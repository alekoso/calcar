/* CalCar Score v2: еталони детермінованої оцінки.
   Кожен кейс тримає діапазон або точну рівність, щоб калібрування констант
   було свідомим: змінив конфіг, перепровір еталони. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), 'calcar_scoretest.mjs');
fs.writeFileSync(tmp, fs.readFileSync('api/score.js', 'utf8'));

const errs = [];
const ev = (source, ref, description) => ({ source, ref, description });
const F = (type, event_id, extra) => ({ type, event_id, evidence: [ev('current_photos', 'photo_1', 'доказ')], ...extra });

/* повне покриття: всі джерела на місці */
const FULL = {
  vin_decoded: true, photos_count: 24,
  historical_listings_count: 4, mileage_observation_count: 4,
  auction_record_exists: true, auction_us_signal: true,
  registration_data_exists: true, service_history_exists: true,
  inspection_history_exists: true, seller_docs_exists: true,
};
/* лише VIN і фото: чиста офіційна машина без історії */
const VIN_PHOTOS = {
  vin_decoded: true, photos_count: 12,
  historical_listings_count: 0, mileage_observation_count: 0,
  auction_record_exists: false, auction_us_signal: false,
  registration_data_exists: false, service_history_exists: false,
  inspection_history_exists: false, seller_docs_exists: false,
};
/* німецька машина з повною європейською історією: запису нема, достовірного
   сигналу США теж, стан unknown без бонуса */
const GERMAN_FULL = { ...FULL, auction_record_exists: false, auction_us_signal: false };

(async () => {
  const { computeScore, gradeFromScore, SCORE_CONFIG } = await import('file://' + tmp);
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

  /* 1. чиста машина з багатою історією */
  let b = computeScore([], FULL);
  if (!(b.final >= 8.5)) errs.push('чиста машина з історією: ' + b.final + ' < 8.5');
  if (b.final !== b.coverage_cap) errs.push('чиста машина: підсумок не дорівнює стелі');

  /* 2. чиста офіційка лише VIN+фото: рівно стеля, обмежено покриттям */
  b = computeScore([], VIN_PHOTOS);
  if (b.final !== b.coverage_cap) errs.push('офіційка: підсумок ' + b.final + ' не дорівнює стелі ' + b.coverage_cap);
  if (!b.limiting_factors.includes('coverage')) errs.push('офіційка: coverage нема в limiting_factors');
  if (!b.score_limited_by_data) errs.push('офіційка: score_limited_by_data мав бути true');

  /* 3. німецька машина з повною ЄС-історією, аукціон not_applicable */
  b = computeScore([], GERMAN_FULL);
  if (!(b.final >= 8.5)) errs.push('німецька з ЄС-історією: ' + b.final + ' < 8.5');
  if (b.coverage.auction_record.state !== 'unknown') errs.push('німецька: аукціон без сигналу мав бути unknown, а не ' + b.coverage.auction_record.state);
  if (b.coverage.auction_record.bonus !== 0) errs.push('німецька: unknown аукціон дав бонус');
  /* явна застосовність за достовірними даними: not_applicable теж без бонуса */
  b = computeScore([], { ...GERMAN_FULL, auction_applicable: false });
  if (b.coverage.auction_record.state !== 'not_applicable') errs.push('явна незастосовність: стан ' + b.coverage.auction_record.state);
  if (b.coverage.auction_record.bonus !== 0) errs.push('not_applicable аукціон дав бонус');
  /* absent лише в парі: сигнал США І джерела реально відповіли */
  b = computeScore([], { ...GERMAN_FULL, auction_us_signal: true, auction_checked: true });
  if (b.coverage.auction_record.state !== 'checked_absent') errs.push('сигнал+опитані джерела: стан ' + b.coverage.auction_record.state);
  if (b.coverage.auction_record.bonus !== 0) errs.push('absent дав бонус');
  if (b.coverage.auction_record.note !== 'авто мало бути в аукціонних базах США, запис не знайдено') {
    errs.push('нема явного рядка про absent: ' + b.coverage.auction_record.note);
  }
  /* чесний продавець із заявою про пригін: НУЛЬ штрафу понад відсутність
     бонуса, підсумок рівно стеля */
  if (b.penalties.length !== 0) errs.push('absent породив штраф');
  if (b.final !== b.coverage_cap) errs.push('absent урізав понад відсутність бонуса: ' + b.final + ' проти стелі ' + b.coverage_cap);

  /* опитані без сигналу: unknown, не absent */
  b = computeScore([], { ...GERMAN_FULL, auction_checked: true });
  if (b.coverage.auction_record.state !== 'unknown') errs.push('опитані без сигналу: стан ' + b.coverage.auction_record.state);
  /* сигнал без відповіді джерел (source_unreachable): unknown, вини машини нема */
  b = computeScore([], { ...GERMAN_FULL, auction_us_signal: true });
  if (b.coverage.auction_record.state !== 'unknown') errs.push('сигнал без відповіді джерел: стан ' + b.coverage.auction_record.state);
  if (b.coverage.auction_record.note) errs.push('unknown отримав рядок absent');

  /* 3б. знахідка БЕЗ evidence на бал не впливає: у dropped, не в штрафи */
  b = quiet(() => computeScore([
    { type: 'STRUCTURAL_DAMAGE', event_id: 'acc1', repair_status: 'unknown' },
    { type: 'STRUCTURAL_DAMAGE', event_id: 'acc2', repair_status: 'unknown', evidence: [] },
    { type: 'FLOOD', event_id: 'f1', evidence: [{ source: 'us_auction', ref: 'x' }] },
    { type: 'MILEAGE_CONFLICT_UNEXPLAINED', event_id: 'm1', evidence: [{ source: 'вигаданий', description: 'текст' }] },
  ], FULL));
  if (b.penalties.length !== 0) errs.push('знахідки без валідного evidence оштрафували: ' + JSON.stringify(b.penalties.map(p => p.type)));
  if (b.dropped_findings !== 4) errs.push('без evidence: dropped ' + b.dropped_findings + ' замість 4');
  if (b.final !== b.coverage_cap) errs.push('без evidence: бал мав лишитись на стелі');

  /* 3д. visually_consistent: штраф мʼякший за unknown, але кап 5.5 НЕ знімається:
     фото не бачить геометрію, зварку і SRS */
  const vc = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'visually_consistent' })], VIN_PHOTOS);
  const unk = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'unknown' })], VIN_PHOTOS);
  if (vc.penalties[0].amount !== -1.4) errs.push('visually_consistent штраф ' + vc.penalties[0].amount + ' замість -1.4');
  if (unk.penalties[0].amount !== -2.0) errs.push('unknown штраф ' + unk.penalties[0].amount + ' замість -2.0');
  b = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'visually_consistent' })], FULL);
  if (!(b.final <= 5.5)) errs.push('visually_consistent обійшов структурний кап: ' + b.final);
  if (!b.limiting_factors.includes('hard_cap:STRUCTURAL_DAMAGE')) errs.push('visually_consistent: капа нема в обмежувачах');
  /* confirmed_ok кап знімає (обʼєктивні дані, не фото) */
  b = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'confirmed_ok' })], FULL);
  if (b.limiting_factors.includes('hard_cap:STRUCTURAL_DAMAGE')) errs.push('confirmed_ok лишився під капом');

  /* 3в. confirmed_bad НЕ обходить структурний кап: він для всього, крім confirmed_ok */
  b = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'confirmed_bad' })], FULL);
  if (!(b.final <= 5.5)) errs.push('структурне confirmed_bad обійшло кап: ' + b.final);
  if (!b.limiting_factors.includes('hard_cap:STRUCTURAL_DAMAGE')) errs.push('confirmed_bad: капа нема в обмежувачах');

  /* 3г. event_id обовʼязковий: два однакові ризики без нього не штрафують двічі, обидва в dropped */
  b = quiet(() => computeScore([
    { type: 'ODOMETER_ROLLBACK', evidence: [ev('registry', 'r1', 'запис реєстру')] },
    { type: 'ODOMETER_ROLLBACK', evidence: [ev('historical_listing', 'listing_2', 'менший пробіг пізніше')] },
    { type: 'ODOMETER_ROLLBACK', event_id: '   ', evidence: [ev('registry', 'r1', 'запис')] },
  ], FULL));
  if (b.penalties.length !== 0) errs.push('без event_id оштрафувало: ' + b.penalties.length + ' разів');
  if (b.dropped_findings !== 3) errs.push('без event_id: dropped ' + b.dropped_findings + ' замість 3');

  /* 4. тяжке ДТП з ремонтом unknown: кап 5.5 і його імʼя в обмежувачах */
  b = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'unknown', severity: 'high' })], FULL);
  if (!(b.final <= 5.5)) errs.push('структурне unknown: ' + b.final + ' > 5.5');
  if (!b.limiting_factors.includes('hard_cap:STRUCTURAL_DAMAGE')) errs.push('структурне unknown: капа нема в limiting_factors');

  /* 5. стеля і кап чисельно збігаються: в обмежувачах ОБИДВА, прапорець не бреше.
     base 5.0 + identity 0.75 + фото 0.75 + сервіс 0.5 = 7.0 = кап подушок unknown */
  const covEq = { ...VIN_PHOTOS, service_history_exists: true };
  b = computeScore([F('AIRBAGS_DEPLOYED', 'acc1', { repair_status: 'unknown' })], covEq);
  if (b.coverage_cap !== 7.0) errs.push('кейс збігу: стеля ' + b.coverage_cap + ' замість 7.0');
  if (!b.limiting_factors.includes('coverage') || !b.limiting_factors.includes('hard_cap:AIRBAGS_DEPLOYED')) {
    errs.push('кейс збігу: очікував обидва обмежувачі, отримав ' + JSON.stringify(b.limiting_factors));
  }
  if (!b.score_limited_by_data) errs.push('кейс збігу: score_limited_by_data бреше');

  /* 6. одна аварія в трьох джерелах = один штраф, evidence обʼєднані */
  b = computeScore([
    { type: 'STRUCTURAL_DAMAGE', event_id: 'acc1', repair_status: 'unknown', evidence: [ev('us_auction', 'auction_event_1', 'фото до ремонту')] },
    { type: 'STRUCTURAL_DAMAGE', event_id: 'acc1', repair_status: 'unknown', evidence: [ev('historical_listing', 'listing_2', 'продавалась битою')] },
    { type: 'STRUCTURAL_DAMAGE', event_id: 'acc1', repair_status: 'unknown', evidence: [ev('seller_claim', null, 'продавець згадав ДТП')] },
  ], FULL);
  if (b.penalties.length !== 1) errs.push('три джерела однієї аварії: ' + b.penalties.length + ' штрафів замість 1');
  if (b.penalties[0].evidence.length !== 3) errs.push('evidence не обʼєднані: ' + b.penalties[0].evidence.length);
  if (b.penalties[0].amount !== -2.0) errs.push('штраф структурного: ' + b.penalties[0].amount + ' замість -2.0');

  /* 7. подушки: підтверджений ремонт помітно мʼякший за unknown */
  const okBag = computeScore([F('AIRBAGS_DEPLOYED', 'acc1', { repair_status: 'confirmed_ok' })], FULL);
  const unkBag = computeScore([F('AIRBAGS_DEPLOYED', 'acc1', { repair_status: 'unknown' })], FULL);
  if (!(Math.round((okBag.final - unkBag.final) * 10) / 10 >= 0.7)) errs.push('подушки: confirmed_ok (' + okBag.final + ') не мʼякший за unknown (' + unkBag.final + ')');

  /* 7б. тюнінг двоярусний: серйозне втручання без підтверджень -0.6,
     підтвердження обслуговування повертають -0.3, несерйозний завжди -0.3 */
  const mod = extra => computeScore([F('MODIFICATION_TECHNICAL_CONCERN', 'm1', extra)], FULL).penalties[0].amount;
  if (mod({ serious_intervention: true, maintenance_evidence: false }) !== -0.6) errs.push('серйозний тюнінг без підтверджень не -0.6');
  if (mod({ serious_intervention: true, maintenance_evidence: true }) !== -0.3) errs.push('підтвердження не повернули -0.3');
  if (mod({ serious_intervention: false, maintenance_evidence: false }) !== -0.3) errs.push('несерйозний тюнінг не -0.3');
  if (mod({}) !== -0.3) errs.push('без прапорців не базовий -0.3');

  /* 7в. подушки: safety-кап. unknown і visually_consistent під капом 7.0,
     confirmed_bad жорсткіший, confirmed_ok знімає */
  b = computeScore([F('AIRBAGS_DEPLOYED', 'a1', { repair_status: 'unknown' })], FULL);
  if (!(b.final <= 7.0) || !b.limiting_factors.includes('hard_cap:AIRBAGS_DEPLOYED')) errs.push('подушки unknown без капа 7.0: ' + b.final);
  b = computeScore([F('AIRBAGS_DEPLOYED', 'a1', { repair_status: 'visually_consistent' })], FULL);
  if (!(b.final <= 7.0)) errs.push('подушки visually_consistent обійшли кап: ' + b.final);
  b = computeScore([F('AIRBAGS_DEPLOYED', 'a1', { repair_status: 'confirmed_bad' })], FULL);
  if (!(b.final <= 6.0)) errs.push('подушки confirmed_bad мʼякші за кап 6.0: ' + b.final);
  b = computeScore([F('AIRBAGS_DEPLOYED', 'a1', { repair_status: 'confirmed_ok' })], FULL);
  if (b.limiting_factors.includes('hard_cap:AIRBAGS_DEPLOYED')) errs.push('confirmed_ok SRS лишився під капом');
  /* комбінації: подушки+структурне = тісніший кап 5.5; подушки+пробіг = кап 7.0 і обидва штрафи */
  b = computeScore([F('AIRBAGS_DEPLOYED', 'acc1', { repair_status: 'unknown' }), F('STRUCTURAL_DAMAGE', 'acc1x', { repair_status: 'unknown' })], FULL);
  if (b.final !== 5.5) errs.push('подушки+структура: ' + b.final + ' замість 5.5');
  b = computeScore([F('AIRBAGS_DEPLOYED', 'acc1', { repair_status: 'unknown' }), F('MILEAGE_CONFLICT_UNEXPLAINED', 'm1', {})], FULL);
  if (b.final !== 7.0 || b.penalties.length !== 2) errs.push('подушки+пробіг: ' + b.final + '/' + b.penalties.length);

  /* 7г. eligibility gate: нижче порога цифри нема */
  const okInp = { identity_confirmed: true, photos_count: 12, basics_known: true, mileage_known: true, historical_listings_count: 0, mileage_observation_count: 0, auction_record_exists: false, registration_data_exists: false, service_history_exists: false, inspection_history_exists: false, seller_docs_exists: false };
  b = computeScore([], okInp);
  if (b.score_available !== true || typeof b.final !== 'number') errs.push('gate хибно зрізав повноцінний вхід');
  for (const [k, v, name] of [['identity_confirmed', false, 'identity'], ['photos_count', 3, 'photos'], ['basics_known', false, 'basics'], ['mileage_known', false, 'mileage']]) {
    b = computeScore([], { ...okInp, [k]: v });
    if (b.score_available !== false || b.final !== null) errs.push('gate пропустив брак ' + name);
    if (!b.score_unavailable_missing.includes(name)) errs.push('gate не назвав брак ' + name);
  }
  /* старі входи без basics/mileage полів: оцінка видається (зворотна сумісність) */
  const legacyInp = { ...okInp }; delete legacyInp.basics_known; delete legacyInp.mileage_known;
  b = computeScore([], legacyInp);
  if (b.score_available !== true) errs.push('старі входи без полів gate зрізані');

  /* 7д. причини стелі розрізняються: дані авто проти недоступності джерел */
  b = computeScore([], { ...okInp, auction_us_signal: true, auction_sources_unreachable: true });
  if (b.coverage.auction_record.state !== 'source_unreachable') errs.push('unreachable стан: ' + b.coverage.auction_record.state);
  if (!/недоступністю джерел CalCar/.test(b.score_limit_reason || '')) errs.push('причина не про джерела: ' + b.score_limit_reason);
  b = computeScore([], okInp);
  if (!/даними авто/.test(b.score_limit_reason || '')) errs.push('причина не про дані авто: ' + b.score_limit_reason);

  /* 8. скрутка і 9. VIN-проблема: жорсткі капи */
  b = computeScore([F('ODOMETER_ROLLBACK', 'e1', {})], FULL);
  if (!(b.final <= 4.5)) errs.push('скрутка: ' + b.final + ' > 4.5');
  b = computeScore([F('VIN_IDENTITY_PROBLEM', 'e1', {})], FULL);
  if (!(b.final <= 3.5)) errs.push('VIN-проблема: ' + b.final + ' > 3.5');

  /* 10. одна історична запис НЕ дає бонус двічі (обʼява + пробіг) */
  const oneRec = { ...VIN_PHOTOS, historical_listings_count: 1, mileage_observation_count: 1 };
  b = computeScore([], oneRec);
  if (b.coverage.historical_listings.state !== 'present') errs.push('один запис: бонус обʼяв не нарахований');
  if (b.coverage.mileage_history.state !== 'absent') errs.push('один запис: бонус пробігу нарахований з однієї точки');

  /* 11. невідомий тип і сміття: не падає, відкидається, лічильник чесний */
  b = quiet(() => computeScore([
    { type: 'ALIEN_TYPE', evidence: [] }, null, 42, 'сміття', { no: 'type' },
    F('CRITICAL_WARNING_LIGHTS', 'w1', {}),
  ], FULL));
  if (b.penalties.length !== 1) errs.push('сміття у знахідках: ' + b.penalties.length + ' штрафів замість 1');
  if (b.dropped_findings !== 5) errs.push('лічильник відкинутих: ' + b.dropped_findings + ' замість 5');

  /* 12. детермінізм: той самий вхід, той самий JSON */
  const inp = [F('FLOOD', 'f1', {}), F('MILEAGE_CONFLICT_UNEXPLAINED', 'm1', {})];
  if (JSON.stringify(computeScore(inp, FULL)) !== JSON.stringify(computeScore(inp, FULL))) errs.push('розрахунок недетермінований');

  /* сміттєвий coverage не валить розрахунок */
  for (const junk of [null, undefined, 42, 'x', []]) {
    try { computeScore([], junk); } catch (e) { errs.push('сміттєвий coverage впав: ' + JSON.stringify(junk)); }
  }

  /* grade рахується з фіналу тими самими константами, капи вдруге не застосовуються */
  if (gradeFromScore(9.0) !== 'buy' || gradeFromScore(7.5) !== 'inspect' || gradeFromScore(6.0) !== 'caution' || gradeFromScore(3.0) !== 'avoid') {
    errs.push('gradeFromScore не відповідає порогам конфігу');
  }
  b = computeScore([], FULL);
  if (b.grade !== gradeFromScore(b.final)) errs.push('grade у розкладі не з фінального балу');

  /* photos_sufficient: лише кількість унікальних кадрів, стара назва померла */
  b = computeScore([], FULL);
  if (!b.coverage.photos_sufficient) errs.push('нема джерела photos_sufficient у покритті');
  if (b.coverage.photos_ok) errs.push('старе джерело photos_ok повернулось');
  const src = fs.readFileSync('api/score.js', 'utf8');
  if (src.includes('PHOTOS_OK_MIN')) errs.push('стара константа PHOTOS_OK_MIN лишилась');
  const checkSrc = fs.readFileSync('api/check.js', 'utf8');
  /* vin_decoded лише за змістовним декодуванням, порожній обʼєкт правдивий */
  if (!checkSrc.includes('nhtsa && nhtsa.Make && (nhtsa.Model || nhtsa.ModelYear)')) errs.push('check.js: змістовність NHTSA-декоду зникла');
  /* ідентичність не залежить від одного NHTSA: реєстр за VIN теж підтверджує */
  if (!checkSrc.includes('identity_confirmed: nhtsaMeaningful || hf.registry_present')) errs.push('check.js: identity лише через NHTSA');
  b = computeScore([], { identity_confirmed: true, photos_count: 12, historical_listings_count: 0, mileage_observation_count: 0, auction_record_exists: false, registration_data_exists: false, service_history_exists: false, inspection_history_exists: false, seller_docs_exists: false });
  if (b.coverage.identity_confirmed.state !== 'present') errs.push('identity_confirmed не читається');
  /* старі збережені входи з vin_decoded відтворюються далі */
  b = computeScore([], { vin_decoded: true, photos_count: 12, historical_listings_count: 0, mileage_observation_count: 0, auction_record_exists: false, registration_data_exists: false, service_history_exists: false, inspection_history_exists: false, seller_docs_exists: false });
  if (b.coverage.identity_confirmed.state !== 'present') errs.push('фолбек vin_decoded для старих входів зламаний');
  /* промпт вимагає event_id завжди, включно з поточними станами */
  if (!checkSrc.includes('event_id ОБОВʼЯЗКОВИЙ для КОЖНОЇ знахідки')) errs.push('check.js: промпт не вимагає event_id завжди');
  if (!checkSrc.includes('current_srs_fault')) errs.push('check.js: промпт без прикладу event_id для поточних станів');
  /* правило mileage-conflict на основі аукціонного одометра: 5 умов */
  if (!checkSrc.includes('MILEAGE_CONFLICT_UNEXPLAINED на основі АУКЦІОННОГО одометра дозволений ЛИШЕ коли ОДНОЧАСНО')) errs.push('check.js: нема 5 умов mileage-conflict');
  if (!checkSrc.includes('статус actual')) errs.push('check.js: правило не вимагає статус actual');
  if (!checkSrc.includes('дата хоч однієї точки ненадійна')) errs.push('check.js: правило не відкидає ненадійну дату');
  if (!checkSrc.includes("odometer_status: ['actual', 'not_actual', 'exempt', 'unknown']")) errs.push('check.js: persistence не пише odometer_status');
  /* межі статусів відновлення жорсткі і живуть у промпті */
  if (!checkSrc.includes('confirmed_ok ЗАБОРОНЕНИЙ')) errs.push('check.js: промпт дозволяє confirmed_ok за фото');
  if (!checkSrc.includes('лишається unknown, НЕ visually_consistent')) errs.push('check.js: невидима зона удару не лишає unknown');
  if (!checkSrc.includes('ХАРАКТЕР і МАСШТАБ вихідного пошкодження')) errs.push('check.js: нема правила про аукціонні матеріали');
  if (!checkSrc.includes('питання ЗНІМАЄТЬСЯ')) errs.push('check.js: MAJOR_REPAIR_UNVERIFIED не знімається некрупним пошкодженням');
  if (!checkSrc.includes('Сам факт рахунку чи документів на ремонт confirmed_ok НЕ дає')) errs.push('check.js: документи без перевірки дають confirmed_ok');
  /* тригери сигналу США і поля тюнінгу живуть у промпті і коді */
  for (const k of ['seller_claims_us_import', 'serious_intervention', 'maintenance_evidence']) {
    if (!checkSrc.includes(k)) errs.push('check.js: нема поля ' + k);
  }
  /* маркування на фото це спостереження в info_notes і ЯВНО не тригер стелі */
  const sigExpr = (checkSrc.split('auction_us_signal: !!(')[1] || '').split(')')[0] + ')';
  if (sigExpr.includes('markings')) errs.push('check.js: маркування на фото знову тригер applicable');
  if (!checkSrc.includes('Тригером застосовності аукціону вони НЕ є')) errs.push('check.js: промпт не виключає маркування з тригерів');
  if (!checkSrc.includes('breakdown.sources_checked')) errs.push('check.js: нема аудиту sources_checked у breakdown');
  if (!checkSrc.includes("/^[1-5]/.test(listing.vin) && listing.country === 'UA'")) errs.push('check.js: нема тригера NA-VIN на ринку України');
  /* WMI повернутий свідомо калібрувальною ітерацією, але ЛИШЕ як сигнал
     "NA-VIN на ринку України" для absent-логіки, не як застосовність сам
     по собі: тригер мусить жити в парі з перевіркою ринку */
  if (!checkSrc.includes('function photoKey(')) errs.push('check.js не дедуплікує кадри для photos_sufficient');
  if (!checkSrc.includes('function normalizeListingUrl(')) errs.push('check.js не нормалізує source_url для дедуплікації');

  /* округлення вниз: дробова стеля 6.95 (cfg-override бонуса) дає 6.9, не 7.0 */
  const fracCfg = { ...SCORE_CONFIG, COVERAGE_BONUS: { ...SCORE_CONFIG.COVERAGE_BONUS, service_history: 0.45 } };
  b = computeScore([], { identity_confirmed: true, photos_count: 12, basics_known: true, mileage_known: true, service_history_exists: true, historical_listings_count: 0, mileage_observation_count: 0, auction_record_exists: false, registration_data_exists: false, inspection_history_exists: false, seller_docs_exists: false }, fracCfg);
  if (b.coverage_cap !== 6.95) errs.push('стеля кейса округлення: ' + b.coverage_cap);
  if (b.final !== 6.9) errs.push('округлення показало більше за стелю: ' + b.final + ' замість 6.9');

  /* конфіг: кожен тип знахідки має рівно одне число штрафу */
  const typeCount = Object.keys(SCORE_CONFIG.PENALTIES).length;
  if (typeCount !== 13) errs.push('у конфігу ' + typeCount + ' типів замість 13');

  /* тіньовий режим: легасі оцінка ЛИШАЄТЬСЯ в схемі і промпті check.js,
     v2 рахується кодом і зберігається поруч, чат чистить поля v2 */
  const check = fs.readFileSync('api/check.js', 'utf8');
  if (!check.includes('"verdict":{"score":7.4')) errs.push('check.js: легасі verdict.score зник зі схеми');
  if (!check.includes('"verdict.score": чесна оцінка')) errs.push('check.js: легасі правила оцінки зникли з промпту');
  if (!check.includes('"score_facts"')) errs.push('check.js: score_facts нема в схемі');
  if (!check.includes("import { computeScore } from './score.js'")) errs.push('check.js: не імпортує чистий модуль оцінки');
  if (!check.includes("parsed.score_v2_preview = breakdown.score_available === false ? null : breakdown.final")) errs.push('check.js: не зберігає score_v2_preview з урахуванням gate');
  if (!check.includes('ВІДСУТНІСТЬ ДАНИХ НІКОЛИ НЕ Є ЗНАХІДКОЮ')) errs.push('check.js: зникло правило про відсутність даних');
  const chat = fs.readFileSync('api/chat.js', 'utf8');
  if (!chat.includes('delete c.score_v2_preview')) errs.push('chat.js: не чистить поля v2 з контексту');

  fs.unlinkSync(tmp);
  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('стеля і покриття · штрафи за подію · капи і збіги обмежувачів · помʼякшення · сміття · детермінізм');
  console.log('SCORE TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
