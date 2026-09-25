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

import { createHash } from 'node:crypto';
import { resolveLocale, errText } from './locale.js';
import { TOKEN_RE, publicReport, reportSummary, reportSlug } from './share.js';

/* Читання job із Supabase з жорстким таймаутом: увесь ендпоінт мусить
   вкластися в maxDuration 15 с, інакше Vercel сам віддає 504 без жодного
   сліду в логах. Гірший випадок: спроба 5 с + пауза 0,4 с + спроба 5 с +
   PATCH застряглого job 3 с = 13,4 с. Обидві спроби невдалі -> 503
   (сторінка повторить), а не "job ще рахується". */
export const JOB_READ_TIMEOUT_MS = 5000;
export const JOB_READ_BACKOFF_MS = 400;
export const JOB_PATCH_TIMEOUT_MS = 3000;
export const JOB_READ_ATTEMPTS = 2;

/* токен це ключ доступу до звіту: у логи лише короткий відбиток */
export function tokenRef(token) {
  return createHash('sha256').update(String(token || '')).digest('hex').slice(0, 12);
}

function classifyReadError(e) {
  if (e && e.http_status) return { error_type: e.http_status >= 500 || e.http_status === 429 ? 'http_5xx' : 'http_4xx', transient: e.http_status >= 500 || e.http_status === 429 };
  if (e && e.name === 'AbortError') return { error_type: 'timeout', transient: true };
  if (e && e.name === 'SyntaxError') return { error_type: 'bad_json', transient: true };
  return { error_type: 'network', transient: true };
}

/* -> { ok: true, rows, attempts } | { ok: false, transient, error_type, http_status, attempts } */
export async function readJobRow(url, hdr, token, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? JOB_READ_TIMEOUT_MS;
  const backoffMs = opts.backoffMs ?? JOB_READ_BACKOFF_MS;
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const log = opts.log || (o => console.error(JSON.stringify(o)));
  let fail = null;
  for (let attempt = 1; attempt <= JOB_READ_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: hdr, signal: ctl.signal });
      if (!r.ok) throw Object.assign(new Error('supabase http ' + r.status), { http_status: r.status || 500 });
      /* тіло читається під тим самим таймаутом */
      const rows = await r.json();
      return { ok: true, rows, attempts: attempt };
    } catch (e) {
      const c = classifyReadError(e);
      fail = { ok: false, transient: c.transient, error_type: c.error_type, http_status: (e && e.http_status) || null, attempts: attempt };
      const last = !c.transient || attempt === JOB_READ_ATTEMPTS;
      log({ op: 'check_job_read', attempt, final: last, duration_ms: Date.now() - t0, error_type: c.error_type, http_status: fail.http_status, token_ref: tokenRef(token) });
      if (last) break;
      await sleep(backoffMs);
    } finally {
      clearTimeout(timer);
    }
  }
  return fail;
}

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
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), JOB_PATCH_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token)
      + '&status=in.(queued,running)&created_at=lt.' + encodeURIComponent(threshold), {
      method: 'PATCH',
      headers: { ...hdr, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ status: 'error', stage: STALE_STAGE, error: errorText, finished_at: now, updated_at: now }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      console.error(JSON.stringify({ op: 'check_job_fail_stale', duration_ms: Date.now() - t0, error_type: 'http', http_status: r.status || null, token_ref: tokenRef(token) }));
      return false;
    }
    const rows = await r.json().catch(() => null);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    /* невдалий PATCH відповідь не змінює, наступне опитування спробує ще раз */
    console.error(JSON.stringify({ op: 'check_job_fail_stale', duration_ms: Date.now() - t0, error_type: e && e.name === 'AbortError' ? 'timeout' : 'network', token_ref: tokenRef(token) }));
    return false;
  } finally {
    clearTimeout(timer);
  }
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
    const read = await readJobRow(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token) + '&select=status,stage,report,error,url,vin,lang,created_at,updated_at,finished_at&limit=1', hdr, token);
    /* збій читання не маскується під "job ще триває": 503 для тимчасового
       збою (сторінка повторить), 500 для постійного */
    if (!read.ok) {
      if (read.transient) res.setHeader('retry-after', '2');
      return res.status(read.transient ? 503 : 500).json({ error: errText(lang, 'internal') });
    }
    const rows = read.rows;
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
