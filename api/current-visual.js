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

import { photoIdentity, photoSetFingerprint } from './vehicle-memory.js';

export const CURRENT_VISUAL_VERSION = 'cv-2026-09-10-p0';
export const MAX_FRAMES = 24;

export const EXTERIOR_ZONES = ['front', 'rear', 'left_front', 'left_side', 'left_rear', 'right_front', 'right_side', 'right_rear', 'roof', 'wheels'];
export const INTERIOR_ZONES = ['driver_area', 'front_passenger', 'front_seats', 'rear_seats', 'dashboard', 'center_console', 'doors', 'trunk'];
export const ZONES = [...EXTERIOR_ZONES, ...INTERIOR_ZONES];
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

/* $defs: зона і знахідка описані один раз, 18 зон посилаються через $ref
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
    notable_visual_features: ARR(OBJ({
      feature: S('string'),
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

ЗОНИ (обовʼязково пройди КОЖНУ з 18 зон і постав visibility):
- sufficient: зона видна достатньо, щоб помітити помітну проблему;
- partial: видно частково, дрібні дефекти можна пропустити;
- not_visible: на кадрах зони немає.
frames: gallery_index кадрів, де зона видна. Зона sufficient з порожнім findings означає лише "на доступному зображенні помітної проблеми не знайдено", і НІКОЛИ: "заводська фарба", "ремонту не було", "прихованих пошкоджень немає".

ЩО ШУКАТИ ЗЗОВНІ (лише те, що справді видно): подряпини і потертості, сколи, вмʼятини, тріщини, зламані чи відсутні деталі, явно нерівний зазор чи посадка панелі, явний різнотон фарби, ознаки перефарбування чи дефекти покриття ЛИШЕ коли зображення реально це показує (шагрень, напил, маскувальні межі, сліди полірування), пошкодження дисків (бордюрні потертості, згини), очевидні проблеми шин (лише коли справді видно: знос до індикатора, тріщини, грижа), корозія, інші очевидні пошкодження.
Різнотон і перефарбування: відблиск, різне освітлення чи кут зйомки НЕ є ознакою. Якщо єдине, що ти бачиш, це "виглядає інакше через світло", знахідку не створюй або став confidence low.

ЩО ШУКАТИ ВСЕРЕДИНІ: помітний знос керма (полірована шкіра, протертості), знос/тріщини/розриви сидінь, пошкодження пластику, дверних карт і накладок, помітні плями, пошкодження стелі, зламані чи відсутні елементи, інші очевидні візуальні проблеми. Дуже виражений знос фіксуй як факт (kind wear, severity за видимим ступенем), але НЕ роби висновків про реальний пробіг.

КОМПЛЕКТАЦІЯ (equipment_visual): опції, які можна ПІДТВЕРДИТИ фото: читабельний бренд акустики (Harman Kardon, Burmester, Bang & Olufsen, Bose, Bowers & Wilkins), панорамний дах, HUD (проектор на торпедо або проекція на склі), кнопки вентиляції/підігріву/масажу/памʼяті сидінь, електроприводи сидінь, апаратура чи кнопки адаптивного круїзу, індикатори контролю сліпих зон у дзеркалах, камери кругового огляду (обʼєктиви у дзеркалах, решітці, кришці багажника), задній клімат, цифрова приладова панель, спортивні сидіння, карбонові вставки, алькантара (лише за читабельним маркуванням чи однозначною фактурою), брендовані елементи інтерʼєру, інші явно видимі важливі опції. Для кожної: normalized_name, що саме видно, кадр, ознака, confidence. Бренд називай ЛИШЕ за читабельним логотипом; інакше клас ("преміум-акустика з окремими твітерами"). Ти НЕ вирішуєш, чи опція базова, платна, пакетна, рідкісна чи дорога: лише "видно ось це".

ПОМІТНІ ОСОБЛИВОСТІ І МОДИФІКАЦІЇ: спойлери, обвіси, сплітери, дифузори, нестандартний випуск, диски незаводського вигляду (бренд лише якщо читабельний: "напис BBS на диску"), плівка, помітно занижена посадка, карбонові зовнішні деталі, нестандартні елементи в салоні. Якщо неможливо відрізнити від заводського виконання, пиши в notable_visual_features ("великий задній спойлер"), а не в modification_candidates. У modification_candidates лише з basis і видимою ознакою; вартість чи "тюнінг за $" не пиши.

ПРИЛАДОВА ПАНЕЛЬ: якщо є кадр із увімкненою панеллю, прочитай одометр (число, одиниця, кадр, ознака: "цифри 30 688 km на екрані під спідометром"), індикатори попереджень (лише читабельні чи однозначно впізнавані піктограми, причину НЕ діагностуй) і інші читабельні важливі повідомлення. Нечитабельно: не вигадуй, odometer_reading null.

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
export function variantWidth(url) {
  const m = /[?&](?:w|width)=(\d+)|[?&]resize=(\d+)/.exec(String(url));
  return m ? parseInt(m[1] || m[2], 10) : Infinity;
}
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
  const stats = { dropped_bad_ref: 0, dropped_weak_sign: 0, downgraded_soft_paint: 0, zones_filled: 0, findings: 0, material_findings: 0, equipment: 0, modifications: 0, notable: 0, warning_lights: 0 };
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
    notable_visual_features: [],
    modification_candidates: [],
    dashboard: { visible: false, ignition_on: null, odometer_reading: null, warning_lights: [], readable_messages: [] },
    summary: str(r.summary).slice(0, 600),
  };
  const zonesIn = r.zones && typeof r.zones === 'object' ? r.zones : {};
  for (const z of ZONES) {
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
    out.equipment_visual.push({ normalized_name: str(e.normalized_name).slice(0, 80), visible_label_or_feature: str(e.visible_label_or_feature).slice(0, 160), category: EQUIPMENT_CATEGORIES.includes(e.category) ? e.category : 'other', ...rf, sign: str(e.sign).slice(0, 240), confidence: conf(e.confidence) });
    stats.equipment++;
  }
  for (const n of Array.isArray(r.notable_visual_features) ? r.notable_visual_features : []) {
    if (!n || !str(n.feature)) continue;
    const rf = withRef(n); if (!rf) continue;
    out.notable_visual_features.push({ feature: str(n.feature).slice(0, 120), ...rf, sign: str(n.sign).slice(0, 240), confidence: conf(n.confidence) });
    stats.notable++;
  }
  for (const m of Array.isArray(r.modification_candidates) ? r.modification_candidates : []) {
    if (!m || !str(m.feature)) continue;
    const rf = withRef(m); if (!rf) continue;
    out.modification_candidates.push({ feature: str(m.feature).slice(0, 120), basis: MOD_BASIS.includes(m.basis) ? m.basis : 'unclear', ...rf, sign: str(m.sign).slice(0, 240), confidence: conf(m.confidence) });
    stats.modifications++;
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
