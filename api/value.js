/* CalCar Check: секція "Вартість, знецінення, ліквідність" (Value v1).

   Три речі в одному модулі:
   1. детермінована крива вартості: одна неперервна функція від "новою"
      через "сьогодні" і ще на 5 років уперед. Числа рахує код, не модель;
   2. вибір якорів: поточна ринкова ціна (середня площадки або ціна
      оголошення) і ціна нового авто (локальна ціна того самого ринку ->
      MSRP ринку-джерела з локалізацією за коефіцієнтами Import ->
      зворотна оцінка від поточної ціни і віку);
   3. малий паралельний виклик моделі: ліквідність, чинники ціни моделі і
      кандидати ціни нового авто зі сниппетів веб-пошуку. Кандидат
      приймається лише коли число справді стоїть у тексті джерела.

   Межі: нічого з цього не входить у Score чи Confidence. Розрахована
   зворотна оцінка ніколи не зберігається як факт про модель: у звіті вона
   позначена approx і basis = reverse_estimate. Ринок і валюта явні у
   контракті з першого дня (бета: Україна, USD).
   Це не Vercel-функція: файл без default export. */

import { searchSerper, classifySource, hostOf } from './mi-research.js';

export const VALUE_VERSION = 'value-v1';
export const FORECAST_YEARS = 5;
export const STEP_YEARS = 0.5;

export function valueSectionEnabled(env) {
  const raw = String(((env || process.env) || {}).VALUE_SECTION || '').trim().toLowerCase();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- Базове річне утримання вартості (лише для зворотної оцінки) ---------- */

export function annualRetention(yearIndex) {
  if (yearIndex <= 1) return 0.85;
  if (yearIndex === 2) return 0.90;
  if (yearIndex <= 5) return 0.92;
  if (yearIndex <= 10) return 0.95;
  return 0.97;
}

/* накопичене утримання за T років; неповний рік береться часткою степеня */
export function retentionFactor(T) {
  const t = num(T);
  if (t === null || t <= 0) return 1;
  let f = 1;
  for (let y = 1; y <= Math.ceil(t); y++) f *= Math.pow(annualRetention(y), Math.min(1, t - (y - 1)));
  return f;
}

export function reverseNewPrice(pc, T) {
  const p = num(pc);
  if (p === null || p <= 0) return null;
  return p / retentionFactor(T);
}

/* ---------- Вік ---------- */

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
export const MIN_AGE_YEARS = 0.5;

/* Площадка дає лише рік. Авто року Y у середньому продане новим посеред
   року, тому старт це 1 липня Y. Молодше за пів року рахуємо як пів року:
   коротша вісь не дає стабільної форми */
export function vehicleAgeYears(year, nowMs) {
  const y = parseInt(year, 10);
  if (!y || y < 1950 || y > new Date(nowMs).getUTCFullYear() + 1) return null;
  const start = Date.UTC(y, 6, 1);
  return Math.max(MIN_AGE_YEARS, (nowMs - start) / YEAR_MS);
}

/* ---------- Крива ---------- */

/* P(t) = F + (P0 - F) * exp(-k * t^b)
   F = min(0.12 * P0, 0.60 * Pc), b = clamp(0.50 + 0.04 * T, 0.50, 0.95),
   k з умови P(T) = Pc. Одна функція до і після "сьогодні". */
export function fitCurve(P0, Pc, T) {
  const p0 = num(P0), pc = num(Pc), t = num(T);
  if (p0 === null || pc === null || t === null || t <= 0 || pc <= 0) return null;
  const F = Math.min(0.12 * p0, 0.60 * pc);
  if (!(p0 > pc && pc > F)) return null;
  const b = clamp(0.50 + 0.04 * t, 0.50, 0.95);
  const k = -Math.log((pc - F) / (p0 - F)) / Math.pow(t, b);
  if (!isFinite(k) || k <= 0) return null;
  return { P0: p0, Pc: pc, T: t, F, b, k };
}

export function priceAt(c, t) {
  if (!c) return null;
  const tt = Math.max(0, t);
  const v = c.F + (c.P0 - c.F) * Math.exp(-c.k * Math.pow(tt, c.b));
  return isFinite(v) ? v : null;
}

const ym = ms => { const d = new Date(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const shiftMonths = (ms, months) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1); };

/* Точки кожні 6 місяців. Сітка привʼязана до "сьогодні", тому сьогодні і
   +5 років завжди є точками; перший відрізок від нового авто може бути
   коротшим за пів року. */
export function curvePoints(c, nowMs) {
  if (!c) return [];
  const pts = [];
  const push = (t, forecast) => {
    const v = priceAt(c, t);
    if (v === null) return;
    pts.push({ t: Math.round(t * 1000) / 1000, date: ym(shiftMonths(nowMs, Math.round((t - c.T) * 12))), value: Math.round(v), forecast });
  };
  const back = Math.floor((c.T - 1e-9) / STEP_YEARS);
  push(0, false);
  for (let n = back; n >= 1; n--) push(c.T - n * STEP_YEARS, false);
  push(c.T, false);
  for (let n = 1; n <= FORECAST_YEARS / STEP_YEARS; n++) push(c.T + n * STEP_YEARS, true);
  /* якорі точні, без похибки округлення експоненти */
  pts[0].value = Math.round(c.P0);
  const today = pts.find(p => !p.forecast && p.t === Math.round(c.T * 1000) / 1000);
  if (today) { today.value = Math.round(c.Pc); today.today = true; }
  return pts;
}

/* ---------- Поточна ринкова ціна і маркер оголошення ---------- */

const PRICE_MIN = 300, PRICE_MAX = 5000000;
const sanePrice = v => { const n = num(v); return n !== null && n >= PRICE_MIN && n <= PRICE_MAX ? n : null; };

/* Графік про конкретне авто, яке людина розглядає, тому якір "сьогодні"
   це НИЖЧА з двох цін: ціна оголошення і середня площадки. Прогноз
   продовжується від неї. Друга ціна лишається контекстом окремою позначкою
   і криву не зміщує:
     - якір це ціна оголошення -> average: середня площадки;
     - якір це середня -> listing: ціна оголошення з відхиленням.
   Є лише одна з цін: вона і є якорем. Порівнюються тільки ціни в одній
   валюті. Ціна оголошення, що відрізняється від середньої більш ніж утричі,
   вважається хибною: якорем лишається середня, позначки немає. Ціни, які
   після округлення до сотні збігаються, другої позначки не дають. */
export function resolveCurrentPrice({ price, currency, price_context } = {}) {
  const listing = sanePrice(price);
  const cur = currency || (price_context && price_context.currency) || null;
  const pc = price_context && typeof price_context === 'object' ? price_context : null;
  const avg = pc ? sanePrice(pc.average_price) : null;
  const sameCurrency = pc && (!currency || !pc.currency || pc.currency === currency);
  const name = (pc && pc.source_name) || null;
  /* обидва реальні входи "сьогодні" для стовпчика чисел і позначок графіка:
     ціна оголошення і середня площадки, незалежно від того, яка з них якір */
  const prices = { listing, average: avg !== null && sameCurrency ? avg : null, average_source_name: avg !== null && sameCurrency ? name : null };
  const fromListing = { value: listing, source: 'listing_price', source_name: null, currency: cur, listing: null, average: null, prices };
  if (avg === null || !sameCurrency) return listing !== null ? fromListing : null;
  const fromAverage = { value: avg, source: 'marketplace_average', source_name: name, currency: pc.currency || cur, listing: null, average: null, prices };
  if (listing === null || listing / avg < 0.3 || listing / avg > 3) return fromAverage;
  const sameShown = Math.round(listing / 100) === Math.round(avg / 100);
  if (listing <= avg) {
    return { ...fromListing, currency: pc.currency || cur, average: sameShown ? null : { value: avg, source_name: name } };
  }
  return { ...fromAverage, listing: sameShown ? null : { value: listing, delta_percent: Math.round((listing - avg) / avg * 100) } };
}

/* ---------- Валюта сторонніх цін ---------- */

/* Середньорічні курси для приведення знайденої ціни нового авто до USD.
   Точність тут не ювелірна: якір усе одно позначається приблизним, якщо
   це не точна локальна ціна тієї самої версії. */
const UAH_PER_USD = { 2005: 5.12, 2006: 5.05, 2007: 5.05, 2008: 5.27, 2009: 7.79, 2010: 7.94, 2011: 7.97, 2012: 7.99, 2013: 7.99, 2014: 11.89, 2015: 21.84, 2016: 25.55, 2017: 26.60, 2018: 27.20, 2019: 25.85, 2020: 26.96, 2021: 27.29, 2022: 32.34, 2023: 36.57, 2024: 40.15, 2025: 41.7, 2026: 42.5 };
const USD_PER_EUR = { 2005: 1.24, 2006: 1.26, 2007: 1.37, 2008: 1.47, 2009: 1.39, 2010: 1.33, 2011: 1.39, 2012: 1.28, 2013: 1.33, 2014: 1.33, 2015: 1.11, 2016: 1.11, 2017: 1.13, 2018: 1.18, 2019: 1.12, 2020: 1.14, 2021: 1.18, 2022: 1.05, 2023: 1.08, 2024: 1.08, 2025: 1.13, 2026: 1.15 };
const rateFor = (table, year) => {
  const ys = Object.keys(table).map(Number);
  const y = clamp(parseInt(year, 10) || ys[ys.length - 1], ys[0], ys[ys.length - 1]);
  return table[y];
};

export function toUsd(amount, currency, year) {
  const a = num(amount);
  if (a === null || a <= 0) return null;
  if (currency === 'USD') return a;
  if (currency === 'EUR') return a * rateFor(USD_PER_EUR, year);
  if (currency === 'UAH') {
    /* до 2005 року таблиці немає: старі гривневі ціни не перераховуємо */
    if ((parseInt(year, 10) || 0) < 2005) return null;
    return a / rateFor(UAH_PER_USD, year);
  }
  return null;
}

/* ---------- Локалізація MSRP США в Україну ---------- */

/* "Новою" це ціна на локальному ринку ТОДІ, КОЛИ АВТО БУЛО НОВИМ. Тому
   MSRP ринку-джерела локалізується режимом ввезення ТОГО року, а не
   сьогоднішнім. Це не податкова база: лише періоди, для яких режим відомий.
   Для року без відомого режиму локалізації немає (null), і якір бере
   детерміновану зворотну оцінку. Сьогоднішні правила історичною правдою
   мовчки не стають.

   - електромобіль, 2019-2025: мито 0%, ПДВ звільнено, акциз 1 EUR за кВт*год;
   - решта (бензин, дизель, гібрид) від 2019 і електромобіль від 2026:
     коефіцієнти кошторису Import (result.html: autoFill і computeExcise)
     для нового авто: мито 10%, акциз за типом і обʼємом двигуна з віком 1,
     ПДВ 20% від суми.
   Логістика не податок: середина таблиці STATE_RATES Import (доставка по
   США плюс фрахт), однакова для всіх режимів. */
const EUR_USD_IMPORT = 1.08;
export const IMPORT_LOGISTICS_USD = 1850;
export const UA_IMPORT_REGIMES = [
  { id: 'ua_bev_2019_2025', fuel: ['electric'], from: 2019, to: 2025, duty: 0, vat: 0, excise: 'per_kwh' },
  { id: 'ua_bev_2026', fuel: ['electric'], from: 2026, to: null, duty: 0.10, vat: 0.20, excise: 'per_kwh' },
  { id: 'ua_ice_2019', fuel: ['petrol', 'diesel', 'hybrid'], from: 2019, to: null, duty: 0.10, vat: 0.20, excise: 'by_engine' },
];

export function uaImportRegime(fuel, year) {
  const y = parseInt(year, 10);
  if (!y || !fuel) return null;
  return UA_IMPORT_REGIMES.find(r => r.fuel.includes(fuel) && y >= r.from && (r.to === null || y <= r.to)) || null;
}

/* null: режим для цього року чи типу приводу невідомий */
export function localizeUsMsrpToUA(msrp, { fuel = null, displacement_l = null, battery_kwh = null, year = null } = {}) {
  const m = num(msrp);
  if (m === null || m <= 0) return null;
  const disp = num(displacement_l) || 0;
  /* тип пального невідомий, але обʼєм двигуна є: це авто з ДВЗ, рахуємо як бензин */
  const regime = uaImportRegime(fuel || (disp ? 'petrol' : null), year);
  if (!regime) return null;
  let excise = 0;
  if (regime.excise === 'per_kwh') excise = (num(battery_kwh) || 0) * EUR_USD_IMPORT;
  else if (fuel === 'hybrid') excise = 100 * EUR_USD_IMPORT;
  else if (disp) excise = disp * (fuel === 'diesel' ? (disp > 3.5 ? 150 : 75) : (disp > 3.0 ? 100 : 50)) * EUR_USD_IMPORT;
  const duty = m * regime.duty;
  const vat = (m + duty + excise) * regime.vat;
  return { value: m + duty + excise + vat + IMPORT_LOGISTICS_USD, regime: regime.id, duty, vat, excise };
}

/* ---------- Якір "новою" ---------- */

/* Мінімально правдоподібне відношення ціни нового авто до поточної для
   СЛАБКОГО якоря (не точна локальна ціна тієї самої версії): авто мусило
   втратити хоч щось. Це запобіжник від базового MSRP під дорогою
   конфігурацією, а не конкурент знайденій ціні: авто, що добре тримають
   ціну, його проходять. */
export function minNewToCurrentRatio(T) {
  const t = Math.max(0, num(T) || 0);
  return 1 + 0.06 * Math.min(t, 1) + 0.02 * Math.min(Math.max(t - 1, 0), 4);
}
/* очевидно хибне число (не та валюта, зайвий нуль): у стільки разів вище
   за зворотну оцінку нове авто не коштувало */
export const MAX_OVER_REVERSE = 5;

/* candidates: уже перевірені (validateCandidates) ціни з джерел.
   Порядок: A локальна ціна того самого ринку, B MSRP США з локалізацією,
   C зворотна оцінка. max(MSRP, зворотна оцінка) свідомо НЕ застосовується. */
/* Чи узгоджена ціна з роком авто в часі.
   - дата сторінки відома: вона мусить бути в межах року від року авто;
   - дати немає: рік авто має стояти в тексті джерела, і пізнішого року там
     бути не повинно;
   - ціна в USD без жодної дати лишається слабким якорем (перерахунку
     валюти немає, спотворити її курсом не можна);
   - інакше джерело якорем не стає. */
export function priceTimeCoherence(c, vehicleYear) {
  const y = parseInt(vehicleYear, 10) || null;
  if (!y) return { ok: false, reason: 'price_date_unknown' };
  const sy = c.source_year || null;
  const years = Array.isArray(c.text_years) ? c.text_years : [];
  if (sy) {
    if (Math.abs(sy - y) > 1) return { ok: false, reason: 'source_date_mismatch' };
    return { ok: true, evidence: 'source_date', price_year: sy };
  }
  if (years.includes(y) && !years.some(x => x > y + 1)) return { ok: true, evidence: 'year_in_text', price_year: y };
  if (c.currency === 'USD' && !years.some(x => x > y + 1)) return { ok: true, evidence: 'none', price_year: y };
  return { ok: false, reason: years.some(x => x > y + 1) ? 'source_date_mismatch' : 'price_date_unknown' };
}

/* ---------- Силовий агрегат для вибору MSRP ----------
   Двигун лише ВИБИРАЄ, які справжні ціни версій стосуються цього авто;
   коефіцієнтів ціни за двигун немає, і обладнання з двигуна не виводиться. */
const FUELS = ['petrol', 'diesel', 'hybrid', 'electric'];
const DRIVES = ['awd', 'rwd', 'fwd'];
/* лінійки високої продуктивності: окремий світ цін, з V8 звичайної версії не змішуються */
/* Ціна нового авто це ЗАВОДСЬКА ціна. Ціна конверсії тюнінг-ательє не є
   ціною заводської версії, навіть коли авто пізніше доопрацьоване тим
   самим ательє: така ціна береться лише коли сама версія авто так
   називається (авто продане як конверсія) */
export const AFTERMARKET_RE = /\b(?:brabus|mansory|hamann|lorinser|novitec|techart|startech|renntech|hennessey|carlsson|g[\s-]?power|ac\s?schnitzer|lumma|liberty\s?walk|prior\s?design|overfinch|kahn|urban\s?automotive|abt)\b/i;
export const PERFORMANCE_RE = /\bamg\b|\b(?:c|e|s|g|gl|gle|gls|ml|cls|sl|glc|glk|cla|gla)\s?(?:55|63|65)\b|\bm[2-8]\b|\bx[3-7]\s?m\b|\brs\s?\d\b|\bsvr\b|turbo\s*s\b|\bsrt\b|hellcat|trackhawk|\btrx\b|type\s*r\b|\bgt3\b|nismo|shelby/i;
const numOrNull = (v, lo, hi) => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) && n >= lo && n <= hi ? n : null; };
export function cleanPowertrain(pt) {
  const p = pt && typeof pt === 'object' ? pt : {};
  return {
    fuel: FUELS.includes(p.fuel) ? p.fuel : null,
    displacement_l: numOrNull(p.displacement_l, 0.6, 9),
    cylinders: (() => { const n = numOrNull(p.cylinders, 2, 16); return n === null ? null : Math.round(n); })(),
    power_hp: (() => { const n = numOrNull(p.power_hp, 40, 2000); return n === null ? null : Math.round(n); })(),
    drive: DRIVES.includes(p.drive) ? p.drive : null,
    performance: p.performance === true,
  };
}
export function normalizeDrive(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (/полн|повн|awd|4wd|4x4|4matic|xdrive|quattro|all[\s-]*wheel|4motion/.test(t)) return 'awd';
  if (/передн|front|fwd/.test(t)) return 'fwd';
  if (/задн|rear|rwd/.test(t)) return 'rwd';
  return null;
}
/* ідентичність цього авто зі звіту: текст двигуна ("4,7 л бензин V8,
   435 л.с."), паливо, привід, версія і назва для лінійки продуктивності */
export function vehiclePowertrain({ fuel = null, engine = null, displacement_l = null, drive = null, trim = null, title = null } = {}) {
  const e = String(engine || '');
  /* перше десяткове число тексту двигуна: "4,7 л", "3.0 TDI", "4.0 V8" */
  const disp = numOrNull(displacement_l, 0.6, 9) ?? numOrNull((/(?:^|[^\d.,])(\d[.,]\d)(?![\d.,])/.exec(e) || [])[1]?.replace(',', '.'), 0.6, 9);
  const cylM = /\b[vw](\d{1,2})\b/i.exec(e) || /\b(?:i|l|r)(\d)\b/i.exec(e) || /(\d{1,2})\s*-?\s*(?:цил|cyl)/i.exec(e);
  const hpM = /(\d{2,4})\s*(?:л\.?\s?с|к\.?\s?с|hp\b|bhp\b|ps\b)/i.exec(e);
  const kwM = /(\d{2,4})\s*(?:квт|kw\b)/i.exec(e);
  const fuelText = /дизел|diesel|tdi|cdi|crdi|bluetec|dci|hdi|jtd/i.test(e) ? 'diesel' : /гибрид|гібрид|hybrid/i.test(e) ? 'hybrid' : /электр|електр|electric/i.test(e) ? 'electric' : /бензин|petrol|gasoline/i.test(e) ? 'petrol' : null;
  return cleanPowertrain({
    fuel: FUELS.includes(fuel) ? fuel : fuelText,
    displacement_l: disp,
    cylinders: cylM ? parseInt(cylM[1], 10) : null,
    power_hp: hpM ? parseInt(hpM[1], 10) : (kwM ? Math.round(parseInt(kwM[1], 10) * 1.341) : null),
    drive: normalizeDrive(drive),
    performance: PERFORMANCE_RE.test(String(trim || '') + ' ' + String(title || '')),
  });
}
/* Порівняння версії-кандидата з цим авто:
   - equivalent: той самий технічний автомобіль під іншою ринковою назвою:
     паливо, обʼєм і потужність (до 7%) збігаються, привід не суперечить,
     лінійка продуктивності та сама;
   - powertrain: сумісний агрегат (паливо і обʼєм), але не доведено, що це
     та сама версія;
   - інакше причина відмови. Сам лише V8 не доводить нічого */
export function compareTechnical(v, c) {
  if (!v || !c) return { level: null, reason: 'no_powertrain' };
  if (!!v.performance !== !!c.performance) return { level: null, reason: 'performance_mismatch' };
  const known = x => x !== null && x !== undefined;
  if (!known(v.fuel) && !known(v.displacement_l)) return { level: null, reason: 'no_vehicle_powertrain' };
  if (known(v.fuel) && known(c.fuel) && v.fuel !== c.fuel) return { level: null, reason: 'wrong_fuel' };
  if (known(v.displacement_l) && known(c.displacement_l) && Math.abs(v.displacement_l - c.displacement_l) > 0.25) return { level: null, reason: 'wrong_engine' };
  if (known(v.cylinders) && known(c.cylinders) && v.cylinders !== c.cylinders) return { level: null, reason: 'wrong_engine' };
  const fuelOk = known(v.fuel) && v.fuel === c.fuel;
  const dispOk = known(v.displacement_l) && known(c.displacement_l) && Math.abs(v.displacement_l - c.displacement_l) <= 0.15;
  const cylOk = known(v.cylinders) && v.cylinders === c.cylinders;
  const powerKnown = known(v.power_hp) && known(c.power_hp);
  const powerOk = powerKnown && Math.abs(v.power_hp - c.power_hp) / Math.max(v.power_hp, c.power_hp) <= 0.07;
  const driveConflict = known(v.drive) && known(c.drive) && v.drive !== c.drive;
  /* еквівалент вимагає ще й близької потужності: однаковий обʼєм буває у
     різних версій з різною віддачею (і різною ціною) */
  if (fuelOk && dispOk && powerOk && !driveConflict) return { level: 'equivalent', reason: null };
  if (fuelOk && (dispOk || (cylOk && !(known(v.displacement_l) && known(c.displacement_l))))) return { level: 'powertrain', reason: powerKnown && !powerOk ? 'different_output' : driveConflict ? 'wrong_drivetrain' : 'weak_equivalence' };
  return { level: null, reason: 'weak_equivalence' };
}
const centralOf = values => { const v = [...new Set(values.map(x => Math.round(x)))].sort((a, b) => a - b), n = v.length; return { values: v, central: n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2 }; };

/* частка, на яку ціна точної версії може відходити від узгодженої ціни
   інших джерел того самого модельного року (коли їх щонайменше два) */
export const EXACT_OUTLIER_SHARE = 0.25;

/* Чи та сама версія: назва версії з джерела проти версії цього авто.
   Порівнюються злиті токени без слів про привід і кузов, з назвою моделі і
   без неї: "X 450 AWD" і "X450" збігаються, "Limited Platinum" і
   "Limited" ні. */
const TRIM_NOISE = new Set(['4matic', '4m', 'awd', '4wd', 'fwd', 'rwd', '2wd', 'xdrive', 'sdrive', 'quattro', '4motion', '4x4', '4x2', 'all', 'wheel', 'drive',
  'sedan', 'suv', 'coupe', 'wagon', 'hatchback', 'crossover', 'at', 'mt', 'amt', 'cvt', 'dct', 'dsg', 'tiptronic', 'base', 'utility', 'sport', '4d', '5d']);
/* версія площадки без потужності в дужках: "X 63 AT (557 к.с.)" -> "X 63 AT" */
export function cleanVersion(text) {
  return String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}
/* токени версії: шум приводу, коробки і кузова прибрано, літери і цифри
   розділені ("X63" -> x, 63), порядок не важить */
const trimTokens = s => cleanVersion(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
  .filter(x => x && !TRIM_NOISE.has(x)).flatMap(x => x.match(/\p{L}+|\p{N}+/gu) || []).filter(x => !TRIM_NOISE.has(x));
export function trimMatches(version, trim, { make = null, model = null } = {}) {
  if (!version || !trim) return false;
  const skip = new Set([...trimTokens(make), ...trimTokens(model)]);
  const key = s => [...new Set(trimTokens(s).filter(x => !skip.has(x)))].sort().join(' ');
  const a = key(version), b = key(trim);
  return a.length >= 2 && a === b;
}

/* MSRP про той самий модельний рік: рік авто з оголошення або модельний
   рік з декодера чи аналізу (вони можуть відрізнятись на рік); без року
   ціни текст джерела не повинен казати про інший рік */
function msrpYearOk(c, years) {
  if (!years.length) return false;
  if (c.model_year) return years.includes(c.model_year);
  const inText = Array.isArray(c.text_years) ? c.text_years : [];
  return !(inText.length && !inText.some(y => years.includes(y)));
}

/* candidates: уже перевірені (validateCandidates) ціни з джерел.
   Порядок:
   A. сильна локальна ціна того самого ринку, узгоджена в часі;
   B. MSRP ринку-джерела саме цієї версії того самого модельного року;
      режим ввезення року відомий: локалізується, інакше лишається як є
      (підпис у звіті і так "Оцінка новою");
   C. слабка локальна ціна;
   D. версія невідома, ціни кількох версій модельного року з одного
      джерела: медіана (2 ціни: середина); лише стартова ціна: нижня межа
      для зворотної оцінки;
   E. одна MSRP невідомої версії з відомим режимом ввезення (як раніше);
   F. зворотна оцінка.
   max(MSRP, зворотна) свідомо НЕ застосовується. */
export function resolveNewPrice({ candidates = [], pc, T, market = null, currency = null, vehicle = {} } = {}) {
  const reverse = reverseNewPrice(pc, T);
  const rejected = [];
  let msrpInfo = null;
  const fallback = reason => ({
    value: reverse !== null ? Math.round(reverse) : null, approx: true, basis: 'reverse_estimate', strength: null, fact: null, rejected, msrp: msrpInfo,
    ...(reason ? { reason } : {}),
  });
  if (reverse === null) return fallback('no_current_price');
  /* сторонні ціни приводяться до USD; графік в іншій валюті їх не бере */
  if (currency !== 'USD' || market !== 'UA') return fallback(candidates.length ? 'sourced_price_needs_ua_usd_market' : null);

  const vy = parseInt(vehicle.year, 10) || null;
  const vYears = [vy, parseInt(vehicle.model_year, 10) || null].filter(Boolean);
  const minOk = pc * minNewToCurrentRatio(T);
  const reject = (c, reason, extra) => rejected.push({ ref: c.source_url || null, reason, amount: c.amount, currency: c.currency, source_date: c.source_date || null, ...(c.version ? { version: c.version } : {}), ...(extra || {}) });
  const localize = (usd, year) => localizeUsMsrpToUA(usd, { ...vehicle, year });
  const sourced = (p, extra) => ({ value: Math.round(p.value), approx: p.strength !== 'strong', basis: p.basis, strength: p.strength, rejected, msrp: msrpInfo,
    fact: { ...p.c, amount_usd: Math.round(p.usd), price_year: p.price_year }, ...(p.localization ? { localization: p.localization } : {}), ...(extra || {}) });
  const plausible = p => {
    if (p.value < minOk) { reject(p.c, 'incompatible_with_current_value', { value: Math.round(p.value) }); return false; }
    if (p.value > reverse * MAX_OVER_REVERSE) { reject(p.c, 'implausibly_high', { value: Math.round(p.value) }); return false; }
    return true;
  };

  /* ---- локальні ціни ---- */
  const locals = [];
  const msrps = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (c.price_kind === 'local_list' && c.market === 'UA') {
      /* Локальна ціна це якір лише коли зрозуміло, ДО ЯКОГО ЧАСУ вона
         належить. Сторінка дилера з цінами "нових авто" без дати чи з
         пізнішою датою показує прайс того дня, а не ціну року авто:
         перерахунок такої гривневої ціни в долари за курсом року авто дав би
         число, якого ніколи не існувало. Курси ми не моделюємо: неузгоджене
         в часі джерело просто не стає якорем */
      const tc = priceTimeCoherence(c, vehicle.year);
      if (!tc.ok) { reject(c, tc.reason); continue; }
      if (c.price_ladder) { reject(c, 'ambiguous_trim_ladder'); continue; }
      const usd = toUsd(c.amount, c.currency, tc.price_year);
      if (usd === null) { reject(c, 'currency_not_convertible'); continue; }
      locals.push({ value: usd, usd, basis: 'local_list', strength: c.trim_match === 'exact' && tc.evidence !== 'none' ? 'strong' : 'weak', c, price_year: tc.price_year });
    } else if (c.price_kind === 'source_msrp' && c.market === 'US') {
      const usd = toUsd(c.amount, c.currency, c.model_year || vy);
      if (usd === null) { reject(c, 'currency_not_convertible'); continue; }
      if (!msrpYearOk(c, vYears)) { reject(c, 'msrp_other_model_year'); continue; }
      if (AFTERMARKET_RE.test(String(c.version || '')) && !AFTERMARKET_RE.test(String(vehicle.trim || ''))) { reject(c, 'aftermarket_conversion'); continue; }
      msrps.push({ c, usd, price_year: c.model_year || vy });
    } else {
      reject(c, 'market_not_supported');
    }
  }
  const trimRank = p => (p.c.trim_match === 'exact' ? 0 : p.c.trim_match === 'unknown' ? 1 : 2);
  const confRank = p => (p.c.confidence === 'high' ? 0 : 1);
  locals.sort((a, b) => (trimRank(a) - trimRank(b)) || (confRank(a) - confRank(b)));

  /* A. сильна локальна: точна локальна ціна нижча за ринок ховає графік,
     джерело не підробляємо */
  const strong = locals.find(p => p.strength === 'strong');
  if (strong) {
    if (strong.value <= pc) return sourced(strong, { reason: 'strong_anchor_not_above_market' });
    return sourced(strong);
  }

  /* ---- вибір MSRP: спершу точна версія, далі технічний еквівалент іншого
     ринку, далі сумісний агрегат, лише потім уся сімʼя модельного року ---- */
  const vPt = vehicle.powertrain ? cleanPowertrain(vehicle.powertrain) : vehiclePowertrain(vehicle);
  const ptOf = m => { const p = cleanPowertrain(m.c.powertrain); return { ...p, performance: p.performance || PERFORMANCE_RE.test(String(m.c.version || '')) }; };
  const describe = m => ({ version: m.c.version || null, amount: m.c.amount, currency: m.c.currency, model_year: m.price_year, powertrain: m.c.powertrain || null, source_url: m.c.source_url || null });
  const sel = { vehicle_version: vehicle.trim || null, vehicle_powertrain: vPt, all_candidates: msrps.map(describe),
    exact_version_candidates: [], equivalent_version_candidates: [], powertrain_candidates: [], rejected_versions: [] };
  const pick = (method, list, market) => {
    const { values, central } = centralOf(list.map(m => m.usd));
    const year = list[0].price_year;
    const loc = localize(central, year);
    const urls = [...new Set(list.map(m => m.c.source_url).filter(Boolean))];
    msrpInfo = { exact: null, selection: { ...sel, method, model_year: year, candidate_count: values.length, values, min: values[0], max: values[values.length - 1],
      selected: Math.round(central), selected_value_localized: loc ? Math.round(loc.value) : null, localization: loc ? loc.regime : null, sources: urls, market: market || 'US',
      trim_known: !!vehicle.trim, exact_trim_matched: method === 'exact_version' } };
    return { value: loc ? loc.value : central, c: { source_url: urls[0] || null, amount: Math.round(central), currency: 'USD' }, localization: loc ? loc.regime : null };
  };

  /* B. MSRP саме цієї версії: переважає будь-яке зіставлення за двигуном */
  const isExact = m => m.c.trim_match === 'exact' || trimMatches(m.c.version, vehicle.trim, vehicle);
  /* серед точних: спершу ціна модельного року самого авто, далі довіра до
     джерела, далі близькість до узгодженої ціни інших джерел. Ціна точної
     версії, що далеко відходить від кількох інших джерел того самого року
     ("ціна в іншій валюті", "з опціями", ціна конверсії), відкидається:
     узгоджена базова ціна точної версії сильніша за поодиноке завищене
     число */
  const ownYear = parseInt(vehicle.model_year, 10) || vy;
  const yearRank = m => (m.price_year === ownYear ? 0 : 1);
  const median = arr => { const v = arr.slice().sort((a, b) => a - b), n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };
  const exactAll = msrps.filter(isExact);
  const exact = [];
  exactAll.forEach((m, i) => {
    const peers = exactAll.filter((x, j) => j !== i && x.price_year === m.price_year).map(x => x.usd);
    if (peers.length >= 2) {
      const consensus = median(peers);
      if (Math.abs(m.usd - consensus) / consensus > EXACT_OUTLIER_SHARE) { reject(m.c, 'exact_price_outlier', { consensus: Math.round(consensus) }); return; }
    }
    exact.push(m);
  });
  const centre = y => { const v = exact.filter(m => m.price_year === y).map(m => m.usd); return v.length ? median(v) : null; };
  const offCentre = m => { const c = centre(m.price_year); return c ? Math.abs(m.usd - c) : 0; };
  exact.sort((a, b) => (yearRank(a) - yearRank(b)) || (confRank(a) - confRank(b)) || (offCentre(a) - offCentre(b)));
  sel.exact_version_candidates = exact.map(describe);
  for (const m of exact) {
    const loc = localize(m.usd, m.price_year);
    const p = { c: m.c, usd: m.usd, price_year: m.price_year, strength: 'weak',
      value: loc ? loc.value : m.usd, basis: loc ? 'localized_msrp' : 'source_msrp', localization: loc ? loc.regime : null };
    msrpInfo = { exact: { amount: m.c.amount, currency: m.c.currency, version: m.c.version || null, model_year: m.price_year, source_url: m.c.source_url, localization: p.localization },
      selection: { ...sel, method: 'exact_version', model_year: m.price_year, selected: Math.round(m.usd), selected_value_localized: loc ? Math.round(loc.value) : null,
        localization: p.localization, sources: [m.c.source_url], market: 'US', trim_known: !!vehicle.trim, exact_trim_matched: true } };
    if (plausible(p)) return sourced(p);
    msrpInfo = null;
  }

  /* B2. технічно та сама версія під іншою ринковою назвою */
  const equivalent = [], powertrain = [];
  for (const m of msrps) {
    if (isExact(m)) continue;
    const r = compareTechnical(vPt, ptOf(m));
    if (r.level === 'equivalent') { equivalent.push(m); powertrain.push(m); }
    else if (r.level === 'powertrain') { powertrain.push(m); sel.rejected_versions.push({ version: m.c.version || null, amount: m.c.amount, reason: r.reason }); }
    else sel.rejected_versions.push({ version: m.c.version || null, amount: m.c.amount, reason: r.reason });
  }
  sel.equivalent_version_candidates = equivalent.map(describe);
  sel.powertrain_candidates = powertrain.map(describe);
  if (equivalent.length) {
    const p = pick('equivalent_version', equivalent);
    if (plausible(p)) return { value: Math.round(p.value), approx: true, basis: 'msrp_equivalent_version', strength: null, fact: null, rejected, msrp: msrpInfo, ...(p.localization ? { localization: p.localization } : {}) };
  }

  /* C. слабка локальна */
  for (const p of locals) if (plausible(p)) return sourced(p);

  /* D1. версія не встановлена, але агрегат сумісний: медіана цих версій
     (дві: середина). Одна сумісна ціна без доведеної еквівалентності
     надто слабка: далі вся сімʼя */
  if (centralOf(powertrain.map(m => m.usd)).values.length >= 2) {
    const n = centralOf(powertrain.map(m => m.usd)).values.length;
    const method = n >= 3 ? 'powertrain_median' : 'powertrain_midpoint';
    const p = pick(method, powertrain);
    if (plausible(p)) return { value: Math.round(p.value), approx: true, basis: 'msrp_' + method, strength: null, fact: null, rejected, msrp: msrpInfo, ...(p.localization ? { localization: p.localization } : {}) };
  }

  /* D. версія невідома, але є ціни кількох версій того самого модельного
     року з одного джерела: нейтральна центральна MSRP. Три і більше цін:
     медіана (для парної кількості середнє двох центральних); дві ціни:
     середина між ними. Без ваг популярності версій і без імовірностей.
     Зворотна оцінка тут не вибирає і не зажимається в діапазон */
  /* версія лінійки продуктивності не бере ціну звичайних версій сімʼї:
     без ціни своєї лінійки чесніша зворотна оцінка */
  const lineMsrps = vPt.performance ? msrps.filter(m => ptOf(m).performance) : msrps;
  if (vPt.performance) for (const m of msrps) if (!lineMsrps.includes(m)) reject(m.c, 'performance_mismatch');
  const bySource = new Map();
  for (const m of lineMsrps) { const k = m.c.source_url || ''; if (!bySource.has(k)) bySource.set(k, []); bySource.get(k).push(m); }
  let family = null;
  for (const [, list] of bySource) {
    const n = centralOf(list.map(m => m.usd)).values.length;
    if (n >= 2 && (!family || n > family.n)) family = { list, n };
  }
  if (family) {
    const method = family.n >= 3 ? 'msrp_median' : 'msrp_midpoint';
    const p = pick(method, family.list);
    if (plausible(p)) return { value: Math.round(p.value), approx: true, basis: method, strength: null, fact: null, rejected, msrp: msrpInfo, ...(p.localization ? { localization: p.localization } : {}) };
  }
  /* лише стартова ціна моделі року: нижня межа правдоподібності, не сімʼя */
  if (!family) {
    const base = lineMsrps.filter(m => m.c.trim_match === 'base').sort((a, b) => a.usd - b.usd)[0];
    if (base) {
      const lo = localize(base.usd, base.price_year), loV = lo ? lo.value : base.usd;
      msrpInfo = { exact: null, selection: { ...sel, method: 'base_floor', model_year: base.price_year, candidate_count: 1, values: [Math.round(base.usd)], min: Math.round(base.usd), max: null,
        selected: null, selected_value_localized: Math.round(loV), localization: lo ? lo.regime : null, sources: [base.c.source_url], market: 'US', trim_known: !!vehicle.trim, exact_trim_matched: false, applied: reverse < loV ? 'floor' : null } };
      if (reverse < loV) return { value: Math.round(loV), approx: true, basis: 'msrp_base_floor', strength: null, fact: null, rejected, msrp: msrpInfo };
      return fallback(null);
    }
  }

  /* E. одна MSRP невідомої версії: лише з відомим режимом ввезення */
  for (const m of lineMsrps.sort((a, b) => confRank(a) - confRank(b))) {
    const loc = localize(m.usd, m.price_year);
    if (!loc) { reject(m.c, 'historical_localization_unknown'); continue; }
    const p = { c: m.c, usd: m.usd, price_year: m.price_year, strength: 'weak', value: loc.value, basis: 'localized_msrp', localization: loc.regime };
    if (plausible(p)) return sourced(p);
  }
  /* версія продуктивності без ціни своєї лінійки: зворотна оцінка з явною
     причиною, а не ціна звичайних версій */
  if (vPt.performance && !lineMsrps.length) return fallback('performance_version_msrp_not_found');
  return fallback(rejected.length ? 'sourced_price_unsuitable' : null);
}

/* ---------- Сохранність вартості моделі ---------- */

/* Наскільки ця модель і версія зберегла ціну до свого віку, порівняно з
   тією самою базовою кривою, що і зворотна оцінка (retentionFactor).
   Друга наука про знецінення тут не створюється. Пороги практичні, V1,
   без марок. Стан лише описує історію для картки "Чому це авто коштує
   стільки" і НЕ йде ні в Оцінку CalCar, ні у впевненість, ні в MI. */
export const RETENTION_THRESHOLDS = { heavy: 0.80, strong: 1.20 };
export const RETENTION_STATES = ['heavy_depreciation', 'normal_depreciation', 'strong_retention', 'unknown'];
/* методи ціни нового авто, з яких висновок про сохранність був би
   циклічним (зворотна оцінка) або не про цю версію (стартова ціна моделі) */
export const RETENTION_UNKNOWN_BASIS = new Set(['reverse_estimate', 'msrp_base_floor']);
export function retentionBasisMeaningful(basis) { return !!basis && !RETENTION_UNKNOWN_BASIS.has(basis); }

/* representative: середня площадки, коли вона є і в тій самій валюті,
   інакше ціна оголошення. Це наближення поточної ціни МОДЕЛІ, а не цього
   оголошення; якір "сьогодні" графіка лишається своїм (нижча з двох).
   Ціна нового авто, відновлена зворотною оцінкою з тієї самої базової
   кривої, незалежного висновку не дає: стан unknown */
export function retentionContext({ newPrice, basis, representative, representativeSource, T }) {
  const p0 = num(newPrice), pc = num(representative), t = num(T);
  const out = { state: 'unknown', basis: basis || null, representative_current_value: pc !== null ? Math.round(pc) : null, representative_current_value_source: representativeSource || null };
  if (p0 === null || pc === null || t === null || t <= 0 || p0 <= 0 || pc <= 0) return { ...out, reason: 'insufficient_inputs' };
  const observed = pc / p0, expected = retentionFactor(t), index = observed / expected;
  const metrics = { observed_retention: Math.round(observed * 1000) / 1000, expected_retention: Math.round(expected * 1000) / 1000, retention_index: Math.round(index * 1000) / 1000 };
  if (!retentionBasisMeaningful(basis)) return { ...out, ...metrics, reason: basis === 'msrp_base_floor' ? 'new_price_from_base_floor' : 'new_price_from_reverse_estimate' };
  const state = index < RETENTION_THRESHOLDS.heavy ? 'heavy_depreciation' : index > RETENTION_THRESHOLDS.strong ? 'strong_retention' : 'normal_depreciation';
  return { ...out, ...metrics, state };
}

/* ---------- Збірка секції ---------- */

/* Повертає обʼєкт для _meta.value_curve. status 'hidden' означає: графік не
   показуємо (правдоподібної кривої немає), причина у reason. */
export function buildValueCurve({ price = null, currency = null, price_context = null, country = null, year = null, candidates = [], vehicle = {}, identity = {}, nowMs = Date.now() } = {}) {
  const base = { version: VALUE_VERSION, market: { country: country || null, currency: currency || (price_context && price_context.currency) || null }, generated_at: new Date(nowMs).toISOString() };
  const hidden = reason => ({ ...base, status: 'hidden', reason });
  const cur = resolveCurrentPrice({ price, currency, price_context });
  if (!cur) return hidden('no_current_price');
  base.market.currency = cur.currency || base.market.currency;
  if (!base.market.currency) return hidden('no_currency');
  const T = vehicleAgeYears(year, nowMs);
  if (T === null) return hidden('no_vehicle_year');
  const np = resolveNewPrice({ candidates, pc: cur.value, T, market: base.market.country, currency: base.market.currency, vehicle: { ...vehicle, year } });
  const out = {
    ...base,
    age_years: Math.round(T * 100) / 100,
    start_year: parseInt(year, 10),
    current: { value: Math.round(cur.value), source: cur.source, source_name: cur.source_name },
    listing: cur.listing,
    average: cur.average,
    prices: cur.prices || null,
    new_price: {
      value: np.value, approx: np.approx, basis: np.basis,
      /* яким режимом ввезення локалізовано MSRP ринку-джерела */
      ...(np.localization ? { localization: np.localization } : {}),
      /* походження числа одним поглядом: що за джерело, яка ціна і валюта в
         ньому стояли, до якого року віднесено. Для зворотної оцінки source
         це null, а rejection_reason каже, чому знайдені ціни не підійшли */
      source: np.fact ? {
        url: np.fact.source_url, host: np.fact.source_host || null, price: np.fact.amount, currency: np.fact.currency,
        date: np.fact.source_date || null, price_year: np.fact.price_year || null, market: np.fact.market,
      } : null,
      rejection_reason: np.basis !== 'reverse_estimate' ? null : np.reason === 'performance_version_msrp_not_found' ? np.reason : np.rejected.length ? np.rejected[0].reason : null,
      /* MSRP ринку-джерела: точна версія або діапазон модельного року як
         межі правдоподібності зворотної оцінки */
      msrp: np.msrp || null,
      /* факт із джерела у контракті Model Intelligence (область: марка,
         модель, покоління, версія, рік, ринок, валюта, джерело, довіра).
         Зворотна оцінка фактом не є: fact лишається null */
      fact: np.fact ? {
        make: identity.make || null, model: identity.model || null, generation: identity.generation || null,
        trim: identity.trim || null, model_year: np.fact.model_year || np.fact.price_year || parseInt(year, 10) || null,
        market: np.fact.market, currency: np.fact.currency, amount: np.fact.amount, amount_usd: np.fact.amount_usd,
        price_kind: np.fact.price_kind, trim_match: np.fact.trim_match,
        source_url: np.fact.source_url, source_host: np.fact.source_host || null, source_excerpt: np.fact.source_excerpt || null,
        source_date: np.fact.source_date || null,
        confidence: np.fact.confidence || 'medium',
      } : null,
      rejected: np.rejected,
    },
  };
  /* сохранність моделі: середня площадки, інакше ціна оголошення */
  const rep = cur.source === 'marketplace_average' ? { value: cur.value, source: 'marketplace_average' }
    : cur.average ? { value: cur.average.value, source: 'marketplace_average' } : { value: cur.value, source: cur.source };
  out.retention = retentionContext({ newPrice: np.value, basis: np.basis, representative: rep.value, representativeSource: rep.source, T });
  if (np.reason === 'strong_anchor_not_above_market') return { ...out, status: 'hidden', reason: np.reason };
  const c = fitCurve(np.value, cur.value, T);
  if (!c) return { ...out, status: 'hidden', reason: 'curve_not_credible' };
  const points = curvePoints(c, nowMs);
  if (points.length < 3 || points.some(p => !isFinite(p.value) || p.value <= 0)) return { ...out, status: 'hidden', reason: 'curve_not_credible' };
  return {
    ...out, status: 'ok',
    curve: { floor: Math.round(c.F), shape: Math.round(c.b * 1000) / 1000, rate: Math.round(c.k * 100000) / 100000 },
    future: { years: FORECAST_YEARS, value: points[points.length - 1].value },
    points,
  };
}

/* ---------- Кандидати ціни нового авто зі сниппетів ---------- */

/* усі числа тексту як цілі: "45,270", "45 270", "45.270", "1 599 000" */
export function numbersInText(text) {
  const out = [];
  const s = String(text || '').replace(/[\u00a0\u202f\u2009]/g, ' ');
  for (const m of s.matchAll(/\d{1,3}(?:[ ,.]\d{3})+(?!\d)|\d{4,9}/g)) {
    const n = parseInt(m[0].replace(/[ ,.]/g, ''), 10);
    if (n >= 1000) out.push(n);
  }
  return out;
}
export function amountInText(amount, text) {
  const a = num(amount);
  if (a === null || a < 1000) return false;
  return numbersInText(text).some(n => Math.abs(n - a) <= Math.max(1, a * 0.005));
}

/* рік сторінки з дати пошуковика: "12 бер. 2022 р.", "Mar 12, 2022";
   відносна дата ("3 days ago") це поточний рік; без дати null */
export function sourceYear(date, nowYear) {
  const s = String(date || '').trim();
  if (!s) return null;
  const m = /\b(19[89]\d|20[0-4]\d)\b/.exec(s);
  if (m) return parseInt(m[1], 10);
  return /\d/.test(s) ? nowYear : null;
}
export function yearsInText(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/(?<![\d.,])(19[89]\d|20[0-4]\d)(?![\d]|[ .,]\d{3})/g)) {
    const y = parseInt(m[1], 10);
    if (!out.includes(y)) out.push(y);
  }
  return out;
}
/* скільки різних цін того самого порядку (від половини до подвійної) у тексті */
export function pricesNear(amount, text) {
  const seen = new Set();
  for (const n of numbersInText(text)) if (n >= amount * 0.5 && n <= amount * 2 && !(n >= 1980 && n <= 2049)) seen.add(n);
  return seen.size;
}

const CUR = ['USD', 'EUR', 'UAH'];
const MKT = ['UA', 'US', 'EU', 'OTHER'];
const KIND = ['local_list', 'source_msrp'];
const TRIM = ['exact', 'base', 'unknown'];

/* Модель лише вказує, у якому результаті пошуку стоїть ціна. Код перевіряє:
   результат існує, число справді є в його тексті, ринок і валюта зі схеми.
   Довіру ставить код за класом домену, а не модель. */
export function validateCandidates(raw, results, { brand = null, year = null, nowYear = new Date().getUTCFullYear() } = {}) {
  const byRef = new Map((results || []).map(r => [r.ref, r]));
  const out = [], dropped = [];
  for (const c of Array.isArray(raw) ? raw.slice(0, 8) : []) {
    const r = c && byRef.get(String(c.result_ref || ''));
    const amount = num(c && c.amount);
    if (!r) { dropped.push({ reason: 'unknown_result_ref' }); continue; }
    if (amount === null || !CUR.includes(c.currency) || !MKT.includes(c.market) || !KIND.includes(c.price_kind)) { dropped.push({ ref: r.ref, reason: 'bad_shape' }); continue; }
    if (!amountInText(amount, r.title + ' ' + r.snippet)) { dropped.push({ ref: r.ref, reason: 'amount_not_in_source' }); continue; }
    /* ціна національного сайту іншої країни не є MSRP ринку США */
    if (c.market === 'US' && foreignMarketHost(r.url)) { dropped.push({ ref: r.ref, reason: 'source_market_mismatch', host: hostOf(r.url) }); continue; }
    const my = parseInt(c.model_year, 10) || null;
    /* ціна іншого модельного року (далі ніж на 1) цій машині не якір */
    if (my && year && Math.abs(my - parseInt(year, 10)) > 1) { dropped.push({ ref: r.ref, reason: 'other_model_year' }); continue; }
    const cls = classifySource(r.url, brand);
    const text = r.title + ' ' + r.snippet;
    const trim = TRIM.includes(c.trim_match) ? c.trim_match : 'unknown';
    out.push({
      ...(c.extraction === 'deterministic' ? { extraction: 'deterministic' } : {}),
      amount, currency: c.currency, market: c.market, price_kind: c.price_kind,
      trim_match: trim, model_year: my,
      version: c.version ? noDash(c.version).slice(0, 60) : null,
      powertrain: cleanPowertrain(c.powertrain),
      source_url: r.url, source_host: cls.host || hostOf(r.url), source_excerpt: String(r.snippet || r.title || '').slice(0, 240),
      confidence: cls.source_type === 'official' ? 'high' : 'medium',
      /* до якого часу належить ціна: дата сторінки від пошуку і роки в
         тексті джерела. Це факти про джерело, рішення приймає resolveNewPrice */
      source_date: r.date || null, source_year: sourceYear(r.date, nowYear), text_years: yearsInText(text),
      /* кілька цін одного порядку без назви версії: це драбина комплектацій,
         і яка з них стосується цієї машини, з тексту не видно */
      price_ladder: trim !== 'exact' && pricesNear(amount, text) >= 3,
    });
  }
  return { candidates: out, dropped };
}

/* Ринок джерела за доменом країни: сторінка австралійського, британського,
   канадського чи будь-якого іншого національного сайту показує ціну свого
   ринку і у своїй валюті ("Price when new $214,900" на .com.au це австралійські
   долари з місцевими податками). MSRP ринку США з такого джерела не береться.
   Загальні домени (.com, .net, .org) і .us рішення не змінюють */
const FOREIGN_MARKET_TLD = /\.(?:au|uk|ca|nz|ie|za|in|sg|my|hk|jp|kr|cn|tw|ae|sa|qa|kw|il|tr|ru|ua|by|kz|pl|cz|sk|hu|ro|bg|hr|si|rs|de|at|ch|fr|be|nl|lu|it|es|pt|gr|se|no|dk|fi|ee|lv|lt|br|ar|cl|mx|pe)$/i;
export function foreignMarketHost(url) {
  const h = hostOf(String(url || ''));
  return !!h && FOREIGN_MARKET_TLD.test(h);
}

/* Страховка витягу: модель могла не повернути ціну, хоча результат пошуку
   прямо називає ТОЧНУ версію цього авто, її модельний рік і ціну нового.
   Нового виклику немає: читаються ті самі сниппети. Береться лише
   однозначний випадок:
   а) заголовок результату називає версію, а сниппет каже "MSRP ... $N"
      (або "$N MSRP", "base price $N");
   б) у прайс-таблиці ціна стоїть одразу після назви версії.
   Ціна б/у, "average price paid", діапазони і таблиці інших версій сюди
   не потрапляють. Далі кандидат іде тими самими перевірками, що й решта */
const MSRP_WORD = '(?:msrp|m\\.s\\.r\\.p\\.?|base price|starting price|starting msrp|starting at|sticker price|original price|price when new|suggested retail(?: prices?)?|retail price)';
const USD_AMOUNT = '\\$\\s?(\\d{2,3},?\\d{3})(?!\\d|,\\d)';
const MSRP_AFTER_WORD = new RegExp(MSRP_WORD + '[^$\\d]{0,40}' + USD_AMOUNT, 'i');
const MSRP_BEFORE_WORD = new RegExp(USD_AMOUNT + '\\s+(?:' + MSRP_WORD + ')', 'i');
const NOT_NEW_PRICE = /average price paid|price paid|trade-?in|private party|invoice|for sale|used\s+\d{4}|per month|\/mo\b/i;
export function versionTokens(trim, { make = null, model = null } = {}) {
  const skip = new Set([...trimTokens(make), ...trimTokens(model)]);
  return [...new Set(trimTokens(trim).filter(x => !skip.has(x)))];
}
export function deterministicCandidates(results, vehicle = {}) {
  const tokens = versionTokens(vehicle.trim, vehicle);
  /* версія з одних коротких позначок ("S", "4") надто неоднозначна */
  if (!tokens.length || !tokens.some(x => x.length >= 2)) return [];
  const years = [parseInt(vehicle.model_year, 10) || null, parseInt(vehicle.year, 10) || null].filter(Boolean);
  if (!years.length) return [];
  const words = t => new Set(trimTokens(t));
  /* назва версії як вона пишеться в таблицях: "X63 AMG", "X 63 AMG", "X-63 AMG" */
  const pieces = cleanVersion(vehicle.trim).toLowerCase().match(/\p{L}+|\p{N}+/gu) || [];
  const makeModel = new Set([...trimTokens(vehicle.make)]);
  const named = pieces.filter(x => !makeModel.has(x) && !TRIM_NOISE.has(x));
  const inline = named.length ? new RegExp('(?:^|[^\\p{L}\\p{N}])' + named.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]?') + '(?:\\s+4matic|\\s+awd|\\s+4wd)?\\s*[,:;|]?\\s*' + USD_AMOUNT, 'iu') : null;
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    const title = String((r && r.title) || ''), snippet = String((r && r.snippet) || '');
    const text = title + ' ' + snippet;
    const yearHit = years.find(y => yearsInText(text).includes(y));
    if (!yearHit) continue;
    let amount = null;
    const titleWords = words(title);
    if (tokens.every(x => titleWords.has(x)) && !NOT_NEW_PRICE.test(title)) {
      const m = MSRP_AFTER_WORD.exec(snippet) || MSRP_BEFORE_WORD.exec(snippet);
      if (m && !NOT_NEW_PRICE.test(snippet.slice(Math.max(0, m.index - 30), m.index))) amount = parseInt(m[1].replace(/,/g, ''), 10);
    }
    if (amount === null && inline && new RegExp(MSRP_WORD, 'i').test(text)) {
      const m = inline.exec(snippet);
      if (m) amount = parseInt(m[1].replace(/,/g, ''), 10);
    }
    if (amount === null || amount < 8000 || amount > 600000) continue;
    out.push({ result_ref: r.ref, amount, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'exact', model_year: yearHit,
      version: noDash(vehicle.trim).slice(0, 60), powertrain: null, extraction: 'deterministic' });
  }
  return out;
}

/* ---------- Тексти: ліквідність і чинники ціни ---------- */

const LIQ = ['high', 'medium', 'low', 'unknown'];
const FORCE_DIR = ['supports', 'reduces'];
/* "Чому це авто коштує стільки" пояснює економіку залишкової вартості.
   Невеликий перелік дозволених типів чинників не пускає в картку окремі
   болячки моделі: їх місце в ризиках і в довідці про модель */
export const WHY_DRIVERS = ['ownership_cost', 'fuel_cost', 'maintenance_cost', 'repair_cost_risk', 'technical_complexity', 'reliability_reputation', 'brand_strength',
  'buyer_demand', 'buyer_pool_width', 'powertrain_desirability', 'efficiency', 'technology_obsolescence', 'practical_demand', 'long_term_reputation'];
/* вузька технічна несправність у тексті: конкретна деталь або режим відмови */
const NARROW_FAILURE_RE = /утечк|протечк|протека|теч[ьи]\b|течёт|течет|leak|насос|помп[аыуе]|\bpump|клапан|valve|форсунк|injector|цеп[ьи]\s+грм|ланцюг\S*\s+грм|timing chain|задир|прокладк|gasket|сальник|соленоид|solenoid|термостат|thermostat|вкладыш|вкладиш|маслосъ[её]мн|маслознімн|\bегр\b|\begr\b|сажев|dpf\b|интеркулер|інтеркулер|подшипник|підшипник|bearing|витік|витоки|протіка/i;
export function narrowFailure(text) { return NARROW_FAILURE_RE.test(String(text || '')); }
/* довге тире у продукті заборонене: модель могла його поставити */
const noDash = s => String(s || '').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim();
/* кожен рядок картки це самостійна причина: сполучник на початку ("Однако",
   "Но", "Хотя", "However") прибирається, речення починається з великої */
const LEAD_CONNECTOR = /^(?:однако|но|хотя|при\s+этом|тем\s+не\s+менее|впрочем|зато|однак|але|хоча|проте|при\s+цьому|втім|however|but|although|though|yet|nevertheless|still|at\s+the\s+same\s+time)[,\s]+/iu;
export function standalone(text) {
  let s = noDash(text);
  for (let i = 0; i < 2 && LEAD_CONNECTOR.test(s); i++) s = s.replace(LEAD_CONNECTOR, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
const cleanList = (arr, max, maxLen) => {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const s = standalone(x).slice(0, maxLen);
    const key = s.toLowerCase();
    if (s.length < 4 || seen.has(key)) continue;
    seen.add(key); out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

export function sanitizeMarketValue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lq = raw.liquidity && typeof raw.liquidity === 'object' ? raw.liquidity : {};
  const level = LIQ.includes(lq.level) ? lq.level : 'unknown';
  const reasons = cleanList(lq.reasons, 3, 200);
  const reasonKeys = new Set(reasons.map(r => r.toLowerCase()));
  /* дві картки не повторюють одне речення */
  const seen = new Set();
  const forces = [];
  for (const f of Array.isArray(raw.price_forces) ? raw.price_forces : []) {
    if (!f || typeof f !== 'object' || !FORCE_DIR.includes(f.direction)) continue;
    /* чинник поза переліком або про конкретну несправність у картку не йде */
    if (!WHY_DRIVERS.includes(f.driver)) continue;
    const text = standalone(f.text).slice(0, 200);
    const key = text.toLowerCase();
    if (text.length < 4 || seen.has(key) || reasonKeys.has(key) || narrowFailure(text)) continue;
    seen.add(key); forces.push({ direction: f.direction, driver: f.driver, text });
    if (forces.length >= 6) break;
  }
  if (!reasons.length && !forces.length) return null;
  return { liquidity: { level: reasons.length ? level : 'unknown', reasons }, price_forces: forces };
}

/* Картка "Чому це авто коштує стільки": детермінований стан сохранності
   обирає, яку історію розповідати, модель лише дає сили з напрямком.
   Сильна амортизація: насамперед те, що знижує; хороша сохранність: що
   підтримує; звичайна чи невідома: обидві сторони. Не більше чотирьох */
export const WHY_PRICE_MAX = 4;
/* Яку історію розповідає картка. Це не те саме, що retention_state:
   стан каже, наскільки НЕЗВИЧНА амортизація для віку, історія каже, який
   бік пояснювати. Старе авто зі звичайною амортизацією все одно втратило
   більшу частину ціни, і картка пояснює саме втрату.
   Частка: збережена доля ціни нового авто; коли ціна нового відновлена
   зворотною оцінкою, береться очікувана для віку (спостережена була б
   циклічною). Пороги в одному місці */
export const PRICE_STORY_THRESHOLDS = { depreciation_below: 0.65, retention_above: 0.75 };
export function priceStory(retention) {
  const r = retention && typeof retention === 'object' ? retention : {};
  const share = r.state === 'unknown' ? num(r.expected_retention) : num(r.observed_retention);
  if (share === null) return r.state === 'strong_retention' ? 'retention' : 'depreciation';
  if (share < PRICE_STORY_THRESHOLDS.depreciation_below) return 'depreciation';
  if (share > PRICE_STORY_THRESHOLDS.retention_above) return 'retention';
  if (r.state === 'heavy_depreciation') return 'depreciation';
  if (r.state === 'strong_retention') return 'retention';
  return share < (PRICE_STORY_THRESHOLDS.depreciation_below + PRICE_STORY_THRESHOLDS.retention_above) / 2 ? 'depreciation' : 'retention';
}
/* Одна історія, без чергування плюсів і мінусів: лише сили обраного
   напрямку, скільки є (до чотирьох), без добивання протилежними. Якщо сил
   потрібного напрямку немає зовсім, показуємо наявні, а не порожню картку */
export function composeWhyPrice(forces, story) {
  const list = Array.isArray(forces) ? forces : [];
  const want = story === 'retention' ? 'supports' : 'reduces';
  const main = list.filter(f => f.direction === want).map(f => f.text);
  const other = list.filter(f => f.direction !== want).map(f => f.text);
  return (main.length ? main : other).slice(0, WHY_PRICE_MAX);
}
/* Підпис для людини: "Втрата вартості: низька / середня / висока". Це той
   самий стан сохранності іншими словами; для ненадійної ціни нового
   (зворотна оцінка, нижня межа) рівня немає */
export const VALUE_LOSS_BY_STATE = { strong_retention: 'low', normal_depreciation: 'medium', heavy_depreciation: 'high' };
export function composeMarketValue(mv, retention) {
  if (!mv || typeof mv !== 'object') return null;
  const state = retention && RETENTION_STATES.includes(retention.state) ? retention.state : 'unknown';
  const story = priceStory(retention);
  const reasons = composeWhyPrice(mv.price_forces, story);
  return { liquidity: mv.liquidity, why_price: { retention_state: state, value_loss: VALUE_LOSS_BY_STATE[state] || null, price_story: story, reasons } };
}

/* ---------- Виклик моделі ---------- */

const S = (type, extra = {}) => ({ type, ...extra });
const OBJ = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export function valueResponseFormat() {
  return { type: 'json_schema', json_schema: { name: 'calcar_value_section', strict: true, schema: OBJ({
    liquidity: OBJ({ level: S('string', { enum: LIQ }), reasons: S('array', { items: S('string') }) }),
    price_forces: S('array', { items: OBJ({ direction: S('string', { enum: FORCE_DIR }), driver: S('string', { enum: WHY_DRIVERS }), text: S('string') }) }),
    new_price_candidates: S('array', { items: OBJ({
      result_ref: S('string'), amount: S('number'), currency: S('string', { enum: CUR }), market: S('string', { enum: MKT }),
      price_kind: S('string', { enum: KIND }), trim_match: S('string', { enum: TRIM }), model_year: S(['integer', 'null']),
      version: S(['string', 'null']),
      powertrain: OBJ({
        fuel: { type: ['string', 'null'], enum: ['petrol', 'diesel', 'hybrid', 'electric', null] },
        displacement_l: S(['number', 'null']), cylinders: S(['integer', 'null']), power_hp: S(['integer', 'null']),
        drive: { type: ['string', 'null'], enum: ['awd', 'rwd', 'fwd', null] }, performance: S('boolean'),
      }),
    }) }),
  }) } };
}

export const VALUE_RULES = `You write the market context block of a used-car report. Output JSON only, by the schema.

Three outputs.

1. liquidity: how easy it normally is to sell THIS MODEL AND VERSION on the LOCAL used-car market (named in MARKET) at a reasonable market price. This is the breadth of the buyer pool that remains AFTER ownership barriers are taken into account; it is marketability of the model and version, not of this particular listing.
   level: high, medium, low, or unknown.
   Calibrate the level by barriers first. Strong barriers: very high fuel consumption, expensive servicing, expensive engine, gearbox or suspension repairs as the car ages, old complex luxury systems, performance-version running costs, a buyer pool limited by budget and risk tolerance. A famous brand, a practical body or all-wheel drive do NOT offset several strong barriers: an aging luxury or performance model that is expensive to own is normally "low" unless MODEL_CONTEXT gives grounded evidence of unusually broad demand. "high" is for mainstream models with a broad audience and low perceived ownership risk. "medium" is for real mixed cases, not a default.
   reasons: 2 or 3 sentences. Every sentence is an INDEPENDENT reason that reads on its own and explains why reselling this kind of car is easier or harder. Never start a reason with a connector (however, but, although, yet, at the same time, nevertheless; однако, но, хотя, при этом, тем не менее; однак, але, хоча, проте, при цьому) and never write a reason as a continuation of the previous one. One sentence states one reason and its effect on resale; do not put "X, but Y" into one sentence.
   Never use: this listing's price, any discount or the marketplace average, the seller, or this car's condition, mileage, accident, flood or history. None of that is in the input and none of it changes the liquidity of the model.
   No numeric ratings and no invented statistics (days to sell, shares, counts). If the input is not enough to judge, use level "unknown" with one neutral reason.

2. price_forces: 4 to 6 forces that explain how well THIS MODEL AND VERSION keeps its original value as it ages (why a car like this is worth a large or a small share of its new price at its age).
   This is market ECONOMICS of residual value, not a list of the model's weak points.
   Each item: direction "supports" (helps it keep value) or "reduces" (makes it lose value faster); driver: the type of the economic driver, one of ownership_cost, fuel_cost, maintenance_cost, repair_cost_risk, technical_complexity, reliability_reputation, brand_strength, buyer_demand, buyer_pool_width, powertrain_desirability, efficiency, technology_obsolescence, practical_demand, long_term_reputation; text: one short sentence that names the factor AND its effect on retained value, for example "High running costs of premium technology cut demand as the car ages." A bare attribute ("All-wheel drive", "Premium positioning", "Practical body") is not acceptable.
   A narrow technical weak point is NOT a force: a specific leak, pump, valve, injector, chain, gasket or any other named failure mode never appears here, even when MODEL_CONTEXT describes it; those belong to the risks section of the report. A technical system may appear only at the economic level. Wrong: "Aging air suspension struts can fail." Right: "Air suspension that is expensive to keep up with age raises expected ownership costs and lowers residual value."
   Give at least three forces that reduce value and at least two that support it when the context allows it; each force is one independent sentence with no leading connector. A force that fits none of the driver types is not written. Do not pad: fewer grounded forces are better than a filler.
   Never mention this listing's price, any discount, the marketplace average, the seller, or this car's condition, mileage, accident, flood or history.
   Do not repeat a liquidity sentence: the same underlying factor may appear in both, but liquidity explains ease of resale and price_forces explains retained value.

3. new_price_candidates: prices of this model when NEW found in SEARCH_RESULTS.
   Take a price only if the number is literally written in that result's title or snippet. result_ref is the result id (S1, S2...). amount is the number as written, without conversion.
   price_kind "local_list": an official or dealer list price of a new car in Ukraine. price_kind "source_msrp": manufacturer list price in another market (US MSRP and so on). market: UA, US, EU or OTHER.
   EXACT VERSION FIRST: when VEHICLE names a version (trim), look first for the price of exactly that version and model year. If any result states it (in a price table row, as "MSRP of $N", "base price $N", "starting at $N" next to that version), return it with trim_match "exact" and the version as written. In a road-test result take the base price, never the "as tested" price with options. A price of a tuner conversion (Brabus, Mansory and similar) is not the factory price of the version: return it only with that tuner name in version.
   When a result lists prices of several versions of the same model year, return EVERY version price as a separate entry; version is the version name exactly as written next to that price (null when there is none).
   powertrain: the powertrain of THAT version as stated in the result or as documented for that exact version and model year (fuel, engine displacement in litres, cylinders, power in hp, drive); null for anything you are not sure about. performance: true for high-performance lines (AMG, M, RS, SVR, Turbo S and similar), otherwise false. This describes the version only and never changes the price.
   trim_match "exact" only when the result clearly names the same version as VEHICLE; "base" for a starting or base price ("from", "starting at"); otherwise "unknown".
   model_year: the model year the price refers to, or null. Skip used-car prices, prices of other generations, monthly payments and price ranges without a concrete number. No suitable price: empty array. Never supply a price from memory.

Never use the em dash character.`;

export function valueUserMessage({ langDirective, vehicle, market, results, modelContext }) {
  const lines = [];
  if (langDirective) lines.push(langDirective + ' This applies to liquidity.reasons and price_factors.');
  lines.push('VEHICLE: ' + JSON.stringify(vehicle));
  lines.push('MARKET: ' + JSON.stringify(market));
  lines.push('MODEL_CONTEXT (CalCar knowledge base and sourced web findings about this model; may be empty):\n' + (modelContext || 'empty'));
  lines.push('SEARCH_RESULTS (web search snippets about the new-car price):\n' + (results.length
    ? results.map(r => r.ref + '. [' + r.host + (r.date ? ', ' + r.date : '') + '] ' + r.title + ' | ' + r.snippet).join('\n')
    : 'none'));
  return lines.join('\n\n');
}

const logLine = (op, extra) => console.log('[value]', JSON.stringify({ op, ...extra }));

/* вік, з якого локальний прайс нових авто вже не знаходиться: дилери
   тримають ціни лише поточних моделей */
export const LOCAL_PRICE_MAX_AGE_YEARS = 4;
export function priceQueries(identity, nowYear = new Date().getUTCFullYear()) {
  const label = [identity.make, identity.model].filter(Boolean).join(' ');
  if (!label || !identity.year) return [];
  /* версія без потужності в дужках, службових дефісів декодера ("X450-4M")
     і позначок коробки: у запиті лишається сама назва версії */
  const inLabel = new Set(String(identity.make || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const version = cleanVersion(identity.trim).replace(/[-_/]+/g, ' ').split(/\s+/).filter(x => x && !/^(?:at|mt|amt|cvt|dct|dsg|4m|base)$/i.test(x) && !inLabel.has(x.toLowerCase())).join(' ');
  const trim = version ? ' ' + version : '';
  const my = identity.model_year || identity.year;
  const msrp = my + ' ' + label + trim + ' MSRP price new';
  /* Запитів завжди два. Для старшого авто з відомою версією запит про
     прайс дилера в Україні повертає лише оголошення б/у, тому його місце
     займає другий запит про ту саму точну версію іншими словами: огляди
     нового авто називають базову ціну саме версії */
  if (version && nowYear - parseInt(identity.year, 10) >= LOCAL_PRICE_MAX_AGE_YEARS) return [my + ' ' + label + trim + ' base price as tested review', msrp];
  return [label + ' ' + identity.year + ' ціна нового в Україні офіційний дилер', msrp];
}

/* Пошук стартує одразу (паралельно з рештою Check), виклик моделі
   запускає analyze() у момент старту основного аналізу і йде паралельно з
   ним. Будь-який збій лишає секцію з детермінованою кривою на зворотній
   оцінці: Check не ламається ніколи. */
export function startValueResearch(input = {}, deps = {}) {
  const identity = input.identity || {};
  const state = { status: 'idle', reason: null, search: null, ai: null, ms: 0, candidates: 0, dropped: [] };
  const search = deps.searchSerper || searchSerper;
  const enabled = valueSectionEnabled(deps.env);
  const t0 = Date.now();
  /* ціна нового авто шукається лише для ринку, де знайдене число можна
     чесно привести до графіка: Україна, USD */
  const wantPrice = enabled && input.market === 'UA' && input.currency === 'USD';
  const queries = wantPrice ? priceQueries(identity) : [];
  const searchPromise = (queries.length
    ? Promise.all(queries.map(q => search(q, { timeoutMs: 6000, signal: deps.signal })))
    : Promise.resolve([])
  ).then(rs => {
    const results = [];
    const seen = new Set();
    for (const r of rs) for (const it of (r && r.items) || []) {
      const url = String((it && it.link) || '');
      if (!/^https?:\/\//.test(url) || seen.has(url) || results.length >= 14) continue;
      seen.add(url);
      results.push({ ref: 'S' + (results.length + 1), url, host: hostOf(url), title: String(it.title || '').slice(0, 160), snippet: String(it.snippet || '').slice(0, 320), date: it.date ? String(it.date).slice(0, 40) : null });
    }
    /* запити і стислі результати лишаються в діагностиці: без них не видно,
       чому з видачі не витягнуто жодної ціни */
    state.search = { queries: queries.length, ok: rs.filter(r => r && r.ok).length, results: results.length, ms: Date.now() - t0, reasons: rs.filter(r => r && !r.ok).map(r => r.reason),
      query_text: queries, items: results.map(r => ({ ref: r.ref, host: r.host, date: r.date, title: r.title.slice(0, 90), snippet: r.snippet.slice(0, 200) })) };
    return results;
  }).catch(e => { state.search = { queries: queries.length, ok: 0, results: 0, error: String((e && e.message) || e).slice(0, 120) }; return []; });

  let analysis = null;
  function analyze(ctx = {}) {
    if (analysis) return analysis;
    if (!enabled) { state.status = 'skipped'; state.reason = 'disabled'; analysis = Promise.resolve(null); return analysis; }
    if (!identity.make || !identity.model) { state.status = 'skipped'; state.reason = 'identity_too_weak'; analysis = Promise.resolve(null); return analysis; }
    const tA = Date.now();
    state.status = 'running';
    analysis = (async () => {
      const results = await searchPromise;
      const body = {
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', max_completion_tokens: 3000, reasoning_effort: 'low',
        response_format: valueResponseFormat(),
        messages: [
          { role: 'system', content: VALUE_RULES },
          { role: 'user', content: valueUserMessage({ langDirective: ctx.langDirective, vehicle: ctx.vehicle || identity, market: ctx.market || { country: input.market || null, currency: input.currency || null }, results, modelContext: ctx.modelContext || null }) },
        ],
      };
      const data = await deps.callModel(body, deps.timeoutMs || 60000, deps.signal);
      if (!data || data.error) throw new Error((data && data.error && data.error.message) || 'empty_response');
      const parsed = JSON.parse(String(data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim());
      /* ціна точної версії, яку модель пропустила: з тих самих сниппетів */
      const fromModel = Array.isArray(parsed.new_price_candidates) ? parsed.new_price_candidates : [];
      const recovered = deterministicCandidates(results, { ...identity, ...(ctx.vehicle || {}), trim: (ctx.vehicle && ctx.vehicle.trim) || identity.trim, model_year: identity.model_year || null })
        .filter(d => !fromModel.some(c => c && String(c.result_ref) === d.result_ref && Math.round(c.amount) === d.amount));
      const v = validateCandidates([...recovered, ...fromModel], results, { brand: identity.make, year: identity.year });
      state.status = 'ok'; state.candidates = v.candidates.length; state.dropped = v.dropped;
      state.recovered = v.candidates.filter(c => c.extraction === 'deterministic').length;
      state.ai = { usage: data.usage || null, model: data.model || body.model, reasoning_effort: body.reasoning_effort };
      state.ms = Date.now() - tA;
      return { market_value: sanitizeMarketValue(parsed), candidates: v.candidates };
    })().catch(e => {
      state.status = 'error'; state.reason = e && e.name === 'AbortError' ? 'timeout' : 'error'; state.ms = Date.now() - tA;
      logLine('analyze', { status: 'error', reason: state.reason, error: String((e && e.message) || e).slice(0, 160), make: identity.make || null, model: identity.model || null });
      return null;
    });
    return analysis;
  }
  return { state, searchPromise, analyze };
}
