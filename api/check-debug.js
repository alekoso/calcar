/* CalCar Check: діагностика джерел фото.
   Відкривається у браузері звичайним посиланням:
   https://calcar.io/api/check-debug?url=ПОСИЛАННЯ_НА_ОГОЛОШЕННЯ
   Показує, які картинки бачить наш сервер на сторінці оголошення
   і чи вдається дістати архів аукціону США. Нічого не змінює. */

export const config = { maxDuration: 120 };

async function grab(url, referer) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: Object.assign({
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'uk,ru;q=0.9,en;q=0.8',
        'upgrade-insecure-requests': '1',
      }, referer ? { referer } : {}),
    });
    const html = await r.text();
    return { ok: r.ok, status: r.status, len: html.length, html };
  } catch (e) {
    return { ok: false, status: 0, len: 0, html: '', error: String(e.message || e) };
  } finally { clearTimeout(t); }
}

/* групуємо картинки за хостом і початком шляху: так одразу видно,
   де лежать фото оголошення, а де фото аукціону */
function groupImages(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:data-src|data-original|data-lazy|src|content)=["'](https?:\/\/[^"']+?\.(?:jpe?g|webp|png))["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:jpe?g|webp|png)/gi)) urls.add(m[0]);
  const groups = {};
  for (const u of urls) {
    try {
      const p = new URL(u);
      const key = p.hostname + '/' + p.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
      groups[key] = groups[key] || { count: 0, sample: u };
      groups[key].count++;
    } catch (e) {}
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .map(([k, v]) => ({ group: k, count: v.count, sample: v.sample }));
}

export default async function handler(req, res) {
  const url = (req.query?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Додай ?url=посилання_на_оголошення' });

  const page = await grab(url);
  const out = {
    listing: { url, ok: page.ok, status: page.status, html_length: page.len, error: page.error || null },
    listing_images: page.html ? groupImages(page.html) : [],
  };

  /* усі згадки архівів аукціонів у коді сторінки */
  const links = new Set();
  if (page.html) {
    for (const m of page.html.matchAll(/https?:\/\/[^\s"'<>]*(?:bidfax|bidinfo|autoastat|stat\.vin|bid\.cars|copart|iaai)[^\s"'<>]*/gi)) {
      links.add(m[0].replace(/&amp;/g, '&'));
    }
  }
  out.auction_links_found = [...links].slice(0, 15);

  /* пробуємо дістати перший архів і подивитись, чи пускають нас */
  const first = [...links].find(l => /bidfax|bidinfo|autoastat/i.test(l));
  if (first) {
    const mirrors = [first];
    if (/\/\/bidfax\.info/.test(first)) mirrors.push(first.replace('//bidfax.info', '//en.bidfax.info'));
    out.auction_attempts = [];
    for (const m of mirrors) {
      const a = await grab(m, 'https://auto.ria.com/');
      out.auction_attempts.push({
        url: m, ok: a.ok, status: a.status, html_length: a.len, error: a.error || null,
        looks_blocked: /captcha|cf_chl|Just a moment|access denied/i.test((a.html || '').slice(0, 4000)),
        images: a.html ? groupImages(a.html).slice(0, 10) : [],
      });
    }
  }

  res.setHeader('content-type', 'application/json; charset=utf-8');
  return res.status(200).send(JSON.stringify(out, null, 2));
}
