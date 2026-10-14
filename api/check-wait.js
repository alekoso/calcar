/* Private, best-effort waiting telemetry. Never sends data to advertising services. */
import { createHash } from 'node:crypto';
export const config = { maxDuration: 10 };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SECRET = /^[a-f0-9]{64}$/i;
const KINDS = ['started','waiting','resume','heartbeat','hidden','visible','leave','handoff','viewed','client_error','accepted'];
/* the job token of check_jobs (api/share.js TOKEN_RE); never logged */
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const STAGES = ['request','queued','listing','identity','history','ai','scoring','done','error','unknown'];
export function identity(raw) {
  if (!raw || !UUID.test(raw.id || '') || !UUID.test(raw.initial_visit || '') || !SECRET.test(raw.secret || '')) return null;
  return { id: raw.id, initial_visit: raw.initial_visit, secret_hash: createHash('sha256').update(raw.secret).digest('hex') };
}
/* the attempt is addressed by its id (same browser) or by the job token
   (another device, the report page); a view needs at least one of them */
export function eventBody(raw) {
  if (!raw || !UUID.test(raw.visit || '') || !KINDS.includes(raw.kind)) return null;
  const id = UUID.test(raw.id || '') ? raw.id : null;
  const token = typeof raw.token === 'string' && TOKEN.test(raw.token) ? raw.token : null;
  if (!id && !(token && raw.kind === 'viewed')) return null;
  if (raw.kind === 'accepted' && !token) return null;
  if (!Number.isInteger(raw.seq) || raw.seq < 0 || raw.seq > 10000) return null;
  const ms = v => Number.isFinite(v) && v >= 0 && v <= 31 * 86400000 ? Math.floor(v) : null;
  if (ms(raw.elapsed_ms) === null || ms(raw.visible_ms) === null) return null;
  return { check_id: id, job_token: token, visit_id: raw.visit, seq: raw.seq, kind: raw.kind,
    elapsed_ms: ms(raw.elapsed_ms), visible_ms: ms(raw.visible_ms),
    stage: STAGES.includes(raw.stage) ? raw.stage : 'unknown' };
}
function env() {
  return process.env.CHECK_WAIT_ANALYTICS_ENABLED === '1' && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
}
async function request(path, body, authorization) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 1500);
  try {
    return await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + path, {
      method: body ? 'POST' : 'GET', signal: ctl.signal,
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: authorization || 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } finally { clearTimeout(timer); }
}
export default async function handler(req, res) {
  res.setHeader('cache-control','no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!env()) return res.status(503).json({ ok: false });
  const origin = req.headers?.origin;
  if (origin && !['https://calcar.io','https://www.calcar.io'].includes(origin) && origin !== process.env.CHECK_WAIT_TEST_ORIGIN) return res.status(403).json({ ok: false });
  let raw;
  try { raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch (_) { return res.status(400).json({ ok: false }); }
  if (JSON.stringify(raw || {}).length > 2048) return res.status(413).json({ ok: false });
  const event = eventBody(raw), v = identity(raw);
  if (!event || (!v && !req.headers?.authorization)) return res.status(400).json({ ok: false });
  let user = null;
  try {
    if (/^Bearer [^\s]+$/.test(req.headers?.authorization || '')) {
      const auth = await request('/auth/v1/user', null, req.headers.authorization);
      if (auth.ok) { const j = await auth.json(); if (typeof j.id === 'string') user = j.id; }
    }
    const { job_token, ...ev } = event;
    const r = await request('/rest/v1/rpc/record_check_wait', { p_event: ev,
      p_secret_hash: v?.secret_hash || null, p_initial_visit: v?.initial_visit || null, p_user_id: user, p_job_token: job_token });
    if (!r.ok) throw new Error('db');
    return res.status(200).json({ ok: await r.json() === true });
  } catch (_) { console.warn(JSON.stringify({ op: 'check_wait_event', status: 'unavailable' })); return res.status(503).json({ ok: false }); }
}
