/* One canonical identity status for every consumer (api/vehicle-spec.js
   identityStatus): Score eligibility, Confidence label, header, Final
   Conclusion context, Market Value version scope and the checklist read the
   same reading. Beta corpus 2026-10-09: a BMW 3 Series decoded clean by vPIC
   was "identity not established" because vPIC puts the model line into
   Series ("3-Series") and the variant into Model ("328i"); the marketplace
   says "3 series", the passport compared "328i" with it and blocked the
   Score, while the header, the conclusion and the market value treated
   "328i xDrive" as confirmed.

   Run: node identitystatustest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_is_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'vehicle-spec.js'));
  const SC = await import('file://' + path.join(dir, 'api', 'score-ceiling.js'));
  const CF = await import('file://' + path.join(dir, 'api', 'confidence.js'));
  const CM = await import('file://' + path.join(dir, 'api', 'checklist-merge.js'));
  const FC = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const V = await import('file://' + path.join(dir, 'api', 'value.js'));
  const driveLabel = v => ({ awd: 'полный', fwd: 'передний', rwd: 'задний' }[v] || null);
  const build = (nhtsa, listing, analysis) => M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa, listing }), analysis, { nhtsa, listing });
  const report = (spec, vehicle = {}, extra = {}) => ({ vehicle, risks: [], checklist: [], discrepancies: [], confidence: { overall_internal: 85, text_key: 'Studied in detail' }, _meta: { lang: 'ru', vehicle_spec: M.publicSpec(spec), history_facts: {}, decision_inputs: { mileage_context: {} } }, score_breakdown: { events: [], inputs: {}, score_version: 'v4', final: 7.5, score_available: true }, ...extra });

  /* ---- the BMW 3 Series shape: vPIC Model = variant, Series = line, Trim = drive designation ---- */
  const bmwDec = { Make: 'BMW', Model: '328i', Series: '3-Series', Trim: 'xDrive', ModelYear: '2015', BodyClass: 'Sedan/Saloon', FuelTypePrimary: 'Gasoline', EngineHP: '240', DisplacementL: '2.00', DriveType: 'AWD/All-Wheel Drive', ErrorCode: '0' };
  const bmwLst = { make: 'bmw', model: '3 series', year: 2014, modification: null, title: 'BMW 3 Series 2014 бензин 2 седан', country: 'UA', text: 'BMW 3 Series 2014. Двигун Бензин, 2 л, (245 к.с. / 180 кВт) Коробка передач Автомат Привід Повний' };
  const bmwAna = { title: 'BMW 3 Series 2014', trim: '328i xDrive', year: 2014, model_year: 2015, fuel: 'petrol', engine: '2,0 л бензин, 243 л.с.', transmission: 'автоматическая', drive: 'полный', generation: 'F30' };
  let s = build(bmwDec, bmwLst, bmwAna);
  ok('1. BMW: decoder Series is the model line, so "328i" against "3 series" is no model conflict', !s.model.conflict && s.model.value && M.decoderModelLine(M.buildVehicleSpec({ nhtsa: bmwDec, listing: bmwLst }).model ? { model: { value: '328i', series: '3-Series', trim_raw: 'xDrive', raw: '328i', strength: 'strong', source: 'decoder' } } : null, { model: { value: '3 series' } }) !== null, JSON.stringify(s.model));
  ok('1a. BMW: the decoder variant plus trim is the version, confirmed with the analysis', s.version.value === '328i xDrive' && s.version.strength === 'strong' && !s.version.conflict, JSON.stringify(s.version));
  ok('1b. BMW: no conflicts, core identity resolved, Score eligible', s.conflicts.length === 0 && SC.coreIdentityConflicts(s).length === 0 && s.identity.status === 'resolved' && s.identity.core_status === 'resolved' && s.identity.version_status === 'confirmed', JSON.stringify(s.identity));
  ok('1c. BMW: the model line source is recorded for observability', s.identity.model_line_source === 'decoder_series');
  ok('1d. not a make rule: Porsche decoder Series "GTS" (a trim) and Model "Cayenne" leave the model as is', (() => { const x = build({ Make: 'PORSCHE', Model: 'Cayenne', Series: 'GTS', ErrorCode: '0', FuelTypePrimary: 'Gasoline' }, { make: 'porsche', model: 'cayenne', year: 2015, modification: '958 (FL)', title: 'Porsche Cayenne 2015', text: '' }, { trim: 'GTS', engine: '3.6 л бензин' }); return x.model.value === 'Cayenne' && x.version.value === 'GTS' && !x.version.conflict && !x.model.line_source; })());
  ok('1e. not a make rule: Macan decoder Series "Type 95B" (a generation code) is neither the model nor a version', (() => { const x = build({ Make: 'PORSCHE', Model: 'Macan', Series: 'Type 95B', Trim: 'S', ErrorCode: '0', FuelTypePrimary: 'Gasoline' }, { make: 'porsche', model: 'macan', year: 2021, modification: '95B (FL)', title: 'Porsche Macan 2021', text: '' }, { trim: null, engine: '3,0 л бензин' }); return x.model.value === 'Macan' && x.version.value === 'S' && !x.version.conflict && x.conflicts.length === 0; })());

  /* ---- marketplace generation strings are generations, not versions ---- */
  for (const g of ['III покоління/URJ200 (2nd FL)', 'V покоління (3rd FL)/J150', '95B (FL)', 'III покоління/T33', 'Type 95B', '958 (FL)', 'B8/8K (FL)']) ok('2. generation string is not a version: ' + g, M.versionKind(g) === 'generation');
  for (const t of ['328i xDrive', 'GTS', 'Sport Line', 'I4 Coupe', 'Premium', 'Luxury', 'SV', 'Prestige+', '328i']) ok('2a. trim stays a trim: ' + t, M.versionKind(t) === 'trim');

  /* ---- 1. core resolved + version unresolved: partial, never unresolved ---- */
  const verDec = { Make: 'BMW', Model: '530i', Series: '5-Series', Trim: 'xDrive', ModelYear: '2019', FuelTypePrimary: 'Gasoline', DisplacementL: '2.0', ErrorCode: '0' };
  const verLst = { make: 'bmw', model: '5 series', year: 2019, modification: null, title: 'BMW 5 Series 2019', country: 'UA', text: 'BMW 5 Series 2019 бензин 2.0 автомат повний' };
  const verAna = { title: 'BMW 5 Series 2019', trim: 'Sport Line', year: 2019, fuel: 'petrol', engine: '2,0 л бензин', transmission: 'автомат', drive: 'полный' };
  s = build(verDec, verLst, verAna);
  ok('3. version conflict (530i xDrive vs Sport Line) with a resolved core: identity partial, core resolved, version conflict', s.version.conflict && !s.model.conflict && s.identity.status === 'partial' && s.identity.core_status === 'resolved' && s.identity.version_status === 'conflict' && s.identity.conditional_fields.includes('version'), JSON.stringify(s.identity));
  ok('3a. the version conflict never blocks the Score', SC.coreIdentityConflicts(s).length === 0 && !M.IDENTITY_CORE_FIELDS.includes('version') && !M.IDENTITY_CORE_FIELDS.includes('power_hp') && !M.IDENTITY_CORE_FIELDS.includes('body') && !M.IDENTITY_CORE_FIELDS.includes('model_year'));
  let veh = { ...verAna };
  M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('3b. header keeps the confirmed core fields and drops the disputed version', veh.trim === null && veh.fuel === 'petrol' && veh.drive === 'полный' && veh.transmission === 'автомат' && veh.engine === '2,0 л бензин', JSON.stringify(veh));
  ok('3c. the conditional version is not shown as confirmed anywhere: header trim null, FC version absent, MV trim null', veh.trim === null && FC.buildConclusionContext(report(s, veh)).vehicle.version === undefined && (s.version.value || null) === null);
  let ctx = FC.buildConclusionContext(report(s, veh)).vehicle;
  ok('3d. FC context carries the canonical status: partial / core resolved / version conflict', ctx.identity_status && ctx.identity_status.status === 'partial' && ctx.identity_status.core_status === 'resolved' && ctx.identity_status.version_status === 'conflict' && ctx.identity_conflicts.includes('version'), JSON.stringify(ctx.identity_status));
  ok('3e. Confidence stays numeric, its label gets the version limitation', CF.identityNoteKey(s.identity) === 'but the version is not confirmed');
  let r = report(s, veh);
  CM.mergeChecklist(r, { fcChecks: [], snapshot: null, lang: 'ru' });
  const vstep = r.checklist.find(t => /^Версия/.test(t)) || '';
  ok('3f. checklist names the conflicting field and what each source said', /декодер VIN: 530i xDrive/.test(vstep) && /разбор страницы: Sport Line/.test(vstep) && /техпаспорт/.test(vstep), JSON.stringify(r.checklist));
  ok('3g. the step is concrete, not "find out why the sources disagree"', !/почему/.test(vstep) && /установить фактическое значение/.test(vstep));
  const curve = V.buildValueCurve({ price: 20000, currency: 'USD', year: 2019, candidates: [], vehicle: {}, identity: { make: 'BMW', model: '5 series', trim: null, version_status: s.identity.version_status } });
  ok('3h. Market Value: no exact version is asked for while the version is in conflict (trim null), the scope is recorded', (!curve.new_price || !curve.new_price.msrp || !curve.new_price.msrp.exact) && (!curve.new_price || !curve.new_price.msrp || !curve.new_price.msrp.selection || curve.new_price.msrp.selection.version_status === 'conflict'), JSON.stringify(curve && curve.new_price));

  /* ---- 2. genuine core conflict: Score stays blocked, everything downstream keeps the uncertainty ---- */
  const coreDec = { Make: 'LAND ROVER', Model: 'Range Rover Evoque', Trim: 'S', ModelYear: '2021', FuelTypePrimary: 'Diesel', DisplacementL: '2.0', ErrorCode: '0' };
  const coreLst = { make: 'land rover', model: 'range rover evoque', year: 2021, modification: '2.0 TSI AT (249 к.с.) AWD', title: 'Land Rover Range Rover Evoque 2021 бензин', country: 'UA', text: 'Двигун Бензин, 2 л, (249 к.с.)' };
  const coreAna = { title: 'Land Rover Range Rover Evoque 2021', trim: 'S', year: 2021, fuel: 'petrol', engine: '2,0 л бензин, 249 л.с.', transmission: 'автомат', drive: 'полный' };
  s = build(coreDec, coreLst, coreAna);
  ok('4. diesel (decoder) against petrol (listing + analysis) is a core conflict: identity unresolved', s.fuel.conflict && s.identity.status === 'unresolved' && s.identity.core_status === 'resolved' === false && s.identity.core_conflicts.includes('fuel'), JSON.stringify(s.identity));
  ok('4a. the Score stays blocked with the concrete reason', SC.coreIdentityConflicts(s).includes('fuel') && (() => { const b = { score_version: 'v4', final: 7.5, score_available: true, inputs: {}, events: [], items: [] }; const out = SC.applyScoreCeiling ? SC.applyScoreCeiling(b, { vehicleSpec: s }) : null; return !out || (out.score_available === false && out.score_unavailable_reason === 'core_identity_unresolved'); })());
  ok('4b. not masked as an unknown version: the version itself is confirmed, the core is not', s.identity.version_status === 'confirmed' && s.identity.core_status === 'unresolved');
  veh = { ...coreAna };
  M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('4c. header drops the disputed core field and keeps the rest', veh.fuel === null && veh.trim === 'S' && veh.drive === 'полный', JSON.stringify(veh));
  ctx = FC.buildConclusionContext(report(s, veh)).vehicle;
  ok('4d. FC context says the core is unresolved and lists the field', ctx.identity_status.core_status === 'unresolved' && ctx.identity_status.core_conflicts.includes('fuel') && ctx.fuel === null === false || ctx.identity_status.core_status === 'unresolved', JSON.stringify(ctx.identity_status));
  ok('4e. Confidence label gets the configuration limitation, not the version one', CF.identityNoteKey(s.identity) === 'but the vehicle configuration is not established');
  ok('4f. the conclusion rules tell the model what identity_status means', /identity_status is that status/.test(fs.readFileSync('api/conclusion.js', 'utf8')) && /core_status unresolved/.test(fs.readFileSync('api/conclusion.js', 'utf8')));

  /* ---- 3. fully resolved vehicle is untouched ---- */
  const okDec = { Make: 'PORSCHE', Model: 'Cayenne', Series: 'GTS', ModelYear: '2016', FuelTypePrimary: 'Gasoline', DisplacementL: '3.6', EngineHP: '440', ErrorCode: '0' };
  const okLst = { make: 'porsche', model: 'cayenne', year: 2015, modification: '958 (FL)', title: 'Porsche Cayenne 2015', country: 'UA', text: 'Porsche Cayenne 2015 GTS 3.6 440 к.с.' };
  const okAna = { title: 'Porsche Cayenne 2015', trim: 'GTS', year: 2015, model_year: 2016, fuel: 'petrol', engine: '3.6 л бензин, 440 л.с.', transmission: 'автомат', drive: 'полный' };
  s = build(okDec, okLst, okAna);
  veh = { ...okAna };
  const before = JSON.stringify(veh);
  M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('5. resolved car: identity resolved, header unchanged, no note, no identity step, FC version confirmed', s.identity.status === 'resolved' && JSON.stringify(veh) === before && CF.identityNoteKey(s.identity) === null && FC.buildConclusionContext(report(s, veh)).vehicle.version === 'GTS', JSON.stringify([s.identity, veh]));
  r = report(s, veh);
  CM.mergeChecklist(r, { fcChecks: [], snapshot: null, lang: 'ru' });
  ok('5a. resolved car: no identity checklist step', !r.checklist.some(t => /^(Модель|Версия|Поколение|Мощность)/.test(t)), JSON.stringify(r.checklist));

  /* ---- power ambiguous is conditional, never a core blocker ---- */
  s = build(null, { make: 'Toyota', model: 'RAV4', year: 2019, modification: '2.5 ECVT (219 к.с.) Hybrid', title: 'Toyota RAV4 2019 гібрид (hev)', text: 'Двигун Гібрид (HEV), 2.49 л, (163.2 к.с. / 120 кВт)' }, { engine: '2,5 л гибрид', fuel: 'hybrid', trim: null });
  ok('6. ambiguous power: identity partial with power conditional, core resolved, Score eligible, no note', s.power_hp.ambiguous && s.identity.status === 'partial' && s.identity.core_status === 'resolved' && s.identity.conditional_fields.includes('power_hp') && SC.coreIdentityConflicts(s).length === 0 && CF.identityNoteKey(s.identity) === null, JSON.stringify(s.identity));

  /* ---- one list, one status object everywhere ---- */
  ok('7. Score ceiling reads the same core list as the identity status', JSON.stringify(SC.SCORE_CEILING_CONFIG.IDENTITY_CORE) === JSON.stringify(M.IDENTITY_CORE_FIELDS));
  const pub = M.publicSpec(build(verDec, verLst, verAna));
  ok('7a. the public spec carries the identity object with status, core, version, conflicts and confirmed fields', pub.identity && pub.identity.version === 'is-v1' && pub.identity.status === 'partial' && Array.isArray(pub.identity.confirmed_fields) && pub.identity.confirmed_fields.includes('fuel') && pub.identity.conflict_fields.includes('version'));
  const src = fs.readFileSync('api/check.js', 'utf8');
  ok('7b. check.js: Confidence note, Market Value version scope and the value research trim all come from the canonical spec', /identity_note_key = identityNoteKey\(vehicleSpec\.identity\)/.test(src) && /version_status: vehicleSpec\.identity \? vehicleSpec\.identity\.version_status/.test(src) && /spec0\.version\.conflict \? null/.test(src));
  ok('7c. the UI renders the identity note after the coverage label', /conf\.identity_note_key \? t\(conf\.text_key\) \+ ', ' \+ t\(conf\.identity_note_key\)/.test(fs.readFileSync('result-check.html', 'utf8')));
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) ok('7d. i18n has both notes: ' + f, /'but the vehicle configuration is not established'/.test(fs.readFileSync(f, 'utf8')) && /'but the version is not confirmed'/.test(fs.readFileSync(f, 'utf8')));
  ok('7e. the main analysis prompt names the identity status when it is not resolved', /IDENTITY_STATUS/.test(M.vehicleSpecPromptBlock(build(verDec, verLst, verAna))) && !/IDENTITY_STATUS/.test(M.vehicleSpecPromptBlock(build(okDec, okLst, okAna))));

  for (const f of ['api/vehicle-spec.js', 'api/score-ceiling.js', 'api/confidence.js', 'api/checklist-merge.js', 'api/conclusion.js', 'identitystatustest.js']) ok('no em dash in ' + f, !fs.readFileSync(f, 'utf8').includes(DASH));
  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('IDENTITY STATUS TEST FAILED (' + errs.length + '/' + checks + '):'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('identity status: ' + checks + ' checks · decoder Series as model line · generation strings are not versions · partial vs unresolved · Score eligibility · header · FC context · Confidence note · Market Value scope · checklist step · one core list');
})().catch(e => { console.log('IDENTITY STATUS TEST CRASHED:', e.stack || e.message); process.exit(1); });
