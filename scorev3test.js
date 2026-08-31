/* CalCar Score v3: синтетичні інваріанти перекаліброваної формули.
   Фікстури синтетичні (математичні інваріанти), НЕ маскуються під реальні
   VIN. Кожен кейс тримає інваріант або діапазон: змінив SCORE_CONFIG_V3,
   перепровір еталони свідомо. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), 'calcar_scorev3test.mjs');
fs.writeFileSync(tmp, fs.readFileSync('api/score-v3.js', 'utf8'));

const errs = [];
const ev = (source, ref, description) => ({ source, ref, description });
const F = (type, event_id, extra) => ({ type, event_id, evidence: [ev('current_photos', 'photo_1', 'доказ')], ...extra });

/* багате покриття: всі домени зароблені */
const RICH = {
  identity_confirmed: true, photos_count: 24,
  historical_listings_count: 3, mileage_observation_count: 3,
  auction_record_exists: true,
  registration_data_exists: true, basics_known: true, mileage_known: true,
};
/* тонке покриття: лише identity і фото */
const THIN = {
  identity_confirmed: true, photos_count: 12,
  historical_listings_count: 0, mileage_observation_count: 0,
  auction_record_exists: false, auction_us_signal: false,
  registration_data_exists: false, basics_known: true, mileage_known: true,
};

(async () => {
  const M = await import('file://' + tmp);
  const { computeScoreV3, resolveAccidentEvents, deriveSeverity, normalizeCurrentProblems, buildCoverageV3, checkEligibilityV3, SCORE_CONFIG_V3 } = M;
  const C_DIM = M.SCORE_DIMENSIONS_CONFIG;
  const C = SCORE_CONFIG_V3;
  const score = (findings, cov, extra) => computeScoreV3({ findings, coverageInputs: cov, ...(extra || {}) });

  /* ===== 1. coverage: домени і стеля ===== */
  let b = score([], RICH);
  if (b.raw_quality !== 10) errs.push('чиста: raw_quality ' + b.raw_quality + ' != 10');
  if (!(b.final >= 9.2)) errs.push('чиста з багатим покриттям: ' + b.final + ' < 9.2');
  if (b.final !== b.coverage_cap) errs.push('чиста: підсумок не дорівнює стелі');
  /* found заробляє покриття */
  if (b.coverage.domains.auction_history.contribution !== C.COVERAGE_DOMAINS.auction_history) errs.push('found аукціон не заробив внесок');
  /* checked_absent теж заробляє: перевірили, запису нема */
  b = score([], { ...RICH, auction_record_exists: false, auction_us_signal: true, auction_checked: true });
  if (b.coverage.domains.auction_history.status !== 'checked_absent') errs.push('checked_absent: статус ' + b.coverage.domains.auction_history.status);
  if (b.coverage.domains.auction_history.contribution !== C.COVERAGE_DOMAINS.auction_history) errs.push('checked_absent не заробив внесок');
  /* source_unreachable НЕ заробляє */
  b = score([], { ...RICH, auction_record_exists: false, auction_us_signal: true, auction_sources_unreachable: true });
  if (b.coverage.domains.auction_history.status !== 'source_unreachable') errs.push('unreachable: статус ' + b.coverage.domains.auction_history.status);
  if (b.coverage.domains.auction_history.contribution !== 0) errs.push('unreachable заробив внесок');
  /* not_applicable чесно виключається: внесок earned, машина не винна */
  b = score([], { ...RICH, auction_record_exists: false, auction_applicable: false });
  if (b.coverage.domains.auction_history.status !== 'not_applicable') errs.push('not_applicable: статус ' + b.coverage.domains.auction_history.status);
  if (b.coverage.domains.auction_history.contribution !== C.COVERAGE_DOMAINS.auction_history) errs.push('not_applicable зменшив стелю (домен має виключатися з очікування)');
  /* unknown не заробляє */
  b = score([], THIN);
  if (b.coverage.domains.auction_history.status !== 'unknown') errs.push('thin: статус аукціону ' + b.coverage.domains.auction_history.status);
  /* coverage НІКОЛИ не змінює raw_quality */
  const bRich = score([F('SERIOUS_POWERTRAIN_FAULT', 'p1')], RICH);
  const bThin = score([F('SERIOUS_POWERTRAIN_FAULT', 'p1')], THIN);
  if (bRich.raw_quality !== bThin.raw_quality) errs.push('coverage вплинув на raw_quality: ' + bRich.raw_quality + ' vs ' + bThin.raw_quality);
  /* чиста eligible машина з тонким покриттям: НЕ кластер 6.9-7.2 і НЕ штучні 8.7:
     рівно своя стеля BASE + identity + photos */
  b = score([], THIN);
  const thinCeil = C.BASE_CEILING + C.COVERAGE_DOMAINS.identity + C.COVERAGE_DOMAINS.current_photos;
  if (Math.abs(b.final - Math.round(thinCeil * 10) / 10) > 1e-9) errs.push('тонке покриття: ' + b.final + ' != стеля ' + thinCeil);
  if (!b.limiting_factors.includes('coverage')) errs.push('тонке покриття: coverage нема в limiting_factors');
  if (!b.score_limited_by_data) errs.push('тонке покриття: score_limited_by_data мав бути true');
  /* верхні якорі: обмежене ~8.2-8.5, дуже багате <= 9.8 */
  const ceilMax = score([], { ...RICH, auction_record_exists: false, auction_applicable: false }).coverage_cap;
  if (ceilMax > C.CEILING_MAX + 1e-9) errs.push('стеля перевищила CEILING_MAX');

  /* ===== 2. eligibility ===== */
  /* <6 фото більше не вбиває Score, якщо є інші зароблені домени */
  b = score([], { ...RICH, photos_count: 3 });
  if (b.score_available !== true) errs.push('3 фото + багата історія: Score мав бути доступний');
  if (b.coverage.domains.current_photos.contribution !== 0) errs.push('3 фото: домен фото не мав заробити');
  /* відсутній поточний пробіг не завжди фатальний */
  b = score([], { ...RICH, mileage_known: false });
  if (b.score_available !== true) errs.push('без поточного пробігу, але з історією: Score мав бути доступний');
  /* справді недостатньо: нема identity */
  b = score([], { ...RICH, identity_confirmed: false });
  if (b.score_available !== false) errs.push('без identity Score мав бути недоступний');
  /* нема жодного evidence-домену і мало фото */
  b = score([], { ...THIN, photos_count: 2 });
  if (b.score_available !== false) errs.push('2 фото без жодного іншого домену: Score мав бути недоступний');
  /* фото стендалон: 4+ фото достатньо для eligibility */
  b = score([], { ...THIN, photos_count: 5 });
  if (b.score_available !== true) errs.push('5 фото стендалон: Score мав бути доступний');

  /* ===== 3. нормалізація ДТП: одна аварія з багатьох джерел ===== */
  const auctionMeta = { lot_id: '123', house: 'Copart', sale_date: '2023-05-10', airbags: { deployed: true, raw: 'deployed' }, primary_damage: 'FRONT END', secondary_damage: null };
  const hv = { structural_visual_status: 'no_visible_issues', srs_visual_status: 'deployed_visible', visible_severity: 'moderate', visible_damage_zones: ['front bumper', 'hood'], evidence: [{ source: 'historical_listing', description: 'архівні кадри' }] };
  const multiSource = [
    F('AIRBAGS_DEPLOYED', 'acc_2023', { evidence: [ev('us_auction', 'lot', 'подушки розкриті за лотом')], repair_status: 'unknown' }),
    F('MAJOR_REPAIR_UNVERIFIED', 'acc_2023_repair', { evidence: [ev('us_auction', 'lot', 'ремонт після аукціону 2023')], repair_status: 'unknown' }),
  ];
  b = score(multiSource, RICH, { auctionMeta, historicalVisual: hv, accidentRecord: { recorded: true, note: 'ДТП 2023' } });
  if (b.accident_events.length !== 1) errs.push('мультиджерельна одна аварія: подій ' + b.accident_events.length + ' != 1');
  if (b.accident_events.length === 1) {
    const e0 = b.accident_events[0];
    if (!e0.normalized_event_id.startsWith('auction:')) errs.push('якір аукціону: id ' + e0.normalized_event_id);
    if (e0.source_event_ids.length < 2) errs.push('source_event_ids не зібрані: ' + JSON.stringify(e0.source_event_ids));
    if (!e0.merge_basis.length) errs.push('merge_basis порожній');
    /* MAJOR_REPAIR злитий у подію: не штрафується вдруге окремо */
    if (b.normalized_current_problems.some(p => p.type === 'MAJOR_REPAIR_UNVERIFIED')) errs.push('MAJOR_REPAIR злитий у подію, але штрафується і окремо');
  }
  /* дві РІЗНІ аварії (різні відомі роки) = дві події, два штрафи */
  const twoAcc = [
    F('AIRBAGS_DEPLOYED', 'acc_2019', { evidence: [ev('historical_listing', 'l1', 'подушки, ДТП 2019 року')], repair_status: 'unknown' }),
    F('AIRBAGS_DEPLOYED', 'acc_2023', { evidence: [ev('historical_listing', 'l2', 'подушки, ДТП 2023 року')], repair_status: 'unknown' }),
  ];
  b = score(twoAcc, RICH);
  if (b.accident_events.length !== 2) errs.push('дві аварії різних років: подій ' + b.accident_events.length + ' != 2');
  const oneAccPen = score([twoAcc[0]], RICH);
  if (!(oneAccPen.final > b.final)) errs.push('дві аварії не гірші за одну: ' + b.final + ' vs ' + oneAccPen.final);
  /* LLM event_id САМ не керує кількістю: різні id, той самий рік = одна подія */
  const sameYearDiffIds = [
    F('AIRBAGS_DEPLOYED', 'llm_a', { evidence: [ev('historical_listing', 'l1', 'подушки, ДТП 2021')], repair_status: 'unknown' }),
    F('MAJOR_REPAIR_UNVERIFIED', 'llm_b', { evidence: [ev('historical_listing', 'l2', 'великий ремонт 2021')], repair_status: 'unknown' }),
  ];
  b = score(sameYearDiffIds, RICH);
  if (b.accident_events.length !== 1) errs.push('різні LLM id, той самий рік: подій ' + b.accident_events.length + ' != 1');

  /* ===== 4. severity: код виводить tier зі СПОСТЕРЕЖУВАНИХ ознак; LLM
     лише витягує ознаки, прикметник visible_severity в математику не входить */
  const SIG = o => ({ signals: { structural: false, airbags: false, zones: 0, major_deformation: false, wheel_displacement: false, cosmetic_only: false, ...o } });
  let sv = deriveSeverity(SIG({ structural: true }));
  if (sv.severity !== 'severe' || !sv.basis.includes('structural_damage')) errs.push('structural мав дати severe: ' + JSON.stringify(sv));
  sv = deriveSeverity(SIG({ major_deformation: true }));
  if (sv.severity !== 'moderate' || !sv.basis.includes('major_deformation_visible')) errs.push('самотня глибока деформація мала дати moderate, не severe: ' + JSON.stringify(sv));
  sv = deriveSeverity(SIG({ major_deformation: true, wheel_displacement: true }));
  if (sv.severity !== 'severe') errs.push('деформація + зміщене колесо мали дати severe: ' + sv.severity);
  sv = deriveSeverity(SIG({ airbags: true }));
  if (sv.severity !== 'moderate' || !sv.basis.includes('airbags_deployed')) errs.push('подушки мали дати мінімум moderate: ' + JSON.stringify(sv));
  sv = deriveSeverity(SIG({ wheel_displacement: true }));
  if (sv.severity !== 'moderate' || !sv.basis.includes('wheel_displacement_visible')) errs.push('зміщене колесо мало дати мінімум moderate: ' + JSON.stringify(sv));
  sv = deriveSeverity(SIG({ zones: 2 }));
  if (sv.severity !== 'moderate') errs.push('кілька зон мали дати moderate: ' + sv.severity);
  sv = deriveSeverity(SIG({ cosmetic_only: true }));
  if (sv.severity !== 'minor') errs.push('косметика мала дати minor: ' + sv.severity);
  sv = deriveSeverity(SIG({}));
  if (sv.severity !== 'indeterminate') errs.push('без ознак мало бути indeterminate: ' + sv.severity);
  sv = deriveSeverity(SIG({ airbags: true, major_deformation: true }));
  if (sv.severity !== 'severe') errs.push('деформація + подушки мали дати severe: ' + sv.severity);
  /* прикметник моделі САМ не піднімає tier */
  sv = deriveSeverity({ signals: { structural: false, airbags: false, zones: 0, major_deformation: false, wheel_displacement: false, cosmetic_only: false, visual_severity: 'severe' } });
  if (sv.severity !== 'indeterminate') errs.push('прикметник visible_severity потрапив у математику: ' + sv.severity);

  /* ===== 5. драбина severity в підсумку і repair-інваріанти ===== */
  const accCase = (sevSignals, repair) => {
    const meta = { lot_id: '9', house: 'IAAI', sale_date: '2022-03-01', airbags: sevSignals.airbags ? { deployed: true, raw: 'x' } : null, primary_damage: sevSignals.zones >= 1 ? 'FRONT END' : null, secondary_damage: sevSignals.zones >= 2 ? 'LEFT SIDE' : null };
    const hvv = sevSignals.structural
      ? { structural_visual_status: 'visible_damage', srs_visual_status: 'not_assessable', major_deformation_visible: true, visible_damage_zones: [], evidence: [{ source: 'historical_listing', description: 'кадри' }] }
      : (sevSignals.minor ? { structural_visual_status: 'no_visible_issues', srs_visual_status: 'not_assessable', cosmetic_only: true, visible_damage_zones: [], evidence: [{ source: 'historical_listing', description: 'кадри' }] } : null);
    const f = repair ? [F('MAJOR_REPAIR_UNVERIFIED', 'acc_2022', { evidence: [ev('us_auction', 'lot', 'ремонт після лота')], repair_status: repair })] : [];
    return score(f, RICH, { auctionMeta: meta, historicalVisual: hvv });
  };
  const clean = score([], RICH).final;
  const minor = accCase({ minor: true, zones: 1 }, 'unknown').final;
  const moderate = accCase({ airbags: true, zones: 1 }, 'unknown').final;
  const severe = accCase({ structural: true, airbags: true, zones: 2 }, 'unknown').final;
  if (!(clean > minor && minor > moderate && moderate > severe)) errs.push('драбина порушена: clean ' + clean + ', minor ' + minor + ', moderate ' + moderate + ', severe ' + severe);
  if (!(moderate - severe > 0.3)) errs.push('severe майже не відрізняється від moderate: ' + moderate + ' vs ' + severe);
  /* смуга 6.9-7.2 сама по собі НЕ проблема: конкретне значення severe
     не фіксується вікном, стару кластеризацію тримають лише причинні
     інваріанти вище (драбина) і нижче (repair, SRS, капи) */
  /* repair: confirmed_ok > visually_consistent > unknown; bad без помʼякшення */
  const modOk = accCase({ airbags: true, zones: 1 }, 'confirmed_ok').final;
  const modVc = accCase({ airbags: true, zones: 1 }, 'visually_consistent').final;
  const modUnk = accCase({ airbags: true, zones: 1 }, 'unknown').final;
  if (!(modOk > modVc && modVc > modUnk)) errs.push('repair-порядок порушений: ok ' + modOk + ', vc ' + modVc + ', unknown ' + modUnk);
  /* confirmed_ok не стирає severe-історію: помітний residual проти чистої */
  const sevOk = accCase({ structural: true, airbags: true, zones: 2 }, 'confirmed_ok');
  const sevOkEvent = sevOk.accident_events[0];
  if (!(sevOkEvent.final_event_penalty >= C.SEVERE_MIN_RESIDUAL - 1e-9)) errs.push('severe residual: штраф ' + sevOkEvent.final_event_penalty + ' < ' + C.SEVERE_MIN_RESIDUAL);
  if (!(clean - sevOk.final >= 0.9)) errs.push('відремонтований severe майже наздогнав чисту: ' + sevOk.final + ' vs ' + clean);

  /* ===== 6. подушки і SRS ===== */
  /* подушки НЕ другий штраф аварії: одна подія, один event-штраф */
  const airbagCase = accCase({ airbags: true, zones: 1 }, 'unknown');
  if (airbagCase.accident_events.length !== 1) errs.push('подушки створили другу подію');
  /* але дають обмежений unresolved-SRS concern, НЕ кап 7.0 */
  if (airbagCase.unresolved_safety_concerns.length !== 1) errs.push('unresolved SRS concern відсутній');
  if (airbagCase.applied_hard_caps.length) errs.push('unknown-SRS дав жорсткий кап: ' + JSON.stringify(airbagCase.applied_hard_caps));
  const srsPen = airbagCase.unresolved_safety_concerns[0] && airbagCase.unresolved_safety_concerns[0].penalty;
  if (!(srsPen >= 0.4 && srsPen <= 0.7)) errs.push('SRS_RESTORATION_UNVERIFIED поза 0.4-0.7: ' + srsPen);
  /* confirmed_ok відновлення: concern знімається */
  const airbagOk = accCase({ airbags: true, zones: 1 }, 'confirmed_ok');
  if (airbagOk.unresolved_safety_concerns.length) errs.push('confirmed_ok не зняв SRS concern');
  /* сильний evidence: поточна несправність SRS дає кап і БЕЗ дубля concern */
  const srsFault = score([
    F('AIRBAGS_DEPLOYED', 'acc_2022', { evidence: [ev('us_auction', 'lot', 'подушки')], repair_status: 'unknown' }),
    F('SRS_FAULT', 'srs_now', { evidence: [ev('current_photos', 'photo_3', 'помилка SRS на панелі, діагностована несправність подушок')] }),
  ], RICH, { auctionMeta });
  if (!srsFault.applied_hard_caps.some(c => c.name.includes('SRS_STRONG_EVIDENCE'))) errs.push('поточна несправність SRS не дала кап');
  if (srsFault.unresolved_safety_concerns.length) errs.push('SRS-несправність і concern подвоїлись');
  if (!(srsFault.final <= C.SRS_STRONG_EVIDENCE_CAP)) errs.push('SRS-кап не застосований: ' + srsFault.final);

  /* ===== 7. structural: без старого додаткового -2.0 і з капом ===== */
  const structCase = accCase({ structural: true, airbags: false, zones: 2 }, 'unknown');
  if (!structCase.applied_hard_caps.some(c => c.name.includes('STRUCTURAL_UNRESOLVED'))) errs.push('unresolved structural без капа');
  if (!(structCase.final <= C.STRUCTURAL_UNRESOLVED_CAP)) errs.push('structural кап не тримає: ' + structCase.final);
  /* structural у події вже врахований через severe: немає окремого додаткового штрафу */
  const structEvent = structCase.accident_events[0];
  const expectedPen = Math.max(C.SEVERE_MIN_RESIDUAL, (C.ACCIDENT_BASE + C.SEVERITY_ADDITIONAL.severe) * C.REPAIR_MULTIPLIER.unknown);
  if (Math.abs(structEvent.final_event_penalty - expectedPen) > 1e-9) errs.push('structural подвійний рахунок: штраф події ' + structEvent.final_event_penalty + ' != ' + expectedPen);
  /* confirmed_ok structural: капа нема, residual лишається */
  const structOk = accCase({ structural: true, airbags: false, zones: 2 }, 'confirmed_ok');
  if (structOk.applied_hard_caps.some(c => c.name.includes('STRUCTURAL'))) errs.push('confirmed_ok structural отримав кап');
  if (!(structOk.final < clean)) errs.push('confirmed_ok structural без residual');

  /* ===== 8. анти-дабл-каунтинг поточних проблем ===== */
  const wLight = F('CRITICAL_WARNING_LIGHTS', 'w1', { evidence: [ev('current_photos', 'photo_2', 'лампа подушок SRS горить')] });
  const fault = F('SRS_FAULT', 'f1', { evidence: [ev('seller_claim', null, 'продавець підтвердив несправність подушок')] });
  b = score([wLight, fault], RICH);
  const srsProblems = b.normalized_current_problems.filter(p => p.type === 'SRS_FAULT' || p.type === 'CRITICAL_WARNING_LIGHTS');
  if (srsProblems.length !== 1) errs.push('лампа + діагноз SRS: проблем ' + srsProblems.length + ' != 1');
  if (srsProblems[0] && !srsProblems[0].merge_basis.includes('warning_light_same_underlying_fault')) errs.push('merge_basis лампи відсутній');
  const onlyFault = score([fault], RICH).final;
  if (b.final !== onlyFault) errs.push('лампа тієї ж проблеми змінила бал: ' + b.final + ' vs ' + onlyFault);
  /* лампа ІНШОГО домену: окрема проблема */
  const otherLight = F('CRITICAL_WARNING_LIGHTS', 'w2', { evidence: [ev('current_photos', 'photo_2', 'горить ABS')] });
  b = score([otherLight, fault], RICH);
  if (b.normalized_current_problems.length !== 2) errs.push('незалежна лампа мала лишитись окремою проблемою');

  /* ===== 9. пробіг ===== */
  /* нормальна хронологія не штрафується: конфліктів-знахідок просто нема,
     а історичні точки пробігу ЗАРОБЛЯЮТЬ coverage */
  b = score([], { ...THIN, mileage_observation_count: 3 });
  if (b.coverage.domains.mileage_timeline.contribution !== C.COVERAGE_DOMAINS.mileage_timeline) errs.push('історичні точки пробігу не заробили домен');
  if (b.raw_quality !== 10) errs.push('нормальна хронологія оштрафована');
  /* rollback значно важчий за незрозумілий конфлікт */
  const conflict = score([F('MILEAGE_CONFLICT_UNEXPLAINED', 'm1')], RICH).final;
  const rollback = score([F('ODOMETER_ROLLBACK', 'm2', { evidence: [ev('registry', null, 'держреєстр: 200 тис, зараз 90 тис')] })], RICH);
  if (!(conflict - rollback.final >= 1.5)) errs.push('rollback мало відрізняється від конфлікту: ' + rollback.final + ' vs ' + conflict);
  if (!rollback.applied_hard_caps.some(c => c.name.includes('ODOMETER_ROLLBACK'))) errs.push('rollback без капа');
  if (!(rollback.final <= C.HARD_CAPS.ODOMETER_ROLLBACK)) errs.push('rollback кап не тримає');

  /* ===== 10. важкі капи: VIN, flood, fire ===== */
  const vin = score([F('VIN_IDENTITY_PROBLEM', 'v1', { evidence: [ev('registry', null, 'VIN не збігається з документами')] })], RICH);
  if (!(vin.final <= C.HARD_CAPS.VIN_IDENTITY_PROBLEM)) errs.push('VIN кап не тримає: ' + vin.final);
  const flood = score([F('FLOOD', 'fl1', { evidence: [ev('us_auction', null, 'flood title')] })], RICH);
  if (!(flood.final <= C.HARD_CAPS.FLOOD)) errs.push('flood кап не тримає: ' + flood.final);
  /* кап це максимум, не фіксоване значення: flood + rollback + несправність нижчі */
  const floodPlus = score([
    F('FLOOD', 'fl1', { evidence: [ev('us_auction', null, 'flood title')] }),
    F('ODOMETER_ROLLBACK', 'm2', { evidence: [ev('registry', null, 'скручений')] }),
    F('SERIOUS_POWERTRAIN_FAULT', 'p1'),
  ], RICH);
  if (!(floodPlus.final < flood.final)) errs.push('кап став фіксованим значенням: ' + floodPlus.final + ' vs ' + flood.final);
  /* VIN-проблема найважча */
  if (!(vin.final <= flood.final)) errs.push('VIN не найважчий: ' + vin.final + ' vs flood ' + flood.final);

  /* ===== 11. модифікації ===== */
  const mod = score([F('MODIFICATION_TECHNICAL_CONCERN', 'md1')], RICH);
  const modSerious = score([F('MODIFICATION_TECHNICAL_CONCERN', 'md2', { serious_intervention: true, maintenance_evidence: false })], RICH);
  const modMaintained = score([F('MODIFICATION_TECHNICAL_CONCERN', 'md3', { serious_intervention: true, maintenance_evidence: true })], RICH);
  if (!(modSerious.final < mod.final)) errs.push('серйозне втручання без обслуговування не важче');
  if (!(modMaintained.final > modSerious.final)) errs.push('evidence обслуговування не помʼякшив');
  /* тюнінг ніколи не масштабу severe/flood */
  if (!(modSerious.final > severe && modSerious.final > flood.final)) errs.push('тюнінг зрівнявся з severe/flood');

  /* ===== 12. виключення: що НЕ впливає ===== */
  /* сміттєві і невідомі типи (ціна, комплектація, походження, generic) відкидаються */
  b = score([
    { type: 'PRICE_TOO_HIGH', event_id: 'x1', evidence: [ev('seller_claim', null, 'дорого')] },
    { type: 'PREMIUM_EQUIPMENT', event_id: 'x2', evidence: [ev('current_photos', null, 'багата комплектація')] },
    { type: 'US_ORIGIN', event_id: 'x3', evidence: [ev('us_auction', null, 'пригнана з США')] },
    { type: 'MODEL_GENERIC_WEAKNESS', event_id: 'x4', evidence: [ev('seller_claim', null, 'у цієї моделі слабкі ланцюги')] },
    { type: 'SELLER_CONTRADICTION', event_id: 'x5', evidence: [ev('seller_claim', null, 'продавець суперечить')] },
    null, 42, { type: 'SRS_FAULT' }, { type: 'SRS_FAULT', event_id: 'no_ev', evidence: [] },
  ], RICH);
  if (b.raw_quality !== 10) errs.push('виключені типи вплинули на бал: ' + b.raw_quality);
  if (b.final !== score([], RICH).final) errs.push('сміття змінило підсумок');
  /* positive bonus = 0: гарні фото не піднімають вище стелі */
  if (C.POSITIVE_VERIFIED_BONUS !== 0) errs.push('positive bonus має бути 0 у v3');

  /* ===== 13. округлення: звичайне математичне до 0.1 ===== */
  const r1 = (await import('file://' + tmp));
  /* прямі перевірки через синтетичний кейс: penalty підбирає значення */
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  if (!near(Math.round(7.25 * 10) / 10, 7.3) || !near(Math.round(7.24 * 10) / 10, 7.2)) errs.push('семантика Math.round несподівана');
  /* конфіг-незалежна перевірка на живій формулі: бал завжди кратний 0.1 */
  for (const bb of [clean, severe, flood.final, rollback.final]) {
    if (bb !== null && Math.abs(bb * 10 - Math.round(bb * 10)) > 1e-9) errs.push('бал не кратний 0.1: ' + bb);
  }

  /* ===== 14. версіювання і детермінізм ===== */
  b = score([], RICH);
  if (b.score_version !== 'v3') errs.push('score_version != v3');
  const d1 = JSON.stringify(score(multiSource, RICH, { auctionMeta, historicalVisual: hv }));
  const d2 = JSON.stringify(score(multiSource, RICH, { auctionMeta, historicalVisual: hv }));
  if (d1 !== d2) errs.push('формула недетермінована');
  /* повний breakdown придатний для пояснення */
  const full = score(multiSource, RICH, { auctionMeta, historicalVisual: hv });
  for (const k of ['score_version', 'starting_score', 'accident_events', 'normalized_current_problems', 'unresolved_safety_concerns', 'raw_quality', 'coverage', 'applied_hard_caps', 'limiting_factors', 'final', 'grade']) {
    if (!(k in full)) errs.push('у breakdown нема поля ' + k);
  }
  const e0 = full.accident_events[0] || {};
  for (const k of ['normalized_event_id', 'anchored', 'source_event_ids', 'merge_basis', 'merge_confidence', 'accident_base', 'derived_severity', 'severity_basis', 'severity_additional', 'repair_status', 'repair_multiplier', 'minimum_residual_if_applied', 'final_event_penalty']) {
    if (!(k in e0)) errs.push('у accident_event нема поля ' + k);
  }
  /* грейди: семантика рівня ВИЯВЛЕНОГО ризику, без buy/excellent */
  const grades = C.GRADE_THRESHOLDS.map(t => t.grade).join(',');
  if (/buy|excellent/.test(grades)) errs.push('оцінювальний грейд лишився: ' + grades);
  if (grades !== 'low_risk,moderate_risk,elevated_risk,high_risk') errs.push('несподівані грейди: ' + grades);
  if (C.GRADE_THRESHOLDS.map(t => t.min).join(',') !== '8.5,7,5.5,0') errs.push('пороги грейдів змінились');

  /* ===== 15. каузальні порядки (розділ 44 ТЗ) ===== */
  const sevSrs = accCase({ structural: false, airbags: true, zones: 2 }, 'unknown');           /* severe-канал через подушки+зони: moderate; порівнюємо з чистим severe */
  const order = [clean, minor, moderate, severe];
  for (let i = 1; i < order.length; i++) if (!(order[i - 1] > order[i])) errs.push('порядок 44 порушений на кроці ' + i + ': ' + order.join(' > '));
  if (!(severe > flood.final)) errs.push('flood не гірший за severe: ' + flood.final + ' vs ' + severe);
  if (!(flood.final >= vin.final)) errs.push('identity fraud не найнижчий');

  /* ===== 16. resolver: anchored проти unanchored (follow-up 3961e3b) ===== */
  /* два РІЗНІ лоти одного року = дві події: інша лот-ідентичність не merge */
  const anchorLot = { lot_id: '40111111', house: 'Copart', sale_date: '2021-06-01', airbags: { deployed: true, raw: 'x' }, primary_damage: 'FRONT END', secondary_damage: null };
  b = score([
    F('AIRBAGS_DEPLOYED', 'lot_40222222_2021', { evidence: [ev('us_auction', 'lot_40222222', 'подушки за іншим лотом 2021')], repair_status: 'unknown' }),
  ], RICH, { auctionMeta: anchorLot });
  if (b.accident_events.length !== 2) errs.push('два різні лоти одного року: подій ' + b.accident_events.length + ' != 2');
  if (b.accident_events.length === 2 && !b.accident_events.some(e => e.merge_basis.includes('lot_mismatch_with_anchor'))) errs.push('lot_mismatch_with_anchor не зафіксований');
  /* той самий лот у ref: merge у якір */
  b = score([
    F('AIRBAGS_DEPLOYED', 'acc_2021', { evidence: [ev('us_auction', 'lot_40111111', 'подушки за лотом')], repair_status: 'unknown' }),
  ], RICH, { auctionMeta: anchorLot });
  if (b.accident_events.length !== 1) errs.push('той самий лот: подій ' + b.accident_events.length + ' != 1');
  /* generic запис площадки 2021 + єдиний аукціонний лот 2021 = одна подія */
  b = score([], RICH, { auctionMeta: anchorLot, accidentRecord: { recorded: true, note: 'ДТП 2021 із пошкодженням передньої частини' } });
  if (b.accident_events.length !== 1) errs.push('generic запис + єдиний лот того ж року: подій ' + b.accident_events.length + ' != 1');
  if (b.accident_events.length === 1) {
    const e0 = b.accident_events[0];
    if (!e0.merge_basis.includes('platform_record_attached')) errs.push('platform_record_attached нема в merge_basis');
    if (!e0.merge_basis.includes('damage_zones_match')) errs.push('збіг зон не зафіксований як підтвердження');
    if (e0.merge_confidence !== 'high') errs.push('роки відомі й рівні: merge_confidence мав бути high, а не ' + e0.merge_confidence);
    if (e0.anchored !== true) errs.push('якірна подія не позначена anchored');
  }
  /* зони як ВЕТО: запис площадки про удар у ЗАД проти фронтального лота */
  b = score([], RICH, { auctionMeta: anchorLot, accidentRecord: { recorded: true, note: 'ДТП 2021 із пошкодженням задньої частини кузова' } });
  if (b.accident_events.length !== 2) errs.push('вето за зонами не спрацювало: подій ' + b.accident_events.length + ' != 2');
  if (b.accident_events.length === 2 && !b.accident_events.some(e => e.merge_basis.includes('damage_zones_veto'))) errs.push('damage_zones_veto не зафіксований');
  /* два САМОСТІЙНІ ДТП одного року не схлопуються (без якоря) */
  b = score([
    F('AIRBAGS_DEPLOYED', 'acc_a_2021', { evidence: [ev('historical_listing', 'l1', 'подушки, перше ДТП 2021')], repair_status: 'unknown' }),
    F('AIRBAGS_DEPLOYED', 'acc_b_2021', { evidence: [ev('historical_listing', 'l2', 'подушки, друге ДТП 2021')], repair_status: 'unknown' }),
  ], RICH);
  if (b.accident_events.length !== 2) errs.push('два самостійні ДТП одного року схлопнулись: подій ' + b.accident_events.length);
  /* несумісні надійні дати проти us_auction-evidence: не merge */
  b = score([
    F('AIRBAGS_DEPLOYED', 'acc_2019', { evidence: [ev('us_auction', 'arch', 'подушки, архів 2019')], repair_status: 'unknown' }),
  ], RICH, { auctionMeta: anchorLot });
  if (b.accident_events.length !== 2) errs.push('різні надійні роки злились попри us_auction evidence: подій ' + b.accident_events.length);

  /* ===== 17. округлення не перевищує стелю і кап ===== */
  b = score([], { identity_confirmed: true, photos_count: 12, registration_data_exists: true, basics_known: true, mileage_known: true, historical_listings_count: 0, mileage_observation_count: 0 });
  if (Math.abs(b.coverage_cap - 8.75) > 1e-9) errs.push('очікувалась стеля 8.75, а не ' + b.coverage_cap);
  if (b.final > b.coverage_cap + 1e-9) errs.push('показаний бал ' + b.final + ' перевищив стелю ' + b.coverage_cap);
  if (b.final !== 8.7) errs.push('стеля 8.75 мала показатись як 8.7, а не ' + b.final);
  /* аналог для hard cap: кап 4.55 не показується як 4.6 */
  const cfgCap = { ...C, HARD_CAPS: { ...C.HARD_CAPS, FLOOD: 4.55 } };
  b = computeScoreV3({ findings: [F('FLOOD', 'fl1', { evidence: [ev('us_auction', null, 'flood title')] })], coverageInputs: RICH }, cfgCap);
  if (b.final > 4.55 + 1e-9) errs.push('показаний бал ' + b.final + ' перевищив кап 4.55');
  if (b.final !== 4.5) errs.push('кап 4.55 мав показатись як 4.5, а не ' + b.final);
  /* quality-обмежений бал округлюється звичайно (може вгору) */
  const cfgQ = { ...C, SEVERITY_ADDITIONAL: { ...C.SEVERITY_ADDITIONAL, moderate: 0.95 } };
  b = computeScoreV3({ findings: [], coverageInputs: RICH, auctionMeta: { lot_id: '9', house: 'IAAI', sale_date: '2022-01-01', airbags: null, primary_damage: 'FRONT END', secondary_damage: 'LEFT SIDE' } }, cfgQ);
  if (b.raw_quality !== 8.75) errs.push('очікувався raw 8.75, а не ' + b.raw_quality);
  if (b.final !== 8.8) errs.push('quality-обмежений 8.75 мав округлитись звичайно до 8.8, а не ' + b.final);

  /* ===== 18. not_applicable: bounded, без ratio-роздування ===== */
  const ceilNA = score([], { ...RICH, auction_record_exists: false, auction_applicable: false }).coverage_cap;
  const ceilFound = score([], RICH).coverage_cap;
  if (Math.abs(ceilNA - ceilFound) > 1e-9) errs.push('not_applicable дав іншу стелю, ніж bounded-внесок домену: ' + ceilNA + ' vs ' + ceilFound);
  if (ceilNA > C.CEILING_MAX + 1e-9) errs.push('not_applicable роздув стелю понад CEILING_MAX');

  /* ===== 19. пояснювальні підоцінки (dimensions) ===== */
  const { computeDimensions, buildScoreDigest, SCORE_DIMENSIONS_CONFIG, DIMENSION_LABELS } = M;
  /* підоцінки НЕ міняють CalCar Score: еталонні фінали ті самі, що й до
     їх появи (RICH-чиста = стеля 9.6, structural-severe = кап 5.5) */
  b = score([], RICH);
  if (b.final !== 9.6) errs.push('фінал чистої змінився після додавання dimensions: ' + b.final);
  if (!b.score_dimensions) errs.push('score_dimensions нема в breakdown');
  const sevCase = accCase({ structural: true, airbags: true, zones: 2 }, 'unknown');
  if (sevCase.final !== 5.5) errs.push('фінал severe-кейса змінився після dimensions: ' + sevCase.final);
  /* чиста перевірена машина: перевірені осі дають чесні 10, а Технічні
     ризики БЕЗ конкретного технічного evidence недоступні: достатня
     кількість фото сама по собі цю вісь не відкриває */
  for (const k of ['history', 'damage_repair']) {
    const d = b.score_dimensions[k];
    if (!d || d.score_available !== true || d.score !== 10) errs.push('чиста перевірена: вісь ' + k + ' мала бути 10: ' + JSON.stringify(d));
  }
  /* Стан за фото: "дефектів не видно" це НЕ 10.0, а base 9.4; 10.0 лише
     за винятковим visual evidence (flawless + повна галерея + >=18 кадрів) */
  const ccPlain = b.score_dimensions.current_condition;
  if (!ccPlain || ccPlain.score !== C_DIM.CC_BASE_DEFAULT) errs.push('звичайний набір без дефектів мав дати базу ' + C_DIM.CC_BASE_DEFAULT + ': ' + JSON.stringify(ccPlain));
  const ccRich = score([], RICH, { visualEvidence: { gallery_complete: true } }).score_dimensions.current_condition;
  if (ccRich.score !== C_DIM.CC_BASE_RICH) errs.push('повна галерея без дефектів мала дати ' + C_DIM.CC_BASE_RICH + ': ' + ccRich.score);
  const ccFlaw = score([], RICH, { visualEvidence: { gallery_complete: false, flawless: true } }).score_dimensions.current_condition;
  if (ccFlaw.score !== C_DIM.CC_FLAWLESS) errs.push('flawless без повного покриття мав дати ' + C_DIM.CC_FLAWLESS + ': ' + ccFlaw.score);
  const ccFull = score([], RICH, { visualEvidence: { gallery_complete: true, flawless: true } }).score_dimensions.current_condition;
  if (ccFull.score !== 10) errs.push('винятковий evidence мав дати 10.0: ' + ccFull.score);
  /* 10.0 недосяжна без flawless-сигналу */
  if (score([], { ...RICH, photos_count: 40 }, { visualEvidence: { gallery_complete: true } }).score_dimensions.current_condition.score >= 10) errs.push('10.0 стала дешевою: без flawless');
  /* Пробіг без відомого одометра недоступний: величина є головним компонентом */
  if (b.score_dimensions.mileage.score_available !== false) errs.push('без одометра Пробіг мав бути unavailable');
  if (b.score_dimensions.technical.score_available !== false || b.score_dimensions.technical.score !== null) {
    errs.push('фото без технічного evidence: technical мав бути unavailable, а не ' + JSON.stringify(b.score_dimensions.technical));
  }
  /* нема даних != 10/10: непідтверджені домени дають unavailable і null */
  b = score([], { identity_confirmed: true, photos_count: 3, basics_known: true, mileage_known: true, historical_listings_count: 1, mileage_observation_count: 0, auction_record_exists: false });
  for (const k of ['mileage', 'current_condition', 'technical']) {
    const d = b.score_dimensions[k];
    if (!d || d.score_available !== false || d.score !== null) errs.push('без даних вісь ' + k + ' мала бути unavailable/null: ' + JSON.stringify(d));
  }
  /* severe гірший за moderate у History і Damage & Repair */
  const sevDim = sevCase.score_dimensions;
  const modDim = accCase({ airbags: true, zones: 1 }, 'unknown').score_dimensions;
  if (!(modDim.history.score > sevDim.history.score)) errs.push('History: severe не гірший за moderate: ' + sevDim.history.score + ' vs ' + modDim.history.score);
  if (!(modDim.damage_repair.score > sevDim.damage_repair.score)) errs.push('Damage&Repair: severe не гірший за moderate');
  /* rollback значно гірший за конфлікт у Mileage (жорсткий кап осі) */
  const VEH = { odometer_km: 60000, age_months: 60, powertrain: 'petrol' };
  const confDim = score([F('MILEAGE_CONFLICT_UNEXPLAINED', 'm1')], RICH, { vehicle: VEH }).score_dimensions.mileage;
  const rollDim = score([F('ODOMETER_ROLLBACK', 'm2', { evidence: [ev('registry', null, 'скручений')] })], RICH, { vehicle: VEH }).score_dimensions.mileage;
  if (!(confDim.score - rollDim.score >= 3)) errs.push('Mileage: rollback мало відрізняється від конфлікту: ' + rollDim.score + ' vs ' + confDim.score);
  if (rollDim.score > 2.5 + 1e-9 || rollDim.rollback_cap_applied !== true) errs.push('Mileage: rollback-кап осі не застосований: ' + JSON.stringify(rollDim));
  /* конфлікт знижує рівно на сконфігуровану величину */
  const cleanDim = score([], RICH, { vehicle: VEH }).score_dimensions.mileage;
  if (Math.abs((cleanDim.score - confDim.score) - 1.5) > 0.051) errs.push('Mileage: конфлікт не -1.5: ' + cleanDim.score + ' -> ' + confDim.score);
  /* скрутка + конфлікт однієї underlying проблеми: не двічі, лише кап */
  const both = score([
    F('ODOMETER_ROLLBACK', 'm2', { evidence: [ev('registry', null, 'скручений')] }),
    F('MILEAGE_CONFLICT_UNEXPLAINED', 'm1'),
  ], RICH, { vehicle: VEH }).score_dimensions.mileage;
  if (both.integrity_adjustment !== 0) errs.push('Mileage: конфлікт оштрафований додатково до скрутки');
  if (both.score !== rollDim.score) errs.push('Mileage: подвійний рахунок скрутки і конфлікту');
  /* дуже низький км/рік не відмиває скрутку */
  const lowKmRoll = score([F('ODOMETER_ROLLBACK', 'm2', { evidence: [ev('registry', null, 'скручений')] })], RICH, { vehicle: { odometer_km: 20000, age_months: 120, powertrain: 'petrol' } }).score_dimensions.mileage;
  if (lowKmRoll.score > 2.5 + 1e-9) errs.push('Mileage: низький км/рік відмив скрутку: ' + lowKmRoll.score);

  /* ===== 19в. Пробіг: annual usage ratio як головний фактор ===== */
  const mil = (odo, months, pt, findings) => score(findings || [], RICH, { vehicle: { odometer_km: odo, age_months: months, powertrain: pt } }).score_dimensions.mileage;
  /* той самий 100k: 3-річний petrol гірший за 8-річний */
  const y3 = mil(100000, 36, 'petrol'), y8 = mil(100000, 96, 'petrol');
  if (!(y8.score - y3.score >= 2)) errs.push('100 тис.: 3-річний не гірший помітно за 8-річний: ' + y3.score + ' vs ' + y8.score);
  /* 180k у 20-річного petrol: дуже високий бал при чистій integrity
     (ratio 0.75 -> 9.1 за новим верхом кривої, мінус lifetime) */
  const old20 = mil(180000, 240, 'petrol');
  if (!(old20.score >= 8.8)) errs.push('180 тис. / 20 років мали дати >= 8.8: ' + old20.score);
  if (!(old20.lifetime_mileage_adjustment < 0 && old20.lifetime_mileage_adjustment >= -1.3)) errs.push('lifetime-коректор поза межами: ' + old20.lifetime_mileage_adjustment);
  /* чиста хронологія НЕ бонус: integrity_adjustment 0 */
  if (old20.integrity_adjustment !== 0) errs.push('чиста хронологія дала integrity-поправку');
  /* дизель кращий за petrol при тих самих віку/пробігу */
  if (!(mil(113000, 97, 'diesel').score > mil(113000, 97, 'petrol').score)) errs.push('дизельний reference не працює');
  /* annual-крива монотонна, десяткова, без bucket-стрибків */
  let prevA = null, aChanges = 0;
  for (let annualK = 8; annualK <= 40; annualK++) {
    const v = mil(annualK * 5000, 60, 'petrol');
    if (prevA !== null) {
      if (v.annual_base_score > prevA + 1e-9) errs.push('annual-крива не монотонна на ' + annualK + 'к/рік');
      /* дрібний крок 1к/рік: без bucket-стрибків, максимум плавний нахил */
      if (prevA - v.annual_base_score > 0.35) errs.push('bucket-стрибок annual-кривої на ' + annualK + 'к/рік: ' + prevA + ' -> ' + v.annual_base_score);
      if (Math.abs(prevA - v.annual_base_score) > 1e-9) aChanges++;
    }
    prevA = v.annual_base_score;
  }
  if (aChanges < 25) errs.push('annual-крива недостатньо неперервна: ' + aChanges);
  /* плавність за одометром при фіксованому віці */
  let prevS = null, sChanges = 0;
  for (const km of [100000, 105000, 110000, 115000, 120000, 125000, 130000]) {
    const v = mil(km, 96, 'petrol').score;
    if (prevS !== null) {
      if (v > prevS + 1e-9) errs.push('бал виріс зі зростанням пробігу: ' + km);
      if (prevS - v > 0.4) errs.push('сходинка завелика на ' + km);
      if (Math.abs(prevS - v) > 1e-9) sChanges++;
    }
    prevS = v;
  }
  if (sChanges < 4) errs.push('крива за одометром не плавна: ' + sChanges + ' зміни');
  /* lifetime малий, тільки негативний, ніколи не головний фактор */
  const life300 = mil(300000, 240, 'petrol');
  if (!(life300.lifetime_mileage_adjustment === -0.7)) errs.push('lifetime на 300 тис. мав бути -0.7: ' + life300.lifetime_mileage_adjustment);
  if (mil(50000, 60, 'petrol').lifetime_mileage_adjustment !== 0) errs.push('lifetime на 50 тис. мав бути 0');
  /* availability: одометр + вік ДОСТАТНЬО для числа; без історичних точок
     хронологія чесно insufficient_history, без бонусів і штрафів */
  b = score([], { ...RICH, mileage_observation_count: 0 }, { vehicle: VEH });
  const noHist = b.score_dimensions.mileage;
  if (noHist.score_available !== true) errs.push('без історичної точки Пробіг мав показуватись');
  if (noHist.integrity_state !== 'insufficient_history') errs.push('без історії integrity_state мав бути insufficient_history: ' + noHist.integrity_state);
  if (noHist.integrity_adjustment !== 0) errs.push('без evidence integrity дала поправку');
  const withHist = score([], RICH, { vehicle: VEH }).score_dimensions.mileage;
  if (withHist.integrity_state !== 'no_issues_found') errs.push('з історією integrity_state мав бути no_issues_found');
  if (noHist.score !== withHist.score) errs.push('відсутність історії змінила число (бонус/штраф без evidence)');
  if (score([F('ODOMETER_ROLLBACK', 'm2', { evidence: [ev('registry', null, 'скручений')] })], { ...RICH, mileage_observation_count: 0 }, { vehicle: VEH }).score_dimensions.mileage.integrity_state !== 'issue_found') errs.push('rollback без історичних точок не позначився issue_found');
  /* без надійного віку: unavailable */
  b = score([], RICH, { vehicle: { odometer_km: 60000, age_months: null, powertrain: 'petrol' } });
  if (b.score_dimensions.mileage.score_available !== false) errs.push('без віку Пробіг мав бути unavailable');
  /* ===== 19в2. верх кривої: 10.0 лише за нульовий пробіг ===== */
  /* нульовий одометр: 10.0 дозволена, вік сам по собі не штраф */
  if (mil(0, 240, 'petrol').score !== 10) errs.push('нульовий пробіг у 20-річного мав дати 10.0: ' + mil(0, 240, 'petrol').score);
  /* будь-який ненульовий пробіг НІКОЛИ не показується як 10.0 */
  for (const [odoV, m] of [[1000, 240], [500, 12], [1200, 12], [100, 6]]) {
    const v = mil(odoV, m, 'petrol');
    if (v.score >= 10) errs.push('ненульовий пробіг ' + odoV + ' показаний як 10.0');
  }
  /* приклади верху кривої (petrol reference 12000, вік 12 міс.) */
  const topCase = kmYear => mil(kmYear, 12, 'petrol');
  for (const [kmY, want] of [[1200, 9.9], [3000, 9.6], [4800, 9.5], [6000, 9.4], [7200, 9.3], [9000, 9.1], [10800, 9.0], [12000, 8.8]]) {
    const v = topCase(kmY).score;
    if (Math.abs(v - want) > 0.051) errs.push('верх кривої: ' + kmY + ' км/рік мав дати ' + want + ', а не ' + v);
  }
  /* acceptance: 20 років / 60 тис. = 3 тис. км/рік -> ~9.6, точно НЕ 10 */
  const gq = mil(60000, 240, 'petrol');
  if (!(gq.score >= 9.5 && gq.score <= 9.7)) errs.push('20 років / 60 тис. поза ~9.6: ' + gq.score);
  if (gq.score >= 10) errs.push('20 років / 60 тис. показані як 10.0');
  /* неперервність верху: монотонно, плавно, без bucket-стрибків, десяткові */
  const topRatios = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.00];
  let prevT = null, tChanges = 0;
  const seenT = new Set();
  for (const r of topRatios) {
    const v = topCase(Math.round(r * 12000)).annual_base_score;
    seenT.add(Math.round(v * 10) / 10);
    if (prevT !== null) {
      if (v > prevT + 1e-9) errs.push('верх кривої не монотонний на ratio ' + r);
      if (prevT - v > 0.35) errs.push('bucket-стрибок верху кривої на ratio ' + r + ': ' + prevT + ' -> ' + v);
      if (Math.abs(prevT - v) > 1e-9) tChanges++;
    }
    prevT = v;
  }
  if (tChanges < 8) errs.push('верх кривої недостатньо неперервний: ' + tChanges);
  if (seenT.size < 8) errs.push('верх кривої дає замало різних десяткових значень: ' + seenT.size);
  /* значення МІЖ якорями теж існують (не лише самі якорі) */
  const mid = topCase(Math.round(0.175 * 12000)).annual_base_score;
  if (!(mid < 9.9 - 1e-9 && mid > 9.6 + 1e-9)) errs.push('між якорями нема проміжних значень: ' + mid);

  /* компоненти діагностики */
  const bmw113 = mil(113000, 98, 'petrol');
  for (const k of ['current_odometer_km', 'age_source', 'vehicle_age_months', 'vehicle_age_years', 'powertrain_class', 'reference_km_year', 'annual_mileage_km', 'usage_ratio', 'annual_base_score', 'lifetime_mileage_adjustment', 'integrity_adjustment', 'rollback_cap_applied', 'final_score']) {
    if (!(k in bmw113)) errs.push('у осі Пробіг нема компонента ' + k);
  }
  if (!(bmw113.score >= 8.0 && bmw113.score <= 8.5)) errs.push('BMW 113 тис. / ~8.2 року поза low-8 смугою: ' + bmw113.score);

  /* ===== 19г. вік: пріоритет джерел, УКРАЇНСЬКА реєстрація не вік ===== */
  const { resolveVehicleAge } = M;
  const NOW = Date.UTC(2026, 7, 30);
  let ag = resolveVehicleAge({ first_use_date: '2019-03-15', production_date: '2018-11-01', model_year: 2018 }, NOW);
  if (ag.age_source !== 'first_registration' || Math.abs(ag.age_months - 89) > 1) errs.push('пріоритет first_registration зламаний: ' + JSON.stringify(ag));
  ag = resolveVehicleAge({ production_date: '2018-11-01', model_year: 2018 }, NOW);
  if (ag.age_source !== 'production_date') errs.push('пріоритет production_date зламаний');
  ag = resolveVehicleAge({ model_year: 2018 }, NOW);
  if (ag.age_source !== 'model_year_midpoint' || Math.abs(ag.age_months - 98) > 1) errs.push('midpoint-fallback зламаний: ' + JSON.stringify(ag));
  if (resolveVehicleAge({}, NOW).age_months !== null) errs.push('без жодної дати вік мав бути null');

  /* історичне ДТП САМО не знижує Стан за фото: та сама база, що в чистої */
  if (sevDim.current_condition.score !== C_DIM.CC_BASE_DEFAULT) errs.push('історичне ДТП знизило current_condition: ' + sevDim.current_condition.score);
  /* generic болячка моделі не є технічним evidence: відкидається на вході
     і вісь лишається недоступною, а не оціненою */
  b = score([{ type: 'MODEL_GENERIC_WEAKNESS', event_id: 'g1', evidence: [ev('seller_claim', null, 'слабкі ланцюги у моделі')] }], RICH);
  if (b.score_dimensions.technical.score_available !== false) errs.push('generic болячка відкрила technical: ' + JSON.stringify(b.score_dimensions.technical));
  /* поточні проблеми працюють по своїх осях */
  b = score([F('POOR_REPAIR_VISIBLE', 'pr1'), F('CRITICAL_WARNING_LIGHTS', 'w9', { evidence: [ev('current_photos', 'photo_2', 'горить ABS')] })], RICH);
  if (!(b.score_dimensions.current_condition.score < 10)) errs.push('current_condition не відреагував на видимі проблеми');
  b = score([F('SERIOUS_POWERTRAIN_FAULT', 'p1'), F('MODIFICATION_TECHNICAL_CONCERN', 'md1', { serious_intervention: true, maintenance_evidence: false })], RICH);
  if (!(b.score_dimensions.technical.score < 10)) errs.push('technical не відреагував на несправність і тюнінг');

  /* ===== 19б. Vision structural gate: possible проти confirmed ===== */
  const hvPossible = { structural_visual_status: 'indeterminate', possible_structural_damage: true, srs_visual_status: 'deployed_visible', major_deformation_visible: true, visible_damage_zones: ['зона правого порога', 'правые двери'], evidence: [{ source: 'us_auction', description: 'пошкоджена зона зовнішнього порога, внутрішній силовий елемент не видно' }] };
  /* зовнішній rocker без видимого силового елемента: НЕ structural, БЕЗ капа */
  b = score([F('AIRBAGS_DEPLOYED', 'acc_x', { evidence: [ev('us_auction', 'auction_photo_1', 'подушки')], repair_status: 'unknown' })], RICH, { historicalVisual: hvPossible, auctionMeta: { lot_id: '7', house: 'IAAI', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null } });
  const psEvent = b.accident_events[0];
  if (!psEvent || psEvent.structural !== false) errs.push('possible structural створив structural');
  if (!psEvent || psEvent.possible_structural !== true) errs.push('possible_structural не прокинувся в подію');
  if (b.applied_hard_caps.some(c => c.name.includes('STRUCTURAL'))) errs.push('possible structural активував кап 5.5');
  if (b.accident_events[0].severity_basis.includes('structural_damage')) errs.push('possible structural потрапив у severity_basis як structural');
  /* possible-флаг НЕ впливає на числовий бал */
  const noFlag = score([F('AIRBAGS_DEPLOYED', 'acc_x', { evidence: [ev('us_auction', 'auction_photo_1', 'подушки')], repair_status: 'unknown' })], RICH, { historicalVisual: { ...hvPossible, possible_structural_damage: false }, auctionMeta: { lot_id: '7', house: 'IAAI', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null } });
  if (noFlag.final !== b.final) errs.push('possible_structural_damage змінив бал: ' + b.final + ' vs ' + noFlag.final);
  /* явно ідентифікований деформований силовий елемент: visible_damage -> кап */
  const hvStrong = { ...hvPossible, structural_visual_status: 'visible_damage', possible_structural_damage: false };
  b = score([], RICH, { historicalVisual: hvStrong, auctionMeta: { lot_id: '7', house: 'IAAI', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null } });
  if (!b.applied_hard_caps.some(c => c.name.includes('STRUCTURAL_UNRESOLVED'))) errs.push('visible_damage не активував structural кап');
  if (!(b.final <= C.STRUCTURAL_UNRESOLVED_CAP)) errs.push('structural кап не тримає при visible_damage');
  /* прикметник "severe"/глибока деформація без ідентифікованого елемента: не structural */
  b = score([], RICH, { historicalVisual: { structural_visual_status: 'indeterminate', visible_severity: 'severe', major_deformation_visible: true, srs_visual_status: 'not_visible', visible_damage_zones: ['борт'], evidence: [{ source: 'us_auction', description: 'сильна деформація боковини' }] }, auctionMeta: { lot_id: '7', house: 'IAAI', sale_date: null, airbags: null, primary_damage: null, secondary_damage: null } });
  if (b.applied_hard_caps.some(c => c.name.includes('STRUCTURAL'))) errs.push('прикметник тяжкості активував structural кап');
  /* structural з надійного НЕ-Vision джерела працює як раніше */
  b = score([F('STRUCTURAL_DAMAGE', 'acc_reg', { evidence: [ev('registry', null, 'запис реєстру: пошкодження лонжерона')], repair_status: 'unknown' })], RICH);
  if (!b.applied_hard_caps.some(c => c.name.includes('STRUCTURAL_UNRESOLVED'))) errs.push('non-Vision structural перестав давати кап');
  if (b.accident_events[0].derived_severity !== 'severe') errs.push('non-Vision structural перестав давати severe');

  /* ===== 20. дайджест для AI-висновку: точні бекенд-числа ===== */
  const digest = buildScoreDigest(sevCase);
  if (!digest) errs.push('дайджест не побудований');
  if (digest) {
    if (digest.calcar_score !== sevCase.final) errs.push('дайджест: calcar_score != final');
    for (const d of digest.dimensions) {
      if (d.score !== sevCase.score_dimensions[d.key].score) errs.push('дайджест: бал осі ' + d.key + ' не збігається з бекендом');
      if (!DIMENSION_LABELS[d.key] || d.label_ua !== DIMENSION_LABELS[d.key]) errs.push('дайджест: нема UA-мітки для ' + d.key);
    }
    if (!digest.weakest.length) errs.push('дайджест: weakest порожній для severe-кейса');
    if (digest.dimensions.some(d => d.key === 'technical')) errs.push('дайджест: недоступний technical потрапив у дайджест (AI не має його цитувати)');
    if (!digest.applied_hard_caps.some(c => c.includes('STRUCTURAL'))) errs.push('дайджест: кап не переданий');
  }
  /* недоступна вісь у дайджест не потрапляє взагалі */
  const thinDigest = buildScoreDigest(score([], { identity_confirmed: true, photos_count: 3, basics_known: true, mileage_known: true, historical_listings_count: 1, mileage_observation_count: 0 }));
  if (thinDigest && thinDigest.dimensions.some(d => ['mileage', 'current_condition', 'technical'].includes(d.key))) errs.push('дайджест містить недоступні осі');
  /* переusage старого computeSubscores заборонений */
  for (const f of ['api/check.js', 'api/score.js', 'api/score-v3.js', 'api/chat.js']) {
    if (/computeSubscores/.test(fs.readFileSync(f, 'utf8'))) errs.push(f + ': computeSubscores не має існувати в новому pipeline');
  }

  /* ===== 21. сторожі диспетчера і приватності ===== */
  const checkSrc = fs.readFileSync('api/check.js', 'utf8');
  if (!/CALCAR_SCORE_VERSION/.test(checkSrc)) errs.push('check.js: нема перемикача CALCAR_SCORE_VERSION');
  if (!/parsed\.score_breakdown = breakdown/.test(checkSrc)) errs.push('check.js: канонічне поле score_breakdown не пишеться');
  if (!/parsed\.active_score_version = SCORE_VERSION/.test(checkSrc)) errs.push('check.js: active_score_version не пишеться');
  if (!/COMPATIBILITY/.test(checkSrc)) errs.push('check.js: compatibility alias не задокументований');
  if (!/score_breakdown_shadow/.test(checkSrc)) errs.push('check.js: тіньова версія не зберігається');
  if (!/computeScoreV3/.test(checkSrc)) errs.push('check.js: v3 не викликається');
  if (!/computeScore\(/.test(checkSrc)) errs.push('check.js: v2 більше не рахується (мала лишитись)');
  if (!fs.existsSync('api/score.js')) errs.push('api/score.js видалений: v2 мала жити поруч');
  const chatSrc = fs.readFileSync('api/chat.js', 'utf8');
  if (!/delete c\.score_breakdown_shadow/.test(chatSrc)) errs.push('chat.js: тіньовий breakdown не вирізається з контексту чату');
  if (!/delete c\.score_breakdown;/.test(chatSrc)) errs.push('chat.js: канонічний breakdown не вирізається з контексту чату');
  const pageSrc = fs.readFileSync('result-check.html', 'utf8');
  if (!/D\.score_breakdown \|\| D\.score_breakdown_v2/.test(pageSrc)) errs.push('result-check: читач не переведений на канонічне поле з alias-фолбеком');
  if (!/Низький виявлений ризик/.test(pageSrc)) errs.push('result-check: risk-wording рівня нема');
  if (!/Аукціонних записів у перевірених джерелах не знайдено/.test(pageSrc)) errs.push('result-check: нейтральне повідомлення checked_absent нема');
  /* AI-висновок: старий стиль головного виклику; числові підоцінки в текст
     не вплітаються; в кінці ОДНА фраза з точним бекенд-балом */
  if (/buildScoreDigest|nPrompt/.test(checkSrc)) errs.push('check.js: залишки narrative-переписування');
  if (!/Оцінка CalCar цього автомобіля становить/.test(checkSrc)) errs.push('check.js: нема фінальної фрази з балом (ua)');
  if (!/оценка CalCar этого автомобиля составляет/.test(checkSrc)) errs.push('check.js: нема фінальної фрази з балом (ru)');
  if (!/CalCar Score of this car is/.test(checkSrc)) errs.push('check.js: нема фінальної фрази з балом (en)');
  if (!/vehicle: vehicleV3/.test(checkSrc)) errs.push('check.js: vehicle-вхід осі Пробіг не передається');
  /* картка підоцінок: пʼять міток на сторінці і в обох словниках */
  const ruDict = fs.readFileSync('i18n/ru.js', 'utf8');
  const enDict = fs.readFileSync('i18n/en.js', 'utf8');
  for (const lbl of ['Історія авто', 'Пробіг', 'Пошкодження та відновлення', 'Стан за фото']) {
    if (!pageSrc.includes("'" + lbl + "'")) errs.push('result-check: мітка осі відсутня: ' + lbl);
    if (!ruDict.includes("'" + lbl + "'")) errs.push('ru.js: нема перекладу мітки ' + lbl);
    if (!enDict.includes("'" + lbl + "'")) errs.push('en.js: нема перекладу мітки ' + lbl);
  }
  /* Технічні ризики свідомо приховані з popover (бекенд-вісь лишається) */
  if (/\['technical'/.test(pageSrc)) errs.push('result-check: technical лишився в popover ORDER');
  /* affordance і межі подій щита/бейджа */
  if (!/dim-caret/.test(pageSrc)) errs.push('result-check: нема caret-affordance на бейджі');
  if (!/has-dims\{cursor:pointer\}/.test(pageSrc.replace(/\s/g, ''))) errs.push('result-check: бейдж без cursor:pointer');
  if (!/shieldEl\.contains\(e\.target\)/.test(pageSrc)) errs.push('result-check: межі подій щита не розділені');
  /* coachmark чату: одноразовий, з localStorage-прапорцем */
  if (!/calcar_chat_hint_seen/.test(pageSrc)) errs.push('result-check: coachmark без localStorage-прапорця');
  if (!/Можна спитати про це авто/.test(pageSrc)) errs.push('result-check: нема тексту coachmark');
  /* середній пробіг за рік: ТІ САМІ canonical-дані осі Пробіг */
  if (!/annual_mileage_km/.test(pageSrc)) errs.push('result-check: річний пробіг не з breakdown осі');
  if (!/Середній пробіг за місяць за весь строк експлуатації автомобіля\./.test(pageSrc)) errs.push('result-check: нема tooltip місячного пробігу');
  /* реєстраційні події історії */
  if (!/reg-badge/.test(pageSrc) || !/перереєстрац\|перерегистрац/.test(pageSrc)) errs.push('result-check: нема виділення перереєстрацій');
  /* старий вигляд Score відновлений: окремої картки більше нема, лише popover */
  if (/dimCard|dim-wrap|dim-track|dimLimit/.test(pageSrc)) errs.push('result-check: залишки окремої картки підоцінок');
  if (!/dim-pop/.test(pageSrc)) errs.push('result-check: popover підоцінок відсутній');
  if (!/mouseenter/.test(pageSrc) || !/tabIndex = 0|tabindex/.test(pageSrc)) errs.push('result-check: popover без hover/focus');
  /* Vision structural gate: строгі правила в промпті + страхувальний хід */
  if (!/STRONG structural evidence/.test(checkSrc)) errs.push('check.js: нема gate STRONG structural evidence у промпті');
  if (!/possible_structural_damage/.test(checkSrc)) errs.push('check.js: нема сигналу possible_structural_damage');
  if (!/"сильно пошкоджений поріг"/.test(checkSrc)) errs.push('check.js: нема явного прикладу недостатнього evidence (поріг)');
  if (!/Потенційно структурна зона удару/.test(checkSrc)) errs.push('check.js: нема детермінованого fallback-ризику possible structural');
  if (!/possible_structural_damage: hv\.possible_structural_damage === true && hv\.structural_visual_status !== 'visible_damage'/.test(checkSrc)) errs.push('check.js: sanitize не гейтить possible проти visible_damage');
  for (const key of ['Стан за фото']) {
    if (!ruDict.includes("'" + key + "'")) errs.push('ru.js: нема перекладу ' + key);
    if (!enDict.includes("'" + key + "'")) errs.push('en.js: нема перекладу ' + key);
  }

  fs.unlinkSync(tmp);
  if (errs.length) {
    console.error('SCORE V3 TEST FAILED:');
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('score v3 tests passed');
})().catch(e => { console.error('SCORE V3 TEST CRASHED:', e); process.exit(1); });
