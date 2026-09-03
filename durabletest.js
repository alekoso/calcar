/* Durable Check: job-обгортка, стабільний кеш історичного візуалу,
   read-only звіт за токеном, проксі архівних фото. Ядро аналізу не чіпаємо:
   перевіряються контракти навколо нього і те, що вони не ламають старий
   синхронний шлях. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_durable_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
/* усі модулі api/: check.js імпортує сусідів (score, auction, locale, visual-signals) */
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}
(async () => {
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const J = await import('file://' + path.join(dir, 'api', 'check-job.js'));
  const I = await import('file://' + path.join(dir, 'api', 'img.js'));
  const src = fs.readFileSync('api/check.js', 'utf8');

  /* 1. токен: непрозорий, 128 біт, url-safe, без послідовності */
  const toks = new Set(); for (let i = 0; i < 200; i++) toks.add(C.makeJobToken());
  if (toks.size !== 200) errs.push('токени повторюються');
  for (const tk of toks) if (!/^[A-Za-z0-9_-]{22}$/.test(tk)) errs.push('токен не base64url/22: ' + tk);

  /* 2. заглушка res: ядро пише статус і тіло, обгортка їх читає */
  const shim = C.fakeRes();
  shim.status(422).json({ error: 'x' });
  if (shim._s !== 422 || shim._o.error !== 'x') errs.push('fakeRes не запамʼятовує статус/тіло');
  if (C.fakeRes()._s !== 200) errs.push('fakeRes дефолт не 200');

  /* 3. waitUntil читається з контексту запиту Vercel без npm-залежності */
  if (typeof C.vercelWaitUntil() !== 'object' && C.vercelWaitUntil() !== null) errs.push('vercelWaitUntil поза Vercel мав дати null');
  const sym = Symbol.for('@vercel/request-context');
  let called = null;
  globalThis[sym] = { get: () => ({ waitUntil: p => { called = p; } }) };
  const wu = C.vercelWaitUntil();
  if (typeof wu !== 'function') errs.push('waitUntil не знайдений у контексті');
  else { wu(Promise.resolve(1)); if (!called) errs.push('waitUntil не викликаний'); }
  delete globalThis[sym];

  /* 4. без waitUntil або без Supabase: стара синхронна поведінка (сторож) */
  if (!/if \(!durable\) return runCheck\(req, res, null\);/.test(src)) errs.push('нема синхронного фолбеку без durable');
  if (!/if \(!created\) return runCheck\(req, res, null\);/.test(src)) errs.push('нема фолбеку, коли таблиці check_jobs ще нема');
  if (!/res\.status\(202\)\.json\(\{ job: token \}\)/.test(src)) errs.push('durable не відповідає 202 з токеном');
  if (!/shim\._o\._meta\.share_token = token/.test(src)) errs.push('токен не кладеться у _meta.share_token');
  for (const st of ["progress('listing')", "progress('identity')", "progress('history')", "progress('ai')", "progress('scoring')"]) {
    if (!src.includes(st)) errs.push('нема стадії ' + st);
  }

  /* 5. стабільність візуалу: ключ = набір кадрів + версія; кеш ПРИМУСОВИЙ */
  if (!/async function readHvCache\(vin, fingerprint\)/.test(src) || !/async function writeHvCache\(/.test(src)) errs.push('нема функцій hv-кешу');
  if (!/hvCache\.fingerprint = photoSetFingerprint\(hvPhotoIds\)/.test(src)) errs.push('ключ кешу не з набору кадрів, що йде у Vision');
  if (!/const hvClean = cachedHv\s*\?\s*sanitizeHistoricalVisual\(cachedHv, 1\)/.test(src)) errs.push('кешований візуал не підміняє відповідь моделі примусово');
  if (!/writeHvCache\(listing\.vin, hvCache\.fingerprint, hvCache\.source/.test(src)) errs.push('свіжий візуал не пишеться в кеш');
  if (!/historical_visual_cache: hvCache/.test(src)) errs.push('_meta без діагностики кешу');
  if (!/historical_visual_cache\?on_conflict=vin,fingerprint,hv_version[\s\S]{0,400}resolution=ignore-duplicates/.test(src)) errs.push('кеш візуалу не first-writer-wins');
  /* той самий набір у будь-якому порядку і з дублями дає той самий ключ; інша версія інший */
  const a = C.photoSetFingerprint(['https://x/1.jpg', 'https://x/2.jpg']);
  const b = C.photoSetFingerprint(['https://x/2.jpg', 'https://x/1.jpg', 'https://x/1.jpg']);
  const c = C.photoSetFingerprint(['https://x/1.jpg', 'https://x/3.jpg']);
  const d = C.photoSetFingerprint(['https://x/1.jpg', 'https://x/2.jpg'], 'other-version');
  if (a !== b) errs.push('відбиток залежить від порядку чи дублів');
  if (a === c) errs.push('інший набір дав той самий відбиток');
  if (a === d) errs.push('інша версія дала той самий відбиток');
  if (!a.startsWith(C.HISTORICAL_VISUAL_VERSION + ':')) errs.push('відбиток без версії');
  /* 10 повторів того самого набору через resolver: ідентичні події і штрафи */
  const { computeScoreV3 } = await import('file://' + path.join(dir, 'api', 'score-v3.js'));
  const hv = { visible_damage_zones: ['left rear quarter', 'rear bumper', 'left rear door', 'left tail light', 'wheel arch'], visible_severity: 'severe', damage_depth: 'inner_structure_or_module', inner_component_damage_extent: 'indeterminate', inner_component_deformation_visible: 'indeterminate', inner_components_exposed: true, fascia_status: 'detached_or_missing', srs_visual_status: 'deployed_visible', structural_visual_status: 'indeterminate', possible_structural_damage: true, load_bearing_structure_deformation_visible: false, cabin_intrusion_visible: false, wheel_displacement_visible: false, cosmetic_only: false, evidence: [{ source: 'us_auction', ref: 'auction_photo_1', description: 'x' }] };
  const COV = { basics_known: true, photos_count: 22, imported_used: true, mileage_known: true, auction_checked: false, auction_us_signal: true, identity_confirmed: true, auction_record_exists: true, registration_data_exists: true, historical_listings_count: 0, mileage_observation_count: 0 };
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const r = computeScoreV3({ findings: [{ type: 'AIRBAGS_DEPLOYED', event_id: 'accident_2022', severity: 'high', repair_status: 'unknown', evidence: [{ source: 'us_auction', ref: 'auction_photo_7', description: 'curtain' }] }], coverageInputs: COV, vehicle: { odometer_km: 167000, age_months: 134, powertrain: 'electric' }, historicalVisual: C.sanitizeHistoricalVisual(hv, 8), accidentRecord: { recorded: true, note: 'ДТП 2022' } });
    runs.push(JSON.stringify({ ev: r.accident_events.map(e => [e.derived_severity, e.final_event_penalty, e.severity_basis]), srs: r.unresolved_safety_concerns.map(x => x.penalty), final: r.final }));
  }
  if (new Set(runs).size !== 1) errs.push('10 повторів того самого візуалу дали різні події/штрафи/бали');
  const one = JSON.parse(runs[0]);
  if (one.ev[0][0] !== 'moderate' || one.ev[0][1] !== 1.3 || one.srs[0] !== 0.6) errs.push('Tesla-fixture: очікувалось moderate 1.3 + SRS 0.6, отримано ' + runs[0]);
  /* substantial vs indeterminate це і є різниця 8.1/6.7 (1.4 = 2.4 - 1.0) */
  const hv2 = { ...hv, inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial' };
  const r2 = computeScoreV3({ findings: [], coverageInputs: COV, vehicle: { odometer_km: 167000, age_months: 134, powertrain: 'electric' }, historicalVisual: C.sanitizeHistoricalVisual(hv2, 8), accidentRecord: { recorded: true, note: 'x' } });
  if (r2.accident_events[0].derived_severity !== 'severe' || Math.abs(r2.accident_events[0].final_event_penalty - 2.7) > 1e-9) errs.push('substantial не дав severe 2.7');
  if (Math.abs((r2.accident_events[0].final_event_penalty - one.ev[0][1]) - 1.4) > 1e-9) errs.push('різниця tier не 1.4');

  /* 6. публічний звіт: без переписки і без входів рішення з чужими авто */
  const pub = J.publicReport({ vehicle: { title: 'X' }, _chat: [{ role: 'user', content: 'secret' }], _meta: { vin: 'V', decision_inputs: { recent_reports: [{ title: 'other car' }] }, photos: [] } });
  if (pub._chat) errs.push('публічний звіт містить переписку');
  if (pub._meta.decision_inputs) errs.push('публічний звіт містить входи рішення');
  if (pub._meta.vin !== 'V' || pub.vehicle.title !== 'X') errs.push('публічний звіт втратив дані');
  const jsrc = fs.readFileSync('api/check-job.js', 'utf8');
  if (!/no-store/.test(jsrc)) errs.push('check-job без no-store');
  if (!/TOKEN_RE = \/\^\[A-Za-z0-9_-\]\{16,64\}\$\//.test(jsrc)) errs.push('check-job не валідує токен');
  if (!/stale/.test(jsrc)) errs.push('check-job не позначає застряглий job як помилку');

  /* 7. проксі кадрів: лише https і лише хости історичних джерел */
  if (!I.allowedImageUrl('https://cdn.riastatic.com/photos/auto/usa/1909/19098/1909872.jpg')) errs.push('riastatic не дозволений');
  if (!I.allowedImageUrl('https://bidfax.info/x.jpg')) errs.push('bidfax не дозволений');
  if (I.allowedImageUrl('http://cdn.riastatic.com/x.jpg')) errs.push('http пропущений');
  if (I.allowedImageUrl('https://evil.example.com/riastatic.com/x.jpg')) errs.push('чужий хост пропущений');
  if (I.allowedImageUrl('https://riastatic.com.evil.com/x.jpg')) errs.push('підробка суфікса пропущена');
  if (I.allowedImageUrl('javascript:alert(1)')) errs.push('не-URL пропущений');

  /* 8. маршрут і сторінки */
  const vj = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const srcs = vj.rewrites.map(r => r.source);
  if (srcs.indexOf('/check/r/:token') < 0 || srcs.indexOf('/check/r/:token') > srcs.indexOf('/check/:id')) errs.push('маршрут /check/r/:token відсутній або стоїть після /check/:id');
  const rc = fs.readFileSync('result-check.html', 'utf8'), ch = fs.readFileSync('check.html', 'utf8');
  if (!/<meta name="robots" content="noindex,nofollow">/.test(rc)) errs.push('звіт без noindex');
  for (const k of ['const OPEN_TOKEN', "fetch('/api/check-job?'", 'READONLY', "body.readonly #chatTopBtn", 'navigator.share', "t('Link copied')", "'/api/img?u='", 'arch-fail', "id=\"shareBtn\"", "id=\"shareBtn2\"", 'Given the version, age and mileage', "r.kind === 'latent'", '#histList{--hd-w:96px;--rail-x:48px}', '.hrow::before', "' last'"]) {
    if (!rc.includes(k)) errs.push('result-check.html: нема ' + k);
  }
  if (rc.includes('Given the engine and mileage')) errs.push('EV-нелогічний заголовок лишився');
  for (const k of ['PENDING_KEY', 'RECENT_KEY', 'async function pollJob', 'async function resumePending', 'r.status === 202 && data.job', "'/check/r/' + token", 'ld.setStage', "t('Recent checks on this device')"]) {
    if (!ch.includes(k)) errs.push('check.html: нема ' + k);
  }
  if (!src.includes('"kind":"finding|latent"')) errs.push('схема risks без kind');
  if (!/HIGH_COST_LATENT_RISK/.test(src) || !/"kind": "latent"/.test(src)) errs.push('промпт без HIGH_COST_LATENT_RISK');
  if (!/MCU1 чи встановлено MCU2/.test(src)) errs.push('промпт без MCU-перевірки');
  if (!/ПРІОРИТИЗАЦІЯ: top risks це 3-5 пунктів/.test(src)) errs.push('промпт без пріоритизації top risks');
  if (!/НЕ стверджуй, що батарея обовʼязково сильно деградована/.test(src)) errs.push('промпт дозволяє стверджувати деградацію батареї');

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('DURABLE TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('токен · fakeRes · waitUntil · синхронний фолбек · hv-кеш примусовий · 10 повторів ідентичні · 1.4 = substantial/indeterminate · публічний звіт без приватного · проксі allowlist · маршрут і сторінки');
  console.log('DURABLE TEST PASSED');
})().catch(e => { console.log('DURABLE TEST CRASHED:', e.stack || e.message); process.exit(1); });
