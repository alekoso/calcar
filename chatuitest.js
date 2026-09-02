/* Спільний чат CalCar і спільний контекст сторінки.
   Головне, що тут захищається: одна реалізація чату на платформу, одна форма
   контексту, і жодних секретів у конверті, який їде помічнику. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = ['check.html', 'import.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const OWN_CHAT = ['result.html', 'result-check.html'];   /* свій докований чат по звіту */
const GLOBAL = ['check.html', 'import.html', 'cabinet.html', 'garage.html'];

/* 1. підключення: контекст скрізь, глобальний чат лише там, де свого нема */
for (const f of PAGES) {
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes('<script src="/context.js"></script>')) errs.push(f + ': не підключений спільний контекст сторінки');
  const hasOwn = s.includes('id="chatPanel"');
  const hasGlobal = s.includes('<script src="/chat.js"></script>');
  if (OWN_CHAT.includes(f)) {
    if (!hasOwn) errs.push(f + ': зник власний чат звіту');
    if (hasGlobal) errs.push(f + ': на сторінці два чати одразу, свій і глобальний');
  } else {
    if (hasOwn) errs.push(f + ': зʼявилась друга реалізація чату замість спільної');
    if (!hasGlobal) errs.push(f + ': нема спільного чату CalCar');
  }
  if (!/CalCarContext\.register\(/.test(s)) errs.push(f + ': сторінка не розповідає, що на ній видно');
}
/* жодної другої копії чату: розмітку і стилі малює тільки chat.js */
for (const f of GLOBAL) {
  const s = fs.readFileSync(f, 'utf8');
  if (/class="cc-panel"|id="ccPanel"/.test(s)) errs.push(f + ': розмітка чату продубльована в сторінці');
  if (/fetch\('\/api\/chat'/.test(s)) errs.push(f + ': сторінка сама ходить у /api/chat повз спільний чат');
}

/* 2. context.js: конверт, секрети, продукт */
{
  const src = fs.readFileSync('context.js', 'utf8');
  const win = {};
  vm.runInNewContext(src, { window: win, location: { pathname: '/garage/abc' }, Object, Array, String, Number, isFinite });
  const C = win.CalCarContext;
  if (!C) { errs.push('context.js не віддає CalCarContext'); }
  else {
    win.calcarLang = () => 'ru';
    C.register(() => ({ page_type: 'garage_feed', vehicle: { make: 'BMW', model: '5 Series' } }));
    const env = C.get({ post_id: 'p1' });
    if (env.page_type !== 'garage_feed') errs.push('провайдер не потрапив у конверт');
    if (env.post_id !== 'p1') errs.push('точковий контекст виклику загубився');
    if (env.locale !== 'ru') errs.push('локаль не потрапила в конверт');
    if (env.route !== '/garage/abc') errs.push('маршрут не потрапив у конверт');
    /* найважливіше: нічого схожого на секрет у конверт не проходить */
    C.register(() => ({ access_token: 'AAA', supabase_anon_key: 'BBB', password: 'x', session: { jwt: 'y' }, safe: 'ok' }));
    const leak = JSON.stringify(C.get());
    for (const bad of ['AAA', 'BBB', 'access_token', 'password', 'jwt', 'anon']) {
      if (leak.includes(bad)) errs.push('у контекст сторінки просочився секрет: ' + bad);
    }
    if (!leak.includes('ok')) errs.push('фільтр вирізав і звичайні поля');
    /* провайдер, що падає, не має ламати весь конверт */
    C.register(() => { throw new Error('boom'); });
    if (C.get().page_type !== 'garage_feed') errs.push('падіння одного провайдера ламає контекст');
    if (C.product() !== 'garage') errs.push('продукт розмови визначено неправильно');
  }
}

/* 3. chat.js: одна реалізація, свій контракт із /api/chat */
{
  const src = fs.readFileSync('chat.js', 'utf8');
  try { new Function(src); } catch (e) { errs.push('синтаксис chat.js: ' + e.message); }
  if (!/document\.getElementById\('chatPanel'\)/.test(src)) errs.push('chat.js не поступається сторінці з власним чатом');
  if (!/fetch\('\/api\/chat'/.test(src)) errs.push('chat.js не ходить у спільний /api/chat');
  if (!/window\.CalCarContext/.test(src)) errs.push('chat.js бере контекст повз спільний інтерфейс');
  if (/document\.body\.innerHTML|document\.body\.innerText/.test(src)) errs.push('chat.js шле помічнику сиру сторінку');
  if (!/sessionStorage/.test(src)) errs.push('розмова не переживає навігацію по CalCar');
  for (const name of ['open', 'close', 'ask']) {
    if (!new RegExp('(^|[^A-Za-z])' + name + ':\\s*function').test(src)) errs.push('нема публічного методу CalCarChat.' + name);
  }
  if (!/window\.CalCarChat = API/.test(src)) errs.push('chat.js не публікує CalCarChat');
}

/* 3b. провайдери контексту сторінок справді працюють і дають очікуваний page_type.
   Сторінки звітів перевіряються тут, а не в браузері: без даних звіту вони
   редиректять, і живої сторінки для заміру просто не існує. */
{
  const EXPECT = {
    'check.html': 'check_landing', 'import.html': 'import_landing', 'cabinet.html': 'cabinet',
    'result-check.html': 'check_report', 'result.html': 'import_report', 'garage.html': 'garage_feed'
  };
  const STUBS = {
    'result-check.html': { DATA: { vehicle: { title: 'BMW 5' }, verdict: { score: 7.4, summary: 'ok' }, risks: [{ title: 'r1' }] }, M: { vin: 'X', odometer_km: 1 }, ROW_ID: 'rid' },
    'result.html': { DATA: { vehicle: { title: 'Audi' }, lot_notes: 'n' }, REPORT_ID: 'iid', chatCtx: () => ({ totals: { repair: 1 } }) },
    'garage.html': { state: { feed: 'for-you' } },
  };
  for (const f of Object.keys(EXPECT)) {
    const s = fs.readFileSync(f, 'utf8');
    /* вирізаємо виклик по балансу дужок: провайдери бувають і в один рядок, і на десять */
    const bodies = [];
    const MARK = 'CalCarContext.register(function () {';
    for (let at = s.indexOf(MARK); at > -1; at = s.indexOf(MARK, at + 1)) {
      let d = 0, end = -1;
      for (let i = at + MARK.length - 1; i < s.length; i++) {
        if (s[i] === '{') d++;
        else if (s[i] === '}' && --d === 0) { end = i; break; }
      }
      if (end > -1) bodies.push(s.slice(at, end + 1) + ');');
    }
    if (!bodies.length) { errs.push(f + ': провайдер контексту не знайдено'); continue; }
    let got = null;
    for (const body of bodies) {
      const box = Object.assign({
        location: { hash: '', pathname: '/', search: '' }, Array, Object, String, Number, JSON,
        car: null, entries: [], DATA: null, M: {}, ROW_ID: null, REPORT_ID: null
      }, STUBS[f] || {});
      const reg = [];
      box.window = { CalCarContext: { register: fn => reg.push(fn) } };
      box.CalCarContext = box.window.CalCarContext;
      try {
        vm.runInNewContext(body, box);
        const out = reg[0] ? reg[0]() : null;
        if (out && out.page_type) got = out;
      } catch (e) { errs.push(f + ': провайдер контексту падає: ' + e.message); }
    }
    if (!got) { errs.push(f + ': провайдер не віддав page_type'); continue; }
    if (got.page_type !== EXPECT[f]) errs.push(f + ': page_type ' + got.page_type + ', а мав бути ' + EXPECT[f]);
    if (f === 'result-check.html' && (!got.report_id || !got.facts || got.facts.score !== 7.4)) errs.push('звіт Check не віддає оцінку і report_id');
    if (f === 'result.html' && (!got.report_id || !got.facts || !got.facts.totals)) errs.push('прорахунок Import не віддає підсумки і report_id');
    /* у гаража два провайдери: стрічка і сторінка конкретного авто */
    if (f === 'garage.html' && bodies.length < 2) errs.push('гараж не описує сторінку конкретного авто');
    if (JSON.stringify(got).length > 4000) errs.push(f + ': конверт контексту роздутий');
  }
}

/* 4. api/chat.js: у гаража своя предметна область, старі продукти не зачеплені */
{
  const a = fs.readFileSync('api/chat.js', 'utf8');
  if (!/const DOMAIN_GARAGE = /.test(a)) errs.push('нема предметної області гаража');
  if (!/product === 'garage' \? DOMAIN_GARAGE/.test(a)) errs.push('гараж не вибирає свою предметну область');
  if (!/body\.product === 'check' \? 'check' : body\.product === 'garage' \? 'garage' : 'import'/.test(a)) errs.push('продукт garage не приймається запитом');
  const dg = a.slice(a.indexOf('const DOMAIN_GARAGE'), a.indexOf('const SYSTEM'));
  for (const rule of ['ОДИН випадок', 'ЧИ АКТУАЛЬНО ДЛЯ ЙОГО АВТО', 'Не вигадуй авто користувача']) {
    if (!dg.includes(rule)) errs.push('у правилах гаража нема: ' + rule);
  }
  if (a.includes('—')) errs.push('довге тире в api/chat.js');
}

/* 5. словники: усі рядки чату перекладені */
{
  const need = ['Ask CalCar', 'Ask a question', 'Send', 'Close', 'Could not answer, try again', 'CalCar sees the page you are on'];
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) {
    const s = fs.readFileSync(f, 'utf8');
    for (const k of need) if (!s.includes("'" + k + "':")) errs.push(f + ': нема перекладу "' + k + '"');
  }
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('чат один на платформу · контекст без секретів · гараж має свою предметну область · словники повні');
console.log('CHAT UI TEST PASSED');
