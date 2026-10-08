/* CalCar Check: benchmark-ендпоінт Final Conclusion.
   Проганяє фінальний synthesis-виклик по ВЖЕ ЗБЕРЕЖЕНОМУ звіту (рядок
   check_jobs за непрозорим токеном, 128 біт) із заданою моделлю і рівнем
   reasoning, щоб порівняти варіанти на реальних машинах. Нічого не пише:
   ні у звіт, ні в БД, ні у Vehicle Memory. Довільних URL і тексту не
   приймає: вхід це лише токен готового звіту.

   POST /api/conclusion-bench
   { job_token, mode?: 'run' | 'models' | 'context' | 'input' | 'shadow', model?, effort?, rules?, shadow_model?, shadow_effort? }
   - models: які моделі бачить production-ключ (лише ідентифікатори);
   - context: компактний контекст, який отримає модель;
   - run: { conclusion, ms, ai, attempts, context_chars };
   - production: смоук production-ланцюжка на КОПІЇ збереженого звіту:
     провайдер за env (runProductionConclusion), attachFinalConclusion,
     злиття checks у чеклист, гейт узгодженості; нічого не пише;
   - input: заморожений вхід без виклику моделі: input_hash (правила,
     контекст звіту і схема відповіді), версія правил, доступність звіту
     для shadow A/B (api/conclusion-shadow.js);
   - shadow: control (production OpenAI, без змін) і shadow (Anthropic,
     api/conclusion-anthropic.js) на ОДНОМУ замороженому вході; пара з
     хешами входу, латентністю, usage і детермінованими перевірками.
     Користувачу нічого не показується, звіт не змінюється. model/effort
     тут ігноруються (control завжди production), shadow_model,
     shadow_effort і shadow_max_tokens лише для shadow-провайдера;
     skip_control: true запускає лише shadow (варіант моделі чи effort
     проти вже зібраних control-виходів, звʼязка за input_hash локально);
     лише тоді shadow_timeout_ms може бути до 780 с.
   rules (лише mode run): текст кандидатних редакційних правил для A/B. Він
   підміняє system-повідомлення ТІЛЬКИ в цьому одному bench-виклику; правила
   production (CONCLUSION_RULES), звичайні Check і збережені звіти не
   змінюються. Без rules виклик іде з правилами production.

   Доступ: заголовок x-calcar-bench, що збігається з env BENCH_KEY. Без
   ключа ендпоінт відповідав лише до OPEN_UNTIL (вікно A/B 2026-10-02 перед
   beta); вікно закрите, тепер потрібен ключ. */

/* 800 s (Pro with Fluid compute) leaves room for a shadow-only run at a
   high reasoning effort; every other mode keeps its own 270 s budget */
export const config = { maxDuration: 800 };
export const SHADOW_ONLY_TIMEOUT_MS = { min: 60000, max: 780000 };
export const HEARTBEAT_MS = 15000;

import { TOKEN_RE } from './share.js';
import { runFinalConclusion, buildConclusionContext, conclusionModel } from './conclusion.js';
import { applyConclusionLanguage, directiveVerdictHits, attachFinalConclusion } from './check.js';
import { runProductionConclusion } from './conclusion-provider.js';
import { sanitizeFcChecks, mergeChecklist } from './checklist-merge.js';
import { enforceReportConsistency } from './report-consistency.js';
import { resolveLocale, languageDirective } from './locale.js';
import { runShadowPair, freezeConclusionInput, shadowAvailability, storedConclusionInfo } from './conclusion-shadow.js';
import { ANTHROPIC_MODEL_RE, ANTHROPIC_EFFORTS } from './conclusion-anthropic.js';

export const OPEN_UNTIL = '2026-10-02T00:00:00Z';
export const MODEL_RE = /^(?:gpt-|o\d|chatgpt-)[A-Za-z0-9._-]{1,60}$/;
export const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

/* кандидатні правила: лише рядок розумного розміру, інакше production */
export const RULES_LIMITS = { min: 200, max: 40000 };
export function candidateRules(v) {
  return typeof v === 'string' && v.trim().length >= RULES_LIMITS.min && v.length <= RULES_LIMITS.max ? v : null;
}
/* транспорт, що підміняє system-повідомлення кандидатними правилами.
   Решта запиту (модель, reasoning, схема, контекст звіту) та сама */
export function withRules(call, rules) {
  if (!rules) return call;
  return (body, ms, signal) => call({ ...body, messages: (body.messages || []).map(m => (m && m.role === 'system' ? { ...m, content: rules } : m)) }, ms, signal);
}

export function benchAllowed(req, env, nowMs = Date.now()) {
  const key = env && env.BENCH_KEY;
  if (key && req.headers && req.headers['x-calcar-bench'] === key) return true;
  return nowMs < Date.parse(OPEN_UNTIL);
}

export async function callModel(body, ms, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: ctl.signal, method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify(body),
    });
    return await resp.json();
  } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!benchAllowed(req, process.env)) return res.status(404).json({ error: 'not found' });
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'not configured' });
  const b = req.body || {};
  const token = String(b.job_token || '').trim();
  if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });
  const mode = ['run', 'models', 'context', 'input', 'shadow', 'production'].includes(b.mode) ? b.mode : 'run';
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token) + '&status=eq.done&select=report,lang&limit=1',
      { headers: { apikey: key, authorization: 'Bearer ' + key } });
    if (!r.ok) {
      console.error('[conclusion-bench]', JSON.stringify({ op: 'job_read', http_status: r.status }));
      return res.status(502).json({ error: 'job read failed' });
    }
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row || !row.report || !row.report.vehicle) return res.status(404).json({ error: 'not found' });

    if (mode === 'models') {
      const mr = await fetch('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY } });
      const mj = await mr.json().catch(() => ({}));
      if (!mr.ok) return res.status(502).json({ error: (mj && mj.error && mj.error.message) || 'models failed' });
      const models = (Array.isArray(mj.data) ? mj.data : [])
        .filter(m => m && MODEL_RE.test(String(m.id || '')))
        .sort((x, y) => (y.created || 0) - (x.created || 0))
        .map(m => ({ id: m.id, created: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null }));
      return res.status(200).json({ ok: true, production: conclusionModel(process.env), check_model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', models });
    }

    const report = row.report;
    if (mode === 'context') return res.status(200).json({ ok: true, context: buildConclusionContext(report) });

    if (mode === 'production') {
      const lang = resolveLocale(row.lang || (report._meta && report._meta.lang));
      const rep = JSON.parse(JSON.stringify(report));
      delete rep.final_conclusion;
      if (rep._meta) { delete rep._meta.final_conclusion; delete rep._meta.checklist_merge; delete rep._meta.consistency; }
      const fc = await runProductionConclusion({ report: rep, langDirective: languageDirective(lang), callModel, timeoutMs: 270000, env: process.env });
      const attached = attachFinalConclusion(rep, fc, lang);
      const fcOk = attached && fc.status === 'ok' && fc.conclusion;
      const snapshot = fcOk && Array.isArray(fc.checklist_snapshot) ? fc.checklist_snapshot : null;
      const fcc = fcOk ? sanitizeFcChecks(fc.conclusion.checks, snapshot ? snapshot.length : 0) : { checks: [], rejected: [] };
      const cm = mergeChecklist(rep, { fcChecks: fcc.checks, snapshot, lang });
      const rc = enforceReportConsistency(rep, { lang });
      return res.status(200).json({
        ok: !!attached, lang, provider: fc.provider || null, model: (fc.ai && fc.ai.model) || null, effort: fc.effort || null, version: fc.version || null,
        status: fc.status, reason: fc.reason || null, fallback_reason: fc.fallback_reason || null, ms: fc.ms, ai: fc.ai || null, attempts: fc.attempts || [],
        meta: rep._meta ? rep._meta.final_conclusion : null, final_conclusion: rep.final_conclusion || null,
        checks: { returned: fcOk && Array.isArray(fc.conclusion.checks) ? fc.conclusion.checks : [], accepted: fcc.checks, rejected: fcc.rejected },
        checklist_merge: { before: cm.before, after: cm.after, refined: cm.refined, added: cm.added, skipped: cm.skipped }, checklist_after: rep.checklist,
        consistency: { version: rc.version, violations: rc.violations.length, dropped: rc.dropped, sentences_removed: rc.sentences_removed, hidden: rc.hidden, fc_violations: rc.violations.filter(v => String(v.section || '').startsWith('final_conclusion')) },
      });
    }

    if (mode === 'input' || mode === 'shadow') {
      const lang = resolveLocale(row.lang || (report._meta && report._meta.lang));
      if (mode === 'input') {
        const frozen = freezeConclusionInput({ report, langDirective: languageDirective(lang) });
        return res.status(200).json({ ok: !!frozen, lang, availability: shadowAvailability(report), stored_conclusion: storedConclusionInfo(report),
          input: frozen ? { input_hash: frozen.input_hash, rules_version: frozen.rules_version, rules_hash: frozen.rules_hash, schema_hash: frozen.schema_hash, context_chars: frozen.context_chars, checklist_snapshot_items: frozen.checklist_snapshot.length } : null });
      }
      const shadowModel = typeof b.shadow_model === 'string' && ANTHROPIC_MODEL_RE.test(b.shadow_model) ? b.shadow_model : null;
      const shadowEffort = ANTHROPIC_EFFORTS.includes(b.shadow_effort) ? b.shadow_effort : null;
      const shadowMaxTokens = Number.isInteger(b.shadow_max_tokens) ? b.shadow_max_tokens : null;
      const skipControl = b.skip_control === true;
      /* only a shadow-only run may use more than the paired 270 s */
      const shadowTimeout = skipControl && Number.isInteger(b.shadow_timeout_ms) ? Math.min(SHADOW_ONLY_TIMEOUT_MS.max, Math.max(SHADOW_ONLY_TIMEOUT_MS.min, b.shadow_timeout_ms)) : 270000;
      /* a long shadow-only run keeps the client connection alive: headers go
         out at once and a space every 15 s, the JSON follows at the end
         (leading whitespace is valid JSON). A connection with no bytes for
         minutes is dropped on the way, the answer would be lost */
      let beat = null;
      if (shadowTimeout > 270000) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.write(' ');
        beat = setInterval(() => { try { res.write(' '); } catch (e) { /* client gone; the run still finishes */ } }, HEARTBEAT_MS);
      }
      let pair;
      try {
        pair = await runShadowPair({
          token, report, lang, langDirective: languageDirective(lang),
          callOpenAI: callModel, callAnthropic: null, env: process.env, timeoutMs: shadowTimeout,
          applyLanguage: applyConclusionLanguage, directiveHits: directiveVerdictHits, shadowModel, shadowEffort, shadowMaxTokens, skipControl,
        });
      } finally { if (beat) clearInterval(beat); }
      pair.anthropic_key_present = !!process.env.ANTHROPIC_API_KEY;
      if (beat) return res.end(JSON.stringify({ ok: pair.status === 'ok', ...pair }));
      return res.status(200).json({ ok: pair.status === 'ok', ...pair });
    }

    const model = typeof b.model === 'string' && MODEL_RE.test(b.model) ? b.model : null;
    const effort = EFFORTS.includes(b.effort) || b.effort === 'off' ? b.effort : null;
    const lang = resolveLocale(row.lang || (report._meta && report._meta.lang));
    if (b.rules !== undefined && b.rules !== null && !candidateRules(b.rules)) return res.status(400).json({ error: 'bad rules' });
    const rules = candidateRules(b.rules);
    const out = await runFinalConclusion({ report, langDirective: languageDirective(lang), callModel: withRules(callModel, rules), timeoutMs: 270000, model, effort, env: { ...process.env, FINAL_CONCLUSION: 'on' } });
    let conclusion = null, directive = null;
    if (out.status === 'ok' && out.conclusion) {
      conclusion = applyConclusionLanguage({ headline: out.conclusion.headline, body: out.conclusion.body }, report, lang);
      const hits = directiveVerdictHits({ headline: conclusion.headline, reasoning: conclusion.body });
      directive = hits.length ? hits : null;
    }
    return res.status(200).json({ ok: out.status === 'ok', status: out.status, reason: out.reason, lang, ms: out.ms, ai: out.ai, attempts: out.attempts, context_chars: out.context_chars, version: out.version, rules: rules ? 'candidate' : 'production', rules_chars: rules ? rules.length : null, conclusion, directive });
  } catch (e) {
    console.error('[conclusion-bench]', JSON.stringify({ op: mode, error: String((e && e.message) || e).slice(0, 200) }));
    if (res.headersSent) return res.end(JSON.stringify({ ok: false, status: 'error', reason: 'internal' }));
    return res.status(500).json({ error: 'internal' });
  }
}
