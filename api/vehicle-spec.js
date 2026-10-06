/* Канонічний паспорт авто для Check (vehicle spec).

   Один нормалізований набір полів ідентичності, який читають усі секції
   звіту замість власних ланцюжків listing || nhtsa. Декодер VIN це доказ,
   а не істина: його технічні поля сильні лише при чистому розборі vPIC
   (ErrorCode 0, те саме правило, що вже діє для модельного року). Слабкий
   декодер ніколи не перебиває площадку, аналіз чи фото і не створює
   розбіжності з продавцем. Два сильні джерела, що суперечать одне одному,
   дають стан conflict: значення не вибирається, конфлікт видно у
   _meta.vehicle_spec і в data_notes, а розбіжність "з продавцем" з нього
   не виготовляється. Невідоме лишається невідомим.

   Поле: { value, source, strength, conflict, candidates }.
   Сила: strong (чистий декодер або збіг двох незалежних джерел), medium
   (площадка або основний аналіз), weak (лише неповний декодер). */

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const low = s => clean(s).toLowerCase();

export const SPEC_FIELDS = ['make', 'model', 'generation', 'version', 'model_year', 'production_year', 'market',
  'fuel', 'displacement_l', 'forced_induction', 'transmission', 'drivetrain', 'body', 'engine_code'];

/* ---------- довіра до декодера ---------- */

/* Розбір vPIC чистий лише з ErrorCode 0. Інші коди (1 контрольна цифра,
   5 помилки позицій, 6 неповний VIN, 7 виробник не зареєстрований,
   8 детальних даних нема, 11 рік, 14 невикористана позиція, 400 символи)
   означають, що поля вгадані за шаблоном: для VIN не з ринку США це
   типово і дає "2.0 бензин" замість 3.0 дизеля */
export function decoderStrong(n) {
  if (!n || typeof n !== 'object') return false;
  const codes = String(n.ErrorCode == null ? '' : n.ErrorCode).split(/[\s,;]+/).filter(Boolean);
  return codes.length > 0 && codes.every(c => c === '0');
}

/* Що з декодера йде в аналіз і в Confidence: при чистому розборі все,
   інакше лише марка і модель як підказка (марка з WMI надійна і для
   незареєстрованих виробників, технічні поля ні) */
export function trustedDecoderView(n) {
  if (!n || typeof n !== 'object') return n || null;
  if (decoderStrong(n)) return n;
  const out = {};
  if (n.Make) out.Make = n.Make;
  if (n.Model) out.Model = n.Model;
  if (n.ErrorCode != null) out.ErrorCode = n.ErrorCode;
  if (n.ErrorText) out.ErrorText = n.ErrorText;
  return out;
}

/* ---------- нормалізація ---------- */

export function normDrive(raw) {
  const t = low(raw).replace(/[\s_-]+/g, '');
  if (!t) return null;
  if (/awd|4wd|4x4|allwheel|fourwheel|повний|полный|full|quattro|xdrive|4matic|4motion|alltrac|allgrip|symmetrical|sh\s*awd/.test(t)) return 'awd';
  if (/fwd|frontwheel|передній|передний|перед|front/.test(t)) return 'fwd';
  if (/rwd|rearwheel|задній|задний|зад|rear/.test(t)) return 'rwd';
  return null;
}

/* Сімейство автоматів (automatic, cvt, dct) не суперечить одне одному:
   площадки часто пишуть "автомат" про варіатор. Конфлікт лише manual
   проти автоматичного сімейства */
export function normTransmission(raw) {
  const t = low(raw);
  if (!t) return null;
  if (/варіатор|вариатор|\bcvt\b|continuously variable|e-cvt|multitronic|xtronic|lineartronic/.test(t)) return 'cvt';
  if (/\bdsg\b|\bdct\b|\bpdk\b|s[- ]?tronic|powershift|dual[- ]?clutch|робот|робат|automated manual|\bamt\b|speedshift|edc/.test(t)) return 'dct';
  if (/автомат|automatic|tiptronic|steptronic|\bat\b|\bакпп\b|\bакп\b|геартроник|geartronic|9g|7g|8hp|zf/.test(t)) return 'automatic';
  if (/механ|manual|standard|\bmt\b|\bмкпп\b|\bмт\b|ручн/.test(t)) return 'manual';
  if (/редуктор|single[- ]?speed|reducer|direct drive/.test(t)) return 'reducer';
  return null;
}
const AUTO_FAMILY = new Set(['automatic', 'cvt', 'dct', 'reducer']);

export function normFuel(raw, electrification = null) {
  const t = low(raw);
  const el = low(electrification);
  if (/bev|battery electric/.test(el)) return 'electric';
  if (/phev|plug/.test(el) || /phev|plug-?in|плагін|плагин/.test(t)) return 'phev';
  if (/\bhev\b|hybrid/.test(el) || /гібрид|гибрид|hybrid|mhev|гибридн/.test(t)) return 'hybrid';
  if (!t) return null;
  if (/electric|електро|электро|\bev\b/.test(t)) return 'electric';
  if (/diesel|дизел|\btdi\b|\bcdi\b|\bhdi\b|\bcrdi\b|bluetec|\bd-?4d\b|\bdci\b|\bjtd\b|\btdci\b|bluehdi/.test(t)) return 'diesel';
  if (/gasoline|petrol|бензин|flexible fuel|ffv|\btfsi\b|\btsi\b|\bfsi\b|\bgdi\b|\bmpi\b|газ\/бензин|lpg/.test(t)) return 'petrol';
  return null;
}
/* гібрид має ДВЗ: не суперечить бензину чи дизелю; конфлікт лише
   бензин проти дизеля і електро проти ДВЗ */
function fuelConflict(a, b) {
  if (!a || !b || a === b) return false;
  const ice = v => v === 'petrol' || v === 'diesel';
  if ((a === 'hybrid' || a === 'phev') && (ice(b) || b === 'hybrid' || b === 'phev')) return false;
  if ((b === 'hybrid' || b === 'phev') && (ice(a) || a === 'hybrid' || a === 'phev')) return false;
  return true;
}

export function normDisplacement(raw) {
  const t = low(raw);
  if (!t) return null;
  /* "3.0", "3,0 л", "2.0L", "4.4-liter", "2998 см3" */
  let m = /(\d{1,2})[.,](\d)\s*(?:л\b|l\b|liter|litre|-?л|$|\s|[,;])/.exec(t) || /\b(\d)[.,](\d)\b(?!\s*(?:к\.?с|hp|kw|квт|%))/.exec(t);
  if (m) { const v = parseFloat(m[1] + '.' + m[2]); return v >= 0.6 && v <= 8.5 ? v : null; }
  m = /(\d{3,4})\s*(?:см3|см³|cc|cm3)/.exec(t);
  if (m) { const v = Math.round(parseInt(m[1], 10) / 100) / 10; return v >= 0.6 && v <= 8.5 ? v : null; }
  return null;
}

export function normForcedInduction(raw) {
  const t = low(raw);
  if (!t) return null;
  const sc = /компресор|компрессор|supercharg|kompressor|\bsc\b|\bscv[68]\b|механічн\w* наддув|механическ\w* наддув/.test(t);
  const tb = /турбо|turbo|\btfsi\b|\btsi\b|\btdi\b|biturbo|bi-turbo|twin-?turbo|twin turbo|\btt\b|ecoboost|\bcdi\b|\bcrdi\b|\bhdi\b|\bdci\b|\btdci\b/.test(t);
  if (sc && tb) return null;
  if (sc) return 'supercharger';
  if (tb) return 'turbo';
  if (/атмосфер|naturally aspirated|\bn\/a\b|\bna\b|безнаддув/.test(t)) return 'na';
  return null;
}

export function normYear(raw) {
  const v = parseInt(String(raw == null ? '' : raw).replace(/[^\d]/g, '').slice(0, 4), 10);
  return v >= 1980 && v <= 2100 ? v : null;
}

const LABEL = {
  fuel: { ua: 'паливо', ru: 'топливо', en: 'fuel' },
  displacement_l: { ua: 'обʼєм двигуна', ru: 'объём двигателя', en: 'engine displacement' },
  forced_induction: { ua: 'тип наддуву', ru: 'тип наддува', en: 'forced induction' },
  transmission: { ua: 'тип коробки передач', ru: 'тип коробки передач', en: 'transmission type' },
  drivetrain: { ua: 'тип приводу', ru: 'тип привода', en: 'drivetrain' },
  version: { ua: 'версія', ru: 'версия', en: 'version' },
  body: { ua: 'тип кузова', ru: 'тип кузова', en: 'body type' },
  model_year: { ua: 'модельний рік', ru: 'модельный год', en: 'model year' },
};
const SOURCE_LABEL = {
  decoder: { ua: 'декодер VIN', ru: 'декодер VIN', en: 'VIN decoder' },
  listing: { ua: 'дані оголошення', ru: 'данные объявления', en: 'listing data' },
  analysis: { ua: 'розбір сторінки і фото', ru: 'разбор страницы и фото', en: 'page and photo analysis' },
};

/* ---------- збирання поля ---------- */

/* Правила вибору:
   - weak-кандидат (неповний декодер) програє будь-якому іншому джерелу і
     конфлікту не створює;
   - кандидати однієї сили, що суперечать (сильний декодер проти аналізу
     чи площадки): conflict, value null;
   - збіг двох джерел підсилює до strong;
   - одне джерело: його значення і сила */
function resolveField(cands, isConflict = (a, b) => a !== b) {
  const list = cands.filter(c => c && c.value !== null && c.value !== undefined && c.value !== '');
  if (!list.length) return { value: null, source: null, strength: null, conflict: false, candidates: cands.filter(c => c && c.raw) };
  const strongOrMedium = list.filter(c => c.strength !== 'weak');
  /* лише слабкий декодер: значення НЕ встановлене (невідоме, не погане),
     кандидат лишається у провенансі */
  if (!strongOrMedium.length) {
    return { value: null, source: null, strength: 'weak', conflict: false,
      candidates: list.map(c => ({ source: c.source, value: c.value, raw: c.raw || null, strength: c.strength })) };
  }
  const pool = strongOrMedium;
  const distinct = [];
  for (const c of pool) if (!distinct.some(d => !isConflict(d.value, c.value))) distinct.push(c);
  if (distinct.length > 1) {
    return { value: null, source: null, strength: null, conflict: true,
      candidates: pool.map(c => ({ source: c.source, value: c.value, raw: c.raw || null, strength: c.strength })) };
  }
  /* збіг кількох джерел: беремо найсильніше формулювання, сила зростає */
  const rank = { strong: 3, medium: 2, weak: 1 };
  const best = pool.slice().sort((a, b) => rank[b.strength] - rank[a.strength])[0];
  const sources = [...new Set(pool.map(c => c.source))];
  const strength = pool.length > 1 && sources.length > 1 ? 'strong' : best.strength;
  return { value: best.value, raw: best.raw || null, source: sources.join('+'), strength, conflict: false,
    candidates: cands.filter(c => c && (c.raw || c.value !== null)).map(c => ({ source: c.source, value: c.value, raw: c.raw || null, strength: c.strength })) };
}

function decoderCandidates(nhtsa) {
  if (!nhtsa || typeof nhtsa !== 'object') return {};
  const s = decoderStrong(nhtsa) ? 'strong' : 'weak';
  const c = (value, raw) => ({ source: 'decoder', value, raw: raw ? clean(raw) : null, strength: s });
  const engineRaw = [nhtsa.DisplacementL ? nhtsa.DisplacementL + ' L' : null, nhtsa.FuelTypePrimary || null, nhtsa.ElectrificationLevel || null, nhtsa.EngineHP ? nhtsa.EngineHP + ' hp' : null].filter(Boolean).join(' ');
  return {
    make: c(nhtsa.Make ? clean(nhtsa.Make) : null, nhtsa.Make),
    model: c(nhtsa.Model ? clean(nhtsa.Model) : null, nhtsa.Model),
    version: c(nhtsa.Trim || nhtsa.Series ? clean(nhtsa.Trim || nhtsa.Series) : null, nhtsa.Trim || nhtsa.Series),
    /* рік вже пройшов gateDecoderYear: при слабкому розборі його тут немає */
    model_year: c(normYear(nhtsa.ModelYear), nhtsa.ModelYear),
    fuel: c(normFuel(nhtsa.FuelTypePrimary, nhtsa.ElectrificationLevel), nhtsa.FuelTypePrimary),
    displacement_l: c(nhtsa.DisplacementL ? (parseFloat(nhtsa.DisplacementL) || null) : null, nhtsa.DisplacementL),
    forced_induction: c(normForcedInduction([nhtsa.Turbo === 'Yes' ? 'turbo' : '', nhtsa.OtherEngineInfo || '', nhtsa.EngineModel || ''].join(' ')), nhtsa.OtherEngineInfo || nhtsa.EngineModel),
    transmission: c(normTransmission(nhtsa.TransmissionStyle), nhtsa.TransmissionStyle),
    drivetrain: c(normDrive(nhtsa.DriveType), nhtsa.DriveType),
    body: c(nhtsa.BodyClass ? clean(nhtsa.BodyClass) : null, nhtsa.BodyClass),
    engine_text: engineRaw || null,
    hp: nhtsa.EngineHP ? parseInt(nhtsa.EngineHP, 10) || null : null,
  };
}

function listingCandidates(listing) {
  const l = listing || {};
  const c = (value, raw) => ({ source: 'listing', value, raw: raw ? clean(raw) : null, strength: 'medium' });
  /* структурована модифікація площадки ("X 63 AT (557 к.с.)", "2.0 MT",
     "3.0 TDI quattro") несе коробку, наддув, паливо і обʼєм */
  const mod = l.modification || '';
  const title = l.title || '';
  return {
    make: c(l.make ? clean(l.make) : null, l.make),
    model: c(l.model ? clean(l.model) : null, l.model),
    version: c(mod ? clean(mod) : null, mod),
    production_year: c(normYear(l.year), l.year),
    fuel: c(normFuel(mod) || normFuel(title), mod || title),
    displacement_l: c(normDisplacement(mod) || normDisplacement(title), mod || title),
    forced_induction: c(normForcedInduction(mod) || normForcedInduction(title), mod || title),
    transmission: c(normTransmission(mod), mod),
    drivetrain: c(normDrive(mod), mod),
  };
}

function analysisCandidates(v) {
  if (!v || typeof v !== 'object') return {};
  const c = (value, raw) => ({ source: 'analysis', value, raw: raw ? clean(raw) : null, strength: 'medium' });
  const engine = v.engine || '';
  return {
    version: c(v.trim ? clean(v.trim) : null, v.trim),
    model_year: c(normYear(v.model_year), v.model_year),
    production_year: c(normYear(v.year), v.year),
    fuel: c(normFuel(v.fuel) || normFuel(engine), v.fuel || engine),
    displacement_l: c(normDisplacement(engine), engine),
    forced_induction: c(normForcedInduction(engine), engine),
    transmission: c(normTransmission(v.transmission), v.transmission),
    drivetrain: c(normDrive(v.drive), v.drive),
    generation: c(v.generation ? clean(v.generation) : null, v.generation),
  };
}

const CONFLICT_RULES = {
  fuel: fuelConflict,
  displacement_l: (a, b) => Math.abs(a - b) > 0.15,
  transmission: (a, b) => a !== b && !(AUTO_FAMILY.has(a) && AUTO_FAMILY.has(b)),
  drivetrain: (a, b) => a !== b,
  forced_induction: (a, b) => a !== b,
  /* версія і модель: різні написання одного не є конфліктом, порівнюється ключ */
  version: (a, b) => key(a) !== key(b) && !key(a).includes(key(b)) && !key(b).includes(key(a)),
  make: (a, b) => key(a) !== key(b) && !key(a).startsWith(key(b)) && !key(b).startsWith(key(a)),
  model: (a, b) => key(a) !== key(b) && !key(a).includes(key(b)) && !key(b).includes(key(a)),
  body: (a, b) => key(a) !== key(b),
  model_year: (a, b) => a !== b,
  production_year: (a, b) => a !== b,
  generation: (a, b) => key(a) !== key(b),
};
const key = s => low(s).replace(/[^a-z0-9а-яіїєґ]+/g, '');

function assemble(dec, lst, ana, prev = null) {
  const spec = {};
  for (const f of ['make', 'model', 'version', 'model_year', 'production_year', 'fuel', 'displacement_l', 'forced_induction', 'transmission', 'drivetrain', 'body', 'generation']) {
    spec[f] = resolveField([dec[f], lst[f], ana[f]], CONFLICT_RULES[f] || ((a, b) => a !== b));
  }
  return spec;
}

/* ---------- публічні збирачі ---------- */

/* До основного виклику: декодер і площадка. */
export function buildVehicleSpec({ nhtsa = null, listing = null } = {}) {
  const dec = decoderCandidates(nhtsa);
  const lst = listingCandidates(listing);
  const spec = assemble(dec, lst, {});
  const strong = decoderStrong(nhtsa);
  spec.market = { value: (listing && listing.country) || null, source: listing && listing.country ? 'listing' : null, strength: listing && listing.country ? 'medium' : null, conflict: false };
  spec.engine_code = { value: null, source: null, strength: null, conflict: false };
  spec.decoder = {
    present: !!nhtsa, strong, error_code: nhtsa && nhtsa.ErrorCode != null ? String(nhtsa.ErrorCode) : null,
    /* технічні поля слабкого декодера: лишаються у провенансі, в паспорт не йдуть */
    unreliable_fields: !nhtsa || strong ? [] : ['version', 'fuel', 'displacement_l', 'forced_induction', 'transmission', 'drivetrain', 'body', 'model_year'].filter(f => dec[f] && dec[f].value !== null),
    engine_text: strong ? dec.engine_text || null : null,
    hp: strong ? dec.hp : null,
  };
  spec.stage = 'pre_analysis';
  return spec;
}

/* Після основного виклику: додається аналіз (сторінка, реєстр, фото). */
export function reconcileVehicleSpec(spec0, parsedVehicle, { nhtsa = null, listing = null, generation = null, generationSource = null, engineCode = null } = {}) {
  const dec = decoderCandidates(nhtsa);
  const lst = listingCandidates(listing);
  const ana = analysisCandidates(parsedVehicle);
  const spec = { ...spec0, ...assemble(dec, lst, ana) };
  /* покоління вирішує resolveGeneration (площадка, MI, аналіз): тут лише запис */
  spec.generation = generation
    ? { value: generation, source: generationSource || null, strength: generationSource === 'listing' || generationSource === 'model_intelligence' ? 'strong' : 'medium', conflict: false }
    : { value: null, source: null, strength: null, conflict: false };
  spec.engine_code = { value: engineCode || null, source: engineCode ? 'decoder' : null, strength: engineCode ? 'strong' : null, conflict: false };
  spec.conflicts = ['make', 'model', 'version', 'model_year', 'fuel', 'displacement_l', 'forced_induction', 'transmission', 'drivetrain', 'body'].filter(f => spec[f] && spec[f].conflict);
  spec.stage = 'reconciled';
  return spec;
}

/* Клас силової установки для Score і норми пробігу з канонічного палива.
   Невідоме лишається unknown */
export function powertrainClassFromSpec(spec) {
  const f = spec && spec.fuel ? spec.fuel.value : null;
  if (f === 'electric') return 'bev';
  if (f === 'phev') return 'phev';
  if (f === 'hybrid') return 'hev';
  if (f === 'petrol' || f === 'diesel') return f;
  return 'unknown';
}

/* Блок для основного виклику: лише те, чому можна вірити, із силою кожного
   поля; слабкий декодер названо прямо, щоб модель не робила з нього
   розбіжність */
export function vehicleSpecPromptBlock(spec) {
  if (!spec) return '';
  const fields = {};
  for (const f of ['make', 'model', 'version', 'model_year', 'production_year', 'fuel', 'displacement_l', 'forced_induction', 'transmission', 'drivetrain', 'body']) {
    const x = spec[f];
    if (x && x.value !== null && x.value !== undefined) fields[f] = { value: x.value, source: x.source, strength: x.strength };
  }
  if (spec.decoder && spec.decoder.engine_text) fields.decoder_engine = spec.decoder.engine_text;
  const lines = ['VEHICLE_SPEC (канонічний паспорт CalCar, зібраний кодом; поля з їхнім джерелом і силою): ' + JSON.stringify(fields)];
  if (spec.decoder && spec.decoder.present && !spec.decoder.strong) {
    lines.push('УВАГА: VIN-декодер розібрав цей VIN НЕПОВНО (ErrorCode ' + (spec.decoder.error_code || '?') + '), тому його технічні поля (' + (spec.decoder.unreliable_fields.join(', ') || 'паливо, обʼєм, привід, коробка, версія') + ') НЕНАДІЙНІ і в паспорт не увійшли. Технічні характеристики бери зі сторінки оголошення, держблоку і фото. Розбіжність "декодер проти оголошення" НЕ створюй: це слабкість декодера, а не проблема авто і не обман продавця.');
  }
  lines.push('ПРАВИЛО ІДЕНТИЧНОСТІ: якщо два джерела ОДНАКОВОЇ сили розходяться у технічній характеристиці, це КОНФЛІКТ ІДЕНТИЧНОСТІ, а не розбіжність із продавцем: назви обидва значення у data_notes, у шапку постав null, у discrepancies і risks його не клади. Невідоме не є поганим.');
  return lines.join('\n');
}

/* Що бачить користувач у data_notes про конфлікт: нейтрально, без звинувачень */
export function conflictNotes(spec, lang = 'en') {
  const L = ['ua', 'ru', 'en'].includes(lang) ? lang : 'en';
  const out = [];
  for (const f of (spec && spec.conflicts) || []) {
    const x = spec[f];
    if (!x || !Array.isArray(x.candidates)) continue;
    const parts = x.candidates.filter(c => c.value !== null).map(c => (SOURCE_LABEL[c.source] ? SOURCE_LABEL[c.source][L] : c.source) + ': ' + (c.raw || c.value));
    const label = LABEL[f] ? LABEL[f][L] : f;
    out.push(L === 'ua' ? `Джерела розходяться щодо: ${label} (${parts.join('; ')}). До огляду авто характеристику не вважаємо встановленою; це не свідчить проти продавця.`
      : L === 'ru' ? `Источники расходятся: ${label} (${parts.join('; ')}). До осмотра характеристику не считаем установленной; это не свидетельствует против продавца.`
      : `Sources disagree on ${label} (${parts.join('; ')}). Until the car is inspected this is not treated as established; it is not evidence against the seller.`);
  }
  return out;
}

/* Розбіжність, ризик чи пункт чеклиста, що тримається на слабкому декодері
   або на полі в стані conflict: прибирається (identity conflict не є
   розбіжністю з продавцем). Поле визнається за словником; слабкий декодер
   лише разом із згадкою VIN чи декодера */
const FIELD_WORDS = {
  fuel: /палив|топлив|fuel|бензин|дизел|petrol|diesel|gasoline/i,
  displacement_l: /об.?[єе]м|объ[её]м|displacement|літр|литр|\bл\b|liter|litre/i,
  forced_induction: /турб|turbo|компрес|supercharg|наддув/i,
  transmission: /коробк|трансміс|трансмис|transmission|gearbox|варіатор|вариатор|автомат|механік|механик|\bcvt\b|\bmt\b|\bat\b/i,
  drivetrain: /привід|привод|drivetrain|\bawd\b|\brwd\b|\bfwd\b|4x4|4wd|повний|полный|задній|задний|передній|передний/i,
  version: /версі|версия|комплектац|trim|модифікац|модификац/i,
  body: /кузов|body/i,
  model_year: /модельн|model year|рік випуску|год выпуска/i,
};
const DECODER_WORDS = /vin|декод|nhtsa|vpic/i;
export function identityConflictItem(item, spec) {
  if (!item || typeof item !== 'object' || !spec) return null;
  const text = [item.title, item.detail, item.note, item.text, item.action, Array.isArray(item.sources) ? item.sources.join(' ') : ''].filter(Boolean).join(' ');
  if (!text) return null;
  const weak = spec.decoder && spec.decoder.present && !spec.decoder.strong;
  for (const [f, rx] of Object.entries(FIELD_WORDS)) {
    if (!rx.test(text)) continue;
    if (spec[f] && spec[f].conflict) return { field: f, reason: 'identity_conflict' };
    if (weak && DECODER_WORDS.test(text) && (spec.decoder.unreliable_fields || []).includes(f)) return { field: f, reason: 'weak_decoder' };
  }
  return null;
}

/* Компактний паспорт для _meta: значення, джерело, сила, конфлікт */
export function publicSpec(spec) {
  if (!spec) return null;
  const out = { version: 'vs-v1', stage: spec.stage || null, decoder: spec.decoder ? { present: spec.decoder.present, strong: spec.decoder.strong, error_code: spec.decoder.error_code, unreliable_fields: spec.decoder.unreliable_fields } : null, conflicts: spec.conflicts || [], fields: {} };
  for (const f of SPEC_FIELDS) {
    const x = spec[f];
    if (!x) continue;
    out.fields[f] = { value: x.value === undefined ? null : x.value, source: x.source || null, strength: x.strength || null, conflict: !!x.conflict };
    if (x.conflict && Array.isArray(x.candidates)) out.fields[f].candidates = x.candidates.filter(c => c.value !== null).map(c => ({ source: c.source, value: c.value, raw: c.raw || null }));
  }
  return out;
}
