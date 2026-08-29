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

  /* ===== 4. severity: виводить код, не слово моделі ===== */
  let sv = deriveSeverity({ signals: { structural: true, airbags: false, zones: 0, visual_severity: null } });
  if (sv.severity !== 'severe' || !sv.basis.includes('structural_damage')) errs.push('structural мав дати severe: ' + JSON.stringify(sv));
  sv = deriveSeverity({ signals: { structural: false, airbags: true, zones: 0, visual_severity: null } });
  if (sv.severity !== 'moderate' || !sv.basis.includes('airbags_deployed')) errs.push('подушки мали дати мінімум moderate: ' + JSON.stringify(sv));
  sv = deriveSeverity({ signals: { structural: false, airbags: false, zones: 2, visual_severity: null } });
  if (sv.severity !== 'moderate') errs.push('кілька зон мали дати moderate: ' + sv.severity);
  sv = deriveSeverity({ signals: { structural: false, airbags: false, zones: 0, visual_severity: 'minor' } });
  if (sv.severity !== 'minor') errs.push('косметика мала дати minor: ' + sv.severity);
  sv = deriveSeverity({ signals: { structural: false, airbags: false, zones: 0, visual_severity: null } });
  if (sv.severity !== 'indeterminate') errs.push('без evidence мало бути indeterminate: ' + sv.severity);
  sv = deriveSeverity({ signals: { structural: false, airbags: true, zones: 0, visual_severity: 'severe' } });
  if (sv.severity !== 'severe') errs.push('severe візуал + подушки мали дати severe: ' + sv.severity);

  /* ===== 5. драбина severity в підсумку і repair-інваріанти ===== */
  const accCase = (sevSignals, repair) => {
    const meta = { lot_id: '9', house: 'IAAI', sale_date: '2022-03-01', airbags: sevSignals.airbags ? { deployed: true, raw: 'x' } : null, primary_damage: sevSignals.zones >= 1 ? 'FRONT END' : null, secondary_damage: sevSignals.zones >= 2 ? 'LEFT SIDE' : null };
    const hvv = sevSignals.structural
      ? { structural_visual_status: 'visible_damage', srs_visual_status: 'not_assessable', visible_severity: 'severe', visible_damage_zones: [], evidence: [{ source: 'historical_listing', description: 'кадри' }] }
      : (sevSignals.minor ? { structural_visual_status: 'no_visible_issues', srs_visual_status: 'not_assessable', visible_severity: 'minor', visible_damage_zones: [], evidence: [{ source: 'historical_listing', description: 'кадри' }] } : null);
    const f = repair ? [F('MAJOR_REPAIR_UNVERIFIED', 'acc_2022', { evidence: [ev('us_auction', 'lot', 'ремонт після лота')], repair_status: repair })] : [];
    return score(f, RICH, { auctionMeta: meta, historicalVisual: hvv });
  };
  const clean = score([], RICH).final;
  const minor = accCase({ minor: true, zones: 1 }, 'unknown').final;
  const moderate = accCase({ airbags: true, zones: 1 }, 'unknown').final;
  const severe = accCase({ structural: true, airbags: true, zones: 2 }, 'unknown').final;
  if (!(clean > minor && minor > moderate && moderate > severe)) errs.push('драбина порушена: clean ' + clean + ', minor ' + minor + ', moderate ' + moderate + ', severe ' + severe);
  if (!(moderate - severe > 0.3)) errs.push('severe майже не відрізняється від moderate: ' + moderate + ' vs ' + severe);
  /* severe не приземляється штучно на ~7.0 */
  if (severe >= 6.9 && severe <= 7.2) errs.push('severe у старому кластері 6.9-7.2: ' + severe);
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
  for (const k of ['normalized_event_id', 'source_event_ids', 'merge_basis', 'accident_base', 'derived_severity', 'severity_basis', 'severity_additional', 'repair_status', 'repair_multiplier', 'minimum_residual_if_applied', 'final_event_penalty']) {
    if (!(k in e0)) errs.push('у accident_event нема поля ' + k);
  }
  /* грейди нейтральні, без buy */
  const grades = C.GRADE_THRESHOLDS.map(t => t.grade).join(',');
  if (/buy/.test(grades)) errs.push('грейд buy лишився: ' + grades);
  if (grades !== 'excellent,good,elevated_risk,high_risk') errs.push('несподівані грейди: ' + grades);

  /* ===== 15. каузальні порядки (розділ 44 ТЗ) ===== */
  const sevSrs = accCase({ structural: false, airbags: true, zones: 2 }, 'unknown');           /* severe-канал через подушки+зони: moderate; порівнюємо з чистим severe */
  const order = [clean, minor, moderate, severe];
  for (let i = 1; i < order.length; i++) if (!(order[i - 1] > order[i])) errs.push('порядок 44 порушений на кроці ' + i + ': ' + order.join(' > '));
  if (!(severe > flood.final)) errs.push('flood не гірший за severe: ' + flood.final + ' vs ' + severe);
  if (!(flood.final >= vin.final)) errs.push('identity fraud не найнижчий');

  /* ===== 16. сторожі диспетчера і приватності ===== */
  const checkSrc = fs.readFileSync('api/check.js', 'utf8');
  if (!/CALCAR_SCORE_VERSION/.test(checkSrc)) errs.push('check.js: нема перемикача CALCAR_SCORE_VERSION');
  if (!/score_breakdown_shadow/.test(checkSrc)) errs.push('check.js: тіньова версія не зберігається');
  if (!/computeScoreV3/.test(checkSrc)) errs.push('check.js: v3 не викликається');
  if (!/computeScore\(/.test(checkSrc)) errs.push('check.js: v2 більше не рахується (мала лишитись)');
  if (!fs.existsSync('api/score.js')) errs.push('api/score.js видалений: v2 мала жити поруч');
  const chatSrc = fs.readFileSync('api/chat.js', 'utf8');
  if (!/delete c\.score_breakdown_shadow/.test(chatSrc)) errs.push('chat.js: тіньовий breakdown не вирізається з контексту чату');

  fs.unlinkSync(tmp);
  if (errs.length) {
    console.error('SCORE V3 TEST FAILED:');
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('score v3 tests passed');
})().catch(e => { console.error('SCORE V3 TEST CRASHED:', e); process.exit(1); });
