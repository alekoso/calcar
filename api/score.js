/* CalCar Score v2: детермінована оцінка Check.
   Розподіл ролей: модель КЛАСИФІКУЄ знахідки (score_facts), код ЗНАЄ джерела
   (coverage з фактів пайплайна), формула РАХУЄ бал. Жодної мережі, жодних
   звернень до моделі: чиста функція computeScore(findings, coverage).
   Тіньовий режим: користувач бачить легасі verdict.score, v2 живе поруч. */

/* ================= КАЛІБРУЄТЬСЯ =================
   УСІ числа оцінки живуть у цьому конфігу і ніде більше. */
export const SCORE_CONFIG = {
  /* стеля довіри: база + бонуси за реально наявні джерела, капиться зверху */
  BASE_CEILING: 5.0,
  CEILING_MAX: 9.5,
  COVERAGE_BONUS: {
    vin_decoded: 0.75,
    photos_ok: 0.75,
    historical_listings: 0.7,
    mileage_history: 0.7,
    registration_data: 0.4,
    auction_record: 0.7,
    service_history: 0.5,
    inspection_history: 0.5,
    seller_docs: 0.3,
  },
  /* пороги достатності джерел */
  PHOTOS_OK_MIN: 6,          /* стільки фото вважаємо повноцінним оглядом */
  HISTORICAL_LISTINGS_MIN: 1,
  MILEAGE_OBS_MIN: 2,        /* менше двох незалежних точок це не хронологія */
  /* штрафи: один тип знахідки = одне число, штраф за ПОДІЮ, не за джерело */
  PENALTIES: {
    STRUCTURAL_DAMAGE: 2.0,
    AIRBAGS_DEPLOYED: 1.2,
    SRS_FAULT: 1.5,
    FLOOD: 3.0,
    FIRE: 3.5,
    ODOMETER_ROLLBACK: 2.5,
    VIN_IDENTITY_PROBLEM: 4.0,
    SERIOUS_POWERTRAIN_FAULT: 1.5,
    POOR_REPAIR_VISIBLE: 1.0,
    CRITICAL_WARNING_LIGHTS: 0.8,
    MILEAGE_CONFLICT_UNEXPLAINED: 0.5,
    MAJOR_REPAIR_UNVERIFIED: 0.4,
    MODIFICATION_TECHNICAL_CONCERN: 0.3,
  },
  /* помʼякшення: підтверджено якісний ремонт зменшує штраф */
  SOFTENED_PENALTIES: {
    STRUCTURAL_DAMAGE: { confirmed_ok: 1.0 },
    AIRBAGS_DEPLOYED: { confirmed_ok: 0.4 },
  },
  /* жорсткі капи підсумку за типом знахідки */
  HARD_CAPS: {
    ODOMETER_ROLLBACK: 4.5,
    FLOOD: 4.5,
    FIRE: 4.5,
    VIN_IDENTITY_PROBLEM: 3.5,
  },
  /* структурне пошкодження без підтвердженого ремонту: окремий кап.
     repair_status відсутній чи unknown = ремонт не підтверджений */
  STRUCTURAL_UNKNOWN_CAP: 5.5,
  /* пороги grade рахуються з ФІНАЛЬНОГО балу, капи вдруге не застосовуються */
  GRADE_THRESHOLDS: [
    { min: 8.5, grade: 'buy' },
    { min: 7.0, grade: 'inspect' },
    { min: 5.5, grade: 'caution' },
    { min: 0, grade: 'avoid' },
  ],
};

export const CONFIRMED_RISK_TYPES = [
  'STRUCTURAL_DAMAGE', 'AIRBAGS_DEPLOYED', 'SRS_FAULT', 'FLOOD', 'FIRE',
  'ODOMETER_ROLLBACK', 'VIN_IDENTITY_PROBLEM', 'SERIOUS_POWERTRAIN_FAULT',
  'POOR_REPAIR_VISIBLE', 'CRITICAL_WARNING_LIGHTS',
];
export const OPEN_QUESTION_TYPES = [
  'MILEAGE_CONFLICT_UNEXPLAINED', 'MAJOR_REPAIR_UNVERIFIED', 'MODIFICATION_TECHNICAL_CONCERN',
];
const ALL_TYPES = new Set([...CONFIRMED_RISK_TYPES, ...OPEN_QUESTION_TYPES]);
const EVIDENCE_SOURCES = new Set(['seller_claim', 'current_photos', 'historical_listing', 'us_auction', 'registry', 'document']);
const REPAIR_STATUSES = new Set(['confirmed_ok', 'unknown', 'confirmed_bad']);

const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;
const EPS = 1e-9;

/* строга валідація: сміття логуються і пропускаються, розрахунок не падає */
function sanitizeFindings(findings) {
  const ok = [];
  let dropped = 0;
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || typeof f !== 'object' || Array.isArray(f) || !ALL_TYPES.has(f.type)) {
      dropped++;
      console.log('[score] відкинута знахідка:', JSON.stringify(f).slice(0, 200));
      continue;
    }
    const evidence = (Array.isArray(f.evidence) ? f.evidence : [])
      .filter(e => e && typeof e === 'object' && EVIDENCE_SOURCES.has(e.source))
      .map(e => ({
        source: e.source,
        ref: typeof e.ref === 'string' ? e.ref.slice(0, 60) : null,
        description: typeof e.description === 'string' ? e.description.slice(0, 300) : null,
      }));
    ok.push({
      type: f.type,
      event_id: (typeof f.event_id === 'string' || typeof f.event_id === 'number') ? String(f.event_id).slice(0, 60) : null,
      severity: typeof f.severity === 'string' ? f.severity.slice(0, 10) : null,
      repair_status: REPAIR_STATUSES.has(f.repair_status) ? f.repair_status : null,
      evidence,
    });
  }
  return { ok, dropped };
}

/* дедуплікація: один type + один event_id = ОДНА подія з обʼєднаними evidence.
   repair_status береться найгірший: confirmed_bad > unknown > confirmed_ok */
const REPAIR_RANK = { confirmed_bad: 2, unknown: 1, confirmed_ok: 0 };
function dedupeFindings(findings) {
  const map = new Map();
  findings.forEach((f, i) => {
    const key = f.type + '|' + (f.event_id === null ? '__auto_' + i : f.event_id);
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...f, evidence: [...f.evidence] }); return; }
    cur.evidence.push(...f.evidence);
    const a = cur.repair_status === null ? 1 : REPAIR_RANK[cur.repair_status];
    const b = f.repair_status === null ? 1 : REPAIR_RANK[f.repair_status];
    if (b > a) cur.repair_status = f.repair_status;
    if (!cur.severity && f.severity) cur.severity = f.severity;
  });
  return [...map.values()];
}

/* доступність джерел: стани present / absent / not_applicable і бонус.
   not_applicable (авто, якому джерела бути не повинно): бонус не нараховується
   і не вимагається; сума решти джерел дозволяє дійти до стелі */
function buildCoverage(inputs, cfg) {
  const i = inputs && typeof inputs === 'object' ? inputs : {};
  const n = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  const states = {
    vin_decoded: i.vin_decoded ? 'present' : 'absent',
    photos_ok: n(i.photos_count) >= cfg.PHOTOS_OK_MIN ? 'present' : 'absent',
    historical_listings: n(i.historical_listings_count) >= cfg.HISTORICAL_LISTINGS_MIN ? 'present' : 'absent',
    mileage_history: n(i.mileage_observation_count) >= cfg.MILEAGE_OBS_MIN ? 'present' : 'absent',
    registration_data: i.registration_data_exists ? 'present' : 'absent',
    auction_record: (i.auction_applicable === false && !i.auction_record_exists)
      ? 'not_applicable'
      : (i.auction_record_exists ? 'present' : 'absent'),
    service_history: i.service_history_exists ? 'present' : 'absent',
    inspection_history: i.inspection_history_exists ? 'present' : 'absent',
    seller_docs: i.seller_docs_exists ? 'present' : 'absent',
  };
  const coverage = {};
  let ceiling = cfg.BASE_CEILING;
  for (const [src, state] of Object.entries(states)) {
    const bonus = state === 'present' ? cfg.COVERAGE_BONUS[src] : 0;
    ceiling += bonus;
    coverage[src] = { state, bonus };
  }
  return { coverage, ceiling: round2(Math.min(cfg.CEILING_MAX, ceiling)) };
}

export function gradeFromScore(score, cfg = SCORE_CONFIG) {
  for (const t of cfg.GRADE_THRESHOLDS) if (score >= t.min) return t.grade;
  return cfg.GRADE_THRESHOLDS[cfg.GRADE_THRESHOLDS.length - 1].grade;
}

export function computeScore(findings, coverageInputs, cfg = SCORE_CONFIG) {
  const { ok, dropped } = sanitizeFindings(findings);
  const events = dedupeFindings(ok);
  const { coverage, ceiling } = buildCoverage(coverageInputs, cfg);

  /* штрафи: за подію, з помʼякшенням за підтверджений ремонт */
  const penalties = events.map(f => {
    const soft = cfg.SOFTENED_PENALTIES[f.type];
    const amount = (soft && f.repair_status && soft[f.repair_status] !== undefined)
      ? soft[f.repair_status]
      : cfg.PENALTIES[f.type];
    return { type: f.type, event_id: f.event_id, amount: -amount, repair_status: f.repair_status, severity: f.severity, evidence: f.evidence };
  });
  const penaltySum = penalties.reduce((s, p) => s - p.amount, 0);
  const raw = 10 - penaltySum;

  /* жорсткі капи, що застосувались до цього авто */
  const caps = [];
  for (const f of events) {
    if (cfg.HARD_CAPS[f.type] !== undefined) caps.push({ name: 'hard_cap:' + f.type, value: cfg.HARD_CAPS[f.type] });
    if (f.type === 'STRUCTURAL_DAMAGE' && f.repair_status !== 'confirmed_ok' && f.repair_status !== 'confirmed_bad') {
      caps.push({ name: 'hard_cap:STRUCTURAL_DAMAGE', value: cfg.STRUCTURAL_UNKNOWN_CAP });
    }
  }

  /* підсумок = min(стеля, 10 - штрафи, капи), підлога 0.
     Обмежувачі визначаються ПО НЕОКРУГЛЕНИХ значеннях: випадковий збіг після
     округлення не має створювати фальшиву причину */
  const unfloored = Math.min(ceiling, raw, ...caps.map(c => c.value));
  const limiting = [];
  if (unfloored > 0) {
    if (Math.abs(ceiling - unfloored) < EPS) limiting.push('coverage');
    for (const c of caps) {
      if (Math.abs(c.value - unfloored) < EPS && !limiting.includes(c.name)) limiting.push(c.name);
    }
  }
  const final = round1(Math.max(0, unfloored));

  const reasons = [];
  if (limiting.includes('coverage')) reasons.push('оцінка обмежена покриттям даних: стеля ' + ceiling);
  for (const l of limiting) {
    if (l.startsWith('hard_cap:')) reasons.push('жорсткий кап ' + l.slice(9));
  }

  return {
    score_v: 2,
    final,
    grade: gradeFromScore(final, cfg),
    raw: round1(raw),
    coverage_cap: ceiling,
    coverage,
    coverage_inputs: coverageInputs && typeof coverageInputs === 'object' ? coverageInputs : {},
    penalties,
    dropped_findings: dropped,
    limiting_factors: limiting,
    score_limited_by_data: limiting.includes('coverage'),
    score_limit_reason: reasons.length ? reasons.join('; ') : null,
  };
}
