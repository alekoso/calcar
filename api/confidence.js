/* CalCar Check Coverage (Confidence) v1: наскільки повно CalCar вивчив
   САМЕ ЦЕЙ автомобіль. Це НЕ ймовірність правильності Score, НЕ друга оцінка
   авто і НЕ ризик. Score v4 цей модуль не читає і не змінює.

   Чотири домени з базовими вагами (історія 35, поточні фото 30, пробіг 20,
   ідентичність 15). Кожен вхід має стан (verified, checked_absent,
   searched_no_result, unavailable, blocked, not_applicable) і бали;
   not_applicable виключається зі знаменника входу, домен з усіма входами
   not_applicable виключається з загального знаменника, решта ваг
   перенормовується. Три жорсткі обмеження: <6 фото -> не вище 69, історію
   фактично не вдалося перевірити -> не вище 69, VIN відсутній або надійно
   інший -> не вище 39.

   Рахується ОДИН раз у момент Check і зберігається знімком у звіті; UI
   читає знімок і нічого не перераховує. Старі звіти зберігають своє
   історичне значення. Модуль чистий: без мережі і без моделі. */

export const CONFIDENCE_CONFIG_V1 = {
  CONFIG_TAG: 'coverage-v1-2026-09-25',
  DOMAIN_WEIGHTS: { history: 35, photos: 30, mileage: 20, identity: 15 },
  HISTORY: { auction: 8, historical_photos: 7, registry: 7, previous_listings: 5, span: 8, search_no_result_share: 0.5 },
  PHOTOS: { count: 10, count_target: 12, zones: 14, zones_target: 6, interior: 4, interior_min_zones: 2, dashboard: 2 },
  MILEAGE: { age: 3, odometer: 5, points: 7, points_scale: [0, 2, 5, 7], dashboard: 3, families: 2, families_min: 2 },
  IDENTITY: { vin: 6, vin_undecoded: 4, consistency: 4, consistency_partial: 2, config: 3, config_partial: 1.5, listing: 2 },
  CAPS: { few_photos: { below: 6, max: 69 }, history_blocked: { max: 69 }, vin: { max: 39 } },
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

  /* аукціон / VIN-історія: web discovery (Serper, агрегатори). Порожня
     видача це searched_no_result (частково), а не доведена відсутність */
  let auctionState = 'unavailable';
  if (c.auctionRecordExists === true || (as && as.status === 'found') || hf.ria_auction_record === true) auctionState = 'verified';
  else if (as && as.status === 'absent') auctionState = 'searched_no_result';
  else if (as && as.status === 'unknown') auctionState = 'blocked';

  /* реєстр: структурований держблок площадки, існує лише для AUTO.RIA (UA) */
  const registryApplicable = listing.country === 'UA';
  let registryState = 'not_applicable';
  if (registryApplicable) {
    if (hf.registry_present === true) registryState = 'verified';
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
      odometer_known: typeof listing.odometer_km === 'number' && listing.odometer_km > 0,
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

function historyDomain(h, cfg) {
  const H = cfg.HISTORY;
  const out = [];
  const a = h.auction;
  out.push(inp('auction_history', a,
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
  /* охоплення історії: від найранішого надійного датованого запису до дня
     Check проти віку авто */
  const now = Date.parse(h.now || '') || Date.now();
  const earliest = (h.dated_records || []).map(d => dayOf(d.date)).filter(t => t !== null && t <= now).sort((x, y) => x - y)[0];
  const ageDays = h.age_months !== null && h.age_months !== undefined ? h.age_months * 30.44 : null;
  if (earliest === undefined || !ageDays) out.push(inp('history_span', 'unavailable', 0, H.span, { ratio: 0 }));
  else {
    const ratio = clamp01(((now - earliest) / DAY) / ageDays);
    out.push(inp('history_span', 'verified', H.span * ratio, H.span, { ratio: Math.round(ratio * 100) / 100, earliest: new Date(earliest).toISOString().slice(0, 10) }));
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
function mileageDomain(m, cfg) {
  const M = cfg.MILEAGE;
  const pts = M.points_scale[Math.min(m.historical_points, M.points_scale.length - 1)];
  return [
    inp('vehicle_age', m.age_known ? 'verified' : 'unavailable', m.age_known ? M.age : 0, M.age),
    inp('current_odometer', m.odometer_known ? 'verified' : 'unavailable', m.odometer_known ? M.odometer : 0, M.odometer),
    inp('historical_points', m.historical_points > 0 ? 'verified' : 'unavailable', pts, M.points, { count: m.historical_points }),
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
  const domainInputs = {
    history: historyDomain({ ...(x.history || {}), now: x.now }, cfg),
    photos: photosDomain(x.photos || {}, cfg),
    mileage: mileageDomain(x.mileage || {}, cfg),
    identity: identityDomain(x.identity || {}, cfg),
  };
  const domains = {};
  let weighted = 0, weights = 0;
  for (const [name, list] of Object.entries(domainInputs)) {
    const applicable = list.filter(i => i.state !== 'not_applicable');
    const max = applicable.reduce((s, i) => s + i.max, 0);
    const earned = applicable.reduce((s, i) => s + i.earned, 0);
    if (!applicable.length || max <= 0) {
      domains[name] = { status: 'not_applicable', score_internal: null, earned: 0, applicable_max: 0, weight: cfg.DOMAIN_WEIGHTS[name], inputs: list };
      continue;
    }
    const score = round1(earned / max * 100);
    domains[name] = { status: score >= 100 ? 'complete' : score > 0 ? 'partial' : 'empty', score_internal: score, earned: round1(earned), applicable_max: max, weight: cfg.DOMAIN_WEIGHTS[name], inputs: list };
    weighted += score * cfg.DOMAIN_WEIGHTS[name];
    weights += cfg.DOMAIN_WEIGHTS[name];
  }
  const base = {
    confidence_version: 'v1',
    config_tag: cfg.CONFIG_TAG,
    computed_at: x.now || null,
    sufficient_tick: cfg.SUFFICIENT_TICK,
    domains,
  };
  if (weights <= 0) return { ...base, overall_internal: null, overall_raw: null, text_key: null, caps_applied: [], unavailable_reason: 'no_applicable_domains' };
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
  /* VIN відсутній або надійно інший. Невдалий декод vPIC при валідному VIN
     цей кап НЕ вмикає */
  if (!id.vin_present || id.vin_mismatch) cap(id.vin_mismatch ? 'vin_mismatch' : 'vin_absent', cfg.CAPS.vin.max);
  const finalV = Math.round(overall);
  return { ...base, overall_internal: finalV, overall_raw: raw, text_key: textKeyFor(finalV, cfg), caps_applied: caps, unavailable_reason: null };
}
