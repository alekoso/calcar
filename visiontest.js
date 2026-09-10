/* Current Vehicle Vision v2, Phase 0: контракт offline-модуля
   (api/current-visual.js) і benchmark-ендпоінта (api/vision-bench.js).
   Перевіряється: стабільні посилання на фізичний кадр (photo_identity не
   залежить від CDN-піддомену і query, один кадр між повторними Check дає
   той самий ключ), strict-схема з усіма 18 зонами, gate доказовості,
   межа current/historical у правилах і те, що production Check модуль
   НЕ імпортує. */
const fs = require('fs');
const errs = [];

(async () => {
  const CV = await import('./api/current-visual.js');
  const VB = await import('./api/vision-bench.js');
  const VM = await import('./api/vehicle-memory.js');

  /* 1. стабільні посилання: один фізичний кадр = один photo_identity */
  const a = 'https://cdn2.riastatic.com/photosnew/auto/photo/bmw_5-series__651753682hd.webp';
  const b = 'https://cdn4.riastatic.com/photosnew/auto/photo/bmw_5-series__651753682hd.webp?x=1';
  const c = 'https://CDN0.riastatic.com/photosnew/auto/photo/BMW_5-series__651753682hd.webp';
  const d = 'https://cdn2.riastatic.com/photosnew/auto/photo/bmw_5-series__651753683hd.webp';
  if (VM.photoIdentity(a) !== VM.photoIdentity(b) || VM.photoIdentity(a) !== VM.photoIdentity(c)) errs.push('photo_identity залежить від CDN-піддомену/query/регістру');
  if (VM.photoIdentity(a) === VM.photoIdentity(d)) errs.push('різні кадри дають один photo_identity');
  const bat1 = 'https://bringatrailer.com/wp-content/uploads/2026/08/IMG_2682-scaled-copy.jpg?resize=300,200';
  const bat2 = 'https://bringatrailer.com/wp-content/uploads/2026/08/IMG_2682-scaled-copy.jpg?w=940';
  if (VM.photoIdentity(bat1) !== VM.photoIdentity(bat2)) errs.push('варіанти розміру одного кадру BaT дають різні identity');

  /* 2. normalizeFrames: дублікати одного фізичного кадру відкидаються, gallery_index зберігається, ліміт 24 */
  const frames = CV.normalizeFrames([{ gallery_index: 0, url: a, high: true }, { gallery_index: 5, url: b }, { gallery_index: 7, url: d }, { gallery_index: 'x', url: d }, { gallery_index: 9, url: 'ftp://bad' }]);
  if (frames.length !== 2 || frames[0].gallery_index !== 0 || frames[1].gallery_index !== 7 || frames[0].identity !== VM.photoIdentity(a) || frames[0].high !== true) errs.push('normalizeFrames: ' + JSON.stringify(frames));
  /* варіанти розміру одного кадру: береться найкращий (без query, інакше найширший), gallery_index першої появи */
  const variants = CV.normalizeFrames([{ gallery_index: 0, url: 'https://bringatrailer.com/u/IMG_1.jpg?w=150&amp;h=150&crop=1' }, { gallery_index: 1, url: 'https://bringatrailer.com/u/IMG_1.jpg?resize=940,627' }, { gallery_index: 2, url: 'https://bringatrailer.com/u/IMG_1.jpg' }, { gallery_index: 3, url: 'https://bringatrailer.com/u/IMG_2.jpg?w=620' }, { gallery_index: 4, url: 'https://bringatrailer.com/u/IMG_2.jpg?resize=1536,1024' }]);
  if (variants.length !== 2 || variants[0].gallery_index !== 0 || variants[0].url !== 'https://bringatrailer.com/u/IMG_1.jpg' || variants[1].gallery_index !== 3 || !/1536/.test(variants[1].url)) errs.push('варіанти розміру: ' + JSON.stringify(variants));
  const many = CV.normalizeFrames(Array.from({ length: 40 }, (_, i) => ({ gallery_index: i, url: 'https://cdn1.riastatic.com/p/' + i + '.webp' })));
  if (many.length !== CV.MAX_FRAMES) errs.push('ліміт кадрів не тримається');
  /* відбиток набору не залежить від порядку і CDN */
  const fp1 = CV.frameSetFingerprint(CV.normalizeFrames([{ gallery_index: 0, url: a }, { gallery_index: 1, url: d }]));
  const fp2 = CV.frameSetFingerprint(CV.normalizeFrames([{ gallery_index: 1, url: d.replace('cdn2', 'cdn3') }, { gallery_index: 0, url: c }]));
  if (fp1 !== fp2) errs.push('відбиток набору кадрів нестабільний');
  if (fp1 === VM.photoSetFingerprint([a, d], 'other-version')) errs.push('відбиток не залежить від версії');

  /* 3. strict-схема: усі обʼєкти закриті, всі 18 зон обовʼязкові */
  const schema = CV.buildCurrentVisualSchema();
  const walk = (n, p) => {
    if (!n || typeof n !== 'object' || n.$ref) return;
    if (n.anyOf) { n.anyOf.forEach((x, i) => walk(x, p + '.anyOf' + i)); return; }
    if (n.type === 'object') {
      const keys = Object.keys(n.properties || {});
      if (n.additionalProperties !== false) errs.push('обʼєкт без additionalProperties:false: ' + p);
      if (JSON.stringify(n.required) !== JSON.stringify(keys)) errs.push('required != усі ключі: ' + p);
      keys.forEach(k => walk(n.properties[k], p + '.' + k));
    }
    if (n.type === 'array') walk(n.items, p + '[]');
  };
  walk(schema, 'root'); walk(schema.$defs.zone, '$defs.zone'); walk(schema.$defs.finding, '$defs.finding');
  if (!schema.$defs || !schema.$defs.zone || Object.values(schema.properties.zones.properties).some(v => v.$ref !== '#/$defs/zone')) errs.push('зони не через $ref');
  const zoneKeys = Object.keys(schema.properties.zones.properties);
  if (zoneKeys.length !== 20 || CV.ZONES.some(z => !zoneKeys.includes(z)) || !zoneKeys.includes('engine_bay') || !zoneKeys.includes('underbody')) errs.push('схема v1 без 20 зон (engine_bay, underbody)');
  if (JSON.stringify(schema).includes('notable_visual_features')) errs.push('notable_visual_features лишилось у схемі v1');
  if (!CV.ZONES.includes('wheels') || !CV.ZONES.includes('dashboard') || !CV.ZONES.includes('trunk')) errs.push('перелік зон не за ТЗ');
  const rf = CV.currentVisualResponseFormat();
  if (rf.type !== 'json_schema' || rf.json_schema.strict !== true) errs.push('response_format не strict json_schema');
  if (JSON.stringify(schema).length > 9000) errs.push('схема Vision розрослась: ' + JSON.stringify(schema).length);

  /* 4. правила: межа current/historical, стабільні посилання, доказовість, без вердиктів */
  const R = CV.CURRENT_VISUAL_RULES;
  if (/аукціон|auction|historical|історичн|до ремонту|before\/after|hv/i.test(R)) errs.push('правила Vision згадують історичні/аукціонні дані');
  for (const need of ['gallery_index', 'ЗОНИ', 'sufficient', 'not_visible', 'ПРИЛАДОВА ПАНЕЛЬ', 'одометр', 'КОМПЛЕКТАЦІЯ', 'МОДИФІКАЦІЇ', 'ДОКАЗОВІСТЬ', 'реальний пробіг', 'базова, платна', 'СТОРОНИ', 'engine_bay', 'underbody', 'ОДОМЕТР НЕЗАЛЕЖНИЙ', 'Заводське спортивне аеро']) if (!R.includes(need)) errs.push('правила без блоку: ' + need);
  if (/notable_visual_features/.test(R)) errs.push('правила згадують прибране поле notable');
  if (!/помітної проблеми не знайдено/.test(R) || !/заводська фарба/.test(R)) errs.push('правила не фіксують семантику "проблеми не знайдено"');
  /* кадри підписані gallery_index, деталізація за режимом */
  const fc = CV.frameContent(frames, 'mixed');
  if (fc.length !== 1 + frames.length * 2 || fc[1].text !== '[gallery_index=0]' || fc[2].image_url.detail !== 'high' || fc[4].image_url.detail !== 'low') errs.push('frameContent: ' + JSON.stringify(fc.map(x => x.text || x.image_url.detail)));

  /* 5. gate: посилання лише на переданий фізичний кадр, конкретна ознака, paint без сильної ознаки = low, зони доповнюються */
  const sent = CV.normalizeFrames([{ gallery_index: 3, url: a }, { gallery_index: 8, url: d }]);
  const raw = {
    coverage: { frames_received: 2, frames_usable: 2, quality_flags: ['studio', 'bogus'], note: '' },
    zones: {
      front: { visibility: 'sufficient', frames: [3, 99], findings: [
        { kind: 'dent', severity: 'moderate', sign: 'вмʼятина на капоті біля емблеми, видно тінь', gallery_index: 3, confidence: 'high' },
        { kind: 'scratch_scuff', severity: 'minor', sign: 'подряпина', gallery_index: 3, confidence: 'high' },
        { kind: 'dent', severity: 'severe', sign: 'глибока вмʼятина на бампері з розривом', gallery_index: 99, confidence: 'high' },
        { kind: 'repaint_sign', severity: 'moderate', sign: 'капот виглядає інакше, схоже через відблиск освітлення', gallery_index: 3, confidence: 'high' },
        { kind: 'paint_mismatch', severity: 'moderate', sign: 'крило помітно світліше за двері на одному кадрі при рівному світлі', gallery_index: 8, confidence: 'medium' },
      ] },
      dashboard: { visibility: 'sufficient', frames: [8], findings: [] },
      rear: { visibility: 'sufficient', frames: [], findings: [] },
    },
    equipment_visual: [
      { normalized_name: 'Harman Kardon', visible_label_or_feature: 'логотип на решітці динаміка', category: 'audio', gallery_index: 8, sign: 'напис Harman Kardon на решітці динаміка передніх дверей', confidence: 'high' },
      { normalized_name: 'HUD', visible_label_or_feature: 'проектор', category: 'display', gallery_index: 4, sign: 'вікно проектора на торпедо', confidence: 'high' },
    ],
    modification_candidates: [{ feature: 'диски BBS', basis: 'brand_readable', gallery_index: 8, sign: 'напис BBS на центральній кришці диска', confidence: 'medium' }],
    dashboard: { visible: true, ignition_on: true, odometer_reading: { value: 30688, unit: 'km', gallery_index: 8, sign: 'цифри 30688 km на екрані під спідометром', confidence: 'high' },
      warning_lights: [{ light: 'check engine', gallery_index: 8, sign: 'жовта піктограма двигуна ліворуч від тахометра', confidence: 'high' }, { light: 'abs', gallery_index: 5, sign: 'напис ABS', confidence: 'high' }],
      readable_messages: [
        { text: 'Service due in 1200 km', sign: 'напис «Service due in 1200 km» у нижньому рядку дисплея', gallery_index: 8, confidence: 'high' },
        { text: '27 Август 2026', sign: 'дата у верхньому рядку центрального екрана', gallery_index: 8, confidence: 'high' },
        { text: 'Медиа/Радио 531 kHz', sign: 'вкладка «Медиа/Радио» і частота на екрані', gallery_index: 8, confidence: 'high' },
        { text: 'Oil level low', sign: 'напис на дисплеї', gallery_index: 8, confidence: 'low' },
        { text: 'Check engine', sign: 'коротко', gallery_index: 8, confidence: 'high' },
      ] },
    summary: 'ok',
  };
  const { current_visual: cv, stats } = CV.gateCurrentVisual(raw, sent);
  const front = cv.zones.front;
  if (front.frames.join(',') !== '3') errs.push('gate не фільтрує frames зони по переданих кадрах');
  if (front.findings.length !== 3) errs.push('gate: очікували 3 знахідки у front, є ' + front.findings.length + ' ' + JSON.stringify(front.findings.map(f => f.kind + '/' + f.gallery_index)));
  const dent = front.findings.find(f => f.kind === 'dent');
  if (!dent || dent.gallery_index !== 3 || dent.photo_identity !== VM.photoIdentity(a) || dent.material !== true) errs.push('gate: знахідка без стабільного посилання/material: ' + JSON.stringify(dent));
  const repaint = front.findings.find(f => f.kind === 'repaint_sign');
  if (!repaint || repaint.confidence !== 'low' || repaint.material !== false) errs.push('gate: paint-знахідка з "мʼякою" ознакою не знижена до low');
  const mismatch = front.findings.find(f => f.kind === 'paint_mismatch');
  if (!mismatch || mismatch.confidence !== 'medium' || mismatch.material !== true) errs.push('gate: paint-знахідка з конкретною ознакою постраждала');
  if (stats.dropped_bad_ref < 3 || stats.dropped_weak_sign !== 1 || stats.downgraded_soft_paint !== 1) errs.push('gate stats: ' + JSON.stringify(stats));
  if (Object.keys(cv.zones).length !== 20 || cv.zones.left_side.visibility !== 'not_visible' || stats.zones_filled !== 17) errs.push('gate не доповнює 20 зон');
  if (cv.zones.rear.visibility !== 'not_visible') errs.push('sufficient без кадрів і знахідок має стати not_visible');
  if (cv.equipment_visual.length !== 1 || cv.equipment_visual[0].photo_identity !== VM.photoIdentity(d)) errs.push('gate комплектації: ' + JSON.stringify(cv.equipment_visual));
  if (!cv.dashboard.odometer_reading || cv.dashboard.odometer_reading.value !== 30688 || cv.dashboard.odometer_reading.unit !== 'km' || cv.dashboard.odometer_reading.photo_identity !== VM.photoIdentity(d)) errs.push('gate одометра: ' + JSON.stringify(cv.dashboard.odometer_reading));
  if (cv.dashboard.warning_lights.length !== 1) errs.push('gate індикаторів');
  /* повідомлення: лишається лише читабельне важливе повідомлення про авто */
  if (cv.dashboard.readable_messages.length !== 1 || !/Service due/.test(cv.dashboard.readable_messages[0].text) || !cv.dashboard.readable_messages[0].sign) errs.push('gate повідомлень: ' + JSON.stringify(cv.dashboard.readable_messages));
  if (stats.dropped_message_noise !== 2 || stats.dropped_message_weak !== 2 || stats.messages !== 1) errs.push('лічильники повідомлень: ' + JSON.stringify({ n: stats.dropped_message_noise, w: stats.dropped_message_weak, m: stats.messages }));
  for (const noise of ['27 Август 2026', '531 kHz', 'Медиа/Радио', '19:51', 'Навигация', 'ConnectedDrive', 'Мой автомобиль', 'Громкость 12', '107.9 FM']) if (!CV.UI_NOISE_RE.test(noise)) errs.push('UI-шум не відсіюється: ' + noise);
  for (const real of ['Service due in 1200 km', 'Oil level low', 'Автопілот на шосе, Пакет включен', 'Обновление доступно', 'Ключ. Возьмите с собой!', 'Запас ходу 194 km']) if (CV.UI_NOISE_RE.test(real)) errs.push('справжнє повідомлення відсіяне як шум: ' + real);
  if (!/ПОВІДОМЛЕННЯ \(readable_messages\)/.test(CV.CURRENT_VISUAL_RULES) || !/ЗАБОРОНЕНО: дата, час/.test(CV.CURRENT_VISUAL_RULES)) errs.push('правила без гейта повідомлень');
  if (cv.coverage.quality_flags.join() !== 'studio' || cv.coverage.note !== null) errs.push('gate coverage');
  if (cv.modification_candidates.length !== 1 || cv.modification_candidates[0].confirmed !== true || cv.notable_visual_features !== undefined) errs.push('gate модифікацій (confirmed) / notable прибрано');
  if (cv.equipment_visual[0].concept !== 'harman_kardon') errs.push('gate не додає concept до опції');
  if (cv.version !== CV.CURRENT_VISUAL_VERSION) errs.push('результат без версії');
  /* порожня/зламана відповідь не падає */
  const empty = CV.gateCurrentVisual(null, sent).current_visual;
  if (Object.keys(empty.zones).length !== 20 || empty.dashboard.odometer_reading !== null) errs.push('gate не переживає порожню відповідь');

  /* 6. ендпоінт: лише за токеном done-job, лише low, кадри з _meta/снапшота, той самий gallery_index, що бачив main */
  const src = fs.readFileSync('api/vision-bench.js', 'utf8');
  const src2 = () => src;
  if (!/reasoning_effort: 'low'/.test(src) || /req\.body\.(effort|reasoning_effort|model)/.test(src)) errs.push('ендпоінт дозволяє змінювати effort/модель');
  if (!/TOKEN_RE\.test\(token\)/.test(src) || /body\.photos|body\.urls/.test(src)) errs.push('ендпоінт приймає довільні кадри замість токена job');
  if (!/status=eq\.done/.test(src)) errs.push('ендпоінт читає не лише done-job');
  if (/method: 'PATCH'|method: 'POST',\s*headers: \{ apikey/.test(src)) errs.push('ендпоінт щось пише в БД');
  const fm = VB.framesFromMeta({ photos: ['https://cdn1.riastatic.com/a.webp', 'https://cdn1.riastatic.com/b.webp', 'https://cdn1.riastatic.com/c.webp'], photo_selection: { picked: [0, 2], high: [2] } });
  if (fm.length !== 2 || fm[1].gallery_index !== 2 || fm[1].high !== true || fm[0].high !== false) errs.push('framesFromMeta: ' + JSON.stringify(fm));
  const fs2 = VB.framesFromSnapshot([{ i: 4, url: 'https://x/y.jpg' }, { i: '7', url: 'https://x/z.jpg' }, { url: 'https://x/q.jpg' }]);
  if (fs2.length !== 3 || fs2[1].gallery_index !== 7) errs.push('framesFromSnapshot: ' + JSON.stringify(fs2));

  /* 6б. Phase 0B: спеціалісти, маршрутизація, злиття, нормалізація понять */
  for (const k of ['exterior', 'interior', 'dashboard']) {
    const sc = CV.buildSpecialistSchema(k);
    walk(sc, 'spec.' + k); if (sc.$defs) { walk(sc.$defs.zone, k + '.$defs.zone'); walk(sc.$defs.finding, k + '.$defs.finding'); }
    if (JSON.stringify(sc).length > 6000) errs.push('схема спеціаліста ' + k + ' розрослась');
    if (!/gallery_index/.test(CV.SPECIALIST_RULES[k]) || /аукціон|auction|historical|історичн|до ремонту/i.test(CV.SPECIALIST_RULES[k])) errs.push('правила спеціаліста ' + k + ' без gallery_index або з історичними даними');
  }
  const exZones = Object.keys(CV.buildSpecialistSchema('exterior').properties.zones.properties);
  if (CV.buildSpecialistSchema('exterior').properties.zones.properties.underbody === undefined) errs.push('exterior спец без underbody');
  if (exZones.length !== 12 || !exZones.includes('engine_bay') || !exZones.includes('underbody')) errs.push('exterior без engine_bay/underbody');
  if (Object.keys(CV.buildSpecialistSchema('interior').properties.zones.properties).length !== 8) errs.push('interior не 8 зон');
  if (CV.buildSpecialistSchema('dashboard').properties.zones) errs.push('dashboard-спеціаліст має зони');
  if (CV.SELECTOR_PROMPT !== fs.readFileSync('api/check.js', 'utf8').match(/text: '(Класифікуй кадри оголошення авто за типом[^']*)'/)[1]) errs.push('промпт класифікації відрізняється від production селектора');
  const rf6 = CV.normalizeFrames([0, 1, 2, 3, 4, 5, 6].map(i => ({ gallery_index: i, url: 'https://cdn1.riastatic.com/p/' + i + '.webp', high: i % 2 === 0 })));
  const routed = CV.routeFrames(rf6, { 0: 'front', 1: 'dashboard', 2: 'steering', 3: 'dashboard', 4: 'detail', 5: 'wheels', 6: 'dashboard' });
  const gi = arr => arr.map(f => f.gallery_index).join(',');
  if (gi(routed.exterior) !== '0,4,5') errs.push('exterior маршрут: ' + gi(routed.exterior));
  if (gi(routed.interior) !== '1,2,3,4,6') errs.push('interior маршрут: ' + gi(routed.interior));
  if (gi(routed.dashboard) !== '6,1,3' || routed.dashboard.length !== 3) errs.push('dashboard маршрут (1-3 найкращі, high спершу): ' + gi(routed.dashboard));
  if (CV.routeFrames(rf6, {}).interior.length !== 7 || CV.routeFrames(rf6, {}).dashboard.length !== 0) errs.push('кадри без типу мають іти обом condition-спеціалістам як detail');
  const routedT = CV.routeFrames(rf6, { 0: 'front', 1: 'center_console', 2: 'steering', 3: 'center_console' });
  if (gi(routedT.dashboard) !== '2,1,3') errs.push('dashboard маршрут має брати центральний екран третім пріоритетом (Tesla): ' + gi(routedT.dashboard));
  /* злиття: зони від свого спеціаліста, опції від interior, панель від dashboard */
  const ex = CV.gateSpecialist('exterior', { coverage: { frames_received: 1, frames_usable: 1, quality_flags: [], note: null }, zones: { underbody: { visibility: 'sufficient', frames: [4], findings: [{ kind: 'corrosion', severity: 'moderate', sign: 'поверхнева корозія на глушнику і кріпленнях', gallery_index: 4, confidence: 'high' }] } }, modification_candidates: [{ feature: 'впуск Perrin', basis: 'brand_readable', gallery_index: 4, sign: 'напис PERRIN на патрубку впуску', confidence: 'high' }], summary: 'ext' }, rf6).current_visual;
  const inr = CV.gateSpecialist('interior', { coverage: { frames_received: 1, frames_usable: 1, quality_flags: [], note: null }, zones: { front_seats: { visibility: 'sufficient', frames: [2], findings: [] } }, equipment_visual: [{ normalized_name: 'задня камера', visible_label_or_feature: 'обʼєктив', category: 'camera_parking', gallery_index: 2, sign: 'обʼєктив над номерним знаком', confidence: 'high' }], modification_candidates: [], summary: 'int' }, rf6).current_visual;
  const dsh = CV.gateSpecialist('dashboard', { frames_usable: 1, dashboard: { visible: true, ignition_on: true, odometer_reading: { value: 151975, unit: 'km', gallery_index: 1, sign: 'цифри 151975 km у нижньому рядку', confidence: 'high' }, warning_lights: [], readable_messages: [] } }, rf6).current_visual;
  const merged = CV.mergeSpecialists({ exterior: ex, interior: inr, dashboard: dsh }, rf6);
  if (Object.keys(merged.zones).length !== 20 || merged.zones.underbody.findings.length !== 1 || merged.zones.front_seats.visibility !== 'sufficient' || merged.zones.doors.visibility !== 'not_visible') errs.push('злиття зон: ' + JSON.stringify(Object.keys(merged.zones).length));
  if (merged.equipment_visual.length !== 1 || merged.dashboard.odometer_reading.value !== 151975 || merged.modification_candidates.length !== 1 || merged.modification_candidates[0].source !== 'exterior') errs.push('злиття опцій/панелі/модифікацій');
  if (!CV.mergeSpecialists({ exterior: ex }, rf6).dashboard || CV.mergeSpecialists({ exterior: ex }, rf6).dashboard.odometer_reading !== null) errs.push('злиття без dashboard-спеціаліста');
  if (CV.equipmentConcept('Камера заднього виду') !== CV.equipmentConcept('задня камера') || CV.equipmentConcept('Harman Kardon') !== 'harman_kardon' || CV.equipmentConcept('підігрів керма') !== 'heated_wheel' || !/^other:/.test(CV.equipmentConcept('щось незвичне'))) errs.push('нормалізація понять');
  if (CV.equipmentConcept('задні дефлектори вентиляції') !== 'rear_climate' || CV.equipmentConcept('вентиляція передніх сидінь') !== 'seat_ventilation' || CV.equipmentConcept('підкермові пелюстки перемикання передач') !== 'paddles') errs.push('нормалізація: задні дефлектори / пелюстки');
  if (CV.modificationConfirmed({ basis: 'aftermarket_look', confidence: 'high' }) || !CV.modificationConfirmed({ basis: 'brand_readable', confidence: 'medium' }) || CV.modificationConfirmed({ basis: 'visible_alteration', confidence: 'low' })) errs.push('modificationConfirmed');
  if (!/MODES = \['general', 'exterior', 'interior', 'dashboard', 'classify'\]/.test(src2()) || !/UUID_RE\.test\(reportId\)/.test(src2()) || !/kind=eq\.check/.test(src2())) errs.push('ендпоінт: режими/report_id');

  /* 7. Phase 1 SHADOW: Vision у production лише за CV_MODE=shadow (або cv_mode у тілі
     запиту для валідації), стартує після вибору кадрів паралельно з рештою,
     НЕ чекається перед основним викликом, результат лише в _meta, основний
     промпт/контент його не отримує, публічний звіт не віддає, збій не
     ламає Check */
  const check = fs.readFileSync('api/check.js', 'utf8');
  if (!/const cvMode = process\.env\.CV_MODE === 'off' \? null\s*\n\s*: \(benchAllowed && req\.body && req\.body\.cv_mode === 'off'\) \? null : 'shadow';/.test(check)) errs.push('shadow не керується CV_MODE=off / вимикач доступний без ключа');
  const iStart = check.indexOf("if (cvMode === 'shadow') {"), iMain = check.indexOf("progress('ai');"), iMainDone = check.indexOf("mark('main_analysis'"), iWait = check.indexOf('cvShadowResult = await Promise.race([cvShadow');
  if (!(iStart > 0 && iStart < iMain && iWait > iMainDone)) errs.push('shadow Vision має стартувати до основного виклику і чекатись лише після нього');
  if (!/cvShadow = \(async \(\) => \{/.test(check) || !/\}\)\(\)\.catch\(e => \(\{ status: 'failed'/.test(check)) errs.push('shadow без catch: збій Vision може впустити Check');
  if (!/status: 'timeout'/.test(check) || !/mark\('current_vision_shadow'/.test(check)) errs.push('shadow без таймауту або без таймінгу');
  const mainContent = check.slice(check.indexOf('const content = ['), check.indexOf("let mainSystem = mainMsg.system;"));
  if (/cvShadow|current_visual_shadow|CURRENT_VISUAL_RULES|currentVisualResponseFormat|frameContent\(/.test(mainContent)) errs.push('контент основного виклику містить Current Vision');
  const rulesArea = check.slice(check.indexOf('const DECISION_RULES = `'), check.indexOf('export function compactHistoricalVisual'));
  if (/current_visual_shadow|CURRENT_VISUAL_EVIDENCE:|cvShadow/.test(rulesArea)) errs.push('правила основного виклику посилаються на shadow Vision');
  if (!/current_visual_shadow: cvShadowResult/.test(check)) errs.push('результат shadow не зберігається в _meta');
  if (/current_visual_shadow/.test(fs.readFileSync('api/share.js', 'utf8'))) errs.push('shadow Vision потрапив у публічний allowlist');
  if (/current_visual_shadow|cvShadow/.test(fs.readFileSync('api/score-v3.js', 'utf8')) || /current_visual_shadow/.test(fs.readFileSync('result-check.html', 'utf8')) || /current_visual_shadow/.test(fs.readFileSync('api/vehicle-memory.js', 'utf8'))) errs.push('shadow Vision використовується Score/UI/Vehicle Memory');
  if (!/odometerDiscrepancy\(current_visual, listing\.odometer_km\)/.test(check)) errs.push('нема детермінованого порівняння одометра з пробігом оголошення');
  if (/odometer_km/.test(CV.CURRENT_VISUAL_RULES) || /listing\.odometer_km/.test(check.slice(iStart, check.indexOf('const d = await callModel(body, 95000)')))) errs.push('пробіг оголошення потрапляє у Vision: одометр має читатись незалежно');
  /* v1 helpers: план деталізації, порівняння одометра, телеметрія */
  const fr2 = CV.normalizeFrames([{ gallery_index: 0, url: a }, { gallery_index: 5, url: d }]);
  const plan = CV.frameDetailPlan(fr2, { 0: 'front', 5: 'dashboard' }, new Set());
  if (plan.source !== 'selector_types' || plan.high.join() !== '5' || plan.low.join() !== '0') errs.push('план деталізації: ' + JSON.stringify(plan));
  if (CV.frameDetailPlan(fr2, { 0: 'front', 5: 'rear' }, new Set([0])).high.join() !== '0') errs.push('high-слот селектора має лишатись high');
  if (CV.frameDetailPlan(fr2, null, null).source !== 'all_high_no_types' || CV.frameDetailPlan(fr2, null, null).low.length) errs.push('без типів усі кадри мають бути high');
  const odo = CV.odometerDiscrepancy({ dashboard: { odometer_reading: { value: 30688, unit: 'km', gallery_index: 10, photo_identity: 'p', confidence: 'high' } } }, 36000);
  if (odo.status !== 'discrepancy_candidate' || odo.delta_km !== -5312 || odo.candidate !== true || odo.needs_verification !== true) errs.push('одометр: розбіжність не зафіксована: ' + JSON.stringify(odo));
  /* кандидат лише з high confidence і підтвердженою одиницею */
  const odoMed = CV.odometerDiscrepancy({ dashboard: { odometer_reading: { value: 161828, unit: 'km', gallery_index: 40, photo_identity: 'p', confidence: 'medium' } } }, 168000);
  if (odoMed.status !== 'unconfirmed_reading' || odoMed.candidate !== false) errs.push('одометр: medium не має ставати кандидатом: ' + JSON.stringify(odoMed));
  const odoUnk = CV.odometerDiscrepancy({ dashboard: { odometer_reading: { value: 43524, unit: 'unknown', gallery_index: 19, photo_identity: 'p', confidence: 'high' } } }, 44000);
  if (odoUnk.status !== 'unit_unknown' || odoUnk.candidate !== false) errs.push('одометр: невідома одиниця не має давати сигнал: ' + JSON.stringify(odoUnk));
  /* одиниця лише з кадру: unit у відповіді без одиниці в ознаці -> unknown */
  const unitGate = CV.gateCurrentVisual({ dashboard: { visible: true, engine_state: 'ignition_on_engine_off', odometer_reading: { value: 43524, unit: 'mi', gallery_index: 3, sign: 'цифри 43524 у нижній частині панелі', confidence: 'high' }, warning_lights: [], readable_messages: [] } }, sent);
  if (unitGate.current_visual.dashboard.odometer_reading.unit !== 'unknown' || unitGate.stats.odometer_unit_unverified !== 1) errs.push('одиниця без згадки на кадрі має ставати unknown');
  const unitOk = CV.gateCurrentVisual({ dashboard: { visible: true, engine_state: 'running', odometer_reading: { value: 43524, unit: 'mi', gallery_index: 3, sign: 'напис «43524 mi» під спідометром', confidence: 'high' }, warning_lights: [], readable_messages: [] } }, sent);
  if (unitOk.current_visual.dashboard.odometer_reading.unit !== 'mi' || unitOk.current_visual.dashboard.engine_state !== 'running') errs.push('підтверджена одиниця або engine_state загубились');
  if (CV.gateCurrentVisual({ dashboard: { engine_state: 'bogus' } }, sent).current_visual.dashboard.engine_state !== 'unknown') errs.push('engine_state без валідації');
  /* правила: одиниця з кадру, engine_state, лампа це спостереження */
  for (const need of ['ОДИНИЦЯ (km чи mi) зараховується ЛИШЕ коли вона написана на самому кадрі', 'СТАН ДВИГУНА (engine_state)', 'несправністю ти його не називаєш']) if (!CV.CURRENT_VISUAL_RULES.includes(need)) errs.push('правила без блоку: ' + need.slice(0, 30));
  /* умовний верифікатор одометра */
  const vSchema = CV.buildOdometerVerifierSchema(); walk(vSchema, 'verifier');
  if (vSchema.properties.zones || vSchema.properties.equipment_visual) errs.push('верифікатор одометра розрісся до dashboard-спеціаліста');
  if (/пробіг оголошення|listing|оголошенн/i.test(CV.ODOMETER_VERIFIER_RULES)) errs.push('верифікатору передається контекст оголошення');
  const vFrames = CV.odometerVerifyFrames({ dashboard: { odometer_reading: { gallery_index: 5 } } }, CV.normalizeFrames([{ gallery_index: 0, url: a }, { gallery_index: 5, url: d }, { gallery_index: 8, url: 'https://cdn1.riastatic.com/x/9.webp' }]), { 0: 'front', 5: 'dashboard', 8: 'steering' });
  if (vFrames.map(f => f.gallery_index).join() !== '5,8' || vFrames.some(f => !f.high)) errs.push('кадри для перевірки одометра: ' + JSON.stringify(vFrames.map(f => f.gallery_index)));
  const vGate = CV.gateOdometerVerifier({ odometer_reading: { value: 168128, unit: 'km', gallery_index: 5, sign: 'напис «168128 km» у нижньому рядку', confidence: 'high' }, engine_state: 'ignition_on_engine_off' }, vFrames);
  if (!vGate.odometer_reading || vGate.odometer_reading.value !== 168128 || vGate.engine_state !== 'ignition_on_engine_off') errs.push('gate верифікатора: ' + JSON.stringify(vGate));
  if (CV.gateOdometerVerifier({ odometer_reading: { value: 1, unit: 'km', gallery_index: 99, sign: 'напис «1 km»', confidence: 'high' } }, vFrames).odometer_reading) errs.push('верифікатор приймає чужий кадр');
  const rec1 = CV.reconcileOdometer({ value: 5273, unit: 'km' }, { odometer_reading: { value: 5273, unit: 'km' } });
  const rec2 = CV.reconcileOdometer({ value: 161828, unit: 'km' }, { odometer_reading: { value: 168128, unit: 'km' } });
  const rec3 = CV.reconcileOdometer({ value: 43524, unit: 'mi' }, { odometer_reading: { value: 43524, unit: 'km' } });
  if (rec1.status !== 'confirmed' || rec2.status !== 'value_mismatch' || rec3.status !== 'unit_mismatch' || rec2.agreed || rec3.agreed) errs.push('звірка читань: ' + JSON.stringify([rec1.status, rec2.status, rec3.status]));
  if (CV.reconcileOdometer({ value: 100000, unit: 'km' }, null).status !== 'verifier_no_reading') errs.push('звірка без другого читання');
  /* у production верифікатор лише за кандидатом і всередині shadow-гілки */
  if (!/if \(odo && odo\.needs_verification\) \{/.test(check)) errs.push('верифікатор запускається не лише за кандидатом');
  const vIdx = check.indexOf('odometerVerifierResponseFormat()');
  if (!(vIdx > iStart && vIdx < iWait)) errs.push('верифікатор має жити всередині shadow-гілки, паралельно з основним викликом');
  if (!/odometer_verifier: verify/.test(check)) errs.push('результат верифікатора не зберігається');
  if (!/status: 'uncertain_visual_reading', candidate: false/.test(check)) errs.push('незгода читань не знімає сигнал розбіжності');
  if (CV.odometerDiscrepancy({ dashboard: { odometer_reading: { value: 151975, unit: 'km', gallery_index: 17, photo_identity: 'p', confidence: 'high' } } }, 151000).status !== 'consistent') errs.push('одометр: 975 км / 0.6% (округлення продавця) не має бути кандидатом');
  if (CV.odometerDiscrepancy({ dashboard: { odometer_reading: { value: 167612, unit: 'km', gallery_index: 24, photo_identity: 'p', confidence: 'high' } } }, 163000).candidate !== true) errs.push('одометр: 4 612 км / 2.8% має бути кандидатом');
  if (CV.odometerDiscrepancy({ dashboard: { odometer_reading: { value: 20000, unit: 'mi', gallery_index: 1, photo_identity: 'p', confidence: 'medium' } } }, 32000).visual_km !== 32187) errs.push('одометр: милі не переводяться в км');
  if (CV.odometerDiscrepancy({ dashboard: { odometer_reading: null } }, 1000).status !== 'no_visual_reading' || CV.odometerDiscrepancy(null, 1000).status !== 'no_visual_reading') errs.push('одометр: порожній стан');
  const summ = CV.summarizeCurrentVisual(cv, stats);
  if (!summ || summ.zones.not_visible !== 18 || summ.equipment.concepts[0] !== 'harman_kardon' || summ.odometer.value !== 30688 || summ.modifications.confirmed !== 1 || summ.messages !== 1) errs.push('телеметрія shadow: ' + JSON.stringify(summ));
  /* BaT: один фізичний кадр = один елемент галереї, найкращий варіант, мініатюра не виграє */
  const fx = JSON.parse(fs.readFileSync('test-fixtures/bat-gallery-120.json', 'utf8'));
  const g = fx.generator; const base = 'https://bringatrailer.com/wp-content/uploads/2026/08/';
  const urls = [];
  g.car.forEach((f, i) => { const v = i === 0 ? g.car_variants_first : f.startsWith('IMG_2693') ? g.car_variants_2693 : f.startsWith('WRX') ? g.car_variants_sticker : g.car_variants; v.forEach(q => urls.push(base + f + q)); });
  urls.push(...g.extra_after_car); g.site_graphics.forEach(x => g.site_variants.forEach(q => urls.push('https://bringatrailer.com/wp-content/uploads/' + x + q))); urls.push(...g.tail);
  if (urls.length !== 120) errs.push('фікстура BaT не 120 URL: ' + urls.length);
  const dd = VM.dedupePhotoVariants(urls);
  if (dd.photos.length !== fx.expected_physical || dd.removed !== 120 - fx.expected_physical) errs.push('BaT дедуплікація: ' + dd.photos.length + ' кадрів, прибрано ' + dd.removed);
  for (const [file, best] of Object.entries(fx.expected_best)) { const got = dd.photos.find(u => u.includes(file)); if (got !== best) errs.push('BaT найкращий варіант ' + file + ': ' + got); }
  if (dd.photos.some(u => /w=150|w=144|resize=144,/.test(u))) errs.push('BaT: мініатюра виграла');
  if (dd.photos[0] !== base + g.car[0] || dd.photos[1] !== base + g.car[1]) errs.push('BaT: порядок першої появи порушено');
  if (VM.dedupePhotoVariants(['https://cdn1.riastatic.com/a.webp', 'https://cdn2.riastatic.com/b.webp']).removed !== 0) errs.push('RIA-галерея без варіантів не має втрачати кадри');
  /* різні кадри, які площадка відрізняє лише query (?id=), НЕ склеюються; розмірні query склеюються */
  const q = VM.dedupePhotoVariants(['https://img.site.com/photo.php?id=1', 'https://img.site.com/photo.php?id=2', 'https://img.site.com/photo.php?id=1&w=300', 'https://img.site.com/p/1.jpg?w=200&h=150', 'https://img.site.com/p/1.jpg?resize=1024,768&quality=80']);
  if (q.photos.length !== 4 || q.removed !== 1 || !q.photos.some(u => u.endsWith('resize=1024,768&quality=80'))) errs.push('дедуплікація за query: ' + JSON.stringify(q));
  if (VM.photoVariantKey('https://a/x.jpg?id=5') === VM.photoVariantKey('https://a/x.jpg?id=6') || VM.photoVariantKey('https://a/x.jpg?w=1') !== VM.photoVariantKey('https://a/x.jpg')) errs.push('photoVariantKey');
  /* shadow не тримає готовий звіт довше за коротку паузу */
  const capM = /const CV_SHADOW_MAX_WAIT_MS = (\d+);/.exec(check);
  if (!capM || Number(capM[1]) > 10000 || !/Math\.min\(CV_SHADOW_MAX_WAIT_MS, 280000/.test(check)) errs.push('shadow може тримати звіт довше 10 с');
  if (!/const dedup = dedupePhotoVariants\(photos\.slice\(0, 120\)\);/.test(check) || !/photo_variants_removed: dedup\.removed/.test(check)) errs.push('extractListing не дедуплікує варіанти кадрів у тому самому вікні 120 URL');

  for (const f of ['api/current-visual.js', 'api/vision-bench.js', 'visiontest.js']) if (/\u2014/.test(fs.readFileSync(f, 'utf8'))) errs.push('довге тире у ' + f);

  if (errs.length) { console.log('VISION TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('vision v2 phase 0: стабільні photo_identity · 18 зон strict · gate доказовості · межа current/historical · ендпоінт лише за токеном job, лише low · production не чіпає');
  console.log('VISION TEST PASSED');
})().catch(e => { console.log('VISION TEST CRASHED:', e.stack || e.message); process.exit(1); });
