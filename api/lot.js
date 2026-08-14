export const config = { maxDuration: 300 };

/* Ланцюг акторів: пробуємо по черзі, поки хтось не поверне лот із фото.
   Один зламаний актор більше не кладе весь продукт. Порядок = пріоритет:
   parseforge дає build sheet (комплектація), решта це резерв.
   Перевизначається змінними середовища COPART_ACTORS / IAAI_ACTORS через кому. */
const list = (env, def) => String(process.env[env] || '').split(',').map(s => s.trim()).filter(Boolean).concat(def)
  .filter((v, i, a) => a.indexOf(v) === i);

/* Порядок: перевірені за документацією актори, які приймають ПОСИЛАННЯ НА ЛОТ
   і тарифікуються за результат (не потребують місячної оренди).
   Актори з rental-підпискою сюди не додаються: вони віддадуть 403,
   поки підписку не оформлено вручну в консолі Apify. */
/* ПРИНЦИП ВИБОРУ ДЖЕРЕЛА:
   1) Дефолтні актори (найбільше користувачів, найбагатші дані) стоять першими:
      Copart = parseforge (єдиний віддає build sheet), IAAI = easyapi.
   2) Якщо дефолтний не відповів (помилка, пусто, чужий лот, без фото),
      сервіс мовчки бере наступний за списком, і так до кінця ланцюга.
   3) Актор, що впав з помилкою, пропускається наступну годину (кеш DOWN),
      щоб кожен користувач не чекав на мертве джерело. 402/403 = 6 годин.
   4) Успіх = лот із фотографіями САМЕ нашого номера лота, інакше далі.
   Порядок можна змінити без деплою: змінні COPART_ACTORS / IAAI_ACTORS на Vercel. */
const COPART_ACTORS = list('COPART_ACTORS', [
  'parseforge~copart-public-search-scraper',       /* ДЕФОЛТ: build sheet, 446 користувачів */
  'shahidirfan~copart-vehicle-auction-scraper',    /* резерв 1: пряме посилання на лот + галерея */
  'memo23~copart-scraper',                         /* резерв 2: 8 країн, повні фото, найдешевший */
  'prodiger~copart-public-search-scraper',         /* резерв 3: клон parseforge, pay-per-event */
]);
const IAAI_ACTORS = list('IAAI_ACTORS', [
  process.env.IAAI_ACTOR || 'easyapi~iaai-vehicle-detail-scraper',  /* ДЕФОЛТ: detailUrls, перевірено */
  'shahidirfan~IAAI-Vehicles-Scraper',             /* резерв: пошуковий URL або keyword */
]);

/* Актор, який щойно впав, не пробуємо повторно 10 хвилин: інакше кожен
   користувач чекає на той самий таймаут. Живе в пам'яті інстансу. */
const DOWN = new Map();
const DOWN_TTL = 60 * 60 * 1000;   /* година: мертвий актор не має гальмувати кожні 10 хвилин */
const isDown = a => { const e = DOWN.get(a); if (!e) return false; if (Date.now() - e.at > e.ttl) { DOWN.delete(a); return false; } return true; };
const markDown = (a, ttl) => DOWN.set(a, { at: Date.now(), ttl: ttl || DOWN_TTL });

/* ---- пріоритет фото за міткою Copart ---- */
const LABEL_PRIORITY = {
  DSFA: 1, PSFA: 2, DENT: 3, DSRA: 4, PSRA: 5,
  CKPT: 6, ODOM: 7, ENGN: 8, VINS: 9, DIRF: 10, DIRR: 11, PSRS: 12,
};

function pickImages(item, limit = 12) {
  const raw = item?.images_list_raw?.IMAGE;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map(im => ({
        url: im.highResUrl || im.fullUrl || im.thumbnailUrl,
        med: im.fullUrl || im.highResUrl || im.thumbnailUrl,
        label: im.imageLabelCode || '',
        seq: im.imageSeqNumber || 999,
      }))
      .filter(x => x.url)
      .sort((a, b) => (LABEL_PRIORITY[a.label] || 50 + a.seq) - (LABEL_PRIORITY[b.label] || 50 + b.seq))
      .slice(0, limit);
  }
  const arr = item?.images_high_res || item?.images_full || item?.images || [];
  return arr.slice(0, limit).map((url, i) => ({ url, label: '', seq: i }));
}

/* ---- витяг комплектації з build sheet ---- */
const EQUIP_RE = /(LED|Heated|Ventilated|Camera|Moonroof|Sunroof|Navigation|Leather|Blind Spot|Adaptive|Cruise|Premium|Audio|Wheels:|Tires:|Battery|Climate|Memory|Power Liftgate|Tow|Third Row|Keyless|Parking|Lane|Collision)/i;

function extractEquipment(bs) {
  const out = [];
  const std = bs?.equipment?.standard;
  if (std) {
    for (const group of Object.values(std)) {
      if (!Array.isArray(group)) continue;
      for (const e of group) {
        const d = e?.description;
        if (d && EQUIP_RE.test(d) && d.length < 90) out.push(d);
      }
    }
  }
  return [...new Set(out)].slice(0, 14);
}

function extractBatteryKwh(bs) {
  const std = bs?.equipment?.standard;
  if (!std) return null;
  for (const group of Object.values(std)) {
    if (!Array.isArray(group)) continue;
    for (const e of group) {
      const m = /([\d.]+)\s*kWh\s*Capacity/i.exec(e?.description || '');
      if (m) return parseFloat(m[1]);
    }
  }
  return null;
}

function detectFuel(bs, item) {
  const eng = bs?.engines?.[0];
  const type = ((eng?.engineType || '') + ' ' + (eng?.fuel?.description || '')).toLowerCase();
  const model = ((item?.make || '') + ' ' + (item?.full_model_name || '')).toLowerCase();
  if (/electric/.test(type) && !/gas|petrol/.test(type)) return 'electric';
  if (/hybrid/.test(type) || /hybrid/.test(model)) return 'hybrid';
  if (/diesel/.test(type)) return 'diesel';
  if (/tesla|rivian|lucid|ioniq|bolt|leaf|mach-e/.test(model)) return 'electric';
  return 'petrol';
}

function normalize(item) {
  const bs = item.build_sheet || {};
  const style = bs.styles?.[0] || {};
  const eng = bs.engines?.[0] || {};
  const spec = bs.technicalSpecification || {};
  const disp = parseFloat(spec.displacement) || null;
  const fuel = detectFuel(bs, item);
  const vinMasked = typeof item.vin === 'string' && item.vin.includes('*');

  const engineParts = [];
  if (disp) engineParts.push(disp + ' л');
  if (eng.engineType) engineParts.push(eng.engineType);
  if (eng.netHorsePower) engineParts.push(String(eng.netHorsePower).replace(/\s*@.*$/, '') + ' к.с.');

  return {
    source: 'copart',
    lot_number: String(item.lot_number || ''),
    lot_url: item.item_url || null,
    vin: item.vin || null,
    vin_masked: vinMasked,
    year: item.year || null,
    make: item.make || null,
    model: item.full_model_name || style.modelName || null,
    trim: style.trim || style.name || null,
    title: [item.year, item.make, item.full_model_name, style.trim].filter(Boolean).join(' '),
    fuel,
    displacement_l: disp,
    battery_kwh: fuel === 'electric' ? extractBatteryKwh(bs) : null,
    engine: engineParts.join(', ') || null,
    transmission: spec.transmissionDescription || item.transmission_description || null,
    drive: spec.drivetrain || style.driveTrain || null,
    body: spec.bodyStyle || null,
    equipment: extractEquipment(bs),
    odometer_mi: item.odometer_reading ?? null,
    odometer_status: item.odometer_status || null,
    primary_damage: item.primary_damage || null,
    secondary_damage: item.secondary_damage || null,
    title_code: item.title_code || null,
    title_group: item.title_group_description || null,
    title_state: item.title_state || null,
    keys: item.keys || null,
    airbags: null,
    run_and_drive: item.run_and_drive ?? null,
    location_state: item.location_state || null,
    location_city: item.location_city || null,
    sale_location: item.sale_location || null,
    current_bid: item.current_bid ?? null,
    buy_it_now: item.buy_it_now_price || null,
    est_retail_value: item.estimated_retail_value || null,
    acv: item.lot_plug_acv || null,
    images: pickImages(item),
  };
}


/* ================= універсальний розбір (IAAI та інші) ================= */
const IMG_RE = /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp)(?:\?[^\s"']*)?$/i;
const IMG_HOST_RE = /(iaai|copart|vis\.|image|photo|media|cdn)/i;
const IMG_JUNK_RE = /(logo|icon|sprite|placeholder|avatar|badge|banner|watermark|\.svg|\.gif)/i;

function deepCollect(obj, out = { images: new Set(), flat: {} }, path = '') {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === 'string') {
    const looksImg = IMG_RE.test(obj) ||
      (/^https?:\/\//.test(obj) && IMG_HOST_RE.test(obj) && /image|photo|resizer|imagekeys/i.test(obj));
    if (looksImg && !IMG_JUNK_RE.test(obj)) out.images.add(obj);
    return out;
  }
  if (typeof obj !== 'object') return out;
  if (Array.isArray(obj)) { obj.forEach(v => deepCollect(v, out, path)); return out; }
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      if (!(key in out.flat)) out.flat[key] = v;
    }
    deepCollect(v, out, path + '.' + k);
  }
  return out;
}

function pick(flat, aliases) {
  for (const a of aliases) {
    const k = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (flat[k] !== undefined && flat[k] !== '' && flat[k] !== null) return flat[k];
  }
  return null;
}

/* IAAI віддає картинки через resizer з параметром ширини — піднімаємо до максимуму */
function upscaleUrl(u) {
  return String(u)
    .replace(/([?&](?:width|w))=(\d+)/gi, (m, p, n) => Number(n) < 2000 ? p + '=2400' : m)
    .replace(/([?&](?:height|h))=(\d+)/gi, (m, p, n) => Number(n) < 1500 ? p + '=1800' : m);
}

function extractImageObjects(item) {
  const found = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const u = o.hdUrl || o.highResUrl || o.fullUrl || o.hd_url || o.largeUrl || o.imageUrl
      || (o.thumbUrl && !o.hdUrl ? o.thumbUrl : null);
    if (typeof u === 'string' && /^https?:/.test(u)
        && /iaai|copart|image|photo|resizer|retriever|imagekeys/i.test(u)
        && !IMG_JUNK_RE.test(u)) {
      found.push(u);
      return;
    }
    Object.values(o).forEach(walk);
  })(item);
  return found;
}

function dedupeImages(urls) {
  /* Той самий кадр приходить у кількох розмірах: ..._thb.jpg (мініатюра),
     ..._ful.jpg, ..._hrs.jpg. Ключ = імʼя файлу без суфікса розміру, і з
     дублікатів лишається найбільша версія, мініатюра ніколи не витісняє повну. */
  const RANK = { thb: 0, thumb: 0, sml: 1, med: 2, ful: 3, full: 3, hrs: 4, hd: 4 };
  const parse = u => {
    const mk = /imageKeys=([^&]+)/i.exec(u);
    const mf = /\/([^\/?#]+?)(?:_(thb|thumb|sml|med|ful|full|hrs|hd))?\.(?:jpe?g|png|webp)/i.exec(u);
    return {
      key: mk ? mk[1] : (mf ? mf[1] : u),
      rank: mf && mf[2] ? (RANK[mf[2].toLowerCase()] ?? 2) : 2,
    };
  };
  const best = new Map();   /* key -> {u, rank, order} */
  urls.forEach((u, i) => {
    const { key, rank } = parse(u);
    const cur = best.get(key);
    if (!cur || rank > cur.rank) best.set(key, { u, rank, order: cur ? cur.order : i });
  });
  return [...best.values()].sort((a, b) => a.order - b.order).map(x => x.u);
}

function normalizeGeneric(item, source) {
  const { images, flat } = deepCollect(item);
  const num = v => { const n = parseFloat(String(v).replace(/[^\d.]/g, '')); return isNaN(n) ? null : n; };

  const year = num(pick(flat, ['year', 'modelYear', 'vehicleYear', 'lotYear']));
  const make = pick(flat, ['make', 'manufacturer', 'brand', 'vehicleMake', 'lotMakeDesc']);
  const model = pick(flat, ['model', 'modelName', 'vehicleModel', 'series', 'lotModelDesc']);
  const trim = pick(flat, ['trim', 'trimLevel', 'styleName', 'series', 'seriesDetail']);
  const fuelRaw = String(pick(flat, ['fuelType', 'fuel', 'engineFuel', 'fuelTypePrimary']) || '').toLowerCase();
  const fuel = /electric|^ev$/.test(fuelRaw) ? 'electric'
    : /hybrid/.test(fuelRaw) ? 'hybrid'
    : /diesel/.test(fuelRaw) ? 'diesel'
    : /tesla|rivian|lucid/i.test(String(make || '')) ? 'electric' : 'petrol';

  /* об'єднуємо обидва збирачі: структурні hd-поля мають пріоритет,
     deep-скан додає те, чого структурний прохід не побачив */
  const imgs = dedupeImages([...extractImageObjects(item), ...images]).map(upscaleUrl);

  return {
    source,
    lot_number: String(pick(flat, ['lotNumber', 'stockNumber', 'itemNumber', 'lotId', 'stock']) || ''),
    lot_url: pick(flat, ['itemUrl', 'url', 'lotUrl', 'link', 'vehicleUrl']),
    vin: (() => {
      const raw = String(pick(flat, ['vin', 'vinNumber', 'vinStatus', 'fullVin', 'maskedVIN']) || '');
      const m = /[A-HJ-NPR-Z0-9*]{11,17}/i.exec(raw.replace(/\s/g, ''));
      return m ? m[0].toUpperCase() : null;
    })(),
    vin_masked: /\*/.test(String(pick(flat, ['vin', 'vinNumber', 'vinStatus', 'fullVin', 'maskedVIN']) || '')),
    year, make, model, trim,
    title: [year, make, model, trim].filter(Boolean).join(' ') || 'Авто',
    fuel,
    displacement_l: num(pick(flat, ['displacement', 'engineSize', 'engineDisplacement'])),
    battery_kwh: null,
    engine: pick(flat, ['engine', 'engineType', 'engineDescription', 'motor']),
    transmission: pick(flat, ['transmission', 'transmissionType', 'transmissionDescription']),
    drive: pick(flat, ['driveLineType', 'drivetrain', 'driveType', 'drive']),
    body: pick(flat, ['bodyStyle', 'bodyType', 'vehicleType']),
    equipment: [],
    odometer_mi: num(pick(flat, ['odometer', 'odometerReading', 'mileage', 'miles'])),
    odometer_status: pick(flat, ['odometerStatus', 'odometerBrand']),
    primary_damage: pick(flat, ['primaryDamage', 'damage', 'lossType', 'primaryDamageType']),
    secondary_damage: pick(flat, ['secondaryDamage', 'secondaryDamageType', 'secDamage']),
    title_code: pick(flat, ['titleCode', 'titleSaleDoc', 'documentType', 'titleType', 'titleDescription', 'saleDocument', 'saleDoc']),
    title_group: pick(flat, ['titleGroup', 'titleGroupDescription', 'saleDocType']),
    title_state: pick(flat, ['titleState', 'documentState']),
    keys: (() => {
      const k = pick(flat, ['keys', 'key', 'hasKeys', 'keyStatus', 'keyFob']);
      if (k === true) return 'YES';
      if (k === false) return 'NO';
      const s = String(k || '');
      if (/not\s*present|\bno\b|missing/i.test(s)) return 'NO';
      if (/present|yes/i.test(s)) return 'YES';
      return k;
    })(),
    run_and_drive: (() => {
      const r = pick(flat, ['runAndDrive', 'runsAndDrives', 'startCode', 'runCondition']);
      if (typeof r === 'boolean') return r;
      if (typeof r === 'string') return /run|start|yes/i.test(r) ? true : /no|stationary/i.test(r) ? false : null;
      return null;
    })(),
    location_state: (() => {
      const s = pick(flat, ['locationState', 'state', 'branchState']);
      if (typeof s === 'string' && /^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
      const loc = String(pick(flat, ['saleLocation', 'branch', 'location', 'branchName']) || '');
      const m = /\b([A-Z]{2})\b/.exec(loc);
      return m ? m[1] : null;
    })(),
    airbags: pick(flat, ['airbags', 'airbagStatus', 'airbag']),
    location_city: pick(flat, ['locationCity', 'city']),
    sale_location: pick(flat, ['saleLocation', 'branch', 'location', 'branchName']),
    current_bid: num(pick(flat, ['currentBid', 'highBid', 'bidAmount'])),
    buy_it_now: num(pick(flat, ['buyItNowPrice', 'buyNowPrice'])),
    est_retail_value: num(pick(flat, ['estimatedRetailValue', 'estRetailValue', 'acv', 'actualCashValue', 'retailValue'])),
    acv: num(pick(flat, ['acv', 'actualCashValue'])),
    images: imgs.slice(0, 16).map((url, i) => ({
      url,
      med: String(url)
        .replace(/([?&](?:width|w))=(\d+)/gi, '$1=1600')
        .replace(/([?&](?:height|h))=(\d+)/gi, '$1=1200'),
      label: '', seq: i,
    })),
  };
}

/* ---- будуємо вхід з прикладу самого актора ---- */
async function buildInputFromExample(actor, url, token) {
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}?token=${token}`);
    if (!r.ok) return null;
    const body = (await r.json())?.data?.exampleRunInput?.body;
    if (!body) return null;
    const ex = JSON.parse(body);
    let placed = false;
    for (const [k, v] of Object.entries(ex)) {
      if (typeof v === 'string' && /^https?:/.test(v)) { ex[k] = url; placed = true; }
      else if (Array.isArray(v) && v.length && typeof v[0] === 'string' && /^https?:/.test(v[0])) { ex[k] = [url]; placed = true; }
      else if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && typeof v[0].url === 'string') { ex[k] = [{ url }]; placed = true; }
      else if (!placed && /url|link/i.test(k) && typeof v === 'string') { ex[k] = url; placed = true; }
      if (/^(maxItems|maxResults|limit|resultsLimit)$/i.test(k)) ex[k] = 1;
    }
    return placed ? ex : null;
  } catch (e) { return null; }
}

/* ---- запуск актора: перебираємо схеми входу, успіх = лот із ФОТО.
   Актор може мовчки прийняти неправильне поле і повернути пустишку,
   тому "щось повернулось" не вважається успіхом. Ім'я обов'язкового
   поля читаємо з помилки Apify. ---- */
async function runActor(actor, inputs, token, url, toLot) {
  const attempts = [];
  /* останній резерв для цього актора: схема входу з його ж прикладу */
  let exampleTried = false;
  let bestNoPhoto = null;
  let paidRuns = 0;
  const MAX_PAID_RUNS = 2;
  const triedFields = new Set(inputs.flatMap(i => Object.keys(i)));
  const label = input => Object.keys(input).filter(k => !/^(max|proxy)/i.test(k)).join('+')
    + (input.proxyConfiguration ? '+proxy' : '');
  for (const input of inputs) {
    if (paidRuns >= MAX_PAID_RUNS) break;
    try {
      const r = await fetch(
        `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=120`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
      if (!r.ok) {
        const body = (await r.text()).slice(0, 300);
        attempts.push(label(input) + ': HTTP ' + r.status);
        if (!exampleTried) {
          exampleTried = true;
          const ex = await buildInputFromExample(actor, url, token);
          if (ex) inputs.push(ex);
        }
        const m = /input\.(\w+)(?:\s+is required|.*?must)/i.exec(body);
        if (m && url && !triedFields.has(m[1])) {
          triedFields.add(m[1]);
          /* помилки валідації безкоштовні: актор ще не запускався */
          inputs.push({ [m[1]]: [url], maxItems: 1 });
          inputs.push({ [m[1]]: url, maxItems: 1 });
          inputs.push({ [m[1]]: [{ url }], maxItems: 1 });
        }
        continue;
      }
      const items = await r.json();
      paidRuns += 1; /* успішний запуск актора вже оплачений, навіть якщо результат нам не підходить */
      if (!Array.isArray(items) || !items.length) { attempts.push(label(input) + ': порожньо'); continue; }
      const lot = toLot(items[0]);
      if (lot && lot.images.length) return lot;
      bestNoPhoto = bestNoPhoto || lot;
      attempts.push(label(input) + (lot === null ? ': чужий лот' : ': без фото'));
    } catch (e) {
      attempts.push(label(input) + ': ' + String(e.message).slice(0, 60));
    }
  }
  const err = new Error(attempts.join(' · '));
  err.noPhotoLot = bestNoPhoto;
  throw err;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.APIFY_TOKEN) {
    return res.status(500).json({ error: 'APIFY_TOKEN не налаштований у Vercel' });
  }

  try {
    const q = String((req.body || {}).query || '').trim();
    if (!q) return res.status(400).json({ error: 'Вкажи посилання на лот або номер лота' });

    const cleaned = q.replace(/\s/g, '');
    const digits = cleaned.replace(/\D/g, '');
    const isIaai = /iaai\.com/i.test(cleaned);
    const isCopart = /copart\.com/i.test(cleaned);

    let url;
    if (isIaai || isCopart) url = cleaned.split('?')[0];
    else if (digits.length >= 7 && digits.length <= 9) url = 'https://www.copart.com/lot/' + digits;
    else return res.status(400).json({ error: 'Встав посилання на лот Copart чи IAAI' });

    /* Точні поля входу, підтверджені реальними запусками:
       - IAAI (easyapi): робоче поле detailUrls (масив рядків), startUrls актор ігнорує
         і скрапить свій демо-лот із дефолтів схеми. Канонічний формат посилання має суфікс ~US.
       - Copart (parseforge): startUrl.
       Актор IAAI платний за результат (~$0.19/лот), тому НІЯКОГО перебору:
       рівно один платний запуск на запит. */
    let iaaiUrl = url;
    if (isIaai) {
      iaaiUrl = url.replace(/\/VehicleDetail\/(\d+)(?![\d~])/i, '/VehicleDetail/$1~US');
    }
    const lotNo = (/\/lot\/(\d+)/i.exec(url) || /(?:^|[^\d])(\d{8})(?!\d)/.exec(url) || [])[1] || null;

    /* Кожен актор має свою схему входу. Ключ це ім'я актора, значення це
       список варіантів у порядку ймовірності. Невідомий актор отримує
       узагальнений набір полів. */
    const stockNo = isIaai ? ((/VehicleDetail\/(\d+)/i.exec(url) || [])[1] || null) : null;
    /* ТАБЛИЦЯ СХЕМ ВХОДУ: у кожного актора свій формат, перевірений за його документацією.
       Невідомий актор отримує загальні варіанти + схему з його ж прикладу (в runActor). */
    const inputsFor = (actor, u) => {
      if (isIaai) {
        /* easyapi: пряме посилання на картку лота в detailUrls (перевірено реальними запусками) */
        if (/easyapi/.test(actor)) return [{ detailUrls: [u], maxItems: 1 }];
        /* shahidirfan IAAI: працює від пошукового URL або keyword, картку лота не приймає */
        if (/shahidirfan/i.test(actor)) return [
          stockNo ? { startUrls: [{ url: 'https://www.iaai.com/Search?Keyword=' + stockNo }], results_wanted: 1, max_pages: 1 } : null,
          stockNo ? { keyword: stockNo, results_wanted: 1, max_pages: 1 } : null,
        ].filter(Boolean);
        return [{ detailUrls: [u], maxItems: 1 }, { startUrls: [{ url: u }], maxItems: 1 }];
      }
      /* parseforge: startUrl (пряме посилання на лот), searchUrl як запасний.
         prodiger: клон parseforge (його інші актори заявлені input-сумісними з оригіналами),
         тому та сама схема. */
      if (/parseforge|prodiger/.test(actor)) return [
        { startUrl: u, maxItems: 1 },
        { searchUrl: u, maxItems: 1 },
      ];
      /* shahidirfan Copart: startUrls приймає і пряме посилання на лот, і пошукове.
         include_gallery_images обов'язково true, інакше віддасть лише мініатюру. */
      if (/shahidirfan/i.test(actor)) return [
        { startUrls: [{ url: u }], results_wanted: 1, max_pages: 1, include_gallery_images: true },
      ];
      /* memo23: ВИКЛЮЧНО lotSearchResults-посилання (рядками, не об'єктами),
         пряме посилання на лот відкидає. Шукаємо за номером лота. */
      if (/memo23/.test(actor)) {
        return lotNo
          ? [{ startUrls: ['https://www.copart.com/lotSearchResults/?free=true&query=' + lotNo], maxItems: 1 }]
          : [];
      }
      return [
        { startUrls: [{ url: u }], maxItems: 1 },
        { startUrl: u, maxItems: 1 },
        { queries: [u], maxItems: 1 },
      ];
    };

    /* захист від підміни: якщо актор повернув інший лот (свій демо-приклад тощо),
       це відмова, а не матеріал для аналізу */
    /* Актори з пошуковим входом при невдалому запиті повертають СВІЙ дефолтний
       результат (browse-all чи демо-лот). Тому звіряємо номер лота: якщо у відповіді
       його немає, це чужа машина, а не наш лот. */
    const reqId = isIaai ? (/VehicleDetail\/(\d+)/i.exec(url) || [])[1] : lotNo;
    /* Резервні актори повертають іншу структуру, ніж parseforge, тому:
       спершу профільний парсер, а якщо він не дав фото, узагальнений глибокий скан. */
    const toLot = item => {
      try {
        if (reqId && !JSON.stringify(item).includes(reqId)) return null;
        if (isIaai) return normalizeGeneric(item, 'iaai');
        let l = null;
        try { l = normalize(item); } catch (e) {}
        if (l && l.images && l.images.length) return l;
        const g = normalizeGeneric(item, 'copart');
        if (g && g.images && g.images.length) return g;
        return l || g;
      } catch (e) { return null; }
    };

    const chain = (isIaai ? IAAI_ACTORS : COPART_ACTORS);
    const targetUrl = isIaai ? iaaiUrl : url;
    const live = chain.filter(a => !isDown(a));
    /* якщо всі позначені як мертві, все одно пробуємо: можливо, вже полагодили */
    const order = live.length ? live : chain;

    let lot = null;
    const failures = [];
    for (const act of order) {
      try {
        lot = await runActor(act, inputsFor(act, targetUrl), process.env.APIFY_TOKEN, targetUrl, toLot);
        if (lot) break;
      } catch (e) {
        const msg = String(e.message || '');
        failures.push(act.split('~')[1] + ': ' + msg.slice(0, 80));
        /* 402/403 = потрібна оренда або немає коштів: марно пробувати найближчим часом */
        if (/HTTP 40[23]/.test(msg)) markDown(act, 6 * 60 * 60 * 1000);
        else if (/HTTP (4|5)\d\d/.test(msg)) markDown(act);
      }
    }
    if (!lot) {
      return res.status(404).json({
        error: 'Фото лота не отримані, жоден із джерел не відповів. Завантаж фото вручну',
        detail: failures.join(' | ').slice(0, 400),
      });
    }
    lot.lot_url = lot.lot_url || url;
    return res.status(200).json({ lot });
  } catch (e) {
    return res.status(502).json({ error: 'Не вдалося отримати дані лота: ' + e.message });
  }
}
