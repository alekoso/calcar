/* CalCar: проксі архівних фото. Збережений звіт CalCar не має залежати
   від того, чи сторонній CDN пустить телефон користувача за прямим
   посиланням (hotlink, referer, UA, термін дії). Кадр віддається з
   CalCar-адреси /api/img?u=<url>, лише з дозволених хостів історичних
   джерел, лише картинки, з довгим кешем на CDN Vercel. Provenance
   кадру не змінюється: оригінальний URL лишається в даних звіту. */

export const config = { maxDuration: 20 };

const ALLOWED_HOST = /(^|\.)(riastatic\.com|bidfax\.info|copart\.com|iaai\.com|bid\.cars|poctra\.com|stat\.vin|autoastat\.com|autobidmaster\.com|salvagebid\.com|carsfromwest\.com|plc\.auction|auctionhistory\.io|vincheck\.info)$/i;
const MAX_BYTES = 6 * 1024 * 1024;
/* чиста перевірка адреси кадру: лише https і лише хости історичних джерел */
export function allowedImageUrl(raw) {
  try { const u = new URL(String(raw)); return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname); } catch (e) { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const raw = String(req.query?.u || '').trim();
  if (!allowedImageUrl(raw)) return res.status(403).end();
  const u = new URL(raw);
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
    if (!r.ok || !/^image\//i.test(type)) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return res.status(502).end();
    res.setHeader('content-type', type.split(';')[0]);
    res.setHeader('cache-control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-calcar-source-host', u.hostname);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).end();
  } finally { clearTimeout(t); }
}
