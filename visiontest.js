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
  if (zoneKeys.length !== 18 || CV.ZONES.some(z => !zoneKeys.includes(z))) errs.push('схема без 18 зон');
  if (!CV.ZONES.includes('wheels') || !CV.ZONES.includes('dashboard') || !CV.ZONES.includes('trunk')) errs.push('перелік зон не за ТЗ');
  const rf = CV.currentVisualResponseFormat();
  if (rf.type !== 'json_schema' || rf.json_schema.strict !== true) errs.push('response_format не strict json_schema');
  if (JSON.stringify(schema).length > 9000) errs.push('схема Vision розрослась: ' + JSON.stringify(schema).length);

  /* 4. правила: межа current/historical, стабільні посилання, доказовість, без вердиктів */
  const R = CV.CURRENT_VISUAL_RULES;
  if (/аукціон|auction|historical|історичн|до ремонту|before\/after|hv/i.test(R)) errs.push('правила Vision згадують історичні/аукціонні дані');
  for (const need of ['gallery_index', 'ЗОНИ', 'sufficient', 'not_visible', 'ПРИЛАДОВА ПАНЕЛЬ', 'одометр', 'КОМПЛЕКТАЦІЯ', 'МОДИФІКАЦІЇ', 'ДОКАЗОВІСТЬ', 'реальний пробіг', 'базова, платна', 'СТОРОНИ']) if (!R.includes(need)) errs.push('правила без блоку: ' + need);
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
    notable_visual_features: [{ feature: 'великий задній спойлер', gallery_index: 3, sign: 'спойлер на кришці багажника на всю ширину', confidence: 'high' }],
    modification_candidates: [{ feature: 'диски BBS', basis: 'brand_readable', gallery_index: 8, sign: 'напис BBS на центральній кришці диска', confidence: 'medium' }],
    dashboard: { visible: true, ignition_on: true, odometer_reading: { value: 30688, unit: 'km', gallery_index: 8, sign: 'цифри 30688 km на екрані під спідометром', confidence: 'high' },
      warning_lights: [{ light: 'check engine', gallery_index: 8, sign: 'жовта піктограма двигуна ліворуч від тахометра', confidence: 'high' }, { light: 'abs', gallery_index: 5, sign: 'напис ABS', confidence: 'high' }],
      readable_messages: [{ text: 'Service due', gallery_index: 8, confidence: 'medium' }] },
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
  if (Object.keys(cv.zones).length !== 20 || cv.zones.left_side.visibility !== 'not_visible' || stats.zones_filled !== 17) errs.push('gate не доповнює 20 зон (18 + engine_bay, underbody)');
  if (cv.zones.rear.visibility !== 'not_visible') errs.push('sufficient без кадрів і знахідок має стати not_visible');
  if (cv.equipment_visual.length !== 1 || cv.equipment_visual[0].photo_identity !== VM.photoIdentity(d)) errs.push('gate комплектації: ' + JSON.stringify(cv.equipment_visual));
  if (!cv.dashboard.odometer_reading || cv.dashboard.odometer_reading.value !== 30688 || cv.dashboard.odometer_reading.unit !== 'km' || cv.dashboard.odometer_reading.photo_identity !== VM.photoIdentity(d)) errs.push('gate одометра: ' + JSON.stringify(cv.dashboard.odometer_reading));
  if (cv.dashboard.warning_lights.length !== 1 || cv.dashboard.readable_messages.length !== 1) errs.push('gate індикаторів/повідомлень');
  if (cv.coverage.quality_flags.join() !== 'studio' || cv.coverage.note !== null) errs.push('gate coverage');
  if (cv.modification_candidates.length !== 1 || cv.notable_visual_features.length !== 1) errs.push('gate модифікацій/особливостей');
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
  if (CV.modificationConfirmed({ basis: 'aftermarket_look', confidence: 'high' }) || !CV.modificationConfirmed({ basis: 'brand_readable', confidence: 'medium' }) || CV.modificationConfirmed({ basis: 'visible_alteration', confidence: 'low' })) errs.push('modificationConfirmed');
  if (!/MODES = \['general', 'exterior', 'interior', 'dashboard', 'classify'\]/.test(src2()) || !/UUID_RE\.test\(reportId\)/.test(src2()) || !/kind=eq\.check/.test(src2())) errs.push('ендпоінт: режими/report_id');

  /* 7. production Check модуль не імпортує і не викликає */
  const check = fs.readFileSync('api/check.js', 'utf8');
  if (/current-visual\.js|vision-bench|gateCurrentVisual|CURRENT_VISUAL_(VERSION|RULES)|currentVisualResponseFormat/.test(check)) errs.push('api/check.js посилається на Phase 0 модуль: production мав лишитись незмінним');
  for (const f of ['api/current-visual.js', 'api/vision-bench.js', 'visiontest.js']) if (/\u2014/.test(fs.readFileSync(f, 'utf8'))) errs.push('довге тире у ' + f);

  if (errs.length) { console.log('VISION TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('vision v2 phase 0: стабільні photo_identity · 18 зон strict · gate доказовості · межа current/historical · ендпоінт лише за токеном job, лише low · production не чіпає');
  console.log('VISION TEST PASSED');
})().catch(e => { console.log('VISION TEST CRASHED:', e.stack || e.message); process.exit(1); });
