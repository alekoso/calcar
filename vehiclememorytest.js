/* Vehicle Memory V0: immutable-знімки оголошення з дедуплікацією за
   відбитком стану, повний raw-доказ (текст продавця, всі кадри, поля
   площадки), метадані площадки без AI, канонічна ідентичність авто і
   карта переиспользування етапів. Supabase імітується заглушкою fetch:
   перевіряється саме логіка "той самий стан = продовжити, змінений =
   новий рядок, старий рядок недоторканий". */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_vm_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

/* заглушка PostgREST для vehicle_snapshots: у памʼяті, з select/order/limit,
   POST (insert) і PATCH за id */
const db = { rows: [], seq: 0, patches: [] };
function fakeFetch(url, opt = {}) {
  const u = String(url);
  const json = (code, body) => ({ ok: code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
  if (!u.includes('/rest/v1/vehicle_snapshots')) return json(404, []);
  const m = (opt.method || 'GET').toUpperCase();
  if (m === 'GET') {
    const vin = (/vin=eq\.([^&]+)/.exec(u) || [])[1];
    const id = (/id=eq\.([^&]+)/.exec(u) || [])[1];
    let rows = db.rows.filter(r => (!vin || r.vin === decodeURIComponent(vin)) && (!id || r.id === decodeURIComponent(id)));
    rows = rows.sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1));
    if (/limit=1/.test(u)) rows = rows.slice(0, 1);
    return json(200, rows);
  }
  if (m === 'POST') {
    const body = JSON.parse(opt.body);
    const row = { ...body, id: 'snap-' + (++db.seq), captured_at: new Date(Date.now() + db.seq).toISOString() };
    db.rows.push(row);
    return json(201, [row]);
  }
  if (m === 'PATCH') {
    const id = decodeURIComponent((/id=eq\.([^&]+)/.exec(u) || [])[1]);
    const body = JSON.parse(opt.body);
    const row = db.rows.find(r => r.id === id);
    if (!row) return json(404, []);
    db.patches.push({ id, body });
    Object.assign(row, body);
    return json(204, null);
  }
  return json(405, {});
}

(async () => {
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const src = fs.readFileSync('api/check.js', 'utf8');

  /* 1. метадані площадки без AI: id оголошення, локація, продавець, статус, raw-текст */
  const html = `<html><head><title>x</title>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@id":"/uk/","name":"AUTO.RIA.com"}},{"@type":"ListItem","position":3,"item":{"@id":"/uk/legkovie/state/kiev/","name":"Київська область"}},{"@type":"ListItem","position":4,"item":{"@id":"/uk/legkovie/city/kiev/","name":"Київ"}},{"@type":"ListItem","position":5,"item":{"@id":"/uk/car/tesla/city/kiev/","name":"Tesla"}}]}</script>
  <script>window.__s={"userId":4151635,"isActive":true}</script></head><body>Опис від продавця Продам власне авто. Дилер</body></html>`;
  const meta = C.extractListingMeta(html, 'https://auto.ria.com/uk/auto_tesla_model_s_40185075.html', {}, 'Опис від продавця Продам власне авто. Приватний продавець');
  if (meta.source_listing_id !== '40185075') errs.push('source_listing_id: ' + meta.source_listing_id);
  if (meta.location !== 'Київська область, Київ') errs.push('location: ' + meta.location);
  if (!meta.seller_meta || meta.seller_meta.platform_user_id !== '4151635') errs.push('seller_meta: ' + JSON.stringify(meta.seller_meta));
  if (meta.listing_status !== 'active') errs.push('статус активного оголошення: ' + meta.listing_status);
  if (!meta.raw_page_text || !meta.raw_page_text.includes('Продам власне авто')) errs.push('raw_page_text порожній');
  const inactive = C.extractListingMeta(html.replace('"isActive":true', '"isActive":false'), 'https://auto.ria.com/uk/auto_x_1.html', {}, 'x');
  if (inactive.listing_status !== 'inactive') errs.push('isActive:false не дає inactive');
  if (C.extractListingMeta('<html></html>', 'https://example.com/cars/1234567?x=1', {}, 'Автомобіль продано').listing_status !== 'inactive') errs.push('текстовий маркер продажу не дає inactive');
  if (C.extractListingMeta('<html></html>', 'https://example.com/cars/1234567?x=1', {}, '').source_listing_id !== '1234567') errs.push('generic listing id не витягнутий');

  /* 2. відбиток стану: детермінований, чутливий до ціни/тексту/кадрів/статусу, байдужий до CDN-хоста і ринкового контексту */
  const L = { vin: 'V1', price: 17000, currency: 'USD', odometer_km: 167000, seller_text: 'Продам власне авто. Пневма.', photos: ['https://cdn.riastatic.com/a/1hd.webp', 'https://cdn.riastatic.com/a/2hd.webp'], listing_equipment: ['Пневмопідвіска'], history_facts: { owners_count: 1 }, year: 2015, title: 'Tesla Model S 2015', listing_status: 'active', price_context: { average_price: 16667 }, domain: 'auto.ria.com', text: 'txt' };
  const fp = C.listingFingerprint(L);
  if (fp !== C.listingFingerprint({ ...L })) errs.push('відбиток недетермінований');
  if (fp !== C.listingFingerprint({ ...L, price_context: { average_price: 99999 } })) errs.push('ринковий контекст входить у відбиток');
  if (fp !== C.listingFingerprint({ ...L, photos: ['https://cdn4.riastatic.com/a/1hd.webp?x', 'https://cdn2.riastatic.com/a/2hd.webp'] })) errs.push('ротація CDN міняє відбиток');
  if (fp !== C.listingFingerprint({ ...L, seller_text: 'Продам  власне авто.   Пневма. ' })) errs.push('пробіли міняють відбиток');
  if (fp === C.listingFingerprint({ ...L, price: 16500 })) errs.push('зміна ціни не міняє відбиток');
  if (fp === C.listingFingerprint({ ...L, seller_text: 'Продам власне авто. Пневма. Був у ДТП.' })) errs.push('зміна тексту продавця не міняє відбиток');
  if (fp === C.listingFingerprint({ ...L, photos: L.photos.slice(0, 1) })) errs.push('зміна набору кадрів не міняє відбиток');
  if (fp === C.listingFingerprint({ ...L, photos: [L.photos[1], L.photos[0]] })) errs.push('порядок кадрів не входить у відбиток');
  if (fp === C.listingFingerprint({ ...L, listing_status: 'inactive' })) errs.push('статус не входить у відбиток');
  if (!/^lf-v1:[0-9a-f]{24}$/.test(fp)) errs.push('формат відбитка: ' + fp);

  /* 3. рядок знімка: raw-доказ повний, кадри впорядковані з ідентичністю */
  const row = C.snapshotRow({ ...L, photos: Array.from({ length: 40 }, (_, i) => 'https://cdn' + (i % 5) + '.riastatic.com/p/' + i + 'hd.webp'), raw_page_text: 'весь текст сторінки', location: 'Київ', seller_meta: { platform_user_id: '1' }, source_listing_id: '40185075' }, 'https://u', 'tok');
  if (row.photos.length !== 40 || row.photo_items.length !== 40 || row.photo_items[7].i !== 7 || row.photo_items[7].id !== 'cdn.riastatic.com/p/7hd.webp') errs.push('photo_items: ' + JSON.stringify(row.photo_items[7]));
  if (row.seller_text !== L.seller_text || row.raw_page_text !== 'весь текст сторінки' || row.location !== 'Київ' || row.source_listing_id !== '40185075' || row.listing_status !== 'active') errs.push('знімок без raw-полів');
  if (row.listing_fingerprint !== C.listingFingerprint({ ...L, photos: row.photos })) errs.push('знімок не несе відбиток');
  if (!row.first_seen_at || row.last_seen_at !== row.first_seen_at || row.seen_count !== 1) errs.push('first/last_seen_at');
  if (!row.photo_set_fingerprint || !row.seller_claims || row.seller_claims.history_facts.owners_count !== 1) errs.push('photo_set_fingerprint/seller_claims');

  /* 4. acceptance-сценарій на фікстурі через заглушку Supabase */
  process.env.SUPABASE_URL = 'https://fake.supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  const T = C;
  const base = { ...L, vin: '5YJSA1H23FFP69703' };
  const s1 = await T.saveSnapshot(base, 'https://auto.ria.com/x_40185075.html', 'tok1');
  if (s1.status !== 'new' || !s1.id) errs.push('Snapshot #1 не створений: ' + JSON.stringify(s1));
  const r1 = db.rows[0];
  if (!r1 || r1.seller_text !== base.seller_text || r1.price_amount !== 17000 || r1.odometer_km !== 167000 || r1.photos.length !== 2) errs.push('Snapshot #1 без повного опису/ціни/пробігу/фото');
  const s1b = await T.saveSnapshot(base, 'https://auto.ria.com/x_40185075.html', 'tok2');
  if (s1b.status !== 'dedup' || s1b.id !== s1.id || db.rows.length !== 1) errs.push('повторний Check без змін створив дубль: ' + JSON.stringify(s1b));
  if (!db.patches.length || !db.patches[0].body.last_seen_at || db.patches[0].body.seen_count !== 2 || db.rows[0].seen_count !== 2) errs.push('last_seen_at/seen_count не оновились при дедуплікації: ' + JSON.stringify(db.patches));
  const s2 = await T.saveSnapshot({ ...base, price: 16500 }, 'https://auto.ria.com/x_40185075.html', 'tok3');
  if (s2.status !== 'changed' || db.rows.length !== 2 || s2.previous_id !== s1.id) errs.push('зміна ціни не створила Snapshot #2: ' + JSON.stringify(s2));
  const s3 = await T.saveSnapshot({ ...base, price: 16500, seller_text: 'Продам власне авто. Пневма. Був у ДТП.' }, 'https://auto.ria.com/x_40185075.html', 'tok4');
  if (s3.status !== 'changed' || db.rows.length !== 3) errs.push('зміна опису не створила Snapshot #3');
  if (db.rows[0].seller_text !== base.seller_text || db.rows[0].price_amount !== 17000) errs.push('Snapshot #1 втратив старий текст/ціну');
  if (db.rows[2].seller_text !== 'Продам власне авто. Пневма. Був у ДТП.') errs.push('Snapshot #3 без нового тексту');
  const s4 = await T.saveSnapshot({ ...base, price: 16500, seller_text: 'Продам власне авто. Пневма. Був у ДТП.', photos: [...base.photos, 'https://cdn.riastatic.com/a/3hd.webp'] }, 'https://auto.ria.com/x_40185075.html', 'tok5');
  if (s4.status !== 'changed' || db.rows.length !== 4 || db.rows[3].photos.length !== 3 || db.rows[2].photos.length !== 2) errs.push('зміна набору фото не створила новий знімок або старий набір втрачено');
  if (db.patches.some(p => 'seller_text' in p.body || 'photos' in p.body || 'price_amount' in p.body)) errs.push('PATCH торкнувся raw-полів старого знімка');
  const s5 = await T.saveSnapshot({ ...base, price: 16500, seller_text: 'Продам власне авто. Пневма. Був у ДТП.', photos: [...base.photos, 'https://cdn7.riastatic.com/a/3hd.webp'] }, 'https://auto.ria.com/x_40185075.html', 'tok6');
  if (s5.status !== 'dedup') errs.push('ротація CDN у кадрах створила дубль знімка');
  globalThis.fetch = realFetch;

  /* 5. сторожі пайплайна: знімок ДО AI, ідентичність з vehicles, карта reuse, claims після AI */
  if (src.indexOf('const snapshot = await saveSnapshot(listing, url, job && job.token);') > src.indexOf("progress('ai');")) errs.push('знімок не перед AI');
  for (const k of ['const vehicleRow = listing.vin ? await readVehicle(listing.vin) : null;', "reuse.identity = 'vehicles_cache'", "reuse.identity = 'nhtsa_decode'", 'upsertVehicle(listing.vin, {', 'reuse.listing_snapshot = snapshot.status;', 'historical_visual: !auctionPhotos.length', 'patchSnapshotClaims(snapshot.id, parsed)', "'/rest/v1/vehicles?on_conflict=vin'", 'resolution=merge-duplicates']) {
    if (!src.includes(k)) errs.push('нема: ' + k);
  }
  const mig = fs.readFileSync('supabase-vehicle-intelligence.sql', 'utf8');
  if (/drop |alter column|delete from|truncate/i.test(mig)) errs.push('міграція не аддитивна');
  for (const col of ['source_listing_id', 'listing_fingerprint', 'first_seen_at', 'last_seen_at', 'seen_count', 'location', 'seller_meta', 'listing_status', 'photo_items', 'photo_set_fingerprint', 'seller_claims', 'raw_page_text']) if (!mig.includes('add column if not exists ' + col)) errs.push('міграція без ' + col);
  if (!/create table if not exists vehicles \(/.test(mig)) errs.push('міграція без таблиці vehicles');

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('VEHICLE MEMORY TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('метадані площадки · відбиток стану · повний знімок · дедуплікація без дублів · зміна ціни/тексту/фото = новий immutable-рядок · vehicles + reuse');
  console.log('VEHICLE MEMORY TEST PASSED');
})().catch(e => { console.log('VEHICLE MEMORY TEST CRASHED:', e.stack || e.message); process.exit(1); });
