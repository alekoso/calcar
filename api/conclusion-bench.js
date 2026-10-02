/* CalCar Check: benchmark-ендпоінт Final Conclusion.
   Проганяє фінальний synthesis-виклик по ВЖЕ ЗБЕРЕЖЕНОМУ звіту (рядок
   check_jobs за непрозорим токеном, 128 біт) із заданою моделлю і рівнем
   reasoning, щоб порівняти варіанти на реальних машинах. Нічого не пише:
   ні у звіт, ні в БД, ні у Vehicle Memory. Довільних URL і тексту не
   приймає: вхід це лише токен готового звіту.

   POST /api/conclusion-bench
   { job_token, mode?: 'run' | 'models' | 'context', model?, effort? }
   - models: які моделі бачить production-ключ (лише ідентифікатори);
   - context: компактний контекст, який отримає модель;
   - run: { conclusion, ms, ai, attempts, context_chars }.

   Доступ: заголовок x-calcar-bench, що збігається з env BENCH_KEY. Без
   ключа ендпоінт відповідає лише до OPEN_UNTIL (вікно A/B перед beta),
   після цієї дати закривається сам. */

export const config = { maxDuration: 300 };

import { TOKEN_RE } from './share.js';
import { runFinalConclusion, buildConclusionContext, conclusionModel } from './conclusion.js';
import { applyConclusionLanguage, directiveVerdictHits } from './check.js';
import { resolveLocale, languageDirective } from './locale.js';

export const OPEN_UNTIL = '2026-10-04T00:00:00Z';
export const MODEL_RE = /^(?:gpt-|o\d|chatgpt-)[A-Za-z0-9._-]{1,60}$/;
export const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

export function benchAllowed(req, env, nowMs = Date.now()) {
  const key = env && env.BENCH_KEY;
  if (key && req.headers && req.headers['x-calcar-bench'] === key) return true;
  return nowMs < Date.parse(OPEN_UNTIL);
}

async function callModel(body, ms, signal) {
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
  const mode = ['run', 'models', 'context'].includes(b.mode) ? b.mode : 'run';
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

    const model = typeof b.model === 'string' && MODEL_RE.test(b.model) ? b.model : null;
    const effort = EFFORTS.includes(b.effort) || b.effort === 'off' ? b.effort : null;
    const lang = resolveLocale(row.lang || (report._meta && report._meta.lang));
    const out = await runFinalConclusion({ report, langDirective: languageDirective(lang), callModel, timeoutMs: 270000, model, effort, env: { ...process.env, FINAL_CONCLUSION: 'on' } });
    let conclusion = null, directive = null;
    if (out.status === 'ok' && out.conclusion) {
      conclusion = applyConclusionLanguage({ headline: out.conclusion.headline, body: out.conclusion.body }, report, lang);
      const hits = directiveVerdictHits({ headline: conclusion.headline, reasoning: conclusion.body });
      directive = hits.length ? hits : null;
    }
    return res.status(200).json({ ok: out.status === 'ok', status: out.status, reason: out.reason, lang, ms: out.ms, ai: out.ai, attempts: out.attempts, context_chars: out.context_chars, version: out.version, conclusion, directive });
  } catch (e) {
    console.error('[conclusion-bench]', JSON.stringify({ op: mode, error: String((e && e.message) || e).slice(0, 200) }));
    return res.status(500).json({ error: 'internal' });
  }
}
