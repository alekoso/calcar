/* CalCar Check Coverage (Confidence) v1: наскільки повно CalCar вивчив
   САМЕ ЦЕЙ автомобіль. Це НЕ ймовірність правильності Score, НЕ друга оцінка
   авто і НЕ ризик. Score v4 цей модуль не читає і не змінює.

   Чотири домени з базовими вагами (історія 35, поточні фото 30, пробіг 20,
   ідентичність 15). Кожен вхід має стан (verified, checked_absent,
   searched_no_result, unavailable, blocked, not_applicable) і бали;
   not_applicable виключається зі знаменника входу, домен з усіма входами
   not_applicable виключається з загального знаменника, решта ваг
   перенормовується. Жорсткі обмеження: <6 фото -> не вище 69, історію
   фактично не вдалося перевірити -> не вище 69, слабка історія (домен
   нижче 50) -> стеля 35 + 0.6 * бал історії, VIN відсутній або надійно
   інший -> не вище 39.

   v2 (coverage-v2): очікування доказів залежить від життєвого циклу авто,
   а не лише від того, що вдалося знайти. Експозиція E рахується плавно з
   віку і абсолютного пробігу (без сходинок, без кількості знайдених
   подій чи власників, щоб не було кола "знайшли більше, вимагаємо
   більше"). Молоде авто з одним показом одометра має повне покриття
   пробігу; 12-річне авто лише з сьогоднішнім одометром ні. Охоплення
   історії (span) теж звіряється з очікуванням за віком. Ідентичність і
   поточні фото від віку не залежать. Сам вік і пробіг ніколи не
   віднімають: вони лише задають, скільки доказів треба.

   Рахується ОДИН раз у момент Check і зберігається знімком у звіті; UI
   читає знімок і нічого не перераховує. Старі звіти зберігають своє
   історичне значення. Модуль чистий: без мережі і без моделі. */

export const CONFIDENCE_CONFIG_V1 = {
  CONFIG_TAG: 'coverage-v2-2026-10-08',
  VERSION: 'v2',
  /* експозиція життєвого циклу: e_age = 1 - exp(-роки / age_tau_years),
     e_km = 1 - exp(-км / km_tau), E = 1 - (1 - e_age)(1 - e_km).
     expected_points = points_expected_max * E^points_curve_exp: скільки
     датованих точок пробігу з минулого потрібно для повного кредиту
     (степінь > 1 тримає очікування малим у перші місяці і роки);
     span_floor: нижня межа очікуваного охоплення історії, щоб дуже
     молоде авто не отримувало повний кредит за один випадковий запис */
  LIFECYCLE: { age_tau_years: 6, km_tau: 120000, points_expected_max: 4, points_curve_exp: 1.5, span_floor: 0.1 },
  /* score_basis: проєкція тієї самої Confidence для композиції Score (не
     друга модель): ті самі домени і капи, але входи, чию невизначеність
     уже володіє інший шар Score, з рахунку прибрано незалежно від стану.
     historical_photos це доказ про тяжкість ДТП, а нею володіють категорія
     v4 і стеля ущерба: ні брак кадрів, ні їх наявність не мають вдруге
     рухати межу доказів. У показаному користувачу overall_internal цей
     вхід лишається */
  SCORE_BASIS_EXCLUDE: ['historical_photos'],
  DOMAIN_WEIGHTS: { history: 35, photos: 30, mileage: 20, identity: 15 },
  HISTORY: { auction: 8, historical_photos: 7, registry: 7, previous_listings: 5, span: 8, search_no_result_share: 0.5,
    /* охоплення: записи молодші за recent_days це поточний продаж, не історія;
       запис у кожні density_years_per_record роки життя авто дає повну щільність */
    recent_days: 120, density_years_per_record: 2 },
  PHOTOS: { count: 10, count_target: 12, zones: 14, zones_target: 6, interior: 4, interior_min_zones: 2, dashboard: 2 },
  MILEAGE: { age: 3, odometer: 5, points: 7, points_scale: [0, 2, 5, 7], dashboard: 3, families: 2, families_min: 2 },
  IDENTITY: { vin: 6, vin_undecoded: 4, consistency: 4, consistency_partial: 2, config: 3, config_partial: 1.5, listing: 2 },
  CAPS: { few_photos: { below: 6, max: 69 }, history_blocked: { max: 69 }, vin: { max: 39 },
    /* історія це критичний вхід: неповний домен історії (нижче below) не
       перекривається добрими фото, ідентифікацією і пробігом. Стеля росте
       разом з історією: base + slope * бал історії. Звідси: історія нижче
       ~58 лишає звіт під рискою "достатньо", нижче ~83 під "вивчено
       детально" */
    weak_history: { below: 85, base: 35, slope: 0.6 } },
  TEXT_RANGES: [[85, 'Studied in detail'], [70, 'Enough data'], [40, 'Partially checked'], [0, 'Data is limited']],
  SUFFICIENT_TICK: 70,
};

const EXTERIOR_ZONES = ['front', 'rear', 'left_front', 'left_side', 'left_rear', 'right_front', 'right_side', 'right_rear', 'roof', 'wheels', 'engine_bay', 'underbody'];
const INTERIOR_ZONES = ['driver_area', 'front_passenger', 'front_seats', 'rear_seats', 'dashboard', 'center_console', 'doors', 'trunk'];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DAY = 86400000;
const round1 = x => Math.round((x + Number.EPSILON) * 10) / 10;
const clamp01 = x => Math.max(0, Math.min(1, x));
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

/* ---------- експозиція життєвого циклу (плавна, детермінована) ---------- */
export function lifecycleExposure({ age_months, odometer_km } = {}, cfg = CONFIDENCE_CONFIG_V1) {
  const L = cfg.LIFECYCLE;
  const years = num(age_months) !== null ? Math.max(0, age_months) / 12 : null;
  const km = num(odometer_km) !== null ? Math.max(0, odometer_km) : null;
  const eAge = years === null ? null : 1 - Math.exp(-years / L.age_tau_years);
  const eKm = km === null ? null : 1 - Math.exp(-km / L.km_tau);
  /* невідомий вік чи пробіг: експозиція за тим, що відомо; нічого не відомо: середня (0.5), не нуль і не максимум */
  const exposure = eAge === null && eKm === null ? 0.5 : eAge === null ? eKm : eKm === null ? eAge : 1 - (1 - eAge) * (1 - eKm);
  const r = x => (x === null ? null : Math.round(x * 1000) / 1000);
  return { exposure: r(exposure), e_age: r(eAge), e_km: r(eKm), age_months: num(age_months), odometer_km: num(odometer_km), expected_points: Math.round(L.points_expected_max * Math.pow(exposure, L.points_curve_exp) * 100) / 100 };
}
const dayOf = v => { const t = Date.parse(v || ''); return isFinite(t) ? t : null; };
const latin = s => /^[a-z0-9 .\-]+$/.test(s);
const normMake = s => String(s || '').toLowerCase().replace(/[^a-z0-9а-яіїєґё ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function isValidVin(v) { return VIN_RE.test(String(v || '').toUpperCase()); }

/* ---------- збирач входу: один для продакшн-Check і офлайн-прогону ----------
   ctx: { now, listing{vin,country,make,odometer_km,listing_equipment},
          hf (history_facts), nhtsa, auctionSearch, auctionRecordExists,
          hvPresent, snaps, snapsLookup ('ok'|'failed'|'no_vin'), cv
          (current_visual), cvStatus, v4 (breakdown Score v4), ageMonths,
          photosCount, disclosuresCount } */
export function buildConfidenceInput(ctx = {}) {
  const c = ctx;
  const listing = c.listing || {};
  const hf = c.hf || {};
  const nhtsa = c.nhtsa || null;
  const as = c.auctionSearch || null;
  const v4 = c.v4 || {};
  const vin = String(listing.vin || '').toUpperCase() || null;
  const now = dayOf(c.now) || Date.now();

  /* застосовність аукціонного джерела: лише коли є відомий іноземний період
     експлуатації чи аукціонний шлях (структуровані докази: позначка площадки
     про імпорт, реєстрація як ввезеного вживаним, архів аукціону, знайдений
     лот). Регіон VIN, країна виробника чи новий ТЗ, ввезений дилером,
     застосовності не створюють: для локального авто відсутність аукціонної
     історії не прогалина */
  const foreign = !!(hf.foreign_lifecycle && hf.foreign_lifecycle.known) || hf.us_import_record === true || hf.ria_auction_record === true || hf.imported_used === true;
  const auctionApplicable = c.auctionRecordExists === true || (as && as.status === 'found') || foreign;
  /* аукціон / VIN-історія: web discovery (Serper, агрегатори). Порожня
     видача це searched_no_result (частково), а не доведена відсутність */
  let auctionState = auctionApplicable ? 'unavailable' : 'not_applicable';
  if (c.auctionRecordExists === true || (as && as.status === 'found') || hf.ria_auction_record === true) auctionState = 'verified';
  else if (auctionApplicable && as && as.status === 'absent') auctionState = 'searched_no_result';
  else if (auctionApplicable && as && as.status === 'unknown') auctionState = 'blocked';

  /* реєстр: структурований держблок площадки, існує лише для AUTO.RIA (UA) */
  const registryApplicable = listing.country === 'UA';
  let registryState = 'not_applicable';
  if (registryApplicable) {
    /* структуровані записи реєстру про власників це теж відповідь реєстру */
    if (hf.registry_present === true || (Array.isArray(hf.owner_events) && hf.owner_events.length > 0)) registryState = 'verified';
    else if (hf.registry_answered_empty === true) registryState = 'checked_absent';
    else registryState = 'unavailable';
  }

  /* попередні оголошення: внутрішній Vehicle Memory + історія площадки */
  let prevState;
  const prevFound = (Array.isArray(c.snaps) && c.snaps.length > 0) || (num(hf.past_listings) || 0) > 0;
  if (prevFound) prevState = 'verified';
  else if (!vin) prevState = 'unavailable';
  else if (c.snapsLookup === 'failed') prevState = 'blocked';
  else prevState = 'checked_absent';

  /* надійні датовані записи для охоплення історії: реєстр, записи
     площадки, дата продажу лота, архів CalCar. Текст продавця і дати з
     хронології моделі сюди не потрапляють */
  const dated = [];
  for (const e of Array.isArray(hf.owner_events) ? hf.owner_events : []) if (e && e.date) dated.push({ date: e.date, source: 'registry_owner' });
  for (const p of Array.isArray(hf.mileage_points) ? hf.mileage_points : []) if (p && p.date) dated.push({ date: p.date, source: p.source || 'platform' });
  if (as && as.status === 'found' && as.sale_date) dated.push({ date: as.sale_date, source: 'auction' });
  for (const s of Array.isArray(c.snaps) ? c.snaps : []) if (s && s.created_at) dated.push({ date: String(s.created_at).slice(0, 10), source: 'vehicle_memory' });

  const cv = c.cvStatus === 'ok' && c.cv ? c.cv : null;
  const zones = cv && cv.zones ? cv.zones : {};
  const suff = z => zones[z] && zones[z].visibility === 'sufficient';
  const dash = cv && cv.dashboard ? cv.dashboard : null;
  const odo = dash && dash.odometer_reading ? dash.odometer_reading : null;

  /* історичні точки пробігу: нормалізовані точки Score v4 до дня Check */
  const todayIso = new Date(now).toISOString().slice(0, 10);
  const mpts = Array.isArray(v4.mileage_points) ? v4.mileage_points : [];
  const historical = new Set(mpts.filter(p => p && p.date && p.date < todayIso).map(p => p.date));
  const families = new Set(mpts.flatMap(p => (Array.isArray(p.families) ? p.families : [p.family]).filter(Boolean)));

  const decoded = !!(nhtsa && nhtsa.Make && (nhtsa.Model || nhtsa.ModelYear));
  const nm = normMake(nhtsa && nhtsa.Make), lm = normMake(listing.make);
  let makeConsistency = 'insufficient';
  if (decoded && nm && lm && latin(nm) && latin(lm)) makeConsistency = (nm.startsWith(lm) || lm.startsWith(nm) || nm.split(' ')[0] === lm.split(' ')[0]) ? 'consistent' : 'conflict';
  const configStructured = !!(nhtsa && (nhtsa.FuelTypePrimary || nhtsa.DisplacementL || nhtsa.EngineHP || nhtsa.ElectrificationLevel || nhtsa.DriveType || nhtsa.TransmissionStyle));
  const configPartial = decoded || hf.registry_present === true || (Array.isArray(listing.listing_equipment) && listing.listing_equipment.length > 0);

  return {
    now: new Date(now).toISOString(),
    history: {
      auction: auctionState,
      auction_applicable: auctionApplicable,
      foreign_lifecycle: foreign,
      event_found: auctionState === 'verified',
      hv_analyzed: c.hvPresent === true,
      registry: registryState,
      previous_listings: prevState,
      dated_records: dated,
      age_months: num(c.ageMonths),
    },
    photos: {
      count: num(c.photosCount) || 0,
      cv_ok: !!cv,
      exterior_sufficient: EXTERIOR_ZONES.filter(suff).length,
      interior_sufficient: INTERIOR_ZONES.filter(suff).length,
      dashboard_visible: !!(dash && dash.visible === true) || suff('dashboard'),
    },
    mileage: {
      age_known: num(c.ageMonths) !== null,
      age_months: num(c.ageMonths),
      odometer_known: typeof listing.odometer_km === 'number' && listing.odometer_km > 0,
      odometer_km: typeof listing.odometer_km === 'number' && listing.odometer_km > 0 ? listing.odometer_km : null,
      historical_points: historical.size,
      dashboard_read: !!(odo && num(odo.value) > 0),
      families: families.size,
    },
    identity: {
      vin_present: !!vin,
      vin_valid: isValidVin(vin),
      vin_mismatch: !!(v4.vin_check && v4.vin_check.mismatch),
      corroborated: decoded || hf.registry_present === true,
      make_consistency: makeConsistency,
      config: configStructured ? 'structured' : (configPartial ? 'partial' : 'none'),
      substantive_listing: typeof listing.odometer_km === 'number' && listing.odometer_km > 0
        && ((Array.isArray(listing.listing_equipment) && listing.listing_equipment.length > 0) || (num(c.disclosuresCount) || 0) > 0),
    },
  };
}

/* ---------- формула ---------- */
const inp = (key, state, earned, max, detail) => ({ key, state, earned: round1(earned), max, ...(detail ? { detail } : {}) });

function historyDomain(h, cfg, life) {
  const H = cfg.HISTORY;
  const out = [];
  const a = h.auction;
  if (a === 'not_applicable') out.push(inp('auction_history', 'not_applicable', 0, 0));
  else out.push(inp('auction_history', a,
    a === 'verified' || a === 'checked_absent' ? H.auction : a === 'searched_no_result' ? H.auction * H.search_no_result_share : 0, H.auction));
  /* архівні кадри мають сенс лише коли подія знайдена; чисту машину без
     аукціонних фото не штрафуємо */
  if (!h.event_found) out.push(inp('historical_photos', 'not_applicable', 0, 0));
  else out.push(inp('historical_photos', h.hv_analyzed ? 'verified' : 'unavailable', h.hv_analyzed ? H.historical_photos : 0, H.historical_photos));
  const r = h.registry;
  out.push(r === 'not_applicable' ? inp('registry', r, 0, 0)
    : inp('registry', r, r === 'verified' || r === 'checked_absent' ? H.registry : 0, H.registry));
  const p = h.previous_listings;
  out.push(inp('previous_listings', p, p === 'verified' || p === 'checked_absent' ? H.previous_listings : 0, H.previous_listings));
  /* охоплення історії: яку частину життя авто покривають надійні датовані
     записи. Проміжок від найранішого запису до дня Check проти віку авто
     (span), помножений на щільність: у скількох різних роках життя є
     ІСТОРИЧНИЙ запис. Одна давня точка пробігу не означає, що історія
     відома; записи останніх місяців це поточний продаж, а не історія */
  const now = Date.parse(h.now || '') || Date.now();
  const times = (h.dated_records || []).map(d => dayOf(d.date)).filter(t => t !== null && t <= now).sort((x, y) => x - y);
  const earliest = times[0];
  const ageDays = h.age_months !== null && h.age_months !== undefined ? h.age_months * 30.44 : null;
  if (earliest === undefined || !ageDays) out.push(inp('history_span', 'unavailable', 0, H.span, { ratio: 0 }));
  else {
    const span = clamp01(((now - earliest) / DAY) / ageDays);
    const years = new Set(times.filter(t => now - t > H.recent_days * DAY).map(t => new Date(t).getUTCFullYear()));
    const density = clamp01(years.size / Math.max(1, (ageDays / 365.25) / H.density_years_per_record));
    const ratio = span * density;
    /* очікуване охоплення росте з віком (e_age): молоде авто з коротким
       рядом записів покриває все, що від нього можна чекати; старе авто
       мусить показати записи через усе життя */
    const expected = Math.max(cfg.LIFECYCLE.span_floor, life && life.e_age !== null ? life.e_age : 1);
    const credit = clamp01(ratio / expected);
    out.push(inp('history_span', 'verified', H.span * credit, H.span, { ratio: Math.round(ratio * 100) / 100, span: Math.round(span * 100) / 100, years_with_records: years.size, earliest: new Date(earliest).toISOString().slice(0, 10), expected: Math.round(expected * 100) / 100, credit: Math.round(credit * 100) / 100 }));
  }
  return out;
}
function photosDomain(p, cfg) {
  const P = cfg.PHOTOS;
  return [
    inp('usable_photos', p.count > 0 ? 'verified' : 'unavailable', P.count * clamp01(p.count / P.count_target), P.count, { count: p.count }),
    inp('visual_zones', p.cv_ok ? 'verified' : 'unavailable', p.cv_ok ? P.zones * clamp01(p.exterior_sufficient / P.zones_target) : 0, P.zones, { sufficient: p.exterior_sufficient }),
    inp('interior', p.cv_ok && p.interior_sufficient >= P.interior_min_zones ? 'verified' : 'unavailable', p.cv_ok && p.interior_sufficient >= P.interior_min_zones ? P.interior : 0, P.interior),
    inp('dashboard', p.cv_ok && p.dashboard_visible ? 'verified' : 'unavailable', p.cv_ok && p.dashboard_visible ? P.dashboard : 0, P.dashboard),
  ];
}
function mileageDomain(m, cfg, life) {
  const M = cfg.MILEAGE;
  /* датовані точки з минулого проти очікування за життєвим циклом:
     кредит = 1 - нестача / max(1, очікування). Молоде авто (очікування
     < 1 точки) без точок отримує майже повний кредит; зріле авто мусить
     показати стільки точок, скільки задає експозиція. Неперервно і за
     віком/пробігом, і за кількістю точки */
  const count = Math.max(0, num(m.historical_points) || 0);
  const expected = life ? life.expected_points : cfg.LIFECYCLE.points_expected_max;
  /* кредит = 1 - нестача / повне очікування (points_expected_max): у молодого
     авто нестача мала в абсолюті, тож і втрата мала; у зрілого нестача
     майже повна. Ділення на саме очікування робило б 3-річне авто без точок
     такою ж чорною скринькою, як 20-річне */
  const shortfall = Math.max(0, expected - count);
  const credit = clamp01(1 - shortfall / cfg.LIFECYCLE.points_expected_max);
  return [
    inp('vehicle_age', m.age_known ? 'verified' : 'unavailable', m.age_known ? M.age : 0, M.age),
    inp('current_odometer', m.odometer_known ? 'verified' : 'unavailable', m.odometer_known ? M.odometer : 0, M.odometer),
    inp('historical_points', count > 0 ? 'verified' : (credit >= 0.999 ? 'not_expected' : 'unavailable'), M.points * credit, M.points, { count, expected, credit: Math.round(credit * 100) / 100 }),
    inp('dashboard_odometer', m.dashboard_read ? 'verified' : 'unavailable', m.dashboard_read ? M.dashboard : 0, M.dashboard),
    inp('source_families', m.families >= M.families_min ? 'verified' : 'unavailable', m.families >= M.families_min ? M.families : 0, M.families, { count: m.families }),
  ];
}
function identityDomain(i, cfg) {
  const I = cfg.IDENTITY;
  let vinPts = 0, vinState = 'unavailable';
  if (i.vin_mismatch) vinState = 'blocked';
  else if (i.vin_valid && i.corroborated) { vinPts = I.vin; vinState = 'verified'; }
  else if (i.vin_valid) { vinPts = I.vin_undecoded; vinState = 'verified'; }
  else if (i.vin_present && i.corroborated) { vinPts = I.vin_undecoded; vinState = 'verified'; }
  const cons = i.make_consistency === 'consistent' ? I.consistency : i.make_consistency === 'conflict' ? 0 : I.consistency_partial;
  const conf = i.config === 'structured' ? I.config : i.config === 'partial' ? I.config_partial : 0;
  return [
    inp('vin_identity', vinState, vinPts, I.vin),
    inp('make_model_consistency', i.make_consistency === 'conflict' ? 'blocked' : 'verified', cons, I.consistency, { state: i.make_consistency }),
    inp('configuration', i.config === 'none' ? 'unavailable' : 'verified', conf, I.config, { state: i.config }),
    inp('listing_data', i.substantive_listing ? 'verified' : 'unavailable', i.substantive_listing ? I.listing : 0, I.listing),
  ];
}

export function textKeyFor(v, cfg = CONFIDENCE_CONFIG_V1) {
  for (const [min, key] of cfg.TEXT_RANGES) if (v >= min) return key;
  return cfg.TEXT_RANGES[cfg.TEXT_RANGES.length - 1][1];
}

export function computeConfidenceV1(input, cfg = CONFIDENCE_CONFIG_V1) {
  const x = input && typeof input === 'object' ? input : {};
  const mi = x.mileage || {};
  const life = lifecycleExposure({ age_months: mi.age_months !== undefined ? mi.age_months : (x.history && x.history.age_months), odometer_km: mi.odometer_km }, cfg);
  life.foreign_lifecycle_known = !!(x.history && x.history.foreign_lifecycle);
  life.auction_applicable = !!(x.history && x.history.auction_applicable);
  const domainInputs = {
    history: historyDomain({ ...(x.history || {}), now: x.now }, cfg, life),
    photos: photosDomain(x.photos || {}, cfg),
    mileage: mileageDomain(mi, cfg, life),
    identity: identityDomain(x.identity || {}, cfg),
  };
  /* бал домену зі списку входів; exclude: входи, які для цього погляду
     рахуються як not_applicable */
  const domainScore = (list, exclude) => {
    const applicable = list.filter(i => i.state !== 'not_applicable' && !(exclude && exclude.has(i.key)));
    const max = applicable.reduce((s, i) => s + i.max, 0);
    const earned = applicable.reduce((s, i) => s + i.earned, 0);
    if (!applicable.length || max <= 0) return { score: null, earned: 0, max: 0 };
    return { score: round1(earned / max * 100), earned: round1(earned), max };
  };
  const domains = {};
  for (const [name, list] of Object.entries(domainInputs)) {
    const d = domainScore(list, null);
    if (d.score === null) { domains[name] = { status: 'not_applicable', score_internal: null, earned: 0, applicable_max: 0, weight: cfg.DOMAIN_WEIGHTS[name], inputs: list }; continue; }
    domains[name] = { status: d.score >= 100 ? 'complete' : d.score > 0 ? 'partial' : 'empty', score_internal: d.score, earned: d.earned, applicable_max: d.max, weight: cfg.DOMAIN_WEIGHTS[name], inputs: list };
  }
  const base = {
    confidence_version: cfg.VERSION,
    config_tag: cfg.CONFIG_TAG,
    computed_at: x.now || null,
    sufficient_tick: cfg.SUFFICIENT_TICK,
    lifecycle: life,
    domains,
  };
  /* зважений підсумок і капи: один і той самий рахунок для показаного
     overall_internal і для основи стелі доказів (з виключеними входами) */
  const compose = scores => {
    let weighted = 0, weights = 0;
    for (const [name, sc] of Object.entries(scores)) {
      if (sc === null) continue;
      weighted += sc * cfg.DOMAIN_WEIGHTS[name];
      weights += cfg.DOMAIN_WEIGHTS[name];
    }
    if (weights <= 0) return null;
    const raw = round1(weighted / weights);
    let overall = raw;
    const caps = [];
    const cap = (name, max) => { caps.push({ name, max, binding: overall > max }); if (overall > max) overall = max; };
    const ph = x.photos || {}, hi = domainInputs.history, id = x.identity || {};
    if ((ph.count || 0) < cfg.CAPS.few_photos.below) cap('few_usable_photos', cfg.CAPS.few_photos.max);
    /* історію фактично не вдалося перевірити: пошук заблокований і жоден
       структурований історичний запит (реєстр) не відповів. Порожня web-видача
       при успішному пошуку цей кап НЕ вмикає */
    const auctionIn = hi.find(i => i.key === 'auction_history');
    const registryIn = hi.find(i => i.key === 'registry');
    if (auctionIn && (auctionIn.state === 'blocked' || auctionIn.state === 'unavailable')
      && !(registryIn && (registryIn.state === 'verified' || registryIn.state === 'checked_absent'))) cap('history_checks_blocked', cfg.CAPS.history_blocked.max);
    /* неповна історія: стеля залежить від балу історії і від життєвого
       циклу: у молодого авто брак глибини природний, тому кап зсувається до
       100 на частку (1 - e_age)^2 (8 міс. ~80% послаблення, 3 роки ~37%,
       5 років ~19%, 9 років ~5%); у зрілого авто діє майже повністю.
       Невідомий вік = експозиція 0.5 */
    const hs = scores.history;
    if (typeof hs === 'number' && hs < cfg.CAPS.weak_history.below) {
      const full = cfg.CAPS.weak_history.base + cfg.CAPS.weak_history.slope * hs;
      const e = life.e_age !== null ? life.e_age : life.exposure;
      const strict = 1 - (1 - e) * (1 - e);
      cap('weak_history', Math.round(100 - (100 - full) * strict));
    }
    /* VIN відсутній або надійно інший. Невдалий декод vPIC при валідному VIN
       цей кап НЕ вмикає */
    if (!id.vin_present || id.vin_mismatch) cap(id.vin_mismatch ? 'vin_mismatch' : 'vin_absent', cfg.CAPS.vin.max);
    return { raw, overall: Math.round(overall), caps };
  };
  const shown = compose(Object.fromEntries(Object.entries(domains).map(([n, d]) => [n, d.score_internal])));
  if (!shown) return { ...base, overall_internal: null, overall_raw: null, text_key: null, caps_applied: [], score_basis: null, unavailable_reason: 'no_applicable_domains' };
  const exclude = new Set(cfg.SCORE_BASIS_EXCLUDE || []);
  const excluded = Object.values(domainInputs).flat().filter(i => exclude.has(i.key) && i.state !== 'not_applicable').map(i => i.key);
  const basis = excluded.length ? compose(Object.fromEntries(Object.entries(domainInputs).map(([n, list]) => [n, domainScore(list, exclude).score]))) : shown;
  return { ...base, overall_internal: shown.overall, overall_raw: shown.raw, text_key: textKeyFor(shown.overall, cfg), caps_applied: shown.caps,
    /* проєкція для композиції Score: той самий рахунок, виключені входи названі явно */
    score_basis: { role: 'score_composition', overall: basis ? basis.overall : shown.overall, excluded },
    unavailable_reason: null };
}

/* Confidence measures how well the evidence covers the car; identity
   measures whether we know which car it is. The number stays, the label
   may not read as unconditional "studied in detail" while the canonical
   identity says the configuration is not established (core conflict) or
   the version is disputed. i18n keys, rendered after the coverage label */
export function identityNoteKey(identity) {
  if (!identity || typeof identity !== 'object') return null;
  if (identity.core_status === 'unresolved') return 'but the vehicle configuration is not established';
  if (identity.version_status === 'conflict') return 'but the version is not confirmed';
  return null;
}
