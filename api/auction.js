/* CalCar: автономний пошук аукціонного запису США за VIN.
   Роль модуля: знайти джерело, СТРОГО підтвердити ідентичність лота,
   витягнути метадані і фото в межах лімітів, чесно розрізнити
   "запису нема" і "джерела недоступні".
   Provider-agnostic: транспорт передається як opts.fetchImpl, тому парсери
   і пайплайн не залежать ні від пошуковика, ні від способу обходу
   антибота (прямий fetch, актор, scraping API: усе це лише fetchImpl). */

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
      searchUrl: vin => 'https://poctra.com/search/q?searchtext=' + vin,
      searchKind: 'html_links',
      lotUrlPattern: /^https:\/\/poctra\.com\/[a-z0-9\-\/]+$/i,
    },
  ],
  FETCH_TIMEOUT_MS: 12000,
  TOTAL_BUDGET_MS: 25000,
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
      || /just a moment|cf-chl|cloudflare|captcha|incapsula|attention required/i.test(body.slice(0, 4000));
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

  const head = norm(title + ' ' + h1 + ' ' + String(page.url || ''));
  const make = norm(nhtsa && nhtsa.Make);
  const model = norm(nhtsa && nhtsa.Model);
  if (make && !head.includes(make)) return { matched: false, reason: 'make_mismatch' };
  if (model) {
    /* модель збігається, якщо хоч один змістовний токен моделі є в заголовку */
    const tokens = model.split(' ').filter(x => x.length >= 2);
    if (tokens.length && !tokens.some(tk => head.includes(tk))) {
      return { matched: false, reason: 'model_mismatch' };
    }
  }
  let confidence = 'high';
  const nYear = parseInt(nhtsa && nhtsa.ModelYear, 10);
  const pYear = parseInt((title + ' ' + h1).match(/\b(19|20)\d{2}\b/)?.[0], 10);
  if (nYear && pYear && Math.abs(nYear - pYear) > AUCTION_CONFIG.YEAR_TOLERANCE) {
    confidence = 'reduced';
  }
  return { matched: true, confidence, year_page: pYear || null, year_vin: nYear || null };
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
export async function discoverVinCandidates(vin, opts = {}, cfg = AUCTION_CONFIG) {
  const V = String(vin || '').toUpperCase();
  const out = [];
  const diag = [];
  const t0 = Date.now();
  for (const src of cfg.SOURCES) {
    const url = src.searchUrl(V);
    const d = { source: src.name, step: 'discovery', url, status: null, blocked: false, found: false, ms: 0 };
    const ts = Date.now();
    try {
      const r = await fetchText(url, opts);
      d.status = r.status;
      d.blocked = r.blocked;
      if (!r.blocked && r.status === 200) {
        if (src.searchKind === 'json_lot_url') {
          try {
            const j = JSON.parse(r.body);
            if (j && j.url && src.lotUrlPattern.test(j.url)) { out.push({ source: src.name, url: j.url }); d.found = true; }
          } catch (e) { /* не JSON: кандидата нема */ }
        } else {
          /* точний VIN у href в межах домену джерела */
          for (const m of r.body.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
            if (m[1].toUpperCase().includes(V) && src.lotUrlPattern.test(m[1])) {
              out.push({ source: src.name, url: m[1] });
              d.found = true;
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
      d.blocked ? 'BLOCKED' : (d.found ? 'found' : 'not_found'), d.ms + 'ms');
    diag.push(d);
  }
  return { candidates: out, diagnostics: diag, discovery_ms: Date.now() - t0 };
}

/* ---------- оркестратор ----------
   Статуси: found (запис підтверджений), absent (джерела ВІДПОВІЛИ і запису
   нема), unknown/source_unreachable (вся ланка відвалилась по блокуваннях
   чи таймаутах: не караємо машину за наш неробочий доступ) */
export async function findAuctionRecord(vin, nhtsa, opts = {}, cfg = AUCTION_CONFIG) {
  const t0 = Date.now();
  const disco = await discoverVinCandidates(vin, opts, cfg);
  const diagnostics = [...disco.diagnostics];
  let answered = disco.diagnostics.some(d => !d.blocked && d.status === 200);

  for (const cand of disco.candidates) {
    if (Date.now() - t0 > (opts.totalBudgetMs || cfg.TOTAL_BUDGET_MS)) break;
    const d = { source: cand.source, step: 'lot', url: cand.url, status: null, blocked: false, found: false, ms: 0 };
    const ts = Date.now();
    try {
      const r = await fetchText(cand.url, opts);
      d.status = r.status;
      d.blocked = r.blocked;
      if (!r.blocked && r.status === 200) {
        answered = true;
        const identity = verifyLotIdentity({ url: cand.url, html: r.body }, vin, nhtsa);
        d.identity = identity.matched ? (identity.confidence || 'high') : identity.reason;
        if (identity.matched) {
          d.found = true;
          const photoUrls = [...new Set([...r.body.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi)]
            .map(m => m[0]).filter(u => u.toUpperCase().includes(String(vin).toUpperCase()) || /(copart|iaai|bid\.car|bidfax|poctra)/i.test(u)))];
          d.ms = Date.now() - ts;
          diagnostics.push(d);
          console.log('[auction] source=' + cand.source, 'step=lot', 'status=200 found identity=' + d.identity, d.ms + 'ms');
          return {
            status: 'found',
            source: cand.source,
            lot_url: cand.url,
            identity,
            photo_urls: photoUrls.slice(0, cfg.MAX_PHOTOS),
            diagnostics,
            total_ms: Date.now() - t0,
          };
        }
      }
    } catch (e) {
      d.status = 'error';
      d.error = String(e.message || e).slice(0, 80);
    }
    d.ms = Date.now() - ts;
    console.log('[auction] source=' + cand.source, 'step=lot', 'status=' + d.status,
      d.blocked ? 'BLOCKED' : 'identity=' + (d.identity || 'no'), d.ms + 'ms');
    diagnostics.push(d);
  }

  return {
    status: answered ? 'absent' : 'unknown',
    reason: answered ? 'sources_answered_no_record' : 'source_unreachable',
    diagnostics,
    total_ms: Date.now() - t0,
  };
}
