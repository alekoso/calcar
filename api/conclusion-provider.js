/* CalCar Check: which provider writes the production Final Conclusion.

   env CONCLUSION_PROVIDER: anthropic (default since 2026-10-08, after the
   shadow A/B) | openai (the previous path, unchanged). Any other value
   means the default.

   anthropic: Claude (api/conclusion-anthropic.js; claude-opus-5-5, effort
   medium unless CONCLUSION_ANTHROPIC_MODEL / CONCLUSION_ANTHROPIC_EFFORT
   say otherwise) gets exactly the input the OpenAI path builds: the same
   CONCLUSION_RULES (fc-v2.5) and the same user message from
   buildConclusionContext, with the same json_schema including checks.
   One provider per Check: Claude alone on success. If Claude fails
   (error, timeout, rate limit after its own retry, refusal, invalid
   output, missing key), the existing OpenAI runFinalConclusion runs once
   with the time left; nothing else changes downstream (language, checklist
   merge, consistency gate run on the result as before).

   The result has the shape of runFinalConclusion plus provider
   (anthropic | openai_fallback | openai), effort and fallback_reason.
   Not a Vercel function. */

import { CONCLUSION_RULES, CONCLUSION_TIMEOUT_MS, CONCLUSION_MIN_BUDGET_MS, CONCLUSION_VERSION, buildConclusionContext, conclusionUserMessage, conclusionEnabled, conclusionModel, runFinalConclusion } from './conclusion.js';
import { runAnthropicConclusion, anthropicConclusionModel } from './conclusion-anthropic.js';

export const CONCLUSION_PROVIDERS = ['anthropic', 'openai'];
export const CONCLUSION_PROVIDER_DEFAULT = 'anthropic';
/* below this the fallback would have no time to finish, so Claude leaves it */
export const FALLBACK_RESERVE_MS = CONCLUSION_MIN_BUDGET_MS;

export function conclusionProvider(env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const v = String(e.CONCLUSION_PROVIDER || '').trim().toLowerCase();
  return CONCLUSION_PROVIDERS.includes(v) ? v : CONCLUSION_PROVIDER_DEFAULT;
}

const checklistSnapshot = report => (report && Array.isArray(report.checklist) ? report.checklist : []).filter(t => typeof t === 'string' && t.trim()).slice(0, 8).map(t => t.trim());
const logLine = o => console.log('[final-conclusion]', JSON.stringify(o));

/* callModel is the OpenAI transport of the Check, used only by the openai
   path and by the fallback */
export async function runProductionConclusion({ report, langDirective = '', callModel, timeoutMs = CONCLUSION_TIMEOUT_MS, env = null, signal = null, callAnthropic = null } = {}) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const t0 = Date.now();
  const provider = conclusionProvider(e);
  if (provider === 'openai') {
    const out = await runFinalConclusion({ report, langDirective, callModel, timeoutMs, env: e, signal });
    return { ...out, provider: 'openai', effort: conclusionModel(e).effort, fallback_reason: null };
  }
  const skipped = reason => ({ status: 'skipped', conclusion: null, ms: 0, ai: null, attempts: [], reason, version: CONCLUSION_VERSION, context_chars: 0, provider: 'anthropic', effort: null, fallback_reason: null });
  if (!conclusionEnabled(e)) return skipped('disabled');
  let context = null;
  try { context = buildConclusionContext(report); } catch (err) { context = null; }
  if (!context || !context.vehicle) return skipped('no_context');
  /* the same strings runFinalConclusion sends to OpenAI */
  const user = conclusionUserMessage({ langDirective, context });
  const acfg = anthropicConclusionModel(e);
  const claudeBudget = Math.max(15000, timeoutMs - FALLBACK_RESERVE_MS);
  const a = await runAnthropicConclusion({ system: CONCLUSION_RULES, user, callModel: callAnthropic, timeoutMs: claudeBudget, env: e, signal })
    .catch(err => ({ status: 'error', reason: String((err && err.message) || err).slice(0, 160), conclusion: null, ai: null, attempts: [] }));
  if (a.status === 'ok' && a.conclusion) {
    return {
      status: 'ok', conclusion: a.conclusion, ms: Date.now() - t0, ai: a.ai, attempts: a.attempts, reason: null,
      version: CONCLUSION_VERSION, context_chars: user.length, checklist_snapshot: checklistSnapshot(report),
      provider: 'anthropic', effort: a.effort || acfg.effort, fallback_reason: null,
    };
  }
  /* one OpenAI fallback with the time that is left */
  const reason = a.reason || a.status || 'error';
  const left = timeoutMs - (Date.now() - t0);
  logLine({ op: 'fallback', from: 'anthropic', to: 'openai', reason, ms: Date.now() - t0, left_ms: left, attempts: a.attempts });
  const anthropicAttempts = (a.attempts || []).map(x => ({ ...x, provider: 'anthropic' }));
  if (left < 15000) {
    return { status: 'error', conclusion: null, ms: Date.now() - t0, ai: null, attempts: anthropicAttempts, reason: 'fallback_no_time', version: CONCLUSION_VERSION, context_chars: user.length, provider: 'openai_fallback', effort: null, fallback_reason: reason };
  }
  const o = await runFinalConclusion({ report, langDirective, callModel, timeoutMs: left, env: e, signal });
  return {
    ...o, ms: Date.now() - t0, attempts: [...anthropicAttempts, ...(o.attempts || []).map(x => ({ ...x, provider: 'openai' }))],
    provider: 'openai_fallback', effort: conclusionModel(e).effort, fallback_reason: reason,
  };
}
