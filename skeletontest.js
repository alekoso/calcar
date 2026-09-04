/* Два стани очікування CalCar і межа між ними.

   1. ПРОГРЕС аналізу: багатоетапний індикатор, спільний компонент Check та
      Import. Блоки CSS і JS між маркерами progress:start/end побайтово
      однакові на сторінках, стадії задає сама сторінка. Тест тримає ще й
      чесність стадій: їх стільки, скільки реальних кроків у пайплайні
      відповідного режиму.
   2. СКЕЛЕТОН: короткочасне очікування даних, які вже існують. Примітиви
      spільні (skeleton:start/end), кожен плейсхолдер має явну геометрію
      майбутнього вмісту, у кожного асинхронного блока є вихід зі стану
      завантаження (дані, порожньо або помилка), анімація вимикається за
      prefers-reduced-motion.
   Скелетон НЕ підміняє прогрес: поки аналіз реально йде, сторінка показує
   стадії, а не геометрію майбутнього звіту. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = ['check.html', 'import.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const S = Object.fromEntries(PAGES.map(p => [p, fs.readFileSync(p, 'utf8')]));
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return null; const j = s.indexOf(b, i); return j < 0 ? null : s.slice(i, j + b.length); };

/* ---------- 1. спільний компонент прогресу ---------- */
const PROGRESS_PAGES = ['check.html', 'import.html', 'result-check.html'];
{
  const blocks = {};
  for (const p of PROGRESS_PAGES) {
    const all = S[p].match(/\/\* progress:start[\s\S]*?\/\* progress:end \*\//g) || [];
    if (all.length !== 2) { errs.push(p + ': очікували два блоки прогресу (CSS і JS), знайдено ' + all.length); continue; }
    blocks[p] = all;
  }
  const have = Object.keys(blocks);
  if (have.length === PROGRESS_PAGES.length) {
    const css = new Set(have.map(p => blocks[p][0]));
    const js = new Set(have.map(p => blocks[p][1]));
    if (css.size !== 1) errs.push('CSS індикатора розійшовся між сторінками');
    if (js.size !== 1) errs.push('JS індикатора розійшовся між сторінками');
    const j = blocks['check.html'][1];
    /* компонент параметризований сторінкою, а не зашитий під Check */
    for (const k of ['LOAD_STAGES', 'LOAD_STAGE_AT', 'LOAD_LONG_AT', 'LOAD_LOG', 'loadingCleanup']) {
      if (!j.includes(k)) errs.push('спільний JS не спирається на ' + k);
    }
    if (/pendingSet\(|calcar_pending_check/.test(j)) errs.push('у спільний JS протік стан Check');
    if (!/ld\.setStage = i =>/.test(j)) errs.push('нема входу для реальних стадій із сервера');
  }
  /* кожна сторінка оголошує свої стадії, контейнер і залежності блоку.
     esc() і t() мусять існувати в ТІЙ САМІЙ області видимості, інакше
     loadingStart() падає на першому ж рядку, а сторінка мовчки лишається
     без індикатора: саме так це і зламалось на Import */
  for (const p of PROGRESS_PAGES) {
    if (!/id="loadBox"/.test(S[p])) errs.push(p + ': нема контейнера індикатора');
    if (!/const LOAD_LOG = '(chk|imp)';/.test(S[p])) errs.push(p + ': нема префікса логів індикатора');
    const scripts = S[p].match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
    const host = scripts.find(x => x.includes('function loadingStart()'));
    if (!host) { errs.push(p + ': блок індикатора не знайдено у скрипті сторінки'); continue; }
    if (!/function esc\(|const esc =/.test(host)) errs.push(p + ': у області видимості індикатора нема esc()');
    for (const dep of ['LOAD_STAGES', 'LOAD_STAGE_AT', 'LOAD_LONG_AT', 'LOAD_LOG']) {
      if (!new RegExp('(const|let|var) ' + dep + '\\b').test(host)) errs.push(p + ': ' + dep + ' оголошено поза областю видимості індикатора');
    }
    if (!/function run\(|const run =|run = /.test(host)) errs.push(p + ': нема run() для повтору після помилки');
  }
  /* Check і його звіт показують ОДНІ стадії: це той самий аналіз */
  const stagesOf = s => {
    const m = s.match(/const (?:LOAD_STAGES|STAGES_LOT) = \[[\s\S]*?\n\];/);
    return m ? m[0].replace(/STAGES_LOT/, 'LOAD_STAGES') : null;
  };
  const a = stagesOf(S['check.html']), b = stagesOf(S['result-check.html']);
  if (!a || !b) errs.push('не знайдено списки стадій Check');
  else if (a !== b) errs.push('стадії Check на сторінці запуску і у звіті розійшлися');
  /* Import: стадії за РЕАЛЬНИМИ межами пайплайна, а не декоративні */
  const imp = S['import.html'];
  const count = name => { const m = imp.match(new RegExp('const ' + name + ' = \\[[\\s\\S]*?\\n\\];')); return m ? (m[0].match(/\{ title:/g) || []).length : -1; };
  if (count('STAGES_LOT') !== 4) errs.push('режим лота не має чотирьох стадій: ' + count('STAGES_LOT'));
  if (count('STAGES_PHOTOS') !== 4) errs.push('режим власних фото не має чотирьох стадій');
  /* прогін лише за VIN не має Vision, тому вигаданого етапу розбору фото в ньому бути не може */
  if (count('STAGES_VIN') !== 3) errs.push('режим VIN не має трьох стадій: ' + count('STAGES_VIN'));
  const vinBlock = (imp.match(/const STAGES_VIN = \[[\s\S]*?\n\];/) || [''])[0];
  if (/Analyzing the damage|photos/i.test(vinBlock)) errs.push('у режимі лише за VIN зʼявився етап розбору фото, якого нема в пайплайні');
  /* реальні межі рухають індикатор */
  if (!/lot = lotData\.lot;[\s\S]{0,120}ld\.setStage\(1\)/.test(imp)) errs.push('Import не рухає стадію після відповіді /api/lot');
  if (!/ld\.setStage\(LOAD_STAGES\.length - 1\)/.test(imp)) errs.push('Import не рухає стадію після відповіді /api/analyze');
  if (/setInterval\([\s\S]{0,80}loadMsg/.test(imp)) errs.push('стара однорядкова крутилка Import лишилась');
  if (/id="loadMsg"/.test(imp)) errs.push('старий рядок статусу аналізу лишився в розмітці Import');
  /* Check більше не пояснює користувачу, як влаштований сервер */
  if (/t\('Analysis in progress\. It continues on the server/.test(S['check.html'])) errs.push('пояснення про сервер лишилось у Check');
  for (const d of ['i18n/ua.js', 'i18n/ru.js']) {
    if (fs.readFileSync(d, 'utf8').includes("'Analysis in progress. It continues on the server")) errs.push(d + ': лишився ключ прибраного пояснення');
  }
  /* але сама поведінка durable job не зачеплена */
  for (const k of ['calcar_pending_check', 'async function pollJob', 'async function resumePending']) {
    if (!S['check.html'].includes(k)) errs.push('durable-поведінка Check зачеплена: нема ' + k);
  }
  /* незавершений аналіз у звіті показує стадії, а не геометрію звіту */
  const rc = S['result-check.html'];
  if (!/body\.await-job \.report-skel\{display:none\}/.test(rc)) errs.push('звіт показує скелетон поверх незавершеного аналізу');
  if (!/document\.body\.classList\.add\('await-job'\); document\.title = t\('The report is not ready yet'\); loadingStart\(\);/.test(rc)) errs.push('незавершений job не вмикає індикатор стадій');
  if (/getElementById\('skeleton'\)/.test(rc)) errs.push('мертве посилання на неіснуючий #skeleton лишилось');
  if (!/if \(AWAIT_TITLE\) document\.title = AWAIT_TITLE;/.test(rc)) errs.push('назва вкладки лишається "звіт не готовий" після появи звіту');
}

/* ---------- 2. спільні примітиви скелетона ---------- */
{
  const prim = {};
  for (const p of PAGES) {
    const b = between(S[p], '/* skeleton:start', '/* skeleton:end */');
    if (!b) { errs.push(p + ': нема блоку примітивів скелетона'); continue; }
    prim[p] = b;
  }
  if (Object.keys(prim).length === PAGES.length && new Set(Object.values(prim)).size !== 1) {
    errs.push('примітиви скелетона розійшлися між сторінками');
  }
  const one = prim['check.html'] || '';
  for (const k of ['.sk{', '.sk-line', '.sk-title', '.sk-circle', '.sk-img']) {
    if (!one.includes(k)) errs.push('нема примітива ' + k);
  }
  /* стиль: нейтральний сірий, без лайму, ледь помітна анімація, повага до reduced-motion */
  if (!/background:#ECEEEA/.test(one)) errs.push('плейсхолдер не нейтрально-сірий');
  if (/var\(--brand\)|#B8F23D/.test(one)) errs.push('у скелетоні зʼявився лайм');
  if (!/@media \(prefers-reduced-motion:reduce\)\{\.sk\{animation:none/.test(one)) errs.push('скелетон не поважає prefers-reduced-motion');
  const dur = /animation:skp ([\d.]+)s/.exec(one);
  if (!dur || +dur[1] < 1.2) errs.push('пульсація надто швидка/агресивна: ' + (dur && dur[1]));
  for (const p of PAGES) {
    const dupes = (S[p].match(/@keyframes skp\{/g) || []).length;
    if (dupes !== 1) errs.push(p + ': анімація скелетона визначена ' + dupes + ' разів');
  }
}

/* ---------- 3. асинхронні блоки: геометрія і вихід зі стану ---------- */
{
  /* КАБІНЕТ: картки списку звітів */
  const cab = S['cabinet.html'];
  if (!/<div class="rgrid" id="reports" aria-busy="true">/.test(cab)) errs.push('кабінет: список не позначає стан завантаження');
  if (/<div class="empty">Loading…<\/div>/.test(cab)) errs.push('кабінет: лишився текстовий "Loading…" замість скелетона');
  if ((cab.match(/class="rcard-sk"/g) || []).length < 2) errs.push('кабінет: замало карток-плейсхолдерів');
  if (!/\.rcard-sk \.rph-sk\{flex:0 0 132px;width:132px;height:96px/.test(cab)) errs.push('кабінет: прев’ю скелетона іншого розміру, ніж справжнє');
  if (!/\.rph,\.rcard-sk \.rph-sk\{flex-basis:104px;width:104px;height:78px\}/.test(cab)) errs.push('кабінет: на телефоні скелетон і картка розходяться в розмірі');
  if (!/box\.removeAttribute\('aria-busy'\);/.test(cab)) errs.push('кабінет: стан завантаження не знімається');
  if (!/rempty[\s\S]{0,200}Could not load the list[\s\S]{0,400}rretry/.test(cab)) errs.push('кабінет: помилка не має компактного стану з повтором');
  if (!/TABS\[kind\]\.empty/.test(cab)) errs.push('кабінет: зник осмислений порожній стан');

  /* CHECK: недавні перевірки */
  const ch = S['check.html'];
  if (!/function renderRecentSkeleton\(n\)\{/.test(ch)) errs.push('check: нема скелетона недавніх');
  if (!/\.rc-sk \.sk-ph\{flex:0 0 76px;width:76px;height:54px/.test(ch)) errs.push('check: кадр скелетона не збігається з .rc-ph 76x54');
  if (!/if \(hasSession \|\| localMine\.length\) renderRecentSkeleton/.test(ch)) errs.push('check: скелетон показується там, де чекати нема чого');
  if (!/grid\.removeAttribute\('aria-busy'\);/.test(ch)) errs.push('check: стан завантаження не знімається при рендері');
  if (!/box\.classList\.remove\('on'\); return;/.test(ch)) errs.push('check: порожній результат лишає скелетон висіти');

  /* ГАРАЖ: стрічка і список авто */
  const g = S['garage.html'];
  if (!/\.feed\[data-state="loading"\] \.feed-loading\{display:flex\}/.test(g)) errs.push('гараж: скелетон стрічки не привʼязаний до стану loading');
  if ((g.match(/class="post-sk"/g) || []).length < 2) errs.push('гараж: замало плейсхолдерів постів');
  if (!/\.post-sk-head\{display:grid;grid-template-columns:40px minmax\(0,1fr\) auto/.test(g)) errs.push('гараж: шапка скелетона не повторює геометрію .post-head');
  if (!/\.car-sk \.sk-thumb\{width:132px;height:88px/.test(g)) errs.push('гараж: прев’ю авто в скелетоні іншого розміру, ніж .car-thumb');
  if (!/data-state="empty"/.test(g) || !/data-state="error"/.test(g)) errs.push('гараж: нема станів empty/error');
  if (!/var box = \$\('carList'\); box\.innerHTML = '';/.test(g)) errs.push('гараж: скелетон авто не змінюється списком');

  /* ЗВІТИ: геометрія майбутнього звіту лише для відновлення готового звіту */
  for (const p of ['result.html', 'result-check.html']) {
    if (!/body\.report-ready \.report-skel\{display:none\}/.test(S[p])) errs.push(p + ': скелетон звіту не зникає у готовому стані');
    if (!/report-ready/.test(S[p])) errs.push(p + ': нема готового стану звіту');
    if (!/aria-hidden="true"/.test((S[p].match(/<div class="report-skel"[^>]*>/) || [''])[0])) errs.push(p + ': скелетон звіту не схований від зчитувача екрана');
  }
}

/* ---------- 4. поведінка: скелетон завжди закінчується ---------- */
{
  /* справжня функція рендера недавніх під заглушкою DOM: порожній список
     мусить прибрати і блок, і плейсхолдери, а не лишити їх назавжди */
  const src = S['check.html'];
  const start = src.indexOf('function renderRecentChecks(rows, demo){');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  const fn = src.slice(start, i + 1);
  const grid = { innerHTML: 'SKELETON', attrs: { 'aria-busy': 'true' }, removeAttribute(a) { delete grid.attrs[a]; }, querySelectorAll: () => [] };
  const box = { cls: new Set(['on']), classList: { add: c => box.cls.add(c), remove: c => box.cls.delete(c) } };
  const ctx = {
    document: { getElementById: id => (id === 'recent' ? box : id === 'recentGrid' ? grid : null) },
    window: { calcarLocale: () => 'en-US' }, Date, Number, Array, String, Math,
    t: x => x, esc: x => String(x ?? ''), RC_PH: '<svg/>', nf: n => String(n), timeAgo: () => 'ago',
  };
  vm.createContext(ctx);
  vm.runInContext(fn + '\nrenderRecentChecks([]);', ctx);
  if (grid.innerHTML !== '' || grid.attrs['aria-busy'] || box.cls.has('on')) {
    errs.push('порожній список лишає скелетон недавніх на екрані');
  }
  vm.runInContext('renderRecentChecks([{ title: "Tesla", score: 8.1, created_at: "2026-01-01" }]);', ctx);
  if (!/rc-score/.test(grid.innerHTML) || grid.attrs['aria-busy']) errs.push('дані не замінюють скелетон недавніх');
}

if (errs.length) { console.log('SKELETON TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
console.log('прогрес: один компонент на Check/Import/звіт, стадії за реальним пайплайном · скелетон: спільні примітиви, геометрія майбутнього вмісту, вихід у дані/порожньо/помилку, reduced-motion');
console.log('SKELETON TEST PASSED');
