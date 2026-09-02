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
if (!g.includes('Added by owner')) errs.push('нема позначки джерела');
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

/* 3а. шапки: правий блок у третій колонці сітки, однаково на пʼяти grid-сторінках.
   result.html живе на flex із margin-left:auto, це окрема архітектура шапки звіту */
const HDR = '.header-right{margin-left:0;grid-column:3;justify-self:end;display:flex;align-items:center;gap:16px;font-size:13px}';
for (const f of ['garage.html','cabinet.html','check.html','import.html','result-check.html']) {
  if (!fs.readFileSync(f,'utf8').includes(HDR)) errs.push('шапка розійшлася: нема канонічного header-right у ' + f);
}
if (!fs.readFileSync('result.html','utf8').includes('.header-right{margin-left:auto;')) errs.push('flex-шапка result.html зламана');

/* 3. меню на всіх сторінках */
for (const f of ['garage.html','cabinet.html','check.html','import.html','result-check.html','result.html']) {
  const s = fs.readFileSync(f,'utf8');
  if (!s.includes('href="/garage"')) errs.push('нема пункту Гараж у ' + f);
  /* міст під кнопкою: без нього hover злітає в зазорі і меню закривається */
  if (!s.includes('.acc-wrap::after')) errs.push('нема моста наведення (.acc-wrap::after) у ' + f);
  /* клік по пункту закриває меню: на кабінеті переходу нема і меню висіло */
  if (!s.includes(".closest('.acc-menu a')")) errs.push('нема закриття меню кліком у ' + f);
  /* вітрина = лише Check: перемикач продуктів знятий, редирект-пастка теж */
  if (s.includes('class="switch"')) errs.push('перемикач продуктів повернувся у ' + f);
  if (s.includes('calcarProduct')) errs.push('редирект за calcarProduct повернувся у ' + f);
  /* плашок Пригін/Перевірка більше нема ніде: продукт на вітрині один */
  if (s.includes('kind-badge')) errs.push('плашка kind-badge повернулась у ' + f);
  if (s.includes("t('Пригін')")) errs.push('плашка Пригін повернулась у ' + f);
}

/* 4. rewrites */
const v = JSON.parse(fs.readFileSync('vercel.json','utf8'));
const src = v.rewrites.map(r=>r.source);
/* головна це Check для всіх. ПАСТКА: rewrites у Vercel застосовуються лише
   коли шлях не збігся з файловою системою, тому фізичний index.html у корені
   мовчки перекриває правило "/" і головна стає Import */
const rootRule = v.rewrites.find(r => r.source === '/');
if (!rootRule || rootRule.destination !== '/check.html') errs.push('маршрут / не веде на check.html');
if (fs.existsSync('index.html')) errs.push('у корені зʼявився index.html: він перекриє rewrite "/" і головна стане Import');
const impRule = v.rewrites.find(r => r.source === '/import');
if (!impRule || !fs.existsSync(impRule.destination.slice(1))) errs.push('/import веде на неіснуючий файл');
if (!src.includes('/garage') || !src.includes('/garage/:id')) errs.push('нема rewrites для гаража');
/* Import прибраний з вітрини, але живий: прямі посилання і закладки працюють */
if (!src.includes('/import')) errs.push('зник rewrite /import: закладки Import помруть');

/* 5. SQL: політики і незмінний created_at */
const q = fs.readFileSync('supabase-garage.sql','utf8');
['garage_vehicles','garage_entries','enable row level security','freeze_created_at','storage.buckets','storage.objects','foldername']
  .forEach(k => { if (!q.includes(k)) errs.push('SQL: нема ' + k); });

/* 6. словники */
for (const f of ['i18n/ru.js','i18n/ua.js']) {
  const s = fs.readFileSync(f,'utf8');
  if (!s.includes("'Service log'")) errs.push('нема ключів гаража у ' + f);
}

/* 7. config.js не чіпали */
const { execSync } = require('child_process');
const diff = execSync('git status --porcelain config.js').toString().trim();
if (diff) errs.push('config.js змінено! ' + diff);

/* 8. Garage як продукт: стрічка спільноти + мій гараж, без бекенду публікацій */
['garageHome','paneFeed','paneGarage','feedSearch','feedQuery','feed','feedList','feedEmpty','feedError']
  .forEach(id => { if (!g.includes('id="'+id+'"')) errs.push('нема елемента стрічки #'+id); });
if (!/class="g-tab on"[^>]*data-tab="feed"/.test(g)) errs.push('стрічка не відкрита за замовчуванням');
if (!g.includes('<div class="sub">Car owners community</div>')) errs.push('інтро гаража не "Car owners community"');
if (!/id="listView"[\s\S]*?<h2 class="g-h2">My cars<\/h2>\s*<div class="sub">Your cars and their history<\/div>/.test(g)) errs.push('"Мій гараж" без заголовка "My cars / Your cars and their history"');
if (!g.includes('href="/garage#garage">← My garage')) errs.push('повернення зі сторінки авто веде не в "Мій гараж"');
if (!g.includes('placeholder="Search cars, problems, repairs or owner experiences"')) errs.push('нема пошуку по стрічці');
if (!g.includes('data-feed="for-you"') || !g.includes('data-feed="following"')) errs.push('нема навігації стрічки Для тебе / Підписки');
if (!g.includes("dispatchEvent(new CustomEvent('garage:vehicles'")) errs.push('основний скрипт не віддає авто власника стрічці');
/* мовне меню: той самий компонент, що на Check/Import, без Garage-варіанта */
{
  const chk = fs.readFileSync('check.html','utf8');
  for (const sel of ['.lang-btn{', '.lang-btn:hover{', '.lang-btn svg{', '.lang-menu{', '.lang-menu button{', '.lang-menu button.on i{']) {
    const pick = src => { const i = src.indexOf('  ' + sel); return i < 0 ? null : src.slice(i, src.indexOf('}', i) + 1); };
    const a = pick(chk), b = pick(g);
    if (!a || !b || a !== b) errs.push('мовне меню гаража відрізняється від Check: ' + sel);
  }
  if (/\.lang-btn\{[^}]*border-radius:20px/.test(g)) errs.push('у гаража лишилась стара pill-обводка мови');
}
/* скрипт стрічки: синтаксис, демо-пости, жодних записів у БД і жодних вигаданих лайків */
{
  const feedSrc = g.split('<script>').slice(1).map(x => x.split('</script>')[0]).find(x => x.includes('DEMO_POSTS'));
  if (!feedSrc) errs.push('скрипт стрічки не знайдено');
  else {
    if (/\.insert\(|\.upsert\(|from\('garage|fetch\(|XMLHttpRequest/.test(feedSrc)) errs.push('скрипт стрічки ходить у БД або API: демо-пости мають лишатися статичними');
    if (/likes|comments|reposts|followers/i.test(feedSrc)) errs.push('у стрічці зʼявились соціальні лічильники без бекенду');
    const vm = require('vm');
    const win = { t: x => x, calcarLocale: () => 'uk-UA', addEventListener(){}, dispatchEvent(){}, CustomEvent: function(){}, history: {}, URLSearchParams: URLSearchParams };
    const ctx = { window: win, document: { getElementById: () => null, querySelectorAll: () => [] }, location: { pathname: '/garage', search: '', hash: '' }, URLSearchParams, Number, String, Math, Promise, Date, console, history: {} };
    ctx.addEventListener = win.addEventListener;
    try {
      vm.runInNewContext(feedSrc, ctx);
      const F = win.CalCarFeed;
      if (!F) errs.push('стрічка не експортує CalCarFeed для тестів');
      else {
        const posts = F.DEMO_POSTS;
        if (posts.length < 5 || posts.length > 7) errs.push('демо-постів має бути 5-7, є ' + posts.length);
        if (posts.filter(p => p.post_type === 'article').length !== 1) errs.push('у демо має бути рівно одна стаття CalCar');
        const types = new Set(posts.map(p => p.post_type));
        for (const need of ['service','repair','issue','experience','upgrade']) if (!types.has(need)) errs.push('нема демо-поста типу ' + need);
        for (const p of posts) {
          if (!p.demo) errs.push(p.id + ': демо-пост не позначений demo:true');
          if (!F.POST_TYPES[p.post_type]) errs.push(p.id + ': невідомий post_type ' + p.post_type);
          if (p.post_type !== 'article' && !(p.vehicle && p.vehicle.make)) errs.push(p.id + ': пост без авто');
          if (!('visibility' in p) || !('published_at' in p)) errs.push(p.id + ': нема полів visibility/published_at майбутнього owner_post');
          for (const ph of (p.photos || [])) if (!fs.existsSync(ph.src.slice(1))) errs.push(p.id + ': фото не існує ' + ph.src);
          if (Object.keys(p).some(k => /like|comment/i.test(k))) errs.push(p.id + ': вигадані лайки/коментарі');
        }
        if (!F.matchPost(posts[0], '')) errs.push('порожній запит має пропускати всі пости');
        if (!F.matchPost(posts[0], 'porsche 153')) errs.push('пошук не знаходить по авто і пробігу');
        if (F.matchPost(posts[0], 'lamborghini')) errs.push('пошук знаходить те, чого нема');
        if (F.feeds.join() !== 'for-you,following') errs.push('джерела стрічки не for-you/following');
      }
    } catch (e) { errs.push('скрипт стрічки впав: ' + e.message); }
  }
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('сторінка · скрипт · меню ×6 · rewrites · SQL · словники · config недоторканий · стрічка: вкладки, демо-пости без БД, мова як у Check');
console.log('GARAGE TEST PASSED');
