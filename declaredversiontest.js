/* Declared version semantics (api/vehicle-spec.js identityStatus, conclusion
   rules, checklist merge, value provenance). Production 2026-10-12: a
   Mercedes-AMG GLE 43 whose listing modification was "AMG 43 G-tronic
   (390 к.с.) 4Matic" got version_status unknown (the version was never
   extracted from the powertrain-shaped string), so the Final Conclusion
   opened with "first find out whether this really is a GLE 43".
   NOT INDEPENDENTLY VERIFIED is not CONTRADICTED: a version the listing
   states without contradiction is the car's working name (declared); it is
   confirmed only with the clean decoder; a conflict needs incompatible
   evidence; unknown means nothing was stated.

   Run: node declaredversiontest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_dv_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'vehicle-spec.js'));
  const SC = await import('file://' + path.join(dir, 'api', 'score-ceiling.js'));
  const CF = await import('file://' + path.join(dir, 'api', 'confidence.js'));
  const CM = await import('file://' + path.join(dir, 'api', 'checklist-merge.js'));
  const FC = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const V = await import('file://' + path.join(dir, 'api', 'value.js'));
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const driveLabel = v => ({ awd: 'полный', fwd: 'передний', rwd: 'задний' }[v] || null);
  const build = (nhtsa, listing, analysis) => M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa, listing }), analysis, { nhtsa, listing });
  const report = (spec, vehicle = {}, extra = {}) => ({ vehicle, risks: [], checklist: ['Кузов и подушки безопасности: проверить после страховых случаев.'], discrepancies: [], confidence: { overall_internal: 72, text_key: 'Enough data' }, _meta: { lang: 'ru', vehicle_spec: M.publicSpec(spec), history_facts: {}, decision_inputs: { mileage_context: {} } }, score_breakdown: { events: [], inputs: {}, score_version: 'v4', final: 7.7, score_available: true }, ...extra });
  const rules = fs.readFileSync('api/conclusion.js', 'utf8');

  /* ---- the declared version is read from the marketplace modification ---- */
  for (const [mod, want] of [['AMG 43 G-tronic (390 к.с.) 4Matic', 'AMG 43'], ['35i Steptronic (306 к.с.) xDrive', '35i'], ['30d Steptronic (258 к.с.) xDrive', '30d'], ['400d G-tronic (330 к.с.) 4Matic', '400d'], ['X 63 AT (557 к.с.)', 'X 63'], ['50 TDI Tiptronic (286 к.с.) Quattro', '50 TDI'],
    ['Long Range 82 kWh Dual Motor (384 к.с.) AWD', 'Long Range Dual Motor'], ['Performance 82.5 kWh (510 к.с.) AWD', 'Performance'], ['eDrive40 83.9 kWh (340 к.с.)', 'eDrive40'], ['Standard Plus 54kWh (241 к.с.)', 'Standard Plus'],
    ['2.5 ECVT (219 к.с.) Hybrid', null], ['2.0 Td4 MHEV AT (163 к.с.) AWD', null], ['2.5 Xtronic (191 к.с.) AWD', null], ['1.8 TSI AT (170 к.с.)', null], ['2.3 Ecoboost turbo АТ (314 к.с.) RWD', null], ['3.0 TDI quattro', null], ['RWD (408 к.с.)', null], ['New 1.5D AT (120 к.с.)', null], ['', null]]) {
    ok('1. declared version from modification: ' + JSON.stringify(mod) + ' -> ' + JSON.stringify(want), M.declaredVersionFromModification(mod) === want, JSON.stringify(M.declaredVersionFromModification(mod)));
  }
  ok('1a. version names agree on words, not substrings: "AMG 43" and "GLE 43 AMG" with model words skipped; "S" and "GTS" differ; "GL63 AMG" and "GL63" agree', M.versionCompatible('AMG 43', 'GLE 43 AMG', new Set(['gle', 'class'])) && !M.versionCompatible('S', 'GTS') && M.versionCompatible('GL63 AMG', 'GL63') && !M.versionCompatible('530i xDrive', 'Sport Line') && M.versionCompatible('Premium', 'Premium Plus'));

  /* ---- A. DECLARED, NO CONFLICT (the GLE shape: weak decoder, listing names the version, analysis repeats the seller) ---- */
  const gleDec = { Make: 'MERCEDES-BENZ', ErrorCode: '1,8' };
  const gleLst = { make: 'mercedes benz', model: 'gle class', year: 2018, country: 'UA', generation: 'W166', modification: 'AMG 43 G-tronic (390 к.с.) 4Matic', title: 'Mercedes-Benz GLE-Class 2018 бензин 3', text: 'GLE 43 AMG з потужним 3.0 BiTurbo на 390 к.с. Модифікація W166, AMG 43 G-tronic (390 к.с.) 4Matic Двигун Бензин, 3 л, (530.4 к.с. / 390 кВт) Привід Повний' };
  const gleAna = { fuel: 'petrol', trim: 'GLE 43 AMG', year: 2018, drive: 'полный', title: 'Mercedes-Benz GLE-Class 2018', engine: '3.0 л бензин Biturbo', generation: 'W166' };
  let s = build(gleDec, gleLst, gleAna);
  ok('A1. listing-declared version with no contradiction is declared, not a conflict and not unknown', s.version.value === 'AMG 43' && !s.version.conflict && s.identity.version_status === 'declared' && s.identity.declared_fields.includes('version'), JSON.stringify([s.version, s.identity]));
  ok('A2. the seller wording "GLE 43 AMG" and the modification "AMG 43" are one version, so the analysis candidate agrees', s.version.candidates.filter(c => c.value).length === 2 && !s.version.conflict);
  ok('A3. declared is not confirmed internally: no decoder among its sources, not in confirmed_fields', !String(s.version.source).includes('decoder') && !s.identity.confirmed_fields.includes('version'));
  ok('A4. the small site power discrepancy (390 PS vs "530.4 к.с. / 390 кВт") stays a power item and does not touch the version', s.power_hp.conflict && s.identity.version_status === 'declared' && !s.conflicts.includes('version'), JSON.stringify(s.conflicts));
  ok('A5. identity status overall stays resolved at the core (the car is known)', s.identity.core_status === 'resolved' && SC.coreIdentityConflicts(s).length === 0);
  let veh = { ...gleAna, trim: null };
  M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('A6. header shows the declared version as the working name', veh.trim === 'AMG 43', JSON.stringify(veh));
  let ctx = FC.buildConclusionContext(report(s, veh)).vehicle;
  ok('A7. FC context carries the version as the working label with version_status declared', ctx.version === 'AMG 43' && ctx.identity_status.version_status === 'declared' && !ctx.identity_conflicts.includes('version'), JSON.stringify([ctx.version, ctx.identity_status]));
  ok('A8. FC rules: declared is the working identity, no "if this really is X", no request to confirm; conflict names the contradiction; unknown is not invented', /version_status declared: the version the listing states is the car's working identity/.test(rules) && /do not write "if this really is X"/.test(rules) && /version_status conflict: name the concrete contradiction/.test(rules) && /version_status unknown: no version is stated, do not invent one/.test(rules) && !/with version_status conflict or unknown never name a version as an established fact/.test(rules));
  ok('A8a. FC checks rule: a declared, uncontradicted version is not an identity check', /a declared, uncontradicted version is not one/.test(rules));
  ok('A9. Confidence label gets no identity note for a declared version', CF.identityNoteKey(s.identity) === null);
  let r = report(s, veh);
  let log = CM.mergeChecklist(r, { fcChecks: [{ text: 'Подтвердить версию по VIN у дилера: действительно ли это GLE 43 AMG.', area: 'identity', refines: null }], snapshot: null, lang: 'ru' });
  ok('A10. checklist: no automatic identity step, and an FC "confirm the version" check is skipped as identity_not_in_conflict', !r.checklist.some(t => /^(Версия|Модель)/.test(t) || /действительно ли это/.test(t)) && log.skipped.some(x => x.reason === 'identity_not_in_conflict'), JSON.stringify([r.checklist, log.skipped]));
  ok('A11. the main analysis prompt names the declared version as the working name and forbids "if this really is"', /ВЕРСІЯ ЗАЯВЛЕНА[^\n]*"AMG 43"/.test(M.vehicleSpecPromptBlock(s)) && !/НЕВІДОМО[^\n]*version/.test(M.vehicleSpecPromptBlock(s)));
  let curve = V.buildValueCurve({ price: 35000, currency: 'USD', year: 2018, candidates: [], vehicle: {}, identity: { make: 'mercedes benz', model: 'gle class', trim: s.version.value, version_status: s.identity.version_status } });
  ok('A12. Market Value: the declared version is passed for matching, and the provenance says declared, never confirmed', curve.new_price.version_status === 'declared', JSON.stringify(curve.new_price));
  ok('A12a. the page tells the reader the version is the listing\'s when a list price is matched to a declared version', /version_status === 'declared'/.test(fs.readFileSync('result-check.html', 'utf8')) && /'The version is the one stated in the listing.'/.test(fs.readFileSync('i18n/ru.js', 'utf8')) && /'The version is the one stated in the listing.'/.test(fs.readFileSync('i18n/ua.js', 'utf8')));
  ok('A13. MI: a declared version does not become version_trusted (decoder-only trust is unchanged)', /version_trusted: spec0\.decoder\.strong && !!\(nhtsa && \(nhtsa\.Trim \|\| nhtsa\.Series\)\)/.test(fs.readFileSync('api/check.js', 'utf8')));
  ok('A14. gate: declared version is trusted enough that "the version is not established" is struck, while "the listing states GLE 43" stands', RC.sentenceViolations('Версия автомобиля не установлена.', RC.canonicalFacts(report(s, veh))).some(v => v.domain === 'version') && RC.sentenceViolations('В объявлении указана версия GLE 43 AMG.', RC.canonicalFacts(report(s, veh))).length === 0);

  /* ---- B. CONFIRMED (BMW 3 regression: decoder Series as line, Model + Trim as version) ---- */
  const bmwDec = { Make: 'BMW', Model: '328i', Series: '3-Series', Trim: 'xDrive', ModelYear: '2015', FuelTypePrimary: 'Gasoline', EngineHP: '240', DisplacementL: '2.00', DriveType: 'AWD/All-Wheel Drive', ErrorCode: '0' };
  const bmwLst = { make: 'bmw', model: '3 series', year: 2014, modification: null, title: 'BMW 3 Series 2014', country: 'UA', text: 'Двигун Бензин, 2 л, (245 к.с. / 180 кВт) Коробка передач Автомат Привід Повний' };
  const bmwAna = { title: 'BMW 3 Series 2014', trim: '328i xDrive', year: 2014, model_year: 2015, fuel: 'petrol', engine: '2,0 л бензин, 243 л.с.', transmission: 'автоматическая', drive: 'полный', generation: 'F30' };
  s = build(bmwDec, bmwLst, bmwAna);
  ok('B1. BMW 3 stays confirmed: version 328i xDrive, identity resolved, Score eligible', s.version.value === '328i xDrive' && s.identity.version_status === 'confirmed' && s.identity.status === 'resolved' && SC.coreIdentityConflicts(s).length === 0 && s.model.value === '3-Series', JSON.stringify(s.identity));
  const cayDec = { Make: 'PORSCHE', Model: 'Cayenne', Series: 'GTS', ModelYear: '2016', FuelTypePrimary: 'Gasoline', DisplacementL: '3.6', EngineHP: '440', ErrorCode: '0' };
  const cayLst = { make: 'porsche', model: 'cayenne', year: 2015, modification: '958 (FL)', title: 'Porsche Cayenne 2015', country: 'UA', text: 'Porsche Cayenne 2015 GTS 3.6 440 к.с.' };
  const cayAna = { title: 'Porsche Cayenne 2015', trim: 'GTS', year: 2015, model_year: 2016, fuel: 'petrol', engine: '3.6 л бензин, 440 л.с.', transmission: 'автомат', drive: 'полный' };
  s = build(cayDec, cayLst, cayAna);
  veh = { ...cayAna }; const before = JSON.stringify(veh); M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('B2. fully confirmed car unchanged: GTS confirmed, header untouched, no note, no identity step', s.identity.version_status === 'confirmed' && s.identity.status === 'resolved' && JSON.stringify(veh) === before && CF.identityNoteKey(s.identity) === null, JSON.stringify(s.identity));

  /* ---- C. REAL CONFLICT (decoder 530i xDrive vs analysis Sport Line) ---- */
  const verDec = { Make: 'BMW', Model: '530i', Series: '5-Series', Trim: 'xDrive', ModelYear: '2019', FuelTypePrimary: 'Gasoline', DisplacementL: '2.0', ErrorCode: '0' };
  const verLst = { make: 'bmw', model: '5 series', year: 2019, modification: null, title: 'BMW 5 Series 2019', country: 'UA', text: 'BMW 5 Series 2019 бензин 2.0 автомат повний' };
  const verAna = { title: 'BMW 5 Series 2019', trim: 'Sport Line', year: 2019, fuel: 'petrol', engine: '2,0 л бензин', transmission: 'автомат', drive: 'полный' };
  s = build(verDec, verLst, verAna);
  ok('C1. the declared semantics do not soften a real conflict: still conflict, identity partial', s.version.conflict && s.identity.version_status === 'conflict' && s.identity.status === 'partial' && s.identity.declared_fields.length === 0, JSON.stringify(s.identity));
  veh = { ...verAna }; M.syncHeaderWithSpec(veh, s, { driveLabel });
  r = report(s, veh);
  log = CM.mergeChecklist(r, { fcChecks: [{ text: 'Сверить версию по VIN и документам: декодер 530i xDrive, анализ Sport Line.', area: 'identity', refines: null }], snapshot: null, lang: 'ru' });
  const vstep = r.checklist.find(t => /^Версия/.test(t)) || '';
  ok('C2. real conflict: header drops the version, the concrete identity step names both sources, FC identity checks are not skipped', veh.trim === null && /декодер VIN: 530i xDrive/.test(vstep) && /разбор страницы: Sport Line/.test(vstep) && !log.skipped.some(x => x.reason === 'identity_not_in_conflict'), JSON.stringify([veh.trim, r.checklist]));
  ctx = FC.buildConclusionContext(report(s, veh)).vehicle;
  ok('C3. FC context: version absent, status conflict, the contradiction is in the context for the model to name', ctx.version === undefined && ctx.identity_status.version_status === 'conflict' && ctx.identity_conflicts.includes('version'));
  curve = V.buildValueCurve({ price: 20000, currency: 'USD', year: 2019, candidates: [], vehicle: {}, identity: { make: 'bmw', model: '5 series', trim: s.version.value || null, version_status: s.identity.version_status } });
  ok('C4. Market Value: no version is passed while it conflicts, provenance says conflict', (s.version.value || null) === null && curve.new_price.version_status === 'conflict');
  ok('C5. Confidence label carries the version limitation only for the real conflict', CF.identityNoteKey(s.identity) === 'but the version is not confirmed');
  /* materially incompatible core evidence stays a core conflict */
  const coreDec = { Make: 'LAND ROVER', Model: 'Range Rover Evoque', Trim: 'S', ModelYear: '2021', FuelTypePrimary: 'Diesel', DisplacementL: '2.0', ErrorCode: '0' };
  s = build(coreDec, { make: 'land rover', model: 'range rover evoque', year: 2021, modification: '2.0 TSI AT (249 к.с.) AWD', title: 'Evoque 2021 бензин', country: 'UA', text: 'Двигун Бензин, 2 л, (249 к.с.)' }, { trim: 'S', year: 2021, fuel: 'petrol', engine: '2,0 л бензин, 249 л.с.', drive: 'полный' });
  ok('C6. strong contradictory core evidence (diesel vs petrol) is still a core conflict and blocks the Score', s.identity.core_status === 'unresolved' && SC.coreIdentityConflicts(s).includes('fuel'), JSON.stringify(s.identity));

  /* ---- D. UNKNOWN (nothing states a version) ---- */
  s = build({ Make: 'HYUNDAI', ErrorCode: '1,5,14,400' }, { make: 'hyundai', model: 'santa fe', year: 2013, modification: '2.4 AT (176 к.с.) 4WD', title: 'Hyundai Santa Fe 2013', country: 'UA', text: 'Двигун Бензин, 2.4 л, (176 к.с.) Привід Повний' }, { trim: null, year: 2013, fuel: 'petrol', engine: '2,4 л бензин, 176 л.с.', drive: 'полный' });
  ok('D1. an engine-only modification gives no version: unknown, not guessed, not declared', s.version.value === null && s.identity.version_status === 'unknown' && s.identity.unknown_fields.includes('version') && s.identity.core_status === 'resolved', JSON.stringify(s.identity));
  ok('D2. unknown version: no identity note, no identity step, FC version absent', CF.identityNoteKey(s.identity) === null && FC.buildConclusionContext(report(s, {})).vehicle.version === undefined && (() => { const rr = report(s, {}); CM.mergeChecklist(rr, { fcChecks: [], snapshot: null, lang: 'ru' }); return !rr.checklist.some(t => /^Версия/.test(t)); })());

  /* ---- power: small or ambiguous discrepancy never makes a version conflict ---- */
  s = build(null, { make: 'Toyota', model: 'RAV4', year: 2019, modification: '2.5 ECVT (219 к.с.) Hybrid', title: 'Toyota RAV4 2019 гібрид (hev)', text: 'Двигун Гібрид (HEV), 2.49 л, (163.2 к.с. / 120 кВт)' }, { engine: '2,5 л гибрид', fuel: 'hybrid', trim: 'Style' });
  ok('E1. ambiguous hybrid power leaves the version alone (declared Style from the analysis, no conflict)', s.power_hp.ambiguous && s.identity.version_status === 'declared' && !s.conflicts.includes('version'), JSON.stringify(s.identity));
  s = build(gleDec, gleLst, { ...gleAna, engine: '3.0 л бензин Biturbo, 385 л.с.' });
  ok('E2. a power figure within tolerance of the declared version figure is no conflict at all', !s.power_hp.conflict || s.identity.version_status === 'declared', JSON.stringify([s.power_hp.conflict, s.identity.version_status]));
  ok('E3. version is never in the core list, so power can only ever be power evidence', !M.IDENTITY_CORE_FIELDS.includes('version') && !M.IDENTITY_CORE_FIELDS.includes('power_hp'));

  /* ---- Market Value provenance of a declared version (owner review 2026-10-12) ---- */
  const src = fs.readFileSync('api/check.js', 'utf8');
  ok('V1. the declared version goes into the price search (canonical version, null only while it conflicts)', /trim: spec0\.version && spec0\.version\.conflict \? null : \(\(spec0\.version && spec0\.version\.value\) \|\| listing\.modification \|\| null\)/.test(src) && /trim: vehicleSpec\.version\.value \|\| null,\n\s+version_status: vehicleSpec\.identity/.test(src));
  ok('V2. a declared version never becomes confirmed (no decoder source)', (() => { const x = build(gleDec, gleLst, gleAna); return x.identity.version_status === 'declared' && !x.identity.confirmed_fields.includes('version'); })());
  ok('V3. declared + exact textual match: reference capped at equivalent and marked declared', JSON.stringify(V.declaredCap({ reference: 'exact', comparable: true }, 'declared')) === JSON.stringify({ reference: 'equivalent', comparable: true, version_basis: 'declared', reference_uncapped: 'exact' }) && V.declaredCap({ reference: 'equivalent', comparable: true }, 'declared').version_basis === 'declared');
  ok('V4. confirmed version keeps exact; analog and estimate untouched', V.declaredCap({ reference: 'exact', comparable: true }, 'confirmed').reference === 'exact' && !V.declaredCap({ reference: 'exact', comparable: true }, 'confirmed').version_basis && V.declaredCap({ reference: 'analog', comparable: true }, 'declared').reference === 'analog' && V.declaredCap({ reference: 'estimate', comparable: null }, 'declared').reference === 'estimate');
  ok('V5. a conflicting version is never passed to narrow pricing', (() => { const x = build(verDec, verLst, verAna); return x.identity.version_status === 'conflict' && (x.version.value || null) === null; })());
  const T = 8;
  const ret = (versionDeclared, reference) => V.retentionContext({ newPrice: 80000, basis: 'localized_msrp', reference, comparable: true, representative: 35000, representativeSource: 'marketplace_average', T, versionDeclared });
  const conf = ret(false, 'exact'), decl = ret(true, 'equivalent');
  ok('V6. value retention: a confirmed exact price is measured; the same price matched to a declared version stays unknown with its own reason, metrics kept', conf.state !== 'unknown' && decl.state === 'unknown' && decl.reason === 'new_price_version_declared' && decl.observed_retention === conf.observed_retention, JSON.stringify([conf, decl]));
  ok('V6a. the retention formula is untouched: same metrics for the same inputs', conf.retention_index === ret(false, 'equivalent').retention_index && ret(false, 'equivalent').state === conf.state);
  const lossOf = r => V.composeMarketValue({ liquidity: { level: 'medium', reasons: [] }, price_forces: [] }, r).why_price.value_loss;
  ok('V6b. Why Price gets no value-loss label from a declared-only version', lossOf(decl) === null);

  /* ---- formulas untouched ---- */
  ok('F1. Confidence formula untouched (TEXT_RANGES and weights as before)', JSON.stringify(CF.CONFIDENCE_CONFIG_V1.TEXT_RANGES) === JSON.stringify([[85, 'Studied in detail'], [70, 'Enough data'], [40, 'Partially checked'], [0, 'Data is limited']]) && JSON.stringify(CF.CONFIDENCE_CONFIG_V1.DOMAIN_WEIGHTS) === JSON.stringify({ history: 35, photos: 30, mileage: 20, identity: 15 }));
  ok('F2. Score ceiling config untouched', SC.SCORE_CEILING_CONFIG.DEFAULT === 10 && SC.SCORE_CEILING_CONFIG.DAMAGE.serious === 7.5 && JSON.stringify(SC.SCORE_CEILING_CONFIG.IDENTITY_CORE) === JSON.stringify(M.IDENTITY_CORE_FIELDS));
  ok('F3. conclusion version bumped for the rule change', FC.CONCLUSION_VERSION === 'fc-v2.7');

  for (const f of ['api/vehicle-spec.js', 'api/conclusion.js', 'api/checklist-merge.js', 'api/value.js', 'declaredversiontest.js', 'result-check.html', 'i18n/ru.js', 'i18n/ua.js']) ok('no em dash in ' + f, !fs.readFileSync(f, 'utf8').includes(DASH));
  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('DECLARED VERSION TEST FAILED (' + errs.length + '/' + checks + '):'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('declared version: ' + checks + ' checks · version from the modification string · declared vs confirmed vs conflict vs unknown · FC working identity · no fake identity step · value provenance · MI trust unchanged · real conflict kept · formulas untouched · declared price capped at equivalent, retention unmeasured');
})().catch(e => { console.log('DECLARED VERSION TEST CRASHED:', e.stack || e.message); process.exit(1); });
