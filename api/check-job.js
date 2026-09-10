/* CalCar Check: стан durable-аналізу і публічний read-only звіт за токеном.
   GET /api/check-job?token=<token>            -> { status, stage, slug, retryable, report?, error? }
   GET /api/check-job?token=<token>&summary=1  -> { status, slug, retryable, summary } (картка для списків)
   retryable: true лише для job, що не встиг завершитись у ліміт функції
   (нижче): повторний запуск дає новий job, старий рядок не чіпається.
   Читає лише сервер через service role. Публічна відповідь будується
   ЯВНИМ allowlist-серіалізатором (api/share.js): переписка чату, входи
   рішення, службова діагностика і будь-яке нове поле схеми публічними
   не стають. Токен непрозорий (128 біт), перебір неможливий; невідомий
   токен дає 404 без деталей. Короткий public_id кабінету публічним ключем
   НЕ є: для старих звітів токен створює /api/share-link після входу. */

export const config = { maxDuration: 15 };

import { resolveLocale, errText } from './locale.js';
import { TOKEN_RE, publicReport, reportSummary, reportSlug } from './share.js';

/* Застряглий job. Функція /api/check живе щонайбільше maxDuration (300 с)
   від початку виклику, а created_at рядка ставиться ВЖЕ всередині цього
   виклику: отже через 300 с після created_at функція гарантовано мертва
   і running/queued може бути лише слідом її смерті (timeout без запису).
   Запас 30 с покриває розсинхрон годинників Vercel і Supabase. Такий job
   переводиться в error АТОМАРНО у БД (PATCH з умовою status і created_at:
   done/error рядок цей запит не зачепить), а відповідь стає retryable. */
export const CHECK_FUNCTION_LIMIT_MS = 300 * 1000;
export const STALE_JOB_AFTER_MS = CHECK_FUNCTION_LIMIT_MS + 30 * 1000;
export const STALE_STAGE = 'timeout';
export function isStaleJob(row, nowMs = Date.now()) {
  if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
  const started = Date.parse(row.created_at || '');
  if (!Number.isFinite(started)) return false;
  return nowMs - started > STALE_JOB_AFTER_MS;
}
export async function failStaleJob(root, hdr, token, errorText, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  const threshold = new Date(nowMs - STALE_JOB_AFTER_MS).toISOString();
  try {
    const r = await fetch(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token)
      + '&status=in.(queued,running)&created_at=lt.' + encodeURIComponent(threshold), {
      method: 'PATCH',
      headers: { ...hdr, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ status: 'error', stage: STALE_STAGE, error: errorText, finished_at: now, updated_at: now }),
    });
    if (!r.ok) return false;
    const rows = await r.json().catch(() => null);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return false; }
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
  const summaryOnly = String(req.query?.summary || '') === '1';
  try {
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });
    const r = await fetch(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token) + '&select=status,stage,report,error,url,vin,lang,created_at,updated_at,finished_at&limit=1', { headers: hdr });
    if (!r.ok) return res.status(500).json({ error: errText(lang, 'internal') });
    const rows = await r.json();
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'not found' });
    /* застряглий job: спершу лагодимо стан у БД (текст помилки мовою
       самого job), і лише тоді відповідаємо; невдалий PATCH відповідь не
       змінює, наступне опитування спробує ще раз */
    const stale = isStaleJob(row);
    if (stale) {
      await failStaleJob(root, hdr, token, errText(resolveLocale(row.lang), 'check_timeout'));
      row.status = 'error'; row.stage = STALE_STAGE; row.error = errText(lang, 'check_timeout');
    }
    const retryable = row.status === 'error' && row.stage === STALE_STAGE;
    const done = row.status === 'done' && row.report && row.report.vehicle;
    const slug = done ? reportSlug(row.report) : null;
    if (summaryOnly) {
      return res.status(200).json({
        status: row.status, slug, retryable,
        summary: done ? { ...reportSummary(row.report), created_at: row.finished_at || row.created_at } : null,
      });
    }
    return res.status(200).json({
      status: row.status,
      stage: row.stage || null,
      slug,
      retryable,
      error: retryable ? errText(lang, 'check_timeout') : (row.error || null),
      report: done ? publicReport(row.report) : null,
      url: row.url || null, vin: row.vin || null, lang: row.lang || null,
      created_at: row.created_at, updated_at: row.updated_at, finished_at: row.finished_at || null,
    });
  } catch (e) {
    return res.status(500).json({ error: errText(lang, 'internal', e.message) });
  }
}
