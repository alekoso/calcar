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
  /* сигнал США без запису: applicable/absent, бонуса нема, формула та сама */
  b = computeScore([], { ...GERMAN_FULL, auction_us_signal: true });
  if (b.coverage.auction_record.state !== 'absent') errs.push('сигнал США без запису: стан ' + b.coverage.auction_record.state);

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

  /* 4. тяжке ДТП з ремонтом unknown: кап 5.5 і його імʼя в обмежувачах */
  b = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'unknown', severity: 'high' })], FULL);
  if (!(b.final <= 5.5)) errs.push('структурне unknown: ' + b.final + ' > 5.5');
  if (!b.limiting_factors.includes('hard_cap:STRUCTURAL_DAMAGE')) errs.push('структурне unknown: капа нема в limiting_factors');

  /* 5. стеля і кап чисельно збігаються: в обмежувачах ОБИДВА, прапорець не бреше */
  const covEq = { ...VIN_PHOTOS, vin_decoded: false, photos_count: 0, service_history_exists: true };
  /* base 5.0 + service 0.5 = 5.5 = кап структурного unknown */
  b = computeScore([F('STRUCTURAL_DAMAGE', 'acc1', { repair_status: 'unknown' })], covEq);
  if (b.coverage_cap !== 5.5) errs.push('кейс збігу: стеля ' + b.coverage_cap + ' замість 5.5');
  if (!b.limiting_factors.includes('coverage') || !b.limiting_factors.includes('hard_cap:STRUCTURAL_DAMAGE')) {
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
  if (/\/\^\[1-5\]\//.test(checkSrc)) errs.push('check.js знову вгадує застосовність аукціону за WMI');
  if (!checkSrc.includes('function photoKey(')) errs.push('check.js не дедуплікує кадри для photos_sufficient');
  if (!checkSrc.includes('function normalizeListingUrl(')) errs.push('check.js не нормалізує source_url для дедуплікації');

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
  if (!check.includes('parsed.score_v2_preview = breakdown.final')) errs.push('check.js: не зберігає score_v2_preview');
  if (!check.includes('ВІДСУТНІСТЬ ДАНИХ НІКОЛИ НЕ Є ЗНАХІДКОЮ')) errs.push('check.js: зникло правило про відсутність даних');
  const chat = fs.readFileSync('api/chat.js', 'utf8');
  if (!chat.includes('delete c.score_v2_preview')) errs.push('chat.js: не чистить поля v2 з контексту');

  fs.unlinkSync(tmp);
  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('стеля і покриття · штрафи за подію · капи і збіги обмежувачів · помʼякшення · сміття · детермінізм');
  console.log('SCORE TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
