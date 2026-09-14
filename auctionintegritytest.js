/* Цілісність аукціонних подій і допуск аукціонного доказу.

   Два реальні дефекти продакшну:
   1. stat.vin віддав "Лот 45129191" для пʼяти різних VIN. Сторінку знайшов
      пошук за VIN, тому VIN стояв в URL і заголовку, і запис пройшов як
      found. Один такий рядок став подією (COPART, 45129191) для ЗАЗ Sens.
   2. auction_events писалась upsert-ом за (auction_house, lot_id) з
      merge-duplicates і vin у тілі: наступний кандидат із тим самим лотом
      мовчки переписав би VIN події.

   Тут доводиться:
   - discovery-контекст (VIN в URL, title, h1, підписаний текст агрегатора)
     не привʼязує аукціонний запис до VIN;
   - source-specific канонічний звʼязок (JSON-LD з точним VIN, сторінка лота
     первинного джерела, перевірена пара лот/VIN) привʼязує;
   - номер лота без канонічного звʼязку не стає lot_id;
   - наявна подія ніколи не змінює VIN, конфлікт логується і не пишеться;
   - незбагачений старий запис кешу не повертається як found.

   Запуск: node auctionintegritytest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_auctint_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

const ZAZ = 'Y6DT1311070334890';
const PAJERO = 'JMB0RK9607J003076';
const TOUAREG = 'WVGZZZCR6TD014831';
const TESLA = '7SAYGDED3PF966312';
const BMW = 'WBAJE7C34HG887901';
const BID_VIN = 'WBAJA9C5XJB033667';

/* ---------- сторінки у формі, яку бачив пайплайн ---------- */
/* stat.vin: сторінка знайдена пошуком за VIN; VIN в URL, у заголовку і в
   підписаному полі; той самий "Лот 45129191" і мітка Copart на кожній */
const statvin = vin => ({
  url: 'https://stat.vin/ru/autoria/brand/model/2007/' + vin,
  html: `<html><head><title>История ${vin} | stat.vin</title></head><body><h1>${vin}</h1>
    <div>VIN: ${vin}</div><div>Аукцион: Copart</div><div>Лот 45129191</div>
    <div>История объявлений auto.ria</div></body></html>`,
});
/* carsniper: агрегатор оголошень, VIN лише в заголовку, "лот" це id оголошення в URL */
const carsniper = {
  url: 'https://carsniper.com.ua/ads/1166359',
  html: `<html><head><title>Volkswagen Touareg 2025 ${TOUAREG}</title></head><body>
    <img src="https://cdn0.riastatic.com/photosnew/auto/photo/volkswagen_touareg__644158307hd.webp">
    Пошкодження: Front end</body></html>`,
};
/* vincheck.by: structured-вузол із точним VIN, у тексті ще й чужий номер лота */
const vincheck = {
  url: 'https://vincheck.by/catalog/' + BMW,
  html: `<html><head><title>BMW 540i ${BMW}</title>
    <script type="application/ld+json">{"@type":"Car","vehicleIdentificationNumber":"${BMW}","brand":"BMW","description":"Copart, повреждения Front end, Side"}</script>
    </head><body>VIN ${BMW} Copart Lot 45129191 похожие лоты</body></html>`,
};
/* americamotors: реальний шаблон, перевірений на сторінці 2026-09-14 */
const americamotors = {
  url: 'https://americamotors.com/en/tesla/model_y/' + TESLA,
  html: `<html><body><h1>Tesla MODEL Y 2023</h1><div>Лот: #42968456 VIN: ${TESLA}</div>
    <div>Детали лота #42968456</div><div>Id: 42968456, VIN: ${TESLA}</div>
    <div>Похожие лоты: Лот: #41111111 VIN: 7SAYGDEE0PF696688</div></body></html>`,
};
/* bid.cars: сторінка лота первинного джерела */
const bidcars = {
  url: 'https://bid.cars/en/lot/0-42107936/2018-BMW-5-Series-' + BID_VIN,
  html: `<html><head><title>2018 BMW 5 Series | ${BID_VIN} | BidCars</title></head>
    <body><h1>2018 BMW 5 SERIES</h1><span>VIN: ${BID_VIN}</span><span>IAAI</span></body></html>`,
};

/* ---------- заглушка PostgREST для auction_events і auction_checks ---------- */
function makeRest(db) {
  const calls = [];
  const matches = (row, q) => {
    for (const [k, v] of q.searchParams) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      const m = /^eq\.(.*)$/.exec(v);
      if (m && String(row[k]) !== m[1]) return false;
    }
    return true;
  };
  const fetchImpl = async (url, opt = {}) => {
    const u = new URL(String(url));
    const table = u.pathname.split('/').pop();
    const method = (opt.method || 'GET').toUpperCase();
    calls.push({ method, table, url: String(url), prefer: opt.headers && opt.headers.prefer, body: opt.body ? JSON.parse(opt.body) : null });
    if (db.failRead && method === 'GET') return { ok: false, status: 503, json: async () => ({}) };
    const rows = db[table] = db[table] || [];
    const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (method === 'GET') {
      let out = rows.filter(r => matches(r, u));
      if (/checked_at\.desc/.test(u.searchParams.get('order') || '')) out = out.slice().sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)));
      const lim = parseInt(u.searchParams.get('limit') || '0', 10);
      return res(200, lim ? out.slice(0, lim) : out);
    }
    if (method === 'POST') {
      const body = JSON.parse(opt.body);
      const conflictCols = (u.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
      const hit = conflictCols.length ? rows.find(r => conflictCols.every(c => String(r[c]) === String(body[c]))) : null;
      if (hit) {
        if (/merge-duplicates/.test(opt.headers.prefer || '')) { Object.assign(hit, body); return res(201, [hit]); }
        return res(201, []);
      }
      rows.push({ ...body });
      return res(201, [body]);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(opt.body);
      const hits = rows.filter(r => matches(r, u));
      for (const h of hits) Object.assign(h, body);
      return { ok: true, status: 204, json: async () => null, text: async () => '' };
    }
    return res(405, {});
  };
  return { fetchImpl, calls };
}

(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  const A = await import('file://' + path.join(dir, 'api', 'auction.js'));
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const logs = [];

  try {
    /* ===== 1. допуск: discovery-контекст не є привʼязкою ===== */
    for (const vin of [ZAZ, PAJERO]) {
      const p = statvin(vin);
      const meta = A.extractLotMeta(p.html, p.url, vin);
      ok('stat.vin ' + vin + ': парсер і далі бачить лот 45129191 (передумова дефекту)', meta.lot_id === '45129191', meta.lot_id);
      const adm = A.admitAuctionRecord(p, vin, meta);
      ok('stat.vin ' + vin + ': запис НЕ допущений', adm.admitted === false, JSON.stringify(adm));
      ok('stat.vin ' + vin + ': причина discovery-контекст', adm.reason === 'vin_only_in_discovery_context', adm.reason);
    }
    const csAdm = A.admitAuctionRecord(carsniper, TOUAREG, A.extractLotMeta(carsniper.html, carsniper.url, TOUAREG));
    ok('carsniper: VIN лише в заголовку не допускає запис', csAdm.admitted === false && csAdm.vin_zones.includes('title'), JSON.stringify(csAdm));
    ok('carsniper: id оголошення в URL не є лотом первинного джерела', A.lotFromAuthoritativeUrl(carsniper.url) === null);

    /* ===== 2. допуск: канонічні звʼязки ===== */
    const vcMeta = A.extractLotMeta(vincheck.html, vincheck.url, BMW);
    const vcAdm = A.admitAuctionRecord(vincheck, BMW, vcMeta);
    ok('JSON-LD з точним VIN допускає запис', vcAdm.admitted && vcAdm.basis === 'json_ld_exact_vin', JSON.stringify(vcAdm));
    ok('текстовий лот на агрегаторі не стає lot_id навіть при допуску', vcAdm.lot_id === null && vcAdm.lot_id_unverified === '45129191', JSON.stringify(vcAdm));
    A.applyAdmission(vcMeta, vcAdm);
    ok('applyAdmission прибирає неперевірений лот із meta', vcMeta.lot_id === null && vcMeta.lot_id_unverified === '45129191' && vcMeta.field_provenance.lot_id === null);

    const amAdm = A.admitAuctionRecord(americamotors, TESLA, null);
    ok('americamotors: перевірена пара лот/VIN допускає запис', amAdm.admitted && amAdm.basis === 'lot_vin_pair' && amAdm.lot_id === '42968456', JSON.stringify(amAdm));
    ok('americamotors: пара чужого авто зі "схожих лотів" не береться', amAdm.lot_id !== '41111111');
    const pairElsewhere = A.admitAuctionRecord({ url: 'https://agg.example/x/' + TESLA, html: americamotors.html }, TESLA, null);
    ok('та сама пара на неперевіреному хості не допускає запис', pairElsewhere.admitted === false, JSON.stringify(pairElsewhere));
    const amTwoLots = A.admitAuctionRecord({ url: americamotors.url, html: `<div>Лот: #42968456 VIN: ${TESLA}</div><div>Лот: #43000000 VIN: ${TESLA}</div>` }, TESLA, null);
    ok('дві різні пари для одного VIN не дають лот навмання', amTwoLots.admitted === false, JSON.stringify(amTwoLots));

    const bidAdm = A.admitAuctionRecord(bidcars, BID_VIN, null);
    ok('bid.cars: сторінка лота з підписаним VIN допускає запис', bidAdm.admitted && bidAdm.basis === 'lot_page_labeled_vin' && bidAdm.lot_id === '42107936' && bidAdm.lot_basis === 'source_url', JSON.stringify(bidAdm));
    const bidNoLabel = A.admitAuctionRecord({ url: bidcars.url, html: `<title>2018 BMW ${BID_VIN}</title>` }, BID_VIN, null);
    ok('bid.cars без підписаного поля VIN (VIN лише в URL/title) не допускається', bidNoLabel.admitted === false, JSON.stringify(bidNoLabel));

    /* ===== 3. збережені записи ===== */
    const legacyStat = { meta: { lot_id: '45129191', lot_id_source: 'direct', auction_house: 'COPART',
      field_provenance: { auction_house: { value: 'COPART', source: 'stat.vin', evidence_type: 'labelled_field' }, lot_id: { value: '45129191', source: 'stat.vin', evidence_type: 'vin_scoped' } } } };
    ok('старий запис stat.vin не довіряється', A.storedAuctionAdmission(legacyStat, statvin(ZAZ).url).admitted === false);
    const legacyCarsniper = { meta: { lot_id: '1166359', lot_id_source: 'source_url', field_provenance: { lot_id: { evidence_type: 'source_url' } } } };
    ok('старий запис carsniper не довіряється', A.storedAuctionAdmission(legacyCarsniper, carsniper.url).admitted === false);
    const legacyAm = { meta: { lot_id: '42968456', lot_id_source: 'direct', auction_house: 'IAAI' } };
    ok('старий americamotors без збереженої привʼязки не довіряється (перепошук доведе пару)', A.storedAuctionAdmission(legacyAm, americamotors.url).admitted === false);
    const legacyBmw = { meta: { lot_id: '49495925', auction_house: 'COPART', field_provenance: { auction_house: { evidence_type: 'json_ld_exact_vin' } } } };
    ok('старий запис із JSON-LD привʼязкою довіряється', A.storedAuctionAdmission(legacyBmw, vincheck.url).admitted === true);
    ok('новий запис із admission.admitted=false не довіряється', A.storedAuctionAdmission({ admission: { admitted: false, reason: 'x' } }, bidcars.url).admitted === false);
    ok('новий запис із admission.admitted=true довіряється', A.storedAuctionAdmission({ admission: bidAdm }, bidcars.url).admitted === true);

    /* ===== 4. пайплайн: stat.vin-кандидат не дає found ===== */
    process.env.SERPER_API_KEY = 'test-key';
    const serper = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ organic: [
      { link: statvin(ZAZ).url, title: 'История ' + ZAZ, snippet: ZAZ + ' Copart' }] }) });
    const pageFetch = async url => {
      const u = String(url);
      const body = /stat\.vin/.test(u) ? statvin(ZAZ).html : 'Just a moment...';
      const status = /stat\.vin/.test(u) ? 200 : 403;
      return { ok: status < 400, status, headers: { get: () => 'text/html' }, text: async () => body, arrayBuffer: async () => Buffer.alloc(0) };
    };
    console.log = (...a) => logs.push(a.map(String).join(' '));
    const recStat = await A.findAuctionRecord(ZAZ, null, { fetchImpl: pageFetch, serperFetchImpl: serper, allowPaid: false });
    console.log = realLog;
    ok('findAuctionRecord: stat.vin-сторінка не дає found', recStat.status !== 'found', recStat.status + '/' + recStat.reason);
    ok('findAuctionRecord: відмова допуску логується структуровано', logs.some(l => /"op":"admission_rejected"/.test(l) && /stat\.vin/.test(l) && /"lot_seen":"45129191"/.test(l)), logs.filter(l => /admission/.test(l)).join(' | '));
    /* оголошення-агрегатор із точним VIN у JSON-LD: привʼязка є, аукціонного запису нема.
       Реальна сторінка carsniper для 4JGBB8GB7BA713348 (2026-09-14): Vehicle + offers,
       ціна і середня ринкова, id оголошення 1374061 лише в URL */
    const MCLASS = '4JGBB8GB7BA713348';
    const adPage = { url: 'https://carsniper.com.ua/ads/1374061/', html: `<html><head><title>Mercedes-Benz M-Class 2011 ${MCLASS}</title>
      <script type="application/ld+json">{"@type":"Vehicle","name":"Mercedes-Benz M-Class 2011","vehicleIdentificationNumber":"${MCLASS}","offers":{"price":11000}}</script>
      </head><body>ціна $11 000; середня ринкова $16 150</body></html>` };
    const serperAd = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ organic: [
      { link: adPage.url, title: 'Mercedes-Benz M-Class ' + MCLASS, snippet: MCLASS }] }) });
    const adFetch = async url => {
      const hit = /carsniper/.test(String(url));
      return { ok: hit, status: hit ? 200 : 403, headers: { get: () => 'text/html' }, text: async () => hit ? adPage.html : 'Just a moment...', arrayBuffer: async () => Buffer.alloc(0) };
    };
    const adAdm = A.admitAuctionRecord(adPage, MCLASS, A.extractLotMeta(adPage.html, adPage.url, MCLASS));
    ok('оголошення з JSON-LD привʼязане, але id оголошення не лот', adAdm.admitted && adAdm.lot_id === null, JSON.stringify(adAdm));
    logs.length = 0;
    console.log = (...a) => logs.push(a.map(String).join(' '));
    const recAd = await A.findAuctionRecord(MCLASS, null, { fetchImpl: adFetch, serperFetchImpl: serperAd, allowPaid: false });
    console.log = realLog;
    ok('оголошення з VIN у JSON-LD без аукціонного контенту не дає found', recAd.status !== 'found', recAd.status + '/' + recAd.reason);
    ok('відсутність аукціонного контенту логується', logs.some(l => /"op":"no_auction_content"/.test(l) && /carsniper/.test(l)), logs.filter(l => /auction/.test(l)).join(' | '));
    delete process.env.SERPER_API_KEY;

    /* ===== 5. writeAuctionEvent: подія ніколи не змінює VIN ===== */
    const recFor = (vin, lot, extra = {}) => ({
      status: 'found', lot_url: 'https://bid.cars/en/lot/1-' + lot + '/x-' + vin,
      identity: { matched: true }, photo_urls: [], sources_checked: [],
      admission: { admitted: true, basis: 'lot_page_labeled_vin', host: 'bid.cars', lot_id: lot, lot_basis: 'source_url' },
      meta: { auction_house: 'COPART', lot_id: lot, odometer_value: 98997, odometer_unit: 'mi', odometer_status: 'unknown', ...extra },
    });
    const db = { auction_events: [], auction_checks: [] };
    const rest = makeRest(db);
    globalThis.fetch = rest.fetchImpl;
    logs.length = 0;
    console.log = (...a) => logs.push(a.map(String).join(' '));

    const w1 = await C.writeAuctionEvent(BMW, recFor(BMW, '49495925'));
    ok('новий лот вставляється', w1.status === 'inserted' && db.auction_events.length === 1 && db.auction_events[0].vin === BMW, JSON.stringify(w1));
    ok('вставка не використовує merge-duplicates', rest.calls.filter(c => c.method === 'POST').every(c => !/merge-duplicates/.test(c.prefer || '')));

    const w2 = await C.writeAuctionEvent(BMW, recFor(BMW, '49495925', { primary_damage: 'Front end' }));
    ok('той самий дім, лот і VIN оновлюють подію', w2.status === 'updated' && db.auction_events[0].primary_damage === 'Front end', JSON.stringify(w2));
    const patch = rest.calls.filter(c => c.method === 'PATCH').pop();
    ok('оновлення фільтроване за VIN наявної події', patch && /vin=eq\.WBAJE7C34HG887901/.test(patch.url), patch && patch.url);
    ok('оновлення не несе поле vin', patch && !('vin' in patch.body));

    const before = JSON.stringify(db.auction_events[0]);
    const w3 = await C.writeAuctionEvent(ZAZ, recFor(ZAZ, '49495925'));
    ok('той самий дім і лот, інший VIN: vin_conflict', w3.status === 'vin_conflict' && w3.existing_vin === BMW, JSON.stringify(w3));
    ok('при конфлікті наявна подія не змінилась ні на байт', JSON.stringify(db.auction_events[0]) === before);
    ok('при конфлікті нового рядка не створено', db.auction_events.length === 1);
    const conflictLog = logs.find(l => /"op":"vin_conflict"/.test(l));
    ok('конфлікт логується з домом, лотом, обома VIN і джерелом', conflictLog && /"auction_house":"COPART"/.test(conflictLog) && /"lot_id":"49495925"/.test(conflictLog)
      && /"existing_vin":"WBAJE7C34HG887901"/.test(conflictLog) && /"candidate_vin":"Y6DT1311070334890"/.test(conflictLog) && /"source_host":"bid.cars"/.test(conflictLog), conflictLog);

    const w4 = await C.writeAuctionEvent(BMW, recFor(BMW, '49495925', { secondary_damage: 'Side' }));
    ok('після конфлікту подія і далі належить першому VIN', w4.status === 'updated' && db.auction_events[0].vin === BMW && db.auction_events[0].secondary_damage === 'Side');

    const unverified = recFor(ZAZ, '45129191');
    unverified.admission = { admitted: true, basis: 'json_ld_exact_vin', lot_id: null, lot_basis: null };
    const w5 = await C.writeAuctionEvent(ZAZ, unverified);
    ok('лот без перевіреної привʼязки подією не стає', w5.status === 'skipped' && w5.reason === 'lot_not_verified' && db.auction_events.length === 1, JSON.stringify(w5));

    db.failRead = true;
    const writesBefore = rest.calls.filter(c => c.method !== 'GET').length;
    const w6 = await C.writeAuctionEvent(TESLA, recFor(TESLA, '42968456'));
    db.failRead = false;
    ok('невдале читання наявної події зупиняє запис (fail closed)', w6.status === 'error' && rest.calls.filter(c => c.method !== 'GET').length === writesBefore, JSON.stringify(w6));
    ok('невдале читання логується', logs.some(l => /"op":"write_auction_event"/.test(l) && /"step":"read_existing"/.test(l)));

    /* ===== 6. readAuctionCache: неперевірений found не повертається ===== */
    db.auction_events.push({ auction_house: 'COPART', lot_id: '45129191', vin: ZAZ, checked_at: '2026-09-10T15:54:52Z',
      source_urls: [statvin(ZAZ).url], record: legacyStat });
    db.auction_checks.push({ vin: ZAZ, status: 'found', source: 'serper:stat.vin', lot_url: statvin(ZAZ).url, checked_at: '2026-09-10T15:54:52Z', record: legacyStat });
    logs.length = 0;
    const zazCache = await C.readAuctionCache(ZAZ);
    ok('хибна подія ЗАЗ і її кеш не повертаються як found', zazCache === null, JSON.stringify(zazCache));
    ok('недовіра до події логується', logs.some(l => /"op":"event_untrusted"/.test(l) && /45129191/.test(l)));
    ok('недовіра до found-кешу логується', logs.some(l => /"op":"found_cache_untrusted"/.test(l)));
    ok('рядки кешу і події не змінені читанням', db.auction_events.some(r => r.vin === ZAZ && r.lot_id === '45129191') && db.auction_checks.some(r => r.vin === ZAZ && r.status === 'found'));

    db.auction_checks.push({ vin: TOUAREG, status: 'found', source: 'serper:carsniper.com.ua', lot_url: carsniper.url, checked_at: '2026-09-10T15:58:39Z', record: legacyCarsniper });
    ok('found-кеш carsniper не повертається', (await C.readAuctionCache(TOUAREG)) === null);

    const bmwCache = await C.readAuctionCache(BMW);
    ok('допущена подія повертається як found', bmwCache && bmwCache.status === 'found' && bmwCache.record.admission.admitted === true, JSON.stringify(bmwCache && bmwCache.status));

    db.auction_checks.push({ vin: PAJERO, status: 'absent', checked_at: '2026-09-10T16:29:16Z', record: { sources_checked: [] } });
    const abs = await C.readAuctionCache(PAJERO);
    ok('absent-кеш і далі читається', abs && abs.status === 'absent');

    db.failRead = true;
    logs.length = 0;
    const failCache = await C.readAuctionCache(BMW);
    db.failRead = false;
    ok('збій читання кешу повертає null і логується', failCache === null && logs.some(l => /"op":"read_auction_events"/.test(l)));

    /* ===== 7. Check: спірний лот не стає доказом цього VIN ===== */
    const src = fs.readFileSync('api/check.js', 'utf8');
    ok('Check пише подію до того, як запис стане доказом', /const eventWrite = rec\.status === 'found' \? await writeAuctionEvent\(listing\.vin, rec\)/.test(src));
    ok('vin_conflict переводить пошук у unknown', /eventWrite\.status === 'vin_conflict'\) \{\s*auctionSearch\.status = 'unknown';\s*auctionSearch\.reason = 'auction_event_vin_conflict';/.test(src));
    ok('found-гілка не виконується при конфлікті', /if \(rec\.status === 'found' && !\(eventWrite && eventWrite\.status === 'vin_conflict'\)\)/.test(src));
    ok('found-кеш несе рішення допуску', /record: \{ photo_urls: rec\.photo_urls \|\| \[\], identity: rec\.identity, admission: rec\.admission \|\| null/.test(src));
    ok('у Check лишився рівно один виклик writeAuctionEvent', (src.match(/await writeAuctionEvent\(/g) || []).length === 1);
  } finally {
    console.log = realLog;
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errs.length) {
    console.error('auctionintegritytest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('auctionintegritytest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.log = console.info; console.error('auctionintegritytest CRASHED:', e.stack || e.message); process.exit(1); });
