/* Спільні нормалізовані візуальні сигнали пошкоджень CalCar.

   Один словник понять на всю платформу: Check і Import описують побачене
   ОДНАКОВИМИ полями з однаковою семантикою, тому їхні визначення не можуть
   розійтись. Тут живуть три речі:
     1. рівні і стани (глибина удару, обсяг ушкодження внутрішньої зони);
     2. resolveDamageDepth: КОД валідує заявлену моделлю глибину проти
        булевих спостережень і за потреби знижує її;
     3. HISTORICAL_VISUAL_RULES і HISTORICAL_VISUAL_SCHEMA: побайтово той
        самий фрагмент промпту, який обидва продукти вставляють у свою
        інструкцію.
   Модуль чистий: без залежностей і без побічних ефектів. Винесено з
   api/check.js без жодної зміни поведінки. */

/* ---------- 4в3а. Глибина пошкодження: код валідує заявлений рівень ----------
   Три РІЗНІ поняття, які раніше злипались в одне:
   (1) DAMAGE DEPTH: наскільки далеко удар пройшов за зовнішню шкіру;
   (2) ACCIDENT SEVERITY: tier події, який рахує резолвер Score;
   (3) STRUCTURAL DAMAGE STATUS: суворо підтверджений силовий елемент,
       єдиний, що вмикає кап.
   Vision віддає СПОСТЕРЕЖЕННЯ, а рівень глибини валідує код: заявлена
   глибина ніколи не може бути вищою за обґрунтовану булевими ознаками.
   Нижча заявлена глибина поважається (консервативно вниз, не вгору). */
/* версія екстрактора історичного візуалу: входить у ключ кешу. v3: доказовий
   стандарт для сигналів, що піднімають тяжкість (signal_evidence) */
export const HISTORICAL_VISUAL_VERSION = 'hv-2026-09-03-v3';

/* ---------- Доказовий стандарт для сигналів, що піднімають тяжкість ----------
   wheel displacement, деформація несучої структури, проникнення в салон,
   видима деформація внутрішнього модуля і substantial-обсяг самі здатні
   підняти подію до severe. Тому true/visible/substantial приймається ЛИШЕ
   з конкретним кадром і конкретною видимою ознакою в signal_evidence.
   Без цього сигнал стає indeterminate: НЕ false і НЕ здогадка більшості.
   Це семантика ВИТЯГУВАННЯ доказів, не зміна SCORE_CONFIG_V3 */
export const SEVERITY_RAISING_SIGNALS = ['wheel_displacement_visible', 'load_bearing_structure_deformation_visible', 'cabin_intrusion_visible', 'inner_component_deformation_visible', 'inner_component_damage_extent'];
const RAISING_VALUE = { wheel_displacement_visible: true, load_bearing_structure_deformation_visible: true, cabin_intrusion_visible: true, inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial' };
export function validSignalEvidence(entry, photosSent) {
  if (!entry || typeof entry !== 'object') return false;
  const m = /^auction_photo_(\d+)$/.exec(String(entry.frame || entry.ref || '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 10);
  if (!(n >= 1 && (!photosSent || n <= photosSent))) return false;
  return typeof entry.sign === 'string' && entry.sign.trim().length >= 8;
}
export function gateSeverityRaisingSignals(hv, photosSent) {
  const h = hv && typeof hv === 'object' ? { ...hv } : {};
  const raw = Array.isArray(h.signal_evidence) ? h.signal_evidence : [];
  const evidence = raw.filter(e => e && typeof e === 'object' && SEVERITY_RAISING_SIGNALS.includes(e.signal) && validSignalEvidence(e, photosSent))
    .map(e => ({ signal: e.signal, frame: String(e.frame || e.ref).trim(), sign: String(e.sign).trim().slice(0, 200) })).slice(0, 12);
  const status = {}, downgraded = [];
  for (const sig of SEVERITY_RAISING_SIGNALS) {
    const v = sig === 'inner_component_deformation_visible' ? innerDeformationState(h[sig]) : h[sig];
    const raising = v === RAISING_VALUE[sig];
    const proven = evidence.some(e => e.signal === sig);
    if (raising && !proven) {
      downgraded.push(sig);
      if (typeof RAISING_VALUE[sig] === 'boolean') h[sig] = false; else h[sig] = 'indeterminate';
      status[sig] = 'indeterminate';
    } else if (raising) status[sig] = 'confirmed';
    else if (typeof RAISING_VALUE[sig] === 'boolean') status[sig] = h[sig] === false ? 'not_visible' : 'indeterminate';
    else status[sig] = v == null ? 'indeterminate' : String(v);
  }
  h.signal_evidence = evidence;
  return { hv: h, signal_status: status, signal_evidence: evidence, downgraded };
}

export const DAMAGE_DEPTH_LEVELS = ['indeterminate', 'exterior_panels_only', 'inner_structure_or_module', 'load_bearing_structure', 'cabin_intrusion'];
export const INNER_EXTENT_LEVELS = ['none', 'localized', 'substantial', 'indeterminate'];
/* стан деформації внутрішніх компонентів: ТРИ стани, бо "не можу визначити"
   це НЕ "деформації нема". Boolean-форма приймається як легасі-вхід */
export const INNER_DEFORMATION_STATES = ['visible', 'not_visible', 'indeterminate'];
export function innerDeformationState(v) {
  if (v === true || v === 'visible') return 'visible';
  if (v === false || v === 'not_visible') return 'not_visible';
  return 'indeterminate';
}
export const FASCIA_STATUSES = ['intact_mounted', 'damaged_but_mounted', 'detached_or_missing', 'not_visible'];
export const OUTER_EXTENT_LEVELS = ['none', 'single_panel', 'multiple_panels', 'indeterminate'];
export function resolveDamageDepth(hv) {
  const h = hv && typeof hv === 'object' ? hv : {};
  const claimed = DAMAGE_DEPTH_LEVELS.includes(h.damage_depth) ? h.damage_depth : 'indeterminate';
  const intrusion = h.cabin_intrusion_visible === true;
  const loadBearing = h.load_bearing_structure_deformation_visible === true;
  const innerState = innerDeformationState(h.inner_component_deformation_visible);
  const innerDef = innerState === 'visible';
  const innerExposed = h.inner_components_exposed === true;
  const fascia = FASCIA_STATUSES.includes(h.fascia_status) ? h.fascia_status : 'not_visible';
  /* максимальний рівень, який ПІДТВЕРДЖУЮТЬ спостереження */
  let justified;
  if (intrusion) justified = 'cabin_intrusion';
  else if (loadBearing) justified = 'load_bearing_structure';
  else if (innerDef || innerExposed) justified = 'inner_structure_or_module';
  /* exterior_only це ТЕЖ твердження: воно вимагає доказу, що удар не пройшов
     глибше. Ціла чи лише пом'ята, але прикручена облицовка в зоні удару таким
     доказом є; якщо зону не видно, чесна відповідь indeterminate */
  else if (fascia === 'intact_mounted' || fascia === 'damaged_but_mounted') justified = 'exterior_panels_only';
  else justified = 'indeterminate';
  const rank = l => DAMAGE_DEPTH_LEVELS.indexOf(l);
  const depth = rank(claimed) > rank(justified) ? justified : claimed;
  /* обсяг ушкодження внутрішньої зони має сенс лише разом із видимою
     деформацією внутрішніх елементів і лише на рівні inner і глибше */
  let extent = INNER_EXTENT_LEVELS.includes(h.inner_component_damage_extent) ? h.inner_component_damage_extent : 'indeterminate';
  if (rank(depth) < rank('inner_structure_or_module')) extent = 'none';
  /* НЕВІДОМО НЕ ДОРІВНЮЄ НЕМА: якщо стан внутрішніх компонентів визначити
     не вдалось, обсяг лишається indeterminate, а не обнуляється в none.
     none означає рівно одне: внутрішні елементи видно і вони цілі */
  else if (innerState === 'indeterminate') extent = 'indeterminate';
  else if (innerState === 'not_visible') extent = 'none';
  else if (extent === 'none') extent = 'indeterminate';
  return {
    damage_depth: depth,
    damage_depth_claimed: claimed,
    damage_depth_downgraded: depth !== claimed,
    inner_component_deformation_visible: innerState,
    inner_component_damage_extent: extent,
  };
}

/* ---- спільний фрагмент промпту: опис спостережень historical_visual ----
   Check і Import вставляють ЦЕЙ САМИЙ текст, тому семантика полів у двох
   продуктах однакова за побудовою, а не за домовленістю. */
export const HISTORICAL_VISUAL_RULES = `ІСТОРИЧНИЙ ВІЗУАЛЬНИЙ АНАЛІЗ ("historical_visual"): заповнюй ЛИШЕ коли історичні кадри реально передані. Оцінюй те, що РЕАЛЬНО видно САМЕ на цих кадрах, а не типовий сценарій ДТП:
- visible_damage_zones: зони з ВИДИМИМ пошкодженням.
- visible_severity за видимим обсягом: minor (косметика) | moderate (помітний удар, деформовані навісні елементи) | severe (очевидно тяжка деформація) | indeterminate. Це wording для звіту; тяжкість у формулі рахує код зі структурованих ознак нижче.
- ГЛИБИНА ПОШКОДЖЕННЯ (damage_depth) це ОКРЕМЕ поняття від тяжкості ДТП і від підтвердженого структурного пошкодження. Ти фіксуєш СПОСТЕРЕЖЕННЯ, тяжкість рахує код. Рівні: "exterior_panels_only" (пошкоджені лише зовнішні замінні деталі: капот, бампер, крило, фара, решітка; облицовка в зоні удару лишилась на місці, внутрішні елементи не вскриті і не пошкоджені), "inner_structure_or_module" (удар пройшов ГЛИБШЕ зовнішніх панелей: видно пошкоджені або деформовані елементи ЗА ними, наприклад підсилювач бампера, крэш-бокси, каркас радіатора чи передня панель-носій, внутрішні кронштейни і кріплення; це НЕ означає структурне пошкодження і НЕ дозволяє писати про лонжерони), "load_bearing_structure" (видно деформований САМЕ несучий елемент: лонжерон, стакан амортизатора, стійка, поріг, підлога, моторний щит, каркас), "cabin_intrusion" (деформація або проникнення в зону салону: щит, стійка, педальний вузол, порушена геометрія дверного отвору), "indeterminate" (за доступними ракурсами глибину визначити не можна).
- ОБСЯГ УШКОДЖЕННЯ ВНУТРІШНЬОЇ ЗОНИ (inner_component_damage_extent): "none" (внутрішні елементи не пошкоджені), "localized" (локальна невелика деформація ОДНОГО внутрішнього елемента без суттєвого руйнування модуля), "substantial" (суттєва деформація чи руйнування внутрішньої зони: помітно погнутий або розірваний підсилювач, пошкоджені кілька внутрішніх елементів, зруйнована зона крэш-боксів, значно деформований носій, явна втрата геометрії внутрішнього модуля), "indeterminate" (видно, що внутрішня зона зачеплена, але обсяг за кадром не оцінити).
- ДВА РІЗНІ ПИТАННЯ, ЯКІ НЕ МОЖНА ЗМІШУВАТИ. ВНУТРІШНІЙ МОДУЛЬ це: підсилювач бампера (crash bar), крэш-бокси, каркас радіатора чи передня панель-носій (carrier), внутрішні кронштейни і кріплення. НЕСУЧА СТРУКТУРА це: лонжерони (frame rails), стакани/чашки амортизаторів (strut towers), стійки кузова (pillars), пороги (sills), підлога, моторний щит (firewall). Це РІЗНІ групи деталей і РІЗНІ поля.
- ПРЯМА ЗАБОРОНА ПЕРЕНОСУ ВІДПОВІДІ: "деформацію лонжеронів/стаканів на цьому ракурсі визначити не можна" стосується ВИКЛЮЧНО несучої структури (load_bearing_structure_deformation_visible) і НЕ Є відповіддю про стан підсилювача, крэш-боксів, носія та інших елементів внутрішнього модуля. Ці два поля заповнюються НЕЗАЛЕЖНО одне від одного: невизначеність по несучій структурі НІКОЛИ не робить внутрішній модуль неушкодженим.
- ЯКЩО ВНУТРІШНІЙ МОДУЛЬ ВІДКРИТИЙ (облицовки нема або вона зірвана), ти ЗОБОВʼЯЗАНИЙ окремо відповісти на два питання: (1) чи видно ДЕФОРМАЦІЮ саме внутрішніх компонентів; (2) який КОНКРЕТНО компонент це підтверджує (назви його в evidence: підсилювач погнутий і зміщений, крэш-бокс зруйнований, носій деформований тощо). Якщо жоден внутрішній компонент не видно достатньо, щоб судити, це стан "визначити не можна", а НЕ "деформації нема".
- КРИТИЧНЕ РОЗРІЗНЕННЯ: "передок розібраний", деталі зняті чи відсутні це НЕ доказ тяжкого удару. inner_components_exposed (внутрішні елементи стали видимими: вскриті ударом АБО зняті) сам по собі тяжкість НЕ піднімає. Потрібно окремо бачити САМЕ ДЕФОРМАЦІЮ: inner_component_deformation_visible = "visible" ЛИШЕ коли внутрішній елемент видимо погнутий, зімʼятий, розірваний чи зміщений зі свого положення, а не просто демонтований; "not_visible" ЛИШЕ коли внутрішні елементи видно достатньо і вони цілі; "indeterminate" коли судити про їх стан за кадрами не можна. НЕВІДОМО ЦЕ НЕ "НЕМА": не став "not_visible", якщо ти просто не роздивився.
- СТРУКТУРОВАНІ ВИДИМІ ОЗНАКИ (booleans, СТАВ true ЛИШЕ коли ознака реально видима на кадрі): outer_panel_damage_extent ("none" | "single_panel" | "multiple_panels" | "indeterminate": скільки ЗОВНІШНІХ панелей пошкоджено), fascia_status (стан зовнішньої облицовки в зоні удару: "intact_mounted" ціла і на місці, "damaged_but_mounted" пошкоджена, але лишилась прикрученою, "detached_or_missing" відірвана чи відсутня, "not_visible" зону не видно; прикручена облицовка це доказ, що удар не пройшов глибше), inner_components_exposed, inner_component_deformation_visible, load_bearing_structure_deformation_visible (видима деформація САМЕ НЕСУЧИХ/СИЛОВИХ частин: лонжерони, стакани/чашки амортизаторів, стійки кузова, пороги/rocker, підлога, моторний щит, зони кріплення підрамника, очевидна глибока деформація кузовного каркаса; зімʼяті капот, бампер, крило, фара чи решітка самі по собі НІКОЛИ не дають true), cabin_intrusion_visible, wheel_displacement_visible (колесо явно зміщене/вивернуте зі свого положення, видимий обвал підвіски), cosmetic_only (УСІ видимі пошкодження обмежені косметикою навісних панелей: подряпини, дрібні вмʼятини, тріснутий бампер).
- ЗАЯВЛЕНА ГЛИБИНА ПЕРЕВІРЯЄТЬСЯ КОДОМ проти цих ознак і може бути автоматично знижена: damage_depth "load_bearing_structure" без load_bearing_structure_deformation_visible, "cabin_intrusion" без cabin_intrusion_visible, "inner_structure_or_module" без вскритих чи деформованих внутрішніх елементів, "exterior_panels_only" без видимої облицовки в зоні удару не пройдуть. Тому не вгадуй рівень: постав той, який реально бачиш, і заповни ознаки чесно.
- structural_visual_status: "no_obvious_severe_signs" означає ЛИШЕ "на доступних кадрах нема явних візуальних ознак тяжкої деформації силової структури" і НІКОЛИ не дорівнює "структура ціла". "visible_damage" СТАВ ЛИШЕ за STRONG structural evidence, коли ОДНОЧАСНО: (1) конкретно ідентифікований силовий елемент (внутрішній силовий поріг/sill, стійка A/B/C, лонжерон/frame rail, стакан/strut tower, силова підлога, інший явно названий structural member, або очевидне зміщення геометрії силової частини); (2) цей елемент достатньо видимий на кадрі; (3) видима деформація САМЕ силового елемента, а не сусідньої зовнішньої панелі. НЕДОСТАТНЬО: "сильно пошкоджений поріг", "зімʼята боковина", "сильний удар", "деформація в районі стійки", будь-який прикметник тяжкості без ідентифікованого силового елемента. Ракурс не дозволяє судити або силову частину від зовнішньої панелі відрізнити не можна: "indeterminate".
- historical_visual.summary і descriptions в evidence це ФІКСАЦІЯ СПОСТЕРЕЖЕНЬ, а не вердикт про тяжкість: перелічуй, ЩО видно і чого не видно ("капот помітно деформований, пошкоджені бампер і оптика, видно розкриті передні подушки; явних ознак деформації силових елементів на кадрах не видно"), БЕЗ підсумкових прикметників тяжкості ("сильний удар", "тяжке ДТП", "глибоко зімʼятий передок" про передок цілком). Єдиним джерелом тяжкості для всіх текстів звіту є resolved severity, який рахує код зі структурованих ознак; прикметник visible_severity лишається службовим полем і в тексти не переноситься.
- damage_side: сторона АВТОМОБІЛЯ з видимим пошкодженням за правилом сторін вище: "left|right|both|center|unknown"; side_confidence: "high" ЛИШЕ за надійної орієнтації (видно кермо/номер/написи), інакше "medium" чи "low". Не можеш надійно: "unknown".
- possible_structural_damage (boolean): true, коли пошкодження лежить у ПОТЕНЦІЙНО структурній зоні (зона порога/rocker, зона стійки, передня/задня зона лонжеронів), але надійно відрізнити зовнішню панель від силового елемента за фото не можна. Тоді structural_visual_status = "indeterminate" + possible_structural_damage: true. Цей сигнал НЕ є підтвердженим структурним пошкодженням.
- srs_visual_status: "deployed_visible" СТАВ ЛИШЕ за ПРЯМИМ візуальним доказом РОЗКРИТОЇ подушки на кадрі: видима біла/сіра тканина подушки з керма, торпедо, шторка вздовж даху, колінна подушка, подушка сидіння. Пошкоджений салон, розібрана торпедо, зірвана обшивка, спрацьовані ремені чи сам факт сильного удару подушок НЕ доводять і "deployed_visible" НЕ дають. "no_deployment_visible" означає лише "спрацювання не видно на доступних кадрах", НЕ "SRS справна". Салон у кадр не потрапив: "not_visible".
- airbags_visible_parts: за deployed_visible опціонально перелічи, які саме подушки РЕАЛЬНО видно розкритими: "driver" | "passenger" | "curtain" | "knee" | "seat". Не вгадуй: у списку лише те, що видно на кадрі.
- ДОКАЗОВИЙ СТАНДАРТ ДЛЯ СИГНАЛІВ, ЩО ПІДНІМАЮТЬ ТЯЖКІСТЬ: wheel_displacement_visible = true, load_bearing_structure_deformation_visible = true, cabin_intrusion_visible = true, inner_component_deformation_visible = "visible", inner_component_damage_extent = "substantial" дозволені ЛИШЕ з окремим записом у signal_evidence: {"signal": назва поля, "frame": "auction_photo_N" (КОНКРЕТНИЙ кадр), "sign": конкретна ВИДИМА ознака саме на цьому кадрі (наприклад "ліве переднє колесо вивернуте назовні відносно арки", "підсилювач бампера погнутий і зміщений вліво", "лонжерон зім'ятий гармошкою за стаканом")}. Немає кадру, де ознаку видно однозначно, або кадр можна прочитати двояко: НЕ став true/visible/substantial, постав indeterminate (для boolean: false плюс запис у summary, що ознаку визначити не можна). Код без валідного запису signal_evidence автоматично знижує такий сигнал до indeterminate. Загальна фраза "видно сильний удар" доказом не є.
- summary: 2-3 речення про побачене, з розділенням "що видно" і "що лишається невідомим". evidence з ref auction_photo_N.`;

/* рядок схеми відповіді для того самого блоку */
export const HISTORICAL_VISUAL_SCHEMA = ` "historical_visual": {"visible_damage_zones":["капот","передній бампер"],"visible_severity":"minor|moderate|severe|indeterminate","damage_depth":"exterior_panels_only|inner_structure_or_module|load_bearing_structure|cabin_intrusion|indeterminate","inner_component_damage_extent":"none|localized|substantial|indeterminate","outer_panel_damage_extent":"none|single_panel|multiple_panels|indeterminate","fascia_status":"intact_mounted|damaged_but_mounted|detached_or_missing|not_visible","inner_components_exposed":false,"inner_component_deformation_visible":"visible|not_visible|indeterminate","load_bearing_structure_deformation_visible":false,"cabin_intrusion_visible":false,"wheel_displacement_visible":false,"cosmetic_only":false,"possible_structural_damage":false,"damage_side":"left|right|both|center|unknown","side_confidence":"high|medium|low","structural_visual_status":"no_obvious_severe_signs|possible|visible_damage|indeterminate","srs_visual_status":"deployed_visible|no_deployment_visible|not_visible|indeterminate","airbags_visible_parts":["driver"],"signal_evidence":[{"signal":"wheel_displacement_visible","frame":"auction_photo_3","sign":"ліве переднє колесо вивернуте назовні відносно арки"}],"summary":"2-3 речення: що реально видно і що лишається невідомим","evidence":[{"source":"us_auction","ref":"auction_photo_1","description":"зім'ятий капот"}]},`;
