/* CalCar Score v4: лише штрафи від бази 10, без капів, без стель, без
   бонусів. Шість входів, затверджених власником (score-v4-spec.md rev 2,
   docs/audits/score-v4-implementation-design-2026-09-24.md rev 2):

   1. аварійна історія (останнє змістовне ДТП своєю категорією, всі ранні
      разом 1.0, флуд і пожежа окремими подіями);
   2. кузов за поточними кадрами (Current Vision, лише надійні види);
   3. салон за поточними кадрами;
   4. інтенсивність пробігу (річний пробіг / норма класу силової установки);
   5. відкат пробігу (поріг 30 000 км, датовані точки, стійкість);
   6. несправності, розкриті продавцем (дослівна цитата, категорія, вузол).

   Окремо: eligibility gate (число не показується, коли substantive
   evidence майже нема, але показується за сильного негативу),
   анти-дабл-каунтинг (один поточний дефект = один штраф; історія і
   підтверджений поточний дефект співіснують), незмінний config_tag.

   Резолвер подій, sanitize знахідок і класи зон беруться з v3 без змін.
   Модуль чистий: жодної мережі, жодних звернень до моделі. */
import { resolveAccidentEvents, sanitizeFindingsV3, zoneClasses } from './score-v3.js';

export const SCORE_CONFIG_V4 = {
  CONFIG_TAG: 'v4-shadow-2026-09-24-age2',
  STARTING_SCORE: 10,
  ACCIDENT: { light: 0.4, medium: 1.2, heavy: 2.5, total: 5.0, unknown: 1.5, unrepaired_seller: 2.5, earlier_events: 1.0, flood: 2.5, fire: 3.0 },
  BODY: { dent: 0.5, corrosion: 0.6, headlight: 0.4, windshield: 0.3, broken_element: 0.3, missing_part: 0.3, wheel: 0.15, wheel_max: 0.3 },
  INTERIOR: { seat_damage: 0.4, driver_seat_wear: 0.25, steering_wheel_wear: 0.2 },
  MILEAGE_NORM_KM_YEAR: { petrol: 12000, diesel: 18000, hev: 12000, phev: 15000, bev: 16000, unknown: 14000 },
  INTENSITY_CURVE: [[1.2, 0], [1.5, 0.3], [2.0, 0.8], [3.0, 1.4], [5.0, 2.2], [8.0, 3.0], [12.0, 4.0]],
  MIN_AGE_MONTHS: 12,
  /* вік: до року 0, далі 0.1 + (роки - 1) * 0.05 від точного age_months,
     без капа (лінійні 0.1 за рік у тіні домінували над реальними знахідками) */
  AGE: { first_year: 0.1, per_extra_year: 0.05 },
  ROLLBACK: { threshold_km: 30000, tiers: [[60000, 1.0], [120000, 2.0], [Infinity, 3.0]], platform_flag: 0.8, same_day_ms: 36 * 3600 * 1000, dedupe_km: 1000 },
  SELLER: {
    vehicle_not_running_or_unit_replacement: 5.0, major_powertrain_symptom: 3.0, generic_powertrain_warning: 1.0,
    localized_powertrain_issue: 1.5, chassis_brakes_steering: 1.0, body_work_needed: 0.8, electrics_comfort: 0.5,
    consumables: 0, srs_not_restored: 2.0, srs_warning_generic: 1.0,
  },
  ELIGIBILITY: { photos_min: 6, seller_text_chars: 150, rich_photos: 12, rich_zones: 6, strong_item_min: 0.4, mileage_points_min: 2 },
};

export const SELLER_CATEGORIES = ['vehicle_not_running_or_unit_replacement', 'major_powertrain_symptom', 'generic_powertrain_warning',
  'localized_powertrain_issue', 'chassis_brakes_steering', 'body_work_needed', 'electrics_comfort', 'consumables',
  'srs_not_restored', 'srs_warning_generic', 'accident_unrepaired', 'engine_swap_installed', 'flood_or_fire'];
export const SELLER_UNITS = ['engine', 'transmission', 'drivetrain', 'chassis', 'body', 'electrics', 'srs', 'consumables', 'vehicle'];
export const SELLER_ZONES = ['front', 'rear', 'left', 'right', 'roof', 'glass', 'interior'];
export const CV_COMPONENTS_EXTERIOR = ['panel', 'bumper', 'headlight', 'taillight', 'windshield', 'glass_other', 'mirror', 'grille', 'trim', 'wheel', 'tire', 'underbody_part', 'other'];
export const CV_COMPONENTS_INTERIOR = ['seat', 'steering_wheel', 'door_card', 'dashboard', 'headliner', 'pedal', 'other'];
export const CV_COMPONENTS = [...new Set([...CV_COMPONENTS_EXTERIOR, ...CV_COMPONENTS_INTERIOR])];
export const WHEEL_POSITIONS = ['front_left', 'front_right', 'rear_left', 'rear_right'];

const round1 = x => Math.round((x + Number.EPSILON) * 10) / 10;
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const yearOf = s => { const m = /20\d\d|19\d\d/.exec(String(s || '')); return m ? parseInt(m[0], 10) : null; };

/* ---------- клас силової установки: спільний для шапки звіту і Score ----------
   Пріоритет: NHTSA ElectrificationLevel -> NHTSA FuelTypePrimary ->
   fuel основного виклику. Гібрид без рівня електрифікації = unknown */
export function resolvePowertrainClass({ nhtsa = null, fuel = null } = {}) {
  const el = String((nhtsa && nhtsa.ElectrificationLevel) || '').toLowerCase();
  if (el) {
    if (/bev|battery electric/.test(el)) return 'bev';
    if (/phev|plug/.test(el)) return 'phev';
    if (/hev|hybrid/.test(el)) return 'hev';
  }
  const ft = String((nhtsa && nhtsa.FuelTypePrimary) || '').toLowerCase();
  if (/gasoline|petrol|flex|ethanol/.test(ft)) return 'petrol';
  if (/diesel/.test(ft)) return 'diesel';
  if (/electric/.test(ft)) return 'bev';
  const f = String(fuel || '').toLowerCase();
  if (f === 'petrol' || f === 'gasoline') return 'petrol';
  if (f === 'diesel') return 'diesel';
  if (f === 'electric' || f === 'bev') return 'bev';
  if (f === 'phev') return 'phev';
  if (f === 'hev') return 'hev';
  return 'unknown';
}
export function mileageNormKmYear(cls, cfg = SCORE_CONFIG_V4) {
  return cfg.MILEAGE_NORM_KM_YEAR[cls] || cfg.MILEAGE_NORM_KM_YEAR.unknown;
}

/* ---------- 1. аварійна історія ---------- */
const CATEGORY_AMOUNT = (cfg, category) => cfg.ACCIDENT[category];
const CATEGORY_RANK = { unknown: 1, light: 2, medium: 3, unrepaired_seller: 4, heavy: 5, total: 6 };


/* категорія ОДНОЇ нормалізованої події з сигналів резолвера і канонічного
   HV (лише для якірної події). Перше співпадіння зверху. Тотал ніколи не
   виводиться з пожежі: лише з обʼєктивних ознак T1-T4 */
export function classifyEventV4(ev, hv, zoneClassesOfEvent, lotZoneClasses) {
  const s = ev.signals || {};
  const h = hv && typeof hv === 'object' ? hv : null;
  const basis = [];
  const ci = !!s.cabin_intrusion || !!(h && h.cabin_intrusion_visible === true);
  const lb = !!s.load_bearing || !!(h && h.load_bearing_structure_deformation_visible === true);
  const st = !!s.structural;
  const inner = (h && h.inner_component_damage_extent) || s.inner_extent || 'none';
  const depth = (h && h.damage_depth) || s.damage_depth || 'indeterminate';
  const outer = (h && h.outer_panel_damage_extent) || 'indeterminate';
  const fascia = (h && h.fascia_status) || 'not_visible';
  const ab = !!s.airbags || !!(h && h.srs_visual_status === 'deployed_visible');
  const wd = !!s.wheel_displacement || !!(h && h.wheel_displacement_visible === true);
  const cosmetic = !!s.cosmetic_only || !!(h && h.cosmetic_only === true);
  const dis = !!(h && h.vehicle_disassembled_visible === true);
  const members = (h && Array.isArray(h.load_bearing_members)) ? h.load_bearing_members : [];
  const zc = zoneClassesOfEvent || new Set();
  /* T4 (несуміжні зони): лише зони metadata лота (FRONT END + REAR END,
     LEFT SIDE + RIGHT SIDE). Вільний текст зон HV для бокового удару
     перелічує і передній, і задній бампер, а damage_side = both стоїть у
     звичайного фронтального удару з двома крилами: обидва джерела давали
     хибний тотал на реальних VIN, тому не використовуються */
  const lz = lotZoneClasses || new Set();
  const nonadj = (lz.has('front') && lz.has('rear')) || (lz.has('left') && lz.has('right'));
  const deep = depth === 'inner_structure_or_module' || depth === 'load_bearing_structure' || depth === 'cabin_intrusion';
  const pick = (category, why) => { basis.push(why); return { category, basis }; };
  if (ci) return pick('total', 'cabin_intrusion');
  if (dis) return pick('total', 'vehicle_disassembled');
  if (lb && members.includes('pillar')) return pick('total', 'pillar_deformation');
  if (nonadj && depth !== 'exterior_panels_only' && depth !== 'indeterminate') return pick('total', 'non_adjacent_zones_deep');
  if (st) return pick('heavy', 'structural_damage');
  if (lb) return pick('heavy', 'load_bearing_deformation');
  if (inner === 'substantial') return pick('heavy', 'inner_module_substantial');
  if (wd && deep) return pick('heavy', 'wheel_displacement_deep');
  if (ab) return pick('medium', 'airbags_deployed');
  if (outer === 'multiple_panels') return pick('medium', 'multiple_panels');
  if (inner === 'localized') return pick('medium', 'inner_module_localized');
  if (depth === 'inner_structure_or_module' && inner === 'indeterminate') return pick('medium', 'inner_module_indeterminate');
  if (zc.size >= 2) return pick('medium', 'multiple_zones');
  if (wd) return pick('medium', 'wheel_displacement');
  if (depth === 'exterior_panels_only' && outer === 'single_panel') return pick('light', 'single_exterior_panel');
  if (cosmetic) return pick('light', 'cosmetic_only');
  if (outer === 'single_panel' && depth === 'indeterminate' && (fascia === 'intact_mounted' || fascia === 'damaged_but_mounted')) return pick('light', 'single_panel_fascia_mounted');
  return pick('unknown', 'severity_not_established');
}

/* чи показує HV хоч якесь пошкодження: лот без видимих пошкоджень і без
   відмітки ДТП подією не є (D2) */
export function hvShowsDamage(h) {
  if (!h || typeof h !== 'object') return false;
  return (Array.isArray(h.visible_damage_zones) && h.visible_damage_zones.length > 0)
    || (h.outer_panel_damage_extent && h.outer_panel_damage_extent !== 'none' && h.outer_panel_damage_extent !== 'indeterminate')
    || h.srs_visual_status === 'deployed_visible' || h.cosmetic_only === true
    || h.load_bearing_structure_deformation_visible === true || h.cabin_intrusion_visible === true
    || h.wheel_displacement_visible === true || h.structural_visual_status === 'visible_damage'
    || (h.damage_depth && h.damage_depth !== 'indeterminate');
}

const FLOOD_RE = /flood|water|затоп|утоп|вода|потоп/i;
const FIRE_RE = /\bburn|\bfire\b|пожеж|пожар|горел|горіл|згор|сгор/i;

function accidentInput(inp, cfg) {
  const items = [], unresolved = [], events = [];
  const findings = inp.findings;
  const hv = inp.historicalVisual || null;
  const am = inp.auctionMeta || null;
  const rec = inp.accidentRecord || null;
  const disclosures = inp.disclosures || [];
  const rawEvents = resolveAccidentEvents(findings, { auctionMeta: am, historicalVisual: hv, accidentRecord: rec });

  /* флуд і пожежа: окремі події, по одному разу, з будь-якого джерела */
  const lotDamage = [am && am.primary_damage, am && am.secondary_damage].filter(Boolean).join(' ');
  const floodSources = [], fireSources = [];
  for (const f of findings) {
    if (f.type === 'FLOOD') floodSources.push('finding');
    if (f.type === 'FIRE') fireSources.push('finding');
  }
  if (FLOOD_RE.test(lotDamage)) floodSources.push('lot');
  if (FIRE_RE.test(lotDamage)) fireSources.push('lot');
  if (hv && hv.fire_traces_visible === true) fireSources.push('historical_photos');
  for (const d of disclosures) {
    if (d.category !== 'flood_or_fire') continue;
    if (FIRE_RE.test(d.quote)) fireSources.push('seller');
    else floodSources.push('seller');
  }

  for (const ev of rawEvents) {
    const anchored = ev.anchored === true;
    const h = anchored ? hv : null;
    const attachedRecord = rec && rec.recorded === true && (ev.merge_basis || []).includes('platform_record_attached');
    const platformEvent = String(ev.normalized_event_id).startsWith('platform:');
    /* D2: якірний лот, кадри прочитані, пошкоджень не видно, відмітки нема:
       подія не створюється, лише unresolved */
    if (anchored && h && !hvShowsDamage(h) && !attachedRecord && !lotDamage && !(ev.signals && (ev.signals.structural || ev.signals.airbags))) {
      unresolved.push({ key: 'auction_reason_unknown', input: 'accident_history', note_key: 'Auction record found, no damage visible on archive photos, reason for sale unknown' });
      continue;
    }
    const zoneText = [
      ...(h && Array.isArray(h.visible_damage_zones) ? h.visible_damage_zones : []),
      lotDamage,
      attachedRecord || platformEvent ? (rec.note || '') : '',
    ].join(' ');
    const zc = zoneClasses(zoneText);
    const substantive = anchored && (!!h || !!lotDamage || !!(am && am.airbags));
    const { category, basis } = classifyEventV4(ev, h, zc, zoneClasses(lotDamage));
    const trustedYear = (am && anchored && am.sale_date ? yearOf(am.sale_date) : null)
      || ((attachedRecord || platformEvent) && rec ? yearOf(rec.note) : null);
    let repair = null;
    for (const r of ev.repair_statuses || []) if (repair === null || ({ confirmed_bad: 3, unknown: 2, visually_consistent: 1, confirmed_ok: 0 })[r] > ({ confirmed_bad: 3, unknown: 2, visually_consistent: 1, confirmed_ok: 0 })[repair]) repair = r;
    events.push({
      normalized_event_id: ev.normalized_event_id, anchored, substantive,
      source_event_ids: [...new Set(ev.source_event_ids || [])], merge_basis: [...new Set(ev.merge_basis || [])],
      v4_category: category, category_basis: basis, trusted_year: trustedYear,
      repair_status: repair, airbags: !!(ev.signals && ev.signals.airbags) || !!(h && h.srs_visual_status === 'deployed_visible'),
      airbags_visible_parts: h && Array.isArray(h.airbags_visible_parts) ? h.airbags_visible_parts : [],
      zone_classes: [...zc], latest: false, unrepaired_signs: false, fire: false,
      evidence: (ev.evidence || []).slice(0, 10),
    });
  }

  /* D2 поза резолвером: лот є, кадри прочитані, пошкоджень не видно,
     відмітки нема, подій резолвер не створив */
  if (am && hv && !hvShowsDamage(hv) && !(rec && rec.recorded === true) && !lotDamage && !events.some(e => e.anchored)
      && !unresolved.some(u => u.key === 'auction_reason_unknown')) {
    unresolved.push({ key: 'auction_reason_unknown', input: 'accident_history', note_key: 'Auction record found, no damage visible on archive photos, reason for sale unknown' });
  }

  /* продавець "після ДТП не відновлена": одна accident causal problem */
  const unrepaired = disclosures.find(d => d.category === 'accident_unrepaired');
  if (unrepaired && !events.length) {
    events.push({
      normalized_event_id: 'seller:accident_unrepaired', anchored: false, substantive: true, source_event_ids: [], merge_basis: ['seller_claim'],
      v4_category: 'unrepaired_seller', category_basis: ['seller_states_unrepaired'], trusted_year: null, repair_status: 'confirmed_bad',
      airbags: false, airbags_visible_parts: [], zone_classes: unrepaired.zone && unrepaired.zone !== 'glass' && unrepaired.zone !== 'interior' ? [unrepaired.zone] : [],
      latest: false, unrepaired_signs: true, fire: false,
      evidence: [{ source: 'seller_claim', ref: 'seller_description', description: unrepaired.quote }],
    });
  }

  /* останнє: змістовне з найбільшим trusted_year, при рівності тяжче;
     без змістовних: перша подія резолвера */
  let latest = null;
  const rank = e => CATEGORY_RANK[e.v4_category] || 0;
  const subst = events.filter(e => e.substantive);
  const pool = subst.length ? subst : events;
  for (const e of pool) {
    if (!latest) { latest = e; continue; }
    const ya = e.trusted_year, yb = latest.trusted_year;
    if (ya !== null && yb !== null && ya !== yb) { if (ya > yb) latest = e; continue; }
    if (ya !== null && yb === null) { latest = e; continue; }
    if (ya === null && yb !== null) continue;
    if (rank(e) > rank(latest)) latest = e;
  }
  if (latest) {
    latest.latest = true;
    if (unrepaired) {
      latest.unrepaired_signs = true;
      if (latest.v4_category === 'unknown') { latest.v4_category = 'unrepaired_seller'; latest.category_basis.push('seller_states_unrepaired'); }
      latest.evidence.push({ source: 'seller_claim', ref: 'seller_description', description: unrepaired.quote });
    }
    /* пожежа, привʼязана до якірної події (кадри або лот), і тотал цієї ж
       події: одна строка 5.0, строка пожежі не створюється */
    const fireOnAnchor = latest.anchored && (fireSources.includes('historical_photos') || fireSources.includes('lot'));
    latest.fire = fireOnAnchor;
    const amount = CATEGORY_AMOUNT(cfg, latest.v4_category);
    items.push({
      key: 'accident_latest_' + latest.v4_category, input: 'accident_history', amount,
      label_key: ACCIDENT_LABELS[latest.v4_category], params: { basis: latest.category_basis.join(','), year: latest.trusted_year },
      evidence: latest.evidence.slice(0, 6), event_id: latest.normalized_event_id,
    });
    if (latest.v4_category === 'unknown') unresolved.push({ key: 'accident_severity_unknown', input: 'accident_history', note_key: 'Accident recorded, severity could not be established', params: { event_id: latest.normalized_event_id } });
    const earlier = events.filter(e => e !== latest);
    if (earlier.length) {
      items.push({
        key: 'accident_earlier_events', input: 'accident_history', amount: cfg.ACCIDENT.earlier_events,
        label_key: 'Earlier accident history', params: { count: earlier.length },
        evidence: earlier.flatMap(e => e.evidence).slice(0, 6), event_id: earlier.map(e => e.normalized_event_id).join(','),
      });
    }
    if (fireOnAnchor && latest.v4_category === 'total') fireSources.length = 0;
  }
  if (floodSources.length) {
    items.push({ key: 'flood_event', input: 'accident_history', amount: cfg.ACCIDENT.flood, label_key: 'Flood damage recorded', params: { sources: [...new Set(floodSources)].join(',') }, evidence: [] });
  }
  if (fireSources.length) {
    items.push({ key: 'fire_event', input: 'accident_history', amount: cfg.ACCIDENT.fire, label_key: 'Fire damage recorded', params: { sources: [...new Set(fireSources)].join(',') }, evidence: [] });
  }
  const checked = !!(hv || am || rec || findings.length || disclosures.length || inp.auctionChecked);
  return { items, unresolved, events, available: checked };
}
const ACCIDENT_LABELS = {
  light: 'Accident history: light damage', medium: 'Accident history: medium damage', heavy: 'Accident history: heavy damage',
  total: 'Accident history: total loss level damage', unknown: 'Accident recorded, severity not established',
  unrepaired_seller: 'Accident history: not restored per seller',
};

/* ---------- 2 і 3. поточний стан за кадрами (Current Vision) ---------- */
const EXTERIOR_ZONES = new Set(['front', 'rear', 'left_front', 'left_side', 'left_rear', 'right_front', 'right_side', 'right_rear', 'roof', 'wheels', 'engine_bay', 'underbody']);
const INTERIOR_ZONES = new Set(['driver_area', 'front_passenger', 'front_seats', 'rear_seats', 'dashboard', 'center_console', 'doors', 'trunk']);
const SEAT_ZONES = new Set(['front_seats', 'rear_seats', 'driver_area', 'front_passenger']);
export function cvZoneClasses(zone) {
  const s = new Set();
  const z = String(zone || '');
  if (/front/.test(z)) s.add('front');
  if (/rear/.test(z)) s.add('rear');
  if (/^left/.test(z)) s.add('left');
  if (/^right/.test(z)) s.add('right');
  if (z === 'roof') s.add('roof');
  return s;
}
const isMaterial = f => f && f.severity && f.severity !== 'minor' && f.confidence && f.confidence !== 'low';

export function mapBodyFinding(f) {
  if (!isMaterial(f) || !EXTERIOR_ZONES.has(f.zone)) return null;
  const c = f.component || 'other';
  const k = f.kind;
  if (k === 'dent' || (k === 'other_visible_damage' && c === 'panel')) return 'dent';
  if (k === 'corrosion') return 'corrosion';
  if ((k === 'crack' || k === 'other_visible_damage') && (c === 'headlight' || c === 'taillight')) return 'headlight';
  if ((k === 'crack' || k === 'chip') && c === 'windshield') return 'windshield';
  if ((k === 'broken_component' || k === 'plastic_damage' || k === 'crack') && ['bumper', 'mirror', 'grille', 'trim', 'glass_other'].includes(c)) return 'broken_element';
  if (k === 'missing_component') return 'missing_part';
  if (k === 'wheel_damage' && f.zone === 'wheels') return 'wheel';
  return null;
}
export function mapInteriorFinding(f) {
  if (!isMaterial(f) || !INTERIOR_ZONES.has(f.zone)) return null;
  const c = f.component || 'other';
  if ((f.kind === 'tear' || f.kind === 'stain') && c === 'seat' && SEAT_ZONES.has(f.zone)) return 'seat_damage';
  if (f.kind === 'wear' && c === 'seat' && (f.zone === 'driver_area' || f.zone === 'front_seats')) return 'driver_seat_wear';
  if (f.kind === 'wear' && c === 'steering_wheel' && (f.zone === 'driver_area' || f.zone === 'dashboard')) return 'steering_wheel_wear';
  return null;
}
const BODY_LABELS = { dent: 'Body: large dent or panel deformation', corrosion: 'Body: visible corrosion', headlight: 'Body: cracked or fogged headlight',
  windshield: 'Body: cracked or chipped windshield', broken_element: 'Body: broken exterior element', missing_part: 'Body: missing part', wheel: 'Body: damaged wheel' };
const INTERIOR_LABELS = { seat_damage: 'Interior: seat upholstery damage', driver_seat_wear: 'Interior: pronounced driver seat wear', steering_wheel_wear: 'Interior: worn steering wheel' };

function currentConditionInputs(inp, cfg) {
  const cv = inp.currentVisual || null;
  const out = { body: { items: [], available: false, status: 'unavailable' }, interior: { items: [], available: false, status: 'unavailable' }, unresolved: [], dropped: 0 };
  if (!cv || inp.cvStatus !== 'ok') return out;
  const zones = cv.zones || {};
  const seen = z => (zones.sufficient || []).includes(z) || (zones.partial || []).includes(z);
  out.body.available = [...EXTERIOR_ZONES].some(seen);
  out.interior.available = [...INTERIOR_ZONES].some(seen);
  if (!out.interior.available) out.unresolved.push({ key: 'interior_not_shown', input: 'interior_condition', note_key: 'Interior not shown on listing photos' });
  const byKey = new Map();
  const wheels = new Map();
  for (const f of Array.isArray(cv.condition_findings) ? cv.condition_findings : []) {
    const bt = mapBodyFinding(f);
    if (bt === 'wheel') {
      const pos = WHEEL_POSITIONS.includes(f.wheel_position) ? f.wheel_position : 'unknown';
      if (!wheels.has(pos)) wheels.set(pos, f);
      continue;
    }
    if (bt) {
      /* engine_bay це та сама передня частина: відсутній передок не
         рахується двічі (front + engine_bay) */
      const bodyZone = f.zone === 'engine_bay' ? 'front' : f.zone;
      const key = 'input2:' + bt + ':' + bodyZone;
      const cur = byKey.get(key);
      if (cur) { cur.evidence.push({ source: 'current_photos', ref: 'photo_' + f.photo, description: f.sign }); continue; }
      byKey.set(key, { key, input: 'body_condition', amount: cfg.BODY[bt], label_key: BODY_LABELS[bt], params: { zone: bodyZone, type: bt }, zone: bodyZone, zone_classes: [...cvZoneClasses(bodyZone)], type: bt,
        evidence: [{ source: 'current_photos', ref: 'photo_' + f.photo, description: f.sign }] });
      continue;
    }
    const it = mapInteriorFinding(f);
    if (it) {
      const key = it === 'seat_damage' ? 'input3:seat_damage:' + f.zone : 'input3:' + it;
      const cur = byKey.get(key);
      if (cur) { cur.evidence.push({ source: 'current_photos', ref: 'photo_' + f.photo, description: f.sign }); continue; }
      byKey.set(key, { key, input: 'interior_condition', amount: cfg.INTERIOR[it], label_key: INTERIOR_LABELS[it], params: { zone: f.zone, type: it }, zone: f.zone, type: it,
        evidence: [{ source: 'current_photos', ref: 'photo_' + f.photo, description: f.sign }] });
      continue;
    }
    out.dropped++;
  }
  /* диски: gallery_index не ідентичність колеса. Відомі позиції рахуються
     по позиціях (не більше двох), невідома позиція це одне колесо */
  if (wheels.size) {
    const known = [...wheels.keys()].filter(k => k !== 'unknown');
    const count = known.length ? Math.min(2, known.length) : 1;
    const amount = Math.min(cfg.BODY.wheel_max, round2(cfg.BODY.wheel * count));
    byKey.set('input2:wheel', { key: 'input2:wheel', input: 'body_condition', amount, label_key: BODY_LABELS.wheel, params: { wheels: count, positions: known.join(',') || 'unknown' }, zone: 'wheels', zone_classes: [], type: 'wheel',
      evidence: [...wheels.values()].map(f => ({ source: 'current_photos', ref: 'photo_' + f.photo, description: f.sign })) });
  }
  for (const it of byKey.values()) (it.input === 'body_condition' ? out.body.items : out.interior.items).push(it);
  out.body.status = out.body.available ? (out.body.items.length ? 'applied' : 'clean') : 'unavailable';
  out.interior.status = out.interior.available ? (out.interior.items.length ? 'applied' : 'clean') : 'unavailable';
  return out;
}

/* ---------- 4. інтенсивність пробігу ---------- */
export function intensityPenalty(ratio, cfg = SCORE_CONFIG_V4) {
  const curve = cfg.INTENSITY_CURVE;
  if (!(ratio > curve[0][0])) return 0;
  for (let i = 1; i < curve.length; i++) {
    if (ratio <= curve[i][0]) {
      const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
      return round2(y0 + (y1 - y0) * (ratio - x0) / (x1 - x0));
    }
  }
  return curve[curve.length - 1][1];
}
function intensityInput(inp, cfg) {
  const v = inp.vehicle || {};
  const odo = num(v.odometer_km), months = num(v.age_months);
  if (odo === null || odo < 0 || months === null) return { items: [], available: false, status: 'unavailable', detail: null };
  if (months < cfg.MIN_AGE_MONTHS) return { items: [], available: false, status: 'unavailable', detail: { reason: 'younger_than_one_year', age_months: months } };
  const cls = cfg.MILEAGE_NORM_KM_YEAR[v.powertrain_class] ? v.powertrain_class : 'unknown';
  const norm = mileageNormKmYear(cls, cfg);
  const annual = odo / (months / 12);
  const ratio = round2(annual / norm);
  const amount = intensityPenalty(ratio, cfg);
  const detail = { odometer_km: odo, age_months: months, age_source: v.age_source || null, powertrain_class: cls, norm_km_year: norm, annual_km: Math.round(annual), ratio };
  const items = amount > 0 ? [{ key: 'input4:intensity', input: 'mileage_intensity', amount, label_key: 'Mileage intensity above the norm for this powertrain', params: detail, evidence: [] }] : [];
  return { items, available: true, status: amount > 0 ? 'applied' : 'clean', detail };
}

/* ---------- 7. вік автомобіля ----------
   age_years < 1: 0; інакше 0.1 + (age_years - 1) * 0.05, де
   age_years = age_months / 12 без округлення до цілих років; той самий
   канонічний age_months, що в інтенсивності; без капа, незалежно від
   інтенсивності; вік невідомий = unavailable, 0 */
function ageInput(inp, cfg) {
  const months = num(inp.vehicle && inp.vehicle.age_months);
  if (months === null || months < 0) return { items: [], available: false, status: 'unavailable', detail: null };
  const years = months / 12;
  const amount = years < 1 ? 0 : round2(cfg.AGE.first_year + (years - 1) * cfg.AGE.per_extra_year);
  const detail = { age_months: months, age_years: round2(months / 12), age_source: (inp.vehicle && inp.vehicle.age_source) || null };
  const items = amount > 0 ? [{ key: 'input7:age', input: 'vehicle_age', amount, label_key: 'Vehicle age', params: detail, evidence: [] }] : [];
  return { items, available: true, status: amount > 0 ? 'applied' : 'clean', detail };
}

/* ---------- 5. відкат пробігу ---------- */
export function normalizeMileagePoints(points, cfg = SCORE_CONFIG_V4) {
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || typeof p !== 'object') continue;
    const t = Date.parse(p.date || '');
    const raw = num(p.km !== undefined ? p.km : p.value);
    if (!isFinite(t) || raw === null || raw < 0) continue;
    const unit = p.unit === 'mi' ? 'mi' : (p.unit === 'km' || p.unit === undefined || p.unit === null ? 'km' : 'unknown');
    if (unit === 'unknown') continue;
    if (p.status && p.status !== 'actual' && p.status !== 'unknown') continue;
    out.push({ km: unit === 'mi' ? Math.round(raw * 1.609) : Math.round(raw), date: new Date(t).toISOString().slice(0, 10), t,
      source: String(p.source || 'unknown').slice(0, 20), family: String(p.family || p.source || 'unknown').slice(0, 20), unit_raw: unit });
  }
  out.sort((a, b) => a.t - b.t || a.km - b.km);
  /* дедуп: той самий день і той самий пробіг (у межах тисячі) це один запис */
  const dedup = [];
  for (const p of out) {
    const same = dedup.find(q => Math.abs(q.t - p.t) <= cfg.ROLLBACK.same_day_ms && Math.abs(q.km - p.km) <= cfg.ROLLBACK.dedupe_km);
    if (same) { if (!same.families.includes(p.family)) same.families.push(p.family); continue; }
    dedup.push({ ...p, families: [p.family] });
  }
  return dedup;
}
export function detectRollback(points, cfg = SCORE_CONFIG_V4) {
  const pts = normalizeMileagePoints(points, cfg);
  let best = null;
  const notes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      if (Math.abs(a.t - b.t) <= cfg.ROLLBACK.same_day_ms) continue;   /* одна часова група: не пара */
      const drop = a.km - b.km;
      if (drop <= 0) continue;
      if (drop < cfg.ROLLBACK.threshold_km) { notes.push({ from: a, to: b, drop }); continue; }
      const continued = pts.some(k => k.t > b.t + cfg.ROLLBACK.same_day_ms && k.km >= b.km && k.km < a.km);
      const twoFamilies = b.families.length >= 2;
      if (!continued && !twoFamilies) { notes.push({ from: a, to: b, drop, unstable: true }); continue; }
      if (!best || drop > best.drop) best = { from: a, to: b, drop, stable_by: continued ? 'continued_series' : 'two_families' };
    }
  }
  return { points: pts, rollback: best, notes };
}
function rollbackInput(inp, cfg) {
  const { points, rollback, notes } = detectRollback(inp.mileagePoints, cfg);
  const unresolved = [];
  const dated = new Set(points.map(p => p.date));
  const available = dated.size >= cfg.ELIGIBILITY.mileage_points_min;
  const items = [];
  if (rollback) {
    const tier = cfg.ROLLBACK.tiers.find(t => rollback.drop < t[0] || t[0] === Infinity) || cfg.ROLLBACK.tiers[cfg.ROLLBACK.tiers.length - 1];
    items.push({ key: 'input5:rollback', input: 'mileage_rollback', amount: tier[1], label_key: 'Mileage decreased between dated records',
      params: { from_km: rollback.from.km, from_date: rollback.from.date, to_km: rollback.to.km, to_date: rollback.to.date, drop_km: rollback.drop, stable_by: rollback.stable_by }, evidence: [] });
  } else if (inp.platformMileageFlag === true) {
    items.push({ key: 'input5:platform_flag', input: 'mileage_rollback', amount: cfg.ROLLBACK.platform_flag, label_key: 'Marketplace flags a mileage inconsistency', params: {}, evidence: [] });
  }
  for (const n of notes.slice(0, 4)) {
    unresolved.push({ key: 'mileage_inconsistency', input: 'mileage_rollback', note_key: n.unstable ? 'Single mileage drop without confirmation' : 'Small mileage discrepancy below the threshold',
      params: { from_km: n.from.km, from_date: n.from.date, to_km: n.to.km, to_date: n.to.date, drop_km: n.drop } });
  }
  return { items, unresolved, available, status: available ? (items.length ? 'applied' : 'clean') : 'unavailable', points };
}

/* ---------- 6. несправності, розкриті продавцем ---------- */
const NEGATION_RE = /(?:^|[\s,;(])(?:не|нет|ні|нема|немає|без|no\b|not\b|without)\s*(?:\w+\s+){0,2}?(?:дым|дим|теч|тек|стук|пина|пинк|ошиб|помил|ерр|error|leak|smoke|knock|проблем|перегр|буксу)/i;
const UNIT_OF_CATEGORY = {
  vehicle_not_running_or_unit_replacement: ['vehicle', 'engine', 'transmission'],
  major_powertrain_symptom: ['engine', 'transmission', 'drivetrain'],
  generic_powertrain_warning: ['engine', 'transmission'],
  localized_powertrain_issue: ['engine', 'transmission', 'drivetrain'],
  chassis_brakes_steering: ['chassis'], body_work_needed: ['body'], electrics_comfort: ['electrics'], consumables: ['consumables'],
  srs_not_restored: ['srs'], srs_warning_generic: ['srs'], accident_unrepaired: ['body'], engine_swap_installed: ['engine'], flood_or_fire: ['vehicle', 'body'],
};
const normText = s => String(s || '').toLowerCase().replace(/[\u2014\u2013]/g, '-').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/* валідація кодом: категорія з переліку, цитата дослівно в тексті
   оголошення, заперечення і невизначеність дають 0 */
export function validateDisclosures(raw, listingText) {
  const ok = [];
  let dropped = 0;
  const text = normText(listingText);
  for (const d of Array.isArray(raw) ? raw : []) {
    if (!d || typeof d !== 'object' || !SELLER_CATEGORIES.includes(d.category)) { dropped++; continue; }
    const quote = String(d.quote || '').trim().slice(0, 300);
    if (quote.length < 3 || !text || !text.includes(normText(quote))) { dropped++; continue; }
    const allowedUnits = UNIT_OF_CATEGORY[d.category];
    const unit = allowedUnits.includes(d.unit) ? d.unit : allowedUnits[0];
    ok.push({
      category: d.category, unit, quote,
      zone: SELLER_ZONES.includes(d.zone) ? d.zone : null,
      negated: d.negated === true || NEGATION_RE.test(quote),
      vague: d.vague === true, seller_favor: d.seller_favor === true,
    });
  }
  return { ok, dropped };
}
const SELLER_LABELS = {
  vehicle_not_running_or_unit_replacement: 'Seller: vehicle not running or major unit needs replacement', major_powertrain_symptom: 'Seller: major engine or transmission symptom',
  generic_powertrain_warning: 'Seller: engine warning without a specific symptom', localized_powertrain_issue: 'Seller: localized engine or transmission issue',
  chassis_brakes_steering: 'Seller: chassis, brakes or steering issue', body_work_needed: 'Seller: body work needed', electrics_comfort: 'Seller: electrics or comfort fault',
  consumables: 'Seller: consumables due', srs_not_restored: 'Seller: airbags not restored', srs_warning_generic: 'Seller: airbag warning light',
};
function sellerInput(disclosures, cfg) {
  const items = [], unresolved = [];
  const scored = disclosures.filter(d => cfg.SELLER[d.category] !== undefined);
  const passthrough = disclosures.filter(d => cfg.SELLER[d.category] === undefined);
  for (const d of disclosures) {
    if (d.negated || d.vague || d.seller_favor) unresolved.push({ key: d.negated ? 'seller_negated_statement' : (d.vague ? 'seller_vague_statement' : 'seller_favorable_claim'), input: 'seller_disclosures', note_key: 'Seller statement recorded without penalty', params: { quote: d.quote.slice(0, 120), category: d.category } });
  }
  for (const d of passthrough) {
    if (d.category === 'engine_swap_installed' && !d.negated) unresolved.push({ key: 'engine_swap_claimed', input: 'seller_disclosures', note_key: 'Seller states an engine swap', params: { quote: d.quote.slice(0, 120) } });
  }
  const live = scored.filter(d => !d.negated && !d.vague && !d.seller_favor);
  /* vehicle-level "не заводиться" поглинає engine і transmission тієї самої
     causal problem; srs_not_restored поглинає srs_warning_generic */
  const vehicleLevel = live.find(d => d.category === 'vehicle_not_running_or_unit_replacement');
  const byUnit = new Map();
  for (const d of live) {
    let unit = d.unit;
    if (d.category === 'vehicle_not_running_or_unit_replacement') unit = 'vehicle';
    if (vehicleLevel && (unit === 'engine' || unit === 'transmission')) continue;
    const amount = cfg.SELLER[d.category];
    const cur = byUnit.get(unit);
    if (!cur || amount > cur.amount || (amount === cur.amount && d.quote.length > cur.quote.length)) byUnit.set(unit, { ...d, amount, quotes: [...(cur ? cur.quotes : []), d.quote] });
    else cur.quotes.push(d.quote);
  }
  for (const [unit, d] of byUnit) {
    if (d.amount <= 0) continue;
    items.push({ key: 'input6:' + unit + ':' + d.category, input: 'seller_disclosures', amount: d.amount, label_key: SELLER_LABELS[d.category],
      params: { quote: d.quote.slice(0, 120), unit, zone: d.zone }, quote: d.quote, zone: d.zone, category: d.category, unit,
      evidence: d.quotes.slice(0, 4).map(q => ({ source: 'seller_claim', ref: 'seller_description', description: q.slice(0, 200) })) });
  }
  return { items, unresolved };
}

/* ---------- анти-дабл-каунтинг: продавець x Current Vision ----------
   Один поточний причинний дефект = одна строка: amount = max, ключ входу 2 */
function dedupeSellerVsBody(sellerItems, bodyItems) {
  const kept = [];
  for (const s of sellerItems) {
    if (s.category !== 'body_work_needed') { kept.push(s); continue; }
    const sz = s.zone;
    const match = bodyItems.find(b => {
      if (sz === 'glass') return b.type === 'windshield' || b.type === 'headlight';
      if (!sz || sz === 'interior') return false;
      return (b.zone_classes || []).includes(sz) && ['dent', 'broken_element', 'missing_part', 'corrosion'].includes(b.type);
    });
    if (!match) { kept.push(s); continue; }
    if (s.amount > match.amount) match.amount = s.amount;
    match.evidence.push(...s.evidence);
    match.params.seller_confirmed = true;
    match.merged_seller_key = s.key;
  }
  return kept;
}

/* ---------- eligibility gate ---------- */
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
export function detectVinMismatch(findings, listingVin) {
  const vin = String(listingVin || '').toUpperCase();
  if (vin.length !== 17) return { mismatch: false, found: null };
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || f.type !== 'VIN_IDENTITY_PROBLEM') continue;
    for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
      const text = String((e && e.description) || '').toUpperCase();
      for (const m of text.match(VIN_RE) || []) if (m !== vin) return { mismatch: true, found: m };
    }
  }
  return { mismatch: false, found: null };
}
export function eligibilityV4(ctx, items, events, cfg = SCORE_CONFIG_V4) {
  const e = ctx || {};
  const E = cfg.ELIGIBILITY;
  const identityOk = !!e.identity_confirmed && e.basics_known !== false;
  const strong = events.length > 0
    || items.some(i => i.input === 'mileage_rollback' && i.key === 'input5:rollback')
    || items.some(i => (i.key === 'flood_event' || i.key === 'fire_event'))
    || items.some(i => ['body_condition', 'interior_condition', 'seller_disclosures'].includes(i.input) && i.amount >= E.strong_item_min);
  const domains = {
    photos: (num(e.photos_count) || 0) >= E.photos_min,
    seller_text: (num(e.seller_text_chars) || 0) >= E.seller_text_chars,
    history: e.auction_record_exists === true || e.registry_present === true || (num(e.historical_listings_count) || 0) >= 1,
    mileage: (num(e.mileage_dated_points) || 0) >= E.mileage_points_min,
  };
  const domainsCount = Object.values(domains).filter(Boolean).length;
  const richVisual = (num(e.photos_count) || 0) >= E.rich_photos && e.cv_status === 'ok' && (num(e.cv_zones_sufficient) || 0) >= E.rich_zones;
  let reason = null;
  if (!identityOk) reason = 'vehicle_identity_unconfirmed';
  else if (e.vin_mismatch === true) reason = 'vehicle_identity_mismatch';
  else if (!(strong || domainsCount >= 2 || richVisual)) reason = 'insufficient_evidence';
  return { eligible: reason === null, reason, identity_ok: identityOk, mismatch: e.vin_mismatch === true, strong_negative: strong, domains, domains_count: domainsCount, rich_visual: richVisual };
}

/* ---------- головна формула ---------- */
export function computeScoreV4(input, cfg = SCORE_CONFIG_V4) {
  const inp = input && typeof input === 'object' ? input : {};
  const { ok: findings, dropped: droppedFindings } = sanitizeFindingsV3(inp.findings);
  const { ok: disclosures, dropped: droppedDisclosures } = validateDisclosures(inp.sellerDisclosures, inp.listingText);
  const ev = inp.evidence || {};

  const acc = accidentInput({ ...inp, findings, disclosures }, cfg);
  const cur = currentConditionInputs({ currentVisual: inp.currentVisual, cvStatus: ev.cv_status }, cfg);
  const inten = intensityInput(inp, cfg);
  const age = ageInput(inp, cfg);
  const roll = rollbackInput({ mileagePoints: inp.mileagePoints, platformMileageFlag: inp.platformMileageFlag }, cfg);
  const sel = sellerInput(disclosures, cfg);

  /* дедуп: продавець проти Current Vision (один поточний дефект) */
  const sellerItems = dedupeSellerVsBody(sel.items, cur.body.items);
  /* історія + підтверджений поточний дефект: обидві строки, подія отримує
     unrepaired_signs для ярлика */
  const latest = acc.events.find(e => e.latest);
  if (latest && (latest.repair_status === null || latest.repair_status === 'unknown' || latest.repair_status === 'confirmed_bad')) {
    for (const b of cur.body.items) {
      if (!['dent', 'broken_element', 'missing_part'].includes(b.type)) continue;
      if ((b.zone_classes || []).some(z => latest.zone_classes.includes(z))) { latest.unrepaired_signs = true; b.params.in_accident_zone = true; }
    }
  }

  const items = [...acc.items, ...cur.body.items, ...cur.interior.items, ...inten.items, ...age.items, ...roll.items, ...sellerItems]
    .map(i => ({ ...i, amount: round2(i.amount) }));
  const rawSum = round2(items.reduce((s, i) => s + i.amount, 0));
  const raw = round2(cfg.STARTING_SCORE - rawSum);
  const final = round1(Math.max(0, raw));

  const mileageDated = new Set(roll.points.map(p => p.date)).size;
  const vinCheck = detectVinMismatch(findings, ev.listing_vin);
  const elig = eligibilityV4({ ...ev, vin_mismatch: ev.vin_mismatch === true || vinCheck.mismatch, mileage_dated_points: mileageDated }, items, acc.events, cfg);

  const state = (available, list, status) => ({ available, status: status || (available ? (list.length ? 'applied' : 'clean') : 'unavailable'), penalty: round2(list.reduce((s, i) => s + i.amount, 0)), item_keys: list.map(i => i.key) });
  const inputs = {
    accident_history: state(acc.available, acc.items),
    body_condition: state(cur.body.available, cur.body.items, cur.body.status),
    interior_condition: state(cur.interior.available, cur.interior.items, cur.interior.status),
    mileage_intensity: state(inten.available, inten.items, inten.status),
    vehicle_age: state(age.available, age.items, age.status),
    mileage_rollback: state(roll.available, roll.items, roll.status),
    seller_disclosures: state(!!(inp.listingText && String(inp.listingText).trim()), sellerItems),
  };
  const unresolved = [...acc.unresolved, ...cur.unresolved, ...roll.unresolved, ...sel.unresolved];

  return {
    score_v: 4,
    score_version: 'v4',
    config_tag: cfg.CONFIG_TAG,
    score_available: elig.eligible,
    score_eligible: elig.eligible,
    score_unavailable_reason: elig.reason,
    final: elig.eligible ? final : null,
    final_if_eligible: final,
    raw_sum: rawSum,
    floored: raw < 0,
    eligibility: elig,
    inputs,
    items,
    events: acc.events,
    mileage_points: roll.points,
    mileage_intensity: inten.detail,
    vehicle_age: age.detail,
    availability: {
      hv: !!inp.historicalVisual, auction_record: ev.auction_record_exists === true, registry: ev.registry_present === true,
      cv_exterior: cur.body.available, cv_interior: cur.interior.available, cv_status: ev.cv_status || null,
      mileage_points: mileageDated, seller_text: !!(inp.listingText && String(inp.listingText).trim()), seller_text_chars: num(ev.seller_text_chars) || 0,
      age: inten.available || (inten.detail && inten.detail.reason) || false, powertrain: (inp.vehicle && inp.vehicle.powertrain_class) || null,
      photos_count: num(ev.photos_count) || 0,
    },
    unresolved,
    dropped: { findings: droppedFindings, disclosures: droppedDisclosures, cv_findings: cur.dropped },
    vin_check: vinCheck,
  };
}
