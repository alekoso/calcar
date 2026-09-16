/* CalCar: проксі архівних фото. Збережений звіт CalCar не має залежати
   від того, чи сторонній CDN пустить телефон користувача за прямим
   посиланням (hotlink, referer, UA, термін дії). Кадр віддається з
   CalCar-адреси /api/img?u=<url>, лише з дозволених хостів історичних
   джерел, лише картинки, з довгим кешем на CDN Vercel. Provenance
   кадру не змінюється: оригінальний URL лишається в даних звіту. */

import { readStoredHistoricalPhoto } from './vehicle-memory.js';

export const config = { maxDuration: 20 };

const ALLOWED_HOST = /(^|\.)(riastatic\.com|bidfax\.info|copart\.com|iaai\.com|bid\.cars|poctra\.com|stat\.vin|autoastat\.com|autobidmaster\.com|salvagebid\.com|carsfromwest\.com|plc\.auction|auctionhistory\.io|vincheck\.info)$/i;
const MAX_BYTES = 6 * 1024 * 1024;
/* чиста перевірка адреси кадру: лише https і лише хости історичних джерел */
export function allowedImageUrl(raw) {
  try { const u = new URL(String(raw)); return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname); } catch (e) { return false; }
}

function send(res, buf, type, host, from) {
  res.setHeader('content-type', type.split(';')[0]);
  res.setHeader('cache-control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-calcar-source-host', host);
  res.setHeader('x-calcar-image-from', from);
  return res.status(200).send(buf);
}

/* Кадр із джерела лише для хостів allowlist. Інакше (або якщо джерело не
   віддає) проксі НЕ ходить на сторонній хост, а шукає збережену копію саме
   цього кадру: той самий точний source URL уже є в Vehicle Memory як
   historical_evidence зі статусом stored. Дозвіл дає збережений доказ
   конкретного кадру, а не хост; шлях у bucket береться лише з бази */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const raw = String(req.query?.u || '').trim();
  let u;
  try { u = new URL(raw); } catch (e) { return res.status(403).end(); }
  if (u.protocol !== 'https:') return res.status(403).end();
  const allowed = allowedImageUrl(raw);
  if (allowed) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(u.toString(), {
        signal: ctl.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          referer: u.origin + '/',
        },
      });
      const type = String(r.headers.get('content-type') || '');
      if (r.ok && /^image\//i.test(type)) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length && buf.length <= MAX_BYTES) return send(res, buf, type, u.hostname, 'source');
      }
    } catch (e) { /* далі збережена копія */ } finally { clearTimeout(t); }
  }
  const stored = await readStoredHistoricalPhoto(raw).catch(() => null);
  if (stored) return send(res, stored.buf, stored.type, u.hostname, 'evidence_store');
  return res.status(allowed ? 502 : 403).end();
}
