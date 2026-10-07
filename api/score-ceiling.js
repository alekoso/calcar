/* CalCar Score Ceiling v1: обмежений шар над Score v4, не Score v5.

   Score v4 відповідає "які підтверджені негативи є в цього авто" і
   рахує штрафи від 10. Цей шар відповідає "наскільки високий бал CalCar
   може обґрунтовано захистити, знаючи САМЕ ЦЕ авто". Стеля C рахується
   з того самого нормалізованого evidence, що вже є у звіті (без нових
   викликів моделі): стартуємо зі стелі, далі діють ті самі незалежні
   штрафи v4. Без стелі C = 10 і бал побайтово дорівнює Score v4.
   Кандидати ніколи не додаються: береться НАЙНИЖЧА застосовна стеля,
   решта зберігається для пояснення.

   Три джерела стелі:
   1. фізична тяжкість минулого пошкодження з Historical Vision і
      нормалізованих фізичних знахідок по цьому VIN. НЕ з подушок (легкий
      удар теж розкриває подушку) і НЕ з адміністративних ярликів: salvage,
      rebuilt, total loss, страховик, сам факт аукціону чи титул ринку
      походження стелі не дають. Подія невідомої тяжкості це звичайний
      штраф v4 (unknown 0.5), а не стеля;
   2. повнота доказів: домени Confidence (history, photos, mileage) у
      вузькій смузі 45 -> 35 плавно знижують стелю (0 -> 1.0 на домен,
      сума, підлога 8.0). Звичайний partial вище 45, молоде авто без
      глибокої історії чи відомий одометр без датованих точок стелю не
      знижують;
   3. цілісність пробігу: не "мало точок", а реальна аномалія чи відкат.

   Одна аварія не рахується двічі: для події, що дала переможну стелю
   ущерба, її штраф v4 і просадка стелі беруться як більше з двох, а не
   сума. Незалежні штрафи (скло, салон, інший дефект кузова, друга подія,
   страховий випадок) віднімаються як завжди.

   Окремо: нерозвʼязаний конфлікт базової ідентичності (модель, двигун,
   коробка, привід) не дає числа взагалі: score_available = false,
   reason core_identity_unresolved. Модуль чистий і не залежить від
   ринку: без мережі, без моделі, без назв країн. */
import { classifyEventV4 } from './score-v4.js';

export const SCORE_CEILING_CONFIG = {
  CONFIG_TAG: 'ceiling-v1-2026-10-07',
  DEFAULT: 10,
  /* стартове калібрування власника (2026-10-07); числа підлягають
     звірці на калібрувальному корпусі перед викаткою */
  DAMAGE: { light: 10, moderate: 9.0, inner_depth: 8.0, serious: 7.5, structural: 6.5, extreme: 6.0 },
  /* домени Confidence з доказами про САМЕ ЦЕ авто; identity вирішується
     окремо паспортом (конфлікт = нема числа), тому в стелю не входить.
     Зниження домену = clamp((band_hi - score) / (band_hi - band_lo), 0, 1):
     вище band_hi нічого, нижче band_lo повний бал; сума по доменах, але
     не нижче floor. young_history_months: до цього віку брак глибини
     історії природний і не знижує */
  EVIDENCE: { domains: ['history', 'photos', 'mileage'], band_hi: 45, band_lo: 35, floor: 8.0, young_history_months: 36 },
  MILEAGE: { anomaly: 8.0, rollback: 7.0, rollback_major: 6.5, major_drop_km: 60000 },
  /* базова ідентичність: конфлікт сильних джерел у цих полях = числа нема.
     Версія, кузов, рік і опції не блокують бал */
  IDENTITY_CORE: ['make', 'model', 'generation', 'fuel', 'displacement_l', 'forced_induction', 'transmission', 'drivetrain'],
};

const round1 = x => Math.round((x + Number.EPSILON) * 10) / 10;
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

/* ---------- 1. фізична тяжкість минулого пошкодження ----------
   Драбина: light (10) -> moderate (9.0) -> inner_depth, можливе ураження
   силової структури (8.0) -> serious (7.5) -> structural (6.5) ->
   extreme (6.0). Класифікатор v4 той самий (без подушок); зони беруться
   з нормалізованої події, а не з тексту лота. */
const STRUCTURAL_BASIS = new Set(['cabin_intrusion', 'vehicle_disassembled', 'pillar_deformation', 'non_adjacent_zones_deep', 'structural_damage', 'load_bearing_deformation']);
const INNER_DEPTH_BASIS = new Set(['inner_module_localized', 'inner_module_indeterminate']);
const SEVERITY_LABEL = {
  structural: 'damage to the load-bearing structure is confirmed in the past',
  serious: 'the car had serious physical damage in the past',
  inner_depth: 'past damage with possible structural involvement',
  moderate: 'the car had moderate damage in the past',
  extreme: 'fire damage is confirmed in the past',
};

/* HV бачив глибину за межами зовнішніх панелей або не може виключити
   ураження силової структури */
function innerDepthSeen(hv) {
  return hv.possible_structural_damage === true
    || hv.damage_depth === 'inner_structure_or_module'
    || hv.inner_component_damage_extent === 'localized'
    || hv.inner_component_deformation_visible === 'visible';
}
/* пошкодження, яке HV однозначно бачив лише на зовнішніх панелях */
function clearlyOuterOnly(hv) {
  return !!hv && hv.damage_depth === 'exterior_panels_only' && !innerDepthSeen(hv);
}

export function physicalDamageSeverity(event, hv) {
  if (!event) return { tier: 'none', basis: 'no_accident_event' };
  /* подія без якоря (запис площадки, страховий випадок, слова продавця):
     фізичного доказу тяжкості нема, стелі нема, штраф v4 лишається */
  if (event.anchored !== true) return { tier: 'none', basis: 'no_physical_evidence' };
  const h = hv && typeof hv === 'object' ? hv : null;
  if (h && h.fire_traces_visible === true) return { tier: 'extreme', basis: 'fire_traces_visible' };
  const basis = Array.isArray(event.category_basis) ? event.category_basis : [];
  const structuralBasis = basis.find(b => STRUCTURAL_BASIS.has(b));
  if (structuralBasis) return { tier: 'structural', basis: structuralBasis };
  /* архівних кадрів нема: тяжкість не встановлена, стелі нема (v4 уже дав unknown) */
  if (!h) return { tier: 'none', basis: 'historical_photos_unavailable' };
  if (h.cabin_intrusion_visible === true) return { tier: 'structural', basis: 'cabin_intrusion' };
  if (h.load_bearing_structure_deformation_visible === true) return { tier: 'structural', basis: 'load_bearing_deformation' };
  if (h.structural_visual_status === 'visible_damage') return { tier: 'structural', basis: 'structural_damage' };
  if (h.vehicle_disassembled_visible === true) return { tier: 'structural', basis: 'vehicle_disassembled' };
  if (h.damage_depth === 'load_bearing_structure' || h.damage_depth === 'cabin_intrusion') return { tier: 'structural', basis: 'damage_depth_' + h.damage_depth };
  const { category, basis: why } = classifyEventV4({ signals: {} }, h, new Set(Array.isArray(event.zone_classes) ? event.zone_classes : []), new Set());
  const last = why[why.length - 1] || category;
  if (category === 'heavy' || category === 'total') return { tier: 'serious', basis: last };
  if (innerDepthSeen(h) || basis.some(b => INNER_DEPTH_BASIS.has(b))) return { tier: 'inner_depth', basis: h.possible_structural_damage === true ? 'possible_structural_damage' : h.damage_depth === 'inner_structure_or_module' ? 'damage_depth_inner_structure_or_module' : 'inner_component_damage' };
  if (category === 'medium') return { tier: 'moderate', basis: last };
  if (category === 'light') return { tier: 'light', basis: last };
  return { tier: 'none', basis: 'severity_not_established' };
}

/* ---------- 2. поточні кадри: чи виглядає помірний зовнішній ремонт завершеним ----------
   Лише для tier moderate і лише коли HV бачив пошкодження однозначно на
   зовнішніх панелях: зона удару (класи front/rear/left/right/roof)
   достатньо видима на поточних кадрах і без суттєвого дефекту кузова в
   ній, або репайр уже підтверджений фактом (confirmed_ok,
   visually_consistent). Глибше пошкодження чистий зовнішній вигляд не
   знімає: правильність прихованого ремонту так не доводиться */
const CLASS_ZONES = {
  front: ['front', 'left_front', 'right_front', 'engine_bay'],
  rear: ['rear', 'left_rear', 'right_rear'],
  left: ['left_front', 'left_side', 'left_rear'],
  right: ['right_front', 'right_side', 'right_rear'],
  roof: ['roof'],
};
const BODY_DEFECT_TYPES = new Set(['dent', 'broken_element', 'missing_part', 'panel_misalignment', 'corrosion']);
export function repairLooksResolved(event, hv, currentVisual, bodyItems) {
  if (!event) return { resolved: false, basis: null };
  if (event.repair_status === 'confirmed_ok' || event.repair_status === 'visually_consistent') return { resolved: true, basis: 'repair_' + event.repair_status };
  if (event.unrepaired_signs === true) return { resolved: false, basis: 'unrepaired_signs' };
  if (!clearlyOuterOnly(hv)) return { resolved: false, basis: 'depth_not_clearly_outer' };
  const cv = currentVisual && typeof currentVisual === 'object' ? currentVisual : null;
  const sufficient = new Set(cv && cv.zones && Array.isArray(cv.zones.sufficient) ? cv.zones.sufficient : []);
  const classes = Array.isArray(event.zone_classes) ? event.zone_classes.filter(c => CLASS_ZONES[c]) : [];
  if (!sufficient.size || !classes.length) return { resolved: false, basis: 'accident_zone_not_shown' };
  for (const c of classes) {
    if (!CLASS_ZONES[c].some(z => sufficient.has(z))) return { resolved: false, basis: 'accident_zone_not_shown:' + c };
    const defect = (bodyItems || []).find(b => BODY_DEFECT_TYPES.has(b.type) && (b.zone_classes || []).includes(c));
    if (defect) return { resolved: false, basis: 'current_defect_in_zone:' + c };
  }
  return { resolved: true, basis: 'current_photos_consistent' };
}

/* ---------- 3. повнота доказів ----------
   Якість доказів неперервна, тому й відповідь стелі неперервна: у смузі
   band_hi -> band_lo домен лінійно знижує стелю на 0 -> 1.0, зниження
   доменів додаються, але повнота сама по собі ніколи не опускає стелю
   нижче floor. Винятки читаються з наявних даних, без зміни Confidence:
   history молодого авто (брак глибини природний), mileage з відомим
   поточним одометром (датованих точок нема, але цілісність це інший шар),
   not_applicable не рахується */
export function domainReduction(score, cfg = SCORE_CEILING_CONFIG) {
  const E = cfg.EVIDENCE;
  const v = num(score);
  if (v === null) return 0;
  return round2(Math.min(1, Math.max(0, (E.band_hi - v) / (E.band_hi - E.band_lo))));
}
export function evidenceCeiling(confidence, ctx = {}, cfg = SCORE_CEILING_CONFIG) {
  const E = cfg.EVIDENCE;
  const domains = confidence && confidence.domains && typeof confidence.domains === 'object' ? confidence.domains : null;
  if (!domains) return null;
  const ageMonths = num(ctx.ageMonths);
  const detail = {};
  let total = 0, considered = 0;
  for (const k of E.domains) {
    const d = domains[k];
    if (!d || d.status === 'not_applicable' || num(d.score_internal) === null) continue;
    considered++;
    const v = d.score_internal;
    const red = domainReduction(v, cfg);
    if (red === 0) { detail[k] = { score: v, reduction: 0 }; continue; }
    const inputs = Array.isArray(d.inputs) ? d.inputs : [];
    if (k === 'history' && ageMonths !== null && ageMonths < E.young_history_months) { detail[k] = { score: v, reduction: 0, exempt: 'young_vehicle' }; continue; }
    if (k === 'mileage' && inputs.some(i => i && i.key === 'current_odometer' && i.state === 'verified')) { detail[k] = { score: v, reduction: 0, exempt: 'odometer_known' }; continue; }
    detail[k] = { score: v, reduction: red };
    total = round2(total + red);
  }
  if (!considered) return null;
  const value = round2(Math.max(E.floor, cfg.DEFAULT - total));
  return { kind: 'evidence', value, reason_code: value < cfg.DEFAULT ? 'evidence_weak' : null, detail: { domains: detail, reduction: total } };
}

/* ---------- 4. цілісність пробігу ---------- */
export function mileageCeiling(breakdown, cfg = SCORE_CEILING_CONFIG) {
  const M = cfg.MILEAGE;
  const items = Array.isArray(breakdown && breakdown.items) ? breakdown.items : [];
  const rb = items.find(i => i.key === 'input5:rollback');
  if (rb) {
    const drop = num(rb.params && rb.params.drop_km) || 0;
    const major = drop >= M.major_drop_km;
    return { kind: 'mileage', value: major ? M.rollback_major : M.rollback, reason_code: major ? 'mileage_rollback_major' : 'mileage_rollback', detail: { drop_km: drop, stable_by: rb.params && rb.params.stable_by } };
  }
  if (items.some(i => i.key === 'input5:platform_flag')) return { kind: 'mileage', value: M.anomaly, reason_code: 'mileage_anomaly', detail: { source: 'platform_flag' } };
  const unresolved = Array.isArray(breakdown && breakdown.unresolved) ? breakdown.unresolved : [];
  const unstable = unresolved.find(u => u.key === 'mileage_inconsistency' && u.note_key === 'Single mileage drop without confirmation');
  if (unstable) return { kind: 'mileage', value: M.anomaly, reason_code: 'mileage_anomaly', detail: { source: 'single_drop_unconfirmed', ...(unstable.params || {}) } };
  return null;
}

/* ---------- 5. базова ідентичність ---------- */
export function coreIdentityConflicts(vehicleSpec, cfg = SCORE_CEILING_CONFIG) {
  const conflicts = vehicleSpec && Array.isArray(vehicleSpec.conflicts) ? vehicleSpec.conflicts : [];
  return conflicts.filter(f => cfg.IDENTITY_CORE.includes(f));
}

/* ---------- стеля минулого пошкодження ---------- */
export function damageCeiling(breakdown, ctx, cfg = SCORE_CEILING_CONFIG) {
  const events = Array.isArray(breakdown && breakdown.events) ? breakdown.events : [];
  const latest = events.find(e => e && e.latest) || null;
  const hv = ctx && ctx.historicalVisual && typeof ctx.historicalVisual === 'object' ? ctx.historicalVisual : null;
  const sev = physicalDamageSeverity(latest, hv);
  const D = cfg.DAMAGE;
  const detail = { basis: sev.basis, airbags: !!(latest && latest.airbags), event_id: latest ? latest.normalized_event_id : null };
  if (sev.tier === 'none' || sev.tier === 'light') return { kind: 'damage', value: D.light, reason_code: null, severity: sev.tier, detail };
  let value = D[sev.tier];
  let reason = { structural: 'structural_historical_damage', serious: 'serious_historical_damage', inner_depth: 'possible_structural_historical_damage', moderate: 'moderate_historical_damage', extreme: 'fire_damage' }[sev.tier];
  if (sev.tier === 'moderate') {
    const bodyItems = (breakdown.items || []).filter(i => i.input === 'body_condition');
    const rep = repairLooksResolved(latest, hv, ctx && ctx.currentVisual, bodyItems);
    detail.repair = rep.basis;
    if (rep.resolved) { value = D.light; reason = null; }
  }
  return { kind: 'damage', value, reason_code: reason, severity: sev.tier, detail };
}

/* штраф v4 за ту саму подію, що дала стелю ущерба: рядок останньої
   аварії і пожежа, привʼязана до цієї ж події */
function latestAccidentPenalty(breakdown) {
  const items = Array.isArray(breakdown && breakdown.items) ? breakdown.items : [];
  const latest = (breakdown.events || []).find(e => e && e.latest) || null;
  let sum = 0;
  const acc = items.find(i => i.input === 'accident_history' && String(i.key).startsWith('accident_latest_'));
  if (acc) sum += num(acc.amount) || 0;
  if (latest && latest.fire === true) { const f = items.find(i => i.key === 'fire_event'); if (f) sum += num(f.amount) || 0; }
  return round1(sum);
}

/* ---------- застосування: мутує breakdown v4 ----------
   ctx: { confidence, vehicleSpec, historicalVisual, currentVisual, ageMonths } */
export function applyScoreCeiling(breakdown, ctx = {}, cfg = SCORE_CEILING_CONFIG) {
  const b = breakdown;
  if (!b || typeof b !== 'object' || b.score_version !== 'v4') return b;
  const v4Final = num(b.final_if_eligible);
  const candidates = [];
  const dmg = damageCeiling(b, ctx, cfg);
  candidates.push(dmg);
  const evd = evidenceCeiling(ctx.confidence, ctx, cfg);
  if (evd) candidates.push(evd);
  const mil = mileageCeiling(b, cfg);
  if (mil) candidates.push(mil);
  let winner = null;
  for (const c of candidates) if (c.value < cfg.DEFAULT && (!winner || c.value < winner.value)) winner = c;
  const value = winner ? winner.value : cfg.DEFAULT;
  /* одна аварія один раз: якщо виграла стеля ущерба, просадка стелі і
     штраф v4 за цю ж подію беруться як більше з двох */
  /* просадка з двома знаками (стеля доказів неперервна, напр. 9.75);
     до одного знака округлюється лише підсумковий бал */
  const rawGap = round2(cfg.DEFAULT - value);
  const accidentOffset = winner && winner.kind === 'damage' ? latestAccidentPenalty(b) : 0;
  const gap = round2(Math.max(0, rawGap - accidentOffset));
  const core = coreIdentityConflicts(ctx.vehicleSpec, cfg);
  b.score_ceiling = {
    version: 'ceiling-v1',
    config_tag: cfg.CONFIG_TAG,
    value,
    active: value < cfg.DEFAULT,
    reason_code: winner ? winner.reason_code : null,
    reason_key: winner ? ceilingReasonKey(winner) : null,
    candidates,
    physical_severity: dmg.severity,
    accident_offset: accidentOffset,
    applied_gap: gap,
    v4_final: v4Final,
    identity_core_conflicts: core,
  };
  b.final_v4 = v4Final;
  if (v4Final !== null && gap > 0) {
    const capped = round1(Math.max(0, v4Final - gap));
    b.final_if_eligible = capped;
    if (b.score_available !== false) b.final = capped;
  }
  if (core.length) {
    b.score_available = false;
    b.score_eligible = false;
    b.score_unavailable_reason = 'core_identity_unresolved';
    b.final = null;
  }
  return b;
}

const REASON_KEYS = {
  moderate_historical_damage: SEVERITY_LABEL.moderate,
  possible_structural_historical_damage: SEVERITY_LABEL.inner_depth,
  serious_historical_damage: SEVERITY_LABEL.serious,
  structural_historical_damage: SEVERITY_LABEL.structural,
  fire_damage: SEVERITY_LABEL.extreme,
  evidence_weak: 'part of the data about this specific car could not be verified',
  mileage_anomaly: 'the mileage history has an unresolved inconsistency',
  mileage_rollback: 'the mileage decreased between dated records',
  mileage_rollback_major: 'the mileage decreased between dated records',
};
export function ceilingReasonKey(candidate) {
  return candidate && candidate.reason_code ? REASON_KEYS[candidate.reason_code] || null : null;
}
