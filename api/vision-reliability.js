/* Надійність Current Vision: Vision це критичний вхід Score v4.

   Причина збоїв у проді (check_jobs, 10.09 і 24.09): кадри йшли в модель
   ПОСИЛАННЯМИ, і провайдер моделі сам завантажував до 24 фото з CDN
   площадки. Один повільний кадр валив увесь виклик ("Unable to download
   content from the provided URL before the timeout", ~3 с), ретраю не було,
   і Check завершувався з балом без кузова і салону.

   Тут три чисті механізми з інжектованими залежностями:
   1. prefetchFrames: сервер сам завантажує кадри з таймаутом на кадр і
      одним повтором, битий кадр виключається лише сам, решта йде в модель
      байтами (data URL). Якщо не завантажився жоден, лишаються посилання.
   2. withVisionRetry: початкова спроба + до двох повторів із backoff лише
      для технічних помилок (таймаут, мережа, 429/5xx, завантаження кадру,
      битий JSON відповіді). Детерміновано невалідний вхід не повторюється.
   3. visionGate: є придатні кадри, Vision очікувався, а термінальний статус
      не ok -> числовий бал не фіналізується. Збій Vision ніколи не
      перетворюється на "кузов недоступний, бал вищий". */

export const VISION_RELIABILITY = {
  ATTEMPTS: 3,
  BACKOFF_MS: [1500, 4000],
  IMAGE_TIMEOUT_MS: 9000,
  IMAGE_RETRIES: 1,
  IMAGE_MAX_BYTES: 8 * 1024 * 1024,
  IMAGE_CONCURRENCY: 6,
  /* мінімальний залишок бюджету функції, щоб ще раз викликати модель */
  MIN_BUDGET_FOR_RETRY_MS: 40000,
};

const RETRYABLE_RE = /unable to download|timeout|timed out|aborted|abort|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|server_error|server error|overloaded|rate.?limit|temporarily|try again|bad gateway|service unavailable|gateway timeout|invalid_json|no response/i;
const PERMANENT_RE = /no_frames|not_applicable|context_length|invalid_schema|unsupported|content_policy/i;

export function isRetryableVisionError(res) {
  if (!res || res.status === 'ok') return false;
  const e = String(res.error || res.status || '');
  const code = Number(res.http_status || 0);
  if (PERMANENT_RE.test(e)) return false;
  if (code === 429 || code >= 500) return true;
  return RETRYABLE_RE.test(e);
}

/* run(attempt) -> Promise<{ status: 'ok'|'failed'|..., error? }>
   Повертає ОДИН термінальний результат плюс журнал спроб */
export async function withVisionRetry(run, opts = {}) {
  const cfg = { ...VISION_RELIABILITY, ...(opts.cfg || {}) };
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const budgetLeft = opts.budgetLeft || (() => Infinity);
  const attempts = [];
  let last = null;
  for (let i = 0; i < cfg.ATTEMPTS; i++) {
    const t0 = Date.now();
    try { last = await run(i); } catch (e) { last = { status: 'failed', error: String((e && e.message) || e).slice(0, 160) }; }
    if (!last || typeof last !== 'object') last = { status: 'failed', error: 'no result' };
    attempts.push({ attempt: i + 1, status: last.status, error: last.status === 'ok' ? null : String(last.error || '').slice(0, 120), ms: Date.now() - t0 });
    if (last.status === 'ok' || !isRetryableVisionError(last) || i === cfg.ATTEMPTS - 1) break;
    const wait = cfg.BACKOFF_MS[Math.min(i, cfg.BACKOFF_MS.length - 1)];
    if (budgetLeft() < wait + cfg.MIN_BUDGET_FOR_RETRY_MS) { attempts.push({ attempt: i + 2, status: 'skipped', error: 'budget_exhausted', ms: 0 }); break; }
    await sleep(wait);
  }
  return { ...last, attempts };
}

/* один кадр: fetch з таймаутом, лише зображення, лише до ліміту розміру */
async function fetchImage(url, fetchImpl, cfg) {
  let lastErr = 'failed';
  for (let k = 0; k <= cfg.IMAGE_RETRIES; k++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), cfg.IMAGE_TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' } });
      if (!r || !r.ok) { lastErr = 'http_' + (r ? r.status : 'none'); if (r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) break; continue; }
      const type = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(type)) { lastErr = 'not_image:' + (type || 'unknown'); break; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) { lastErr = 'empty'; continue; }
      if (buf.length > cfg.IMAGE_MAX_BYTES) { lastErr = 'too_large'; break; }
      return { ok: true, dataUrl: 'data:' + (type === 'image/jpg' ? 'image/jpeg' : type) + ';base64,' + buf.toString('base64'), bytes: buf.length };
    } catch (e) {
      lastErr = (e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || e).slice(0, 60);
    } finally { clearTimeout(t); }
  }
  return { ok: false, error: lastErr };
}

/* frames: [{ gallery_index, url, identity, high, ... }]. Кожен кадр отримує
   send_url (data URL) і зберігає вихідний url та identity: посилання на кадр
   у знахідках і відбиток набору від транспорту не залежать */
export async function prefetchFrames(frames, opts = {}) {
  const cfg = { ...VISION_RELIABILITY, ...(opts.cfg || {}) };
  const fetchImpl = opts.fetchImpl || fetch;
  const list = Array.isArray(frames) ? frames : [];
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fetchImage(list[i].url, fetchImpl, cfg);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.IMAGE_CONCURRENCY, list.length) }, worker));
  const kept = [], dropped = [];
  let bytes = 0;
  list.forEach((f, i) => {
    const r = results[i];
    if (r && r.ok) { kept.push({ ...f, send_url: r.dataUrl }); bytes += r.bytes; }
    else dropped.push({ gallery_index: f.gallery_index, reason: (r && r.error) || 'failed' });
  });
  /* не завантажився жоден: сервер, мабуть, сам не бачить CDN; лишаємо
     посилання, щоб модель спробувала сама (стара поведінка) */
  if (!kept.length && list.length) return { frames: list.map(f => ({ ...f })), dropped, transport: 'remote_urls', bytes: 0 };
  return { frames: kept, dropped, transport: 'inline_bytes', bytes };
}

/* gate перед фіналізацією числового балу */
export function visionGate({ usablePhotos = 0, expected = false, status = null } = {}) {
  if (!expected) return { finalize: true, reason: 'vision_not_expected' };
  if (!(usablePhotos > 0)) return { finalize: true, reason: 'no_usable_photos' };
  if (status === 'not_applicable') return { finalize: true, reason: 'no_usable_photos' };
  if (status === 'ok') return { finalize: true, reason: 'vision_ok' };
  return { finalize: false, reason: 'vision_technical_failure' };
}
