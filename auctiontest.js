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
  /* точний VIN головніший за naming моделі: "540i" проти "5 Series 540 XI"
     НЕ відкидається (диагностований false negative), але позначається */
  const naming = A.verifyLotIdentity({ url: 'https://bid.cars/en/lot/1-49495925/2017-BMW-5-Series-' + VIN, html: '<title>2017 BMW 5 Series, 540 XI | ' + VIN + ' | Bid History</title>' }, VIN, { Make: 'BMW', Model: '540i', ModelYear: '2017' });
  if (!naming.matched) errs.push('540i проти "5 Series 540 XI" відкинуто: false negative лишився');
  if (naming.confidence !== 'reduced' || naming.model_naming_mismatch !== true) errs.push('naming-розбіжність не позначена: ' + JSON.stringify(naming));
  /* naming-розбіжність (X5 при декодованому 740i) при точному VIN: приймаємо
     зі зниженою впевненістю і прапорцем, НЕ мовчки довіряємо trim */
  const wrongModel = A.verifyLotIdentity({ url: LOT_URL, html: '<title>2018 BMW X5 ' + VIN + '</title>' }, VIN, { ...NHTSA, Model: '740i' });
  if (!wrongModel.matched || wrongModel.model_naming_mismatch !== true || wrongModel.confidence !== 'reduced') errs.push('naming-конфлікт не дав reduced+flag: ' + JSON.stringify(wrongModel));
  /* ІНШИЙ VIN на сторінці: reject як і раніше */
  const otherVin = A.verifyLotIdentity({ url: 'https://x/lot/2', html: '<title>2018 BMW 530e WBAJA9C51KB111111</title>' }, VIN, NHTSA);
  if (otherVin.matched) errs.push('чужий VIN пройшов ідентичність');
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

    /* статус пробігу: actual / not_actual / exempt / unknown */
    const actualM = A.extractLotMeta('Odometer: 17850 mi Actual Lot #1000001', 'https://x/1000001');
    if (actualM.odometer_status !== 'actual') errs.push('actual статус: ' + actualM.odometer_status);
    if (!actualM.odometer_status_raw) errs.push('actual raw порожній');
    const notActM = A.extractLotMeta('Odometer 55000 mi Not Actual Lot #1000002', 'https://x/1000002');
    if (notActM.odometer_status !== 'not_actual') errs.push('not_actual статус: ' + notActM.odometer_status);
    const tmuM = A.extractLotMeta('Mileage 90000 mi TMU Lot #1000003', 'https://x/1000003');
    if (tmuM.odometer_status !== 'not_actual') errs.push('TMU не not_actual: ' + tmuM.odometer_status);
    const exM = A.extractLotMeta('Odometer 120000 mi Exempt Lot #1000004', 'https://x/1000004');
    if (exM.odometer_status !== 'exempt') errs.push('exempt статус: ' + exM.odometer_status);
    const unkM = A.extractLotMeta('Mileage 21000 km Lot #1000005', 'https://x/1000005');
    if (unkM.odometer_status !== 'unknown') errs.push('без маркера статус не unknown: ' + unkM.odometer_status);
    if (unkM.odometer_status_raw !== null) errs.push('unknown статус має raw');
    const amStatus = A.extractLotMeta('Подтвержденный пробег в момент инспекции 17850 mi Lot #42968456', 'https://x/42968456');
    if (amStatus.odometer_status !== 'actual') errs.push('americamotors "Подтвержденный" не actual: ' + amStatus.odometer_status);
    /* airbags з metadata лота */
    const air = A.extractLotMeta('Primary Damage Right side Secondary Left front Airbag: Driver Lot #42968456', 'https://x/42968456');
    if (!air.airbags || air.airbags.deployed !== true) errs.push('Airbag: Driver не розпізнано deployed');
    if (air.airbags.raw.toLowerCase().indexOf('driver') === -1) errs.push('airbags raw без Driver');
    const airNone = A.extractLotMeta('Airbag: None Lot #1', 'https://x/1');
    if (!airNone.airbags || airNone.airbags.deployed !== false) errs.push('Airbag: None не false');
    const airAbsent = A.extractLotMeta('Odometer 100 mi Lot #2', 'https://x/2');
    if (airAbsent.airbags !== null) errs.push('без поля airbags не null');
  } else errs.push('нема extractLotMeta');

  /* image-level provenance: VIN або lot_id в URL пройде, generic ні */
  if (A.photoHasProvenance) {
    const VINp = '7SAYGDED3PF966312';
    if (!A.photoHasProvenance('https://mercury.bid.cars/0-42968456/2023-Tesla-Model-Y-7SAYGDED3PF966312-1.jpg', VINp, '42968456')) errs.push('VIN-specific фото не пройшло провенанс');
    if (!A.photoHasProvenance('https://x/lot/42968456/img.jpg', VINp, '42968456')) errs.push('lot_id у URL не пройшов провенанс');
    if (A.photoHasProvenance('https://cs.copart.com/v1/AUTH_svc.pdoc00001/LPP228/451e5121f3f144cf92a35b582dbb00ac_ful.jpg', VINp, '42968456')) errs.push('generic cs.copart без VIN пройшов провенанс');
    if (A.photoHasProvenance('https://x/photo.jpg', VINp, null)) errs.push('фото без VIN і lot_id пройшло провенанс');
  } else errs.push('нема photoHasProvenance');

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


  /* ===== Serper discovery: штатний general-крок ===== */
  process.env.SERPER_API_KEY = 'test-key-for-mock';
  const SERPER_LOT = 'https://bid.cars/en/lot/1-49495925/2017-BMW-5-Series-' + VIN;
  let serperCalls = 0;
  const serperOk = async (url, init) => {
    serperCalls++;
    return { status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ organic: [
      { link: SERPER_LOT, title: '2017 BMW 5 Series ' + VIN, snippet: 'salvage, front end, 98,997 mi' },
      { link: 'https://randomforum.example/thread/123', title: 'форум', snippet: 'бачив ' + VIN + ' в продажу' },
      { link: 'https://nothing.example/other', title: 'без VIN', snippet: 'просто сторінка' },
    ] }) };
  };
  const allBlockedT = makeFetch([[/./, { status: 403, body: 'Just a moment...' }]]);
  let discoT = await quiet(() => A.discoverVinCandidates(VIN, { fetchImpl: allBlockedT, serperFetchImpl: serperOk, nhtsa: NHTSA }));
  const urlsT = discoT.candidates.map(c => c.url);
  if (!urlsT.includes(SERPER_LOT)) errs.push('Serper-кандидат з точним VIN не зʼявився');
  if (!urlsT.includes('https://randomforum.example/thread/123')) errs.push('strong candidate за VIN у snippet не зʼявився');
  if (urlsT.includes('https://nothing.example/other')) errs.push('кандидат без VIN пройшов');
  /* ranking: реальний historical-кандидат ВИЩЕ шаблонного дзеркала */
  const iBid = urlsT.indexOf(SERPER_LOT);
  const iMirror = urlsT.findIndex(u => /americamotors/.test(u));
  if (iMirror >= 0 && iBid > iMirror) errs.push('шаблонне дзеркало вище реального historical-кандидата');
  if (serperCalls !== 1) errs.push('без extendedSearch мав бути 1 Serper-запит, а не ' + serperCalls);
  /* extended search: лише imported/gap і лише коли перший запит без historical */
  serperCalls = 0;
  const serperEmptyThenExt = async () => { serperCalls++; return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ organic: [] }) }; };
  await quiet(() => A.discoverVinCandidates(VIN, { fetchImpl: allBlockedT, serperFetchImpl: serperEmptyThenExt, nhtsa: NHTSA, extendedSearch: true }));
  if (serperCalls !== 2) errs.push('extendedSearch: мало бути 2 запити, а не ' + serperCalls);
  /* skipSerper (повтор по кешу): нуль викликів */
  serperCalls = 0;
  await quiet(() => A.discoverVinCandidates(VIN, { fetchImpl: allBlockedT, serperFetchImpl: serperOk, nhtsa: NHTSA, skipSerper: true }));
  if (serperCalls !== 0) errs.push('skipSerper не запобіг повторному Serper-виклику');

  /* ===== сніпет НЕ evidence: сторінка недоступна -> unreachable, нуль фактів ===== */
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: allBlockedT, serperFetchImpl: serperOk, allowPaid: false }));
  if (rec.status !== 'unknown' || rec.reason !== 'source_unreachable') errs.push('Serper-кандидат + blocked fetch: мав бути source_unreachable, а не ' + rec.status + '/' + rec.reason);
  if (rec.meta || (rec.photo_urls || []).length) errs.push('факти зі сніпета просочились без fetch');

  /* ===== 200-челендж (качки DDG) = blocked, не порожній пошук ===== */
  process.env.SERPER_API_KEY = '';
  const duckChallenge = makeFetch([
    [/duckduckgo/, { status: 200, body: '<html>DuckDuckGo Unfortunately, bots use DuckDuckGo too. Please complete the following challenge. Select all squares containing a duck</html>' }],
    [/./, { status: 403, body: 'Just a moment...' }],
  ]);
  discoT = await quiet(() => A.discoverVinCandidates(VIN, { fetchImpl: duckChallenge, nhtsa: NHTSA }));
  const ddgDiag = discoT.diagnostics.find(d => d.source === 'search');
  if (!ddgDiag || ddgDiag.blocked !== true) errs.push('200-челендж DDG не розпізнаний як blocked: ' + JSON.stringify(ddgDiag));
  process.env.SERPER_API_KEY = 'test-key-for-mock';

  /* ===== ZenRows для заблокованого discovery-endpoint bid.cars ===== */
  process.env.ZENROWS_API_KEY = 'test-zen';
  const serperEmpty = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ organic: [] }) });
  let zenUrls = [];
  const zenMock = async (apiUrl) => {
    zenUrls.push(decodeURIComponent(String(apiUrl)));
    if (/app%2Fsearch|app\/search/.test(String(apiUrl))) {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ results: 1, url: LOT_URL }) };
    }
    return { status: 200, headers: { get: () => null }, text: async () => LOT_HTML };
  };
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: allBlockedT, serperFetchImpl: serperEmpty, zenrowsFetchImpl: zenMock, allowSlowEnrich: true }));
  if (rec.status !== 'found') errs.push('discovery-unblock через ZenRows не знайшов лот: ' + rec.status + '/' + rec.reason);
  if (!zenUrls.some(u => /app\/search/.test(u))) errs.push('ZenRows не викликався для discovery-endpoint');
  /* коли Serper УЖЕ дав historical-кандидата: discovery-unblock НЕ палиться */
  zenUrls = [];
  const directLotOk = makeFetch([
    [/bid\.cars\/en\/lot\//, { body: LOT_HTML.replace(/0-42107936/g, '1-49495925') }],
    [/./, { status: 403, body: 'Just a moment...' }],
  ]);
  const serperBid = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ organic: [{ link: LOT_URL, title: VIN, snippet: '' }] }) });
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: directLotOk, serperFetchImpl: serperBid, zenrowsFetchImpl: zenMock }));
  if (rec.status !== 'found') errs.push('Serper-кандидат + прямий fetch лота: мав бути found');
  if (zenUrls.length) errs.push('ZenRows витрачено попри готового кандидата і успішний прямий fetch: ' + zenUrls.length);
  delete process.env.ZENROWS_API_KEY;
  delete process.env.SERPER_API_KEY;


  /* ===== сторінка оголошення і не-аукціонний контент не дають found ===== */
  process.env.SERPER_API_KEY = 'test-key-for-mock';
  const LISTING_URL = 'https://auto.ria.com/uk/auto_bmw_5-series_40359409.html';
  const serperListing = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ organic: [
    { link: LISTING_URL, title: 'BMW 530e 2018 ' + VIN, snippet: 'оголошення' },
    { link: 'https://somecatalog.example/vin/' + VIN, title: '2018 BMW 530e ' + VIN, snippet: 'каталог' },
  ] }) });
  const catalogPage = '<html><head><title>2018 BMW 530e ' + VIN + '</title></head><body>Просто каталожна сторінка без аукціонного контенту</body></html>';
  const listingFetch = makeFetch([
    [/somecatalog\.example/, { body: catalogPage }],
    [/auto\.ria\.com/, { body: '<html><head><title>2018 BMW 530e ' + VIN + '</title></head><body>оголошення</body></html>' }],
    [/./, { status: 403, body: 'Just a moment...' }],
  ]);
  rec = await quiet(() => A.findAuctionRecord(VIN, NHTSA, { fetchImpl: listingFetch, serperFetchImpl: serperListing, allowPaid: false, excludeUrl: LISTING_URL }));
  if (rec.status === 'found') errs.push('сторінка оголошення/каталог без аукціонного контенту дали found');
  const disco2 = await quiet(() => A.discoverVinCandidates(VIN, { fetchImpl: listingFetch, serperFetchImpl: serperListing, excludeUrl: LISTING_URL }));
  if (disco2.candidates.some(c => /auto\.ria\.com/.test(c.url))) errs.push('площадка оголошення лишилась кандидатом');
  delete process.env.SERPER_API_KEY;


  /* ===== історичні фото: транспорт байтів замість викидання URL ===== */
  const PROT = 'https://mercury.bid.cars/1-49495925/2017-BMW-5-Series-' + VIN + '-1.jpg';
  const PROT2 = 'https://pluto.bid.car/1-49495925/2017-BMW-5-Series-' + VIN + '-2.jpg';
  const FREE = 'https://copart.vincheck.by/v1/AUTH/lpp/0325/free-' + VIN + '.jpg';
  const CF_HTML = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-chl</body></html>';
  const imgResp = (buf, type) => ({ ok: true, status: 200, headers: { get: h => (h.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => buf, text: async () => '' });
  const htmlResp = (status, body) => ({ ok: status < 400, status, headers: { get: h => (h.toLowerCase() === 'content-type' ? 'text/html' : null) }, arrayBuffer: async () => Buffer.from(body), text: async () => body });

  /* 1+2. прямий 403 -> дозволений платний фолбек, байти приймаються */
  process.env.ZENROWS_API_KEY = 'test-zen';
  let zenImgCalls = [];
  const directBlocked = async () => htmlResp(403, CF_HTML);
  const zenImgOk = async (api) => { zenImgCalls.push(decodeURIComponent(String(api))); return imgResp(jpeg(90000), 'image/jpeg'); };
  let hp = await quiet(() => A.fetchHistoricalPhotos([PROT, PROT2], { fetchImpl: directBlocked, zenrowsFetchImpl: zenImgOk, min: 2 }));
  if (hp.photos.length !== 2) errs.push('захищені кадри не дістались через ZenRows: ' + hp.photos.length);
  if (!hp.photos.every(p => Buffer.isBuffer(p.buf) && p.via.startsWith('zenrows'))) errs.push('кадри повернулись не байтами');
  if (!zenImgCalls.every(u => /\.jpg/.test(u))) errs.push('ZenRows викликався не на IMAGE URL');
  if (zenImgCalls.some(u => /js_render/.test(u))) errs.push('для image URL увімкнувся зайвий js_render');
  if (hp.stats.zen_basic < 1) errs.push('не порахований дешевий режим');

  /* 3. HTTP 200 з Cloudflare-HTML НЕ є зображенням */
  const zenImgHtml = async () => htmlResp(200, CF_HTML);
  hp = await quiet(() => A.fetchHistoricalPhotos([PROT], { fetchImpl: directBlocked, zenrowsFetchImpl: zenImgHtml, min: 1 }));
  if (hp.photos.length !== 0) errs.push('HTML-челендж прийнятий як зображення');
  if (!hp.stats.failed.length) errs.push('невдалий кадр не позначений');

  /* 4. валідні JPEG-байти напряму приймаються */
  const directOk = async () => imgResp(jpeg(120000), 'image/jpeg');
  hp = await quiet(() => A.fetchHistoricalPhotos([FREE], { fetchImpl: directOk, min: 1 }));
  if (hp.photos.length !== 1 || hp.photos[0].via !== 'direct') errs.push('валідний прямий JPEG не прийнятий');

  /* 5. вільне джерело в пріоритеті: за нього не платимо */
  zenImgCalls = [];
  const mixed = async (u) => (/vincheck/.test(String(u)) ? imgResp(jpeg(100000), 'image/jpeg') : htmlResp(403, CF_HTML));
  hp = await quiet(() => A.fetchHistoricalPhotos([PROT, FREE, PROT2], { fetchImpl: mixed, zenrowsFetchImpl: zenImgOk, min: 1, max: 3 }));
  if (!hp.photos.some(p => p.via === 'direct')) errs.push('вільний кадр не використаний');
  if (hp.stats.credits > 0 && hp.photos.filter(p => p.via === 'direct').length >= 1 && hp.stats.zen_basic > 2) errs.push('заплатили більше, ніж потрібно, за наявності вільних кадрів');

  /* 6. усе недоступне -> нуль кадрів, жодних вигаданих даних */
  hp = await quiet(() => A.fetchHistoricalPhotos([PROT, PROT2], { fetchImpl: directBlocked, allowPaid: false }));
  if (hp.photos.length !== 0 || hp.stats.credits !== 0) errs.push('без платного шляху кадри взялись нізвідки');
  delete process.env.ZENROWS_API_KEY;

  /* дедуп дзеркал одного кадру */
  const dd = A.dedupePhotoUrls(['https://mercury.bid.cars/1-1/x-1.jpg', 'https://pluto.bid.car/1-1/x-1.jpg', 'https://mercury.bid.cars/1-1/x-2.jpg']);
  if (dd.length !== 2) errs.push('дзеркала одного кадру не злились: ' + dd.length);
  if (dd[0].mirrors.length !== 2) errs.push('дзеркала не збережені як альтернативи');

  /* ===== 7-11. VIN-scoped метадані ===== */
  const AGG = '<html><head>' +
    '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Vehicle', vehicleIdentificationNumber: VIN, name: '2018 BMW 530E', odometer: { value: '98997', unitCode: 'SMI' }, image: ['https://copart.vincheck.by/v1/AUTH/lpp/0325/a_hrs.jpg'] }) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Vehicle', vehicleIdentificationNumber: 'WBAJA9C51KB111111', name: '2019 BMW I4', odometer: { value: '12345', unitCode: 'SMI' }, image: ['https://vis.iaai.com/resizer?imageKeys=44352640'] }) + '</script>' +
    '</head><body><nav>лоти з США, дані аукціонів Copart і IAAI</nav>' +
    '<div class="lot">VIN: ' + VIN + ' пробіг 98 997 mi Primary damage Front end Secondary damage Side</div>' +
    '<div class="carousel">2019 BMW I4 WBAJA9C51KB111111 IAAI пробіг 12 345 mi Primary damage Rear end</div>' +
    '</body></html>';
  const aggMeta = A.extractLotMeta(AGG, 'https://vincheck.by/catalog/' + VIN, VIN);
  if (aggMeta.auction_house !== 'COPART') errs.push('exact-VIN JSON-LD Copart + чужа IAAI-карусель дали: ' + aggMeta.auction_house);
  if (aggMeta.field_provenance?.auction_house?.evidence_type !== 'json_ld_exact_vin') errs.push('провенанс платформи не json_ld_exact_vin');
  if (aggMeta.odometer_value !== 98997) errs.push('пробіг цільового VIN: ' + aggMeta.odometer_value);
  if (aggMeta.primary_damage !== 'Front end' || aggMeta.secondary_damage !== 'Side') errs.push('damage цільового VIN: ' + aggMeta.primary_damage + '/' + aggMeta.secondary_damage);
  if (/Rear/i.test(String(aggMeta.primary_damage))) errs.push('damage чужого авто просочився');
  if (aggMeta.field_provenance?.mileage?.value !== 98997) errs.push('провенанс пробігу відсутній');

  /* 8. навігаційний текст "Copart і IAAI" сам по собі платформу не визначає */
  const NAV_ONLY = '<html><body><nav>дані аукціонів Copart і IAAI</nav><div>VIN: ' + VIN + ' пробіг 50 000 mi</div></body></html>';
  const navMeta = A.extractLotMeta(NAV_ONLY, 'https://agg.example/x', VIN);
  if (navMeta.auction_house !== null) errs.push('навігаційний текст визначив платформу: ' + navMeta.auction_house);

  /* 9. немає надійних доказів -> null */
  const NOTHING = '<html><body><div>VIN: ' + VIN + ' просто сторінка</div></body></html>';
  if (A.extractLotMeta(NOTHING, 'https://agg.example/y', VIN).auction_house !== null) errs.push('без доказів платформа не null');

  /* 10. lot_id з bid.cars-URL виду /lot/1-49495925/ */
  const lr = A.parseLotRef('https://bid.cars/en/lot/1-49495925/2017-BMW-5-Series-' + VIN);
  if (lr.lot_id !== '49495925' || lr.raw_lot_reference !== '1-49495925') errs.push('lot_id bid.cars: ' + JSON.stringify(lr));
  if (lr.house_hint !== 'COPART') errs.push('перевірена конвенція префікса не дала Copart');
  if (A.parseLotRef('https://bid.cars/en/lot/0-42107936/x').house_hint !== 'IAAI') errs.push('префікс 0- не дав IAAI');
  /* старі прямі lot id не зламані */
  if (A.parseLotRef('https://poctra.com/lot/12345678').lot_id !== '12345678') errs.push('прямий lot_id зламаний');
  /* конвенція ЛИШЕ last-resort: structured evidence сильніша */
  const BIDLOT = '<html><head><title>2018 BMW 530e ' + VIN + '</title></head><body><script>var auctionType = \'IAAI\';</script><div>VIN: ' + VIN + '</div></body></html>';
  const bidMeta = A.extractLotMeta(BIDLOT, 'https://bid.cars/en/lot/1-49495925/x', VIN);
  if (bidMeta.auction_house !== 'IAAI') errs.push('labelled-поле мало перебити конвенцію префікса: ' + bidMeta.auction_house);

  /* кадри structured-блоку цього VIN: провенанс за побудовою, першими */
  if (!(aggMeta.jsonld_photos || []).some(u => /copart\.vincheck\.by/.test(u))) errs.push('кадри JSON-LD цього VIN не зібрані');
  const AGG_OTHER = AGG.replace('WBAJA9C51KB111111', 'WBAJA9C51KB111111');
  const sc = A.vinScopedRegions(AGG_OTHER, VIN);
  if (sc.single_lot_page !== false) errs.push('сторінка з чужим авто вважається одно-лотовою');
  if ((sc.jsonld_photos || []).some(u => /iaai/.test(u))) errs.push('кадри чужого авто просочились у скоуп');
  /* одно-лотова сторінка: скоуп = весь документ (поля лота далеко від VIN) */
  const SINGLE = '<html><head><title>2018 BMW 530e ' + VIN + '</title></head><body><div>' + 'x'.repeat(3000) + '</div><div>Primary damage Front end Secondary damage Side</div><div>VIN: ' + VIN + '</div></body></html>';
  const singleMeta = A.extractLotMeta(SINGLE, 'https://bid.cars/en/lot/1-49495925/x', VIN);
  if (singleMeta.primary_damage !== 'Front end') errs.push('одно-лотова сторінка: damage загубився через вузький скоуп: ' + singleMeta.primary_damage);
  /* damage з опису structured-блоку (vincheck-формат) */
  const LD_DESC = '<html><head><script type="application/ld+json">' + JSON.stringify({ '@type': 'Vehicle', vehicleIdentificationNumber: VIN, description: '2017 BMW 540 XI, VIN ' + VIN + ': фото лота, повреждения Front end , Side, пробег 98 997 mi', image: ['https://copart.vincheck.by/v1/a_hrs.jpg'] }) + '</script></head><body><div>VIN ' + VIN + '</div><div>WBAJA9C51KB111111 чуже авто</div></body></html>';
  const ldMeta = A.extractLotMeta(LD_DESC, 'https://vincheck.by/catalog/' + VIN, VIN);
  if (ldMeta.primary_damage !== 'Front end' || ldMeta.secondary_damage !== 'Side') errs.push('damage з JSON-LD description: ' + ldMeta.primary_damage + '/' + ldMeta.secondary_damage);

  /* 13. field_provenance зберігається для ключових полів */
  for (const k of ['auction_house', 'lot_id', 'mileage', 'primary_damage']) {
    if (!(k in (aggMeta.field_provenance || {}))) errs.push('нема провенансу поля ' + k);
  }

  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('повний шлях · ідентичність (VIN > naming) · absent проти unreachable · ліміти фото · TTL кешу · Serper discovery і ranking · сніпет не evidence · 200-челендж · ZenRows discovery-unblock і подвійна умова');
  console.log('AUCTION TEST PASSED');
  fs.unlinkSync(tmp);
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
