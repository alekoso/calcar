/* Ідентичність подій історії авто (Vehicle History): записи джерела проти
   канонічних подій. Перевіряється: той самий лот + ті самі архівні кадри +
   ті самі зони = одна подія; два записи з лише схожим текстом не зливаються
   автоматично (один рік, різні event_id); неоднозначний дублікат (сусідні
   роки, ті самі зони) не створює другого підтвердженого ДТП і штрафу за
   ранню подію; два незалежно доведені ДТП лишаються окремими; страховий
   запис кріпиться лише за доказом звʼязку; лізингова подія не псує
   хронологію власників і наступна реальна зміна власника не губиться;
   факт реєстру ніколи не стає словами продавця; дата кадру окремо від
   дати ДТП/продажу; невідома одиниця пробігу лишається невідомою; записи
   про повінь ідуть за тими самими правилами ідентичності і не стають "ДТП
   невідомої тяжкості". Без країн у правилах. */
const fs = require('fs');
const errs = [];
const eq = (a, b, msg) => { if (a !== b) errs.push(msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
const ok = (c, msg) => { if (!c) errs.push(msg); };
const DASH = String.fromCharCode(0x2014);

(async () => {
  const { parseHistoryRecords, groupAccidentRecords, classifyFixationSource, recordCause } = await import('./api/history-records.js');
  const { resolveAccidentEvents, sanitizeFindingsV3, zoneClasses } = await import('./api/score-v3.js');
  const resolve = (findings, ctx) => resolveAccidentEvents(sanitizeFindingsV3(findings).ok, ctx || {});
  const { computeScoreV4, SCORE_CONFIG_V4: C4 } = await import('./api/score-v4.js');
  const { parseOwnerEvents, classifyOwnerOperation, annotateOwnerOrdinals, addMissingOwnerEvents, describeOwnerEvents } = await import('./api/history-owners.js');
  const { buildConclusionContext } = await import('./api/conclusion.js');
  /* extractHistoryFacts живе в api/check.js (не імпортується без середовища): виконуємо її джерело з модулями, які вона читає */
  const api = fs.readFileSync('api/check.js', 'utf8');
  const grab = (src, name) => { const i = src.indexOf('export function ' + name + '('); if (i < 0) return null; let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i + 'export '.length, k + 1); } } return null; };
  const facts = new Function('zoneClasses', fs.readFileSync('api/history-owners.js', 'utf8').replace(/^export /gm, '') + fs.readFileSync('api/history-records.js', 'utf8').replace(/^export /gm, '') + grab(api, 'extractHistoryFacts') + '\nreturn extractHistoryFacts;')(zoneClasses);

  const VIN = 'WBAJE7C34HG887901';
  const baseEv = { identity_confirmed: true, basics_known: true, photos_count: 15, seller_text_chars: 300, auction_record_exists: false, registry_present: true, historical_listings_count: 0, cv_status: 'ok', cv_zones_sufficient: 10, listing_vin: VIN };
  const hv = (o = {}) => ({ visible_damage_zones: ['ліва двері', 'ліва задня боковина'], damage_depth: 'exterior_panels_only', inner_component_damage_extent: 'none', outer_panel_damage_extent: 'multiple_panels', fascia_status: 'intact_mounted', inner_components_exposed: false, inner_component_deformation_visible: 'not_visible', load_bearing_structure_deformation_visible: false, cabin_intrusion_visible: false, wheel_displacement_visible: false, cosmetic_only: false, structural_visual_status: 'no_obvious_severe_signs', srs_visual_status: 'no_deployment_visible', airbags_visible_parts: [], evidence: [{ source: 'us_auction', ref: 'auction_photo_1', description: 'вмʼятини лівих дверей' }], ...o });
  const lot = (o = {}) => ({ lot_id: '40355574', house: 'copart', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null, ...o });
  const F = (type, id, evidence, o = {}) => ({ type, event_id: id, evidence, repair_status: 'unknown', ...o });
  const E = (source, ref, description) => ({ source, ref, description });
  const run = (o = {}) => computeScoreV4({ findings: [], evidence: baseEv, listingText: 'Продається авто.', ...o });
  const accOf = r => r.items.filter(i => i.input === 'accident_history');
  const sum = r => Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 10) / 10;
  const HIST = 'Історія авто за VIN-кодом 03.09.26 Продається на AUTO.RIA Продавець вказав пробіг 50 тис. км 1-ий власник 09.07.21 Реєстрація ТЗ привезеного з-за кордону '
    + '15.02.21 Зафіксовано пробіг 11 тис. км Джерело фіксації ' + DASH + ' архівні дані з офіційного аукціону Copart в США '
    + '2021 рік Зафіксовано ДТП ДТП на території США в 2021 році із пошкодженням лівої сторони кузова Фото пошкоджень '
    + '2020 рік Зафіксовано ДТП ДТП на території США в 2020 році із пошкодженням лівої сторони кузова Фото пошкоджень Дізнайтесь більше про авто';

  /* ===== 1. той самий лот + ті самі архівні кадри + ті самі зони -> одна канонічна подія ===== */
  {
    const hf = facts(HIST);
    eq(hf.history_records.accidents.length, 2, '1: записів ДТП');
    eq(hf.history_records.accident_groups.length, 1, '1: два записи суміжних років з тими самими зонами мали стати однією групою');
    eq(hf.history_records.accident_groups[0].identity, 'possibly_same', '1: ідентичність групи');
    eq(hf.accident_note, 'ДТП на території США в 2021 році із пошкодженням лівої сторони кузова', '1: нотатка з першого запису (старий regex тут порожній)');
    const r = run({ auctionMeta: lot(), historicalVisual: hv(), accidentRecords: hf.history_records.accident_groups, hazardRecords: hf.history_records.hazards,
      findings: [F('MAJOR_REPAIR_UNVERIFIED', 'accident_2021', [E('us_auction', 'auction_photo_1', 'вмʼятини лівих дверей'), E('historical_listing', 'ria_2021', 'ДТП у 2021 році, ліва сторона')])] });
    eq(r.events.length, 1, '1: лот + кадри + запис площадки: подій не одна');
    ok(r.events[0].merge_basis.includes('platform_record_attached') && r.events[0].merge_basis.includes('duplicate_records_possible_same_event'), '1: записи не прикріплені до лота як possibly_same');
    eq(r.events[0].trusted_year, 2021, '1: рік події з запису площадки');
    eq(r.events[0].year_source, 'platform_record', '1: походження року');
    eq(r.events[0].record_identity, 'possibly_same', '1: ідентичність записів на події');
    ok(!r.items.some(i => i.key === 'accident_earlier_events'), '1: другий запис тієї ж події дав штраф за ранню подію');
    eq(accOf(r).length, 1, '1: один рядок ДТП');
  }

  /* ===== 2. два записи з ЛИШЕ схожим текстом не зливаються автоматично ===== */
  {
    /* один рік, різні event_id моделі, різні джерельні записи: модель розрізнила їх сама */
    const ev = resolve([
      F('AIRBAGS_DEPLOYED', 'acc_a_2021', [E('historical_listing', 'l1', 'подушки, перше ДТП 2021, ліва сторона')]),
      F('AIRBAGS_DEPLOYED', 'acc_b_2021', [E('historical_listing', 'l2', 'подушки, друге ДТП 2021, ліва сторона')]),
    ]);
    eq(ev.length, 2, '2: два записи одного року зі схожим текстом схлопнулись');
    /* різні зони: окремі навіть у суміжні роки */
    const ev2 = resolve([
      F('MAJOR_REPAIR_UNVERIFIED', 'accident_2021', [E('historical_listing', 'l1', 'ДТП 2021, пошкодження передньої частини')]),
      F('MAJOR_REPAIR_UNVERIFIED', 'accident_2020', [E('historical_listing', 'l2', 'ДТП 2020, пошкодження задньої частини')]),
    ]);
    eq(ev2.length, 2, '2: різні зони суміжних років злилися');
    /* розрив 2+ роки: окремі */
    const ev3 = resolve([
      F('MAJOR_REPAIR_UNVERIFIED', 'accident_2021', [E('historical_listing', 'l1', 'ДТП 2021, ліва сторона')]),
      F('MAJOR_REPAIR_UNVERIFIED', 'accident_2019', [E('historical_listing', 'l2', 'ДТП 2019, ліва сторона')]),
    ]);
    eq(ev3.length, 2, '2: розрив у два роки злився');
    /* записи площадки: ті самі зони, але 2+ роки різниці = окремі групи */
    const g = groupAccidentRecords([{ kind: 'accident', year: 2022, text: 'ліва сторона', zones: ['left'], photos: false, cause: null }, { kind: 'accident', year: 2019, text: 'ліва сторона', zones: ['left'], photos: false, cause: null }]);
    eq(g.groups.length, 2, '2: записи площадки з розривом 3 роки злилися');
  }

  /* ===== 3. неоднозначний дублікат не створює другого підтвердженого ДТП ===== */
  {
    /* без якоря: дві текстові групи сусідніх років, ті самі зони */
    const dup = run({ findings: [
      F('MAJOR_REPAIR_UNVERIFIED', 'accident_2021', [E('historical_listing', 'ria_2021', 'ДТП 2021, пошкодження лівої сторони кузова')]),
      F('MAJOR_REPAIR_UNVERIFIED', 'accident_2020', [E('historical_listing', 'ria_2020', 'ДТП 2020, пошкодження лівої сторони кузова')]),
    ] });
    eq(dup.events.length, 1, '3: неоднозначний дублікат став другою подією');
    eq(dup.events[0].record_identity, 'possibly_same', '3: подія не позначена як possibly_same');
    ok(!dup.items.some(i => i.key === 'accident_earlier_events'), '3: неоднозначний дублікат дав штраф за ранню подію');
    eq(accOf(dup).length, 1, '3: рядків ДТП не один');
    /* те саме для ДТП-груп (не лише ремонтних): сусідні роки, ті самі зони */
    const dup2 = run({ findings: [
      F('AIRBAGS_DEPLOYED', 'accident_2021', [E('historical_listing', 'ria_2021', 'подушки, ДТП 2021, ліва сторона')]),
      F('AIRBAGS_DEPLOYED', 'accident_2020', [E('historical_listing', 'ria_2020', 'подушки, ДТП 2020, ліва сторона')]),
    ] });
    eq(dup2.events.length, 1, '3: ДТП-групи сусідніх років стали двома подіями'); ok(!dup2.items.some(i => i.key === 'accident_earlier_events'), '3: штраф за ранню подію для дубліката ДТП-груп');
    /* ті самі два записи площадки без жодних знахідок моделі: одна подія unknown 0.5 */
    const hf = facts(HIST);
    const recOnly = run({ accidentRecords: hf.history_records.accident_groups, hazardRecords: [] });
    eq(recOnly.events.length, 1, '3: записи площадки без якоря дали дві події');
    eq(sum(recOnly), C4.ACCIDENT.unknown, '3: два записи однієї події мали дати один unknown');
  }

  /* ===== 4. два незалежно доведені ДТП лишаються окремими ===== */
  {
    const two = run({ auctionMeta: lot(), historicalVisual: hv(), findings: [
      F('STRUCTURAL_DAMAGE', 'accident_2019', [E('registry', 'reg', 'структурне ДТП 2019')]),
      F('AIRBAGS_DEPLOYED', 'accident_2016', [E('registry', 'reg', 'подушки 2016')]),
    ] });
    ok(two.items.some(i => i.key === 'accident_earlier_events' && i.amount === C4.ACCIDENT.earlier_events), '4: незалежна рання подія не оштрафована як раніше');
    /* записи площадки різних зон у суміжні роки = дві групи = дві події */
    const hf = facts('Історія авто за VIN-кодом 2021 рік Зафіксовано ДТП ДТП у 2021 році із пошкодженням передньої частини кузова 2020 рік Зафіксовано ДТП ДТП у 2020 році із пошкодженням задньої частини кузова Дізнайтесь більше про авто');
    eq(hf.history_records.accident_groups.length, 2, '4: різні зони суміжних років мали дати дві групи');
    const r = run({ accidentRecords: hf.history_records.accident_groups, hazardRecords: [] });
    eq(r.events.length, 2, '4: дві незалежні події площадки злилися');
    ok(r.items.some(i => i.key === 'accident_earlier_events'), '4: друга незалежна подія площадки не оштрафована');
  }

  /* ===== 5. страховий запис кріпиться лише за доказом звʼязку ===== */
  {
    const same = run({ auctionMeta: lot(), historicalVisual: hv(), accidentRecords: facts(HIST).history_records.accident_groups, hazardRecords: [], evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(same.events.length, 1, '5: страховий запис того самого блоку історії не прикріпився до події з записом площадки');
    ok(same.events[0].merge_basis.includes('insurance_record_attached'), '5: підстава прикріплення');
    const apart = run({ auctionMeta: lot(), historicalVisual: hv(), evidence: { ...baseEv, insurance_case_recorded: true } });
    eq(apart.events.length, 2, '5: страховий запис без звʼязку з лотом злився з лотом');
    ok(apart.events.some(e => e.normalized_event_id === 'insurance:record'), '5: окрема подія страхового запису');
  }

  /* ===== 6/7. лізинг і наступна зміна власника ===== */
  {
    const REG = '4-ий власник 01.06.24 Перереєстрація ТЗ на нов. власн. по договору укладеному в ТСЦ 31.05.24 Продавалось на AUTO.RIA Продавець вказав пробіг 27 тис. км '
      + '3-ій власник 31.05.23 Перереєстрація ТЗ на нов. власн. по договору укладеному в ТСЦ 23.05.23 Продавалось на AUTO.RIA Продавець вказав пробіг 17 тис. км '
      + '2-ий власник 13.04.23 Перереєстрація ТЗ за договором фінансового лізингу та ДКП предмета лізингу '
      + '1-ий власник 25.06.21 Первинна реєстрація нового ТЗ придбаного в торговельній організації, який ввезено з-за кордону';
    const evs = parseOwnerEvents(REG);
    eq(evs.map(e => e.ordinal).join(','), '1,2,3,4', '6: порядок подій реєстру');
    eq(evs[1].operation, 'lease_registration', '6: лізингова подія не розпізнана як окремий тип');
    eq(classifyOwnerOperation('Перереєстрація ТЗ за договором фінансового лізингу та ДКП предмета лізингу'), 'lease_registration', '6: класифікатор лізингу');
    eq(evs[2].operation, 'owner_reregistration', '7: наступна реальна зміна власника втратила тип');
    const hf = facts(REG);
    eq(hf.owners_count, 4, '6: число власників з реєстру');
    eq(hf.registry_present, true, '8: структуровані рядки власників не дали registry_present');
    /* модель написала лише 1-го і лізинг; 3-й і 4-й додаються з реєстру, лізинговий рядок лишається лізингом */
    const history = [
      { date: '06.2021', event: 'Первинна реєстрація нового автомобіля.', gap: null },
      { date: '04.2023', event: 'Переоформлення після фінансового лізингу та договору купівлі-продажу.', gap: '1 рік 10 місяців' },
      { date: '05.2023', event: 'Минуле оголошення, пробіг 17 000 км.', gap: '1 місяць' },
      { date: '10.2026', event: 'Поточне оголошення, пробіг 46 000 км.', gap: '3 роки' },
    ];
    let rows = annotateOwnerOrdinals(history, hf); rows = describeOwnerEvents(rows, hf, 'ua'); rows = addMissingOwnerEvents(rows, hf, 'ua');
    const ords = rows.filter(h => h.owner_ordinal).map(h => h.owner_ordinal + '@' + h.date);
    eq(ords.join(','), '1@06.2021,2@04.2023,3@05.2023,4@06.2024', '6/7: хронологія власників: ' + ords.join(','));
    const lease = rows.find(h => h.owner_ordinal === 2);
    ok(/лізинг/i.test(lease.event), '6: лізинговий рядок втратив лізинг: ' + lease.event);
    const third = rows.find(h => h.owner_ordinal === 3);
    eq(third.event_source, 'registry_operation', '7: наступна зміна власника не додана з реєстру');
    ok(/нового власника/i.test(third.event) && !/лізинг/i.test(third.event), '7: текст доданої події: ' + third.event);
    /* лізинговий рядок, якого модель не написала, синтезується як лізинг, не як "новий власник" */
    const rows2 = addMissingOwnerEvents(annotateOwnerOrdinals([{ date: '06.2021', event: 'Первинна реєстрація.', gap: null }], hf), hf, 'ua');
    ok(/лізинг/i.test(rows2.find(h => h.owner_ordinal === 2).event), '6: синтезований лізинговий рядок названо зміною власника');
  }

  /* ===== 8. факт реєстру ніколи не стає словами продавця ===== */
  {
    const t = 'Пробіг від продавця 252 тис.км ДТП Немає офіційно зареєстрованих Страхові випадки в Україні Виявлено Дивитися деталі Історія авто за VIN-кодом 05.10.26 Продається на AUTO.RIA Продавець вказав пробіг 252 тис. км '
      + '28.08.26 Зафіксовано пробіг 247 тис. км Джерело фіксації ' + DASH + ' дилерське СТО 1-ий власник 31.03.07 Реєстрацiя ТЗ привезеного з-за кордону Дізнайтесь більше про авто';
    const hf = facts(t);
    eq(hf.registry_present, true, '8: сторінка без підпису про офіційні дані, але з рядком власника реєстру: registry_present');
    eq(hf.owners_count, 1, '8: один власник з реєстру');
    eq(hf.insurance_case_recorded, true, '8: страховий випадок');
    const ctx = buildConclusionContext({ _meta: { history_facts: hf, seller_text: 'ОДИН ГОСПОДАР З 2007 РОКУ' }, vehicle: {}, score_breakdown: { vehicle_owners: { owners_count: 1, status: 'clean' }, events: [] }, history: [{ date: '03.2007', event: 'Перша реєстрація.', owner_ordinal: 1, owner_ordinal_source: 'registry' }, { date: '10.2026', event: 'Поточне оголошення.' }] });
    eq(ctx.ownership.owners_count, 1, '8: число власників у контексті висновку');
    eq(ctx.ownership.owners_count_source, 'registry', '8: походження числа власників не реєстр');
    eq(ctx.ownership.registry_data_present, true, '8: реєстр у контексті висновку позначений відсутнім');
    eq(ctx.history.timeline[0].source, 'registry', '8: рядок реєстру без походження');
    eq(ctx.history.timeline[1].source, 'report', '8: рядок моделі позначений як реєстр');
    const noReg = buildConclusionContext({ _meta: { history_facts: { registry_present: false } }, vehicle: {}, score_breakdown: { events: [] }, history: [] });
    ok(noReg.ownership.owners_count_source == null, '8: без числа власників походження не вигадується');
  }

  /* ===== 9. дата кадру окремо від дати ДТП/продажу ===== */
  {
    const r = run({ auctionMeta: lot({ sale_date: '2021-02-15' }), historicalVisual: hv(), accidentRecords: facts(HIST).history_records.accident_groups, hazardRecords: [] });
    eq(r.events[0].trusted_year, 2021, '9: рік продажу лота'); eq(r.events[0].year_source, 'auction_sale_date', '9: походження року з дати продажу');
    const r2 = run({ findings: [F('MAJOR_REPAIR_UNVERIFIED', 'accident_2020', [E('us_auction', 'auction_photo_3', 'на кадрі штамп 03.2025, пошкодження лівих дверей')])] });
    eq(r2.events[0].trusted_year, null, '9: рік зі штампа на фото став надійним роком');
    eq(r2.events[0].resolver_year, 2020, '9: рік з імені події');
    eq(r2.events[0].year_source, 'finding_text', '9: походження року зі знахідки');
    /* точка одометра з архіву аукціону лишається точкою одометра зі своїм походженням, не датою ДТП */
    const hf = facts(HIST);
    const auc = hf.mileage_points.find(p => p.km === 11000);
    eq(auc && auc.source, 'auction_archive', '9: точка архіву аукціону підписана не як архів');
    eq(auc && auc.date, '2021-02-15', '9: дата фіксації одометра');
    ok(!hf.mileage_points.some(p => p.source === 'registry'), '9: архівна точка все ще реєстр');
    const dl = facts('Історія авто за VIN-кодом 05.06.25 Зафіксовано пробіг 26 тис. км розбіжність 1 тис. км Джерело фіксації ' + DASH + ' дилерське СТО 02.03.21 Зафіксовано пробіг 1 тис. км Джерело фіксації ' + DASH + ' дилерське СТО Дізнайтесь більше');
    eq(dl.mileage_points.map(p => p.source).join(','), 'dealer_service,dealer_service', '9: дилерські точки підписані як дилерське СТО');
    eq(facts('Історія авто за VIN-кодом 15.02.21 Зафіксовано пробіг 11 тис. км 1-ий власник 09.07.21 Реєстрація ТЗ Дізнайтесь').mileage_points[0].source, 'registry', '9: точка без підпису джерела лишається реєстром');
    eq(classifyFixationSource('Аукціон IAAI'), 'auction_archive', '9: класифікатор джерела: аукціон'); eq(classifyFixationSource('Технічна перевірка'), 'inspection', '9: класифікатор джерела: перевірка');
  }

  /* ===== 10. невідома одиниця пробігу лишається невідомою ===== */
  {
    const r = run({ mileagePoints: [{ km: 1000, unit: 'unknown', status: 'unknown', date: '2025-03-12', source: 'auction', family: 'auction' }, { km: 95000, date: '2026-10-07', source: 'listing', family: 'current' }] });
    ok(!r.mileage_points.some(p => p.source === 'auction'), '10: точка з невідомою одиницею потрапила в нормалізовані точки');
    ok(!r.items.some(i => i.input === 'mileage_rollback'), '10: невідома одиниця дала відкат');
    const mi = run({ mileagePoints: [{ km: 1000, unit: 'mi', date: '2025-03-12', source: 'auction', family: 'auction' }] });
    eq(mi.mileage_points.find(p => p.source === 'auction').unit_raw, 'mi', '10: милі не стали км без позначки');
    ok(facts(HIST).mileage_points.every(p => !('unit' in p) || p.unit === undefined), '10: парсер площадки не вигадує одиницю (км як надруковано, без перерахунку)');
    eq(facts(HIST).history_records.accidents.length, 2, '10: записи ДТП не залежать від одиниць');
    ok(!/km_converted|\* ?1\.609/.test(fs.readFileSync('api/history-records.js', 'utf8')), '10: у парсері записів зʼявився перерахунок одиниць');
  }

  /* ===== 11. повінь за тими самими правилами ідентичності ===== */
  {
    const t = 'Страхові випадки в Україні Не виявлено Страхові випадки за кордоном Виявлено • на території США в 2022 році постраждав в результаті повені/затоплення Виявлено • на території США в 2026 році постраждав в результаті повені/затоплення Виявлено • на території США в 2026 році постраждав у повені/затопленні '
      + 'Історія авто за VIN-кодом 21.04.26 Зафіксовано пробіг 44 тис. км Джерело фіксації ' + DASH + ' архівні дані з офіційного аукціону Copart в США 2026 рік Зафіксовано ДТП ДТП на території США в 2026 році постраждав у повені/затопленні Дізнайтесь більше про авто';
    const hf = facts(t);
    eq(hf.history_records.accident_groups.length, 0, '11: запис ДТП з причиною повінь став групою ДТП');
    eq(hf.history_records.hazards.length, 4, '11: небезпеки: запис ДТП-повінь + 3 страхові записи');
    eq(hf.history_records.insurance.filter(i => i.scope === 'abroad').length, 3, '11: страхові записи за кордоном');
    eq(recordCause('постраждав у повені/затопленні'), 'flood', '11: причина повінь');
    const r = run({ auctionMeta: lot({ lot_id: '49464576', house: 'COPART' }), accidentRecords: hf.history_records.accident_groups, hazardRecords: hf.history_records.hazards, evidence: { ...baseEv, auction_record_exists: true } });
    ok(!r.items.some(i => String(i.key).startsWith('accident_latest_')), '11: лот із повінню оштрафований як ДТП невідомої тяжкості');
    const flood = r.items.find(i => i.key === 'flood_event');
    ok(flood && flood.amount === C4.ACCIDENT.flood, '11: повінь не оштрафована один раз');
    ok(/platform_record/.test(flood.params.sources), '11: джерело повені з записів площадки не позначене');
    eq(r.items.filter(i => i.key === 'flood_event').length, 1, '11: кілька записів про повінь дали кілька штрафів');
    /* три записи це не три повені: кількість записів не рахується */
    const fl = run({ findings: [F('FLOOD', 'flood_2022', [E('historical_listing', 'ins', 'повінь 2022')]), F('FLOOD', 'flood_2026', [E('historical_listing', 'ins', 'повінь 2026')])], hazardRecords: hf.history_records.hazards });
    eq(fl.items.filter(i => i.key === 'flood_event').length, 1, '11: записи різних років дали окремі штрафи за повінь');
    eq(sum(fl), C4.ACCIDENT.flood, '11: сума за повінь');
  }

  /* ===== без країн у правилах ідентичності ===== */
  {
    const code = f => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of ['api/history-records.js']) ok(!/\b(UA|US|USA)\b|\.country\b|Ukraine|Україн[аи]\b/.test(code(f).replace(/в Україні\|в Украине\|за кордоном\|за рубежом/g, '')), f + ': правило залежить від країни');
    ok(!/listing\.country|\.country ===/.test(code('api/score-v3.js').slice(code('api/score-v3.js').indexOf('function resolveAccidentEvents'))), 'резолвер залежить від країни');
    ok(!fs.readFileSync('api/history-records.js', 'utf8').includes(DASH) && !fs.readFileSync('eventidentitytest.js', 'utf8').includes(DASH), 'довге тире у файлах');
  }

  if (errs.length) { console.error('EVENT IDENTITY TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
  console.log('event identity: лот + кадри + запис = одна подія · схожий текст не зливає · неоднозначний дублікат без другого ДТП · незалежні події окремо · страховий лише за доказом · лізинг і наступний власник · реєстр не слова продавця · дата кадру окремо · одиниця невідома лишається · повінь за тими ж правилами');
})();
