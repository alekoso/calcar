/* CalCar Damage Score: стан авто саме з боку пошкоджень і відновлення.

   10 = мінімальні або локальні пошкодження, 0 = вкрай тяжкі.
   Це НЕ CalCar Score, НЕ ризик покупки і НЕ оцінка вигоди.

   ДРУГОЇ МОДЕЛІ ПОШКОДЖЕНЬ НЕМА. Тут немає жодної власної ваги: усі числа
   беруться з замороженої accident-моделі Check (SCORE_CONFIG_V3), а події,
   тяжкість, злиття і глибина рахують ті самі функції, що і в Check:
   resolveAccidentEvents, deriveSeverity, normalizeCurrentProblems,
   resolveDamageDepth. Цей модуль лише ВІДБИРАЄ, які з уже існуючих штрафів
   належать семантиці пошкоджень, і застосовує наявні капи.

   Що свідомо НЕ входить: пробіг, комплектація, ціна, відсутність ключів
   сама по собі, salvage-тайтл сам по собі, чесність продавця, типові
   слабкі місця моделі, кількість вірогідних позицій кошторису.

   Невідомо НЕ дорівнює погано: unknown ніколи не знижує бал, він лише не
   дає покриття. Замало доказів: score = null, UI показує прочерк. */
import {
  SCORE_CONFIG_V3 as CFG, resolveAccidentEvents, deriveSeverity, normalizeCurrentProblems,
} from './score-v3.js';
import { resolveDamageDepth } from './visual-signals.js';

/* штрафи, що описують САМЕ пошкодження. Решта CURRENT_PENALTIES (одометр,
   identity, лампи, модифікації, конфлікт пробігу) лишається поза Damage Score */
export const DAMAGE_PROBLEM_TYPES = new Set(['FLOOD', 'FIRE', 'SRS_FAULT', 'POOR_REPAIR_VISIBLE']);
const ACCIDENT_TYPES = new Set(['STRUCTURAL_DAMAGE', 'AIRBAGS_DEPLOYED', 'MAJOR_REPAIR_UNVERIFIED']);
const REPAIR_RANK = { confirmed_bad: 3, unknown: 2, visually_consistent: 1, confirmed_ok: 0 };
const SEV_RANK = { indeterminate: 0, minor: 1, moderate: 2, severe: 3 };

/* ярлики за балом; ключі англійські, переклад у словниках */
export const DAMAGE_LABELS = [
  { min: 8.5, key: 'Minor damage' },
  { min: 7.0, key: 'Moderate damage' },
  { min: 5.5, key: 'Serious damage' },
  { min: -1, key: 'Severe damage' },
];
/* історична тяжкість події задає ПІДЛОГУ ярлика: підтверджений якісний
   ремонт знижує залишковий ризик і піднімає бал, але severe-аварія не
   стає moderate-аварією заднім числом */
const SEVERITY_FLOOR_LABEL = { severe: 'Serious damage', moderate: 'Moderate damage', minor: 'Minor damage', indeterminate: null };
const LABEL_RANK = { 'Minor damage': 0, 'Moderate damage': 1, 'Serious damage': 2, 'Severe damage': 3 };

export function labelForDamage(score, maxSeverity) {
  const byScore = DAMAGE_LABELS.find(l => score >= l.min).key;
  const floor = SEVERITY_FLOOR_LABEL[maxSeverity] || null;
  if (!floor) return byScore;
  return LABEL_RANK[floor] > LABEL_RANK[byScore] ? floor : byScore;
}

/* ---- покриття: чи вистачає доказів САМЕ про пошкодження ----
   Кількість фото сама по собі показати бал не дозволяє. Потрібна базова
   присутність доказів І хоча б один змістовний сигнал: визначена глибина
   удару або сильний нормалізований сигнал тяжкості. */
export function damageCoverage(inp) {
  const i = inp && typeof inp === 'object' ? inp : {};
  const hv = i.hv || null;
  const photos = typeof i.photos_analyzed === 'number' ? i.photos_analyzed : 0;
  const base = photos >= 2 || i.auction_damage_known === true;
  const depthKnown = !!(hv && hv.damage_depth && hv.damage_depth !== 'indeterminate');
  const strong = [];
  if (hv) {
    if (hv.inner_component_deformation_visible === 'visible' || hv.inner_component_deformation_visible === true) strong.push('inner_module_deformation');
    if (hv.load_bearing_structure_deformation_visible === true) strong.push('load_bearing_deformation');
    if (hv.cabin_intrusion_visible === true) strong.push('cabin_intrusion');
    if (hv.wheel_displacement_visible === true) strong.push('wheel_displacement');
    if (hv.srs_visual_status === 'deployed_visible') strong.push('airbags_deployed_visible');
    if (hv.structural_visual_status === 'visible_damage') strong.push('structural_visible');
    if (hv.cosmetic_only === true) strong.push('cosmetic_only_confirmed');
  }
  if (i.airbags_deployed_confirmed === true) strong.push('airbags_deployed_auction');
  if (i.flood_confirmed === true) strong.push('flood_confirmed');
  if (i.fire_confirmed === true) strong.push('fire_confirmed');
  return {
    base_evidence: base,
    depth_known: depthKnown,
    strong_signals: strong,
    sufficient: base && (depthKnown || strong.length > 0),
    photos_analyzed: photos,
  };
}

/* ---- сам бал ----
   inp: { findings, auctionMeta, hv, coverage }
   findings і auctionMeta у тій самій формі, що приймає Check. */
export function computeDamageScore(inp, cfg = CFG) {
  const i = inp && typeof inp === 'object' ? inp : {};
  const rawHv = i.hv && typeof i.hv === 'object' ? i.hv : null;
  /* глибина валідується кодом проти спостережень, як у Check */
  const hv = rawHv ? { ...rawHv, ...resolveDamageDepth(rawHv) } : null;
  const findings = Array.isArray(i.findings) ? i.findings : [];
  const coverage = damageCoverage({ ...(i.coverage || {}), hv });

  const events = resolveAccidentEvents(findings, {
    auctionMeta: i.auctionMeta || null,
    historicalVisual: hv,
    accidentRecord: i.accidentRecord || null,
  }).map(ev => {
    const { severity, basis } = deriveSeverity(ev);
    let repair = null;
    for (const r of ev.repair_statuses) if (repair === null || REPAIR_RANK[r] > REPAIR_RANK[repair]) repair = r;
    const mult = cfg.REPAIR_MULTIPLIER[repair || 'unknown'];
    let penalty = Math.round((cfg.ACCIDENT_BASE + cfg.SEVERITY_ADDITIONAL[severity] * mult) * 100) / 100;
    let residual = false;
    if (severity === 'severe' && penalty < cfg.SEVERE_MIN_RESIDUAL) { penalty = cfg.SEVERE_MIN_RESIDUAL; residual = true; }
    return {
      normalized_event_id: ev.normalized_event_id,
      derived_severity: severity, severity_basis: basis,
      repair_status: repair, repair_multiplier: mult,
      minimum_residual_if_applied: residual ? cfg.SEVERE_MIN_RESIDUAL : null,
      final_event_penalty: penalty,
      airbags: ev.signals.airbags, structural: ev.signals.structural,
    };
  });
  const accidentPenalty = events.reduce((s, e) => s + e.final_event_penalty, 0);

  /* SRS restoration: та сама умова, що в Check, один concern на авто */
  const problems = normalizeCurrentProblems(findings.filter(f => f && !ACCIDENT_TYPES.has(f.type)));
  const hasSrsFault = problems.some(p => p.type === 'SRS_FAULT');
  const unresolvedSafety = [];
  for (const ev of events) {
    if (ev.airbags && ev.repair_status !== 'confirmed_ok' && !hasSrsFault) {
      unresolvedSafety.push({ type: 'SRS_RESTORATION_UNVERIFIED', penalty: cfg.SRS_RESTORATION_UNVERIFIED, event: ev.normalized_event_id });
      break;
    }
  }
  const safetyPenalty = unresolvedSafety.reduce((s, u) => s + u.penalty, 0);

  const damageProblems = problems.filter(p => DAMAGE_PROBLEM_TYPES.has(p.type))
    .map(p => ({ ...p, penalty: cfg.CURRENT_PENALTIES[p.type] }));
  const problemPenalty = damageProblems.reduce((s, p) => s + p.penalty, 0);

  const raw = Math.round((10 - accidentPenalty - safetyPenalty - problemPenalty) * 100) / 100;

  /* капи: ті самі, що в Check, і лише ті, що семантично про пошкодження */
  const caps = [];
  for (const ev of events) {
    if (ev.structural && ev.repair_status !== 'confirmed_ok') caps.push({ name: 'hard_cap:STRUCTURAL_UNRESOLVED', value: cfg.STRUCTURAL_UNRESOLVED_CAP });
    if (ev.airbags && ev.repair_status === 'confirmed_bad') caps.push({ name: 'hard_cap:SRS_STRONG_EVIDENCE', value: cfg.SRS_STRONG_EVIDENCE_CAP });
  }
  for (const p of damageProblems) {
    if (cfg.HARD_CAPS[p.type] !== undefined) caps.push({ name: 'hard_cap:' + p.type, value: cfg.HARD_CAPS[p.type] });
    if (p.type === 'SRS_FAULT') caps.push({ name: 'hard_cap:SRS_STRONG_EVIDENCE', value: cfg.SRS_STRONG_EVIDENCE_CAP });
  }
  const bounded = Math.min(raw, ...caps.map(c => c.value), 10);
  const score = Math.round(Math.max(0, bounded) * 10) / 10;

  let maxSeverity = 'indeterminate';
  for (const ev of events) if (SEV_RANK[ev.derived_severity] > SEV_RANK[maxSeverity]) maxSeverity = ev.derived_severity;
  /* відновлення підтверджене об'єктивно: показуємо це поруч із ярликом,
     щоб вищий бал при severe-історії не читався як легша аварія */
  const restored = events.length > 0 && events.every(e => e.repair_status === 'confirmed_ok');

  const out = {
    damage_score_v: 1,
    accident_events: events,
    unresolved_safety_concerns: unresolvedSafety,
    damage_problems: damageProblems,
    accident_penalty: Math.round(accidentPenalty * 100) / 100,
    safety_penalty: safetyPenalty,
    problem_penalty: problemPenalty,
    raw_score: raw,
    applied_hard_caps: caps,
    max_event_severity: maxSeverity,
    restoration_confirmed: restored,
    coverage,
    resolved_hv: hv ? { damage_depth: hv.damage_depth, damage_depth_claimed: hv.damage_depth_claimed, damage_depth_downgraded: hv.damage_depth_downgraded, inner_component_damage_extent: hv.inner_component_damage_extent } : null,
  };
  if (!coverage.sufficient) {
    return { ...out, score_available: false, score: null, label_key: null,
      unavailable_reason: 'недостатньо доказів про пошкодження: глибина удару і сильні сигнали не визначені' };
  }
  return { ...out, score_available: true, score, label_key: labelForDamage(score, maxSeverity) };
}
