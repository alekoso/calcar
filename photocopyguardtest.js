/* Копія кадру оголошення не є історичним доказом.

   Реальний випадок продакшну: для VW Touareg WVGZZZCR6TD014831 агрегатор
   carsniper.com.ua пройшов як "знайдений аукціонний запис", а його єдиний
   кадр cdn0.riastatic.com/.../volkswagen_touareg__644158307hd.webp байт у
   байт (SHA-256 771e7123...) збігся з кадром самого оголошення
   cdn2.riastatic.com/.../volkswagen_touareg__644158307hd.webp. Цей кадр
   пішов у Historical Vision як "до ремонту" і в збережені historical_evidence.

   Тут доводиться:
   - кадр, чия ідентичність збігається з кадром поточного оголошення або з
     кадром оголошень цієї машини, відомим памʼяті, до Vision не йде;
   - байти, отримані через захищений CDN, звіряються за SHA-256;
   - незалежний аукціонний кадр лишається;
   - читання відбитків памʼяті іде одним REST-запитом і логує збій.

   Запуск: node photocopyguardtest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_photocopy_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

/* реальні URL, ідентичність і хеш із продакшну (snapshot_photos, 2026-09-10) */
const LISTING_0 = 'https://cdn2.riastatic.com/photosnew/auto/photo/volkswagen_touareg__644158307hd.webp';
const LISTING_29 = 'https://cdn2.riastatic.com/photosnew/auto/photo/volkswagen_touareg__644161587hd.webp';
const CARSNIPER_PHOTO = 'https://cdn0.riastatic.com/photosnew/auto/photo/volkswagen_touareg__644158307hd.webp';
const STORED_IDENTITY = 'cdn.riastatic.com/photosnew/auto/photo/volkswagen_touareg__644158307hd.webp';
const REAL_AUCTION = 'https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0525/f924015599aa416e8af5a5ee8f78d580_hrs.jpg';

(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const VM = await import('file://' + path.join(dir, 'api', 'vehicle-memory.js'));
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const logs = [];
  try {
    /* 1. той самий кадр, інший піддомен CDN (Touareg/carsniper) */
    ok('ідентичність копії carsniper дорівнює збереженій ідентичності кадру оголошення', VM.photoIdentity(CARSNIPER_PHOTO) === STORED_IDENTITY,
      VM.photoIdentity(CARSNIPER_PHOTO));
    const s1 = C.splitCopiedListingPhotos([CARSNIPER_PHOTO, REAL_AUCTION], { listingPhotos: [LISTING_0, LISTING_29] });
    ok('копія кадру поточного оголошення відкидається', s1.dropped.length === 1 && s1.dropped[0] === CARSNIPER_PHOTO, JSON.stringify(s1));
    ok('незалежний аукціонний кадр лишається', s1.kept.length === 1 && s1.kept[0] === REAL_AUCTION);

    /* 2. варіант розміру того самого кадру RIA (hd -> fx) теж копія */
    const s2 = C.splitCopiedListingPhotos(['https://cdn4.riastatic.com/photosnew/auto/photo/volkswagen_touareg__644158307fx.webp'], { listingPhotos: [LISTING_0] });
    ok('варіант розміру кадру оголошення відкидається', s2.dropped.length === 1, JSON.stringify(s2));

    /* 3. кадр оголошення з МИНУЛОГО знімка, відомий лише памʼяті */
    const known = { identities: new Set([STORED_IDENTITY]), hashes: new Set(), ok: true };
    const s3 = C.splitCopiedListingPhotos([CARSNIPER_PHOTO], { listingPhotos: [LISTING_29], known });
    ok('копія кадру, відомого памʼяті, відкидається навіть без нього в поточному оголошенні', s3.dropped.length === 1 && s3.kept.length === 0, JSON.stringify(s3));
    const s4 = C.splitCopiedListingPhotos([CARSNIPER_PHOTO], { listingPhotos: [LISTING_29] });
    ok('без збігу ні з оголошенням, ні з памʼяттю кадр лишається', s4.kept.length === 1);

    /* 4. байти через захищений CDN: SHA-256 */
    const bytes = Buffer.from('JPEG-BYTES-OF-LISTING-PHOTO-0');
    const knownHash = { identities: new Set(), hashes: new Set([crypto.createHash('sha256').update(bytes).digest('hex')]) };
    ok('байти кадру оголошення розпізнаються за SHA-256', C.isCopiedListingBytes(bytes, knownHash) === true);
    ok('інші байти не вважаються копією', C.isCopiedListingBytes(Buffer.from('OTHER'), knownHash) === false);
    ok('без відомих хешів нічого не відкидається', C.isCopiedListingBytes(bytes, { hashes: new Set() }) === false && C.isCopiedListingBytes(bytes, null) === false);
    ok('data-URI не відкидається звіркою за URL (його звіряють байти)', C.splitCopiedListingPhotos(['data:image/jpeg;base64,AAAA'], { listingPhotos: [LISTING_0] }).kept.length === 1);

    /* 5. відбитки памʼяті: один REST-запит, хеші з вбудованого photo_assets */
    let seen = null;
    globalThis.fetch = async url => {
      seen = String(url);
      return { ok: true, status: 200, json: async () => [
        { photo_identity: STORED_IDENTITY, photo_assets: { content_hash: '771e7123775bdd47571beaf99351427365e2642f783e426f565503316da7d924' } },
        { photo_identity: 'cdn.riastatic.com/photosnew/auto/photo/volkswagen_touareg__644161587hd.webp', photo_assets: null },
      ] };
    };
    const fp = await VM.readListingPhotoFingerprints('44652ac9-8a57-41de-bb32-4add4fa621a9');
    ok('запит відбитків фільтрує кадри оголошень цієї машини', /snapshot_photos\?vehicle_id=eq\.44652ac9-8a57-41de-bb32-4add4fa621a9&kind=eq\.listing&select=photo_identity,photo_assets\(content_hash\)/.test(seen || ''), seen);
    ok('відбитки містять ідентичності і хеші', fp.ok && fp.identities.has(STORED_IDENTITY) && fp.hashes.has('771e7123775bdd47571beaf99351427365e2642f783e426f565503316da7d924') && fp.identities.size === 2 && fp.hashes.size === 1);

    console.log = (...a) => logs.push(a.map(String).join(' '));
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ code: '42703' }) });
    const bad = await VM.readListingPhotoFingerprints('veh-1');
    console.log = realLog;
    ok('збій читання відбитків повертає порожні множини', bad.ok === false && bad.identities.size === 0 && bad.hashes.size === 0);
    ok('збій читання відбитків логується', logs.some(l => /"op":"read_listing_photo_fingerprints"/.test(l) && /"status":400/.test(l)), logs.join(' | '));

    /* 6. місце в пайплайні: guard стоїть до Vision і до historical_evidence */
    const src = fs.readFileSync('api/check.js', 'utf8');
    const iGuard = src.indexOf('const copyGuard = splitCopiedListingPhotos(provenancedCandidates');
    const iCands = src.indexOf('const photoCandidates = copyGuard.kept;');
    const iDirect = src.indexOf('const directCandidates = photoCandidates.filter(visionDirect);');
    const iHv = src.indexOf('hvCache.fingerprint = photoSetFingerprint(hvPhotoIds);');
    const iEvidence = src.indexOf('const evidencePreservePromise =');
    ok('guard застосовується до формування набору для Vision', iGuard > 0 && iGuard < iCands && iCands < iDirect && iDirect < iHv, [iGuard, iCands, iDirect, iHv].join(','));
    ok('guard стоїть до збереження historical_evidence', iGuard > 0 && iGuard < iEvidence);
    ok('байти захищеного CDN звіряються до додавання в набір', /for \(const ph of hp\.photos\) \{[\s\S]{0,200}?isCopiedListingBytes\(ph\.buf, knownListingPhotos\)[\s\S]{0,400}?continue;[\s\S]{0,40}?auctionPhotos\.push/.test(src));
    ok('відкидання копій логується', /op: 'copied_listing_photo_dropped', by: 'identity'/.test(src) && /op: 'copied_listing_photo_dropped', by: 'sha256'/.test(src));
  } finally {
    console.log = realLog;
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errs.length) {
    console.error('photocopyguardtest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('photocopyguardtest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('photocopyguardtest CRASHED:', e.stack || e.message); process.exit(1); });
