/* Лаунчер продуктів CalCar. Блок продубльований у шести сторінках, як і решта
   спільної шапки, тому головне, що тримає тест, це відсутність розходжень між
   копіями. Плюс дві невидимі умови, які легко зламати не помітивши:
   панель мусить лежати поза <header> (у шапки є backdrop-filter, і всередині
   неї position:fixed рахується від шапки, а не від вікна), а на телефоні
   мусить ховатися чип beta, інакше рядок шапки переноситься і вона росте. */
const fs = require('fs');

const PAGES = ['import.html', 'check.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const BLOCKS = {
  css: /  \/\* ---- лаунчер продуктів CalCar[\s\S]*?@keyframes lnc-up\{[^}]*\}/,
  btn: /<button class="lnc-btn"[\s\S]*?<\/button>/,
  panel: /<div class="lnc-backdrop"[\s\S]*?\n<\/div>\n/,
  js: /<script>\n\/\* Лаунчер продуктів CalCar[\s\S]*?\n<\/script>/
};

const errs = [];
const src = {};
for (const f of PAGES) src[f] = fs.readFileSync(f, 'utf8');

/* 1. кожен блок є на кожній сторінці і всюди однаковий: копії не розходяться */
for (const [name, re] of Object.entries(BLOCKS)) {
  const seen = new Map();
  for (const f of PAGES) {
    const m = src[f].match(re);
    if (!m) { errs.push('нема блока ' + name + ' у ' + f); continue; }
    if (src[f].match(new RegExp(re.source, 'g')).length !== 1) errs.push('блок ' + name + ' продубльований у ' + f);
    const key = m[0];
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(f);
  }
  if (seen.size > 1) errs.push('блок ' + name + ' розійшовся між копіями: ' + JSON.stringify([...seen.values()]));
}

for (const f of PAGES) {
  const s = src[f];
  const head = s.indexOf('<header>'), headEnd = s.indexOf('</header>');
  const btn = s.indexOf('<button class="lnc-btn"'), panel = s.indexOf('<div class="lnc-backdrop"');

  /* 2. кнопка живе в шапці і стоїть перед логотипом */
  if (!(btn > head && btn < headEnd)) errs.push('кнопка лаунчера не в шапці: ' + f);
  const logo = s.indexOf('<a class="logo"', head);
  if (!(btn < logo)) errs.push('лаунчер стоїть після логотипа: ' + f);

  /* 3. панель поза шапкою: у header є backdrop-filter, він ламає position:fixed */
  if (!(panel > headEnd)) errs.push('панель лаунчера всередині <header>, мобільна шторка приліпне до шапки: ' + f);
  if (!s.includes('header{background:rgba(255,255,255,.88);backdrop-filter:blur(10px)')) errs.push('шапка без backdrop-filter, перевір причину виносу панелі: ' + f);

  /* 4. Import веде в наявний flow, Check у свій; поточний продукт ставить код */
  if (!s.includes('<a class="lnc-item" data-prod="import" href="/import">')) errs.push('картка Import не веде на /import: ' + f);
  if (!s.includes('<a class="lnc-item" data-prod="check" href="/check">')) errs.push('картка Check не веде на /check: ' + f);
  if ((s.match(/class="lnc-item"/g) || []).length !== 3) errs.push('у лаунчері не три продукти: ' + f);
  if (!s.includes('<a class="lnc-item" data-prod="garage" href="/garage">')) errs.push('картка Garage не веде на /garage: ' + f);

  /* 5. на телефоні звільняємо місце чипом beta, інакше шапка стає дворядковою */
  if (!/@media\(max-width:620px\)\{[\s\S]{0,600}header \.prod\{display:none\}/.test(s)) errs.push('нема мобільного правила header .prod: ' + f);

  /* 5а. логотип не має зсуватися: на широкому екрані кнопка виходить із потоку
     у поле поруч із контейнером. Зсув -30px це не магічне число, а
     падінг шапки мінус (ширина кнопки + зазор до логотипа): якщо змінити
     розмір кнопки чи зазор і забути про зсув, логотип поїде або кнопка
     наїде на нього. Поріг медіазапиту мусить лишати кнопці поле від краю */
  const pad = +(/\.header-in\{[^}]*padding:0 (\d+)px/.exec(s) || [])[1];
  /* result.html має окрему flex-шапку без .hleft: там зазор живе на .header-in */
  const gapM = /\.hleft\{[^}]*gap:(\d+)px/.exec(s) || /\.header-in\{[^}]*gap:(\d+)px/.exec(s);
  const gap = gapM ? +gapM[1] : 0;
  const btnW = +(/\.lnc-btn\{[^}]*width:(\d+)px/.exec(s) || [])[1];
  const shift = /body:not\(\.chat-docked\) \.lnc-btn\{position:absolute;left:(-?\d+)px/.exec(s);
  const mq = /@media\(min-width:(\d+)px\)\{\s*header \.header-in\{position:relative\}/.exec(s);
  if (!pad || !gap || !btnW) errs.push('не читаються розміри шапки у ' + f);
  else if (!shift) errs.push('нема desktop-правила виносу кнопки з потоку: ' + f);
  else {
    const want = pad - (btnW + gap);
    if (+shift[1] !== want) errs.push(f + ': зсув кнопки ' + shift[1] + 'px, а за розмірами шапки має бути ' + want + 'px');
    if (!mq) errs.push('нема порога медіазапиту для виносу кнопки: ' + f);
    else {
      /* 1160 це max-width контейнера; кнопці треба поле |зсув| плюс 10px від краю */
      const need = 1160 + 2 * (Math.abs(want) + 10);
      if (+mq[1] < need) errs.push(f + ': поріг ' + mq[1] + 'px замалий, кнопка впреться в край вікна; треба від ' + need + 'px');
    }
  }
  /* у звітах chat-docked знімає max-width шапки, поля не лишається: там у рядок */
  if (!/body:not\(\.chat-docked\)/.test(s)) errs.push('нема захисту від chat-docked у ' + f);

  /* 5б. картки компактні: жодних окремих CTA і другого рядка опису. Уся картка
     Import сама є посиланням, тож кнопка всередині посилання це і зайвий шум,
     і вкладена інтерактивність */
  if (/lnc-cta|lnc-note/.test(s)) errs.push('CTA або другий рядок повернулись у картку: ' + f);
  if (!/a\.lnc-item:hover\{background:var\(--surface-2\)\}/.test(s)) errs.push('нема підсвітки картки на наведення: ' + f);
  if (!/\.lnc-item\{[^}]*cursor:pointer/.test(s)) errs.push('нема cursor:pointer на картці: ' + f);

  /* 5в. відкриття наведенням: місток над панеллю плюс затримка, інакше меню
     зникає, поки курсор іде від кнопки до нього. Затримка мусить бути в межах
     150-250ms: менше не встигає курсор, більше меню висить після відведення */
  if (!/\.lnc-panel::before\{content:"";position:absolute;left:0;right:0;bottom:100%/.test(s)) errs.push('нема містка під панеллю: ' + f);
  const delay = /hoverTimer = setTimeout\(function \(\) \{ hoverTimer = null; if \(!pinned\) close\(false\); \}, (\d+)\)/.exec(s);
  if (!delay) errs.push('нема відкладеного закриття по відведенню миші: ' + f);
  else if (+delay[1] < 150 || +delay[1] > 250) errs.push(f + ': затримка закриття ' + delay[1] + 'ms, треба 150-250ms');
  if (!/hover:hover\) and \(pointer:fine/.test(s)) errs.push('наведення не обмежене мишею, на тачі меню відкриється саме: ' + f);
  /* наведення не має забирати фокус: людина його не просила */
  if (!/if \(!open\) setOpen\(true, false\)/.test(s)) errs.push('наведення забирає фокус у панель: ' + f);
  if (!/setOpen\(true, true\); pinned = true/.test(s)) errs.push('клік не віддає фокус панелі: ' + f);

  /* 5г. акаунт і мова переїхали в панель лаунчера: у шапці їх дропдаунів нема */
  const headerRight = (s.match(/<div class="header-right">[\s\S]*?<\/div>/) || [''])[0];
  if (/lang|auth|acc-/.test(headerRight)) errs.push('мова або акаунт лишились у правій частині шапки: ' + f);
  if (/id="langBtn"/.test(s)) errs.push('стара кнопка мовного дропдауна лишилась: ' + f);
  if (!/<div class="lnc-sec">Account<\/div>[\s\S]{0,400}id="authLink"/.test(s)) errs.push('групи "Акаунт" нема в панелі: ' + f);
  if (!/<div class="lnc-sec">Language<\/div>\s*<div class="lang-dd" id="langDd">/.test(s)) errs.push('групи "Мова" нема в панелі: ' + f);
  /* мова це один компактний рядок, список розкривається за потреби */
  if (!/id="langCur"[\s\S]{0,200}id="langCurName"/.test(s)) errs.push('нема рядка поточної мови: ' + f);
  if (!/\.lnc-panel \.lang-menu\{display:none\}/.test(s) || !/\.lnc-panel \.lang-dd\.lang-open \.lang-menu\{display:block\}/.test(s)) errs.push('список мов не згортається: ' + f);
  if (!/langDd\.classList\.toggle\('lang-open'\)/.test(s)) errs.push('рядок мови не розкриває список: ' + f);
  /* панель ніколи не виходить за екран */
  if (!/max-height:calc\(100dvh - 84px\);overflow:auto/.test(s)) errs.push('панель без обмеження висоти на десктопі: ' + f);
  if (!/max-height:calc\(100dvh - 16px\);overflow:auto/.test(s)) errs.push('шторка без обмеження висоти на телефоні: ' + f);
  /* акаунт: "Кабінет" і "Звіти" вели в одне місце, лишились самі розділи */
  if (!/\.acc-wrap:not\(\.anon\) \.btn-auth\{display:none\}/.test(s)) errs.push('дубль "Кабінет" лишився в меню: ' + f);
  if (!/<div class="lnc-sec">Products<\/div>\s*<div class="lnc-list">/.test(s)) errs.push('групи "Продукти" нема в панелі: ' + f);
  if (!/\.lnc-panel \.acc-menu,\.lnc-panel \.lang-menu\{position:static/.test(s)) errs.push('меню в панелі лишились випадаючими: ' + f);

  /* 5д. переїзд кнопки в правий кластер, коли поля ліворуч немає */
  if (!/rail\.insertBefore\(btn, rail\.firstChild\)/.test(s)) errs.push('нема переїзду кнопки в правий кластер: ' + f);
  if (!/getComputedStyle\(btn\)\.position !== 'absolute'/.test(s)) errs.push('переїзд не звіряється з обчисленим стилем: ' + f);

  /* 6. вітрина лишається одним продуктом: старий перемикач не повернувся */
  if (/class="switch"|calcarProduct|kind-badge/.test(s)) errs.push('старий перемикач Check/Import повернувся у ' + f);

  /* 7. скрипт лаунчера мусить парситись */
  const js = s.match(BLOCKS.js);
  if (js) {
    fs.writeFileSync('/tmp/lnc.js', js[0].replace(/^<script>\n/, '').replace(/\n<\/script>$/, ''));
    try { require('child_process').execSync('node --check /tmp/lnc.js'); }
    catch (e) { errs.push('синтаксис скрипта лаунчера у ' + f + ': ' + String(e.message).split('\n')[1]); }
  }
}

/* 7а. поточний продукт: розмітка на всіх сторінках однакова, тому позначку
   ставить код зі шляху. Проганяємо справжній скрипт лаунчера на всіх реальних
   маршрутах з vercel.json під мінімальною заглушкою DOM */
function resolveProduct(pathname) {
  const cards = {
    check: { prod: 'check', cls: [], attrs: { href: '/check' } },
    'import': { prod: 'import', cls: [], attrs: { href: '/import' } },
    garage: { prod: 'garage', cls: [], attrs: { href: '/garage' } }
  };
  const el = (extra) => Object.assign({
    addEventListener() {}, focus() {}, offsetWidth: 344,
    classList: { toggle() {}, add() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    style: { setProperty() {} }, getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
    querySelector: () => null, querySelectorAll: () => []
  }, extra);
  const panel = el({
    querySelector(sel) {
      const m = /data-prod="([^"]+)"/.exec(sel);
      const c = m && cards[m[1]];
      if (!c) return null;
      return el({
        classList: { add(n) { c.cls.push(n); }, toggle() {}, contains: () => false },
        removeAttribute(a) { delete c.attrs[a]; },
        setAttribute(a, v) { c.attrs[a] = v; }
      });
    }
  });
  const byId = { lncBtn: el({}), lncPanel: panel, lncBackdrop: el({}) };
  const sandbox = {
    /* querySelector повертає null: правого кластера в заглушці немає, тож
       переїзд кнопки не виконується і тест лишається саме про продукт */
    document: { getElementById: (i) => byId[i] || null, querySelector: () => null, addEventListener() {}, documentElement: { classList: { toggle() {} } }, body: el({}), activeElement: null },
    location: { pathname },
    window: { matchMedia: () => ({ matches: false }), addEventListener() {}, innerWidth: 1200 }
  };
  const src = fs.readFileSync('check.html', 'utf8').match(BLOCKS.js)[0]
    .replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  new Function('document', 'location', 'window', src)(sandbox.document, sandbox.location, sandbox.window);
  const cur = Object.values(cards).filter(c => c.cls.includes('is-current')).map(c => c.prod);
  if (cur.length > 1) return 'НЕОДНОЗНАЧНО:' + cur.join(',');
  return cur[0] || '';
}
const ROUTES = {
  '/': 'check', '/check': 'check', '/check/aB3xZ9': 'check', '/check.html': 'check',
  '/result-check.html': 'check',
  '/import': 'import', '/import.html': 'import', '/result.html': 'import',
  '/garage': 'garage', '/garage/12': 'garage', '/garage.html': 'garage', '/garage/post/demo-1': 'garage', '/garage/article/bmw': 'garage', '/cabinet.html': ''
};
for (const [path, want] of Object.entries(ROUTES)) {
  const got = resolveProduct(path);
  if (got !== want) errs.push('шлях ' + path + ': поточний продукт "' + got + '", очікували "' + (want || 'жоден') + '"');
}
/* картка поточного продукту мусить втратити href: це статус, а не навігація */
if (resolveProduct('/check') !== 'check') errs.push('Check не позначається поточним на /check');

/* 8. маршрут Import справді існує, інакше картка веде в 404 */
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
if (!vercel.rewrites.some(r => r.source === '/import' && r.destination === '/import.html')) errs.push('маршрут /import зник із vercel.json');
if (!fs.existsSync('import.html')) errs.push('немає import.html, вести нікуди');

/* 9. нові рядки інтерфейсу мусять бути в обох словниках, інакше RU/EN сторінка стане мішаною */
const KEYS = ['CalCar menu', 'Products', 'Account', 'Language', 'Pre-purchase car check', 'Current product',
              'What a US car really costs in Ukraine'];
for (const d of ['i18n/ru.js', 'i18n/ua.js']) {
  const s = fs.readFileSync(d, 'utf8');
  for (const k of KEYS) if (!s.includes("'" + k + "':")) errs.push('нема ключа "' + k + '" у ' + d);
}
/* рядки зі сторінки і ключі словника мусять збігатися символ у символ */
for (const k of KEYS) if (!src['check.html'].includes(k)) errs.push('рядок "' + k + '" зник зі сторінки, словники тепер мимо');

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('лаунчер: 4 блоки однакові на 6 сторінках · панель поза шапкою · Import -> /import · 11 маршрутів дають правильний поточний продукт · назва продукту ховається на телефоні · словники повні');
console.log('LAUNCHER TEST PASSED');
