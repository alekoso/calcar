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
/* публікації йдуть окремими маршрутами; /garage/:id лишається сторінкою авто і стоїть після них */
if (!src.includes('/garage/post/:id') || !src.includes('/garage/article/:slug')) errs.push('нема rewrites для сторінок публікацій');
if (src.indexOf('/garage/post/:id') > src.indexOf('/garage/:id')) errs.push('маршрут публікації стоїть після /garage/:id');
const postRule = v.rewrites.find(r => r.source === '/garage/post/:id');
if (!postRule || postRule.destination !== '/garage.html?post=:id') errs.push('/garage/post/:id веде не в garage.html?post=');
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

/* 8. Garage як продукт: головна навігація, центрована стрічка, мій гараж */
['garageHome','paneFeed','paneGarage','feedSearch','feedQuery','feed','feedList','feedEmpty','feedError']
  .forEach(id => { if (!g.includes('id="'+id+'"')) errs.push('нема елемента стрічки #'+id); });
if (!/class="g-tab on"[^>]*data-tab="feed"/.test(g)) errs.push('стрічка не відкрита за замовчуванням');
if (!/<div class="g-seg" role="tablist"/.test(g)) errs.push('нема сегментованого перемикача продукту');
if ((g.match(/class="g-tab/g) || []).length !== 2) errs.push('у головній навігації не два розділи');
if (!/\.g-seg\{[^}]*grid-template-columns:1fr 1fr/.test(g)) errs.push('розділи навігації не рівної ширини');
/* сегментований перемикач без чорної обводки і зеленої крапки */
if (/\.g-tab\.on::before/.test(g)) errs.push('у навігації гаража повернулась зелена крапка');
if (/\.g-seg\{[^}]*border:1px solid/.test(g)) errs.push('контейнер навігації знову з обводкою');
if (!/\.g-tab\.on\{background:var\(--card\);color:var\(--ink\);border-color:var\(--line\)/.test(g)) errs.push('активний сегмент не біла пігулка з мʼякою межею');
if (!/\.g-tab:focus-visible\{outline/.test(g)) errs.push('клавіатурний фокус навігації втрачено');
/* сторінка публікації: превʼю у стрічці веде на повну публікацію, маршрути не бʼються з /garage/:id */
if (!g.includes('id="postView"')) errs.push('нема контейнера сторінки публікації');
/* rewrite серверний: у браузері лишається /garage/post/:id, тому публікацію впізнаємо з pathname */
if (!/PATH\.match\(\/\^\\\/garage\\\/\(\?:post\|article\)\\\/\(\[\^\\\/\?#\]\+\)\/\)/.test(g)) errs.push('публікація не впізнається з pathname, на проді після rewrite вона не відкриється');
if (!/function postHref\(p\) \{ return p\.post_type === 'article' \? '\/garage\/article\/' \+ p\.slug : '\/garage\/post\/' \+ p\.id; \}/.test(g)) errs.push('картка стрічки не веде на сторінку публікації');
if (!/class="post-link" href="/.test(g)) errs.push('заголовок публікації не посилання');
if (!/function renderDetail\(p\)/.test(g) || !/pd-lead|sections/.test(g)) errs.push('нема повної сторінки публікації і статті');
if (!/slug: 'bmw-b58-after-100000-km'/.test(g)) errs.push('у статті нема slug');
/* "Запитати CalCar" = той самий помічник із фокусом, а не окремий чат */
if (!/CalCarChat\.open\(\{ focus: askFocus\(p\) \}\)/.test(g)) errs.push('кнопка під публікацією не передає фокус спільному помічнику');
if (/intro:|askSuggestions/.test(g)) errs.push('у гаражі лишились окремі підказки або інтро окремого чату');
if ((g.match(/data-action="ask-calcar">/g) || []).length !== 2) errs.push('CTA під публікацією має бути одна на картку і одна на сторінці публікації');
if (!/\.g-nav\{position:sticky;top:var\(--hdr-h\)/.test(g)) errs.push('навігація не липне під шапкою');
if (!g.includes('#garageHome [hidden]{display:none!important}')) errs.push('hidden не перемагає display:flex: на сторінці авто видно навігацію стрічки');
if (!/--hdr-h:56px/.test(g)) errs.push('нема токена висоти шапки');
/* стара конструкція: великий заголовок і підзаголовок окремим hero */
if (/<h1>Garage<\/h1>/.test(g)) errs.push('повернувся hero-заголовок Гаража');
if (/<div class="sub">Car owners community<\/div>/.test(g)) errs.push('підзаголовок знову займає окремий hero');
/* стрічка по центру, а не притиснута ліворуч */
if (!/\.feed-shell\{display:grid;grid-template-columns:minmax\(0,780px\);justify-content:center\}/.test(g)) errs.push('стрічка не центрована');
if (/\.feed-col\{max-width:760px\}/.test(g)) errs.push('стрічка знову притиснута ліворуч');
if (!/id="listView"[\s\S]*?<h2 class="g-h2">My cars<\/h2>\s*<div class="sub">Your cars and their history<\/div>/.test(g)) errs.push('"Мій гараж" без заголовка "My cars / Your cars and their history"');
if (!g.includes('href="/garage#garage">← My garage')) errs.push('повернення зі сторінки авто веде не в "Мій гараж"');
if (!g.includes('placeholder="Search cars, problems, repairs or owner experiences"')) errs.push('нема пошуку по стрічці');
if (!g.includes('data-feed="for-you"') || !g.includes('data-feed="following"')) errs.push('нема навігації стрічки Для тебе / Підписки');
/* другорядні фільтри мусять лишатися слабшими за головний перемикач */
if (/\.feed-nav-btn\.on\{background:var\(--ink\)/.test(g)) errs.push('фільтри стрічки сперечаються з головною навігацією');
if (!g.includes("dispatchEvent(new CustomEvent('garage:vehicles'")) errs.push('основний скрипт не віддає авто власника стрічці');
/* картка: однакова геометрія шапки, без повторюваної таблиці, з обмеженим фото */
if (!/\.post-head\{display:grid;grid-template-columns:40px minmax\(0,1fr\) auto/.test(g)) errs.push('шапки постів не мають спільної геометрії');
if (/\.post-facts/.test(g)) errs.push('повторювана таблиця Пробіг/Тип/Вартість/Робота повернулась');
if (!/\.post-photos img\{[^}]*max-height:320px/.test(g)) errs.push('висота фото у стрічці не обмежена');
if (!/-webkit-line-clamp:4/.test(g)) errs.push('довгий текст поста не обрізаний до превʼю');

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
    if (!/window\.CalCarChat\.open\(/.test(feedSrc)) errs.push('"Запитати CalCar" не відкриває спільний чат');
    if (!/page_type: 'garage_feed'/.test(feedSrc) || !/content_type:/.test(feedSrc)) errs.push('контекст публікації не їде в чат');
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
