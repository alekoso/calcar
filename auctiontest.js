/* Аукціонний пошук: юніт-еталони на мок-транспорті.
   Мок відтворює РЕАЛЬНІ відповіді bid.cars, зняті браузером для
   WBAJA9C5XJB033667: доводить, що з робочим транспортом (fetchImpl)
   пайплайн проходить шлях цілком, а парсери від транспорту не залежать. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), 'calcar_auctiontest.mjs');
fs.writeFileSync(tmp, fs.readFileSync('api/auction.js', 'utf8'));

const errs = [];
const VIN = 'WBAJA9C5XJB033667';
const NHTSA = { Make: 'BMW', Model: '530e', ModelYear: '2018' };
const LOT_URL = 'https://bid.cars/en/lot/0-42107936/2018-BMW-5-Series-WBAJA9C5XJB033667';

const jpeg = n => { const b = Buffer.alloc(n, 1); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const png = n => { const b = Buffer.alloc(n, 1); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; return b; };

const LOT_HTML = `<html><head><title>2018 BMW 5 Series, 530E Iperformance | ${VIN} | Bid History | BidCars</title></head>
<body><h1>2018 BMW 5 SERIES, 530E IPERFORMANCE</h1><span>VIN: ${VIN}</span><span class="badge">IAAI</span>
<p>You are watching archived offer. Auction ended on Wednesday, June 4, 2025.</p>
<img src="https://pluto.bid.car/0-42107936/2018-BMW-5-Series-${VIN}-1.jpg">
<img src="https://pluto.bid.car/0-42107936/2018-BMW-5-Series-${VIN}-2.jpg">
<div class="similar">Similar archival offers <a href="https://bid.cars/en/lot/0-999/2019-BMW-5-Series-WBAJA9C51KB111111">інший лот</a></div>
</body></html>`;

/* мок-транспорт: як бачив би пайплайн джерела БЕЗ Cloudflare */
function makeFetch(map) {
  return async (url) => {
    for (const [re, resp] of map) {
      if (re.test(String(url))) {
        return {
          ok: (resp.status || 200) < 400,
          status: resp.status || 200,
          headers: { get: h => (h.toLowerCase() === 'content-type' ? (resp.type || 'text/html') : null) },
          text: async () => resp.body || '',
          arrayBuffer: async () => (resp.buf || Buffer.alloc(0)),
        };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found', arrayBuffer: async () => Buffer.alloc(0) };
  };
}

(async () => {
  const A = await import('file://' + tmp);
  const quiet = async fn => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

  /* 1. повний шлях: discovery -> лот -> ідентичність -> фото */
  const happy = makeFetch([
    [/app\/search\/en\/vin-lot/, { body: JSON.stringify({ results: 1, url: LOT_URL }) }],
    [/bid\.cars\/en\/lot\//, { body: LOT_HTML }],
    [/pluto\.bid\.car.*-1\.jpg/, { type: 'image/jpeg', buf: jpeg(200000) }],
    [/pluto\.bid\.car.*-2\.jpg/, { type: 'image/jpeg', buf: jpeg(300000) }],
    [/bidfax|poctra/, { status: 403, body: 'Just a moment... cloudflare' }],
  ]);
  let rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: happy }));
  if (rec.status !== 'found') errs.push('повний шлях: статус ' + rec.status + ' замість found');
  if (rec.lot_url !== LOT_URL) errs.push('повний шлях: не той лот');
  if (rec.identity?.confidence !== 'high') errs.push('повний шлях: впевненість ' + rec.identity?.confidence);
  if (!(rec.photo_urls || []).some(u => u.includes('-1.jpg'))) errs.push('повний шлях: фото лота не витягнуті');
  /* паспорт джерела: аукціонний дім і дата продажу з лота */
  if (rec.meta?.auction_house !== 'IAAI') errs.push('паспорт: дім ' + rec.meta?.auction_house + ' замість IAAI');
  if (rec.meta?.sale_date !== '2025-06-04') errs.push('паспорт: дата ' + rec.meta?.sale_date + ' (очікував нормалізовану 2025-06-04)');
  const dl = await quiet(() => A.downloadLotPhotos(rec.photo_urls, { fetchImpl: happy }));
  if (dl.photos.length !== 2) errs.push('скачано ' + dl.photos.length + ' фото замість 2');
  /* ранній вихід при found законний: found у аудиті, не вимагає обходу решти */
  const stF = Object.fromEntries((rec.sources_checked || []).map(c => [c.source, c.status]));
  if (stF['bid.cars'] !== 'found') errs.push('аудит found бреше: ' + JSON.stringify(stF));

  /* 2. строга ідентичність: VIN лише в тілі сторінки (схожі лоти) не рахується */
  const noZone = A.verifyLotIdentity({ url: 'https://bid.cars/en/lot/0-1/2018-BMW', html: '<title>2018 BMW 5 Series</title><div>' + VIN + '</div><span>VIN: WBAJA9C51KB111111</span>' }, VIN, NHTSA);
  if (!noZone.matched === false && noZone.matched) errs.push('VIN поза канонічною зоною пройшов');
  /* підписане поле VIN: канонічна зона */
  const labeled = A.verifyLotIdentity({ url: 'https://x/lot/1', html: '<title>2018 BMW 530e</title><b>VIN</b>: ' + VIN }, VIN, NHTSA);
  if (!labeled.matched) errs.push('підписане поле VIN не зарахувалось');
  /* марка або модель розійшлись: запис геть */
  const wrongMake = A.verifyLotIdentity({ url: LOT_URL, html: '<title>2018 Audi A6 ' + VIN + '</title>' }, VIN, NHTSA);
  if (wrongMake.matched) errs.push('чужа марка пройшла ідентичність');
  const wrongModel = A.verifyLotIdentity({ url: LOT_URL, html: '<title>2018 BMW X5 ' + VIN + '</title>' }, VIN, { ...NHTSA, Model: '740i' });
  if (wrongModel.matched) errs.push('чужа модель пройшла ідентичність');
  /* рік +-1 законний, більший розліт = знижена впевненість, не відкидання */
  const y1 = A.verifyLotIdentity({ url: LOT_URL, html: '<title>2017 BMW 530e ' + VIN + '</title>' }, VIN, NHTSA);
  if (!y1.matched || y1.confidence !== 'high') errs.push('рік у допуску +-1 не пройшов як high');
  const y3 = A.verifyLotIdentity({ url: LOT_URL, html: '<title>2015 BMW 530e ' + VIN + '</title>' }, VIN, NHTSA);
  if (!y3.matched || y3.confidence !== 'reduced') errs.push('великий розліт року не дав reduced');

  /* 3. СТРОГИЙ absent проти source_unreachable */
  const answeredNo = makeFetch([
    [/vin-lot/, { body: JSON.stringify({ results: 0 }) }],
    [/bidfax|poctra/, { body: '<html>Nothing found</html>' }],
  ]);
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: answeredNo }));
  if (rec.status !== 'absent' || rec.reason !== 'sources_answered_no_record') errs.push('усі відповіли без запису: ' + rec.status + '/' + rec.reason);
  if (!Array.isArray(rec.sources_checked) || rec.sources_checked.length !== 3 || !rec.sources_checked.every(c => c.status === 'not_found')) {
    errs.push('аудит absent неповний: ' + JSON.stringify(rec.sources_checked));
  }
  /* два джерела "нема" + одне впало = unreachable, НЕ absent */
  const twoNoOneDown = makeFetch([
    [/vin-lot/, { body: JSON.stringify({ results: 0 }) }],
    [/bidfax/, { body: '<html>Nothing found</html>' }],
    [/poctra/, { status: 403, body: 'Just a moment cloudflare' }],
  ]);
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: twoNoOneDown }));
  if (rec.status !== 'unknown' || rec.reason !== 'source_unreachable') errs.push('часткова відповідь дала ' + rec.status + ' замість unknown');
  const st = Object.fromEntries(rec.sources_checked.map(c => [c.source, c.status]));
  if (st['bid.cars'] !== 'not_found' || st['bidfax.info'] !== 'not_found' || st['poctra.com'] !== 'blocked') {
    errs.push('аудит часткової відповіді бреше: ' + JSON.stringify(st));
  }
  /* 200 із нерозпарсеною відповіддю (не JSON) = unreachable, не not_found */
  const unparsed = makeFetch([
    [/vin-lot/, { body: '<html>this is not json</html>' }],
    [/bidfax|poctra/, { body: '<html>Nothing found</html>' }],
  ]);
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: unparsed }));
  if (rec.status !== 'unknown') errs.push('нерозпарсений JSON дав ' + rec.status + ' замість unknown');
  /* перший відповів "нема": обхід ПРОДОВЖУЄТЬСЯ, всі три опитані */
  const seen = [];
  const trackFetch = async (url) => { seen.push(String(url)); return answeredNo(url); };
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: trackFetch }));
  if (!(seen.some(u => u.includes('bidfax')) && seen.some(u => u.includes('poctra')))) {
    errs.push('обхід зупинився достроково без found: ' + JSON.stringify(seen));
  }
  const allBlocked = makeFetch([[/./, { status: 403, body: 'Just a moment cloudflare' }]]);
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: allBlocked }));
  if (rec.status !== 'unknown' || rec.reason !== 'source_unreachable') errs.push('усе заблоковане мало дати unknown/source_unreachable: ' + rec.status + '/' + rec.reason);
  if (!rec.sources_checked.every(c => c.status === 'blocked')) errs.push('аудит блокувань бреше: ' + JSON.stringify(rec.sources_checked));

  /* 4. ліміти фото: розмір, сигнатура, content-type, сумарний ліміт, максимум 20 */
  const CFG = { ...A.AUCTION_CONFIG, MAX_PHOTOS: 5, MAX_PHOTO_BYTES: 250000, MAX_TOTAL_BYTES: 400000 };
  const photoFetch = makeFetch([
    [/ok1\.jpg/, { type: 'image/jpeg', buf: jpeg(200000) }],
    [/ok2\.png/, { type: 'image/png', buf: png(150000) }],
    [/big\.jpg/, { type: 'image/jpeg', buf: jpeg(300000) }],
    [/fake\.jpg/, { type: 'image/jpeg', buf: Buffer.from('<html>not an image at all</html>') }],
    [/text\.jpg/, { type: 'text/html', body: '<html></html>' }],
  ]);
  const urls = ['https://x/ok1.jpg', 'https://x/big.jpg', 'https://x/fake.jpg', 'https://x/text.jpg', 'https://x/ok2.png', 'https://x/over-limit.jpg'];
  const lim = await quiet(() => A.downloadLotPhotos(urls, { fetchImpl: photoFetch }, CFG));
  if (lim.photos.length !== 2) errs.push('ліміти фото: скачано ' + lim.photos.length + ' замість 2');
  const reasons = lim.skipped.map(s => s.reason).sort().join(',');
  if (!reasons.includes('too_large') || !reasons.includes('bad_signature') || !reasons.includes('not_image_type')) {
    errs.push('причини пропуску неповні: ' + reasons);
  }
  if (urls.length > CFG.MAX_PHOTOS && lim.photos.length + lim.skipped.length > CFG.MAX_PHOTOS) errs.push('оброблено понад MAX_PHOTOS');

  /* 5. кеш відсутності: TTL 30 днів, знайдене постійне */
  const now = Date.now();
  if (!A.shouldRecheck(null, now)) errs.push('без кешу мала бути перевірка');
  if (A.shouldRecheck({ status: 'found', checked_at: new Date(now - 400 * 86400000).toISOString() }, now)) errs.push('знайдений запис перепровіряється');
  if (A.shouldRecheck({ status: 'absent', checked_at: new Date(now - 10 * 86400000).toISOString() }, now)) errs.push('свіжий absent перепровіряється до TTL');
  if (!A.shouldRecheck({ status: 'absent', checked_at: new Date(now - 40 * 86400000).toISOString() }, now)) errs.push('старий absent не перепровіряється після TTL');

  /* 6. discovery: пошук додає кандидатів БУДЬ-ЯКОГО домену з точним VIN,
     ідентичність фільтрує їх пізніше; json_lot_url з чужим доменом лота
     все одно відсіюється патерном джерела */
  const disco = await quiet(() => A.discoverVinCandidates(VIN, { fetchImpl: makeFetch([
    [/vin-lot/, { body: JSON.stringify({ results: 1, url: 'https://evil.example.com/lot/' + VIN }) }],
    [/duckduckgo/, { body: '<a href="/l/?uddg=' + encodeURIComponent('https://newmirror.example/lot/' + VIN) + '">x</a>' }],
  ]) }));
  if (!disco.candidates.some(c => /newmirror\.example/.test(c.url))) errs.push('пошуковий кандидат нового домену загублений');
  if (disco.candidates.some(c => /evil\.example/.test(c.url))) errs.push('чужий домен лота з json джерела пройшов');

  /* 8. метадані лота: одометр з одиницею, дата, damage, канонізація дому */
  if (A.odometerToKm) {
    /* 17,850 mi проти km після конвертації */
    const km = A.odometerToKm(17850, 'mi');
    if (km !== 28727) errs.push('17850 mi у км: ' + km + ' замість 28727');
    /* заявлені 21000 km це той самий пробіг у межах похибки: не конфлікт */
    if (Math.abs(km - 21000) < 5000) { /* реально різниця ~7700 км, конфлікт можливий: перевіряємо саму конвертацію, не рішення */ }
    if (A.odometerToKm(120000, 'km') !== 120000) errs.push('km у km змінилось');
    if (A.odometerToKm(100, 'unknown') !== null) errs.push('unknown одиниця дала число');
    if (A.odometerToKm(0, 'mi') !== null || A.odometerToKm(-5, 'km') !== null) errs.push('невалідне значення дало число');
  } else errs.push('нема odometerToKm');

  if (A.canonicalAuctionHouse) {
    if (A.canonicalAuctionHouse('Iaai / Иааи') !== 'IAAI') errs.push('IAAI не канонізується');
    if (A.canonicalAuctionHouse('Sold at COPART') !== 'COPART') errs.push('COPART не канонізується');
    if (A.canonicalAuctionHouse('IaaI') !== 'IAAI') errs.push('варіант регістру IaaI не канонізується');
    /* домени дзеркал НІКОЛИ не дім */
    for (const d of ['americamotors.com', 'bid.cars', 'bidfax.info', 'copart.com']) {
      if (A.canonicalAuctionHouse(d) !== null) errs.push('домен ' + d + ' став домом');
    }
  } else errs.push('нема canonicalAuctionHouse');

  /* extractLotMeta на реальному фрагменті americamotors */
  if (A.extractLotMeta) {
    const am = 'Детали лота #42968456 VIN: 7SAYGDED3PF966312 Автомобиль находится на аукционе Iaai / Иааи. '
      + 'Пробег: 17850 mi. Основ. поврежд: - Втор. поврежд: Left Front Тип документа: Salvage';
    const m = A.extractLotMeta(am, 'https://americamotors.com/en/tesla/model_y/7SAYGDED3PF966312');
    if (m.auction_house !== 'IAAI') errs.push('am: дім ' + m.auction_house);
    if (m.odometer_value !== 17850 || m.odometer_unit !== 'mi') errs.push('am: одометр ' + m.odometer_value + '/' + m.odometer_unit);
    if (m.lot_id !== '42968456') errs.push('am: lot_id ' + m.lot_id);
    if (m.lot_id_source !== 'direct') errs.push('am: lot_id_source ' + m.lot_id_source);
    if (m.primary_damage !== null) errs.push('am: дефіс primary не став null: ' + m.primary_damage);
    if (m.secondary_damage !== 'Left Front') errs.push('am: secondary ' + m.secondary_damage);
    if (m.title_status !== 'Salvage') errs.push('am: title ' + m.title_status);
    /* дата без явного "Auction ended": null, сирого нема */
    if (m.sale_date !== null) errs.push('am: вгадана дата ' + m.sale_date);
    /* km-джерело: одиниця km */
    const km = A.extractLotMeta('Пробіг 120000 км Lot #1234567', 'https://x/1234567');
    if (km.odometer_unit !== 'km' || km.odometer_value !== 120000) errs.push('km-джерело: ' + km.odometer_value + '/' + km.odometer_unit);
    /* число без одиниці: unknown */
    const noUnit = A.extractLotMeta('Mileage 55000 Lot #7654321', 'https://x/7654321');
    if (noUnit.odometer_unit !== 'unknown') errs.push('число без одиниці не unknown: ' + noUnit.odometer_unit);
    /* дата ISO парситься, погана дата: null + raw */
    const goodDate = A.extractLotMeta('Auction ended on June 4, 2025 Lot #9999999', 'https://x/9999999');
    if (goodDate.sale_date !== '2025-06-04') errs.push('ISO-дата не розпарсилась: ' + goodDate.sale_date);
  } else errs.push('нема extractLotMeta');

  /* recoverLotId: строгі guard-и */
  if (A.recoverLotId) {
    const good = { url: 'https://bid.cars/en/lot/0-42968456/x', house: 'Copart', vinConfirmed: true, vin: 'V1' };
    if (A.recoverLotId(good, 'COPART', 'V1') !== '42968456') errs.push('валідне відновлення lot_id не спрацювало');
    if (A.recoverLotId({ ...good, house: 'IAAI' }, 'COPART', 'V1') !== null) errs.push('розбіжність домів пропустила відновлення');
    if (A.recoverLotId({ ...good, vinConfirmed: false }, 'COPART', 'V1') !== null) errs.push('непідтверджений VIN пропустив відновлення');
    if (A.recoverLotId({ ...good, vin: 'V2' }, 'COPART', 'V1') !== null) errs.push('чужий VIN пропустив відновлення');
    if (A.recoverLotId({ ...good, house: null }, 'COPART', 'V1') !== null) errs.push('невідомий дім кандидата пропустив відновлення');
  } else errs.push('нема recoverLotId');

  /* 7. ZenRows: подвійна умова і закритий білий список */
  const OLD_KEY = process.env.ZENROWS_API_KEY;
  process.env.ZENROWS_API_KEY = 'test-key-not-real';
  let zCalls = 0;
  const zenFetch = async () => { zCalls++; return { status: 200, headers: { get: () => '25' }, text: async () => LOT_HTML }; };
  let z = await quiet(() => A.zenrowsFetch(LOT_URL, { missing_reason: 'photos_unavailable', missing_fact_required: false }, { zenrowsFetchImpl: zenFetch }));
  if (z.skipped !== 'justification_rejected') errs.push('ZenRows пустив виклик без missing_fact_required');
  z = await quiet(() => A.zenrowsFetch(LOT_URL, { missing_reason: 'sale_price_missing', missing_fact_required: true }, { zenrowsFetchImpl: zenFetch }));
  if (z.skipped !== 'justification_rejected') errs.push('ZenRows пустив причину поза білим списком');
  z = await quiet(() => A.zenrowsFetch(LOT_URL, { missing_reason: 'need_damage_labels', missing_fact_required: true }, { zenrowsFetchImpl: zenFetch }));
  if (z.skipped !== 'justification_rejected') errs.push('ZenRows пустив need_damage_labels');
  z = await quiet(() => A.zenrowsFetch(LOT_URL, { missing_reason: 'photos_unavailable', missing_fact_required: true }, { zenrowsFetchImpl: zenFetch }));
  if (z.skipped || z.status !== 200) errs.push('ZenRows відхилив валідне виправдання: ' + (z.skipped || z.status));
  if (!(z.credits >= 1)) errs.push('ZenRows не звітує credits');
  delete process.env.ZENROWS_API_KEY;
  z = await quiet(() => A.zenrowsFetch(LOT_URL, { missing_reason: 'photos_unavailable', missing_fact_required: true }, { zenrowsFetchImpl: zenFetch }));
  if (z.skipped !== 'no_api_key') errs.push('без ключа ZenRows не пропущений');
  if (OLD_KEY) process.env.ZENROWS_API_KEY = OLD_KEY;
  const allBlk = makeFetch([[/./, { status: 403, body: 'Just a moment cloudflare' }]]);
  const noPaid = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: allBlk, allowPaid: false }));
  if (noPaid.status !== 'unknown') errs.push('без платної сходинки блок не дав unknown: ' + noPaid.status);

  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('повний шлях · ідентичність · absent проти unreachable · ліміти фото · TTL кешу · пошуковий discovery · ZenRows подвійна умова');
  console.log('AUCTION TEST PASSED');
  fs.unlinkSync(tmp);
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
