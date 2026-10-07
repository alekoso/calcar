/* Канонічний паспорт авто (api/vehicle-spec.js) і його проводка у Check.

   Форми відмов з аудиту 15 звітів:
   1. слабкий декодер (неповний розбір vPIC) проти сильних даних оголошення,
      реєстру і фото: Prado "2.0 бензин" проти 3.0 дизеля;
   2. привід: Bentley RWD з неповного декоду проти AWD оголошення;
   3. коробка: "2.0 MT" проти варіатора, автомат проти варіатора не конфлікт;
   4. наддув: компресор проти турбо;
   5. модельний рік проти року виробництва чи оголошення;
   6. нерозвʼязаний конфлікт двох сильних джерел лишається конфліктом, а не
      стає обманом продавця.
   Плюс сторожа проводки: промпт, Score, Value, MI, Confidence, Final
   Conclusion читають паспорт, а не власні ланцюжки listing || nhtsa.

   Запуск: node vehiclespectest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_vspec_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'vehicle-spec.js'));
  const SRC = fs.readFileSync('api/vehicle-spec.js', 'utf8');
  const CHECK = fs.readFileSync('api/check.js', 'utf8');
  const CONC = fs.readFileSync('api/conclusion.js', 'utf8');

  /* ---- 1. слабкий декодер проти сильних даних (Prado) ---- */
  const pradoDec = { Make: 'TOYOTA', Model: 'Land Cruiser Prado', FuelTypePrimary: 'Gasoline', DisplacementL: '2.0', DriveType: '4WD/4-Wheel Drive/4x4', ErrorCode: '1,11,14,400', ErrorText: '1 - Check Digit (9th position) does not calculate properly' };
  const pradoLst = { make: 'Toyota', model: 'Land Cruiser Prado', year: 2013, title: 'Toyota Land Cruiser Prado 2013', modification: '3.0 D-4D AT (173 к.с.)', country: 'UA' };
  let s0 = M.buildVehicleSpec({ nhtsa: pradoDec, listing: pradoLst });
  ok('1. неповний розбір: декодер слабкий, його технічні поля названі ненадійними', !s0.decoder.strong && s0.decoder.unreliable_fields.includes('fuel') && s0.decoder.unreliable_fields.includes('displacement_l') && s0.decoder.unreliable_fields.includes('drivetrain'));
  ok('1a. до аналізу: паливо і обʼєм з модифікації площадки, слабкий декодер не перебиває', s0.fuel.value === 'diesel' && s0.fuel.source === 'listing' && s0.displacement_l.value === 3 && s0.transmission.value === 'automatic' && !s0.fuel.conflict && !s0.displacement_l.conflict, JSON.stringify(s0.fuel));
  ok('1b. привід відомий лише слабкому декодеру: невідомий, а не поганий', s0.drivetrain.value === null && s0.drivetrain.strength === 'weak' && !s0.drivetrain.conflict && s0.drivetrain.candidates.length === 1);
  const pb = M.vehicleSpecPromptBlock(s0);
  ok('1c. у промпт слабкі поля декодера не йдуть, є пряма заборона робити з них розбіжність', !/"drivetrain"/.test(pb) && /НЕПОВНО/.test(pb) && /НЕ створюй/.test(pb) && /"fuel":\{"value":"diesel"/.test(pb));
  ok('1d. довірений вид декодера для аналізу і Confidence: лише марка і модель', JSON.stringify(Object.keys(M.trustedDecoderView(pradoDec)).sort()) === JSON.stringify(['ErrorCode', 'ErrorText', 'Make', 'Model']));
  let s = M.reconcileVehicleSpec(s0, { fuel: 'diesel', engine: '3.0 л турбодизель, 173 к.с.', drive: 'повний', transmission: 'автомат', year: 2013, model_year: null }, { nhtsa: pradoDec, listing: pradoLst });
  ok('1e. після аналізу: дизель 3.0 турбо, повний привід; конфліктів немає', s.fuel.value === 'diesel' && s.fuel.strength === 'strong' && s.displacement_l.value === 3 && s.forced_induction.value === 'turbo' && s.drivetrain.value === 'awd' && s.drivetrain.source === 'analysis' && s.conflicts.length === 0, JSON.stringify(s.conflicts));
  const pradoDisc = { severity: 'high', title: "Паливо та об'єм двигуна не збігаються", detail: "VIN-декодування вказує бензиновий двигун об'ємом 2,0 л, тоді як технічний блок оголошення вказує дизельний 3,0 л.", sources: ['VIN', 'технічний блок оголошення'] };
  const hit = M.identityConflictItem(pradoDisc, s);
  ok('1f. розбіжність "декодер проти оголошення" на слабкому декодері прибирається як weak_decoder', hit && hit.reason === 'weak_decoder' && hit.field === 'fuel', JSON.stringify(hit));
  ok('1g. справжня розбіжність з продавцем (власники) не чіпається', M.identityConflictItem({ title: 'Кількість власників', detail: 'Продавець каже другий власник, реєстр показує чотирьох' }, s) === null);
  ok('1h. ризик і пункт чеклиста на тому самому слабкому декодері теж прибираються', M.identityConflictItem({ title: 'Невідповідність даних про двигун', note: 'VIN-декодування NHTSA вказує бензин 2.0' }, s) !== null && M.identityConflictItem({ text: 'Звірити паливо і обʼєм за VIN-декодуванням' }, s) !== null);
  ok('1i. UNKNOWN не стає BAD: клас силової установки з паспорта до аналізу і після', M.powertrainClassFromSpec(s0) === 'diesel' && M.powertrainClassFromSpec(M.buildVehicleSpec({ nhtsa: pradoDec, listing: { make: 'Toyota', model: 'Prado' } })) === 'unknown' && M.powertrainClassFromSpec(s) === 'diesel');

  /* ---- 2. привід: Bentley RWD слабкого декоду проти AWD оголошення ---- */
  const bentDec = { Make: 'BENTLEY', Model: 'Continental', DriveType: 'RWD/Rear-Wheel Drive', TransmissionStyle: 'Automatic', ErrorCode: '5,14' };
  s0 = M.buildVehicleSpec({ nhtsa: bentDec, listing: { make: 'Bentley', model: 'Continental GT', year: 2020, title: 'Bentley Continental GT 2020', modification: '6.0 W12 AWD' } });
  s = M.reconcileVehicleSpec(s0, { drive: 'Повний', transmission: 'Автоматична', engine: '6.0 л бензин W12, 635 к.с.', fuel: 'petrol' }, { nhtsa: bentDec, listing: { modification: '6.0 W12 AWD' } });
  ok('2. слабкий RWD декодера програє AWD площадки і аналізу без конфлікту', s.drivetrain.value === 'awd' && s.drivetrain.strength === 'strong' && !s.drivetrain.conflict && s.conflicts.length === 0);
  ok('2a. розбіжність про привід із VIN прибирається', M.identityConflictItem({ title: 'Привід: AWD у оголошенні проти RWD у VIN-декодуванні', detail: 'Технічний блок AUTO.RIA вказує AWD, а VIN-декодування NHTSA зазначає RWD' }, s) !== null);
  ok('2b. форми приводу: канон для декодера, площадки і трьох мов', M.normDrive('4WD/4-Wheel Drive/4x4') === 'awd' && M.normDrive('Передній') === 'fwd' && M.normDrive('задний') === 'rwd' && M.normDrive('xDrive') === 'awd' && M.normDrive('quattro') === 'awd' && M.normDrive('') === null && M.normDrive('седан') === null);

  /* ---- 3. коробка ---- */
  ok('3. автомат і варіатор одного сімейства: не конфлікт; механіка проти варіатора: конфлікт', (() => {
    const dec = { Make: 'NISSAN', Model: 'Qashqai', TransmissionStyle: 'Continuously Variable Transmission (CVT)', ErrorCode: '0' };
    const a = M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa: dec, listing: {} }), { transmission: 'автомат' }, { nhtsa: dec, listing: {} });
    const b = M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa: dec, listing: {} }), { transmission: 'механіка' }, { nhtsa: dec, listing: {} });
    return a.transmission.value === 'cvt' && !a.transmission.conflict && b.transmission.conflict && b.transmission.value === null && b.conflicts.includes('transmission');
  })());
  ok('3a. форми коробки', M.normTransmission('2.0 MT') === 'manual' && M.normTransmission('варіатор') === 'cvt' && M.normTransmission('DSG') === 'dct' && M.normTransmission('9G-Tronic') === 'automatic' && M.normTransmission('Manual/Standard') === 'manual' && M.normTransmission('') === null);

  /* ---- 4. наддув: компресор проти турбо ---- */
  const rrDec = { Make: 'LAND ROVER', Model: 'Range Rover', Trim: 'Supercharged', FuelTypePrimary: 'Gasoline', DisplacementL: '5.0', ErrorCode: '0', OtherEngineInfo: 'Supercharged' };
  s0 = M.buildVehicleSpec({ nhtsa: rrDec, listing: { make: 'Land Rover', model: 'Range Rover', year: 2013, modification: '5.0 Supercharged AT (510 к.с.)' } });
  ok('4. наддув з сильного декодера і площадки: компресор', s0.forced_induction.value === 'supercharger' && s0.forced_induction.strength === 'strong');
  s = M.reconcileVehicleSpec(s0, { engine: '5.0 л бензин V8 турбо, 510 к.с.', fuel: 'petrol' }, { nhtsa: rrDec, listing: { modification: '5.0 Supercharged AT (510 к.с.)' } });
  ok('4a. аналіз назвав мотор турбо: конфлікт, значення не вибране, шапка двигуна знімається', s.forced_induction.conflict && s.forced_induction.value === null && s.conflicts.includes('forced_induction'));
  s = M.reconcileVehicleSpec(s0, { engine: '5.0 л бензин V8 з компресором, 510 к.с.', fuel: 'petrol' }, { nhtsa: rrDec, listing: { modification: '5.0 Supercharged AT (510 к.с.)' } });
  ok('4b. аналіз підтвердив компресор: без конфлікту, паспорт несе supercharger для висновку', s.forced_induction.value === 'supercharger' && s.conflicts.length === 0 && M.publicSpec(s).fields.forced_induction.value === 'supercharger');
  ok('4c. форми наддуву', M.normForcedInduction('3.0 TFSI') === 'turbo' && M.normForcedInduction('2.0 TDI') === 'turbo' && M.normForcedInduction('компрессор') === 'supercharger' && M.normForcedInduction('атмосферний 3.6') === 'na' && M.normForcedInduction('2.0 л бензин') === null && M.normForcedInduction('twincharged turbo supercharger') === null);

  /* ---- 5. модельний рік проти року виробництва і оголошення ---- */
  const q7Dec = { Make: 'AUDI', Model: 'Q7', ModelYear: '2017', FuelTypePrimary: 'Gasoline', DisplacementL: '3', DriveType: 'AWD/All-Wheel Drive', TransmissionStyle: 'Automatic', ErrorCode: '0' };
  s0 = M.buildVehicleSpec({ nhtsa: q7Dec, listing: { make: 'Audi', model: 'Q7', year: 2016, modification: '3.0 TFSI quattro AT (333 к.с.)' } });
  s = M.reconcileVehicleSpec(s0, { year: 2016, model_year: 2017, fuel: 'petrol', engine: '3.0 л бензин V6 турбо', drive: 'повний', transmission: 'автоматична' }, { nhtsa: q7Dec, listing: { year: 2016, modification: '3.0 TFSI quattro AT (333 к.с.)' } });
  ok('5. модельний рік 2017 (декодер) і рік випуску 2016 (оголошення) живуть окремо, конфлікту немає', s.model_year.value === 2017 && s.model_year.source === 'decoder+analysis' && s.production_year.value === 2016 && s.conflicts.length === 0, JSON.stringify([s.model_year, s.production_year]));
  ok('5a. рік із слабкого декодера модельним роком не стає', M.buildVehicleSpec({ nhtsa: { Make: 'X', ModelYear: '2001', ErrorCode: '8' }, listing: { year: 2013 } }).model_year.value === null);
  ok('5b. два сильні джерела з різним модельним роком: конфлікт, а не вибір за алфавітом', M.reconcileVehicleSpec(s0, { model_year: 2015 }, { nhtsa: q7Dec, listing: {} }).model_year.conflict === true);

  /* ---- 6. нерозвʼязаний конфлікт двох сильних джерел ---- */
  const bmwDec = { Make: 'BMW', Model: 'X5', FuelTypePrimary: 'Diesel', DisplacementL: '3.0', DriveType: 'AWD/All-Wheel Drive', ErrorCode: '0' };
  s0 = M.buildVehicleSpec({ nhtsa: bmwDec, listing: { make: 'BMW', model: 'X5', year: 2015 } });
  s = M.reconcileVehicleSpec(s0, { fuel: 'petrol', engine: '3.0 л бензин, 306 к.с.', drive: 'задній' }, { nhtsa: bmwDec, listing: {} });
  ok('6. сильний декодер проти аналізу: паливо і привід у конфлікті, значень немає', s.fuel.conflict && s.fuel.value === null && s.drivetrain.conflict && s.drivetrain.value === null && s.conflicts.includes('fuel') && s.conflicts.includes('drivetrain'));
  ok('6a. конфлікт не стає розбіжністю з продавцем: пункт про паливо з VIN прибирається як identity_conflict', (M.identityConflictItem({ title: 'Паливо: дизель за VIN проти бензину в оголошенні', detail: 'Продавець вводить в оману' }, s) || {}).reason === 'identity_conflict');
  const notes = M.conflictNotes(s, 'ua');
  ok('6b. нотатка для людини нейтральна і називає обидва джерела', notes.length === 2 && /Джерела розходяться/.test(notes[0]) && /декодер VIN/.test(notes[0]) && /розбір сторінки/.test(notes[0]) && /не свідчить проти продавця/.test(notes[0]) && M.conflictNotes(s, 'en')[0].startsWith('Sources disagree') && M.conflictNotes(s, 'ru')[0].startsWith('Источники расходятся'));
  ok('6c. гібрид не суперечить бензину (MHEV), електро суперечить ДВЗ', !M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa: q7Dec, listing: {} }), { fuel: 'hybrid' }, { nhtsa: q7Dec, listing: {} }).fuel.conflict && M.reconcileVehicleSpec(M.buildVehicleSpec({ nhtsa: q7Dec, listing: {} }), { fuel: 'electric' }, { nhtsa: q7Dec, listing: {} }).fuel.conflict);
  ok('6d. публічний паспорт несе значення, джерело, силу, конфлікт і кандидатів конфлікту', (() => { const p = M.publicSpec(s); return p.version === 'vs-v1' && p.decoder.strong && p.fields.fuel.conflict && p.fields.fuel.candidates.length === 2 && p.fields.displacement_l.value === 3 && p.conflicts.length === 2; })());
  ok('6e. без декодера і без аналізу все невідоме, нічого не падає', (() => { const e = M.reconcileVehicleSpec(M.buildVehicleSpec({}), null, {}); return e.fuel.value === null && e.conflicts.length === 0 && M.powertrainClassFromSpec(e) === 'unknown' && M.vehicleSpecPromptBlock(e).includes('VEHICLE_SPEC'); })());

  /* ---- 7. проводка у Check ---- */
  const core = CHECK.slice(CHECK.indexOf('async function runCheck('));
  ok('7. паспорт будується одразу після гейту року декодера і до будь-якого використання', core.indexOf('const spec0 = buildVehicleSpec({ nhtsa, listing });') > core.indexOf('nhtsa = gateDecoderYear(nhtsa);') && core.indexOf('const spec0 = buildVehicleSpec') < core.indexOf('startCheckResearch({'));
  ok('7a. промпт отримує довірений вид декодера і блок VEHICLE_SPEC', /nhtsaForPrompt\(trustedDecoderView\(nhtsa\)\)/.test(CHECK) && /if \(spec\) blocks\.push\(vehicleSpecPromptBlock\(spec\)\);/.test(CHECK) && /PROMPT\(listing, nhtsa, auction, langDirective, auctionSearch, cvEvidence, spec0\)/.test(core));
  ok('7b. правило промпту: технічні характеристики з VEHICLE_SPEC, слабкий декодер не стає розбіжністю', /Технічні характеристики бери з VEHICLE_SPEC/.test(CHECK) && /Декодер це доказ, а не істина/.test(CHECK) && !/Технічні характеристики бери з VIN-декодування/.test(CHECK));
  ok('7c. Score v3, v4 і mileage context беруть клас силової установки з паспорта', (core.match(/powertrainClassFromSpec\(vehicleSpec\)/g) || []).length >= 3 && /const ptClass = powertrainClassFromSpec\(spec0\);/.test(core) && !/resolvePowertrainClass\(\{ nhtsa/.test(core));
  ok('7d. Value: трим, паливо, обʼєм і привід з паспорта, слабкий декодер не потрапляє', /trim: spec0\.version\.value \|\| null, body: spec0\.body\.value \|\| null,/.test(core) && /fuel: vehicleSpec\.fuel\.value \|\| null, displacement_l: vehicleSpec\.displacement_l\.value \|\| null/.test(core) && /trim: vehicleSpec\.version\.value \|\| null/.test(core) && !/trim: \(nhtsa && \(nhtsa\.Trim \|\| nhtsa\.Series\)\) \|\| listing\.modification \|\| null, body: \(nhtsa/.test(core));
  ok('7e. MI research: версія і мотор лише від декодера з чистим розбором; фінал бере version_trusted і клас з паспорта', /version_text: \(spec0\.decoder\.strong && nhtsa && \(nhtsa\.Trim \|\| nhtsa\.Series\)\) \|\| null/.test(core) && /engine_text: spec0\.decoder\.engine_text \|\| null/.test(core) && /version_trusted: spec0\.decoder\.strong && !!\(nhtsa/.test(core));
  ok('7f. Confidence отримує довірений вид декодера', /hf, nhtsa: trustedDecoderView\(nhtsa\), auctionSearch,/.test(core));
  ok('7g. після аналізу: reconcile, шапка без конфліктних полів, нотатки у data_notes, фільтр discrepancies, risks і checklist, паспорт у _meta', /vehicleSpec = reconcileVehicleSpec\(spec0, parsed\.vehicle, \{ nhtsa, listing \}\)/.test(core) && /vehicleSpec\.header_sync = syncHeaderWithSpec\(parsed\.vehicle, vehicleSpec/.test(core) && /conflictNotes\(vehicleSpec, lang\)/.test(core) && /for \(const k of \['discrepancies', 'risks', 'checklist'\]\)/.test(core) && /vehicle_spec: publicSpec\(/.test(core) && core.indexOf('vehicleSpec = reconcileVehicleSpec') < core.indexOf('computeScoreV4({'));
  ok('7h. Final Conclusion читає паспорт: наддув, конфлікти, неповний декодер, і правило про них', /forced_induction: vsv\('forced_induction'\)/.test(CONC) && /identity_conflicts: vs && Array\.isArray\(vs\.conflicts\)/.test(CONC) && /vin_decoder_incomplete/.test(CONC) && /vehicle\.forced_induction is canonical/.test(CONC) && /never present the conflict as a seller discrepancy/.test(CONC));
  ok('7i. довгого тире немає; модуль без фактів про моделі', !SRC.includes(String.fromCharCode(0x2014)) && !/x166|f15|cayenne|prado(?!\s*\*\/)/i.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('vehiclespectest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('vehiclespectest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('vehiclespectest CRASHED:', e.stack || e.message); process.exit(1); });
