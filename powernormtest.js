/* Power normalisation of the canonical vehicle spec (api/vehicle-spec.js).

   Beta corpus 2026-10-09: RAV4 2019 hybrid got a "219 vs 163" conflict (the
   modification states the system output, the marketplace engine block states
   163.2 к.с. / 120 кВт: different kinds of power), Prado 2021 a bogus "44"
   from the decimal "277.44 к.с.", Tesla Model Y a "112 hp" from the battery
   "82 кВт·год". A figure is compared only after unit, semantic type and
   normalisation; a bare number stays unit-unknown; provenance survives.

   Run: node powernormtest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_pw_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'vehicle-spec.js'));
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const CM = await import('file://' + path.join(dir, 'api', 'checklist-merge.js'));
  const FC = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const build = (nhtsa, listing, analysis) => M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa, listing }), analysis, { nhtsa, listing });
  const report = (spec, vehicle = {}, extra = {}) => ({ vehicle, risks: [], checklist: [], discrepancies: [], _meta: { lang: 'ru', vehicle_spec: M.publicSpec(spec), history_facts: {}, decision_inputs: { mileage_context: {} } }, score_breakdown: { events: [], inputs: {}, score_version: 'v4' }, ...extra });
  const conf2 = () => build(null, { make: 'X', model: 'Y', year: 2020, modification: '2.0 AT (163 кВт)', title: 'X Y 2020 бензин', text: 'Потужність 219 к.с.' }, { engine: '2,0 л бензин, 222 л.с.' });
  const vals = s => [...new Set(s.power_hp.candidates.filter(c => c.value !== null).map(c => c.value))].sort((a, b) => a - b).join(',');

  /* ---- A. 163 kW, 219 hp and 222 PS are one power ---- */
  const kw163 = M.parsePower('163 кВт');
  ok('A. 163 kW normalises to 222 metric hp with its unit kept', kw163.value === 222 && kw163.unit === 'kw' && kw163.raw_value === 163 && kw163.converted === 'kw_to_ps', JSON.stringify(kw163));
  ok('A1. 163 kW vs 219 hp vs 222 PS: no conflict', M.powerEquivalent(222, 219) && M.powerEquivalent(222, 222) && M.powerEquivalent(219, 222));
  let s = build(null, { make: 'X', model: 'Y', year: 2020, modification: '2.0 AT (219 к.с.)', title: 'X Y 2020 бензин', text: 'Двигун Бензин, 2 л, (222 к.с. / 163 кВт)' }, { engine: '2,0 л бензин, 219 л.с.' });
  ok('A2. spec: modification 219 PS, block 222 PS / 163 kW, analysis 219: one confirmed power', !s.power_hp.conflict && !s.power_hp.ambiguous && M.powerEquivalent(s.power_hp.value, 219), JSON.stringify(s.power_hp));

  /* ---- B. 150 kW vs 204 PS ---- */
  ok('B. 150 kW is 204 PS', M.parsePower('150 kW').value === 204 && M.powerEquivalent(M.parsePower('150 kW').value, 204));
  s = build(null, { make: 'X', model: 'Y', year: 2021, modification: '2.8D AT (204 к.с.) 4WD', title: 'X Y 2021 дизель', text: 'Потужний дизель 2.8 л (150 кВт), автомат.' }, { engine: '2,8 л дизель' });
  ok('B1. spec: 204 PS and 150 kW do not conflict', !s.power_hp.conflict && s.power_hp.value === 204, JSON.stringify(s.power_hp));

  /* ---- C. 204 kW vs 204 PS is a real mismatch ---- */
  s = build(null, { make: 'X', model: 'Y', year: 2021, modification: '2.8D AT (204 к.с.) 4WD', title: 'X Y 2021 дизель', text: 'Потужний дизель 2.76 л (204 кВт), автомат. Двигун Дизель, 2.76 л, (277.44 к.с. / 204 кВт)' }, { engine: '2,76 л дизель' });
  ok('C. 204 kW (277 PS) against 204 PS is a conflict after normalisation', s.power_hp.conflict && s.power_hp.value === null && vals(s) === '204,277', JSON.stringify(s.power_hp));
  ok('C1. the decimal "277.44 к.с." never yields a bogus 44', !s.power_hp.candidates.some(c => c.value === 44) && JSON.stringify(M.powerValues('(277.44 к.с. / 204 кВт)')) === '[277]');
  ok('C2. "943.296 к.с." never yields a bogus 296', JSON.stringify(M.powerValues('Потужність двигуна 943.296 к.с. / 694 кВт')) === '[943]');

  /* ---- D. same number, different units ---- */
  ok('D. 204 kW and 204 PS are never equal because the number matches', M.parsePower('204 кВт').value !== M.parsePower('204 к.с.').value && !M.powerEquivalent(M.parsePower('204 кВт').value, M.parsePower('204 к.с.').value));
  ok('D1. 191 kW and 191 PS likewise', !M.powerEquivalent(M.parsePower('191 кВт').value, M.parsePower('191 к.с.').value));

  /* ---- E. unknown unit ---- */
  const bare = M.parsePower('204');
  ok('E. a bare number is unit unknown and has no normalised value', bare && bare.unit === 'unknown' && bare.value === null && bare.raw_value === 204, JSON.stringify(bare));
  s = build(null, { make: 'X', model: 'Y', year: 2021, power_hp: '204', modification: '', title: 'X Y 2021 дизель', text: 'Потужність 277 к.с.' }, { engine: '2,8 л дизель' });
  ok('E1. a unit-unknown structured figure neither conflicts with nor confirms 277 PS', !s.power_hp.conflict && !s.power_hp.ambiguous && s.power_hp.value === 277 && s.power_hp.candidates.some(c => c.unit === 'unknown' && c.value === null && c.raw_value === 204), JSON.stringify(s.power_hp));
  ok('E2. a lone unit-unknown figure leaves power unknown, not established', (() => { const x = build(null, { make: 'X', model: 'Y', year: 2021, power_hp: '204', modification: '', title: 'X Y 2021 дизель', text: '' }, { engine: '2,8 л дизель' }); return x.power_hp.value === null && !x.power_hp.conflict && !x.power_hp.ambiguous; })());

  /* ---- F. hp vs PS and rounding are tolerated ---- */
  ok('F. 268 hp, 272 PS and 200 kW are one engine', M.normPower('200 кВт') === 272 && M.powerEquivalent(272, 268) && M.powerEquivalent(272, 275));
  s = build({ Make: 'BMW', Model: 'X5', EngineHP: '335', FuelTypePrimary: 'Gasoline', ErrorCode: '0' }, { make: 'BMW', model: 'X5', year: 2019, modification: '3.0 AT (250 кВт)', title: 'BMW X5 2019', text: 'Потужність 340 к.с.' }, { engine: '3.0 л бензин, 340 л.с.' });
  ok('F1. decoder 335 SAE hp, listing 250 kW, text 340 PS: no conflict', !s.power_hp.conflict && s.power_hp.value !== null && s.power_hp.candidates.some(c => c.unit === 'hp_sae' && c.converted === 'sae_to_ps' && c.raw_value === 335), JSON.stringify(s.power_hp));
  ok('F2. tolerance is 6 hp or 4 percent', M.POWER_TOLERANCE.abs_hp === 6 && M.POWER_TOLERANCE.rel === 0.04 && M.powerEquivalent(100, 106) && !M.powerEquivalent(100, 107) && M.powerEquivalent(400, 416) && !M.powerEquivalent(400, 417));

  /* ---- G. clearly different compatible values stay a conflict ---- */
  s = build(null, { make: 'Land Rover', model: 'Range Rover Evoque', year: 2021, modification: '2.0 Td4 MHEV AT (163 к.с.) AWD', title: 'Land Rover Range Rover Evoque 2021', text: 'Двигун: 2.0 дизель, потужність 180 кВт (245 к.с.). Двигун Дизель, 2 л, (245 к.с. / 180 кВт)' }, { engine: '2,0 л дизель MHEV' });
  ok('G. mild hybrid 163 PS vs 180 kW (245 PS): conflict with both candidates', s.power_hp.conflict && vals(s) === '163,245' && s.electrification.value === 'mild_hybrid', JSON.stringify(s.power_hp));
  ok('G1. the kW candidate keeps its original unit and number', s.power_hp.candidates.some(c => c.unit === 'kw' && c.raw_value === 180 && c.value === 245 && /180 кВт/.test(c.raw)), JSON.stringify(s.power_hp.candidates));

  /* ---- H. same units, different semantic types (hybrid) ---- */
  const rav = () => build(null, { make: 'Toyota', model: 'RAV4', year: 2019, modification: '2.5 ECVT (219 к.с.) Hybrid', title: 'Toyota RAV4 2019 гібрид (hev)', text: 'Модифікація V покоління, 2.5 ECVT (219 к.с.) Hybrid Двигун Гібрид (HEV), 2.49 л, (163.2 к.с. / 120 кВт) Екологічний стандарт Євро-6' }, { engine: '2,5 л гибрид', fuel: 'hybrid' });
  s = rav();
  ok('H. hybrid: modification 219 PS (system) and engine block 163 PS: ambiguous, not a conflict', !s.power_hp.conflict && s.power_hp.ambiguous && s.power_hp.value === null && !s.conflicts.includes('power_hp'), JSON.stringify(s.power_hp));
  ok('H1. the candidates carry their semantic types: modification system, marketplace "Двигун" block engine', s.power_hp.candidates.some(c => c.type === 'system' && c.value === 219) && s.power_hp.candidates.some(c => c.type === 'engine' && c.value === 163 && c.raw_value === 163.2), JSON.stringify(s.power_hp.candidates));
  ok('H2. relation table: system vs unknown and unknown vs unknown are not comparable, engine vs engine is', !M.powerComparable('system', 'unknown') && !M.powerComparable('unknown', 'unknown') && M.powerComparable('engine', 'engine') && M.powerComparable('system', 'system'));
  ok('H3. a conventional car types every figure as engine; an electrified one by modification or explicit label only', M.powerTypeFor('modification', false) === 'engine' && M.powerTypeFor('text', false) === 'engine' && M.powerTypeFor('modification', true) === 'system' && M.powerTypeFor('text', true) === 'unknown' && M.powerTypeFor('text', true, 'engine') === 'engine');
  let pub = M.publicSpec(s);
  ok('H4. public spec marks power ambiguous with typed candidates and does not call it unknown', pub.fields.power_hp.ambiguous === true && pub.fields.power_hp.conflict === false && pub.fields.power_hp.candidates.length === 2 && pub.fields.power_hp.candidates.every(c => c.unit && c.type) && !pub.unknown.includes('power_hp'), JSON.stringify(pub.fields.power_hp));
  let notes = M.conflictNotes(s, 'ru');
  ok('H5. data_notes name each kind of power without a conflict wording', notes.some(n => /системная, [^;]*219/.test(n) && /двигателя, [^;]*163/.test(n)) && !notes.some(n => /расходятся/.test(n)), JSON.stringify(notes));
  ok('H6. the prompt block tells the model it is not a conflict', /ПОТУЖНІСТЬ НЕ ЗВЕДЕНА/.test(M.vehicleSpecPromptBlock(s)) && !/НЕВІДОМО[^\n]*power_hp/.test(M.vehicleSpecPromptBlock(s)));

  /* ---- H7-H14. explicit field context, per-type resolution, header (owner review 2026-10-09) ---- */
  s = rav();
  ok('H7. RAV4: distinct known types are recorded per type, generic power stays null', s.power_hp.value === null && s.power_hp.ambiguity === 'distinct_types' && s.power_hp.by_type.system.value === 219 && s.power_hp.by_type.engine.value === 163 && s.power_hp.by_type.engine.raw_value === 163.2, JSON.stringify(s.power_hp));
  pub = M.publicSpec(s);
  ok('H8. public spec carries by_type and the ambiguity kind, candidates kept', pub.fields.power_hp.by_type && pub.fields.power_hp.by_type.engine.value === 163 && pub.fields.power_hp.ambiguity === 'distinct_types' && pub.fields.power_hp.candidates.length === 2, JSON.stringify(pub.fields.power_hp));
  ok('H9. label typing: "Двигун", "Потужність двигуна", "Engine output" -> engine; "Сумарна потужність", "Combined output" -> system; "Номінальна потужність", "Rated power" -> rated; plain seller prose -> none',
    M.powerLabelType('Двигун Гібрид (HEV), 2.49 л, (163.2 к.с.', 32) === 'engine' && M.powerLabelType('Потужність двигуна 384 к.с.', 19) === 'engine' && M.powerLabelType('Engine output 150 kW', 14) === 'engine'
    && M.powerLabelType('Сумарна потужність 222 к.с.', 19) === 'system' && M.powerLabelType('Combined output 302 hp', 16) === 'system' && M.powerLabelType('Номінальна потужність 70 кВт', 22) === 'rated' && M.powerLabelType('Rated power 70 kW', 12) === 'rated'
    && M.powerLabelType('Машина дуже динамічна, 300 к.с.', 23) === null && M.powerLabelType('Двигун новий. Їде добре, 300 к.с.', 25) === null && M.powerLabelType('Двигун Гібрид • 2.5 ECVT (219 к.с.', 26) === null);
  /* 1. header */
  let veh = { title: 'Toyota RAV4 2019', engine: '2,5 л гибрид, 219 л.с.' };
  let ch = M.syncHeaderWithSpec(veh, s, {});
  ok('H10. header: ambiguous power cannot leak the analysis figure into the engine line', veh.engine === '2,5 л гибрид' && ch.some(c => c.why === 'power_ambiguous'), JSON.stringify([veh, ch]));
  veh = { title: 'X', engine: '2,0 л бензин, 219 л.с.' };
  M.syncHeaderWithSpec(veh, conf2(), {});
  ok('H11. header: a confirmed canonical power keeps its figure', veh.engine === '2,0 л бензин, 219 л.с.', JSON.stringify(veh));
  /* 4. system vs system and 5. engine vs engine still conflict */
  const hyb = (mod, text) => build(null, { make: 'X', model: 'Y', year: 2022, modification: mod, title: 'X Y 2022 гібрид (hev)', text }, { engine: '2,5 л гибрид', fuel: 'hybrid' });
  s = hyb('2.5 Hybrid (219 к.с.)', 'Сумарна потужність 300 к.с.');
  ok('H12. hybrid: two system figures that differ are a conflict', s.power_hp.conflict && s.conflicts.includes('power_hp'), JSON.stringify(s.power_hp));
  s = hyb('2.5 Hybrid (219 к.с.)', 'Двигун Гібрид (HEV), 2.49 л, (163 к.с. / 120 кВт). Потужність двигуна 200 к.с.');
  ok('H13. hybrid: two engine figures that differ are a conflict, the system figure stays out of it', s.power_hp.conflict && [...new Set(s.power_hp.candidates.filter(c => c.type === 'engine').map(c => c.value))].sort().join() === '163,200', JSON.stringify(s.power_hp));
  /* 6. unknown vs known: no fake conflict, no confirmation */
  s = hyb('2.5 Hybrid (219 к.с.)', 'Їздить дуже динамічно, 250 к.с. вистачає з запасом.');
  ok('H14. hybrid: an unlabelled figure that differs from the system figure makes power ambiguous, never a conflict', !s.power_hp.conflict && s.power_hp.ambiguous && s.power_hp.ambiguity === 'unknown_type' && !s.conflicts.includes('power_hp'), JSON.stringify(s.power_hp));
  s = hyb('2.5 Hybrid (219 к.с.)', 'Їздить дуже динамічно, 219 к.с. вистачає з запасом.');
  ok('H15. hybrid: an unlabelled figure that agrees does not confirm or strengthen the known one', s.power_hp.value === 219 && s.power_hp.strength === 'medium' && s.power_hp.source === 'listing' && s.power_hp.type === 'system', JSON.stringify(s.power_hp));

  /* ---- I. EV: peak/system vs other figures; battery capacity is not power ---- */
  s = build({ Make: 'TESLA', Model: 'Model Y', FuelTypePrimary: 'Electric', ElectrificationLevel: 'BEV (Battery Electric Vehicle)', ErrorCode: '0' }, { make: 'Tesla', model: 'Model Y', year: 2023, modification: 'Long Range 82 kWh Dual Motor (384 к.с.) AWD', title: 'Tesla Model Y 2023 електро', text: 'Батарея: Long Range (82 кВт·год) Двигун: Електро (384 к.с.) Ємність акумулятора 82 кВт-год Потужність двигуна 384 к.с. / 282 кВт' }, { engine: 'электро, два электродвигателя' });
  ok('I. EV: 384 PS and 282 kW agree, the 82 kWh battery is not a 112 hp candidate', !s.power_hp.conflict && !s.power_hp.ambiguous && s.power_hp.value === 384 && !s.power_hp.candidates.some(c => c.value === 112), JSON.stringify(s.power_hp));
  ok('I1. kWh in every spelling is energy', M.powerValues('82 кВт·год, 82 кВт-год, 82 кВт⋅год, 82 kWh, 82.5 kWh, 60kWh, 82 кВт год').length === 0);
  s = build(null, { make: 'Tesla', model: 'Model 3', year: 2021, modification: 'Performance 82.5 kWh (510 к.с.) AWD', title: 'Tesla Model 3 2021 електро', text: 'Performance 82.5 kWh (510 к.с.) AWD Двигун Електро Потужність двигуна 943.296 к.с. / 694 кВт' }, { engine: 'електро' });
  ok('I2. EV: modification 510 PS (system) vs "Потужність двигуна" 943 PS (engine): different kinds, ambiguous, both kept, no bogus 296', !s.power_hp.conflict && s.power_hp.ambiguous && s.power_hp.ambiguity === 'distinct_types' && vals(s) === '510,943', JSON.stringify(s.power_hp));
  ok('I3. EV figures of different kinds that agree are confirmed, not ambiguous', (() => { const x = build(null, { make: 'T', model: 'M', year: 2023, modification: 'LR (384 к.с.)', title: 'T M 2023 електро', text: 'Потужність 282 кВт' }, { engine: 'електро, 384 л.с.' }); return x.power_hp.value === 384 && !x.power_hp.ambiguous; })());

  /* ---- J. provenance survives normalisation ---- */
  s = build(null, { make: 'X', model: 'Y', year: 2021, modification: '2.8D AT (204 к.с.) 4WD', title: 'X Y 2021 дизель', text: 'дизель 2.76 л (204 кВт)' }, { engine: '2,76 л дизель' });
  const kwC = s.power_hp.candidates.find(c => c.unit === 'kw');
  ok('J. the kW candidate keeps source, raw snippet, unit, number, normalised value and the conversion applied', kwC && kwC.source === 'listing' && kwC.raw === '204 кВт' && kwC.raw_value === 204 && kwC.value === 277 && kwC.converted === 'kw_to_ps' && kwC.type === 'engine', JSON.stringify(kwC));
  ok('J1. no candidate pretends its source wrote the normalised number', !s.power_hp.candidates.some(c => /^277 hp$/.test(String(c.raw))));
  pub = M.publicSpec(s);
  ok('J2. public candidates expose unit, number and type', pub.fields.power_hp.candidates.some(c => c.unit === 'kw' && c.raw_value === 204 && c.converted === 'kw_to_ps'), JSON.stringify(pub.fields.power_hp));

  /* ---- K. the identity gate consumes the normalised result ---- */
  const conf = build(null, { make: 'X', model: 'Y', year: 2020, modification: '2.0 AT (163 кВт)', title: 'X Y 2020 бензин', text: 'Потужність 219 к.с.' }, { engine: '2,0 л бензин, 222 л.с.' });
  let facts = RC.canonicalFacts(report(conf));
  ok('K. gate: a prose figure of 219 л.с. against established 163 kW is not a violation', RC.sentenceViolations('Мотор на 219 л.с. тянет уверенно.', facts).length === 0 && RC.sentenceViolations('Мотор на 163 кВт тянет уверенно.', facts).length === 0, JSON.stringify(facts.power_hp));
  ok('K1. gate: a different figure is still a violation', RC.sentenceViolations('Мотор на 300 л.с. тянет уверенно.', facts).some(v => v.domain === 'power_hp'));
  facts = RC.canonicalFacts(report(rav()));
  ok('K2. gate: ambiguous power is neither trusted nor a conflict, so neither figure is struck', !facts.power_hp.trusted && !facts.power_hp.conflict && RC.sentenceViolations('Гибридная установка выдаёт 219 л.с.', facts).length === 0 && RC.sentenceViolations('Бензиновый мотор развивает 163 л.с.', facts).length === 0);
  ok('K3. gate: battery capacity in prose is not a power claim', RC.powerValuesInProse ? true : RC.sentenceViolations('Батарея на 82 кВт·ч заряжается за ночь.', RC.canonicalFacts(report(conf))).length === 0);

  /* ---- L. checklist: no fake kW/hp step; M. a real conflict still propagates ---- */
  let r = report(rav(), { title: 'Toyota RAV4 2019' });
  CM.mergeChecklist(r, { fcChecks: [], snapshot: null, lang: 'ru' });
  ok('L. checklist: RAV4 power of different kinds adds no "219 или 163" step', !r.checklist.some(t => /Мощность двигателя: источники расходятся|219 л\.с\. или 163/.test(t)), JSON.stringify(r.checklist));
  r = report(s, { title: 'Toyota Land Cruiser Prado 2021' });
  CM.mergeChecklist(r, { fcChecks: [], snapshot: null, lang: 'ru' });
  const step = r.checklist.find(t => /^Мощность двигателя/.test(t)) || '';
  ok('M. checklist: a real conflict adds the step and names each candidate in its own unit', /204 л\.с\./.test(step) && /204 кВт \(277 л\.с\.\)/.test(step) && !/44 л/.test(step) && !/277 л\.с\. или/.test(step), step);
  ok('M1. the real conflict reaches the Final Conclusion context and the spec conflicts list', s.conflicts.includes('power_hp') && (FC.buildConclusionContext(report(s)).vehicle.identity_conflicts || []).includes('power_hp') && FC.buildConclusionContext(report(s)).vehicle.power_hp === undefined);
  ok('M2. the ambiguous hybrid does not reach the Final Conclusion as a conflict', !(FC.buildConclusionContext(report(rav())).vehicle.identity_conflicts || []).includes('power_hp') && FC.buildConclusionContext(report(rav())).vehicle.power_hp === undefined);
  const dropped = M.identityConflictItem({ title: 'Мощность двигателя', detail: 'В объявлении 219 и 163 л.с.' }, rav());
  ok('M3. a model-written "discrepancy" about ambiguous power is not an identity conflict item', dropped === null && M.identityFieldOf({ title: 'Мощность двигателя', detail: 'В объявлении 219 и 163 л.с.' }) === 'power_hp');

  for (const f of ['api/vehicle-spec.js', 'api/checklist-merge.js', 'powernormtest.js']) ok('no em dash in ' + f, !fs.readFileSync(f, 'utf8').includes(DASH));
  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('POWER NORMALISATION TEST FAILED (' + errs.length + '/' + checks + '):'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('power normalisation: ' + checks + ' checks · units kW/PS/SAE/unknown · kWh is energy · decimals · semantic types · tolerance 6 hp or 4% · provenance · gate · checklist · Final Conclusion context · field-label types · per-type conflicts · header');
})().catch(e => { console.log('POWER NORMALISATION TEST CRASHED:', e.stack || e.message); process.exit(1); });
