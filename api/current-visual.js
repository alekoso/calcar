/* CalCar Check: Current Vehicle Vision v2, Phase 0 (offline harness).
   Спеціалізований структурний розбір ТЕКУЧИХ фото оголошення: "що
   обʼєктивно видно на цьому авто ЗАРАЗ". НЕ підключений до production
   Check: check.js цей модуль не імпортує; єдиний споживач у Phase 0 це
   benchmark-ендпоінт api/vision-bench.js.

   Межі (за ТЗ Phase 0):
   - лише поточні кадри: жодних історичних/аукціонних фото, hv, зон
     старого удару, before/after, оцінки якості відновлення;
   - без рішення, без Score, без історії, без болячок моделі, без цін
     опцій, без механічної діагностики по фото;
   - кожна знахідка посилається на ФІЗИЧНИЙ кадр: gallery_index (номер у
     галереї оголошення) + photo_identity (стабільний ключ файла без
     CDN-піддомену і query), а не на відносний photo_N вибірки.

   Чотири задачі: 1) стан по зонах; 2) візуально підтверджена
   комплектація; 3) помітні особливості / кандидати на модифікації;
   4) факти з приладової панелі (одометр, індикатори). */

import { photoIdentity, photoSetFingerprint, photoVariantWidth } from './vehicle-memory.js';

export const CURRENT_VISUAL_VERSION = 'cv-2026-09-10-v1';
export const MAX_FRAMES = 24;

export const EXTERIOR_ZONES = ['front', 'rear', 'left_front', 'left_side', 'left_rear', 'right_front', 'right_side', 'right_rear', 'roof', 'wheels'];
export const INTERIOR_ZONES = ['driver_area', 'front_passenger', 'front_seats', 'rear_seats', 'dashboard', 'center_console', 'doors', 'trunk'];
/* v1: моторний відсік і днище це legitimate-зони загального контракту
   (Phase 0 показала, що без них корозія днища губиться) */
export const EXTRA_EXTERIOR_ZONES = ['engine_bay', 'underbody'];
export const ZONES = [...EXTERIOR_ZONES, ...EXTRA_EXTERIOR_ZONES, ...INTERIOR_ZONES];
export const ALL_ZONES = ZONES;
export const VISIBILITY = ['sufficient', 'partial', 'not_visible'];
export const FINDING_KINDS = ['scratch_scuff', 'chip', 'dent', 'crack', 'broken_component', 'missing_component', 'panel_gap_alignment', 'paint_mismatch', 'repaint_sign',
  'wheel_damage', 'tire_issue', 'corrosion', 'wear', 'tear', 'plastic_damage', 'trim_damage', 'stain', 'headliner_damage', 'other_visible_damage'];
export const SEVERITY = ['minor', 'moderate', 'severe'];
export const CONFIDENCE = ['high', 'medium', 'low'];
export const EQUIPMENT_CATEGORIES = ['audio', 'roof', 'display', 'seats', 'climate', 'driver_assist', 'camera_parking', 'interior_trim', 'lighting', 'wheels', 'other'];
export const MOD_BASIS = ['brand_readable', 'aftermarket_look', 'non_standard_fitment', 'visible_alteration', 'unclear'];
export const QUALITY_FLAGS = ['studio', 'low_light', 'wet_surface', 'heavy_reflections', 'filters_or_editing', 'small_or_blurry', 'wrap_or_film_visible', 'dirt_or_snow'];
/* види знахідок, які без сильного видимого доказу дають лише low */
export const PAINT_KINDS = new Set(['paint_mismatch', 'repaint_sign']);
export const MIN_SIGN_CHARS = 12;
/* ознака "мʼяка": відблиск, освітлення, здогад. Для paint-видів це не доказ */
export const SOFT_SIGN_RE = /відблиск|відбит|блік|reflection|glare|освітлен|lighting|light angle|здається|можливо|ніби|схоже|мабуть|ймовірно|seems|appears|might|could be/i;

/* ---------- strict json_schema ---------- */
const S = (type, description, extra = {}) => ({ type, ...(description ? { description } : {}), ...extra });
const NS = description => ({ type: ['string', 'null'], ...(description ? { description } : {}) });
const E = (values, description) => ({ type: 'string', enum: values, ...(description ? { description } : {}) });
const OBJ = (properties, description) => ({ type: 'object', ...(description ? { description } : {}), properties, required: Object.keys(properties), additionalProperties: false });
const ARR = (items, description) => ({ type: 'array', ...(description ? { description } : {}), items });
const GI = S('integer', 'gallery_index кадру з підпису [gallery_index=N]');

const FINDING = OBJ({
  kind: E(FINDING_KINDS),
  severity: E(SEVERITY),
  sign: S('string', 'конкретна видима ознака на цьому кадрі'),
  gallery_index: GI,
  confidence: E(CONFIDENCE),
});
const ZONE = OBJ({
  visibility: E(VISIBILITY),
  frames: ARR(S('integer'), 'gallery_index кадрів, де ця зона видна'),
  findings: ARR(FINDING),
});

/* $defs: зона і знахідка описані один раз, 20 зон посилаються через $ref
   (strict json_schema це підтримує); інакше схема роздувається до ~24 KB
   і коштує токенів у кожному виклику */
export function buildCurrentVisualSchema() {
  const zones = {};
  for (const z of ZONES) zones[z] = { $ref: '#/$defs/zone' };
  const zoneDef = { ...ZONE, properties: { ...ZONE.properties, findings: ARR({ $ref: '#/$defs/finding' }) } };
  const schema = OBJ({
    coverage: OBJ({
      frames_received: S('integer'),
      frames_usable: S('integer', 'кадри достатньої якості для огляду'),
      quality_flags: ARR(E(QUALITY_FLAGS)),
      note: NS('1 речення про обмеження зйомки або null'),
    }),
    zones: OBJ(zones),
    equipment_visual: ARR(OBJ({
      normalized_name: S('string', 'коротка нормалізована назва: "Harman Kardon", "панорамний дах", "HUD"'),
      visible_label_or_feature: S('string', 'що саме видно: логотип, кнопка, елемент'),
      category: E(EQUIPMENT_CATEGORIES),
      gallery_index: GI,
      sign: S('string'),
      confidence: E(CONFIDENCE),
    })),
    modification_candidates: ARR(OBJ({
      feature: S('string'),
      basis: E(MOD_BASIS),
      gallery_index: GI,
      sign: S('string'),
      confidence: E(CONFIDENCE),
    })),
    dashboard: OBJ({
      visible: S('boolean'),
      ignition_on: S(['boolean', 'null']),
      odometer_reading: { anyOf: [OBJ({
        value: S('integer'), unit: E(['km', 'mi', 'unknown']), gallery_index: GI, sign: S('string'), confidence: E(CONFIDENCE),
      }), S('null')] },
      warning_lights: ARR(OBJ({ light: S('string'), gallery_index: GI, sign: S('string'), confidence: E(CONFIDENCE) })),
      readable_messages: ARR(OBJ({ text: S('string'), gallery_index: GI, confidence: E(CONFIDENCE) })),
    }),
    summary: S('string', '2-3 речення лише про побачене'),
  });
  schema.$defs = { finding: FINDING, zone: zoneDef };
  return schema;
}

export function currentVisualResponseFormat() {
  return { type: 'json_schema', json_schema: { name: 'calcar_current_visual', strict: true, schema: buildCurrentVisualSchema() } };
}

/* ---------- правила ---------- */
export const CURRENT_VISUAL_RULES = `Ти автомобільний оглядач CalCar. Перед тобою ЛИШЕ поточні фото з оголошення про продаж авто. Твоя єдина задача: структуровано зафіксувати, що ОБʼЄКТИВНО ВИДНО на цьому автомобілі ЗАРАЗ. Жодних висновків про історію, ДТП у минулому, якість ремонту, приховані пошкодження, механічний стан, реальний пробіг, вартість опцій чи рішення про покупку: це роблять інші компоненти.

КАДРИ: кожен кадр підписаний [gallery_index=N]. У будь-якому посиланні на кадр використовуй САМЕ це число. Кадр без підпису не існує. Кадр очевидно іншого авто (інша модель, колір, кузов) ігноруй.

СТОРОНИ: left/right це сторони САМОГО АВТО з місця водія, а не сторони кадру. Авто зняте спереду: права сторона авто візуально зліва кадру.

ЗОНИ (обовʼязково пройди КОЖНУ з 20 зон і постав visibility): зовнішні front, rear, left_front, left_side, left_rear, right_front, right_side, right_rear, roof, wheels, engine_bay (моторний відсік), underbody (днище); внутрішні driver_area, front_passenger, front_seats, rear_seats, dashboard, center_console, doors, trunk.
- sufficient: зона видна достатньо, щоб помітити помітну проблему;
- partial: видно частково, дрібні дефекти можна пропустити;
- not_visible: на кадрах зони немає.
frames: gallery_index кадрів, де зона видна. Зона sufficient з порожнім findings означає лише "на доступному зображенні помітної проблеми не знайдено", і НІКОЛИ: "заводська фарба", "ремонту не було", "прихованих пошкоджень немає".

ЩО ШУКАТИ ЗЗОВНІ (лише те, що справді видно): подряпини і потертості, сколи, вмʼятини, тріщини, зламані чи відсутні деталі, явно нерівний зазор чи посадка панелі, явний різнотон фарби, ознаки перефарбування чи дефекти покриття ЛИШЕ коли зображення реально це показує (шагрень, напил, маскувальні межі, сліди полірування), пошкодження дисків (бордюрні потертості, згини), очевидні проблеми шин (лише коли справді видно: знос до індикатора, тріщини, грижа), корозія (кузов, днище, вихлоп, кріплення, підрамники), видимі проблеми днища (течі, пошкоджені захисти, зірвані кріплення), видимі проблеми моторного відсіку (течі, пошкодження, відсутні деталі, кустарні переробки), інші очевидні пошкодження. Механічні діагнози по фото заборонені.
Різнотон і перефарбування: відблиск, різне освітлення чи кут зйомки НЕ є ознакою. Якщо єдине, що ти бачиш, це "виглядає інакше через світло", знахідку не створюй або став confidence low.

ЩО ШУКАТИ ВСЕРЕДИНІ: помітний знос керма (полірована шкіра, протертості), знос/тріщини/розриви сидінь, пошкодження пластику, дверних карт і накладок, помітні плями, пошкодження стелі, зламані чи відсутні елементи, інші очевидні візуальні проблеми. Дуже виражений знос фіксуй як факт (kind wear, severity за видимим ступенем), але НЕ роби висновків про реальний пробіг.

КОМПЛЕКТАЦІЯ (equipment_visual): опції, які можна ПІДТВЕРДИТИ фото: читабельний бренд акустики (Harman Kardon, Burmester, Bang & Olufsen, Bose, Bowers & Wilkins), панорамний дах, HUD (проектор на торпедо або проекція на склі), кнопки вентиляції/підігріву/масажу/памʼяті сидінь, електроприводи сидінь, апаратура чи кнопки адаптивного круїзу, індикатори контролю сліпих зон у дзеркалах, камери кругового огляду (обʼєктиви у дзеркалах, решітці, кришці багажника), задній клімат, цифрова приладова панель, спортивні сидіння, карбонові вставки, алькантара (лише за читабельним маркуванням чи однозначною фактурою), брендовані елементи інтерʼєру, інші явно видимі важливі опції. Для кожної: normalized_name, що саме видно, кадр, ознака, confidence. Бренд називай ЛИШЕ за читабельним логотипом; інакше клас ("преміум-акустика з окремими твітерами"). Ти НЕ вирішуєш, чи опція базова, платна, пакетна, рідкісна чи дорога: лише "видно ось це".

МОДИФІКАЦІЇ (modification_candidates): спойлери, обвіси, сплітери, дифузори, нестандартний випуск, диски незаводського вигляду (бренд лише якщо читабельний: "напис BBS на диску"), плівка, помітно занижена посадка, карбонові деталі, нештатні елементи у моторному відсіку чи салоні (впуск, кермо, екран, педалі; бренд лише читабельний). Для кожної basis: brand_readable (читабельний бренд нештатної деталі), visible_alteration (видно сліди переробки, нештатне кріплення, кустарну проводку), non_standard_fitment, aftermarket_look (лише вигляд), unclear. Заводське спортивне аеро (M, AMG, S line, GTS тощо) саме по собі НЕ модифікація: якщо не можна відрізнити від заводського виконання, basis unclear і confidence low. Вартість не пиши.

ПРИЛАДОВА ПАНЕЛЬ: якщо є кадр із увімкненою панеллю, прочитай одометр (число, одиниця, кадр, ознака: "цифри 30 688 km на екрані під спідометром"), індикатори попереджень (лише читабельні чи однозначно впізнавані піктограми, причину НЕ діагностуй) і інші читабельні важливі повідомлення. Нечитабельно: не вигадуй, odometer_reading null.

ОДОМЕТР НЕЗАЛЕЖНИЙ: читай цифри з кадру як є; жодних даних оголошення про пробіг у тебе немає і підганяти показання ні під що не треба. Сумнівні цифри: confidence low, а не вигадане число.

ДОКАЗОВІСТЬ: будь-яка знахідка, опція, модифікація чи показання панелі БЕЗ конкретного кадру і конкретної видимої ознаки не існує. sign описує те, що видно ("глибока подряпина до ґрунту на задньому лівому бампері"), а не висновок ("бампер ремонтували"). Краще пропустити сумнівне, ніж впевнено вигадати. Мова значень: українська, коротко.`;

/* кадри з підписами: gallery_index у тексті перед кожним зображенням */
export function frameContent(frames, detail = 'high') {
  const out = [{ type: 'text', text: 'КАДРИ ОГОЛОШЕННЯ: ' + frames.length + ' шт. Кожен підписаний [gallery_index=N]; посилайся лише на ці числа.' }];
  for (const f of frames) {
    out.push({ type: 'text', text: '[gallery_index=' + f.gallery_index + ']' });
    out.push({ type: 'image_url', image_url: { url: f.url, detail: detail === 'mixed' ? (f.high ? 'high' : 'low') : detail } });
  }
  return out;
}

/* один фізичний кадр один раз: галереї на кшталт BaT віддають той самий
   файл у 8-9 варіантах розміру (?w=150, ?resize=300,200 ...). Для Vision
   береться найкращий варіант: без query, інакше з найбільшою шириною;
   gallery_index лишається від ПЕРШОЇ появи кадру в галереї */
export const variantWidth = photoVariantWidth;
export function normalizeFrames(list) {
  const byId = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    const gi = Number.isInteger(x && x.gallery_index) ? x.gallery_index : parseInt(x && x.gallery_index, 10);
    const url = x && typeof x.url === 'string' ? x.url.trim().replace(/&amp;/g, '&') : '';
    if (!Number.isFinite(gi) || gi < 0 || !/^https?:\/\//i.test(url)) continue;
    const identity = photoIdentity(url);
    const cur = byId.get(identity);
    if (!cur) { byId.set(identity, { gallery_index: gi, url, identity, high: x.high === true }); continue; }
    if (variantWidth(url) > variantWidth(cur.url)) { cur.url = url; cur.high = cur.high || x.high === true; }
  }
  return [...byId.values()].slice(0, MAX_FRAMES);
}

export function frameSetFingerprint(frames) {
  return photoSetFingerprint(frames.map(f => f.url), CURRENT_VISUAL_VERSION);
}

/* ---------- gate: доказовість і стабільні посилання ----------
   Кожне посилання на кадр мусить бути на фізичний переданий кадр (інакше
   викидається), кожна ознака конкретна (інакше викидається), paint-види з
   "мʼякою" ознакою (відблиск, освітлення, здогад) знижуються до low,
   material = severity moderate|severe при confidence не low. Зони, яких
   модель не повернула, доповнюються not_visible. */
export function gateCurrentVisual(raw, frames) {
  const byIndex = new Map((frames || []).map(f => [f.gallery_index, f]));
  const stats = { dropped_bad_ref: 0, dropped_weak_sign: 0, downgraded_soft_paint: 0, zones_filled: 0, findings: 0, material_findings: 0, equipment: 0, modifications: 0, modifications_confirmed: 0, warning_lights: 0 };
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = v => typeof v === 'string' ? v.trim() : '';
  const ref = gi => { const f = byIndex.get(gi); return f ? { gallery_index: gi, photo_identity: f.identity } : null; };
  const withRef = (item, needSign = true) => {
    const rf = ref(item && item.gallery_index);
    if (!rf) { stats.dropped_bad_ref++; return null; }
    if (needSign && str(item.sign).length < MIN_SIGN_CHARS) { stats.dropped_weak_sign++; return null; }
    return rf;
  };
  const conf = v => CONFIDENCE.includes(v) ? v : 'low';
  const out = {
    version: CURRENT_VISUAL_VERSION,
    coverage: {
      frames_received: (frames || []).length,
      frames_usable: Number.isInteger(r.coverage && r.coverage.frames_usable) ? Math.min(r.coverage.frames_usable, (frames || []).length) : null,
      quality_flags: Array.isArray(r.coverage && r.coverage.quality_flags) ? r.coverage.quality_flags.filter(x => QUALITY_FLAGS.includes(x)) : [],
      note: str(r.coverage && r.coverage.note) || null,
    },
    zones: {},
    equipment_visual: [],
    modification_candidates: [],
    dashboard: { visible: false, ignition_on: null, odometer_reading: null, warning_lights: [], readable_messages: [] },
    summary: str(r.summary).slice(0, 600),
  };
  const zonesIn = r.zones && typeof r.zones === 'object' ? r.zones : {};
  for (const z of ALL_ZONES) {
    const zi = zonesIn[z];
    if (!zi || typeof zi !== 'object') { stats.zones_filled++; out.zones[z] = { visibility: 'not_visible', frames: [], findings: [] }; continue; }
    const frs = (Array.isArray(zi.frames) ? zi.frames : []).filter(gi => byIndex.has(gi));
    const findings = [];
    for (const f of Array.isArray(zi.findings) ? zi.findings : []) {
      if (!f || !FINDING_KINDS.includes(f.kind)) continue;
      const rf = withRef(f);
      if (!rf) continue;
      let confidence = conf(f.confidence);
      if (PAINT_KINDS.has(f.kind) && SOFT_SIGN_RE.test(f.sign) && confidence !== 'low') { confidence = 'low'; stats.downgraded_soft_paint++; }
      const severity = SEVERITY.includes(f.severity) ? f.severity : 'minor';
      const material = severity !== 'minor' && confidence !== 'low';
      findings.push({ kind: f.kind, severity, sign: str(f.sign).slice(0, 240), ...rf, confidence, material });
      stats.findings++; if (material) stats.material_findings++;
    }
    let visibility = VISIBILITY.includes(zi.visibility) ? zi.visibility : 'not_visible';
    if (visibility !== 'not_visible' && !frs.length && !findings.length) visibility = 'not_visible';
    out.zones[z] = { visibility, frames: frs, findings };
  }
  for (const e of Array.isArray(r.equipment_visual) ? r.equipment_visual : []) {
    if (!e || !str(e.normalized_name)) continue;
    const rf = withRef(e); if (!rf) continue;
    out.equipment_visual.push({ normalized_name: str(e.normalized_name).slice(0, 80), concept: equipmentConcept(e.normalized_name), visible_label_or_feature: str(e.visible_label_or_feature).slice(0, 160), category: EQUIPMENT_CATEGORIES.includes(e.category) ? e.category : 'other', ...rf, sign: str(e.sign).slice(0, 240), confidence: conf(e.confidence) });
    stats.equipment++;
  }
  for (const m of Array.isArray(r.modification_candidates) ? r.modification_candidates : []) {
    if (!m || !str(m.feature)) continue;
    const rf = withRef(m); if (!rf) continue;
    const mod = { feature: str(m.feature).slice(0, 120), basis: MOD_BASIS.includes(m.basis) ? m.basis : 'unclear', ...rf, sign: str(m.sign).slice(0, 240), confidence: conf(m.confidence) };
    mod.confirmed = modificationConfirmed(mod);
    out.modification_candidates.push(mod);
    stats.modifications++; if (mod.confirmed) stats.modifications_confirmed++;
  }
  const d = r.dashboard && typeof r.dashboard === 'object' ? r.dashboard : {};
  out.dashboard.visible = d.visible === true;
  out.dashboard.ignition_on = typeof d.ignition_on === 'boolean' ? d.ignition_on : null;
  if (d.odometer_reading && typeof d.odometer_reading === 'object') {
    const o = d.odometer_reading;
    const rf = withRef(o);
    const value = Number.isInteger(o.value) ? o.value : parseInt(o.value, 10);
    if (rf && Number.isFinite(value) && value > 0 && value < 2000000) {
      out.dashboard.odometer_reading = { value, unit: ['km', 'mi'].includes(o.unit) ? o.unit : 'unknown', ...rf, sign: str(o.sign).slice(0, 240), confidence: conf(o.confidence) };
    }
  }
  for (const w of Array.isArray(d.warning_lights) ? d.warning_lights : []) {
    if (!w || !str(w.light)) continue;
    const rf = withRef(w); if (!rf) continue;
    out.dashboard.warning_lights.push({ light: str(w.light).slice(0, 80), ...rf, sign: str(w.sign).slice(0, 240), confidence: conf(w.confidence) });
    stats.warning_lights++;
  }
  for (const m of Array.isArray(d.readable_messages) ? d.readable_messages : []) {
    if (!m || !str(m.text)) continue;
    const rf = ref(m.gallery_index); if (!rf) { stats.dropped_bad_ref++; continue; }
    out.dashboard.readable_messages.push({ text: str(m.text).slice(0, 160), ...rf, confidence: conf(m.confidence) });
  }
  return { current_visual: out, stats };
}


/* ======================================================================
   Phase 0B: три паралельні спеціалісти (exterior / interior+equipment /
   dashboard) на тих самих кадрах. Маршрутизація за типами кадрів
   селектора (ті самі 15 категорій, що в production photo selector); у
   benchmark типи для галерей без селектора дає та сама класифікація.
   ====================================================================== */
export const SELECTOR_TYPES = ['front', 'rear', 'side', 'dashboard', 'steering', 'center_console', 'doors', 'front_seats', 'rear_seats', 'roof', 'trunk', 'engine_bay', 'wheels', 'detail', 'other'];
/* той самий текст, що в production селекторі (api/check.js), лише підпис
   кадру i=<gallery_index> замість порядкового номера */
export const SELECTOR_PROMPT = 'Класифікуй кадри оголошення авто за типом. Відповідай ЛИШЕ валідним JSON {"frames":[{"i":1,"type":"front"}]} з записом для КОЖНОГО кадру. type СТРОГО з переліку: front | rear | side | dashboard | steering | center_console | doors | front_seats | rear_seats | roof | trunk | engine_bay | wheels | detail | other. i це число з підпису i=N перед кадром.';
export const ROUTE = {
  exterior: new Set(['front', 'rear', 'side', 'wheels', 'roof', 'engine_bay', 'detail', 'other']),
  interior: new Set(['dashboard', 'steering', 'center_console', 'doors', 'front_seats', 'rear_seats', 'trunk', 'roof', 'detail']),
  /* приладові факти бувають і на центральному екрані (Tesla: одометр і
     попередження лише там), тому center_console третім пріоритетом */
  dashboard: ['dashboard', 'steering', 'center_console'],
};
export const DASHBOARD_MAX_FRAMES = 3;
/* frames: [{gallery_index, url, identity, high}], types: {gallery_index: type}.
   Кадр без типу трактується як detail (іде обом condition-спеціалістам).
   Dashboard: 1-3 найкращі кадри приладів/екранів: спершу type dashboard
   (high раніше low), потім steering, потім center_console. */
export function routeFrames(frames, types = {}) {
  const t = f => SELECTOR_TYPES.includes(types[f.gallery_index]) ? types[f.gallery_index] : 'detail';
  const exterior = frames.filter(f => ROUTE.exterior.has(t(f)));
  const interior = frames.filter(f => ROUTE.interior.has(t(f)));
  const rank = f => (ROUTE.dashboard.indexOf(t(f)) * 2) + (f.high ? 0 : 1);
  const dashboard = frames.filter(f => ROUTE.dashboard.includes(t(f))).sort((a, b) => rank(a) - rank(b) || a.gallery_index - b.gallery_index).slice(0, DASHBOARD_MAX_FRAMES);
  return { exterior, interior, dashboard, types: Object.fromEntries(frames.map(f => [f.gallery_index, t(f)])) };
}

const COMMON_HEAD = `КАДРИ: кожен кадр підписаний [gallery_index=N]. У будь-якому посиланні на кадр використовуй САМЕ це число. Кадр без підпису не існує. Кадр очевидно іншого авто (інша модель, колір, кузов) або сторонню графіку ігноруй.

СТОРОНИ: left/right це сторони САМОГО АВТО з місця водія, а не сторони кадру. Авто зняте спереду: права сторона авто візуально зліва кадру.

ДОКАЗОВІСТЬ: будь-яка знахідка без конкретного кадру і конкретної видимої ознаки не існує. sign описує те, що видно, а не висновок. Краще пропустити сумнівне, ніж впевнено вигадати. Мова значень: українська, коротко.`;
const ZONE_SEMANTICS = `Для КОЖНОЇ зі своїх зон постав visibility: sufficient (видно достатньо, щоб помітити помітну проблему), partial (видно частково), not_visible (на кадрах зони немає); frames: gallery_index кадрів, де зона видна. Зона sufficient з порожнім findings означає лише "на доступному зображенні помітної проблеми не знайдено", і НІКОЛИ: "заводська фарба", "ремонту не було", "прихованих пошкоджень немає".`;

export const SPECIALIST_RULES = {
  exterior: `Ти оглядач зовнішнього стану авто CalCar. Перед тобою ЛИШЕ поточні зовнішні кадри оголошення (кузов, колеса, дах, моторний відсік, днище, деталі). Єдина задача: зафіксувати ФАКТИЧНИЙ поточний стан. Жодних висновків про історію, минулі ДТП, якість ремонту, механіку чи рішення.

${COMMON_HEAD}

ЗОНИ (12): front, rear, left_front, left_side, left_rear, right_front, right_side, right_rear, roof, wheels, engine_bay, underbody. ${ZONE_SEMANTICS}

ЩО ШУКАТИ (лише те, що справді видно): подряпини і потертості, сколи, вмʼятини, тріщини, зламані чи відсутні деталі, явно нерівний зазор чи посадка панелі, явний різнотон фарби, ознаки перефарбування чи дефекти покриття ЛИШЕ коли зображення реально це показує (шагрень, напил, маскувальні межі, сліди полірування), пошкодження дисків (бордюрні потертості, згини), очевидні проблеми шин (знос до індикатора, тріщини, грижа), корозія (кузов, днище, вихлоп, кріплення, підрамники), видимі проблеми днища (течі, пошкоджені захисти, зірвані кріплення), видимі проблеми моторного відсіку (течі, пошкодження, відсутні деталі, кустарні переробки), інші очевидні пошкодження. Різнотон і перефарбування: відблиск, різне освітлення чи кут зйомки НЕ є ознакою; якщо єдине, що ти бачиш, це "виглядає інакше через світло", знахідку не створюй або став confidence low. Механічні діагнози по фото заборонені.

ЗОВНІШНІ МОДИФІКАЦІЇ (modification_candidates): спойлери, обвіси, сплітери, дифузори, нестандартний випуск, диски незаводського вигляду (бренд лише якщо читабельний), плівка, помітно занижена посадка, карбонові деталі, нештатні елементи у моторному відсіку (впуск, блоу-офф тощо, бренд лише читабельний). basis: brand_readable (читабельний бренд), visible_alteration (видно сліди переробки чи нештатне кріплення), non_standard_fitment, aftermarket_look (лише вигляд), unclear. Якщо неможливо відрізнити від заводського виконання, basis unclear і confidence low. Вартість не пиши.`,

  interior: `Ти оглядач салону і комплектації авто CalCar. Перед тобою ЛИШЕ поточні кадри салону, дверей, багажника і деталей оголошення. Дві задачі: (1) фактичний стан салону; (2) комплектація, яку МОЖНА ПІДТВЕРДИТИ фото. Жодних висновків про історію, реальний пробіг, вартість опцій чи рішення.

${COMMON_HEAD}

ЗОНИ (8): driver_area, front_passenger, front_seats, rear_seats, dashboard, center_console, doors, trunk. ${ZONE_SEMANTICS}

СТАН: помітний знос керма (полірована шкіра, протертості), знос/тріщини/розриви сидінь, пошкодження пластику, дверних карт і накладок, помітні плями, пошкодження стелі, зламані чи відсутні елементи, інші очевидні візуальні проблеми. Дуже виражений знос фіксуй як факт (kind wear), але НЕ роби висновків про реальний пробіг.

КОМПЛЕКТАЦІЯ (equipment_visual): опції, які підтверджує кадр: читабельний бренд акустики (Harman Kardon, Burmester, Bang & Olufsen, Bose, Bowers & Wilkins), панорамний дах або люк, HUD (проектор на торпедо чи проекція на склі), кнопки вентиляції / підігріву / масажу / памʼяті сидінь, електроприводи сидінь, кнопки чи важелі адаптивного круїзу і асистентів, індикатори контролю сліпих зон у дзеркалах, обʼєктиви камер (дзеркала, решітка, кришка багажника), задній клімат, цифрова приладова панель, спортивні сидіння, карбонові чи преміальні вставки, алькантара (лише за читабельним маркуванням чи однозначною фактурою), брендовані елементи інтерʼєру, інші явно видимі важливі опції. Для кожної: normalized_name (коротко і однаково для однакових речей: "камера заднього виду", "електрорегулювання передніх сидінь", "підігрів передніх сидінь"), що саме видно, категорія, кадр, ознака, confidence. Бренд ЛИШЕ за читабельним логотипом. Ти НЕ вирішуєш, чи опція базова, платна, пакетна, рідкісна чи дорога.

ВНУТРІШНІ МОДИФІКАЦІЇ (modification_candidates): нештатні керма, накладки, екрани, мультимедіа, спортивні педалі тощо, лише з basis і видимою ознакою; заводське від нештатного не відрізнити: basis unclear, confidence low.`,

  dashboard: `Ти зчитувач приладової панелі CalCar. Перед тобою 1-3 поточні кадри приладів / екранів авто. Єдина задача: ВИТЯГТИ читабельні факти. Причини попереджень не пояснюй, стан авто не оцінюй.

${COMMON_HEAD}

ОДОМЕТР: якщо число пробігу читабельне, поверни value (ціле), unit (km | mi | unknown), кадр, ознаку ("цифри 151975 km у нижньому рядку між шкалами"), confidence. Нечитабельно або нема: odometer_reading null, не вигадуй.
ІНДИКАТОРИ: лише читабельні написи чи однозначно впізнавані піктограми (check engine, ABS, подушка/SRS, тиск у шинах, рівень пального, акумулятор, температура, service). Кожен з кадром і ознакою.
ПОВІДОМЛЕННЯ: інші читабельні важливі повідомлення на приладах або центральному екрані (сервіс, помилки, пакети функцій, оновлення). Дрібне меню без значення не перелічуй.`,
};

const S2 = (type, description, extra = {}) => ({ type, ...(description ? { description } : {}), ...extra });
export function buildSpecialistSchema(kind) {
  const zoneRef = { $ref: '#/$defs/zone' };
  const zoneDef = { ...ZONE, properties: { ...ZONE.properties, findings: ARR({ $ref: '#/$defs/finding' }) } };
  const mods = ARR(OBJ({ feature: S2('string'), basis: E(MOD_BASIS), gallery_index: GI, sign: S2('string'), confidence: E(CONFIDENCE) }));
  const coverage = OBJ({ frames_received: S2('integer'), frames_usable: S2('integer'), quality_flags: ARR(E(QUALITY_FLAGS)), note: NS('1 речення про обмеження або null') });
  let schema;
  if (kind === 'exterior') {
    const zones = {}; for (const z of [...EXTERIOR_ZONES, ...EXTRA_EXTERIOR_ZONES]) zones[z] = zoneRef;
    schema = OBJ({ coverage, zones: OBJ(zones), modification_candidates: mods, summary: S2('string') });
    schema.$defs = { finding: FINDING, zone: zoneDef };
  } else if (kind === 'interior') {
    const zones = {}; for (const z of INTERIOR_ZONES) zones[z] = zoneRef;
    schema = OBJ({
      coverage, zones: OBJ(zones),
      equipment_visual: ARR(OBJ({ normalized_name: S2('string'), visible_label_or_feature: S2('string'), category: E(EQUIPMENT_CATEGORIES), gallery_index: GI, sign: S2('string'), confidence: E(CONFIDENCE) })),
      modification_candidates: mods, summary: S2('string'),
    });
    schema.$defs = { finding: FINDING, zone: zoneDef };
  } else if (kind === 'dashboard') {
    schema = OBJ({
      frames_usable: S2('integer'),
      dashboard: OBJ({
        visible: S2('boolean'), ignition_on: S2(['boolean', 'null']),
        odometer_reading: { anyOf: [OBJ({ value: S2('integer'), unit: E(['km', 'mi', 'unknown']), gallery_index: GI, sign: S2('string'), confidence: E(CONFIDENCE) }), S2('null')] },
        warning_lights: ARR(OBJ({ light: S2('string'), gallery_index: GI, sign: S2('string'), confidence: E(CONFIDENCE) })),
        readable_messages: ARR(OBJ({ text: S2('string'), gallery_index: GI, confidence: E(CONFIDENCE) })),
      }),
    });
  } else throw new Error('unknown specialist ' + kind);
  return schema;
}
export function specialistResponseFormat(kind) {
  return { type: 'json_schema', json_schema: { name: 'calcar_current_visual_' + kind, strict: true, schema: buildSpecialistSchema(kind) } };
}

/* результат спеціаліста -> та сама форма, що в general (через gate), лише
   свої частини; решта порожня */
export function gateSpecialist(kind, raw, frames) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const shaped = { coverage: r.coverage || { frames_usable: r.frames_usable }, zones: r.zones || {}, equipment_visual: kind === 'interior' ? r.equipment_visual : [], modification_candidates: kind === 'dashboard' ? [] : r.modification_candidates, dashboard: kind === 'dashboard' ? r.dashboard : {}, summary: r.summary || '' };
  const out = gateCurrentVisual(shaped, frames);
  out.current_visual.specialist = kind;
  return out;
}

/* злиття трьох спеціалістів у один current_visual: зони від свого
   спеціаліста (exterior: 10 + engine_bay/underbody; interior: 8), опції
   від interior, модифікації обʼєднані з позначкою джерела, приладова
   панель від dashboard-спеціаліста (або порожня, якщо кадрів приладів не
   було) */
export function mergeSpecialists({ exterior = null, interior = null, dashboard = null } = {}, frames = []) {
  const empty = gateCurrentVisual(null, frames).current_visual;
  const out = { ...empty, version: CURRENT_VISUAL_VERSION + '-parallel', zones: {}, specialists: {} };
  for (const z of ALL_ZONES) {
    const src = INTERIOR_ZONES.includes(z) ? interior : exterior;
    out.zones[z] = src && src.zones && src.zones[z] ? src.zones[z] : { visibility: 'not_visible', frames: [], findings: [] };
  }
  out.equipment_visual = interior ? interior.equipment_visual : [];
  out.modification_candidates = [
    ...(exterior ? exterior.modification_candidates.map(m => ({ ...m, source: 'exterior' })) : []),
    ...(interior ? interior.modification_candidates.map(m => ({ ...m, source: 'interior' })) : []),
  ];
  out.dashboard = dashboard ? dashboard.dashboard : empty.dashboard;
  out.coverage = {
    frames_received: frames.length,
    frames_usable: [exterior, interior].filter(Boolean).reduce((n, x) => n + (x.coverage.frames_usable || 0), 0) || null,
    quality_flags: [...new Set([...(exterior ? exterior.coverage.quality_flags : []), ...(interior ? interior.coverage.quality_flags : [])])],
    note: [exterior && exterior.coverage.note, interior && interior.coverage.note].filter(Boolean).join(' ') || null,
  };
  out.summary = [exterior && exterior.summary, interior && interior.summary].filter(Boolean).join(' ');
  out.specialists = { exterior: !!exterior, interior: !!interior, dashboard: !!dashboard };
  return out;
}

/* легка нормалізація понять комплектації для порівняння між прогонами:
   синоніми одного поняття ("камера заднього виду" / "задня камера") дають
   один ключ. Це НЕ база опцій і не показується користувачу */
export const EQUIPMENT_CONCEPTS = [
  ['harman_kardon', /harman/i], ['bose', /\bbose\b/i], ['burmester', /burmester/i], ['bang_olufsen', /bang|olufsen|b&o/i], ['bowers_wilkins', /bowers|b&w/i], ['premium_audio', /акустик|аудіо|audio|динамік|сабвуфер/i],
  ['panoramic_roof', /панорам|люк|sunroof/i], ['hud', /\bhud\b|проекц/i], ['digital_cluster', /цифров.*(панел|прилад)|virtual cockpit/i], ['central_display', /центральн.*(дисплей|екран)|мультимед.*екран|екран мультимед|сенсорн.*(дисплей|екран)|мультимедійн.*систем/i],
  ['heated_wheel', /підігрів.*керм|керм.*підігрів/i],
  ['seat_power', /електрорегул|електропривод|електричн.*(сидін|крісл)/i], ['seat_memory', /пам.?ят/i], ['seat_heating', /підігрів/i], ['seat_ventilation', /вентиляц/i], ['seat_massage', /масаж/i], ['sport_seats', /спортивн.*(сид|крісл)|бічн.*підтрим|комфортн.*сид/i], ['leather', /шкір/i],
  ['rear_climate', /задн.*(клімат|дефлектор|обдув)|дефлектор.*задн/i], ['dual_zone_climate', /двозонн|роздільн.*клімат|клімат-контрол/i], ['ambient_lighting', /підсвіч|підсвіт|ambient/i], ['wood_trim', /дерев/i], ['carbon_trim', /карбон|вуглепласт/i], ['alcantara', /алькантар|замш/i], ['aluminium_trim', /алюмін/i],
  ['parking_sensors', /паркув|парктрон|датчик/i], ['rear_camera', /камера заднього|задня камера|камера.*задн/i], ['surround_camera', /кругов|360|камера в корпусі|камер.*дзеркал/i], ['adaptive_cruise', /круїз|cruise|дистрон/i], ['lane_assist', /смуг/i], ['blind_spot', /сліп/i], ['gesture_control', /жест/i], ['navigation', /навігац/i], ['driver_assist_other', /асистент|автопілот|попереджен|гальмуван/i],
  ['carplay', /carplay|android auto/i], ['m_steering_wheel', /кермо|кермов/i], ['sport_chrono_clock', /chrono|годинник|хронометр/i], ['paddles', /пелюст/i], ['colored_calipers', /супорт/i], ['badge', /edrive|напис|шильд/i], ['roof_rails', /рейлінг/i], ['fog_lights', /протитуман/i], ['manual_gearbox', /механічн.*коробк/i], ['cargo_cover', /шторк|сітк/i], ['keyless', /безключов|keyless/i], ['led_lights', /led|світлодіод|лазерн|адаптивн.*(фар|оптик)/i], ['wireless_charging', /бездрот.*заряд/i], ['heated_wheel', /підігрів.*керм/i],
];
export function equipmentConcept(name) {
  const n = String(name || '').toLowerCase();
  for (const [key, rx] of EQUIPMENT_CONCEPTS) if (rx.test(n)) return key;
  return 'other:' + n.replace(/\s+/g, ' ').trim().slice(0, 60);
}
/* модифікація "підтверджена" лише з читабельним брендом або видимою переробкою */
export function modificationConfirmed(m) {
  return !!m && (m.basis === 'brand_readable' || m.basis === 'visible_alteration') && m.confidence !== 'low';
}


/* ======================================================================
   v1 (Phase 1, shadow): план деталізації кадрів, незалежне порівняння
   одометра з пробігом оголошення, компактна телеметрія.
   ====================================================================== */
/* mixed detail: high для кадрів, де важливі текст і дрібні елементи
   (прилади, екрани, деталі/брендування, диски, моторний відсік) і для
   high-слотів production-селектора; решта low. Без типів кадрів (галерея
   <=24, селектор не запускався) всі кадри high: дешевше, ніж ризикувати
   нечитабельним одометром */
export const HIGH_DETAIL_TYPES = new Set(['dashboard', 'steering', 'center_console', 'detail', 'wheels', 'engine_bay']);
export function frameDetailPlan(frames, types = null, highSet = null) {
  const hasTypes = types && typeof types === 'object' && Object.keys(types).length > 0;
  const out = frames.map(f => {
    const t = hasTypes ? types[f.gallery_index] : null;
    const high = !hasTypes || HIGH_DETAIL_TYPES.has(t) || (highSet ? highSet.has(f.gallery_index) : false) || f.high === true;
    return { ...f, high, type: t || null };
  });
  return {
    frames: out,
    source: hasTypes ? 'selector_types' : 'all_high_no_types',
    high: out.filter(f => f.high).map(f => f.gallery_index),
    low: out.filter(f => !f.high).map(f => f.gallery_index),
  };
}

/* Візуальний одометр НЕЗАЛЕЖНИЙ від оголошення: модель пробігу оголошення
   не бачить. Порівняння детерміноване і живе лише в телеметрії
   (Score v3 не змінюється). candidate: розбіжність >= 3% і >= 500 км */
export const ODOMETER_DISCREPANCY_MIN_PCT = 3;
export const ODOMETER_DISCREPANCY_MIN_KM = 500;
export function odometerDiscrepancy(cv, listingOdometerKm) {
  const o = cv && cv.dashboard && cv.dashboard.odometer_reading;
  const listing = Number.isFinite(Number(listingOdometerKm)) && Number(listingOdometerKm) > 0 ? Math.round(Number(listingOdometerKm)) : null;
  if (!o) return { status: 'no_visual_reading', listing_km: listing };
  const visualKm = o.unit === 'mi' ? Math.round(o.value * 1.609344) : o.unit === 'km' ? o.value : null;
  if (visualKm === null) return { status: 'unit_unknown', visual_value: o.value, gallery_index: o.gallery_index, listing_km: listing, confidence: o.confidence };
  if (listing === null) return { status: 'no_listing_mileage', visual_km: visualKm, gallery_index: o.gallery_index, confidence: o.confidence };
  const delta = visualKm - listing;
  const pct = Math.round(Math.abs(delta) / listing * 1000) / 10;
  const candidate = Math.abs(delta) >= ODOMETER_DISCREPANCY_MIN_KM && pct >= ODOMETER_DISCREPANCY_MIN_PCT;
  return { status: candidate ? 'discrepancy_candidate' : 'consistent', visual_km: visualKm, listing_km: listing, delta_km: delta, delta_pct: pct, gallery_index: o.gallery_index, photo_identity: o.photo_identity, confidence: o.confidence, candidate };
}

export function summarizeCurrentVisual(cv, stats) {
  if (!cv) return null;
  const vis = { sufficient: 0, partial: 0, not_visible: 0 };
  let findings = 0, material = 0;
  for (const z of Object.values(cv.zones || {})) { vis[z.visibility] = (vis[z.visibility] || 0) + 1; findings += z.findings.length; material += z.findings.filter(f => f.material).length; }
  const o = cv.dashboard && cv.dashboard.odometer_reading;
  return {
    version: cv.version,
    coverage: cv.coverage,
    zones: vis,
    findings: { total: findings, material },
    equipment: { total: cv.equipment_visual.length, concepts: [...new Set(cv.equipment_visual.map(e => e.concept))] },
    odometer: o ? { value: o.value, unit: o.unit, gallery_index: o.gallery_index, confidence: o.confidence } : null,
    warning_lights: cv.dashboard ? cv.dashboard.warning_lights.map(w => w.light) : [],
    messages: cv.dashboard ? cv.dashboard.readable_messages.length : 0,
    modifications: { total: cv.modification_candidates.length, confirmed: cv.modification_candidates.filter(m => m.confirmed).length },
    gate: stats || null,
  };
}
