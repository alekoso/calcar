/* Головні сторінки Check і Import після редизайну. Тест тримає те, що
   легко повернути назад випадковою правкою: підписи-заповнювачі під формою,
   важкий CTA і старі блоки; блок недавньої активності, який без даних не
   рендериться зовсім; приклад результату, у якого цифри мусять сходитись. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = { 'check.html': fs.readFileSync('check.html', 'utf8'), 'import.html': fs.readFileSync('import.html', 'utf8') };

for (const [f, s] of Object.entries(PAGES)) {
  const body = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  /* 1. під формою нема маркетингових підписів і "скоро", нема важкого CTA */
  for (const bad of ['hf-note', "We'll find the VIN", 'Result in ~', 'No card required', 'VIN-only check', 'class="cta"', 'cta-wrap', 'ctaBtn', 'class="steps"', 'class="sample"', 'sline'])
    if (s.includes(bad)) errs.push(f + ': повернулось "' + bad + '"');
  /* 2. hero: бейдж над заголовком, форма це input + одна кнопка */
  if (!/<span class="hero-badge">[^<]+<\/span>\s*<h1>/.test(s)) errs.push(f + ': нема бейджа над заголовком');
  /* форма закінчується там, де починається блок недавніх: у Import між ними
     ще лежить <details> альтернативного входу без жодної головної кнопки */
  const form = s.slice(s.indexOf('<div class="hero-form">'), s.indexOf('id="recent"'));
  if ((form.match(/<button class="btn-primary"/g) || []).length !== 1) errs.push(f + ': у формі не одна головна кнопка');
  if (!/\.hero p\.sub\{[^}]*font-weight:500/.test(s)) errs.push(f + ': підзаголовок без font-weight:500');
  /* 3. недавня активність: за замовчуванням схована, вмикається лише класом */
  if (!/\.recent\{[^}]*display:none/.test(s) || !s.includes('.recent.on{display:block}')) errs.push(f + ': блок недавніх не схований за замовчуванням');
  if (!s.includes('id="recent"') || !s.includes('id="recentGrid"')) errs.push(f + ': нема розмітки недавніх');
  if (!/\.limit\(3\)/.test(s)) errs.push(f + ': запит недавніх без ліміту 3');
  if (!/from\('reports'\)[\s\S]{0,400}\.eq\('kind', '(check|import)'\)/.test(s)) errs.push(f + ': недавні не відфільтровані за kind');
  /* лише сам блок недавніх: від рендера до кінця його IIFE. Раніше в файлі є
     легітимний insert нового звіту, він тут ні до чого */
  const blk = s.slice(s.indexOf('function renderRecent'), s.indexOf('})();', s.indexOf('function loadRecent')) + 5);
  if (!blk.includes("from('reports')")) errs.push(f + ': блок недавніх не читає reports');
  if (/\.(insert|update|delete)\(/.test(blk)) errs.push(f + ': блок недавніх пише у reports');
  /* 4. приклад результату присутній і позначений як приклад */
  if (!/<section class="sec-ex">/.test(s) || !/class="ex-foot">A sample\./.test(s)) errs.push(f + ': нема прикладу результату або підпису "приклад"');
  /* приклад це картка звіту, а не таблиця: іконки станів і двошаровий текст, без крапок-маркерів */
  if (!/class="ex-ic (ok|warn|unknown)"/.test(s) || /<span class="dot (ok|warn)"><\/span><span class="ex-k">/.test(s)) errs.push(f + ': приклад результату знову таблиця з крапками');
  /* недавні з фото: перший кадр галереї у запиті, заглушка без нього */
  if (!/photo:data->_meta->photos->>0/.test(s)) errs.push(f + ': недавні без фото у запиті');
  if (!/const RC_PH = '<svg/.test(s) || !/class="rc-ph">' \+ ph/.test(s)) errs.push(f + ': недавні без заглушки фото');
  /* 5. рівно три картки продукту */
  if ((body.match(/<div class="feat">/g) || []).length !== 3) errs.push(f + ': карток продукту не три');
  /* 6. "beta" в шапці лишилась, лаунчер лишився */
  if (/class="beta"/.test(s) || !s.includes('id="lncBtn"') || !/<span class="prod" data-prod="(Check|Import)"/.test(s)) errs.push(f + ': шапка змінилась');
  /* без справжніх звітів блок показує приклади: статичні demo-авто, без переходу,
     без дат, без БД. Перший справжній звіт їх замінює */
  const ex = f === 'check.html' ? 'renderExampleChecks' : 'renderExampleEstimates';
  if (!new RegExp('function ' + ex + '\\(\\)').test(s)) errs.push(f + ': нема прикладів для нового користувача');
  /* demo-картки рендеряться тим самим кодом, що справжні: структура, дата, оцінка збігаються */
  if (!new RegExp('renderRecent\\w+\\(DEMO_\\w+\\.map\\([\\s\\S]{0,260}\\), true\\);').test(s)) errs.push(f + ': приклади не через спільний рендерер справжніх карток');
  if (!/\(demo \? '<div class="rc rc-demo">' : '<a class="rc" href=/.test(s)) errs.push(f + ': demo-картка не div без переходу');
  if (!new RegExp('if \\(Array\\.isArray\\(rows\\) && rows\\.length\\) renderRecent\\w+\\(rows\\); else ' + ex + '\\(\\);').test(s)) errs.push(f + ': приклади не замінюються справжніми звітами');
  /* тіло функції прикладів вирізається за балансом дужок: в Import вона живе всередині IIFE */
  const demoBlock = (() => { const st = s.indexOf('function ' + ex + '(){'); if (st < 0) return ''; let i = s.indexOf('{', st), d = 0; for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) break; } return s.slice(st, i + 1); })();
  if (/href=/.test(demoBlock)) errs.push(f + ': demo-картки клікаються');
  if (!/from\('reports'\)/.test(s.slice(s.indexOf('function loadRecent')))) errs.push(f + ': справжній запит недавніх зник');
  /* demo-фото: справжні фотографії з /demo, кожна мусить існувати; жодних svg-авто,
     битий файл дає лише нейтральну заглушку */
  for (const m of new Set(s.match(/\/demo\/[a-z0-9-]+\.(jpg|webp)/g) || [])) if (!fs.existsSync(m.slice(1))) errs.push(f + ': нема фото ' + m);
  if (/\/demo\/[a-z0-9-]+\.svg/.test(s)) errs.push(f + ': повернулась векторна demo-машина');
  if (!/onerror="this\.onerror=null;this\.removeAttribute\('src'\)"/.test(s)) errs.push(f + ': demo-фото без нейтрального фолбека');
  if (!/grid\.querySelectorAll\('\.rc-ph img'\)\.forEach\(img => img\.addEventListener\('error', \(\) => \{ img\.parentNode\.innerHTML = RC_PH; \}/.test(s)) errs.push(f + ': demo-картки без нейтрального фолбека');
  if (!/<img class="ex-photo" src="\/demo\//.test(s)) errs.push(f + ': у прикладі результату нема demo-фото');
  if (/\.hero-badge::before/.test(s)) errs.push(f + ': крапка перед бейджем повернулась');
  if (!/\.prod\{font-family:'Caveat',cursive;font-size:22px;font-weight:600;font-style:normal;color:var\(--brand-active\)/.test(s) || (s.match(/^\s*\.prod\{/gm) || []).length !== 1) errs.push(f + ': назва продукту не одним lime-правилом (Caveat)');
  if (!/family=Caveat:wght@600&display=swap&text=CheckImport/.test(s)) errs.push(f + ': шрифт Caveat не підключений або без text-підмножини');
  /* у demo-картках лише фото, модель і оцінка/сума: без рядка "Приклад" і без "Приклад авто" */
  if (/Example vehicle/.test(s)) errs.push(f + ': "Example vehicle" повернувся');
  const exFn = f === 'check.html' ? 'renderExampleChecks' : 'renderExampleEstimates';
  const st = s.indexOf('function ' + exFn + '(){'); let i2 = s.indexOf('{', st), dd = 0; for (; i2 < s.length; i2++) { if (s[i2] === '{') dd++; else if (s[i2] === '}' && --dd === 0) break; }
  if (/Example'\)/.test(s.slice(st, i2 + 1))) errs.push(f + ': у demo-картках слово "Приклад"');
  if (!/\(r\.pos \? ' style="object-position:' \+ esc\(r\.pos\)/.test(s)) errs.push(f + ': demo-фото без індивідуального object-position');
  if (!/\.ex-ic\.ok\{background:var\(--brand\)\}/.test(s) || !/\.ex-ic\.warn\{background:var\(--amber-soft\)/.test(s)) errs.push(f + ': статус-іконки не в системі лайм/amber/нейтральний');
  if (/\.ex-ic\.ok\{background:var\(--green-soft\)/.test(s)) errs.push(f + ': позитивний статус знову generic green');
  /* футер мінімальний: лише копірайт, без другого логотипа і beta */
  /* футер: справжній логотип, опис, лише реальні маршрути, копірайт; без beta, calcar.io і фейкових сторінок */
  const foot = (s.match(/<footer>[\s\S]*?<\/footer>/) || [''])[0];
  if (!/<a class="logo" href="\/">/.test(foot) || !/© 2026 CalCar/.test(foot)) errs.push(f + ': футер без логотипа або копірайту');
  if (/beta|calcar\.io|Privacy|Terms|Support|About/i.test(foot.replace(/<[^>]+>/g, ''))) errs.push(f + ': у футері зайве (beta/calcar.io/фейкові сторінки)');
  const links = (foot.match(/<a href="([^"]+)"/g) || []).map(x => x.replace(/<a href="([^"]+)"/, '$1'));
  if (links.join('|') !== '/check|/import|/cabinet.html#reports|/garage') errs.push(f + ': посилання футера не ті: ' + links.join(', '));
}

/* 7а. Check demo: підказка (i), компонент оцінки, вердикт стилем звіту, рівна висота */
{
  const c = PAGES['check.html'];
  if (!/<span class="ex-i" tabindex="0" role="button"[^>]*>i<span class="ex-tip"><b>CalCar Score<\/b>/.test(c)) errs.push('check.html: (i) без підказки');
  if (!/\.ex-i:hover \.ex-tip,\.ex-i:focus \.ex-tip\{display:block\}/.test(c)) errs.push('check.html: підказка не показується на hover/focus');
  if (!c.includes('<div class="ex-score"><b>8.1</b><small>/ 10</small></div>')) errs.push('check.html: оцінка demo не компонентом');
  /* малі оцінки: один розмір шрифту для числа і "/ 10", baseline через inline-flex, без transform/top */
  if (!/\.rc-score\{display:inline-flex;align-items:baseline;gap:4px;font-size:15px;line-height:1/.test(c)) errs.push('check.html: малі оцінки не єдиним компонентом');
  if (!/\.rc-score small\{font-size:inherit;font-weight:600;color:var\(--muted\)\}/.test(c)) errs.push('check.html: знаменник малої оцінки іншого розміру');
  if (/\.(rc|ex)-score[^{]*\{[^}]*(transform|top:|vertical-align)/.test(c)) errs.push('check.html: оцінка вирівняна хаком');
  if (!c.includes('<span class="ex-verdict">Worth considering</span>')) errs.push('check.html: вердикт не фінальний');
  if (!/\.rc-score\{display:inline-flex;align-items:baseline/.test(c)) errs.push('check.html: оцінка в картках без спільної базової лінії');
  const rl = (fs.readFileSync('result-check.html', 'utf8').match(/\.risk-label\{([^}]*)\}/) || [])[1] || '';
  for (const prop of ['font-size:12px', 'font-weight:600', 'padding:2px 8px', 'border-radius:12px']) if (!rl.includes(prop) || !/\.ex-verdict\{[^}]*/.test(c) || !c.match(/\.ex-verdict\{[^}]*\}/)[0].includes(prop)) errs.push('check.html: бейдж вердикту не стилем risk-label звіту (' + prop + ')');
  if (!/\.ex-rows\{[^}]*grid-auto-rows:1fr;height:100%/.test(c) || !/\.ex-left\{[^}]*display:flex;flex-direction:column;justify-content:space-between/.test(c)) errs.push('check.html: половини demo не вирівняні по висоті за побудовою');
  const i = PAGES['import.html'];
  if ((i.match(/<span class="cost-ic">/g) || []).length !== 5) errs.push('import.html: не всі рядки кошторису з іконкою');
  /* одна батьківська сітка 2x6: кошторис рядки 1-6, авто 1/4, статуси 4-6; без margin-підгонки */
  if (!/\.ex\{display:grid;grid-template-columns:1\.1fr 1fr;grid-template-rows:repeat\(6,minmax\(0,1fr\)\) auto/.test(i)) errs.push('import.html: demo не на одній сітці 2x6 з рівними рядками');
  /* усі шість рядків ліворуч з тим самим вертикальним відступом, підсумок не вищий */
  if (!/\.cost-row\{[^}]*padding:4px 20px/.test(i) || !/\.cost-total\{[^}]*padding:4px 20px/.test(i)) errs.push('import.html: рядки кошторису з різним вертикальним відступом');
  if (!/\.cost\{display:contents\}/.test(i) || !/\.ex-side\{display:contents\}/.test(i) || !/\.ex-rows\{display:contents/.test(i)) errs.push('import.html: обгортки не display:contents, діти не в батьківській сітці');
  for (const k of [1,2,3,4,5]) if (!i.includes('.cost-row:nth-child(' + k + '){grid-row:' + k + '}')) errs.push('import.html: рядок кошторису ' + k + ' без явного grid-row');
  if (!/\.cost-total\{grid-column:1;grid-row:6;[^}]*margin:0;/.test(i)) errs.push('import.html: підсумок не в рядку 6 або з відступами');
  if (!/\.ex-car\{grid-column:2;grid-row:1\/4;/.test(i)) errs.push('import.html: превʼю авто не в рядках 1-3');
  for (const [k, r] of [[1,4],[2,5],[3,6]]) if (!i.includes('.ex-rows li:nth-child(' + k + '){grid-row:' + r + '}')) errs.push('import.html: статус ' + k + ' не в рядку ' + r);
  if (!/<figure class="ex-car"><img class="ex-photo" src="\/demo\/import-main-dodge-challenger\.jpg"[^>]*><figcaption><b>Dodge Challenger<\/b>/.test(i)) errs.push('import.html: demo-розрахунок не Dodge Challenger з фото');
  if (!/<img class="ex-photo" src="\/demo\/check-main-bmw-5-series\.jpg"[\s\S]{0,200}<figcaption><b>BMW 5 Series<\/b>/.test(c)) errs.push('check.html: demo-звіт не BMW 5 Series з фото');
  if (/540i xDrive|BMW X5 2021/.test(c + i)) errs.push('стара назва demo-авто лишилась');
  if (!/name: 'Mercedes EQC'[\s\S]*name: 'Tesla Model Y'[\s\S]*name: 'Audi Q5'/.test(c)) errs.push('check.html: порядок або назви прикладів не ті');
  if (!/name: 'Mazda 6'[\s\S]*name: 'Audi A7'[\s\S]*name: 'Toyota Corolla'/.test(i)) errs.push('import.html: порядок або назви прикладів не ті');
  if (!fs.existsSync('demo') || fs.readdirSync('demo').some(x => x.endsWith('.svg'))) errs.push('у demo/ лишились svg-ілюстрації');
}
/* 7. Check: у прикладі категорії; Import: цифри прикладу сходяться в підсумок */
const rows = (PAGES['check.html'].match(/<b class="ex-k">([^<]+)<\/b>/g) || []).map(x => x.replace(/<[^>]+>/g, ''));
if (rows.join('|') !== 'Mileage|History|Equipment|Price') errs.push('check.html: категорії прикладу: ' + rows.join(', '));
const nums = (PAGES['import.html'].match(/<div class="cost-row">(?:<span class="cost-ic">.*?<\/span>)?<span>[^<]+<\/span><b>\$([\d ]+)<\/b>/g) || []).map(x => +x.match(/\$([\d ]+)<\/b>/)[1].replace(/\s/g, ''));
const total = +((PAGES['import.html'].match(/<div class="cost-total">[\s\S]*?<b>\$([\d ]+)<\/b>/) || [])[1] || '').replace(/\s/g, '');
if (nums.length !== 5) errs.push('import.html: у прикладі не пʼять статей: ' + nums.length);
else if (nums.reduce((a, b) => a + b, 0) !== total) errs.push('import.html: статті прикладу дають ' + nums.reduce((a, b) => a + b, 0) + ', а підсумок ' + total);
if (/max(imum)? bid|Different|Різниця|Разница/i.test(PAGES['import.html'].replace(/<script[\s\S]*?<\/script>/gi, ''))) errs.push('import.html: "максимальна ставка" або "різниця" повернулись у приклад');

/* 8. рендер недавніх: порожній список нічого не показує; три рядки дають три
      клікабельні картки з правильними адресами звітів */
function render(page, fnName, rowsIn) {
  const src = PAGES[page];
  /* тіло функції вирізається за балансом дужок, а не регуляркою: усередині є
     вкладені блоки map(...), і ліниве \}\n обривало код на півдорозі */
  const start = src.indexOf('function ' + fnName + '(rows, demo){');
  if (start < 0) { errs.push(page + ': не знайдено ' + fnName); return null; }
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  const m = [src.slice(start, i + 1)];
  const box = { cls: new Set(), classList: { add(c) { box.cls.add(c); } } };
  const grid = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = {
    document: { getElementById: id => (id === 'recent' ? box : id === 'recentGrid' ? grid : null) },
    window: { calcarLocale: () => 'en-US' }, Date, Number, Array, String, Math, encodeURIComponent,
    t: x => x, esc: x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), RC_PH: '<svg/>',
    nf: n => Number(n).toLocaleString('en-US'),
    timeAgo: () => 'ago',
  };
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\n' + fnName + '(rows)', Object.assign(ctx, { rows: rowsIn }));
  return { shown: box.cls.has('on'), html: grid.innerHTML };
}
for (const [page, fn] of [['check.html', 'renderRecentChecks'], ['import.html', 'renderRecentEstimates']]) {
  const empty = render(page, fn, []);
  if (empty && (empty.shown || empty.html)) errs.push(page + ': порожній список недавніх щось показує');
  const none = render(page, fn, null);
  if (none && none.shown) errs.push(page + ': null замість списку вмикає блок');
}
const rc = render('check.html', 'renderRecentChecks', [
  { id: 'x1', public_id: 'ABC123', created_at: new Date().toISOString(), title: 'BMW 540i 2019', odometer_km: 49000, score: '8.1' },
  { id: 'x2', public_id: null, created_at: new Date().toISOString(), title: 'Audi <Q5> 2018', odometer_km: null, score: null, legacy_score: '5.6' },
  { id: 'x3', public_id: 'Z', created_at: new Date().toISOString(), title: 'C', score: '6' },
  { id: 'x4', public_id: 'Q', created_at: new Date().toISOString(), title: 'D', score: '7' },
]);
if (rc) {
  if (!rc.shown) errs.push('check.html: блок не увімкнувся');
  if ((rc.html.match(/<a class="rc"/g) || []).length !== 3) errs.push('check.html: недавніх має бути максимум 3');
  if (!rc.html.includes('href="/check/ABC123"')) errs.push('check.html: коротка адреса звіту не використана');
  if (!rc.html.includes('href="/result-check.html?id=x2"')) errs.push('check.html: без public_id адреса має бути через id');
  if (!rc.html.includes('rc-score ok"><b>8.1</b><small>/ 10</small>')) errs.push('check.html: оцінка 8.1 не зелена або не компонентом число+знаменник');
  if (!rc.html.includes('rc-score warn"><b>5.6</b>')) errs.push('check.html: легасі-оцінка 5.6 не жовта або не взята з verdict');
  if (rc.html.includes('<Q5>')) errs.push('check.html: назва не екранується');
}
const ri = render('import.html', 'renderRecentEstimates', [
  { id: 'y1', created_at: new Date().toISOString(), title: 'BMW X5 2021', lot_url: 'https://www.copart.com/lot/1', grand: '31840' },
  { id: 'y2', created_at: new Date().toISOString(), title: 'Tesla', lot_url: 'https://www.iaai.com/vehicledetail/2', grand: null },
]);
if (ri) {
  if (!ri.html.includes('href="/result.html?id=y1"')) errs.push('import.html: адреса розрахунку неправильна');
  if (!/Copart/.test(ri.html) || !/IAAI/.test(ri.html)) errs.push('import.html: аукціон не визначено з lot_url');
  if (!ri.html.includes('$31,840')) errs.push('import.html: підсумок не показаний');
  if ((ri.html.match(/rc-sum/g) || []).length !== 1) errs.push('import.html: без знімка підсумку картка мусить бути без суми, а не з нулем');
}

/* 9. головна лишається Check, редиректу на останній продукт немає */
const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
if (!v.rewrites.some(r => r.source === '/' && r.destination === '/check.html')) errs.push('маршрут / не веде на check.html');
for (const [f, s] of Object.entries(PAGES)) if (/last_product|lastProduct|calcar_product/.test(s)) errs.push(f + ': зʼявилась памʼять останнього продукту');

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('лендинги: форма чиста · бейдж · недавні лише з даними, максимум 3, адреси як у кабінеті · приклад сходиться · 3 картки · головна Check');
console.log('LANDING TEST PASSED');
