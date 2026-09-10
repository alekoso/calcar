/* CalCar Check: детермінований перенос канонічних фактів Current Vision у
   готову структуру звіту (Feed v1.1).

   Навіщо. У Feed v1 канонічні факти жили лише в промпті: модель мала
   переказати кожен із них своїми словами. Вимірювання показали втрати:
   з восьми підтверджених кадрами понять комплектації у звіт потрапляли
   три. Розбір кадрів не має залежати від того, чи згадає його модель.

   Що робить код. Канонічні поняття комплектації і, за потреби, знахідки
   стану вносить сам код, з локалізованою назвою і доказом на конкретний
   кадр. Модель лишається автором формулювань і рішення, але вже не
   вирішує, чи потрапить підтверджений факт у звіт.

   Межа. Код вносить лише те, що вміє назвати мовою звіту: канонічні
   поняття зі словника і знахідки стану зі словників зон, видів і
   серйозності. Вільний текст (модифікації, поняття поза словником,
   повідомлення приладової панелі) лишається за моделлю: вигадувати
   переклад код не має права, а другий AI-виклик тут заборонений.
   Нерозміщені канонічні факти чесно рахуються в телеметрії. */

import { equipmentConcept } from './current-visual.js';

const L = (category, ua, ru, en) => ({ category, ua, ru, en });
/* категорії тут це категорії ЗВІТУ (equipment_v2), а не Vision */
export const CONCEPT_LABELS = {
  harman_kardon: L('multimedia', 'Аудіосистема Harman Kardon', 'Аудиосистема Harman Kardon', 'Harman Kardon audio'),
  bose: L('multimedia', 'Аудіосистема Bose', 'Аудиосистема Bose', 'Bose audio'),
  burmester: L('multimedia', 'Аудіосистема Burmester', 'Аудиосистема Burmester', 'Burmester audio'),
  bang_olufsen: L('multimedia', 'Аудіосистема Bang & Olufsen', 'Аудиосистема Bang & Olufsen', 'Bang & Olufsen audio'),
  bowers_wilkins: L('multimedia', 'Аудіосистема Bowers & Wilkins', 'Аудиосистема Bowers & Wilkins', 'Bowers & Wilkins audio'),
  premium_audio: L('multimedia', 'Преміальна аудіосистема', 'Премиальная аудиосистема', 'Premium audio system'),
  panoramic_roof: L('comfort', 'Панорамний дах або люк', 'Панорамная крыша или люк', 'Panoramic roof or sunroof'),
  hud: L('multimedia', 'Проекційний дисплей', 'Проекционный дисплей', 'Head-up display'),
  digital_cluster: L('multimedia', 'Цифрова приладова панель', 'Цифровая приборная панель', 'Digital instrument cluster'),
  central_display: L('multimedia', 'Мультимедійний дисплей', 'Мультимедийный дисплей', 'Central multimedia display'),
  heated_wheel: L('comfort', 'Підігрів керма', 'Подогрев руля', 'Heated steering wheel'),
  rear_climate: L('comfort', 'Клімат для задніх пасажирів', 'Климат для задних пассажиров', 'Rear climate control'),
  paddles: L('performance', 'Підрульові пелюстки перемикання передач', 'Подрулевые лепестки переключения передач', 'Steering wheel paddles'),
  seat_power: L('comfort', 'Електрорегулювання сидінь', 'Электрорегулировка сидений', 'Power adjustable seats'),
  seat_memory: L('comfort', 'Памʼять положення сидіння', 'Память положения сиденья', 'Seat position memory'),
  seat_heating: L('comfort', 'Підігрів сидінь', 'Подогрев сидений', 'Heated seats'),
  seat_ventilation: L('comfort', 'Вентиляція сидінь', 'Вентиляция сидений', 'Ventilated seats'),
  seat_massage: L('comfort', 'Масаж сидінь', 'Массаж сидений', 'Massage seats'),
  sport_seats: L('interior', 'Спортивні сидіння з бічною підтримкою', 'Спортивные сиденья с боковой поддержкой', 'Sport seats with bolstering'),
  leather: L('interior', 'Шкіряне оздоблення салону', 'Кожаная отделка салона', 'Leather interior'),
  dual_zone_climate: L('comfort', 'Клімат-контроль', 'Климат-контроль', 'Climate control'),
  ambient_lighting: L('interior', 'Атмосферне підсвічування салону', 'Атмосферная подсветка салона', 'Ambient interior lighting'),
  wood_trim: L('interior', 'Деревʼяні вставки салону', 'Деревянные вставки салона', 'Wood interior trim'),
  carbon_trim: L('interior', 'Карбонові вставки салону', 'Карбоновые вставки салона', 'Carbon interior trim'),
  alcantara: L('interior', 'Оздоблення алькантарою', 'Отделка алькантарой', 'Alcantara trim'),
  aluminium_trim: L('interior', 'Алюмінієві вставки салону', 'Алюминиевые вставки салона', 'Aluminium interior trim'),
  parking_sensors: L('assist', 'Парковочні датчики', 'Парковочные датчики', 'Parking sensors'),
  rear_camera: L('assist', 'Камера заднього виду', 'Камера заднего вида', 'Rear view camera'),
  surround_camera: L('assist', 'Камери кругового огляду', 'Камеры кругового обзора', 'Surround view cameras'),
  adaptive_cruise: L('assist', 'Круїз-контроль', 'Круиз-контроль', 'Cruise control'),
  lane_assist: L('assist', 'Асистент утримання смуги', 'Ассистент удержания полосы', 'Lane keeping assist'),
  blind_spot: L('assist', 'Контроль сліпих зон', 'Контроль слепых зон', 'Blind spot monitoring'),
  gesture_control: L('multimedia', 'Керування жестами', 'Управление жестами', 'Gesture control'),
  navigation: L('multimedia', 'Навігаційна система', 'Навигационная система', 'Navigation system'),
  driver_assist_other: L('assist', 'Системи допомоги водію', 'Системы помощи водителю', 'Driver assistance systems'),
  carplay: L('multimedia', 'Apple CarPlay або Android Auto', 'Apple CarPlay или Android Auto', 'Apple CarPlay or Android Auto'),
  m_steering_wheel: L('interior', 'Спортивне кермо', 'Спортивный руль', 'Sport steering wheel'),
  sport_chrono_clock: L('performance', 'Годинник пакета Sport Chrono', 'Часы пакета Sport Chrono', 'Sport Chrono clock'),
  colored_calipers: L('performance', 'Фарбовані гальмівні супорти', 'Окрашенные тормозные суппорты', 'Painted brake calipers'),
  badge: L('exterior', 'Шильд версії на кузові', 'Шильд версии на кузове', 'Model badge'),
  roof_rails: L('exterior', 'Рейлінги на даху', 'Рейлинги на крыше', 'Roof rails'),
  fog_lights: L('exterior', 'Протитуманні фари', 'Противотуманные фары', 'Fog lights'),
  manual_gearbox: L('performance', 'Механічна коробка передач', 'Механическая коробка передач', 'Manual gearbox'),
  cargo_cover: L('comfort', 'Шторка або сітка багажника', 'Шторка или сетка багажника', 'Cargo cover'),
  keyless: L('comfort', 'Безключовий доступ', 'Бесключевой доступ', 'Keyless entry'),
  led_lights: L('exterior', 'Світлодіодна оптика', 'Светодиодная оптика', 'LED lighting'),
  wireless_charging: L('comfort', 'Бездротова зарядка', 'Беспроводная зарядка', 'Wireless charging'),
};

export const ZONE_LABELS = {
  front: L(null, 'Передня частина', 'Передняя часть', 'Front end'),
  rear: L(null, 'Задня частина', 'Задняя часть', 'Rear end'),
  left_front: L(null, 'Ліва передня частина', 'Левая передняя часть', 'Left front'),
  left_side: L(null, 'Лівий бік', 'Левый борт', 'Left side'),
  left_rear: L(null, 'Ліва задня частина', 'Левая задняя часть', 'Left rear'),
  right_front: L(null, 'Права передня частина', 'Правая передняя часть', 'Right front'),
  right_side: L(null, 'Правий бік', 'Правый борт', 'Right side'),
  right_rear: L(null, 'Права задня частина', 'Правая задняя часть', 'Right rear'),
  roof: L(null, 'Дах', 'Крыша', 'Roof'),
  wheels: L(null, 'Колеса', 'Колёса', 'Wheels'),
  engine_bay: L(null, 'Моторний відсік', 'Моторный отсек', 'Engine bay'),
  underbody: L(null, 'Днище', 'Днище', 'Underbody'),
  driver_area: L(null, 'Місце водія', 'Место водителя', 'Driver area'),
  front_passenger: L(null, 'Місце переднього пасажира', 'Место переднего пассажира', 'Front passenger area'),
  front_seats: L(null, 'Передні сидіння', 'Передние сиденья', 'Front seats'),
  rear_seats: L(null, 'Задні сидіння', 'Задние сиденья', 'Rear seats'),
  dashboard: L(null, 'Приладова панель', 'Приборная панель', 'Dashboard'),
  center_console: L(null, 'Центральна консоль', 'Центральная консоль', 'Center console'),
  doors: L(null, 'Двері зсередини', 'Двери изнутри', 'Door cards'),
  trunk: L(null, 'Багажник', 'Багажник', 'Trunk'),
};

export const KIND_LABELS = {
  scratch_scuff: L(null, 'подряпини і потертості', 'царапины и потёртости', 'scratches and scuffs'),
  chip: L(null, 'скол', 'скол', 'paint chip'),
  dent: L(null, 'вмʼятина', 'вмятина', 'dent'),
  crack: L(null, 'тріщина', 'трещина', 'crack'),
  broken_component: L(null, 'зламана деталь', 'сломанная деталь', 'broken component'),
  missing_component: L(null, 'відсутня деталь', 'отсутствующая деталь', 'missing component'),
  panel_gap_alignment: L(null, 'нерівні зазори панелей', 'неровные зазоры панелей', 'uneven panel gaps'),
  paint_mismatch: L(null, 'різнотон фарби', 'разнотон краски', 'paint mismatch'),
  repaint_sign: L(null, 'ознака перефарбування', 'признак перекраски', 'sign of repaint'),
  wheel_damage: L(null, 'пошкодження диска', 'повреждение диска', 'wheel damage'),
  tire_issue: L(null, 'проблема шини', 'проблема шины', 'tyre issue'),
  corrosion: L(null, 'корозія', 'коррозия', 'corrosion'),
  wear: L(null, 'знос', 'износ', 'wear'),
  tear: L(null, 'розрив оббивки', 'разрыв обивки', 'torn upholstery'),
  plastic_damage: L(null, 'пошкодження пластику', 'повреждение пластика', 'plastic damage'),
  trim_damage: L(null, 'пошкодження оздоблення', 'повреждение отделки', 'trim damage'),
  stain: L(null, 'пляма', 'пятно', 'stain'),
  headliner_damage: L(null, 'пошкодження стелі салону', 'повреждение потолка салона', 'headliner damage'),
  other_visible_damage: L(null, 'видиме пошкодження', 'видимое повреждение', 'visible damage'),
};

export const SEVERITY_LABELS = {
  minor: L(null, 'незначне', 'незначительное', 'minor'),
  moderate: L(null, 'помітне', 'заметное', 'moderate'),
  severe: L(null, 'серйозне', 'серьёзное', 'severe'),
};

const lang3 = l => (l === 'ru' ? 'ru' : l === 'en' ? 'en' : 'ua');
const say = (table, key, lang) => (table[key] ? table[key][lang3(lang)] : null);

/* канонічні поняття комплектації: одне поняття = один запис, перевагу має
   найвпевненіший доказ */
export function canonicalEquipment(cv) {
  const rank = { high: 3, medium: 2, low: 1 };
  const byConcept = new Map();
  for (const e of (cv && cv.equipment_visual) || []) {
    if (!e || !e.concept) continue;
    const prev = byConcept.get(e.concept);
    if (!prev || (rank[e.confidence] || 0) > (rank[prev.confidence] || 0)) byConcept.set(e.concept, e);
  }
  return [...byConcept.values()];
}

const photoRef = gi => 'photo_' + (Number(gi) + 1);

/* Комплектація: код гарантує, що КОЖНЕ канонічне поняття зі словника є у
   звіті і має доказ на конкретний кадр. Записи моделі з інших джерел не
   чіпаються; єдиний візуальний доказ у записі це канонічний */
export function mergeCanonicalEquipment(items, cv, lang) {
  const list = Array.isArray(items) ? items.slice() : [];
  const canonical = canonicalEquipment(cv);
  const stats = { canonical: canonical.length, labelled: 0, matched: 0, inserted: 0, unlabelled: 0, unlabelled_concepts: [] };
  for (const e of canonical) {
    const label = CONCEPT_LABELS[e.concept];
    if (!label) { stats.unlabelled++; if (stats.unlabelled_concepts.length < 8) stats.unlabelled_concepts.push(e.concept); continue; }
    stats.labelled++;
    const ev = { source: 'current_photos', ref: photoRef(e.gallery_index), sign: e.sign || e.visible_label_or_feature || null };
    const hit = list.find(it => it && typeof it === 'object' && equipmentConcept(it.name) === e.concept);
    if (hit) {
      const rest = Array.isArray(hit.evidence) ? hit.evidence.filter(x => x && x.source !== 'current_photos') : [];
      hit.evidence = [...rest, ev];
      if (hit.confidence_level === 'seller') hit.confidence_level = 'seller_and_visual';
      else if (hit.confidence_level !== 'vehicle_data' && hit.confidence_level !== 'seller_and_visual') hit.confidence_level = 'visual';
      stats.matched++;
    } else {
      list.push({
        name: say(CONCEPT_LABELS, e.concept, lang), category: label.category, confidence_level: 'visual',
        highlight: false, retrofit: false, retrofit_basis: null, historical_claim: false, value_tier: 'standard',
        evidence: [ev],
      });
      stats.inserted++;
    }
  }
  return { items: list, stats };
}

/* Стан: модель формулює знахідки своїми словами і має дати рівно по одному
   пункту на канонічну знахідку. Якщо якісь загубились, код дописує їх
   словниковим реченням: канонічний факт не має зникати зі звіту */
export function conditionSentence(f, lang) {
  const zone = say(ZONE_LABELS, f.zone, lang);
  const kind = say(KIND_LABELS, f.kind, lang);
  const sev = say(SEVERITY_LABELS, f.severity, lang);
  if (!zone || !kind || !sev) return null;
  const l = lang3(lang);
  const frame = Number.isFinite(Number(f.photo)) ? photoRef(Number(f.photo) - 1) : null;
  const tail = frame ? (l === 'en' ? ' (' + frame + ')' : ' (' + frame + ')') : '';
  if (l === 'en') return zone + ': ' + kind + ', ' + sev + tail + '.';
  return zone + ': ' + kind + ', ' + sev + tail + '.';
}

export function mergeCanonicalConditions(findings, compactFindings, lang) {
  const list = Array.isArray(findings) ? findings.slice() : [];
  const canonical = Array.isArray(compactFindings) ? compactFindings : [];
  const spoken = list.filter(f => f && (f.status === 'warn' || f.status === 'bad')).length;
  const stats = { canonical: canonical.length, from_main: spoken, filled_by_code: 0 };
  if (canonical.length > spoken) {
    for (const f of canonical.slice(spoken)) {
      const text = conditionSentence(f, lang);
      if (!text) continue;
      list.push({ status: f.severity === 'severe' ? 'bad' : 'warn', text });
      stats.filled_by_code++;
    }
  }
  return { items: list, stats };
}

/* Модифікації і поняття поза словником: код їх не вигадує, але рахує,
   скільки канонічних фактів модель не переказала */
export function canonicalGaps(items, cv) {
  const list = Array.isArray(items) ? items : [];
  const mods = ((cv && cv.modification_candidates) || []).filter(m => m && m.confirmed);
  const retro = list.filter(it => it && it.retrofit === true).length;
  return { confirmed_modifications: mods.length, retrofit_in_report: retro, unreported: Math.max(0, mods.length - retro) };
}

/* Компактний доказ для РІШЕННЯ. Основному виклику більше не потрібні
   кадри і ознаки підтверджених опцій: цей блок збирає код. Модель бачить
   лише перелік назв, щоб враховувати оснащення в міркуванні, і повні
   деталі там, де вона справді автор тексту: стан, модифікації, панель */
export function decisionEvidenceBlock(cv, framesTotal, lang) {
  if (!cv) return null;
  const zones = Object.entries(cv.zones || {});
  const pick = v => zones.filter(([, z]) => z.visibility === v).map(([k]) => k);
  const findings = [];
  for (const [zone, z] of zones) {
    for (const f of z.findings || []) {
      if (!f.material) continue;
      findings.push({ zone, kind: f.kind, severity: f.severity, photo: Number(f.gallery_index) + 1, sign: f.sign });
    }
  }
  const equipment = canonicalEquipment(cv).map(e => say(CONCEPT_LABELS, e.concept, lang) || e.normalized_name).filter(Boolean);
  const mods = ((cv.modification_candidates) || []).filter(m => m.confirmed).map(m => ({ feature: m.feature, photo: Number(m.gallery_index) + 1, sign: m.sign }));
  const d = cv.dashboard || {};
  const view = {
    coverage: { frames: cv.coverage ? cv.coverage.frames_received : null, quality_flags: cv.coverage ? cv.coverage.quality_flags : [] },
    zones: { sufficient: pick('sufficient'), partial: pick('partial'), not_visible: pick('not_visible') },
    condition_findings: findings,
    equipment_confirmed: equipment,
    confirmed_modifications: mods,
    dashboard: {
      engine_state: d.engine_state || 'unknown',
      warning_lights: (d.warning_lights || []).map(w => ({ light: w.light, photo: Number(w.gallery_index) + 1 })),
      readable_messages: (d.readable_messages || []).map(m => ({ text: m.text, photo: Number(m.gallery_index) + 1 })),
    },
  };
  return 'CURRENT_VISUAL_EVIDENCE (канонічний розбір НИНІШНІХ кадрів оголошення окремим спеціалізованим читанням; photo це номер кадру галереї): '
    + JSON.stringify(view)
    + (framesTotal ? '\nРОЗБІР БАЧИВ КАДРІВ: ' + framesTotal : '');
}
