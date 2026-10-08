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
    eq(r2.score_eligible, true, 'відмітка ДТП мала відкрити число'); eq(r2.final, 9.5, 'U1 = 9.5 (невідома тяжкість 0.5 з 2026-09-30)');
    const r3 = run({ evidence: { ...weak, photos_count: 15, seller_text_chars: 300 } });
    eq(r3.score_eligible, true, '15 фото і текст eligible');
    const r4 = run({ evidence: { ...weak, photos_count: 20, cv_status: 'ok', cv_zones_sufficient: 6 }, currentVisual: cv() });
    eq(r4.score_eligible, true, 'rich visual eligible');
    const r5 = run({ evidence: { ...baseEv, identity_confirmed: false } });
    eq(r5.score_unavailable_reason, 'vehicle_identity_unconfirmed', 'identity reason');
    /* ---- реальний випадок: Audi A5 2021 без VIN ----
       Оголошення дає рік, модель, пробіг, багато кадрів, опис і комплектацію,
       але VIN продавець не вказав, і історію ніхто не підтвердив. Бал МАЄ
       бути: рахуємо за тим, що є. Історія лишається невідомою, а не чистою */
    const audi = {
      basics_known: true, mileage_known: true, photos_count: 24, seller_text_chars: 700,
      identity_confirmed: false, registry_present: false, auction_record_exists: false,
      historical_listings_count: 0, mileage_observation_count: 0,
      cv_status: 'ok', cv_zones_sufficient: 8, listing_vin: null,
    };
    const rAudi = run({ evidence: audi, listingText: 'Audi A5 45 TFSI quattro, 60 000 км, один власник.' });
    eq(rAudi.score_eligible, true, 'Audi A5 без VIN мала отримати бал');
    ok(typeof rAudi.final === 'number' && rAudi.final > 0, 'Audi A5: число балу не пораховане');
    eq(rAudi.eligibility.identity_source, 'listing_evidence', 'Audi A5: ідентичність мала спертись на оголошення');
    eq(rAudi.eligibility.domains.history, false, 'Audi A5: історія мусить лишитись непідтвердженою');
    /* відсутній VIN сам по собі не дає ані балів, ані чистої історії */
    const rVin = run({ evidence: { ...audi, identity_confirmed: true, listing_vin: VIN } });
    ok(rAudi.final <= rVin.final, 'без VIN бал не може бути вищим, ніж із підтвердженою ідентичністю');
    /* мало кадрів або невідомий пробіг: оголошення ідентичністю не стає */
    eq(run({ evidence: { ...audi, photos_count: 5 } }).score_unavailable_reason, 'vehicle_identity_unconfirmed', 'мало кадрів без VIN: бал не видається');
    eq(run({ evidence: { ...audi, mileage_known: false } }).score_unavailable_reason, 'vehicle_identity_unconfirmed', 'невідомий пробіг без VIN: бал не видається');
    /* входи шлюзу мусять доїжджати з пайплайна: без цього рядка бал
       не видавався б навіть коли пробіг відомий */
    const chk = fs.readFileSync('api/check.js', 'utf8');
    ok(/mileage_known: coverageInputs\.mileage_known/.test(chk), 'check.js не передає mileage_known у Score v4');
    ok(/photos_count: coverageInputs\.photos_count/.test(chk), 'check.js не передає photos_count у Score v4');
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
    /* подушки не є мірою удару (рішення власника 2026-10-07): легкий удар з подушками лишається light, факт подушок зберігається на події */
    const abLight = cat({ outer_panel_damage_extent: 'single_panel', srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver'] });
    eq(abLight.latest.v4_category, 'light', 'подушки більше не піднімають легке до середнього'); eq(abLight.latest.airbags, true, 'факт подушок на події втрачено');
    eq(cat({ srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver'] }).latest.v4_category, 'medium', 'кілька панелей з подушками = середнє за панелями');
    eq(cat({ outer_panel_damage_extent: 'indeterminate', damage_depth: 'indeterminate', fascia_status: 'not_visible', srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver'] }).latest.v4_category, 'unknown', 'самі подушки без фізичних ознак = unknown');
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
    eq(fm.it.length, 2, 'пожежа + середнє: дві строки'); ok(near(sum(fm.r), 3.7, 3.7), 'пожежа + середнє = 0.7 + 3.0: ' + sum(fm.r));
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
    eq(earlier.length, 1, 'ранні події: одна строка'); eq(earlier[0].amount, 1, 'K: додаткова рання аварія = 1.0 (відновлено 2026-10-01)'); eq(earlier[0].params.count, 2, 'count ранніх');
    const latest = two.events.find(e => e.latest);
    eq(latest.anchored, true, 'останнє = змістовне якірне, а не LLM-група з роком');
    eq(latest.v4_category, 'medium', 'категорія останнього від HV');
    const five = run({ auctionMeta: lot(), historicalVisual: hv(), findings: [2015, 2016, 2017, 2018, 2019].map(y => finding('AIRBAGS_DEPLOYED', 'accident_' + y, { evidence: [{ source: 'registry', ref: 'reg', description: 'ДТП ' + y }] })) });
    eq(five.items.filter(i => i.key === 'accident_earlier_events')[0].amount, 1, 'пʼять ранніх теж одна строка 1.0');
    eq(sum(five), sum(two), 'кількість ранніх не змінює суму');
    /* trusted year: лот 2024 проти відмітки 2021 з іншими зонами (окрема подія) */
    const ty = run({ auctionMeta: lot({ sale_date: '2024-03-01', primary_damage: 'FRONT END' }), historicalVisual: hv(), accidentRecord: { recorded: true, note: 'ДТП в 2021 році із пошкодженням задньої частини' } });
    const tl = ty.events.find(e => e.latest);
    eq(tl.trusted_year, 2024, 'trusted year лота'); eq(ty.events.length, 2, 'дві події за зонами'); ok(ty.items.some(i => i.key === 'accident_earlier_events'), 'відмітка 2021 = рання');
  }

  /* запис площадки без якоря + єдина LLM-група = одна подія */
  {
    const r = run({ accidentRecord: { recorded: true, note: 'Зафіксовано ДТП' }, findings: [{ type: 'MAJOR_REPAIR_UNVERIFIED', event_id: 'current_rear_collision', evidence: [{ source: 'current_photos', ref: 'photo_2', description: 'розбите заднє скло і кришка багажника' }] }] });
    eq(r.events.length, 1, 'запис площадки і LLM-група без якоря мали злитись'); eq(itemsOf(r, 'accident_history').length, 1, 'одна аварійна строка'); eq(sum(r), 0.5, 'одна подія невідомої тяжкості 0.5, без ранньої');
    const r2 = run({ accidentRecord: { recorded: true, note: 'ДТП в 2019 році' }, findings: [{ type: 'AIRBAGS_DEPLOYED', event_id: 'accident_2023', evidence: [{ source: 'registry', ref: 'reg', description: 'подушки 2023' }] }] });
    eq(r2.events.length, 2, 'різні роки не зливаються');
  }

  /* ===== 6. дублікати одного події ===== */
  {
    const r = run({ auctionMeta: lot({ primary_damage: 'FRONT END', airbags: { deployed: true, raw: 'Driver' } }), historicalVisual: hv({ srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver'] }),
      accidentRecord: { recorded: true, note: 'ДТП на території США із пошкодженням передньої частини' },
      findings: [finding('AIRBAGS_DEPLOYED', 'accident_us'), finding('MAJOR_REPAIR_UNVERIFIED', 'accident_us')] });
    eq(r.events.length, 1, 'одна подія з пʼяти джерел'); eq(itemsOf(r, 'accident_history').length, 1, 'одна строка');
    eq(r.events[0].v4_category, 'medium', 'панелі = середнє'); eq(r.events[0].category_basis.includes('airbags_deployed'), false, 'подушки як підстава категорії'); eq(sum(r), 0.7, 'сума 0.7 (середнє з 2026-09-30)');
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
    eq(sum(run({ currentVisual: cv([cvf('front', 'chip', { component: 'windshield' })]) })), 0.3, 'лобове: суттєвий скол 0.3');
    eq(sum(run({ currentVisual: cv([cvf('rear', 'broken_component', { component: 'bumper' })]) })), 0.3, 'зламаний бампер 0.3');
    eq(sum(run({ currentVisual: cv([cvf('rear', 'broken_component', { component: 'other' })]) })), 0, 'зламаний елемент без компонента (старий кеш) не рахується');
    eq(sum(run({ currentVisual: cv([cvf('rear', 'missing_component', { component: 'other' })]) })), 0.3, 'відсутня деталь без компонента рахується');
    eq(sum(run({ currentVisual: cv([cvf('front', 'scratch_scuff')]) })), 0, 'подряпина = чек-лист');
    eq(sum(run({ currentVisual: cv([cvf('front', 'wear', { component: 'headlight' })]) })), 0.4, 'матова фара (wear + headlight) = 0.4');
    eq(sum(run({ currentVisual: cv([cvf('rear', 'broken_component', { component: 'panel', severity: 'severe' })]) })), 0.5, 'зімʼята панель як broken_component = вмʼятина 0.5');
    eq(itemsOf(run({ currentVisual: cv([cvf('front', 'missing_component', { component: 'bumper', severity: 'severe' }), cvf('engine_bay', 'missing_component', { component: 'other', severity: 'severe', photo: 9 })]) }), 'body_condition').length, 1, 'відсутній передок: front + engine_bay = одна строка');
    /* HV-пошкодження без CV не дає поточного штрафу; ДТП + CV-вмʼятина в зоні = обидві */
    const hOnly = run({ auctionMeta: lot(), historicalVisual: hv(), currentVisual: cv([]) });
    eq(itemsOf(hOnly, 'body_condition').length, 0, 'архівні кадри створили поточний штраф');
    const both = run({ auctionMeta: lot(), historicalVisual: hv(), currentVisual: cv([cvf('front', 'dent')]) });
    eq(itemsOf(both, 'accident_history').length, 1, 'ДТП строка'); eq(itemsOf(both, 'body_condition').length, 1, 'вмʼятина строка');
    ok(near(sum(both), 1.2, 1.2), 'ДТП 0.7 + вмʼятина 0.5 = 1.2: ' + sum(both));
    eq(both.events[0].unrepaired_signs, true, 'unrepaired_signs');
    eq(run({ evidence: { ...baseEv, cv_status: 'failed' }, currentVisual: cv([cvf('front', 'dent')]) }).inputs.body_condition.status, 'unavailable', 'CV не ok = unavailable');
  }

  /* ===== 8. вхід 3: салон ===== */
  {
    const r = run({ currentVisual: cv([cvf('driver_area', 'wear', { component: 'seat', photo: 1 }), cvf('front_seats', 'wear', { component: 'seat', photo: 2 }), cvf('driver_area', 'wear', { component: 'steering_wheel', photo: 3 }), cvf('rear_seats', 'tear', { component: 'seat' })]) });
    /* 2026-09-30: сидіння рядами (передній + задній 0.8, розрив +0.4), кермо окремо, салон разом не більше 1.2 */
    /* 2026-10-01: обидва ряди 1.0 + кермо 0.2 + значне пошкодження (розрив) до капу салону 1.5 */
    eq(itemsOf(r, 'interior_condition').length, 3, 'сидіння, кермо, значне пошкодження');
    ok(near(sum(r), 1.5, 1.5), 'D: салон упирається в кап 1.5: ' + sum(r));
    const pass = run({ currentVisual: cv([cvf('front_passenger', 'wear', { component: 'seat', photo: 21, sign: 'потертість валика пасажирського сидіння' }), cvf('front_seats', 'wear', { component: 'seat', photo: 21, sign: 'потертість валика пасажирського сидіння' })]) });
    /* той самий знос пасажирського сидіння у двох зонах: один дефект, один ряд = 0.4 */
    eq(sum(pass), 0.6, 'суттєвий знос одного ряду = 0.6, дубль зон не подвоює');
    const ns = run({ currentVisual: cv([], { zones: { sufficient: ['front', 'rear'], partial: [], not_visible: ['driver_area', 'front_seats'] } }) });
    eq(ns.inputs.interior_condition.status, 'unavailable', 'салон не показаний'); ok(ns.unresolved.some(u => u.key === 'interior_not_shown'), 'unresolved interior_not_shown');
  }

  /* ===== 9. вхід 4: інтенсивність ===== */
  {
    /* погоджена крива 2026-09-26: точні якорі, лінійна інтерполяція, кап 5.0 з 12x */
    const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) errs.push(m + ': ' + a + ' != ' + b); };
    for (const [x, y] of [[1.2, 0], [1.5, 0.4], [2.0, 1.0], [2.5, 1.6], [3.0, 2.1], [3.5, 2.5], [4.0, 2.9], [5.0, 3.5], [8.0, 4.5], [12.0, 5.0]]) near(intensityPenalty(x), y, 'якір ' + x);
    eq(intensityPenalty(1.19), 0, '1.19'); eq(intensityPenalty(1.0), 0, 'норма'); eq(intensityPenalty(0.3), 0, 'малий пробіг без бонусу'); eq(intensityPenalty(12.5), 5, '12.5 кап'); eq(intensityPenalty(40), 5, '40 кап');
    near(intensityPenalty(3.2), 2.26, 'інтерполяція 3.2'); near(intensityPenalty(1.35), 0.2, 'інтерполяція 1.35'); near(intensityPenalty(10), 4.75, 'інтерполяція 10');
    ok(intensityPenalty(0.1) >= 0 && intensityPenalty(0) === 0, 'бонусу за малий пробіг нема');;
    const veh = { odometer_km: 180000, age_months: 60, powertrain_class: 'petrol' };   /* 36 000 км/рік, ratio 3.0 */
    const r = run({ vehicle: veh });
    eq(r.items.find(i => i.key === 'input4:intensity').amount, 2.1, 'ratio 3.0 = 2.1'); eq(r.mileage_intensity.ratio, 3, 'ratio');
    const swap = run({ vehicle: veh, listingText: 'Стоит контрактный мотор.', sellerDisclosures: [{ category: 'engine_swap_installed', unit: 'engine', quote: 'контрактный мотор', negated: false, vague: false, seller_favor: true }] });
    eq(swap.items.find(i => i.key === 'input4:intensity').amount, 2.1, 'свап не вимикає інтенсивність'); ok(swap.unresolved.some(u => u.key === 'engine_swap_claimed'), 'свап в unresolved');
    /* старе авто з пробігом, накопиченим за багато років: майже без штрафу
       (300 000 км за ~24 роки ~ 12 500 км/рік, ratio ~1.04) */
    const old = run({ vehicle: { odometer_km: 300000, age_months: 288, powertrain_class: 'petrol' } });
    eq(old.inputs.mileage_intensity.status, 'clean', 'старе авто з віковим пробігом без штрафу інтенсивності');
    ok(old.mileage_intensity.ratio < 1.2, 'старе авто: ratio ' + old.mileage_intensity.ratio);
    /* невідомий пробіг чи вік: штрафу нема (UNKNOWN != BAD) */
    for (const v of [{ odometer_km: null, age_months: 60, powertrain_class: 'petrol' }, { odometer_km: 200000, age_months: null, powertrain_class: 'petrol' }]) {
      const u = run({ vehicle: v });
      eq(u.inputs.mileage_intensity.status, 'unavailable', 'невідомо = unavailable'); ok(!u.items.some(x => x.input === 'mileage_intensity'), 'невідомо = без штрафу');
    }
    /* інтерполяція без проміжного округлення: 3.2x -> 2.26 у точному значенні */
    const r32 = run({ vehicle: { odometer_km: 192000, age_months: 60, powertrain_class: 'petrol' } });   /* 38 400 км/рік / 12 000 = 3.2 */
    ok(Math.abs(r32.mileage_intensity.penalty_exact - 2.26) < 1e-9, '3.2x точно 2.26: ' + r32.mileage_intensity.penalty_exact);
    /* реальний кейс: Toyota RAV4 MY2023, 124 000 км, вік 39 міс. від середини модельного року,
       тип двигуна за наявним правилом (hybrid без рівня електрифікації = unknown, норма 14 000):
       стара крива давала 1.24 і бал 8.6, нова мусить відчутно знизити бал */
    const OLD_CFG = { ...C, INTENSITY_CURVE: [[1.2, 0], [1.5, 0.3], [2.0, 0.8], [3.0, 1.4], [5.0, 2.2], [8.0, 3.0], [12.0, 4.0]] };
    const rav = { vehicle: { odometer_km: 124000, age_months: 39, age_source: 'model_year_midpoint', powertrain_class: 'unknown' } };
    const ravNew = run(rav), ravOld = computeScoreV4({ findings: [], evidence: baseEv, listingText: 'Продається авто. Опис продавця без дефектів.', ...rav }, OLD_CFG);
    /* 8.6 у проді тих часів містило старий штраф за вік 0.21; з віком 0.1/рік (39 міс. = 0.33) та сама стара крива дає 8.4 */
    eq(ravOld.final_if_eligible, 8.4, 'RAV4 зі старою кривою 8.4 (8.6 зі старим віком)');
    ok(ravNew.mileage_intensity.penalty_exact > 1.8 && ravNew.mileage_intensity.penalty_exact < 1.85, 'RAV4 новий штраф ~1.83: ' + ravNew.mileage_intensity.penalty_exact);
    ok(ravOld.final_if_eligible - ravNew.final_if_eligible >= 0.5, 'RAV4: нова крива відчутно знижує бал: ' + ravOld.final_if_eligible + ' -> ' + ravNew.final_if_eligible);
    /* з 2026-09-26 той самий RAV4 (fuel "hybrid") класифікується як HEV, норма 12 000 */
    const ravHev = run({ vehicle: { ...rav.vehicle, powertrain_class: resolvePowertrainClass({ fuel: 'hybrid' }) } });
    eq(ravHev.mileage_intensity.powertrain_class, 'hev', 'RAV4 hybrid -> HEV'); eq(ravHev.mileage_intensity.ratio, 3.18, 'RAV4 HEV ratio 3.18');
    ok(Math.abs(ravHev.mileage_intensity.penalty_exact - 2.2436) < 0.001, 'RAV4 HEV штраф ~2.24: ' + ravHev.mileage_intensity.penalty_exact);
    eq(ravHev.final_if_eligible, 7.4, 'RAV4 HEV бал 7.4 (7.5 зі старим штрафом за вік)');
    eq(run({ vehicle: { ...veh, age_months: 6 } }).inputs.mileage_intensity.status, 'unavailable', 'молодше року');
    eq(resolvePowertrainClass({ nhtsa: { ElectrificationLevel: 'PHEV (Plug-in Hybrid Electric Vehicle)', FuelTypePrimary: 'Gasoline' } }), 'phev', 'PHEV');
    eq(resolvePowertrainClass({ nhtsa: { FuelTypePrimary: 'Gasoline' }, fuel: 'hybrid' }), 'petrol', 'NHTSA пріоритетніше');
    /* 2026-09-26, рішення власника: hybrid без явного plug-in = HEV, явний plug-in = PHEV */
    eq(resolvePowertrainClass({ fuel: 'hybrid' }), 'hev', 'hybrid без ознаки plug-in = HEV');
    eq(resolvePowertrainClass({ fuel: 'plug-in hybrid' }), 'phev', 'явний plug-in = PHEV'); eq(resolvePowertrainClass({ fuel: 'phev' }), 'phev', 'phev');
    eq(resolvePowertrainClass({ fuel: null }), 'unknown', 'тип невідомий = unknown'); eq(resolvePowertrainClass({ fuel: 'lpg' }), 'unknown', 'невизначений тип = unknown');
    eq(V4.mileageNormKmYear('unknown'), 14000, 'норма unknown'); eq(V4.mileageNormKmYear('phev'), 15000, 'норма phev');
  }

  /* ===== 9б. вхід 7: вік: свідома частина абсолютного балу, 0.1 за рік від точних місяців (правило власника 2026-10-08) ===== */
  {
    const ageOf = m => run({ vehicle: { odometer_km: 1000, age_months: m, powertrain_class: 'petrol' } });
    ok(!('enabled' in C.AGE), 'штраф за вік не має перемикача: він завжди активний');
    eq(JSON.stringify(C.AGE), JSON.stringify({ per_year: 0.1 }), 'конфіг віку: лише per_year 0.1, без ступенів');
    for (const [m, pen] of [[12, 0.1], [36, 0.3], [60, 0.5], [96, 0.8], [120, 1.0], [180, 1.5], [240, 2.0]]) {
      const r = ageOf(m);
      const it = r.items.find(i => i.key === 'input7:age');
      eq(it && it.amount, pen, 'вік ' + m + ' міс.'); eq(it && it.label_key, 'Vehicle age', 'label віку');
      eq(r.inputs.vehicle_age.status, 'applied', 'статус віку ' + m);
    }
    /* молодше року: лише пропорційна частка за місяцями, без ступені на 12 міс. */
    eq(ageOf(6).items.find(i => i.key === 'input7:age').amount, 0.05, '6 місяців: 0.05'); eq(ageOf(11).items.find(i => i.key === 'input7:age').amount, 0.09, '11 місяців: 0.09');
    eq(ageOf(18).items.find(i => i.key === 'input7:age').amount, 0.15, '18 місяців: 0.15 без округлення до років');
    eq(ageOf(0).items.length, 0, '0 місяців: 0'); eq(ageOf(0).inputs.vehicle_age.status, 'clean', '0 місяців: clean');
    let prevAge = 0; for (let m = 1; m <= 300; m++) { const a = ageOf(m).items.find(i => i.key === 'input7:age').amount; ok(a >= prevAge && a - prevAge <= 0.011, 'вік не плавний біля ' + m + ' міс.'); prevAge = a; }
    eq(ageOf(6).inputs.mileage_intensity.status, 'unavailable', 'інтенсивність до року unavailable');
    const noAge = run({ vehicle: { odometer_km: 1000, age_months: null, powertrain_class: 'petrol' } });
    eq(noAge.inputs.vehicle_age.status, 'unavailable', 'вік невідомий = unavailable'); eq(sum(noAge), 0, 'вік невідомий = 0');
    const both = run({ vehicle: { odometer_km: 180000, age_months: 60, powertrain_class: 'petrol' } });
    ok(near(sum(both), 2.6, 2.6), 'інтенсивність 2.1 + вік 0.5 незалежно: ' + sum(both)); eq(both.final, 7.4, 'final 7.4');
    eq(run({ vehicle: { odometer_km: 1000, age_months: 480, powertrain_class: 'petrol' } }).items.find(i => i.key === 'input7:age').amount, 4.0, '40 років = 4.0, без капа');
  }

  /* ===== 9в. вхід 8: кількість власників. 2026-10-08: кількість власників сама по
     собі не дефект (OWNERS.enabled = false); лічильник лишається у inputs для UI ===== */
  {
    const ev = (...ords) => ords.map((o, i) => ({ ordinal: o, date: '20' + (10 + i) + '-01-01' }));
    const own = (events, reg) => run({ ownerEvents: events, ownersCountRegistry: reg });
    eq(C.OWNERS.enabled, false, 'штраф за власників має бути вимкнений');
    for (const n of [1, 2, 3, 5, 7, 10]) {
      const r = own(ev(...Array.from({ length: n }, (_, i) => i + 1)), n);
      ok(!r.items.some(i => i.key === 'input8:owners'), 'власників ' + n + ' дали рядок штрафу'); eq(r.inputs.vehicle_owners.owners_count, n, 'owners_count ' + n);
      eq(r.inputs.vehicle_owners.status, 'not_scored', 'статус власників ' + n); eq(sum(r), 0, 'власників ' + n + ' щось відняли');
      eq(r.availability.ownership_history, 'known', 'availability власників ' + n);
    }
    const legacy = { ...C, OWNERS: { ...C.OWNERS, enabled: true } };
    const legacyOwn = n => computeScoreV4({ findings: [], evidence: { identity_confirmed: true, basics_known: true, photos_count: 15, seller_text_chars: 300, registry_present: true, historical_listings_count: 0, cv_status: 'ok', cv_zones_sufficient: 10, listing_vin: 'WBAJE7C34HG887901' }, listingText: 'x', ownerEvents: ev(...Array.from({ length: n }, (_, i) => i + 1)), ownersCountRegistry: n }, legacy);
    for (const [n, pen] of [[1, 0], [3, 0.2], [10, 0.9]]) eq((legacyOwn(n).items.find(i => i.key === 'input8:owners') || { amount: 0 }).amount, pen, 'legacy власників ' + n);
    const unk = own([], null);
    eq(unk.inputs.vehicle_owners.status, 'unavailable', 'невідомо = unavailable'); eq(unk.inputs.vehicle_owners.owners_count, null, 'owners_count null'); eq(sum(unk), 0, 'невідомо = 0');
    eq(unk.availability.ownership_history, 'unavailable', 'availability для Confidence');
    eq(V4.resolveOwnersCount(ev(1, 2, 3), 3), 3, '1,2,3 -> 3');
    eq(V4.resolveOwnersCount(ev(1, 2, 3), null), 3, '1,2,3 без лічильника реєстру -> 3');
    eq(V4.resolveOwnersCount(ev(1, 3), null), null, '1,3 -> unknown');
    eq(V4.resolveOwnersCount(ev(2, 3), null), null, '2,3 без 1 -> unknown');
    eq(V4.resolveOwnersCount([{ ordinal: 1, date: '2020-01-01' }, { ordinal: 2, date: '2021-01-01' }, { ordinal: 2, date: '2021-01-01' }], null), null, 'дублікат не збільшує кількість');
    eq(V4.resolveOwnersCount(ev(1, 2, 3), 4), null, 'суперечність із лічильником реєстру -> unknown');
    /* власники не впливають на eligibility */
    const weak = { ...baseEv, photos_count: 1, seller_text_chars: 0, registry_present: true, historical_listings_count: 0, cv_status: 'failed', cv_zones_sufficient: 0 };
    const w5 = run({ evidence: weak, ownerEvents: ev(1, 2, 3, 4, 5), ownersCountRegistry: 5 });
    eq(w5.score_eligible, false, 'пʼять власників самі по собі не роблять Score eligible'); eq(w5.eligibility.strong_negative, false, 'власники не strong negative');
    /* незалежність від віку та інтенсивності */
    const both = run({ ownerEvents: ev(1, 2, 3), ownersCountRegistry: 3, vehicle: { odometer_km: 180000, age_months: 60, powertrain_class: 'petrol' } });
    ok(near(sum(both), 2.6, 2.6), 'інтенсивність 2.1 + вік 0.5, власники не штрафуються: ' + sum(both)); eq(both.final, 7.4, 'final 7.4 сходиться з items');
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
    eq(sum(rb([p('2025-01-04', 510000, 'platform_history'), p('2026-09-24', 405000, 'platform_history'), p('2026-09-24', 405000, 'current')])), 0, 'рядок площадки про поточне оголошення + саме оголошення не є двома сімействами');
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

  /* ===== 11б. накопичення стану (калібрування на реальній Camry 2014, 2026-09-29) =====
     Одна дрібна знахідка штрафу не дає; кілька незалежних дрібних дефектів
     кузова чи плями і знос сидінь у кількох зонах салону накопичуються.
     Суттєвий перекіс або відкритий зазор панелі тепер рахується. */
  {
    /* різні дефекти: власний кадр і власна ознака (той самий кадр + ознака = один дефект) */
    let nth = 100;
    const minorF = (zone, kind, o = {}) => { nth++; return cvf(zone, kind, { severity: 'minor', photo: nth, sign: 'ознака ' + zone + ' ' + kind + ' ' + nth, ...o }); };
    const camryVeh = { odometer_km: 200000, age_months: 147, age_source: 'model_year_midpoint', powertrain_class: 'petrol' };
    const cvZones = { sufficient: ['front', 'rear', 'left_side', 'right_side', 'left_front', 'right_front', 'wheels', 'driver_area', 'front_seats', 'rear_seats', 'dashboard'], partial: [], not_visible: [] };
    const tired = [
      minorF('rear', 'scratch_scuff', { component: 'bumper' }), minorF('rear', 'chip'), minorF('front', 'scratch_scuff', { component: 'bumper', photo: 19 }),
      minorF('front', 'scratch_scuff', { component: 'bumper', photo: 14 }), minorF('left_side', 'scratch_scuff'),
      cvf('left_front', 'broken_component', { component: 'mirror' }), cvf('right_front', 'panel_gap_alignment', { component: 'panel' }),
      minorF('rear_seats', 'stain', { component: 'seat' }), minorF('front_seats', 'stain', { component: 'seat', photo: 6 }), minorF('front_seats', 'stain', { component: 'seat', photo: 8, confidence: 'medium' }),
    ];
    const accident = { auctionMeta: lot({ primary_damage: 'REAR END' }), historicalVisual: hv({ visible_damage_zones: ['кришка багажника', 'задня панель'] }), accidentRecord: { recorded: true, note: null },
      findings: [finding('MAJOR_REPAIR_UNVERIFIED', 'rear_accident', { severity: 'high' })] };
    const A = run({ vehicle: camryVeh, currentVisual: { zones: cvZones, condition_findings: [] } });
    const B = run({ vehicle: camryVeh, currentVisual: { zones: cvZones, condition_findings: [] }, ...accident });
    const Cc = run({ vehicle: camryVeh, currentVisual: { zones: cvZones, condition_findings: tired }, ...accident });
    ok(A.final_if_eligible > B.final_if_eligible, 'A чиста Camry вище за B з ДТП: ' + A.final_if_eligible + ' / ' + B.final_if_eligible);
    ok(B.final_if_eligible > Cc.final_if_eligible, 'B (ДТП, чистий стан) вище за C (ДТП + втомлений стан): ' + B.final_if_eligible + ' / ' + Cc.final_if_eligible);
    ok(A.final_if_eligible - Cc.final_if_eligible >= 2.5, 'C матеріально нижче за чисту: ' + A.final_if_eligible + ' -> ' + Cc.final_if_eligible);
    ok(B.final_if_eligible - Cc.final_if_eligible >= 2.0, 'стан сам по собі відчутно знижує бал: ' + B.final_if_eligible + ' -> ' + Cc.final_if_eligible);
    /* H: відремонтоване середнє ДТП при доброму стані: історія знижує, але авто лишається добрим */
    eq(B.items.find(i => i.input === 'accident_history').amount, 0.7, 'H: середнє ДТП 0.7'); eq(B.inputs.body_condition.status, 'clean', 'H: стан добрий');
    ok(A.final_if_eligible - B.final_if_eligible <= 0.8, 'H: ДТП не домінує над добрим станом (не більше 0.8 відносно чистої): ' + A.final_if_eligible + ' -> ' + B.final_if_eligible);
    /* I: поганий стан без ДТП все одно матеріально знижує бал */
    const I0 = run({ vehicle: camryVeh, currentVisual: { zones: cvZones, condition_findings: tired } });
    ok(A.final_if_eligible - I0.final_if_eligible >= 2.0, 'I: поганий стан без ДТП: ' + A.final_if_eligible + ' -> ' + I0.final_if_eligible);
    /* зведення стану для основного аналізу: ті самі знахідки, без чисел балу */
    const sumC = V4.currentConditionSummary({ zones: cvZones, condition_findings: tired });
    eq(sumC.exterior.state, 'below_good', 'зведення: кузов нижче доброго'); eq(sumC.interior.state, 'below_good', 'зведення: салон нижче доброго');
    ok(!/amount|penalt|0\.\d/.test(JSON.stringify(sumC)), 'зведення без штрафів і чисел балу');
    eq(V4.currentConditionSummary({ zones: cvZones, condition_findings: [] }).exterior.state, 'no_notable_issues', 'зведення: чисте авто');
    eq(V4.currentConditionSummary({ zones: cvZones, condition_findings: [minorF('front', 'chip')] }).exterior.state, 'no_notable_issues', 'зведення: один скол не робить стан поганим');
    const ck = k => Cc.items.find(i => i.key === k);
    eq(ck('input2:cosmetic_wear') && ck('input2:cosmetic_wear').amount, 1.1, 'G: 4 незалежні дефекти у 3 зонах (дубль зони і виду не рахується) = 0.8 + 0.3');
    eq(ck('input3:seating') && ck('input3:seating').amount, 1, 'C: плями переднього і заднього ряду = 1.0');
    eq(ck('input2:panel_misalignment:right_front') && ck('input2:panel_misalignment:right_front').amount, 0.4, 'C: перекіс панелі = 0.4');
    eq(Cc.items.filter(i => i.input === 'accident_history').length, B.items.filter(i => i.input === 'accident_history').length, 'стан не дублює ту саму аварію');
    /* D: старе авто з віковим пробігом у відмінному стані: лише вік, без штрафу за пробіг */
    const D = run({ vehicle: { odometer_km: 300000, age_months: 288, powertrain_class: 'petrol' }, currentVisual: { zones: cvZones, condition_findings: [] } });
    eq(D.inputs.mileage_intensity.status, 'clean', 'D: віковий пробіг без штрафу'); eq(D.inputs.body_condition.status, 'clean', 'D: кузов чистий'); eq(D.inputs.interior_condition.status, 'clean', 'D: салон чистий');
    /* 2026-10-08: вік 0.1 за рік (24 роки = 2.4) є єдиним штрафом такого авто: 7.6, не нижче */
    ok(D.items.every(i => i.key === 'input7:age'), 'D: окрім віку щось відняли: ' + D.items.map(i => i.key).join(',')); ok(near(D.final_if_eligible, 7.6, 7.6), 'D: старе авто у відмінному стані = 10 мінус лише вік 2.4: ' + D.final_if_eligible);
    /* E: один ізольований дрібний скол, два дрібні дефекти, одна пляма: без штрафу */
    for (const few of [[minorF('front', 'chip')], [minorF('front', 'chip'), minorF('rear', 'scratch_scuff')], [minorF('front_seats', 'stain', { component: 'seat' })],
      [minorF('front', 'chip', { photo: 1 }), minorF('front', 'chip', { photo: 2 }), minorF('front', 'chip', { photo: 3 }), minorF('front', 'chip', { photo: 4 })]]) {
      const e = run({ currentVisual: { zones: cvZones, condition_findings: few } });
      eq(sum(e), 0, 'E: поодинокі дрібні дефекти (чи багато кадрів одного дефекту) без штрафу: ' + few.length);
    }
    /* поріг: три незалежні дефекти = 0.45; кап 0.8; низька впевненість не рахується */
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front', 'chip'), minorF('front', 'scratch_scuff'), minorF('rear', 'chip')] } })), 0.6, 'кілька незалежних у 2 зонах = 0.6');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front', 'chip'), minorF('rear', 'chip'), minorF('left_side', 'scratch_scuff')] } })), 0.9, 'F: 3 незалежні у 3 зонах = 0.6 + 0.3');
    const many = ['front', 'rear', 'left_side', 'right_side', 'left_front', 'right_front'].flatMap(z => [minorF(z, 'chip'), minorF(z, 'scratch_scuff')]);
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: many } })), 1.5, 'H: кап накопичення кузова 1.5');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front', 'chip', { confidence: 'low' }), minorF('rear', 'chip', { confidence: 'low' }), minorF('left_side', 'chip', { confidence: 'low' })] } })), 0, 'низька впевненість не накопичується');
    /* суттєва пляма сидіння вже рахується поштучно: та сама зона в накопиченні не рахується вдруге */
    const seatMat = run({ currentVisual: { zones: cvZones, condition_findings: [cvf('front_seats', 'tear', { component: 'seat' }), minorF('front_seats', 'stain', { component: 'seat' }), minorF('rear_seats', 'stain', { component: 'seat' })] } });
    ok(!seatMat.items.some(i => i.key === 'input3:upholstery_wear'), 'зона з суттєвим пошкодженням сидіння не рахується двічі');
    /* той самий стан передніх сидінь у зонах driver_area і front_seats: один ряд, один штраф;
       дрібні плями на вже порахованому ряду не накопичуються (реальний повторний прогін Camry) */
    const rows = run({ currentVisual: { zones: cvZones, condition_findings: [cvf('driver_area', 'stain', { component: 'seat', photo: 6 }), cvf('front_seats', 'stain', { component: 'seat', photo: 8 }),
      minorF('front_passenger', 'stain', { component: 'seat', photo: 9 }), minorF('rear_seats', 'stain', { component: 'seat', photo: 10, confidence: 'medium' })] } });
    eq(rows.items.filter(i => i.input === 'interior_condition').map(i => i.key + '=' + i.amount).join(), 'input3:seating=1', 'передній ряд раз + задній ряд = 1.0');
    const frontOnly = run({ currentVisual: { zones: cvZones, condition_findings: [cvf('driver_area', 'stain', { component: 'seat', photo: 6 }), cvf('front_seats', 'stain', { component: 'seat', photo: 8 })] } });
    eq(sum(frontOnly), 0.6, 'плями лише переднього ряду (у двох зонах Vision) = 0.6');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front_seats', 'stain', { component: 'seat' }), minorF('rear_seats', 'stain', { component: 'seat' })] } })), 1, 'C: плями переднього і заднього ряду = 1.0');
    /* дрібний зазор панелі (Vision оцінив як minor) не губиться: це незалежний дефект у накопиченні */
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front', 'panel_gap_alignment'), minorF('front', 'chip'), minorF('rear', 'chip')] } })), 0.6, 'дрібний зазор панелі входить у накопичення');
    /* суттєва потертість без поштучного рядка не губиться: входить у накопичення (реальний прогін Camry) */
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [cvf('rear', 'scratch_scuff', { component: 'bumper', photo: 41, sign: 'потертість бампера 41' }), minorF('rear', 'chip'), minorF('front', 'chip')] } })), 0.6, 'moderate потертість у накопиченні');
    /* суттєва вмʼятина має поштучний рядок і в накопичення вдруге не йде */
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [cvf('rear', 'dent', { photo: 42, sign: 'вмʼятина 42' }), minorF('rear', 'chip'), minorF('front', 'chip')] } })), 0.5, 'вмʼятина окремо, без подвійного рахунку');
    /* G: скло пропорційно, з будь-якої зони кадру, не входить у косметичне накопичення */
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front', 'chip', { component: 'windshield' })] } })), 0.15, 'G: маленький скол лобового 0.15');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('dashboard', 'chip', { component: 'windshield' })] } })), 0.15, 'G: скол лобового з кадру салону теж рахується');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [cvf('front', 'crack', { component: 'windshield', severity: 'severe' })] } })), 0.6, 'G: тріщина лобового 0.6');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front', 'chip', { component: 'windshield' }), minorF('rear', 'chip'), minorF('left_side', 'chip')] } })), 0.15, 'G: скол скла не добиває косметичне накопичення до порогу');
    /* той самий дефект (кадр + ознака), покладений Vision у дві зони, рахується раз (реальний третій прогін Camry) */
    const gap = { kind: 'panel_gap_alignment', severity: 'moderate', confidence: 'high', component: 'panel', photo: 13, sign: 'Між передньою кромкою капота та бампером нерівний зазор.' };
    const twice = run({ currentVisual: { zones: cvZones, condition_findings: [{ zone: 'front', ...gap }, { zone: 'left_front', ...gap }] } });
    eq(twice.items.filter(i => i.type === 'panel_misalignment').length, 1, 'дубль дефекту у двох зонах рахується раз');
    /* 2026-09-30: UNKNOWN != BAD. Невідома тяжкість 0.5 і не важча за підтверджене середнє;
       ранні події не вище за середнє; тяжкі рівні без змін */
    eq(C.ACCIDENT.unknown, 0.5, 'невідома тяжкість 0.5'); ok(C.ACCIDENT.unknown <= C.ACCIDENT.medium, 'невідома не важча за середнє');
    eq(C.ACCIDENT.earlier_events, 1, 'K: додаткова рання аварія 1.0'); eq(C.ACCIDENT.unknown, 0.5, 'L: одна подія невідомої тяжкості 0.5'); eq(C.ACCIDENT.medium, 0.7, 'M: підтверджене середнє 0.7');
    for (const [k, v] of [['medium', 0.7], ['heavy', 2.5], ['total', 5.0], ['fire', 3.0], ['flood', 2.5], ['unrepaired_seller', 2.5], ['light', 0.4]]) eq(C.ACCIDENT[k], v, 'рівень ДТП ' + k + ' не змінений');
    /* сидіння по рядах: знахідка переднього ряду, заднього, обох; чистий ряд без знахідки; дублі кадрів ряду не множать */
    const seatRowF = (zone, photo) => cvf(zone, 'stain', { component: 'seat', photo, sign: 'помітні плями на подушці ' + zone + ' ' + photo });
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [seatRowF('front_seats', 31)] } })), 0.6, 'B: лише передній ряд = 0.6');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [seatRowF('rear_seats', 32)] } })), 0.6, 'B: лише задній ряд = 0.6');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [seatRowF('front_seats', 31), seatRowF('rear_seats', 32)] } })), 1, 'C: обидва ряди = 1.0');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [] } })), 0, 'чисті ряди без знахідок = 0');
    /* ряд, де модель окремо підтвердила помітний знос (row_confirmed), не є поодинокою дрібною плямою */
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('rear_seats', 'stain', { component: 'seat', row_confirmed: true })] } })), 0.6, 'підтверджений ряд = 0.6');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('rear_seats', 'stain', { component: 'seat' })] } })), 0, 'одна дрібна пляма без підтвердження ряду = 0');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [seatRowF('rear_seats', 32), seatRowF('rear_seats', 33), seatRowF('rear_seats', 34)] } })), 0.6, 'кілька кадрів одного ряду = 0.6');
    /* 2026-10-01: D значне фізичне пошкодження салону окремо, звичайна пляма ним не є; E 1-2 дефекти кузова 0; J вмʼятина/зазор не вдруге */
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [cvf('doors', 'broken_component', { component: 'door_card', photo: 51, sign: 'зламана накладка дверної карти' })] } })), 0.5, 'D: зламана оздоба салону = 0.5');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [cvf('front_seats', 'stain', { component: 'seat', photo: 52, sign: 'помітна пляма 52' })] } })), 0.6, 'D: суттєва пляма це ряд, а не значне пошкодження');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [cvf('front_seats', 'tear', { component: 'seat', photo: 53, sign: 'розрив 53' }), cvf('rear_seats', 'stain', { component: 'seat', photo: 54, sign: 'плями 54' }), cvf('dashboard', 'wear', { component: 'steering_wheel', photo: 55, sign: 'знос керма 55' })] } })), 1.5, 'D: кап салону 1.5');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [minorF('front', 'chip'), minorF('rear', 'scratch_scuff')] } })), 0, 'E: два звичайні дефекти без накопичення');
    eq(sum(run({ currentVisual: { zones: cvZones, condition_findings: [cvf('front', 'panel_gap_alignment', { photo: 56, sign: 'зазор 56' }), minorF('front', 'chip'), minorF('rear', 'chip')] } })), 0.4, 'J: суттєвий зазор окремо, у накопичення не йде');
    for (const [k, v] of [['heavy', 2.5], ['total', 5.0], ['fire', 3.0], ['flood', 2.5]]) eq(C.ACCIDENT[k], v, 'N: ' + k + ' без змін');
    /* страховий випадок площадки (рішення власника 2026-10-06): підтверджена
       подія невідомої тяжкості = рівно один існуючий штраф unknown 0.5
       через ту саму подієву модель; окремого штрафу і стелі нема */
    const insOf = r => itemsOf(r, 'accident_history');
    const rnd1 = x => Math.round((x + Number.EPSILON) * 10) / 10;
    const ins = run({ evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(rnd1(sum(ins) - sum(run({}))), 0.5, 'страховий випадок: рівно 0.5');
    eq(insOf(ins).length, 1, 'страховий випадок: один ряд');
    eq(insOf(ins)[0].key, 'accident_latest_unknown', 'страховий випадок: існуючий ряд unknown, не новий тип');
    eq(insOf(ins)[0].amount, C.ACCIDENT.unknown, 'страховий випадок: вага unknown');
    eq(insOf(ins)[0].label_key, 'Insurance case recorded, severity not established', 'ярлик страхового випадку');
    eq(ins.events.length, 1, 'страховий: одна подія'); eq(ins.events[0].normalized_event_id, 'insurance:record', 'страховий: id події'); eq(ins.events[0].anchored, false, 'страховий: подія не заякорена');
    ok(!ins.unresolved.some(u => u.key === 'insurance_case_recorded'), 'стара позначка без штрафу лишилась');
    ok(ins.unresolved.some(u => u.key === 'accident_severity_unknown' && u.params.event_id === 'insurance:record' && /Insurance case/.test(u.note_key)), 'нема позначки unknown для страхового');
    /* 2. той самий випадок: запис ДТП площадки + страховий + лот з кадрами: ОДНА подія, найсильніша класифікація */
    const both = run({ auctionMeta: lot(), historicalVisual: hv({ outer_panel_damage_extent: 'single_panel' }), accidentRecord: { recorded: true, note: 'ДТП' }, evidence: { ...baseEv, insurance_case_recorded: true, auction_record_exists: true } });
    eq(both.events.length, 1, 'страховий + ДТП + лот: подій не одна'); eq(insOf(both).length, 1, 'страховий + лот: рядів не один');
    ok(both.events[0].merge_basis.includes('insurance_record_attached') && both.events[0].merge_basis.includes('platform_record_attached'), 'страховий запис не прикріплений до якірної події');
    eq(insOf(both)[0].key, 'accident_latest_light', 'найсильніша класифікація = light з кадрів');
    eq(rnd1(sum(both) - sum(run({}))), C.ACCIDENT.light, 'страховий + легке: лише 0.4, без 0.5 зверху');
    /* 3. страховий + запис ДТП площадки без лота: одна unknown подія, 0.5 один раз */
    const recIns = run({ accidentRecord: { recorded: true, note: 'ДТП 2021' }, evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(insOf(recIns).length, 1, 'ДТП + страховий без лота: один ряд'); eq(rnd1(sum(recIns) - sum(run({}))), 0.5, 'ДТП + страховий: 0.5 один раз');
    ok(recIns.events.length === 1 && recIns.events[0].merge_basis.includes('insurance_record_attached'), 'страховий не прикріплений до запису ДТП');
    /* 4. та сама подія (запис площадки злитий з лотом, страховий з того ж блоку):
       помірне/серйозне з кадрів перемагає, 0.5 зникає */
    const sameRec = { recorded: true, note: 'ДТП' };
    const medIns = run({ auctionMeta: lot(), historicalVisual: hv(), accidentRecord: sameRec, evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(medIns.events.length, 1, 'страховий + запис + лот: подій не одна');
    eq(insOf(medIns).map(i => i.key).join(','), 'accident_latest_medium', 'страховий + помірне: лише medium');
    eq(rnd1(sum(medIns) - sum(run({}))), C.ACCIDENT.medium, 'страховий + помірне: 0.7 без 0.5');
    const hvy = hv({ damage_depth: 'inner_structure_or_module', inner_component_damage_extent: 'substantial', inner_component_deformation_visible: 'visible' });
    eq(rnd1(sum(run({ auctionMeta: lot(), historicalVisual: hvy, accidentRecord: sameRec, evidence: { ...baseEv, insurance_case_recorded: true } })) - sum(run({}))), C.ACCIDENT.heavy, 'страховий + серйозне: 2.5 без 0.5');
    /* лот без видимих пошкоджень + страховий: лот подією не стає (D2, лише
       позначка про невідому причину продажу), страховий дає свою одну
       подію unknown 0.5; другого штрафу нема */
    const cleanLot = run({ auctionMeta: lot(), historicalVisual: hv({ visible_damage_zones: [], outer_panel_damage_extent: 'none', damage_depth: 'indeterminate', fascia_status: 'intact_mounted' }), evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(rnd1(sum(cleanLot) - sum(run({}))), 0.5, 'чистий лот + страховий: 0.5'); eq(insOf(cleanLot).length, 1, 'чистий лот + страховий: один ряд');
    eq(cleanLot.events.map(e => e.normalized_event_id).join(','), 'insurance:record', 'чистий лот + страховий: подія лише страхова');
    ok(cleanLot.unresolved.some(u => u.key === 'auction_reason_unknown'), 'чистий лот + страховий: позначка про лот без причини зникла');
    /* 5. salvage/титул/страховик/аукціон без підтвердженої події: нічого */
    const title = run({ auctionMeta: lot(), listingText: 'Copart SALVAGE title, rebuilt, insurer State Farm, total loss, був ремонт. Продається авто.', evidence: { ...baseEv, auction_record_exists: true } });
    eq(rnd1(sum(title) - sum(run({}))), 0, 'титул без події дав штраф'); ok(!title.events.length, 'титул створив подію');
    /* 6. дві незалежні події + страховий без запису площадки: існуюча multi-event логіка, страховий окремою подією, третього рядка нема */
    const twoIns = run({ auctionMeta: lot(), historicalVisual: hv(), findings: [
      finding('STRUCTURAL_DAMAGE', 'accident_2019', { evidence: [{ source: 'registry', ref: 'reg', description: 'структурне ДТП 2019' }] }),
      finding('AIRBAGS_DEPLOYED', 'accident_2016', { evidence: [{ source: 'registry', ref: 'reg', description: 'подушки 2016' }] }),
    ], evidence: { ...baseEv, insurance_case_recorded: true } });
    const twoNo = run({ auctionMeta: lot(), historicalVisual: hv(), findings: [
      finding('STRUCTURAL_DAMAGE', 'accident_2019', { evidence: [{ source: 'registry', ref: 'reg', description: 'структурне ДТП 2019' }] }),
      finding('AIRBAGS_DEPLOYED', 'accident_2016', { evidence: [{ source: 'registry', ref: 'reg', description: 'подушки 2016' }] }),
    ] });
    /* лот іншого ринку і групи знахідок без запису площадки: ствердного звʼязку
       зі страховим записом нема, він лишається окремою подією; ранні події
       це одна плоска строка, тому сума та сама */
    eq(sum(twoIns), sum(twoNo), 'дві події + страховий: сума змінилась'); eq(twoIns.events.length, twoNo.events.length + 1, 'страховий без ствердного звʼязку мав лишитися окремою подією');
    ok(twoIns.items.some(i => i.key === 'accident_earlier_events'), 'дві події + страховий: рання подія зникла');
    ok(!twoIns.events.some(e => e.merge_basis.includes('insurance_record_attached')), 'страховий прикріплено до події іншого контексту');
    /* J. лот + страховий без запису площадки: дві незалежні події, існуюча логіка ранніх подій */
    const lotIns = run({ auctionMeta: lot(), historicalVisual: hv({ outer_panel_damage_extent: 'single_panel' }), evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(lotIns.events.length, 2, 'лот + страховий без запису площадки: подій не дві');
    eq(insOf(lotIns).map(i => i.key).sort().join(','), 'accident_earlier_events,accident_latest_light', 'лот + страховий: рядки');
    eq(rnd1(sum(lotIns) - sum(run({}))), rnd1(C.ACCIDENT.light + C.ACCIDENT.earlier_events), 'лот + страховий: сума двох незалежних подій');
  }

  /* ===== 12. незмінний config_tag ===== */
  {
    const hash = crypto.createHash('md5').update(JSON.stringify(C)).digest('hex');
    /* 2026-09-25: у ELIGIBILITY додано listing_identity_photos (v4-prod-2026-09-25).
       2026-09-26: погоджена крива інтенсивності пробігу, тег v4-prod-2026-09-26;
       того ж дня hybrid без plug-in = HEV, тег v4-prod-2026-09-26-hev.
       2026-09-29: накопичення дрібних дефектів (WEAR) і перекіс панелі, тег v4-prod-2026-09-29;
       того ж дня сидіння рахуються по рядах (без подвійного рахунку), тег v4-prod-2026-09-29b.
       2026-09-30: нинішній стан сильніше (сидіння рядами, поширені дефекти, скло), середнє ДТП 0.7, тег v4-prod-2026-09-30;
       того ж дня дрібний зазор панелі в накопиченні, тег v4-prod-2026-09-30b.
       2026-10-07: v4-prod-2026-10-07. 2026-10-08: кількість власників не штрафується
       (OWNERS.enabled = false), тег v4-prod-2026-10-08; того ж дня вік 0.1 за рік від точних
       місяців (AGE.per_year), тег v4-prod-2026-10-08b */
    const EXPECTED = 'b661c61ffcdb26fea1b9c7724702a77f';
    if (hash !== EXPECTED) errs.push('SCORE_CONFIG_V4 змінився (md5 ' + hash + '), онови CONFIG_TAG і хеш у тесті');
  }

  /* ===== 13. ізоляція продакшн v3 ===== */
  {
    const checkSrc = fs.readFileSync('api/check.js', 'utf8');
    ok(/computeScoreV4/.test(checkSrc), 'check.js: v4 не викликається');
    ok(/SCORE_VERSION === 'v4' \? breakdownV4 : breakdownV3/.test(checkSrc), 'check.js: активний breakdown обирає диспетчер');
    ok(/CALCAR_SCORE_VERSION === 'v3' \? 'v3' : 'v4'/.test(checkSrc), 'check.js: за замовчуванням має бути v4, rollback через env v3');
    ok(/maxResolvedSeverity\(parsed\.score_breakdown && parsed\.score_breakdown\.score_version === 'v4' \? parsed\.score_breakdown_shadow : parsed\.score_breakdown\)/.test(checkSrc), 'check.js: resolved severity для текстів береться з v3 у тіні');
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
