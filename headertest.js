/* Шапка однакова на шести сторінках, і кнопка "Кабінет" нікуди не веде.
   Тест тримає: пігулку beta скрізь тим самим правилом, ту саму іконку кнопки,
   спільний блок поведінки меню побайтово однаковий, і саму поведінку кліку
   під заглушкою DOM: preventDefault завжди, перемикання меню лише на тачі. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = ['check.html', 'import.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const S = Object.fromEntries(PAGES.map(p => [p, fs.readFileSync(p, 'utf8')]));
const BETA = '.beta{font-size:11px;font-weight:600;background:var(--surface-2);color:var(--muted);padding:2px 8px;border-radius:20px;letter-spacing:.4px}';
const ICON = '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>';
const blocks = new Map();
for (const p of PAGES) {
  const s = S[p];
  if (!s.includes(BETA)) errs.push(p + ': beta не пігулка (нема спільного правила .beta)');
  if ((s.match(/<div class="beta">beta<\/div>/g) || []).length !== 1) errs.push(p + ': нема beta у шапці');
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
console.log('шапка: beta-пігулка і іконка однакові на 6 сторінках · блок меню побайтово один · клік по Кабінет нікуди не веде · тач відкриває, тап поза закриває');
console.log('HEADER TEST PASSED');
