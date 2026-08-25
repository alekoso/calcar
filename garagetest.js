/* Гараж: перевірки збірки без браузера */
const fs = require('fs');
const errs = [];
const g = fs.readFileSync('garage.html','utf8');

/* 1. сторінка зібрана коректно */
if ((g.match(/<script/g)||[]).length !== (g.match(/<\/script>/g)||[]).length) errs.push('script-теги не збігаються');
['listView','carView','mAdd','mEntry','fVin','eDate','btnSaveCar','btnSaveEntry','entries','emptyGarage','carList','checkNone','checkDone','noAuth','noCfg','btnFind','manualFields','stepDetails','galEmpty','btnAddPhotos','eExisting','mEntryTitle']
  .forEach(id => { if (!g.includes('id="'+id+'"')) errs.push('нема елемента #'+id); });
if (!g.includes('calcarLang')) errs.push('i18n-двигун не вбудований');
/* ключове: ім'я конфігу має збігатися з реальним config.js та кабінетом */
const cfgName = (fs.readFileSync('config.js','utf8').match(/window\.(CALCAR_[A-Z_]+)/) || [])[1];
if (!cfgName) errs.push('не знайдено імʼя конфігу в config.js');
else {
  if (!g.includes('window.' + cfgName)) errs.push('garage читає не той конфіг, треба window.' + cfgName);
  const cab = fs.readFileSync('cabinet.html','utf8');
  if (!cab.includes('window.' + cfgName)) errs.push('кабінет читає інший конфіг, перевір узгодженість');
}
/* VIN у звітах лежить у data->_meta->>vin */
if (!g.includes("data->_meta->>vin")) errs.push('пошук звіту не за реальним шляхом VIN');
if (!g.includes('DecodeVinValues')) errs.push('нема VIN-декодера');
if (!g.includes("from('garage_vehicles')")) errs.push('нема запитів до garage_vehicles');
if (!g.includes('createSignedUrls')) errs.push('нема підписаних URL для приватних фото');
if (!g.includes('Додано власником')) errs.push('нема позначки джерела');
if (!g.includes('data-edit')) errs.push('нема редагування записів журналу');
if (!g.includes('carFiles.length = 0')) errs.push('баг масиву фото повернувся: carFiles перепризначається');
if (g.includes('recallsBox')) errs.push('recalls мав зникнути зі сторінки');

/* 2. синтаксис основного скрипта */
const scripts = g.split('<script>').slice(1).map(s => s.split('</script>')[0]).filter(s => s.includes('garage_vehicles'));
if (!scripts.length) errs.push('основний скрипт не знайдено');
else {
  fs.writeFileSync('/tmp/gm.js', scripts[0]);
  try { require('child_process').execSync('node --check /tmp/gm.js'); } catch(e){ errs.push('синтаксис основного скрипта: ' + e.message.split('\n')[1]); }
}

/* 3. меню на всіх сторінках */
for (const f of ['garage.html','cabinet.html','check.html','index.html','result-check.html','result.html']) {
  const s = fs.readFileSync(f,'utf8');
  if (!s.includes('href="/garage"')) errs.push('нема пункту Гараж у ' + f);
  /* міст під кнопкою: без нього hover злітає в зазорі і меню закривається */
  if (!s.includes('.acc-wrap::after')) errs.push('нема моста наведення (.acc-wrap::after) у ' + f);
  /* клік по пункту закриває меню: на кабінеті переходу нема і меню висіло */
  if (!s.includes(".closest('.acc-menu a')")) errs.push('нема закриття меню кліком у ' + f);
}

/* 4. rewrites */
const v = JSON.parse(fs.readFileSync('vercel.json','utf8'));
const src = v.rewrites.map(r=>r.source);
if (!src.includes('/garage') || !src.includes('/garage/:id')) errs.push('нема rewrites для гаража');

/* 5. SQL: політики і незмінний created_at */
const q = fs.readFileSync('supabase-garage.sql','utf8');
['garage_vehicles','garage_entries','enable row level security','freeze_created_at','storage.buckets','storage.objects','foldername']
  .forEach(k => { if (!q.includes(k)) errs.push('SQL: нема ' + k); });

/* 6. словники */
for (const f of ['i18n/ru.js','i18n/en.js']) {
  const s = fs.readFileSync(f,'utf8');
  if (!s.includes("'Журнал авто'")) errs.push('нема ключів гаража у ' + f);
}

/* 7. config.js не чіпали */
const { execSync } = require('child_process');
const diff = execSync('git status --porcelain config.js').toString().trim();
if (diff) errs.push('config.js змінено! ' + diff);

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('сторінка · скрипт · меню ×6 · rewrites · SQL · словники · config недоторканий');
console.log('GARAGE TEST PASSED');
