/* CalCar Score Ceiling v2: обмежений шар над Score v4, не Score v5.

   Score v4 відповідає "які підтверджені негативи є в цього авто" і
   рахує штрафи від 10. Цей шар відповідає "наскільки високий бал CalCar
   може обґрунтовано захистити, знаючи САМЕ ЦЕ авто". Межі рахуються
   з того самого нормалізованого evidence, що вже є у звіті (без нових
   викликів моделі). Без меж бал побайтово дорівнює Score v4. Стелі
   ризику ніколи не додаються: береться НАЙСУВОРІША застосовна, решта
   зберігається для пояснення.

   Три джерела стелі:
   1. фізична тяжкість минулого пошкодження з Historical Vision і
      нормалізованих фізичних знахідок по цьому VIN. НЕ з подушок (легкий
      удар теж розкриває подушку) і НЕ з адміністративних ярликів: salvage,
      rebuilt, total loss, страховик, сам факт аукціону чи титул ринку
      походження стелі не дають. Подія невідомої тяжкості це звичайний
      штраф v4 (unknown 0.5), а не стеля;
   2. повнота доказів: ОДНА модель доказів, Confidence (coverage-v2,
      lifecycle-aware): її проєкція score_basis плавно задає межу E
      (EVIDENCE.curve, підлога 8.0). Вік і пробіг самі по собі нічого не
      віднімають: вони лише піднімають очікування доказів усередині
      Confidence. Невідоме не є дефектом і не стає рядком штрафу, але
      невідоме робить підсумок обережнішим: композиція стартує з E, а не
      з 10, тож дві однакові авто з однаковими дефектами, одне зрозуміле,
      інше чорна скринька, отримують різний бал;
   3. цілісність пробігу: не "мало точок", а реальна аномалія чи відкат.

   Одна аварія не рахується двічі: для події, що дала переможну стелю
   ущерба, її штраф v4 і просадка стелі беруться як більше з двох, а не
   сума. Незалежні штрафи (скло, салон, інший дефект кузова, друга подія,
   страховий випадок) віднімаються як завжди.

   Композиція (ceiling-v2):
       final = E - risk - independent
   де E = межа доказів, risk = max(10 - R, штраф v4 за подію, що дала R)
   для найсуворішої стелі ризику R (ущерб чи цілісність пробігу; стелі не
   додаються), independent = штрафи v4 без того, яким володіє R. Те саме
   число: final = v4 - (10 - E) - max(0, (10 - R) - штраф_R).

   Окремо: нерозвʼязаний конфлікт базової ідентичності (модель, двигун,
   коробка, привід) не дає числа взагалі: score_available = false,
   reason core_identity_unresolved. Модуль чистий і не залежить від
   ринку: без мережі, без моделі, без назв країн. */
import { classifyEventV4 } from './score-v4.js';
import { IDENTITY_CORE_FIELDS } from './vehicle-spec.js';

export const SCORE_CEILING_CONFIG = {
  CONFIG_TAG: 'ceiling-v2-2026-10-08',
  VERSION: 'ceiling-v2',
  DEFAULT: 10,
  /* стартове калібрування власника (2026-10-07); числа підлягають
     звірці на калібрувальному корпусі перед викаткою */
  DAMAGE: { light: 10, moderate: 9.0, inner_depth: 8.0, serious: 7.5, structural: 6.5, extreme: 6.0 },
  /* межа доказів E = кусково-лінійна крива від score_basis Confidence v2
     (уже з капами). Між вузлами лінійно, нижче першого вузла підлога, вище
     останнього 10.
     Калібрування 2026-10-08 під віднімальну композицію: "дані обмежені"
     (<40) не вище ~8.2, "перевірено частково" (40..69) 8.2..9.1, "достатньо
     даних" (70..84) 9.1..9.5, "вивчено детально" (85+) 9.5..9.9, рівно 10
     лише при фактично повних доказах (100); підлога 8.0 при 35 і нижче */
  EVIDENCE: { curve: [[35, 8.0], [40, 8.2], [55, 8.7], [70, 9.1], [85, 9.5], [95, 9.9], [100, 10]], floor: 8.0 },
  MILEAGE: { anomaly: 8.0, rollback: 7.0, rollback_major: 6.5, major_drop_km: 60000 },
  /* базова ідентичність: конфлікт сильних джерел у цих полях = числа нема.
     Версія, кузов, рік і опції не блокують бал */
  /* the one list lives in vehicle-spec (identityStatus reads the same one) */
  IDENTITY_CORE: IDENTITY_CORE_FIELDS,
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
   Confidence v2 вже знає життєвий цикл (очікування точок пробігу і
   охоплення історії ростуть з віком і пробігом), тому стеля читає лише
   її підсумок: жодної другої моделі покриття. Крива неперервна: один
   додатковий доказ зсуває підсумок на кілька пунктів і стелю на соті.
   Прогалини (gaps) для пояснення беруться з входів доменів Confidence
   детерміновано; вони не змінюють числа */
export function evidenceCeilingValue(overall, cfg = SCORE_CEILING_CONFIG) {
  const E = cfg.EVIDENCE;
  const v = num(overall);
  if (v === null) return null;
  const pts = E.curve;
  if (v <= pts[0][0]) return E.floor;
  if (v >= pts[pts.length - 1][0]) return cfg.DEFAULT;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (v <= x1) return round2(Math.max(E.floor, y0 + (y1 - y0) * (v - x0) / (x1 - x0)));
  }
  return cfg.DEFAULT;
}
const GAP_KEYS = {
  mileage_points: 'few historical mileage records',
  history_span: 'the car\'s past is covered only partially',
  history_sources: 'history sources did not answer',
  photos: 'few usable photos or zones',
  identity: 'vehicle identification is incomplete',
};
export function evidenceGaps(confidence) {
  const d = confidence && confidence.domains && typeof confidence.domains === 'object' ? confidence.domains : {};
  const inputOf = (dom, key) => { const x = d[dom]; const list = x && Array.isArray(x.inputs) ? x.inputs : []; return list.find(i => i && i.key === key) || null; };
  const gaps = [];
  const mp = inputOf('mileage', 'historical_points');
  if (mp && mp.max > 0 && mp.earned / mp.max < 0.5 && mp.state !== 'not_expected') gaps.push('mileage_points');
  const span = inputOf('history', 'history_span');
  if (span && span.max > 0 && span.earned / span.max < 0.5) gaps.push('history_span');
  const srcMissing = ['auction_history', 'registry', 'previous_listings'].map(k => inputOf('history', k)).filter(i => i && i.max > 0 && (i.state === 'unavailable' || i.state === 'blocked'));
  if (srcMissing.length) gaps.push('history_sources');
  if (d.photos && typeof d.photos.score_internal === 'number' && d.photos.score_internal < 60) gaps.push('photos');
  if (d.identity && typeof d.identity.score_internal === 'number' && d.identity.score_internal < 60) gaps.push('identity');
  return gaps;
}
export function evidenceCeiling(confidence, ctx = {}, cfg = SCORE_CEILING_CONFIG) {
  if (!confidence || typeof confidence !== 'object') return null;
  /* основа: score_basis.overall (проєкція Confidence v2 без входів, якими
     володіє інший шар Score), інакше показаний підсумок (знімки v1) */
  const basis = confidence.score_basis && num(confidence.score_basis.overall) !== null ? confidence.score_basis.overall : num(confidence.overall_internal);
  if (basis === null) return null;
  const value = evidenceCeilingValue(basis, cfg);
  const gaps = evidenceGaps(confidence);
  return { kind: 'evidence', value, reason_code: value < cfg.DEFAULT ? 'evidence_insufficient' : null, detail: { overall: num(confidence.overall_internal), basis, excluded: confidence.score_basis ? confidence.score_basis.excluded : [], confidence_version: confidence.confidence_version || null, gaps, gap_keys: gaps.map(g => GAP_KEYS[g]) } };
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
/* штраф v4, яким володіє стеля цілісності пробігу (відкат чи прапор площадки) */
function rollbackPenalty(breakdown) {
  const items = Array.isArray(breakdown && breakdown.items) ? breakdown.items : [];
  return round1(items.filter(i => i.key === 'input5:rollback' || i.key === 'input5:platform_flag').reduce((s, i) => s + (num(i.amount) || 0), 0));
}

/* ---------- застосування: мутує breakdown v4 ----------
   ctx: { confidence, vehicleSpec, historicalVisual, currentVisual } */
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
  /* стеля ризику R: найсуворіша з ущербу і цілісності пробігу (не додаються);
     її просадка = більше з (10 - R) і штрафу v4 за ту саму подію, тобто
     понад штраф v4 віднімається лише max(0, (10 - R) - штраф_R) */
  let risk = null;
  for (const c of candidates) if (c.kind !== 'evidence' && c.value < cfg.DEFAULT && (!risk || c.value < risk.value)) risk = c;
  const riskPenalty = risk ? (risk.kind === 'damage' ? latestAccidentPenalty(b) : rollbackPenalty(b)) : 0;
  const riskGap = risk ? round2(Math.max(0, round2(cfg.DEFAULT - risk.value) - riskPenalty)) : 0;
  /* межа доказів E: підсумок стартує з E, а не з 10 */
  const evidenceMax = evd ? evd.value : cfg.DEFAULT;
  const evidenceGap = round2(cfg.DEFAULT - evidenceMax);
  const rawSum = num(b.raw_sum) !== null ? b.raw_sum : (v4Final === null ? 0 : round2(cfg.DEFAULT - v4Final));
  const independent = round2(Math.max(0, rawSum - riskPenalty));
  const capped = v4Final === null ? null : round1(Math.max(0, v4Final - evidenceGap - riskGap));
  /* пояснення: головна причина = більша з просадок; стеля ризику з нульовою
     просадкою (офсет аварії) лишається поясненням, коли доказів досить */
  let winner = null;
  if (risk && riskGap > 0 && (!evd || riskGap >= evidenceGap)) winner = risk;
  else if (evd && evidenceGap > 0) winner = evd;
  else if (risk) winner = risk;
  const value = Math.min(risk ? risk.value : cfg.DEFAULT, evidenceMax);
  const core = coreIdentityConflicts(ctx.vehicleSpec, cfg);
  b.score_ceiling = {
    version: cfg.VERSION,
    config_tag: cfg.CONFIG_TAG,
    value,
    active: !!winner,
    bound: evidenceGap > 0 || riskGap > 0,
    reason_code: winner ? winner.reason_code : null,
    reason_key: winner ? ceilingReasonKey(winner) : null,
    /* прогалини доказів для пояснення в UI */
    gap_keys: evd && evidenceGap > 0 ? evd.detail.gap_keys : [],
    candidates,
    physical_severity: dmg.severity,
    /* явна композиція для UI і реплею */
    composition: {
      evidence_max: evidenceMax, evidence_gap: evidenceGap,
      risk: risk ? { kind: risk.kind, value: risk.value, reason_code: risk.reason_code, reason_key: ceilingReasonKey(risk), penalty_owned: riskPenalty, reduction: riskGap } : null,
      independent_penalties: independent,
      /* підтверджені недоліки разом: незалежні штрафи плюс просадка ризику понад її штраф */
      confirmed_total: round1(independent + riskPenalty + riskGap),
      final: capped,
    },
    accident_offset: risk && risk.kind === 'damage' ? riskPenalty : 0,
    applied_gap: riskGap,
    v4_final: v4Final,
    identity_core_conflicts: core,
  };
  b.final_v4 = v4Final;
  if (v4Final !== null && capped !== null && capped !== v4Final) {
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
  evidence_insufficient: 'the score is limited by incomplete data about this car',
  mileage_anomaly: 'the mileage history has an unresolved inconsistency',
  mileage_rollback: 'the mileage decreased between dated records',
  mileage_rollback_major: 'the mileage decreased between dated records',
};
export function ceilingReasonKey(candidate) {
  return candidate && candidate.reason_code ? REASON_KEYS[candidate.reason_code] || null : null;
}
