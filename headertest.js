/* Шапка однакова на шести сторінках: ліворуч лаунчер, логотип і назва
   продукту, праворуч ОДНА помітна кнопка глобального помічника. Продукти,
   акаунт і мова живуть у панелі лаунчера, у шапці їх дропдаунів нема.
   Тест тримає: спільний блок поведінки побайтово однаковий, кнопка помічника
   відкриває той самий unified Assistant, стан входу чесний і не падає від
   порядку скриптів, у правій частині шапки нема нічого зайвого. */
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
  /* акаунт живе в панелі лаунчера: ті самі три пункти, кожен з іконкою */
  const menu = (s.match(/<div class="acc-menu">[\s\S]*?<\/div>/) || [''])[0];
  const hrefs = (menu.match(/<a href="([^"]+)"/g) || []).map(x => x.replace(/<a href="([^"]+)"/, '$1'));
  if (hrefs.join('|') !== MENU.join('|')) errs.push(p + ': порядок меню: ' + hrefs.join(', '));
  if ((menu.match(/<svg /g) || []).length !== 3) errs.push(p + ': у меню не три іконки');
  if (/<a href="\/garage"/.test(menu)) errs.push(p + ': Гараж лишився в меню кабінету, він тепер продукт лаунчера');
  if (!/\.acc-menu a svg\{width:18px;height:18px/.test(s)) errs.push(p + ': іконки меню без правила розміру 18px');
  if ((s.match(/^\s*\.prod\{/gm) || []).length !== 1) errs.push(p + ': правило .prod не одне, назви продуктів різняться');
  if (s.split(ICON).length - 1 !== 1) errs.push(p + ': іконка кнопки кабінету інша');
  /* права частина шапки: рівно одна дія, глобальний вхід у помічника */
  const right = (s.match(/<div class="header-right">[\s\S]*?<\/div>/) || [''])[0];
  if (!/id="aiBtn"/.test(right)) errs.push(p + ': у шапці нема кнопки помічника');
  if (/lang-dd|langBtn|btn-auth|acc-wrap/.test(right)) errs.push(p + ': мова або акаунт лишились у правій частині шапки');
  if ((right.match(/<button|<a /g) || []).length !== 1) errs.push(p + ': у правій частині шапки не рівно одна дія');
  if (!/\.btn-ai\{[^}]*background:var\(--brand\)/.test(s)) errs.push(p + ': кнопка помічника не фірмова лаймова');
  if (!/\.btn-ai\{[^}]*color:var\(--ink\)/.test(s)) errs.push(p + ': текст кнопки помічника не темний');
  if (/\.btn-ai\{[^}]*position:fixed/.test(s)) errs.push(p + ': кнопка помічника знову плаваюча');
  if (!/\.btn-ai \.ai-short\{display:none\}/.test(s) || !/\.btn-ai \.ai-full\{display:none\}/.test(s)) errs.push(p + ': нема компактної форми назви для телефона');
  if (!s.includes('.acc-wrap.anon .acc-menu{display:none!important}')) errs.push(p + ': анонімному показуються пункти кабінету');
  const m = s.match(/<script>\n\/\* Спільна поведінка шапки[\s\S]*?<\/script>/);
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

/* поведінка спільного блоку під заглушкою DOM: кнопка помічника відкриває
   ТОЙ САМИЙ unified Assistant, свого чату не створює */
{
  const block = blocks.get('check.html') || '';
  const src = block.replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  const listeners = [];
  let prevented = 0;
  const panel = { open: false };
  const aiBtn = { attrs: {}, setAttribute(k, v) { aiBtn.attrs[k] = v; } };
  const chat = {
    open: () => { panel.open = true; },
    close: () => { panel.open = false; },
    toggle: () => { panel.open ? chat.close() : chat.open(); },
    isOpen: () => panel.open,
  };
  const ctx = {
    document: { addEventListener: (t, fn) => listeners.push({ type: t, fn }), querySelector: () => null, getElementById: id => (id === 'aiBtn' ? aiBtn : null), querySelectorAll: () => [], activeElement: null },
    window: { CalCarChat: chat, matchMedia: () => ({ matches: true }) },
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const fire = (type, ev) => listeners.filter(l => l.type === type).forEach(l => l.fn(ev));
  const click = () => fire('click', { target: { closest: sel => (sel === '#aiBtn' ? aiBtn : null) }, preventDefault() { prevented++; } });
  /* закрито -> клік -> відкрито -> клік -> закрито -> клік -> відкрито */
  click();
  if (!panel.open) errs.push('перший клік не відкрив помічника');
  if (aiBtn.attrs['aria-expanded'] !== 'true') errs.push('aria-expanded не став true при відкритті');
  click();
  if (panel.open) errs.push('повторний клік не закрив помічника');
  if (aiBtn.attrs['aria-expanded'] !== 'false') errs.push('aria-expanded не став false при закритті');
  click();
  if (!panel.open) errs.push('третій клік не відкрив помічника знову');
  if (!prevented) errs.push('клік по кнопці помічника не зупинений, сторінка може перейти кудись');
  fire('click', { target: { closest: () => null }, preventDefault() { errs.push('блок реагує на чужі кліки'); } });
  /* панель закрили повз кнопку: шапка дізнається про це подією помічника */
  chat.close();
  fire('calcar-chat-state', { detail: { open: false } });
  if (aiBtn.attrs['aria-expanded'] !== 'false') errs.push('aria-expanded не оновився після закриття помічника повз кнопку');
  /* стан беремо в помічника, свого прапорця нема */
  if (/(let|var|const)\s+\w*[Oo]pen\w*\s*=/.test(src)) errs.push('шапка завела власний прапорець стану помічника');
  if (/CalCarChat\.(?!toggle|isOpen)/.test(src)) errs.push('блок чіпає помічника повз toggle/isOpen');
  if (/thread|memory|registerCapability/.test(src)) errs.push('спільний блок лізе у тред/памʼять помічника');
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('шапка: без beta, назва продукту і іконка однакові на 6 сторінках · праворуч рівно одна дія (помічник) · продукти/акаунт/мова в лаунчері · блок поведінки побайтово один · кнопка відкриває спільний Assistant');
console.log('HEADER TEST PASSED');
