/* Комплектація: доказ підтверджує лише ТУ САМУ здатність. Регресії
   аудиту 10 звітів перед бетою: парктроніки підтверджували датчик світла
   і дощу, кнопки сидіння підтверджували дзеркала, шкіра сидінь підтверджувала
   шкіряне кермо, кнопки на кермі підтверджували шкіряний салон, задні
   дефлектори ставали заднім кліматом, твітер і кнопки аудіо ставали
   преміум-акустикою, коліщатко яскравості ставало атмосферним підсвічуванням.
   Вужче спостереження лишається власним пунктом «Видно на фото». */
const fs = require('fs');
const errs = [];
(async () => {
  const CV = await import('./api/current-visual.js');
  const CM = await import('./api/canonical-merge.js');
  const vis = (name, gi, sign) => ({ normalized_name: name, concept: CV.equipmentConcept(name), gallery_index: gi, sign, visible_label_or_feature: sign, confidence: 'high' });
  const cvOf = list => ({ equipment_visual: list });
  const seller = name => ({ name, category: 'comfort', confidence_level: 'seller', highlight: false, retrofit: false, retrofit_basis: null, historical_claim: false, value_tier: 'standard', evidence: [{ source: 'seller_claim', ref: 'seller_description', sign: name }] });
  const run = (claims, visual, lang = 'ru') => {
    const cv = cvOf(visual);
    const concepts = [...new Set(cv.equipment_visual.map(e => e.concept))];
    const gated = CV.applyCurrentVisualEquipmentGate(claims, concepts);
    return CM.mergeCanonicalEquipment(gated.items, cv, lang);
  };
  const find = (m, re) => m.items.find(x => re.test(x.name));
  const visualOf = x => (x && x.evidence || []).filter(e => e.source === 'current_photos');

  /* ---------- негативні: доказ сусідньої опції не підтверджує заяву ---------- */
  const NEG = [
    ['1. кнопки сидіння не підтверджують дзеркала', 'Электрорегулировка зеркал', vis('электропривод водительского сиденья', 39, 'переключатели регулировок на основании сиденья'), /зеркал/i, /Электрорегулировка сидений/],
    ['2. парктроніки не підтверджують датчик світла', 'Датчик света', vis('паркувальні датчики спереду', 1, 'круглые датчики в переднем бампере'), /Датчик света/, /Парковочные датчики/],
    ['3. парктроніки не підтверджують датчик дощу', 'Датчик дождя', vis('передні паркувальні датчики', 2, 'круглые датчики в переднем бампере'), /Датчик дождя/, /Парковочные датчики/],
    ['4. шкіра сидінь не підтверджує шкіряне кермо', 'Кожаная отделка рулевого колеса', vis('шкіряне оздоблення сидінь', 3, 'оранжевая кожаная обивка сидений'), /рулевого колеса/, /Кожаная обивка сидений/],
    ['4б. шкіра сидінь не підтверджує ширший шкіряний салон', 'Кожаная отделка салона', vis('шкіряне оздоблення сидінь', 3, 'оранжевая кожаная обивка сидений'), /отделка салона/, /Кожаная обивка сидений/],
    ['4в. режим AUTO склоочисників не підтверджує датчик дощу', 'Датчик дождя', vis('автоматичні склоочисники', 24, 'положение AUTO на подрулевом переключателе стеклоочистителей'), /Датчик дождя/, /Автоматический режим стеклоочистителей/],
    ['5. кнопки на кермі не підтверджують шкіряний салон', 'Кожаная отделка салона', vis('кнопки на обеих спицах руля', 29, 'кнопки управления на обеих спицах руля'), /Кожаная отделка салона/, /Многофункциональный руль/],
    ['6. задні дефлектори не підтверджують задній клімат', 'Климат-контроль для задних пассажиров', vis('задні дефлектори вентиляції', 36, 'воздуховоды на задней части центральной консоли'), /задних пассажиров/, /Задние дефлекторы вентиляции/],
    ['7. твітер не підтверджує преміум-акустику', 'Премиальная аудиосистема', vis('преміум-акустика з окремими твітерами', 7, 'круглый твитер в передней стойке'), /Премиальная аудиосистема/, /динамик или твитер/],
    ['8. кнопки аудіо на кермі не підтверджують преміум-акустику', 'Премиальная аудиосистема', vis('кнопки керування аудіо на кермі', 32, 'кнопки на левой спице руля'), /Премиальная аудиосистема/, /Кнопки управления аудио на руле/],
    ['9. коліщатко яскравості не підтверджує атмосферне підсвічування', 'Атмосферная подсветка салона', vis('підсвічування панелі приладів', 22, 'колёсико регулировки яркости подсветки'), /Атмосферная подсветка/, null],
    /* бета-гейт 2026-10-08: одне відро led_lights робило увімкнені LED-контури
       точним доказом лазерних і адаптивних фар */
    ['10. увімкнені LED-елементи не підтверджують лазерні фари', 'Лазерные фары', vis('увімкнені світлодіодні світлові елементи у передніх фарах', 2, 'На передней фаре видны включённые световые контуры.'), /Лазерные/, /Светодиодная оптика/],
    ['11. увімкнені LED-елементи не підтверджують адаптивні фари', 'Адаптивные светодиодные фары', vis('світлодіодні фари', 3, 'В обеих передних фарах видны включённые световые контуры.'), /Адаптивные/, /Светодиодная оптика/],
    ['12. LED-елементи не підтверджують ксенон', 'Ксеноновые фары', vis('світлодіодні фари', 3, 'В передних фарах видны включённые световые контуры.'), /Ксеноновые/, /Светодиодная оптика/],
  ];
  for (const [title, claim, observation, claimRe, narrowerRe] of NEG) {
    const m = run([seller(claim)], [observation]);
    const c = find(m, claimRe);
    if (!c || c.confidence_level !== 'seller' || visualOf(c).length) errs.push(title + ': заява отримала чужий доказ: ' + JSON.stringify(c && { lvl: c.confidence_level, ev: visualOf(c) }));
    if (narrowerRe) {
      const n = find(m, narrowerRe);
      if (!n || n.confidence_level !== 'visual' || visualOf(n).length !== 1) errs.push(title + ': вужче спостереження загублене: ' + JSON.stringify(m.items.map(x => x.name)));
    } else if (m.items.length !== 1 || m.stats.unlabelled !== 1) {
      errs.push(title + ': нецінне спостереження мало лишитись лише в телеметрії: ' + JSON.stringify(m.items.map(x => x.name)));
    }
    if (!m.stats.not_confirming.length) errs.push(title + ': звʼязок заяви зі спостереженням не зафіксований');
  }

  /* ---------- позитивні: точне спостереження підтверджує ---------- */
  {
    const m = run([seller('Электрорегулировка сидений')], [vis('электропривод водительского сиденья', 39, 'переключатели регулировок на основании сиденья')]);
    const c = find(m, /сидений/);
    if (!c || c.confidence_level !== 'seller_and_visual' || visualOf(c)[0].ref !== 'photo_40') errs.push('П1. точні кнопки сидіння не підтвердили електропривод сидінь: ' + JSON.stringify(c));
    if (m.items.length !== 1) errs.push('П1. дублікат пункту: ' + m.items.map(x => x.name).join(', '));
  }
  {
    const m = run([seller('Акустика Harman Kardon')], [vis('Harman Kardon', 16, 'напис harman/kardon на решітці динаміка')]);
    const c = find(m, /Harman/);
    if (!c || c.confidence_level !== 'seller_and_visual') errs.push('П2. читабельний бренд акустики не підтвердив систему: ' + JSON.stringify(c));
  }
  {
    const m = run([seller('Климат-контроль для задних пассажиров')], [vis('задній клімат-контроль', 5, 'панель с регуляторами TEMP и REAR COOL')]);
    const c = find(m, /задних пассажиров/);
    if (!c || c.confidence_level !== 'seller_and_visual') errs.push('П3. окрема задня панель клімату не підтвердила задній клімат: ' + JSON.stringify(c));
  }
  {
    const m = run([seller('Датчик света')], [vis('датчик світла', 9, 'датчик на лобовому склі за дзеркалом')]);
    if (find(m, /Датчик света/).confidence_level !== 'seller_and_visual') errs.push('П4. точний датчик світла не підтверджений');
    const m3 = run([seller('Кожаный салон')], [vis('шкіряне оздоблення салону', 4, 'шкіра на сидіннях, дверних картах і торпедо')]);
    if (find(m3, /Кожаный салон/).confidence_level !== 'seller_and_visual') errs.push('П6. точне спостереження шкіряного салону не підтвердило заяву');
    const m4 = run([seller('Датчик дождя')], [vis('датчик дощу', 2, 'модуль датчика дощу на лобовому склі за дзеркалом')]);
    if (find(m4, /Датчик дождя/).confidence_level !== 'seller_and_visual') errs.push('П7. точний датчик дощу не підтвердив заяву');
    const m2 = run([seller('Подогрев сидений')], [vis('підігрів передніх сидінь', 9, 'кнопки з піктограмами підігріву')]);
    if (find(m2, /Подогрев/).confidence_level !== 'seller_and_visual') errs.push('П5. точний збіг не підняв заяву до підтвердженої');
  }
  {
    const m = run([seller('Светодиодные фары')], [vis('світлодіодні фари', 3, 'В передних фарах видны включённые светодиодные контуры.')]);
    if (find(m, /Светодиодные/).confidence_level !== 'seller_and_visual') errs.push('П8. точне спостереження LED не підтвердило світлодіодні фари');
    const m2 = run([seller('Лазерные фары')], [vis('лазерні фари', 2, 'на розсіювачі читається позначення Laser')]);
    if (find(m2, /Лазерные/).confidence_level !== 'seller_and_visual') errs.push('П9. точне спостереження лазерних фар не підтвердило заяву');
  }
  /* спостереження без заяви продавця не викидається */
  {
    const m = run([], [vis('задні дефлектори вентиляції', 36, 'воздуховоды'), vis('круглый твитер в передней стойке', 7, 'твитер'), vis('кнопки керування аудіо на кермі', 32, 'кнопки')]);
    const names = m.items.map(x => x.name);
    if (m.items.length !== 3 || !names.some(n => /дефлектор/i.test(n)) || !names.some(n => /твитер/i.test(n)) || !names.some(n => /аудио на руле/i.test(n))) errs.push('спостереження без заяви загублені: ' + names.join(', '));
    if (m.items.some(x => x.confidence_level !== 'visual')) errs.push('спостереження без заяви має рівень «Видно на фото»');
  }

  /* ---------- таксономія відношень ---------- */
  const R = CV.relateConcepts;
  if (R('rear_vents', 'rear_climate') !== 'narrower' || R('speaker_visible', 'premium_audio') !== 'narrower' || R('audio_steering_controls', 'premium_audio') !== 'narrower') errs.push('вужчі спостереження не позначені narrower');
  if (R('rear_climate', 'rear_vents') !== 'broader_unsupported') errs.push('зворотне відношення не broader_unsupported');
  if (R('leather_seats', 'leather') !== 'narrower' || R('auto_wipers', 'rain_sensor') !== 'narrower') errs.push('шкіра сидінь і режим AUTO не позначені narrower');
  if (R('parking_sensors', 'light_sensor') !== 'incompatible' || R('seat_power', 'mirror_power') !== 'incompatible' || R('leather', 'leather_steering_wheel') !== 'incompatible' || R('cluster_brightness', 'ambient_lighting') !== 'incompatible') errs.push('несумісні пари не позначені');
  if (R('led_lights', 'laser_headlights') !== 'narrower' || R('led_lights', 'adaptive_headlights') !== 'narrower' || R('led_lights', 'xenon_headlights') !== 'incompatible') errs.push('фари: LED не позначений вужчим за лазер/адаптив і несумісним із ксеноном');
  if (R('seat_heating', 'seat_heating') !== 'exact' || R('hud', 'navigation') !== 'unrelated') errs.push('exact/unrelated зламані');
  for (const [a, b] of [...CV.CONCEPT_NARROWER, ...CV.CONCEPT_INCOMPATIBLE]) {
    for (const k of [a, b]) if (!CV.EQUIPMENT_CONCEPTS.some(([key]) => key === k)) errs.push('таксономія посилається на невідоме поняття: ' + k);
  }
  /* гейт: чужий доказ знімається з причиною */
  {
    const g = CV.applyCurrentVisualEquipmentGate([{ name: 'Датчик света', confidence_level: 'seller_and_visual', evidence: [{ source: 'seller_claim' }, { source: 'current_photos', ref: 'photo_2', sign: 'парктроники' }] }], ['parking_sensors']);
    if (g.dropped !== 1 || !g.relations.length || g.relations[0].relation !== 'incompatible' || g.items[0].evidence.length !== 1) errs.push('гейт не зняв чужий доказ або не пояснив: ' + JSON.stringify(g));
  }
  /* точність словника: назва кожного поняття трьома мовами повертається до себе, нові поняття розрізняються */
  for (const [name, key] of [['Электрорегулировка зеркал', 'mirror_power'], ['Електрорегулювання дзеркал', 'mirror_power'], ['Power-adjustable mirrors', 'mirror_power'], ['Датчик света', 'light_sensor'], ['Датчик дощу', 'rain_sensor'], ['Rain sensor', 'rain_sensor'],
    ['Кожаный руль', 'leather_steering_wheel'], ['Кожаная отделка рулевого колеса', 'leather_steering_wheel'], ['Шкіряне оздоблення салону', 'leather'], ['Leather interior', 'leather'], ['Кожаная отделка салона', 'leather'], ['Кожаный салон', 'leather'],
    ['шкіряне оздоблення сидінь', 'leather_seats'], ['Кожаная обивка сидений', 'leather_seats'], ['Leather seat upholstery', 'leather_seats'], ['оранжевая кожаная обивка передних и задних сидений', 'leather_seats'],
    ['автоматичні склоочисники', 'auto_wipers'], ['Автоматический режим стеклоочистителей', 'auto_wipers'], ['Automatic wiper mode', 'auto_wipers'], ['Датчик дождя и света', 'rain_sensor'],
    ['Задние дефлекторы вентиляции', 'rear_vents'], ['Климат для задних пассажиров', 'rear_climate'], ['задній клімат', 'rear_climate'], ['Rear air vents', 'rear_vents'],
    ['Отдельный динамик или твитер', 'speaker_visible'], ['Премиальная аудиосистема', 'premium_audio'], ['Кнопки управления аудио на руле', 'audio_steering_controls'],
    ['Многофункциональный руль', 'multifunction_wheel'], ['Спортивный руль', 'm_steering_wheel'], ['подогрев руля', 'heated_wheel'],
    ['Атмосферная подсветка салона', 'ambient_lighting'], ['контурная подсветка салона', 'ambient_lighting'], ['регулятор яскравості підсвітки приладів', 'cluster_brightness'],
    ['Парковочные датчики', 'parking_sensors'], ['парктроніки', 'parking_sensors'], ['Ассистент автоматической парковки', 'automatic_parking'],
    ['Лазерные фары', 'laser_headlights'], ['Laser headlights', 'laser_headlights'], ['Лазерні фари', 'laser_headlights'], ['Адаптивные светодиодные фары', 'adaptive_headlights'], ['Matrix LED', 'adaptive_headlights'], ['Адаптивні фари', 'adaptive_headlights'], ['Adaptive LED headlights', 'adaptive_headlights'],
    ['Ксеноновые фары', 'xenon_headlights'], ['Біксенонові фари', 'xenon_headlights'], ['Светодиодные фары', 'led_lights'], ['LED фари', 'led_lights'], ['увімкнені світлодіодні світлові елементи у передніх фарах', 'led_lights']]) {
    if (CV.equipmentConcept(name) !== key) errs.push('поняття: ' + name + ' -> ' + CV.equipmentConcept(name) + ', очікували ' + key);
  }
  if (CV.equipmentConcept('Адаптивный круиз-контроль') === 'adaptive_headlights' || CV.equipmentConcept('Адаптивна підвіска') === 'adaptive_headlights') errs.push('адаптивний круїз або підвіска стали адаптивними фарами');
  /* Vision називає те, що видно; Final Conclusion не робить заяву продавця фактом */
  if (!/називай САМЕ ТЕ, ЩО ВИДНО, а не ширшу функцію/.test(CV.CURRENT_VISUAL_RULES)) errs.push('правило Vision про вужче спостереження відсутнє');
  const fc = fs.readFileSync('api/conclusion.js', 'utf8');
  if (!/\(seller claim only\) is the seller's statement and nothing more/.test(fc)) errs.push('Final Conclusion не тримає заяву продавця умовною');
  const chk = fs.readFileSync('api/check.js', 'utf8');
  if (!/dropped_relations: gated\.relations/.test(chk)) errs.push('нема телеметрії відношень знятих доказів');

  if (errs.length) { console.log('EQUIPMENT EVIDENCE TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('доказ комплектації: лише точне поняття · 9 регресій аудиту · вужче спостереження лишається пунктом · бренд, задня панель клімату і точні кнопки підтверджують · таксономія narrower/incompatible');
  console.log('EQUIPMENT EVIDENCE TEST PASSED');
})();
