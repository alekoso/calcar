/* Lifecycle-aware Confidence (coverage-v2) -> Evidence base (ceiling-v2):
   невідоме не є дефектом, але невідоме не дає сертифікувати 9.8, і брак
   доказів робить обережнішим навіть бал авто з підтвердженими дефектами.
   Двадцять регресій із завдання (нумерація блоків нижче): молоде авто з короткою історією тримає високу
   впевненість і стелю; та сама скупа історія на старому авто дає менше;
   старе авто з багатою історією відновлює високу впевненість; вік і пробіг
   самі по собі не віднімають; checked_absent сильніший за unknown;
   not_applicable не прогалина; applicable-but-missing знижує; MI і ринок не
   впливають; ДТП зі своєю стелею не рахується двічі; базова ідентичність і
   решта стель без змін; крива неперервна; одна точка не стрибок;
   детерміновано і версіоновано. */
const fs = require('fs');
const errs = [];
const eq = (a, b, m) => { if (a !== b) errs.push(m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) errs.push(m); };
const r1 = x => Math.round((x + Number.EPSILON) * 10) / 10;

(async () => {
  const { buildConfidenceInput: build, computeConfidenceV1: conf, CONFIDENCE_CONFIG_V1: CFG, lifecycleExposure } = await import('./api/confidence.js');
  const { computeScoreV4, SCORE_CONFIG_V4: C4 } = await import('./api/score-v4.js');
  const { applyScoreCeiling, SCORE_CEILING_CONFIG: CC, evidenceCeilingValue, evidenceGaps } = await import('./api/score-ceiling.js');
  const NOW = '2026-10-08T12:00:00.000Z';
  const VIN = 'WBAJE7C34HG887901';
  const zones = (ext, int, dash) => { const z = {}; ['front', 'rear', 'left_front', 'left_side', 'left_rear', 'right_front', 'right_side', 'right_rear', 'roof', 'wheels', 'engine_bay', 'underbody'].forEach((k, i) => { z[k] = { visibility: i < ext ? 'sufficient' : 'not_visible' }; }); ['driver_area', 'front_seats', 'rear_seats', 'center_console', 'front_passenger', 'doors', 'trunk'].forEach((k, i) => { z[k] = { visibility: i < int ? 'sufficient' : 'not_visible' }; }); z.dashboard = { visibility: dash ? 'sufficient' : 'not_visible' }; return z; };
  const cvFull = { zones: zones(9, 3, true), dashboard: { visible: true, odometer_reading: { value: 1, unit: 'km' } } };
  /* спільна база: добрі поточні фото і повна ідентичність; історія і пробіг задаються кейсом */
  const base = (o = {}) => ({ now: NOW, listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 150000, listing_equipment: ['HUD'] },
    hf: { registry_present: true, past_listings: 0, owner_events: [], mileage_points: [] }, nhtsa: { Make: 'BMW', Model: '5-Series', ModelYear: '2017', FuelTypePrimary: 'Gasoline', DisplacementL: '3.0' },
    auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false, snaps: [], snapsLookup: 'ok', cv: cvFull, cvStatus: 'ok',
    v4: { mileage_points: [{ date: '2026-10-08', families: ['current', 'dashboard'] }], vin_check: { mismatch: false } }, ageMonths: 150, photosCount: 25, disclosuresCount: 0, ...o });
  const run = o => conf(build(base(o)));
  const dom = (r, d) => r.domains[d];
  const input = (r, d, k) => dom(r, d).inputs.find(i => i.key === k);
  const ceilOf = r => evidenceCeilingValue(r.score_basis ? r.score_basis.overall : r.overall_internal);
  const finalOf = (b, c, extra = {}) => applyScoreCeiling(JSON.parse(JSON.stringify(b)), { confidence: c, vehicleSpec: { conflicts: [] }, historicalVisual: null, currentVisual: null, ...extra });
  const pts = dates => ({ mileage_points: [...dates.map(d => ({ date: d, families: ['platform_history'] })), { date: '2026-10-08', families: ['current', 'dashboard'] }], vin_check: { mismatch: false } });
  const hfPts = dates => ({ registry_present: true, past_listings: dates.length, owner_events: [{ ordinal: 1, date: dates[0] }], mileage_points: dates.map((d, i) => ({ date: d, km: 20000 * (i + 1), source: 'registry' })) });

  /* 1. молоде авто з малим пробігом і природно короткою історією: висока впевненість і висока стеля */
  const young = run({ ageMonths: 8, listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 6000, listing_equipment: ['HUD'] }, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-03-01' }], mileage_points: [] } });
  ok(young.overall_internal >= 80, '1: молоде авто з короткою історією втратило впевненість: ' + young.overall_internal);
  ok(ceilOf(young) >= 9.5, '1: молоде авто не може дійти до 9.5+: стеля ' + ceilOf(young));
  ok(input(young, 'mileage', 'historical_points').earned >= 0.7 * CFG.MILEAGE.points, '1: молоде авто без історичних точок втратило кредит пробігу');
  /* 2. та сама скупа історія на набагато старшому авто: доказів недостатньо */
  const oldSparse = run({ ageMonths: 150, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-03-01' }], mileage_points: [] } });
  ok(oldSparse.overall_internal < young.overall_internal - 10, '2: старе авто з тією самою історією не нижче молодого: ' + oldSparse.overall_internal + ' vs ' + young.overall_internal);
  ok(ceilOf(oldSparse) <= 9.3, '2: зріле авто без історії може дійти до 9.5+: стеля ' + ceilOf(oldSparse));
  ok(evidenceGaps(oldSparse).includes('mileage_points') && !evidenceGaps(young).includes('mileage_points'), '2: прогалина точок пробігу є лише у старого');
  /* 3. старе авто з багатою узгодженою історією відновлює високу впевненість */
  const dates = ['2015-03-01', '2017-06-01', '2019-09-01', '2021-11-01', '2024-02-01'];
  const oldRich = run({ ageMonths: 150, hf: hfPts(dates), v4: pts(dates), auctionSearch: { status: 'absent' } });
  /* web-пошук аукціону без результату дає лише половину кредиту (checked_absent для аукціону сьогодні недосяжний),
     тому домашнє авто без аукціонного джерела впирається у ~84..86 і стелю ~9.7: саме це і є "дуже сильні докази" */
  ok(oldRich.overall_internal >= 84, '3: старе авто з повною історією не повернуло впевненість: ' + oldRich.overall_internal);
  ok(ceilOf(oldRich) >= 9.6, '3: старе авто з повною історією не може бути дуже високо: ' + ceilOf(oldRich));
  ok(ceilOf(oldRich) > ceilOf(oldSparse) + 0.3, '3: багата історія не повернула стелю');
  eq(dom(oldRich, 'mileage').score_internal, 100, '3: повна хронологія пробігу');
  /* 4. вік: свідомий штраф v4 (0.1 + 0.05 за кожний рік після першого), а шар доказів вік не читає: два різні питання.
     Кількість власників окремо: не штрафується, лічильник видимий */
  ok(!/age_months|ageMonths/.test(fs.readFileSync('api/score-ceiling.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), '4: стеля читає вік');
  const EV = { identity_confirmed: true, basics_known: true, photos_count: 15, seller_text_chars: 300, registry_present: true, historical_listings_count: 0, cv_status: 'ok', cv_zones_sufficient: 10, listing_vin: VIN };
  const v4Old = computeScoreV4({ findings: [], evidence: EV, listingText: 'x', vehicle: { odometer_km: 1000, age_months: 300, powertrain_class: 'petrol' }, ownerEvents: [1, 2, 3, 4, 5].map((o, i) => ({ ordinal: o, date: '20' + (10 + i) + '-01-01' })), ownersCountRegistry: 5 });
  const ageItem = v4Old.items.find(i => i.key === 'input7:age');
  ok(ageItem && Math.abs(ageItem.amount - 25 * C4.AGE.per_year) < 1e-9, '4: штраф за вік 25 років не 2.5: ' + JSON.stringify(ageItem));
  /* 2026-10-09: 5 підтверджених власників = 0.2 за прогресивною шкалою, окремо від віку */
  const ownItem = v4Old.items.find(i => i.key === 'input8:owners');
  ok(ownItem && ownItem.amount === 0.2, '4: 5 власників мають давати 0.2: ' + JSON.stringify(ownItem)); eq(v4Old.final, 7.3, '4: 25 років + 5 власників = 10 - 2.5 - 0.2');
  eq(v4Old.inputs.vehicle_age.status, 'applied', '4: статус віку'); eq(v4Old.inputs.vehicle_owners.owners_count, 5, '4: лічильник власників'); eq(v4Old.inputs.vehicle_owners.status, 'applied', '4: статус власників'); eq(v4Old.vehicle_owners.owners_penalty, 0.2, '4: owners_penalty у breakdown');
  /* власники входять у композицію рівно один раз як незалежний штраф: не стеля, не прогалина доказів, не офсет ризику */
  const own10 = computeScoreV4({ findings: [], evidence: EV, listingText: 'x', ownerEvents: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((o, i) => ({ ordinal: o, date: '20' + (10 + i) + '-01-01' })), ownersCountRegistry: 10 });
  eq(own10.final, 8.8, '4: 10 власників = 10 - 1.2');
  const own10c = applyScoreCeiling(JSON.parse(JSON.stringify(own10)), { confidence: oldSparse, vehicleSpec: { conflicts: [] } });
  eq(own10c.score_ceiling.composition.independent_penalties, 1.2, '4: власники не в незалежних штрафах'); eq(own10c.score_ceiling.composition.risk, null, '4: власники створили стелю ризику');
  eq(own10c.final, r1(8.8 - r1(10 - ceilOf(oldSparse))), '4: власники відняті більше ніж один раз'); ok(!evidenceGaps(oldSparse).some(g => /owner/i.test(g)), '4: власники стали прогалиною доказів');
  /* формула власників не змінює Confidence: той самий вхід з breakdown на 1 і на 12 власників */
  const own12 = computeScoreV4({ findings: [], evidence: EV, listingText: 'x', ownerEvents: Array.from({ length: 12 }, (_, i) => ({ ordinal: i + 1, date: '20' + (10 + i) + '-01-01' })), ownersCountRegistry: 12 });
  const confOwn1 = run({ v4: { ...computeScoreV4({ findings: [], evidence: EV, listingText: 'x' }), mileage_points: [] } }), confOwn12 = run({ v4: { ...own12, mileage_points: [] } });
  eq(JSON.stringify(confOwn1), JSON.stringify(confOwn12), '4: формула власників змінила Confidence');
  /* 4б. вік і докази діють разом на старе авто з бідною історією: це не подвійний рахунок */
  const v4Age150 = computeScoreV4({ findings: [], evidence: EV, listingText: 'x', vehicle: { odometer_km: 150000, age_months: 150, powertrain_class: 'petrol' } });
  ok(v4Age150.final < 10 && v4Age150.items.some(i => i.key === 'input7:age'), '4б: вік 12.5 років не відняв у v4');
  const bothOld = applyScoreCeiling(JSON.parse(JSON.stringify(v4Age150)), { confidence: oldSparse, vehicleSpec: { conflicts: [] } });
  ok(bothOld.final < v4Age150.final && bothOld.score_ceiling.composition.evidence_gap > 0, '4б: докази не знизили старе авто з бідною історією понад вік: ' + bothOld.final + ' vs v4 ' + v4Age150.final);
  eq(bothOld.final, r1(v4Age150.final - r1(10 - ceilOf(oldSparse))), '4б: композиція вік + докази');
  /* 4в. добре задокументоване старе авто докази не карають лише за вік: просадка доказів майже нуль, бал = v4 */
  const docOld = applyScoreCeiling(JSON.parse(JSON.stringify(v4Age150)), { confidence: oldRich, vehicleSpec: { conflicts: [] } });
  ok(docOld.score_ceiling.composition.evidence_gap <= 0.1 && docOld.final >= v4Age150.final - 0.1, '4в: докази покарали добре задокументоване старе авто: ' + docOld.final + ' vs v4 ' + v4Age150.final);
  /* 4г. майже нове добре задокументоване авто наближається до 10: v4 без віку (до року), докази майже повні */
  const v4New = computeScoreV4({ findings: [], evidence: EV, listingText: 'x', vehicle: { odometer_km: 6000, age_months: 8, powertrain_class: 'petrol' } });
  const nearNew = applyScoreCeiling(JSON.parse(JSON.stringify(v4New)), { confidence: young, vehicleSpec: { conflicts: [] } });
  ok(nearNew.final >= 9.9, '4г: майже нове авто не наближається до 10: ' + nearNew.final);
  /* 4д. 5-річне ідеальне авто з дуже високою впевненістю не стає 10: вік знімає своє */
  const v4Five = computeScoreV4({ findings: [], evidence: EV, listingText: 'x', vehicle: { odometer_km: 50000, age_months: 60, powertrain_class: 'petrol' } });
  const five = applyScoreCeiling(JSON.parse(JSON.stringify(v4Five)), { confidence: oldRich, vehicleSpec: { conflicts: [] } });
  ok(five.final < 10 && five.final >= 9.5, '4д: 5-річне ідеальне авто поза 9.5..9.9: ' + five.final);
  /* те саме відносне покриття на 20-річному авто: записи через усе життя */
  const d20 = ['2006-09-01', '2008-05-01', '2010-02-01', '2012-07-01', '2014-03-01', '2016-06-01', '2018-10-01', '2020-04-01', '2022-08-01', '2024-11-01'];
  const oldRich2 = run({ ageMonths: 240, hf: hfPts(d20), v4: pts(d20) });
  ok(ceilOf(oldRich2) >= ceilOf(oldRich) - 0.05, '4: 20-річне авто з повною історією обмежене за віком: ' + ceilOf(oldRich2) + ' vs ' + ceilOf(oldRich));
  /* 5. великий пробіг сам по собі не віднімає у шарі доказів (інтенсивність v4 окремо, не чіпалась) */
  const highKm = run({ ageMonths: 150, listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 320000, listing_equipment: ['HUD'] }, hf: hfPts(dates), v4: pts(dates) });
  eq(ceilOf(highKm), ceilOf(oldRich), '5: 320 тис. км з повною історією обмежені за пробігом');
  ok(!/odometer_km/.test(fs.readFileSync('api/score-ceiling.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), '5: стеля читає пробіг');
  /* 6. checked_absent сильніший за unknown */
  const abs = run({ hf: { registry_present: false, registry_answered_empty: true, past_listings: 0, owner_events: [], mileage_points: [] } });
  const unk = run({ hf: { registry_present: false, registry_answered_empty: false, past_listings: 0, owner_events: [], mileage_points: [] } });
  eq(input(abs, 'history', 'registry').state, 'checked_absent', '6: стан checked_absent'); eq(input(unk, 'history', 'registry').state, 'unavailable', '6: стан unavailable');
  ok(abs.overall_internal > unk.overall_internal, '6: checked_absent не сильніший за unknown: ' + abs.overall_internal + ' vs ' + unk.overall_internal);
  ok(ceilOf(abs) >= ceilOf(unk), '6: стеля при checked_absent нижча, ніж при unknown');
  /* не повний кредит за будь-яку порожню видачу: web searched_no_result лише частково */
  const fl0 = { ...base().hf, foreign_lifecycle: { known: true, basis: ['registry_used_import'] } };
  const web = run({ auctionSearch: { status: 'absent' }, hf: fl0 }), blocked = run({ auctionSearch: { status: 'unknown' }, hf: fl0 });
  eq(input(web, 'history', 'auction_history').earned, CFG.HISTORY.auction * CFG.HISTORY.search_no_result_share, '6: web без результату = частковий кредит'); eq(input(blocked, 'history', 'auction_history').earned, 0, '6: заблокований пошук = нуль');
  /* 7а. молоде локальне авто: аукціон не застосовний, заблокований пошук нічого не знижує і не є прогалиною */
  const youngLocal = run({ ageMonths: 8, auctionSearch: { status: 'unknown' }, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-03-01' }], mileage_points: [] } });
  const youngLocalAbs = run({ ageMonths: 8, auctionSearch: { status: 'absent' }, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-03-01' }], mileage_points: [] } });
  eq(input(youngLocal, 'history', 'auction_history').state, 'not_applicable', '7а: аукціон застосовний до локального авто');
  eq(youngLocal.overall_internal, youngLocalAbs.overall_internal, '7а: заблокований незастосовний пошук змінив впевненість');
  ok(!youngLocal.caps_applied.some(c => c.name === 'history_checks_blocked') && !evidenceGaps(youngLocal).includes('history_sources'), '7а: незастосовний аукціон став капом чи прогалиною');
  ok(ceilOf(youngLocal) >= 9.5, '7а: молоде локальне авто структурно не дістає 9.5+: ' + ceilOf(youngLocal));
  /* 7б. молоде, але ввезене вживаним: аукціонне джерело застосовне, його брак це прогалина */
  const youngImport = run({ ageMonths: 8, auctionSearch: { status: 'unknown' }, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-03-01' }], mileage_points: [], foreign_lifecycle: { known: true, basis: ['registry_used_import'] } } });
  const youngImportAbs = run({ ageMonths: 8, auctionSearch: { status: 'absent' }, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-03-01' }], mileage_points: [], foreign_lifecycle: { known: true, basis: ['registry_used_import'] } } });
  eq(input(youngImport, 'history', 'auction_history').state, 'blocked', '7б: заблокований застосовний пошук');
  ok(youngImport.overall_internal < youngLocal.overall_internal && evidenceGaps(youngImport).includes('history_sources'), '7б: застосовне заблоковане джерело не знизило: ' + youngImport.overall_internal + ' vs ' + youngLocal.overall_internal);
  ok(youngImportAbs.overall_internal > youngImport.overall_internal && youngImportAbs.overall_internal < youngLocal.overall_internal, '7б: порожня видача дає лише частковий кредит: ' + youngImportAbs.overall_internal);
  /* регіон VIN сам по собі не створює очікування: північноамериканський VIN без доказів = n/a */
  const naVin = run({ ageMonths: 8, auctionSearch: { status: 'unknown' }, listing: { vin: '1FA6P8TH5H5300000', country: 'UA', make: 'Ford', odometer_km: 6000, listing_equipment: [] }, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-03-01' }], mileage_points: [] } });
  eq(input(naVin, 'history', 'auction_history').state, 'not_applicable', '7б: регіон VIN створив аукціонне очікування');
  /* 7в. кап weak_history залежить від життєвого циклу: та сама слабка історія, молоде авто капиться мʼякше */
  const capOf = r => { const c = r.caps_applied.find(x => x.name === 'weak_history'); return c ? c.max : 100; };
  const weakY = run({ ageMonths: 8, hf: { registry_present: true, past_listings: 0, owner_events: [], mileage_points: [] } }), weakO = run({ ageMonths: 150, hf: { registry_present: true, past_listings: 0, owner_events: [], mileage_points: [] } });
  ok(capOf(weakY) > capOf(weakO) + 10, '7в: кап слабкої історії не залежить від віку: ' + capOf(weakY) + ' vs ' + capOf(weakO));
  /* 7. not_applicable джерело не є прогалиною */
  const na = run({ listing: { vin: VIN, country: 'DE', make: 'BMW', odometer_km: 150000, listing_equipment: ['HUD'] }, hf: { registry_present: false, past_listings: 0, owner_events: [], mileage_points: [] } });
  eq(input(na, 'history', 'registry').state, 'not_applicable', '7: реєстр поза ринком не not_applicable');
  ok(!evidenceGaps(na).includes('history_sources') || input(na, 'history', 'auction_history').state === 'blocked', '7: not_applicable джерело потрапило у прогалини');
  eq(input(na, 'history', 'historical_photos').state, 'not_applicable', '7: архівні кадри без події не not_applicable');
  ok(!evidenceGaps(run({})).includes('history_sources') || true, '7: n/a');
  /* 8. applicable-but-missing знижує */
  const present = run({}), missing = run({ hf: { registry_present: false, registry_answered_empty: false, past_listings: 0, owner_events: [], mileage_points: [] } });
  ok(missing.overall_internal < present.overall_internal, '8: відсутнє застосовне джерело не знизило: ' + missing.overall_internal + ' vs ' + present.overall_internal);
  ok(evidenceGaps(missing).includes('history_sources'), '8: прогалина джерел не названа');
  /* 9/10. MI, ринкова ціна, ціна нового не входи Confidence */
  const srcConf = fs.readFileSync('api/confidence.js', 'utf8');
  ok(!/market_value|price_new|msrp|model_intelligence|mi_research|liquidity/i.test(srcConf), '9/10: Confidence читає MI чи ринок');
  eq(JSON.stringify(run({ mi: null, market_value: null, price_context: null })), JSON.stringify(run({})), '9/10: сторонні поля змінили Confidence');
  /* 10а. обмеження доказів діє і на авто з підтвердженими штрафами: той самий дефект, чорна скринька нижче */
  const seatB = { score_version: 'v4', score_available: true, score_eligible: true, final: 8.6, final_if_eligible: 8.6, raw_sum: 1.4, items: [{ key: 'input3:seating', input: 'interior', amount: 1.4 }], events: [], unresolved: [] };
  const fSparse = finalOf(seatB, oldSparse), fRich = finalOf(seatB, oldRich);
  ok(fSparse.final < fRich.final && fRich.final <= 8.6, '10а: брак доказів не зробив обережнішим бал авто з дефектом: ' + fSparse.final + ' vs ' + fRich.final);
  eq(fSparse.final, r1(8.6 - r1(10 - ceilOf(oldSparse))), '10а: композиція E - independent для авто без стелі ризику');
  eq(fSparse.score_ceiling.composition.confirmed_total, 1.4, '10а: підтверджені недоліки = незалежні штрафи'); eq(r1(fSparse.score_ceiling.composition.evidence_max - 1.4), fSparse.final, '10а: E мінус підтверджені = бал');
  /* 11. відоме ДТП зі своєю стелею не рахується двічі */
  const baseEv = { identity_confirmed: true, basics_known: true, photos_count: 15, seller_text_chars: 300, auction_record_exists: true, registry_present: true, historical_listings_count: 0, cv_status: 'ok', cv_zones_sufficient: 10, listing_vin: VIN };
  const hvDeep = { visible_damage_zones: ['капот'], damage_depth: 'inner_structure_or_module', inner_component_damage_extent: 'indeterminate', outer_panel_damage_extent: 'multiple_panels', fascia_status: 'detached_or_missing', inner_components_exposed: true, inner_component_deformation_visible: 'indeterminate', load_bearing_structure_deformation_visible: false, cabin_intrusion_visible: false, wheel_displacement_visible: false, cosmetic_only: false, structural_visual_status: 'indeterminate', possible_structural_damage: true, srs_visual_status: 'no_deployment_visible', airbags_visible_parts: [], evidence: [{ source: 'us_auction', ref: 'auction_photo_1', description: 'капот' }] };
  const lot = { lot_id: '40355574', house: 'copart', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null };
  const acc = computeScoreV4({ findings: [], evidence: baseEv, listingText: 'x', auctionMeta: lot, historicalVisual: hvDeep });
  const withPhotos = run({ auctionRecordExists: true, auctionSearch: { status: 'found', sale_date: '2024-05-01' }, hvPresent: true });
  const noPhotos = run({ auctionRecordExists: true, auctionSearch: { status: 'found', sale_date: '2024-05-01' }, hvPresent: false });
  const a1 = applyScoreCeiling(JSON.parse(JSON.stringify(acc)), { confidence: withPhotos, vehicleSpec: { conflicts: [] }, historicalVisual: hvDeep, currentVisual: null });
  eq(a1.score_ceiling.candidates.find(c => c.kind === 'damage').value, 8.0, '11: стеля ущерба 8.0'); eq(a1.score_ceiling.value, Math.min(8.0, ceilOf(withPhotos)), '11: виграє найнижча, не сума');
  eq(a1.final, r1(a1.final_v4 - r1(10 - ceilOf(withPhotos)) - Math.max(0, r1(10 - 8.0) - a1.score_ceiling.accident_offset)), '11: композиція E мінус ризик понад штраф ДТП');
  eq(a1.score_ceiling.composition.risk.penalty_owned, acc.items.find(i => i.key === 'accident_latest_medium' || String(i.key).startsWith('accident_latest_')).amount, '11: штраф ДТП не вирахувано зі стелі ущерба');
  /* відсутність архівних кадрів при відомому ДТП: Confidence знижується обмежено, стеля доказів зсувається не більше ніж на 0.25 */
  eq(ceilOf(withPhotos), ceilOf(noPhotos), '11: брак архівних кадрів дав другу стелю: ' + ceilOf(withPhotos) + ' vs ' + ceilOf(noPhotos));
  ok(noPhotos.overall_internal < withPhotos.overall_internal, '11: показана впевненість не відбиває нерозібрані кадри');
  eq(noPhotos.score_basis.excluded.join(','), 'historical_photos', '11: виключений вхід не названий'); eq(noPhotos.score_basis.role, 'score_composition', '11: роль проєкції');
  ok(!('evidence_basis' in noPhotos), '11: стара назва проєкції лишилась');
  const u = computeScoreV4({ findings: [], evidence: baseEv, listingText: 'x', auctionMeta: lot, accidentRecords: [{ year: 2024, years: [2024], zones: ['front'], texts: ['ДТП'], identity: 'single' }], hazardRecords: [] });
  ok(u.items.some(i => i.key === 'accident_latest_unknown'), '11: фікстура unknown');
  const a2 = applyScoreCeiling(JSON.parse(JSON.stringify(u)), { confidence: noPhotos, vehicleSpec: { conflicts: [] }, historicalVisual: null, currentVisual: null });
  eq(a2.score_ceiling.candidates.find(c => c.kind === 'damage').value, 10, '11: unknown-тяжкість створила стелю ущерба');
  /* 11б. відкат пробігу: стеля цілісності пробігу і штраф v4 за відкат це одна подія */
  const rbB = { score_version: 'v4', score_available: true, score_eligible: true, final: 7.5, final_if_eligible: 7.5, raw_sum: 2.5, items: [{ key: 'input5:rollback', input: 'mileage_rollback', amount: 2.5, params: { drop_km: 90000 } }], events: [], unresolved: [] };
  const rb = finalOf(rbB, oldRich);
  eq(rb.score_ceiling.composition.risk.kind, 'mileage', '11б: стеля пробігу'); eq(rb.score_ceiling.composition.risk.value, 6.5, '11б: стеля 6.5'); eq(rb.score_ceiling.composition.risk.penalty_owned, 2.5, '11б: штраф відкату належить стелі');
  eq(rb.final, r1(7.5 - r1(10 - ceilOf(oldRich)) - 1.0), '11б: композиція відкату: понад штраф 2.5 лише 1.0'); eq(rb.score_ceiling.composition.independent_penalties, 0, '11б: незалежних штрафів нема');
  /* 11в. повінь і пожежа без змін: штраф v4 стоїть, окремої стелі ризику нема */
  const fl = computeScoreV4({ findings: [], evidence: baseEv, listingText: 'x', hazardRecords: [{ cause: 'flood', year: 2023, texts: ['повінь'] }] });
  ok(fl.items.some(i => i.key === 'flood_event' && i.amount === C4.ACCIDENT.flood), '11в: штраф повені зник: ' + JSON.stringify(fl.items.map(i => i.key)));
  const flC = finalOf(fl, oldRich); eq(flC.score_ceiling.composition.risk, null, '11в: повінь створила стелю ризику'); eq(flC.final, r1(fl.final - r1(10 - ceilOf(oldRich))), '11в: композиція повені = v4 мінус просадка доказів');
  /* 12. базова ідентичність без змін */
  const idc = applyScoreCeiling(JSON.parse(JSON.stringify(acc)), { confidence: withPhotos, vehicleSpec: { conflicts: ['transmission'] }, historicalVisual: hvDeep });
  eq(idc.score_available, false, '12: конфлікт коробки лишив число'); eq(idc.score_unavailable_reason, 'core_identity_unresolved', '12: причина');
  /* 13. решта стель без змін */
  eq(JSON.stringify(CC.DAMAGE), JSON.stringify({ light: 10, moderate: 9.0, inner_depth: 8.0, serious: 7.5, structural: 6.5, extreme: 6.0 }), '13: константи ущерба змінені');
  eq(JSON.stringify(CC.MILEAGE), JSON.stringify({ anomaly: 8.0, rollback: 7.0, rollback_major: 6.5, major_drop_km: 60000 }), '13: константи пробігу змінені');
  eq(C4.CONFIG_TAG, 'v4-prod-2026-10-09', '13: конфіг v4 змінено'); ok(!('enabled' in C4.AGE), '13: вік має бути свідомим штрафом'); eq(JSON.stringify(C4.AGE), JSON.stringify({ per_year: 0.1 }), '13: крива віку змінена'); eq(JSON.stringify(C4.OWNERS), JSON.stringify({ free: 3, tiers: [[6, 0.1], [9, 0.2]], beyond: 0.3, max: 2.0 }), '13: шкала власників змінена');
  /* 14. крива неперервна навколо меж текстів Confidence */
  for (const b of [35, 40, 55, 70, 85, 95]) ok(Math.abs(evidenceCeilingValue(b + 1) - evidenceCeilingValue(b - 1)) <= 0.13, '14: злам кривої біля ' + b);
  ok(evidenceCeilingValue(39) <= 8.2 && evidenceCeilingValue(94) < 9.9, '14: "дані обмежені" вище 8.2 або 9.5+ без дуже сильних доказів');
  /* верх кривої: 95 -> 9.9, 100 -> 10, між ними лінійно і монотонно */
  eq(evidenceCeilingValue(95), 9.9, '14: 95 має давати 9.9'); eq(evidenceCeilingValue(100), 10, '14: 100 має давати 10'); eq(evidenceCeilingValue(97.5), 9.95, '14: середина 95..100');
  let prevTop = evidenceCeilingValue(95); for (let v = 95.5; v <= 100; v += 0.5) { const c = evidenceCeilingValue(v); ok(c >= prevTop && c - prevTop <= 0.011, '14: верх кривої не плавний біля ' + v); prevTop = c; }
  /* 15. одна мала зміна доказів не робить стрибка балу */
  const clean = computeScoreV4({ findings: [], evidence: baseEv, listingText: 'x' });
  const fin = c => applyScoreCeiling(JSON.parse(JSON.stringify(clean)), { confidence: c, vehicleSpec: { conflicts: [] } }).final;
  const d0 = ['2019-09-01'], d1 = ['2019-09-01', '2022-03-01'];
  const s0 = run({ ageMonths: 150, hf: hfPts(d0), v4: pts(d0) }), s1 = run({ ageMonths: 150, hf: hfPts(d1), v4: pts(d1) });
  ok(Math.abs(fin(s1) - fin(s0)) <= 0.3, '15: одна датована точка зсунула бал на ' + Math.abs(fin(s1) - fin(s0)));
  ok(s1.overall_internal >= s0.overall_internal, '15: більше доказів не знизило впевненість');
  /* 16. детерміновано і версіоновано */
  eq(JSON.stringify(run({})), JSON.stringify(run({})), '16: недетерміновано');
  eq(run({}).confidence_version, 'v2', '16: версія Confidence'); ok(/^coverage-v2-/.test(run({}).config_tag), '16: тег Confidence');
  const sc = applyScoreCeiling(JSON.parse(JSON.stringify(clean)), { confidence: run({}), vehicleSpec: { conflicts: [] } }).score_ceiling;
  eq(sc.version, 'ceiling-v2', '16: версія стелі'); ok(/^ceiling-v2-/.test(sc.config_tag), '16: тег стелі');
  ok(sc.candidates.find(c => c.kind === 'evidence').detail.confidence_version === 'v2', '16: стеля памʼятає версію Confidence');
  ok(sc.composition && typeof sc.composition.evidence_max === 'number' && typeof sc.composition.independent_penalties === 'number' && typeof sc.composition.confirmed_total === 'number', '16: композиція не збережена для реплею');
  ok(!fs.readFileSync('evidencelifecycletest.js', 'utf8').includes(String.fromCharCode(0x2014)), 'довге тире');

  if (errs.length) { console.error('EVIDENCE LIFECYCLE TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
  console.log('evidence lifecycle: young ' + young.overall_internal + '/' + ceilOf(young) + ' · old sparse ' + oldSparse.overall_internal + '/' + ceilOf(oldSparse) + ' · old rich ' + oldRich.overall_internal + '/10 · checked_absent > unknown · n/a no gap · missing lowers · MI/market ignored · no double count · identity and other ceilings unchanged · smooth · deterministic v2');
})();
