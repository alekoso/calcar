/* Повнота перевірки (Confidence v1): формула, стани джерел, капи,
   перенормування, детермінізм і незалежність від Score v4. */
const fs = require('fs');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };
const eq = (a, b, m) => { if (a !== b) errs.push(m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };

(async () => {
  const C = await import('./api/confidence.js');
  const V4 = await import('./api/score-v4.js');
  const { buildConfidenceInput: build, computeConfidenceV1: conf, CONFIDENCE_CONFIG_V1: CFG } = C;
  const NOW = '2026-09-25T12:00:00.000Z';
  const VIN = 'WBAJE7C34HG887901';
  const zones = (ext, int, dash) => {
    const z = {};
    ['front', 'rear', 'left_front', 'left_side', 'left_rear', 'right_front', 'right_side', 'right_rear', 'roof', 'wheels', 'engine_bay', 'underbody']
      .forEach((k, i) => { z[k] = { visibility: i < ext ? 'sufficient' : 'not_visible' }; });
    ['driver_area', 'front_seats', 'rear_seats', 'center_console', 'front_passenger', 'doors', 'trunk']
      .forEach((k, i) => { z[k] = { visibility: i < int ? 'sufficient' : 'not_visible' }; });
    z.dashboard = { visibility: dash ? 'sufficient' : 'not_visible' };
    return z;
  };
  const rich = (o = {}) => ({
    now: NOW,
    listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 150000, listing_equipment: ['Панорама', 'HUD'] },
    hf: { registry_present: true, past_listings: 2, owner_events: [{ ordinal: 1, date: '2016-08-01' }, { ordinal: 2, date: '2020-03-01' }],
      mileage_points: [{ date: '2020-03-01', km: 70000, source: 'registry' }] },
    nhtsa: { Make: 'BMW', Model: '5-Series', ModelYear: '2017', FuelTypePrimary: 'Gasoline', DisplacementL: '3.0' },
    auctionSearch: { status: 'found', sale_date: '2019-05-01' },
    auctionRecordExists: true, hvPresent: true,
    snaps: [{ created_at: '2024-01-10T00:00:00Z', odometer_km: 120000 }], snapsLookup: 'ok',
    cv: { zones: zones(8, 3, true), dashboard: { visible: true, odometer_reading: { value: 150200, unit: 'km' } } }, cvStatus: 'ok',
    /* зріле авто (110 міс, 150 тис. км): чотири датовані точки з минулого покривають очікування v2 */
    v4: { mileage_points: [{ date: '2018-06-01', families: ['platform_history'] }, { date: '2020-03-01', families: ['platform_history'] }, { date: '2022-04-01', families: ['platform_history'] }, { date: '2024-01-10', families: ['vehicle_memory'] },
      { date: '2026-09-25', families: ['current', 'dashboard'] }], vin_check: { mismatch: false } },
    ageMonths: 110, photosCount: 25, disclosuresCount: 0,
    ...o,
  });
  const run = o => conf(build(rich(o)));
  const dom = (r, d) => r.domains[d];
  const input = (r, d, k) => dom(r, d).inputs.find(i => i.key === k);

  /* 1. багате покриття -> >= 85 */
  const r1 = run();
  ok(r1.overall_internal >= 85, 'rich coverage >= 85: ' + r1.overall_internal);
  eq(r1.text_key, 'Studied in detail', 'rich text key');
  eq(r1.caps_applied.filter(c => c.binding).length, 0, 'rich: no binding caps');

  /* 2. добре, але неповно -> близько або вище 70 */
  const r2 = run({ auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false, snaps: [], hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2022-01-01' }] },
    photosCount: 14, cv: { zones: zones(5, 2, false), dashboard: { visible: false } }, v4: { mileage_points: [{ date: '2022-01-01', families: ['platform_history'] }, { date: '2026-09-25', families: ['current'] }], vin_check: {} } });
  ok(r2.overall_internal >= 62 && r2.overall_internal < 85, 'good but incomplete near/above 70: ' + r2.overall_internal);

  /* 3. 3 фото при іншому доброму -> кап 69 */
  const r3 = run({ photosCount: 3 });
  ok(r3.overall_internal <= 69, '3 photos capped at 69: ' + r3.overall_internal);
  ok(r3.caps_applied.some(c => c.name === 'few_usable_photos' && c.binding), 'few photos cap recorded');

  /* 4. історію фактично не вдалося перевірити -> кап 69 */
  /* аукціон застосовний лише при відомому іноземному періоді (тут: позначка площадки про імпорт) */
  const r4 = run({ auctionSearch: { status: 'unknown', reason: 'source_unreachable' }, auctionRecordExists: false, hvPresent: false, listing: { vin: VIN, country: null, make: 'BMW', odometer_km: 150000, listing_equipment: ['x'] }, hf: { us_import_record: true } });
  ok(r4.overall_internal <= 69, 'blocked history capped at 69: ' + r4.overall_internal);
  ok(r4.caps_applied.some(c => c.name === 'history_checks_blocked'), 'history blocked cap recorded');
  /* порожня web-видача при успішному пошуку кап НЕ вмикає */
  const r4b = run({ auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false, listing: { vin: VIN, country: null, make: 'BMW', odometer_km: 150000, listing_equipment: ['x'] }, hf: { us_import_record: true } });
  ok(!r4b.caps_applied.some(c => c.name === 'history_checks_blocked'), 'searched_no_result must not trigger history cap');

  /* 5. VIN відсутній -> <= 39 */
  const r5 = run({ listing: { vin: null, country: 'UA', make: 'BMW', odometer_km: 150000, listing_equipment: ['x'] } });
  ok(r5.overall_internal <= 39, 'VIN absent <= 39: ' + r5.overall_internal);
  /* без VIN бал за авто рахується (див. scorev4test), але впевненість низька,
     а історія лишається НЕПІДТВЕРДЖЕНОЮ: жодних балів за "чисту історію" */
  const rAudi = run({
    listing: { vin: null, country: 'UA', make: 'Audi', model: 'A5', odometer_km: 60000, listing_equipment: ['x'] },
    photosCount: 24, hf: { registry_present: false, past_listings: 0 }, nhtsa: null,
    auctionSearch: null, auctionRecordExists: false, hvPresent: false,
    snaps: [], v4: { mileage_points: [{ date: '2026-09-25', families: ['current'] }], vin_check: { mismatch: false } },
  });
  ok(rAudi.overall_internal <= 39, 'Audi без VIN: впевненість мала лишитись низькою: ' + rAudi.overall_internal);
  ok(rAudi.domains.history.earned === 0, 'Audi без VIN: непідтверджена історія дала бали');
  ok(rAudi.domains.photos.earned > 0, 'Audi без VIN: кадри мали дати покриття');
  ok(rAudi.text_key === 'Data is limited', 'Audi без VIN: текст впевненості не про обмежені дані: ' + rAudi.text_key);

  /* 6. валідний європейський VIN і невдалий декод vPIC -> НЕ кап 39 */
  const r6 = run({ listing: { vin: 'WVWZZZ7MZ6V009287', country: 'UA', make: 'Volkswagen', odometer_km: 360000, listing_equipment: ['x'] }, nhtsa: null, hf: { registry_present: false, past_listings: 0 } });
  ok(r6.overall_internal > 39, 'EU VIN + failed decode must not cap 39: ' + r6.overall_internal);
  eq(input(r6, 'identity', 'vin_identity').earned, 4, 'valid undecoded VIN = 4/6');
  eq(input(r6, 'identity', 'make_model_consistency').earned, 2, 'decode failure is not a conflict (partial 2)');

  /* 7. надійно інший VIN -> <= 39 */
  const r7 = run({ v4: { mileage_points: [], vin_check: { mismatch: true } } });
  ok(r7.overall_internal <= 39, 'VIN mismatch <= 39: ' + r7.overall_internal);
  eq(input(r7, 'identity', 'vin_identity').earned, 0, 'mismatch VIN = 0');

  /* 8. структурований checked_absent отримує повний кредит */
  const r8 = run({ hf: { registry_present: false, registry_answered_empty: true }, snaps: [], snapsLookup: 'ok' });
  eq(input(r8, 'history', 'registry').state, 'checked_absent', 'registry checked_absent state');
  eq(input(r8, 'history', 'registry').earned, CFG.HISTORY.registry, 'registry checked_absent full credit');
  eq(input(r8, 'history', 'previous_listings').earned, CFG.HISTORY.previous_listings, 'Vehicle Memory checked_absent full credit');
  const r8b = run({ snaps: Object.assign([], { lookup_failed: true }), snapsLookup: 'failed', hf: { registry_present: true } });
  eq(input(r8b, 'history', 'previous_listings').earned, 0, 'lookup failed = 0');

  /* 9. Serper/web searched_no_result -> лише частковий кредит */
  const r9 = run({ auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false, hf: { ...rich().hf, foreign_lifecycle: { known: true, basis: ['registry_used_import'] } } });
  eq(input(r9, 'history', 'auction_history').state, 'searched_no_result', 'web no result state');
  eq(input(r9, 'history', 'auction_history').earned, CFG.HISTORY.auction / 2, 'web no result = 50%');

  /* 10. not_applicable вхід прибраний зі знаменника */
  eq(input(r9, 'history', 'historical_photos').state, 'not_applicable', 'no event -> historical photos not applicable');
  eq(dom(r9, 'history').applicable_max, 35 - 7, 'history denominator without historical photos');
  const r10 = run({ listing: { vin: VIN, country: null, make: 'BMW', odometer_km: 150000, listing_equipment: ['x'] } });
  eq(input(r10, 'history', 'registry').state, 'not_applicable', 'non-UA registry not applicable');
  eq(dom(r10, 'history').applicable_max, 35 - 7, 'registry removed from denominator');
  const withEvent = run({ hvPresent: false });
  eq(input(withEvent, 'history', 'historical_photos').earned, 0, 'event found, photos unavailable = 0');

  /* 11. домен цілком not_applicable -> виключений, ваги перенормовані */
  const inp11 = build(rich());
  const r11a = conf(inp11);
  const cfg11 = { ...CFG, HISTORY: { ...CFG.HISTORY } };
  const forced = JSON.parse(JSON.stringify(inp11));
  const r11 = (() => {
    /* домен історії штучно not_applicable через підмінений результат доменів */
    const full = conf(forced);
    const d = full.domains;
    const w = CFG.DOMAIN_WEIGHTS;
    const expected = Math.round((d.photos.score_internal * w.photos + d.mileage.score_internal * w.mileage + d.identity.score_internal * w.identity) / (w.photos + w.mileage + w.identity));
    return { expected };
  })();
  /* пряма перевірка механізму: вхід без жодного applicable входу в домені */
  const naInput = JSON.parse(JSON.stringify(inp11));
  const fakeCfg = { ...CFG, HISTORY: { ...CFG.HISTORY, auction: 0, historical_photos: 0, registry: 0, previous_listings: 0, span: 0 } };
  const r11b = conf(naInput, fakeCfg);
  eq(r11b.domains.history.status, 'not_applicable', 'zero-max domain treated as not applicable');
  eq(r11b.overall_internal, r11.expected, 'weights renormalized without history');
  ok(r11a.overall_internal !== null, 'normal overall exists');
  const none = conf({ now: NOW, history: {}, photos: {}, mileage: {}, identity: {} }, { ...CFG, HISTORY: fakeCfg.HISTORY, PHOTOS: { ...CFG.PHOTOS, count: 0, zones: 0, interior: 0, dashboard: 0 }, MILEAGE: { ...CFG.MILEAGE, age: 0, odometer: 0, points: 0, dashboard: 0, families: 0 }, IDENTITY: { ...CFG.IDENTITY, vin: 0, consistency: 0, config: 0, listing: 0 } });
  eq(none.overall_internal, null, 'no applicable domains -> unavailable'); eq(none.unavailable_reason, 'no_applicable_domains', 'unavailable reason');

  /* 12. дата з тексту продавця не подовжує охоплення історії */
  const baseSpan = input(run({ hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2023-01-01' }] }, auctionSearch: { status: 'absent' }, auctionRecordExists: false, snaps: [] }), 'history', 'history_span').earned;
  const sellerSpan = input(run({ hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2023-01-01' }], seller_text: 'Куплена новою у 2016 році у дилера' }, auctionSearch: { status: 'absent' }, auctionRecordExists: false, snaps: [] }), 'history', 'history_span').earned;
  eq(sellerSpan, baseSpan, 'seller text date must not extend span');
  ok(baseSpan > 0 && baseSpan < CFG.HISTORY.span, 'partial span from registry only: ' + baseSpan);

  /* 12a. історія це критичний вхід: стеля росте з балом історії */
  {
    const noHist = { auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false, snaps: [], ageMonths: 135 };
    const weak = run({ ...noHist, hf: {} });
    eq(dom(weak, 'identity').score_internal, 100, 'weak history fixture keeps identity complete');
    ok(dom(weak, 'photos').score_internal === 100 && dom(weak, 'mileage').score_internal === 100, 'weak history fixture keeps photos and mileage complete');
    ok(weak.overall_internal < CFG.SUFFICIENT_TICK && weak.text_key === 'Partially checked', 'complete identity + weak history stays below the sufficient tick: ' + weak.overall_internal);
    ok(weak.caps_applied.some(c => c.name === 'weak_history' && c.binding), 'weak history cap recorded as binding');
    /* кількість полів без охоплення в часі не робить історію вивченою */
    const fields = run({ ...noHist, hf: { registry_present: true, past_listings: 3, owner_events: [{ ordinal: 1, date: '2026-08-01' }, { ordinal: 2, date: '2026-08-10' }, { ordinal: 3, date: '2026-08-20' }] } });
    eq(input(fields, 'history', 'history_span').earned, 0, 'recent records only: zero history span');
    /* 2026-10-08: для локального авто аукціон не застосовний, тож історія без охоплення в часі
       дає ~60, кап weak_history тримає підсумок нижче "вивчено детально" і є звʼязувальним */
    ok(fields.overall_internal < 85 && fields.caps_applied.some(c => c.name === 'weak_history' && c.binding), 'many recent fields without coverage reach "Studied in detail": ' + fields.overall_internal);
    /* щільність: один давній запис на одинадцять років гірший за записи в різні роки */
    const one = input(run({ ...noHist, hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2016-08-01' }] } }), 'history', 'history_span').earned;
    const many = input(run({ ...noHist, hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2016-08-01' }, { ordinal: 2, date: '2018-05-01' }, { ordinal: 3, date: '2020-03-01' }, { ordinal: 4, date: '2022-06-01' }, { ordinal: 5, date: '2024-02-01' }] } }), 'history', 'history_span').earned;
    ok(one > 0 && many > one, 'span rewards records spread over the years: ' + one + ' < ' + many);
    /* середня історія: "достатньо" досяжне, "вивчено детально" ні */
    const mid = run({ auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false, snaps: [] });
    const hMid = dom(mid, 'history').score_internal;
    /* кап weak_history лише трохи послаблений для зрілого авто (110 міс.): підсумок не вище формули */
    const capMid = Math.round(100 - (100 - (CFG.CAPS.weak_history.base + CFG.CAPS.weak_history.slope * hMid)) * (1 - Math.pow(1 - mid.lifecycle.e_age, 2)));
    ok(hMid >= 59 && hMid < 85 ? (mid.overall_internal >= 70 && mid.overall_internal <= capMid && mid.overall_internal < 90) : true, 'mid history lands near "Enough data": history ' + hMid + ', overall ' + mid.overall_internal + ', cap ' + capMid);
    /* застосовність аукціону: локальне авто без іноземного періоду не має аукціонного джерела у знаменнику;
       заблокований пошук для нього нічого не знижує; для авто з іноземним періодом той самий блок знижує */
    const localBlocked = run({ ...noHist, auctionSearch: { status: 'unknown' }, hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2016-08-01' }] } });
    const localAbsent = run({ ...noHist, auctionSearch: { status: 'absent' }, hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2016-08-01' }] } });
    eq(input(localBlocked, 'history', 'auction_history').state, 'not_applicable', 'local car: auction not applicable'); eq(input(localBlocked, 'history', 'auction_history').max, 0, 'local car: auction out of denominator');
    eq(localBlocked.overall_internal, localAbsent.overall_internal, 'local car: blocked vs empty web search must be identical');
    ok(!localBlocked.caps_applied.some(c => c.name === 'history_checks_blocked'), 'local car: blocked cap applied without applicability');
    eq(localBlocked.lifecycle.auction_applicable, false, 'local car: applicability flag'); eq(localBlocked.lifecycle.foreign_lifecycle_known, false, 'local car: foreign flag');
    const importBlocked = run({ ...noHist, auctionSearch: { status: 'unknown' }, hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2016-08-01' }], foreign_lifecycle: { known: true, basis: ['registry_used_import'] } } });
    const importAbsent = run({ ...noHist, auctionSearch: { status: 'absent' }, hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2016-08-01' }], foreign_lifecycle: { known: true, basis: ['registry_used_import'] } } });
    eq(input(importBlocked, 'history', 'auction_history').state, 'blocked', 'import: blocked state'); eq(input(importAbsent, 'history', 'auction_history').state, 'searched_no_result', 'import: searched state');
    ok(importBlocked.overall_internal < importAbsent.overall_internal && importAbsent.overall_internal < localAbsent.overall_internal, 'import: blocked < searched < local n/a: ' + importBlocked.overall_internal + ' ' + importAbsent.overall_internal + ' ' + localAbsent.overall_internal);
    eq(importBlocked.lifecycle.auction_applicable, true, 'import: applicability flag');
    /* регіон VIN не створює застосовності: північноамериканський VIN без доказів іноземного періоду = n/a */
    const naVin = run({ ...noHist, auctionSearch: { status: 'unknown' }, listing: { vin: '1FA6P8TH5H5300000', country: 'UA', make: 'Ford', odometer_km: 50000, listing_equipment: [] }, hf: { registry_present: true, owner_events: [{ ordinal: 1, date: '2020-08-01' }] } });
    eq(input(naVin, 'history', 'auction_history').state, 'not_applicable', 'VIN region alone must not create auction applicability');
    /* кап weak_history залежить від віку: та сама слабка історія, молоде авто капиться мʼякше за зріле */
    const capOf = r => { const c = r.caps_applied.find(x => x.name === 'weak_history'); return c ? c.max : null; };
    const weakYoung = run({ ...noHist, ageMonths: 8, hf: { registry_present: true, owner_events: [] } }), weakOld = run({ ...noHist, ageMonths: 150, hf: { registry_present: true, owner_events: [] } });
    ok(capOf(weakYoung) !== null && capOf(weakOld) !== null && capOf(weakYoung) > capOf(weakOld) + 10, 'weak history cap must relax for a young car: ' + capOf(weakYoung) + ' vs ' + capOf(weakOld));
    const full = CFG.CAPS.weak_history.base + CFG.CAPS.weak_history.slope * dom(weakOld, 'history').score_internal;
    ok(capOf(weakOld) <= Math.round(full) + 3, 'mature car cap must stay close to the strict formula: ' + capOf(weakOld) + ' vs ' + full);
    /* обидва крайні стани досяжні */
    eq(r1.text_key, 'Studied in detail', 'top state reachable');
    const low = run({ ...noHist, hf: {}, photosCount: 4, cv: { zones: zones(2, 0, false), dashboard: { visible: false } }, v4: { mileage_points: [{ date: '2026-09-25', families: ['current'] }], vin_check: {} }, nhtsa: null,
      listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 150000 } });
    ok(low.overall_internal < 40 && low.text_key === 'Data is limited', 'lowest state reachable: ' + low.overall_internal);
    eq(CFG.CAPS.weak_history.base + CFG.CAPS.weak_history.slope * 50 < CFG.SUFFICIENT_TICK, true, 'history below 50 always under the sufficient tick');
    const page = fs.readFileSync('result-check.html', 'utf8');
    ok(/'Vehicle identification'/.test(page) && !/'Car data'/.test(page), 'domain label renamed to Vehicle identification');
  }

  /* 12b. lifecycle-aware (coverage-v2): очікування доказів росте з віком і пробігом плавно */
  {
    const { lifecycleExposure } = C;
    const L = CFG.LIFECYCLE;
    eq(CFG.VERSION, 'v2', 'confidence version v2'); ok(/coverage-v2-/.test(CFG.CONFIG_TAG), 'config tag v2');
    const young = lifecycleExposure({ age_months: 6, odometer_km: 4000 }), mature = lifecycleExposure({ age_months: 150, odometer_km: 160000 });
    ok(young.exposure < 0.2 && mature.exposure > 0.9, 'exposure: young ' + young.exposure + ', mature ' + mature.exposure);
    ok(young.expected_points < 0.2 && mature.expected_points > 3, 'expected points: young ' + young.expected_points + ', mature ' + mature.expected_points);
    eq(lifecycleExposure({}).exposure, 0.5, 'unknown age and mileage: middle exposure, not zero');
    /* монотонно і без сходинок: по місяцях і по кілометрах */
    let prev = lifecycleExposure({ age_months: 0, odometer_km: 50000 }).exposure;
    for (let m = 1; m <= 240; m++) { const e = lifecycleExposure({ age_months: m, odometer_km: 50000 }).exposure; ok(e >= prev - 1e-9 && e - prev < 0.02, 'exposure jumps at month ' + m); prev = e; }
    prev = lifecycleExposure({ age_months: 60, odometer_km: 0 }).exposure;
    for (let km = 5000; km <= 400000; km += 5000) { const e = lifecycleExposure({ age_months: 60, odometer_km: km }).exposure; ok(e >= prev - 1e-9 && e - prev < 0.05, 'exposure jumps at km ' + km); prev = e; }
    /* молоде авто без історичних точок: майже повний кредит точок; зріле з тими самими входами: нуль */
    const noPts = { v4: { mileage_points: [{ date: '2026-09-25', families: ['current'] }], vin_check: { mismatch: false } }, hf: { registry_present: true, past_listings: 0, owner_events: [{ ordinal: 1, date: '2026-02-01' }], mileage_points: [] }, snaps: [] };
    const y = run({ ...noPts, ageMonths: 8, listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 6000, listing_equipment: ['HUD'] } });
    const o = run({ ...noPts, ageMonths: 150, listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 160000, listing_equipment: ['HUD'] } });
    ok(input(y, 'mileage', 'historical_points').earned >= 0.7 * CFG.MILEAGE.points, 'young car without past points keeps most of the points credit: ' + input(y, 'mileage', 'historical_points').earned);
    /* кредит = 1 - нестача / 4: зріле авто без точок має майже нуль (очікування ~3.4..4 з 4) */
    ok(input(o, 'mileage', 'historical_points').earned <= 0.1 * CFG.MILEAGE.points, 'mature car without past points keeps points credit: ' + input(o, 'mileage', 'historical_points').earned);
    ok(dom(y, 'mileage').score_internal > dom(o, 'mileage').score_internal + 15, 'same absence, different lifecycle: ' + dom(y, 'mileage').score_internal + ' vs ' + dom(o, 'mileage').score_internal);
    ok(y.lifecycle && y.lifecycle.exposure < o.lifecycle.exposure, 'lifecycle block stored in the snapshot');
    /* охоплення історії: один запис пів року тому покриває очікування молодого авто, не старого */
    ok(input(y, 'history', 'history_span').earned > input(o, 'history', 'history_span').earned + 4, 'span expectation scales with age: ' + input(y, 'history', 'history_span').earned + ' vs ' + input(o, 'history', 'history_span').earned);
    /* старе авто з багатою історією відновлює повний кредит */
    const rich = run({ ageMonths: 150, listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 160000, listing_equipment: ['HUD'] },
      hf: { registry_present: true, past_listings: 3, owner_events: [{ ordinal: 1, date: '2014-06-01' }, { ordinal: 2, date: '2018-05-01' }, { ordinal: 3, date: '2022-03-01' }], mileage_points: [{ date: '2016-03-01', km: 30000, source: 'registry' }, { date: '2020-03-01', km: 90000, source: 'registry' }, { date: '2024-01-10', km: 140000, source: 'dealer_service' }] },
      v4: { mileage_points: [{ date: '2016-03-01', families: ['platform_history'] }, { date: '2018-05-01', families: ['platform_history'] }, { date: '2020-03-01', families: ['platform_history'] }, { date: '2022-03-01', families: ['platform_history'] }, { date: '2024-01-10', families: ['platform_history'] }, { date: '2026-09-25', families: ['current', 'dashboard'] }], vin_check: { mismatch: false } } });
    eq(dom(rich, 'mileage').score_internal, 100, 'old car with full mileage chronology: complete mileage domain');
    ok(dom(rich, 'history').score_internal >= 90, 'old car with records through its life: history ' + dom(rich, 'history').score_internal);
    /* одна додаткова точка зсуває домен плавно, не стрибком */
    const one = run({ ...noPts, ageMonths: 150, listing: { vin: VIN, country: 'UA', make: 'BMW', odometer_km: 160000, listing_equipment: ['HUD'] }, v4: { mileage_points: [{ date: '2021-01-01', families: ['platform_history'] }, { date: '2026-09-25', families: ['current'] }], vin_check: { mismatch: false } } });
    const delta = dom(one, 'mileage').score_internal - dom(o, 'mileage').score_internal;
    /* точка з іншої родини джерел несе і кредит families (2 з 20): крок обмежений 20 */
    ok(delta > 0 && delta <= 20, 'one extra dated point moves the mileage domain by a bounded step: ' + delta);
    /* вік і пробіг ніколи не вхід Score v4: конфіг Confidence не читається v4 */
    ok(!/CONFIDENCE_CONFIG|lifecycleExposure/.test(fs.readFileSync('api/score-v4.js', 'utf8')), 'score-v4 reads Confidence lifecycle');
  }

  /* 13. Confidence не змінює Score v4: модуль v4 не залежить від confidence, і навпаки лише читає */
  const v4src = fs.readFileSync('api/score-v4.js', 'utf8');
  ok(!/confidence\.js|computeConfidence|overall_internal/.test(v4src), 'score-v4 must not depend on the coverage module');
  const confSrc = fs.readFileSync('api/confidence.js', 'utf8');
  ok(!/computeScoreV4|final\s*=|\.final\b/.test(confSrc), 'confidence must not compute or write Score');
  const checkSrc = fs.readFileSync('api/check.js', 'utf8');
  ok(/parsed\.confidence = computeConfidenceV1\(buildConfidenceInput\(/.test(checkSrc), 'check.js stores confidence snapshot');
  ok(!/confidence[^\n]{0,80}breakdown(V4)?\.final\s*=|final\s*=\s*[^\n]*confidence/i.test(checkSrc), 'check.js must not mix confidence into final');
  const shareSrc = fs.readFileSync('api/share.js', 'utf8');
  ok(/'confidence'/.test(shareSrc), 'public report keeps confidence snapshot');

  /* 14. ті самі входи -> побайтово стабільний результат */
  eq(JSON.stringify(run()), JSON.stringify(run()), 'deterministic byte-stable output');

  /* контракт знімка */
  for (const k of ['confidence_version', 'config_tag', 'overall_internal', 'text_key', 'domains', 'caps_applied', 'unavailable_reason']) ok(k in r1, 'snapshot field ' + k);
  for (const d of ['history', 'photos', 'mileage', 'identity']) for (const k of ['status', 'score_internal', 'earned', 'applicable_max', 'inputs']) ok(k in r1.domains[d], d + '.' + k);
  eq(r1.sufficient_tick, 70, 'sufficient tick 70');
  eq(CFG.DOMAIN_WEIGHTS.history + CFG.DOMAIN_WEIGHTS.photos + CFG.DOMAIN_WEIGHTS.mileage + CFG.DOMAIN_WEIGHTS.identity, 100, 'weights sum 100');
  eq(CFG.HISTORY.auction + CFG.HISTORY.historical_photos + CFG.HISTORY.registry + CFG.HISTORY.previous_listings + CFG.HISTORY.span, 35, 'history inputs sum 35');
  eq(CFG.PHOTOS.count + CFG.PHOTOS.zones + CFG.PHOTOS.interior + CFG.PHOTOS.dashboard, 30, 'photos inputs sum 30');
  eq(CFG.MILEAGE.age + CFG.MILEAGE.odometer + CFG.MILEAGE.points + CFG.MILEAGE.dashboard + CFG.MILEAGE.families, 20, 'mileage inputs sum 20');
  eq(CFG.IDENTITY.vin + CFG.IDENTITY.consistency + CFG.IDENTITY.config + CFG.IDENTITY.listing, 15, 'identity inputs sum 15');
  for (const [v, key] of [[39, 'Data is limited'], [40, 'Partially checked'], [69, 'Partially checked'], [70, 'Enough data'], [84, 'Enough data'], [85, 'Studied in detail']]) eq(C.textKeyFor(v), key, 'text range ' + v);
  ok(!V4.SCORE_CONFIG_V4.CONFIDENCE, 'Score v4 config untouched');

  if (errs.length) { console.error('CONFIDENCE TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
  console.log('confidence tests passed (rich ' + r1.overall_internal + ', incomplete ' + r2.overall_internal + ', 3 photos ' + r3.overall_internal + ', blocked ' + r4.overall_internal + ', no VIN ' + r5.overall_internal + ', EU undecoded ' + r6.overall_internal + ')');
})().catch(e => { console.error('CONFIDENCE TEST CRASHED:', e); process.exit(1); });
