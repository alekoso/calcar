/* CalCar Check: стан durable-аналізу і read-only звіт за токеном.
   GET /api/check-job?token=<token>  -> { status, stage, report?, error? }
   GET /api/check-job?pid=<public_id> -> збережений звіт кабінету як
   read-only (для посилання "Поділитися" на старі звіти без токена).
   Читає лише сервер через service role; приватні поля (переписка чату,
   входи рішення з назвами інших авто цієї людини) у публічну відповідь
   не потрапляють. Токен непрозорий, перебір неможливий; невідомий токен
   дає 404 без деталей. */

export const config = { maxDuration: 15 };

import { resolveLocale, errText } from './locale.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const PID_RE = /^[A-Z0-9]{4,12}$/;

export function publicReport(report) {
  if (!report || typeof report !== 'object') return null;
  const out = { ...report };
  delete out._chat;
  if (out._meta && typeof out._meta === 'object') {
    const meta = { ...out._meta };
    delete meta.decision_inputs;
    out._meta = meta;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const lang = resolveLocale(req.query?.lang);
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  res.setHeader('cache-control', 'no-store');
  if (!base || !key) return res.status(500).json({ error: errText(lang, 'internal') });
  const hdr = { apikey: key, authorization: 'Bearer ' + key };
  const root = base.replace(/\/$/, '');
  const token = String(req.query?.token || '').trim();
  const pid = String(req.query?.pid || '').trim().toUpperCase();
  try {
    if (token) {
      if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });
      const r = await fetch(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token) + '&select=status,stage,report,error,url,vin,lang,created_at,updated_at,finished_at&limit=1', { headers: hdr });
      if (!r.ok) return res.status(500).json({ error: errText(lang, 'internal') });
      const rows = await r.json();
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).json({ error: 'not found' });
      /* job, що застряг у running довше за ліміт функції, чесно вважається зламаним */
      const ageMs = Date.now() - Date.parse(row.updated_at || row.created_at || 0);
      const stale = (row.status === 'queued' || row.status === 'running') && ageMs > 6 * 60 * 1000;
      return res.status(200).json({
        status: stale ? 'error' : row.status,
        stage: row.stage || null,
        error: stale ? errText(lang, 'check_timeout') : (row.error || null),
        report: row.status === 'done' ? publicReport(row.report) : null,
        url: row.url || null, vin: row.vin || null, lang: row.lang || null,
        created_at: row.created_at, updated_at: row.updated_at, finished_at: row.finished_at || null,
      });
    }
    if (pid) {
      if (!PID_RE.test(pid)) return res.status(404).json({ error: 'not found' });
      const r = await fetch(root + '/rest/v1/reports?public_id=eq.' + encodeURIComponent(pid) + '&kind=eq.check&select=data,created_at&limit=1', { headers: hdr });
      if (!r.ok) return res.status(500).json({ error: errText(lang, 'internal') });
      const rows = await r.json();
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!row || !row.data || !row.data.vehicle) return res.status(404).json({ error: 'not found' });
      return res.status(200).json({ status: 'done', stage: 'done', report: publicReport(row.data), created_at: row.created_at, finished_at: row.created_at });
    }
    return res.status(400).json({ error: 'token or pid required' });
  } catch (e) {
    return res.status(500).json({ error: errText(lang, 'internal', e.message) });
  }
}
