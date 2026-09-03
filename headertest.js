/* Шапка однакова на шести сторінках, і кнопка "Кабінет" нікуди не веде.
   Тест тримає: пігулку beta скрізь тим самим правилом, ту саму іконку кнопки,
   спільний блок поведінки меню побайтово однаковий, і саму поведінку кліку
   під заглушкою DOM: preventDefault завжди, перемикання меню лише на тачі. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = ['check.html', 'import.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const S = Object.fromEntries(PAGES.map(p => [p, fs.readFileSync(p, 'utf8')]));
const PROD_CSS = ".prod{font-family:'Caveat',cursive;font-size:22px;font-weight:600;font-style:normal;color:var(--brand-active);letter-spacing:0;line-height:1;position:relative;top:1px}";
const PROD = { 'check.html': 'Check', 'result-check.html': 'Check', 'import.html': 'Import', 'result.html': 'Import', 'garage.html': 'Garage' };
const MENU = ['/cabinet.html#reports', '/cabinet.html#memory', '/cabinet.html#account'];
const ICON = '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>';
const blocks = new Map();
for (const p of PAGES) {
  const s = S[p];
  /* beta зникла зі всіх сторінок; біля логотипа назва продукту з data-атрибута,
     щоб локалізація її не перекладала; кабінет і гараж без назви продукту */
  if (/class="beta"/.test(s) || /\bbeta\b/.test(s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''))) errs.push(p + ': beta лишилась у розмітці');
  if (!s.includes(PROD_CSS) || !s.includes('.prod::after{content:attr(data-prod)}')) errs.push(p + ': нема правила назви продукту');
  const lab = (s.match(/<span class="prod" data-prod="([^"]+)"/g) || []).map(x => x.replace(/.*data-prod="([^"]+)".*/, '$1'));
  if (PROD[p] ? (lab.length !== 1 || lab[0] !== PROD[p]) : lab.length) errs.push(p + ': назва продукту в шапці: ' + (lab.join(',') || 'нема') + ', очікували ' + (PROD[p] || 'нічого'));
  /* меню кабінету: Звіти, Гараж, Памʼять, Налаштування, кожен пункт з іконкою */
  const menu = (s.match(/<div class="acc-menu">[\s\S]*?<\/div>/) || [''])[0];
  const hrefs = (menu.match(/<a href="([^"]+)"/g) || []).map(x => x.replace(/<a href="([^"]+)"/, '$1'));
  if (hrefs.join('|') !== MENU.join('|')) errs.push(p + ': порядок меню: ' + hrefs.join(', '));
  if ((menu.match(/<svg /g) || []).length !== 3) errs.push(p + ': у меню не три іконки');
  if (/<a href="\/garage"/.test(menu)) errs.push(p + ': Гараж лишився в меню кабінету, він тепер продукт лаунчера');
  if (!/\.acc-menu a svg\{width:18px;height:18px/.test(s)) errs.push(p + ': іконки меню без правила розміру 18px');
  if ((s.match(/^\s*\.prod\{/gm) || []).length !== 1) errs.push(p + ': правило .prod не одне, назви продуктів різняться');
  if (s.split(ICON).length - 1 !== 1) errs.push(p + ': іконка кнопки кабінету інша');
  if (!s.includes('.acc-wrap:hover .acc-menu,.acc-wrap:focus-within .acc-menu{display:block}')) errs.push(p + ': меню кабінету не відкривається наведенням/фокусом');
  if (!s.includes('.acc-wrap.open .acc-menu{display:block}')) errs.push(p + ': нема правила для тача (.acc-wrap.open)');
  const m = s.match(/<script>\n\/\* Клік по пункту меню акаунта[\s\S]*?<\/script>/);
  if (!m) { errs.push(p + ': нема спільного блоку поведінки меню'); continue; }
  blocks.set(p, m[0]);
}
if (new Set(blocks.values()).size > 1) errs.push('блок поведінки меню розійшовся між сторінками');

/* стан входу: розмітка за замовчуванням анонімна, "Кабінет" лише за
   підтвердженою сесією, і жодна сторінка не падає, якщо дізналась про сесію
   РАНІШЕ, ніж виконався спільний блок (саме так кабінет лишався порожнім) */
for (const p of PAGES) {
  const s = S[p];
  if (!/<div class="acc-wrap anon">/.test(s)) errs.push(p + ': шапка не починається з анонімного стану');
  if (!/<span id="authLabel">Sign in<\/span>/.test(s)) errs.push(p + ': за замовчуванням не "Увійти"');
  if (!/\.acc-wrap\.anon \.acc-menu\{display:none!important\}/.test(s)) errs.push(p + ': анонімному показується меню кабінету');
  const calls = (s.match(/window\.calcarAuthState\(/g) || []).length;
  if (calls < 2) errs.push(p + ': нема виклику calcarAuthState за станом сесії');
  /* кожен виклик поза визначенням блоку мусить бути захищений перевіркою */
  const unguarded = s.split('\n').filter(l => /window\.calcarAuthState\(/.test(l) && !/if \(window\.calcarAuthState\)/.test(l) && !/window\.calcarAuthState = /.test(l) && !/CALCAR_SIGNED_IN !== undefined/.test(l));
  if (unguarded.length) errs.push(p + ': незахищений виклик calcarAuthState (сторінка впаде, якщо блок ще не виконався): ' + unguarded[0].trim().slice(0, 60));
  if (!/window\.CALCAR_SIGNED_IN = /.test(s)) errs.push(p + ': стан сесії не запамʼятовується до виконання блоку');
}
/* сама функція: анонім бачить "Увійти" і не бачить меню, вхід дає "Кабінет" */
{
  const src = (blocks.get('check.html') || '').replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  const mkCls = () => { const set = new Set(['anon']); return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: c => (set.has(c) ? set.delete(c) : set.add(c)), _set: set }; };
  const wrap = { classList: mkCls() };
  const lab = { textContent: 'Sign in' };
  const ctx = {
    window: { t: x => (x === 'My account' ? 'Кабінет' : x === 'Sign in' ? 'Увійти' : x), matchMedia: () => ({ matches: true }) },
    document: { addEventListener() {}, querySelector: sel => (sel === '.acc-wrap' ? wrap : null), getElementById: id => (id === 'authLabel' ? lab : null), querySelectorAll: () => [], activeElement: null },
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.window.calcarAuthState(true);
  if (lab.textContent !== 'Кабінет' || wrap.classList.contains('anon')) errs.push('підтверджена сесія не дає "Кабінет"');
  ctx.window.calcarAuthState(false);
  if (lab.textContent !== 'Увійти' || !wrap.classList.contains('anon')) errs.push('без сесії шапка не повертається в "Увійти"');
  if (ctx.window.CALCAR_SIGNED_IN !== false) errs.push('стан входу не зберігається у CALCAR_SIGNED_IN');
}

/* поведінка кліку: справжній блок під заглушкою */
const block = blocks.get('check.html') || '';
function run(hoverable) {
  const listeners = [];
  const wrap = { cls: new Set(), classList: { toggle(c) { wrap.cls.has(c) ? wrap.cls.delete(c) : wrap.cls.add(c); }, remove(c) { wrap.cls.delete(c); }, contains(c) { return wrap.cls.has(c); } } };
  const btn = { closest: sel => (sel === '.acc-wrap' ? wrap : null) };
  const target = { closest: sel => (sel === '.btn-auth' ? btn : sel === '.acc-wrap' ? wrap : null) };
  const ctx = {
    document: { addEventListener: (t, fn) => listeners.push(fn), querySelectorAll: () => [wrap], activeElement: null },
    window: { matchMedia: () => ({ matches: hoverable }) },
  };
  vm.createContext(ctx);
  vm.runInContext(block.replace(/^<script>\n/, '').replace(/\n<\/script>$/, ''), ctx);
  let prevented = 0;
  const ev = { target, preventDefault() { prevented++; } };
  listeners.forEach(fn => fn(ev));
  return { prevented, open: wrap.cls.has('open'), listeners: listeners.length };
}
const desk = run(true), touch = run(false);
if (!desk.prevented) errs.push('десктоп: клік по "Кабінет" не зупинений, посилання веде на сторінку');
if (desk.open) errs.push('десктоп: клік перемикає меню класом, а має нічого не робити (меню тримає наведення)');
if (!touch.prevented) errs.push('тач: клік по "Кабінет" не зупинений');
if (!touch.open) errs.push('тач: тап не відкриває меню');
/* клік поза меню закриває відкрите тач-меню */
{
  const listeners = [];
  const wrap = { removed: false, classList: { remove() { wrap.removed = true; } } };
  const ctx = { document: { addEventListener: (t, fn) => listeners.push(fn), querySelectorAll: () => [wrap], activeElement: null }, window: { matchMedia: () => ({ matches: false }) } };
  vm.createContext(ctx);
  vm.runInContext(block.replace(/^<script>\n/, '').replace(/\n<\/script>$/, ''), ctx);
  listeners.forEach(fn => fn({ target: { closest: () => null }, preventDefault() {} }));
  if (!wrap.removed) errs.push('тап поза меню не закриває його');
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('шапка: без beta, назва продукту і іконка однакові на 6 сторінках · меню Звіти/Памʼять/Налаштування з іконками · блок меню побайтово один · клік по Кабінет нікуди не веде · тач відкриває, тап поза закриває');
console.log('HEADER TEST PASSED');
