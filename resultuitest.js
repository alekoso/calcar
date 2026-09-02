/* Звіти Check та Import: одна дизайн-система. Check це еталон, тому спільні
   блоки CSS у result.html мусять збігатися з result-check.html побайтово, а
   Import-логіка (ідентифікатори, таблиці, формули) лишатися на місці. */
const fs = require('fs');
const errs = [];
const chk = fs.readFileSync('result-check.html', 'utf8');
const imp = fs.readFileSync('result.html', 'utf8');
const cssOf = s => (s.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
const C = cssOf(chk), I = cssOf(imp);
const rule = (css, sel) => { const i = css.indexOf('\n  ' + sel + '{'); if (i < 0) return null; return css.slice(i + 3, css.indexOf('}', i) + 1); };

/* 1. спільні правила: побайтово ті самі, що в Check */
for (const sel of ['.card', '.card-head', '.card-head h2', '.card-body', '.hint', '.sec-meta', '.badge', '.badge.green', '.badge.blue', '.badge.amber', '.badge.red',
  '.btn-back', '.btn-chat', '.btn-primary', '.ext-link', '.photo-strip', '.photo-strip img', '.lot-title', '.lot-title h1',
  '.spec-rows', '.spec-row', '.spec-l', '.spec-v', '.spec-v.price', '#titleChips', '.id-chip', '.id-chip .id-l', '.id-chip .id-v', '.copy-btn',
  '.risk-badge', '.risk-label', '.dot', '.flags', '.flag', '.dmg-note', '.issue', '.issue-t', '.issue-t b', '.issue p', '.final-actions',
  'footer', '.footer-in', '.ft-brand', '.ft-cols', '.ft-col', '.ft-col a', '.footer-bottom', '.wrap', '.topbar']) {
  const a = rule(C, sel), b = rule(I, sel);
  if (!a) { errs.push('в еталоні Check нема правила ' + sel); continue; }
  if (!b) { errs.push('Import без спільного правила ' + sel); continue; }
  if (a !== b) errs.push('правило ' + sel + ' розійшлось між Check і Import');
}
/* 2. каркас: футер притиснутий до низу, той самий футер, ті самі маршрути */
if (!/body\{min-height:100vh;display:flex;flex-direction:column\}/.test(I)) errs.push('Import без каркаса з футером донизу');
if (/padding-bottom:32px/.test(I)) errs.push('Import тримає старий відступ замість футера');
const footerOf = s => (s.match(/<footer>[\s\S]*?<\/footer>/) || [''])[0];
if (!footerOf(imp)) errs.push('у прорахунку Import нема футера');
else if (footerOf(imp) !== footerOf(chk)) errs.push('футер Import відрізняється від Check');
/* 3. старі Import-only візуальні мови прибрані */
for (const dead of ['.lot-meta{', '.photos{', '.photos .ph', '.verdict-grid', '.v-cell', '.spec-grid', '.v-actions', 'background:#FFF7E8', '#E9C98B', '#8A5A13', '.chip.gold::before', '.spec-rows.in-body']) {
  if (I.includes(dead)) errs.push('у Import лишилось старе правило: ' + dead);
}
if (!/\.subtotal\{[\s\S]*?background:var\(--brand-soft\)/.test(I)) errs.push('підсумки секцій не soft-lime');
if (!/\.total-v\{font-size:36px/.test(I)) errs.push('фінальна сума не домінує');
if (!/@media\(max-width:760px\)\{\n\s*\.est-head\{display:none\}/.test(I)) errs.push('мобільний брейкпоінт таблиць не 760px, як у Check');
if (/@media\(max-width:720px\)/.test(I)) errs.push('лишився брейкпоінт 720px');
/* 4. Import-логіка на місці: ідентифікатори, рядки таблиць, формули */
for (const id of ['bid', 'usState', 'auctionFees', 'usDelivery', 'freight', 'port', 'duty', 'excise', 'vat', 'broker', 'uaFinal', 'partRows', 'workRows', 'maintRows', 'addPart', 'addWork', 'addMaint', 'partsTotal', 'worksTotal', 'maintTotal', 'logisticsTotal', 'grandTotal', 'noBidNote', 'safetyStrike', 'riskBadge', 'riskScore', 'flagsEl', 'dmgNote', 'zonesEl', 'issuesList', 'chipsEl', 'lotMeta', 'lotTitle', 'lotLink', 'titleChips', 'photosGrid', 'eqLegend', 'lotObs', 'lotObsText']) {
  if (!imp.includes('id="' + id + '"')) errs.push('зник елемент #' + id);
}
for (const cls of ["className = 'est-row'", "'est-row simple'", 'class="toggle"', 'class="seg"', 'class="money"', 'class="del"', 'class="name-input"', 'class="conf sure"', 'class="prem-badge"']) {
  if (!imp.includes(cls)) errs.push('зник компонент кошторису ' + cls);
}
if (!/function computeRisk\(\)/.test(imp) || !/s \+= w\(F\.str\) \* 2\.0;/.test(imp)) errs.push('формула ризику змінена');
if (!imp.includes('under_key_ua: repair + logistics')) errs.push('формула під ключ змінена');
/* 5. подача картки авто, комплектації і слабких місць: паттерни Check */
if (!/<div class="spec-rows" id="lotMeta">/.test(imp)) errs.push('метадані лота не в spec-rows');
if (!/<div class="photo-strip" id="photosGrid"/.test(imp)) errs.push('фото лота не стрічкою');
if (!/chip\(t\('Lot'\), String\(DATA\._meta\.lot_number\)\)/.test(imp)) errs.push('номер лота не identity-чіп');
if (imp.includes('id="specGrid"')) errs.push('двигун/коробка/привід/версія лишились у комплектації');
for (const k of ["t('Engine')", "t('Gearbox')", "t('Drivetrain')", "t('Trim')"]) if (!new RegExp('lotSpec\\.push\\(\\[' + k.replace(/[()]/g, '\\$&')).test(imp)) errs.push('у картці авто нема характеристики ' + k);
for (const dead of ['id="lotBadge"', 'id="modeHint"', "t('read from photos')", "t('AI estimate')"]) if (imp.includes(dead)) errs.push('службова позначка лишилась у картці авто: ' + dead);
if (!/id="lotObs"/.test(imp) || !/What we noticed in the photos/.test(imp)) errs.push('нема спостереження з фото');
if (!/riskBadge'\)\.style\.display = 'none'/.test(imp)) errs.push('ризик покупки показується як оцінка пошкоджень');
if (!/\.total-break\{margin-top:12px;padding-top:10px;border-top:1px solid #DCEFAE/.test(imp)) errs.push('розбивка підсумку не під головною сумою');
if (imp.includes('.total-side')) errs.push('лишилась стара розбивка праворуч');
if (!/class="issue"><div class="issue-t">/.test(imp)) errs.push('слабкі місця не компонентом Check');
if (!/<span class="sec-meta">Pick a category/.test(imp)) errs.push('підписи секцій не sec-meta');
if (imp.includes('class="hint" style="margin-left:auto"')) errs.push('лишились старі підписи секцій');
if (!/id="importAskAi"/.test(imp) || !/CalCarChat\.open\(\)/.test(imp)) errs.push('фінальні дії без "Запитати CalCar"');
if (imp.includes('\u2014')) errs.push('довге тире в result.html');

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('спільні правила побайтово · футер один · старі мови прибрані · Import-логіка на місці');
console.log('RESULT UI TEST PASSED');
