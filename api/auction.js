/* CalCar: автономний пошук аукціонного запису США за VIN.
   Роль модуля: знайти джерело, СТРОГО підтвердити ідентичність лота,
   витягнути метадані і фото в межах лімітів, чесно розрізнити
   "запису нема" і "джерела недоступні".
   Provider-agnostic: транспорт передається як opts.fetchImpl, тому парсери
   і пайплайн не залежать ні від пошуковика, ні від способу обходу
   антибота (прямий fetch, актор, scraping API: усе це лише fetchImpl). */

/* версії шарів історичних даних: змінив семантику витягу чи нормалізації
   події -> підніми версію, і кеш оновиться сам, без ручної чистки таблиць */
export const PARSER_VERSION = 'parser-2026-08-31';
export const EVENT_VERSION = 'event-2026-08-31';

/* ================= КАЛІБРУЄТЬСЯ ================= */
export const AUCTION_CONFIG = {
  /* білий список джерел: discovery не виходить за нього ніколи */
  SOURCES: [
    {
      name: 'bid.cars',
      /* внутрішній пошук: віддає url лота одним запитом */
      searchUrl: vin => 'https://bid.cars/app/search/en/vin-lot/' + vin + '/false',
      searchKind: 'json_lot_url',
      lotUrlPattern: /^https:\/\/bid\.cars\/en\/lot\//,
    },
    {
      name: 'bidfax.info',
      searchUrl: vin => 'https://en.bidfax.info/?do=search&subaction=search&story=' + vin,
      searchKind: 'html_links',
      lotUrlPattern: /^https:\/\/en\.bidfax\.info\/[a-z0-9\-\/]+\.html$/i,
    },
    {
      name: 'poctra.com',
      searchUrl: vin => 'https://poctra.com/search?q=' + vin,
      searchKind: 'html_links',
      lotUrlPattern: /^https:\/\/poctra\.com\/[a-z0-9\-\/]+$/i,
    },
  ],
  /* ШТАТНИЙ general discovery: Serper (Google) за точним VIN у лапках.
     Прод-IP Vercel масово ловить 403 від безкоштовних endpoint-ів, тому
     дешевий пошуковий крок є нормою, а не аварією. Serper дає ЛИШЕ
     кандидатів (URL): жоден факт зі сніпета не стає evidence */
  SERPER_ENDPOINT: 'https://google.serper.dev/search',
  /* відомі historical-домени: кандидати з них ранжуються вище */
  HISTORICAL_DOMAINS: /bid\.cars|bidfax|poctra|stat\.vin|plc\.auction|salvagebid|autoastat|autobidmaster|carsfromwest|epicvin|vinchain/i,
  /* fallback-пошук без ключа: НЕ основний шлях продакшна */
  SEARCH_ENDPOINT: vin => 'https://html.duckduckgo.com/html/?q=%22' + vin + '%22',
  SEARCH_MAX_CANDIDATES: 8,
  /* безкоштовні дзеркала: production-адаптер без VIN-specific хардкоду,
     URL будується з марки/моделі декодування */
  MIRRORS: [
    {
      name: 'americamotors.com',
      url: (vin, nhtsa) => {
        const mk = String(nhtsa && nhtsa.Make || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const md = String(nhtsa && nhtsa.Model || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return (mk && md) ? 'https://americamotors.com/en/' + mk + '/' + md + '/' + vin : null;
      },
    },
  ],
  /* якість безкоштовних фото, нижче якої дозволений платний fallback */
  ZENROWS_MIN_FREE_PHOTOS: 4,
  /* закритий білий список причин платного виклику, без "аналогічних".
     sale_price_missing причиною НЕ є (ціна не в продуктовій логіці);
     need_damage_labels ЗАБОРОНЕНА при наявності якісних фото: зони і подушки
     визначає vision-аналіз власним пайплайном */
  ZENROWS_REASONS: ['title_status_missing', 'photos_unavailable', 'photos_low_quality', 'odometer_unreadable', 'critical_auction_metadata_missing', 'discovery_blocked'],
  FETCH_TIMEOUT_MS: 12000,
  TOTAL_BUDGET_MS: 25000,
  /* історичний візуал: скільки кадрів реально тягнемо на Vision.
     Не 20: достатньо репрезентативних ракурсів для зон, severity і SRS */
  VISION_PHOTOS_MAX: 6,
  VISION_PHOTO_MAX_BYTES: 1600000,
  /* конвенція префікса лота bid.cars ПЕРЕВІРЕНА на 6 реальних лотах
     (BMW x4, Tesla x2): 0- -> IAAI, 1- -> Copart; на кожній сторінці
     збігаються два незалежні labelled-сигнали (var auctionType і фраза
     "Data fetched from the platform"). Використовується ЛИШЕ як
     last-resort після structured і labelled evidence */
  LOT_PREFIX_HOUSE: { '0': 'IAAI', '1': 'COPART' },
  /* ліміти скачування фото */
  MAX_PHOTOS: 20,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 40 * 1024 * 1024,
  /* кеш відсутності: повторна перевірка дозволена після TTL.
     Знайдений запис постійний і не перевіряється повторно */
  ABSENT_TTL_DAYS: 30,
  /* допуск року: модельний проти календарного це законна різниця */
  YEAR_TOLERANCE: 1,
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ---------- транспорт ---------- */
async function fetchText(url, opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs || AUCTION_CONFIG.FETCH_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    const body = await r.text();
    const blocked = r.status === 403 || r.status === 429 || r.status === 503
      /* маркери challenge/interstitial, НЕ голе слово cloudflare (буває у
         CDN-скриптах). HTTP 200 із челенджем ("Select all squares containing
         a duck") це ТЕЖ blocked, а не порожній результат пошуку */
      || /just a moment|cf-chl|cf-browser-verification|captcha|incapsula|attention required|enable javascript and cookies|bots use duckduckgo|select all squares|verify (that )?you are (a )?human|security verification|robot check|performing security/i.test(body.slice(0, 4000));
    return { status: r.status, body, blocked };
  } finally { clearTimeout(t); }
}

/* ---------- 1. строга ідентифікація лота ----------
   VIN мусить стояти в КАНОНІЧНІЙ зоні запису: URL, <title>, <h1> або
   підписане поле VIN. Збіг у довільному HTML (блоки "схожі лоти") не
   рахується. Кросс-перевірка з NHTSA: марка і модель мусять збігатися,
   рік з допуском +-1; більший розліт року = знижена впевненість,
   розліт марки чи моделі = запис відкидається. */
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function verifyLotIdentity(page, vin, nhtsa) {
  const V = String(vin || '').toUpperCase();
  const title = (page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const h1 = (page.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  /* підписане поле: "VIN: <значення>" у тексті без тегів, інакше розмітка
     між словом VIN і значенням ламала збіг */
  const plain = page.html.replace(/<[^>]+>/g, ' ').toUpperCase();
  const labeled = new RegExp('VIN[^A-Z0-9]{0,10}' + V).test(plain);
  const zones = [String(page.url || '').toUpperCase(), title.toUpperCase(), h1.toUpperCase()];
  const inCanonical = zones.some(z => z.includes(V)) || labeled;
  if (!inCanonical) return { matched: false, reason: 'vin_not_in_canonical_zone' };

  /* make/model звіряються по КОНТЕНТУ сторінки (title/h1): URL-слаг це наш
     же candidate і не може підтверджувати сам себе */
  const head = norm(title + ' ' + h1);
  const make = norm(nhtsa && nhtsa.Make);
  const model = norm(nhtsa && nhtsa.Model);
  /* несумісна МАРКА при заявленому VIN: справжній identity-конфлікт */
  if (make && !head.includes(make)) return { matched: false, reason: 'make_mismatch' };
  let confidence = 'high';
  let model_naming_mismatch = false;
  if (model) {
    /* ТОЧНИЙ повний VIN у канонічній зоні є ГОЛОВНИМ якорем ідентичності.
       Варіації naming моделі/trim ("540i" проти "5 Series 540 XI") НЕ
       відкидають запис: це знижена впевненість і data-quality нотатка,
       а не hard reject (диагностований false negative) */
    const tokens = model.split(' ').filter(x => x.length >= 2);
    if (tokens.length && !tokens.some(tk => head.includes(tk))) {
      confidence = 'reduced';
      model_naming_mismatch = true;
    }
  }
  const nYear = parseInt(nhtsa && nhtsa.ModelYear, 10);
  const pYear = parseInt((title + ' ' + h1).match(/\b(19|20)\d{2}\b/)?.[0], 10);
  if (nYear && pYear && Math.abs(nYear - pYear) > AUCTION_CONFIG.YEAR_TOLERANCE) {
    confidence = 'reduced';
  }
  return { matched: true, confidence, model_naming_mismatch, year_page: pYear || null, year_vin: nYear || null };
}

/* ---------- 2/3. кеш і статуси ----------
   Чиста логіка рішення про повторну перевірку: знайдене постійне,
   absent живе ABSENT_TTL_DAYS, потім перевірка дозволена знову */
export function shouldRecheck(cached, now = Date.now(), cfg = AUCTION_CONFIG) {
  if (!cached || !cached.status) return true;
  if (cached.status === 'found') return false;
  if (cached.status !== 'absent') return true;
  const age = now - new Date(cached.checked_at || 0).getTime();
  return !(age >= 0 && age < cfg.ABSENT_TTL_DAYS * 86400000);
}

/* ---------- 4. фото з лімітами ---------- */
const IMG_MAGIC = buf =>
  (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||                      /* JPEG */
  (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||   /* PNG */
  (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50); /* WebP */

export async function downloadLotPhotos(urls, opts = {}, cfg = AUCTION_CONFIG) {
  const fetchImpl = opts.fetchImpl || fetch;
  const photos = [];
  const skipped = [];
  let total = 0;
  for (const u of (urls || []).slice(0, cfg.MAX_PHOTOS)) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), opts.timeoutMs || cfg.FETCH_TIMEOUT_MS);
      let r;
      try {
        r = await fetchImpl(u, { signal: ctl.signal, headers: { 'user-agent': UA, accept: 'image/*' } });
      } finally { clearTimeout(t); }
      const type = String(r.headers?.get?.('content-type') || '');
      if (!r.ok || !/^image\//i.test(type)) {
        skipped.push({ url: u, reason: !r.ok ? 'http_' + r.status : 'not_image_type' });
        console.log('[auction] фото пропущене:', u.slice(0, 90), !r.ok ? 'http ' + r.status : 'content-type ' + type);
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > cfg.MAX_PHOTO_BYTES) {
        skipped.push({ url: u, reason: 'too_large' });
        console.log('[auction] фото пропущене (розмір ' + buf.length + '):', u.slice(0, 90));
        continue;
      }
      if (buf.length < 12 || !IMG_MAGIC(buf)) {
        skipped.push({ url: u, reason: 'bad_signature' });
        console.log('[auction] фото пропущене (не зображення за сигнатурою):', u.slice(0, 90));
        continue;
      }
      if (total + buf.length > cfg.MAX_TOTAL_BYTES) {
        skipped.push({ url: u, reason: 'total_limit' });
        console.log('[auction] сумарний ліміт фото вичерпаний, решта пропущена');
        break;
      }
      total += buf.length;
      photos.push({ url: u, bytes: buf.length, type, buf });
    } catch (e) {
      skipped.push({ url: u, reason: 'fetch_failed' });
      console.log('[auction] фото не скачалось:', u.slice(0, 90), e.message);
    }
  }
  return { photos, skipped, total_bytes: total };
}

/* ---------- 5/7. discovery: provider-agnostic ----------
   Кандидати лише з білого списку джерел, без виходу за нього і без JS.
   Провайдери source-specific (шаблони URL і внутрішній пошук архівів);
   зовнішній search API, якщо колись зʼявиться, стає ще одним провайдером
   і на пайплайн не впливає */
/* безкоштовний пошуковий discovery: кандидати з БУДЬ-ЯКОГО публічного
   домену, аби точний VIN стояв у URL. Endpoint часом віддає антибот 202:
   тоді просто нуль кандидатів, драбина йде далі шаблонами джерел */
/* Serper: один дешевий запит "<VIN>" (+ опційний extended "<VIN> auction"
   лише для imported/history-gap без результатів першого). Повертає ЛИШЕ
   кандидатів: title/snippet служать discovery і ранжуванню, факти з них
   НІКОЛИ не нормалізуються (дані беруться тільки зі сторінки після fetch
   і підтвердженої ідентичності) */
async function serperDiscovery(vin, opts, cfg) {
  const V = String(vin || '').toUpperCase();
  const key = process.env.SERPER_API_KEY;
  const diag = { source: 'serper', step: 'discovery', status: null, found: false, queries: 0, ms: 0 };
  if (!key) { diag.status = 'no_api_key'; return { candidates: [], diag }; }
  const fetchImpl = opts.serperFetchImpl || opts.fetchImpl || fetch;
  const ts = Date.now();
  const out = [];
  const runQuery = async q => {
    diag.queries++;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.timeoutMs || cfg.FETCH_TIMEOUT_MS);
    try {
      const r = await fetchImpl(cfg.SERPER_ENDPOINT, {
        signal: ctl.signal,
        method: 'POST',
        headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      diag.status = r.status;
      if (r.status !== 200) return;
      const j = JSON.parse(await r.text());
      for (const item of (Array.isArray(j.organic) ? j.organic : [])) {
        const u = String(item.link || '');
        if (!/^https?:\/\//.test(u)) continue;
        /* strong candidate: точний VIN в url, title АБО snippet. Це привід
           ВІДКРИТИ сторінку, не підтверджена ідентичність */
        const hay = (u + ' ' + (item.title || '') + ' ' + (item.snippet || '')).toUpperCase();
        if (!hay.includes(V)) continue;
        let host;
        try { host = new URL(u).hostname; } catch (e) { continue; }
        if (out.some(c => c.url === u)) continue;
        out.push({ source: 'serper:' + host, url: u, known_historical: cfg.HISTORICAL_DOMAINS.test(host) });
        if (out.length >= cfg.SEARCH_MAX_CANDIDATES) break;
      }
    } catch (e) { diag.status = diag.status || 'error'; diag.error = String(e.message || e).slice(0, 60); } finally { clearTimeout(t); }
  };
  await runQuery('"' + V + '"');
  /* limited extended search: лише imported/history-gap і лише коли перший
     запит не дав historical-кандидатів. Без віяла з 5-10 запитів */
  if (opts.extendedSearch && !out.some(c => c.known_historical) && out.length < cfg.SEARCH_MAX_CANDIDATES) {
    await runQuery('"' + V + '" auction');
  }
  diag.found = out.length > 0;
  diag.ms = Date.now() - ts;
  console.log('[auction] source=serper step=discovery status=' + diag.status,
    'queries=' + diag.queries, 'candidates=' + out.length, diag.ms + 'ms');
  return { candidates: out, diag };
}

async function searchDiscovery(vin, opts, cfg) {
  const V = String(vin || '').toUpperCase();
  const d = { source: 'search', step: 'discovery', url: cfg.SEARCH_ENDPOINT(V), status: null, blocked: false, found: false, ms: 0 };
  const ts = Date.now();
  const out = [];
  try {
    const r = await fetchText(cfg.SEARCH_ENDPOINT(V), opts);
    d.status = r.status;
    d.blocked = r.blocked;
    if (!r.blocked && r.status === 200) {
      const seen = new Set();
      for (const m of r.body.matchAll(/uddg=([^&"]+)/g)) {
        let u;
        try { u = decodeURIComponent(m[1]); } catch (e) { continue; }
        if (!/^https?:\/\//.test(u) || /duckduckgo/.test(u) || !u.toUpperCase().includes(V)) continue;
        let host;
        try { host = new URL(u).hostname; } catch (e) { continue; }
        if (seen.has(host)) continue;
        seen.add(host);
        out.push({ source: 'search:' + host, url: u });
        if (out.length >= cfg.SEARCH_MAX_CANDIDATES) break;
      }
      d.found = out.length > 0;
    }
  } catch (e) { d.status = 'error'; d.error = String(e.message || e).slice(0, 60); }
  d.ms = Date.now() - ts;
  console.log('[auction] source=search step=discovery status=' + d.status, d.blocked ? 'BLOCKED' : ('candidates=' + out.length), d.ms + 'ms');
  return { candidates: out, diag: d };
}

export async function discoverVinCandidates(vin, opts = {}, cfg = AUCTION_CONFIG) {
  const V = String(vin || '').toUpperCase();
  const out = [];
  const diag = [];
  const t0 = Date.now();
  for (const src of cfg.SOURCES) {
    const url = src.searchUrl(V);
    /* outcome на джерело: found | not_found | blocked | unreachable.
       not_found ЛИШЕ коли джерело успішно відповіло і відповідь розпарсилась */
    const d = { source: src.name, step: 'discovery', url, status: null, blocked: false, found: false, outcome: 'unreachable', ms: 0 };
    const ts = Date.now();
    try {
      const r = await fetchText(url, opts);
      d.status = r.status;
      d.blocked = r.blocked;
      if (r.blocked) {
        d.outcome = 'blocked';
      } else if (r.status === 200) {
        if (src.searchKind === 'json_lot_url') {
          try {
            const j = JSON.parse(r.body);
            if (j && j.url && src.lotUrlPattern.test(j.url)) { out.push({ source: src.name, url: j.url }); d.found = true; d.outcome = 'candidate'; }
            else d.outcome = 'not_found';
          } catch (e) { d.outcome = 'unreachable'; /* 200, але не розпарсилось */ }
        } else {
          d.outcome = 'not_found';
          /* точний VIN у href в межах домену джерела */
          for (const m of r.body.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
            if (m[1].toUpperCase().includes(V) && src.lotUrlPattern.test(m[1])) {
              out.push({ source: src.name, url: m[1] });
              d.found = true;
              d.outcome = 'candidate';
              break;
            }
          }
        }
      }
    } catch (e) {
      d.status = 'error';
      d.error = String(e.message || e).slice(0, 80);
    }
    d.ms = Date.now() - ts;
    console.log('[auction] source=' + src.name, 'step=discovery', 'status=' + d.status,
      d.blocked ? 'BLOCKED' : d.outcome, d.ms + 'ms');
    diag.push(d);
  }
  /* ШТАТНИЙ general discovery: Serper за точним VIN. Повторний прохід по
     закешованій found-події Serper НЕ викликає (opts.skipSerper) */
  const sp = opts.skipSerper
    ? { candidates: [], diag: { source: 'serper', step: 'discovery', status: 'skipped_cache', found: false, queries: 0, ms: 0 } }
    : await serperDiscovery(V, opts, cfg);
  diag.push(sp.diag);
  /* DDG: лише optional fallback, коли Serper недоступний і нічого нема */
  let ddgCandidates = [];
  if (sp.diag.status === 'no_api_key' || (!out.length && !sp.candidates.length)) {
    const sd = await searchDiscovery(V, opts, cfg);
    diag.push(sd.diag);
    ddgCandidates = sd.candidates;
  }
  /* RANKING: (1) підтверджені source-specific знахідки; (2) Serper з
     відомих historical-доменів; (3) інші strong exact-VIN кандидати;
     (4) DDG-fallback; (5) шаблонні (guessed) дзеркала ОСТАННІМИ: платний
     виклик не має йти на мертве дзеркало поперед реального запису */
  const serperHist = sp.candidates.filter(c => c.known_historical);
  const serperOther = sp.candidates.filter(c => !c.known_historical);
  const tail = [];
  for (const m of cfg.MIRRORS) {
    const u = m.url(V, opts.nhtsa);
    if (u) tail.push({ source: m.name, url: u, synthetic: true });
  }
  /* сама сторінка оголошення, що перевіряється, і будь-які URL її
     площадки НЕ є historical-кандидатами: індексований Google лістинг
     містить VIN, але це поточне оголошення, а не аукціонний архів */
  let excludeHost = null;
  try { excludeHost = opts.excludeUrl ? new URL(opts.excludeUrl).hostname.replace(/^www\./, '') : null; } catch (e) {}
  const merged = [];
  for (const c of [...out, ...serperHist, ...serperOther, ...ddgCandidates, ...tail]) {
    if (excludeHost) {
      try { if (new URL(c.url).hostname.replace(/^www\./, '') === excludeHost) continue; } catch (e) {}
    }
    if (!merged.some(x => x.url === c.url)) merged.push(c);
  }
  return { candidates: merged, diagnostics: diag, discovery_ms: Date.now() - t0 };
}

/* паспорт джерела: аукціонний дім і дата продажу з тексту лота */
/* image-level provenance: фото можна віддавати Vision як evidence ЛИШЕ коли
   його належність exact lot доведена на рівні URL: точний VIN або lot_id у
   посиланні. Generic-галерея (cs.copart без VIN/lot) провенанс НЕ проходить:
   вона змішує різні авто і у Vision не йде */
export function photoHasProvenance(url, vin, lotId) {
  const u = String(url || '').toUpperCase();
  if (vin && u.includes(String(vin).toUpperCase())) return true;
  if (lotId && new RegExp('\\b' + String(lotId) + '\\b').test(u)) return true;
  return false;
}

/* канонічний ідентифікатор аукціонного дому. Домен дзеркала
   (americamotors.com, bid.cars, bidfax.info) НІКОЛИ не auction_house:
   тут лише самі доми, і жодних варіантів регістру назовні */
/* ---------- VIN-scoped витяг історичних фактів ----------
   На сторінці-агрегаторі поруч живуть чужі авто (каруселі, реклама,
   рекомендації) і навігаційний текст ("дані аукціонів Copart і IAAI").
   Витягати факти з plain-тексту ВСЬОГО документа не можна: саме так
   з'явився хибний IAAI для лота Copart. Скоуп будується навколо
   ЦІЛЬОВОГО VIN: structured-блок з vehicleIdentificationNumber === VIN,
   плюс текстові вікна навколо входжень VIN */
export function vinScopedRegions(html, vin, windowChars = 2500) {
  const V = String(vin || '').toUpperCase();
  const src = String(html || '');
  const out = { jsonld: [], text: '', found: false };
  if (!V) return out;
  /* JSON-LD блоки з ТОЧНИМ VIN: рекурсивно, бо буває @graph і масиви */
  for (const m of src.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch (e) { continue; }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { for (const x of node) stack.push(x); continue; }
      const nodeVin = String(node.vehicleIdentificationNumber || node.vin || '').toUpperCase();
      if (nodeVin === V) out.jsonld.push(node);
      else for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') stack.push(node[k]);
    }
  }
  /* текстові вікна навколо VIN у розмітці, зведені до plain */
  const plainAll = src.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const up = plainAll.toUpperCase();
  const parts = [];
  let i = up.indexOf(V);
  while (i >= 0 && parts.length < 8) {
    parts.push(plainAll.slice(Math.max(0, i - windowChars), i + windowChars));
    i = up.indexOf(V, i + V.length);
  }
  /* чужі авто на сторінці: інший Vehicle-JSON-LD або інший 17-значний VIN.
     Якщо їх нема, сторінка одно-лотова і ВЕСЬ її текст стосується цього
     авто: тоді звужувати скоуп шкідливо (поля лота лежать далеко від VIN) */
  const otherVins = new Set();
  for (const m of plainAll.matchAll(/\b([A-HJ-NPR-Z0-9]{17})\b/g)) {
    const c = m[1].toUpperCase();
    if (c !== V && /\d/.test(c) && /[A-Z]/.test(c)) otherVins.add(c);
  }
  out.other_vehicles = otherVins.size;
  /* ДІАГНОСТИКА, не режим витягу: відсутність чужого VIN у тексті НЕ
     доводить, що сторінка одно-лотова (карусель може не друкувати VIN, і
     тоді у whole-document режим протікали чужі пробіг/damage/title).
     Скоуп ЗАВЖДИ вікна навколо VIN + structured-блок цього VIN.
     Перевірено на реальній сторінці bid.cars: поля лота лежать за 142
     символи від VIN, тобто вікно їх упевнено покриває */
  out.single_lot_page = otherVins.size === 0;
  out.text = parts.join(' \u2022 ');
  /* зображення зі structured-блоку цього VIN: провенанс за побудовою
     (лежать усередині блоку саме цього VIN), навіть якщо в URL хеш */
  out.jsonld_photos = [];
  for (const node of out.jsonld) {
    const imgs = Array.isArray(node.image) ? node.image : (node.image ? [node.image] : []);
    for (const u of imgs) if (typeof u === 'string' && /^https?:\/\/.*\.(?:jpe?g|png|webp)/i.test(u)) out.jsonld_photos.push(u);
  }
  /* галерея лота ПОВНІСТЮ: structured-блок часто цитує лише кілька перших
     кадрів (у діагностованого VIN 5 із 12, усі екстерʼєрні), через що салон
     і докази подушок ніколи не доїжджали до Vision. Добираємо кадри ТОГО
     САМОГО хоста і ТІЄЇ САМОЇ теки, що й кадри цього VIN, і лише суцільним
     блоком у порядку документа, який містить хоча б один кадр із JSON-LD:
     сусідні теки на агрегаторі належать іншим авто */
  if (out.jsonld_photos.length) {
    const keyOf = u => { try { const x = new URL(u); return x.hostname + x.pathname.replace(/[^/]+$/, ''); } catch (e) { return null; } };
    const ldKeys = new Set(out.jsonld_photos.map(keyOf).filter(Boolean));
    const pageImgs = [...new Set([...src.matchAll(/https?:\/\/[^"'\s>\\]+\.(?:jpe?g|png|webp)/gi)].map(m => m[0]))];
    const block = [];
    let started = false;
    for (const u of pageImgs) {
      const k = keyOf(u);
      if (k && ldKeys.has(k)) { block.push(u); started = true; }
      else if (started) break; /* суцільний блок скінчився: далі чужі авто */
    }
    if (block.length && block.some(u => out.jsonld_photos.includes(u))) {
      out.gallery_photos = block.slice(0, 20);
      out.jsonld_photos = [...new Set([...out.jsonld_photos, ...out.gallery_photos])];
    }
  }
  out.found = out.jsonld.length > 0 || parts.length > 0;
  return out;
}

/* платформа аукціону ЛИШЕ зі скоупу цільового VIN, за пріоритетом
   evidence. Неоднозначність (обидві платформи в одному вікні без
   мітки) чесно дає null: unknown краще за неправильний IAAI */
export function auctionHouseScoped(html, url, vin, cfg = AUCTION_CONFIG) {
  const scope = vinScopedRegions(html, vin);
  /* 1. structured-блок цього VIN: явні поля і хости зображень лота */
  for (const node of scope.jsonld) {
    const flat = JSON.stringify(node);
    const hostHouse = /(?:^|[\/."'])copart[a-z0-9.-]*\.(?:com|by|ua|net)/i.test(flat) ? 'COPART'
      : /(?:^|[\/."'])(?:vis\.)?iaai[a-z0-9.-]*\.(?:com|by|ua|net)/i.test(flat) ? 'IAAI' : null;
    if (hostHouse) return { value: hostHouse, evidence_type: 'json_ld_exact_vin' };
    const direct = canonicalAuctionHouse(flat.replace(/[{}\",:\[\]]/g, ' '));
    if (direct) return { value: direct, evidence_type: 'json_ld_exact_vin' };
  }
  /* 2. явно підписане поле (у скоупі або у службових змінних сторінки) */
  const labelled = String(html || '').match(/(?:var\s+auctionType\s*=\s*['"]|Data fetched from the platform\s+|Auction house[:\s]{1,4}|Auction[:\s]{1,4}|Platform[:\s]{1,4}|Аукцион[:\s]{1,4}|Аукціон[:\s]{1,4}|Площадка[:\s]{1,4}|Майданчик[:\s]{1,4})(Copart|IAAI)\b/i);
  if (labelled) return { value: canonicalAuctionHouse(labelled[1]), evidence_type: 'labelled_field' };
  /* 3. скоуп VIN: рахуємо лише коли платформа в ньому ОДНА */
  if (scope.text) {
    const hasC = /\bcopart\b/i.test(scope.text);
    const hasI = /\biaai\b/i.test(scope.text);
    if (hasC && !hasI) return { value: 'COPART', evidence_type: 'vin_scoped_text' };
    if (hasI && !hasC) return { value: 'IAAI', evidence_type: 'vin_scoped_text' };
  }
  /* 4. last-resort: перевірена конвенція префікса лота джерела */
  const ref = parseLotRef(url);
  if (ref.raw_lot_reference && ref.house_hint) return { value: ref.house_hint, evidence_type: 'source_lot_convention' };
  /* 5. надійних доказів нема */
  return { value: null, evidence_type: null };
}

/* lot id з URL джерела. bid.cars має форму /lot/<префікс>-<lot>/...:
   стара регулярка \/(\d{7,9})\b її не бачила (перед цифрами дефіс) */
export function parseLotRef(url, cfg = AUCTION_CONFIG) {
  const u = String(url || '');
  const pref = u.match(/\/lot\/([01])-(\d{6,9})\b/);
  if (pref) return { lot_id: pref[2], raw_lot_reference: pref[1] + '-' + pref[2], house_hint: cfg.LOT_PREFIX_HOUSE[pref[1]] || null };
  const plainLot = u.match(/\/(\d{7,9})\b/);
  if (plainLot) return { lot_id: plainLot[1], raw_lot_reference: plainLot[1], house_hint: null };
  return { lot_id: null, raw_lot_reference: null, house_hint: null };
}

export function canonicalAuctionHouse(raw) {
  const t = String(raw || '').trim().toLowerCase();
  /* чистий домен-токен (americamotors.com, copart.com, bid.cars) домом НЕ є */
  if (/^[a-z0-9.\-]+\.(com|info|cars|net|org|ua|bg)$/.test(t)) return null;
  if (/\biaai\b|иааи|іааі|insurance auto auctions/.test(t)) return 'IAAI';
  if (/\bcopart\b/.test(t)) return 'COPART';
  return null;
}

/* пробіг у км з явної одиниці. unit СТРОГО mi|km|unknown; unknown або
   невідоме число дають null (порівнювати такий пробіг заборонено) */
export function odometerToKm(value, unit) {
  const v = Number(value);
  if (!isFinite(v) || v <= 0) return null;
  if (unit === 'km') return Math.round(v);
  if (unit === 'mi') return Math.round(v * 1.609344);
  return null;
}

/* дата продажу: суворий ISO-парс, інакше null (не вгадуємо формат). Сирий
   рядок повертається окремо, щоб не втратити його для відладки */
function parseSaleDate(raw) {
  const r = String(raw || '').trim();
  let iso = null;
  const pad = n => String(n).padStart(2, '0');
  let m = r.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i);
  if (m) { const d = new Date(m[1]); if (!isNaN(d)) iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  if (!iso) { m = r.match(/\b(\d{4})-(\d{2})-(\d{2})\b/); if (m) { const d = new Date(m[0]); if (!isNaN(d) && +m[1] >= 1990 && +m[1] <= 2100) iso = m[1] + '-' + m[2] + '-' + m[3]; } }
  return { sale_date: iso, sale_date_raw: iso ? null : (r.slice(0, 40) || null) };
}

export function extractLotMeta(html, url, vin) {
  /* VIN-scoped: усі vehicle-specific факти беремо ЛИШЕ зі скоупу цільового
     VIN (structured-блок + вікна навколо VIN). Без vin поведінка legacy:
     весь документ (для одно-лотових сторінок і зворотної сумісності) */
  const wholePlain = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const scope = vin ? vinScopedRegions(html, vin) : null;
  const scopeSource = vin ? 'vin_scoped' : 'whole_page';
  const jsonldText = scope && scope.jsonld.length ? scope.jsonld.map(n => JSON.stringify(n).replace(/[{}\",:\[\]]/g, ' ')).join(' ') : '';
  const plain = (scope && scope.found) ? (jsonldText + ' ' + scope.text).replace(/\s+/g, ' ') : wholePlain;
  const houseScoped = vin ? auctionHouseScoped(html, url, vin) : { value: canonicalAuctionHouse(wholePlain), evidence_type: 'whole_page_legacy' };
  const auction_house = houseScoped.value;
  /* damage з опису structured-блоку цього VIN: "повреждения Front end , Side" */
  let ldDamage = null;
  for (const node of (scope ? scope.jsonld : [])) {
    const dm = String(node.description || '').match(/(?:повреждения|пошкодження|damage)[:\s]{0,3}([A-Za-z][A-Za-z\- ]{1,28})(?:\s*,\s*([A-Za-z][A-Za-z\- ]{1,28}))?/i);
    if (dm) { ldDamage = { primary: (dm[1] || '').trim() || null, secondary: (dm[2] || '').trim() || null }; break; }
  }
  /* дата: беремо ЛИШЕ явну "Auction ended" чи ISO; для американмоторс блок
     "Дата продажи" стосується схожих авто, не цього лота, тому не чіпаємо */
  const dateRaw = (plain.match(/Auction ended[^.]*?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i) || [])[1] || null;
  const { sale_date, sale_date_raw } = parseSaleDate(dateRaw);
  /* одометр: число з ЯВНОЮ одиницею. Одиниця з джерела, НЕ припущення */
  let odometer_value = null, odometer_unit = 'unknown';
  let om = plain.match(/(\d[\d\s,.]{1,9})\s*(?:mi|miles|миль|міль)(?![a-zа-яіїєґ])/i);
  if (om) { odometer_value = parseInt(om[1].replace(/[^\d]/g, ''), 10) || null; odometer_unit = 'mi'; }
  else { om = plain.match(/(\d[\d\s,.]{1,9})\s*(?:km|км)(?![a-zа-яіїєґ])/i); if (om) { odometer_value = parseInt(om[1].replace(/[^\d]/g, ''), 10) || null; odometer_unit = 'km'; } }
  /* статус пробігу з джерела (actual|not_actual|exempt|unknown), сирий рядок
     окремо. Одиниця і статус НЕ припускаються, беруться з тексту лота */
  let odometer_status = 'unknown', odometer_status_raw = null;
  const CYR = '[а-яіїєґё]';
  const sm = plain.match(new RegExp('(not[\\s-]?actual|true\\s+mileage\\s+unknown|\\bTMU\\b|exceeds\\s+mechanical\\s+limits|mileage\\s+exempt|\\bexempt\\b|\\bactual\\b|підтвердж' + CYR + '+\\s+пробіг|подтвержд' + CYR + '+\\s+пробег|не\\s+відповідає\\s+пробіг|скручен' + CYR + '*)', 'i'));
  if (sm) {
    odometer_status_raw = sm[0].trim().slice(0, 60);
    const tt = sm[0].toLowerCase();
    if (/not|tmu|true\s+mileage|скручен|не\s+відповідає/.test(tt)) odometer_status = 'not_actual';
    else if (/exempt|exceeds/.test(tt)) odometer_status = 'exempt';
    else odometer_status = 'actual';
  }
  /* ідентичність події: lot id з URL джерела (source-aware) або зі скоупу */
  const lotRef = parseLotRef(url);
  const lot_id = lotRef.lot_id
    || (plain.match(/(?:Lot|Лот|лота)[:\s#№]{0,5}(\d{7,9})/i) || [])[1] || null;
  const raw_lot_reference = lotRef.raw_lot_reference || lot_id;
  /* невізуальні метадані: тягнемо завжди, дефіс/тире = нема (null) */
  /* damage/title: захоплюємо ЛИШЕ латиницю значення (аукціонні мітки латиною),
     стоп на кирилиці наступного маркера; дефіс = нема */
  const clean = v => { const t = (v || '').trim().replace(/^[-\u2013\u2014\s]+|[-\u2013\u2014\s]+$/g, ''); return t.length >= 2 ? t.slice(0, 40) : null; };
  /* стоп на наступному маркері, щоб primary не тягнув 'Secondary damage ...' */
  /* \u2022 це роздільник вікон VIN-скоупу: теж законний стоп */
  const dmgStop = '(?:Secondary|Odometer|Loss|Title|Airbag|Primary|VIN|\u2022|\\d|Тип|Пробіг|Пробег|Втор|Основ|$)';
  const primary_damage = (ldDamage && ldDamage.primary) || clean((plain.match(new RegExp('(?:Primary damage|Осн\\.? поврежд[а-яіїєґё]*|Основн[а-яіїєґё]+ пошкодж[а-яіїєґё]*)[:\\s]{0,5}([A-Za-z\\- ,\\/]{1,30}?)\\s*' + dmgStop, 'i')) || [])[1]);
  const secondary_damage = (ldDamage && ldDamage.secondary) || clean((plain.match(new RegExp('(?:Secondary damage|Втор\\.? поврежд[а-яіїєґё]*|Другорядн[а-яіїєґё]+ пошкодж[а-яіїєґё]*)[:\\s]{0,5}([A-Za-z\\- ,\\/]{1,30}?)\\s*' + dmgStop, 'i')) || [])[1]);
  const title_status = clean((plain.match(/(?:Title status|Document type|Тип документа|Тип документу)[:\s]{0,5}([A-Za-z\- ,\/]{1,30})/i) || [])[1]);
  /* подушки з metadata лота (bid.cars/IAAI/Copart дають Airbag: Driver тощо).
     Це НЕ visual evidence, а надійний historical metadata exact-lot */
  const airRaw = (plain.match(/Airbags?[:\s]{0,4}([A-Za-z ,\/]{2,30})/i) || [])[1];
  let airbags = null;
  if (airRaw) {
    const a = airRaw.trim().toLowerCase();
    if (/none|no\b|not deployed|intact/.test(a)) airbags = { deployed: false, raw: airRaw.trim().slice(0, 30) };
    else if (/driver|passenger|side|curtain|both|deployed|yes|front/.test(a)) airbags = { deployed: true, raw: airRaw.trim().slice(0, 30) };
  }
  /* field-level provenance: завжди видно, звідки взялося значення.
     Внутрішні/діагностичні дані, у користувацький звіт не йдуть */
  let sourceHost = null;
  try { sourceHost = new URL(String(url || '')).hostname.replace(/^www\./, ''); } catch (e) {}
  const prov = (value, evidence) => (value === null || value === undefined)
    ? null : { value, source: sourceHost, evidence_type: evidence || scopeSource };
  const field_provenance = {
    auction_house: auction_house ? { value: auction_house, source: sourceHost, evidence_type: houseScoped.evidence_type } : null,
    lot_id: prov(lot_id, lotRef.lot_id ? 'source_url' : scopeSource),
    sale_date: prov(sale_date),
    mileage: odometer_value === null ? null : { value: odometer_value, unit: odometer_unit, source: sourceHost, evidence_type: scopeSource },
    primary_damage: prov(primary_damage),
    secondary_damage: prov(secondary_damage),
    title_status: prov(title_status),
    airbags: airbags ? { value: airbags.raw, source: sourceHost, evidence_type: scopeSource } : null,
  };
  return { auction_house, sale_date, sale_date_raw, odometer_value, odometer_unit, odometer_status, odometer_status_raw, lot_id, raw_lot_reference, lot_id_source: lot_id ? (lotRef.lot_id ? 'source_url' : 'direct') : null, primary_damage, secondary_damage, title_status, airbags, scope: scopeSource, jsonld_photos: (scope && scope.jsonld_photos) || [], field_provenance, parser_version: PARSER_VERSION };
}

/* строге відновлення lot_id з discovery-кандидата: ЛИШЕ коли одночасно
   VIN події підтверджений, auction_house події і кандидата відомі, після
   канонізації збігаються, і кандидат про той самий VIN. Інакше null:
   евристика "єдиний лот для VIN, значить він" ЗАБОРОНЕНА */
export function recoverLotId(candidate, eventHouse, vin) {
  if (!candidate || !eventHouse) return null;
  const candHouse = canonicalAuctionHouse(candidate.house);
  if (!candHouse || candHouse !== canonicalAuctionHouse(eventHouse)) return null;
  if (!candidate.vinConfirmed) return null;
  if (String(candidate.vin || '').toUpperCase() !== String(vin || '').toUpperCase()) return null;
  const m = String(candidate.url || '').match(/(\d{7,9})/);
  return m ? m[1] : null;
}

/* ---------- оркестратор ----------
   Статуси: found (запис підтверджений), absent (джерела ВІДПОВІЛИ і запису
   нема), unknown/source_unreachable (вся ланка відвалилась по блокуваннях
   чи таймаутах: не караємо машину за наш неробочий доступ) */
export async function findAuctionRecord(vin, nhtsa, opts = {}, cfg = AUCTION_CONFIG) {
  const t0 = Date.now();
  const disco = await discoverVinCandidates(vin, opts, cfg);
  const diagnostics = [...disco.diagnostics];

  /* заблокований discovery-endpoint bid.cars: ОДИН платний виклик пошуку
     дозволений ЛИШЕ коли Serper/інші кроки не дали жодного historical-
     кандидата (не палимо кредити, коли реальний lot URL уже знайдено).
     Це discovery, тому justification: discovery_blocked */
  const bidDiag = disco.diagnostics.find(d => d.source === 'bid.cars' && d.step === 'discovery');
  const hasHistoricalCandidate = disco.candidates.some(c => !c.synthetic && (c.known_historical || !/^serper:/.test(c.source) && c.source !== 'search' && !/^search:/.test(c.source)));
  if (bidDiag && bidDiag.outcome === 'blocked' && !hasHistoricalCandidate
    && opts.allowPaid !== false && process.env.ZENROWS_API_KEY) {
    const zd = await zenrowsFetch(cfg.SOURCES[0].searchUrl(String(vin).toUpperCase()), { missing_reason: 'discovery_blocked', missing_fact_required: true }, opts, cfg);
    if (!zd.skipped && zd.status === 200) {
      try {
        const j = JSON.parse(zd.body);
        if (j && j.url && cfg.SOURCES[0].lotUrlPattern.test(j.url) && !disco.candidates.some(c => c.url === j.url)) {
          disco.candidates.unshift({ source: 'bid.cars', url: j.url });
          bidDiag.outcome = 'candidate';
          bidDiag.found = true;
          diagnostics.push({ source: 'bid.cars', step: 'discovery_unblock', status: 200, found: true, paid: true, ms: 0 });
          console.log('[auction] source=bid.cars step=discovery_unblock кандидат через zenrows');
        }
      } catch (e) { /* JSON не розпарсився: лишається blocked */ }
    }
  }
  /* СТРОГИЙ absent: рахується лише коли КОЖНЕ джерело ланцюга успішно
     відповіло відсутністю запису. Ранній вихід дозволений лише при found.
     Будь-який таймаут, блокування чи нерозпарсена відповідь хоч одного
     джерела = source_unreachable, стеля не чіпається */
  const outcomes = {};
  for (const d of disco.diagnostics) outcomes[d.source] = d.outcome;

  for (const cand of disco.candidates) {
    if (Date.now() - t0 > (opts.totalBudgetMs || cfg.TOTAL_BUDGET_MS)) { outcomes[cand.source] = 'unreachable'; continue; }
    const d = { source: cand.source, step: 'lot', url: cand.url, status: null, blocked: false, found: false, ms: 0 };
    const ts = Date.now();
    try {
      const r = await fetchText(cand.url, opts);
      d.status = r.status;
      d.blocked = r.blocked;
      if (r.blocked) outcomes[cand.source] = 'blocked';
      else if (r.status !== 200) outcomes[cand.source] = 'unreachable';
      if (!r.blocked && r.status === 200) {
        const identity = verifyLotIdentity({ url: cand.url, html: r.body }, vin, nhtsa);
        d.identity = identity.matched ? (identity.confidence || 'high') : identity.reason;
        /* сторінка відповіла, але це не наш запис: джерело чесно "нема".
           Для кандидатів довільних доменів ідентичність це ЄДИНИЙ гейт */
        outcomes[cand.source] = identity.matched ? 'found' : 'not_found';
        /* ідентичність підтверджена, але сторінка мусить бути АУКЦІОННИМ
           записом: дім, лот або аукціонні damage-поля. Довільна сторінка з
           VIN (лістинг, каталог без аукціонного контенту) found не дає */
        if (identity.matched) {
          const metaProbe = extractLotMeta(r.body, cand.url, vin);
          if (!metaProbe.auction_house && !metaProbe.lot_id && !metaProbe.primary_damage) {
            outcomes[cand.source] = 'not_found';
            d.identity = (d.identity || 'high') + '+no_auction_content';
            d.ms = Date.now() - ts;
            console.log('[auction] source=' + cand.source, 'step=lot VIN ok, але не аукціонний запис');
            diagnostics.push(d);
            continue;
          }
          d.found = true;
          const photoUrls = [...new Set([...r.body.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi)]
            .map(m => m[0]).filter(u => (u.toUpperCase().includes(String(vin).toUpperCase()) || /(copart|iaai|bid\.car|bidfax|poctra)/i.test(u)) && !/logo|icon|favicon|sprite|flag|thumb/i.test(u)))];
          d.ms = Date.now() - ts;
          diagnostics.push(d);
          console.log('[auction] source=' + cand.source, 'step=lot', 'status=200 found identity=' + d.identity, d.ms + 'ms');
          /* ранній вихід законний ЛИШЕ при found */
          const meta = extractLotMeta(r.body, cand.url, vin);
          /* кадри зі structured-блоку цього VIN мають провенанс за
             побудовою і зазвичай відкриваються прямо: ставимо їх ПЕРШИМИ */
          const ldPhotos = meta.jsonld_photos || [];
          const rec = {
            status: 'found',
            source: cand.source,
            lot_url: cand.url,
            identity,
            meta,
            photo_urls: [...new Set([...ldPhotos, ...photoUrls])].slice(0, cfg.MAX_PHOTOS),
            jsonld_photos: ldPhotos,
            sources_checked: sourcesChecked(outcomes, cfg),
            diagnostics,
            total_ms: Date.now() - t0,
          };
          /* провенанс-verified фото недостатньо: photos_low_quality дозволяє
             один платний добір VIN-specific кадрів exact-lot. Рахуємо саме
             provenance-verified: generic-галерея (americamotors cs.copart) у
             Vision не йде, тож 10 чужих кадрів не рахуються за достатні */
          const verified = rec.photo_urls.filter(u => photoHasProvenance(u, vin, rec.meta?.lot_id)).length;
          if (verified < cfg.ZENROWS_MIN_FREE_PHOTOS && opts.allowPaid !== false && process.env.ZENROWS_API_KEY) {
            const alt = disco.candidates.find(c => c.url !== cand.url && (c.source === 'bid.cars' || /bid\.cars/.test(c.url)));
            if (alt) {
              const reason = verified ? 'photos_low_quality' : 'photos_unavailable';
              const z = await zenrowsFetch(alt.url, { missing_reason: reason, missing_fact_required: true }, opts, cfg);
              if (!z.skipped && z.status === 200) {
                const id2 = verifyLotIdentity({ url: alt.url, html: z.body }, vin, nhtsa);
                if (id2.matched) {
                  /* VIN-specific фото exact-lot: сильний провенанс */
                  const more = [...new Set([...z.body.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi)]
                    .map(m => m[0]).filter(u => photoHasProvenance(u, vin, rec.meta?.lot_id) && !/logo|icon|favicon|sprite|flag|thumb/i.test(u)))];
                  rec.photo_urls = [...new Set([...more, ...rec.photo_urls])].slice(0, cfg.MAX_PHOTOS);
                  /* сторінку вже отримано з необхідної причини: беремо достовірні
                     metadata (подушки, damage) без окремого запиту */
                  const m2 = extractLotMeta(z.body, alt.url, vin);
                  rec.meta = { ...rec.meta, airbags: rec.meta?.airbags || m2.airbags, primary_damage: rec.meta?.primary_damage || m2.primary_damage, secondary_damage: rec.meta?.secondary_damage || m2.secondary_damage, lot_id: rec.meta?.lot_id || m2.lot_id };
                  rec.paid = { provider: 'zenrows', reason, calls: z.calls, credits: z.credits };
                }
              }
            }
          }
          return rec;
        }
      }
    } catch (e) {
      d.status = 'error';
      d.error = String(e.message || e).slice(0, 80);
      outcomes[cand.source] = 'unreachable';
    }
    d.ms = Date.now() - ts;
    console.log('[auction] source=' + cand.source, 'step=lot', 'status=' + d.status,
      d.blocked ? 'BLOCKED' : 'identity=' + (d.identity || 'no'), d.ms + 'ms');
    diagnostics.push(d);
  }

  /* Остання сходинка: ZenRows. Запис ОЧІКУВАНО існує (discovery дав
     кандидатів з точним VIN), безкоштовні способи вичерпані, фото і факти
     інакше не отримати: photos_unavailable. Один найперспективніший URL */
  if (disco.candidates.length && opts.allowPaid !== false && process.env.ZENROWS_API_KEY) {
    const best = disco.candidates.find(c => c.source === 'bid.cars' || /bid\.cars/.test(c.url)) || disco.candidates[0];
    const z = await zenrowsFetch(best.url, { missing_reason: 'photos_unavailable', missing_fact_required: true }, opts, cfg);
    if (!z.skipped && z.status === 200) {
      const identity = verifyLotIdentity({ url: best.url, html: z.body }, vin, nhtsa);
      const metaZ = identity.matched ? extractLotMeta(z.body, best.url, vin) : null;
      if (identity.matched && metaZ && (metaZ.auction_house || metaZ.lot_id || metaZ.primary_damage)) {
        const photoUrls = [...new Set([...z.body.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi)]
          .map(m => m[0]).filter(u => (u.toUpperCase().includes(String(vin).toUpperCase()) || /(copart|iaai|bid\.car|bidfax|poctra)/i.test(u)) && !/logo|icon|favicon|sprite|flag|thumb/i.test(u)))];
        outcomes[best.source] = 'found';
        return {
          status: 'found',
          source: best.source,
          lot_url: best.url,
          identity,
          meta: metaZ,
          photo_urls: photoUrls.slice(0, cfg.MAX_PHOTOS),
          paid: { provider: 'zenrows', reason: 'photos_unavailable', calls: z.calls, credits: z.credits },
          sources_checked: sourcesChecked(outcomes, cfg),
          diagnostics,
          total_ms: Date.now() - t0,
        };
      }
      console.log('[zenrows] сторінка отримана, але ідентичність не пройдена:', identity.reason);
    }
  }

  const checked = sourcesChecked(outcomes, cfg);
  const allAnsweredNo = checked.length > 0 && checked.every(c => c.status === 'not_found');
  return {
    status: allAnsweredNo ? 'absent' : 'unknown',
    reason: allAnsweredNo ? 'sources_answered_no_record' : 'source_unreachable',
    sources_checked: checked,
    diagnostics,
    total_ms: Date.now() - t0,
  };
}

/* ---------- історичні фото: транспорт до Vision ----------
   Захищені CDN (mercury.bid.cars, pluto.bid.car) віддають Cloudflare-
   челендж на прямий запит, тому Vision НІКОЛИ не зможе відкрити такий URL
   сам. Тягнемо БАЙТИ на сервері і віддаємо їх Vision як bytes/base64.
   Лестниця на КОЖЕН кадр: (A) прямий серверний fetch, (B) ZenRows на сам
   IMAGE URL у найдешевшому режимі, (C) ZenRows premium_proxy.
   Порядок кандидатів: спершу пробуємо ВСІ вільні URL прямим шляхом і
   платимо лише за брак кадрів. HTTP 200 з HTML-челенджем зображенням НЕ
   вважається: перевіряємо content-type і магічні байти */
export function dedupePhotoUrls(urls) {
  const byId = new Map();
  for (const u of (urls || [])) {
    if (typeof u !== 'string' || !/^https?:\/\//.test(u)) continue;
    let id;
    try { id = new URL(u).pathname.split('/').filter(Boolean).pop().toLowerCase(); } catch (e) { id = u.toLowerCase(); }
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(u);
  }
  /* один кадр = один запис із дзеркалами-альтернативами */
  return [...byId.entries()].map(([id, mirrors]) => ({ id, mirrors }));
}

function pickSpread(items, k) {
  if (items.length <= k) return items;
  const out = [];
  for (let i = 0; i < k; i++) out.push(items[Math.round(i * (items.length - 1) / (k - 1))]);
  return [...new Set(out)];
}

async function tryImage(url, opts, cfg, mode) {
  const cost = { calls: 0, credits: 0 };
  let body = null, status = null, type = '';
  try {
    if (mode === 'direct') {
      const fetchImpl = opts.fetchImpl || fetch;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), opts.timeoutMs || cfg.FETCH_TIMEOUT_MS);
      let r;
      try { r = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': UA, accept: 'image/*' } }); } finally { clearTimeout(t); }
      status = r.status;
      type = String(r.headers?.get?.('content-type') || '');
      if (r.ok) body = Buffer.from(await r.arrayBuffer());
    } else {
      const z = await zenrowsImage(url, opts, cfg, mode === 'premium');
      cost.calls = z.calls || 0;
      cost.credits = z.credits || 0;
      status = z.status;
      type = z.type || '';
      body = z.buf || null;
    }
  } catch (e) { status = 'error'; }
  /* валідація: тип, магічні байти, розмір. HTML-челендж відкидається */
  if (!body || !Buffer.isBuffer(body) || body.length < 12) return { ok: false, reason: 'no_bytes', status, cost };
  if (type && !/^image\//i.test(type) && !/octet-stream/i.test(type)) return { ok: false, reason: 'not_image_type', status, cost };
  if (!IMG_MAGIC(body)) return { ok: false, reason: 'bad_signature', status, cost };
  if (body.length > cfg.VISION_PHOTO_MAX_BYTES) return { ok: false, reason: 'too_large', status, cost };
  return { ok: true, buf: body, type: /^image\//i.test(type) ? type : 'image/jpeg', status, cost };
}

export async function zenrowsImage(targetUrl, opts = {}, cfg = AUCTION_CONFIG, premium = false) {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) return { skipped: 'no_api_key', calls: 0, credits: 0 };
  const fetchImpl = opts.zenrowsFetchImpl || fetch;
  /* для прямого image URL js_render НЕ потрібен: тягнемо байти */
  const api = 'https://api.zenrows.com/v1/?apikey=' + encodeURIComponent(key)
    + '&url=' + encodeURIComponent(targetUrl) + (premium ? '&premium_proxy=true' : '');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.zenrowsTimeoutMs || 45000);
  try {
    const r = await fetchImpl(api, { signal: ctl.signal });
    const type = String(r.headers?.get?.('content-type') || '');
    const buf = Buffer.from(await r.arrayBuffer());
    const cost = r.headers?.get?.('x-request-cost');
    return { status: r.status, type, buf, calls: 1, credits: cost ? Number(cost) : (premium ? 25 : 1) };
  } catch (e) {
    return { status: 'error', calls: 1, credits: premium ? 25 : 1 };
  } finally { clearTimeout(t); }
}

export async function fetchHistoricalPhotos(urls, opts = {}, cfg = AUCTION_CONFIG) {
  const frames = dedupePhotoUrls(urls);
  const picked = pickSpread(frames, opts.max || cfg.VISION_PHOTOS_MAX);
  const stats = { discovered: frames.length, attempted: picked.length, direct_ok: 0, direct_fail: 0, zen_basic: 0, zen_premium: 0, credits: 0, failed: [] };
  const photos = [];
  /* ФАЗА 1: усе, що відкривається безкоштовно (будь-яке дзеркало кадру) */
  const unresolved = [];
  for (const f of picked) {
    let done = null;
    for (const u of f.mirrors) {
      const r = await tryImage(u, opts, cfg, 'direct');
      if (r.ok) { done = { url: u, buf: r.buf, type: r.type, via: 'direct' }; break; }
      stats.direct_fail++;
    }
    if (done) { stats.direct_ok++; photos.push(done); } else unresolved.push(f);
  }
  /* ФАЗА 2: платимо лише за брак кадрів і лише за найдешевшим режимом */
  const wantMin = Math.min(opts.min || 3, picked.length);
  if (photos.length < wantMin && opts.allowPaid !== false && process.env.ZENROWS_API_KEY) {
    for (const f of unresolved) {
      if (photos.length >= wantMin) break;
      let done = null;
      for (const mode of ['basic', 'premium']) {
        for (const u of f.mirrors) {
          const r = await tryImage(u, opts, cfg, mode);
          stats.credits += r.cost.credits;
          if (mode === 'basic') stats.zen_basic += r.cost.calls; else stats.zen_premium += r.cost.calls;
          if (r.ok) { done = { url: u, buf: r.buf, type: r.type, via: 'zenrows_' + mode }; break; }
        }
        if (done) break;
      }
      if (done) photos.push(done); else stats.failed.push(f.id);
    }
  } else {
    for (const f of unresolved) stats.failed.push(f.id);
  }
  console.log('[auction] historical photos: discovered=' + stats.discovered, 'direct_ok=' + stats.direct_ok,
    'zen_basic=' + stats.zen_basic, 'zen_premium=' + stats.zen_premium, 'used=' + photos.length, 'credits~=' + stats.credits);
  return { photos, stats };
}

/* ---------- ZenRows: СТРОГО останній fallback ----------
   Подвійна умова перед викликом: missing_reason із ЗАКРИТОГО білого списку
   І missing_fact_required === true. Відсутність поля сама по собі не привід;
   need_damage_labels заборонена при якісних фото (їх аналізує vision).
   Один найперспективніший URL, не віялом. Ключ ЛИШЕ з env, ніколи не
   логується. Free plan: платний тариф не підключається */
export async function zenrowsFetch(targetUrl, justification, opts = {}, cfg = AUCTION_CONFIG) {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) return { skipped: 'no_api_key' };
  if (!justification || justification.missing_fact_required !== true
    || !cfg.ZENROWS_REASONS.includes(justification.missing_reason)) {
    return { skipped: 'justification_rejected' };
  }
  const fetchImpl = opts.zenrowsFetchImpl || fetch;
  const call = async params => {
    const api = 'https://api.zenrows.com/v1/?apikey=' + encodeURIComponent(key)
      + '&url=' + encodeURIComponent(targetUrl) + params;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.zenrowsTimeoutMs || 90000);
    try {
      const r = await fetchImpl(api, { signal: ctl.signal });
      const body = await r.text();
      return { status: r.status, body, cost: r.headers?.get?.('x-request-cost') || null };
    } catch (e) {
      return { status: 'error', body: '', error: String(e.message || e).slice(0, 60) };
    } finally { clearTimeout(t); }
  };
  /* SPA-джерела (bid.cars) без js_render віддають порожній каркас: для них
     ОДИН запит одразу з рендером. Решта: дешевий базовий, ескалація лише за
     потреби. Так одна платна сходинка дає повну сторінку */
  const spa = opts.allowSlowEnrich && /bid\.cars|bidfax|poctra/i.test(String(targetUrl));
  let calls = 1;
  let r = spa ? await call('&js_render=true&premium_proxy=true') : await call('');
  let credits = r.cost ? Number(r.cost) : (spa ? 25 : 1);
  if (!spa && (r.status !== 200 || /just a moment|cf-chl/i.test(String(r.body).slice(0, 3000)))) {
    calls++;
    r = await call('&js_render=true&premium_proxy=true');
    credits += r.cost ? Number(r.cost) : 25;
  }
  console.log('[zenrows] reason=' + justification.missing_reason, 'url=' + String(targetUrl).slice(0, 80),
    'status=' + r.status, 'calls=' + calls, 'credits~=' + credits);
  return { status: r.status, body: r.body, calls, credits };
}

/* аудит опитування для score_breakdown_v2 і майбутнього блоку осей:
   по одному рядку на джерело ланцюга */
function sourcesChecked(outcomes, cfg) {
  return cfg.SOURCES.map(src => {
    const o = outcomes[src.name] || 'unreachable';
    return { source: src.name, status: o === 'candidate' ? 'unreachable' : o };
  });
}
