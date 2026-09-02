/* Сторінка "Звіти" в кабінеті: каталог авто з двома вкладками продуктів.
   Тест тримає розділення за колонкою kind (не за назвою), джерела даних
   картки (фото, оцінка, підсумок з того, що звіт уже зберіг), поведінку
   трьох крапок, порожні стани з дорогою в продукт і словники. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const s = fs.readFileSync('cabinet.html', 'utf8');
const body = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

/* 1. вкладки: точні назви продуктів, Check перша і активна за замовчуванням */
if (!/<button class="rtab on"[^>]*data-kind="check"[^>]*>Vehicle Checks /.test(s)) errs.push('перша вкладка не "Vehicle Checks" або не активна');
if (!/<button class="rtab"[^>]*data-kind="import"[^>]*>Car Import /.test(s)) errs.push('друга вкладка не "Car Import"');
if (/Import from (the )?US|Vehicle Check<|>Check</.test(body)) errs.push('назва вкладки з забороненого списку');
if (!/let kind = 'check';/.test(s)) errs.push('вкладка за замовчуванням не Check');
if (/localStorage\.(get|set)Item\('calcar_reports_tab'/.test(s)) errs.push('вкладка запамʼятовується у localStorage: домовлялись лише про сесію');

/* 2. розділення продуктів: лише за kind, нічого не вгадується з назви */
if (!/rows\.filter\(r => \(r\.kind \|\| 'import'\) === kind\)/.test(s)) errs.push('список не фільтрується за kind із фолбеком import для старих рядків');
if (/kind\s*=\s*\/(BMW|Copart|lot)/i.test(s)) errs.push('kind визначається з назви');

/* 3. джерела даних картки: те, що звіт уже зберіг, без нових запитів */
for (const [what, re] of [
  ['перший кадр галереї', /photo:data->_meta->photos->>0/],
  ['канонічна оцінка', /score:data->score_breakdown->>final/],
  ['поріг даних оцінки', /score_avail:data->score_breakdown->>score_available/],
  ['легасі-оцінка', /legacy:data->verdict->>score/],
  ['підсумок під ключ зі знімка', /grand:data->_snapshot->>grand/],
  ['назва авто', /vtitle:data->vehicle->>title/],
  ['номер лота для пошуку', /lot:data->_meta->>lot_number/],
]) if (!re.test(s)) errs.push('у запиті нема: ' + what);
if (/fetch\(['"]\/api\//.test(s.slice(s.indexOf("const box = document.getElementById('reports')")))) errs.push('список звітів ходить в API');

/* 4. картка: без стрілки, VIN і пробігу на екрані; фото або заглушка; три крапки окремо */
if (/class="go"/.test(s) || /\.report \.go/.test(s)) errs.push('стрілка → повернулась');
if (/rc-vin|vin-sub/.test(s)) errs.push('VIN показується в картці');
if (!/PLACEHOLDER = '<svg/.test(s) || !/isHttp\(r\.photo\) \? '<img/.test(s)) errs.push('нема заглушки фото або фото без перевірки URL');
if (!/img\.addEventListener\('error'/.test(s)) errs.push('битий кадр не замінюється заглушкою');
if (!/if \(ev\.target\.closest\('\.kebab, \.menu'\)\) return; open\(\);/.test(s)) errs.push('клік по трьох крапках відкриває звіт');
if (!/kebab\.addEventListener\('click', ev => \{\s*ev\.stopPropagation\(\);/.test(s)) errs.push('три крапки не зупиняють спливання');
if (!/menu\.querySelector\('\.del'\)[\s\S]{0,300}from\('reports'\)\.delete\(\)\.eq\('id', el\.dataset\.id\)/.test(s)) errs.push('видалення зі старого меню зникло');
if (!/\.kebab\{[^}]*width:36px;height:36px/.test(s)) errs.push('у трьох крапок нема touch-target 36px');

/* 5. сітка: 2 колонки, на телефоні 1, без 4-5 колонок на широких */
if (!/\.rgrid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(s)) errs.push('сітка не з двох колонок');
if (!/@media\(max-width:760px\)\{\s*\.rgrid\{grid-template-columns:1fr\}/.test(s)) errs.push('на телефоні не одна колонка');
if (/repeat\(auto-fill|repeat\(auto-fit|repeat\([345]/.test(s.slice(s.indexOf('.rgrid{')))) errs.push('сітка розповзається на широких екранах');

/* 6. порожні стани ведуть у свій продукт, пошук залежить від вкладки */
if (!/check: \{ empty: 'No checks yet'[^}]*href: '\/check', search: 'Search by model or VIN'/.test(s)) errs.push('порожній стан Check або підказка пошуку не ті');
if (!/'import': \{ empty: 'No estimates yet'[^}]*href: '\/import', search: 'Search by model, VIN or lot number'/.test(s)) errs.push('порожній стан Import або підказка пошуку не ті');
if (!/sInput\.placeholder = t\(TABS\[kind\]\.search\)/.test(s)) errs.push('підказка пошуку не міняється з вкладкою');

/* 7. хелпери картки: справжній код, під заглушкою t()/calcarLocale */
const a = s.indexOf(' const esc = x =>'), b = s.indexOf(" const isHttp = u => /^https?:\\/\\//i.test(String(u || ''));");
if (a < 0 || b < 0) errs.push('не знайдено блок хелперів картки');
else {
  const ctx = { t: x => x, calcarLocale: () => 'en-US', Date, Number, String, Math, isNaN };
  vm.createContext(ctx);
  /* const у vm не стає властивістю контексту, тому хелпери віддаються виразом у кінці */
  const { scoreOf, scoreCls, nameOf, hrefOf, when, isHttp } = vm.runInContext(
    s.slice(a, b) + "\n const isHttp = u => /^https?:\\/\\//i.test(String(u || ''));\n({ scoreOf, scoreCls, nameOf, hrefOf, when, isHttp })", ctx);
  if (scoreOf({ score: '8.1', legacy: '3' }) !== 8.1) errs.push('канонічна оцінка не має пріоритету');
  if (scoreOf({ score: null, score_v2: null, preview: null, legacy: '7.3' }) !== 7.3) errs.push('легасі-оцінка не підхоплюється');
  if (scoreOf({ score: '8', score_avail: 'false' }) !== null) errs.push('нижче порога даних оцінка мусить бути відсутня');
  if (scoreOf({}) !== null) errs.push('без оцінки має бути null, а не 0');
  if (scoreOf({ score: '12' }) !== 10) errs.push('оцінка не обмежена 0..10');
  if (scoreCls(7.5) !== 'ok' || scoreCls(7.4) !== 'warn' || scoreCls(5.4) !== 'bad') errs.push('пороги кольору не як у звіті (7.5/5.5)');
  if (nameOf({ title: 'BMW X5 2021 · lot 45123456', kind: 'import' }) !== 'BMW X5 2021') errs.push('номер лота не прибирається з назви');
  if (nameOf({ vtitle: 'Audi Q5', title: 'x · lot 1' }) !== 'Audi Q5') errs.push('vehicle.title не має пріоритету');
  if (nameOf({ kind: 'check' }) !== 'Check' || nameOf({ kind: 'import' }) !== 'Estimate') errs.push('фолбек назви не за продуктом');
  if (hrefOf({ kind: 'check', public_id: 'ABC', id: '1' }) !== '/check/ABC') errs.push('коротка адреса Check не використана');
  if (hrefOf({ kind: 'check', id: '1' }) !== '/result-check.html?id=1') errs.push('фолбек адреси Check без public_id');
  if (hrefOf({ kind: 'import', id: '2' }) !== '/result.html?id=2') errs.push('адреса Import неправильна');
  const now = new Date();
  if (!/^Today, /.test(when(now.toISOString()))) errs.push('сьогоднішня дата не "Today, час": ' + when(now.toISOString()));
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (!/^Yesterday, /.test(when(y.toISOString()))) errs.push('вчорашня дата не "Yesterday, час"');
  const old = new Date(now.getFullYear() - 1, 0, 15, 12, 0);
  if (/:\d\d/.test(when(old.toISOString())) || !new RegExp(String(now.getFullYear() - 1)).test(when(old.toISOString()))) errs.push('минулий рік має бути з роком і без часу: ' + when(old.toISOString()));
  if (isHttp('data:image/png;base64,x') || !isHttp('https://a/b.jpg')) errs.push('перевірка URL фото неправильна');
}

/* 8. словники: нові рядки в UA і RU */
for (const d of ['i18n/ua.js', 'i18n/ru.js']) {
  const dict = fs.readFileSync(d, 'utf8');
  for (const k of ['Vehicle Checks', 'Car Import', 'Search by model or VIN', 'Search by model, VIN or lot number', 'Today', 'No checks yet', 'No estimates yet', 'Check a car', 'Calculate a lot'])
    if (!dict.includes("'" + k + "':")) errs.push('нема ключа "' + k + '" у ' + d);
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('звіти: вкладки за kind · картка з фото/оцінкою/підсумком зі збереженого · три крапки окремо · 2 колонки, на телефоні 1 · порожні стани в продукт · хелпери під тестом');
console.log('REPORTS TEST PASSED');
