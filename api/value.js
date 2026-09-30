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
  const fromListing = { value: listing, source: 'listing_price', source_name: null, currency: cur, listing: null, average: null };
  if (avg === null || !sameCurrency) return listing !== null ? fromListing : null;
  const fromAverage = { value: avg, source: 'marketplace_average', source_name: name, currency: pc.currency || cur, listing: null, average: null };
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
export function resolveNewPrice({ candidates = [], pc, T, market = null, currency = null, vehicle = {} } = {}) {
  const reverse = reverseNewPrice(pc, T);
  const rejected = [];
  const fallback = reason => ({
    value: reverse !== null ? Math.round(reverse) : null, approx: true, basis: 'reverse_estimate', strength: null, fact: null, rejected,
    ...(reason ? { reason } : {}),
  });
  if (reverse === null) return fallback('no_current_price');
  /* сторонні ціни приводяться до USD; графік в іншій валюті їх не бере */
  if (currency !== 'USD' || market !== 'UA') return fallback(candidates.length ? 'sourced_price_needs_ua_usd_market' : null);

  const prepared = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const usd = toUsd(c.amount, c.currency, c.model_year || vehicle.year);
    if (usd === null) { rejected.push({ ref: c.source_url || null, reason: 'currency_not_convertible' }); continue; }
    if (c.price_kind === 'local_list' && c.market === 'UA') {
      prepared.push({ rank: 0, value: usd, basis: 'local_list', strength: c.trim_match === 'exact' ? 'strong' : 'weak', c });
    } else if (c.price_kind === 'source_msrp' && c.market === 'US') {
      /* режим ввезення року, коли авто було новим */
      const loc = localizeUsMsrpToUA(usd, { ...vehicle, year: c.model_year || vehicle.year });
      if (loc !== null) prepared.push({ rank: 1, value: loc.value, basis: 'localized_msrp', strength: 'weak', c, localization: loc.regime });
      else rejected.push({ ref: c.source_url || null, reason: 'historical_localization_unknown' });
    } else {
      rejected.push({ ref: c.source_url || null, reason: 'market_not_supported' });
    }
  }
  const strengthRank = p => (p.strength === 'strong' ? 0 : 1);
  const trimRank = p => (p.c.trim_match === 'exact' ? 0 : p.c.trim_match === 'unknown' ? 1 : 2);
  const confRank = p => (p.c.confidence === 'high' ? 0 : 1);
  prepared.sort((a, b) => (a.rank - b.rank) || (strengthRank(a) - strengthRank(b)) || (trimRank(a) - trimRank(b)) || (confRank(a) - confRank(b)));

  for (const p of prepared) {
    const fact = { ...p.c, amount_usd: Math.round(toUsd(p.c.amount, p.c.currency, p.c.model_year || vehicle.year)) };
    if (p.strength === 'strong') {
      /* точна локальна ціна нижча за ринок: джерело не підробляємо і криву
         не вигадуємо, графік ховається */
      if (p.value <= pc) return { value: Math.round(p.value), approx: false, basis: p.basis, strength: 'strong', fact, rejected, reason: 'strong_anchor_not_above_market' };
      return { value: Math.round(p.value), approx: false, basis: p.basis, strength: 'strong', fact, rejected };
    }
    if (p.value < pc * minNewToCurrentRatio(T)) { rejected.push({ ref: p.c.source_url || null, reason: 'incompatible_with_current_value', value: Math.round(p.value) }); continue; }
    if (p.value > reverse * MAX_OVER_REVERSE) { rejected.push({ ref: p.c.source_url || null, reason: 'implausibly_high', value: Math.round(p.value) }); continue; }
    return { value: Math.round(p.value), approx: true, basis: p.basis, strength: 'weak', fact, rejected, ...(p.localization ? { localization: p.localization } : {}) };
  }
  return fallback(rejected.length ? 'sourced_price_unsuitable' : null);
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
    new_price: {
      value: np.value, approx: np.approx, basis: np.basis,
      /* яким режимом ввезення локалізовано MSRP ринку-джерела */
      ...(np.localization ? { localization: np.localization } : {}),
      /* факт із джерела у контракті Model Intelligence (область: марка,
         модель, покоління, версія, рік, ринок, валюта, джерело, довіра).
         Зворотна оцінка фактом не є: fact лишається null */
      fact: np.fact ? {
        make: identity.make || null, model: identity.model || null, generation: identity.generation || null,
        trim: identity.trim || null, model_year: np.fact.model_year || parseInt(year, 10) || null,
        market: np.fact.market, currency: np.fact.currency, amount: np.fact.amount, amount_usd: np.fact.amount_usd,
        price_kind: np.fact.price_kind, trim_match: np.fact.trim_match,
        source_url: np.fact.source_url, source_host: np.fact.source_host || null, source_excerpt: np.fact.source_excerpt || null,
        confidence: np.fact.confidence || 'medium',
      } : null,
      rejected: np.rejected,
    },
  };
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

const CUR = ['USD', 'EUR', 'UAH'];
const MKT = ['UA', 'US', 'EU', 'OTHER'];
const KIND = ['local_list', 'source_msrp'];
const TRIM = ['exact', 'base', 'unknown'];

/* Модель лише вказує, у якому результаті пошуку стоїть ціна. Код перевіряє:
   результат існує, число справді є в його тексті, ринок і валюта зі схеми.
   Довіру ставить код за класом домену, а не модель. */
export function validateCandidates(raw, results, { brand = null, year = null } = {}) {
  const byRef = new Map((results || []).map(r => [r.ref, r]));
  const out = [], dropped = [];
  for (const c of Array.isArray(raw) ? raw.slice(0, 8) : []) {
    const r = c && byRef.get(String(c.result_ref || ''));
    const amount = num(c && c.amount);
    if (!r) { dropped.push({ reason: 'unknown_result_ref' }); continue; }
    if (amount === null || !CUR.includes(c.currency) || !MKT.includes(c.market) || !KIND.includes(c.price_kind)) { dropped.push({ ref: r.ref, reason: 'bad_shape' }); continue; }
    if (!amountInText(amount, r.title + ' ' + r.snippet)) { dropped.push({ ref: r.ref, reason: 'amount_not_in_source' }); continue; }
    const my = parseInt(c.model_year, 10) || null;
    /* ціна іншого модельного року (далі ніж на 1) цій машині не якір */
    if (my && year && Math.abs(my - parseInt(year, 10)) > 1) { dropped.push({ ref: r.ref, reason: 'other_model_year' }); continue; }
    const cls = classifySource(r.url, brand);
    out.push({
      amount, currency: c.currency, market: c.market, price_kind: c.price_kind,
      trim_match: TRIM.includes(c.trim_match) ? c.trim_match : 'unknown', model_year: my,
      source_url: r.url, source_host: cls.host || hostOf(r.url), source_excerpt: String(r.snippet || r.title || '').slice(0, 240),
      confidence: cls.source_type === 'official' ? 'high' : 'medium',
    });
  }
  return { candidates: out, dropped };
}

/* ---------- Тексти: ліквідність і чинники ціни ---------- */

const LIQ = ['high', 'medium', 'low', 'unknown'];
/* довге тире у продукті заборонене: модель могла його поставити */
const noDash = s => String(s || '').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim();
const cleanList = (arr, max, maxLen) => {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const s = noDash(x).slice(0, maxLen);
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
  const factors = cleanList(raw.price_factors, 5, 120).filter(f => !reasonKeys.has(f.toLowerCase()));
  if (!reasons.length && !factors.length) return null;
  return { liquidity: { level: reasons.length ? level : 'unknown', reasons }, price_factors: factors };
}

/* ---------- Виклик моделі ---------- */

const S = (type, extra = {}) => ({ type, ...extra });
const OBJ = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export function valueResponseFormat() {
  return { type: 'json_schema', json_schema: { name: 'calcar_value_section', strict: true, schema: OBJ({
    liquidity: OBJ({ level: S('string', { enum: LIQ }), reasons: S('array', { items: S('string') }) }),
    price_factors: S('array', { items: S('string') }),
    new_price_candidates: S('array', { items: OBJ({
      result_ref: S('string'), amount: S('number'), currency: S('string', { enum: CUR }), market: S('string', { enum: MKT }),
      price_kind: S('string', { enum: KIND }), trim_match: S('string', { enum: TRIM }), model_year: S(['integer', 'null']),
    }) }),
  }) } };
}

export const VALUE_RULES = `You write the market context block of a used-car report. Output JSON only, by the schema.

Three outputs.

1. liquidity: how easy this model and version is to resell on the LOCAL market named in VEHICLE.
   level: high, medium, low, or unknown. reasons: 2 or 3 short sentences.
   Base it on what the input gives: segment and body style, powertrain type, age, price class, ownership-cost class, breadth of buyer audience, the price position against the marketplace average when given, and MODEL_CONTEXT.
   No numeric ratings and no invented statistics (days to sell, shares, counts). If the input is not enough to judge, use level "unknown" with one neutral reason.

2. price_factors: 3 to 5 short noun-phrase factors explaining why the market values this MODEL and VERSION roughly at this level (model economics, not defects of this particular car).
   Reliability, failure and repair claims about specific units (engine, gearbox, suspension, electronics, battery) are allowed ONLY when MODEL_CONTEXT supports them. Without that support stay with structural facts that follow from the identity itself: segment, body practicality, powertrain type and its running costs, age of a premium car, buyer audience breadth, demand class.
   Do not repeat a liquidity reason. Do not mention this car's condition, accident history, mileage or seller.

3. new_price_candidates: prices of this model when NEW found in SEARCH_RESULTS.
   Take a price only if the number is literally written in that result's title or snippet. result_ref is the result id (S1, S2...). amount is the number as written, without conversion.
   price_kind "local_list": an official or dealer list price of a new car in Ukraine. price_kind "source_msrp": manufacturer list price in another market (US MSRP and so on). market: UA, US, EU or OTHER.
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
    ? results.map(r => r.ref + '. [' + r.host + '] ' + r.title + ' | ' + r.snippet).join('\n')
    : 'none'));
  return lines.join('\n\n');
}

const logLine = (op, extra) => console.log('[value]', JSON.stringify({ op, ...extra }));

export function priceQueries(identity) {
  const label = [identity.make, identity.model].filter(Boolean).join(' ');
  if (!label || !identity.year) return [];
  const trim = identity.trim ? ' ' + identity.trim : '';
  return [
    label + ' ' + identity.year + ' ціна нового в Україні офіційний дилер',
    identity.year + ' ' + label + trim + ' MSRP price new',
  ];
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
      results.push({ ref: 'S' + (results.length + 1), url, host: hostOf(url), title: String(it.title || '').slice(0, 160), snippet: String(it.snippet || '').slice(0, 320) });
    }
    state.search = { queries: queries.length, ok: rs.filter(r => r && r.ok).length, results: results.length, ms: Date.now() - t0, reasons: rs.filter(r => r && !r.ok).map(r => r.reason) };
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
      const v = validateCandidates(parsed.new_price_candidates, results, { brand: identity.make, year: identity.year });
      state.status = 'ok'; state.candidates = v.candidates.length; state.dropped = v.dropped;
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
