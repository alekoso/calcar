/* Identity invariant: canonical fact status must not mutate as it flows
   through the report (header, discrepancies, risks, checklist, Final
   Conclusion context, consistency gate).

   A. resolved stays resolved;  B. an unresolved material conflict stays a
   conflict and no block picks a candidate;  C. unknown stays unknown and is
   not inferred from model knowledge;  D. equivalent values in other units or
   conventions (kW / hp / PS, CVT vs stepped automatic, trim vs generation
   code vs powertrain spec) are not identity conflicts.

   Replays the three audited cars with inputs reconstructed from their saved
   passports: Evoque 2021 (163 vs 245 hp), Audi A4 2013 (CVT vs 8-speed
   automatic, drivetrain unknown), Porsche Cayenne 2015 (GTS from decoder and
   analysis against a generation code from the marketplace).

   Run: node identityinvarianttest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_ident_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'vehicle-spec.js'));
  const FC = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const SRC = fs.readFileSync('api/check.js', 'utf8');
  const driveLabel = v => ({ awd: 'повний', fwd: 'передній', rwd: 'задній' }[v] || null);
  const build = (nhtsa, listing, analysis) => M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa, listing }), analysis, { nhtsa, listing });
  const report = (spec, vehicle, extra = {}) => ({ vehicle, risks: [], checklist: [], discrepancies: [], _meta: { lang: 'ru', vehicle_spec: M.publicSpec(spec), history_facts: {}, decision_inputs: { mileage_context: {} } }, score_breakdown: { events: [], inputs: {} }, ...extra });

  /* ================= 1. Evoque 2021: power conflict 163 vs 245 ================= */
  const evoDec = { Make: 'LAND ROVER', Model: 'Range Rover Evoque', FuelTypePrimary: 'Diesel', ElectrificationLevel: 'Mild HEV (Hybrid Electric Vehicle)', ErrorCode: '5,14', ErrorText: '5 - ...' };
  const evoLst = { make: 'Land Rover', model: 'Range Rover Evoque', year: 2021, modification: '2.0 Td4 MHEV AT (163 к.с.) AWD', title: 'Land Rover Range Rover Evoque 2021', country: 'UA',
    text: 'Range Rover Evoque 2021. Двигун 2.0 дизель. Потужність 245 к.с. Коробка автомат. Привід повний. Пробіг 46 тис. км.' };
  const evoAna = { title: 'Land Rover Range Rover Evoque 2021', trim: 'S', year: 2021, fuel: 'hybrid', engine: '2,0 л дизель MHEV, 163 л.с.', transmission: 'автоматическая', drive: 'полный' };
  let s = build(evoDec, evoLst, evoAna);
  ok('1. Evoque: the version is not a conflict: "2.0 Td4 MHEV AT (163 к.с.) AWD" is a powertrain spec, not a trim', !s.version.conflict && s.version.value === 'S', JSON.stringify(s.version));
  ok('1a. Evoque: power 163 vs 245 is a canonical conflict with both candidates', s.power_hp.conflict && s.power_hp.value === null && [...new Set(s.power_hp.candidates.map(c => c.value))].sort().join() === '163,245', JSON.stringify(s.power_hp));
  ok('1b. Evoque: primary fuel stays diesel, electrification is mild hybrid', s.fuel.value === 'diesel' && s.electrification.value === 'mild_hybrid', JSON.stringify([s.fuel.value, s.electrification.value]));
  ok('1c. Evoque: mileage norm class is diesel, not hev', M.powertrainClassFromSpec(s) === 'diesel');
  ok('1d. Evoque: conflicts list has power and not version', s.conflicts.includes('power_hp') && !s.conflicts.includes('version'), JSON.stringify(s.conflicts));
  let veh = { ...evoAna, drive: 'полный' };
  let ch = M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('1e. Evoque header: engine line loses the disputed figure, fuel becomes diesel, trim S stays', veh.engine === '2,0 л дизель MHEV' && veh.fuel === 'diesel' && veh.trim === 'S', JSON.stringify(veh));
  let notes = M.conflictNotes(s, 'ru');
  ok('1f. Evoque data_notes name the power conflict with both figures and no accusation', notes.some(n => /мощност/.test(n) && /163/.test(n) && /245/.test(n) && /не свидетельствует против продавца/.test(n)), JSON.stringify(notes));
  ok('1g. Evoque: a discrepancy about power is the passport\'s business, not the seller\'s', M.identityFieldOf({ title: 'Мощность двигателя', detail: 'В объявлении 163 и 245 л.с.' }) === 'power_hp');
  let pub = M.publicSpec(s);
  let ctx = FC.buildConclusionContext(report(s, veh));
  ok('1h. Evoque FC context: power is not a settled number, conflict is listed, fuel diesel + mild hybrid', ctx.vehicle.power_hp === undefined && ctx.vehicle.identity_conflicts.includes('power_hp') && ctx.vehicle.electrification === 'mild_hybrid', JSON.stringify(ctx.vehicle));
  let r = report(s, veh, { final_conclusion: { headline: 'Ухоженный Evoque с 163 л.с.', body: 'Двухлитровый дизель на 163 л.с. тянет уверенно.\n\nПробег небольшой.' }, risks: [{ title: 'Мотор', note: 'Дизель 163 л.с. надёжен.', action: 'проверить' }] });
  let out = RC.enforceReportConsistency(r, { lang: 'ru' });
  ok('1i. Evoque gate: a settled "163 л.с." is removed everywhere while power is in conflict; FC hidden because the headline asserts it', r.final_conclusion === null && r.risks.length === 0 && out.violations.some(v => v.field === 'power_hp' && v.canonical === 'conflict'), JSON.stringify(out.violations));
  r = report(s, veh, { final_conclusion: { headline: 'Ухоженный Evoque', body: 'Продавец указывает 163 л.с., а технический блок 245 л.с.: мощность нужно уточнить по документам.\n\nПробег небольшой.' } });
  out = RC.enforceReportConsistency(r, { lang: 'ru' });
  ok('1j. Evoque gate: naming both candidates as a source disagreement is allowed', r.final_conclusion && out.violations.length === 0, JSON.stringify(out.violations));

  /* ================= 2. Audi A4 2013: CVT vs 8-speed automatic, drivetrain unknown ================= */
  const a4Dec = { Make: 'AUDI', Model: 'A4', Trim: 'Premium', ModelYear: '2014', FuelTypePrimary: 'Gasoline', DisplacementL: '1.984', TransmissionStyle: 'Automatic', BodyClass: 'Sedan/Saloon', ErrorCode: '0' };
  const a4Lst = { make: 'Audi', model: 'A4', year: 2013, modification: 'B8/8K (FL)', title: 'Audi A4 2013', country: 'UA', text: 'Audi A4 2013. 2.0 бензин. Коробка: Варіатор. Продавець: 8-ступенчатый автомат.' };
  const a4Ana = { title: 'Audi A4 2013', trim: 'Premium', year: 2013, model_year: 2014, fuel: 'petrol', engine: '2,0 л бензин, 220 л.с.', transmission: 'Автоматическая', drive: null };
  const a4LstCvt = { ...a4Lst, modification: '2.0 TFSI CVT' };
  s = build(a4Dec, a4LstCvt, a4Ana);
  ok('2. A4: "B8/8K (FL)"-style generation code never makes a version conflict; Premium is the version', (() => { const t = build(a4Dec, a4Lst, a4Ana); return !t.version.conflict && t.version.value === 'Premium'; })());
  ok('2a. A4: CVT vs automatic is one family: transmission resolved as automatic family, no conflict', !s.transmission.conflict && s.transmission.value && s.conflicts.length === 0, JSON.stringify([s.transmission, s.conflicts]));
  ok('2b. A4: the exact gearbox type is not established and keeps both candidates', s.transmission_type.exact === false && s.transmission_type.candidates.map(c => c.value).sort().join() === 'automatic,cvt', JSON.stringify(s.transmission_type));
  ok('2b2. A4 (production path): the gearbox named only in the marketplace technical block of the page text still counts: exact type not established', (() => { const t = build(a4Dec, { ...a4Lst, text: 'Audi A4 2013. Коробка передач: Варіатор. Двигун 2.0.' }, a4Ana); return t.transmission_type.exact === false && t.transmission_type.candidates.map(c => c.value).sort().join() === 'automatic,cvt' && !t.transmission.conflict; })());
  ok('2b3. A4: a seller free-text remark without a label does not create a gearbox candidate', (() => { const t = build(a4Dec, { ...a4Lst, text: 'Коробка работает отлично, вариатор обслужен.' }, a4Ana); return t.transmission_type.exact === true && t.transmission_type.value === 'automatic'; })());
  ok('2b4. A4 data_notes: joined sources are localized, no raw "decoder+analysis" key', (() => { const t = build(a4Dec, { ...a4Lst, text: 'Коробка передач: Варіатор.' }, a4Ana); const n = M.conflictNotes(t, 'ru'); return n.length === 1 && !/decoder|analysis|listing/.test(n[0]) && /декодер VIN и разбор/.test(n[0]); })(), JSON.stringify(M.conflictNotes(build(a4Dec, { ...a4Lst, text: 'Коробка передач: Варіатор.' }, a4Ana), 'ru')));
  ok('2c. A4: drivetrain is unknown, not inferred', s.drivetrain.value === null && !s.drivetrain.conflict && M.publicSpec(s).unknown.includes('drivetrain'));
  notes = M.conflictNotes(s, 'ru');
  ok('2d. A4 data_notes: the exact type is worded as unestablished, not as a contradiction', notes.length === 1 && /автоматическая/.test(notes[0]) && /не противоречие/.test(notes[0]), JSON.stringify(notes));
  ok('2e. A4: a "transmission type contradiction" discrepancy belongs to the passport and is dropped', M.identityFieldOf({ title: 'Разный тип трансмиссии', detail: 'Продавец указывает 8-ступенчатую АКПП, а технический блок вариатор. Это несовместимые характеристики.' }) === 'transmission');
  ok('2f. A4: model year 2014 and production year 2013 are two facts, no conflict', s.model_year.value === 2014 && s.production_year.value === 2013 && !s.model_year.conflict && !s.production_year.conflict);
  veh = { ...a4Ana };
  ch = M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('2g. A4 header: drive stays null (unknown is not filled), model year kept, trim Premium kept', veh.drive === null && veh.model_year === 2014 && veh.trim === 'Premium', JSON.stringify(veh));
  ctx = FC.buildConclusionContext(report(s, veh));
  ok('2h. A4 FC context: drivetrain listed as unknown, gearbox exact candidates listed, both years present', ctx.vehicle.identity_unknown.includes('drivetrain') && ctx.vehicle.transmission_exact_candidates.length === 2 && ctx.vehicle.model_year === 2014 && ctx.vehicle.production_year === 2013, JSON.stringify(ctx.vehicle));
  r = report(s, veh, { final_conclusion: { headline: 'Аккуратная A4', body: 'Полный привод quattro уверенно держит дорогу. Салон выглядит ухоженно, а пробег для возраста нормальный. Кузов на фото без заметных дефектов. Светлый салон опрятен.\n\nКоробка автоматическая, точный тип не установлен. Перед покупкой стоит установить код агрегата.' }, checklist: ['Проверить задний редуктор полного привода.', 'Коробка: установить код агрегата.'] });
  out = RC.enforceReportConsistency(r, { lang: 'ru' });
  ok('2i. A4 gate: drivetrain inferred from model knowledge is removed; "automatic, exact type not established" stays', r.final_conclusion && !/quattro/.test(r.final_conclusion.body) && /точный тип не установлен/.test(r.final_conclusion.body) && r.checklist.length === 1, JSON.stringify([r.final_conclusion, r.checklist, out.violations]));
  ok('2j. A4: the prompt block says the family is known and the exact type is not, and forbids "incompatible"', /точний тип ні/.test(M.vehicleSpecPromptBlock(s)) && /НЕ "несумісні характеристики"/.test(M.vehicleSpecPromptBlock(s)));

  /* ================= 3. Porsche Cayenne 2015: GTS from decoder and analysis, generation code from the marketplace ================= */
  const cayDec = { Make: 'PORSCHE', Model: 'Cayenne', Trim: 'GTS', ModelYear: '2016', FuelTypePrimary: 'Gasoline', DisplacementL: '3.6', EngineHP: '440', ErrorCode: '0' };
  const cayLst = { make: 'Porsche', model: 'Cayenne', year: 2015, modification: '958 (FL)', title: 'Porsche Cayenne 2015', country: 'UA', text: 'Porsche Cayenne 2015 GTS 3.6 440 к.с.' };
  const cayAna = { title: 'Porsche Cayenne 2015', trim: 'GTS', year: 2015, model_year: 2016, fuel: 'petrol', engine: '3.6 л бензин, 440 л.с.', transmission: 'автомат', drive: 'полный' };
  s = build(cayDec, cayLst, cayAna);
  ok('3. Cayenne: GTS resolved strong (decoder + analysis), "958 (FL)" is a generation code', s.version.value === 'GTS' && s.version.strength === 'strong' && !s.version.conflict && s.conflicts.length === 0, JSON.stringify([s.version, s.conflicts]));
  ok('3a. Cayenne: 440 SAE hp (decoder) and 440 л.с. are one power', !s.power_hp.conflict && M.powerEquivalent(s.power_hp.value, 440), JSON.stringify(s.power_hp));
  veh = { ...cayAna, trim: null };
  M.syncHeaderWithSpec(veh, s, { driveLabel });
  ok('3b. Cayenne header: the established version is written into the empty trim', veh.trim === 'GTS');
  ctx = FC.buildConclusionContext(report(s, veh));
  ok('3c. Cayenne FC context: version GTS is established, no identity conflicts', ctx.vehicle.version === 'GTS' && ctx.vehicle.identity_conflicts === undefined, JSON.stringify(ctx.vehicle));
  r = report(s, veh, { final_conclusion: { headline: 'Cayenne с вопросами к воде', body: 'Это Cayenne GTS с мощным мотором. Кузов на фото выглядит аккуратно. Салон со складками на коже.\n\nСредняя объединяет разные исполнения, а точная версия здесь пока не установлена, поэтому разница ещё не говорит о завышении. Малый пробег не оправдывает доплату. История затопления важнее пробега.' }, risks: [{ title: 'Двигатель', note: 'У GTS мощный мотор.', action: 'проверить' }] });
  out = RC.enforceReportConsistency(r, { lang: 'ru' });
  ok('3d. Cayenne gate: "version not established" is removed when the version is established; GTS in risks stays', r.final_conclusion && !/не установлена/.test(r.final_conclusion.body) && /Cayenne GTS/.test(r.final_conclusion.body) && r.risks.length === 1, JSON.stringify([r.final_conclusion && r.final_conclusion.body, out.violations]));
  /* the opposite status: a genuine trim conflict */
  const cayLstS = { ...cayLst, modification: 'S' };
  const s2 = build(cayDec, cayLstS, cayAna);
  ok('3e. Cayenne control: GTS (decoder, analysis) vs S (marketplace trim) is a real version conflict', s2.version.conflict && s2.conflicts.includes('version'));
  veh = { ...cayAna };
  M.syncHeaderWithSpec(veh, s2, { driveLabel });
  r = report(s2, veh, { final_conclusion: { headline: 'Cayenne GTS с вопросами к воде', body: 'Это Cayenne GTS с мощным мотором.\n\nИстория затопления важнее пробега.' }, risks: [{ title: 'Двигатель GTS', note: 'У версии GTS мощный мотор.', action: 'проверить' }] });
  out = RC.enforceReportConsistency(r, { lang: 'ru' });
  ok('3f. Cayenne control: while the version conflicts, no block may assert GTS: header trim null, risk dropped, FC hidden (headline)', veh.trim === null && r.risks.length === 0 && r.final_conclusion === null && out.violations.every(v => v.canonical === 'conflict'), JSON.stringify([veh.trim, r.risks, out.violations]));
  ctx = FC.buildConclusionContext(report(s2, veh));
  ok('3g. Cayenne control FC context: version absent, conflict listed', ctx.vehicle.version === undefined && ctx.vehicle.identity_conflicts.includes('version'));

  /* ================= 4. unit normalisation ================= */
  ok('4. 200 kW, 268 hp and 272 PS are one power', M.normPower('200 кВт') === 272 && M.normPower('268 hp') === 268 && M.powerEquivalent(272, 268) && M.powerEquivalent(272, 275));
  const kwDec = { Make: 'BMW', Model: 'X5', EngineHP: '335', FuelTypePrimary: 'Gasoline', ErrorCode: '0' };
  const kwSpec = build(kwDec, { make: 'BMW', model: 'X5', year: 2019, modification: '3.0 AT (250 кВт)', text: 'Потужність 340 к.с.' }, { engine: '3.0 л бензин, 340 л.с.' });
  ok('4a. decoder 335 SAE hp, listing 250 kW and 340 л.с. do not conflict', !kwSpec.power_hp.conflict && kwSpec.power_hp.value !== null, JSON.stringify(kwSpec.power_hp));
  ok('4b. 163 vs 245 is a conflict even after normalisation', !M.powerEquivalent(163, 245));
  ok('4c. gate: a report figure in kW equal to the established hp is not a violation', RC.sentenceViolations('Мотор на 250 кВт тянет уверенно.', RC.canonicalFacts(report(kwSpec, {}))).length === 0);
  ok('4d. gate: a different figure is a violation against established power', RC.sentenceViolations('Мотор на 420 л.с. тянет уверенно.', RC.canonicalFacts(report(kwSpec, {}))).some(v => v.domain === 'power_hp'));

  /* ================= 5. unknown stays unknown; MHEV; years ================= */
  const unkSpec = build(null, { make: 'Toyota', model: 'Camry', year: 2014, modification: '2.5 AT', text: '' }, { fuel: 'petrol', engine: '2,5 л бензин', transmission: 'автомат', drive: null });
  ok('5. no source names the drivetrain: unknown, and the prompt block says so', unkSpec.drivetrain.value === null && M.publicSpec(unkSpec).unknown.includes('drivetrain') && /НЕВІДОМО[^\n]*drivetrain/.test(M.vehicleSpecPromptBlock(unkSpec)));
  r = report(unkSpec, { fuel: 'petrol', drive: null }, { final_conclusion: { headline: 'Camry', body: 'Передний привод и атмосферный мотор делают её простой. Салон выглядит ухоженно, кузов без заметных дефектов. Это понятная массовая машина.\n\nПробег нормальный для возраста. Владельцев двое.' } });
  out = RC.enforceReportConsistency(r, { lang: 'ru' });
  ok('5a. gate: a drivetrain stated for an unknown-drivetrain car is removed', r.final_conclusion && !/Передний привод/.test(r.final_conclusion.body) && out.violations.some(v => v.domain === 'identity_unknown' && v.field === 'drivetrain'), JSON.stringify([r.final_conclusion, out.violations]));
  const mhevDec = { Make: 'AUDI', Model: 'Q7', FuelTypePrimary: 'Diesel', ElectrificationLevel: 'Mild HEV (Hybrid Electric Vehicle)', DisplacementL: '3.0', ErrorCode: '0' };
  const mhev = build(mhevDec, { make: 'Audi', model: 'Q7', year: 2020, modification: '45 TDI MHEV quattro' }, { fuel: 'hybrid', engine: '3,0 л дизель, мягкий гибрид' });
  ok('5b. diesel MHEV keeps diesel as primary fuel and mild_hybrid as electrification; class diesel', mhev.fuel.value === 'diesel' && !mhev.fuel.conflict && mhev.electrification.value === 'mild_hybrid' && M.powertrainClassFromSpec(mhev) === 'diesel', JSON.stringify([mhev.fuel, mhev.electrification]));
  veh = { fuel: 'hybrid', engine: '3,0 л дизель, мягкий гибрид' };
  M.syncHeaderWithSpec(veh, mhev, { driveLabel });
  ok('5c. header fuel of a diesel MHEV is diesel', veh.fuel === 'diesel');
  const fullHybrid = build({ Make: 'TOYOTA', Model: 'RAV4', FuelTypePrimary: 'Gasoline', ElectrificationLevel: 'Strong HEV (Hybrid Electric Vehicle)', ErrorCode: '0' }, { make: 'Toyota', model: 'RAV4', year: 2021, modification: '2.5 Hybrid' }, { fuel: 'hybrid', engine: '2,5 л гибрид' });
  ok('5d. a full hybrid is still class hev', M.powertrainClassFromSpec(fullHybrid) === 'hev' && fullHybrid.electrification.value === 'hybrid');
  const yrs = build({ Make: 'BMW', Model: 'X5', ModelYear: '2017', FuelTypePrimary: 'Gasoline', ErrorCode: '0' }, { make: 'BMW', model: 'X5', year: 2016 }, { year: 2016, model_year: 2017, fuel: 'petrol' });
  ok('5e. model year 2017 and registration year 2016 live side by side without a conflict', yrs.model_year.value === 2017 && yrs.production_year.value === 2016 && yrs.conflicts.length === 0);
  ok('5f. a discrepancy framing the year difference as deception is not an identity field (handled by the prompt rule), owners are not either', M.identityFieldOf({ title: 'Количество владельцев', detail: 'один против трёх' }) === null);

  /* ================= 6. wiring ================= */
  ok('6. check.js: header follows the passport through syncHeaderWithSpec with a localized drive label', /vehicleSpec\.header_sync = syncHeaderWithSpec\(parsed\.vehicle, vehicleSpec, \{ driveLabel: v => localizeDrive\(v, lang\) \}\);/.test(SRC) && !/parsed\.vehicle\[HEADER_FIELD\[f\]\] = null/.test(SRC));
  ok('6a. check.js: identity-field discrepancies are dropped as the passport\'s business', /const f = identityFieldOf\(it\);/.test(SRC) && /reason: 'identity_field'/.test(SRC));
  ok('6b. no model-specific identity hacks', !/quattro\s*=|Tiptronic/.test(fs.readFileSync('api/vehicle-spec.js', 'utf8')) && !/auto\.ria|autoria/i.test(fs.readFileSync('api/vehicle-spec.js', 'utf8')));
  ok('6c. FC context exposes canonical version, power, electrification, exact gearbox, both years, unknown list', /version: str\(vsv\('version'\), 80\)/.test(fs.readFileSync('api/conclusion.js', 'utf8')) && /identity_unknown:/.test(fs.readFileSync('api/conclusion.js', 'utf8')));
  ok('6d. ceiling core identity does not include version or power (a trim conflict never zeroes the score)', !/IDENTITY_CORE: \[[^\]]*(?:version|power_hp)/.test(fs.readFileSync('api/score-ceiling.js', 'utf8')));
  for (const f of ['api/vehicle-spec.js', 'api/report-consistency.js', 'api/conclusion.js', 'identityinvarianttest.js']) ok('no em dash in ' + f, !fs.readFileSync(f, 'utf8').includes(DASH));

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('IDENTITY INVARIANT TEST FAILED (' + errs.length + '/' + checks + '):'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('identity invariant: ' + checks + ' checks · Evoque power conflict kept everywhere · A4 gearbox family known, exact type not, drivetrain unknown · Cayenne GTS established vs genuine trim conflict · kW/hp/PS one power · MHEV keeps diesel · years separate · wiring');
})().catch(e => { console.log('IDENTITY INVARIANT TEST CRASHED:', e.stack || e.message); process.exit(1); });
