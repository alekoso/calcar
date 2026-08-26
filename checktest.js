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

  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('нормалізація одна · збіг за URL і за VIN · значущий query не клеїться · гість без перевірки · повтор свідомий, insert');
  console.log('CHECK DUP TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
