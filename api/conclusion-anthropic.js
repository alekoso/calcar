/* CalCar Check: Final Conclusion, Anthropic provider (SHADOW ONLY).

   Same product rules (CONCLUSION_RULES), the same user message and the same
   output schema as the production OpenAI Final Conclusion. Only the wire
   format differs: the Messages API takes the rules as `system`, the report
   context as the single user turn and the schema as
   output_config.format. Reasoning depth maps to output_config.effort
   (medium, like the production reasoning_effort); thinking stays adaptive
   because this model cannot run without it.

   Nothing here reaches a user: api/check.js never imports this file. Callers
   are the benchmark endpoint (api/conclusion-bench.js, mode shadow) and the
   local runner (fc-shadow-bench.js), always with the frozen input of a
   stored report. There is no fallback model and no server-side refusal
   fallback: a benchmark run must stay on the model under test, so a
   refusal, a timeout or an API error is recorded as a failure.

   Not a Vercel function (no default export). */

import { CONCLUSION_VERSION, CONCLUSION_TIMEOUT_MS, conclusionResponseFormat, sanitizeConclusion } from './conclusion.js';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const ANTHROPIC_CONCLUSION_MODEL_DEFAULT = 'claude-opus-5-5';
export const ANTHROPIC_CONCLUSION_EFFORT_DEFAULT = 'medium';
export const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const ANTHROPIC_MODEL_RE = /^claude-[A-Za-z0-9.-]{1,60}$/;
/* same output budget as the production call (max_completion_tokens 12000).
   On both APIs this ceiling includes the model's reasoning tokens */
export const ANTHROPIC_MAX_TOKENS = 12000;
/* a benchmark may raise the ceiling (never lower it) for a high-effort run:
   the model does not see max_tokens, so a higher ceiling changes nothing
   but whether a long answer is cut off */
export const ANTHROPIC_MAX_TOKENS_LIMIT = 64000;
export function anthropicMaxTokens(v) { return Number.isInteger(v) && v >= ANTHROPIC_MAX_TOKENS && v <= ANTHROPIC_MAX_TOKENS_LIMIT ? v : ANTHROPIC_MAX_TOKENS; }
/* one retry only for transient failures; a short pause between attempts */
export const ANTHROPIC_RETRY_PAUSE_MS = 1500;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const RETRYABLE_TYPES = new Set(['rate_limit_error', 'overloaded_error', 'api_error']);

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* model and effort of the shadow provider only. Env overrides without code:
   CONCLUSION_ANTHROPIC_MODEL, CONCLUSION_ANTHROPIC_EFFORT. Neither is
   required: the defaults are the benchmark configuration */
export function anthropicConclusionModel(env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const model = typeof e.CONCLUSION_ANTHROPIC_MODEL === 'string' && ANTHROPIC_MODEL_RE.test(e.CONCLUSION_ANTHROPIC_MODEL) ? e.CONCLUSION_ANTHROPIC_MODEL : ANTHROPIC_CONCLUSION_MODEL_DEFAULT;
  const effort = ANTHROPIC_EFFORTS.includes(e.CONCLUSION_ANTHROPIC_EFFORT) ? e.CONCLUSION_ANTHROPIC_EFFORT : ANTHROPIC_CONCLUSION_EFFORT_DEFAULT;
  return { model, effort };
}

/* the request body. `system` and `user` are the exact strings the control
   call sends (CONCLUSION_RULES and conclusionUserMessage); the schema is
   the production json_schema taken from conclusionResponseFormat() */
export function anthropicConclusionBody({ system, user, model, effort, maxTokens = ANTHROPIC_MAX_TOKENS, stream = false } = {}) {
  return {
    model,
    max_tokens: maxTokens,
    /* a raised ceiling means a long call: the answer is streamed so the
       connection never sits idle for minutes; the content is the same */
    ...(stream ? { stream: true } : {}),
    /* static rules first with a cache breakpoint: the production OpenAI call
       gets its prefix cached automatically, the Messages API needs the marker */
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: {
      effort,
      format: { type: 'json_schema', schema: conclusionResponseFormat().json_schema.schema },
    },
  };
}

/* transport: raw Messages API over fetch, no SDK (the project has no npm
   dependencies). The key is read here and only here; it never enters the
   returned data or any log */
export async function callAnthropic(body, ms, signal, env) {
  const e = env || process.env || {};
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      signal: ctl.signal, method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': e.ANTHROPIC_API_KEY || '', 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(body),
    });
    const isStream = body && body.stream === true && resp.ok && /event-stream/.test(String(resp.headers.get('content-type') || ''));
    if (isStream) { const data = await readAnthropicStream(resp); data.http_status = resp.status; return data; }
    const json = await resp.json().catch(() => null);
    const data = isObj(json) ? json : { type: 'error', error: { type: 'bad_response', message: 'non-JSON response' } };
    data.http_status = resp.status;
    return data;
  } finally { clearTimeout(t); }
}

/* SSE stream -> the same shape as a non-streaming message: text blocks
   joined, stop_reason and stop_details, usage from message_start and the
   final message_delta. Thinking deltas are not kept (display is omitted) */
export function assembleAnthropicEvents(events) {
  const msg = { type: 'message', model: null, content: [], stop_reason: null, stop_details: null, usage: {} };
  const blocks = {};
  for (const ev of Array.isArray(events) ? events : []) {
    if (!isObj(ev)) continue;
    if (ev.type === 'error') return { type: 'error', error: isObj(ev.error) ? ev.error : { type: 'stream_error', message: 'stream error' } };
    if (ev.type === 'message_start' && isObj(ev.message)) {
      msg.model = ev.message.model || null;
      if (isObj(ev.message.usage)) Object.assign(msg.usage, ev.message.usage);
    } else if (ev.type === 'content_block_start' && isObj(ev.content_block)) {
      blocks[ev.index] = { type: ev.content_block.type, text: typeof ev.content_block.text === 'string' ? ev.content_block.text : '' };
    } else if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'text_delta') {
      (blocks[ev.index] = blocks[ev.index] || { type: 'text', text: '' }).text += ev.delta.text || '';
    } else if (ev.type === 'message_delta') {
      if (isObj(ev.delta)) { if (ev.delta.stop_reason !== undefined) msg.stop_reason = ev.delta.stop_reason; if (ev.delta.stop_details !== undefined) msg.stop_details = ev.delta.stop_details; }
      if (isObj(ev.usage)) Object.assign(msg.usage, ev.usage);
    }
  }
  msg.content = Object.keys(blocks).map(Number).sort((a, b) => a - b).map(i => blocks[i]).filter(b => b.type === 'text').map(b => ({ type: 'text', text: b.text }));
  if (msg.stop_reason === null) return { type: 'error', error: { type: 'stream_incomplete', message: 'stream ended without a final message_delta' } };
  return msg;
}

export async function readAnthropicStream(resp) {
  const text = await resp.text();
  const events = [];
  for (const chunk of text.split(/\r?\n\r?\n/)) {
    const data = chunk.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
    if (!data) continue;
    try { events.push(JSON.parse(data)); } catch (e) { /* a partial last chunk is caught by the missing message_delta */ }
  }
  return assembleAnthropicEvents(events);
}

/* response -> { clean, error, retryable }. Never throws */
export function parseAnthropicConclusion(data) {
  if (!isObj(data)) return { clean: null, error: 'empty_response', retryable: true };
  const status = typeof data.http_status === 'number' ? data.http_status : null;
  if (data.type === 'error' || isObj(data.error)) {
    const er = isObj(data.error) ? data.error : {};
    const type = String(er.type || 'unknown');
    return {
      clean: null,
      error: 'api_error:' + type + (er.message ? ':' + String(er.message).slice(0, 160) : ''),
      retryable: RETRYABLE_TYPES.has(type) || (status !== null && RETRYABLE_STATUS.has(status)),
    };
  }
  if (data.stop_reason === 'refusal') {
    const cat = isObj(data.stop_details) && data.stop_details.category ? String(data.stop_details.category) : 'unspecified';
    return { clean: null, error: 'refusal:' + cat, retryable: false };
  }
  if (data.stop_reason === 'max_tokens') return { clean: null, error: 'max_tokens', retryable: false };
  const text = arr(data.content).filter(b => isObj(b) && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
  let clean = null;
  try { clean = sanitizeConclusion(JSON.parse(text.replace(/```json|```/g, '').trim())); } catch (e) { clean = null; }
  return { clean, error: clean ? null : 'invalid_output', retryable: false };
}

/* usage in the same shape runFinalConclusion reports for OpenAI. The
   Messages API counts reasoning inside output_tokens, so reasoning_tokens
   stays null rather than being guessed */
export function anthropicUsage(data, body, effort) {
  const u = isObj(data) && isObj(data.usage) ? data.usage : null;
  const out = { provider: 'anthropic', model: (isObj(data) && data.model) || body.model, reasoning_effort: effort || null, reasoning_tokens: null };
  if (u) {
    if (typeof u.input_tokens === 'number') out.input_tokens = u.input_tokens;
    if (typeof u.output_tokens === 'number') out.output_tokens = u.output_tokens;
    if (typeof u.cache_read_input_tokens === 'number') out.cached_tokens = u.cache_read_input_tokens;
    if (typeof u.cache_creation_input_tokens === 'number') out.cache_creation_tokens = u.cache_creation_input_tokens;
  }
  return out;
}

const logLine = o => console.log('[final-conclusion-shadow]', JSON.stringify(o));

/* Returns { provider, status, conclusion, ms, ai, attempts, reason, version,
   model, effort, stop_reason, context_chars }. Never throws. `system` and
   `user` come from the frozen input (api/conclusion-shadow.js); the
   function does not rebuild them, so it cannot drift from the control */
export async function runAnthropicConclusion({ system, user, callModel = null, timeoutMs = CONCLUSION_TIMEOUT_MS, model = null, effort = null, maxTokens = null, env = null, signal = null } = {}) {
  const t0 = Date.now();
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const cfg = anthropicConclusionModel(e);
  const m = model && ANTHROPIC_MODEL_RE.test(model) ? model : cfg.model;
  const eff = ANTHROPIC_EFFORTS.includes(effort) ? effort : cfg.effort;
  const mt = anthropicMaxTokens(maxTokens);
  const out = { provider: 'anthropic', status: 'skipped', conclusion: null, ms: 0, ai: null, attempts: [], reason: null, version: CONCLUSION_VERSION, model: m, effort: eff, max_tokens: mt, stop_reason: null, context_chars: typeof user === 'string' ? user.length : 0 };
  if (typeof system !== 'string' || !system || typeof user !== 'string' || !user) { out.reason = 'no_input'; return out; }
  if (!callModel && !e.ANTHROPIC_API_KEY) { out.reason = 'no_key'; return out; }
  const transport = callModel || ((b, ms, s) => callAnthropic(b, ms, s, e));
  for (let pass = 0; pass < 2; pass++) {
    const left = timeoutMs - (Date.now() - t0);
    if (left < 15000) { out.reason = out.reason || 'timeout'; break; }
    const body = anthropicConclusionBody({ system, user, model: m, effort: eff, maxTokens: mt, stream: mt > ANTHROPIC_MAX_TOKENS });
    const tA = Date.now();
    let data = null, err = null;
    try { data = await transport(body, left, signal); }
    catch (ex) { err = ex && ex.name === 'AbortError' ? 'timeout' : String((ex && ex.message) || ex).slice(0, 160); }
    const parsed = err ? { clean: null, error: err, retryable: err !== 'timeout' } : parseAnthropicConclusion(data);
    out.attempts.push({ model: m, effort: eff, ms: Date.now() - tA, ok: !!parsed.clean, error: parsed.error, http_status: isObj(data) && typeof data.http_status === 'number' ? data.http_status : null, stop_reason: (isObj(data) && data.stop_reason) || null });
    if (parsed.clean) {
      out.status = 'ok'; out.conclusion = parsed.clean; out.ai = anthropicUsage(data, body, eff);
      out.stop_reason = data.stop_reason || null; out.ms = Date.now() - t0; out.reason = null;
      return out;
    }
    out.reason = parsed.error;
    if (pass === 0 && parsed.retryable) { await sleep(ANTHROPIC_RETRY_PAUSE_MS); continue; }
    break;
  }
  out.status = 'error'; out.ms = Date.now() - t0;
  logLine({ op: 'run', status: 'error', reason: out.reason, attempts: out.attempts });
  return out;
}
