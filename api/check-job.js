/* CalCar Check: стан durable-аналізу і публічний read-only звіт за токеном.
   GET /api/check-job?token=<token>            -> { status, stage, slug, report?, error? }
   GET /api/check-job?token=<token>&summary=1  -> { status, slug, summary } (картка для списків)
   Читає лише сервер через service role. Публічна відповідь будується
   ЯВНИМ allowlist-серіалізатором (api/share.js): переписка чату, входи
   рішення, службова діагностика і будь-яке нове поле схеми публічними
   не стають. Токен непрозорий (128 біт), перебір неможливий; невідомий
   токен дає 404 без деталей. Короткий public_id кабінету публічним ключем
   НЕ є: для старих звітів токен створює /api/share-link після входу. */

export const config = { maxDuration: 15 };

import { resolveLocale, errText } from './locale.js';
import { TOKEN_RE, publicReport, reportSummary, reportSlug } from './share.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const lang = resolveLocale(req.query?.lang);
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  res.setHeader('cache-control', 'no-store');
  if (!base || !key) return res.status(500).json({ error: errText(lang, 'internal') });
  const hdr = { apikey: key, authorization: 'Bearer ' + key };
  const root = base.replace(/\/$/, '');
  const token = String(req.query?.token || '').trim();
  const summaryOnly = String(req.query?.summary || '') === '1';
  try {
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });
    const r = await fetch(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token) + '&select=status,stage,report,error,url,vin,lang,created_at,updated_at,finished_at&limit=1', { headers: hdr });
    if (!r.ok) return res.status(500).json({ error: errText(lang, 'internal') });
    const rows = await r.json();
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'not found' });
    /* job, що застряг у running довше за ліміт функції, чесно вважається зламаним */
    const ageMs = Date.now() - Date.parse(row.updated_at || row.created_at || 0);
    const stale = (row.status === 'queued' || row.status === 'running') && ageMs > 6 * 60 * 1000;
    const done = row.status === 'done' && row.report && row.report.vehicle;
    const slug = done ? reportSlug(row.report) : null;
    if (summaryOnly) {
      return res.status(200).json({
        status: stale ? 'error' : row.status, slug,
        summary: done ? { ...reportSummary(row.report), created_at: row.finished_at || row.created_at } : null,
      });
    }
    return res.status(200).json({
      status: stale ? 'error' : row.status,
      stage: row.stage || null,
      slug,
      error: stale ? errText(lang, 'check_timeout') : (row.error || null),
      report: done ? publicReport(row.report) : null,
      url: row.url || null, vin: row.vin || null, lang: row.lang || null,
      created_at: row.created_at, updated_at: row.updated_at, finished_at: row.finished_at || null,
    });
  } catch (e) {
    return res.status(500).json({ error: errText(lang, 'internal', e.message) });
  }
}
