export const config = { maxDuration: 300 };

import { computeScore } from './score.js';
import { findAuctionRecord, shouldRecheck } from './auction.js';

/* ============================================================
   CalCar Check, рушій v1: посилання на оголошення -> звіт.
   Потік: fetch сторінки -> витяг фактів (детермінований) ->
   NHTSA decode -> знімок у vehicle_snapshots (рів даних) ->
   AI-розбір розбіжностей -> JSON звіту.
   v1 заточений під auto.ria.com, generic-шлях працює для інших,
   але без гарантій. Нові площадки додаються адаптерами.
   ============================================================ */

/* ---------- 1. Завантаження сторінки ---------- */
async function fetchPage(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: Object.assign({
        /* представляємось звичайним браузером: без цього частина сайтів
           віддає заглушку або 403 */
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'uk,ru;q=0.9,en;q=0.8',
        'upgrade-insecure-requests': '1',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': opts.referer ? 'cross-site' : 'none',
      }, opts.referer ? { referer: opts.referer } : {}),
    });
    const html = await r.text();
    if (!r.ok) {
      const e = new Error('Сайт відповів помилкою HTTP ' + r.status);
      e.blocked = r.status === 403 || r.status === 429 || r.status === 503;
      throw e;
    }
    if (/cf-browser-verification|__cf_chl|captcha|access denied|Just a moment/i.test(html.slice(0, 4000))) {
      const e = new Error('Сайт закрив сторінку перевіркою на робота');
      e.blocked = true;
      throw e;
    }
    if (html.length < 3000) {
      throw new Error('Сайт віддав порожню сторінку');
    }
    return html;
  } finally { clearTimeout(t); }
}

/* ---------- 2. Утиліти витягу ---------- */
const dec = s => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function metaTag(html, name) {
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name.replace(/[:]/g, '\\$&') + '["\'][^>]+content=["\']([^"\']*)["\']', 'i');
  const m = re.exec(html);
  return m ? dec(m[1]) : null;
}

/* усі JSON-блоки сторінки: ld+json та вбудований стан фреймворків */
function pageJsonBlobs(html) {
  const out = [];
  const ld = html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ld) { try { out.push(JSON.parse(m[1].trim())); } catch (e) {} }
  for (const re of [/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/, /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/]) {
    const m = re.exec(html);
    if (m) { try { out.push(JSON.parse(m[1])); } catch (e) {} }
  }
  return out;
}

/* глибокий збір "ключ -> перше значення" по JSON, як у lot.js */
function deepCollect(obj, flat = {}) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return flat;
  if (Array.isArray(obj)) { obj.forEach(v => deepCollect(v, flat)); return flat; }
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      if (!(key in flat)) flat[key] = v;
    }
    deepCollect(v, flat);
  }
  return flat;
}
function pick(flat, aliases) {
  for (const a of aliases) {
    const k = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (flat[k] !== undefined && flat[k] !== '' && flat[k] !== null) return flat[k];
  }
  return null;
}

/* HTML -> читабельний текст для AI: без скриптів, стилів і тегів */
function htmlToText(html) {
  return dec(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

/* вирізаємо з довгого тексту лише змістовні секції, щоб не годувати AI
   меню, відгуками і новинами площадки */
function relevantText(text, markers, budget = 14000) {
  const chunks = [];
  for (const { from, to, cap } of markers) {
    const i = text.indexOf(from);
    if (i === -1) continue;
    let end = text.length;
    for (const stop of to) {
      const j = text.indexOf(stop, i + from.length);
      if (j !== -1 && j < end) end = j;
    }
    chunks.push(text.slice(i, Math.min(end, i + cap)));
  }
  const joined = chunks.join('\n\n');
  return (joined.length > 500 ? joined : text.slice(0, budget)).slice(0, budget);
}

/* ---------- 3. Витяг фактів оголошення ---------- */
const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/g;

function extractListing(html, url) {
  const domain = (/^https?:\/\/(?:www\.)?([^\/]+)/i.exec(url) || [])[1] || '';
  const isRia = /auto\.ria\.com$/i.test(domain);
  const text = htmlToText(html);
  const flat = deepCollect(pageJsonBlobs(html));

  const title = metaTag(html, 'og:title') || pick(flat, ['name', 'title']) || '';

  /* VIN: перший рядок правильної форми зі сторінки; відсіюємо випадкові
     збіги вимогою мати і літери, і цифри */
  let vin = null;
  for (const m of (title + ' ' + text.slice(0, 60000)).matchAll(VIN_RE)) {
    const v = m[1].toUpperCase();
    if (/[A-Z]/.test(v) && /\d/.test(v)) { vin = v; break; }
  }

  /* держномер України: другий ключ звʼязування, коли VIN приховано */
  const plateM = /\b([АВЕІКМНОРСТХA-Z]{2})\s?(\d{4})\s?([АВЕІКМНОРСТХA-Z]{2})\b/u.exec(text.slice(0, 30000));
  const plate = plateM ? (plateM[1] + plateM[2] + plateM[3]).toUpperCase() : null;

  /* ціна: RIA пише її в og:title ("ціна 30500 $"), generic бере з JSON */
  let price = null, currency = null;
  const priceM = /ціна\s+([\d\s]+)\s*(\$|€|грн)/i.exec(title) || /([\d\s]{4,})\s*(\$|€|грн)\b/.exec(text.slice(0, 20000));
  if (priceM) {
    price = parseInt(priceM[1].replace(/\s/g, ''), 10) || null;
    currency = { '$': 'USD', '€': 'EUR', 'грн': 'UAH' }[priceM[2]] || null;
  }
  if (!price) {
    price = parseFloat(pick(flat, ['price', 'priceUSD', 'priceValue'])) || null;
    currency = currency || pick(flat, ['priceCurrency', 'currency']) || null;
  }

  /* пробіг: "пробіг 129 тис. км" або поля JSON */
  let odometerKm = null;
  const odoM = /пробіг[^\d]{0,10}(\d{1,3})\s*тис/i.exec(text) || /(\d{1,3})\s*тис\.?\s*км/i.exec(text.slice(0, 20000));
  if (odoM) odometerKm = parseInt(odoM[1], 10) * 1000;
  if (!odometerKm) {
    const raw = parseFloat(pick(flat, ['mileage', 'race', 'odometer', 'mileageInKm']));
    if (raw) odometerKm = raw < 1000 ? raw * 1000 : raw;
  }

  const yearM = /\b(19[89]\d|20[0-4]\d)\b/.exec(title);
  const year = yearM ? parseInt(yearM[1], 10) : (parseInt(pick(flat, ['year', 'productionYear', 'vehicleModelDate']), 10) || null);

  /* фото: RIA кладе кадри на cdn.riastatic.com у кількох розмірах,
     лишаємо по одному найбільшому на кадр (hd > fx > bx) */
  let photos = [];
  if (isRia) {
    /* нижче галереї йдуть блоки "інші авто продавця" і "схожі оголошення":
       їхні прев'ю не мають потрапити в аналіз. Ріжемо сторінку по маркеру,
       але лише там, де до нього вже набралась повноцінна галерея: слова на
       кшталт "Схожі" трапляються і в меню на початку сторінки */
    const PHOTO_RE = /https:\/\/cdn\d*\.riastatic\.com\/photosnew\/auto\/photo\/([a-z0-9_\-]*?)(\d+)(hd|fx|bx)\.(?:webp|jpe?g)/gi;
    const MARKERS = /(Інші авто|Другие авто|Схожі|Похожие|Ще від|Еще от|Всі авто продавця|Все авто продавца|similar-adverts|other-adverts|proposition_other)/gi;
    const photoPositions = [...html.matchAll(PHOTO_RE)].map(m => m.index);
    let zone = html;
    for (const mk of html.matchAll(MARKERS)) {
      const before = photoPositions.filter(p => p < mk.index).length;
      if (before >= 5) { zone = html.slice(0, mk.index); break; }
    }

    const RANK = { hd: 3, fx: 2, bx: 1 };
    const RE = /https:\/\/cdn\d*\.riastatic\.com\/photosnew\/auto\/photo\/([a-z0-9_\-]*?)(\d+)(hd|fx|bx)\.(?:webp|jpe?g)/gi;
    const found = [];
    for (const m of zone.matchAll(RE)) {
      found.push({ prefix: (m[1] || '').toLowerCase(), id: m[2], rank: RANK[m[3].toLowerCase()] || 0, url: m[0] });
    }
    /* кожне чуже оголошення дає рівно одне прев'ю, наше авто дає багато кадрів:
       лишаємо найбільшу групу з однаковим префіксом шляху */
    const byPrefix = new Map();
    for (const f of found) {
      if (!byPrefix.has(f.prefix)) byPrefix.set(f.prefix, new Map());
      const ids = byPrefix.get(f.prefix);
      const cur = ids.get(f.id);
      if (!cur || f.rank > cur.rank) ids.set(f.id, f);
    }
    let winner = null;
    for (const [, ids] of byPrefix) if (!winner || ids.size > winner.size) winner = ids;
    /* якщо групування нічого не дало (один кадр на префікс), беремо все зі зрізаної зони */
    const useAll = !winner || winner.size < 3;
    const pool = useAll ? found : [...winner.values()];
    const best = new Map();
    for (const f of pool) {
      const cur = best.get(f.id);
      if (!cur || f.rank > cur.rank) best.set(f.id, f);
    }
    photos = [...best.values()].map(x => x.url);
  } else {
    const seen = new Set();
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:jpe?g|webp|png)(?:\?[^\s"'<>]*)?/gi)) {
      const u = m[0];
      if (/logo|icon|sprite|avatar|banner|placeholder|\.svg/i.test(u)) continue;
      if (!seen.has(u)) { seen.add(u); }
    }
    photos = [...seen];
  }
  photos = photos.slice(0, 40);

  /* фото аукціону США: RIA зберігає їх у себе, окремою гілкою /photos/auto/usa/.
     Це наше основне джерело кадрів "до ремонту": сам bidfax закритий від
     автоматичних запитів і віддає 403 */
  const usaPhotos = [];
  if (isRia) {
    const seenUsa = new Set();
    for (const m of html.matchAll(/https:\/\/cdn\d*\.riastatic\.com\/photos\/auto\/usa\/[^\s"'<>\\]+?\.(?:jpe?g|webp|png)/gi)) {
      const u = m[0];
      if (!seenUsa.has(u)) { seenUsa.add(u); usaPhotos.push(u); }
    }
  }

  /* марка і модель: із title виду "BMW 5 Series 2018" це робить AI краще,
     тут лише груба спроба з URL-слага RIA */
  let make = null, model = null;
  const slug = /auto_([a-z\-]+?)_([a-z0-9\-]+?)_\d+\.html/i.exec(url);
  if (slug) { make = slug[1].replace(/-/g, ' '); model = slug[2].replace(/-/g, ' '); }

  /* текст для AI: опис продавця + офіційний блок перевірки + історія.
     Маркери підібрані під RIA, generic отримує початок сторінки */
  const aiText = relevantText(text, [
    { from: 'Опис від продавця', to: ['Дізнайтесь більше', 'Оголошення створене'], cap: 5000 },
    { from: 'Перевірено AUTO.RIA', to: ['Дізнайтесь більше про авто'], cap: 4000 },
    { from: 'Історія авто за VIN', to: ['Дізнайтесь більше', 'Виїзна перевірка'], cap: 4000 },
    { from: title.slice(0, 40), to: ['Опис від продавця'], cap: 3000 },
  ]);

  return {
    domain, country: isRia ? 'UA' : null,
    title: title.slice(0, 200), vin, plate,
    price, currency, odometer_km: odometerKm, year, make, model,
    photos, text: aiText,
    /* кадри "до ремонту" з аукціону США, збережені самою RIA */
    usa_photos: usaPhotos.slice(0, 12),
    /* посилання на зовнішній архів: лишається як довідка для користувача */
    auction_url: (/https?:\/\/bidfax\.info\/[^\s"'<>\\]+/i.exec(html) || [null])[0],
  };
}

/* ---------- 3б. Архів аукціону США: фото "до ремонту" ---------- */

/* bidfax закривається від ботів, тому пробуємо кілька дзеркал і йдемо з реферером,
   ніби перейшли з RIA. Перше, що віддає фото, виграє. */
function auctionMirrors(url) {
  const out = [url];
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'bidfax.info') out.push(url.replace('//bidfax.info', '//en.bidfax.info'));
    if (host === 'en.bidfax.info') out.push(url.replace('//en.bidfax.info', '//bidfax.info'));
  } catch (e) {}
  return out;
}

/* фото лота: різні дзеркала кладуть їх у /uploads/, /photos/ чи /img/,
   плюс частина картинок віддається ліниво через data-src */
function extractAuctionPhotos(html) {
  const seen = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>]*\/(?:uploads|photos|img|images)\/[^\s"'<>]+?\.(?:jpe?g|webp|png)/gi,
    /(?:data-src|data-original|data-lazy|src)=["'](https?:\/\/[^"']+?\.(?:jpe?g|webp|png))["']/gi,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      let u = (m[1] || m[0]).replace('/thumbs/', '/').replace(/\/thumb_/, '/');
      /* службові картинки інтерфейсу нам не потрібні */
      if (/logo|sprite|icon|banner|avatar|placeholder|flag|noimage/i.test(u)) continue;
      seen.add(u);
    }
  }
  return [...seen];
}

async function fetchAuction(url) {
  if (!url) return null;
  let lastErr = null;
  for (const m of auctionMirrors(url)) {
    try {
      const html = await fetchPage(m, { referer: 'https://auto.ria.com/' });
      const photos = extractAuctionPhotos(html).slice(0, 8);
      const text = htmlToText(html).slice(0, 4000);
      if (photos.length || text.length > 300) return { url: m, photos, text };
    } catch (e) { lastErr = e; }
  }
  /* архів існує, але закритий від автоматичних запитів */
  return { url, photos: [], text: '', blocked: true, error: lastErr ? String(lastErr.message || lastErr) : null };
}

/* ---------- 4. Знімок у рів даних ---------- */
async function saveSnapshot(l, url) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return 'env_missing';
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/vehicle_snapshots', {
      method: 'POST',
      headers: {
        apikey: key, authorization: 'Bearer ' + key,
        'content-type': 'application/json', prefer: 'return=minimal',
      },
      body: JSON.stringify({
        vin: l.vin, plate: l.plate,
        source_url: url, source_domain: l.domain, country: l.country,
        price_amount: l.price, price_currency: l.currency,
        odometer_km: l.odometer_km, year: l.year, make: l.make, model: l.model,
        listing: { title: l.title, text: l.text },
        photos: l.photos.slice(0, 20),
      }),
    });
    return r.ok ? 'saved' : 'error_' + r.status;
  } catch (e) { return 'error'; }
}

/* ---------- 4б. Історія рову даних для Score v2 ----------
   Лише факти пайплайна: скільки МИ реально бачили це авто раніше.
   Поточне оголошення виключається, повторні аналізи того самого URL теж. */
/* нормалізація URL оголошення для ідентичності: hash і трекінгові параметри
   оголошення не змінюють. Інші query лишаємо, а marketplace listing id парсер
   не витягує, тож надійнішої ідентичності за нормалізований URL поки нема */
function normalizeListingUrl(u) {
  try {
    const url = new URL(String(u));
    url.hash = '';
    const drop = [];
    url.searchParams.forEach((v, k) => { if (/^(utm_|fbclid$|gclid$|yclid$|ref$|referrer$)/i.test(k)) drop.push(k); });
    drop.forEach(k => url.searchParams.delete(k));
    return url.toString();
  } catch (e) { return String(u || ''); }
}

async function readSnapshots(vin, currentUrl) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !vin) return [];
  try {
    const r = await fetch(base.replace(/\/$/, '')
      + '/rest/v1/vehicle_snapshots?vin=eq.' + encodeURIComponent(vin)
      + '&select=odometer_km,source_url,created_at&order=created_at.asc&limit=200', {
      headers: { apikey: key, authorization: 'Bearer ' + key },
    });
    if (!r.ok) return [];
    const rows = await r.json();
    /* одне джерело рахується один раз: дедуплікація за нормалізованим URL */
    const cur = normalizeListingUrl(currentUrl);
    const seen = new Set();
    const out = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const u = normalizeListingUrl(row.source_url);
      if (!u || u === cur || seen.has(u)) continue;
      seen.add(u);
      out.push({ odometer_km: row.odometer_km ?? null, source_url: u, created_at: row.created_at });
    }
    return out;
  } catch (e) { return []; }
}

/* унікальність кадру для photos_sufficient: у riastatic один кадр приходить
   у варіантах розмірів (суфікси hd/fx/bx), ключ це імʼя без суфікса розміру,
   той самий, що вже використовує витяг галереї вище */
function photoKey(u) {
  const m = /riastatic\.com\/photosnew\/auto\/photo\/([a-z0-9_\-]*?\d+)(?:hd|fx|bx)\.(?:webp|jpe?g)/i.exec(String(u));
  if (m) return 'ria:' + m[1].toLowerCase();
  return String(u).split('#')[0].split('?')[0];
}

/* ---------- 4в. Кеш аукціонних перевірок ----------
   Таблиця auction_checks зʼявиться окремою міграцією; до того функції
   тихо повертають null/ігнорують помилки, пайплайн від них не залежить */
async function readAuctionCache(vin) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !vin) return null;
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/auction_checks?vin=eq.' + encodeURIComponent(vin) + '&select=*', {
      headers: { apikey: key, authorization: 'Bearer ' + key },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) { return null; }
}
async function writeAuctionCache(vin, row) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !vin) return;
  try {
    await fetch(base.replace(/\/$/, '') + '/rest/v1/auction_checks?on_conflict=vin', {
      method: 'POST',
      headers: {
        apikey: key, authorization: 'Bearer ' + key,
        'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ vin, checked_at: new Date().toISOString(), ...row }),
    });
  } catch (e) { /* кеш не критичний */ }
}

/* ---------- 5. AI-розбір ---------- */
const PROMPT = (l, nhtsa, auction, langDirective) => `Ти експертна система CalCar Check: незалежний розбір оголошення про продаж вживаного авто. Твоя робота: звірити те, що СТВЕРДЖУЄ продавець, із тим, що КАЖУТЬ дані і фото, і чесно відповісти, чи варто брати саме це авто.

${langDirective}

ФАКТИ, ВИТЯГНУТІ ЗІ СТОРІНКИ ОГОЛОШЕННЯ (детермінований парс):
${JSON.stringify({ title: l.title, vin: l.vin, plate: l.plate, price: l.price, currency: l.currency, odometer_km: l.odometer_km, year: l.year })}

ТЕКСТ СТОРІНКИ ОГОЛОШЕННЯ (опис продавця + офіційні блоки перевірки площадки, якщо є):
${l.text}

Декодування VIN від NHTSA: ${nhtsa ? JSON.stringify(nhtsa) : 'недоступне'}
${auction && auction.photos.length ? `
ФОТО З АУКЦІОНУ США ДОСТУПНІ (${auction.photos.length} кадрів, зроблені ДО ремонту, коли авто продавали пошкодженим).${auction.text ? '\nТекст архіву аукціону:\n' + auction.text.slice(0, 2500) : ''}
ЦЕ НАЙЦІННІШЕ ДЖЕРЕЛО ЗВІТУ, і воно у тебе Є: писати "аукціонні фото недоступні" тепер прямо заборонено. Обовʼязково:
- по аукціонних фото визнач РЕАЛЬНИЙ обсяг пошкоджень: які деталі биті, чи зачеплені подушки, лонжерони, підвіска
- звір це з тим, як продавець описує пошкодження і ремонт: занижує, чесний чи перебільшує
- порівняй зону удару "до" з нинішніми фото "після": збіг відтінку, зазори, якість відновлення
- verdict тверджень продавця про пошкодження і ремонт тепер спирається на аукціонні фото, а не на "недоступно"
` : auction && auction.blocked ? `Архів аукціону США існує (посилання на сторінці), але його сервер не пустив нас автоматично.
ЖОРСТКЕ ПРАВИЛО: згадай цю обставину РІВНО ОДИН РАЗ, в auction.summary, одним реченням. У verdict, risks, discrepancies, photo_findings, checklist і будь-де ще ЗАБОРОНЕНО писати "без доступних аукціонних фото", "фото аукціону недоступні" і подібні звороти. Роби висновки з того, що маєш: запис про ДТП у США сам по собі є фактом, і оцінювати треба ризик неякісного відновлення, а не відсутність фото.` : 'Архіву аукціону США у сторінці немає.'}

РОЗБІЖНІСТЬ ІСНУЄ ЛИШЕ КОЛИ: джерело А стверджує X, а джерело Б стверджує несумісне з X значення Y, і ти називаєш обидва джерела та обидва значення. Відсутність інформації, "не розкрито", "не вдалося перевірити" РОЗБІЖНІСТЮ НЕ Є і в discrepancies не потрапляє ніколи. Якщо справжніх суперечностей немає, повертай порожній масив: блок просто не покажеться, і це правильно.

ГОЛОВНА МЕХАНІКА: розбіжності між джерелами. Порівнюй:
- твердження продавця в описі ПРОТИ офіційного блоку перевірки площадки (власники, ДТП, страхові випадки, історія пробігу, аукціонні записи США)
- фото ДО ремонту (аукціон) ПРОТИ фото ЗАРАЗ і ПРОТИ слів продавця про обсяг ремонту
- заявлений пробіг ПРОТИ хронології пробігів у історії і ПРОТИ зносу на фото (кермо, сидіння, педалі, кнопки)
- заявлену комплектацію ПРОТИ даних VIN
- поведінку продавця: короткий цикл володіння, перепродаж, "професійний продавець" із свіжою покупкою це патерн перекупа, назви його прямо якщо видно з історії

ПРАВИЛА ЧЕСНОСТІ (найважливіше):
- НІКОЛИ не пиши статус "ok", якщо це не підтверджено даними чи чітко видимим доказом на фото. Не видно або нечітко: статус "unknown" з конкретною дією для перевірки.
- Кожна розбіжність МУСИТЬ спиратися на конкретні рядки джерел, не вигадуй фактів. Якщо чогось у даних немає, прямо кажи, що цього немає.
- ТЛУМАЧ СЛОВА ПРОДАВЦЯ ДОБРОЗИЧЛИВО, як їх розуміє звичайний читач оголошення. Приклад: "оригінальний рестайлінг" у тексті про переобладнання зазвичай означає "переодягнули в рестайлінг оригінальними деталями", а НЕ "авто з заводу рестайлінгове". Verdict "contradicted" стався ЛИШЕ коли твердження у природному прочитанні прямо суперечить знайденому факту. Якщо формулювання двозначне, поясни обидва прочитання в evidence замість "спростовано".
- Дані довідника площадки можуть містити сміття (неправильна потужність, обʼєм). Технічні характеристики бери з VIN-декодування, розбіжність довідника НЕ вважай проблемою авто, але згадай у data_notes.
- НІКОЛИ не використовуй символ довгого тире у жодному тексті. Пиши кому, двокрапку або крапку.
- Не заповнюй блоки заради кількості. Краще 2 влучні розбіжності, ніж 6 порожніх. Порожній масив завжди кращий за наповнювач.
- Пробіг "1 тис. км" у записі аукціону США може означати милі або фіксацію на момент продажу: не роби з одиниць виміру катастрофу, але звір хронологію на логічність.

ТВЕРДЖЕННЯ ПРОДАВЦЯ перевіряй, але НЕ виводь окремим списком. Результат перевірки клади туди, де він доречний: суперечність із фактами = у discrepancies; заявлена опція = у equipment.seller або equipment.photo, якщо видно на фото; твердження про обсяг ремонту після США = у auction.findings. Констатації "не вдалося перевірити" без цінності для рішення взагалі не пиши.

ШАПКА = ФАКТИ. Усі поля "vehicle" це короткі технічні факти без коментарів, застережень і слів про відсутні дані:
- "engine": "4.4 л бензин V8, 462 к.с." або "електро, 77 кВт·год". НІКОЛИ не пиши "довідково", "в декодуванні не вказано", "ймовірно". Невідоме = null, а не речення про невідомість.
- "mileage_note": ЛИШЕ заявлене число одним коротким рядком: "129 000 км". Уся аналітика пробігу (хронологія, розбіжності) живе в discrepancies та history, НЕ в шапці.

"photo_findings": ЛИШЕ про НИНІШНІ фото з оголошення (не аукціонні: для них є auction.findings). СПОЧАТКУ те, що РЕАЛЬНО ПОМІЧЕНО: різниця відтінку фарби, шагрень, нерівні зазори, свіжий герметик, нештатні деталі, знос салону проти пробігу. Кожна знахідка = окремий пункт зі status warn або bad. Якщо підозрілого нічого немає: ОДИН пункт "ok" ("на доступних фото явних слідів ремонту не видно") плюс МАКСИМУМ один пункт "unknown" із найважливішим обмеженням (наприклад, немає фото салону). ЗАБОРОНЕНО три пункти поспіль про те, чого не видно.

"risks": 2-5 КЛЮЧОВИХ РИЗИКІВ. Це відповідь на питання "що в цьому авто може коштувати найбільших грошей чи проблем". Обовʼязково розрізняй: ЗНАЙДЕНА проблема (є доказ у даних чи на фото) проти ПОТЕНЦІЙНОГО ризику моделі (двигун дорогий у ремонті, але несправність не встановлена). Для складних чи преміальних авто з дешевою ціною чесно пояснюй, ЧОМУ вони дешеві: дорогий сервіс, ресурс агрегатів, витрати володіння. Для авто після ДТП у США один із ризиків майже завжди якість відновлення. Кожен ризик КОМПАКТНИЙ: title; level (high = висока ціна помилки, med, low); note МАКСИМУМ 2 речення (чому це головна стаття витрат саме тут, без есе); action одним рядком, що починається з переліку конкретних вузлів чи дій ("лонжерони, підрамник, SRS та ремені", а не загальне "діагностика на СТО").

"equipment": комплектація з зазначенням джерела кожної групи. "vin": лише те, що РЕАЛЬНО назване в декодуванні VIN. "photo": опції, які ВИДНО на фото оголошення (Burmester чи інша акустика по решітках, панорамний дах, вентиляція за перфорацією сидінь, камери 360, HUD, моніторами позаду, підсвітка тощо): пиши тільки впевнено видиме. "seller": важливі опції зі слів продавця, яких нема ні у VIN, ні на фото. Порожні масиви дозволені, вигадувати заборонено.

"verdict.score": чесна оцінка пропозиції від 0 до 10 з одним знаком після коми. Якорі: 8.5+ чисте авто без питань за адекватною ціною; 7.0-8.4 добре, лишились дрібні перевірки; 5.5-6.9 брати можна лише після серйозних перевірок і торгу; 4.0-5.4 серйозні ризики чи ознаки обману; нижче 4 краще відмовитись. Не завищуй: знайдена брехня продавця чи приховане серйозне ДТП тягне оцінку вниз сильніше за все.

ЗАБОРОНА ПОВТОРІВ ПРО БРАК ДАНИХ: будь-яке обмеження джерел (немає фото аукціону, немає заказ-нарядів, немає build sheet) згадується у звіті МАКСИМУМ ОДИН РАЗ, у найдоречнішому місці. Повторювати ту саму думку в кількох розділах заборонено: це найгірший дефект звіту.

"data_notes": пиши мовою користувача продукту, без згадок про внутрішні механізми ("парс", "детермінований", "заголовок сторінки"). Просто: які дані площадки виглядають помилковими і чому ми їм не віримо.

"model_notes.issues": типові слабкі місця САМЕ ЦІЄЇ версії (марка + модель + рік + двигун + фактичний пробіг). 0-4 пункти. Кожен пункт мусить бути задокументованою особливістю саме цієї моделі і покоління; якщо речення без змін пасує іншому авто, викинь його. Тільки проблеми, актуальні при ЦЬОМУ пробігу. Якщо певного нічого немає, порожній масив. Без цін.

"score_facts": СЛУЖБОВА класифікація знахідок для коду, на текст звіту НЕ впливає, verdict.score і verdict.grade рахуй як раніше, незалежно від неї. Жорсткі правила класифікації:
- type СТРОГО з переліку. Підтверджені ризики: STRUCTURAL_DAMAGE, AIRBAGS_DEPLOYED, SRS_FAULT (поточна несправність SRS), FLOOD, FIRE, ODOMETER_ROLLBACK, VIN_IDENTITY_PROBLEM, SERIOUS_POWERTRAIN_FAULT, POOR_REPAIR_VISIBLE, CRITICAL_WARNING_LIGHTS. Відкриті питання: MILEAGE_CONFLICT_UNEXPLAINED, MAJOR_REPAIR_UNVERIFIED, MODIFICATION_TECHNICAL_CONCERN.
- Підтверджений ризик вимагає ПРЯМОГО доказу. Не підвищуй відкрите питання до підтвердженого ризику припущенням.
- Різниця пробігів САМА ПО СОБІ це НЕ ODOMETER_ROLLBACK, а MILEAGE_CONFLICT_UNEXPLAINED. Тюнінг сам по собі НЕ MODIFICATION_TECHNICAL_CONCERN: потрібен конкретний технічний привід. Минуле ДТП саме по собі НЕ POOR_REPAIR_VISIBLE: потрібні видимі сліди поганого ремонту.
- ВІДСУТНІСТЬ ДАНИХ НІКОЛИ НЕ Є ЗНАХІДКОЮ. Unknown не добре і не погано.
- event_id ОБОВʼЯЗКОВИЙ для КОЖНОЇ знахідки, без нього код її відкине. Для подій це імʼя події (accident_2020, flood_2021), для поточних станів і несправностей стабільний ідентифікатор (current_srs_fault, mileage_conflict_1, modification_suspension). Знахідки ОДНОЇ події (одного ДТП) несуть СПІЛЬНИЙ event_id: подія з кількома підтвердженнями це ОДНА знахідка з кількома evidence, не кілька знахідок.
- repair_status (confirmed_ok | unknown | confirmed_bad) і severity (low|med|high) став де застосовно.
- evidence: масив {source: seller_claim|current_photos|historical_listing|us_auction|registry|document, ref: конкретний запис (listing_3, photo_7, auction_event_1) де можливо, description: коротке доказове речення}. Одна знахідка може мати скільки завгодно доказів.
- info_notes: вільний текст без впливу на бал. Якщо знахідок нема, findings це порожній масив.

"verdict.grade": buy (брати, істотних проблем не знайдено), inspect (можна брати після конкретних перевірок), caution (є серйозні розбіжності, торг або обережність), avoid (знайдені факти прямо суперечать оголошенню або ризик надто високий). Оцінюй відносно ринку вживаних авто: сліди експлуатації це норма, а не привід для avoid. Але приховування фактів продавцем (знайдене ДТП при "без ДТП") завжди мінімум caution.

Відповідай ЛИШЕ валідним JSON без markdown, точно за схемою:
{
 "vehicle": {"title":"Марка Модель Рік","year":2018,"fuel":"petrol|diesel|hybrid|electric","engine":"4.4 л бензин V8, 462 к.с. (або null)","transmission":"...","drive":"...","trim":"версія або null","mileage_note":"129 000 км"},
 "auction": {"found":true,"summary":"2-4 речення: що сталося з авто в США за архівом, реальний обсяг пошкоджень по фото, чи чесно продавець його описує","findings":[{"status":"ok|warn|bad|unknown","text":"порівняння до/після, 1 речення"}]},
 "risks":[{"title":"назва ризику","level":"high|med|low","note":"1-2 речення: чому це головна стаття витрат чи ризику саме тут","action":"конкретна перевірка до покупки, 1 рядок"}],
 "equipment":{"vin":["опція з декодування VIN"],"photo":["опція, яку видно на фото"],"seller":["опція зі слів продавця"]},
 "discrepancies":[{"severity":"high|med|low","title":"коротка назва розбіжності","detail":"2-3 речення: що стверджується, що знайдено, звідки","sources":["опис продавця","перевірка площадки","фото","VIN"]}],
 "history":[{"date":"MM.YYYY або YYYY","event":"1 рядок: подія з історії авто","gap":"тривалість від попередньої події ('2 роки 3 місяці') або null"}],
 "history_note":"1 рядок ЛИШЕ якщо патерн незвичний (наприклад 3 переоформлення за 5 місяців), без спекуляцій про причини; якщо історія звичайна: null",
 "photo_findings":[{"status":"ok|warn|bad|unknown","text":"знахідка по фото, 1 речення"}],
 "data_notes":"сміття чи суперечності в даних площадки, 1-2 речення, або null",
 "model_notes":{"issues":[{"unit":"вузол/двигун","title":"назва проблеми","detail":"1-2 речення","severity":"low|med|high"}]},
 "checklist":["конкретна перевірка при огляді, 1 рядок", "..."],
 "score_facts":{"findings":[{"type":"STRUCTURAL_DAMAGE","event_id":"accident_2020","severity":"high","repair_status":"unknown","evidence":[{"source":"us_auction","ref":"auction_event_1","description":"на аукціонних фото деформований лівий лонжерон"}]}],"info_notes":["вільна замітка без впливу на бал"]},
 "verdict":{"score":7.4,"summary":"3-5 речень людською мовою: що це за авто і пропозиція, головні знахідки, чи варто розглядати і за яких умов. Без канцеляриту"}
}
"checklist": 3-6 пунктів, і це поради ПОКУПЦЮ ДЛЯ ЖИВОГО ОГЛЯДУ І ТЕСТ-ДРАЙВУ, а не дослідницькі завдання. ЖОРСТКІ правила:
- ЗАБОРОНЕНО радити користувачу самому діставати дані: build sheet за VIN, аукціонні фото, лоти Copart, платні VIN-звіти, історію. Збір даних це робота CalCar, а не покупця.
- Кожен пункт мусить випливати з КОНКРЕТНОЇ знахідки цього звіту (розбіжність, запис історії, знахідка на фото, слабке місце цієї версії при цьому пробігу) і називати, ЩО саме шукати і ДЕ. Приклад правильного: "задній лівий кут: звір відтінок ліхтаря і зазор кришки багажника, у 2020 був страховий випадок ззаду". Приклад забороненого: "зробити карту ЛКП товщиноміром по всіх елементах".
- Загальні ритуали ("діагностика на СТО", "прочитати помилки", "перевірити рівні рідин") дозволені лише якщо привʼязані до конкретного вузла з конкретної причини з цього звіту.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY не налаштований у Vercel' });
  }

  try {
    const rawUrl = String((req.body || {}).url || '').trim();
    const lang = ['ua', 'ru', 'en'].includes(req.body?.lang) ? req.body.lang : 'ua';
    if (!/^https?:\/\/.+\..+/.test(rawUrl)) {
      return res.status(400).json({ error: 'Встав повне посилання на оголошення, з https://' });
    }
    const url = rawUrl.split('#')[0];

    /* --- сторінка --- */
    let html;
    try {
      html = await fetchPage(url);
    } catch (e) {
      return res.status(e.blocked ? 502 : 502).json({
        error: e.blocked
          ? 'Сайт оголошення не пустив нас на сторінку. Спробуй ще раз за хвилину, це буває тимчасово'
          : 'Не вдалося завантажити сторінку оголошення: ' + e.message,
      });
    }

    const listing = extractListing(html, url);
    if (!listing.photos.length && !listing.vin && !listing.text) {
      return res.status(422).json({ error: 'Зі сторінки не вдалося витягнути дані оголошення. Надішли інше посилання' });
    }

    /* --- NHTSA decode: той самий безкоштовний шлях, що в Import --- */
    let nhtsa = null;
    if (listing.vin) {
      try {
        const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(listing.vin)}?format=json`);
        const row = (await r.json())?.Results?.[0];
        if (row) {
          nhtsa = {};
          for (const k of ['Make','Model','ModelYear','Trim','Series','FuelTypePrimary','ElectrificationLevel','DisplacementL','EngineHP','TransmissionStyle','DriveType','BodyClass','PlantCountry']) {
            if (row[k]) nhtsa[k] = row[k];
          }
        }
      } catch (e) { /* без NHTSA працюємо далі */ }
    }

    /* --- знімок у рів: ДО аналізу, щоб історія копилась навіть коли AI впав --- */
    const snapshot = await saveSnapshot(listing, url);

    /* --- фото "до ремонту": спершу кадри, збережені самою RIA --- */
    let auction = null;
    if (listing.usa_photos.length) {
      auction = { url: listing.auction_url, photos: listing.usa_photos, text: '', from_ria: true };
    } else if (listing.auction_url) {
      /* запасний шлях: зовнішній архів, якщо він раптом пустить */
      auction = await fetchAuction(listing.auction_url);
    }

    /* --- автономний аукціонний пошук за VIN: лістинг аукціону не дав ---
       Статуси чесні: found лише зі строгою ідентичністю, absent лише коли
       джерела ВІДПОВІЛИ, заблокований доступ це unknown/source_unreachable
       і машину за нього не караємо. Діагностика по джерелах іде в логи
       (Runtime Logs покажуть, кого прод-IP не проходить) і в _meta */
    let auctionSearch = null;
    if (!auction && listing.vin) {
      try {
        const cached = await readAuctionCache(listing.vin);
        if (cached && !shouldRecheck(cached)) {
          auctionSearch = { status: cached.status, reason: 'cache', source: cached.source || null, lot_url: cached.lot_url || null, cache: 'hit' };
          if (cached.status === 'found' && cached.lot_url) {
            auction = { url: cached.lot_url, photos: Array.isArray(cached.record?.photo_urls) ? cached.record.photo_urls.slice(0, 8) : [], text: '', from_search: true };
          }
          console.log('[auction] cache=hit', cached.status, listing.vin);
        } else {
          const rec = await findAuctionRecord(listing.vin, nhtsa, { totalBudgetMs: 20000 });
          auctionSearch = {
            status: rec.status, reason: rec.reason || null, source: rec.source || null,
            lot_url: rec.lot_url || null, total_ms: rec.total_ms, cache: 'miss',
            identity: rec.identity ? { confidence: rec.identity.confidence, year_page: rec.identity.year_page, year_vin: rec.identity.year_vin } : null,
            sources: rec.diagnostics.map(d => ({ source: d.source, step: d.step, status: d.status, blocked: !!d.blocked, found: !!d.found, ms: d.ms })),
          };
          if (rec.status === 'found') {
            auction = { url: rec.lot_url, photos: (rec.photo_urls || []).slice(0, 8), text: '', from_search: true };
            await writeAuctionCache(listing.vin, { status: 'found', source: rec.source, lot_url: rec.lot_url, record: { photo_urls: rec.photo_urls || [], identity: rec.identity } });
          } else if (rec.status === 'absent') {
            await writeAuctionCache(listing.vin, { status: 'absent', source: null, lot_url: null, record: null });
          }
        }
      } catch (e) { console.log('[auction] пошук впав:', e.message); }
    }

    /* --- AI --- */
    const LANG_NAME = { ua: 'українською', ru: 'російською', en: 'англійською (English)' };
    const langDirective = 'МОВА ВІДПОВІДІ: усі текстові значення пиши ' + LANG_NAME[lang] + '. Ключі JSON та enum-значення (status, severity, verdict, grade, fuel) залишай латиницею точно за схемою.';

    /* Бюджет фото. 40 кадрів у високій деталізації не встигають за ліміт часу,
       тому: ключові кадри високою деталізацією, решта низькою. Модель все одно
       бачить весь набір (салон, деталі), але запит лишається в межах часу. */
    const photoUrls = listing.photos.slice(0, 24);
    const auctionPhotos = (auction?.photos || []).slice(0, 8);
    const img = (u, detail) => ({ type: 'image_url', image_url: { url: u, detail } });
    const content = [
      { type: 'text', text: 'ФОТО З ОГОЛОШЕННЯ (стан зараз). Це ПОВНИЙ набір фото цього авто, включно з салоном і деталями: не пиши, що фото салону немає, якщо воно серед переданих. Якщо якийсь кадр очевидно належить ІНШОМУ авто (інша модель, інший колір, інший кузов), просто проігноруй його і не згадуй у звіті:' },
      ...photoUrls.map((u, i) => img(u, i < 12 ? 'high' : 'low')),
      ...(auctionPhotos.length
        ? [{ type: 'text', text: 'ФОТО З АУКЦІОНУ США (до ремонту, архів):' }, ...auctionPhotos.map(u => img(u, 'high'))]
        : []),
      { type: 'text', text: PROMPT(listing, nhtsa, auction, langDirective) },
    ];

    const EFFORT = process.env.REASONING_EFFORT || 'high';
    const modelBody = (c, withEffort = true) => {
      const b = {
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: c }],
      };
      if (withEffort && EFFORT !== 'off') b.reasoning_effort = EFFORT;
      return b;
    };
    const callModel = async (body, ms) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          signal: ctl.signal,
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
          body: JSON.stringify(body),
        });
        return await resp.json();
      } finally { clearTimeout(t); }
    };

    const t0 = Date.now();
    let data = await callModel(modelBody(content), 240000);

    if (data?.error && /reasoning_effort|unknown|unsupported|unrecognized/i.test(String(data.error.message || ''))) {
      data = await callModel(modelBody(content, false), Math.max(60000, 250000 - (Date.now() - t0)));
    }

    /* модель не змогла забрати фото за посиланням: повторюємо без фото,
       звіт по тексту кращий за відсутність звіту */
    if (data?.error && /image|url|download|fetch/i.test(String(data.error.message || ''))) {
      console.log('[check] photo urls failed, retrying text-only:', data.error.message);
      data = await callModel(modelBody([content[content.length - 1]]), Math.max(60000, 250000 - (Date.now() - t0)));
    }

    console.log('[check]', listing.domain,
      '| vin', listing.vin ? 'yes' : 'no',
      '| photos', photoUrls.length,
      '| snapshot', snapshot,
      '| ai', Date.now() - t0, 'ms',
      '| tokens', JSON.stringify(data?.usage || {}));

    if (data.error) {
      return res.status(502).json({ error: 'AI: ' + (data.error.message || 'помилка запиту') });
    }
    let parsed;
    try {
      parsed = JSON.parse((data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim());
    } catch (e) {
      return res.status(502).json({ error: 'AI повернув невалідну відповідь, спробуй ще раз' });
    }

    /* ---- CalCar Score v2, тіньовий режим: модель класифікувала знахідки,
       код визначає доступність джерел із фактів пайплайна, формула рахує.
       Користувач бачить легасі verdict.score, v2 лише зберігається в data ---- */
    try {
      const snaps = await readSnapshots(listing.vin, url);
      const coverageInputs = {
        /* порожній обʼєкт від NHTSA це НЕ декодування: потрібні змістовні
           поля, мінімум Make плюс Model або ModelYear */
        vin_decoded: !!(nhtsa && nhtsa.Make && (nhtsa.Model || nhtsa.ModelYear)),
        /* лише кількість унікальних кадрів, без AI-оцінки якості */
        photos_count: new Set(listing.photos.map(photoKey)).size,
        historical_listings_count: snaps.length,
        /* незалежні часові точки пробігу, БЕЗ поточного оголошення; один запис
           рахується один раз (дедуплікація за source_url уже в readSnapshots) */
        mileage_observation_count: snaps.filter(r => r.odometer_km != null).length,
        auction_record_exists: !!auction,
        /* достовірний сигнал експлуатації чи імпорту зі США, ОКРІМ самого
           запису аукціону. Місце виробництва (WMI) таким сигналом НЕ є:
           надійнішого джерела в пайплайні поки нема, тож false */
        auction_us_signal: false,
        /* джерела реально відповіли і запису нема: absent. Заблокований
           доступ (source_unreachable) лишає unknown, машина не винна */
        auction_checked: !!(auctionSearch && auctionSearch.status === 'absent'),
        /* цих джерел у пайплайні поки немає: код чесно каже "не був" */
        registration_data_exists: false,
        service_history_exists: false,
        inspection_history_exists: false,
        seller_docs_exists: false,
      };
      const findings = Array.isArray(parsed?.score_facts?.findings) ? parsed.score_facts.findings : [];
      const breakdown = computeScore(findings, coverageInputs);
      parsed.score_v2_preview = breakdown.final;
      parsed.score_breakdown_v2 = breakdown;
      console.log('[check] score_v2', breakdown.final, '(legacy', (parsed.verdict && parsed.verdict.score) + ')',
        '| cap', breakdown.coverage_cap, '| lim', breakdown.limiting_factors.join(',') || 'none');
    } catch (e) { console.log('[check] score_v2 failed:', e.message); }

    parsed._meta = {
      kind: 'check',
      lang,
      url,
      domain: listing.domain,
      country: listing.country,
      vin: listing.vin,
      plate: listing.plate,
      price: listing.price,
      currency: listing.currency,
      odometer_km: listing.odometer_km,
      photos: listing.photos.slice(0, 60),
      auction_url: listing.auction_url || null,
      auction_photos: auctionPhotos,
      auction_search: auctionSearch,
      snapshot,
      analyzed_at: new Date().toISOString(),
    };
    return res.status(200).json(parsed);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Аналіз не встиг завершитись. Спробуй ще раз, зазвичай з другої спроби швидше' });
    }
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
