/* Check: захист від повторного аналізу тієї самої машини.
   Функціональні перевірки на мок-SB (пошук за нормалізованим URL і за VIN)
   плюс сторожі: нормалізація одна на кодову базу, "перевірити заново" реально
   запускає новий аналіз, новий звіт це нова запис, стара не перезаписується. */
const fs = require('fs');

const errs = [];
const page = fs.readFileSync('check.html', 'utf8');
const api = fs.readFileSync('api/check.js', 'utf8');

/* 1. нормалізація: копія в check.html посимвольно рівна api/check.js */
const grab = (src, name) => {
  const m = src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n\\}'));
  return m && m[0];
};
const normApi = grab(api, 'normalizeListingUrl');
const normPage = grab(page, 'normalizeListingUrl');
if (!normApi || !normPage) errs.push('normalizeListingUrl не знайдена в одному з файлів');
else if (normApi !== normPage) errs.push('normalizeListingUrl розійшлася між check.html і api/check.js');

/* 2. функціональні перевірки findExistingCheck на мок-SB */
const findFn = grab(page, 'findExistingCheck');
if (!findFn) errs.push('findExistingCheck не знайдена в check.html');

const makeSB = rows => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }) }) }),
});
/* без знайдених функцій гарнес не збирається: іменовані помилки вже в errs */
const harness = (normPage && findFn)
  ? new Function('SB', 'url', normPage + '\n' + findFn + '\nreturn findExistingCheck(url);')
  : async () => null;

const REPORTS = [
  { id: 'r1', public_id: 'AB2345', created_at: '2026-08-20T10:00:00Z', url: 'https://auto.ria.com/uk/auto_bmw_123.html?utm_source=fb&fbclid=zzz', vin: 'WBA7E2C55KG123456' },
  { id: 'r2', public_id: null, created_at: '2026-07-01T10:00:00Z', url: 'https://mobile.de/car/777?page=2', vin: 'WAUZZZ4M0JD010203' },
];

(async () => {
  /* збіг за URL: трекінгові параметри і hash не заважають */
  let hit = await harness(makeSB(REPORTS), 'https://auto.ria.com/uk/auto_bmw_123.html#photos');
  if (!hit || hit.id !== 'r1') errs.push('збіг за нормалізованим URL не спрацював');
  /* значущий query НЕ зрізається: інша сторінка з іншим query це інше оголошення */
  hit = await harness(makeSB(REPORTS), 'https://mobile.de/car/777?page=3');
  if (hit) errs.push('різний значущий query помилково склеївся');
  hit = await harness(makeSB(REPORTS), 'https://mobile.de/car/777?page=2&utm_campaign=x');
  if (!hit || hit.id !== 'r2') errs.push('той самий query із трекінговим хвостом не зловився');
  /* збіг за VIN при РІЗНИХ URL: авто переїхало в нове оголошення */
  hit = await harness(makeSB(REPORTS), 'https://other-site.com/sale/WAUZZZ4M0JD010203-audi-q8');
  if (!hit || hit.id !== 'r2') errs.push('збіг за VIN при різних URL не спрацював');
  /* 17 цифро-літерних символів без літер чи без цифр це не VIN */
  hit = await harness(makeSB(REPORTS), 'https://x.com/12345678901234567-car');
  if (hit) errs.push('випадкові 17 цифр зловились як VIN');
  /* нічого схожого: null, аналіз піде */
  hit = await harness(makeSB(REPORTS), 'https://auto.ria.com/uk/auto_other_999.html');
  if (hit) errs.push('фальшивий збіг на чужому оголошенні');
  /* гість: перевірки нема, обходів теж */
  const guestSB = { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => { throw new Error('не мало викликатись'); } };
  hit = await harness(guestSB, 'https://auto.ria.com/uk/auto_bmw_123.html');
  if (hit !== null) errs.push('гість отримав перевірку повторів');

  /* 3. "перевірити заново" реально запускає новий аналіз */
  if (!page.includes("window.__forceReanalyze = true;")) errs.push('нема прапорця повторного аналізу');
  if (!/window\.__forceReanalyze = true;\s*\n\s*run\(\);/.test(page)) errs.push('"перевірити заново" не перезапускає run()');
  if (!/const force = window\.__forceReanalyze;\s*\n\s*window\.__forceReanalyze = false;/.test(page)) {
    errs.push('прапорець не одноразовий: наступний аналіз знову без перевірки');
  }

  /* 4. новий звіт = нова запис: збереження лише insert, update по reports нема */
  const save = page.split("fetch('/api/check'")[1] || '';
  if (!save.includes(".insert(")) errs.push('збереження звіту не через insert');
  if (/from\('reports'\)[\s\S]{0,120}?\.update\(/.test(page)) errs.push('у check.html зʼявився update по reports: старий звіт можна перезаписати');

  /* 5. нормалізація держ/історичного блоку RIA: реальні фрагменти сторінок */
  const grabFn = grab(api, 'extractHistoryFacts');
  if (!grabFn) errs.push('extractHistoryFacts не знайдена в api/check.js');
  else {
    const hf = new Function('text', grabFn + '\nreturn extractHistoryFacts(text);');
    /* фрагмент S550 (реєстр є, ДТП нема, 2 минулі продажі з пробігами) */
    const s550 = 'ДТП Немає офіційно зареєстрованих Страхові випадки в Україні Не виявлено '
      + 'Історія авто за VIN-кодом 25.08.26 Продається на AUTO.RIA Продавець вказав пробіг 153 тис. км 4-ий власник '
      + '26.09.24 Продавалось на AUTO.RIA Продавець вказав пробіг 144 тис. км 20.09.24 Продавалось на AUTO.RIA Продавець вказав пробіг 143 тис. км '
      + 'Перевірено AUTO.RIA за офіційними відкритими державними даними Mercedes-Benz S-Class 2008 Остання операція 03.10.2024 4 власники';
    const a = hf(s550);
    if (!a.registry_present) errs.push('S550: реєстр не розпізнаний');
    if (a.owners_count !== 4) errs.push('S550: власники ' + a.owners_count + ' замість 4');
    if (a.past_listings !== 2) errs.push('S550: минулі оголошення ' + a.past_listings + ' замість 2');
    if (a.past_mileage_points !== 2) errs.push('S550: точки пробігу ' + a.past_mileage_points + ' замість 2');
    if (a.accident_recorded) errs.push('S550: "Немає офіційно зареєстрованих" хибно розпізнане як ДТП');
    if (a.us_import_record || a.ria_auction_record) errs.push('S550: хибний сигнал США чи аукціону');
    /* фрагмент Tesla WP7V3G (ДТП зафіксоване, пригін, аукціонні дані площадки, реєстр порожній) */
    const tesla = 'Був у ДТП Пригнано з США Торг Обмін '
      + 'Перевірено AUTO.RIA за офіційними відкритими державними даними Відсутня інформація із офіційних відкритих даних '
      + 'останній зафіксований від 29.12.2025 джерело фіксації - архівні дані з офіційного аукціону ІААІ в США '
      + 'ДТП Зафіксовано ДТП • на території США в 2025 році із пошкодженням правої сторони кузова та зовнішнього інтерфейсу '
      + 'Історія авто за VIN-кодом 26.08.26 Продається на AUTO.RIA Продавець вказав пробіг 29 тис. км '
      + '03.02.26 Продавалось на AUTO.RIA Продавець вказав пробіг 29 тис. км 29.12.25 Зафіксовано пробіг 29 тис. км';
    const b = hf(tesla);
    if (b.registry_present) errs.push('Tesla: порожній реєстр розпізнаний як наявний');
    if (!b.accident_recorded) errs.push('Tesla: зафіксоване ДТП загублене');
    if (!b.accident_note || !b.accident_note.includes('правої сторони')) errs.push('Tesla: нотатка ДТП без зони: ' + b.accident_note);
    if (!b.us_import_record) errs.push('Tesla: позначка "Пригнано з США" загублена');
    if (!b.ria_auction_record) errs.push('Tesla: аукціонні дані площадки загублені');
    if (b.past_listings !== 1) errs.push('Tesla: минулі оголошення ' + b.past_listings);
    if (b.past_mileage_points !== 2) errs.push('Tesla: точки пробігу ' + b.past_mileage_points + ' замість 2');
    /* порожнеча не ламає */
    const c = hf('');
    if (c.registry_present || c.accident_recorded || c.past_listings) errs.push('порожній текст дає факти');
  }
  /* нормалізовані факти течуть в ОБИДВА місця: coverage і промпт */
  if (!api.includes('history_facts: l.history_facts')) errs.push('check.js: факти не йдуть у промпт');
  if (!api.includes('hf.registry_present === true')) errs.push('check.js: coverage не читає реєстр із фактів');
  if (!api.includes('identity_confirmed: nhtsaMeaningful || hf.registry_present')) errs.push('check.js: ідентичність залежить лише від NHTSA');
  if (!api.includes('hf.ria_auction_record === true')) errs.push('check.js: аукціонний запис площадки не рахується');

  /* 5. словники */
  for (const d of ['i18n/ru.js', 'i18n/en.js']) {
    const dict = fs.readFileSync(d, 'utf8');
    for (const k of ['Ти вже перевіряв це авто', 'перевірити заново']) {
      if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
    }
  }

  /* 6а0. рівномірна вибірка кадрів для Vision */
  {
    const pickFn = grab(api, 'pickEvenIndexes');
    if (!pickFn) errs.push('pickEvenIndexes не знайдена');
    else {
      const pick = new Function(pickFn + '\nreturn pickEvenIndexes;')();
      /* менше або рівно ліміту: всі кадри */
      if (JSON.stringify(pick(5, 24)) !== JSON.stringify([0, 1, 2, 3, 4])) errs.push('вибірка n<=k не бере всі');
      /* 40 кадрів: рівно 24, унікальні, від першого до останнього, монотонні */
      const p40 = pick(40, 24);
      if (p40.length !== 24) errs.push('вибірка 40->24 дала ' + p40.length);
      if (p40[0] !== 0 || p40[p40.length - 1] !== 39) errs.push('вибірка не покриває краї галереї');
      if (new Set(p40).size !== p40.length) errs.push('дублікати індексів');
      if (p40.some((v, i) => i > 0 && v <= p40[i - 1])) errs.push('вибірка не монотонна');
      /* не перші 24 підряд: хвіст галереї представлений */
      if (p40.every(v => v < 24)) errs.push('вибірка досі бере лише початок галереї');
      /* high-слоти рівномірні: 24->12 покриває початок і кінець набору */
      const h = pick(24, 12);
      if (h.length !== 12 || h[0] !== 0 || h[h.length - 1] !== 23) errs.push('high-слоти не рівномірні: ' + JSON.stringify(h));
    }
    if (api.includes('listing.photos.slice(0, 24)')) errs.push('лишився slice(0,24) для Vision');
    if (api.includes("i < 12 ? 'high'")) errs.push('high досі дістається першим 12 підряд');
    if (!api.includes('photo_selection: { total:')) errs.push('нема аудиту вибірки в _meta');
  }

  /* 6а00. розумна вибірка кадрів: різноманітність, покриття, fallback */
  {
    const dvFn = grab(api, 'pickDiverseFrames');
    if (!dvFn) errs.push('нема pickDiverseFrames');
    else {
      const dv = new Function(dvFn + '\nreturn pickDiverseFrames;')();
      /* 30 екстерʼєрних + по одному салонних: салон, багажник, задній ряд обовʼязково */
      const types = Array(30).fill('front').concat(['rear_seats', 'trunk', 'dashboard', 'center_console', 'doors', 'rear', 'side']);
      const r = dv(types, 24, 12);
      if (r.picked.length !== 24) errs.push('вибірка не 24: ' + r.picked.length);
      for (const [name, idx] of [['задній ряд', 30], ['багажник', 31], ['торпедо', 32], ['консоль', 33], ['двері', 34]]) {
        if (!r.picked.includes(idx)) errs.push('різноманітна вибірка загубила: ' + name);
      }
      /* однакові екстерʼєри не зʼїдають бюджет: front обмежений раундами */
      if (r.picked.filter(i => types[i] === 'front').length > 20) errs.push('однакові екстерʼєри зʼїли бюджет');
      /* high дістається салону, а не першим кадрам */
      if (!r.high.has(32) || !r.high.has(31)) errs.push('high не дістався торпедо/багажнику');
      if (r.high.size > 12) errs.push('high понад ліміт');
      /* менше ніж k: усі */
      const r2 = dv(['front', 'rear'], 24, 12);
      if (r2.picked.length !== 2) errs.push('малий набір не взятий цілком');
    }
    /* хендлер: <=24 всі без виклику, >24 селектор, fallback чесний */
    if (!api.includes('listing.photos.length <= 24')) errs.push('нема гілки <=24 без виклику');
    if (!api.includes("mode: 'even_fallback'")) errs.push('нема рівномірного fallback');
    if (!api.includes('gallery_coverage_complete: galleryCoverageComplete')) errs.push('нема прапорця покриття галереї в _meta');
    if (!api.includes('ЗАБОРОНЕНО стверджувати, що якась зона')) errs.push('нема заборони "не показано" при частковому покритті');
    if (api.includes('Це ПОВНИЙ набір фото цього авто')) errs.push('промпт бреше про повний набір безумовно');
    if (!api.includes('photos.slice(0, 120)')) errs.push('кап екстракції фото не піднятий');
    /* перейменування оцінки */
    const pgS = fs.readFileSync('result-check.html', 'utf8');
    if (!pgS.includes('Оцінка CalCar:')) errs.push('бейдж не перейменований в Оцінка CalCar');
    for (const d of ['i18n/ru.js', 'i18n/en.js']) {
      if (!fs.readFileSync(d, 'utf8').includes("'Оцінка CalCar:'")) errs.push('нема ключа "Оцінка CalCar:" у ' + d);
    }
  }

  /* 6а. комплектація v2: детерміновані функції, чотири рівні, верифікатор */
  {
    const sanFn = grab(api, 'sanitizeEquipment');
    const selFn = grab(api, 'selectEquipmentClaims');
    const appFn = grab(api, 'applyEquipmentVerifier');
    if (!sanFn || !selFn || !appFn) errs.push('функції комплектації не знайдені в api/check.js');
    else {
      const lib = new Function(sanFn + '\n' + selFn + '\n' + appFn + '\nreturn { sanitizeEquipment, selectEquipmentClaims, applyEquipmentVerifier };')();
      const ev = (source, ref, sign) => ({ source, ref, sign });
      const mk = o => Object.assign({ name: 'x', category: 'comfort', confidence_level: 'visual', highlight: false, retrofit: false, retrofit_basis: null, historical_claim: false, evidence: [] }, o);
      /* visual без кадру і ознаки: якщо є заява продавця, стає seller; без неї зникає */
      let r = lib.sanitizeEquipment([mk({ name: 'HUD', evidence: [] })]);
      if (r.length) errs.push('visual без evidence вижив');
      r = lib.sanitizeEquipment([mk({ name: 'HUD', evidence: [ev('seller_claim', null, 'проектор')] })]);
      if (r.length !== 1 || r[0].confidence_level !== 'seller') errs.push('visual без кадру із заявою не став seller: ' + JSON.stringify(r));
      /* seller_and_visual без візуального evidence: seller */
      r = lib.sanitizeEquipment([mk({ confidence_level: 'seller_and_visual', evidence: [ev('seller_claim', null, 'вказано')] })]);
      if (r.length !== 1 || r[0].confidence_level !== 'seller') errs.push('s_a_v без кадру не понижений до seller');
      /* повний visual виживає */
      r = lib.sanitizeEquipment([mk({ name: 'Панорамний дах', evidence: [ev('current_photos', 'photo_3', 'скло даху на кадрі згори')] })]);
      if (r.length !== 1 || r[0].confidence_level !== 'visual') errs.push('валідний visual не вижив');
      /* рівня "ймовірно" не існує */
      r = lib.sanitizeEquipment([mk({ confidence_level: 'probable', evidence: [ev('current_photos', 'photo_1', 'щось')] })]);
      if (r.length) errs.push('невідомий рівень не відкинутий');
      /* retrofit лише з підставою */
      r = lib.sanitizeEquipment([mk({ retrofit: true, evidence: [ev('current_photos', 'photo_1', 'фари')] })]);
      if (r[0].retrofit !== false) errs.push('retrofit без підстави не скинутий');
      r = lib.sanitizeEquipment([mk({ retrofit: true, retrofit_basis: 'продавець прямо вказав переобладнання', evidence: [ev('current_photos', 'photo_1', 'фари')] })]);
      if (r[0].retrofit !== true) errs.push('retrofit з підставою загублений');
      /* суто історична: зберігається без рівня */
      r = lib.sanitizeEquipment([mk({ confidence_level: null, historical_claim: true, evidence: [ev('historical', 'auction_2023', 'у картці лота')] })]);
      if (r.length !== 1 || r[0].confidence_level !== null) errs.push('historical_claim без рівня загублена');
      /* highlight максимум 8 */
      r = lib.sanitizeEquipment(Array.from({ length: 12 }, (_, i) => mk({ name: 'opt' + i, highlight: true, evidence: [ev('current_photos', 'photo_1', 'ознака')] })));
      if (r.filter(x => x.highlight).length !== 8) errs.push('highlight не обмежений вісьмома');
      /* відбір claims: лише важливі візуальні, максимум 6, brand перший */
      const many = [
        mk({ name: 'Килимки', evidence: [ev('current_photos', 'photo_1', 'килимки')] }),
        mk({ name: 'Harman Kardon аудіо', evidence: [ev('current_photos', 'photo_2', 'логотип на решітці')] }),
        mk({ name: 'Адаптивний круїз', evidence: [ev('current_photos', 'photo_3', 'важіль')] }),
        mk({ name: 'HUD проекція', evidence: [ev('current_photos', 'photo_4', 'лінза')] }),
        mk({ name: 'Пневмопідвіска', confidence_level: 'vehicle_data', evidence: [ev('vehicle_data', 'vin_decode', 'у декодуванні')] }),
      ];
      const claims = lib.selectEquipmentClaims(lib.sanitizeEquipment(many));
      if (claims.some(c => c.name === 'Килимки')) errs.push('неважлива знахідка потрапила у перевірку');
      if (claims.some(c => c.confidence_level === 'vehicle_data')) errs.push('vehicle_data потрапив у перевірку');
      if (claims[0].name !== 'Harman Kardon аудіо') errs.push('брендове аудіо не перше у перевірці');
      /* вердикти: s_a_v -> seller, visual -> геть, vehicle_data недоторканий */
      const items = lib.sanitizeEquipment([
        mk({ name: 'Burmester', confidence_level: 'seller_and_visual', evidence: [ev('seller_claim', null, 'бурмістер у описі'), ev('current_photos', 'photo_5', 'логотип')] }),
        mk({ name: 'HUD', evidence: [ev('current_photos', 'photo_6', 'лінза на торпедо')] }),
        mk({ name: 'Панорама', confidence_level: 'vehicle_data', evidence: [ev('vehicle_data', 'vin_decode', 'sunroof у декодуванні')] }),
      ]);
      const after = lib.applyEquipmentVerifier(items, [
        { name: 'Burmester', verdict: 'not_confirmed' },
        { name: 'HUD', verdict: 'not_confirmed' },
        { name: 'Панорама', verdict: 'not_confirmed' },
      ]);
      const burm = after.find(x => x.name === 'Burmester');
      if (!burm || burm.confidence_level !== 'seller') errs.push('s_a_v не пройшов, але не став seller');
      if (burm && burm.evidence.some(e => e.source === 'current_photos')) errs.push('візуальний evidence лишився після провалу');
      if (after.some(x => x.name === 'HUD')) errs.push('visual, що не пройшов, не видалений');
      const pan = after.find(x => x.name === 'Панорама');
      if (!pan || pan.confidence_level !== 'vehicle_data') errs.push('vehicle_data понижений перевіркою');
    }
    /* сторожі промпта і хендлера */
    if (!api.includes('ATTENTION MAP')) errs.push('check.js: нема attention map у промпті');
    if (!api.includes('дистронік це адаптивний круїз')) errs.push('check.js: нема нормалізації народних назв');
    if (!api.includes('КНОПКИ ДОКАЗУЮТЬ КНОПКИ')) errs.push('check.js: нема правила про органи керування');
    if (!api.includes('рівня "ймовірно" НЕ існує')) errs.push('check.js: нема заборони проміжного рівня');
    if (!api.includes('"equipment_v2":[{')) errs.push('check.js: схема без equipment_v2');
    /* semantic cleanup: софт-стани, не підсилювати понад доказ, без дублів шапки */
    if (!api.includes('софтверні і конфігураційні стани опціями не є')) errs.push('check.js: софт-стани не виключені з комплектації');
    if (!api.includes('НЕ ПІДСИЛЮЙ ВИСНОВОК ПОНАД ДОКАЗ')) errs.push('check.js: нема правила про підсилення висновку');
    if (!api.includes('в equipment_v2 не дублюй')) errs.push('check.js: базові характеристики шапки не виключені');
    if (!api.includes('elapsedEq > 190000')) errs.push('check.js: верифікатор без бюджету часу');
    if (!api.includes('.slice(0, 6)')) errs.push('check.js: claims не обмежені шістьома');
    if (!api.includes('equipment_verifier: eqVerifier')) errs.push('check.js: діагностика верифікатора не в _meta');
    /* сторінка: новий рендер + легасі фолбек */
    const page2 = fs.readFileSync('result-check.html', 'utf8');
    for (const el of ['equipment_v2', 'class="eq-chip"', "t('Підтверджено')", "t('Дані авто')", 'Встановлено пізніше / переобладнання', 'Підтверджено за VIN']) {
      if (!page2.includes(el)) errs.push('result-check.html: нема ' + el);
    }
    /* компактність: без повнорядкових опцій, retrofit не дублюється, опис продавця без кнопки */
    if (page2.includes('class="eq-row"')) errs.push('повнорядкові опції комплектації лишились');
    if (!page2.includes("!o.retrofit).sort(byNotable)")) errs.push('retrofit не виключений із source-груп');
    if (page2.includes('id="descBtn"') || page2.includes('id="sellerDesc"')) errs.push('кнопка опису продавця лишилась в UI');
    if (page2.includes('cursor:help')) errs.push('щит досі з cursor:help (курсор-знак питання)');
    if (page2.includes('background:var(--surface-2);font-size:12.5px;font-weight:600')) errs.push('sec-meta досі з сірою заливкою');
    for (const d of ['i18n/ru.js', 'i18n/en.js']) {
      const dict = fs.readFileSync(d, 'utf8');
      for (const k of ['Підтверджено', 'Дані авто', 'Встановлено пізніше / переобладнання']) {
        if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
      }
    }
  }

  /* 6. правки звіту Check: порядок блоків, identity, вердикт, історія, бейдж */
  {
    const page = fs.readFileSync('result-check.html', 'utf8');
    /* порядок: комплектація одразу під картку авто, перед вердиктом і ризиками */
    const iEq = page.indexOf('id="eqCard"'), iVd = page.indexOf('id="verdictCard"'), iRk = page.indexOf('id="risksCard"');
    if (!(iEq > -1 && iVd > -1 && iEq < iVd && iVd < iRk)) errs.push('порядок блоків: eqCard мусить стояти перед verdictCard і risksCard');
    /* identity-рядок і опис продавця */
    for (const el of ['id="titleChips"', 'class="copy-btn"']) {
      if (!page.includes(el)) errs.push('result-check.html: нема ' + el);
    }
    if (page.includes('id="carMeta"')) errs.push('старий carMeta лишився');
    /* UI polish: збалансована сітка, чіпи, без AI-плашки, toggle чату, tooltip */
    if (!page.includes('Math.ceil(spec.length / 2)')) errs.push('сітка характеристик не балансується');
    if (page.includes('AI-перевірка оголошення')) errs.push('плашка AI лишилась');
    if (page.includes('id="idLine"')) errs.push('нижній identity-рядок лишився');
    if (!page.includes('class="id-chip"')) errs.push('нема identity-чіпів біля назви');
    if (!page.includes("contains('open') ? close() : open()")) errs.push('чат не перемикається повторним кліком');
    if (!page.includes('id="scoreTip"') || !page.includes('Критичні ризики можуть сильніше впливати')) errs.push('нема premium tooltip щита');
    if (/score-shield[^>]*title=/.test(page)) errs.push('щит досі з browser-title');
    if (page.includes("t('після перевірок')")) errs.push('grade-бейдж біля оцінки лишився');
    if (page.includes('id="vHint"')) errs.push('рядок-підпис під оцінкою лишився');
    const metaCount = (page.match(/class="sec-meta"/g) || []).length;
    if (metaCount < 7) errs.push('sec-meta pill не скрізь: ' + metaCount);
    if (page.includes('class="hint" style="margin-left:auto"')) errs.push('старий сірий hint у шапках лишився');
    /* вердикт: плашки і списків нема, видима частина обмежена */
    if (page.includes('id="pdRec"') || page.includes('id="pdLists"')) errs.push('плашка або списки лишились у вердикті');
    if (!page.includes('450')) errs.push('нема ліміту видимої частини');
    if (!page.includes('questions_for_seller')) errs.push('питання продавцю зникли зі сторінки');
    if (!page.includes('id="qCard"')) errs.push('нема окремого блоку питань продавцю');
    /* історичний блок: глобальна назва, без failure-текстів і сирих URL */
    if (!page.includes('Історія пошкоджень і фото з минулого')) errs.push('нема нової назви історичного блоку');
    if (page.includes('Авто в США: до ремонту і зараз')) errs.push('стара назва блоку лишилась');
    if (page.includes('Фото з архіву не вдалося завантажити')) errs.push('failure-текст про фото лишився');
    if (!page.includes('au.found === true')) errs.push('блок історії не звіряється з found');
    if (!page.includes("M.auction_search.lot_url : null")) errs.push('кнопка джерела не обмежена verified-сторінкою');
    /* бейдж: колір строго за балом, щит із тултіпом */
    if (!page.includes("sc >= 7.5 ? 'ok' : sc >= 5.5 ? 'warn' : 'bad'")) errs.push('пороги кольору бейджа не 7.5/5.5');
    if (!page.includes('score-shield') || !page.includes('id="scoreTip"')) errs.push('нема щита CalCar з тултіпом');
    /* болячки: позначка про заявлене обслуговування */
    if (!page.includes('seller_serviced === true')) errs.push('нема позначки заявленого обслуговування');
  }
  /* 6а2. provenance, listing_data, value_tier, grounding помічника */
  {
    const sanFn2 = grab(api, 'sanitizeEquipment');
    const appFn2 = grab(api, 'applyEquipmentVerifier');
    if (sanFn2 && appFn2) {
      const lib2 = new Function(sanFn2 + '\n' + appFn2 + '\nreturn { sanitizeEquipment, applyEquipmentVerifier };')();
      const ev = (source, ref, sign) => ({ source, ref, sign });
      const mk = o => Object.assign({ name: 'x', category: 'comfort', confidence_level: null, highlight: false, retrofit: false, retrofit_basis: null, historical_claim: false, evidence: [] }, o);
      /* лише listing_data лишається listing_data, НЕ factory */
      let r = lib2.sanitizeEquipment([mk({ name: 'Камера 360', evidence: [ev('listing_data', 'опції площадки', 'Камера 360')] })], 'autoria');
      if (r.length !== 1 || r[0].confidence_level !== 'listing_data') errs.push('listing-only не listing_data: ' + JSON.stringify(r));
      if (r[0].factory_status !== 'unknown') errs.push('listing_data підняв factory_status');
      if (!r[0].provenance.length || r[0].provenance[0].type !== 'listing_data' || r[0].provenance[0].marketplace !== 'autoria') errs.push('provenance listing_data без marketplace');
      /* visual + listing = Підтверджено, НЕ vehicle_data; обидва provenance живуть */
      r = lib2.sanitizeEquipment([mk({ name: 'B&W', evidence: [ev('current_photos', 'photo_5', 'логотип на решітці'), ev('listing_data', 'опції площадки', 'акустика')] })], 'autoria');
      if (r[0].confidence_level !== 'seller_and_visual') errs.push('visual+listing не Підтверджено: ' + r[0].confidence_level);
      if (r[0].factory_status !== 'unknown') errs.push('visual+listing став factory');
      if (r[0].provenance.length !== 2) errs.push('multiple provenance загублені після dedupe');
      if (r[0].provenance.find(p => p.type === 'visual' && p.photo_id !== 'photo_5')) errs.push('visual provenance без photo_id');
      /* visual-only лишається visual + factory_status unknown */
      r = lib2.sanitizeEquipment([mk({ name: 'HUD', evidence: [ev('current_photos', 'photo_3', 'лінза')] })]);
      if (r[0].confidence_level !== 'visual' || r[0].factory_status !== 'unknown') errs.push('visual-only попсований');
      /* value_tier: невалідний = standard, не змінює рівень і provenance */
      r = lib2.sanitizeEquipment([mk({ name: 'A', value_tier: 'mega', evidence: [ev('current_photos', 'photo_1', 'a')] }), mk({ name: 'B', value_tier: 'high_value', evidence: [ev('seller_claim', null, 'b')] })]);
      if (r[0].value_tier !== 'standard') errs.push('невалідний value_tier не standard');
      if (r[1].value_tier !== 'high_value' || r[1].confidence_level !== 'seller') errs.push('value_tier змінив рівень/загубився');
      /* верифікатор: s_a_v(visual+listing) не пройшов -> listing_data, visual provenance геть */
      const items = lib2.sanitizeEquipment([mk({ name: 'Sound', evidence: [ev('current_photos', 'photo_2', 'решітка'), ev('listing_data', 'опції', 'аудіо')] })], 'autoria');
      const after = lib2.applyEquipmentVerifier(items, [{ name: 'Sound', verdict: 'not_confirmed' }]);
      if (!after.length || after[0].confidence_level !== 'listing_data') errs.push('провалений visual+listing не впав у listing_data');
      if (after[0].provenance.some(p => p.type === 'visual')) errs.push('visual provenance лишився після провалу');
    }
    /* retrofit: незвичність не доказ; назва не ширша за доказ; рамка помічника */
    if (!api.includes('ЗАБОРОНЕНО ставити retrofit лише тому')) errs.push('check.js: нема заборони retrofit за незвичністю');
    if (!api.includes('Заводські опціональні пакети існують (M Sport на BMW 530e')) errs.push('check.js: нема правила про заводські пакети');
    if (!api.includes('vehicle-specific доказом ПІЗНІШОЇ установки')) errs.push('check.js: retrofit без вимоги прямого доказу');
    if (api.includes('однозначна несумісність елемента із заводською конфігурацією')) errs.push('check.js: стара "несумісність" лишилась підставою retrofit');
    if (!api.includes('НАЗВА НЕ ШИРША ЗА ДОКАЗ')) errs.push('check.js: нема правила назви за доказом');
    if (!api.includes('НЕ "преміальна аудіосистема Bowers & Wilkins"')) errs.push('check.js: нема прикладу вузької назви B&W');
    {
      const chatApi2 = fs.readFileSync('api/chat.js', 'utf8');
      if (!chatApi2.includes('НЕ починай відповідь безумовним "так, система є"')) errs.push('chat.js: помічник підвищує visual до підтвердженої системи');
      if (!chatApi2.includes('це підробка чи лише накладки: цього ми теж не знаємо')) errs.push('chat.js: нема заборони на "підробку"');
    }
    /* explicit retrofit-доказ як і раніше допустимий (санітайзер) */
    {
      const sanFn3 = grab(api, 'sanitizeEquipment');
      const lib3 = new Function(sanFn3 + '\nreturn sanitizeEquipment;')();
      const it = lib3([{ name: 'Фаркоп', category: 'exterior', confidence_level: null, retrofit: true, retrofit_basis: 'продавець прямо вказав, що фаркоп встановлений минулого року', evidence: [{ source: 'seller_claim', ref: null, sign: 'встановив фаркоп' }] }]);
      if (!it.length || it[0].retrofit !== true) errs.push('явний retrofit-доказ продавця не пройшов');
      const it2 = lib3([{ name: 'Спойлер', category: 'exterior', confidence_level: null, retrofit: true, retrofit_basis: null, evidence: [{ source: 'current_photos', ref: 'photo_2', sign: 'спойлер' }] }]);
      if (it2[0].retrofit !== false) errs.push('retrofit без підстави не скинутий');
    }
    /* сторожі: адаптер, промпт, тексти, чат */
    if (!api.includes('listing_equipment: listingEquipment.slice(0, 60)')) errs.push('нема marketplace-адаптера');
    if (!api.includes('split(/\\s+•\\s+/)')) errs.push('адаптер не терпить подвійні пробіли сепаратора');
    if (!api.includes("if (/^\\d/.test(p)")) errs.push('адаптер не фільтрує числові значення');
    if (!api.includes('source listing_data: структуровані поля площадки')) errs.push('промпт без секції listing_data');
    if (!api.includes('НІКОЛИ не підвищує достовірність опцій')) errs.push('нема правила чесного wording');
    if (!api.includes('"value_tier":"standard|notable|high_value"')) errs.push('схема без value_tier');
    const chatApi = fs.readFileSync('api/chat.js', 'utf8');
    if (!chatApi.includes('пріоритет у provenance')) errs.push('chat.js: structured provenance не пріоритетний');
    if (!chatApi.includes('не посилайся на why_consider')) errs.push('chat.js: why_consider не виключений як доказ');
    const pg3 = fs.readFileSync('result-check.html', 'utf8');
    if (!pg3.includes("['listing_data', t('Дані оголошення')]")) errs.push('нема групи Дані оголошення');
    if (!pg3.includes('eq-star')) errs.push('нема зірки high_value');
    if (!pg3.includes("factory_status: o.factory_status")) errs.push('чат не отримує структуровану комплектацію');
    for (const d of ['i18n/ru.js', 'i18n/en.js']) {
      const dict = fs.readFileSync(d, 'utf8');
      for (const k of ['Дані оголошення', 'Цінна опція', 'Виявлена по фото', 'Вказана в оголошенні']) {
        if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
      }
    }
  }

  /* 6б. регресія історичних фото + historical_visual + timeline */
  {
    /* провенанс-виняток: usa_photos самої площадки проходять, generic ні */
    if (!api.includes("auction.from_ria && /riastatic\\.com\\/photos\\/auto\\/usa\\//.test(u)")) errs.push('check.js: usa_photos RIA не проходять провенанс (регресія 49c1b55)');
    if (!api.includes("auction_photos_provenance")) errs.push('check.js: нема провенансу фото в _meta');
    if (!api.includes('auction.photos_sent')) errs.push('check.js: промпт бреше про кількість переданих кадрів');
    /* historical_visual: схема, семантика, санітизація, порядок до decision */
    if (!api.includes('"historical_visual":')) errs.push('check.js: схема без historical_visual');
    if (!api.includes('НІКОЛИ не дорівнює "структура ціла"')) errs.push('check.js: нема семантики no_obvious_severe_signs');
    if (!api.includes('НЕ "SRS справна"')) errs.push('check.js: нема семантики no_deployment_visible');
    if (!api.includes('purchase_decision ЗОБОВʼЯЗАНИЙ враховувати historical_visual')) errs.push('check.js: decision не бачить historical_visual');
    const sanHv = grab(api, 'sanitizeHistoricalVisual');
    if (!sanHv) errs.push('нема sanitizeHistoricalVisual');
    else {
      const sh = new Function(sanHv + '\nreturn sanitizeHistoricalVisual;')();
      /* без переданих кадрів поле не існує */
      if (sh({ visible_severity: 'severe' }, 0) !== null) errs.push('historical_visual без кадрів вижив');
      /* невалідні enum падають в indeterminate, зайве ріжеться */
      const r = sh({ visible_damage_zones: ['капот', 7, '  бампер  '], visible_severity: 'huge', structural_visual_status: 'structure_ok', srs_visual_status: 'fine', summary: 'видно удар', evidence: [{ source: 'us_auction', ref: 'auction_photo_1', description: 'зімʼятий капот' }, { bad: 1 }] }, 3);
      if (r.visible_severity !== 'indeterminate' || r.structural_visual_status !== 'indeterminate' || r.srs_visual_status !== 'indeterminate') errs.push('невалідні enum не занулені: ' + JSON.stringify(r));
      if (r.visible_damage_zones.length !== 2 || r.evidence.length !== 1) errs.push('сміття у зонах/evidence не відсіяне');
      const ok = sh({ visible_damage_zones: ['капот'], visible_severity: 'moderate', structural_visual_status: 'no_obvious_severe_signs', srs_visual_status: 'not_visible', summary: 's', evidence: [] }, 2);
      if (ok.visible_severity !== 'moderate' || ok.structural_visual_status !== 'no_obvious_severe_signs') errs.push('валідний assessment попсований');
    }
    /* seller_text: structured JSON-LD пріоритет, маркери fallback */
    if (!api.includes("d['@type'] === 'Vehicle' && typeof d.description === 'string'")) errs.push('check.js: seller_text без JSON-LD межі');
    if (!api.includes("'Що перевірити перед покупкою'")) errs.push('check.js: fallback без стоп-маркера площадки');
    /* UI: поточний стан вище історії, connector завжди */
    const pg = fs.readFileSync('result-check.html', 'utf8');
    if (!(pg.indexOf('id="photoCard"') < pg.indexOf('id="usCard"'))) errs.push('блок поточних фото не вище історичного');
    if (!pg.includes("(i > 0 ? '<div class=\"hgap\">' + (h.gap ? esc(h.gap) : '') + '</div>' : '')")) errs.push('timeline connector залежить від підпису інтервалу');
  }

  /* 7. сервер: seller_text, діагностика, дисципліна ризиків, розділення сутностей */
  if (!api.includes('seller_text: listing.seller_text')) errs.push('check.js: seller_text не йде у _meta');
  if (!api.includes('history_photos_unavailable')) errs.push('check.js: нема структурованої діагностики фото');
  if (!api.includes('ДИСЦИПЛІНА РИЗИКІВ')) errs.push('check.js: нема правила дисципліни ризиків');
  if (!api.includes('РОЗДІЛЕННЯ СУТНОСТЕЙ')) errs.push('check.js: нема правила розділення сутностей');
  if (!api.includes('"seller_serviced": true')) errs.push('check.js: схема без seller_serviced');
  if (!api.includes('нейтральні історичні записи самі по собі цей блок НЕ створюють')) errs.push('check.js: нема гейта історичного блоку');
  if (!api.includes('КЛЮЧОВИХ РИЗИКІВ САМЕ ЦЬОГО ЕКЗЕМПЛЯРА')) errs.push('check.js: risks не обмежені екземпляром');
  if (!api.includes('Вік, пробіг і відома болячка моделі САМІ ПО СОБІ недостатні')) errs.push('check.js: болячки моделі не відсічені від risks');
  if (!api.includes('ані перевірку, ані питання продавцю')) errs.push('check.js: дисципліна не поширена на must_check і питання');
  if (!api.includes('технічну недоступність архіву чи фото НЕ згадуй НІДЕ')) errs.push('check.js: недоступність архіву ще згадується у звіті');
  /* 8. словники: нові рядки */
  for (const d of ['i18n/ru.js', 'i18n/en.js']) {
    const dict = fs.readFileSync(d, 'utf8');
    for (const k of ['Історія пошкоджень і фото з минулого', 'Копіювати', 'Скопійовано', 'Відкрити джерело', 'Фото з минулого', 'продавець заявляє, що вузол уже обслужений', 'Наша оцінка авто на основі даних, які вдалося перевірити.', 'Критичні ризики можуть сильніше впливати на підсумкову оцінку.', 'Що спитати до огляду']) {
      if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
    }
  }

  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('нормалізація одна · збіг за URL і за VIN · значущий query не клеїться · гість без перевірки · повтор свідомий, insert · правки звіту');
  console.log('CHECK DUP TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
