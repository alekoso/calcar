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
/* картка відкривається справжнім посиланням, не JS: правий клік, середня
   кнопка, Cmd/Ctrl+клік і копіювання адреси працюють як у браузері */
if (!/<a class="rt" href="' \+ esc\(hrefOf\(r\)\) \+ '"><\/a>/.test(s)) errs.push('заголовок картки не справжнє посилання на канонічну адресу звіту');
if (/data-href=|role="link"|location\.href = el\.dataset/.test(s)) errs.push('картка знову відкривається через JS замість посилання');
if (!/\.rcard \.rt::after\{content:'';position:absolute;inset:0/.test(s) || !/\.rcard \.kebab\{position:relative;z-index:2\}/.test(s)) errs.push('посилання не розтягнуте на картку або три крапки під ним');
/* рамка лише для клавіатури (:focus-visible): клік мишею, правий клік і
   середня кнопка картку не обводять; загального outline:none немає */
if (!/\.rcard:has\(\.rt:focus-visible\)\{outline:2px solid var\(--ink\);outline-offset:2px\}/.test(s)) errs.push('клавіатурний фокус на картці не видно');
if (/\.rcard:focus-within\{outline/.test(s) || /\.rcard \.rt\{[^}]*outline:none/.test(s)) errs.push('рамка картки на будь-який фокус або сліпе outline:none на посиланні');
if (!/\.rcard \.rt:focus\{outline:none\}/.test(s)) errs.push('рамка браузера на посиланні при кліку мишею не прибрана');
if (/outline:\s*none\s*!important|\*:focus\{outline:none/.test(s)) errs.push('outline вимкнено глобально');
if (!/\.kebab:hover/.test(s) || !/kebab\.addEventListener\('click', ev => \{\s*ev\.stopPropagation\(\);/.test(s)) errs.push('три крапки не зупиняють спливання');
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

/* 7б. прокрутка списку при поверненні по історії: стан запису історії,
   відновлення лише по history-навігації і лише коли картки вже є */
{
  const i = s.indexOf(' function reportsScrollSave(ev) {'), j = s.indexOf(' async function showList() {');
  if (i < 0 || j < i) errs.push('нема функцій збереження/відновлення прокрутки');
  else {
    if (!/history\.scrollRestoration = 'manual'/.test(s)) errs.push('браузерне відновлення прокрутки не вимкнене: воно спрацьовує до появи карток');
    if (!/ render\(\);\n \/\*[^\n]*\n reportsScrollRestore\(box\);\n box\.addEventListener\('click', reportsScrollSave\);/.test(s)) errs.push('відновлення не після першого рендера списку або збереження не на кліку по картці');
    const mk = (over = {}) => {
      const st = { state: null, replaced: 0, scrolled: null, navType: over.navType || 'back_forward', cards: over.cards !== false };
      const ctx = {
        history: { get state() { return st.state; }, replaceState(v) { st.state = v; st.replaced++; } },
        window: { scrollY: over.scrollY || 0 }, performance: { getEntriesByType: () => [{ type: st.navType }] },
        scrollTo: (x, y) => { st.scrolled = y; },
      };
      ctx.window.scrollTo = ctx.scrollTo;
      vm.createContext(ctx);
      vm.runInContext(s.slice(i, j) + '\n this.save = reportsScrollSave; this.restore = reportsScrollRestore;', ctx);
      return { st, ctx, box: { querySelector: sel => (st.cards ? {} : null) } };
    };
    const a = { closest: sel => (sel === 'a.rt' ? {} : null) };
    const click = over => Object.assign({ target: a, button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, over);
    /* звичайний клік по картці: позиція у стан запису історії */
    let r = mk({ scrollY: 840 });
    r.ctx.save(click());
    if (r.st.replaced !== 1 || !r.st.state || r.st.state.reportsScroll !== 840) errs.push('звичайний клік не записує прокрутку в history.state');
    /* клік зі змінювачами, середня кнопка, не по картці: нічого не пишеться і не перехоплюється */
    for (const [name, ev] of [['Cmd+клік', click({ metaKey: true })], ['Ctrl+клік', click({ ctrlKey: true })], ['Shift+клік', click({ shiftKey: true })], ['середня кнопка', click({ button: 1 })], ['не по картці', click({ target: { closest: () => null } })]]) {
      r = mk({ scrollY: 500 }); r.ctx.save(ev);
      if (r.st.replaced !== 0) errs.push(name + ' записує прокрутку (новий таб зсунув би цю вкладку)');
    }
    if (/preventDefault\(\)/.test(s.slice(i, j))) errs.push('збереження прокрутки перехоплює перехід по посиланню');
    /* повернення по історії з картками: прокрутка відновлюється */
    r = mk(); r.st.state = { reportsScroll: 840 }; r.ctx.restore(r.box);
    if (r.st.scrolled !== 840) errs.push('повернення назад не відновлює прокрутку');
    /* картки ще не відрендерені: не прокручуємо в порожнечу */
    r = mk({ cards: false }); r.st.state = { reportsScroll: 840 }; r.ctx.restore(r.box);
    if (r.st.scrolled !== null) errs.push('прокрутка відновлюється до появи карток');
    /* свіжий візит: стану немає, починаємо звичайно */
    r = mk({ navType: 'navigate' }); r.ctx.restore(r.box);
    if (r.st.scrolled !== null) errs.push('свіжий візит прокручує список');
    /* звичайний перехід на Звіти з чужим станом не відновлює */
    r = mk({ navType: 'navigate' }); r.st.state = { reportsScroll: 840 }; r.ctx.restore(r.box);
    if (r.st.scrolled !== null) errs.push('не history-навігація відновлює прокрутку');
    if (/localStorage[^\n]*[Ss]croll/.test(s)) errs.push('прокрутка списку зберігається у localStorage');
  }
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
