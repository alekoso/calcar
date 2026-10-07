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
  'fuel', 'electrification', 'displacement_l', 'forced_induction', 'power_hp', 'transmission', 'transmission_type', 'drivetrain', 'body', 'engine_code'];

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

/* fuel is the PRIMARY fuel. A mild hybrid keeps its diesel or petrol: the
   electric assistance lives in the separate electrification field. A full
   hybrid without a named fuel stays 'hybrid' (the existing product value) */
const DIESEL_RE = /diesel|дизел|\btdi\b|\bcdi\b|\bhdi\b|\bcrdi\b|bluetec|\bd-?4d\b|\bdci\b|\bjtd\b|\btdci\b|bluehdi|\btd[46]\b|\bd\d{3}\b/;
const PETROL_RE = /gasoline|petrol|бензин|flexible fuel|ffv|\btfsi\b|\btsi\b|\bfsi\b|\bgdi\b|\bmpi\b|газ\/бензин|lpg/;
export function normElectrification(raw, electrification = null) {
  const t = low(raw);
  const el = low(electrification);
  if (/bev|battery electric/.test(el)) return 'bev';
  if (/phev|plug/.test(el) || /phev|plug-?in|плагін|плагин/.test(t)) return 'phev';
  if (/mild/.test(el) || /mhev|mild[- ]?hybrid|м[’'ʼ]як\w* гібрид|мягк\w* гибрид|48\s?v|48-вольт/.test(t)) return 'mild_hybrid';
  if (/\bhev\b|hybrid/.test(el) || /гібрид|гибрид|hybrid/.test(t)) return 'hybrid';
  if (!t) return null;
  if (/electric|електро|электро|\bev\b/.test(t) && !DIESEL_RE.test(t) && !PETROL_RE.test(t)) return 'bev';
  return null;
}
export function normFuel(raw, electrification = null) {
  const t = low(raw);
  const e = normElectrification(raw, electrification);
  if (e === 'bev') return 'electric';
  if (DIESEL_RE.test(t)) return 'diesel';
  if (PETROL_RE.test(t)) return 'petrol';
  if (e === 'phev') return 'phev';
  if (e === 'hybrid') return 'hybrid';
  if (e === 'mild_hybrid') return null;
  if (!t) return null;
  if (/electric|електро|электро|\bev\b/.test(t)) return 'electric';
  return null;
}
/* generic "hybrid" does not contradict a mild hybrid; everything else must agree */
function electrificationConflict(a, b) {
  if (!a || !b || a === b) return false;
  if ((a === 'hybrid' && b === 'mild_hybrid') || (a === 'mild_hybrid' && b === 'hybrid')) return false;
  return true;
}

/* ---------- power ----------
   Units are normalised before any comparison: kW -> metric hp (x1.36), SAE hp
   -> metric hp (x1.014). Two figures are the same power when they differ by
   at most 6 hp or 4 percent, whichever is larger: 200 kW, 268 hp and 272 PS
   are one engine, not a conflict */
export function normPower(raw) {
  const t = low(raw);
  if (!t) return null;
  let m = /(\d{2,4})\s*(?:квт|kw)(?![a-zа-я])/.exec(t);
  if (m) { const v = Math.round(parseInt(m[1], 10) * 1.36); return v >= 20 && v <= 2500 ? v : null; }
  m = /(\d{2,4})\s*(?:к\.?\s?с\.?|л\.?\s?с\.?|кс\b|лс\b|\bps\b|\bhp\b|\bbhp\b|horsepower)/.exec(t);
  if (m) { const v = parseInt(m[1], 10); return v >= 20 && v <= 2500 ? v : null; }
  return null;
}
export function powerEquivalent(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return true;
  return Math.abs(a - b) <= Math.max(6, 0.04 * Math.max(a, b));
}
/* every distinct power figure in a text, already normalised */
export function powerValues(text) {
  const t = low(text);
  const out = [];
  const re = /(\d{2,4})\s*(квт|kw|к\.?\s?с\.?|л\.?\s?с\.?|кс\b|лс\b|\bps\b|\bhp\b|\bbhp\b|horsepower)/g;
  let m;
  while ((m = re.exec(t))) {
    const v = normPower(m[0]);
    if (v !== null && !out.some(x => powerEquivalent(x, v))) out.push(v);
  }
  return out;
}

/* ---------- version kind ----------
   Marketplaces put very different things into the "modification" slot: a
   trim level ("GTS", "Premium"), a powertrain spec ("2.0 Td4 MHEV AT (163 к.с.)
   AWD") or a generation code ("958 (FL)", "B8/8K (FL)"). Only a trim level
   can confirm or contradict the version; the other two are not versions and
   never create a version conflict */
export function versionKind(raw) {
  const t = clean(raw);
  if (!t) return null;
  if (/\d[.,]\d\s*(?:л|l|tdi|tsi|tfsi|cdi|td|d|i|t)?\b|\d{2,4}\s*(?:к\.?\s?с|л\.?\s?с|hp|ps|kw|квт)|\b(?:at|mt|cvt|dsg|awd|4x4|4wd|fwd|rwd|mhev|phev|tdi|tsi|tfsi|cdi|hdi|dci|crdi|td[46])\b/i.test(t)) return 'powertrain';
  if (/^(?:[a-z]{0,2}\d{2,3}(?:[./]\d{1,2}[a-z]?)?|[a-z]\d{1,2}(?:\/[a-z]?\d{1,2}[a-z]?)?)\s*(?:\((?:fl|рест\w*|facelift)\)|fl|рестайл\w*|facelift)?$/i.test(t)) return 'generation';
  return 'trim';
}
const trimOnly = raw => (versionKind(raw) === 'trim' ? clean(raw) : null);
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
  power_hp: { ua: 'потужність двигуна', ru: 'мощность двигателя', en: 'engine power' },
  electrification: { ua: 'тип гібридної системи', ru: 'тип гибридной системы', en: 'electrification' },
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
    version: c(trimOnly(nhtsa.Trim || nhtsa.Series), nhtsa.Trim || nhtsa.Series),
    /* рік вже пройшов gateDecoderYear: при слабкому розборі його тут немає */
    model_year: c(normYear(nhtsa.ModelYear), nhtsa.ModelYear),
    fuel: c(normFuel(nhtsa.FuelTypePrimary, nhtsa.ElectrificationLevel), nhtsa.FuelTypePrimary),
    electrification: c(normElectrification(nhtsa.FuelTypePrimary, nhtsa.ElectrificationLevel), nhtsa.ElectrificationLevel),
    /* vPIC EngineHP is SAE horsepower */
    power_hp: c(nhtsa.EngineHP ? (Math.round(parseFloat(nhtsa.EngineHP) * 1.014) || null) : null, nhtsa.EngineHP ? nhtsa.EngineHP + ' hp' : null),
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
    version: c(trimOnly(mod), mod),
    production_year: c(normYear(l.year), l.year),
    fuel: c(normFuel(mod) || normFuel(title), mod || title),
    electrification: c(normElectrification(mod) || normElectrification(title), mod || title),
    power_hp: c(normPower(mod), mod),
    /* every power figure the listing page states (modification plus the
       marketplace technical block): two different figures are a conflict
       inside one source, and the conflict must stay visible */
    power_values: (l.power_hp ? [Number(l.power_hp)] : []).concat(powerValues(l.text || '')).filter(v => Number.isFinite(v) && v > 0),
    displacement_l: c(normDisplacement(mod) || normDisplacement(title), mod || title),
    forced_induction: c(normForcedInduction(mod) || normForcedInduction(title), mod || title),
    /* the marketplace technical block names the gearbox under a label
       ("Коробка передач: Варіатор"); the seller's free text does not count */
    transmission: normTransmission(mod) ? c(normTransmission(mod), mod) : c(normTransmission(labelledValue(l.text, GEARBOX_LABEL)), labelledValue(l.text, GEARBOX_LABEL)),
    drivetrain: c(normDrive(mod), mod),
  };
}

const GEARBOX_LABEL = /(?:коробка(?:\s+передач)?|трансмісія|трансмиссия|transmission|gearbox)\s*[:：]\s*([^\n.,;|]{2,40})/i;
/* value written after a label in the structured technical block; null when
   the label is missing or is followed by nothing usable */
function labelledValue(text, rx) {
  const m = rx.exec(String(text || ''));
  return m ? clean(m[1]) : null;
}

function analysisCandidates(v) {
  if (!v || typeof v !== 'object') return {};
  const c = (value, raw) => ({ source: 'analysis', value, raw: raw ? clean(raw) : null, strength: 'medium' });
  const engine = v.engine || '';
  return {
    version: c(trimOnly(v.trim), v.trim),
    model_year: c(normYear(v.model_year), v.model_year),
    production_year: c(normYear(v.year), v.year),
    fuel: c(normFuel(engine) || normFuel(v.fuel), engine || v.fuel),
    electrification: c(normElectrification(engine) || normElectrification(v.fuel), engine || v.fuel),
    power_hp: c(normPower(engine), engine),
    displacement_l: c(normDisplacement(engine), engine),
    forced_induction: c(normForcedInduction(engine), engine),
    transmission: c(normTransmission(v.transmission), v.transmission),
    drivetrain: c(normDrive(v.drive), v.drive),
    generation: c(v.generation ? clean(v.generation) : null, v.generation),
  };
}

const CONFLICT_RULES = {
  fuel: fuelConflict,
  electrification: electrificationConflict,
  power_hp: (a, b) => !powerEquivalent(a, b),
  displacement_l: (a, b) => Math.abs(a - b) > 0.15,
  transmission: (a, b) => a !== b && !(AUTO_FAMILY.has(a) && AUTO_FAMILY.has(b)),
  drivetrain: (a, b) => a !== b,
  forced_induction: (a, b) => a !== b,
  /* версія і модель: різні написання одного не є конфліктом, порівнюється ключ */
  /* "GL63 AMG" and "GL63" are one version; a two-letter trim ("S", "GT") is compared exactly, it is not a substring of "GTS" */
  version: (a, b) => key(a) !== key(b) && !(Math.min(key(a).length, key(b).length) >= 3 && (key(a).includes(key(b)) || key(b).includes(key(a)))),
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
  for (const f of ['make', 'model', 'version', 'model_year', 'production_year', 'fuel', 'electrification', 'displacement_l', 'forced_induction', 'transmission', 'drivetrain', 'body', 'generation']) {
    spec[f] = resolveField([dec[f], lst[f], ana[f]], CONFLICT_RULES[f] || ((a, b) => a !== b));
  }
  /* power: the listing may state several figures; each is its own candidate */
  const powerCands = [dec.power_hp, lst.power_hp];
  for (const v of (lst.power_values || [])) if (!powerCands.some(c => c && c.value !== null && powerEquivalent(c.value, v))) powerCands.push({ source: 'listing', value: v, raw: v + ' hp', strength: 'medium' });
  powerCands.push(ana.power_hp);
  spec.power_hp = resolveField(powerCands, CONFLICT_RULES.power_hp);
  /* exact gearbox type inside the automatic family: resolved only when every
     trusted source names the same type; otherwise the family is known and
     the exact type is not, which is a limit of the data and not a conflict */
  const tcands = [dec.transmission, lst.transmission, ana.transmission].filter(c => c && c.value !== null && c.strength !== 'weak');
  const byType = new Map();
  for (const c of tcands) { const cur = byType.get(c.value); if (cur) { if (!cur.sources.includes(c.source)) cur.sources.push(c.source); } else byType.set(c.value, { value: c.value, sources: [c.source], raw: c.raw || null }); }
  const typeCands = [...byType.values()].map(c => ({ value: c.value, source: c.sources.join('+'), raw: c.raw }));
  spec.transmission_type = spec.transmission.conflict || !tcands.length
    ? { value: null, exact: false, candidates: typeCands }
    : (typeCands.length === 1
      ? { value: typeCands[0].value, exact: true, source: typeCands[0].source, strength: spec.transmission.strength, candidates: [] }
      : { value: null, exact: false, family: spec.transmission.value, candidates: typeCands });
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
  spec.conflicts = ['make', 'model', 'version', 'model_year', 'fuel', 'electrification', 'displacement_l', 'forced_induction', 'power_hp', 'transmission', 'drivetrain', 'body'].filter(f => spec[f] && spec[f].conflict);
  spec.stage = 'reconciled';
  return spec;
}

/* Клас силової установки для Score і норми пробігу з канонічного палива.
   Невідоме лишається unknown */
export function powertrainClassFromSpec(spec) {
  const f = spec && spec.fuel ? spec.fuel.value : null;
  const e = spec && spec.electrification ? spec.electrification.value : null;
  if (e === 'bev' || f === 'electric') return 'bev';
  if (e === 'phev') return 'phev';
  /* a mild hybrid is still a diesel or a petrol car for mileage norms and model risks */
  if (e === 'mild_hybrid' && (f === 'petrol' || f === 'diesel')) return f;
  if (e === 'hybrid') return 'hev';
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
  for (const f of ['make', 'model', 'version', 'model_year', 'production_year', 'fuel', 'electrification', 'displacement_l', 'forced_induction', 'power_hp', 'transmission', 'drivetrain', 'body']) {
    const x = spec[f];
    if (x && x.value !== null && x.value !== undefined) fields[f] = { value: x.value, source: x.source, strength: x.strength };
  }
  if (spec.transmission_type) fields.transmission_type = spec.transmission_type.exact ? { value: spec.transmission_type.value, exact: true } : { value: null, exact: false, candidates: spec.transmission_type.candidates.map(c => c.value + ' (' + c.source + ')') };
  if (spec.decoder && spec.decoder.engine_text) fields.decoder_engine = spec.decoder.engine_text;
  const unknown = ['version', 'fuel', 'transmission', 'drivetrain', 'power_hp'].filter(f => spec[f] && spec[f].value === null && !spec[f].conflict);
  const conflicts = (spec.conflicts || []).map(f => f + ': ' + ((spec[f] && spec[f].candidates) || []).filter(c => c.value !== null).map(c => (c.raw || c.value) + ' (' + c.source + ')').join(' | '));
  const lines = ['VEHICLE_SPEC (канонічний паспорт CalCar, зібраний кодом; поля з їхнім джерелом і силою): ' + JSON.stringify(fields)
    + (conflicts.length ? '\nКОНФЛІКТИ ІДЕНТИЧНОСТІ (значення НЕ встановлене, обидва кандидати названі): ' + conflicts.join('; ') : '')
    + (unknown.length ? '\nНЕВІДОМО (жодне джерело не дає значення): ' + unknown.join(', ') + '. Невідоме не виводь із загальних знань про модель: лиши null у шапці і не стверджуй у текстах.' : '')
    + (spec.transmission_type && !spec.transmission_type.exact && spec.transmission_type.family ? '\nКОРОБКА: сімейство встановлене (' + spec.transmission_type.family + '), точний тип ні (кандидати: ' + spec.transmission_type.candidates.map(c => c.value + ' від ' + c.source).join(', ') + '). Варіатор і ступінчастий автомат це одне сімейство: це НЕ "несумісні характеристики" і не розбіжність із продавцем, а невстановлений точний тип; у discrepancies його не клади, у checklist можна лишити перевірку коду агрегату.' : '')];
  if (spec.decoder && spec.decoder.present && !spec.decoder.strong) {
    lines.push('УВАГА: VIN-декодер розібрав цей VIN НЕПОВНО (ErrorCode ' + (spec.decoder.error_code || '?') + '), тому його технічні поля (' + (spec.decoder.unreliable_fields.join(', ') || 'паливо, обʼєм, привід, коробка, версія') + ') НЕНАДІЙНІ і в паспорт не увійшли. Технічні характеристики бери зі сторінки оголошення, держблоку і фото. Розбіжність "декодер проти оголошення" НЕ створюй: це слабкість декодера, а не проблема авто і не обман продавця.');
  }
  lines.push('ПРАВИЛО ІДЕНТИЧНОСТІ: якщо два джерела ОДНАКОВОЇ сили розходяться у технічній характеристиці (зокрема у потужності після приведення одиниць: кВт, к.с., hp це одна величина), це КОНФЛІКТ ІДЕНТИЧНОСТІ, а не розбіжність із продавцем: назви обидва значення у data_notes, у шапку постав null (для потужності: двигун без цифри потужності), у discrepancies і risks його не клади. Невідоме не є поганим. Технічні характеристики (паливо, обʼєм, наддув, потужність, коробка, привід, версія) ЗАВЖДИ бери з VEHICLE_SPEC: не обирай один із кандидатів конфлікту самостійно.');
  return lines.join('\n');
}

/* Що бачить користувач у data_notes про конфлікт: нейтрально, без звинувачень */
export function conflictNotes(spec, lang = 'en') {
  const L = ['ua', 'ru', 'en'].includes(lang) ? lang : 'en';
  const out = [];
  const fmt = c => (SOURCE_LABEL[c.source] ? SOURCE_LABEL[c.source][L] : c.source) + ': ' + (c.raw || c.value);
  for (const f of (spec && spec.conflicts) || []) {
    const x = spec[f];
    if (!x || !Array.isArray(x.candidates)) continue;
    const parts = x.candidates.filter(c => c.value !== null).map(fmt);
    const label = LABEL[f] ? LABEL[f][L] : f;
    out.push(L === 'ua' ? `Джерела розходяться щодо: ${label} (${parts.join('; ')}). До огляду авто характеристику не вважаємо встановленою; це не свідчить проти продавця.`
      : L === 'ru' ? `Источники расходятся: ${label} (${parts.join('; ')}). До осмотра характеристику не считаем установленной; это не свидетельствует против продавца.`
      : `Sources disagree on ${label} (${parts.join('; ')}). Until the car is inspected this is not treated as established; it is not evidence against the seller.`);
  }
  /* family known, exact type not: a limit of the data, worded as such */
  const tt = spec && spec.transmission_type;
  if (tt && !tt.exact && tt.family && Array.isArray(tt.candidates) && tt.candidates.length > 1) {
    const TYPE = { cvt: { ua: 'варіатор', ru: 'вариатор', en: 'CVT' }, automatic: { ua: 'ступінчастий автомат', ru: 'ступенчатый автомат', en: 'stepped automatic' }, dct: { ua: 'роботизована коробка', ru: 'роботизированная коробка', en: 'dual-clutch' }, reducer: { ua: 'редуктор', ru: 'редуктор', en: 'single-speed reducer' } };
    const srcLabel = src => String(src).split('+').map(x => (SOURCE_LABEL[x] ? SOURCE_LABEL[x][L] : x)).join(L === 'en' ? ' and ' : L === 'ua' ? ' і ' : ' и ');
    const parts = tt.candidates.map(c => srcLabel(c.source) + ': ' + (TYPE[c.value] ? TYPE[c.value][L] : c.value));
    out.push(L === 'ua' ? `Коробка автоматична, але точний її тип джерела називають по-різному (${parts.join('; ')}); це не суперечність, а невстановлений тип: з'ясовується за кодом агрегату на огляді.`
      : L === 'ru' ? `Коробка автоматическая, но точный её тип источники называют по-разному (${parts.join('; ')}); это не противоречие, а неустановленный тип: уточняется по коду агрегата на осмотре.`
      : `The gearbox is automatic, but the sources name its exact type differently (${parts.join('; ')}); this is not a contradiction but an unestablished type, settled by the unit code at inspection.`);
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
  power_hp: /потужн|мощност|horsepower|\d\s*(?:к\.?\s?с|л\.?\s?с|hp|ps|квт|kw)\b/i,
  electrification: /mhev|mild|гібрид|гибрид|hybrid|електрифік|электрифик/i,
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

/* A discrepancy about a technical identity field (fuel, displacement,
   induction, power, gearbox, drivetrain, version) is the passport's business
   in every status: resolved means the sources agree after normalisation,
   conflict is already in data_notes, unknown is unknown. The seller is not
   accused of a "discrepancy" about such a field in any case. Owners, mileage,
   accidents, equipment and condition remain real discrepancies */
const IDENTITY_FIELDS = ['fuel', 'displacement_l', 'forced_induction', 'power_hp', 'transmission', 'drivetrain', 'version', 'electrification'];
export function identityFieldOf(item) {
  if (!item || typeof item !== 'object') return null;
  const text = [item.title, item.detail].filter(Boolean).join(' ');
  if (!text) return null;
  for (const f of IDENTITY_FIELDS) if (FIELD_WORDS[f] && FIELD_WORDS[f].test(text)) return f;
  return null;
}

/* Header follows the passport: a resolved field is written into the header,
   a field in conflict is removed from it, power in conflict leaves the
   engine line without a horsepower figure. Returns what changed */
const FUEL_HEADER = { petrol: 'petrol', diesel: 'diesel', hybrid: 'hybrid', phev: 'hybrid', electric: 'electric' };
const POWER_IN_TEXT = /,?\s*(?:\(|\b)\d{2,4}\s*(?:к\.?\s?с\.?|л\.?\s?с\.?|кс\b|лс\b|\bps\b|\bhp\b|\bbhp\b|квт|kw)\.?\)?/gi;
export function syncHeaderWithSpec(vehicle, spec, { driveLabel = null } = {}) {
  const changes = [];
  if (!vehicle || typeof vehicle !== 'object' || !spec) return changes;
  const set = (key, value, why) => { if (vehicle[key] !== value) { changes.push({ field: key, from: vehicle[key] === undefined ? null : vehicle[key], to: value, why }); vehicle[key] = value; } };
  const HEADER_FIELD = { fuel: 'fuel', drivetrain: 'drive', transmission: 'transmission', version: 'trim', model_year: 'model_year', displacement_l: 'engine', forced_induction: 'engine' };
  for (const f of spec.conflicts || []) {
    if (f === 'power_hp') {
      if (typeof vehicle.engine === 'string' && POWER_IN_TEXT.test(vehicle.engine)) set('engine', vehicle.engine.replace(POWER_IN_TEXT, '').replace(/\s*,\s*$/, '').replace(/\s{2,}/g, ' ').trim() || null, 'power_conflict');
      POWER_IN_TEXT.lastIndex = 0;
      continue;
    }
    if (HEADER_FIELD[f] && vehicle[HEADER_FIELD[f]] !== null && vehicle[HEADER_FIELD[f]] !== undefined) set(HEADER_FIELD[f], null, 'identity_conflict');
  }
  const resolved = f => spec[f] && !spec[f].conflict && spec[f].value !== null && spec[f].value !== undefined && spec[f].strength !== 'weak';
  if (resolved('fuel') && FUEL_HEADER[spec.fuel.value] && vehicle.fuel !== FUEL_HEADER[spec.fuel.value]) set('fuel', FUEL_HEADER[spec.fuel.value], 'canonical');
  if (resolved('version') && (vehicle.trim === null || vehicle.trim === undefined || !String(vehicle.trim).trim())) set('trim', spec.version.value, 'canonical');
  if (resolved('model_year') && vehicle.model_year !== spec.model_year.value) set('model_year', spec.model_year.value, 'canonical');
  if (resolved('drivetrain') && typeof driveLabel === 'function') {
    const label = driveLabel(spec.drivetrain.value);
    if (label && normDrive(vehicle.drive) !== spec.drivetrain.value) set('drive', label, 'canonical');
  }
  return changes;
}

/* Компактний паспорт для _meta: значення, джерело, сила, конфлікт */
export function publicSpec(spec) {
  if (!spec) return null;
  const out = { version: 'vs-v1', stage: spec.stage || null, decoder: spec.decoder ? { present: spec.decoder.present, strong: spec.decoder.strong, error_code: spec.decoder.error_code, unreliable_fields: spec.decoder.unreliable_fields } : null, conflicts: spec.conflicts || [], fields: {} };
  for (const f of SPEC_FIELDS) {
    const x = spec[f];
    if (!x) continue;
    out.fields[f] = { value: x.value === undefined ? null : x.value, source: x.source || null, strength: x.strength || null, conflict: !!x.conflict };
    if (f === 'transmission_type') out.fields[f].exact = !!x.exact;
    if ((x.conflict || (f === 'transmission_type' && !x.exact)) && Array.isArray(x.candidates)) out.fields[f].candidates = x.candidates.filter(c => c.value !== null).map(c => ({ source: c.source, value: c.value, raw: c.raw || null }));
  }
  /* genuinely unknown identity fields: no trusted source gives a value and there is no conflict */
  out.unknown = ['version', 'fuel', 'transmission', 'drivetrain', 'power_hp'].filter(f => spec[f] && spec[f].value === null && !spec[f].conflict);
  return out;
}
