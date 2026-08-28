export const config = { maxDuration: 300 };

import { computeScore } from './score.js';
import { findAuctionRecord, shouldRecheck, discoverVinCandidates, photoHasProvenance } from './auction.js';

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
  photos = photos.slice(0, 120);

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

  /* оригінальний опис продавця: ЛИШЕ користувацький текст, без
     автогенерованих секцій площадки (кузов, "Що перевірити перед
     покупкою", техдані). Пріоритет: structured JSON-LD Vehicle.description
     (точна межа від самої площадки); текстові маркери лише fallback.
     Якщо межу визначити не можна, краще коротший опис, ніж сміття */
  let sellerText = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const d = JSON.parse(m[1]);
      if (d && d['@type'] === 'Vehicle' && typeof d.description === 'string' && d.description.trim().length > 20) {
        sellerText = d.description.trim().slice(0, 3000);
        break;
      }
    } catch (e) { /* не валідний JSON-LD: пропускаємо */ }
  }
  if (!sellerText) {
    const mk = 'Опис від продавця';
    const i = text.indexOf(mk);
    if (i !== -1) {
      let end = Math.min(text.length, i + 4000);
      for (const stop of ['Дізнайтесь більше', 'Оголошення створене', 'Перевірено AUTO.RIA', 'Що перевірити перед покупкою', 'Что проверить перед покупкой']) {
        const j = text.indexOf(stop, i + mk.length);
        if (j !== -1 && j < end) end = j;
      }
      const seg = text.slice(i + mk.length, end).trim();
      if (seg.length > 20) sellerText = seg.slice(0, 3000);
    }
  }

  /* покоління з structured-поля площадки: заповнюється лише коли надійно
     відоме, інакше null (не вгадуємо) */
  let generation = null;
  if (isRia) {
    const g = /"id":"basicInfoGenerationBase"[\s\S]{0,300}?"content":"([A-Za-z0-9][A-Za-z0-9\- ]{0,18}?)\s*(?:•|")/.exec(html);
    if (g && g[1].trim()) generation = g[1].trim().slice(0, 20);
  }

  /* marketplace adapter: структуровані опції площадки з embedded-даних
     ВЖЕ завантаженої сторінки. Нормалізований плоский список іде в
     загальний Equipment-пайплайн із source listing_data; downstream від
     конкретної площадки не залежить: нема структурованих опцій, пайплайн
     працює через Vision + seller_text + заводські дані */
  const listingEquipment = [];
  if (isRia) {
    const seenOpt = new Set();
    for (const m of html.matchAll(/"id":"desc([A-Za-z]+)Value"[\s\S]{0,400}?"content":"([^"]{2,400})"/g)) {
      /* значення-списки через " • " це опції; одиночні значення це
         теххарактеристики (колір, коробка) і опціями не є. Сепаратор
         площадки буває з одним чи двома пробілами */
      const groupId = m[1];
      const parts = m[2].split(/\s+•\s+/).map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      for (let p of parts) {
        /* числові значення (витрати, кількість дверей) і тип кузова
           це не опції комплектації */
        if (/^\d/.test(p) || /\d+[.,]\d+/.test(p)) continue;
        if (/^(Седан|Купе|Універсал|Хетчбек|Позашляховик|Ліфтбек|Мінівен|Пікап|Кабріолет|Родстер)$/i.test(p)) continue;
        /* позиції подушок без контексту групи безглузді */
        if (/^airbag/i.test(groupId)) p = 'Подушка безпеки: ' + p;
        const key = p.toLowerCase();
        if (!seenOpt.has(key)) { seenOpt.add(key); listingEquipment.push(p.slice(0, 60)); }
      }
    }
  }

  return {
    domain, country: isRia ? 'UA' : null,
    title: title.slice(0, 200), vin, plate,
    seller_text: sellerText,
    generation,
    listing_equipment: listingEquipment.slice(0, 60),
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
  if (!base || !key) return { status: 'env_missing', id: null };
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/vehicle_snapshots', {
      method: 'POST',
      headers: {
        apikey: key, authorization: 'Bearer ' + key,
        'content-type': 'application/json', prefer: 'return=representation',
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
    if (!r.ok) return { status: 'error_' + r.status, id: null };
    const rows = await r.json().catch(() => []);
    return { status: 'saved', id: Array.isArray(rows) && rows[0] ? rows[0].id : null };
  } catch (e) { return { status: 'error', id: null }; }
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

/* ---------- 4в. Кеш аукціонних подій ----------
   Читаємо збережену подію з auction_events за VIN. Знайдена подія постійна:
   повторний аналіз використовує її і НЕ платить за ретривал знову.
   До виконання міграції функція тихо повертає null, пайплайн не залежить */
async function readAuctionCache(vin) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !vin) return null;
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/auction_events?vin=eq.' + encodeURIComponent(vin) + '&order=checked_at.desc&limit=1&select=*', {
      headers: { apikey: key, authorization: 'Bearer ' + key },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return null;
    /* приводимо рядок події до форми, яку очікує гілка cache-hit */
    return {
      status: 'found',
      source: row.auction_house || null,
      lot_url: row.lot_url || (Array.isArray(row.source_urls) ? row.source_urls[0] : null),
      checked_at: row.checked_at,
      record: row.record || { photo_urls: [], meta: { auction_house: row.auction_house, lot_id: row.lot_id } },
    };
  } catch (e) { return null; }
}
/* аукціонна подія: ключ (auction_house, lot_id) ідентифікує ПОДІЮ, не
   джерело. Одна подія, знайдена на кількох дзеркалах, лишається одним
   рядком і обогачується (source_urls зливаються). У VIN подій може бути
   кілька. До виконання міграції власником запис мовчки не відбувається */
async function writeAuctionEvent(vin, rec) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !vin || !rec) return;
  const house = String(rec.meta?.auction_house || '');
  const lotId = String(rec.meta?.lot_id || '');
  /* ключ мусить бути повним і канонічним. Домен дзеркала домом не є */
  if (house !== 'IAAI' && house !== 'COPART') return;
  if (!lotId) return;
  const unit = ['mi', 'km', 'unknown'].includes(rec.meta?.odometer_unit) ? rec.meta.odometer_unit : 'unknown';
  const root = base.replace(/\/$/, '');
  const hdr = { apikey: key, authorization: 'Bearer ' + key };
  try {
    /* обогачення source_urls: читаємо наявний рядок, зливаємо джерела */
    let sourceUrls = rec.lot_url ? [rec.lot_url] : [];
    try {
      const r = await fetch(root + '/rest/v1/auction_events?auction_house=eq.' + encodeURIComponent(house) + '&lot_id=eq.' + encodeURIComponent(lotId) + '&select=source_urls', { headers: hdr });
      if (r.ok) {
        const rows = await r.json();
        const prev = Array.isArray(rows?.[0]?.source_urls) ? rows[0].source_urls : [];
        sourceUrls = [...new Set([...prev, ...sourceUrls])];
      }
    } catch (e) { /* перший запис події: наявного рядка нема */ }
    /* first_seen_at НЕ шлемо: default now() на insert, при обогаченні лишається */
    await fetch(root + '/rest/v1/auction_events?on_conflict=auction_house,lot_id', {
      method: 'POST',
      headers: { ...hdr, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        auction_house: house,
        lot_id: lotId,
        vin,
        sale_date: rec.meta?.sale_date || null,
        odometer_value: rec.meta?.odometer_value ?? null,
        odometer_unit: unit,
        odometer_status: ['actual', 'not_actual', 'exempt', 'unknown'].includes(rec.meta?.odometer_status) ? rec.meta.odometer_status : 'unknown',
        primary_damage: rec.meta?.primary_damage || null,
        secondary_damage: rec.meta?.secondary_damage || null,
        title_status: rec.meta?.title_status || null,
        source_urls: sourceUrls,
        record: {
          photo_urls: rec.photo_urls || [],
          identity: rec.identity || null,
          meta: rec.meta || null,
          sources_checked: rec.sources_checked || [],
          lot_id_source: rec.meta?.lot_id_source || null,
          sale_date_raw: rec.meta?.sale_date_raw || null,
          odometer_status_raw: rec.meta?.odometer_status_raw || null,
        },
        checked_at: new Date().toISOString(),
      }),
    });
  } catch (e) { /* persistence не критичний */ }
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

/* ---------- 4в2. Нормалізація фактів держ/історичного блоку RIA ----------
   ДЕТЕРМІНОВАНІ маркери з офіційних блоків сторінки: власники, точки пробігу,
   минулі оголошення, запис ДТП, пригін зі США, аукціонний запис у даних
   площадки. Один і той самий нормалізований набір їде і в coverage (Score),
   і в промпт (purchase_decision): факт не має губитись між ними */
export function extractHistoryFacts(text) {
  const t = String(text || '');
  const registry_present = /за офіційними відкритими державними даними/i.test(t)
    && !/Відсутня інформація із офіційних відкритих даних/i.test(t)
    && (/\d+\s*власник/i.test(t) || /Остання операція/i.test(t));
  let owners_count = null;
  for (const m of t.matchAll(/(\d+)(?:-[а-яіїє]+)?\s*власник/gi)) {
    const n = parseInt(m[1], 10);
    if (n && (owners_count === null || n > owners_count)) owners_count = n;
  }
  /* aiText може дублювати секції сторінки: рахуємо УНІКАЛЬНІ датовані записи,
     а не сирі збіги, інакше та сама подія рахується двічі */
  const past_listings = new Set(
    [...t.matchAll(/(\d{2}\.\d{2}\.\d{2})\s+Продавалось на AUTO\.RIA/g)].map(m => m[1])
  ).size;
  const past_mileage_points = new Set([
    ...[...t.matchAll(/(\d{2}\.\d{2}\.\d{2})\s+Продавалось на AUTO\.RIA\s+Продавець вказав пробіг\s*(\d+)/g)].map(m => m[1] + '|' + m[2]),
    ...[...t.matchAll(/(\d{2}\.\d{2}\.\d{2})\s+Зафіксовано пробіг\s*(\d+)/g)].map(m => m[1] + '|' + m[2]),
  ]).size;
  const accident_recorded = /Зафіксовано ДТП/i.test(t) || /Був(?:ла)?\s+у\s+ДТП/i.test(t);
  const accident_note = ((t.match(/Зафіксовано ДТП\s*[•]?\s*(.{10,180}?)(?:Історія авто|Вподобали|Пробіг від|$)/i) || [])[1] || '').trim() || null;
  return {
    registry_present,
    owners_count,
    past_listings,
    past_mileage_points,
    accident_recorded,
    accident_note,
    us_import_record: /Пригнано з США|Ввезено з США|Пригнано зі США/i.test(t),
    /* \w не матчить кирилицю: явний літерал фрази площадки */
    ria_auction_record: /архівні дані з офіційного аукціону/i.test(t),
  };
}

/* ---------- 4г. Валідація фінального висновку ----------
   Битий чи неповний purchase_decision не валить звіт: поле просто
   прибирається, і сторінка рендерить старий verdict.summary */
export function sanitizePurchaseDecision(pd, v2) {
  if (!pd || typeof pd !== 'object' || Array.isArray(pd)) return null;
  if (!['buy', 'go_see', 'negotiate', 'skip'].includes(pd.recommendation)) return null;
  const str = (v, n) => (typeof v === 'string' && v.trim()) ? v.trim().replace(/\u2014/g, ',').slice(0, n) : null;
  const arr = v => Array.isArray(v)
    ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().replace(/\u2014/g, ',').slice(0, 300)).slice(0, 8)
    : [];
  const out = {
    recommendation: pd.recommendation,
    headline: str(pd.headline, 140),
    summary_short: str(pd.summary_short, 400),
    reasoning: str(pd.reasoning, 4000),
    why_consider: arr(pd.why_consider),
    main_concerns: arr(pd.main_concerns),
    must_check: arr(pd.must_check),
    questions_for_seller: arr(pd.questions_for_seller),
    value_context: str(pd.value_context, 600),
    missing_but_important: arr(pd.missing_but_important),
  };
  if (!out.headline || !out.summary_short || !out.reasoning) return null;
  /* сумісність із балом: skip при 8+ чи buy при <=4.5 це червоний прапорець.
     Рішення не викидаємо, але позначаємо: тіньові дані для калібрування */
  if (typeof v2 === 'number' && ((out.recommendation === 'skip' && v2 >= 8) || (out.recommendation === 'buy' && v2 <= 4.5))) {
    out.score_conflict = true;
    console.log('[check] decision-score conflict:', out.recommendation, 'при v2', v2);
  }
  return out;
}

/* ---------- 4б2. Рівномірна вибірка кадрів для Vision ----------
   Перші 24 підряд відрізали салон: у галереях оголошень екстерʼєр іде
   першим, а торпедо, консоль і сидіння лежать у хвості. Тому і кадри
   (максимум 24), і high-слоти (максимум 12) розподіляються детерміновано
   і рівномірно по всьому діапазону від першого до останнього. Без
   AI-класифікації, hash-ів і схожості: спершу проста рівномірна вибірка */
export function pickEvenIndexes(n, k) {
  if (!Number.isFinite(n) || n <= 0) return [];
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  const idx = [];
  for (let i = 0; i < k; i++) idx.push(Math.round(i * (n - 1) / (k - 1)));
  return [...new Set(idx)];
}

/* ---------- 4б3. Детермінований вибір різноманітних кадрів ----------
   types: масив типів кадрів за індексами галереї (від класифікатора).
   Round-robin за пріоритетом типів: салон, багажник і задній ряд
   потрапляють обовʼязково, однакові екстерʼєри не зʼїдають бюджет.
   high-слоти (максимум maxHigh) дістаються найінформативнішим типам */
export function pickDiverseFrames(types, k = 24, maxHigh = 12) {
  const PRI = ['dashboard', 'center_console', 'steering', 'front_seats', 'rear_seats', 'trunk', 'doors', 'roof', 'engine_bay', 'front', 'rear', 'side', 'wheels', 'detail', 'other'];
  const norm = t => PRI.includes(t) ? t : 'other';
  const byType = new Map(PRI.map(t => [t, []]));
  (Array.isArray(types) ? types : []).forEach((t, i) => byType.get(norm(t)).push(i));
  const n = (Array.isArray(types) ? types : []).length;
  const picked = [];
  for (let round = 0; picked.length < Math.min(k, n); round++) {
    let added = false;
    for (const t of PRI) {
      const arr = byType.get(t);
      if (arr.length > round) {
        picked.push(arr[round]);
        added = true;
        if (picked.length >= Math.min(k, n)) break;
      }
    }
    if (!added) break;
  }
  picked.sort((a, b) => a - b);
  const HIGH_PRI = ['dashboard', 'steering', 'center_console', 'doors', 'front_seats', 'rear_seats', 'trunk', 'front', 'rear', 'side', 'detail', 'engine_bay', 'roof', 'wheels', 'other'];
  const rank = i => HIGH_PRI.indexOf(norm(types[i]));
  const high = picked.slice().sort((a, b) => rank(a) - rank(b) || a - b).slice(0, maxHigh);
  return { picked, high: new Set(high) };
}

/* ---------- 4в3. Історичний візуальний аналіз: детермінована валідація ----------
   Структурований assessment історичних кадрів. Жорстка семантика:
   no_obvious_severe_signs НІКОЛИ не означає "структура ціла",
   no_deployment_visible не означає справну SRS. Без переданих кадрів
   поле не існує. На Score не впливає: лише wording, звіт і decision */
export function sanitizeHistoricalVisual(hv, photosSent) {
  if (!photosSent || !hv || typeof hv !== 'object' || Array.isArray(hv)) return null;
  const SEV = ['minor', 'moderate', 'severe', 'indeterminate'];
  const STR = ['no_obvious_severe_signs', 'possible', 'visible_damage', 'indeterminate'];
  const SRS = ['deployed_visible', 'no_deployment_visible', 'not_visible', 'indeterminate'];
  const clean = v => (typeof v === 'string' && v.trim()) ? v.trim().replace(/\u2014/g, ',') : null;
  return {
    visible_damage_zones: (Array.isArray(hv.visible_damage_zones) ? hv.visible_damage_zones : []).map(clean).filter(Boolean).map(z => z.slice(0, 60)).slice(0, 10),
    visible_severity: SEV.includes(hv.visible_severity) ? hv.visible_severity : 'indeterminate',
    structural_visual_status: STR.includes(hv.structural_visual_status) ? hv.structural_visual_status : 'indeterminate',
    srs_visual_status: SRS.includes(hv.srs_visual_status) ? hv.srs_visual_status : 'indeterminate',
    summary: clean(hv.summary) ? clean(hv.summary).slice(0, 600) : null,
    evidence: (Array.isArray(hv.evidence) ? hv.evidence : [])
      .filter(e => e && typeof e === 'object')
      .map(e => ({ source: clean(e.source), ref: clean(e.ref), description: clean(e.description) ? clean(e.description).slice(0, 200) : null }))
      .filter(e => e.source)
      .slice(0, 6),
  };
}

/* ---------- 4г. Комплектація: детермінована валідація і верифікація ----------
   Модель пропонує знахідки, код вирішує, що виживає. Рівно чотири рівні
   достовірності, рівня "ймовірно" не існує. Візуальне підтвердження без
   кадру і конкретної ознаки не існує. Філософія: краще пропустити опцію,
   ніж впевнено додати неіснуючу */
export function sanitizeEquipment(list, marketplace) {
  if (!Array.isArray(list)) return [];
  const LEVELS = ['vehicle_data', 'seller_and_visual', 'visual', 'seller', 'listing_data'];
  const CATS = ['comfort', 'interior', 'multimedia', 'assist', 'exterior', 'performance'];
  const TIERS = ['standard', 'notable', 'high_value'];
  /* provenance-тип за первинним джерелом; display-група це НЕ evidence */
  const PMAP = { vehicle_data: 'factory_data', current_photos: 'visual', seller_claim: 'seller', listing_data: 'listing_data', historical: 'historical' };
  const clean = v => (typeof v === 'string' && v.trim()) ? v.trim().replace(/\u2014/g, ',') : null;
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const name = clean(raw.name) && clean(raw.name).slice(0, 80);
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    /* захист від вигаданих рівнів на кшталт "ймовірно" */
    if (raw.confidence_level != null && !LEVELS.includes(raw.confidence_level)) continue;
    const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
      .filter(e => e && typeof e === 'object')
      .map(e => ({
        source: clean(e.source) ? clean(e.source).slice(0, 30) : null,
        ref: clean(e.ref) ? clean(e.ref).slice(0, 60) : null,
        sign: clean(e.sign) ? clean(e.sign).slice(0, 200) : null,
      }))
      .filter(e => e.source)
      .slice(0, 5);
    const visualEv = evidence.some(e => e.source === 'current_photos' && e.ref && e.sign);
    const sellerEv = evidence.some(e => e.source === 'seller_claim');
    const dataEv = evidence.some(e => e.source === 'vehicle_data' && e.sign);
    const listEv = evidence.some(e => e.source === 'listing_data');
    const histEv = evidence.some(e => e.source === 'historical');
    /* display-рівень ДЕТЕРМІНОВАНО з первинних джерел, не зі слів моделі:
       factory_data -> Дані авто; visual + listing/seller -> Підтверджено;
       лише visual -> Видно на фото; лише listing_data -> Дані оголошення;
       лише seller -> Зі слів продавця. "Підтверджено" НЕ означає
       "підтверджено по VIN" */
    let level;
    if (dataEv) level = 'vehicle_data';
    else if (visualEv && (sellerEv || listEv)) level = 'seller_and_visual';
    else if (visualEv) level = 'visual';
    else if (listEv) level = 'listing_data';
    else if (sellerEv) level = 'seller';
    else if (raw.historical_claim === true && histEv) level = null;
    else continue;
    const provenance = evidence.filter(e => PMAP[e.source]).map(e => {
      const p = { type: PMAP[e.source] };
      if (e.ref) p.ref = e.ref;
      if (e.sign) p.evidence = e.sign;
      if (e.source === 'current_photos' && e.ref && /^photo_\d+$/.test(e.ref)) p.photo_id = e.ref;
      if (e.source === 'listing_data' && marketplace) p.marketplace = marketplace;
      return p;
    });
    const basis = clean(raw.retrofit_basis) ? clean(raw.retrofit_basis).slice(0, 200) : null;
    const retrofit = raw.retrofit === true && !!basis;
    out.push({
      name,
      category: CATS.includes(raw.category) ? raw.category : 'comfort',
      confidence_level: level,
      highlight: raw.highlight === true && !!level,
      retrofit,
      retrofit_basis: retrofit ? basis : null,
      historical_claim: raw.historical_claim === true,
      /* value_tier це цінність, не достовірність: на рівень не впливає */
      value_tier: TIERS.includes(raw.value_tier) ? raw.value_tier : 'standard',
      factory_status: dataEv ? 'confirmed' : 'unknown',
      provenance,
      evidence,
    });
    seen.add(key);
    if (out.length >= 40) break;
  }
  let h = 0;
  for (const it of out) if (it.highlight && ++h > 8) it.highlight = false;
  return out;
}

/* кандидати на скептичну перевірку: лише важливі і брендові візуальні
   знахідки, максимум 6. vehicle_data і seller не перевіряються взагалі */
export function selectEquipmentClaims(items) {
  const PRIORITY = [
    /burmester|harman|bang|bowers|b&o|meridian|levinson|bose|акустик|аудіо|аудио|sound/i,
    /пакет|package|m ?sport|m ?style|amg|s-?line|r-?line|denali|стилістик|стилистик/i,
    /адаптивн|дистрон|distronic|круїз|круиз|асистент|ассистент|pilot/i,
    /hud|head-?up|проекц/i,
    /пневмо|air ?suspension|airmatic/i,
    /камер|360|кругов/i,
  ];
  const scored = [];
  (Array.isArray(items) ? items : []).forEach((it, idx) => {
    if (it.confidence_level !== 'visual' && it.confidence_level !== 'seller_and_visual') return;
    for (let p = 0; p < PRIORITY.length; p++) {
      if (PRIORITY[p].test(it.name)) { scored.push({ it, p, idx }); break; }
    }
  });
  scored.sort((a, b) => a.p - b.p || a.idx - b.idx);
  return scored.slice(0, 6).map(x => x.it);
}

/* детерміноване застосування вердиктів перевіряльника:
   seller_and_visual не пройшов = seller (якщо заява продавця існує);
   visual без іншого джерела не пройшов = видаляється;
   vehicle_data і seller перевіркою не понижуються */
export function applyEquipmentVerifier(items, verdicts) {
  if (!Array.isArray(items)) return [];
  if (!Array.isArray(verdicts)) return items;
  const bad = new Set(verdicts
    .filter(v => v && v.verdict === 'not_confirmed' && typeof v.name === 'string')
    .map(v => v.name.trim().toLowerCase().replace(/\s+/g, ' ')));
  if (!bad.size) return items;
  const out = [];
  for (const it of items) {
    if (!bad.has(it.name.trim().toLowerCase().replace(/\s+/g, ' '))) { out.push(it); continue; }
    if (it.confidence_level === 'seller_and_visual') {
      const rest = it.evidence.filter(e => e.source !== 'current_photos');
      const restProv = (it.provenance || []).filter(p => p.type !== 'visual');
      if (rest.some(e => e.source === 'seller_claim')) out.push({ ...it, confidence_level: 'seller', evidence: rest, provenance: restProv });
      else if (rest.some(e => e.source === 'listing_data')) out.push({ ...it, confidence_level: 'listing_data', evidence: rest, provenance: restProv });
    } else if (it.confidence_level !== 'visual') {
      out.push(it);
    }
    /* visual, що не пройшов: видалено */
  }
  return out;
}

/* ---------- 4д. Шар накопичення знань: спостереження з Check ----------
   Чисті build-функції формують рядки для equipment_observation /
   issue_observation / observation_coverage, мережею їх пише writeKnowledge.
   Правила чесності:
   - ABSENT дозволений ЛИШЕ від джерела, здатного довести відсутність
     (vehicle_data чи document); Vision, продавець і опції площадки дають
     PRESENT або UNKNOWN;
   - суто historical evidence НЕ підтверджує PRESENT для поточного
     снапшота: стан UNKNOWN;
   - visual-покриття комплектації завжди partial: повний перегляд галереї
     не означає повний перелік опцій (він живе в gallery_complete);
   - у issue_observation йдуть ЛИШЕ vehicle-specific знахідки з конкретним
     первинним доказом; типові слабкі місця моделі (model_notes), generic-
     ризики і згенерований reasoning НЕ пишуться ніколи */

export function normalizeOptionAlias(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
}

/* детермінований ключ доказу: без залежностей, djb2 у hex */
export function evidenceKey(e) {
  const raw = [e.source_type, e.source_ref, e.source_url, e.description].map(v => v || '').join('|');
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) ^ c) >>> 0;
  }
  return h1.toString(16) + h2.toString(16);
}

/* ABSENT лише від доказу, здатного довести відсутність */
export function absentAllowed(evidence) {
  return (Array.isArray(evidence) ? evidence : []).some(e =>
    e && (e.source_type === 'vehicle_data' || e.source_type === 'document'));
}

const KNOWLEDGE_SOURCE_MAP = { factory_data: 'vehicle_data', visual: 'visual', listing_data: 'listing_data', seller: 'seller_text', historical: 'historical', document: 'document' };

export function buildEquipmentObservations(parsed, listing, snapshotId) {
  const items = Array.isArray(parsed && parsed.equipment_v2) ? parsed.equipment_v2 : [];
  const v = (parsed && parsed.vehicle) || {};
  const out = [];
  for (const it of items) {
    if (!it || !it.name) continue;
    const evidence = (Array.isArray(it.provenance) ? it.provenance : [])
      .filter(p => p && KNOWLEDGE_SOURCE_MAP[p.type])
      .map(p => {
        const ev = {
          source_type: KNOWLEDGE_SOURCE_MAP[p.type],
          source_ref: p.ref || p.photo_id || null,
          source_url: null,
          description: p.evidence || null,
          /* historical стверджує минуле, не поточний снапшот */
          claim_state: KNOWLEDGE_SOURCE_MAP[p.type] === 'historical' ? 'UNKNOWN' : 'PRESENT',
          /* реальний per-evidence рівень у Check відсутній: не вигадуємо
             його з display-групи, лишаємо null */
          confidence: null,
        };
        ev.evidence_key = evidenceKey(ev);
        return ev;
      });
    if (!evidence.length) continue;
    /* стан поточного снапшота: суто historical = UNKNOWN, ABSENT з Check
       не буває (довідного джерела відсутності в пайплайні нема) */
    const onlyHistorical = evidence.every(e => e.source_type === 'historical');
    const state = onlyHistorical ? 'UNKNOWN' : 'PRESENT';
    out.push({
      option_name: String(it.name).slice(0, 80),
      option_category: it.category || 'other',
      observation: {
        vin: listing.vin, snapshot_id: snapshotId, check_id: null,
        /* source НЕ дорівнює confidence: display-група виводиться з джерел,
           тому виводити з неї впевненість це та сама заборонена підміна.
           Реального independent confidence у Check-знахідці нема: null */
        state, confidence: null,
        retrofit: it.retrofit === true,
        make: listing.make || null, model: listing.model || null, generation: listing.generation || null,
        model_year: listing.year || null,
        listing_market: listing.country || null,
        factory_market: null,
        engine: v.engine || null, trim: v.trim || null, drive: undefined, drivetrain: v.drive || null,
      },
      evidence,
    });
  }
  return out;
}

export function validateEquipmentObservation(row) {
  /* захисний шар перед записом: ABSENT без довідного доказу відхиляється */
  if (row.observation.state === 'ABSENT' && !absentAllowed(row.evidence)) return false;
  return true;
}

const ISSUE_TYPE_BY_SOURCE = { historical: 'historical_record', visual: 'visible_defect', document: 'document', seller_text: 'seller_statement', vehicle_data: 'inspection_record', listing_data: 'historical_record' };

/* issue_observation це шар ТЕХНІЧНИХ/експлуатаційних проблем конкретної
   машини, які потенційно стосуються Model Issue Intelligence. ДТП, damage
   events, реєстрації, пробіги і звичайні історичні події сюди НЕ пишуться:
   вони живуть у Vehicle Graph шарах (vehicle_snapshots, auction_events,
   history) і в derived-агрегатах болячок не беруть участі */
const TECHNICAL_ISSUE_TYPES = ['SRS_FAULT', 'SERIOUS_POWERTRAIN_FAULT', 'CRITICAL_WARNING_LIGHTS', 'MODIFICATION_TECHNICAL_CONCERN'];

export function buildIssueObservations(parsed, listing, snapshotId) {
  /* ЛИШЕ vehicle-specific ТЕХНІЧНІ знахідки з конкретним первинним доказом.
     model_notes (типові слабкі місця версії), risks і reasoning сюди не
     читаються ВЗАГАЛІ: заборона архітектурна, не фільтр */
  const out = [];
  const v = (parsed && parsed.vehicle) || {};
  const base = () => ({
    vin: listing.vin, snapshot_id: snapshotId, check_id: null,
    make: listing.make || null, model: listing.model || null, generation: listing.generation || null,
    model_year: listing.year || null, listing_market: listing.country || null, factory_market: null,
    engine: v.engine || null, trim: v.trim || null, drivetrain: v.drive || null,
  });
  const findings = Array.isArray(parsed && parsed.score_facts && parsed.score_facts.findings)
    ? parsed.score_facts.findings : [];
  const SRC = { us_auction: 'historical', historical_listing: 'historical', registry: 'historical', current_photos: 'visual', document: 'document', seller_claim: 'seller_text' };
  for (const fnd of findings) {
    if (!fnd || !fnd.type || !fnd.event_id) continue;
    /* damage/history події (ДТП, затоплення, скрутки) лишаються в
       auction/history шарах, не в model issue intelligence */
    if (!TECHNICAL_ISSUE_TYPES.includes(fnd.type)) continue;
    const evidence = (Array.isArray(fnd.evidence) ? fnd.evidence : [])
      .filter(e => e && SRC[e.source] && (e.ref || e.description))
      .map(e => {
        const ev = { source_type: SRC[e.source], source_ref: e.ref || null, source_url: null, description: e.description || null, confidence: null };
        ev.evidence_key = evidenceKey(ev);
        return ev;
      });
    /* сам факт присутності у score_facts недостатній: без конкретного
       первинного доказу спостереження не створюється */
    if (!evidence.length) continue;
    out.push({
      observation: Object.assign(base(), {
        issue_type: ISSUE_TYPE_BY_SOURCE[evidence[0].source_type] || 'historical_record',
        event_key: String(fnd.event_id).slice(0, 120),
        issue_key: String(fnd.type).slice(0, 60),
        title: String(fnd.type).slice(0, 120),
        detail: (evidence[0].description || '').slice(0, 300) || null,
      }),
      evidence,
    });
  }
  return out;
}

export function buildCoverageRows(parsed, listing, snapshotId, meta) {
  const rows = [];
  const ps = (meta && meta.photo_selection) || {};
  const types = (ps.selector && Array.isArray(ps.selector.types)) ? [...new Set(ps.selector.types)] : [];
  /* visual для комплектації ЗАВЖДИ partial: повний перегляд галереї не
     означає повний перелік опцій; факт перегляду всієї галереї окремо */
  rows.push({
    vin: listing.vin, snapshot_id: snapshotId, source_type: 'visual',
    completeness: 'partial',
    gallery_complete: ps.gallery_coverage_complete === true,
    covered_areas: types.length ? types : (ps.gallery_coverage_complete ? ['all_frames'] : ['sampled_frames']),
  });
  if (Array.isArray(listing.listing_equipment) && listing.listing_equipment.length) {
    rows.push({ vin: listing.vin, snapshot_id: snapshotId, source_type: 'listing_data', completeness: 'partial', gallery_complete: null, covered_areas: ['structured_options'] });
  }
  if (listing.seller_text) {
    rows.push({ vin: listing.vin, snapshot_id: snapshotId, source_type: 'seller_text', completeness: 'partial', gallery_complete: null, covered_areas: ['seller_description'] });
  }
  return rows;
}

/* мережевий запис: батчами через PostgREST, on_conflict=ignore.
   Помилка тут НІКОЛИ не ламає Check: лише лог */
async function writeKnowledge(parsed, listing, snapshotId, meta) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !snapshotId || !listing.vin) return 'skipped';
  /* headers мерджаться ПІСЛЯ spread opts: інакше opts.headers (prefer)
     затирав auth-заголовки і всі POST діставали 401 */
  const api = (path, opts) => {
    opts = opts || {};
    return fetch(base.replace(/\/$/, '') + '/rest/v1/' + path, {
      ...opts,
      headers: Object.assign({ apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' }, opts.headers || {}),
    });
  };
  /* PostgREST при помилці віддає ОБʼЄКТ, не масив: ітерація по ньому
     валила весь хук. Тут завжди масив, помилка йде в лог зі своїм кроком */
  const stepErrs = [];
  const jarr = async (r, step) => {
    const j = await r.json().catch(() => null);
    if (Array.isArray(j)) return j;
    if (!r.ok || j) {
      console.log('[knowledge]', step, 'HTTP', r.status, JSON.stringify(j || {}).slice(0, 160));
      stepErrs.push(step + ':' + r.status);
    }
    return [];
  };
  /* значення in.(...) беруться в лапки: пробіли і коми інакше ламають фільтр */
  const inList = vals => 'in.(' + vals.map(v => encodeURIComponent('"' + String(v).replace(/"/g, '') + '"')).join(',') + ')';
  const postCheck = async (p, r) => { if (!r.ok) { console.log('[knowledge]', p, 'HTTP', r.status, (await r.text().catch(() => '')).slice(0, 160)); stepErrs.push(p + ':' + r.status); } return r; };
  const eqRows = buildEquipmentObservations(parsed, listing, snapshotId).filter(validateEquipmentObservation);
  const issueRows = buildIssueObservations(parsed, listing, snapshotId);
  const covRows = buildCoverageRows(parsed, listing, snapshotId, meta);
  if (!eqRows.length && !issueRows.length && !covRows.length) return 'empty';

  /* 1. словник опцій: alias -> option_id, відсутні опції створюються */
  const aliasMap = {};
  if (eqRows.length) {
    const norms = [...new Set(eqRows.map(r => normalizeOptionAlias(r.option_name)))];
    const got = await api('option_alias?alias_norm=' + inList(norms) + '&select=alias_norm,option_id');
    for (const row of await jarr(got, 'alias_get')) aliasMap[row.alias_norm] = row.option_id;
    const missing = eqRows.filter(r => !aliasMap[normalizeOptionAlias(r.option_name)]);
    if (missing.length) {
      const uniq = new Map();
      for (const r of missing) uniq.set(normalizeOptionAlias(r.option_name), r);
      const ins = await api('option_dict?on_conflict=canonical_name', {
        method: 'POST',
        headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify([...uniq.values()].map(r => ({ canonical_name: r.option_name, category: ['comfort','interior','multimedia','assist','exterior','performance','safety'].includes(r.option_category) ? r.option_category : 'other' }))),
      });
      const created = await jarr(ins, 'option_insert');
      const reread = await api('option_dict?canonical_name=' + inList([...uniq.values()].map(r => r.option_name)) + '&select=option_id,canonical_name');
      for (const row of [...created, ...await jarr(reread, 'option_reread')]) {
        aliasMap[normalizeOptionAlias(row.canonical_name)] = row.option_id;
      }
      await postCheck('alias_insert', await api('option_alias?on_conflict=alias_norm', {
        method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify([...uniq.keys()].filter(nrm => aliasMap[nrm]).map(nrm => ({ alias_norm: nrm, alias: uniq.get(nrm).option_name, lang: null, option_id: aliasMap[nrm] }))),
      }));
    }
  }

  /* 2. спостереження комплектації: ідемпотентно, старі не перезаписуються */
  let eqSaved = 0, evSaved = 0;
  const eqValid = eqRows.filter(r => aliasMap[normalizeOptionAlias(r.option_name)]);
  if (eqValid.length) {
    await postCheck('eq_obs_insert', await api('equipment_observation?on_conflict=vin,snapshot_id,option_id', {
      method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(eqValid.map(r => {
        const o = { ...r.observation, option_id: aliasMap[normalizeOptionAlias(r.option_name)] };
        delete o.drive;
        return o;
      })),
    }));
    const ids = await api('equipment_observation?snapshot_id=eq.' + snapshotId + '&select=id,option_id');
    const idMap = {};
    for (const row of await jarr(ids, 'eq_obs_ids')) idMap[row.option_id] = row.id;
    const evRows = [];
    for (const r of eqValid) {
      const oid = idMap[aliasMap[normalizeOptionAlias(r.option_name)]];
      if (!oid) continue;
      for (const e of r.evidence) evRows.push({ observation_id: oid, ...e });
    }
    eqSaved = eqValid.length; evSaved = evRows.length;
    if (evRows.length) await postCheck('eq_ev_insert', await api('equipment_observation_evidence?on_conflict=observation_id,evidence_key', {
      method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify(evRows),
    }));
  }

  /* 3. знахідки машини */
  if (issueRows.length) {
    await postCheck('iss_obs_insert', await api('issue_observation?on_conflict=vin,snapshot_id,event_key', {
      method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(issueRows.map(r => r.observation)),
    }));
    const ids = await api('issue_observation?snapshot_id=eq.' + snapshotId + '&select=id,event_key');
    const idMap = {};
    for (const row of await jarr(ids, 'iss_obs_ids')) idMap[row.event_key] = row.id;
    const evRows = [];
    for (const r of issueRows) {
      const oid = idMap[r.observation.event_key];
      if (!oid) continue;
      for (const e of r.evidence) evRows.push({ observation_id: oid, ...e });
    }
    if (evRows.length) await postCheck('iss_ev_insert', await api('issue_observation_evidence?on_conflict=observation_id,evidence_key', {
      method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify(evRows),
    }));
  }

  /* 4. покриття */
  if (covRows.length) await postCheck('coverage_insert', await api('observation_coverage?on_conflict=snapshot_id,source_type', {
    method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify(covRows),
  }));
  return 'saved eq=' + eqSaved + ' ev=' + evSaved + ' issues=' + issueRows.length + ' cov=' + covRows.length + (stepErrs.length ? ' errs=' + stepErrs.join(',') : '');
}

/* ---------- 5. AI-розбір ---------- */
/* стиль фінального висновку: 'a' із прикладами міркувань власника (few-shot),
   'b' лише словесний опис стилю. Перемикається тілом запиту decision_style
   (для сліпого тесту) або env DECISION_STYLE; вибір фінального за власником */
const DECISION_RULES = `
"purchase_decision": ФІНАЛЬНИЙ ВИСНОВОК, окремий обʼєкт (verdict.summary заповнюй як раніше, він лишається):
- "recommendation": buy | go_see | negotiate | skip.
- "headline": РІШЕННЯ одним рядком, як жива порада ("Їхати дивитись, але спершу два питання продавцю").
- "summary_short": ЧОМУ: 3-4 речення головного зважування, МАКСИМУМ 400 символів, НЕ переказ headline.
- "reasoning": повне міркування, 2-4 абзаци, розділені порожнім рядком.
- "why_consider", "main_concerns", "must_check", "questions_for_seller": списки, відсортовані за важливістю: найдорожче за ціною помилки перше.
- "value_context": про ціну СЛОВАМИ, без вигаданих ринкових чисел.
- "missing_but_important": чого ми не перевірили і як людині це закрити.

ТОН REASONING: міркування досвідченого покупця-перекупника, який зважує все одразу: ціну проти ризиків, комплектацію проти віку, удар проти тяжкості. Чесні сумніви дозволені, але кожен сумнів закінчується дією ("не ясно з пробігом: питати сервісну історію"). Сміливість позиції обовʼязкова: при добрих фактах прямо "так, їхати дивитись" без страхувальної ковдри, при поганих прямо "я б шукав інше авто".
ЗАБОРОНЕНО в purchase_decision:
- канцелярит і переказ фактів без позиції;
- універсальні агрегатні списки в must_check: КОЖЕН пункт привʼязаний до знайденого факту або конкретної діри в даних ЦІЄЇ машини. Пункт, що пасує будь-якому авто цієї моделі, це брак;
- однакові кінцівки на кшталт "перевірити X, Y, Z на СТО";
- міркування, що не спираються на жоден здобутий CalCar факт: загальні знання про модель дозволені ЛИШЕ у звʼязці з фактами цього екземпляра (аукціонні фото, хронологія, розбіжності, покриття даних).
УЗГОДЖЕНІСТЬ: purchase_decision спирається на score_facts і зібрані факти, суперечити їм не можна: "історія чиста", коли джерела історії не підтверджені, це брак. recommendation мусить бути сумісним із загальною картиною ризиків звіту.
`;
const DECISION_FEWSHOT = `
ПРИКЛАДИ СТИЛЮ МІРКУВАННЯ (від власника продукту). Переймай СПОСІБ думати: зважування, чесні сумніви, прямоту. ЗМІСТ не копіюй: усі факти бери ЛИШЕ зі свого звіту по цьому авто. Мова прикладів не важлива, відповідай мовою користувача.
---
BMW 5 Series 2017
По фотографиям все нормально: внешне машина выглядит нормально, внутри тоже. Но машина не в М пакете , это большой минус, потому что многие эти модели переодевают в М пакет, и они выглядят намного лучше.
Большой плюс в том, что описание детальное, и можно понять состояние машины. И, конечно, большой плюс в том, что это официальная машина, поэтому цена достаточно оправдана. Каких-то минусов по этой машине я не вижу, но машина не вау, наверное, из-за внешнего вида. Но достаточно неплохой вариант, учитывая, что это официальная машина и она вроде как ухоженная. Ну и, конечно, плюс то, что достаточно хорошая комплектация у машины. То есть этой машине я бы поставил оценку, наверное, где-то 7.5 из 10. Почему не больше? Потому что машина всё-таки недешёвая, цена может быть ниже. Машина не переодета в М-пакет, хотя на рынке много вариантов с М-пакетом. Да, они, скорее всего, из США, но, тем не менее, за эту стоимость машина может выглядеть намного лучше.
Mercedes-Benz S-Class 2008
Эта машина стоит двадцать с чем-то тысяч долларов, хотя она 2008 года. И, конечно, эта цена сильно высокая для этой машины. Она должна стоить намного меньше.
Дальше владелец пишет, что он второй владелец, хотя по записям написано, что это четвертый владелец. Надо понять, почему так. То есть это уже есть несоответствие.
Вот здесь надо быть очень внимательным по пробегу. Машина достаточно старая, 2008 года, а первая запись о пробеге была в 2024 году, и там пробег был указан 144 тысячи километров. И это может быть неправдой, учитывая, что машина до этого ездила уже 16 лет. И за 16 лет 144 тысячи километров пробега , это очень-очень мало. То есть потенциально там должно быть больше.
Мы не знаем, правда это или неправда, но это стоит проверить. И, конечно, там пробег мог быть скрученным, учитывая количество лет. Но объем двигателя там не маленький, и, возможно, на этой машине мало ездили, потому что большой расход. Это как объяснение.
Например, если машина была бы 2 литра дизель 2008 года и было бы написано 144 тысячи пробега, то это почти наверняка, что пробег скручен. А здесь, учитывая, что большой объем двигателя, возможно, действительно на ней очень-очень мало ездили. Честно сказать, я не знаю, как правильно оценить этот автомобиль. Но этот автомобиль официальный, у него было небольшое количество владельцев: даже если четыре, это все равно немного за 18 лет езды.
Минус в том, что нет записей по пробегу за это время. Но возможно машина просто была в одних руках, и эти записи нигде не вносились, потому и нет откуда взяться.
Состояние вроде у машины по фотографиям неплохое. В целом цена тоже обычная, то есть не высокая и не низкая, поэтому я не знаю, как оценить эту машину. То есть прям каких-то косяков у нее нет, поэтому потенциально можно было бы поставить тоже в районе семи, просто потому что по ней ничего прям плохого не нашли.
Единственное, на что стоит еще обратить внимание: человек пишет, что он второй владелец, что это его личная машина, но на аккаунте у него в продаже еще две другие машины. Это значит, что он продает сразу три машины. Надо уточнять, действительно ли он владелец.
Maserati Quattroporte 2016
По Maserati у нее подозрительно низкая цена, учитывая, что это 16-й год и модель SQ4. То есть это не плохая модель, а хорошая, и у нее цена очень низкая. Надо смотреть, что с ней было. По фотографиям вроде всё неплохо. Пробег не сильно большой, нормальный для этого возраста. Два владельца с 19 года тоже нормально и последняя операция была в 23 году. По записям пробега я вижу расхождение. Это указано на Авториа: в 25-м году у нее было 139 тысяч пробега, а сейчас, спустя год больше даже, указано 136 тысяч километров пробега. Надо понять, почему так указано. Возможно, пробег был скручен. По фотографиям из США удар был не такой сильный: передний бампер отпал. Но, возможно, сбили человека или что-то типа этого , лобовое стекло треснуто, и стреляли все подушки.
Не знаю, минус это большой или не минус, но относительно удара он был не критичный, то есть абсолютно нормальный. Такую машину можно свободно брать.
Заменить все подушки, бампер, лобовое стекло , собственно, это, наверное, и сделали. То есть сказать, что это сильно большой минус по США, нельзя.
То есть этой машине я бы, наверное, поставил в районе пяти, потому что не ясно, что с пробегом и какие еще минусы.
В США все подушки стреляли. Плюс машина неликвидная. Не знаю, надо ли это учитывать. Два владельца за семь лет , это хорошо. И в целом не знаю, почему надо какие-то минусы ставить: не сильно на самом деле ясно.
Вроде по машине все хорошо, но как-то интуитивно хочется поставить 5,6 оценку. Но цена заманчивая, цена невысокая , 16 тысяч. Для SQ4 2016 года это хорошая цена. Да, такие машины сейчас тяжело продаются, но цена заманчивая. Возможно, из-за того, что цена низкая, можно было бы оценку выше поставить. Опять же, не ясно.
Мы учитываем это все в комплексе или нет? Учитываем ли мы цену за эту машину или нет? То есть если бы она стоила 28, конечно, я бы не ставил ей высокую оценку. Но цена 16, потому, возможно, на нее стоит обратить внимание. Скорее всего, цены тоже надо учитывать. Но чтобы учитывать цены, нам нужно понимать, какие цены на рынке есть в этой конкретной стране. Это достаточно тяжело.
Tesla Model Y 2023
У владельца нет никакого описания. Нет указания, какая конкретно это модель: 82 кВт, 78 кВт, Performance, Long Range. Он не указал этого ничего , это всё большой минус. Если человек хочет продать машину, он должен это всё указывать, а он этого всего не указал, так что ему за это большой минус. Если брать по машине, то 23 год и 21 тысяча километров пробега , это очень хорошо. И учитывая цену 21 тысяча долларов , это очень и очень хорошая цена. Очень хорошая.
Потому здесь из-за этого оценка должна идти выше, потому что маленький пробег, свежий возраст и очень заманчивая цена. Возможно, есть минусы и причины, почему такая цена. По фотографиям из США я вижу, что машина была ударена по бокам. Это неприятно и, скорее всего, значит, что машина была полностью крашена или менялись детали, но надо смотреть.
То есть это нелегкий удар: это удары в разных сторонах, стреляли подушки. Машина не тотал, можно восстановить, но смотря как.
Плюс на Авториа информации по этой машине не было: я скопировал VIN-код и первой ссылкой открыл на Битфакс, и там посмотрел фотографии. То есть опять же не ясно, как эту машину оценить. Вроде цена заманчивая, учитывая год и пробег, но она имеет причины, почему такая цена. Потому что в США она была ударена неплохо, но с другой стороны там не тотал, там ничего такого прям сильно серьезного силовых агрегатов не было повреждено, прям это больше внешние типа двери, бок и тому подобное.
Потому неясно, какую оценку здесь ставит. На самом деле учитывать стоимость и учитывать год и пробег или нет. Но я думаю, учитывая то, что нет описания владельца и никакой-то другой информации, учитывая, что машина только пригнана, возможно, в районе 4.5 или 5.
Tesla Model Y 2022
Машина 2022 года, перформанс и цена ее 22 тысячи. Это хорошая цена ниже рынка, учитывая перформанс и 2022 год. У машины небольшой пробег, но вот что настораживает. Второй владелец купил машину в июле этого же года, то есть месяц назад, и сейчас его продает. Вопрос, почему? Машина в США была затоплена. Неясно, насколько сильно она была затоплена. В общем не знаю, какую оценку здесь ставить.
Опять же цена ниже рынка, что указывает на то, что машину тяжело продать, потому что она была затоплена. Но все равно это не отменяет факт того, что машина была затоплена, даже учитывая хорошую стоимость. Потому я бы поставил машине оценку где-то 3.8. Это чисто интуитивно.
---
`;

const PROMPT = (l, nhtsa, auction, langDirective, decisionStyle, auctionMeta) => `Ти експертна система CalCar Check: незалежний розбір оголошення про продаж вживаного авто. Твоя робота: звірити те, що СТВЕРДЖУЄ продавець, із тим, що КАЖУТЬ дані і фото, і чесно відповісти, чи варто брати саме це авто.

${langDirective}

ФАКТИ, ВИТЯГНУТІ ЗІ СТОРІНКИ ОГОЛОШЕННЯ (детермінований парс):
${JSON.stringify({ title: l.title, vin: l.vin, plate: l.plate, price: l.price, currency: l.currency, odometer_km: l.odometer_km, year: l.year, history_facts: l.history_facts })}

ТЕКСТ СТОРІНКИ ОГОЛОШЕННЯ (опис продавця + офіційні блоки перевірки площадки, якщо є):
${l.text}

Декодування VIN від NHTSA: ${nhtsa ? JSON.stringify(nhtsa) : 'недоступне'}
${Array.isArray(l.listing_equipment) && l.listing_equipment.length ? 'СТРУКТУРОВАНІ ОПЦІЇ З ДАНИХ ОГОЛОШЕННЯ (source listing_data: структуровані поля площадки; це НЕ заводські дані і НЕ слова продавця): ' + JSON.stringify(l.listing_equipment) : ''}
${auction && auction.photos_sent ? `
ІСТОРИЧНІ ФОТО ПОШКОДЖЕНОГО СТАНУ ДОСТУПНІ (${auction.photos_sent} кадрів, зроблені ДО ремонту, коли авто продавали пошкодженим).${auction.text ? '\nТекст архіву аукціону:\n' + auction.text.slice(0, 2500) : ''}
ЦЕ НАЙЦІННІШЕ ДЖЕРЕЛО ЗВІТУ, і воно у тебе Є: писати "аукціонні фото недоступні" тепер прямо заборонено. Обовʼязково:
- по аукціонних фото визнач РЕАЛЬНИЙ обсяг пошкоджень: які деталі биті, чи зачеплені подушки, лонжерони, підвіска
- звір це з тим, як продавець описує пошкодження і ремонт: занижує, чесний чи перебільшує
- порівняй зону удару "до" з нинішніми фото "після": збіг відтінку, зазори, якість відновлення
- verdict тверджень продавця про пошкодження і ремонт тепер спирається на аукціонні фото, а не на "недоступно"

ІСТОРИЧНИЙ ВІЗУАЛЬНИЙ АНАЛІЗ ("historical_visual"): заповнюй ЛИШЕ коли історичні кадри реально передані. Оцінюй те, що РЕАЛЬНО видно САМЕ на цих кадрах, а не типовий сценарій ДТП:
- visible_damage_zones: зони з ВИДИМИМ пошкодженням.
- visible_severity за видимим обсягом: minor (косметика) | moderate (помітний удар, деформовані навісні елементи) | severe (очевидно тяжка деформація) | indeterminate.
- structural_visual_status: "no_obvious_severe_signs" означає ЛИШЕ "на доступних кадрах нема явних візуальних ознак тяжкої деформації силової структури" і НІКОЛИ не дорівнює "структура ціла". "visible_damage" лише при видимій деформації силових елементів. Ракурс не дозволяє судити: "indeterminate".
- srs_visual_status: "no_deployment_visible" означає лише "спрацювання не видно на доступних кадрах", НЕ "SRS справна". Салон у кадр не потрапив: "not_visible".
- summary: 2-3 речення про побачене, з розділенням "що видно" і "що лишається невідомим". evidence з ref auction_photo_N.
` : auction && (auction.blocked || (auction.photos || []).length) ? `Архів чи історичні матеріали існують, але кадри автоматично недоступні.
ЖОРСТКЕ ПРАВИЛО: технічну недоступність архіву чи фото НЕ згадуй НІДЕ у звіті, включно з auction.summary: ані "сервер не пустив", ані "не вдалося завантажити", ані "матеріали недоступні". Користувач бачить лише те, що знайдено; факт недоступності живе тільки в службових логах. auction.summary будуй з наявних фактів (запис про ДТП, дані площадки, слова продавця) без жодного речення про доступ. Роби висновки з того, що маєш: запис про ДТП у США сам по собі є фактом, і оцінювати треба ризик неякісного відновлення, а не відсутність фото.` : 'Архіву аукціону США у сторінці немає.'}

БЛОК ІСТОРІЇ ПОШКОДЖЕНЬ ("auction"): у звіті це розділ "Історія пошкоджень і фото з минулого", і він ГЛОБАЛЬНИЙ, не лише про США. "found": true СТАВ ЛИШЕ коли для авто реально знайдена подія, повʼязана з пошкодженням, ДТП чи відновленням (аукціон пошкоджених авто, запис про ДТП, історичні фото пошкодженого стану). Звичайна реєстраційна історія, зміна власників, минулі оголошення без пошкоджень та інші нейтральні історичні записи самі по собі цей блок НЕ створюють: тоді "found": false, "summary": null, "findings": порожній масив, і жодних текстів на кшталт "записів не знайдено" у summary. Американський контекст (США, IAAI, Copart) згадуй усередині блоку ЛИШЕ коли подія справді американська; для подій з інших країн називай їхнє джерело.

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

ТВЕРДЖЕННЯ ПРОДАВЦЯ перевіряй, але НЕ виводь окремим списком. Результат перевірки клади туди, де він доречний: суперечність із фактами = у discrepancies; заявлена опція = в equipment_v2 з рівнем seller чи seller_and_visual; твердження про обсяг ремонту після США = у auction.findings. Констатації "не вдалося перевірити" без цінності для рішення взагалі не пиши.

ШАПКА = ФАКТИ. Усі поля "vehicle" це короткі технічні факти без коментарів, застережень і слів про відсутні дані:
- "engine": "4.4 л бензин V8, 462 к.с." або "електро, 77 кВт·год". НІКОЛИ не пиши "довідково", "в декодуванні не вказано", "ймовірно". Невідоме = null, а не речення про невідомість.
- "mileage_note": ЛИШЕ заявлене число одним коротким рядком: "129 000 км". Уся аналітика пробігу (хронологія, розбіжності) живе в discrepancies та history, НЕ в шапці.

"photo_findings": ЛИШЕ про НИНІШНІ фото з оголошення (не аукціонні: для них є auction.findings). СПОЧАТКУ те, що РЕАЛЬНО ПОМІЧЕНО: різниця відтінку фарби, шагрень, нерівні зазори, свіжий герметик, нештатні деталі, знос салону проти пробігу. Кожна знахідка = окремий пункт зі status warn або bad. Якщо підозрілого нічого немає: ОДИН пункт "ok" ("на доступних фото явних слідів ремонту не видно") плюс МАКСИМУМ один пункт "unknown" із найважливішим обмеженням (наприклад, немає фото салону). ЗАБОРОНЕНО три пункти поспіль про те, чого не видно.

"risks": 2-5 КЛЮЧОВИХ РИЗИКІВ САМЕ ЦЬОГО ЕКЗЕМПЛЯРА, кожен спирається на КОНКРЕТНИЙ факт цієї машини: симптом, помилку системи, суперечність, результат діагностики, видимий дефект, зафіксовану подію (ДТП, аукціон, скрутка) з непідтвердженими наслідками. Вік, пробіг і відома болячка моделі САМІ ПО СОБІ недостатні для risks: типові задири, пневмопідвіска, роздавальна коробка, батарея гібрида тощо живуть у model_notes.issues, де можна позначити підвищену актуальність через вік чи пробіг цієї машини; у risks вони переходять ЛИШЕ за конкретного сигналу по цій машині. Пояснення "чому преміальне авто дешеве" (дорогий сервіс, витрати володіння) клади у purchase_decision.value_context, не в risks. Для авто після зафіксованого ДТП один із ризиків майже завжди якість відновлення: це конкретна подія цієї машини. Кожен ризик КОМПАКТНИЙ: title; level (high = висока ціна помилки, med, low); note МАКСИМУМ 2 речення (чому це головна стаття витрат саме тут, без есе); action одним рядком, що починається з переліку конкретних вузлів чи дій ("лонжерони, підрамник, SRS та ремені", а не загальне "діагностика на СТО").

ДИСЦИПЛІНА РИЗИКІВ: виконаний ремонт, обслуговування чи модифікація САМІ ПО СОБІ не є ризиком і НЕ створюють рекомендацію "перевірити", навіть для важливих вузлів. Ризик чи перевірка зʼявляються ЛИШЕ за конкретної підстави: симптом проблеми, знайдена суперечність, видимий дефект, помилка системи, свідчення неякісної чи незавершеної роботи, або серйозне минуле пошкодження з непідтвердженими наслідками. Це правило застосовується ОДНАКОВО до risks, must_check, questions_for_seller і checklist: виконаний ремонт чи модифікація без конкретного негативного сигналу НЕ створюють ані перевірку, ані питання продавцю. Зокрема рестайлінгові фари, вихлоп, проставки, CarPlay, замінена система охолодження без ознак проблеми і подібні зміни: це факти обслуговування і комплектації (history, equipment), про них не питають і їх не перевіряють, поки нема сигналу.

РОЗДІЛЕННЯ СУТНОСТЕЙ: "model_notes.issues" це ЛИШЕ типові болячки моделі, двигуна, коробки цієї версії. "risks" це ЛИШЕ про цей конкретний екземпляр. Заявлений продавцем ремонт НЕ створює новий запис ані в issues, ані в risks: якщо вузол є слабким місцем моделі і продавець заявляє, що він уже обслужений, постав у відповідному пункті issues поле "seller_serviced": true (інтерфейс покаже позначку "продавець заявляє, що вузол уже обслужений"), і це знижує актуальність ризику.

КОМПЛЕКТАЦІЯ ("equipment_v2"): максимально повне визначення ПІДТВЕРДЖУВАНОЇ комплектації. Філософія: краще пропустити одну опцію, ніж впевнено додати неіснуючу. Пайплайн усередині ЦЬОГО Ж аналізу, без окремих проходів:
1) ATTENTION MAP: спершу сформуй подумки коротку карту характерних для цієї марки, моделі, покоління, року і версії опцій та місць, де зазвичай видно їх ознаки (логотип на решітці динаміка, кнопки вентиляції на консолі, проектор HUD на торпедо, камери в дзеркалах і решітці радіатора, шторки, память сидінь). Карта каже, КУДИ дивитись; наявність опції в карті НЕ доказ її присутності; впевнені знахідки поза картою теж фіксуй.
2) ТЕКСТ ПРОДАВЦЯ: розбери, що заявлено, з нормалізацією народних назв (дистронік це адаптивний круїз, бурмістер це Burmester, панорама це панорамний дах, вебасто це автономний підігрів). Заява продавця це окреме джерело і НІЧОГО не підтверджує автоматично.
3) ВІЗУАЛЬНИЙ ПРОХІД по фото оголошення: кожне візуальне підтвердження ЗОБОВʼЯЗАНЕ мати evidence з конкретним кадром (ref photo_N) і конкретною ознакою (sign: "логотип Harman Kardon на решітці динаміка передніх дверей", "кнопки вентиляції на центральній консолі"). Без ознаки на кадрі опція візуально НЕ підтверджена.
- ДЖЕРЕЛА ОПЦІЙ (evidence source): vehicle_data (заводські/VIN-дані), current_photos (видно на фото), seller_claim (слова продавця), listing_data (структуровані поля оголошення площадки), historical. ОДНА опція з кількох джерел це ОДИН item з КІЛЬКОМА evidence, не дублікати. Рівень достовірності обчислює код із джерел; рівня "ймовірно" НЕ існує. Візуальне твердження без достатнього візуального evidence (кадр + ознака) візуальним не є; явно заявлена продавцем чи площадкою опція при цьому лишається зі своїм джерелом.
- listing_data це дані ПЛОЩАДКИ, НЕ заводське підтвердження: ніколи не перетворюй їх на "підтверджено по VIN". Опція одночасно в listing_data і на фото: обидва evidence в одному item.
- "value_tier": standard | notable | high_value для КОЖНОЇ опції, з урахуванням марки, моделі, покоління, року і версії. high_value це помітна upper-tier чи дорога опція саме для цієї моделі (Bowers & Wilkins на відповідній BMW може бути high_value). Це якісна класифікація, НЕ ціна: вартість і вплив на ціну авто не пиши. value_tier НЕ впливає на достовірність і джерела.
- ПОМИЛКА ІДЕНТИФІКАЦІЇ ГІРША ЗА ПРОПУСК: при сумніві в бренді чи пакеті пиши клас опції без бренда ("преміум-аудіо"); бренд лише при читабельному логотипі чи прямій ознаці.
- НАЗВА НЕ ШИРША ЗА ДОКАЗ: імʼя опції описує рівно те, що показує evidence, і не підтверджує заводське походження автоматично. Читабельне маркування бренду на решітці динаміка дає назву "Bowers & Wilkins" (аналогічно "Burmester", "Harman Kardon"), НЕ "преміальна аудіосистема Bowers & Wilkins" і НЕ "повна заводська система": обсяг і походження системи з маркування не випливають. Те саме для M/AMG/S line елементів, Laserlight та інших брендованих візуальних знахідок: називай видимий елемент. КНОПКИ ДОКАЗУЮТЬ КНОПКИ: для функцій, видимих лише органами керування, формулюй наявність органів керування ("кнопки вентиляції сидінь"), не працездатність функції. Заводське походження по зовнішньому вигляду НЕ стверджуй: "M Sport стилістика", не "заводський пакет M Sport".
- RETROFIT: retrofit true ЛИШЕ з конкретним vehicle-specific доказом ПІЗНІШОЇ установки, записаним у retrofit_basis: (а) продавець прямо каже, що елемент встановлений пізніше; (б) сервісний чи історичний запис підтверджує дообладнання; (в) візуальний доказ БЕЗПОСЕРЕДНЬО показує aftermarket-виконання чи сліди переробки (нештатні кріплення, кустарна проводка, невідповідні кузову зазори кріплень), а не просто незвичну для версії опцію. ЗАБОРОНЕНО ставити retrofit лише тому, що: опція здається незвичною чи "несумісною" з trim за твоїми знаннями; опції нема в listing_data; нема заводського build sheet; конфігурація здається малоймовірною. Заводські опціональні пакети існують (M Sport на BMW 530e, AMG Line, S line): незвичність це НЕ доказ. Не можеш довести пізнішу установку: retrofit false і factory_status unknown. Тон нейтральний, без оцінок і без "варто перевірити".
- ІСТОРИЧНІ ДЖЕРЕЛА (минулі оголошення, аукціонна картка з наявного контексту): це НЕ слова поточного продавця, рівень seller їм не давай. Опція лише з історичного джерела: historical_claim true, confidence_level null (зберігається в даних, не показується). Якщо поточні фото її підтверджують: рівень visual чи seller_and_visual за поточним оголошенням, historical_claim лиши true.
- "highlight": true у 5-8 найзначущіших для вибору опцій (преміум-аудіо, HUD, камери кругового огляду, вентиляція, пневмопідвіска, адаптивний круїз, панорама, значущі пакети). Клімат, електродзеркала, Bluetooth highlight не отримують.
- НЕ КОМПЛЕКТАЦІЯ: софтверні і конфігураційні стани опціями не є і в equipment_v2 не потрапляють: мова інтерфейсу мультимедіа, русифікація, активовані налаштування, версія прошивки, повний бак тощо.
- НЕ ПІДСИЛЮЙ ВИСНОВОК ПОНАД ДОКАЗ: видимий секундомір Sport Chrono дозволяє зафіксувати "обладнання Sport Chrono", але НЕ "заводський пакет Sport Chrono". Матеріали (Alcantara, шкіра наппа) називай точно ЛИШЕ за достатнім доказом (читабельне маркування або продавець вказав І видно на фото); інакше нейтральний опис обробки: "замшева обробка стелі", не "Alcantara".
- БАЗОВІ ХАРАКТЕРИСТИКИ авто, які вже показані в шапці звіту (двигун, тип силової установки, гібрид/електро, коробка, привід, версія), в equipment_v2 не дублюй: гібридна силова установка це шапка, не опція комплектації.
- ВІДСУТНІ опції не перелічуй. Надійність, вартість ремонту і рекомендації перевірок сюди не пиши: блок відповідає лише "що встановлено". Вигадувати заборонено, порожній масив дозволений.

"verdict.score": чесна оцінка пропозиції від 0 до 10 з одним знаком після коми. Якорі: 8.5+ чисте авто без питань за адекватною ціною; 7.0-8.4 добре, лишились дрібні перевірки; 5.5-6.9 брати можна лише після серйозних перевірок і торгу; 4.0-5.4 серйозні ризики чи ознаки обману; нижче 4 краще відмовитись. Не завищуй: знайдена брехня продавця чи приховане серйозне ДТП тягне оцінку вниз сильніше за все.

ЗАБОРОНА ПОВТОРІВ ПРО БРАК ДАНИХ: будь-яке обмеження джерел (немає фото аукціону, немає заказ-нарядів, немає build sheet) згадується у звіті МАКСИМУМ ОДИН РАЗ, у найдоречнішому місці. Повторювати ту саму думку в кількох розділах заборонено: це найгірший дефект звіту.

"data_notes": пиши мовою користувача продукту, без згадок про внутрішні механізми ("парс", "детермінований", "заголовок сторінки"). Просто: які дані площадки виглядають помилковими і чому ми їм не віримо.

"model_notes.issues": типові слабкі місця САМЕ ЦІЄЇ версії (марка + модель + рік + двигун + фактичний пробіг). 0-4 пункти. Кожен пункт мусить бути задокументованою особливістю саме цієї моделі і покоління; якщо речення без змін пасує іншому авто, викинь його. Тільки проблеми, актуальні при ЦЬОМУ пробігу. Якщо певного нічого немає, порожній масив. Без цін.

"score_facts": СЛУЖБОВА класифікація знахідок для коду, на текст звіту НЕ впливає, verdict.score і verdict.grade рахуй як раніше, незалежно від неї. Жорсткі правила класифікації:
- type СТРОГО з переліку. Підтверджені ризики: STRUCTURAL_DAMAGE, AIRBAGS_DEPLOYED, SRS_FAULT (поточна несправність SRS), FLOOD, FIRE, ODOMETER_ROLLBACK, VIN_IDENTITY_PROBLEM, SERIOUS_POWERTRAIN_FAULT, POOR_REPAIR_VISIBLE, CRITICAL_WARNING_LIGHTS. Відкриті питання: MILEAGE_CONFLICT_UNEXPLAINED, MAJOR_REPAIR_UNVERIFIED, MODIFICATION_TECHNICAL_CONCERN.
- Підтверджений ризик вимагає ПРЯМОГО доказу. Не підвищуй відкрите питання до підтвердженого ризику припущенням.
- ОДИНИЦІ ПРОБІГУ: перед будь-яким порівнянням пробігу (аукціон проти історії проти поточного оголошення) приведи значення до ОДНІЄЇ одиниці. Аукціонний одометр США зазвичай у милях (mi), українські оголошення у км: 1 mi = 1.609 km.
- MILEAGE_CONFLICT_UNEXPLAINED на основі АУКЦІОННОГО одометра дозволений ЛИШЕ коли ОДНОЧАСНО: одиниця аукціонної точки не unknown; її статус actual (не not_actual, не exempt, не unknown); аукціонна точка має надійну дату; порівнювана точка з історії чи оголошення теж має надійну дату; і ПІСЛЯ переведення одиниць пізніша точка справді нижча за ранішу. Якщо статус not_actual, exempt чи unknown, одиниця unknown, або дата хоч однієї точки ненадійна: конфлікт НЕ виставляй, збережи як інформаційний факт в info_notes із вихідним значенням і статусом.
- Різниця пробігів САМА ПО СОБІ це НЕ ODOMETER_ROLLBACK, а MILEAGE_CONFLICT_UNEXPLAINED. Тюнінг сам по собі НЕ MODIFICATION_TECHNICAL_CONCERN: потрібен конкретний технічний привід. Минуле ДТП саме по собі НЕ POOR_REPAIR_VISIBLE: потрібні видимі сліди поганого ремонту.
- ВІДСУТНІСТЬ ДАНИХ НІКОЛИ НЕ Є ЗНАХІДКОЮ. Unknown не добре і не погано.
- event_id ОБОВʼЯЗКОВИЙ для КОЖНОЇ знахідки, без нього код її відкине. Для подій це імʼя події (accident_2020, flood_2021), для поточних станів і несправностей стабільний ідентифікатор (current_srs_fault, mileage_conflict_1, modification_suspension). Знахідки ОДНОЇ події (одного ДТП) несуть СПІЛЬНИЙ event_id: подія з кількома підтвердженнями це ОДНА знахідка з кількома evidence, не кілька знахідок.
- repair_status де застосовно, МЕЖІ ЖОРСТКІ:
  * visually_consistent: пошкоджені на аукціоні зони на НИНІШНІХ фото без видимих слідів неякісного відновлення, І лише коли нинішні фото достатньо показують САМЕ ті зони і ракурси, що були пошкоджені. Потрібна зона не видна або порівняння ненадійне: лишається unknown, НЕ visually_consistent.
  * confirmed_bad: конкретні ВИДИМІ дефекти ремонту (зазори, відтінок, шагрень, герметик), назви їх в evidence.
  * confirmed_ok: ЛИШЕ обʼєктивні дані якості відновлення: незалежна інспекція чи діагностика, документований ремонт РАЗОМ із результатами перевірки. Сам факт рахунку чи документів на ремонт confirmed_ok НЕ дає. За одним візуальним порівнянням фото confirmed_ok ЗАБОРОНЕНИЙ.
  * unknown: усе інше. severity (low|med|high) де застосовно.
- АУКЦІОННІ МАТЕРІАЛИ (фото до ремонту, метадані лота) встановлюють ХАРАКТЕР і МАСШТАБ вихідного пошкодження. Розрізняй два різні висновки: "характер вихідного пошкодження встановлений" (це дають аукціонні фото) і "якість ремонту підтверджена" (цього вони НЕ дають). Висновки лише по конкретних зонах, які реально є на фото.
- Якщо MAJOR_REPAIR_UNVERIFIED існував лише через невідомість масштабу, а аукціонні матеріали ДОСТУПНІ і показують некрупне пошкодження (навісні елементи, подушки не спрацювали, силова структура не зачеплена): питання ЗНІМАЄТЬСЯ, крупного ремонту, ймовірно, не було, знахідку не створюй. НЕДОСТУПНІСТЬ матеріалів сама по собі ані знімає питання, ані створює знахідку. Якщо пошкодження крупне: порівняння зон до/після дає лише висновок про видимі ознаки, статус за межами вище.
- ОФІЦІЙНИЙ ЗАПИС ПРО ДТП (позначка "Був у ДТП", "Зафіксовано ДТП" у держ/історичному блоці, history_facts.accident_recorded) це ФАКТ із доказом (source historical_listing чи registry), НЕ "відсутність даних". Але MAJOR_REPAIR_UNVERIFIED НЕ ставиться через саме підтверджене ДТП невідомої тяжкості: потрібен ПОЗИТИВНИЙ доказ суттєвості (спрацьовані подушки, структурні пошкодження, кілька зон, серйозний опис damage у записі). НЕДОСТУПНІСТЬ фото чи матеріалів доказом суттєвості НЕ є. Відоме ДТП без доказів суттєвості: фіксуй в info_notes із точним текстом запису, на бал воно не впливає, АЛЕ purchase_decision мусить помітно його відпрацювати: у main_concerns або must_check із текстом запису і конкретною перевіркою.
- confirmed_ok для AIRBAGS_DEPLOYED лише зі ЗМІСТОВНИМ підтвердженням відновлення SRS: діагностика без помилок, документи ремонту РАЗОМ із перевіркою. "Нормальний салон на фото" це НЕ підтвердження SRS.
- РОЗБІЖНОСТІ ПРОДАВЦЯ (слова проти офіційних даних: "другий власник" при чотирьох тощо) живуть у discrepancies і в purchase_decision: матеріальна суперечність продавця йде ПЕРШИМ пунктом main_concerns і питанням у questions_for_seller. У score_facts їх НЕ класифікуй: самі по собі вони технічну чи історичну оцінку авто не погіршують.
- evidence: масив {source: seller_claim|current_photos|historical_listing|us_auction|registry|document, ref: конкретний запис (listing_3, photo_7, auction_event_1) де можливо, description: коротке доказове речення}. Одна знахідка може мати скільки завгодно доказів.
${auctionMeta && auctionMeta.status === 'found' ? `
METADATA EXACT-LOT (надійний historical, джерело ${auctionMeta.source || 'аукціон'}${auctionMeta.lot_id_meta ? ' лот ' + auctionMeta.lot_id_meta : ''}):${auctionMeta.airbags_meta ? '\n- Подушки за metadata лота: ' + JSON.stringify(auctionMeta.airbags_meta) : ''}${auctionMeta.primary_damage ? '\n- Primary damage: ' + auctionMeta.primary_damage : ''}${auctionMeta.secondary_damage ? '\n- Secondary damage: ' + auctionMeta.secondary_damage : ''}
- METADATA І VISION ДОПОВНЮЮТЬ ОДНЕ ОДНОГО. Якщо metadata exact-lot прямо каже, що подушки спрацювали (Airbag: Driver/Passenger/Side тощо), створи AIRBAGS_DEPLOYED з evidence source us_auction і ref auction_metadata (НЕ current_photos, НЕ фото). Не вимагай фотопідтвердження салону: надійний exact-lot historical metadata сам є позитивним доказом. Це НЕ inference з характеру удару, а прямий запис аукціону.
- Damage-зони з metadata (primary/secondary) бери як факт зони удару, навіть якщо кадр цієї зони у Vision відсутній.
` : ''}
- VISION ПО АУКЦІОННИХ ФОТО: зони пошкоджень, подушки та інші візуально визначувані факти з АУКЦІОННИХ кадрів фіксуй evidence із source us_auction і ref auction_photo_N (кадри нумеруються в порядку подачі). НЕ змішуй із current_photos: аукціонна сторінка пройшла перевірку точного VIN, її зображення успадковують звʼязок із цією подією; нинішні фото це лише current-state. Правила скромності діють і тут: салон на аукціонних кадрах не показаний, подушки unknown; зона не видна, unknown; "структура не видна" НЕ означає "структура ціла".
- СТРУКТУРА, межа висновків: по фото допустимо сказати "видимих слідів структурного пошкодження нема" (no_visible_structural_damage), але НЕ "структура ціла" чи "structure ok", якщо силові елементи не обстежені повністю. Для бокового удару невидимі пороги і стійки лишаються unknown, не "цілі".
- Для MODIFICATION_TECHNICAL_CONCERN додатково: serious_intervention true, якщо є хоч одне серйозне втручання (прошивка чи наддув, вихлоп із видаленням каталізаторів, інше втручання в силовий агрегат); maintenance_evidence true, лише якщо в матеріалах РЕАЛЬНО є підтвердження обслуговування чи діагностики (сервісні записи, логи, документи). Нема даних = false, не вигадуй.
- "signals": {"seller_claims_us_import": true лише при ЯВНІЙ заяві продавця про пригін зі США ("пригнана зі США", "авто з Америки"). Непевність = false}.
- Аукціонні маркування на фото (наліпки, штрих-коди Copart/IAAI, run-номер на лобовому) фіксуй ЛИШЕ спостереженням в info_notes. Тригером застосовності аукціону вони НЕ є і на стелю не впливають.
- info_notes: вільний текст без впливу на бал. Якщо знахідок нема, findings це порожній масив.

"verdict.grade": buy (брати, істотних проблем не знайдено), inspect (можна брати після конкретних перевірок), caution (є серйозні розбіжності, торг або обережність), avoid (знайдені факти прямо суперечать оголошенню або ризик надто високий). Оцінюй відносно ринку вживаних авто: сліди експлуатації це норма, а не привід для avoid. Але приховування фактів продавцем (знайдене ДТП при "без ДТП") завжди мінімум caution.

КОМПЛЕКТАЦІЯ В ТЕКСТАХ: згенерований текст НІКОЛИ не підвищує достовірність опцій понад їх джерела. visual не перетворюється на "заводську комплектацію" чи "підтверджено по VIN"; замість "багата підтверджена комплектація" при змішаних джерелах пиши чесно: "багате оснащення за фото і даними оголошення". Згадуючи конкретну ВАЖЛИВУ опцію, тримай рівень джерела: "Bowers & Wilkins видно на фото", "адаптивний круїз вказаний в оголошенні", "HUD вказаний в оголошенні і видно на фото". Біля звичайних опцій джерело підписувати не обовʼязково.

ІСТОРИЧНИЙ ВІЗУАЛ І РІШЕННЯ: purchase_decision ЗОБОВʼЯЗАНИЙ враховувати historical_visual РАЗОМ з фактами історії, поточними фото, заявами продавця, пробігом і болячками моделі, і РОЗРІЗНЯТИ три різні ситуації: (1) видимі ознаки тяжкого/структурного пошкодження; (2) явних тяжких структурних ознак на доступних кадрах НЕ видно; (3) прихована структура, геометрія і SRS лишаються неперевіреними. Друга і третя співіснують: тоді формулюй "на історичному фото видно помітний удар спереду; явних ознак тяжкої деформації силової структури чи зони салону на доступному ракурсі нема, але приховані елементи, геометрію і SRS за цим фото підтвердити не можна". НЕ пиши так, ніби тяжке пошкодження вже знайдене, якщо visual evidence його не показує; і НЕ називай удар мінімальним, якщо на кадрах видно суттєве пошкодження.

${DECISION_RULES}${decisionStyle === 'a' ? DECISION_FEWSHOT : ''}
Відповідай ЛИШЕ валідним JSON без markdown, точно за схемою:
{
 "vehicle": {"title":"Марка Модель Рік","year":2018,"fuel":"petrol|diesel|hybrid|electric","engine":"4.4 л бензин V8, 462 к.с. (або null)","transmission":"...","drive":"...","trim":"версія або null","mileage_note":"129 000 км"},
 "auction": {"found":true,"summary":"2-4 речення: що сталося з авто в США за архівом, реальний обсяг пошкоджень по фото, чи чесно продавець його описує","findings":[{"status":"ok|warn|bad|unknown","text":"порівняння до/після, 1 речення"}]},
 "historical_visual": {"visible_damage_zones":["капот","передній бампер"],"visible_severity":"minor|moderate|severe|indeterminate","structural_visual_status":"no_obvious_severe_signs|possible|visible_damage|indeterminate","srs_visual_status":"deployed_visible|no_deployment_visible|not_visible|indeterminate","summary":"2-3 речення: що реально видно і що лишається невідомим","evidence":[{"source":"us_auction","ref":"auction_photo_1","description":"зім'ятий капот"}]},
 "risks":[{"title":"назва ризику","level":"high|med|low","note":"1-2 речення: чому це головна стаття витрат чи ризику саме тут","action":"конкретна перевірка до покупки, 1 рядок"}],
 "equipment_v2":[{"name":"вентиляція передніх сидінь","category":"comfort|interior|multimedia|assist|exterior|performance","confidence_level":"vehicle_data|seller_and_visual|visual|seller, або null лише для суто історичної","highlight":false,"retrofit":false,"retrofit_basis":null,"historical_claim":false,"value_tier":"standard|notable|high_value","evidence":[{"source":"vehicle_data|current_photos|seller_claim|listing_data|historical","ref":"photo_7 чи vin_decode чи назва історичного джерела","sign":"конкретна ознака на кадрі чи коротка цитата джерела"}]}],
 "discrepancies":[{"severity":"high|med|low","title":"коротка назва розбіжності","detail":"2-3 речення: що стверджується, що знайдено, звідки","sources":["опис продавця","перевірка площадки","фото","VIN"]}],
 "history":[{"date":"MM.YYYY або YYYY","event":"1 рядок: подія з історії авто","gap":"тривалість від попередньої події ('2 роки 3 місяці') або null"}],
 "history_note":"1 рядок ЛИШЕ якщо патерн незвичний (наприклад 3 переоформлення за 5 місяців), без спекуляцій про причини; якщо історія звичайна: null",
 "photo_findings":[{"status":"ok|warn|bad|unknown","text":"знахідка по фото, 1 речення"}],
 "data_notes":"сміття чи суперечності в даних площадки, 1-2 речення, або null",
 "model_notes":{"issues":[{"unit":"вузол/двигун","title":"назва проблеми","detail":"1-2 речення","severity":"low|med|high","seller_serviced":false}]},
 "checklist":["конкретна перевірка при огляді, 1 рядок", "..."],
 "purchase_decision":{"recommendation":"buy|go_see|negotiate|skip","headline":"рішення одним рядком","summary_short":"чому: 3-4 речення, до 400 символів","reasoning":"повне міркування, 2-4 абзаци","why_consider":["..."],"main_concerns":["..."],"must_check":["..."],"questions_for_seller":["..."],"value_context":"про ціну словами","missing_but_important":["..."]},
 "score_facts":{"findings":[{"type":"STRUCTURAL_DAMAGE","event_id":"accident_2020","severity":"high","repair_status":"unknown","serious_intervention":false,"maintenance_evidence":false,"evidence":[{"source":"us_auction","ref":"auction_event_1","description":"на аукціонних фото деформований лівий лонжерон"}]}],"signals":{"seller_claims_us_import":false},"info_notes":["вільна замітка без впливу на бал"]},
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
    const decisionStyle = ['a', 'b'].includes(req.body?.decision_style)
      ? req.body.decision_style
      : (process.env.DECISION_STYLE === 'b' ? 'b' : 'a');
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
    listing.history_facts = extractHistoryFacts(listing.text);
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
          auctionSearch = { status: cached.status, reason: 'cache', source: cached.source || null, lot_url: cached.lot_url || null, cache: 'hit', sources_checked: Array.isArray(cached.record?.sources_checked) ? cached.record.sources_checked : [] };
          if (cached.status === 'found' && cached.lot_url) {
            auction = { url: cached.lot_url, photos: Array.isArray(cached.record?.photo_urls) ? cached.record.photo_urls.slice(0, 8) : [], text: '', from_search: true };
            auctionSearch.house = cached.record?.meta?.auction_house || null;
            auctionSearch.sale_date = cached.record?.meta?.sale_date || null;
            auctionSearch.lot_id_meta = cached.record?.meta?.lot_id || null;
            auctionSearch.airbags_meta = cached.record?.meta?.airbags || null;
            auctionSearch.primary_damage = cached.record?.meta?.primary_damage || null;
            auctionSearch.secondary_damage = cached.record?.meta?.secondary_damage || null;
            /* знайдена подія постійна і повторно не оплачується, але у VIN
               може зʼявитись НОВА аукціонна подія: discovery повторюємо і
               дивимось лише на кандидатів з ІНШИМИ сторінками */
            try {
              const disco = await discoverVinCandidates(listing.vin, { totalBudgetMs: 8000, nhtsa });
              const fresh = disco.candidates.filter(c => normalizeListingUrl(c.url) !== normalizeListingUrl(cached.lot_url));
              if (fresh.length) {
                console.log('[auction] новий кандидат поза кешем:', fresh[0].url.slice(0, 90));
                auctionSearch.new_candidates = fresh.map(c => c.url).slice(0, 3);
              }
            } catch (e) { /* повтор discovery не критичний */ }
          }
          console.log('[auction] cache=hit', cached.status, listing.vin);
        } else {
          const rec = await findAuctionRecord(listing.vin, nhtsa, { totalBudgetMs: 20000, nhtsa, zenrowsTimeoutMs: 55000 });
          auctionSearch = {
            status: rec.status, reason: rec.reason || null, source: rec.source || null,
            lot_url: rec.lot_url || null, total_ms: rec.total_ms, cache: 'miss',
            sources_checked: rec.sources_checked || [],
            identity: rec.identity ? { confidence: rec.identity.confidence, year_page: rec.identity.year_page, year_vin: rec.identity.year_vin } : null,
            sources: rec.diagnostics.map(d => ({ source: d.source, step: d.step, status: d.status, blocked: !!d.blocked, found: !!d.found, ms: d.ms })),
          };
          if (rec.status === 'found') {
            const passport = 'Джерело: архів аукціону' + (rec.meta?.auction_house ? ' ' + rec.meta.auction_house : '') + (rec.meta?.sale_date ? ', продаж ' + rec.meta.sale_date : '');
            auction = { url: rec.lot_url, photos: (rec.photo_urls || []).slice(0, 8), text: passport, from_search: true };
            auctionSearch.house = rec.meta?.auction_house || null;
            auctionSearch.sale_date = rec.meta?.sale_date || null;
            auctionSearch.paid = rec.paid || null;
            auctionSearch.odometer = rec.meta ? { value: rec.meta.odometer_value, unit: rec.meta.odometer_unit } : null;
            auctionSearch.lot_id_meta = rec.meta?.lot_id || null;
            auctionSearch.airbags_meta = rec.meta?.airbags || null;
            auctionSearch.primary_damage = rec.meta?.primary_damage || null;
            auctionSearch.secondary_damage = rec.meta?.secondary_damage || null;
            /* подія постійна за source+lot; vin-кеш лишається для сумісності */
            await writeAuctionEvent(listing.vin, rec);
            await writeAuctionCache(listing.vin, { status: 'found', source: rec.source, lot_url: rec.lot_url, record: { photo_urls: rec.photo_urls || [], identity: rec.identity, meta: rec.meta || null, sources_checked: rec.sources_checked || [] } });
          } else if (rec.status === 'absent') {
            await writeAuctionCache(listing.vin, { status: 'absent', source: null, lot_url: null, record: { sources_checked: rec.sources_checked || [] } });
          }
        }
      } catch (e) { console.log('[auction] пошук впав:', e.message); }
    }

    /* --- AI --- */
    const LANG_NAME = { ua: 'українською', ru: 'російською', en: 'англійською (English)' };
    const langDirective = 'МОВА ВІДПОВІДІ: усі текстові значення пиши ' + LANG_NAME[lang] + '. Ключі JSON та enum-значення (status, severity, verdict, grade, fuel) залишай латиницею точно за схемою.';

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

    const img = (u, detail) => ({ type: 'image_url', image_url: { url: u, detail } });
    /* ---- вибірка кадрів ----
       <=24 кадрів: усі, галерея переглянута повністю, без викликів.
       >24: ОДИН дешевий content-aware прохід low-detail по ВСІЙ галереї
       класифікує типи кадрів, детермінований pickDiverseFrames обирає до
       24 максимально різноманітних (задній ряд, багажник, торпедо,
       консоль і двері обовʼязково, без купи однакових екстерʼєрів) і
       роздає high-слоти найінформативнішим. Фейл чи таймаут: рівномірний
       fallback і чесний gallery_coverage_complete=false */
    let photoIdx, highSet, galleryCoverageComplete, photoSelectorMeta;
    if (listing.photos.length <= 24) {
      photoIdx = listing.photos.map((_, i) => i);
      highSet = new Set(pickEvenIndexes(photoIdx.length, 12));
      galleryCoverageComplete = true;
      photoSelectorMeta = { mode: 'all' };
    } else {
      try {
        const tSel = Date.now();
        const selContent = [{ type: 'text', text: 'Класифікуй кадри оголошення авто за типом. Відповідай ЛИШЕ валідним JSON {"frames":[{"i":1,"type":"front"}]} з записом для КОЖНОГО кадру. type СТРОГО з переліку: front | rear | side | dashboard | steering | center_console | doors | front_seats | rear_seats | roof | trunk | engine_bay | wheels | detail | other. i це число з підпису i=N перед кадром.' }];
        listing.photos.forEach((u, i) => { selContent.push({ type: 'text', text: 'i=' + (i + 1) + ':' }); selContent.push(img(u, 'low')); });
        const sr = await callModel(modelBody(selContent, false), 45000);
        const frames = JSON.parse((sr.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()).frames;
        if (!Array.isArray(frames) || !frames.length) throw new Error('selector: порожня класифікація');
        const types = new Array(listing.photos.length).fill('other');
        for (const fr of frames) {
          const i = parseInt(fr && fr.i, 10) - 1;
          if (i >= 0 && i < types.length && typeof fr.type === 'string') types[i] = fr.type;
        }
        const dv = pickDiverseFrames(types, 24, 12);
        photoIdx = dv.picked;
        highSet = new Set(photoIdx.map((gi, pos) => dv.high.has(gi) ? pos : -1).filter(p => p >= 0));
        galleryCoverageComplete = true;
        photoSelectorMeta = { mode: 'selector', ms: Date.now() - tSel, tokens: sr.usage || null, types: photoIdx.map(i => types[i]) };
        console.log('[photos] селектор:', listing.photos.length, '->', photoIdx.length, 'за', Date.now() - tSel, 'мс');
      } catch (e) {
        photoIdx = pickEvenIndexes(listing.photos.length, 24);
        highSet = new Set(pickEvenIndexes(photoIdx.length, 12));
        galleryCoverageComplete = false;
        photoSelectorMeta = { mode: 'even_fallback', error: String(e.message || e).slice(0, 80) };
        console.log('[photos] селектор впав, рівномірний fallback:', e.message);
      }
    }
    const photoUrls = photoIdx.map(i => listing.photos[i]);
    /* image-level provenance: у Vision ЛИШЕ кадри, чия належність exact lot
       доведена URL (VIN або lot_id). Generic-галерея (americamotors cs.copart
       без VIN) виключається: вона змішує різні авто. AmericaMotors лишається
       для discovery і metadata, але не для visual evidence */
    const auctionLotId = auctionSearch && auctionSearch.status === 'found'
      ? (auctionSearch.lot_id_meta || (auctionSearch.record && auctionSearch.record.meta && auctionSearch.record.meta.lot_id) || null)
      : null;
    /* у Vision: provenance-verified І публічно завантажувані. Фото за
       антиботом (bid.cars CDN mercury/pluto) провенанс проходять, але OpenAI
       їх не завантажить: у Vision вони не йдуть (інакше запит зависає на
       кожному недоступному кадрі). Такі кадри лишаються в record, а зони і
       подушки для них дає exact-lot metadata */
    const visionLoadable = u => !/mercury\.bid|pluto\.bid|bid\.cars|bidfax|poctra|cf-chl/i.test(String(u));
    /* ВИНЯТОК ПРОВЕНАНСУ (виправлення регресії 49c1b55): usa_photos,
       збережені САМОЮ площадкою у гілці /photos/auto/usa/ сторінки цього
       VIN, привʼязані до exact події платформою: це явна технічна
       привʼязка, VIN у імені файлу їм не потрібен. Generic-дзеркала
       (americamotors) як і раніше мусять мати VIN/lot у URL */
    const auctionPhotos = (auction?.photos || [])
      .filter(u => ((auction.from_ria && /riastatic\.com\/photos\/auto\/usa\//.test(u)) || photoHasProvenance(u, listing.vin, auctionLotId)) && visionLoadable(u))
      .slice(0, 8);
    if (auction) auction.photos_sent = auctionPhotos.length;
    if (auction && !auctionPhotos.length) {
      /* структуроване діагностичне повідомлення для Runtime Logs:
         без секретів, HTML і великих payload */
      console.log('[diag]', JSON.stringify({
        evt: 'history_photos_unavailable',
        source: (auctionSearch && auctionSearch.source) || (auction.from_ria ? 'ria_usa_photos' : auction.from_search ? 'auction_search' : 'external_archive'),
        step: 'display_photos',
        reason: (auction.photos || []).length ? 'provenance_or_unloadable' : 'no_photo_urls',
        vin: listing.vin || null,
      }));
    }
    const content = [
      { type: 'text', text: 'ФОТО З ОГОЛОШЕННЯ (стан зараз). Нумерація: photo_1..photo_' + photoUrls.length + ' у порядку подачі, на неї посилаються evidence ref. '
        + (galleryCoverageComplete
          ? 'Уся галерея оголошення переглянута (' + listing.photos.length + ' кадрів, передані найінформативніші): якщо якась зона (багажник, задній ряд, салон) відсутня серед кадрів, її справді нема в оголошенні, і про це можна казати прямо.'
          : 'УВАГА: переглянута лише ЧАСТИНА галереї (' + photoUrls.length + ' з ' + listing.photos.length + ' кадрів). ЗАБОРОНЕНО стверджувати, що якась зона (багажник, задній ряд, салон) "не показана" в оголошенні: відсутність серед переданих кадрів не означає відсутності в галереї.')
        + ' Якщо якийсь кадр очевидно належить ІНШОМУ авто (інша модель, інший колір, інший кузов), просто проігноруй його і не згадуй у звіті:' },
      ...photoUrls.map((u, i) => img(u, highSet.has(i) ? 'high' : 'low')),
      ...(auctionPhotos.length
        ? [{ type: 'text', text: 'ФОТО З АУКЦІОНУ США (до ремонту, архів). Нумерація: auction_photo_1..auction_photo_' + auctionPhotos.length + ' у порядку подачі:' }, ...auctionPhotos.map(u => img(u, 'high'))]
        : []),
      { type: 'text', text: PROMPT(listing, nhtsa, auction, langDirective, decisionStyle, auctionSearch) },
    ];

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
      '| snapshot', snapshot.status,
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
      const hf = listing.history_facts || {};
      const nhtsaMeaningful = !!(nhtsa && nhtsa.Make && (nhtsa.Model || nhtsa.ModelYear));
      const coverageInputs = {
        /* ідентичність не залежить від одного NHTSA: для євро-VIN достатньо,
           щоб достовірне джерело (держреєстр у блоці RIA показує марку,
           модель і рік саме за цим VIN) підтвердило авто. Порожній декод
           NHTSA сам по собі бал не занижує */
        identity_confirmed: nhtsaMeaningful || hf.registry_present === true,
        /* лише кількість унікальних кадрів, без AI-оцінки якості */
        photos_count: new Set(listing.photos.map(photoKey)).size,
        /* минулі оголошення: наш рів даних АБО історичний блок площадки */
        historical_listings_count: Math.max(snaps.length, hf.past_listings || 0),
        /* незалежні часові точки пробігу З МИНУЛОГО, без поточного оголошення:
           рів даних або зафіксовані площадкою минулі продажі і фіксації */
        mileage_observation_count: Math.max(
          snaps.filter(r => r.odometer_km != null).length,
          hf.past_mileage_points || 0
        ),
        /* запис аукціону існує, якщо він у нас (пошук/лістинг) АБО площадка
           сама цитує архівні дані офіційного аукціону */
        auction_record_exists: !!auction || hf.ria_auction_record === true,
        /* сигнал США: ЛИШЕ жорсткі тригери: позначка площадки "Пригнано з
           США", явна заява продавця (класифікація моделі або консервативний
           regex), північноамериканський VIN (WMI 1-5) на ринку України.
           Аукціонні маркування на фото це спостереження в info_notes і
           тригером ЯВНО не є */
        auction_us_signal: !!(
          hf.us_import_record === true
          || parsed?.score_facts?.signals?.seller_claims_us_import === true
          || /приг[а-яіїєґ]{0,12}\s+(?:з|зі|из)\s+США/i.test(listing.text || '')
          || (listing.vin && /^[1-5]/.test(listing.vin) && listing.country === 'UA')
        ),
        /* джерела реально відповіли і запису нема: у парі з сигналом дає
           absent. Заблокований доступ (source_unreachable) лишає unknown,
           стеля не чіпається, вини машини нема */
        auction_checked: !!(auctionSearch && auctionSearch.status === 'absent'),
        /* джерела намагались, але вся ланка недоступна: стан
           source_unreachable у coverage, причина стелі "джерела CalCar" */
        auction_sources_unreachable: !!(auctionSearch && auctionSearch.status === 'unknown' && auctionSearch.reason === 'source_unreachable'),
        /* мінімальний набір для видачі оцінки (eligibility gate) */
        basics_known: !!(listing.year && (listing.make || listing.model || listing.title)),
        mileage_known: listing.odometer_km != null,
        /* держдані: офіційний блок площадки з власниками й операціями */
        registration_data_exists: hf.registry_present === true,
        /* цих джерел у пайплайні поки немає: код чесно каже "не був" */
        service_history_exists: false,
        inspection_history_exists: false,
        seller_docs_exists: false,
      };
      const findings = Array.isArray(parsed?.score_facts?.findings) ? parsed.score_facts.findings : [];
      const breakdown = computeScore(findings, coverageInputs);
      /* економіка ретривала: ціна одного Check з аукціонним пошуком.
         Прямий fetch безкоштовний, платний провайдер підставить свою ціну */
      breakdown.retrieval_provider = auctionSearch ? (auctionSearch.cache === 'hit' ? 'cache' : 'direct_fetch') : null;
      breakdown.retrieval_requests = auctionSearch && Array.isArray(auctionSearch.sources) ? auctionSearch.sources.length : 0;
      breakdown.retrieval_cost_usd = 0;
      breakdown.retrieval_cache_hit = !!(auctionSearch && auctionSearch.cache === 'hit');
      breakdown.retrieval_zenrows = auctionSearch && auctionSearch.paid
        ? { reason: auctionSearch.paid.reason, calls: auctionSearch.paid.calls, credits: auctionSearch.paid.credits }
        : null;
      if (auctionSearch && auctionSearch.paid) breakdown.retrieval_provider = 'direct_fetch+zenrows';
      /* аудит опитування: дані для майбутнього блоку осей
         ("перевірено: ..., запис не знайдено") */
      breakdown.sources_checked = auctionSearch ? (auctionSearch.sources_checked || []) : null;
      /* підтверджене ДТП невідомої тяжкості: структурований факт для
         purchase_decision і майбутнього блоку осей, НЕ штраф */
      breakdown.accident_record_present = hf.accident_recorded === true;
      breakdown.accident_record_note = hf.accident_note || null;
      parsed.score_v2_preview = breakdown.score_available === false ? null : breakdown.final;
      parsed.score_breakdown_v2 = breakdown;
      console.log('[check] score_v2', breakdown.final, '(legacy', (parsed.verdict && parsed.verdict.score) + ')',
        '| cap', breakdown.coverage_cap, '| lim', breakdown.limiting_factors.join(',') || 'none');
    } catch (e) { console.log('[check] score_v2 failed:', e.message); }

    /* історичний візуал: валідація. Виник у ТОМУ Ж виклику, що й
       purchase_decision, тому рішення бачило кадри до формування */
    const hvClean = sanitizeHistoricalVisual(parsed.historical_visual, auctionPhotos.length);
    if (hvClean) parsed.historical_visual = hvClean;
    else delete parsed.historical_visual;

    const cleanDecision = sanitizePurchaseDecision(parsed.purchase_decision, parsed.score_v2_preview);
    if (cleanDecision) parsed.purchase_decision = cleanDecision;
    else delete parsed.purchase_decision;

    /* ---- комплектація: детермінована валідація + скептична перевірка ----
       Максимум ОДИН додатковий виклик, максимум 6 claims, лише важливі і
       брендові візуальні знахідки. Мета виклику: СПРОСТУВАТИ. Результат
       застосовує код за жорсткими правилами. Бюджет часу жорсткий:
       комплектація ніколи не стає причиною таймауту Check */
    let eqVerifier = { status: 'skipped', reason: 'no_claims' };
    try {
      parsed.equipment_v2 = sanitizeEquipment(parsed.equipment_v2, /(^|\.)auto\.ria\.com$/.test(listing.domain || '') ? 'autoria' : (listing.domain || null));
      const claims = selectEquipmentClaims(parsed.equipment_v2);
      const elapsedEq = Date.now() - t0;
      if (!claims.length) {
        eqVerifier = { status: 'skipped', reason: 'no_claims' };
      } else if (elapsedEq > 190000) {
        eqVerifier = { status: 'skipped', reason: 'time_budget', elapsed_ms: elapsedEq };
      } else {
        const tv = Date.now();
        const refIdx = r => { const m = /photo_(\d+)/.exec(String(r || '')); return m ? parseInt(m[1], 10) - 1 : -1; };
        const frames = [...new Set(claims
          .flatMap(c => c.evidence.filter(e => e.source === 'current_photos').map(e => refIdx(e.ref)))
          .filter(i => i >= 0 && i < photoUrls.length))].slice(0, 8);
        const vContent = [{
          type: 'text',
          text: 'Ти скептичний перевіряльник комплектації авто. Нижче кадри з тією ж нумерацією photo_N, що в основному аналізі, і візуальні заяви. Твоє завдання СПРОСТУВАТИ кожну: verdict confirmed ЛИШЕ якщо названа ознака справді чітко видима на названому кадрі; будь-який сумнів це not_confirmed. Відповідай ЛИШЕ валідним JSON {"verdicts":[{"name":"точна назва зі списку","verdict":"confirmed|not_confirmed"}]}.\nЗаяви:\n'
            + claims.map(c => '- ' + c.name + ' :: ' + c.evidence.filter(e => e.source === 'current_photos').map(e => (e.ref || '') + ', ' + (e.sign || '')).join('; ')).join('\n'),
        }];
        for (const i of frames) {
          vContent.push({ type: 'text', text: 'photo_' + (i + 1) + ':' });
          vContent.push(img(photoUrls[i], 'high'));
        }
        const vd = await callModel(modelBody(vContent, false), Math.max(15000, Math.min(50000, 280000 - (Date.now() - t0))));
        let verdicts = null;
        try { verdicts = JSON.parse((vd.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()).verdicts; } catch (e2) { /* невалідна відповідь: пропускаємо */ }
        if (Array.isArray(verdicts)) {
          const before = parsed.equipment_v2.length;
          parsed.equipment_v2 = applyEquipmentVerifier(parsed.equipment_v2, verdicts);
          eqVerifier = {
            status: 'done', checked: claims.length, frames: frames.length,
            not_confirmed: verdicts.filter(v => v && v.verdict === 'not_confirmed').length,
            removed: before - parsed.equipment_v2.length, ms: Date.now() - tv,
            tokens: vd.usage || null,
          };
        } else {
          eqVerifier = { status: 'skipped', reason: 'bad_response', ms: Date.now() - tv };
        }
      }
    } catch (e) {
      eqVerifier = { status: 'skipped', reason: 'error' };
      console.log('[equipment] верифікатор впав, пропущено:', e.message);
    }
    console.log('[equipment]', JSON.stringify({ items: (parsed.equipment_v2 || []).length, verifier: eqVerifier }));

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
      /* аудит вибірки кадрів для Vision: індекси галереї і high-слоти */
      photo_selection: { total: listing.photos.length, picked: photoIdx, high: photoIdx.filter((_, i) => highSet.has(i)), gallery_coverage_complete: galleryCoverageComplete, selector: photoSelectorMeta },
      seller_text: listing.seller_text || null,
      auction_url: listing.auction_url || null,
      auction_photos: auctionPhotos,
      auction_photos_provenance: auction && auctionPhotos.length
        ? (auction.from_ria ? 'autoria_history' : auction.from_search ? 'auction_search' : 'external_archive')
        : null,
      auction_search: auctionSearch,
      history_facts: listing.history_facts || null,
      /* паспорт джерела для інтерфейсу: без посилань назовні */
      auction_meta: auctionSearch && auctionSearch.status === 'found'
        ? { house: auctionSearch.house || null, date: auctionSearch.sale_date || null }
        : null,
      snapshot: snapshot.status,
      equipment_verifier: eqVerifier,
      analyzed_at: new Date().toISOString(),
    };
    /* шар знань: спостереження цього Check. Ніколи не ламає відповідь.
       Результат кроку йде в _meta.knowledge як діагностика */
    try {
      const kn = await writeKnowledge(parsed, listing, snapshot.id, parsed._meta);
      console.log('[knowledge]', kn);
      parsed._meta.knowledge = kn;
    } catch (e) {
      console.log('[knowledge] хук впав, Check не зачеплений:', e.message);
      parsed._meta.knowledge = 'hook_error: ' + String(e.message).slice(0, 120);
    }

    return res.status(200).json(parsed);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Аналіз не встиг завершитись. Спробуй ще раз, зазвичай з другої спроби швидше' });
    }
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
