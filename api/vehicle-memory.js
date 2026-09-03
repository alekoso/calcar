/* CalCar Vehicle Memory: одна canonical сутність на VIN і обʼєктивна
   історія авто в часі.

   Сутності (див. docs/VEHICLE_INTELLIGENCE_STORAGE.md):
     Vehicle        один рядок на VIN (vehicles);
     Listing        одне оголошення площадки: source + source_listing_id
                    (listings), може існувати БЕЗ VIN і привʼязатись пізніше;
     Snapshot       immutable стан оголошення (vehicle_snapshots): той самий
                    відбиток лише продовжує last_seen_at, змінений стан
                    створює новий рядок; старий рядок ніколи не втрачає
                    свого змісту;
     PhotoAsset     один бінарник на content hash (photo_assets + Storage);
     SnapshotPhoto  звʼязок знімок -> кадр з позицією і URL на момент
                    спостереження (snapshot_photos).
   Report НЕ є Vehicle Memory: рішення, чат і контекст покупця живуть у
   reports/check_jobs і сюди не потрапляють.

   Модуль спілкується з Supabase лише через REST і глобальний fetch, тому
   тести підміняють fetch заглушкою і перевіряють саме логіку. Без
   SUPABASE_URL/ключа всі функції мовчки повертають "env_missing". */

import crypto from 'crypto';
import { HISTORICAL_VISUAL_VERSION } from './visual-signals.js';

export const SNAPSHOT_SCHEMA_VERSION = 'snap-v1';
export const LISTING_FINGERPRINT_VERSION = 'lf-v1';
export const PHOTO_STORAGE_BUCKET = 'vehicle-evidence';
export const PHOTO_PRESERVE_MAX = 120;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_CONCURRENCY = 6;

/* ---------- REST-помічники ---------- */
function env() {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return base && key ? { root: base.replace(/\/$/, ''), key } : null;
}
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const e = env();
  if (!e) return { ok: false, status: 0, rows: null, missing: true };
  const headers = { apikey: e.key, authorization: 'Bearer ' + e.key, 'content-type': 'application/json' };
  if (prefer) headers.prefer = prefer;
  try {
    const r = await fetch(e.root + '/rest/v1/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let rows = null;
    if (r.status !== 204) { try { rows = await r.json(); } catch (err) { rows = null; } }
    return { ok: r.ok, status: r.status, rows };
  } catch (err) { return { ok: false, status: 0, rows: null, error: err.message }; }
}
const first = res => (res && res.ok && Array.isArray(res.rows) && res.rows[0]) ? res.rows[0] : null;

/* ---------- ідентичності і відбитки ---------- */
/* ідентичність кадру: CDN площадки ротує піддомени (cdn -> cdn4) і додає
   query, а кадр той самий */
export function photoIdentity(u) {
  if (typeof u !== 'string') return '';
  if (!/^https?:\/\//i.test(u)) return u;
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase().replace(/^(?:www\.)?/, '').replace(/^cdn\d+\./, 'cdn.');
    return host + x.pathname.toLowerCase();
  } catch (e) { return u; }
}
export function photoSetFingerprint(urls, version = HISTORICAL_VISUAL_VERSION) {
  const norm = [...new Set((urls || []).filter(u => typeof u === 'string').map(photoIdentity).filter(Boolean))].sort().join('|') + '::' + version;
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h * 33) ^ norm.charCodeAt(i)) >>> 0;
  return version + ':' + h.toString(36);
}
/* відбиток стану оголошення: ціна, пробіг, повний текст продавця,
   впорядковані ідентичності кадрів, поля площадки, статус. Ринковий
   контекст (середня ціна) НЕ входить: він змінюється сам по собі */
export function listingFingerprint(l) {
  const norm = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? null : v);
  const state = {
    v: LISTING_FINGERPRINT_VERSION,
    price: l.price ?? null, currency: l.currency || null, odometer_km: l.odometer_km ?? null,
    seller_text: norm(l.seller_text) || null,
    photos: (l.photos || []).map(photoIdentity),
    equipment: (l.listing_equipment || []).map(norm),
    history_facts: l.history_facts || null,
    year: l.year ?? null, title: norm(l.title) || null,
    status: l.listing_status || 'active',
  };
  return LISTING_FINGERPRINT_VERSION + ':' + crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 24);
}
/* ключ оголошення: площадка + її id; без id площадки ключем стає
   нормалізована адреса (без hash і трекінгових параметрів) */
export function listingKey(l, url) {
  const source = String(l.domain || (/^https?:\/\/(?:www\.)?([^\/]+)/i.exec(url) || [])[1] || 'unknown').toLowerCase();
  if (l.source_listing_id) return { source, source_listing_id: String(l.source_listing_id) };
  let norm = String(url || '').split('#')[0];
  try { const x = new URL(norm); for (const k of [...x.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$|^ref$/i.test(k)) x.searchParams.delete(k); norm = x.toString(); } catch (e) {}
  return { source, source_listing_id: 'url:' + crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16) };
}

/* ---------- рядок знімка ---------- */
export function snapshotRow(l, url, jobToken, links = {}) {
  const photos = (l.photos || []).slice(0, PHOTO_PRESERVE_MAX);
  const now = new Date().toISOString();
  return {
    vin: l.vin || null, plate: l.plate || null,
    source_url: url, source_domain: l.domain, country: l.country,
    price_amount: l.price ?? null, price_currency: l.currency || null,
    odometer_km: l.odometer_km ?? null, year: l.year ?? null, make: l.make || null, model: l.model || null,
    listing: { title: l.title, text: l.text },
    photos,
    seller_text: l.seller_text || null,
    listing_fields: {
      generation: l.generation || null,
      listing_equipment: l.listing_equipment || [],
      price_context: l.price_context || null,
      history_facts: l.history_facts || null,
      auction_url: l.auction_url || null,
      usa_photos: l.usa_photos || [],
      photos_total: (l.photos || []).length,
    },
    job_token: jobToken || null,
    source_listing_id: l.source_listing_id || null,
    listing_fingerprint: listingFingerprint(l),
    first_seen_at: now, last_seen_at: now, seen_count: 1,
    title: l.title || null,
    location: l.location || null,
    seller_meta: l.seller_meta || null,
    listing_status: l.listing_status || 'active',
    photo_items: photos.map((u, i) => ({ i, url: u, id: photoIdentity(u) })),
    photo_set_fingerprint: photoSetFingerprint(photos, 'ps-v1'),
    seller_claims: { history_facts: l.history_facts || null, listing_equipment: l.listing_equipment || [], ai_discrepancies: null },
    raw_page_text: l.raw_page_text || null,
    /* Vehicle Memory V1: звʼязки і версії */
    vehicle_id: links.vehicleId || null,
    listing_id: links.listingId || null,
    parser_version: links.parserVersion || null,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
  };
}
const SNAPSHOT_V1_COLS = ['vehicle_id', 'listing_id', 'parser_version', 'schema_version'];
const SNAPSHOT_V0_COLS = ['source_listing_id', 'listing_fingerprint', 'first_seen_at', 'last_seen_at', 'seen_count', 'title', 'location', 'seller_meta', 'listing_status', 'photo_items', 'photo_set_fingerprint', 'seller_claims', 'raw_page_text'];
const SNAPSHOT_LEGACY_EXTRA = ['seller_text', 'listing_fields', 'job_token'];

/* ---------- Vehicle ---------- */
export const NHTSA_DECODER_VERSION = 'vpic-v1';
export async function readVehicle(vin) {
  if (!vin) return null;
  return first(await rest('vehicles?vin=eq.' + encodeURIComponent(vin) + '&select=*&limit=1'));
}
/* один рядок на VIN: merge-duplicates, null-поля не затирають відоме */
export async function upsertVehicle(vin, patch) {
  if (!vin) return null;
  const row = { vin };
  for (const [k, v] of Object.entries(patch || {})) if (v !== null && v !== undefined) row[k] = v;
  const r = await rest('vehicles?on_conflict=vin', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' });
  return first(r);
}

/* ---------- Listing ---------- */
export async function resolveListing(l, url, { vehicleId = null } = {}) {
  const key = listingKey(l, url);
  const now = new Date().toISOString();
  const found = first(await rest('listings?source=eq.' + encodeURIComponent(key.source) + '&source_listing_id=eq.' + encodeURIComponent(key.source_listing_id) + '&select=*&limit=1'));
  if (found) return { listing: found, created: false, key };
  const ins = await rest('listings?on_conflict=source,source_listing_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { source: key.source, source_listing_id: key.source_listing_id, url: String(url || '').split('#')[0], vin: l.vin || null, vehicle_id: vehicleId || null, first_seen_at: now, last_seen_at: now, current_status: l.listing_status || 'active', snapshots_count: 0 },
  });
  const row = first(ins);
  if (row) return { listing: row, created: true, key };
  return { listing: null, created: false, key, error: ins.status };
}
/* VIN зʼявився пізніше: оголошення і вся його історія знімків
   привʼязуються до canonical Vehicle. Це ЄДИНИЙ дозволений UPDATE старих
   знімків: заповнення порожнього звʼязку, зміст знімка не чіпається */
export async function attachVehicleToListing(listingId, vehicleId, vin) {
  if (!listingId || !vehicleId) return false;
  const a = await rest('listings?id=eq.' + encodeURIComponent(listingId) + '&vehicle_id=is.null', { method: 'PATCH', prefer: 'return=minimal', body: { vehicle_id: vehicleId, vin: vin || null } });
  const b = await rest('vehicle_snapshots?listing_id=eq.' + encodeURIComponent(listingId) + '&vehicle_id=is.null', { method: 'PATCH', prefer: 'return=minimal', body: { vehicle_id: vehicleId, vin: vin || null } });
  return !!(a.ok && b.ok);
}

/* ---------- Observation: Check як спостереження Vehicle Memory ----------
   fetch listing -> resolve Vehicle -> resolve Listing -> порівняти з
   останнім знімком -> dedup або новий immutable знімок. Персональні дані
   користувача сюди не потрапляють */
export async function observeListing(l, url, { jobToken = null, vehicleId = null, parserVersion = null } = {}) {
  if (!env()) return { status: 'env_missing', snapshot: { status: 'env_missing', id: null }, listing_id: null, vehicle_id: vehicleId };
  const out = { vehicle_id: vehicleId || null, listing_id: null, listing_created: false, snapshot: { status: 'error', id: null }, attached: false };
  try {
    const { listing, created } = await resolveListing(l, url, { vehicleId });
    if (listing) { out.listing_id = listing.id; out.listing_created = created; }
    /* VIN знайдено, а оголошення жило без нього: привʼязати історію */
    if (listing && vehicleId && !listing.vehicle_id) out.attached = await attachVehicleToListing(listing.id, vehicleId, l.vin);
    const row = snapshotRow(l, url, jobToken, { vehicleId, listingId: out.listing_id, parserVersion });
    /* останній знімок ЦЬОГО оголошення; старі рядки без listing_id
       знаходяться за VIN або адресою */
    let last = null;
    if (out.listing_id) last = first(await rest('vehicle_snapshots?listing_id=eq.' + encodeURIComponent(out.listing_id) + '&order=captured_at.desc&limit=1&select=id,captured_at,listing_fingerprint,seen_count'));
    if (!last) {
      const q = l.vin ? 'vin=eq.' + encodeURIComponent(l.vin) : 'source_url=eq.' + encodeURIComponent(url);
      last = first(await rest('vehicle_snapshots?' + q + '&order=captured_at.desc&limit=1&select=id,captured_at,listing_fingerprint,seen_count,listing_id'));
      if (last && last.listing_id && out.listing_id && last.listing_id !== out.listing_id) last = null;   /* інше оголошення того ж авто */
    }
    const now = row.last_seen_at;
    if (last && last.listing_fingerprint && last.listing_fingerprint === row.listing_fingerprint) {
      const seen = (last.seen_count || 1) + 1;
      const r1 = await rest('vehicle_snapshots?id=eq.' + encodeURIComponent(last.id), { method: 'PATCH', prefer: 'return=minimal', body: { last_seen_at: now, seen_count: seen } });
      if (r1.ok) {
        out.snapshot = { status: 'dedup', id: last.id, seen_count: seen };
        if (out.listing_id) await rest('listings?id=eq.' + encodeURIComponent(out.listing_id), { method: 'PATCH', prefer: 'return=minimal', body: { last_seen_at: now, current_status: row.listing_status, seen_count: seen } });
        return out;
      }
    }
    let r = await rest('vehicle_snapshots', { method: 'POST', prefer: 'return=representation', body: row });
    if (!r.ok && r.status === 400) {
      const v0 = { ...row }; for (const c of SNAPSHOT_V1_COLS) delete v0[c];
      r = await rest('vehicle_snapshots', { method: 'POST', prefer: 'return=representation', body: v0 });
      if (!r.ok && r.status === 400) {
        const legacy = { ...v0 }; for (const c of [...SNAPSHOT_V0_COLS, ...SNAPSHOT_LEGACY_EXTRA]) delete legacy[c];
        r = await rest('vehicle_snapshots', { method: 'POST', prefer: 'return=representation', body: legacy });
      }
    }
    const ins = first(r);
    if (!ins) { out.snapshot = { status: 'error_' + r.status, id: null }; return out; }
    out.snapshot = { status: last ? 'changed' : 'new', id: ins.id, previous_id: last ? last.id : null, fingerprint: row.listing_fingerprint };
    if (out.listing_id) {
      const cur = first(await rest('listings?id=eq.' + encodeURIComponent(out.listing_id) + '&select=snapshots_count&limit=1'));
      await rest('listings?id=eq.' + encodeURIComponent(out.listing_id), { method: 'PATCH', prefer: 'return=minimal', body: { last_seen_at: now, current_status: row.listing_status, last_snapshot_id: ins.id, last_fingerprint: row.listing_fingerprint, snapshots_count: ((cur && cur.snapshots_count) || 0) + 1, seen_count: 1 } });
    }
    return out;
  } catch (e) { out.snapshot = { status: 'error', id: null, error: e.message }; return out; }
}

/* після AI: нормалізовані заяви продавця з розбіжностей ДОПОВНЮЮТЬ знімок
   (нове поле, raw-доказ не чіпається) */
export async function patchSnapshotClaims(id, parsed) {
  if (!id || !parsed) return false;
  const disc = (Array.isArray(parsed.discrepancies) ? parsed.discrepancies : []).map(d => ({ title: (d && d.title) || null, severity: (d && d.severity) || null })).filter(d => d.title).slice(0, 20);
  const row = first(await rest('vehicle_snapshots?id=eq.' + encodeURIComponent(id) + '&select=seller_claims'));
  const claims = { ...((row && row.seller_claims) || {}), ai_discrepancies: disc, ai_seller_claims_us_import: parsed?.score_facts?.signals?.seller_claims_us_import === true };
  const r = await rest('vehicle_snapshots?id=eq.' + encodeURIComponent(id), { method: 'PATCH', prefer: 'return=minimal', body: { seller_claims: claims } });
  return r.ok;
}

/* ---------- Photo Assets: один бінарник на content hash ----------
   Кадр завантажується дозволеним способом (публічна адреса площадки,
   без обходу захисту), хешується SHA-256; існуючий hash -> лише звʼязок,
   новий -> один раз у приватний bucket Storage. Джерело, що не віддає
   кадр, лишає metadata_only/unavailable: URL, ідентичність, позиція і
   provenance зберігаються все одно. Perceptual-дедуп свідомо не робиться:
   змінена версія кадру сама є частиною історії */
export function photoStoragePath(hash, mime) {
  const ext = /webp/i.test(mime) ? 'webp' : /png/i.test(mime) ? 'png' : /gif/i.test(mime) ? 'gif' : /avif/i.test(mime) ? 'avif' : 'jpg';
  return hash.slice(0, 2) + '/' + hash.slice(2, 4) + '/' + hash + '.' + ext;
}
async function downloadImage(url, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const u = new URL(url);
    const r = await fetch(u.toString(), { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', accept: 'image/avif,image/webp,image/*,*/*;q=0.8', referer: u.origin + '/' } });
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (r.status === 401 || r.status === 403) return { status: 'unavailable', reason: 'protected_' + r.status };
    if (!r.ok) return { status: 'unavailable', reason: 'http_' + r.status };
    if (!/^image\//.test(type)) return { status: 'unavailable', reason: 'not_image' };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > PHOTO_MAX_BYTES) return { status: 'unavailable', reason: buf.length ? 'too_large' : 'empty' };
    return { status: 'ok', buf, type };
  } catch (e) { return { status: 'unavailable', reason: e.name === 'AbortError' ? 'timeout' : 'fetch_failed' }; }
  finally { clearTimeout(t); }
}
async function storageUpload(path, buf, mime) {
  const e = env();
  if (!e) return false;
  try {
    const r = await fetch(e.root + '/storage/v1/object/' + PHOTO_STORAGE_BUCKET + '/' + path, {
      method: 'POST', headers: { apikey: e.key, authorization: 'Bearer ' + e.key, 'content-type': mime || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '31536000' }, body: buf,
    });
    return r.ok || r.status === 409;
  } catch (err) { return false; }
}
/* photos: [{ url, position, kind: 'listing'|'historical_evidence', event_key?, buf?, type? }] */
export async function preservePhotos({ snapshotId, vehicleId = null, listingId = null, photos, budgetMs = 90000, timeoutMs = 12000 }) {
  const stats = { total: 0, hashed: 0, existing: 0, uploaded: 0, metadata_only: 0, unavailable: 0, linked: 0, bytes: 0, ms: 0 };
  if (!env() || !snapshotId || !Array.isArray(photos) || !photos.length) return stats;
  const t0 = Date.now();
  const list = photos.slice(0, PHOTO_PRESERVE_MAX);
  stats.total = list.length;
  const now = new Date().toISOString();
  const items = list.map(p => ({ ...p, identity: photoIdentity(p.url), hash: null, mime: null, size: null, buf: null, status: 'pending', reason: null }));
  /* 1. байти: або вже на руках, або завантаження з бюджетом часу */
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const it = items[idx++];
      if (Date.now() - t0 > budgetMs) { it.status = 'metadata_only'; it.reason = 'time_budget'; stats.metadata_only++; continue; }
      let got;
      if (it.buf && it.buf.length) got = { status: 'ok', buf: it.buf, type: it.type || 'image/jpeg' };
      else if (/^https:\/\//i.test(String(it.url))) got = await downloadImage(it.url, timeoutMs);
      else got = { status: 'unavailable', reason: 'not_https' };
      if (got.status !== 'ok') { it.status = 'unavailable'; it.reason = got.reason; stats.unavailable++; continue; }
      it.buf = got.buf; it.mime = got.type; it.size = got.buf.length;
      it.hash = crypto.createHash('sha256').update(got.buf).digest('hex');
      stats.hashed++; stats.bytes += got.buf.length;
    }
  };
  await Promise.all(Array.from({ length: PHOTO_CONCURRENCY }, worker));
  /* 2. які hash уже є */
  const hashes = [...new Set(items.filter(i => i.hash).map(i => i.hash))];
  const assetByHash = new Map();
  for (let i = 0; i < hashes.length; i += 50) {
    const chunk = hashes.slice(i, i + 50);
    const r = await rest('photo_assets?content_hash=in.(' + chunk.map(h => '"' + h + '"').join(',') + ')&select=id,content_hash,storage_status');
    for (const row of (r.ok && Array.isArray(r.rows)) ? r.rows : []) assetByHash.set(row.content_hash, row);
  }
  /* 3. нові бінарники: один раз у Storage, один рядок photo_assets */
  const seenNew = new Set();
  for (const it of items) {
    if (!it.hash) continue;
    if (assetByHash.has(it.hash)) { it.status = 'existing'; continue; }
    if (seenNew.has(it.hash)) { it.status = 'existing_in_batch'; continue; }
    seenNew.add(it.hash);
    const path = photoStoragePath(it.hash, it.mime);
    const stored = await storageUpload(path, it.buf, it.mime);
    const r = await rest('photo_assets?on_conflict=content_hash', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: { content_hash: it.hash, source_url: it.url, provenance: it.kind === 'historical_evidence' ? (it.event_key || 'historical_evidence') : 'listing', mime_type: it.mime, byte_size: it.size, storage_path: stored ? path : null, storage_status: stored ? 'stored' : 'metadata_only', first_vehicle_id: vehicleId, created_at: now },
    });
    let row = first(r);
    if (!row) row = first(await rest('photo_assets?content_hash=eq.' + it.hash + '&select=id,content_hash,storage_status'));
    if (row) { assetByHash.set(it.hash, row); it.status = stored ? 'uploaded' : 'metadata_only'; if (stored) stats.uploaded++; else stats.metadata_only++; }
    else { it.status = 'metadata_only'; it.reason = 'asset_insert_failed'; stats.metadata_only++; }
  }
  for (const it of items) if (it.status === 'existing' || it.status === 'existing_in_batch') stats.existing++;
  /* 4. звʼязки знімок -> кадр: завжди, навіть без бінарника */
  const links = items.map(it => ({
    snapshot_id: snapshotId, vehicle_id: vehicleId, listing_id: listingId,
    photo_asset_id: it.hash && assetByHash.get(it.hash) ? assetByHash.get(it.hash).id : null,
    kind: it.kind || 'listing', event_key: it.event_key || null, position: it.position,
    source_url_at_observation: it.url, photo_identity: it.identity,
    storage_status: it.hash && assetByHash.get(it.hash) ? (assetByHash.get(it.hash).storage_status || 'stored') : (it.status === 'unavailable' ? 'unavailable' : 'metadata_only'),
    reason: it.reason, observed_at: now,
  }));
  for (let i = 0; i < links.length; i += 100) {
    const r = await rest('snapshot_photos?on_conflict=snapshot_id,kind,position', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: links.slice(i, i + 100) });
    if (r.ok) stats.linked += Math.min(100, links.length - i);
  }
  for (const it of items) it.buf = null;
  stats.ms = Date.now() - t0;
  return stats;
}
