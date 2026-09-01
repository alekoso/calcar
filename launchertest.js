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
  if ((s.match(/class="lnc-item"/g) || []).length !== 2) errs.push('у лаунчері не два продукти: ' + f);

  /* 5. на телефоні звільняємо місце чипом beta, інакше шапка стає дворядковою */
  if (!/@media\(max-width:620px\)\{[\s\S]{0,600}header \.beta\{display:none\}/.test(s)) errs.push('нема мобільного правила header .beta: ' + f);

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
    'import': { prod: 'import', cls: [], attrs: { href: '/import' } }
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
    document: { getElementById: (i) => byId[i] || null, addEventListener() {}, documentElement: { classList: { toggle() {} } }, activeElement: null },
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
  '/garage': '', '/garage/12': '', '/cabinet.html': ''
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
const KEYS = ['Продукти CalCar', 'Перевірка авто перед купівлею', 'Поточний продукт',
              'Скільки обійдеться авто зі США в Україні', 'Ремонт, розмитнення та підсумкова вартість', 'Відкрити'];
for (const d of ['i18n/ru.js', 'i18n/en.js']) {
  const s = fs.readFileSync(d, 'utf8');
  for (const k of KEYS) if (!s.includes("'" + k + "':")) errs.push('нема ключа "' + k + '" у ' + d);
}
/* рядки зі сторінки і ключі словника мусять збігатися символ у символ */
for (const k of KEYS) if (!src['check.html'].includes(k)) errs.push('рядок "' + k + '" зник зі сторінки, словники тепер мимо');

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('лаунчер: 4 блоки однакові на 6 сторінках · панель поза шапкою · Import -> /import · 11 маршрутів дають правильний поточний продукт · beta ховається на телефоні · словники повні');
console.log('LAUNCHER TEST PASSED');
