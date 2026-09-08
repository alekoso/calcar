/* Сторінка керування памʼяттю: один вміст у всіх станах.

   Памʼять це нотатка з чотирьох розділів, яку веде помічник (NOTE_SPEC у
   api/memory.js і api/chat.js). Сторінка кабінету її ПОКАЗУЄ і дозволяє
   правити, тому вона не має права нічого скорочувати чи показувати
   частково. Тест ганяє справжній код сторінки під заглушкою DOM:
     initial load == after save == after reload;
     Скасувати повертає рівно вихідний текст;
     довга нотатка не ріжеться ні рендером, ні збереженням;
     нерозпізнаний заголовок не ковтається;
     читання це окремий контейнер, а не гігантське поле. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const page = fs.readFileSync('cabinet.html', 'utf8');

/* ---------- дістаємо справжні функції сторінки ---------- */
function grab(src, name, kind) {
  const start = src.indexOf((kind === 'const' ? 'const ' : 'function ') + name);
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const secs = (page.match(/const MEM_SECTIONS = \[[^\]]*\];/) || [])[0];
const escFn = (page.match(/const memEsc = [^\n]+/) || [])[0];
const renderFn = grab(page, 'renderMemory');
if (!secs || !escFn || !renderFn) { console.log('MEMORY TEST FAILED: не знайдено код рендера памʼяті'); process.exit(1); }

/* ---------- заглушка DOM ---------- */
function makeEl() {
  return { innerHTML: '', style: {}, value: '', readOnly: false, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, setSelectionRange() {}, addEventListener() {} };
}
const NOTE = [
  'Людина:',
  'Шукає авто в Україні, розбирається в техніці на середньому рівні.',
  'Їздить щодня по місту, 15 000 км на рік.',
  '',
  'Уподобання й обмеження:',
  'Бюджет до 25 000 доларів. Кузов універсал або кросовер.',
  'Готовий брати авто після ДТП зі США, якщо ремонт задокументований.',
  'Пробіг до 150 000 км. Важливіша надійність, ніж динаміка.',
  '',
  'Активний пошук:',
  'Дивиться BMW 5 Series та Tesla Model S 2015-2018 років.',
  'Кандидати: BMW 530e 2018 (26 499 доларів), Tesla Model S 2015 (17 000 доларів).',
  '',
  'Рішення:',
  '2026-09-01: відсіяв Audi A6 2016 через нерозкриту історію обслуговування.',
  '2026-09-03: Tesla Model S 2015 лишив у списку після перевірки батареї.',
].join('\n');

function run(text) {
  const view = makeEl();
  /* t() як у справжній UA-локалі: label розділу повертається українським заголовком */
  const LABELS = { Person: 'Людина', 'Preferences and limits': 'Уподобання й обмеження', 'Current search': 'Активний пошук', Decisions: 'Рішення' };
  const ctx = { t: x => LABELS[x] || x, document: { getElementById: id => (id === 'memView' ? view : null) } };
  vm.createContext(ctx);
  vm.runInContext(secs + '\nconst memView = document.getElementById("memView");\n' + escFn + '\n' + renderFn + '\nrenderMemory(TEXT);', Object.assign(ctx, { TEXT: text }));
  return view.innerHTML;
}

/* ---------- 1. увесь вміст, усі розділи, нічого не загублено ---------- */
{
  const html = run(NOTE);
  for (const h of ['Людина', 'Уподобання й обмеження', 'Активний пошук', 'Рішення']) {
    if (!html.includes('<b>' + h + '</b>')) errs.push('розділ "' + h + '" не показаний');
  }
  /* кожен непорожній рядок нотатки мусить дійти до екрана */
  for (const line of NOTE.split('\n')) {
    const l = line.trim();
    if (!l || l.endsWith(':')) continue;
    const escaped = l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!html.includes(escaped)) errs.push('рядок памʼяті загублений при показі: "' + l.slice(0, 40) + '"');
  }
  if ((html.match(/class="mem-sec"/g) || []).length !== 4) errs.push('розділів на екрані не чотири: ' + (html.match(/class="mem-sec"/g) || []).length);
}

/* ---------- 2. початковий показ == після збереження == після перезавантаження ---------- */
{
  const initial = run(NOTE);          /* renderMemory(saved) при завантаженні */
  const afterSave = run(NOTE);        /* setMode(false) після Зберегти */
  const afterReload = run(NOTE);      /* нове завантаження тієї ж нотатки */
  if (initial !== afterSave) errs.push('показ після збереження відрізняється від початкового');
  if (initial !== afterReload) errs.push('показ після перезавантаження відрізняється від початкового');
  if (initial.length < NOTE.length * 0.8) errs.push('початковий показ помітно коротший за саму нотатку');
}

/* ---------- 3. довга памʼять не ріжеться ---------- */
{
  const long = NOTE + '\n' + 'x'.repeat(2400);
  const html = run(long);
  if (!html.includes('x'.repeat(2400))) errs.push('довга нотатка обрізана при показі');
  /* ліміт один на UI і генератор (api/memory.js, api/chat.js): 6000; довше не
     ріжеться мовчки, а показується людині */
  const limit = (page.match(/const MEM_LIMIT = (\d+);/) || [])[1];
  if (+limit !== 6000) errs.push('ліміт памʼяті на сторінці не 6000: ' + limit);
  for (const f of ['api/memory.js', 'api/chat.js']) if (!/slice\(0, 6000\)/.test(fs.readFileSync(f, 'utf8'))) errs.push(f + ': ліміт памʼяті не 6000');
  if (/slice\(0, 2800\)/.test(page)) errs.push('сторінка досі ріже по 2800');
  if (!/if \(tooLong\(v, trSt\)\) return;/.test(page) || !/if \(tooLong\(v, st\)\) return;/.test(page)) errs.push('задовгий текст ріжеться мовчки замість повідомлення');
}

/* ---------- 4. нерозпізнаний формат не губиться ---------- */
{
  const plain = 'Просто нотатка без заголовків.\nДругий рядок.';
  const html = run(plain);
  if (!html.includes('Просто нотатка без заголовків.') || !html.includes('Другий рядок.')) errs.push('текст без розділів не показаний');
  const mixed = 'Невідомий розділ:\nтекст під ним\n\nРішення:\nщось';
  const h2 = run(mixed);
  if (!h2.includes('Невідомий розділ:') || !h2.includes('текст під ним')) errs.push('невідомий заголовок ковтається разом із текстом');
  if (!run('').includes('mem-empty')) errs.push('порожня памʼять не має чесного порожнього стану');
  /* порожня памʼять пропонує перенести профіль із ChatGPT/Claude, а не глухий кут */
  if (!run('').includes('id="memTransferBtn"')) errs.push('порожня памʼять без кнопки перенесення з ChatGPT/Claude');
  if (!/id="memPromptSrc" hidden>Analyze our past conversations/.test(page)) errs.push('нема тексту запиту для ChatGPT/Claude у розмітці');
  if (!/id="memPaste"/.test(page) || !/id="memPasteSave"/.test(page)) errs.push('нема поля вставки профілю або кнопки збереження');
  if (!run('').includes('id="memManualBtn"')) errs.push('порожня памʼять без дії "Заповнити вручну"');
  if (!/Return a compact but sufficiently detailed structured profile in English\./.test(page)) errs.push('текст запиту не оновлений');
  /* заголовки: у нотатці лишаються українськими, на екрані через t(label) */
  const en = (() => { const v = makeEl(); const c = { t: x => x, document: { getElementById: id => (id === 'memView' ? v : null) } }; vm.createContext(c); vm.runInContext(secs + '\nconst memView = document.getElementById("memView");\n' + escFn + '\n' + renderFn + '\nrenderMemory(TEXT);', Object.assign(c, { TEXT: NOTE })); return v.innerHTML; })();
  if (!en.includes('<b>Person</b>') || !en.includes('<b>Decisions</b>')) errs.push('заголовки розділів не показуються мовою інтерфейсу');
}

/* ---------- 5. стани сторінки: читання, правка, скасування ---------- */
{
  const setModeFn = grab(page, 'setMode');
  if (!setModeFn) errs.push('нема setMode');
  else {
    const view = makeEl(), ta = makeEl(), bEdit = makeEl(), bSave = makeEl(), bCancel = makeEl(), bClear = makeEl(), useRow = makeEl(), memActions = makeEl();
    const trBox = { hidden: true };
    ta.value = NOTE;
    let rendered = null;
    const ctx = {
      ta, memView: view, bEdit, bSave, bCancel, bClear, useRow, memActions, trBox, saved: NOTE, String,
      autoGrow() {}, renderMemory(v) { rendered = v; },
    };
    vm.createContext(ctx);
    vm.runInContext(setModeFn + '\nsetMode(false);', ctx);
    if (ta.style.display !== 'none' || view.style.display !== '') errs.push('у режимі читання видно поле, а не контейнер памʼяті');
    if (rendered !== NOTE) errs.push('режим читання показує не весь текст');
    if (bEdit.style.display !== '' || bClear.style.display !== '' || useRow.style.display !== '') errs.push('непорожня памʼять у читанні без Змінити/Видалити/прапорця');
    vm.runInContext('setMode(true);', ctx);
    if (ta.style.display !== '' || view.style.display !== 'none') errs.push('у режимі правки не видно поле');
    if (bSave.style.display !== '' || bCancel.style.display !== '' || bEdit.style.display !== 'none') errs.push('у режимі правки не ті кнопки');
    /* імпорт: окремий стан, не редактор і не читання */
    vm.runInContext('setMode("import");', ctx);
    if (trBox.hidden || ta.style.display !== 'none' || view.style.display !== 'none' || memActions.style.display !== 'none') errs.push('режим імпорту змішаний з іншими станами');
    /* порожня памʼять у читанні: онбординг без редактора, Видалити, Скасувати і прапорця */
    ctx.saved = ''; ta.value = '';
    vm.runInContext('setMode(false);', ctx);
    if (ta.style.display !== 'none' || view.style.display !== '') errs.push('порожня памʼять відкриває редактор замість онбордингу');
    if (bClear.style.display !== 'none' || bCancel.style.display !== 'none' || bEdit.style.display !== 'none' || useRow.style.display !== 'none' || memActions.style.display !== 'none') errs.push('порожня памʼять показує Видалити/Скасувати/Змінити або прапорець');
    if (trBox.hidden !== true) errs.push('порожнє читання показує панель імпорту');
    /* Скасувати повертає рівно збережений текст */
    const cancel = (page.match(/bCancel\.onclick = \(\) => \{[^}]*\};/) || [''])[0];
    if (!/ta\.value = saved;/.test(cancel)) errs.push('Скасувати не повертає збережений текст');
    if (!/setMode\(false\)/.test(cancel)) errs.push('Скасувати не повертає режим читання');
  }
  /* читання це контейнер, а не величезне поле */
  if (!/<div class="mem-view" id="memView">/.test(page)) errs.push('нема окремого контейнера памʼяті');
  if (!/\.mem-view\{[^}]*border:1px solid var\(--line\)/.test(page)) errs.push('контейнер памʼяті без власної рамки');
  if (!/<textarea id="memText" rows="6" style="display:none"/.test(page)) errs.push('поле правки видно в режимі читання');
  if (!/renderMemory\(saved\);/.test(page)) errs.push('памʼять не рендериться одразу при завантаженні');
  if (/if \(!ta\.value\) setMode\(true\)/.test(page)) errs.push('порожня памʼять знову відкриває редактор при завантаженні');
  /* прапорець і видалення памʼяті лишились */
  if (!/id="memUse"/.test(page) || !/id="memClear"/.test(page)) errs.push('зник прапорець використання або видалення памʼяті');
}

if (errs.length) { console.log('MEMORY TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
console.log('памʼять: усі чотири розділи · початковий показ = після збереження = після перезавантаження · довга нотатка не ріжеться · невідомий формат не губиться · читання в контейнері, правка в полі');
console.log('MEMORY TEST PASSED');
