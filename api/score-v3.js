/* CalCar Score v3: перекалібрована детермінована оцінка ЯКОСТІ і
   vehicle-specific ризику конкретного екземпляра, НЕЗАЛЕЖНО від ціни.

   Ролі ті самі, що у v2: LLM витягує structured evidence, КОД нормалізує,
   групує, дедуплікує, виводить severity, застосовує repair-модифікатори,
   рахує штрафи, coverage і капи. LLM не генерує числових штрафів і не
   керує математично значущим event_id.

   Головні відмінності від v2:
   - ДТП рахуються на рівні NORMALIZED accident event: одна реальна аварія,
     знайдена через аукціон + історичні фото + запис площадки + знахідки
     моделі, це ОДНА подія (deterministic resolver, а не event_id від LLM);
   - severity (minor|moderate|severe|indeterminate) виводить КОД зі
     structured evidence (structural, подушки, кількість зон, візуальна
     тяжкість), не слово моделі;
   - подушки це вхід severity + обмежений unresolved-SRS concern, а НЕ
     другий штраф за ту саму аварію і НЕ дефолтний кап 7.0;
   - coverage міряє ГЛИБИНУ перевірки доменів (checked_absent теж заробляє
     покриття, not_applicable чесно виключається), впливає лише на верх
     шкали і ніколи не підвищує raw_quality;
   - анти-дабл-каунтинг поширений на поточні технічні проблеми
     (warning light + діагностована несправність = одна underlying проблема);
   - у Score НЕ входять: ціна, вигідність, комплектація, країна походження,
     маркетплейс, суперечності продавця як окрема числова вісь, generic
     болячки моделі без evidence на цій машині, відсутність даних як мінус.
     unknown != bad; positive_verified_bonus = 0 (гак на майбутнє).

   Версіювання: v2 живе поруч (api/score.js) і НЕ видаляється; активну
   версію обирає диспетчер у api/check.js (env CALCAR_SCORE_VERSION),
   rollback це перемикання конфігурації, не revert коміту. */

/* ================= КАЛІБРУЄТЬСЯ: усі числа v3 тут =================
   Статус: v3 INITIAL PRODUCTION CALIBRATION (2026-08-29, коміт 3961e3b+).
   Перегляд коефіцієнтів: після достатньої вибірки, орієнтир 50+ реальних
   accident events у корпусі (усі валідні продові Check зберігаються в
   reports; curated gold-набір живе у calibration-gold.json).
   Watchpoints без зміни коефіцієнтів: indeterminate-ДТП ~9.2-9.3,
   moderate + unknown repair ~8.7 (у стелі), ACCIDENT_BASE 0.3 */
export const SCORE_CONFIG_V3 = {
  CALIBRATION_TAG: 'v3-initial-2026-08-29',
  STARTING_SCORE: 10,

  /* ---- coverage: глибина перевірки інформаційних ДОМЕНІВ.
     Домен заробляє внесок, якщо він applicable і УСПІШНО перевірений:
     record found АБО checked_absent. source_unreachable і unknown внеску
     не дають. not_applicable виключається з очікування (внесок earned:
     непридатний домен не робить дослідження неповним). Coverage впливає
     лише на СТЕЛЮ (верх шкали) і ніколи не чіпає raw_quality ---- */
  BASE_CEILING: 8.0,
  CEILING_MAX: 9.8,
  COVERAGE_DOMAINS: {
    identity: 0.2,           /* VIN-декод або держреєстр підтвердили авто */
    current_photos: 0.2,     /* достатньо поточних кадрів для visual-домену */
    history_records: 0.35,   /* реєстраційні/платформенні історичні записи */
    mileage_timeline: 0.35,  /* незалежні датовані точки пробігу */
    auction_history: 0.5,    /* аукціонна історія: found АБО checked_absent */
  },
  PHOTOS_DOMAIN_MIN: 6,      /* поріг ДОМЕНУ фото, не eligibility */
  MILEAGE_OBS_MIN: 2,

  /* ---- нормалізовані accident events ---- */
  ACCIDENT_BASE: 0.3,        /* підтверджене ДТП саме по собі: малий базовий вплив,
                                але помітний на кроці 0.1 навіть при повній стелі */
  SEVERITY_ADDITIONAL: { minor: 0.2, moderate: 1.0, severe: 2.4, indeterminate: 0 },
  /* visually_consistent означає ЛИШЕ "на доступних поточних кадрах
     пошкоджені зони без видимих протиріч із відновленням": це НЕ перевірка
     геометрії, зварних швів, силових елементів чи SRS. Тому він
     НЕЙТРАЛЬНИЙ (1.0), як і unknown: факт лишається у звіті, але числового
     бонуса авто не дає. Знижку дає лише confirmed_ok з обʼєктивним
     підтвердженням якості відновлення */
  REPAIR_MULTIPLIER: { confirmed_ok: 0.6, visually_consistent: 1.0, unknown: 1.0, confirmed_bad: 1.0 },
  /* підтверджений ремонт не стирає severe-історію: мінімальний residual */
  SEVERE_MIN_RESIDUAL: 1.0,

  /* ---- unresolved safety: подушки розкривались, SRS потребувала
     відновлення, підтвердження нема. Це НЕ штраф за unknown і НЕ кап ---- */
  SRS_RESTORATION_UNVERIFIED: 0.6,

  /* ---- поточні і незалежні проблеми (за нормалізовану проблему) ---- */
  CURRENT_PENALTIES: {
    SRS_FAULT: 1.5,
    SERIOUS_POWERTRAIN_FAULT: 1.5,
    POOR_REPAIR_VISIBLE: 1.0,
    CRITICAL_WARNING_LIGHTS: 0.8,
    MILEAGE_CONFLICT_UNEXPLAINED: 0.5,
    MAJOR_REPAIR_UNVERIFIED: 0.4,
    MODIFICATION_TECHNICAL_CONCERN: 0.3,
    FLOOD: 3.0,
    FIRE: 3.5,
    ODOMETER_ROLLBACK: 2.5,
    VIN_IDENTITY_PROBLEM: 4.0,
  },
  MODIFICATION_SERIOUS_UNVERIFIED: 0.6,

  /* ---- капи: лише факти, що обʼєктивно обмежують максимум ---- */
  HARD_CAPS: {
    VIN_IDENTITY_PROBLEM: 3.5,
    FLOOD: 4.5,
    FIRE: 4.5,
    ODOMETER_ROLLBACK: 4.5,
  },
  STRUCTURAL_UNRESOLVED_CAP: 5.5,  /* структурне БЕЗ confirmed_ok ремонту */
  /* SRS-кап лише за СИЛЬНІШИМ evidence: поточна несправність SRS або
     confirmed_bad відновлення. Простий unknown капа не отримує */
  SRS_STRONG_EVIDENCE_CAP: 6.0,

  /* ---- eligibility: глобальний, не marketplace-specific.
     Identity + базові факти + мінімально достатній vehicle-specific
     evidence. <6 фото більше НЕ вбиває Score, якщо є інші домени ---- */
  ELIGIBILITY: {
    MIN_PHOTOS_STANDALONE: 4, /* фото як єдиний evidence-домен */
  },

  /* пороги ті самі (до калібрування не змінюються), семантика: РІВЕНЬ
     ВИЯВЛЕНОГО РИЗИКУ, не якість чи порада купувати. Ціна свідомо не
     входить у Score, тому "buy"/"excellent" некоректні */
  GRADE_THRESHOLDS: [
    { min: 8.5, grade: 'low_risk' },       /* низький виявлений ризик */
    { min: 7.0, grade: 'moderate_risk' },  /* помірний виявлений ризик */
    { min: 5.5, grade: 'elevated_risk' },  /* підвищений виявлений ризик */
    { min: 0, grade: 'high_risk' },        /* високий виявлений ризик */
  ],

  /* positive bonuses у v3 СВІДОМО нуль: гак на майбутнє */
  POSITIVE_VERIFIED_BONUS: 0,
};

/* типи знахідок, що описують НАСЛІДКИ аварії (входять у accident events) */
const ACCIDENT_FINDING_TYPES = new Set(['STRUCTURAL_DAMAGE', 'AIRBAGS_DEPLOYED', 'MAJOR_REPAIR_UNVERIFIED']);
/* незалежні/поточні проблеми */
const INDEPENDENT_TYPES = new Set(['SRS_FAULT', 'SERIOUS_POWERTRAIN_FAULT', 'POOR_REPAIR_VISIBLE', 'CRITICAL_WARNING_LIGHTS', 'MILEAGE_CONFLICT_UNEXPLAINED', 'MODIFICATION_TECHNICAL_CONCERN', 'FLOOD', 'FIRE', 'ODOMETER_ROLLBACK', 'VIN_IDENTITY_PROBLEM']);
const EVIDENCE_SOURCES = new Set(['seller_claim', 'current_photos', 'historical_listing', 'us_auction', 'registry', 'document']);
const REPAIR_STATUSES = new Set(['confirmed_ok', 'visually_consistent', 'unknown', 'confirmed_bad']);
const REPAIR_RANK = { confirmed_bad: 3, unknown: 2, visually_consistent: 1, confirmed_ok: 0 };

const round1 = x => Math.round((x + Number.EPSILON) * 10) / 10;
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const EPS = 1e-9;

/* та сама строга валідація, що у v2: без валідного evidence і event_id
   знахідка на бал не впливає */
function sanitizeFindingsV3(findings) {
  const ok = [];
  let dropped = 0;
  for (const f of Array.isArray(findings) ? findings : []) {
    const known = f && (ACCIDENT_FINDING_TYPES.has(f.type) || INDEPENDENT_TYPES.has(f.type));
    if (!f || typeof f !== 'object' || Array.isArray(f) || !known) { dropped++; continue; }
    const evidence = (Array.isArray(f.evidence) ? f.evidence : [])
      .filter(e => e && typeof e === 'object' && EVIDENCE_SOURCES.has(e.source)
        && typeof e.description === 'string' && e.description.trim())
      .map(e => ({ source: e.source, ref: typeof e.ref === 'string' ? e.ref.slice(0, 60) : null, description: e.description.trim().slice(0, 300) }));
    if (!evidence.length) { dropped++; continue; }
    const eid = (typeof f.event_id === 'string' && f.event_id.trim()) || typeof f.event_id === 'number'
      ? String(f.event_id).trim().slice(0, 60) : null;
    if (!eid) { dropped++; continue; }
    ok.push({
      type: f.type,
      source_event_id: eid,
      serious_intervention: f.serious_intervention === true,
      maintenance_evidence: f.maintenance_evidence === true,
      repair_status: REPAIR_STATUSES.has(f.repair_status) ? f.repair_status : null,
      evidence,
    });
  }
  return { ok, dropped };
}

const yearOf = s => {
  const m = /20\d\d|19\d\d/.exec(String(s || ''));
  return m ? parseInt(m[0], 10) : null;
};

/* аукціонні damage-строки, що НЕ є суттєвою зоною пошкодження */
const BENIGN_DAMAGE = /normal wear|minor dent|scratch|unknown|none/i;
const materialZone = v => !!(v && typeof v === 'string' && !BENIGN_DAMAGE.test(v));

/* класи зон пошкодження з довільного тексту: підтвердження або вето merge.
   Дві НЕПОРОЖНІ множини без перетину = кажуть про різні частини авто */
const ZONE_PATTERNS = [
  { key: 'front', re: /перед|передн|front|капот|hood/i },
  { key: 'rear', re: /зад|задн|rear|багажник|trunk/i },
  { key: 'left', re: /лів|лев[аоыий]|left/i },
  { key: 'right', re: /прав|right/i },
  { key: 'roof', re: /дах|крыш|roof/i },
];
const zoneClasses = text => {
  const s = new Set();
  for (const z of ZONE_PATTERNS) if (z.re.test(String(text || ''))) s.add(z.key);
  return s;
};
const zonesDisjoint = (a, b) => a.size > 0 && b.size > 0 && [...a].every(k => !b.has(k));

const CONF_RANK = { high: 2, medium: 1 };
const yearsCompatible = (a, b) => a === null || b === null || a === b;

function newEvent(id, year, anchored, basis, confidence) {
  return {
    normalized_event_id: id,
    anchored: !!anchored,
    source_event_ids: [],
    merge_basis: basis ? [...basis] : [],
    merge_confidence: confidence || 'high',
    year,
    signals: { structural: false, load_bearing: false, airbags: false, zones: 0, major_deformation: false, wheel_displacement: false, cosmetic_only: false, possible_structural: false },
    repair_statuses: [],
    evidence: [],
  };
}
function attach(target, basisTag, confidence) {
  target.merge_basis.push(basisTag);
  if (CONF_RANK[confidence] < CONF_RANK[target.merge_confidence]) target.merge_confidence = confidence;
}
function absorbGroup(target, g) {
  target.source_event_ids.push(g.id);
  for (const f of g.findings) {
    target.evidence.push(...f.evidence);
    if (f.repair_status) target.repair_statuses.push(f.repair_status);
    if (f.type === 'STRUCTURAL_DAMAGE') target.signals.structural = true;
    if (f.type === 'AIRBAGS_DEPLOYED') target.signals.airbags = true;
    if (f.type === 'MAJOR_REPAIR_UNVERIFIED') target.merge_basis.push('major_repair_same_accident');
  }
}

/* ---------- нормалізація ДТП: deterministic accident event resolver ----------
   Розділені ANCHORED події (аукціонний лот із власним ідентифікатором) і
   UNANCHORED supporting-записи (generic запис площадки, ремонт, знахідки без
   якоря). Правила merge:
   - різні source_event_ids чи несумісні НАДІЙНІ роки НІКОЛИ не зливаються
     лише за збігом року;
   - us_auction-evidence зливає знахідку в якір лише за сумісного року;
   - generic запис площадки БЕЗ власної ідентичності приєднується до ЄДИНОЇ
     якірної події сумісного періоду, якщо зони пошкоджень не суперечать;
   - ремонтний supporting-запис приєднується до єдиної події сумісного
     періоду; кілька кандидатів = не приєднується;
   - самостійні ДТП-групи одного року НЕ схлопуються між собою */
export function resolveAccidentEvents(findings, ctx) {
  const c = ctx || {};
  const events = [];
  const auctionMeta = c.auctionMeta || null;
  const hv = c.historicalVisual || null;

  /* якірна подія аукціону: власний надійний ідентифікатор (лот) */
  let auctionEvent = null;
  let anchorZoneText = '';
  if (auctionMeta || (hv && Array.isArray(hv.evidence) && hv.evidence.length)) {
    const lotId = auctionMeta && auctionMeta.lot_id ? String(auctionMeta.lot_id) : null;
    auctionEvent = newEvent(
      lotId ? 'auction:' + (auctionMeta.house || 'lot') + ':' + lotId : 'auction:event',
      auctionMeta && auctionMeta.sale_date ? yearOf(auctionMeta.sale_date) : null,
      true, [], 'high');
    if (auctionMeta) {
      auctionEvent.merge_basis.push('auction_record');
      if (auctionMeta.airbags && auctionMeta.airbags.deployed === true) {
        auctionEvent.signals.airbags = true;
        auctionEvent.evidence.push({ source: 'us_auction', ref: 'auction_metadata', description: 'подушки за metadata лота: ' + (auctionMeta.airbags.raw || 'deployed') });
      }
      const zones = [auctionMeta.primary_damage, auctionMeta.secondary_damage].filter(materialZone);
      auctionEvent.signals.zones = Math.max(auctionEvent.signals.zones, zones.length);
      for (const z of zones) auctionEvent.evidence.push({ source: 'us_auction', ref: 'auction_metadata', description: 'damage за metadata лота: ' + z });
      anchorZoneText += ' ' + zones.join(' ');
    }
    if (hv) {
      /* historical visual привʼязаний до аукціонних кадрів цього ж лота */
      auctionEvent.merge_basis.push('historical_photos_same_lot');
      if (hv.structural_visual_status === 'visible_damage') auctionEvent.signals.structural = true;
      if (hv.srs_visual_status === 'deployed_visible') auctionEvent.signals.airbags = true;
      const hvZones = Array.isArray(hv.visible_damage_zones) ? hv.visible_damage_zones : [];
      auctionEvent.signals.zones = Math.max(auctionEvent.signals.zones, hvZones.length);
      anchorZoneText += ' ' + hvZones.join(' ');
      /* структуровані ВИДИМІ ознаки, не прикметник моделі */
      if (hv.possible_structural_damage === true && hv.structural_visual_status !== 'visible_damage') auctionEvent.signals.possible_structural = true;
      /* видима деформація НЕСУЧИХ частин (лонжерони, стакани, стійки,
         пороги, підлога, моторний щит, каркас): сильний фізичний сигнал
         тяжкості БЕЗ капа 5.5 (кап лишається за strict visible_damage) */
      if (hv.load_bearing_structure_deformation_visible === true) auctionEvent.signals.load_bearing = true;
      if (hv.major_deformation_visible === true) auctionEvent.signals.major_deformation = true;
      if (hv.wheel_displacement_visible === true) auctionEvent.signals.wheel_displacement = true;
      if (hv.cosmetic_only === true) auctionEvent.signals.cosmetic_only = true;
    }
    events.push(auctionEvent);
  }
  const anchorZones = zoneClasses(anchorZoneText);

  /* групи знахідок за source_event_id: один id = одна група (high).
     Крос-групового merge за роком НЕМАЄ */
  const groups = new Map();
  for (const f of findings) {
    if (!ACCIDENT_FINDING_TYPES.has(f.type)) continue;
    let g = groups.get(f.source_event_id);
    if (!g) {
      g = { id: f.source_event_id, findings: [], year: null, hasAuctionEvidence: false };
      groups.set(f.source_event_id, g);
    }
    g.findings.push(f);
    g.hasAuctionEvidence = g.hasAuctionEvidence || f.evidence.some(e => e.source === 'us_auction');
    g.year = g.year || yearOf(f.source_event_id) || yearOf(f.evidence.map(e => e.description).join(' '));
  }
  const glist = [...groups.values()];
  const isSupportingOnly = g => g.findings.every(f => f.type === 'MAJOR_REPAIR_UNVERIFIED');
  /* власна лот-ідентичність групи: цифровий лот у event_id чи structured
     refs (НЕ в описах). Інший лот, ніж у якоря, НІКОЛИ не зливається */
  const anchorLotId = auctionMeta && auctionMeta.lot_id ? String(auctionMeta.lot_id) : null;
  const lotRefOf = g => {
    const src = [g.id, ...g.findings.flatMap(f => f.evidence.map(e => e.ref || ''))].join(' ');
    const m = /(?<![0-9])(\d{7,9})(?![0-9])/.exec(src);
    return m ? m[1] : null;
  };
  const lotConflicts = g => {
    const ref = lotRefOf(g);
    return !!(anchorLotId && ref && ref !== anchorLotId);
  };

  /* фаза 1: us_auction-evidence веде в якір, але НЕ проти надійних дат
     і НЕ проти іншої лот-ідентичності */
  const pending = [];
  for (const g of glist) {
    if (auctionEvent && g.hasAuctionEvidence && yearsCompatible(g.year, auctionEvent.year) && !lotConflicts(g)) {
      attach(auctionEvent, 'us_auction_evidence', 'high');
      absorbGroup(auctionEvent, g);
    } else pending.push(g);
  }

  /* фаза 2: єдина неякірна ДТП-група сумісного періоду може приєднатися до
     якоря (medium). Дві і більше груп одного періоду = неоднозначність,
     жодна не приєднується за роком */
  const accidentPending = pending.filter(g => !isSupportingOnly(g));
  if (auctionEvent && accidentPending.length === 1) {
    const g = accidentPending[0];
    const gZones = zoneClasses(g.findings.map(f => f.evidence.map(e => e.description).join(' ')).join(' '));
    if (yearsCompatible(g.year, auctionEvent.year) && !lotConflicts(g) && !zonesDisjoint(gZones, anchorZones)) {
      attach(auctionEvent, 'same_period_single_anchor', 'medium');
      if (gZones.size && anchorZones.size) auctionEvent.merge_basis.push('damage_zones_match');
      absorbGroup(auctionEvent, g);
      pending.splice(pending.indexOf(g), 1);
    }
  }

  /* фаза 3: решта груп = власні події */
  for (const g of pending) {
    if (isSupportingOnly(g)) continue; /* ремонтні: фаза 4 */
    const ev = newEvent('accident:' + (g.year ? g.year + ':' : '') + g.id, g.year, false, ['llm_finding_group'], 'high');
    if (auctionEvent && g.hasAuctionEvidence && !yearsCompatible(g.year, auctionEvent.year)) ev.merge_basis.push('year_mismatch_with_anchor');
    if (auctionEvent && g.hasAuctionEvidence && lotConflicts(g)) ev.merge_basis.push('lot_mismatch_with_anchor');
    absorbGroup(ev, g);
    events.push(ev);
  }

  /* фаза 4: ремонтний supporting-запис приєднується до ЄДИНОЇ події
     сумісного періоду; кандидатів кілька або нуль = власна подія */
  for (const g of pending.filter(isSupportingOnly)) {
    const candidates = events.filter(ev => yearsCompatible(g.year, ev.year));
    if (candidates.length === 1) {
      attach(candidates[0], 'supporting_repair_same_period', 'medium');
      absorbGroup(candidates[0], g);
    } else {
      const ev = newEvent('accident:' + (g.year ? g.year + ':' : '') + g.id, g.year, false, ['llm_finding_group'], 'high');
      absorbGroup(ev, g);
      events.push(ev);
    }
  }

  /* фаза 5: generic запис площадки БЕЗ власної ідентичності приєднується
     до ЄДИНОЇ якірної події сумісного періоду, якщо зони не суперечать */
  if (c.accidentRecord && c.accidentRecord.recorded === true) {
    const recYear = yearOf(c.accidentRecord.note);
    const recZones = zoneClasses(c.accidentRecord.note);
    const recEvidence = { source: 'historical_listing', ref: 'platform_history', description: (c.accidentRecord.note || 'зафіксовано ДТП').slice(0, 200) };
    const veto = zonesDisjoint(recZones, anchorZones);
    if (auctionEvent && yearsCompatible(recYear, auctionEvent.year) && !veto) {
      attach(auctionEvent, 'platform_record_attached', recYear !== null && auctionEvent.year !== null ? 'high' : 'medium');
      if (recZones.size && anchorZones.size) auctionEvent.merge_basis.push('damage_zones_match');
      auctionEvent.evidence.push(recEvidence);
    } else {
      const ev = newEvent('platform:accident' + (recYear ? ':' + recYear : ''), recYear, false,
        veto && auctionEvent ? ['platform_record', 'damage_zones_veto'] : ['platform_record'], 'high');
      ev.evidence.push(recEvidence);
      events.push(ev);
    }
  }

  /* події без жодного сигналу і evidence не існують */
  return events.filter(e => e.evidence.length || e.signals.structural || e.signals.airbags || e.signals.zones > 0);
}

/* ---------- severity: виводить КОД зі спостережуваних ознак ----------
   LLM витягує ЛИШЕ структуровані спостереження (structural_visual_status,
   major_deformation_visible, wheel_displacement_visible, cosmetic_only,
   зони, подушки); tier визначає код. Прикметник visible_severity у
   математику НЕ входить (лишається тільки wording звіту). Недостатньо
   ознак: indeterminate (допустимий стан), severity_basis[] зберігається */
export function deriveSeverity(ev) {
  const basis = [];
  let severity = 'indeterminate';
  const bump = (level, why) => {
    const rank = { indeterminate: 0, minor: 1, moderate: 2, severe: 3 };
    basis.push(why);
    if (rank[level] > rank[severity]) severity = level;
  };
  if (ev.signals.structural) bump('severe', 'structural_damage');
  /* видима деформація несучих частин: severe сама по собі */
  if (ev.signals.load_bearing) bump('severe', 'load_bearing_structure_deformation_visible');
  /* глибока видима деформація кузова дає severe ЛИШЕ з незалежним
     ФІЗИЧНИМ підтвердженням тяжкості: несучі частини, структурні ознаки,
     зміщене колесо. Подушки корроборатором НЕ є: розкриті подушки плюс
     зімʼяті навісні панелі це штатна сигнатура БУДЬ-ЯКОГО фронтального
     удару з порогом спрацювання, а не доказ severe. Подушки лишаються
     самостійним moderate-сигналом нижче і окремим SRS restoration concern */
  const majorCorroborated = ev.signals.structural || ev.signals.load_bearing || ev.signals.wheel_displacement;
  if (ev.signals.major_deformation) bump(majorCorroborated ? 'severe' : 'moderate', 'major_deformation_visible');
  if (ev.signals.airbags) bump('moderate', 'airbags_deployed');
  if (ev.signals.wheel_displacement) bump('moderate', 'wheel_displacement_visible');
  if (ev.signals.zones >= 2) bump('moderate', 'multiple_damage_zones');
  if (ev.signals.cosmetic_only && severity === 'indeterminate') bump('minor', 'cosmetic_panels_only');
  return { severity, basis };
}

/* ---------- нормалізація поточних проблем: анти-дабл-каунтинг ----------
   Одна underlying проблема не штрафується двічі за симптом і діагноз:
   warning light стає evidence діагностованої несправності */
const WARNING_DOMAINS = [
  { re: /srs|подушк|airbag|безпек/i, fault: 'SRS_FAULT' },
  { re: /двигун|двигат|engine|check|трансміс|акпп|коробк/i, fault: 'SERIOUS_POWERTRAIN_FAULT' },
];
export function normalizeCurrentProblems(findings) {
  const problems = [];
  const faults = findings.filter(f => INDEPENDENT_TYPES.has(f.type) && f.type !== 'CRITICAL_WARNING_LIGHTS');
  const warnings = findings.filter(f => f.type === 'CRITICAL_WARNING_LIGHTS');
  for (const f of faults) {
    problems.push({
      normalized_problem_id: f.type + ':' + f.source_event_id,
      type: f.type,
      source_finding_ids: [f.source_event_id],
      merge_basis: [],
      serious_intervention: f.serious_intervention,
      maintenance_evidence: f.maintenance_evidence,
      repair_status: f.repair_status,
      evidence: [...f.evidence],
    });
  }
  for (const w of warnings) {
    const text = w.evidence.map(e => e.description).join(' ');
    let merged = false;
    for (const d of WARNING_DOMAINS) {
      if (!d.re.test(text)) continue;
      const host = problems.find(p => p.type === d.fault);
      if (host) {
        /* симптом тієї самої underlying проблеми: лише evidence */
        host.source_finding_ids.push(w.source_event_id);
        host.merge_basis.push('warning_light_same_underlying_fault');
        host.evidence.push(...w.evidence);
        merged = true;
        break;
      }
    }
    if (!merged) {
      problems.push({
        normalized_problem_id: 'CRITICAL_WARNING_LIGHTS:' + w.source_event_id,
        type: 'CRITICAL_WARNING_LIGHTS',
        source_finding_ids: [w.source_event_id],
        merge_basis: [],
        evidence: [...w.evidence],
      });
    }
  }
  /* дедуп однакових type+id */
  const seen = new Map();
  for (const p of problems) {
    const key = p.normalized_problem_id;
    if (seen.has(key)) {
      const cur = seen.get(key);
      cur.evidence.push(...p.evidence);
      cur.merge_basis.push('duplicate_finding');
    } else seen.set(key, p);
  }
  return [...seen.values()];
}

/* ---------- coverage: домени глибини перевірки ---------- */
export function buildCoverageV3(inputs, cfg) {
  const i = inputs && typeof inputs === 'object' ? inputs : {};
  const n = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  const identity = i.identity_confirmed !== undefined ? !!i.identity_confirmed : !!i.vin_decoded;
  const domains = {};
  const add = (name, applicable, status, earned) => {
    domains[name] = {
      applicable,
      status,
      contribution: earned ? cfg.COVERAGE_DOMAINS[name] : 0,
    };
  };
  add('identity', true, identity ? 'found' : 'unknown', identity);
  const photosOk = n(i.photos_count) >= cfg.PHOTOS_DOMAIN_MIN;
  add('current_photos', true, photosOk ? 'found' : 'unknown', photosOk);
  const histOk = i.registration_data_exists === true || n(i.historical_listings_count) >= 1;
  add('history_records', true, histOk ? 'found' : 'unknown', histOk);
  const milOk = n(i.mileage_observation_count) >= cfg.MILEAGE_OBS_MIN;
  add('mileage_timeline', true, milOk ? 'found' : 'unknown', milOk);
  /* аукціонний домен: found АБО checked_absent = перевірено (coverage
     заробляється за ПЕРЕВІРКУ, не за знайдену проблему);
     not_applicable виключається з очікування (earned);
     source_unreachable/unknown внеску не дають */
  if (i.auction_record_exists) add('auction_history', true, 'found', true);
  else if (i.auction_applicable === false) add('auction_history', false, 'not_applicable', true);
  else if (i.auction_us_signal && i.auction_checked) add('auction_history', true, 'checked_absent', true);
  else if (i.auction_sources_unreachable) add('auction_history', true, 'source_unreachable', false);
  else add('auction_history', true, 'unknown', false);

  let ceiling = cfg.BASE_CEILING;
  for (const d of Object.values(domains)) ceiling += d.contribution;
  return { domains, ceiling: round2(Math.min(cfg.CEILING_MAX, ceiling)) };
}

/* ---------- eligibility: глобальний, не marketplace-specific ---------- */
export function checkEligibilityV3(i, cfg = SCORE_CONFIG_V3) {
  const inp = i && typeof i === 'object' ? i : {};
  const missing = [];
  const identity = inp.identity_confirmed !== undefined ? !!inp.identity_confirmed : !!inp.vin_decoded;
  if (!identity) missing.push('identity');
  if (inp.basics_known === false) missing.push('basics');
  /* мінімально достатній vehicle-specific evidence: фото стендалон,
     АБО будь-який інший заробленый evidence-домен. <6 фото і навіть
     відсутній current-пробіг Score не вбивають, якщо є інші домени */
  const n = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  const hasOtherEvidence = inp.auction_record_exists === true
    || (inp.auction_us_signal && inp.auction_checked)
    || inp.registration_data_exists === true
    || n(inp.historical_listings_count) >= 1
    || n(inp.mileage_observation_count) >= cfg.MILEAGE_OBS_MIN;
  if (n(inp.photos_count) < cfg.ELIGIBILITY.MIN_PHOTOS_STANDALONE && !hasOtherEvidence) missing.push('evidence');
  return { eligible: missing.length === 0, missing };
}

export function gradeFromScoreV3(score, cfg = SCORE_CONFIG_V3) {
  for (const t of cfg.GRADE_THRESHOLDS) if (score >= t.min) return t.grade;
  return cfg.GRADE_THRESHOLDS[cfg.GRADE_THRESHOLDS.length - 1].grade;
}

/* ---------- головна формула ---------- */
export function computeScoreV3(input, cfg = SCORE_CONFIG_V3) {
  const inp = input && typeof input === 'object' ? input : {};
  const { ok: findings, dropped } = sanitizeFindingsV3(inp.findings);
  const coverageInputs = inp.coverageInputs || {};
  const { domains, ceiling } = buildCoverageV3(coverageInputs, cfg);
  const eligibility = checkEligibilityV3(coverageInputs, cfg);

  /* 1. нормалізовані accident events */
  const rawEvents = resolveAccidentEvents(findings, {
    auctionMeta: inp.auctionMeta || null,
    historicalVisual: inp.historicalVisual || null,
    accidentRecord: inp.accidentRecord || null,
  });
  const accidentEvents = rawEvents.map(ev => {
    const { severity, basis } = deriveSeverity(ev);
    /* найгірший repair_status серед злитих знахідок */
    let repair = null;
    for (const r of ev.repair_statuses) {
      if (repair === null || REPAIR_RANK[r] > REPAIR_RANK[repair]) repair = r;
    }
    const mult = cfg.REPAIR_MULTIPLIER[repair || 'unknown'];
    /* САМ ФАКТ підтвердженого ДТП не стирається якістю ремонту: множник
       діє лише на severity-складову, ACCIDENT_BASE лишається незмінною */
    let penalty = round2(cfg.ACCIDENT_BASE + cfg.SEVERITY_ADDITIONAL[severity] * mult);
    let residualApplied = false;
    if (severity === 'severe' && penalty < cfg.SEVERE_MIN_RESIDUAL) {
      penalty = cfg.SEVERE_MIN_RESIDUAL;   /* ремонт не стирає severe-історію */
      residualApplied = true;
    }
    return {
      normalized_event_id: ev.normalized_event_id,
      anchored: ev.anchored,
      source_event_ids: [...new Set(ev.source_event_ids)],
      merge_basis: [...new Set(ev.merge_basis)],
      merge_confidence: ev.merge_confidence,
      accident_base: cfg.ACCIDENT_BASE,
      derived_severity: severity,
      severity_basis: basis,
      severity_additional: cfg.SEVERITY_ADDITIONAL[severity],
      repair_status: repair,
      repair_multiplier: mult,
      minimum_residual_if_applied: residualApplied ? cfg.SEVERE_MIN_RESIDUAL : null,
      final_event_penalty: penalty,
      airbags: ev.signals.airbags,
      structural: ev.signals.structural,
      /* потенційно структурна зона: НЕ підтверджене структурне, без капа */
      possible_structural: ev.signals.possible_structural === true,
      evidence: ev.evidence.slice(0, 10),
    };
  });
  const accidentPenalty = accidentEvents.reduce((s, e) => s + e.final_event_penalty, 0);

  /* 2. unresolved safety: подушки без підтвердженого відновлення SRS.
     Якщо поточна несправність SRS вже штрафується, concern не дублюється */
  const problems = normalizeCurrentProblems(findings.filter(f => INDEPENDENT_TYPES.has(f.type)));
  const unresolvedSafety = [];
  const hasCurrentSrsFault = problems.some(p => p.type === 'SRS_FAULT');
  for (const ev of accidentEvents) {
    if (ev.airbags && ev.repair_status !== 'confirmed_ok' && !hasCurrentSrsFault) {
      unresolvedSafety.push({
        type: 'SRS_RESTORATION_UNVERIFIED',
        penalty: cfg.SRS_RESTORATION_UNVERIFIED,
        event: ev.normalized_event_id,
        evidence: ev.evidence.filter(e => /подушк|airbag|srs|шторк/i.test(e.description)).slice(0, 3),
      });
      break; /* один concern на авто: SRS одна система */
    }
  }
  const safetyPenalty = unresolvedSafety.reduce((s, u) => s + u.penalty, 0);

  /* 3. поточні і незалежні проблеми */
  const currentPenalties = problems.map(p => {
    let amount = cfg.CURRENT_PENALTIES[p.type];
    if (p.type === 'MODIFICATION_TECHNICAL_CONCERN' && p.serious_intervention && !p.maintenance_evidence) {
      amount = cfg.MODIFICATION_SERIOUS_UNVERIFIED;
    }
    /* MAJOR_REPAIR, змерджений в accident event, не штрафується вдруге */
    return { ...p, penalty: amount };
  }).filter(p => {
    if (p.type !== 'MAJOR_REPAIR_UNVERIFIED') return true;
    const merged = accidentEvents.some(ev => ev.source_event_ids.some(id => p.source_finding_ids.includes(id)));
    return !merged;
  });
  const currentPenalty = currentPenalties.reduce((s, p) => s + p.penalty, 0);

  const rawQuality = round2(cfg.STARTING_SCORE - accidentPenalty - safetyPenalty - currentPenalty);

  /* 4. капи */
  const caps = [];
  for (const p of currentPenalties) {
    if (cfg.HARD_CAPS[p.type] !== undefined) caps.push({ name: 'hard_cap:' + p.type, value: cfg.HARD_CAPS[p.type] });
  }
  for (const ev of accidentEvents) {
    if (ev.structural && ev.repair_status !== 'confirmed_ok') {
      caps.push({ name: 'hard_cap:STRUCTURAL_UNRESOLVED', value: cfg.STRUCTURAL_UNRESOLVED_CAP });
    }
    if (ev.airbags && ev.repair_status === 'confirmed_bad') {
      caps.push({ name: 'hard_cap:SRS_STRONG_EVIDENCE', value: cfg.SRS_STRONG_EVIDENCE_CAP });
    }
  }
  if (hasCurrentSrsFault) caps.push({ name: 'hard_cap:SRS_STRONG_EVIDENCE', value: cfg.SRS_STRONG_EVIDENCE_CAP });

  /* 5. підсумок */
  const unclamped = Math.min(rawQuality, ceiling, ...caps.map(c => c.value));
  const limiting = [];
  if (unclamped > 0) {
    if (Math.abs(rawQuality - unclamped) < EPS) limiting.push('quality');
    if (Math.abs(ceiling - unclamped) < EPS) limiting.push('coverage');
    for (const c of caps) if (Math.abs(c.value - unclamped) < EPS && !limiting.includes(c.name)) limiting.push(c.name);
  }
  /* звичайне математичне округлення до 0.1 (7.24 -> 7.2, 7.25 -> 7.3),
     АЛЕ показаний бал ніколи не перевищує діючу стелю покриття чи жорсткий
     кап через округлення: коли обмежувач зовнішній, округлення тільки вниз */
  const clamped = Math.min(10, Math.max(0, unclamped));
  let final = round1(clamped);
  const boundIsExternal = limiting.includes('coverage') || limiting.some(l => l.startsWith('hard_cap'));
  if (boundIsExternal && final > clamped + EPS) final = Math.floor((clamped + EPS) * 10) / 10;

  const base = {
    score_v: 3,
    score_version: 'v3',
    starting_score: cfg.STARTING_SCORE,
    accident_events: accidentEvents,
    normalized_current_problems: currentPenalties,
    unresolved_safety_concerns: unresolvedSafety,
    raw_quality: rawQuality,
    coverage: { domains, ceiling },
    coverage_cap: ceiling,
    applied_hard_caps: caps,
    limiting_factors: limiting,
    dropped_findings: dropped,
    coverage_inputs: coverageInputs,
    /* пояснювальні підоцінки: рахує КОД, вони НЕ входять у формулу
       CalCar Score і не змінюють final (див. computeDimensions) */
    score_dimensions: computeDimensions({
      accidentEvents, problems: currentPenalties, unresolvedSafety, domains, coverageInputs,
      vehicle: inp.vehicle || null,
      visualEvidence: inp.visualEvidence || null,
    }),
  };
  if (!eligibility.eligible) {
    return { ...base, score_available: false, score_unavailable_missing: eligibility.missing, final: null, grade: null,
      score_limit_reason: 'недостатньо даних для оцінки: ' + eligibility.missing.join(', ') };
  }
  return { ...base, score_available: true, final, grade: gradeFromScoreV3(final, cfg),
    score_limited_by_data: limiting.includes('coverage'),
    score_limit_reason: limiting.includes('coverage') ? 'оцінка обмежена глибиною перевірки: стеля ' + ceiling : (limiting.filter(l => l.startsWith('hard_cap')).map(l => 'жорсткий кап ' + l.slice(9)).join('; ') || null) };
}

/* ============ пояснювальні підоцінки (explanatory dimensions) ============
   П'ять окремих осей 0-10, які рахує КОД з уже нормалізованих фактів
   breakdown. Вони НЕ усереднюються в CalCar Score, НЕ є входом
   computeScoreV3 і НЕ впливають на final: це пояснювальний шар для
   картки і AI-висновку. Числа підоцінок живуть у власному конфігу і
   свідомо НЕ звірені з SCORE_CONFIG_V3: середнє п'яти осей не мусить
   збігатися з CalCar Score. Недостатньо даних для осі:
   score_available:false і score:null, жодних фейкових 10/10.
   "Перевірили і проблем не знайшли" (10) != "даних недостатньо" (null) */
export const SCORE_DIMENSIONS_CONFIG = {
  HISTORY_EVENT: { severe: 3.5, moderate: 2.0, minor: 0.8, indeterminate: 1.0 },
  HISTORY_FLOOD: 4.5,
  HISTORY_FIRE: 5.0,
  HISTORY_VIN: 5.0,
  /* ---- Пробіг: наскільки хороший ПІДТВЕРДЖЕНИЙ пробіг відносно віку і
     типу силової установки. Головний показник: usage_ratio =
     (одометр / вік у fractional роках) / reference класу. Стара машина з
     природно великим сумарним пробігом НЕ погана за цією віссю; ресурс
     конкретного двигуна живе в Technical Risks / Knowledge Layer.
     A. annual_base_score: неперервна anchor-крива за usage_ratio;
     B. невеликий НЕГАТИВНИЙ lifetime-коректор за сумарний пробіг;
     C. integrity: чиста хронологія 0 (не бонус), конфлікт -1.5,
        скрутка = кап осі 2.5 (низький км/рік скрутку не відмиває) ---- */
  MILEAGE_REF_KM_YEAR: { petrol: 12000, diesel: 18000, hev: 12000, phev: 15000, bev: 16000, electric: 16000, hybrid: 14000, unknown: 14000 },
  /* 10.0 = фактично нульовий пробіг: верх кривої стартує з ratio 0,
     будь-який ненульовий пробіг дає < 10 (страхує guard нижче) */
  MILEAGE_USAGE_CURVE: [[0, 10], [0.10, 9.9], [0.25, 9.6], [0.40, 9.5], [0.50, 9.4], [0.60, 9.3], [0.75, 9.1], [0.90, 9.0], [1.00, 8.8], [1.10, 8.5], [1.25, 8.0], [1.40, 7.6], [1.60, 7.1], [1.80, 6.6], [2.00, 6.1], [2.25, 5.5], [2.50, 5.0], [3.00, 4.2], [3.50, 3.6], [4.00, 3.1], [5.00, 2.3], [6.00, 1.6], [7.00, 1.0]],
  MILEAGE_LIFETIME_CURVE: [[100000, 0], [150000, -0.1], [200000, -0.3], [250000, -0.5], [300000, -0.7], [400000, -1.0], [500000, -1.3]],
  MILEAGE_MIN_AGE_MONTHS: 6,
  MILEAGE_CONFLICT: 1.5,
  MILEAGE_ROLLBACK_CAP: 2.5,
  DR_EVENT: { severe: 3.0, moderate: 1.6, minor: 0.5, indeterminate: 1.0 },
  /* та сама семантика: visually_consistent нейтральний */
  DR_REPAIR_MULT: { confirmed_ok: 0.45, visually_consistent: 1.0, unknown: 1.0, confirmed_bad: 1.3 },
  DR_STRUCTURAL_UNRESOLVED: 1.0,  /* додатково до severe-події */
  DR_SRS_UNVERIFIED: 1.2,
  DR_POOR_REPAIR: 1.5,
  DR_FLOOD: 4.0,                  /* затоплення/пожежа це теж пошкодження */
  DR_FIRE: 4.5,
  /* Стан за фото: 10.0 це ВИНЯТОК (практично бездоганний вигляд при
     достатньому покритті і якості кадрів), а не дефолт за "нічого поганого
     не видно". База залежить від сили visual evidence, вік не бере участі */
  CC_BASE_DEFAULT: 9.4,     /* дефектів не видно, звичайний достатній набір */
  CC_BASE_RICH: 9.6,        /* + повністю переглянута галерея, >=12 кадрів */
  CC_FLAWLESS: 9.8,         /* строгий flawless-сигнал без повного покриття */
  CC_FLAWLESS_FULL: 10,     /* flawless + повна галерея + >=18 кадрів */
  CC_RICH_MIN_PHOTOS: 12,
  CC_FLAWLESS_MIN_PHOTOS: 18,
  CC_POOR_REPAIR: 2.5,
  CC_WARNING: 1.8,
  TECH_SRS_FAULT: 3.0,
  TECH_POWERTRAIN: 3.0,
  TECH_MOD: 1.0,
  TECH_MOD_SERIOUS: 2.0,
};
export const DIMENSION_LABELS = {
  history: 'Історія авто',
  mileage: 'Пробіг',
  damage_repair: 'Пошкодження та відновлення',
  current_condition: 'Стан за фото',
  technical: 'Технічні ризики',
};
export const RISK_LABELS = {
  low_risk: 'низький виявлений ризик',
  moderate_risk: 'помірний виявлений ризик',
  elevated_risk: 'підвищений виявлений ризик',
  high_risk: 'високий виявлений ризик',
};

/* ---------- вік автомобіля: пріоритет джерел ----------
   1) надійна дата ПЕРШОЇ реєстрації/експлуатації авто взагалі (для
      імпортованої машини першу реєстрацію В УКРАЇНІ використовувати
      ЗАБОРОНЕНО: вона каже про імпорт, не про вік);
   2) надійна дата виробництва (production/build date);
   3) fallback: середина модельного року (1 липня, детерміновано).
   Вік у МІСЯЦЯХ, далі fractional роки: без стрибків у "день народження" */
export function resolveVehicleAge({ first_use_date, production_date, model_year } = {}, now = Date.now()) {
  const months = from => Math.max(6, Math.round((now - from) / (30.44 * 24 * 3600 * 1000)));
  const parse = v => { const t = Date.parse(v); return isFinite(t) ? t : null; };
  const fu = first_use_date ? parse(first_use_date) : null;
  if (fu !== null) return { age_months: months(fu), age_source: 'first_registration' };
  const pd = production_date ? parse(production_date) : null;
  if (pd !== null) return { age_months: months(pd), age_source: 'production_date' };
  const y = parseInt(model_year, 10);
  if (y >= 1950 && y <= 2100) return { age_months: months(Date.UTC(y, 6, 1)), age_source: 'model_year_midpoint' };
  return { age_months: null, age_source: null };
}

export function computeDimensions(input, dc = SCORE_DIMENSIONS_CONFIG) {
  const events = Array.isArray(input.accidentEvents) ? input.accidentEvents : [];
  const problems = Array.isArray(input.problems) ? input.problems : [];
  const safety = Array.isArray(input.unresolvedSafety) ? input.unresolvedSafety : [];
  const domains = input.domains || {};
  const cov = input.coverageInputs || {};
  const has = t => problems.some(p => p.type === t);
  const earned = d => !!(domains[d] && domains[d].contribution > 0);
  const dim = (available, penalty, factors) => available
    ? { score_available: true, score: round1(Math.max(0, Math.min(10, 10 - penalty))), main_factors: factors.length ? factors : ['no_issues_found'] }
    : { score_available: false, score: null, main_factors: [] };

  /* A. HISTORY: що з авто БУЛО. Доступна, коли історію реально перевіряли
     (джерела історії/аукціону відповіли) або серйозні події вже знайдені */
  const histFactors = [];
  let histPen = 0;
  for (const ev of events) { histPen += dc.HISTORY_EVENT[ev.derived_severity]; histFactors.push(ev.derived_severity + '_accident'); }
  if (events.length >= 2) histFactors.push('multiple_accidents');
  if (has('FLOOD')) { histPen += dc.HISTORY_FLOOD; histFactors.push('flood_history'); }
  if (has('FIRE')) { histPen += dc.HISTORY_FIRE; histFactors.push('fire_history'); }
  if (has('VIN_IDENTITY_PROBLEM')) { histPen += dc.HISTORY_VIN; histFactors.push('vin_identity_problem'); }
  /* history gap (ввезена вживаною без жодного незалежного історичного
     якоря): одна пізня локальна реєстрація НЕ є meaningful-покриттям
     життя авто, і "нічого не знайдено" тут не означає "ідеальна історія".
     Це НЕ штраф: вісь чесно недоступна, поки не зʼявиться справжній
     evidence (аукціон found/checked_absent, події, минулі записи) */
  const historyGap = cov.history_gap_detected === true;
  const histAvailable = (earned('history_records') && !historyGap)
    || (domains.auction_history && ['found', 'checked_absent'].includes(domains.auction_history.status))
    || events.length > 0 || histFactors.length > 0;
  const history = dim(histAvailable, histPen, histFactors);

  /* B. MILEAGE: наскільки хороший ПІДТВЕРДЖЕНИЙ пробіг відносно віку і
     powertrain. Головний фактор: середньорічний пробіг проти reference
     класу (неперервна крива за usage_ratio), далі невеликий lifetime-
     коректор і integrity. Для числового бала достатньо надійного одометра
     і надійного віку: головний зміст осі це км/рік. Без незалежних
     історичних точок хронологія НЕ вважається підтвердженою: integrity
     чесно позначається insufficient_history (без бонусів і штрафів) */
  const n = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  const veh = input.vehicle || {};
  const odo = (typeof veh.odometer_km === 'number' && isFinite(veh.odometer_km) && veh.odometer_km >= 0) ? veh.odometer_km : null;
  const months = (typeof veh.age_months === 'number' && isFinite(veh.age_months) && veh.age_months >= dc.MILEAGE_MIN_AGE_MONTHS) ? veh.age_months : null;
  const hasRollback = has('ODOMETER_ROLLBACK');
  const hasConflict = has('MILEAGE_CONFLICT_UNEXPLAINED');
  let mileage;
  if (odo === null || months === null) {
    mileage = { score_available: false, score: null, main_factors: [] };
  } else {
    const interp = (curve, x) => {
      if (x <= curve[0][0]) return curve[0][1];
      for (let i = 1; i < curve.length; i++) {
        if (x <= curve[i][0]) {
          const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
          return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        }
      }
      return curve[curve.length - 1][1];
    };
    const milFactors = [];
    const ageYears = months / 12;
    const annual = odo / ageYears;
    const ptClass = String(veh.powertrain || '').toLowerCase();
    const refKm = dc.MILEAGE_REF_KM_YEAR[ptClass] || dc.MILEAGE_REF_KM_YEAR.unknown;
    const usageRatio = annual / refKm;
    /* A. головний фактор: неперервна крива за usage_ratio, без buckets */
    const annualBase = interp(dc.MILEAGE_USAGE_CURVE, usageRatio);
    if (usageRatio > 1.25) milFactors.push('high_annual_usage');
    else if (usageRatio <= 0.6) milFactors.push('low_annual_usage');
    /* B. невеликий негативний lifetime-коректор: сумарний пробіг не
       ігнорується, але ніколи не стає головним фактором */
    const lifetimeAdj = interp(dc.MILEAGE_LIFETIME_CURVE, odo);
    if (lifetimeAdj <= -0.5) milFactors.push('high_lifetime_mileage');
    /* C. integrity: конфлікт помірний мінус; скрутка = кап осі. Якщо
       скрутка і конфлікт описують ту саму underlying проблему, двічі
       не штрафуємо: діє лише кап */
    let integrityAdj = 0;
    if (hasConflict && !hasRollback) { integrityAdj = -dc.MILEAGE_CONFLICT; milFactors.push('mileage_conflict'); }
    /* стан цілісності хронології: issue_found | no_issues_found |
       insufficient_history (історичних точок нема: НЕ "підтверджено чиста") */
    const integrityState = (hasRollback || hasConflict) ? 'issue_found'
      : (n(cov.mileage_observation_count) >= 1 ? 'no_issues_found' : 'insufficient_history');
    if (integrityState === 'insufficient_history') milFactors.push('insufficient_mileage_history');
    let sc = Math.max(0, Math.min(10, annualBase + lifetimeAdj + integrityAdj));
    let rollbackCap = false;
    if (hasRollback) { sc = Math.min(sc, dc.MILEAGE_ROLLBACK_CAP); rollbackCap = true; milFactors.push('odometer_rollback'); }
    let finalScore = round1(sc);
    /* семантика 10.0 = нульовий пробіг: raw лишається неперервним, guard
       лише не дає округленню показати 10.0 машині, що вже їздила */
    if (odo > 0 && finalScore >= 10) finalScore = 9.9;
    mileage = {
      score_available: true,
      score: finalScore,
      main_factors: milFactors.length ? milFactors : ['no_issues_found'],
      current_odometer_km: odo,
      age_source: veh.age_source || 'provided',
      vehicle_age_months: months,
      vehicle_age_years: round2(ageYears),
      powertrain_class: dc.MILEAGE_REF_KM_YEAR[ptClass] ? ptClass : 'unknown',
      reference_km_year: refKm,
      annual_mileage_km: Math.round(annual),
      usage_ratio: round2(usageRatio),
      annual_base_score: round2(annualBase),
      lifetime_mileage_adjustment: round2(lifetimeAdj),
      integrity_adjustment: round2(integrityAdj),
      integrity_state: integrityState,
      rollback_cap_applied: rollbackCap,
      final_score: finalScore,
    };
  }

  /* C. DAMAGE_REPAIR: тяжкість пошкоджень і підтвердженість відновлення.
     Доступна за тих самих умов, що HISTORY: перевірена чиста історія
     чесно дає 10, неперевірена не дає нічого */
  const drFactors = [];
  let drPen = 0;
  for (const ev of events) {
    const mult = dc.DR_REPAIR_MULT[ev.repair_status || 'unknown'];
    drPen += dc.DR_EVENT[ev.derived_severity] * mult;
    drFactors.push(ev.derived_severity + '_damage_repair_' + (ev.repair_status || 'unknown'));
    if (ev.structural && ev.repair_status !== 'confirmed_ok') { drPen += dc.DR_STRUCTURAL_UNRESOLVED; drFactors.push('structural_unresolved'); }
  }
  if (safety.length) { drPen += dc.DR_SRS_UNVERIFIED; drFactors.push('srs_restoration_unverified'); }
  if (has('POOR_REPAIR_VISIBLE')) { drPen += dc.DR_POOR_REPAIR; drFactors.push('poor_repair_visible'); }
  if (has('FLOOD')) { drPen += dc.DR_FLOOD; drFactors.push('flood_damage'); }
  if (has('FIRE')) { drPen += dc.DR_FIRE; drFactors.push('fire_damage'); }
  const damage_repair = dim(histAvailable || drFactors.length > 0, drPen, drFactors);

  /* D. CURRENT_CONDITION: лише ПОТОЧНИЙ vehicle-specific стан.
     Історичне ДТП саме по собі цю вісь НЕ знижує. "Дефектів не видно"
     НЕ дорівнює "ідеальний стан": база визначається силою visual
     evidence, 10.0 лише за справді виняткових доказів */
  const vev = input.visualEvidence || {};
  const photosN = n(cov.photos_count);
  const ccFactors = [];
  let ccPen = 0;
  if (has('POOR_REPAIR_VISIBLE')) { ccPen += dc.CC_POOR_REPAIR; ccFactors.push('poor_repair_visible'); }
  if (has('CRITICAL_WARNING_LIGHTS')) { ccPen += dc.CC_WARNING; ccFactors.push('warning_lights'); }
  let ccBase = dc.CC_BASE_DEFAULT;
  if (vev.flawless === true && vev.gallery_complete === true && photosN >= dc.CC_FLAWLESS_MIN_PHOTOS) { ccBase = dc.CC_FLAWLESS_FULL; ccFactors.push('showroom_condition_confirmed'); }
  else if (vev.flawless === true) { ccBase = dc.CC_FLAWLESS; ccFactors.push('flawless_on_available_photos'); }
  else if (vev.gallery_complete === true && photosN >= dc.CC_RICH_MIN_PHOTOS) { ccBase = dc.CC_BASE_RICH; }
  const ccAvailable = earned('current_photos') || ccFactors.length > 0;
  const current_condition = ccAvailable
    ? { score_available: true, score: round1(Math.max(0, Math.min(10, ccBase - ccPen))), main_factors: ccFactors.length ? ccFactors : ['no_visible_defects'] }
    : { score_available: false, score: null, main_factors: [] };

  /* E. TECHNICAL: лише конкретні vehicle-specific технічні знахідки.
     Generic болячки моделі без evidence на цій машині сюди не входять
     (їх відкидає sanitizeFindingsV3 ще на вході) */
  const techFactors = [];
  let techPen = 0;
  if (has('SRS_FAULT')) { techPen += dc.TECH_SRS_FAULT; techFactors.push('srs_fault'); }
  if (has('SERIOUS_POWERTRAIN_FAULT')) { techPen += dc.TECH_POWERTRAIN; techFactors.push('powertrain_fault'); }
  for (const p of problems.filter(x => x.type === 'MODIFICATION_TECHNICAL_CONCERN')) {
    const serious = p.serious_intervention && !p.maintenance_evidence;
    techPen += serious ? dc.TECH_MOD_SERIOUS : dc.TECH_MOD;
    techFactors.push(serious ? 'serious_modification_unverified' : 'technical_modification');
  }
  /* доступна ЛИШЕ коли є конкретний технічний факт по ЦІЙ машині
     (несправність SRS/powertrain, суттєва модифікація тощо): достатня
     кількість фото сама по собі технічну вісь НЕ відкриває */
  const technical = dim(techFactors.length > 0, techPen, techFactors);

  return { history, mileage, damage_repair, current_condition, technical };
}

/* ---------- дайджест для AI-висновку ----------
   ЄДИНЕ джерело чисел для тексту: бекенд. Модель нічого не рахує і не
   змінює; недоступні осі в дайджест не потрапляють взагалі */
export function buildScoreDigest(breakdown) {
  const b = breakdown || {};
  if (b.score_available !== true || !b.score_dimensions) return null;
  const dims = [];
  for (const [key, d] of Object.entries(b.score_dimensions)) {
    if (d && d.score_available === true && typeof d.score === 'number') {
      dims.push({ key, label_ua: DIMENSION_LABELS[key], score: d.score, main_factors: d.main_factors });
    }
  }
  const sorted = [...dims].sort((a, c) => a.score - c.score);
  return {
    calcar_score: b.final,
    risk_grade: b.grade,
    risk_label_ua: RISK_LABELS[b.grade] || null,
    limiting_factor: (b.limiting_factors && b.limiting_factors[0]) || null,
    applied_hard_caps: (b.applied_hard_caps || []).map(c => c.name),
    dimensions: dims,
    weakest: sorted.slice(0, 2).filter(d => d.score < 8).map(d => d.key),
    strongest: sorted.length ? [sorted[sorted.length - 1]].filter(d => d.score >= 8).map(d => d.key) : [],
  };
}
