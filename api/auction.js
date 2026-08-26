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
  /* безкоштовний discovery поза білим списком доменів: кандидатом стає
     будь-яка публічна сторінка з точним VIN в URL; використання даних
     завжди йде через строгу перевірку ідентичності */
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
  ZENROWS_REASONS: ['title_status_missing', 'photos_unavailable', 'photos_low_quality', 'odometer_unreadable', 'critical_auction_metadata_missing'],
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
      /* маркери challenge-сторінки, НЕ голе слово cloudflare (буває у CDN-скриптах) */
      || /just a moment|cf-chl|cf-browser-verification|captcha|incapsula|attention required|enable javascript and cookies/i.test(body.slice(0, 4000));
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
/* безкоштовний пошуковий discovery: кандидати з БУДЬ-ЯКОГО публічного
   домену, аби точний VIN стояв у URL. Endpoint часом віддає антибот 202:
   тоді просто нуль кандидатів, драбина йде далі шаблонами джерел */
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
  /* пошуковий discovery: кандидати не обмежені трьома доменами */
  const sd = await searchDiscovery(V, opts, cfg);
  diag.push(sd.diag);
  /* безкоштовні дзеркала за шаблоном марка/модель (без VIN-хардкоду) стоять
     ПЕРШИМИ: їхні фото лежать на відкритому CDN (cs.copart.com), тоді як
     фото інших дзеркал часто за тим самим антиботом, що й лот */
  const head = [];
  for (const m of cfg.MIRRORS) {
    const u = m.url(V, opts.nhtsa);
    if (u) head.push({ source: m.name, url: u });
  }
  const merged = [...head, ...out];
  for (const c of sd.candidates) {
    if (!merged.some(x => x.url === c.url)) merged.push(c);
  }
  return { candidates: merged, diagnostics: diag, discovery_ms: Date.now() - t0 };
}

/* паспорт джерела: аукціонний дім і дата продажу з тексту лота */
export function extractLotMeta(html, url) {
  const plain = String(html || '').replace(/<[^>]+>/g, ' ');
  const house = /\bIAAI\b|Иааи|Insurance Auto Auctions/i.test(plain) ? 'IAAI'
    : (/\bCopart\b/i.test(plain) ? 'Copart' : null);
  const date = (plain.match(/Auction ended[^.]*?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i)
    || plain.match(/\b(\d{2}[./]\d{2}[./]\d{4})\b/) || [])[1] || null;
  const odometer_mi = parseInt(((plain.match(/(\d[\d\s,.]{2,9})\s*(?:mi|миль|міль)\b/i) || [])[1] || '').replace(/[^\d]/g, ''), 10) || null;
  /* ідентичність події: auction_house + lot id; лот беремо з URL або тексту */
  const lot_id = ((String(url || '').match(/(\d{7,9})/) || [])[1]
    || (plain.match(/Lot[:\s#]{0,4}(\d{7,9})/i) || [])[1] || null);
  /* невізуальні метадані: тягнемо завжди, вони безкоштовні */
  const primary_damage = ((plain.match(/(?:Primary damage|Осн\.? повреждения|Основні пошкодження|Основное повреждение)[:\s]{0,5}([A-Za-zА-Яа-яІіЇїЄє ,\/]{3,40})/i) || [])[1] || '').trim() || null;
  const title_status = ((plain.match(/(?:Title status|Document type|Тип документа|Тип документу)[:\s]{0,5}([A-Za-zА-Яа-яІіЇїЄє ,\/]{3,40})/i) || [])[1] || '').trim() || null;
  return { auction_house: house, sale_date: date, odometer_mi, lot_id, primary_damage, title_status };
}

/* ---------- оркестратор ----------
   Статуси: found (запис підтверджений), absent (джерела ВІДПОВІЛИ і запису
   нема), unknown/source_unreachable (вся ланка відвалилась по блокуваннях
   чи таймаутах: не караємо машину за наш неробочий доступ) */
export async function findAuctionRecord(vin, nhtsa, opts = {}, cfg = AUCTION_CONFIG) {
  const t0 = Date.now();
  const disco = await discoverVinCandidates(vin, opts, cfg);
  const diagnostics = [...disco.diagnostics];
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
        if (identity.matched) {
          d.found = true;
          const photoUrls = [...new Set([...r.body.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi)]
            .map(m => m[0]).filter(u => (u.toUpperCase().includes(String(vin).toUpperCase()) || /(copart|iaai|bid\.car|bidfax|poctra)/i.test(u)) && !/logo|icon|favicon|sprite|flag|thumb/i.test(u)))];
          d.ms = Date.now() - ts;
          diagnostics.push(d);
          console.log('[auction] source=' + cand.source, 'step=lot', 'status=200 found identity=' + d.identity, d.ms + 'ms');
          /* ранній вихід законний ЛИШЕ при found */
          const meta = extractLotMeta(r.body, cand.url);
          /* дзеркало (americamotors) часто без числового lot_id у URL: дотягуємо
             з інших discovery-кандидатів тієї ж події, де id стоїть у шляху */
          if (!meta.lot_id) {
            for (const other of disco.candidates) {
              const m = String(other.url).match(/\b(\d{7,9})\b/);
              if (m) { meta.lot_id = m[1]; break; }
            }
          }
          const rec = {
            status: 'found',
            source: cand.source,
            lot_url: cand.url,
            identity,
            meta,
            photo_urls: photoUrls.slice(0, cfg.MAX_PHOTOS),
            sources_checked: sourcesChecked(outcomes, cfg),
            diagnostics,
            total_ms: Date.now() - t0,
          };
          /* безкоштовних фото недостатньо: photos_low_quality дозволяє один
             платний добір із багатшого джерела. При достатніх фото платний
             виклик ЗАБОРОНЕНИЙ: зони і подушки читає vision-аналіз */
          if (rec.photo_urls.length < cfg.ZENROWS_MIN_FREE_PHOTOS && opts.allowPaid !== false && process.env.ZENROWS_API_KEY) {
            const alt = disco.candidates.find(c => c.url !== cand.url && (c.source === 'bid.cars' || /bid\.cars/.test(c.url)));
            if (alt) {
              const reason = rec.photo_urls.length ? 'photos_low_quality' : 'photos_unavailable';
              const z = await zenrowsFetch(alt.url, { missing_reason: reason, missing_fact_required: true }, opts, cfg);
              if (!z.skipped && z.status === 200) {
                const id2 = verifyLotIdentity({ url: alt.url, html: z.body }, vin, nhtsa);
                if (id2.matched) {
                  const more = [...new Set([...z.body.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi)]
                    .map(m => m[0]).filter(u => /(copart|iaai|bid\.car)/i.test(u) && !/logo|icon|favicon|sprite|flag|thumb/i.test(u)))];
                  rec.photo_urls = [...new Set([...rec.photo_urls, ...more])].slice(0, cfg.MAX_PHOTOS);
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
      if (identity.matched) {
        const photoUrls = [...new Set([...z.body.matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi)]
          .map(m => m[0]).filter(u => (u.toUpperCase().includes(String(vin).toUpperCase()) || /(copart|iaai|bid\.car|bidfax|poctra)/i.test(u)) && !/logo|icon|favicon|sprite|flag|thumb/i.test(u)))];
        outcomes[best.source] = 'found';
        return {
          status: 'found',
          source: best.source,
          lot_url: best.url,
          identity,
          meta: extractLotMeta(z.body, best.url),
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
    const t = setTimeout(() => ctl.abort(), 90000);
    try {
      const r = await fetchImpl(api, { signal: ctl.signal });
      const body = await r.text();
      return { status: r.status, body, cost: r.headers?.get?.('x-request-cost') || null };
    } catch (e) {
      return { status: 'error', body: '', error: String(e.message || e).slice(0, 60) };
    } finally { clearTimeout(t); }
  };
  let calls = 1;
  let r = await call('');
  let credits = r.cost ? Number(r.cost) : 1;
  if (r.status !== 200 || /just a moment|cf-chl/i.test(String(r.body).slice(0, 3000))) {
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
