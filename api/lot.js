export const config = { maxDuration: 300 };

const COPART_ACTOR = 'parseforge~copart-public-search-scraper';
const IAAI_ACTOR = process.env.IAAI_ACTOR || 'easyapi~iaai-vehicle-detail-scraper';

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
  const seen = new Set();
  return urls.filter(u => {
    const m = /imageKeys=([^&]+)/i.exec(u);
    const key = m ? m[1] : u;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeGeneric(item, source) {
  const { images, flat } = deepCollect(item);
  const num = v => { const n = parseFloat(String(v).replace(/[^\d.]/g, '')); return isNaN(n) ? null : n; };

  const year = num(pick(flat, ['year', 'modelYear', 'vehicleYear']));
  const make = pick(flat, ['make', 'manufacturer', 'brand', 'vehicleMake']);
  const model = pick(flat, ['model', 'modelName', 'vehicleModel', 'series']);
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
      const raw = String(pick(flat, ['vin', 'vinNumber', 'vinStatus']) || '');
      const m = /[A-HJ-NPR-Z0-9*]{11,17}/i.exec(raw.replace(/\s/g, ''));
      return m ? m[0].toUpperCase() : null;
    })(),
    vin_masked: /\*/.test(String(pick(flat, ['vin', 'vinNumber', 'vinStatus']) || '')),
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
    secondary_damage: pick(flat, ['secondaryDamage', 'secondaryDamageType']),
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
    est_retail_value: num(pick(flat, ['estimatedRetailValue', 'acv', 'actualCashValue', 'retailValue'])),
    acv: num(pick(flat, ['acv', 'actualCashValue'])),
    images: imgs.slice(0, 14).map((url, i) => ({ url, label: '', seq: i })),
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
  let bestNoPhoto = null;
  const triedFields = new Set(inputs.flatMap(i => Object.keys(i)));
  const label = input => Object.keys(input).filter(k => !/^(max|proxy)/i.test(k)).join('+')
    + (input.proxyConfiguration ? '+proxy' : '');
  for (const input of inputs) {
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
        const m = /input\.(\w+)(?:\s+is required|.*?must)/i.exec(body);
        if (m && url && !triedFields.has(m[1])) {
          triedFields.add(m[1]);
          inputs.push({ [m[1]]: url, maxItems: 1, proxyConfiguration: { useApifyProxy: true } });
          inputs.push({ [m[1]]: [{ url }], maxItems: 1, proxyConfiguration: { useApifyProxy: true } });
          inputs.push({ [m[1]]: [url], maxItems: 1 });
        }
        continue;
      }
      const items = await r.json();
      if (!Array.isArray(items) || !items.length) { attempts.push(label(input) + ': порожньо'); continue; }
      const lot = toLot(items[0]);
      if (lot && lot.images.length) return lot;
      bestNoPhoto = bestNoPhoto || lot;
      attempts.push(label(input) + ': без фото');
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

    const actor = isIaai ? IAAI_ACTOR : COPART_ACTOR;
    const PROXY = { useApifyProxy: true };
    /* IAAI захищений антиботом: без proxyConfiguration актор отримує заглушки.
       Консоль Apify підставляє proxy за замовчуванням, тому ручні запуски працюють. */
    const inputs = isIaai
      ? [
          { startUrls: [{ url }], maxItems: 1, proxyConfiguration: PROXY },
          { startUrls: [url], maxItems: 1, proxyConfiguration: PROXY },
          { startUrls: [{ url }], maxItems: 1, proxyConfiguration: PROXY, proxy: PROXY },
          { startUrls: [{ url }], maxItems: 1 },
          { urls: [url], maxItems: 1, proxyConfiguration: PROXY },
          { url, maxItems: 1, proxyConfiguration: PROXY },
          { startUrl: url, maxItems: 1, proxyConfiguration: PROXY },
        ]
      : [
          { startUrl: url, maxItems: 1 },
          { searchUrl: url, maxItems: 1 },
          { url, maxItems: 1 },
          { startUrls: [{ url }], maxItems: 1, proxyConfiguration: PROXY },
          { searchUrls: [url], maxItems: 1 },
        ];

    const fromExample = await buildInputFromExample(actor, url, process.env.APIFY_TOKEN);
    if (fromExample) inputs.unshift(fromExample);

    const toLot = item => {
      try { return isIaai ? normalizeGeneric(item, 'iaai') : normalize(item); }
      catch (e) { return null; }
    };

    let lot;
    try {
      lot = await runActor(actor, inputs, process.env.APIFY_TOKEN, url, toLot);
    } catch (e) {
      return res.status(404).json({
        error: 'Фото лота не отримані (' + e.message + '). Завантаж фото вручну',
      });
    }
    lot.lot_url = lot.lot_url || url;
    return res.status(200).json({ lot });
  } catch (e) {
    return res.status(502).json({ error: 'Не вдалося отримати дані лота: ' + e.message });
  }
}
