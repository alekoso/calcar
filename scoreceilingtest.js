/* CalCar Score Ceiling v1: обмежений шар над Score v4 (api/score-ceiling.js).
   Перевіряється: без стелі бал побайтово дорівнює v4; стеля ніколи не
   додає; подушки не визначають тяжкість, не дають стелі і не мають
   окремого штрафу; титул лота стелі не дає; драбина фізичної тяжкості
   10 / 9.0 / 8.0 (можливе ураження силової структури) / 7.5 / 6.5 / 6.0;
   помірна знімається чистими поточними кадрами лише коли HV бачив суто
   зовнішні панелі; глибше чистий вигляд не знімає; подія невідомої
   тяжкості це штраф v4 unknown 0.5, а не стеля; одна аварія не рахується
   двічі (більше з двох: штраф v4 чи просадка стелі); повнота доказів
   лише від справді слабких доменів, partial не знижує, молоде авто і
   відомий одометр не слабкість; конфлікт базової ідентичності = числа
   нема; відкат пробігу = стеля цілісності; словники, check.js, UI. */
const fs = require('fs');
const crypto = require('crypto');
const errs = [];
const near = (x, lo, hi) => typeof x === 'number' && x >= lo - 1e-9 && x <= hi + 1e-9;
const eq = (a, b, msg) => { if (a !== b) errs.push(msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
const ok = (c, msg) => { if (!c) errs.push(msg); };
const r1 = x => Math.round((x + Number.EPSILON) * 10) / 10;

(async () => {
  const { computeScoreV4, SCORE_CONFIG_V4: C4 } = await import('./api/score-v4.js');
  const { applyScoreCeiling, SCORE_CEILING_CONFIG: C, evidenceCeiling, evidenceCeilingValue, evidenceGaps, mileageCeiling, physicalDamageSeverity, coreIdentityConflicts, ceilingReasonKey } = await import('./api/score-ceiling.js');

  /* ---- фікстури (ті самі, що у scorev4test.js) ---- */
  const VIN = 'WBAJE7C34HG887901';
  const baseEv = { identity_confirmed: true, basics_known: true, photos_count: 15, seller_text_chars: 300, auction_record_exists: false, registry_present: true, historical_listings_count: 0, cv_status: 'ok', cv_zones_sufficient: 10, listing_vin: VIN };
  const hv = (o = {}) => ({ visible_damage_zones: ['капот', 'передний бампер'], damage_depth: 'exterior_panels_only', inner_component_damage_extent: 'none', outer_panel_damage_extent: 'multiple_panels', fascia_status: 'damaged_but_mounted', inner_components_exposed: false, inner_component_deformation_visible: 'not_visible', load_bearing_structure_deformation_visible: false, cabin_intrusion_visible: false, wheel_displacement_visible: false, cosmetic_only: false, structural_visual_status: 'no_obvious_severe_signs', srs_visual_status: 'no_deployment_visible', airbags_visible_parts: [], evidence: [{ source: 'us_auction', ref: 'auction_photo_1', description: 'капот зім’ятий' }], ...o });
  const AB = { srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver', 'passenger'] };
  const lot = (o = {}) => ({ lot_id: '40355574', house: 'copart', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null, ...o });
  const cv = (findings = [], o = {}) => ({ zones: { sufficient: ['front', 'rear', 'left_side', 'right_side', 'wheels', 'driver_area', 'front_seats', 'dashboard'], partial: [], not_visible: [] }, condition_findings: findings, ...o });
  const cvf = (zone, kind, o = {}) => ({ zone, kind, severity: 'moderate', confidence: 'high', photo: 3, sign: 'конкретна видима ознака на кадрі', component: 'panel', ...o });
  const finding = (type, id, o = {}) => ({ type, event_id: id, evidence: [{ source: 'us_auction', ref: 'auction_photo_2', description: 'опис ' + id }], repair_status: 'unknown', ...o });
  const SALVAGE_TEXT = 'Copart SALVAGE title, rebuilt, total loss by insurer (IAAI). Продається авто. Опис продавця без дефектів.';
  const run = (o = {}) => computeScoreV4({ findings: [], evidence: baseEv, listingText: 'Продається авто. Опис продавця без дефектів.', ...o });
  const dom = (v, o = {}) => (v === null ? { status: 'not_applicable', score_internal: null } : { status: v >= 70 ? 'complete' : 'partial', score_internal: v, ...o });
  /* знімок Confidence v2: стеля читає лише підсумок overall_internal; домени потрібні для пояснення прогалин */
  const conf = (overall, o = {}) => ({ confidence_version: 'v2', overall_internal: overall, domains: { history: dom(90, o.history), photos: dom(95, o.photos), mileage: dom(80, o.mileage), identity: dom(100) } });
  const GOOD = conf(100);
  const ctx = (o = {}) => ({ confidence: GOOD, vehicleSpec: { conflicts: [] }, historicalVisual: null, currentVisual: null, ...o });
  const latestOf = r => r.events.find(e => e.latest) || null;
  const accOf = r => r.items.filter(i => i.input === 'accident_history');
  const accSum = r => r1(accOf(r).reduce((s, i) => s + i.amount, 0));
  const dmgOf = b => b.score_ceiling.candidates.find(c => c.kind === 'damage');
  /* очікуваний бал: v4 мінус більше з (просадка стелі ущерба, штраф v4 за ту саму подію) */
  const expectDamage = (b, ceil) => r1(Math.max(0, b.final_v4 - Math.max(0, r1(10 - ceil) - accSum(b))));

  /* ===== A. чисте авто: бал побайтово = v4, стелі нема, жодного шуму ===== */
  {
    const r = run();
    const before = JSON.stringify(r);
    const a = applyScoreCeiling(r, ctx({ currentVisual: cv() }));
    ok(a === r, 'applyScoreCeiling має мутувати і повертати той самий обʼєкт');
    eq(a.score_ceiling.active, false, 'A: стеля активна на чистому авто');
    eq(a.score_ceiling.value, 10, 'A: стеля не 10');
    eq(a.score_ceiling.reason_code, null, 'A: причина без стелі'); eq(a.score_ceiling.reason_key, null, 'A: ключ причини без стелі');
    eq(a.score_ceiling.physical_severity, 'none', 'A: тяжкість без події');
    eq(a.score_ceiling.applied_gap, 0, 'A: просадка без стелі'); eq(a.score_ceiling.accident_offset, 0, 'A: офсет без стелі');
    eq(a.final_v4, JSON.parse(before).final, 'A: final_v4 не збережений');
    const { score_ceiling, final_v4, ...rest } = a;
    eq(JSON.stringify(rest), before, 'A: breakdown v4 змінився без стелі');
    ok(a.score_ceiling.candidates.every(c => c.value === 10), 'A: кандидати не 10');
  }

  /* ===== B/K/L. повнота доказів: плавна крива від підсумку Confidence v2, підлога 8.0, прогалини для пояснення ===== */
  {
    const V = v => evidenceCeilingValue(v);
    /* калібрування 2026-10-08 під віднімальну композицію: "дані обмежені" не вище 8.2, "достатньо" 9.1, "вивчено" 9.5, 95+ = 10 */
    for (const [v, exp] of [[35, 8.0], [40, 8.2], [55, 8.7], [70, 9.1], [85, 9.5], [95, 9.9], [100, 10], [0, 8.0], [30, 8.0]]) eq(V(v), exp, 'B: вузол кривої ' + v);
    eq(V(62.5), 8.9, 'B: середина відрізка 55..70'); eq(V(77.5), 9.3, 'B: середина відрізка 70..85'); eq(V(90), 9.7, 'B: середина відрізка 85..95'); eq(V(37.5), 8.1, 'B: середина відрізка 35..40');
    /* верх кривої: 9.9 при 95, рівно 10 лише при 100, між ними лінійно */
    eq(V(97.5), 9.95, 'B: середина відрізка 95..100'); eq(V(96), 9.92, 'B: 96 -> 9.92'); eq(V(99), 9.98, 'B: 99 -> 9.98');
    /* неперервно і монотонно: один пункт Confidence зсуває стелю не більше ніж на 0.06 */
    let prev = V(0);
    for (let v = 1; v <= 100; v++) { const c = V(v); ok(c >= prev - 1e-9 && c - prev <= 0.061, 'B: стрибок стелі між ' + (v - 1) + ' і ' + v + ': ' + prev + ' -> ' + c); prev = c; }
    eq(evidenceCeiling(null), null, 'B: без Confidence стелі нема'); eq(evidenceCeiling({ domains: {} }), null, 'B: без підсумку стелі нема');
    eq(evidenceCeiling(conf(100)).value, 10, 'B: повні докази = 10'); eq(evidenceCeiling(conf(100)).reason_code, null, 'B: причина без стелі');
    eq(evidenceCeiling(conf(96)).value, 9.92, 'B: майже повні докази трохи нижче 10'); eq(evidenceCeiling(conf(96)).reason_code, 'evidence_insufficient', 'B: причина при 96');
    eq(evidenceCeiling(conf(70)).value, 9.1, 'B: достатньо даних = 9.1'); eq(evidenceCeiling(conf(70)).reason_code, 'evidence_insufficient', 'B: причина');
    eq(evidenceCeiling(conf(85)).value, 9.5, 'B: вивчено детально = 9.5');
    eq(evidenceCeiling(conf(40)).value, 8.2, 'L: мало даних = 8.2'); eq(evidenceCeiling(conf(35)).value, 8.0, 'L: підлога'); eq(evidenceCeiling(conf(12)).value, 8.0, 'L: підлога не пробивається');
    /* межа читає score_basis (проєкція без входів, якими володіє інший шар), а не показаний підсумок */
    eq(evidenceCeiling({ confidence_version: 'v2', overall_internal: 60, score_basis: { role: 'score_composition', overall: 70, excluded: ['historical_photos'] }, domains: {} }).value, 9.1, 'B: межа не читає score_basis');
    eq(evidenceCeiling({ confidence_version: 'v2', overall_internal: 60, score_basis: { role: 'score_composition', overall: 70, excluded: ['historical_photos'] }, domains: {} }).detail.excluded.join(','), 'historical_photos', 'B: виключені входи не названі');
    /* ceiling читає лише підсумок: вік, пробіг і домени напряму не читаються (життєвий цикл живе у Confidence) */
    const src = fs.readFileSync('api/score-ceiling.js', 'utf8');
    ok(!/ageMonths|odometer_km|young_history|band_hi/.test(src), 'B: стеля знову читає вік/пробіг або смугу доменів');
    /* прогалини: детерміновані з входів доменів */
    const inputs = { mileage: { inputs: [{ key: 'historical_points', state: 'unavailable', earned: 0, max: 7 }] }, history: { inputs: [{ key: 'history_span', state: 'verified', earned: 1, max: 8 }, { key: 'registry', state: 'unavailable', earned: 0, max: 7 }] } };
    const g = evidenceGaps(conf(60, inputs));
    eq(g.join(','), 'mileage_points,history_span,history_sources', 'B: прогалини');
    eq(evidenceCeiling(conf(60, inputs)).detail.gap_keys[0], 'few historical mileage records', 'B: ключ прогалини');
    eq(evidenceGaps(conf(96, { mileage: { inputs: [{ key: 'historical_points', state: 'not_expected', earned: 6.5, max: 7 }] } })).length, 0, 'B: молоде авто без точок не прогалина');
    eq(evidenceGaps(conf(60, { photos: { score_internal: 40 } })).join(','), 'photos', 'B: прогалина фото');
    /* застосування: v4 мінус просадка, прогалини в score_ceiling */
    const r = applyScoreCeiling(run(), ctx({ confidence: conf(70, inputs) }));
    eq(r.score_ceiling.value, 9.1, 'B: стеля доказів не застосована'); eq(r.final, r1(r.final_v4 - 0.9), 'B: бал не v4 мінус 0.9');
    eq(r.score_ceiling.reason_key, 'the score is limited by incomplete data about this car', 'B: ключ причини');
    eq(r.score_ceiling.gap_keys.length, 3, 'B: прогалини не збережені в score_ceiling');
    const k95 = applyScoreCeiling(run(), ctx({ confidence: conf(95) }));
    eq(k95.score_ceiling.composition.evidence_max, 9.9, 'K: 95 має давати 9.9'); eq(k95.final, r1(k95.final_v4 - 0.1), 'K: 95 має знімати 0.1');
    const k = applyScoreCeiling(run(), ctx({ confidence: conf(100) }));
    eq(k.score_ceiling.active, false, 'K: повні докази дали стелю'); eq(k.final, k.final_v4, 'K: бал змінився');
    eq(applyScoreCeiling(run(), ctx({ confidence: conf(80) })).score_ceiling.gap_keys.length, 0, 'B: без прогалин список порожній');
  }

  /* ===== A'/B'/O. легке ДТП: без стелі; з подушками та сама тяжкість, та сама стеля, той самий бал v4 ===== */
  {
    const hl = hv({ outer_panel_damage_extent: 'single_panel' });
    const light = run({ auctionMeta: lot({ primary_damage: 'FRONT END' }), historicalVisual: hl, listingText: SALVAGE_TEXT });
    eq(latestOf(light).v4_category, 'light', 'A: одна панель = light у v4');
    const a = applyScoreCeiling(light, ctx({ historicalVisual: hl }));
    eq(a.score_ceiling.active, false, 'A: SALVAGE з одним бампером отримав стелю'); eq(a.score_ceiling.physical_severity, 'light', 'A: тяжкість не light'); eq(a.final, a.final_v4, 'A: бал відрізняється від v4');
    const hab = hv({ outer_panel_damage_extent: 'single_panel', ...AB });
    const ab = run({ auctionMeta: lot({ primary_damage: 'FRONT END', airbags: { deployed: true, raw: 'DEPLOYED' } }), historicalVisual: hab, listingText: SALVAGE_TEXT });
    eq(latestOf(ab).v4_category, 'light', 'B: подушки підняли легке у v4'); eq(latestOf(ab).airbags, true, 'B: факт подушок не збережений');
    const b = applyScoreCeiling(ab, ctx({ historicalVisual: hab }));
    eq(b.score_ceiling.physical_severity, 'light', 'B: подушки визначили тяжкість'); eq(b.score_ceiling.active, false, 'B: подушки дали стелю');
    eq(b.final, a.final, 'B/O: легке з подушками і без мають один бал');
    eq(dmgOf(b).detail.airbags, true, 'B: подушки не збережені в деталях');
    ok(!ab.items.some(i => /airbag|srs/i.test(i.key + ' ' + i.input)), 'O: зʼявився окремий штраф за подушки');
    ok(!Object.keys(C4).some(k => /airbag|srs/i.test(k)), 'O: у SCORE_CONFIG_V4 зʼявився штраф за подушки');
  }

  /* ===== C. помірне зовнішнє: 9.0; одна аварія один раз; знімається чистими кадрами зони; дефект у зоні лишає ===== */
  let moderateV4 = null;
  {
    const med = run({ auctionMeta: lot(), historicalVisual: hv() });
    eq(latestOf(med).v4_category, 'medium', 'C: кілька панелей = medium у v4');
    moderateV4 = med.final;
    const c1 = applyScoreCeiling(med, ctx({ historicalVisual: hv() }));
    eq(c1.score_ceiling.value, 9.0, 'C: помірне без поточних кадрів зони не 9.0'); eq(c1.score_ceiling.reason_code, 'moderate_historical_damage', 'C: причина'); eq(c1.score_ceiling.physical_severity, 'moderate', 'C: тяжкість');
    eq(c1.score_ceiling.accident_offset, C4.ACCIDENT.medium, 'C: офсет не дорівнює штрафу v4 за цю подію');
    eq(c1.final, expectDamage(c1, 9.0), 'C: бал не v4 мінус (1.0 мінус 0.7)'); eq(c1.final, r1(moderateV4 - 0.3), 'C: аварія порахована двічі');
    eq(ceilingReasonKey(c1.score_ceiling.candidates[0]), 'the car had moderate damage in the past', 'C: ключ причини');
    const c2 = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hv(), currentVisual: cv() }), ctx({ historicalVisual: hv(), currentVisual: cv() }));
    eq(c2.score_ceiling.active, false, 'C: чисті кадри зони удару не зняли помірну зовнішню стелю'); eq(dmgOf(c2).detail.repair, 'current_photos_consistent', 'C: підстава зняття'); eq(c2.final, c2.final_v4, 'C: після зняття бал не v4');
    const c3 = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hv(), currentVisual: cv([cvf('front', 'dent')]) }), ctx({ historicalVisual: hv(), currentVisual: cv([cvf('front', 'dent')]) }));
    eq(c3.score_ceiling.value, 9.0, 'C: вмʼятина в зоні удару мала лишити стелю'); ok(/unrepaired_signs|current_defect_in_zone/.test(dmgOf(c3).detail.repair), 'C: підстава збереження: ' + dmgOf(c3).detail.repair);
    const noFront = cv([], { zones: { sufficient: ['rear', 'left_side', 'right_side', 'wheels'], partial: ['front'], not_visible: [] } });
    eq(applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hv(), currentVisual: noFront }), ctx({ historicalVisual: hv(), currentVisual: noFront })).score_ceiling.value, 9.0, 'C: зона удару не показана, а стеля знята');
    /* помірне з подушками: та сама стеля і той самий бал */
    const hab = hv(AB);
    const mab = run({ auctionMeta: lot({ airbags: { deployed: true, raw: 'DEPLOYED' } }), historicalVisual: hab });
    eq(mab.final, moderateV4, 'C: подушки змінили бал v4 помірного');
    const cab = applyScoreCeiling(mab, ctx({ historicalVisual: hab }));
    eq(cab.score_ceiling.value, 9.0, 'C: помірне з подушками не 9.0'); eq(cab.final, c1.final, 'C: помірне з подушками дало інший бал'); eq(cab.score_ceiling.reason_code, 'moderate_historical_damage', 'C: причина згадує подушки');
  }

  /* ===== D/E. можливе ураження силової структури: 8.0; чисті поточні кадри НЕ знімають; подушки нічого не змінюють ===== */
  {
    const hin = o => hv({ damage_depth: 'inner_structure_or_module', inner_component_damage_extent: 'indeterminate', inner_component_deformation_visible: 'indeterminate', inner_components_exposed: true, possible_structural_damage: true, structural_visual_status: 'indeterminate', fascia_status: 'detached_or_missing', ...o });
    const d = run({ auctionMeta: lot(), historicalVisual: hin() });
    eq(latestOf(d).v4_category, 'medium', 'D: v4 лишає medium за панелями');
    const d1 = applyScoreCeiling(d, ctx({ historicalVisual: hin() }));
    eq(d1.score_ceiling.value, 8.0, 'D: можливе ураження не 8.0'); eq(d1.score_ceiling.physical_severity, 'inner_depth', 'D: тяжкість'); eq(d1.score_ceiling.reason_code, 'possible_structural_historical_damage', 'D: причина');
    eq(d1.final, expectDamage(d1, 8.0), 'D: бал не v4 мінус (2.0 мінус 0.7)'); eq(d1.final, r1(d1.final_v4 - 1.3), 'D: просадка 1.3');
    eq(ceilingReasonKey(d1.score_ceiling.candidates[0]), 'past damage with possible structural involvement', 'D: ключ причини');
    const e1 = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hin(), currentVisual: cv() }), ctx({ historicalVisual: hin(), currentVisual: cv() }));
    eq(e1.score_ceiling.value, 8.0, 'E: чисті поточні кадри зняли стелю глибокого пошкодження'); eq(dmgOf(e1).detail.repair, undefined, 'E: для глибини зняття кадрами не розглядається');
    const e2 = applyScoreCeiling(run({ auctionMeta: lot({ airbags: { deployed: true, raw: 'DEPLOYED' } }), historicalVisual: hin(AB), currentVisual: cv() }), ctx({ historicalVisual: hin(AB), currentVisual: cv() }));
    eq(e2.score_ceiling.value, 8.0, 'E: подушки змінили стелю глибини'); eq(e2.final, e1.final, 'E: подушки змінили бал глибини');
    /* лише possible_structural при одній панелі і невизначеній глибині: класифікатор v4 unknown, стеля 8.0 за HV */
    const hps = hv({ outer_panel_damage_extent: 'single_panel', damage_depth: 'indeterminate', fascia_status: 'not_visible', possible_structural_damage: true, structural_visual_status: 'indeterminate', inner_components_exposed: true });
    const ps = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hps }), ctx({ historicalVisual: hps }));
    eq(ps.score_ceiling.physical_severity, 'inner_depth', 'D: possible_structural без глибини не дав 8.0'); eq(ps.score_ceiling.value, 8.0, 'D: possible_structural стеля');
    /* помірне з глибиною лише зовнішньою, але inner localized: теж 8.0 */
    const hloc = hv({ damage_depth: 'inner_structure_or_module', inner_component_damage_extent: 'localized', inner_component_deformation_visible: 'visible' });
    eq(applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hloc, currentVisual: cv() }), ctx({ historicalVisual: hloc, currentVisual: cv() })).score_ceiling.value, 8.0, 'D: inner localized не 8.0');
  }

  /* ===== F/M/N. серйозне 7.5 і структурне 6.5: аварія один раз, незалежні штрафи лишаються, кадри не знімають ===== */
  {
    const hs = o => hv({ damage_depth: 'inner_structure_or_module', inner_component_damage_extent: 'substantial', inner_component_deformation_visible: 'visible', fascia_status: 'detached_or_missing', ...o });
    const g = run({ auctionMeta: lot(), historicalVisual: hs(), currentVisual: cv() });
    eq(latestOf(g).v4_category, 'heavy', 'F: v4 heavy');
    const g1 = applyScoreCeiling(g, ctx({ historicalVisual: hs(), currentVisual: cv() }));
    eq(g1.score_ceiling.value, 7.5, 'F: серйозне не 7.5'); eq(g1.score_ceiling.reason_code, 'serious_historical_damage', 'F: причина');
    eq(g1.score_ceiling.accident_offset, C4.ACCIDENT.heavy, 'M: офсет не дорівнює heavy'); eq(g1.score_ceiling.applied_gap, 0, 'M: просадка понад штраф heavy');
    eq(g1.final, g1.final_v4, 'M: серйозна аварія порахована двічі'); eq(g1.score_ceiling.active, true, 'M: стеля має лишатися активною для пояснення');
    const g2 = applyScoreCeiling(run({ auctionMeta: lot({ airbags: { deployed: true, raw: 'DEPLOYED' } }), historicalVisual: hs(AB), currentVisual: cv() }), ctx({ historicalVisual: hs(AB), currentVisual: cv() }));
    eq(g2.score_ceiling.value, 7.5, 'F: серйозне з подушками не 7.5'); eq(g2.final, g1.final, 'F: подушки змінили бал серйозного');
    /* N. незалежні штрафи: дефект кузова поза зоною удару і друга незалежна подія віднімаються як завжди */
    const indep = run({ auctionMeta: lot(), historicalVisual: hs(), currentVisual: cv([cvf('rear', 'dent', { photo: 9, sign: 'вмʼятина 9' })]),
      /* дві групи знахідок різних років: одна зливається з лотом (рік лота невідомий), друга лишається окремою подією */
      findings: [finding('AIRBAGS_DEPLOYED', 'accident_2019', { evidence: [{ source: 'registry', ref: 'reg', description: 'подушки 2019' }] }), finding('AIRBAGS_DEPLOYED', 'accident_2016', { evidence: [{ source: 'registry', ref: 'reg', description: 'подушки 2016' }] })] });
    ok(indep.items.some(i => i.key === 'accident_earlier_events'), 'N: фікстура: другої події нема'); ok(indep.items.some(i => i.input === 'body_condition'), 'N: фікстура: дефекту кузова нема');
    const n = applyScoreCeiling(indep, ctx({ historicalVisual: hs(), currentVisual: cv([cvf('rear', 'dent', { photo: 9, sign: 'вмʼятина 9' })]) }));
    eq(n.final, n.final_v4, 'N: незалежні штрафи не мали зникнути чи подвоїтись'); ok(n.final < g1.final, 'N: незалежні штрафи не віднялися');
    /* структурне: load-bearing (heavy 2.5) -> 6.5, просадка 3.5 мінус 2.5 = 1.0; кабіна (total 5.0) -> штраф сильніший за стелю */
    const hl = hv({ load_bearing_structure_deformation_visible: true, damage_depth: 'load_bearing_structure', load_bearing_members: ['rail'] });
    const h1 = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hl, currentVisual: cv() }), ctx({ historicalVisual: hl, currentVisual: cv() }));
    eq(h1.score_ceiling.value, 6.5, 'F: структурне не 6.5'); eq(h1.score_ceiling.physical_severity, 'structural', 'F: тяжкість'); eq(h1.score_ceiling.reason_code, 'structural_historical_damage', 'F: причина');
    eq(h1.final, expectDamage(h1, 6.5), 'F: структурне: бал не більше з двох'); eq(h1.final, r1(h1.final_v4 - 1.0), 'F: структурне: просадка не 1.0');
    const hc = hv({ cabin_intrusion_visible: true, damage_depth: 'cabin_intrusion' });
    const h2 = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hc, currentVisual: cv() }), ctx({ historicalVisual: hc, currentVisual: cv() }));
    eq(h2.score_ceiling.value, 6.5, 'F: кабіна не 6.5'); eq(h2.final, h2.final_v4, 'F: кабіна: штраф total сильніший за стелю, бал мав лишитися v4');
    const hd = hv({ vehicle_disassembled_visible: true });
    eq(applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hd, currentVisual: cv() }), ctx({ historicalVisual: hd, currentVisual: cv() })).score_ceiling.value, 6.5, 'F: розібране не 6.5');
    /* пожежа: 6.0, офсет = аварія + пожежа цієї ж події */
    const hf = hv({ fire_traces_visible: true });
    const t = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hf }), ctx({ historicalVisual: hf }));
    eq(t.score_ceiling.value, 6.0, 'T: пожежа не 6.0'); eq(t.score_ceiling.reason_code, 'fire_damage', 'T: причина');
    ok(t.items.some(i => i.key === 'fire_event'), 'T: фікстура без рядка пожежі'); eq(t.score_ceiling.accident_offset, accSum(t), 'T: офсет без пожежі');
    eq(t.final, expectDamage(t, 6.0), 'T: пожежа порахована двічі');
  }

  /* ===== G/H. титул, запис без доказів, страховий випадок: стелі нема; v4 unknown 0.5 один раз ===== */
  {
    const title = run({ auctionMeta: lot({ airbags: { deployed: true, raw: 'DEPLOYED' } }), historicalVisual: null, listingText: SALVAGE_TEXT, evidence: { ...baseEv, auction_record_exists: true } });
    const g = applyScoreCeiling(title, ctx());
    eq(dmgOf(g).value, 10, 'G: титул/аукціон без фото дав стелю'); eq(g.score_ceiling.physical_severity, 'none', 'G: тяжкість з титулу'); eq(g.final, g.final_v4, 'G: бал змінився від титулу');
    eq(physicalDamageSeverity({ anchored: true, category_basis: [], merge_basis: ['auction_record'] }, null).tier, 'none', 'G: заякорена подія без HV має бути none');
    const rec = run({ accidentRecord: { recorded: true, note: 'ДТП 2021' } });
    ok(latestOf(rec) && latestOf(rec).anchored !== true && accSum(rec) === C4.ACCIDENT.unknown, 'H: запис ДТП має бути незаякореною подією unknown 0.5');
    const h1 = applyScoreCeiling(rec, ctx());
    eq(dmgOf(h1).value, 10, 'H: запис ДТП дав стелю'); eq(h1.final, h1.final_v4, 'H: бал змінився від запису');
    const ins = run({ evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(accOf(ins).map(i => i.key + ':' + i.amount).join(','), 'accident_latest_unknown:0.5', 'H: страховий без доказів = один рядок 0.5');
    const h2 = applyScoreCeiling(ins, ctx());
    eq(dmgOf(h2).value, 10, 'H: страховий запис дав стелю'); eq(h2.score_ceiling.physical_severity, 'none', 'H: тяжкість зі страхового'); eq(h2.final, h2.final_v4, 'H: бал відрізняється від v4'); eq(h2.final, r1(10 - ins.raw_sum), 'H: v4 не 10 мінус штрафи');
    /* лот із зонами пошкодження, але без архівних кадрів: v4 unknown 0.5, стелі нема; пізніші кадри з косметикою = light */
    const k = run({ auctionMeta: lot({ primary_damage: 'FRONT END', secondary_damage: 'SIDE' }), accidentRecord: { recorded: true, note: 'ДТП' }, historicalVisual: null, evidence: { ...baseEv, auction_record_exists: true } });
    eq(accSum(k), C4.ACCIDENT.unknown, 'K: лот без кадрів не unknown 0.5');
    const k1 = applyScoreCeiling(k, ctx());
    eq(dmgOf(k1).value, 10, 'K: подія без фото дала стелю'); eq(k1.final, k1.final_v4, 'K: бал змінився');
    const hcos = hv({ cosmetic_only: true, outer_panel_damage_extent: 'single_panel', damage_depth: 'indeterminate', fascia_status: 'not_visible' });
    const l = applyScoreCeiling(run({ auctionMeta: lot({ primary_damage: 'FRONT END' }), accidentRecord: { recorded: true, note: 'ДТП' }, historicalVisual: hcos, evidence: { ...baseEv, auction_record_exists: true } }), ctx({ historicalVisual: hcos }));
    eq(l.score_ceiling.physical_severity, 'light', 'L: косметика не light'); eq(l.score_ceiling.active, false, 'L: косметика дала стелю');
    /* страховий з того ж блоку, що запис, злитий з лотом з помірними кадрами: одна подія, стеля за фізикою */
    const same = run({ auctionMeta: lot(), historicalVisual: hv(), accidentRecord: { recorded: true, note: 'ДТП' }, evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(same.events.length, 1, 'I: та сама подія з трьох джерел не одна'); eq(accOf(same).map(i => i.key).join(','), 'accident_latest_medium', 'I: лише medium, без 0.5');
    eq(applyScoreCeiling(same, ctx({ historicalVisual: hv() })).score_ceiling.value, 9.0, 'I: стеля за кадрами попри страховий запис');
  }

  /* ===== ідентичність: базовий конфлікт = числа нема; версія/кузов/рік не ховають ===== */
  {
    for (const f of ['transmission', 'generation', 'drivetrain', 'displacement_l', 'fuel', 'model', 'make', 'forced_induction']) {
      const m = applyScoreCeiling(run(), ctx({ vehicleSpec: { conflicts: [f] } }));
      eq(m.score_available, false, 'ідентичність: конфлікт ' + f + ' лишив бал'); eq(m.score_eligible, false, 'ідентичність: eligible при ' + f);
      eq(m.score_unavailable_reason, 'core_identity_unresolved', 'ідентичність: причина при ' + f); eq(m.final, null, 'ідентичність: final при ' + f);
      ok(typeof m.final_v4 === 'number', 'ідентичність: final_v4 має лишитися числом'); eq(JSON.stringify(m.score_ceiling.identity_core_conflicts), JSON.stringify([f]), 'ідентичність: список конфліктів');
      ok(!m.score_ceiling.candidates.some(c => c.value < 8), 'ідентичність: конфлікт не має давати стелю 7.x');
    }
    const n = applyScoreCeiling(run(), ctx({ vehicleSpec: { conflicts: ['version', 'body', 'model_year'] } }));
    eq(n.score_available, true, 'ідентичність: версія/кузов/рік сховали бал'); eq(n.final, n.final_v4, 'ідентичність: бал змінився від версії'); eq(n.score_ceiling.identity_core_conflicts.length, 0, 'ідентичність: версія потрапила в базові');
    eq(JSON.stringify(coreIdentityConflicts({ conflicts: ['version', 'transmission', 'body'] })), '["transmission"]', 'ідентичність: фільтр базових полів'); eq(coreIdentityConflicts(null).length, 0, 'ідентичність: без паспорта конфліктів нема');
  }

  /* ===== пробіг: мало точок = не стеля; аномалія 8.0; відкат 7.0; великий відкат 6.5 ===== */
  {
    eq(mileageCeiling(run()), null, 'пробіг: чистий пробіг дав стелю цілісності');
    const o = applyScoreCeiling(run(), ctx({ confidence: conf(100, { mileage: { score_internal: 45 } }) }));
    eq(o.score_ceiling.active, false, 'пробіг: мало точок при повному підсумку дало стелю'); ok(!o.score_ceiling.candidates.some(c => c.kind === 'mileage'), 'пробіг: кандидат цілісності без відкату');
    const syn = (items = [], unresolved = []) => ({ score_version: 'v4', score_available: true, score_eligible: true, final: 8.0, final_if_eligible: 8.0, items, events: [], unresolved });
    const p1 = applyScoreCeiling(syn([{ key: 'input5:rollback', input: 'mileage_rollback', amount: 1.5, params: { drop_km: 30000, stable_by: 'two_families' } }]), ctx());
    eq(p1.score_ceiling.value, 7.0, 'пробіг: відкат не 7.0'); eq(p1.score_ceiling.reason_code, 'mileage_rollback', 'пробіг: причина відкату');
    /* ceiling-v2: штраф v4 за відкат (1.5) належить стелі пробігу, тож понад нього віднімається лише 3.0 - 1.5 (у v1 відкат рахувався двічі: 5.0) */
    eq(p1.final, 6.5, 'пробіг: бал при відкаті (8.0 мінус (3.0 - 1.5))'); eq(p1.score_ceiling.composition.risk.penalty_owned, 1.5, 'пробіг: штраф відкату не належить стелі');
    eq(p1.score_ceiling.accident_offset, 0, 'пробіг: офсет аварії для стелі пробігу');
    const p2 = applyScoreCeiling(syn([{ key: 'input5:rollback', input: 'mileage_rollback', amount: 2.5, params: { drop_km: 80000, stable_by: 'continued_series' } }]), ctx());
    eq(p2.score_ceiling.value, 6.5, 'пробіг: великий відкат не 6.5'); eq(p2.score_ceiling.reason_code, 'mileage_rollback_major', 'пробіг: причина великого відкату');
    eq(applyScoreCeiling(syn([{ key: 'input5:platform_flag', input: 'mileage_rollback', amount: 1.0, params: {} }]), ctx()).score_ceiling.value, 8.0, 'пробіг: прапор площадки не 8.0');
    eq(applyScoreCeiling(syn([], [{ key: 'mileage_inconsistency', input: 'mileage_rollback', note_key: 'Single mileage drop without confirmation', params: { drop_km: 12000 } }]), ctx()).score_ceiling.value, 8.0, 'пробіг: непідтверджене падіння не 8.0');
    eq(applyScoreCeiling(syn([], [{ key: 'mileage_inconsistency', input: 'mileage_rollback', note_key: 'Small mileage discrepancy below the threshold', params: { drop_km: 1200 } }]), ctx()).score_ceiling.active, false, 'пробіг: дрібна розбіжність дала стелю');
    eq(ceilingReasonKey(p1.score_ceiling.candidates.find(c => c.kind === 'mileage')), 'the mileage decreased between dated records', 'пробіг: ключ причини відкату');
  }

  /* ===== кандидати не додаються, найнижча виграє; офсет лише для стелі ущерба; не v4 не чіпається; підлога 0; неприйнятний v4 ===== */
  {
    const v3 = { score_version: 'v3', final: 7.2 };
    eq(applyScoreCeiling(v3, ctx()), v3, 'v3 має повертатися як є'); ok(!('score_ceiling' in v3), 'v3 отримав стелю');
    const s = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hv() }), ctx({ historicalVisual: hv(), confidence: conf(66.25) }));
    eq(s.score_ceiling.value, 9.0, 'дві стелі 9.0 склалися'); eq(s.score_ceiling.candidates.length, 2, 'кандидатів не два');
    const lo = applyScoreCeiling(run({ auctionMeta: lot(), historicalVisual: hv() }), ctx({ historicalVisual: hv(), confidence: conf(30) }));
    eq(lo.score_ceiling.value, 8.0, 'найнижча стеля не виграла'); eq(lo.score_ceiling.reason_code, 'evidence_insufficient', 'причина найнижчої');
    /* композиція ceiling-v2: final = v4 - (10 - E) - max(0, (10 - R) - штраф_R): межа доказів E = 8.0 (просадка 2.0),
       стеля ризику R = 9.0 понад штраф 0.7 за ту саму подію дає ще 0.3; стелі не додаються, подія не рахується двічі */
    eq(lo.score_ceiling.accident_offset, C4.ACCIDENT.medium, 'офсет аварії для стелі ущерба'); eq(lo.score_ceiling.applied_gap, 0.3, 'просадка стелі ущерба');
    eq(lo.final, r1(lo.final_v4 - 2.0 - 0.3), 'композиція E - risk - independent: ' + lo.final + ' vs v4 ' + lo.final_v4);
    const cp = lo.score_ceiling.composition;
    eq(cp.evidence_max, 8.0, 'композиція: межа доказів'); eq(cp.evidence_gap, 2.0, 'композиція: просадка доказів');
    eq(cp.risk.kind, 'damage', 'композиція: вид ризику'); eq(cp.risk.value, 9.0, 'композиція: стеля ризику'); eq(cp.risk.penalty_owned, C4.ACCIDENT.medium, 'композиція: штраф, яким володіє стеля'); eq(cp.risk.reduction, 0.3, 'композиція: просадка ризику');
    eq(cp.independent_penalties, r1(lo.raw_sum - C4.ACCIDENT.medium), 'композиція: незалежні штрафи'); eq(r1(cp.evidence_max - cp.confirmed_total), lo.final, 'композиція: E мінус підтверджені недоліки має давати бал');
    eq(cp.final, lo.final, 'композиція: final');
    /* брак доказів знижує і авто далеко від 10 (рішення власника 2026-10-08: не soft cap) */
    const low = applyScoreCeiling({ score_version: 'v4', score_available: true, score_eligible: true, final: 7.1, final_if_eligible: 7.1, items: [], events: [], unresolved: [] }, ctx({ confidence: conf(60) }));
    const e60 = evidenceCeilingValue(60);
    eq(low.final, r1(7.1 - r1(10 - e60)), 'брак даних не знизив авто далеко від 10: ' + low.final); eq(low.score_ceiling.active, true, 'стеля доказів неактивна'); eq(low.score_ceiling.bound, true, 'bound без змін балу');
    eq(low.score_ceiling.composition.independent_penalties, 2.9, 'незалежні штрафи без raw_sum = 10 - v4'); eq(low.score_ceiling.composition.risk, null, 'ризик без стелі');
    /* два однакові авто з однаковим дефектом: зрозуміле вище за чорну скриньку, обидва нижче v4 */
    const twin = c => applyScoreCeiling({ score_version: 'v4', score_available: true, score_eligible: true, final: 8.6, final_if_eligible: 8.6, raw_sum: 1.4, items: [{ key: 'input3:seating', input: 'interior', amount: 1.4 }], events: [], unresolved: [] }, ctx({ confidence: conf(c) })).final;
    ok(twin(90) > twin(45) && twin(90) < 8.6 + 1e-9 && twin(45) <= 7.0, 'дві однакові авто: зрозуміле ' + twin(90) + ', чорна скринька ' + twin(45));
    const inel = run({ findings: [{ type: 'VIN_IDENTITY_PROBLEM', event_id: 'vin_1', evidence: [{ source: 'current_photos', ref: 'photo_4', description: 'На табличці VIN WBAJE7C34HG000000, в оголошенні інший' }] }] });
    eq(inel.score_available, false, 'фікстура неприйнятності');
    const v = applyScoreCeiling(inel, ctx({ confidence: conf(55) }));
    eq(v.final, null, 'неприйнятний v4 отримав число'); eq(v.final_if_eligible, r1(v.final_v4 - r1(10 - evidenceCeilingValue(55))), 'final_if_eligible не обмежений');
    const w = applyScoreCeiling({ score_version: 'v4', score_available: true, final: 1.0, final_if_eligible: 1.0, items: [{ key: 'input5:rollback', input: 'mileage_rollback', amount: 2.5, params: { drop_km: 90000 } }], events: [], unresolved: [] }, ctx());
    eq(w.final, 0, 'підлога 0 не тримається');
    ok(typeof C.CONFIG_TAG === 'string' && /^ceiling-v2-/.test(C.CONFIG_TAG), 'config_tag стелі'); eq(w.score_ceiling.config_tag, C.CONFIG_TAG, 'config_tag у збереженому обʼєкті');
    eq(C.DAMAGE.moderate, 9.0, 'константа moderate'); eq(C.DAMAGE.inner_depth, 8.0, 'константа inner_depth'); eq(C.DAMAGE.serious, 7.5, 'константа serious'); eq(C.DAMAGE.structural, 6.5, 'константа structural'); eq(C.DAMAGE.extreme, 6.0, 'константа extreme');
    eq(JSON.stringify(C.EVIDENCE.curve), '[[35,8],[40,8.2],[55,8.7],[70,9.1],[85,9.5],[95,9.9],[100,10]]', 'крива доказів'); eq(C.EVIDENCE.floor, 8.0, 'підлога доказів'); ok(!('band_hi' in C.EVIDENCE) && !('steps' in C.EVIDENCE) && !('soft_width' in C.EVIDENCE), 'стара смуга чи soft cap доказів лишились');
    eq(C.VERSION, 'ceiling-v2', 'версія стелі'); ok(/^ceiling-v2-/.test(C.CONFIG_TAG), 'тег стелі v2');
    ok(!('unknown_no_photos' in C.DAMAGE) && !('unclear' in C.DAMAGE), 'стеля невідомої тяжкості має бути прибрана');
  }

  /* ===== словники, прошивка в check.js, UI, подушки в текстах, v4 config, без довгого тире ===== */
  {
    const src = fs.readFileSync('api/score-ceiling.js', 'utf8');
    const texts = [...src.matchAll(/^\s+[a-z_]+: '([^']{20,})',?$/gm)].map(m => m[1]);
    ok(texts.length >= 8 && texts.every(s => !/airbag|srs/i.test(s)), 'текст причини стелі згадує подушки або рядків замало: ' + texts.length);
    ok(!/airbags_deployed/.test(fs.readFileSync('api/score-v4.js', 'utf8')), 'v4 досі має подушки як підставу категорії');
    const ru = fs.readFileSync('i18n/ru.js', 'utf8'), ua = fs.readFileSync('i18n/ua.js', 'utf8');
    const keys = ['Maximum score is limited to {v}', 'Vehicle identity not established', 'the score is limited by incomplete data about this car', 'few historical mileage records', "the car's past is covered only partially", 'history sources did not answer', 'few usable photos or zones', 'vehicle identification is incomplete', 'Maximum supported by available data: {v}', 'Confirmed problems: {v}', ...new Set(texts)];
    ok(keys.length >= 10, 'ключів причин замало: ' + keys.length);
    for (const k of keys) { const lit = "'" + k.replace(/'/g, "\\'") + "':"; ok(ru.includes(lit), 'ru: нема ' + k); ok(ua.includes(lit), 'ua: нема ' + k); }
    for (const dead of ['a damage event is confirmed, but the archive photos', 'the severity of the past damage could not be established']) ok(!ru.includes(dead) && !ua.includes(dead), 'мертвий ключ у словниках: ' + dead);
    ok(/'Maximum score is limited to \{v\}': 'Максимальная оценка ограничена до \{v\}'/.test(ru), 'RU текст стелі');
    const chk = fs.readFileSync('api/check.js', 'utf8');
    ok(/import \{ applyScoreCeiling \} from '\.\/score-ceiling\.js'/.test(chk), 'check.js не імпортує стелю');
    const iConf = chk.indexOf('parsed.confidence = computeConfidenceV1('), iApply = chk.indexOf('applyScoreCeiling(breakdownV4, {'), iSel = chk.indexOf("const breakdown = SCORE_VERSION === 'v4' ? breakdownV4 : breakdownV3;");
    ok(iConf > 0 && iApply > iConf && iSel > iApply, 'стеля має застосовуватися після Confidence і до вибору breakdown');
    ok(!/ageMonths:|lotDamage:/.test(chk.slice(iApply, iSel)), 'check.js передає у стелю вік чи зони лота (життєвий цикл живе у Confidence)');
    ok(/console\.log\('\[score-ceiling\]'/.test(chk), 'нема структурованого логу стелі');
    const page = fs.readFileSync('result-check.html', 'utf8');
    ok(/t\('Maximum score is limited to \{v\}'\)\.replace\('\{v\}', ceil\.value\.toFixed\(1\)\)/.test(page), 'UI не показує стелю');
    ok(/gapSrc\.gap_keys\.map\(k => esc\(t\(k\)\)\)/.test(page), 'UI не показує прогалини доказів');
    ok(/t\('Maximum supported by available data: \{v\}'\)\.replace\('\{v\}', evidenceLine\.toFixed\(1\)\)/.test(page) && /t\('Confirmed problems: \{v\}'\)\.replace\('\{v\}', '\\u2212' \+ comp\.confirmed_total\.toFixed\(1\)\)/.test(page), 'UI не показує межу за даними і підтверджені недоліки');
    ok(/score_unavailable_reason === 'core_identity_unresolved' \? t\('Vehicle identity not established'\)/.test(page), 'UI не показує причину ідентичності');
    const hash = crypto.createHash('md5').update(JSON.stringify(C4)).digest('hex');
    eq(hash, 'e22129162dc1f34059f39b03e0e47e12', 'SCORE_CONFIG_V4 змінився поза тегом v4-prod-2026-10-09'); eq(C4.CONFIG_TAG, 'v4-prod-2026-10-09', 'тег v4');
    ok(!('enabled' in C4.AGE), 'вік має бути свідомим штрафом без перемикача'); eq(C4.OWNERS.max, 2.0, 'кап власників 2.0');
    for (const f of ['api/score-ceiling.js', 'scoreceilingtest.js']) ok(!fs.readFileSync(f, 'utf8').includes(String.fromCharCode(0x2014)), f + ': довге тире');
  }

  if (errs.length) { console.error('SCORE CEILING TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
  console.log('score ceiling: без стелі = v4 побайтово · подушки не тяжкість, не стеля, не штраф · титул і запис без доказів не стеля · 10/9.0/8.0/7.5/6.5/6.0 · зовнішня помірна знімається кадрами, глибока ні · одна аварія один раз · докази: плавна крива від Confidence v2, soft cap над коліном, підлога 8.0, прогалини пояснені · базовий конфлікт = нема числа · відкат 7.0/6.5 · словники, check.js, UI');
})();
