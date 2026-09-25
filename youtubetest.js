/* Відео про модель: необовʼязкове збагачення звіту Check.
   Тест тримає головне: запити детерміновані і мовні, двигун потрапляє лише
   в запит про проблеми і лише коли відомий, слабкі чи чужі відео в добірку
   не лізуть, а будь-яка невдача YouTube дає порожній список і схований блок,
   не чіпаючи сам звіт. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const errs = [];
const page = fs.readFileSync('result-check.html', 'utf8');

const vid = (id, title, extra = {}) => Object.assign({
  id, title, channel: 'Auto Channel', channel_id: 'ch-' + id, duration_s: 900, views: 50000, intents: ['review'],
}, extra);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_yt_'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'youtube.js'), fs.readFileSync('api/youtube.js', 'utf8'));
  const Y = await import('file://' + path.join(dir, 'youtube.js'));

  /* ---------- 1. ідентичність моделі ---------- */
  const m550 = Y.buildIdentity({ title: 'BMW M550i 2018', make: 'BMW', model: 'M550i', generation: 'G30', engine_code: 'N63' });
  if (m550.base !== 'BMW M550i G30') errs.push('ідентичність M550i не "BMW M550i G30": ' + m550.base);
  if (m550.withEngine !== 'BMW M550i G30 N63') errs.push('двигун не доданий до ідентичності для запиту про проблеми: ' + m550.withEngine);
  /* рік не звужує пошук */
  if (/\b(19|20)\d{2}\b/.test(m550.base)) errs.push('рік потрапив у пошуковий запит');
  /* сирий заголовок оголошення не використовуємо: беремо нормалізовану назву звіту */
  if (!/const title = clean\(\(D\.vehicle \|\| \{\}\)\.title \|\| ''\);/.test(page)) errs.push('сторінка бере ідентичність не з нормалізованої назви звіту');
  /* покоління з площадки буває сміттям */
  if (Y.validGeneration('Base') || Y.validGeneration('Sedan') || Y.validGeneration('повний привід')) errs.push('сміттєве покоління прийняте за код платформи');
  for (const g of ['G30', 'W205', '958.1', 'TL', 'f10']) if (!Y.validGeneration(g)) errs.push('код платформи відкинуто: ' + g);
  if (Y.buildIdentity({ title: 'Porsche Cayenne GTS 2013', generation: '958.1' }).base !== 'Porsche Cayenne GTS 958.1') errs.push('Cayenne: покоління не додане');
  /* двигун лише зі структурного декодера і лише валідний код */
  if (Y.validEngineCode('') || Y.validEngineCode('petrol') || Y.validEngineCode('2.0 l petrol plug-in hybrid')) errs.push('код двигуна вигаданий з тексту');
  if (Y.validEngineCode('N63') !== 'N63' || Y.validEngineCode('g4kj') !== 'G4KJ') errs.push('справжній код двигуна відкинуто');
  /* покоління вже в назві не дублюється */
  if (Y.buildIdentity({ title: 'Hyundai Tucson TL 2019', generation: 'TL' }).base !== 'Hyundai Tucson TL') errs.push('покоління продубльоване в ідентичності');

  /* ---------- 2. три запити, мова звіту, шаблони без моделі ---------- */
  const q = (id, lang) => Y.buildQueries(id, lang).map(x => x.q);
  const ru = q(m550, 'ru'), ua = q(m550, 'ua'), en = q(m550, 'en');
  if (ru.join('|') !== 'BMW M550i G30 обзор|BMW M550i G30 N63 проблемы|BMW M550i G30 опыт владения') errs.push('RU-запити не за шаблоном: ' + ru.join('|'));
  if (ua.join('|') !== 'BMW M550i G30 огляд|BMW M550i G30 N63 проблеми|BMW M550i G30 досвід володіння') errs.push('UA-запити не за шаблоном: ' + ua.join('|'));
  if (en.join('|') !== 'BMW M550i G30 review|BMW M550i G30 N63 common problems|BMW M550i G30 ownership review') errs.push('EN-запити не за шаблоном: ' + en.join('|'));
  if (q(m550, 'de').join('|') !== en.join('|')) errs.push('невідома мова не падає на англійські шаблони');
  /* двигун лише у запиті про проблеми */
  const engQ = Y.buildQueries(m550, 'ru').filter(x => x.q.includes('N63')).map(x => x.intent);
  if (engQ.join() !== 'problems') errs.push('двигун потрапив не лише в запит про проблеми: ' + engQ.join());
  /* двигун невідомий: його нема в жодному запиті */
  const noEng = Y.buildIdentity({ title: 'BMW 530e 2018', generation: 'G30' });
  if (noEng.withEngine !== noEng.base) errs.push('без коду двигуна ідентичність розійшлась');
  if (q(noEng, 'ru').some(x => /N6|B4|engine/i.test(x))) errs.push('без даних про двигун у запит щось дописали');
  const src = fs.readFileSync('api/youtube.js', 'utf8');
  if (/openai|gpt|chat\/completions/i.test(src)) errs.push('у відео підключили модель: шаблони мусять бути детермінованими');

  /* ---------- 3. фільтр, ранжування, різноманітність ---------- */
  const id = m550;
  /* чуже відео без моделі в заголовку не проходить */
  const unrelated = Y.selectVideos([vid('u1', 'Топ 10 самых надёжных авто 2024', { views: 5000000 })], id);
  if (unrelated.length) errs.push('відео без моделі в заголовку потрапило в добірку');
  /* Shorts і прямі ефіри відсіюються */
  const shorts = Y.selectVideos([vid('s1', 'BMW M550i G30 обзор', { duration_s: 45 }), vid('s2', 'BMW M550i G30 стрим', { live: true })], id);
  if (shorts.length) errs.push('Shorts або прямий ефір потрапили в добірку');
  /* віральне generic-відео не обходить точне відео про цю версію */
  const rank = Y.selectVideos([
    vid('gen', 'BMW 5 серии обзор', { views: 9000000 }),
    vid('exact', 'BMW M550i G30 обзор и проблемы N63', { views: 40000, intents: ['review', 'problems'] }),
  ], id);
  if (!rank.length || rank[0].id !== 'exact') errs.push('віральне generic-відео обійшло точне: ' + JSON.stringify(rank.map(v => v.id)));
  /* перегляди вирішують між однаково релевантними */
  const pop = Y.selectVideos([
    vid('low', 'BMW M550i G30 обзор от владельца', { views: 1000, channel_id: 'a' }),
    vid('high', 'BMW M550i G30 обзор на треке', { views: 900000, channel_id: 'b' }),
  ], id);
  if (pop[0].id !== 'high') errs.push('перегляди не впливають на порядок однаково релевантних');
  /* те саме відео в кількох запитах показуємо один раз */
  const dup = Y.selectVideos([
    vid('same', 'BMW M550i G30 обзор', { intents: ['review'] }),
    vid('same', 'BMW M550i G30 обзор', { intents: ['problems'] }),
    vid('same', 'BMW M550i G30 обзор', { intents: ['ownership'] }),
  ], id);
  if (dup.length !== 1) errs.push('дубль того самого відео показаний кілька разів');
  if (dup[0].intents.join() !== 'review,problems,ownership') errs.push('наміри дубля не обʼєднані');
  /* очевидний перезалив з тим самим заголовком */
  const reup = Y.selectVideos([vid('r1', 'BMW M550i G30 обзор', { channel_id: 'a' }), vid('r2', 'BMW M550i G30 обзор', { channel_id: 'b' })], id);
  if (reup.length !== 1) errs.push('перезалив з тим самим заголовком не прибраний');
  /* більше шести кандидатів: віддаємо максимум шість */
  const many = Y.selectVideos(Array.from({ length: 12 }, (_, i) => vid('v' + i, 'BMW M550i G30 обзор частина ' + i, { channel_id: 'c' + i, views: 10000 * (i + 1) })), id);
  if (many.length !== 6) errs.push('віддано не 6 відео, а ' + many.length);
  /* лише два придатних: слабкими не добиваємо */
  const two = Y.selectVideos([
    vid('t1', 'BMW M550i G30 обзор', { channel_id: 'a' }),
    vid('t2', 'BMW M550i G30 проблемы N63', { channel_id: 'b', intents: ['problems'] }),
    vid('t3', 'Обзор кроссоверов 2020', { channel_id: 'c', views: 3000000 }),
  ], id);
  if (two.length !== 2) errs.push('добірку добили слабким відео: ' + JSON.stringify(two.map(v => v.id)));
  /* різноманітність намірів: огляд, проблеми, досвід у перших результатах */
  const diverse = Y.selectVideos([
    vid('rev1', 'BMW M550i G30 обзор', { channel_id: 'a', views: 800000 }),
    vid('rev2', 'BMW M550i G30 обзор динамики', { channel_id: 'b', views: 700000 }),
    vid('rev3', 'BMW M550i G30 обзор салона', { channel_id: 'd', views: 600000 }),
    vid('prob', 'BMW M550i G30 проблемы N63', { channel_id: 'e', views: 120000, intents: ['problems'] }),
    vid('own', 'BMW M550i G30 опыт владения год', { channel_id: 'f', views: 90000, intents: ['ownership'] }),
  ], id, { max: 3 });
  const kinds = diverse.flatMap(v => v.intents);
  for (const need of ['review', 'problems', 'ownership']) if (!kinds.includes(need)) errs.push('у трьох перших нема наміру ' + need);
  /* один канал не забирає всі слоти */
  const oneCh = Y.selectVideos(Array.from({ length: 6 }, (_, i) => vid('c' + i, 'BMW M550i G30 обзор ' + i, { channel_id: 'same', views: 100000 })), id);
  if (oneCh.length > 2) errs.push('один канал зайняв більше двох слотів: ' + oneCh.length);
  /* тривалість з ISO-8601 */
  if (Y.parseDuration('PT12M30S') !== 750 || Y.parseDuration('PT1H2M3S') !== 3723 || Y.parseDuration('bad') !== null) errs.push('тривалість розібрана неправильно');
  if (!(Y.popularity(0) === 0 && Y.popularity(10000000) === 1 && Y.popularity(1000) > 0)) errs.push('нормалізація переглядів не логарифмічна 0..1');

  /* ---------- 4. ендпоінт: ключ, помилки, кеш ---------- */
  const res = () => { const r = { code: 0, h: {}, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.setHeader = (k, v) => { r.h[k.toLowerCase()] = v; }; return r; };
  const query = { title: 'BMW M550i 2018', generation: 'G30', engine_code: 'N63', lang: 'ru' };
  const calls = [];
  const okFetch = async (u) => {
    u = String(u); calls.push(u);
    if (u.includes('/search?') || u.includes('/search')) {
      const qq = new URL(u).searchParams.get('q');
      const n = qq.includes('проблемы') ? 'p' : qq.includes('опыт') ? 'o' : 'r';
      return { ok: true, json: async () => ({ items: [1, 2].map(i => ({ id: { videoId: n + i }, snippet: { title: 'BMW M550i G30 ' + qq, channelTitle: 'Chan ' + n, channelId: 'ch' + n + i, publishedAt: '2024-05-01T00:00:00Z', liveBroadcastContent: 'none' } })) }) };
    }
    const ids = new URL(u).searchParams.get('id').split(',');
    return { ok: true, json: async () => ({ items: ids.map(i => ({ id: i, snippet: { title: 'BMW M550i G30 обзор ' + i, channelTitle: 'Chan ' + i[0], thumbnails: { medium: { url: 'https://i.ytimg.com/vi/' + i + '/mq.jpg' } }, liveBroadcastContent: 'none', publishedAt: '2024-05-01T00:00:00Z' }, contentDetails: { duration: 'PT11M' }, statistics: { viewCount: '123456' } })) }) };
  };

  /* 11. нема ключа: порожньо і жодного запиту назовні */
  delete process.env.YOUTUBE_API_KEY;
  global.fetch = async () => { throw new Error('мережа не мала використовуватись без ключа'); };
  let r1 = res();
  const quiet = async fn => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
  await quiet(() => Y.default({ method: 'GET', query }, r1));
  if (r1.code !== 200 || !r1.body || r1.body.videos.length) errs.push('без ключа ендпоінт не віддав порожній список');
  if (r1.h['cache-control'] !== 'no-store') errs.push('порожня відповідь без ключа кешується');

  /* 10. YouTube недоступний */
  process.env.YOUTUBE_API_KEY = 'test-key';
  global.fetch = async () => { throw new Error('network down'); };
  let r2 = res();
  await quiet(() => Y.default({ method: 'GET', query }, r2));
  if (r2.code !== 200 || r2.body.videos.length) errs.push('падіння YouTube не дало порожній список');
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  let r3 = res();
  await quiet(() => Y.default({ method: 'GET', query }, r3));
  if (r3.code !== 200 || r3.body.videos.length) errs.push('помилка квоти не дала порожній список');

  /* 12. звичайний успішний шлях: 3 пошуки, метадані одним запитом, кеш 7 днів */
  global.fetch = okFetch;
  let r4 = res();
  await Y.default({ method: 'GET', query }, r4);
  const searches = calls.filter(u => u.includes('/search'));
  if (searches.length !== 3) errs.push('не три пошукові запити: ' + searches.length);
  if (!searches.every(u => /type=video/.test(u) && /videoEmbeddable=true/.test(u) && /videoSyndicated=true/.test(u))) errs.push('пошук не обмежений відео, які можна вбудувати');
  if (!searches.every(u => /maxResults=5/.test(u))) errs.push('беремо не по 5 кандидатів');
  if (!searches.some(u => /relevanceLanguage=ru/.test(u))) errs.push('мова звіту не передана в пошук');
  if (calls.filter(u => u.includes('/videos')).length !== 1) errs.push('метадані тягнуться не одним запитом');
  if (/commentThreads|channels\?/.test(calls.join(' '))) errs.push('ендпоінт ліз у коментарі або історію каналу');
  if (!r4.body.videos.length || r4.body.videos.length > 6) errs.push('успішний шлях віддав ' + r4.body.videos.length + ' відео');
  for (const v of r4.body.videos) {
    for (const k of ['id', 'title', 'channel', 'thumb', 'duration_s']) if (v[k] === undefined) errs.push('у відео нема поля ' + k);
  }
  const cc = r4.h['cache-control'] || '';
  if (!/s-maxage=604800/.test(cc)) errs.push('кеш моделі не 7 днів: ' + cc);
  if (!/public/.test(cc)) errs.push('відповідь не кешується на CDN');
  /* ключ лишається на сервері */
  if (JSON.stringify(r4.body).includes('test-key')) errs.push('ключ YouTube потрапив у відповідь');
  if (/YOUTUBE_API_KEY/.test(page)) errs.push('ключ YouTube згадується на сторінці');
  /* 405 на чужий метод */
  const r5 = res(); await Y.default({ method: 'POST', query }, r5);
  if (r5.code !== 405) errs.push('POST не відхилений');

  /* ---------- 5. проводка на сторінці ---------- */
  /* блок стоїть одразу після слабких місць */
  const iIssues = page.indexOf('id="issuesCard"'), iYt = page.indexOf('id="ytCard"'), iQ = page.indexOf('id="qCard"');
  if (!(iIssues > 0 && iYt > iIssues && iYt < iQ)) errs.push('блок відео стоїть не одразу після слабких місць');
  /* асинхронно і лише після готового звіту */
  if (!/document\.body\.classList\.add\('report-ready'\);\n[\s\S]{0,200}?try \{ videosInit\(DATA\); \} catch \(e\) \{\}/.test(page)) errs.push('відео вантажаться не після report-ready');
  if (/await videosInit|videosInit\(DATA\)\.then|await\s+\w*videosInit/.test(page)) errs.push('звіт чекає на YouTube');
  const vi = page.slice(page.indexOf('async function videosInit'), page.indexOf('/* плеєр вантажиться'));
  if (!/if \(!videos\.length\) return;/.test(vi) || !/catch \(e\) \{ return; \}/.test(vi)) errs.push('порожній або збійний YouTube не ховає блок');
  if (!/id="ytCard" style="display:none"/.test(page)) errs.push('блок відео видно до появи результатів');
  if (!/AbortController[\s\S]{0,120}setTimeout\(\(\) => ctl\.abort\(\), 9000\)/.test(vi)) errs.push('запит відео без таймауту');
  /* картки: мініатюра без iframe, плеєр лише після кліку і без кукі */
  if (/<iframe/.test(page.slice(iYt, iQ))) errs.push('iframe вантажиться одразу в картках');
  if (!/createElement\('iframe'\)/.test(page) || !/youtube-nocookie\.com\/embed\//.test(page)) errs.push('плеєр не створюється після кліку або не в режимі без кукі');
  if (!/frame\.innerHTML = '';\n\s*document\.documentElement\.style\.overflow = '';/.test(page)) errs.push('після закриття модалки плеєр не вивантажується');
  if (!/lastTrig\.focus\(\)/.test(page)) errs.push('після закриття фокус не повертається на картку');
  if (!/e\.key === 'Escape'\) \{ e\.preventDefault\(\); close\(\); return; \}/.test(page.slice(page.indexOf('window.ytOpen')))) errs.push('модалка відео не закривається по ESC');
  if (!/id="ytmLink"[^>]*target="_blank"[^>]*rel="noopener"/.test(page)) errs.push('нема запасного переходу на YouTube');
  /* показати ще / згорнути */
  if (!/grid\.onclick = e => \{/.test(vi)) errs.push('обробник кліку по картках навішується повторно');
  if (!/moreBtn\.textContent = open \? t\('Show more'\) : t\('Show less'\)/.test(vi)) errs.push('немає перемикання показати ще / згорнути');
  if (!/\.yt-card\[hidden\],\.yt-more\[hidden\]\{display:none\}/.test(page)) errs.push('атрибут hidden у картках перебивається display класу: видно всі шість одразу');
  if (!/YT_INITIAL = 3, YT_MAX = 6/.test(page)) errs.push('показуємо не 3 спочатку і не 6 максимум');
  /* мобільний: одна колонка, без горизонтального переповнення */
  if (!/@media\(max-width:620px\)\{\.yt-grid\{grid-template-columns:1fr\}/.test(page)) errs.push('на телефоні картки не в одну колонку');
  if (!/\.yt-grid\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(page)) errs.push('на десктопі не три картки в ряд');
  /* аналітика на наявному шарі */
  const an = fs.readFileSync('analytics.js', 'utf8');
  for (const e of ['youtube_block_viewed', 'youtube_video_opened', 'youtube_show_more', 'youtube_opened_external']) {
    if (!an.includes("'" + e + "'")) errs.push('подія ' + e + ' не зареєстрована в analytics.js');
    if (!page.includes("track('" + e + "'")) errs.push('сторінка не шле подію ' + e);
  }
  /* ідентичність моделі доїжджає до сторінки і не тягне за собою VIN-даних */
  const sh = fs.readFileSync('api/share.js', 'utf8');
  if (!/'model_identity'/.test(sh.slice(sh.indexOf('const PUBLIC_META'), sh.indexOf('];', sh.indexOf('const PUBLIC_META'))))) errs.push('model_identity не дозволений у публічному звіті');
  const chk = fs.readFileSync('api/check.js', 'utf8');
  if (!/model_identity: \{\n\s*make:[\s\S]{0,260}?generation: validGeneration\(listing\.generation\),\n\s*engine_code: validEngineCode\(nhtsa && nhtsa\.EngineModel\),/.test(chk)) errs.push('check.js не кладе структурну ідентичність моделі');
  /* Check не чекає на відео і не знає про них */
  if (/googleapis\.com\/youtube|YOUTUBE_API_KEY|youtube\.com/.test(chk)) errs.push('Check ходить у YouTube у своєму шляху');
  if (!/import \{ validGeneration, validEngineCode \} from '\.\/youtube\.js';/.test(chk)) errs.push('check.js перевіряє покоління і двигун не тими самими функціями');
  /* словники */
  for (const d of ['i18n/ru.js', 'i18n/ua.js']) {
    const dict = fs.readFileSync(d, 'utf8');
    for (const k of ['Videos about this model', 'Show more', 'Show less', 'Open on YouTube']) {
      if (!dict.includes("'" + k + "':")) errs.push(d + ': нема ключа "' + k + '"');
    }
  }
  if (page.includes('\u2014')) errs.push('довге тире в result-check.html');

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('ідентичність моделі без року · три мовні шаблони, двигун лише в "проблеми" · релевантність 70 / перегляди 30 · максимум 6, слабкими не добиваємо · будь-яка невдача ховає блок');
  console.log('YOUTUBE TEST PASSED');
})();
