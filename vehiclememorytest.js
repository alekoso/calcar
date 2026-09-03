/* Vehicle Memory V1: одна canonical сутність на VIN, Listing як окрема
   сутність, immutable-знімки з дедуплікацією за відбитком стану, один
   бінарник кадру на content hash, привʼязка історії без VIN до Vehicle,
   коли VIN зʼявився. Supabase (PostgREST + Storage) імітується заглушкою
   fetch у памʼяті: перевіряється саме логіка модуля api/vehicle-memory.js
   і сторожі пайплайна. Acceptance повторює сценарії задачі:
   same listing, changes, multiple listings, 100 users, no VIN -> VIN,
   source image disappears. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const errs = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_vm_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

/* ---------- заглушка PostgREST + Storage + CDN ---------- */
const UNIQUE = { vehicles: ['vin'], listings: ['source', 'source_listing_id'], vehicle_snapshots: ['id'], photo_assets: ['content_hash'], snapshot_photos: ['snapshot_id', 'kind', 'position'] };
const db = { vehicles: [], listings: [], vehicle_snapshots: [], photo_assets: [], snapshot_photos: [] };
const storage = new Map();
const cdn = { gone: new Set(), protectedUrls: new Set(), downloads: 0 };
let seq = 0;
const uuid = () => '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
const imageBytes = url => Buffer.from('IMG:' + url.replace(/^https:\/\/cdn\d*\./, 'https://cdn.').split('?')[0]);
function parseQuery(q) {
  const f = [], o = {};
  for (const part of (q || '').split('&').filter(Boolean)) {
    const i = part.indexOf('='); const k = decodeURIComponent(part.slice(0, i)); const v = decodeURIComponent(part.slice(i + 1));
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) { o[k] = v; continue; }
    if (v.startsWith('eq.')) f.push(r => String(r[k]) === v.slice(3));
    else if (v === 'is.null') f.push(r => r[k] == null);
    else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, ''))); f.push(r => set.has(String(r[k]))); }
    else f.push(() => false);
  }
  return { f, o };
}
function fakeFetch(url, opt = {}) {
  const u = String(url), m = (opt.method || 'GET').toUpperCase();
  const json = (code, body) => ({ ok: code < 300, status: code, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.startsWith('https://fake.supabase.local/storage/v1/object/')) {
    const p = u.replace('https://fake.supabase.local/storage/v1/object/', '');
    storage.set(p, opt.body.length);
    return json(200, { Key: p });
  }
  if (u.startsWith('https://fake.supabase.local/rest/v1/')) {
    const rest = u.replace('https://fake.supabase.local/rest/v1/', '');
    const qi = rest.indexOf('?'); const table = qi < 0 ? rest : rest.slice(0, qi); const { f, o } = parseQuery(qi < 0 ? '' : rest.slice(qi + 1));
    const rows = db[table]; if (!rows) return json(404, { message: 'no table ' + table });
    const match = r => f.every(fn => fn(r));
    if (m === 'GET') {
      let out = rows.filter(match);
      if (o.order) { const [col, dir] = o.order.split('.'); out = out.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
      if (o.limit) out = out.slice(0, parseInt(o.limit, 10));
      return json(200, out);
    }
    if (m === 'POST') {
      const body = JSON.parse(opt.body); const list = Array.isArray(body) ? body : [body];
      const prefer = String((opt.headers || {}).prefer || ''); const keys = UNIQUE[table]; const out = [];
      for (const b of list) {
        const ex = rows.find(r => keys.every(k => String(r[k]) === String(b[k])));
        if (ex && /merge-duplicates/.test(prefer)) { Object.assign(ex, b); out.push(ex); continue; }
        if (ex && /ignore-duplicates/.test(prefer)) { continue; }
        if (ex) return json(409, { message: 'duplicate' });
        const row = { id: uuid(), captured_at: new Date(Date.now() + (++seq)).toISOString(), ...b };
        rows.push(row); out.push(row);
      }
      return json(201, /return=representation/.test(prefer) ? out : null);
    }
    if (m === 'PATCH') {
      const body = JSON.parse(opt.body); let n = 0;
      for (const r of rows) if (match(r)) { if (table === 'vehicle_snapshots') db._patches.push({ id: r.id, body }); Object.assign(r, body); n++; }
      return json(204, null);
    }
    return json(405, {});
  }
  /* CDN площадки */
  if (/^https:\/\//.test(u)) {
    cdn.downloads++;
    if (cdn.gone.has(u)) return { ok: false, status: 404, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
    if (cdn.protectedUrls.has(u)) return { ok: false, status: 403, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
    const buf = imageBytes(u);
    return { ok: true, status: 200, headers: { get: h => (h === 'content-type' ? (/\.webp/.test(u) ? 'image/webp' : 'image/jpeg') : null) }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  }
  return json(404, {});
}
db._patches = [];

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  globalThis.fetch = fakeFetch;
  const VM = await import('file://' + path.join(dir, 'api', 'vehicle-memory.js'));
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const src = fs.readFileSync('api/check.js', 'utf8');

  /* пайплайн Check у мініатюрі: resolve Vehicle -> observe Listing -> preserve photos */
  async function check(l, url, tok) {
    let vehicleRow = l.vin ? await VM.readVehicle(l.vin) : null;
    if (l.vin) { const up = await VM.upsertVehicle(l.vin, { make: l.make || null, model: l.model || null, year: l.year || null, first_seen_at: vehicleRow ? undefined : new Date().toISOString(), last_seen_at: new Date().toISOString() }); if (up) vehicleRow = up; }
    const obs = await VM.observeListing(l, url, { jobToken: tok, vehicleId: vehicleRow ? vehicleRow.id : null, parserVersion: 'parser-test' });
    let photos = null;
    if (obs.snapshot.id && obs.snapshot.status !== 'dedup' && (l.photos || []).length) {
      photos = await VM.preservePhotos({ snapshotId: obs.snapshot.id, vehicleId: obs.vehicle_id, listingId: obs.listing_id, photos: l.photos.map((u, i) => ({ url: u, position: i, kind: 'listing' })) });
    }
    return { obs, photos };
  }
  const P = n => 'https://cdn.riastatic.com/photosnew/auto/photo/tesla__' + n + 'hd.webp';
  const L1 = { vin: '5YJSA1H23FFP69703', make: 'Tesla', model: 'Model S', year: 2015, domain: 'auto.ria.com', source_listing_id: '40185075', price: 17000, currency: 'USD', odometer_km: 167000, title: 'Tesla Model S 2015', seller_text: 'Продам власне авто Tesla Model S P85D у максимальній комплектації. Пневма, Ludicrous.', photos: [P('A'), P('B'), P('C'), P('D'), P('E')], listing_equipment: ['Пневмопідвіска'], history_facts: { owners_count: 1 }, listing_status: 'active', raw_page_text: 'весь текст сторінки', location: 'Київ', text: 't' };
  const U1 = 'https://auto.ria.com/uk/auto_tesla_model_s_40185075.html';

  /* ===== 16. SAME LISTING ===== */
  const c1 = await check(L1, U1, 'tok1');
  if (c1.obs.snapshot.status !== 'new' || !c1.obs.listing_created) errs.push('CHECK #1: ' + JSON.stringify(c1.obs));
  if (db.vehicles.length !== 1 || db.listings.length !== 1 || db.vehicle_snapshots.length !== 1) errs.push('CHECK #1 не створив рівно Vehicle/Listing/Snapshot: ' + [db.vehicles.length, db.listings.length, db.vehicle_snapshots.length]);
  if (db.photo_assets.length !== 5 || storage.size !== 5 || db.snapshot_photos.length !== 5) errs.push('CHECK #1 photo assets: ' + [db.photo_assets.length, storage.size, db.snapshot_photos.length]);
  if (!c1.photos || c1.photos.uploaded !== 5 || c1.photos.existing !== 0) errs.push('CHECK #1 stats: ' + JSON.stringify(c1.photos));
  const s1 = db.vehicle_snapshots[0];
  if (s1.vehicle_id !== db.vehicles[0].id || s1.listing_id !== db.listings[0].id || s1.schema_version !== 'snap-v1' || s1.parser_version !== 'parser-test') errs.push('Snapshot #1 без звʼязків/версій');
  if (s1.seller_text !== L1.seller_text || s1.raw_page_text !== 'весь текст сторінки' || s1.price_amount !== 17000 || s1.odometer_km !== 167000 || s1.photos.length !== 5) errs.push('Snapshot #1 без повного raw-доказу');
  if (db.listings[0].vehicle_id !== db.vehicles[0].id || db.listings[0].source !== 'auto.ria.com' || db.listings[0].source_listing_id !== '40185075' || db.listings[0].snapshots_count !== 1) errs.push('Listing #1: ' + JSON.stringify(db.listings[0]));
  const lastSeen1 = db.listings[0].last_seen_at, dl1 = cdn.downloads;
  const c2 = await check(L1, U1, 'tok2');
  if (c2.obs.snapshot.status !== 'dedup' || c2.obs.snapshot.id !== s1.id) errs.push('CHECK #2 не dedup: ' + JSON.stringify(c2.obs.snapshot));
  if (db.vehicles.length !== 1 || db.listings.length !== 1 || db.vehicle_snapshots.length !== 1 || db.photo_assets.length !== 5 || storage.size !== 5) errs.push('CHECK #2 створив зайве');
  if (cdn.downloads !== dl1) errs.push('CHECK #2 знову завантажував кадри');
  if (!(db.listings[0].last_seen_at >= lastSeen1) || db.listings[0].seen_count !== 2 || s1.seen_count !== 2 || !s1.last_seen_at) errs.push('last_seen_at/seen_count не оновились');

  /* ===== 17. CHANGES ===== */
  const c3 = await check({ ...L1, price: 16200 }, U1, 'tok3');
  if (c3.obs.snapshot.status !== 'changed' || db.vehicle_snapshots.length !== 2) errs.push('зміна ціни не дала Snapshot #2');
  const s2 = db.vehicle_snapshots[1];
  if (s1.price_amount !== 17000 || s2.price_amount !== 16200) errs.push('Snapshot #1 втратив стару ціну');
  if (db.photo_assets.length !== 5 || storage.size !== 5 || c3.photos.existing !== 5 || c3.photos.uploaded !== 0) errs.push('ті самі кадри збережені вдруге: ' + JSON.stringify(c3.photos));
  if (db.snapshot_photos.filter(x => x.snapshot_id === s2.id).length !== 5) errs.push('Snapshot #2 без звʼязків із кадрами');
  const c4 = await check({ ...L1, price: 16200, seller_text: 'Продам Tesla Model S P85D. Був у ДТП у 2022, відновлено.' }, U1, 'tok4');
  if (c4.obs.snapshot.status !== 'changed' || db.vehicle_snapshots.length !== 3) errs.push('зміна опису не дала Snapshot #3');
  const s3 = db.vehicle_snapshots[2];
  if (s1.seller_text !== L1.seller_text || s2.seller_text !== L1.seller_text || !/ДТП у 2022/.test(s3.seller_text)) errs.push('старі описи не збереглись повністю');
  const c5 = await check({ ...L1, price: 16200, seller_text: s3.seller_text, photos: [P('A'), P('B'), P('C'), P('F'), P('G')] }, U1, 'tok5');
  if (c5.obs.snapshot.status !== 'changed' || db.vehicle_snapshots.length !== 4) errs.push('зміна набору фото не дала Snapshot #4');
  const s4 = db.vehicle_snapshots[3];
  if (db.photo_assets.length !== 7 || storage.size !== 7 || c5.photos.uploaded !== 2 || c5.photos.existing !== 3) errs.push('дедуп бінарників A/B/C або збереження F/G: ' + JSON.stringify(c5.photos) + ' assets ' + db.photo_assets.length);
  const linksOf = sid => db.snapshot_photos.filter(x => x.snapshot_id === sid).sort((a, b) => a.position - b.position);
  const a1 = linksOf(s1.id), a4 = linksOf(s4.id);
  if (a4.length !== 5 || a4[0].photo_asset_id !== a1[0].photo_asset_id || a4[2].photo_asset_id !== a1[2].photo_asset_id || a4[3].photo_asset_id === a1[3].photo_asset_id) errs.push('SnapshotPhoto не показує A/B/C ті самі, F/G нові');
  if (a1.length !== 5 || a1[3].source_url_at_observation !== P('D')) errs.push('старий набір кадрів Snapshot #1 недоступний');
  if (db._patches.some(p => 'seller_text' in p.body || 'photos' in p.body || 'price_amount' in p.body || 'raw_page_text' in p.body)) errs.push('PATCH торкнувся raw-полів старого знімка');
  /* ротація CDN тих самих кадрів: ні нового знімка, ні нового бінарника */
  const c5b = await check({ ...L1, price: 16200, seller_text: s3.seller_text, photos: [P('A').replace('cdn.', 'cdn4.'), P('B'), P('C'), P('F'), P('G') + '?x=1'] }, U1, 'tok5b');
  if (c5b.obs.snapshot.status !== 'dedup' || db.photo_assets.length !== 7) errs.push('ротація CDN створила дубль знімка/бінарника');

  /* ===== 18. MULTIPLE LISTINGS, ONE VEHICLE ===== */
  const L2 = { ...L1, domain: 'olx.ua', source_listing_id: 'ABC123', price: 15900, seller_text: 'Tesla Model S на OLX', photos: [P('A'), P('H')] };
  const c6 = await check(L2, 'https://www.olx.ua/uk/obyavlenie/tesla-ABC123.html', 'tok6');
  if (db.vehicles.length !== 1 || db.listings.length !== 2) errs.push('друге оголошення створило другий Vehicle або не створило Listing: ' + [db.vehicles.length, db.listings.length]);
  if (c6.obs.snapshot.status !== 'new' || c6.obs.snapshot.previous_id) errs.push('ланцюг знімків L2 не окремий: ' + JSON.stringify(c6.obs.snapshot));
  if (db.listings[1].vehicle_id !== db.vehicles[0].id || db.vehicle_snapshots[4].vehicle_id !== db.vehicles[0].id) errs.push('L2 не привʼязаний до того самого Vehicle');
  if (db.photo_assets.length !== 8 || c6.photos.existing !== 1 || c6.photos.uploaded !== 1) errs.push('кадр A з іншої площадки збережений вдруге');
  const c6b = await check({ ...L1, price: 16200, seller_text: s3.seller_text, photos: [P('A'), P('B'), P('C'), P('F'), P('G')] }, U1, 'tok6b');
  if (c6b.obs.snapshot.status !== 'dedup' || c6b.obs.snapshot.id !== s4.id) errs.push('ланцюг L1 зламався після появи L2');

  /* ===== 19. 100 USERS ===== */
  const before = { v: db.vehicles.length, l: db.listings.length, s: db.vehicle_snapshots.length, a: db.photo_assets.length, st: storage.size, d: cdn.downloads };
  for (let i = 0; i < 100; i++) { const c = await check({ ...L1, price: 16200, seller_text: s3.seller_text, photos: [P('A'), P('B'), P('C'), P('F'), P('G')] }, U1, 'user' + i); if (c.obs.snapshot.status !== 'dedup') errs.push('user ' + i + ' створив знімок'); }
  if (db.vehicles.length !== before.v || db.listings.length !== before.l || db.vehicle_snapshots.length !== before.s || db.photo_assets.length !== before.a || storage.size !== before.st || cdn.downloads !== before.d) errs.push('100 users: ' + JSON.stringify({ before, after: { v: db.vehicles.length, l: db.listings.length, s: db.vehicle_snapshots.length, a: db.photo_assets.length, st: storage.size, d: cdn.downloads } }));
  if (db.listings[0].seen_count !== 103 || s4.seen_count !== 103) errs.push('seen_count після 100 users: ' + db.listings[0].seen_count + '/' + s4.seen_count);

  /* ===== LISTINGS WITHOUT VIN -> VIN LATER ===== */
  const L3 = { ...L1, vin: null, domain: 'auto.ria.com', source_listing_id: '55555555', price: 9000, seller_text: 'Без VIN у тексті', photos: [P('X')] };
  const c7 = await check(L3, 'https://auto.ria.com/uk/auto_bmw_x5_55555555.html', 'tok7');
  if (c7.obs.snapshot.status !== 'new' || c7.obs.vehicle_id || db.vehicles.length !== 1) errs.push('оголошення без VIN створило fake Vehicle або не створило знімок: ' + JSON.stringify(c7.obs));
  const l3 = db.listings.find(x => x.source_listing_id === '55555555');
  if (!l3 || l3.vehicle_id || db.vehicle_snapshots.find(x => x.listing_id === l3.id).vehicle_id) errs.push('Listing/Snapshot без VIN мають vehicle_id');
  const c8 = await check({ ...L3, price: 8800 }, 'https://auto.ria.com/uk/auto_bmw_x5_55555555.html', 'tok8');
  if (c8.obs.snapshot.status !== 'changed' || db.vehicle_snapshots.filter(x => x.listing_id === l3.id).length !== 2) errs.push('історія без VIN не копиться');
  const c9 = await check({ ...L3, price: 8800, vin: 'WBAJA9C55JB252679' }, 'https://auto.ria.com/uk/auto_bmw_x5_55555555.html', 'tok9');
  if (db.vehicles.length !== 2 || !c9.obs.attached) errs.push('VIN пізніше: Vehicle не створений або історія не привʼязана: ' + JSON.stringify(c9.obs));
  const v2 = db.vehicles.find(x => x.vin === 'WBAJA9C55JB252679');
  const chain3 = db.vehicle_snapshots.filter(x => x.listing_id === l3.id);
  if (!v2 || l3.vehicle_id !== v2.id || l3.vin !== 'WBAJA9C55JB252679' || chain3.length !== 2 || chain3.some(x => x.vehicle_id !== v2.id)) errs.push('попередня історія без VIN не привʼязана до canonical Vehicle: ' + JSON.stringify({ l3v: l3.vehicle_id, chain: chain3.map(x => x.vehicle_id) }));
  if (chain3[0].price_amount !== 9000 || chain3[1].price_amount !== 8800 || c9.obs.snapshot.status !== 'dedup') errs.push('привʼязка VIN переписала або продублювала знімки');

  /* ===== SOURCE IMAGE DISAPPEARS / PROTECTED ===== */
  cdn.gone.add(P('GONE')); cdn.protectedUrls.add('https://protected.example.com/photos/1.jpg');
  const L4 = { ...L1, vin: 'JTDKN3DU0A0000001', source_listing_id: '77777777', price: 5000, seller_text: 'Toyota', photos: [P('A'), P('GONE'), 'https://protected.example.com/photos/1.jpg'] };
  const c10 = await check(L4, 'https://auto.ria.com/uk/auto_toyota_77777777.html', 'tok10');
  const l4 = linksOf(c10.obs.snapshot.id);
  if (l4.length !== 3 || l4[0].storage_status !== 'stored' || l4[1].storage_status !== 'unavailable' || l4[1].reason !== 'http_404' || l4[2].storage_status !== 'unavailable' || l4[2].reason !== 'protected_403') errs.push('зниклий/захищений кадр: ' + JSON.stringify(l4.map(x => [x.storage_status, x.reason])));
  if (l4[1].source_url_at_observation !== P('GONE') || !l4[1].photo_identity || l4[1].position !== 1) errs.push('metadata зниклого кадру втрачені');
  if (c10.photos.unavailable !== 2 || c10.photos.existing !== 1 || db.photo_assets.length !== before.a + 1) errs.push('stats зниклого кадру: ' + JSON.stringify(c10.photos) + ' assets ' + db.photo_assets.length);

  /* ===== чисті функції і сторожі ===== */
  if (VM.listingKey({ domain: 'auto.ria.com', source_listing_id: '1' }, 'https://auto.ria.com/x_1.html').source_listing_id !== '1') errs.push('listingKey з id площадки');
  const k1 = VM.listingKey({ domain: 'example.com' }, 'https://example.com/cars/abc?utm_source=x#top'), k2 = VM.listingKey({ domain: 'example.com' }, 'https://example.com/cars/abc');
  if (k1.source_listing_id !== k2.source_listing_id || !k1.source_listing_id.startsWith('url:')) errs.push('listingKey без id не нормалізує адресу');
  if (VM.photoStoragePath('ab'.repeat(32), 'image/webp') !== 'ab/ab/' + 'ab'.repeat(32) + '.webp') errs.push('photoStoragePath');
  const fp = VM.listingFingerprint(L1);
  if (fp !== VM.listingFingerprint({ ...L1, price_context: { average_price: 1 } }) || fp === VM.listingFingerprint({ ...L1, listing_status: 'inactive' }) || fp === VM.listingFingerprint({ ...L1, photos: [P('B'), P('A'), P('C'), P('D'), P('E')] })) errs.push('listingFingerprint: контекст/статус/порядок кадрів');
  if (C.listingFingerprint !== VM.listingFingerprint || C.photoIdentity !== VM.photoIdentity || C.HISTORICAL_VISUAL_VERSION !== 'hv-2026-09-03-v3') errs.push('check.js не реекспортує спільні ідентичності/версію');
  for (const k of ['const observation = await observeListing(listing, url, { jobToken: job && job.token, vehicleId: vehicleRow && vehicleRow.id ? vehicleRow.id : null, parserVersion: PARSER_VERSION });', "kind: 'listing' })), budgetMs: 100000", "kind: 'historical_evidence'", 'vehicle_id: observation.vehicle_id || null,', 'listing_id: observation.listing_id || null,', 'photo_preservation: photoPreservation,', 'patchSnapshotClaims(snapshot.id, parsed)']) {
    if (!src.includes(k)) errs.push('check.js: нема ' + k);
  }
  if (src.indexOf('const observation = await observeListing(') > src.indexOf("progress('ai');")) errs.push('спостереження не перед AI');
  if (/async function saveSnapshot|SNAPSHOT_V0_COLS/.test(src)) errs.push('стара saveSnapshot лишилась у check.js');
  const mig = fs.readFileSync('supabase-vehicle-memory-v1.sql', 'utf8');
  if (/drop |alter column|delete from|truncate|rename/i.test(mig)) errs.push('міграція не аддитивна');
  for (const k of ['create table if not exists listings', 'create table if not exists photo_assets', 'create table if not exists snapshot_photos', 'unique (source, source_listing_id)', 'content_hash text not null unique', 'unique (snapshot_id, kind, position)', "values ('vehicle-evidence', 'vehicle-evidence', false)", 'enable row level security']) if (!mig.includes(k)) errs.push('міграція без ' + k);
  if (!/update vehicle_snapshots s set vehicle_id = v\.id from vehicles v where s\.vehicle_id is null/.test(mig)) errs.push('backfill звʼязків не обмежений порожніми');
  if (!fs.existsSync('docs/VEHICLE_INTELLIGENCE_STORAGE.md')) errs.push('нема docs/VEHICLE_INTELLIGENCE_STORAGE.md');

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('VEHICLE MEMORY TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('1 VIN = 1 Vehicle · Listing окремо · immutable-знімки · dedup без дублів · A/B/C один бінарник · 2 listings 1 vehicle · 100 users · без VIN -> VIN · зниклий кадр');
  console.log('VEHICLE MEMORY TEST PASSED');
})().catch(e => { console.log('VEHICLE MEMORY TEST CRASHED:', e.stack || e.message); process.exit(1); });
