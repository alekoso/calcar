/* Премиум-опції в картці "Комплектація" (Premium options v2): тест без
   мережі і без бази.

   Що доводиться:
   1. премиум вирішує лише детермінована таксономія за назвою
      (equipment-value.js); value_tier моделі і позначка каталогу MI
      підсвітку не змінюють; однакова річ однакова на будь-якому авто;
   2. RU, UA, EN і фірмові назви сходяться до одного поняття;
   3. подача: затверджений стиль premium-chip і легенди не змінений
      (відбиток CSS), легенда лише за наявності премиуму і з назвою
      "Премиум-опції", ліміту кількості немає;
   4. докази: доступне в MI встановленим не стає; підтверджене фото і
      даними оголошення показується; одна й та сама річ з різних джерел
      дає один пункт; поняття Vision без словникової назви більше не
      губляться (екрани і окремі крісла задніх пасажирів);
   5. Maybach: усе, що вже знає Check, доходить до картки, нічого не
      вигадано;
   6. нових мережевих викликів немає.

   Запуск: node premiumtest.js */

const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

(async () => {
  const w = {};
  vm.runInNewContext(fs.readFileSync('equipment-value.js', 'utf8'), { window: w, String, RegExp });
  const EV = w.CalCarEquipmentValue;
  const prem = name => EV.isHighValue({ name });

  /* ===== 1. класифікація ===== */
  const TRUE = {
    '1-11': ['Ассистент автоматической парковки', 'Камеры кругового обзора', 'Аудиосистема Harman Kardon', 'Аудиосистема Burmester 3D', 'Вентиляция передних сидений',
      'Массаж сидений', 'Подруливающая задняя ось', 'Digital Light', 'Лазерные фары'],
    UA: ['Асистент автоматичного паркування', 'Камери кругового огляду', 'Вентиляція сидінь', 'Масаж сидінь', 'Проєкційний дисплей', 'Повноповоротне шасі', 'Екрани для задніх пасажирів', 'Окремі задні крісла', 'Пневмопідвіска'],
    EN: ['Parking Assistant Plus', 'Surround View', '3D view camera', 'Ventilated seats', 'Massage seats', 'Rear axle steering', 'Head-up display', 'Night vision', 'Rear seat entertainment', 'Individual rear seats', 'Soft close doors'],
    brand: ['harman/kardon', 'Burmester 4D', 'Bowers & Wilkins Diamond', 'Bang & Olufsen', 'Mark Levinson', 'Meridian', 'Bose', 'E-ACTIVE BODY CONTROL', 'AIRMATIC', 'Airscarf', 'Chauffeur Package', 'Executive rear seats', 'Integral Active Steering'],
  };
  const FALSE = ['Память сидений и зеркал', 'Памʼять сидінь і дзеркал', 'Memory seats and mirrors', 'Apple CarPlay и Android Auto', 'Подогрев передних сидений', 'Підігрів сидінь', 'Heated seats',
    'Парктроники', 'Park Assist sensors', 'Круиз-контроль', 'Адаптивный круиз-контроль', 'Бесключевой доступ', 'Навигационная система', 'Климат-контроль', 'Климат для задних пассажиров',
    'Камера заднего вида', 'Панорамная крыша или люк', 'Атмосферная подсветка салона', 'Электропривод крышки багажника', 'Электропривод двери багажника', 'Электрорегулировка сидений',
    'Премиальная аудиосистема', 'Мультимедийный дисплей', 'Цифровая приборная панель', 'Светодиодные фары', 'Датчики света и дождя', 'Bluetooth', 'ABS', 'Сигнализация', 'Бортовой компьютер'];
  for (const [group, list] of Object.entries(TRUE)) for (const n of list) ok('1. ' + group + ': премиум "' + n + '"', prem(n), EV.conceptFor(n));
  for (const n of FALSE) ok('1. звичайне "' + n + '"', !prem(n), EV.conceptFor(n));
  ok('1a. синоніми сходяться до одного поняття', EV.conceptFor('Камеры кругового обзора') === EV.conceptFor('Surround View') && EV.conceptFor('Surround View') === EV.conceptFor('Камери кругового огляду')
    && EV.conceptFor('Harman Kardon') === EV.conceptFor('Burmester') && EV.conceptFor('Ассистент автоматической парковки') === EV.conceptFor('Parking Assistant Plus'));
  /* value_tier моделі і каталог MI підсвітку не вирішують */
  ok('1b. value_tier моделі не робить памʼять сидінь премиумом', !EV.isHighValue({ name: 'Память сидений и зеркал', value_tier: 'high_value' }));
  ok('1c. value_tier моделі не знімає премиум з Harman Kardon', EV.isHighValue({ name: 'Аудиосистема Harman Kardon', value_tier: 'standard' }));
  ok('1d. позначка каталогу MI теж не вирішує', !EV.isHighValue({ name: 'Люк', mi: { confirmed: true, value_tier: 'high_value' } }) && EV.isHighValue({ name: 'Пневмоподвеска', mi: { confirmed: true, value_tier: 'standard' } }));
  ok('1e. марка авто не бере участі', !/maybach|mercedes|bmw|porsche|toyota|lanos/i.test(fs.readFileSync('equipment-value.js', 'utf8').replace(/Maybach частина|Maybach/g, '')));
  ok('1f. сміття не ламає', !EV.isHighValue(null) && !EV.isHighValue({}) && !EV.isHighValue({ name: '' }) && EV.premiumConcept({ name: 'Массаж сидений' }) === 'massage_seats');

  /* ===== 3. подача ===== */
  const page = fs.readFileSync('result-check.html', 'utf8');
  const a = page.indexOf('  /* Дорога опція відрізняється ЛИШЕ рамкою, і рамка повільно тече.'), b = page.indexOf('  /* міжчипові відступи більші');
  const fp = crypto.createHash('sha1').update(page.slice(a, b)).digest('hex');
  ok('16. затверджений стиль premium-chip і легенди не змінений (відбиток CSS)', a > 0 && fp === '46dc8f6c0e37bab69b37ff9ec6b43042cbed1eba', fp);
  ok('16a. premium-chip той самий клас .eq-chip.hv', /return '<span class="eq-chip' \+ \(hv \? ' hv' : ''\) \+ '"'/.test(page) && /const hv = CalCarEquipmentValue\.isHighValue\(o\);/.test(page));
  ok('17. звичайна опція лишається звичайним chip', /class="eq-chip' \+ \(hv \? ' hv' : ''\)/.test(page));
  ok('18-19. легенда лише коли показано хоч одну премиум-опцію', /const anyHv = eqV2\.some\(o => CalCarEquipmentValue\.isHighValue\(o\)\);\n\s*\$\('eqLegend'\)\.hidden = !anyHv;/.test(page) && /id="eqLegend" hidden>/.test(page));
  const d = { CALCAR_DICTS: {} };
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) vm.runInNewContext(fs.readFileSync(f, 'utf8'), { window: d });
  ok('20. легенда: Premium options / Премиум-опции / Преміум-опції', /id="eqLegend" hidden>Premium options<\/span>/.test(page) && d.CALCAR_DICTS.ru['Premium options'] === 'Премиум-опции' && d.CALCAR_DICTS.ua['Premium options'] === 'Преміум-опції');
  ok('20a. підказка без обіцянки платної опції', /t\('Premium option'\) \+ '\. ' \+ t\('High-end equipment that noticeably sets this car apart\.'\)/.test(page)
    && d.CALCAR_DICTS.ru['Premium option'] && d.CALCAR_DICTS.ua['High-end equipment that noticeably sets this car apart.']);
  ok('20b. поняття таксономії лишається на chip для діагностики', /data-premium="' \+ esc\(CalCarEquipmentValue\.premiumConcept\(o\)\)/.test(page));
  const many = ['Массаж сидений', 'Вентиляция сидений', 'Камеры кругового обзора', 'Проекционный дисплей', 'Аудиосистема Burmester 4D', 'Пневмоподвеска Airmatic', 'E-ACTIVE BODY CONTROL', 'Подруливающая задняя ось',
    'Digital Light', 'Ночное видение', 'Раздельные задние кресла', 'Экраны для задних пассажиров', 'Холодильник', 'Доводчики дверей', 'Мультиконтурные сиденья'].map(name => ({ name }));
  ok('27. ліміту кількості немає: 15 премиум-пунктів, 15 підсвічено', many.filter(o => EV.isHighValue(o)).length === 15 && !/slice\(0,\s*\d+\)[^;\n]*isHighValue|isHighValue[^;\n]*slice\(0/.test(page));

  /* ===== 4. докази і злиття джерел ===== */
  const CV = await import('./api/current-visual.js');
  const CM = await import('./api/canonical-merge.js');
  const MIE = await import('./api/mi-equipment.js');
  /* 21: доступне в каталозі MI без доказу про авто не зʼявляється і не стає підтвердженим */
  {
    const cand = [{ equipment_key: 'night_vision', name_en: 'Night Vision', aliases: [{ alias: 'night vision' }, { alias: 'ночное видение' }], value_tier: 'high_value', availability: 'optional' }];
    const items = [{ name: 'Круиз-контроль', confidence_level: 'listing_data' }];
    const r = MIE.applyMiEquipment(items, cand);
    ok('21. доступне в MI встановленим не стає', r.items.length === 1 && !r.items.some(x => /night|ночн/i.test(x.name)) && r.stats.confirmed === 0);
    const seller = MIE.applyMiEquipment([{ name: 'Ночное видение', confidence_level: 'seller' }], cand);
    ok('21a. лише слова продавця каталог не підтверджує', seller.items[0].mi && seller.items[0].mi.confirmed === false);
  }
  /* 23, 25: Vision-підтверджене показується; однакове з різних джерел один раз */
  const cvOf = list => ({ equipment_visual: list.map(([n, gi]) => ({ normalized_name: n, concept: CV.equipmentConcept(n), gallery_index: gi, sign: 'видно на кадрі', confidence: 'high' })) });
  {
    const items = [{ name: 'Камеры кругового обзора', confidence_level: 'seller', evidence: [{ source: 'seller_claim', ref: 'опис', sign: '360' }] }];
    const m = CM.mergeCanonicalEquipment(items, cvOf([['камери кругового огляду', 3], ['масаж сидінь', 5]]), 'ru');
    const surround = m.items.filter(x => CV.equipmentConcept(x.name) === 'surround_camera');
    ok('25. та сама річ від продавця і з фото: один пункт, рівень seller_and_visual', surround.length === 1 && surround[0].confidence_level === 'seller_and_visual' && surround[0].name === 'Камеры кругового обзора');
    const massage = m.items.find(x => x.name === 'Массаж сидений');
    ok('23. підтверджене фото показується мовою звіту', massage && massage.confidence_level === 'visual' && massage.evidence[0].ref === 'photo_6' && EV.isHighValue(massage));
  }
  /* 24: дані оголошення лишаються в комплектації */
  {
    const src = fs.readFileSync('api/check.js', 'utf8');
    ok('24. рівень listing_data є валідним доказом комплектації', /'listing_data'/.test(src.slice(src.indexOf('export function sanitizeEquipment'), src.indexOf('export function selectEquipmentClaims'))) && MIE.EXACT_LEVELS.has('listing_data'));
  }
  /* поняття Vision без словникової назви більше не губляться */
  for (const [n, key] of [['задні екрани для пасажирів', 'rear_entertainment'], ['окремі задні крісла з центральною консоллю', 'executive_rear'], ['Задние экраны для пассажиров', 'rear_entertainment'],
    ['Раздельные задние кресла', 'executive_rear'], ['Ассистент автоматической парковки', 'automatic_parking'], ['Климат для задних пассажиров', 'rear_climate'], ['Парковочные датчики', 'parking_sensors'],
    ['камера заднього виду з дисплеєм', 'rear_camera'], ['задній клімат', 'rear_climate']]) {
    ok('4a. поняття "' + n + '" -> ' + key, CV.equipmentConcept(n) === key, CV.equipmentConcept(n));
  }
  {
    const bad = [];
    for (const [k, l] of Object.entries(CM.CONCEPT_LABELS)) for (const lang of ['ua', 'ru', 'en']) if (CV.equipmentConcept(l[lang]) !== k) bad.push(k + '/' + lang);
    ok('4b. кожна назва поняття трьома мовами повертається до свого поняття (дедуплікація і гейт фото)', bad.length === 0, bad.join(', '));
  }

  /* ===== 5. Maybach: реальні дані Check (Vision 8 понять, продавець 1 пункт) ===== */
  {
    const vision = [['панорамне скління даху', 18], ['цифрова панель приладів', 14], ['задні екрани для пасажирів', 16], ['задній клімат', 16], ['контурне підсвічування салону', 17],
      ['електрорегулювання сидінь', 13], ['окремі задні крісла з центральною консоллю', 16], ['преміальна акустика', 15]];
    const cv = cvOf(vision);
    /* основний розбір мовою звіту; екрани і крісла він назвав по-російськи */
    const main = [
      { name: 'Защитная пленка кузова', confidence_level: 'seller', evidence: [{ source: 'seller_claim', ref: 'seller_description', sign: 'В бронеплівці' }] },
      { name: 'Задние экраны для пассажиров', confidence_level: 'visual', evidence: [{ source: 'current_photos', ref: 'photo_17', sign: 'екрани у спинках' }] },
      { name: 'Раздельные задние кресла', confidence_level: 'visual', evidence: [{ source: 'current_photos', ref: 'photo_17', sign: 'два окремі крісла' }] },
    ];
    const concepts = [...new Set(cv.equipment_visual.map(e => e.concept))];
    ok('26a. усі 8 понять Vision мають словникову назву', concepts.every(c => CM.CONCEPT_LABELS[c]), concepts.filter(c => !CM.CONCEPT_LABELS[c]).join(', '));
    const gated = CV.applyCurrentVisualEquipmentGate(main, concepts);
    ok('26b. гейт фото не знімає доказ з екранів і крісел, названих мовою звіту', gated.dropped === 0);
    const merged = CM.mergeCanonicalEquipment(gated.items, cv, 'ru');
    const names = merged.items.map(x => x.name);
    ok('26c. у картці 9 пунктів: 8 з фото без дублікатів і плівка від продавця', merged.items.length === 9 && merged.stats.unlabelled === 0 && merged.stats.matched === 2 && merged.stats.inserted === 6, names.join(' | '));
    const premium = merged.items.filter(o => EV.isHighValue(o)).map(o => o.name);
    ok('26d. премиум: екрани і окремі задні крісла; акустика без читабельного бренду ні', premium.length === 2 && premium.includes('Задние экраны для пассажиров') && premium.includes('Раздельные задние кресла'), premium.join(' | '));
    ok('28. нічого не вигадано: лише те, що дали фото і продавець', merged.items.every(x => (x.evidence || []).length > 0) && !names.some(n => /burmester|hud|проекц|ночн|масаж|массаж|вентиляц/i.test(n)));
  }

  /* ===== 6. нових мережевих викликів немає ===== */
  {
    const ev = fs.readFileSync('equipment-value.js', 'utf8');
    ok('29. класифікація локальна: без мережі', !/fetch\(|XMLHttpRequest|import\(|require\(/.test(ev));
    for (const f of ['api/current-visual.js', 'api/canonical-merge.js']) {
      const src = fs.readFileSync(f, 'utf8');
      ok('29a. ' + f + ' без нових викликів мережі', (src.match(/fetch\(/g) || []).length === 0);
    }
  }

  if (errs.length) {
    console.error('premiumtest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('premiumtest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('premiumtest CRASHED:', e.stack || e.message); process.exit(1); });
