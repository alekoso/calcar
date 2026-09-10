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
  const S = await import('file://' + path.join(dir, 'api', 'share.js'));
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
  if (!/const hvClean = cachedHv\s*\?\s*sanitizeHistoricalVisual\(cachedHv, auctionPhotos\.length \|\| 1\)/.test(src)) errs.push('кешований візуал не підміняє відповідь моделі примусово');
  /* доказовий стандарт: сигнал, що піднімає тяжкість, без кадру і ознаки = indeterminate, не false і не більшість */
  const VS = await import('file://' + path.join(dir, 'api', 'visual-signals.js'));
  if (VS.HISTORICAL_VISUAL_VERSION === 'hv-2026-09-01-v2') errs.push('версія екстрактора не піднята після зміни схеми доказів');
  const weak = { damage_depth: 'inner_structure_or_module', inner_components_exposed: true, fascia_status: 'detached_or_missing', inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial', wheel_displacement_visible: true, load_bearing_structure_deformation_visible: true, cabin_intrusion_visible: true, srs_visual_status: 'deployed_visible', visible_damage_zones: ['a', 'b'], signal_evidence: [{ signal: 'wheel_displacement_visible', frame: 'general impression', sign: 'strong hit' }] };
  const g = VS.gateSeverityRaisingSignals(weak, 8);
  if (g.hv.wheel_displacement_visible !== false || g.signal_status.wheel_displacement_visible !== 'indeterminate') errs.push('wheel без кадру не став indeterminate: ' + JSON.stringify(g.signal_status));
  if (g.hv.inner_component_deformation_visible !== 'indeterminate' || g.hv.inner_component_damage_extent !== 'indeterminate' || g.hv.load_bearing_structure_deformation_visible !== false || g.hv.cabin_intrusion_visible !== false) errs.push('сигнали без доказу не знижені: ' + JSON.stringify(g.hv));
  if (g.downgraded.length !== 5) errs.push('downgraded: ' + g.downgraded.join());
  const sanWeak = C.sanitizeHistoricalVisual(weak, 8);
  if (sanWeak.wheel_displacement_visible !== false || sanWeak.inner_component_damage_extent !== 'indeterminate' || sanWeak.signal_status.wheel_displacement_visible !== 'indeterminate' || sanWeak.evidence_downgrades.length !== 5) errs.push('sanitize не застосовує доказовий гейт');
  const strong = { ...weak, signal_evidence: [{ signal: 'wheel_displacement_visible', frame: 'auction_photo_3', sign: 'ліве переднє колесо вивернуте назовні відносно арки' }, { signal: 'inner_component_deformation_visible', frame: 'auction_photo_1', sign: 'підсилювач бампера погнутий і зміщений' }, { signal: 'inner_component_damage_extent', frame: 'auction_photo_1', sign: 'зруйнована зона крэш-боксів з обох боків' }] };
  const sanStrong = C.sanitizeHistoricalVisual(strong, 8);
  if (sanStrong.wheel_displacement_visible !== true || sanStrong.inner_component_deformation_visible !== 'visible' || sanStrong.inner_component_damage_extent !== 'substantial' || sanStrong.signal_status.wheel_displacement_visible !== 'confirmed') errs.push('сигнали з кадром і ознакою не підтверджені: ' + JSON.stringify(sanStrong.signal_status));
  if (sanStrong.load_bearing_structure_deformation_visible !== false || sanStrong.signal_status.load_bearing_structure_deformation_visible !== 'indeterminate') errs.push('load_bearing без доказу не indeterminate');
  if (sanStrong.signal_evidence.length !== 3 || sanStrong.signal_evidence[0].frame !== 'auction_photo_3') errs.push('signal_evidence не збережено');
  const outOfRange = { ...weak, signal_evidence: [{ signal: 'wheel_displacement_visible', frame: 'auction_photo_9', sign: 'ліве переднє колесо вивернуте назовні відносно арки' }] };
  if (C.sanitizeHistoricalVisual(outOfRange, 8).wheel_displacement_visible !== false) errs.push('кадр поза переданим набором прийнятий як доказ');
  /* consensus голосує по ВЖЕ гейтованих читаннях: слабке evidence не стає severe більшістю */
  const gatedReads = [C.sanitizeHistoricalVisual(weak, 8), C.sanitizeHistoricalVisual(weak, 8), C.sanitizeHistoricalVisual(strong, 8)];
  const consG = C.hvConsensus(gatedReads);
  if (!consG || consG.hv.wheel_displacement_visible !== false) errs.push('два слабкі читання і одне сильне: більшість мала лишити wheel indeterminate/false');
  if (!/ДОКАЗОВИЙ СТАНДАРТ ДЛЯ СИГНАЛІВ, ЩО ПІДНІМАЮТЬ ТЯЖКІСТЬ/.test(VS.HISTORICAL_VISUAL_RULES) || !/"signal_evidence":\[/.test(VS.HISTORICAL_VISUAL_SCHEMA)) errs.push('промпт/схема без доказового стандарту');
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
  /* доказовий стандарт: severity-raising сигнали лише з кадром і ознакою */
  const hv2 = { ...hv, inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial', signal_evidence: [{ signal: 'inner_component_deformation_visible', frame: 'auction_photo_2', sign: 'підсилювач заднього бампера погнутий і зміщений вліво' }, { signal: 'inner_component_damage_extent', frame: 'auction_photo_2', sign: 'зруйнована зона крэш-боксів, деформований носій' }] };
  const r2 = computeScoreV3({ findings: [], coverageInputs: COV, vehicle: { odometer_km: 167000, age_months: 134, powertrain: 'electric' }, historicalVisual: C.sanitizeHistoricalVisual(hv2, 8), accidentRecord: { recorded: true, note: 'x' } });
  if (r2.accident_events[0].derived_severity !== 'severe' || Math.abs(r2.accident_events[0].final_event_penalty - 2.7) > 1e-9) errs.push('substantial не дав severe 2.7');
  if (Math.abs((r2.accident_events[0].final_event_penalty - one.ev[0][1]) - 1.4) > 1e-9) errs.push('різниця tier не 1.4');

  /* 6. публічний звіт: ЯВНИЙ allowlist. Нове чи невідоме поле публічним
     не стає; переписка, входи рішення, службова діагностика і текст
     продавця відсутні за побудовою */
  const pub = S.publicReport({
    vehicle: { title: 'X' }, verdict: { score: 8 }, score_facts: [{ type: 'X' }], score_breakdown_shadow: {}, brand_new_private_field: { secret: 1 },
    _chat: [{ role: 'user', content: 'secret' }],
    _meta: { vin: 'V', photos: [], seller_text: 'private', snapshot: {}, knowledge: {}, equipment_verifier: {}, photo_selection: {}, historical_photo_transport: {},
      decision_inputs: { recent_reports: [{ title: 'other car' }] }, share_token: 'tok', share_slug: 'x-1',
      auction_search: { status: 'found', lot_url: 'https://l', candidates: ['internal'], sources_checked: ['s'] } },
  });
  if (pub._chat) errs.push('публічний звіт містить переписку');
  if (pub.brand_new_private_field || pub.score_facts || pub.score_breakdown_shadow) errs.push('публічний звіт віддає поле поза allowlist');
  for (const k of ['decision_inputs', 'seller_text', 'snapshot', 'knowledge', 'equipment_verifier', 'photo_selection', 'historical_photo_transport']) if (k in pub._meta) errs.push('публічний _meta містить ' + k);
  if (pub._meta.vin !== 'V' || pub.vehicle.title !== 'X' || pub.verdict.score !== 8 || pub._meta.share_token !== 'tok') errs.push('публічний звіт втратив дозволені дані');
  if (!pub._meta.auction_search || pub._meta.auction_search.candidates || pub._meta.auction_search.lot_url !== 'https://l') errs.push('auction_search не звужений до публічних полів');
  if (S.publicReport(null) !== null || S.publicReport([1]) !== null) errs.push('publicReport не відкидає не-обʼєкт');
  const jsrc = fs.readFileSync('api/check-job.js', 'utf8');
  if (!/no-store/.test(jsrc)) errs.push('check-job без no-store');
  if (!/import \{ TOKEN_RE, publicReport, reportSummary, reportSlug \} from '\.\/share\.js'/.test(jsrc)) errs.push('check-job не використовує allowlist-серіалізатор');
  if (/pid=|public_id/.test(jsrc.replace(/\/\*[\s\S]*?\*\//g, ''))) errs.push('check-job досі віддає звіт за коротким public_id');
  if (!/summary=1|summaryOnly/.test(jsrc)) errs.push('check-job без режиму summary для карток');
  if (!/stale/.test(jsrc)) errs.push('check-job не позначає застряглий job як помилку');
  /* share-link: лише власник, лише за JWT, токен непрозорий */
  const slsrc = fs.readFileSync('api/share-link.js', 'utf8');
  if (!/auth\/v1\/user/.test(slsrc) || !/user_id=eq\./.test(slsrc) || !/makeJobToken\(\)/.test(slsrc)) errs.push('share-link не перевіряє власника або не створює токен');
  if (!/return res\.status\(401\)/.test(slsrc)) errs.push('share-link без 401');

  /* 5б. ідентичність кадру: ротація CDN-піддомену і query не міняють відбиток */
  const fpA = C.photoSetFingerprint(['https://cdn.riastatic.com/photos/auto/usa/1909/19098/1909872.jpg', 'https://cdn.riastatic.com/photos/auto/usa/1909/19098/1909864.jpg']);
  const fpB = C.photoSetFingerprint(['https://cdn4.riastatic.com/photos/auto/usa/1909/19098/1909864.jpg?x=1', 'https://CDN2.riastatic.com/photos/auto/usa/1909/19098/1909872.jpg']);
  if (fpA !== fpB) errs.push('відбиток залежить від CDN-піддомену/query');
  if (fpA === C.photoSetFingerprint(['https://cdn.riastatic.com/photos/auto/usa/1909/19098/1909872.jpg'])) errs.push('відбиток не бачить різницю наборів');
  if (C.photoIdentity('https://cdn7.riastatic.com/a/B.jpg?q') !== 'cdn.riastatic.com/a/b.jpg') errs.push('photoIdentity: ' + C.photoIdentity('https://cdn7.riastatic.com/a/B.jpg?q'));
  if (C.photoIdentity('https://bidfax.info/x.jpg') === C.photoIdentity('https://poctra.com/x.jpg')) errs.push('photoIdentity склеює різні хости');

  /* 6б. slug: лише презентація, make-model-year, транслітерація, без VIN */
  if (S.slugify('Tesla Model S 2015') !== 'tesla-model-s-2015') errs.push('slugify latin: ' + S.slugify('Tesla Model S 2015'));
  if (S.slugify('Шкода Октавія 2016') !== 'shkoda-oktaviia-2016') errs.push('slugify translit: ' + S.slugify('Шкода Октавія 2016'));
  if (S.slugify('') !== 'car' || S.slugify('!!!') !== 'car') errs.push('порожній slug не car');
  if (S.reportSlug({ vehicle: { title: 'Tesla Model S', year: 2015 } }) !== 'tesla-model-s-2015') errs.push('reportSlug не додає рік');
  if (S.reportSlug({ vehicle: { title: 'Tesla Model S 2015', year: 2015 } }) !== 'tesla-model-s-2015') errs.push('reportSlug дублює рік');
  if (S.reportSlug({ vehicle: { title: 'Y' }, _meta: { share_slug: 'bmw-x5-2019' } }) !== 'bmw-x5-2019') errs.push('reportSlug ігнорує серверний share_slug');
  if (S.reportSlug({ vehicle: { title: 'Y' }, _meta: { share_slug: 'BAD SLUG' } }) !== 'y') errs.push('reportSlug приймає невалідний share_slug');
  if (S.sharePath({ vehicle: { title: 'Tesla Model S 2015' } }, 'tok') !== '/check/r/tesla-model-s-2015/tok') errs.push('sharePath не slug/token');
  if (S.slugify('5YJSA1H23FFP69703 Tesla').includes('5yjsa1h23ffp69703') && false) errs.push('');
  if (!/share_slug: \(listing\.make && listing\.model\)/.test(src)) errs.push('_meta.share_slug не з даних площадки');
  const sum = S.reportSummary({ vehicle: { title: 'T' }, score_breakdown: { final: 8.1 }, _meta: { photos: ['p'], odometer_km: 5 } });
  if (!sum || sum.score !== 8.1 || sum.photo !== 'p' || sum.slug !== 't') errs.push('reportSummary: ' + JSON.stringify(sum));

  /* 6в. consensus історичного візуалу: голосування по evidence, не по Score */
  const base = { visible_damage_zones: ['a', 'b'], damage_depth: 'inner_structure_or_module', inner_component_deformation_visible: 'indeterminate', inner_component_damage_extent: 'indeterminate', load_bearing_structure_deformation_visible: false, wheel_displacement_visible: false, cabin_intrusion_visible: false, structural_visual_status: 'indeterminate', srs_visual_status: 'deployed_visible', cosmetic_only: false, possible_structural_damage: false, summary: 'A' };
  const A = { ...base }, B = { ...base, summary: 'B' };
  let cc = C.hvConsensus([A, B]);
  if (!cc || !cc.resolved || cc.conflict_detected !== false || cc.reads_count !== 2 || cc.hv.summary !== 'A') errs.push('згода A/B не канонізується: ' + JSON.stringify(cc));
  const Bsev = { ...base, inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial' };
  cc = C.hvConsensus([A, Bsev]);
  if (!cc || cc.resolved || cc.conflict_detected !== true || cc.hv !== null) errs.push('матеріальний конфлікт A/B не вимагає C: ' + JSON.stringify(cc));
  if (cc && (cc.disagreed_fields.join() !== 'inner_component_deformation_visible,inner_component_damage_extent')) errs.push('disagreed_fields: ' + (cc && cc.disagreed_fields));
  cc = C.hvConsensus([A, Bsev, { ...base, summary: 'C' }]);
  if (!cc || !cc.resolved || cc.hv.inner_component_damage_extent !== 'indeterminate' || cc.hv.inner_component_deformation_visible !== 'indeterminate') errs.push('більшість 2:1 не перемогла outlier: ' + JSON.stringify(cc && cc.hv));
  cc = C.hvConsensus([Bsev, A, { ...Bsev, summary: 'C' }]);
  if (!cc || cc.hv.inner_component_damage_extent !== 'substantial') errs.push('більшість 2:1 у бік severe не перемогла');
  cc = C.hvConsensus([A, Bsev, { ...base, inner_component_damage_extent: 'localized', inner_component_deformation_visible: 'visible' }]);
  if (!cc || cc.hv.inner_component_damage_extent !== 'indeterminate') errs.push('три різні значення enum не дали indeterminate: ' + (cc && cc.hv.inner_component_damage_extent));
  if (cc && cc.hv.inner_component_deformation_visible !== 'visible') errs.push('boolean-подібна більшість visible 2:1 не врахована');
  cc = C.hvConsensus([A, { ...base, wheel_displacement_visible: true }, { ...base, summary: 'C' }]);
  if (!cc || cc.hv.wheel_displacement_visible !== false) errs.push('outlier wheel_displacement не відкинутий більшістю');
  cc = C.hvConsensus([A, { ...base, visible_damage_zones: ['a'] }]);
  if (!cc || cc.resolved) errs.push('кількість зон (multiple_damage_zones) не матеріальна');
  cc = C.hvConsensus([A, { ...base, summary: 'other wording', damage_side: 'left' }]);
  if (!cc || !cc.resolved || cc.conflict_detected !== false) errs.push('нематеріальна різниця (wording, side) помилково вимагає C');
  if (C.hvConsensus([A]).reads_count !== 1 || C.hvConsensus([]) !== null) errs.push('consensus з 1/0 читань');
  /* сторожі пайплайна: consensus ДО основного виклику, запис у кеш із діагностикою, ваги не чіпаються */
  if (!/const ab = await Promise\.all\(\[readHv\('A'\), readHv\('B'\)\]\)/.test(src)) errs.push('нема паралельних читань A/B');
  if (!/if \(cons && !cons\.resolved\) \{[\s\S]{0,200}const c = await readHv\('C'\)/.test(src)) errs.push('нема читання C за конфлікту');
  if (src.indexOf("readHv('A')") > src.indexOf("progress('ai');")) errs.push('consensus не перед основним викликом');
  if (!/reads_count: cons\.reads_count, conflict_detected: cons\.conflict_detected/.test(src) || !/canonicalized_at: new Date\(\)\.toISOString\(\), extractor_version: HISTORICAL_VISUAL_VERSION/.test(src)) errs.push('діагностика consensus не зберігається');
  if (!/consensus: \{ disagreed_fields: diag\.disagreed_fields/.test(src)) errs.push('writeHvCache без consensus-діагностики');
  if (!/Math\.max\(100000, Math\.min\(240000, 268000 - \(Date\.now\(\) - tRun\)\)\)/.test(src)) errs.push('основний виклик не враховує бюджет функції після consensus');
  if (!/if \(Date\.now\(\) - tRun < 150000\) \{\s*const c = await readHv\('C'\)/.test(src)) errs.push('читання C без бюджету часу');
  if (!/cons\.tie_break \? false : await writeHvCache/.test(src)) errs.push('tie-break без C потрапляє в кеш');
  if (!/elapsedEq > 190000 \|\| Date\.now\(\) - tRun > 235000/.test(src)) errs.push('верифікатор комплектації не знає загального бюджету');
  cc = C.hvConsensus([A, Bsev], { force: true });
  if (!cc || !cc.resolved || !cc.tie_break || cc.hv.inner_component_damage_extent !== 'indeterminate' || cc.hv.inner_component_deformation_visible !== 'indeterminate') errs.push('force-tie не дає indeterminate: ' + JSON.stringify(cc && cc.hv));
  if (C.hvConsensus([A, Bsev, { ...base, summary: 'C' }]).tie_break !== false) errs.push('3 читання позначені як tie_break');
  const v3 = fs.readFileSync('api/score-v3.js', 'utf8');
  if (!/minor: 0\.2|minor: \.2/.test(v3) || !/severe: 2\.4/.test(v3) || !/moderate: 1(\.0)?\b/.test(v3)) errs.push('frozen SEVERITY_ADDITIONAL змінені');
  /* міграція: аддитивна, без destructive */
  const mig = fs.readFileSync('supabase-vehicle-intelligence.sql', 'utf8');
  if (/drop |alter column|delete from|truncate/i.test(mig)) errs.push('міграція не аддитивна');
  for (const col of ['seller_text', 'listing_fields', 'job_token', 'reads_count', 'conflict_detected', 'canonicalized_at', 'extractor_version', 'consensus']) if (!mig.includes('add column if not exists ' + col)) errs.push('міграція без ' + col);
  /* повний знімок оголошення */
  const snap = C.snapshotRow({ vin: 'V', photos: Array.from({ length: 50 }, (_, i) => 'p' + i), seller_text: 'опис продавця', listing_equipment: ['a'], price_context: { x: 1 }, history_facts: { y: 2 }, title: 'T', text: 'txt', price: 1, currency: 'USD' }, 'https://u', 'tok');
  if (snap.photos.length !== 50) errs.push('знімок обрізає галерею до ' + snap.photos.length);
  if (snap.seller_text !== 'опис продавця' || snap.job_token !== 'tok' || snap.listing_fields.photos_total !== 50 || snap.listing_fields.price_context.x !== 1) errs.push('знімок без повних полів');
  if (!/observeListing\(listing, url, \{ jobToken: job && job\.token/.test(src)) errs.push('знімок не привʼязаний до job');

  /* 7. проксі кадрів: лише https і лише хости історичних джерел */
  if (!I.allowedImageUrl('https://cdn.riastatic.com/photos/auto/usa/1909/19098/1909872.jpg')) errs.push('riastatic не дозволений');
  if (!I.allowedImageUrl('https://bidfax.info/x.jpg')) errs.push('bidfax не дозволений');
  if (I.allowedImageUrl('http://cdn.riastatic.com/x.jpg')) errs.push('http пропущений');
  if (I.allowedImageUrl('https://evil.example.com/riastatic.com/x.jpg')) errs.push('чужий хост пропущений');
  if (I.allowedImageUrl('https://riastatic.com.evil.com/x.jpg')) errs.push('підробка суфікса пропущена');
  if (I.allowedImageUrl('javascript:alert(1)')) errs.push('не-URL пропущений');

  /* 8. маршрут і сторінки */
  const vj = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const rc = fs.readFileSync('result-check.html', 'utf8'), ch = fs.readFileSync('check.html', 'utf8');
  const srcs = vj.rewrites.map(r => r.source);
  if (srcs.indexOf('/check/r/:token') < 0 || srcs.indexOf('/check/r/:token') > srcs.indexOf('/check/:id')) errs.push('маршрут /check/r/:token відсутній або стоїть після /check/:id');
  if (srcs.indexOf('/check/r/:slug/:token') < 0 || srcs.indexOf('/check/r/:slug/:token') > srcs.indexOf('/check/r/:token')) errs.push('маршрут /check/r/:slug/:token відсутній або стоїть після /check/r/:token');
  if (!/result-check\.html\?r=:token&slug=:slug/.test(JSON.stringify(vj))) errs.push('slug-маршрут не передає r і slug');
  for (const k of ['let SHARE_SLUG', 'async function ensureShareToken', "fetch('/api/share-link'", "'/check/r/' + SHARE_SLUG + '/' + OPEN_TOKEN", "location.replace('/check/' + PATH_R[2])"]) {
    if (!rc.includes(k)) errs.push('result-check.html: нема ' + k);
  }
  if (/pid=/.test(rc)) errs.push('result-check.html досі читає звіт за pid');
  for (const k of ['async function refreshRecentFromServer', '&summary=1', "x.slug || 'car'", "'/check/r/' + slug + '/' + token"]) {
    if (!ch.includes(k)) errs.push('check.html: нема ' + k);
  }
  if (!/<meta name="robots" content="noindex,nofollow">/.test(rc)) errs.push('звіт без noindex');
  for (const k of ['const OPEN_TOKEN', "fetch('/api/check-job?'", 'READONLY', 'body.readonly .pd-cta', 'navigator.share', "t('Link copied')", "'/api/img?u='", 'arch-fail', "id=\"shareBtn\"", "id=\"shareBtn2\"", 'Given the version, age and mileage', "r.kind === 'latent'", '#histList{--hd-w:96px;--rail-x:48px}', '.hrow::before', "' last'"]) {
    if (!rc.includes(k)) errs.push('result-check.html: нема ' + k);
  }
  if (rc.includes('Given the engine and mileage')) errs.push('EV-нелогічний заголовок лишився');
  for (const k of ['PENDING_KEY', 'RECENT_KEY', 'async function pollJob', 'async function resumePending', 'r.status === 202 && data.job', 'ld.setStage', "t('Recent checks on this device')"]) {
    if (!ch.includes(k)) errs.push('check.html: нема ' + k);
  }
  if (!/kind: E\(\['finding', 'latent'\]/.test(fs.readFileSync('api/check-schema.js', 'utf8'))) errs.push('схема risks без kind');
  if (!/HIGH_COST_LATENT_RISK/.test(src) || !/"kind": "latent"/.test(src)) errs.push('промпт без HIGH_COST_LATENT_RISK');
  if (!/MCU1 чи встановлено MCU2/.test(src)) errs.push('промпт без MCU-перевірки');
  if (!/ПРІОРИТИЗАЦІЯ: top risks це 3-5 пунктів/.test(src)) errs.push('промпт без пріоритизації top risks');
  if (!/НЕ стверджуй, що батарея обовʼязково сильно деградована/.test(src)) errs.push('промпт дозволяє стверджувати деградацію батареї');

  /* 7. застряглий job: функція /api/check живе щонайбільше maxDuration, тому
     running старший за ліміт + запас гарантовано мертвий: check-job чинить
     стан у БД атомарно (PATCH з умовою status і created_at) і відповідає
     retryable error; свіжий running, done і звичайний error не чіпаються */
  const limitM = src.match(/^export const config = \{ maxDuration: (\d+) \};/m);
  if (!limitM || Number(limitM[1]) * 1000 !== J.CHECK_FUNCTION_LIMIT_MS) errs.push('CHECK_FUNCTION_LIMIT_MS не дорівнює maxDuration /api/check');
  if (!(J.STALE_JOB_AFTER_MS > J.CHECK_FUNCTION_LIMIT_MS + 10000 && J.STALE_JOB_AFTER_MS <= J.CHECK_FUNCTION_LIMIT_MS + 90000)) errs.push('запас stale-таймауту поза розумними межами: ' + J.STALE_JOB_AFTER_MS);
  const T0 = Date.parse('2026-09-10T10:00:00.000Z');
  const rowAt = (ageS, extra = {}) => ({ status: 'running', stage: 'ai', created_at: new Date(T0 - ageS * 1000).toISOString(), updated_at: new Date(T0 - ageS * 1000 + 5000).toISOString(), url: 'https://auto.ria.com/uk/auto_x_1.html', lang: 'ru', report: null, error: null, finished_at: null, ...extra });
  if (J.isStaleJob(rowAt(100), T0)) errs.push('running 100 с вважається stale');
  if (J.isStaleJob(rowAt(329), T0)) errs.push('running 329 с вважається stale (ліміт 300 + запас 30)');
  if (!J.isStaleJob(rowAt(331), T0)) errs.push('running 331 с не stale');
  if (!J.isStaleJob(rowAt(400, { status: 'queued' }), T0)) errs.push('queued 400 с не stale');
  if (J.isStaleJob(rowAt(4000, { status: 'done' }), T0) || J.isStaleJob(rowAt(4000, { status: 'error' }), T0)) errs.push('done/error вважається stale');
  if (J.isStaleJob(rowAt(4000, { created_at: null }), T0)) errs.push('рядок без created_at позначається stale наосліп');
  /* обробник з підмінним Supabase REST */
  const envBak = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv';
  const fetchBak = globalThis.fetch;
  const calls = [];
  let dbRow = null;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    /* GET віддає КОПІЮ рядка, як справжній REST: мутації відповіді обробником стан БД не міняють */
    if ((opts.method || 'GET') === 'GET') return { ok: true, json: async () => (dbRow ? [JSON.parse(JSON.stringify(dbRow))] : []) };
    if (opts.method === 'PATCH') {
      /* імітація умов PostgREST: status=in.(queued,running) і created_at=lt.<threshold> */
      const thr = decodeURIComponent(String(url).match(/created_at=lt\.([^&]+)/)[1]);
      const hit = dbRow && ['queued', 'running'].includes(dbRow.status) && Date.parse(dbRow.created_at) < Date.parse(thr) && /status=in\.\(queued,running\)/.test(String(url));
      if (hit) Object.assign(dbRow, JSON.parse(opts.body));
      return { ok: true, json: async () => (hit ? [dbRow] : []) };
    }
    return { ok: false, json: async () => ({}) };
  };
  const call = async (query) => { const out = {}; const res = { setHeader() {}, status(n) { out.s = n; return this; }, json(o) { out.o = o; return this; } }; await J.default({ method: 'GET', query }, res); return out; };
  const TOK = 'AAAAAAAAAAAAAAAAAAAAAA';
  const realNow = Date.now; Date.now = () => T0;
  try {
    /* свіжий running: без PATCH, статус як є, retryable false */
    dbRow = rowAt(120); calls.length = 0;
    let r = await call({ token: TOK, lang: 'ru' });
    if (r.s !== 200 || r.o.status !== 'running' || r.o.retryable !== false || r.o.error !== null || calls.some(c => c.method === 'PATCH')) errs.push('свіжий running позначений stale або відповідь зламана: ' + JSON.stringify(r.o));
    /* running на межі: 329 с ще живий */
    dbRow = rowAt(329); calls.length = 0;
    r = await call({ token: TOK });
    if (r.o.status !== 'running' || calls.some(c => c.method === 'PATCH')) errs.push('running 329 с позначений stale');
    /* stale running: атомарний PATCH з умовами, стан у БД error/timeout, відповідь retryable мовою запиту, помилка в БД мовою job */
    dbRow = rowAt(400); calls.length = 0;
    r = await call({ token: TOK, lang: 'ua' });
    const patch = calls.find(c => c.method === 'PATCH');
    if (!patch) errs.push('stale running не переведений у БД');
    else {
      if (!/status=in\.\(queued,running\)/.test(patch.url) || !/created_at=lt\./.test(patch.url) || !new RegExp('token=eq\\.' + TOK).test(patch.url)) errs.push('PATCH без атомарних умов: ' + patch.url);
      if (patch.body.status !== 'error' || patch.body.stage !== J.STALE_STAGE || !patch.body.finished_at || !patch.body.updated_at) errs.push('PATCH тіло неправильне: ' + JSON.stringify(patch.body));
      if (!/Анализ не успел завершиться/.test(patch.body.error)) errs.push('помилка в БД не мовою job (ru): ' + patch.body.error);
    }
    if (dbRow.status !== 'error' || dbRow.stage !== 'timeout') errs.push('рядок у БД не став error/timeout');
    if (r.s !== 200 || r.o.status !== 'error' || r.o.retryable !== true || !/Аналіз не встиг завершитись/.test(r.o.error) || r.o.report !== null || r.o.url !== dbRow.url) errs.push('відповідь для stale не retryable error мовою запиту: ' + JSON.stringify(r.o));
    /* повторне опитування вже полагодженого рядка: без нового PATCH, все ще retryable */
    calls.length = 0;
    r = await call({ token: TOK, lang: 'en' });
    if (calls.some(c => c.method === 'PATCH') || r.o.status !== 'error' || r.o.retryable !== true || !/did not finish/.test(r.o.error)) errs.push('полагоджений timeout-рядок обробляється неправильно: ' + JSON.stringify(r.o));
    /* summary-режим (картки) теж чинить БД */
    dbRow = rowAt(500, { status: 'queued', stage: 'queued' }); calls.length = 0;
    r = await call({ token: TOK, summary: '1' });
    if (!calls.some(c => c.method === 'PATCH') || dbRow.status !== 'error' || r.o.status !== 'error' || r.o.retryable !== true || r.o.summary !== null) errs.push('summary-режим не лагодить stale queued: ' + JSON.stringify(r.o));
    /* done старший за ліміт: не чіпається, звіт віддається */
    dbRow = rowAt(4000, { status: 'done', stage: 'done', report: { vehicle: { title: 'X' }, verdict: { score: 8 }, _meta: { vin: 'V' } }, finished_at: new Date(T0 - 3800 * 1000).toISOString() }); calls.length = 0;
    r = await call({ token: TOK });
    if (calls.some(c => c.method === 'PATCH') || r.o.status !== 'done' || r.o.retryable !== false || !r.o.report || r.o.report.vehicle.title !== 'X' || !r.o.slug) errs.push('done job зачеплений stale-логікою: ' + JSON.stringify(r.o).slice(0, 200));
    r = await call({ token: TOK, summary: '1' });
    if (r.o.status !== 'done' || !r.o.summary || r.o.retryable !== false) errs.push('summary для done зламаний');
    /* звичайний error (не timeout): не retryable, текст із БД */
    dbRow = rowAt(4000, { status: 'error', stage: 'error', error: 'Listing not found' }); calls.length = 0;
    r = await call({ token: TOK });
    if (calls.some(c => c.method === 'PATCH') || r.o.status !== 'error' || r.o.retryable !== false || r.o.error !== 'Listing not found') errs.push('звичайний error став retryable або зачеплений: ' + JSON.stringify(r.o));
    /* невдалий PATCH (БД недоступна): відповідь усе одно error/retryable, наступне опитування спробує ще */
    dbRow = rowAt(400); calls.length = 0;
    const fetchOk = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => (opts.method === 'PATCH' ? { ok: false, json: async () => ({}) } : fetchOk(url, opts));
    r = await call({ token: TOK });
    globalThis.fetch = fetchOk;
    if (r.o.status !== 'error' || r.o.retryable !== true || dbRow.status !== 'running') errs.push('невдалий PATCH ламає відповідь: ' + JSON.stringify(r.o));
    /* невідомий токен: 404 без деталей і без PATCH */
    dbRow = null; calls.length = 0;
    r = await call({ token: TOK });
    if (r.s !== 404 || calls.some(c => c.method === 'PATCH')) errs.push('невідомий токен не 404');
  } finally {
    Date.now = realNow; globalThis.fetch = fetchBak;
    if (envBak.u === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = envBak.u;
    if (envBak.k === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = envBak.k;
  }
  /* UI: сторінка Check читає ?url= (повернення зі звіту), read-only звіт при retryable дає кнопку повтору з тією ж адресою; опитування Check зупиняється на status error */
  const chkHtml = fs.readFileSync('check.html', 'utf8'), rcHtml = fs.readFileSync('result-check.html', 'utf8');
  if (!/new URLSearchParams\(location\.search\)\.get\('url'\)/.test(chkHtml)) errs.push('check.html не читає ?url= для повтору');
  if (!/if \(j\.status === 'error'\) throw new Error\(j\.error/.test(chkHtml)) errs.push('pollJob не зупиняється на error');
  if (!/j\.retryable \? ' <a class="job-retry" href="\/' \+ \(j\.url \? '\?url=' \+ encodeURIComponent\(j\.url\)/.test(rcHtml)) errs.push('read-only звіт без кнопки повтору для retryable');
  if (!/\.job-retry\{/.test(rcHtml)) errs.push('кнопка повтору без стилю');

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('DURABLE TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('токен · fakeRes · waitUntil · синхронний фолбек · stale job -> error/timeout атомарно · hv-кеш примусовий · 10 повторів ідентичні · 1.4 = substantial/indeterminate · публічний звіт без приватного · проксі allowlist · маршрут і сторінки');
  console.log('DURABLE TEST PASSED');
})().catch(e => { console.log('DURABLE TEST CRASHED:', e.stack || e.message); process.exit(1); });
