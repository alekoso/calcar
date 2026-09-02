/* Шапка однакова на шести сторінках, і кнопка "Кабінет" нікуди не веде.
   Тест тримає: пігулку beta скрізь тим самим правилом, ту саму іконку кнопки,
   спільний блок поведінки меню побайтово однаковий, і саму поведінку кліку
   під заглушкою DOM: preventDefault завжди, перемикання меню лише на тачі. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = ['check.html', 'import.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const S = Object.fromEntries(PAGES.map(p => [p, fs.readFileSync(p, 'utf8')]));
const PROD_CSS = '.prod{font-size:14px;font-weight:600;font-style:italic;color:var(--ink-2);letter-spacing:.01em;line-height:1}';
const PROD = { 'check.html': 'Check', 'result-check.html': 'Check', 'import.html': 'Import', 'result.html': 'Import' };
const MENU = ['/cabinet.html#reports', '/garage', '/cabinet.html#memory', '/cabinet.html#account'];
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
  if ((menu.match(/<svg /g) || []).length !== 4) errs.push(p + ': у меню не чотири іконки');
  if (!/\.acc-menu a svg\{width:16px;height:16px/.test(s)) errs.push(p + ': іконки меню без правила розміру');
  if (s.split(ICON).length - 1 !== 1) errs.push(p + ': іконка кнопки кабінету інша');
  if (!s.includes('.acc-wrap:hover .acc-menu,.acc-wrap:focus-within .acc-menu{display:block}')) errs.push(p + ': меню кабінету не відкривається наведенням/фокусом');
  if (!s.includes('.acc-wrap.open .acc-menu{display:block}')) errs.push(p + ': нема правила для тача (.acc-wrap.open)');
  const m = s.match(/<script>\n\/\* Клік по пункту меню акаунта[\s\S]*?<\/script>/);
  if (!m) { errs.push(p + ': нема спільного блоку поведінки меню'); continue; }
  blocks.set(p, m[0]);
}
if (new Set(blocks.values()).size > 1) errs.push('блок поведінки меню розійшовся між сторінками');

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
console.log('шапка: без beta, назва продукту і іконка однакові на 6 сторінках · меню Звіти/Гараж/Памʼять/Налаштування з іконками · блок меню побайтово один · клік по Кабінет нікуди не веде · тач відкриває, тап поза закриває');
console.log('HEADER TEST PASSED');
