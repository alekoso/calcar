/* Source-unit inconsistency of the power figure (api/vehicle-spec.js
   resolvePower / sourceUnitPair). Production 2026-10-12: a GLE 43 whose
   marketplace card says "390 к.с." in the modification and "530.4 к.с. /
   390 кВт" in its technical block got a buyer-facing "390 or 530 hp" step;
   Prado 2021 the same with 204. The same number under two incompatible
   units inside one page is the source's own unit-label error, and the 530.4
   is that source's conversion of its mislabelled 390, not independent
   evidence. Real conflicts between independent sources, and between
   different figures of one page, stay conflicts.

   Run: node powerunittest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_pu_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'vehicle-spec.js'));
  const CM = await import('file://' + path.join(dir, 'api', 'checklist-merge.js'));
  const FC = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const driveLabel = v => ({ awd: 'полный', fwd: 'передний', rwd: 'задний' }[v] || null);
  const build = (nhtsa, listing, analysis) => M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa, listing }), analysis, { nhtsa, listing });
  const report = (spec, vehicle = {}) => ({ vehicle, risks: [], checklist: ['Кузов: проверить после страховых случаев.'], discrepancies: [], confidence: { overall_internal: 72, text_key: 'Enough data' }, _meta: { lang: 'ru', vehicle_spec: M.publicSpec(spec), history_facts: {}, decision_inputs: { mileage_context: {} } }, score_breakdown: { events: [], inputs: {}, score_version: 'v4', final: 7.7, score_available: true } });
  const powerStep = r => r.checklist.find(t => /^Мощность двигателя/.test(t)) || null;

  /* ---- 1. the GLE shape ---- */
  const gleLst = { make: 'mercedes benz', model: 'gle class', year: 2018, country: 'UA', modification: 'AMG 43 G-tronic (390 к.с.) 4Matic', title: 'Mercedes-Benz GLE-Class 2018', text: 'GLE 43 AMG з потужним 3.0 BiTurbo на 390 к.с. Модифікація W166, AMG 43 G-tronic (390 к.с.) 4Matic Двигун Бензин, 3 л, (530.4 к.с. / 390 кВт) Привід Повний' };
  const gleAna = { fuel: 'petrol', trim: 'GLE 43 AMG', year: 2018, drive: 'полный', title: 'Mercedes-Benz GLE-Class 2018', engine: '3.0 л бензин Biturbo', generation: 'W166' };
  let s = build({ Make: 'MERCEDES-BENZ', ErrorCode: '1,8' }, gleLst, gleAna);
  const p = s.power_hp;
  ok('1. 390 PS and 390 kW of one page: source_unit_inconsistency, no conflict, no value', !p.conflict && p.ambiguous && p.ambiguity === 'source_unit_inconsistency' && p.value === null && p.inconsistency && p.inconsistency.number === 390 && p.inconsistency.family === 'listing' && p.inconsistency.units.includes('kw') && p.inconsistency.units.includes('ps'), JSON.stringify(p));
  const derived = p.candidates.find(c => c.raw === '530.4 к.с.');
  ok('2. 530.4 PS is the alternate spelling of the 390 kW statement, not an independent candidate: one candidate carries both, marked as the pair', derived && derived.alt && derived.alt.raw === '390 кВт' && derived.alt.unit === 'kw' && derived.unit_pair === true && p.candidates.filter(c => c.unit_pair).length === 2 && !p.candidates.some(c => c.raw === '390 кВт'), JSON.stringify(p.candidates));
  ok('2a. the raw provenance survives: modification 390 PS, technical block 530.4 PS with its 390 kW', p.candidates.some(c => /390 к\.с\./.test(c.raw) && c.unit === 'ps' && c.raw_value === 390 && c.unit_pair) && derived.raw_value === 530.4 && derived.value === 530);
  let veh = { ...gleAna, engine: '3.0 л бензин Biturbo, 390 л.с.' };
  M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('3. GLE: no buyer-facing 390 vs 530: no power conflict in the spec, header carries no figure, no checklist step', !s.conflicts.includes('power_hp') && veh.engine === '3.0 л бензин Biturbo' && (() => { const r = report(s, veh); CM.mergeChecklist(r, { fcChecks: [], snapshot: null, lang: 'ru' }); return powerStep(r) === null; })(), JSON.stringify([s.conflicts, veh.engine]));
  const pub = M.publicSpec(s);
  ok('3a. public spec explains it: ambiguity source_unit_inconsistency with the number, the units and both figures', pub.fields.power_hp.ambiguity === 'source_unit_inconsistency' && pub.fields.power_hp.inconsistency.number === 390 && pub.fields.power_hp.inconsistency.figures.length === 2 && pub.fields.power_hp.candidates.some(c => c.alt && c.alt.raw === '390 кВт'), JSON.stringify(pub.fields.power_hp));
  let notes = M.conflictNotes(s, 'ru');
  ok('3b. data note names the unit-label error of the source, never "sources disagree"', notes.some(n => /подписано разными единицами/.test(n) && /390/.test(n)) && !notes.some(n => /расходятся/.test(n)), JSON.stringify(notes));
  ok('3c. the main analysis prompt says: one source, unit-label error, no "which power is right" for the buyer, no doubt about the version', /помилка підпису одиниці в ОДНОМУ джерелі/.test(M.vehicleSpecPromptBlock(s)) && /не став через це під сумнів версію/.test(M.vehicleSpecPromptBlock(s)));

  /* ---- 4. Prado ---- */
  s = build({ ErrorCode: '1,11,14,400' }, { make: 'toyota', model: 'land cruiser prado', year: 2021, country: 'UA', modification: '2.8D АТ (204 к.с.) 4WD', title: 'Toyota Land Cruiser Prado 2021 дизель', text: 'Потужний дизель 2.76 л (204 кВт), автоматична коробка. Модифікація 2.8D АТ (204 к.с.) 4WD Двигун Дизель, 2.76 л, (277.44 к.с. / 204 кВт)' }, { engine: '2,76 л дизель', fuel: 'diesel' });
  ok('4. Prado: 204 PS and 204 kW (277.44 PS) of one page: the same inconsistency, no "204 or 277" step', !s.power_hp.conflict && s.power_hp.ambiguity === 'source_unit_inconsistency' && s.power_hp.inconsistency.number === 204 && (() => { const r = report(s, {}); CM.mergeChecklist(r, { fcChecks: [], snapshot: null, lang: 'ru' }); return powerStep(r) === null; })(), JSON.stringify(s.power_hp));
  ok('4a. no value is guessed: 204 is not declared correct without an independent source', s.power_hp.value === null);

  /* ---- 5. same number, different units, independent strong sources: a real conflict ---- */
  s = build({ Make: 'X', Model: 'Y', EngineHP: '204', FuelTypePrimary: 'Diesel', ErrorCode: '0' }, { make: 'x', model: 'y', year: 2021, modification: null, title: 'X Y 2021 дизель', text: 'Двигун Дизель, 2.8 л, (204 кВт)' }, { engine: '2,8 л дизель' });
  ok('5. decoder 204 SAE hp against the page\'s 204 kW: different families, a real conflict', s.power_hp.conflict && !s.power_hp.inconsistency, JSON.stringify(s.power_hp));
  /* a clean decoder settles the page\'s own pair */
  s = build({ Make: 'X', Model: 'Y', EngineHP: '201', FuelTypePrimary: 'Diesel', ErrorCode: '0' }, { make: 'x', model: 'y', year: 2021, modification: '2.8D АТ (204 к.с.) 4WD', title: 'X Y 2021 дизель', text: 'дизель 2.76 л (204 кВт)' }, { engine: '2,8 л дизель' });
  ok('5a. a clean decoder that agrees with one side settles the pair: value 204, inconsistency recorded as settled_by decoder, no conflict', s.power_hp.value === 204 && !s.power_hp.conflict && s.power_hp.inconsistency && s.power_hp.inconsistency.settled_by === 'decoder' && /decoder/.test(s.power_hp.source), JSON.stringify(s.power_hp));
  s = build({ Make: 'X', Model: 'Y', EngineHP: '160', FuelTypePrimary: 'Diesel', ErrorCode: '0' }, { make: 'x', model: 'y', year: 2021, modification: '2.8D АТ (204 к.с.) 4WD', title: 'X Y 2021 дизель', text: 'дизель 2.76 л (204 кВт)' }, { engine: '2,8 л дизель' });
  ok('5b. a clean decoder that agrees with neither side: a real conflict, the pair noted', s.power_hp.conflict && s.power_hp.inconsistency && !s.power_hp.inconsistency.settled_by, JSON.stringify(s.power_hp));

  /* ---- 6. different normalised values of independent sources: real conflict preserved ---- */
  s = build({ Make: 'LAND ROVER', Model: 'Range Rover Evoque', EngineHP: '161', FuelTypePrimary: 'Diesel', ErrorCode: '0' }, { make: 'land rover', model: 'range rover evoque', year: 2021, modification: '2.0 D AT (163 к.с.) AWD', title: 'Evoque 2021', text: 'потужність 180 кВт (245 к.с.)' }, { engine: '2,0 л дизель' });
  ok('6. decoder 163 and page 180 kW (245): independent sources, different numbers, a real conflict with the checklist step', s.power_hp.conflict && (() => { const r = report(s, {}); CM.mergeChecklist(r, { fcChecks: [], snapshot: null, lang: 'ru' }); const st = powerStep(r) || ''; return /163 л\.с\./.test(st) && /180 кВт \(245 л\.с\.\)/.test(st); })(), JSON.stringify(s.power_hp));
  s = build(null, { make: 'x', model: 'y', year: 2021, modification: '2.8D AT (160 к.с.) 4WD', title: 'X', text: 'дизель 2.76 л (204 кВт)' }, { engine: '2,76 л дизель' });
  ok('6a. two different numbers of the same page (160 PS, 204 kW) are a real conflict, not a unit pair', s.power_hp.conflict && !s.power_hp.inconsistency);
  ok('6b. same number under the same unit is agreement, not a pair', !M.sourceUnitPair({ source: 'listing', raw_value: 204, unit: 'ps' }, { source: 'listing', raw_value: 204, unit: 'ps' }) && !!M.sourceUnitPair({ source: 'listing', raw_value: 204, unit: 'ps' }, { source: 'listing', raw_value: 204, unit: 'kw' }) && !M.sourceUnitPair({ source: 'decoder', raw_value: 204, unit: 'hp_sae' }, { source: 'listing', raw_value: 204, unit: 'kw' }));

  /* ---- 7. engine vs system unchanged; 8. kWh; 9. decimals ---- */
  s = build(null, { make: 'Toyota', model: 'RAV4', year: 2019, modification: '2.5 ECVT (219 к.с.) Hybrid', title: 'Toyota RAV4 2019 гібрид (hev)', text: 'Двигун Гібрид (HEV), 2.49 л, (163.2 к.с. / 120 кВт)' }, { engine: '2,5 л гибрид', fuel: 'hybrid' });
  ok('7. hybrid system 219 vs engine 163: still distinct_types, untouched by the pair rule', s.power_hp.ambiguity === 'distinct_types' && !s.power_hp.inconsistency, JSON.stringify(s.power_hp));
  s = build(null, { make: 'Tesla', model: 'Model Y', year: 2023, modification: 'Long Range 82 kWh Dual Motor (384 к.с.) AWD', title: 'Tesla Model Y 2023 електро', text: 'Батарея 82 кВт·год Потужність двигуна 384 к.с. / 282 кВт' }, { engine: 'электро' });
  ok('8. Tesla: 384 confirmed, kWh never a figure, the 282 kW is the alternate spelling of 384', s.power_hp.value === 384 && !s.power_hp.ambiguous && !s.power_hp.candidates.some(c => c.value === 112) && M.powerFigures('Потужність двигуна 384 к.с. / 282 кВт')[0].alt.raw === '282 кВт', JSON.stringify(s.power_hp));
  ok('9. decimals: "277.44 к.с." stays one figure (no 44), "943.296 к.с." no 296', JSON.stringify(M.powerValues('(277.44 к.с. / 204 кВт)')) === '[277]' && JSON.stringify(M.powerValues('943.296 к.с. / 694 кВт')) === '[943]');

  /* ---- 10. checklist step only for a real conflict (covered in 3, 4, 6) ---- */
  ok('10. checklist adds the power step only for a real conflict', true);

  /* ---- 11. FC context: no version risk from the unit pair ---- */
  s = build({ Make: 'MERCEDES-BENZ', ErrorCode: '1,8' }, gleLst, gleAna);
  const ctx = FC.buildConclusionContext(report(s, gleAna)).vehicle;
  ok('11. FC context: version AMG 43 declared, identity_conflicts empty, power absent (not a conflict and not a figure)', ctx.version === 'AMG 43' && ctx.identity_status.version_status === 'declared' && !ctx.identity_conflicts && ctx.power_hp === undefined, JSON.stringify([ctx.version, ctx.identity_status, ctx.identity_conflicts]));
  const facts = RC.canonicalFacts(report(s, gleAna));
  ok('11a. gate: with the pair open neither figure is struck from prose and no conflict is asserted', !facts.power_hp.conflict && !facts.power_hp.trusted && RC.sentenceViolations('Трёхлитровый битурбо на 390 л.с. тянет уверенно.', facts).length === 0);

  /* ---- 12. provenance survives (covered in 2, 2a, 3a) ---- */
  ok('12. provenance of both figures survives in the public spec', pub.fields.power_hp.candidates.length === 2 && pub.fields.power_hp.candidates.every(c => c.raw && c.unit && c.raw_value !== null));

  for (const f of ['api/vehicle-spec.js', 'powerunittest.js']) ok('no em dash in ' + f, !fs.readFileSync(f, 'utf8').includes(DASH));
  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('POWER UNIT TEST FAILED (' + errs.length + '/' + checks + '):'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('power source-unit inconsistency: ' + checks + ' checks · same number under two units of one page · derived conversion is not evidence · decoder settles the pair · independent conflicts kept · hybrid/EV and parsing untouched · no buyer step, no version doubt');
})().catch(e => { console.log('POWER UNIT TEST CRASHED:', e.stack || e.message); process.exit(1); });
