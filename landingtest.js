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
  /* справжні звіти виграють у прикладів; форма гілки може відрізнятись
     (Check після durable-звітів має ще проміжний гостьовий список) */
  if (!new RegExp('if \\(Array\\.isArray\\(rows\\) && rows\\.length\\)[\\s\\S]{0,200}renderRecent\\w+\\(rows\\)').test(s)) errs.push(f + ': справжні звіти не витісняють приклади');
  if (!new RegExp(ex + '\\(\\);').test(s) || !new RegExp('\\belse\\b[\\s\\S]{0,220}' + ex + '\\(\\);').test(s)) errs.push(f + ': приклади не лишились запасним варіантом');
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
  if (/beta|calcar\.io|Support|About/i.test(foot.replace(/<[^>]+>/g, ''))) errs.push(f + ': у футері зайве (beta/calcar.io/фейкові сторінки)');
  const links = (foot.match(/<a href="([^"]+)"/g) || []).map(x => x.replace(/<a href="([^"]+)"/, '$1'));
  if (links.join('|') !== '/check|/import|/cabinet.html#reports|/privacy|/terms') errs.push(f + ': посилання футера не ті: ' + links.join(', '));
  if (!/<div class="ft-col" id="ftContacts" hidden><b>Contact<\/b><\/div>/.test(foot)) errs.push(f + ': у футері нема прихованої колонки контактів');
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
  const box = { cls: new Set(), classList: { add(c) { box.cls.add(c); }, remove(c) { box.cls.delete(c); } } };
  const grid = { innerHTML: '', querySelectorAll: () => [], removeAttribute() {}, setAttribute() {} };
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

/* ---- поле адреси і блок "Що працює всередині CalCar" ---- */
{
  const home = PAGES['check.html'];
  /* поле: людська дія замість обрізаної адреси */
  if (/placeholder="https?:/.test(home)) errs.push('у полі знову обрізана адреса замість дії');
  if (!/placeholder="Paste a vehicle listing link"/.test(home)) errs.push('нема людського заповнювача поля');
  if (!/<div class="hf-field"><svg /.test(home)) errs.push('нема іконки посилання в полі');
  if (!/For example, a listing from a supported marketplace/.test(home)) errs.push('підпис під полем не оновлений');
  if (/For example, paste a link to an AUTO\.RIA listing/.test(home)) errs.push('старий підпис під полем лишився');
  /* секція йде після "Що перевіряє CalCar" і не дублює її картки */
  const iChecks = home.indexOf('What CalCar checks'), iTech = home.indexOf('What powers CalCar');
  if (!(iChecks > 0 && iTech > iChecks)) errs.push('секція технологій стоїть не після "Що перевіряє CalCar"');
  if (/class="feat"[\s\S]{0,200}Vehicle Vision/.test(home)) errs.push('технології зроблені тими самими картками, що й "Що перевіряє"');
  const tech = home.slice(iTech, home.indexOf('<footer>', iTech));
  /* показуємо лише те, що справді працює в проді */
  for (const name of ['Vehicle Vision', 'Vehicle Memory', 'Model Intelligence', 'Web Search', 'Decision Engine', 'CalCar AI']) {
    if (!tech.includes('<b>' + name + '</b>')) errs.push('нема системи ' + name);
  }
  /* нічого з дорожньої карти: це ще не працює і обіцяти його не можна */
  for (const notLive of ['Vehicle Graph', 'CalCar Data', 'Ask CalCar', 'Market', 'Current Vision']) {
    if (tech.includes(notLive)) errs.push('у блок потрапила нереалізована система: ' + notLive);
  }
  /* композиція: чотири рівні картки, Decision Engine по центру, два
     результати по центру під ним. Симетрія тримається сіткою, не очима */
  if (!/\.arch\{--g:16px;display:grid;grid-template-columns:repeat\(4,1fr\)/.test(home)) errs.push('верхній шар не з чотирьох рівних карток');
  if (!/\.node-engine\{grid-column:2 \/ 4/.test(home)) errs.push('Decision Engine не по центру сітки');
  if (!/\.out-a\{grid-column:1 \/ 3\}/.test(home) || !/\.out-b\{grid-column:3 \/ 5\}/.test(home)) errs.push('нижні картки не симетричні відносно центра');
  /* звʼязки: у тій самій сітці, центри колонок як (100% - 3g)/8 */
  if (!/\.join\{grid-column:1 \/ -1;position:relative/.test(home)) errs.push('звʼязки живуть поза сіткою карток');
  for (const pos of ['\\(100% - 3 \\* var\\(--g\\)\\) \\/ 8', '3 \\* \\(100% - 3 \\* var\\(--g\\)\\) \\/ 8 \\+ var\\(--g\\)', '5 \\* \\(100% - 3 \\* var\\(--g\\)\\) \\/ 8 \\+ 2 \\* var\\(--g\\)', '7 \\* \\(100% - 3 \\* var\\(--g\\)\\) \\/ 8 \\+ 3 \\* var\\(--g\\)']) {
    if (!new RegExp('left:calc\\(' + pos + '\\)').test(home)) errs.push('стійка звʼязку не в центрі колонки: ' + pos.slice(0, 20));
  }
  if (!/\.join\.split i\.h\{left:calc\(\(100% - 3 \* var\(--g\)\) \/ 4 \+ var\(--g\) \/ 2\);right:calc\(\(100% - 3 \* var\(--g\)\) \/ 4 \+ var\(--g\) \/ 2\)\}/.test(home)) errs.push('шина до нижніх карток не в їх центрах');
  if (!/\.join i\.d\{width:1px;left:50%/.test(home)) errs.push('спуск між шарами не по центру');
  /* одна мова карток: без пунктиру і сірої "вимкненої" картки */
  if (/border-style:dashed/.test(home)) errs.push('пунктирна картка результату лишилась');
  if (/\.node-out\{background:var\(--surface-2\)/.test(home)) errs.push('картка результату досі сіра');
  if (!/\.node\{display:flex;gap:12px;background:var\(--card\);border:1px solid var\(--line\)/.test(home)) errs.push('картки перестали бути однією родиною');
  /* фон секції нейтральний, як у решти сторінки */
  if (/\.tech-band/.test(home)) errs.push('лаймова смуга під секцією лишилась');
  if (/tech-flow\{display:grid;grid-template-columns:1\.15fr/.test(home)) errs.push('стара асиметрична композиція лишилась');
  /* телефон: колонка карток і коротка риска між шарами, без геометрії */
  if (!/@media\(max-width:900px\)\{\n\s*\/\*[^*]*\*\/\n\s*\.arch\{grid-template-columns:1fr/.test(home)) errs.push('на телефоні картки не в одну колонку');
  if (!/\.node-engine,\.out-a,\.out-b\{grid-column:1 \/ -1\}/.test(home)) errs.push('на телефоні картки не на всю ширину');
  if (!/\.join i\{display:none\}/.test(home)) errs.push('складна геометрія звʼязків лишилась на телефоні');
  /* потік сигналів: послідовність, запуск у полі зору, пауза під курсором,
     повна тиша за prefers-reduced-motion */
  const flowJs = home.slice(home.indexOf("var arch = document.querySelector('.arch')"), home.indexOf('})();', home.indexOf("var arch = document.querySelector('.arch')")));
  if (!flowJs) errs.push('нема сценарію потоку сигналів');
  if (!/matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/.test(flowJs)) errs.push('потік сигналів не вимикається за prefers-reduced-motion');
  if (!/new IntersectionObserver\(/.test(flowJs) || !/rootMargin: '-12% 0px -12% 0px'/.test(flowJs)) errs.push('потік не привʼязаний до появи секції на екрані');
  if (/threshold: 0\.\d/.test(flowJs)) errs.push('частка висоти як поріг: на телефоні схема вища за екран і цикл не стартує');
  if (!/en\.isIntersecting\) start\(\); else stop\(\)/.test(flowJs)) errs.push('поза екраном цикл не зупиняється');
  /* курсор не втручається: ні паузи, ні підсвічування картки під мишею */
  if (/mouseenter|mouseleave|hovered/.test(flowJs)) errs.push('курсор досі зупиняє або збиває автоматичну послідовність');
  if (/\.node:hover/.test(home)) errs.push('наведення досі підсвічує картку і конкурує з послідовністю');
  if (/requestAnimationFrame|setInterval/.test(flowJs)) errs.push('замість одного таймера зроблено цикл кадрів');
  /* порядок кроків: чотири джерела -> лінії -> Decision Engine -> лінія -> результат -> асистент */
  const steps = (/var STEPS = \[([\s\S]*?)\];/.exec(flowJs) || [])[1] || '';
  const order = (steps.match(/nodes\[\d\]|fan|split/g) || []).join(',');
  if (order !== 'nodes[0],nodes[1],nodes[2],nodes[3],fan,nodes[4],split,nodes[5],nodes[6]') errs.push('порядок підсвічування не за архітектурою: ' + order);
  const times = (steps.match(/, (\d+)\]/g) || []).map(x => parseInt(x.slice(2), 10));
  if (times.length !== 9) errs.push('не девʼять кроків у циклі: ' + times.length);
  if (times.slice(0, 4).some(t => t < 600 || t > 800)) errs.push('верхні картки спалахують не за 600-800 мс: ' + times.slice(0, 4).join());
  if (times[4] < 800 || times[4] > 1000 || times[5] < 800 || times[5] > 1000) errs.push('збіг ліній і Decision Engine не 800-1000 мс');
  if (times[8] < 2000 || times[8] > 3000) errs.push('пауза між циклами не 2-3 с: ' + times[8]);
  const loop = times.reduce((a2, b2) => a2 + b2, 0);
  if (loop < 7000 || loop > 10000) errs.push('цикл не 7-10 с: ' + loop);
  /* активна картка це акцент, а не зсув чи зміна розміру */
  const live = (/\n\s*\.node\.is-live\{([^}]*)\}/.exec(home) || [])[1] || '';
  if (!/border-color:var\(--brand\)/.test(live)) errs.push('активна картка без лаймового акценту');
  if (/transform|width|height|padding|margin|font-size/.test(live)) errs.push('активна картка рухається або змінює розмір');
  if (!/\.join\.is-live i\{background:var\(--brand\)\}/.test(home)) errs.push('звʼязки не беруть участі в потоці');
  if (/opacity:0?\.[0-5]/.test(live)) errs.push('неактивні картки гасяться надто сильно');
  /* відступ між секціями помітно менший */
  /* видимий проміжок над секцією це margin плюс власний padding секції:
     разом мусить лишитись приблизно половина від колишніх 64 + 48 */
  const g1 = parseInt((/\.tech\{margin-top:(\d+)px;padding-top:(\d+)px\}/.exec(home) || [])[1] || '0', 10);
  const g2 = parseInt((/\.tech\{margin-top:\d+px;padding-top:(\d+)px\}/.exec(home) || [])[1] || '0', 10);
  if (!(g1 + g2 > 0 && g1 + g2 <= 56)) errs.push('проміжок над секцією не зменшений приблизно вдвічі: ' + (g1 + g2));
  if (/glow|neon|particle|blur\(|rotate3d|perspective/.test(tech)) errs.push('у блоці зʼявились ефекти поза мовою CalCar');
  /* мікровзаємодії стримані: рамка і іконка, без стрибка картки */
  if (/\.node:hover/.test(home)) errs.push('наведення знову підсвічує картку');
  if (/\.node:hover\{[^}]*transform:translateY\(-[2-9]/.test(home)) errs.push('картки стрибають на hover');
  if (!/transition:[^;]*\.18s ease/.test(home)) errs.push('переходи не плавні 180 мс');
  /* копія каже, що це системи CalCar, а не абстрактний ШІ */
  for (const claim of ["CalCar's AI vision module", "CalCar's memory system", "CalCar's automotive knowledge base", "CalCar's search module", "CalCar's Decision Engine", "CalCar's AI assistant"]) {
    if (!tech.includes(claim)) errs.push('опис не називає систему CalCar: ' + claim);
  }
  for (const hype of ['most advanced', 'unique neural', 'our own AI model', 'proprietary model', 'world-class']) {
    if (tech.toLowerCase().includes(hype)) errs.push('непідтверджена заява в описі: ' + hype);
  }
  /* доступність: фокус на кнопці і на полі лишається видимим */
  if (!/\.btn-primary:focus-visible\{outline:2px solid var\(--ink\)/.test(home)) errs.push('головна кнопка без видимого фокуса');
  if (!/input\[type=text\]:focus\{outline:none;border-color:var\(--brand\)/.test(home)) errs.push('поле втратило акцент фокуса');
  /* словники: описи перекладені, назви систем лишаються продуктовими іменами */
  for (const d of ['i18n/ru.js', 'i18n/ua.js']) {
    const dict = fs.readFileSync(d, 'utf8');
    for (const k of ['Paste a vehicle listing link', 'For example, a listing from a supported marketplace', 'What powers CalCar', 'More than a single AI prompt. Several specialized systems work together on every car.']) {
      if (!dict.includes("'" + k + "':")) errs.push(d + ': нема ключа "' + k + '"');
    }
    for (const name of ['Vehicle Memory', 'Decision Engine']) {
      if (dict.includes("'" + name + "':")) errs.push(d + ': назву системи ' + name + ' переклали, вона мусить лишатись продуктовим імʼям');
    }
  }
}

/* ---- скільки триває перевірка: підказка на головній і час, що йде ---- */
{
  const home = PAGES['check.html'];
  /* типова тривалість це реальна медіана завершених Check, а не вигадка */
  const hint = (/<span class="hf-time">Usually ~(\d+) sec<\/span>/.exec(home) || [])[1];
  if (!hint) errs.push('нема підказки про типову тривалість перевірки');
  else if (+hint < 30 || +hint > 180) errs.push('типова тривалість поза правдоподібним діапазоном: ' + hint);
  if (!/\.hf-time\{[^}]*margin-left:auto/.test(home)) errs.push('підказка про час конкурує з головною кнопкою');
  for (const d of ['i18n/ru.js', 'i18n/ua.js']) {
    const dict = fs.readFileSync(d, 'utf8');
    for (const k of ['Usually ~90 sec', '{n} sec']) if (!dict.includes("'" + k + "':")) errs.push(d + ': нема ключа "' + k + '"');
  }
  /* час у завантажувачі ЙДЕ вперед, рахується на клієнті і зупиняється */
  const loader = home.slice(home.indexOf('function loadingStart()'), home.indexOf('function loadingError('));
  if (!/const secs = Math\.max\(0, Math\.round\(\(Date\.now\(\) - ld\.t0\) \/ 1000\)\);/.test(loader)) errs.push('час рахується не від моменту старту на клієнті');
  if (!/t\('\{n\} sec'\)\.replace\('\{n\}', secs\)/.test(loader)) errs.push('час без локалізованого підпису');
  if (!/ld\.tick = setInterval\(showTime, 1000\)/.test(loader)) errs.push('час не оновлюється щосекунди');
  if (!/clearInterval\(ld\.tick\)/.test(loader)) errs.push('таймер не зупиняється разом із аналізом');
  if (/remaining|залишилось|осталось|countdown/i.test(loader)) errs.push('замість часу, що йде, зроблено зворотний відлік');
  if (/setInterval[^)]*fetch|fetch\([^)]*\)[^;]*;\s*\}, 1000\)/.test(loader)) errs.push('таймер опитує сервер');
  /* завантажувач лишається побайтово однаковим на обох сторінках */
  const block = src => src.slice(src.indexOf('/* progress:start'), src.indexOf('/* progress:end'));
  if (block(home) !== block(fs.readFileSync('result-check.html', 'utf8'))) errs.push('копії завантажувача розійшлись між сторінками');
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('лендинги: форма чиста · бейдж · недавні лише з даними, максимум 3, адреси як у кабінеті · приклад сходиться · 3 картки · головна Check');
console.log('LANDING TEST PASSED');
