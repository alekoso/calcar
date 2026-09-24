/* CalCar Score v4: синтетичні інваріанти затвердженої формули
   (score-v4-spec.md rev 2, docs/audits/score-v4-implementation-design rev 2).
   Перевіряється: детермінізм, відсутність капів, eligibility gate,
   категорії ДТП, ранні події, пожежа і флуд, входи 2-6, дедуп,
   незмінний config_tag, ізоляція продакшн v3. */
const fs = require('fs');
const crypto = require('crypto');
const errs = [];
const near = (x, lo, hi) => typeof x === 'number' && x >= lo - 1e-9 && x <= hi + 1e-9;
const eq = (a, b, msg) => { if (a !== b) errs.push(msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
const ok = (c, msg) => { if (!c) errs.push(msg); };

(async () => {
  const V4 = await import('./api/score-v4.js');
  const { computeScoreV4, SCORE_CONFIG_V4: C, intensityPenalty, resolvePowertrainClass, detectRollback, validateDisclosures, classifyEventV4 } = V4;

  /* ---- фікстури ---- */
  const VIN = 'WBAJE7C34HG887901';
  const baseEv = { identity_confirmed: true, basics_known: true, photos_count: 15, seller_text_chars: 300, auction_record_exists: false, registry_present: true, historical_listings_count: 0, cv_status: 'ok', cv_zones_sufficient: 10, listing_vin: VIN };
  const hv = (o = {}) => ({ visible_damage_zones: ['капот', 'передний бампер'], damage_depth: 'exterior_panels_only', inner_component_damage_extent: 'none', outer_panel_damage_extent: 'multiple_panels', fascia_status: 'damaged_but_mounted', inner_components_exposed: false, inner_component_deformation_visible: 'not_visible', load_bearing_structure_deformation_visible: false, cabin_intrusion_visible: false, wheel_displacement_visible: false, cosmetic_only: false, structural_visual_status: 'no_obvious_severe_signs', srs_visual_status: 'no_deployment_visible', airbags_visible_parts: [], evidence: [{ source: 'us_auction', ref: 'auction_photo_1', description: 'капот зім’ятий' }], ...o });
  const lot = (o = {}) => ({ lot_id: '40355574', house: 'copart', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null, ...o });
  const finding = (type, id, o = {}) => ({ type, event_id: id, evidence: [{ source: 'us_auction', ref: 'auction_photo_2', description: 'опис ' + id }], repair_status: 'unknown', ...o });
  const cv = (findings = [], o = {}) => ({ zones: { sufficient: ['front', 'rear', 'left_side', 'right_side', 'wheels', 'driver_area', 'front_seats', 'dashboard'], partial: [], not_visible: [] }, condition_findings: findings, ...o });
  const cvf = (zone, kind, o = {}) => ({ zone, kind, severity: 'moderate', confidence: 'high', photo: 3, sign: 'конкретна видима ознака на кадрі', component: 'panel', ...o });
  const run = (o = {}) => computeScoreV4({ findings: [], evidence: baseEv, listingText: 'Продається авто. Опис продавця без дефектів.', ...o });
  const itemsOf = (r, input) => r.items.filter(i => i.input === input);
  const sum = r => r.items.reduce((s, i) => s + i.amount, 0);

  /* ===== 1. детермінізм і формула ===== */
  {
    const a = run({ auctionMeta: lot(), historicalVisual: hv() });
    const b = run({ auctionMeta: lot(), historicalVisual: hv() });
    eq(JSON.stringify(a), JSON.stringify(b), 'однаковий вхід дає різний breakdown');
    const c = run({ auctionMeta: lot(), historicalVisual: hv({ evidence: [{ source: 'us_auction', ref: 'auction_photo_1', description: 'ІНШИЙ текст опису' }], summary: 'інше' }) });
    eq(c.final, a.final, 'зміна тексту evidence змінила final');
    ok(Math.abs(a.final - Math.round((10 - sum(a)) * 10) / 10) < 1e-9, 'final != round1(10 - сума items)');
    eq(a.score_version, 'v4', 'score_version'); eq(a.config_tag, C.CONFIG_TAG, 'config_tag');
  }

  /* ===== 2. капів нема ===== */
  {
    const r = run({
      auctionMeta: lot({ primary_damage: 'WATER/FLOOD' }), historicalVisual: hv({ cabin_intrusion_visible: true, damage_depth: 'cabin_intrusion' }),
      listingText: 'Машина не заводится, на запчасти.', sellerDisclosures: [{ category: 'vehicle_not_running_or_unit_replacement', unit: 'vehicle', quote: 'не заводится', negated: false, vague: false, seller_favor: false }],
    });
    ok(sum(r) > 10, 'сума штрафів мала перевищити 10: ' + sum(r));
    eq(r.final, 0, 'пол 0'); eq(r.floored, true, 'floored');
    ok(r.items.some(i => i.key === 'accident_latest_total') && r.items.some(i => i.key === 'flood_event'), 'тотал і флуд обидві строки');
    ok(!r.items.some(i => /cap/.test(i.key)), 'зʼявився кап');
  }

  /* ===== 3. eligibility ===== */
  {
    const weak = { ...baseEv, photos_count: 1, seller_text_chars: 0, registry_present: false, cv_status: 'failed', cv_zones_sufficient: 0 };
    const r0 = run({ evidence: weak, listingText: '' });
    eq(r0.score_eligible, false, 'одна фотографія без даних мала бути не eligible');
    eq(r0.score_unavailable_reason, 'insufficient_evidence', 'reason');
    eq(r0.final, null, 'final при неeligible'); eq(r0.final_if_eligible, 10, 'final_if_eligible');
    const r0b = run({ evidence: { ...weak, photos_count: 3, seller_text_chars: 100 } });
    eq(r0b.score_eligible, false, '3 фото і 100 символів мали бути не eligible');
    const r1 = run({ evidence: { ...weak, seller_text_chars: 20 }, listingText: 'Не заводится.', sellerDisclosures: [{ category: 'vehicle_not_running_or_unit_replacement', unit: 'vehicle', quote: 'Не заводится', negated: false, vague: false, seller_favor: false }] });
    eq(r1.score_eligible, true, 'сильний негатив мав відкрити число'); eq(r1.final, 5, 'не заводиться = 5.0');
    const r2 = run({ evidence: weak, accidentRecord: { recorded: true, note: 'ДТП на території США в 2021 році' } });
    eq(r2.score_eligible, true, 'відмітка ДТП мала відкрити число'); eq(r2.final, 8.5, 'U1 = 8.5');
    const r3 = run({ evidence: { ...weak, photos_count: 15, seller_text_chars: 300 } });
    eq(r3.score_eligible, true, '15 фото і текст eligible');
    const r4 = run({ evidence: { ...weak, photos_count: 20, cv_status: 'ok', cv_zones_sufficient: 6 }, currentVisual: cv() });
    eq(r4.score_eligible, true, 'rich visual eligible');
    const r5 = run({ evidence: { ...baseEv, identity_confirmed: false } });
    eq(r5.score_unavailable_reason, 'vehicle_identity_unconfirmed', 'identity reason');
    const r6 = run({ findings: [{ type: 'VIN_IDENTITY_PROBLEM', event_id: 'vin_1', evidence: [{ source: 'current_photos', ref: 'photo_4', description: 'На табличці VIN WBAJE7C34HG000000, в оголошенні інший' }] }] });
    eq(r6.score_unavailable_reason, 'vehicle_identity_mismatch', 'VIN mismatch reason'); eq(r6.final, null, 'VIN mismatch без числа');
    const r7 = run({ findings: [{ type: 'VIN_IDENTITY_PROBLEM', event_id: 'vin_1', evidence: [{ source: 'current_photos', ref: 'photo_4', description: 'VIN ' + VIN + ' читається частково' }] }] });
    eq(r7.score_eligible, true, 'той самий VIN не є mismatch');
  }

  /* ===== 4. категорії ДТП ===== */
  {
    const cat = (h, extra = {}) => { const r = run({ auctionMeta: lot(), historicalVisual: hv(h), ...extra }); const it = itemsOf(r, 'accident_history'); return { r, it, latest: r.events.find(e => e.latest) }; };
    eq(cat({ outer_panel_damage_extent: 'single_panel' }).latest.v4_category, 'light', 'одна панель = легке');
    eq(cat({ cosmetic_only: true, outer_panel_damage_extent: 'single_panel', damage_depth: 'indeterminate', fascia_status: 'not_visible' }).latest.v4_category, 'light', 'cosmetic = легке');
    eq(cat({}).latest.v4_category, 'medium', 'кілька панелей = середнє');
    eq(cat({ outer_panel_damage_extent: 'single_panel', srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver'] }).latest.v4_category, 'medium', 'подушки = середнє');
    eq(cat({ damage_depth: 'inner_structure_or_module', inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'localized', fascia_status: 'detached_or_missing' }).latest.v4_category, 'medium', 'INNER localized = середнє (D1)');
    eq(cat({ damage_depth: 'inner_structure_or_module', inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial', fascia_status: 'detached_or_missing' }).latest.v4_category, 'heavy', 'INNER substantial = тяжке');
    eq(cat({ load_bearing_structure_deformation_visible: true, damage_depth: 'load_bearing_structure' }).latest.v4_category, 'heavy', 'несуча = тяжке');
    eq(cat({ structural_visual_status: 'visible_damage' }).latest.v4_category, 'heavy', 'structural = тяжке');
    eq(cat({ cabin_intrusion_visible: true, damage_depth: 'cabin_intrusion' }).latest.v4_category, 'total', 'салон = тотал');
    eq(cat({ load_bearing_structure_deformation_visible: true, damage_depth: 'load_bearing_structure', load_bearing_members: ['pillar'] }).latest.v4_category, 'total', 'стійка = тотал');
    eq(cat({ vehicle_disassembled_visible: true }).latest.v4_category, 'total', 'розібрана = тотал');
    const deepHv = { damage_depth: 'inner_structure_or_module', inner_component_damage_extent: 'indeterminate', fascia_status: 'detached_or_missing' };
    eq(cat({ ...deepHv }, { auctionMeta: lot({ primary_damage: 'FRONT END', secondary_damage: 'REAR END' }) }).latest.v4_category, 'total', 'лот перед + зад із глибиною = тотал');
    eq(cat({ ...deepHv, damage_side: 'both' }).latest.v4_category, 'medium', 'damage_side both (фронт із двома крилами) = НЕ тотал');
    eq(cat({ ...deepHv }, { auctionMeta: lot({ primary_damage: 'LEFT SIDE', secondary_damage: 'RIGHT SIDE' }) }).latest.v4_category, 'total', 'лот обидва борти із глибиною = тотал');
    eq(cat({}, { auctionMeta: lot({ primary_damage: 'FRONT END', secondary_damage: 'REAR END' }) }).latest.v4_category, 'medium', 'перед + зад без глибини = НЕ тотал');
    eq(cat({ ...deepHv, visible_damage_zones: ['передний бампер', 'левая задняя дверь', 'задний бампер'] }).latest.v4_category, 'medium', 'боковий удар по вільному тексту зон = НЕ тотал');
    const amounts = ['light', 'medium', 'heavy', 'total'].map(k => C.ACCIDENT[k]);
    ok(amounts[0] < amounts[1] && amounts[1] < amounts[2] && amounts[2] < amounts[3], 'порядок ваг категорій');
    /* U1: кадри є, зона удару не видна */
    const u = cat({ visible_damage_zones: [], outer_panel_damage_extent: 'indeterminate', damage_depth: 'indeterminate', fascia_status: 'not_visible', evidence: [] }, { accidentRecord: { recorded: true, note: 'Зафіксовано ДТП' } });
    eq(u.latest && u.latest.v4_category, 'unknown', 'зона не видна = не встановлена');
    /* D2: лот без пошкоджень і без відмітки = не подія */
    const d2 = cat({ visible_damage_zones: [], outer_panel_damage_extent: 'none', damage_depth: 'indeterminate', fascia_status: 'intact_mounted', evidence: [] });
    eq(d2.it.length, 0, 'лот без пошкоджень дав штраф'); ok(d2.r.unresolved.some(u => u.key === 'auction_reason_unknown'), 'нема unresolved auction_reason_unknown');
    /* пожежа */
    const ft = cat({ cabin_intrusion_visible: true, damage_depth: 'cabin_intrusion', fire_traces_visible: true });
    eq(ft.it.length, 1, 'пожежа + тотал: одна строка'); eq(ft.it[0].amount, 5, 'пожежа + тотал = 5.0');
    const fm = cat({ fire_traces_visible: true });
    eq(fm.it.length, 2, 'пожежа + середнє: дві строки'); ok(near(sum(fm.r), 4.2, 4.2), 'пожежа + середнє = 1.2 + 3.0: ' + sum(fm.r));
    const fo = run({ findings: [{ type: 'FIRE', event_id: 'fire_2020', evidence: [{ source: 'registry', ref: 'r', description: 'пожежа 2020' }] }] });
    eq(sum(fo), 3, 'пожежа без зіткнення = 3.0');
    const fl = cat({}, { auctionMeta: lot({ primary_damage: 'WATER/FLOOD' }) });
    ok(fl.it.some(i => i.key === 'flood_event') && fl.it.some(i => i.key === 'accident_latest_medium'), 'флуд + зіткнення: дві строки');
    eq(run({ findings: [finding('FLOOD', 'flood_2024'), finding('FLOOD', 'flood_2024_dup')] }).items.filter(i => i.key === 'flood_event').length, 1, 'флуд один раз');
  }

  /* ===== 5. ранні події і хронологія ===== */
  {
    const two = run({ auctionMeta: lot(), historicalVisual: hv(), findings: [
      finding('STRUCTURAL_DAMAGE', 'accident_2019', { evidence: [{ source: 'registry', ref: 'reg', description: 'структурне ДТП 2019' }] }),
      finding('AIRBAGS_DEPLOYED', 'accident_2016', { evidence: [{ source: 'registry', ref: 'reg', description: 'подушки 2016' }] }),
    ] });
    const earlier = two.items.filter(i => i.key === 'accident_earlier_events');
    eq(earlier.length, 1, 'ранні події: одна строка'); eq(earlier[0].amount, 1, 'ранні = 1.0'); eq(earlier[0].params.count, 2, 'count ранніх');
    const latest = two.events.find(e => e.latest);
    eq(latest.anchored, true, 'останнє = змістовне якірне, а не LLM-група з роком');
    eq(latest.v4_category, 'medium', 'категорія останнього від HV');
    const five = run({ auctionMeta: lot(), historicalVisual: hv(), findings: [2015, 2016, 2017, 2018, 2019].map(y => finding('AIRBAGS_DEPLOYED', 'accident_' + y, { evidence: [{ source: 'registry', ref: 'reg', description: 'ДТП ' + y }] })) });
    eq(five.items.filter(i => i.key === 'accident_earlier_events')[0].amount, 1, 'пʼять ранніх теж 1.0');
    eq(sum(five), sum(two), 'кількість ранніх не змінює суму');
    /* trusted year: лот 2024 проти відмітки 2021 з іншими зонами (окрема подія) */
    const ty = run({ auctionMeta: lot({ sale_date: '2024-03-01', primary_damage: 'FRONT END' }), historicalVisual: hv(), accidentRecord: { recorded: true, note: 'ДТП в 2021 році із пошкодженням задньої частини' } });
    const tl = ty.events.find(e => e.latest);
    eq(tl.trusted_year, 2024, 'trusted year лота'); eq(ty.events.length, 2, 'дві події за зонами'); ok(ty.items.some(i => i.key === 'accident_earlier_events'), 'відмітка 2021 = рання');
  }

  /* ===== 6. дублікати одного події ===== */
  {
    const r = run({ auctionMeta: lot({ primary_damage: 'FRONT END', airbags: { deployed: true, raw: 'Driver' } }), historicalVisual: hv({ srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver'] }),
      accidentRecord: { recorded: true, note: 'ДТП на території США із пошкодженням передньої частини' },
      findings: [finding('AIRBAGS_DEPLOYED', 'accident_us'), finding('MAJOR_REPAIR_UNVERIFIED', 'accident_us')] });
    eq(r.events.length, 1, 'одна подія з пʼяти джерел'); eq(itemsOf(r, 'accident_history').length, 1, 'одна строка');
    eq(r.events[0].v4_category, 'medium', 'подушки + панелі = середнє'); eq(sum(r), 1.2, 'сума 1.2');
  }

  /* ===== 7. вхід 2: кузов ===== */
  {
    const r = run({ currentVisual: cv([cvf('front', 'dent', { photo: 1 }), cvf('front', 'dent', { photo: 2 }), cvf('front', 'dent', { photo: 3 })]) });
    eq(itemsOf(r, 'body_condition').length, 1, 'три кадри однієї зони = одна строка'); eq(sum(r), 0.5, 'вмʼятина 0.5');
    eq(sum(run({ currentVisual: cv([cvf('front', 'dent', { severity: 'minor' }), cvf('rear', 'dent', { confidence: 'low' })]) })), 0, 'minor і low не рахуються');
    eq(sum(run({ currentVisual: cv([cvf('underbody', 'corrosion', { severity: 'minor', component: 'underbody_part' })]) })), 0, 'коррозія minor = 0');
    eq(sum(run({ currentVisual: cv([cvf('left_side', 'corrosion')]) })), 0.6, 'коррозія moderate = 0.6');
    eq(sum(run({ currentVisual: cv([cvf('wheels', 'wheel_damage', { component: 'wheel' })]) })), 0.15, 'диск без позиції = 0.15');
    eq(sum(run({ currentVisual: cv([cvf('wheels', 'wheel_damage', { component: 'wheel', wheel_position: 'front_left' }), cvf('wheels', 'wheel_damage', { component: 'wheel', wheel_position: 'rear_right', photo: 5 })]) })), 0.3, 'дві позиції = 0.3');
    eq(sum(run({ currentVisual: cv([cvf('wheels', 'wheel_damage', { component: 'wheel', wheel_position: 'front_left' }), cvf('wheels', 'wheel_damage', { component: 'wheel', wheel_position: 'rear_right', photo: 5 }), cvf('wheels', 'wheel_damage', { component: 'wheel', wheel_position: 'rear_left', photo: 6 })]) })), 0.3, 'три позиції = 0.3 (макс)');
    eq(sum(run({ currentVisual: cv([cvf('front', 'crack', { component: 'headlight' })]) })), 0.4, 'фара 0.4');
    eq(sum(run({ currentVisual: cv([cvf('front', 'chip', { component: 'windshield' })]) })), 0.3, 'лобове 0.3');
    eq(sum(run({ currentVisual: cv([cvf('rear', 'broken_component', { component: 'bumper' })]) })), 0.3, 'зламаний бампер 0.3');
    eq(sum(run({ currentVisual: cv([cvf('rear', 'broken_component', { component: 'other' })]) })), 0, 'зламаний елемент без компонента (старий кеш) не рахується');
    eq(sum(run({ currentVisual: cv([cvf('rear', 'missing_component', { component: 'other' })]) })), 0.3, 'відсутня деталь без компонента рахується');
    eq(sum(run({ currentVisual: cv([cvf('front', 'scratch_scuff')]) })), 0, 'подряпина = чек-лист');
    eq(itemsOf(run({ currentVisual: cv([cvf('front', 'missing_component', { component: 'bumper', severity: 'severe' }), cvf('engine_bay', 'missing_component', { component: 'other', severity: 'severe', photo: 9 })]) }), 'body_condition').length, 1, 'відсутній передок: front + engine_bay = одна строка');
    /* HV-пошкодження без CV не дає поточного штрафу; ДТП + CV-вмʼятина в зоні = обидві */
    const hOnly = run({ auctionMeta: lot(), historicalVisual: hv(), currentVisual: cv([]) });
    eq(itemsOf(hOnly, 'body_condition').length, 0, 'архівні кадри створили поточний штраф');
    const both = run({ auctionMeta: lot(), historicalVisual: hv(), currentVisual: cv([cvf('front', 'dent')]) });
    eq(itemsOf(both, 'accident_history').length, 1, 'ДТП строка'); eq(itemsOf(both, 'body_condition').length, 1, 'вмʼятина строка');
    ok(near(sum(both), 1.7, 1.7), 'ДТП 1.2 + вмʼятина 0.5 = 1.7: ' + sum(both));
    eq(both.events[0].unrepaired_signs, true, 'unrepaired_signs');
    eq(run({ evidence: { ...baseEv, cv_status: 'failed' }, currentVisual: cv([cvf('front', 'dent')]) }).inputs.body_condition.status, 'unavailable', 'CV не ok = unavailable');
  }

  /* ===== 8. вхід 3: салон ===== */
  {
    const r = run({ currentVisual: cv([cvf('driver_area', 'wear', { component: 'seat', photo: 1 }), cvf('front_seats', 'wear', { component: 'seat', photo: 2 }), cvf('driver_area', 'wear', { component: 'steering_wheel', photo: 3 }), cvf('rear_seats', 'tear', { component: 'seat' })]) });
    eq(itemsOf(r, 'interior_condition').length, 3, 'знос водійського один раз + кермо + обивка');
    ok(near(sum(r), 0.85, 0.85), 'салон 0.25 + 0.2 + 0.4: ' + sum(r));
    const ns = run({ currentVisual: cv([], { zones: { sufficient: ['front', 'rear'], partial: [], not_visible: ['driver_area', 'front_seats'] } }) });
    eq(ns.inputs.interior_condition.status, 'unavailable', 'салон не показаний'); ok(ns.unresolved.some(u => u.key === 'interior_not_shown'), 'unresolved interior_not_shown');
  }

  /* ===== 9. вхід 4: інтенсивність ===== */
  {
    for (const [x, y] of [[1.2, 0], [1.5, 0.3], [2.0, 0.8], [3.0, 1.4], [5.0, 2.2], [8.0, 3.0], [12.0, 4.0]]) eq(intensityPenalty(x), y, 'якір ' + x);
    eq(intensityPenalty(1.19), 0, '1.19'); eq(intensityPenalty(0.5), 0, 'нижче норми'); eq(intensityPenalty(20), 4, '20'); eq(intensityPenalty(1.35), 0.15, 'інтерполяція 1.35'); eq(intensityPenalty(10), 3.5, 'інтерполяція 10');
    const veh = { odometer_km: 180000, age_months: 60, powertrain_class: 'petrol' };   /* 36 000 км/рік, ratio 3.0 */
    const r = run({ vehicle: veh });
    eq(r.items.find(i => i.key === 'input4:intensity').amount, 1.4, 'ratio 3.0 = 1.4'); eq(r.mileage_intensity.ratio, 3, 'ratio');
    const swap = run({ vehicle: veh, listingText: 'Стоит контрактный мотор.', sellerDisclosures: [{ category: 'engine_swap_installed', unit: 'engine', quote: 'контрактный мотор', negated: false, vague: false, seller_favor: true }] });
    eq(swap.items.find(i => i.key === 'input4:intensity').amount, 1.4, 'свап не вимикає інтенсивність'); ok(swap.unresolved.some(u => u.key === 'engine_swap_claimed'), 'свап в unresolved');
    eq(run({ vehicle: { ...veh, age_months: 6 } }).inputs.mileage_intensity.status, 'unavailable', 'молодше року');
    eq(resolvePowertrainClass({ nhtsa: { ElectrificationLevel: 'PHEV (Plug-in Hybrid Electric Vehicle)', FuelTypePrimary: 'Gasoline' } }), 'phev', 'PHEV');
    eq(resolvePowertrainClass({ nhtsa: { FuelTypePrimary: 'Gasoline' }, fuel: 'hybrid' }), 'petrol', 'NHTSA пріоритетніше');
    eq(resolvePowertrainClass({ fuel: 'hybrid' }), 'unknown', 'hybrid без рівня = unknown');
    eq(V4.mileageNormKmYear('unknown'), 14000, 'норма unknown'); eq(V4.mileageNormKmYear('phev'), 15000, 'норма phev');
  }

  /* ===== 9б. вхід 7: вік ===== */
  {
    const ageOf = m => run({ vehicle: { odometer_km: 1000, age_months: m, powertrain_class: 'petrol' } });
    for (const [m, pen] of [[12, 0.1], [36, 0.2], [60, 0.3], [96, 0.45], [120, 0.55], [180, 0.8], [240, 1.05]]) {
      const r = ageOf(m);
      const it = r.items.find(i => i.key === 'input7:age');
      eq(it && it.amount, pen, 'вік ' + m + ' міс.'); eq(it && it.label_key, 'Vehicle age', 'label віку');
      eq(r.inputs.vehicle_age.status, 'applied', 'статус віку ' + m);
    }
    eq(ageOf(6).items.length, 0, 'молодше року: вік 0'); eq(ageOf(6).inputs.vehicle_age.status, 'clean', 'молодше року: вік clean');
    eq(ageOf(11).items.length, 0, '11 місяців: 0'); eq(ageOf(18).items.find(i => i.key === 'input7:age').amount, 0.13, '18 місяців: точний вік без округлення до років (0.1 + 0.5 * 0.05)');
    eq(ageOf(6).inputs.mileage_intensity.status, 'unavailable', 'інтенсивність до року unavailable');
    const noAge = run({ vehicle: { odometer_km: 1000, age_months: null, powertrain_class: 'petrol' } });
    eq(noAge.inputs.vehicle_age.status, 'unavailable', 'вік невідомий = unavailable'); eq(sum(noAge), 0, 'вік невідомий = 0');
    const both = run({ vehicle: { odometer_km: 180000, age_months: 60, powertrain_class: 'petrol' } });
    ok(near(sum(both), 1.7, 1.7), 'інтенсивність 1.4 + вік 0.3 незалежно: ' + sum(both)); eq(both.final, 8.3, 'final 8.3');
    eq(run({ vehicle: { odometer_km: 1000, age_months: 480, powertrain_class: 'petrol' } }).items.find(i => i.key === 'input7:age').amount, 2.05, '40 років = 2.05, без капа');
  }

  /* ===== 10. вхід 5: відкат ===== */
  {
    const p = (date, km, family, o = {}) => ({ date, km, source: family, family, ...o });
    const rb = pts => run({ mileagePoints: pts });
    eq(sum(rb([p('2023-01-01', 150000, 'platform_history'), p('2024-01-01', 120001, 'vehicle_memory'), p('2025-01-01', 130000, 'current')])), 0, '29 999 = 0');
    const c1 = rb([p('2023-01-01', 150000, 'platform_history'), p('2024-01-01', 120000, 'vehicle_memory'), p('2025-01-01', 130000, 'current')]);
    eq(sum(c1), 1, '30 000 з продовженням = 1.0');
    const c2 = rb([p('2023-01-01', 150000, 'platform_history'), p('2024-01-01', 120000, 'vehicle_memory')]);
    eq(sum(c2), 0, 'без продовження і одним сімейством = 0'); ok(c2.unresolved.some(u => u.key === 'mileage_inconsistency'), 'unresolved');
    const c3 = rb([p('2023-01-01', 150000, 'platform_history'), p('2024-01-01', 120000, 'vehicle_memory'), p('2024-01-01', 120300, 'current')]);
    eq(sum(c3), 1, 'два сімейства підтверджують = 1.0');
    eq(sum(rb([p('2025-01-01', 170000, 'current'), p('2025-01-01', 130000, 'dashboard')])), 0, 'одна дата = не пара');
    eq(sum(rb([p('2022-01-01', 100000, 'auction', { unit: 'mi', status: 'actual' }), p('2024-01-01', 120000, 'current'), p('2025-01-01', 125000, 'vehicle_memory')])), 1, 'mi -> km: 160 900 -> 120 000 = 1.0');
    eq(sum(rb([p('2022-01-01', 100000, 'auction', { unit: 'mi', status: 'not_actual' }), p('2024-01-01', 120000, 'current'), p('2025-01-01', 125000, 'vehicle_memory')])), 0, 'not_actual не точка');
    const mx = rb([p('2021-01-01', 250000, 'platform_history'), p('2022-01-01', 120000, 'platform_history'), p('2023-01-01', 125000, 'vehicle_memory'), p('2024-01-01', 60000, 'current'), p('2025-01-01', 61000, 'dashboard')]);
    eq(sum(mx), 3, 'максимальний відкат (190 000) = 3.0');
    eq(sum(rb([p('2023-01-01', 190000, 'platform_history'), p('2024-01-01', 130000, 'vehicle_memory'), p('2025-01-01', 135000, 'current')])), 2, '60 000 = 2.0');
    eq(rb([p('2025-01-01', 170000, 'current')]).inputs.mileage_rollback.status, 'unavailable', 'одна точка = unavailable');
    eq(sum(rb([p('2024-01-01', 170000, 'current'), p('2025-01-01', 175087, 'dashboard')])), 0, 'приладка більше = 0');
  }

  /* ===== 11. вхід 6: продавець ===== */
  {
    const text = 'Продам авто. Есть течь масла с поддона. Не работает полный привод. Двигатель дымит. Не дымит коробка. Нужно вложить немного. Помято крыло. Треснуто лобовое. Горит airbag. Подушки не восстановлены.';
    const d = (category, unit, quote, o = {}) => ({ category, unit, quote, negated: false, vague: false, seller_favor: false, ...o });
    const v = validateDisclosures([d('major_powertrain_symptom', 'engine', 'этого нет в тексте')], text);
    eq(v.ok.length, 0, 'цитата не з тексту мала відкинутись'); eq(v.dropped, 1, 'dropped');
    const neg = run({ listingText: text, sellerDisclosures: [d('major_powertrain_symptom', 'transmission', 'Не дымит коробка')] });
    eq(sum(neg), 0, 'заперечення = 0'); ok(neg.unresolved.some(u => u.key === 'seller_negated_statement'), 'заперечення в unresolved');
    eq(sum(run({ listingText: text, sellerDisclosures: [d('localized_powertrain_issue', 'engine', 'Нужно вложить немного', { vague: true })] })), 0, 'vague = 0');
    eq(sum(run({ listingText: text, sellerDisclosures: [d('localized_powertrain_issue', 'engine', 'течь масла'), d('major_powertrain_symptom', 'drivetrain', 'Не работает полный привод')] })), 4.5, 'різні вузли сумуються 1.5 + 3.0');
    eq(sum(run({ listingText: text, sellerDisclosures: [d('localized_powertrain_issue', 'engine', 'течь масла'), d('major_powertrain_symptom', 'engine', 'Двигатель дымит')] })), 3, 'один вузол = max');
    eq(sum(run({ listingText: text + ' Не заводится.', sellerDisclosures: [d('vehicle_not_running_or_unit_replacement', 'vehicle', 'Не заводится'), d('major_powertrain_symptom', 'engine', 'Двигатель дымит'), d('chassis_brakes_steering', 'chassis', 'Помято крыло')] })), 6, 'не заводиться поглинає двигун, ходова сумується: 5 + 1');
    eq(sum(run({ listingText: text, sellerDisclosures: [d('srs_not_restored', 'srs', 'Подушки не восстановлены'), d('srs_warning_generic', 'srs', 'Горит airbag')] })), 2, 'srs_not_restored поглинає generic');
    eq(sum(run({ listingText: text, sellerDisclosures: [d('srs_warning_generic', 'srs', 'Горит airbag')] })), 1, 'srs generic = 1.0');
    /* дедуп продавець x Vision */
    const wnd = run({ listingText: text, sellerDisclosures: [d('body_work_needed', 'body', 'Треснуто лобовое', { zone: 'glass' })], currentVisual: cv([cvf('front', 'crack', { component: 'windshield' })]) });
    eq(wnd.items.length, 1, 'лобове: одна строка'); eq(wnd.items[0].amount, 0.8, 'лобове = max(0.3, 0.8)'); eq(wnd.items[0].input, 'body_condition', 'ключ входу 2');
    const wing = run({ listingText: text, sellerDisclosures: [d('body_work_needed', 'body', 'Помято крыло', { zone: 'left' })] });
    eq(sum(wing), 0.8, 'крило без Vision = 0.8 продавця');
    const wing2 = run({ listingText: text, sellerDisclosures: [d('body_work_needed', 'body', 'Помято крыло', { zone: 'left' })], currentVisual: cv([cvf('left_front', 'dent')]) });
    eq(wing2.items.length, 1, 'крило + Vision = одна строка'); eq(wing2.items[0].amount, 0.8, 'max 0.8');
    eq(run({ listingText: '' }).inputs.seller_disclosures.status, 'unavailable', 'порожній текст = unavailable');
    /* "не відновлена" + відоме ДТП = одна причинна проблема */
    const unr = run({ listingText: 'После ДТП не восстановлена', auctionMeta: lot(), historicalVisual: hv(), sellerDisclosures: [d('accident_unrepaired', 'body', 'не восстановлена')] });
    eq(itemsOf(unr, 'accident_history').length, 1, 'одна аварійна строка'); eq(itemsOf(unr, 'seller_disclosures').length, 0, 'без строки продавця');
    eq(unr.events[0].unrepaired_signs, true, 'unrepaired_signs від продавця');
    const unrU = run({ listingText: 'После ДТП не восстановлена', accidentRecord: { recorded: true, note: 'Зафіксовано ДТП' }, sellerDisclosures: [d('accident_unrepaired', 'body', 'не восстановлена')] });
    eq(sum(unrU), 2.5, 'U1 + не відновлена = 2.5');
    const unrNone = run({ listingText: 'После ДТП не восстановлена', sellerDisclosures: [d('accident_unrepaired', 'body', 'не восстановлена')] });
    eq(sum(unrNone), 2.5, 'не відновлена без події = 2.5 (вхід 1)'); eq(unrNone.events.length, 1, 'синтетична подія');
    /* флуд зі слів */
    eq(sum(run({ listingText: 'Машина была утоплена', sellerDisclosures: [d('flood_or_fire', 'vehicle', 'была утоплена')] })), 2.5, 'утоплена зі слів = флуд 2.5');
  }

  /* ===== 12. незмінний config_tag ===== */
  {
    const hash = crypto.createHash('md5').update(JSON.stringify(C)).digest('hex');
    const EXPECTED = '59640c04075132fa30f7d159c665ad36';
    if (hash !== EXPECTED) errs.push('SCORE_CONFIG_V4 змінився (md5 ' + hash + '), онови CONFIG_TAG і хеш у тесті');
  }

  /* ===== 13. ізоляція продакшн v3 ===== */
  {
    const checkSrc = fs.readFileSync('api/check.js', 'utf8');
    ok(/computeScoreV4/.test(checkSrc), 'check.js: v4 не викликається');
    ok(/SCORE_VERSION === 'v4' \? breakdownV4 : breakdownV3/.test(checkSrc), 'check.js: активний breakdown обирає диспетчер');
    ok(/const SCORE_VERSION = .*'v4'.*:\s*'v3'/.test(checkSrc) || /CALCAR_SCORE_VERSION === 'v4' \? 'v4' : 'v3'/.test(checkSrc), 'check.js: за замовчуванням має лишатись v3');
    ok(!/parsed\.score_breakdown = breakdownV4/.test(checkSrc), 'check.js: v4 напряму пишеться у продакшн-поле');
    ok(/score_breakdown_shadow = shadow/.test(checkSrc), 'check.js: тінь не пишеться');
    const v3src = fs.readFileSync('api/score-v3.js', 'utf8');
    ok(!/score-v4/.test(v3src), 'score-v3 не має залежати від v4');
  }

  if (errs.length) {
    console.error('SCORE V4 TEST FAILED:');
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('score v4 tests passed');
})().catch(e => { console.error('SCORE V4 TEST CRASHED:', e); process.exit(1); });
