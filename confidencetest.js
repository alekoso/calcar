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
    v4: { mileage_points: [{ date: '2020-03-01', families: ['platform_history'] }, { date: '2022-04-01', families: ['platform_history'] }, { date: '2024-01-10', families: ['vehicle_memory'] },
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
  const r4 = run({ auctionSearch: { status: 'unknown', reason: 'source_unreachable' }, auctionRecordExists: false, hvPresent: false, listing: { vin: VIN, country: null, make: 'BMW', odometer_km: 150000, listing_equipment: ['x'] }, hf: {} });
  ok(r4.overall_internal <= 69, 'blocked history capped at 69: ' + r4.overall_internal);
  ok(r4.caps_applied.some(c => c.name === 'history_checks_blocked'), 'history blocked cap recorded');
  /* порожня web-видача при успішному пошуку кап НЕ вмикає */
  const r4b = run({ auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false, listing: { vin: VIN, country: null, make: 'BMW', odometer_km: 150000, listing_equipment: ['x'] }, hf: {} });
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
  const r9 = run({ auctionSearch: { status: 'absent' }, auctionRecordExists: false, hvPresent: false });
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
