/* Єдиний CalCar Assistant: один UI, одна розмова, один потік, один контекст.
   Головне, що тут захищається: на жодній сторінці нема другого чату і другого
   стану розмови; конверт контексту не пропускає секретів; здатності звітів
   підключені в спільний shell, а не викинуті. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = ['check.html', 'import.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];

/* 1. один помічник на кожній сторінці, без власних чатів */
for (const f of PAGES) {
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes('<script src="/context.js"></script>')) errs.push(f + ': не підключений спільний контекст сторінки');
  if (!s.includes('<script src="/chat.js"></script>')) errs.push(f + ': не підключений спільний помічник');
  if (s.includes('id="chatPanel"') || s.includes('id="chatMsgs"') || s.includes('id="chatText"')) errs.push(f + ': власна панель чату замість спільної');
  if (/fetch\('\/api\/chat'/.test(s)) errs.push(f + ': сторінка сама ходить у /api/chat повз спільний чат');
  if (/sessionStorage\.(get|set)Item\('calcar(Check|Global)Chat'\)|localStorage\.(get|set)Item\(CHAT_KEY\)/.test(s)) errs.push(f + ': другий стан розмови');
  if (/class="cc-panel"|id="ccPanel"/.test(s)) errs.push(f + ': розмітка помічника продубльована в сторінці');
  if (!/CalCarContext\.register\(/.test(s)) errs.push(f + ': сторінка не розповідає, що на ній видно');
}
/* звіти: свої здатності підключені в спільний помічник, докування збережене */
for (const f of ['result.html', 'result-check.html']) {
  const s = fs.readFileSync(f, 'utf8');
  if (!/registerCapability\(\{[\s\S]*?dock: true/.test(s)) errs.push(f + ': здатність звіту не докує помічника');
  if (!/photos:/.test(s)) errs.push(f + ': звіт не віддає фото помічнику');
  if (!s.includes('body.chat-docked{padding-right:380px}')) errs.push(f + ': нема CSS докування');
  if (!s.includes('id="chatSelAsk"')) errs.push(f + ': зникла кнопка "Запитати про це" біля виділення');
  if (!/CalCarChat\.open\(q \? \{ quote: q \} : \{\}\)/.test(s)) errs.push(f + ': цитата з виділення не їде у спільний чат');
  /* Check-звіт свідомо без верхньої кнопки і без плаваючої: входи лише
     контекстні. Import поки тримає верхню кнопку і перемикає нею помічника */
  if (f === 'result-check.html') {
    if (/id="chatTopBtn"/.test(s)) errs.push(f + ': верхня кнопка чату повернулась у звіт Check');
    if (!/window\.CALCAR_CHAT_FAB = false/.test(s)) errs.push(f + ': плаваюча кнопка помічника не вимкнена на звіті');
    if (!/calcarOpenChat/.test(s)) errs.push(f + ': нема контекстного входу в помічника');
  } else if (!/CalCarChat\.toggle\(\)/.test(s)) errs.push(f + ': кнопка чату в шапці не перемикає спільний помічник');
}
if (!/others: OTHER_REPORTS/.test(fs.readFileSync('result-check.html', 'utf8'))) errs.push('звіт Check не віддає інші звіти людини');
if (!/context: Object\.assign\(chatContext\(\), \{ page: body\.context \}\)/.test(fs.readFileSync('result.html', 'utf8'))) errs.push('прорахунок Import не віддає контекст лота');

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
    if (env.post_id !== 'p1') errs.push('фокус виклику загубився');
    if (env.locale !== 'ru' || env.route !== '/garage/abc') errs.push('локаль або маршрут не потрапили в конверт');
    C.register(() => ({ access_token: 'AAA', supabase_anon_key: 'BBB', password: 'x', session: { jwt: 'y' }, safe: 'ok' }));
    const leak = JSON.stringify(C.get());
    for (const bad of ['AAA', 'BBB', 'access_token', 'password', 'jwt', 'anon']) if (leak.includes(bad)) errs.push('у контекст просочився секрет: ' + bad);
    if (!leak.includes('ok')) errs.push('фільтр вирізав і звичайні поля');
    C.register(() => { throw new Error('boom'); });
    if (C.get().page_type !== 'garage_feed') errs.push('падіння одного провайдера ламає контекст');
  }
}

/* 3. chat.js: один потік, фокус окремо від розмови, здатності */
{
  const src = fs.readFileSync('chat.js', 'utf8');
  try { new Function(src); } catch (e) { errs.push('синтаксис chat.js: ' + e.message); }
  if ((src.match(/localStorage\.setItem\(THREAD_KEY/g) || []).length < 1) errs.push('потік не зберігається');
  if (!/var THREAD_KEY = 'calcar_assistant_thread'/.test(src)) errs.push('нема єдиного ключа потоку');
  if (/calcarCheckChat|calcarChat:/.test(src)) errs.push('у chat.js лишились ключі старих окремих чатів');
  if (!/thread_id: thread\.id/.test(src)) errs.push('запит не несе стабільний thread_id');
  if (!/document\.getElementById\('chatPanel'\)/.test(src) === false) errs.push('chat.js досі поступається старому чату сторінки');
  if (!/window\.CalCarContext/.test(src)) errs.push('chat.js бере контекст повз спільний інтерфейс');
  if (/document\.body\.innerHTML|document\.body\.innerText/.test(src)) errs.push('chat.js шле помічнику сиру сторінку');
  for (const name of ['open', 'close', 'toggle', 'setFocus', 'setQuote', 'registerCapability', 'thread', 'ask']) {
    if (!new RegExp('(^|[^A-Za-z])' + name + ':\\s*function').test(src)) errs.push('нема публічного методу CalCarChat.' + name);
  }
  if (!/window\.CalCarChat = API/.test(src)) errs.push('chat.js не публікує CalCarChat');
  for (const cap of ['DOCK_MIN', 'chat-docked', 'refPayload', 'pendingFiles.length >= 3', 'quoted_text: q', 'saveChatMemory(', 'scheduleMemoryUpdate(', 'afterReply', 'suggestions(ctx)']) {
    if (!src.includes(cap)) errs.push('здатність звіту загубилась у chat.js: ' + cap);
  }
  if (!/cc-empty/.test(src) || !src.includes("t('Ask me about a car, a report, or whatever is open on the page right now.')")) errs.push('нема спільного порожнього стану помічника');
  if (!/focusDismissed/.test(src)) errs.push('картку фокуса не можна прибрати');

  /* живий прогін ядра: потік переживає навігацію, фокус не породжує нового чату, запит несе контекст */
  const store = {};
  const mkDoc = () => {
    const els = {};
    const mk = () => ({ classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, addEventListener(){}, appendChild(){}, append(){}, querySelector(){ return mk(); }, querySelectorAll(){ return []; }, setAttribute(){}, getAttribute(){ return null; }, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', focus(){}, remove(){}, closest(){ return null; }, click(){}, files: [] });
    return { readyState: 'complete', head: mk(), body: mk(), createElement: () => mk(), createTextNode: () => ({}), addEventListener(){}, getElementById: id => (els[id] = els[id] || mk()), querySelector: () => mk(), querySelectorAll: () => [], documentElement: { style: {} } };
  };
  const runPage = async (pathname, pageType, extraCtx, ask, replyText) => {
    const sent = [];
    const win = {
      t: x => x, calcarLang: () => 'ru',
      localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
      sessionStorage: { getItem: () => null, setItem(){}, removeItem(){} },
      innerWidth: 1400, addEventListener(){}, matchMedia: () => ({ matches: false }),
      crypto: { randomUUID: () => 'thread-1' },
      fetch: async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ reply: replyText }) }; },
    };
    win.window = win;
    const ctxWin = {};
    vm.runInNewContext(fs.readFileSync('context.js', 'utf8'), { window: ctxWin, location: { pathname }, Object, Array, String, Number, isFinite });
    ctxWin.CalCarContext.register(() => Object.assign({ page_type: pageType }, extraCtx || {}));
    win.CalCarContext = ctxWin.CalCarContext;
    const ctx = { window: win, document: mkDoc(), location: { pathname, search: '', hash: '' }, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
      setTimeout: (fn) => fn(), clearTimeout(){}, fetch: win.fetch, Event: function(){}, Image: function(){}, FileReader: function(){}, Promise, Object, Array, String, Number, Math, JSON, Date, console, crypto: win.crypto };
    vm.runInNewContext(fs.readFileSync('chat.js', 'utf8'), ctx);
    const A = win.CalCarChat;
    if (ask) { A.open(ask.focus ? { focus: ask.focus } : {}); await A.ask(ask.text); await new Promise(r => setTimeout(r, 0)); }
    return { A, sent };
  };
  (async () => {
    const a = await runPage('/check', 'check_landing', null, { text: 'привіт' }, 'відповідь 1');
    const th1 = a.A.thread();
    if (th1.id !== 'thread-1') errs.push('потік без стабільного id');
    if (th1.messages.length !== 2) errs.push('після першого питання в потоці не 2 репліки: ' + th1.messages.length);
    if (!a.sent[0] || a.sent[0].thread_id !== 'thread-1' || a.sent[0].context.page_type !== 'check_landing') errs.push('перший запит без thread_id або контексту вітрини');
    /* та сама розмова в Гаражі: інша сторінка, той самий потік, фокус поста поверх */
    const b = await runPage('/garage', 'garage_feed', null, { text: 'а це актуально?', focus: { label: 'Owner post', title: 'Porsche Cayenne GTS', context: { page_type: 'garage_feed', content_type: 'owner_post', post_id: 'demo-1', vehicle: { make: 'Porsche' } } } }, 'відповідь 2');
    const th2 = b.A.thread();
    if (th2.id !== 'thread-1') errs.push('навігація створила новий потік');
    if (th2.messages.length !== 4) errs.push('розмова не збереглась між сторінками: ' + th2.messages.length);
    if (th2.messages[0].content !== 'привіт') errs.push('старі репліки загубились');
    const q2 = b.sent[0];
    if (!q2 || q2.product !== 'garage' || q2.context.post_id !== 'demo-1' || q2.context.content_type !== 'owner_post') errs.push('фокус публікації не потрапив у запит');
    if (q2 && q2.messages.length !== 3) errs.push('у запит поїхала не вся розмова: ' + (q2 && q2.messages.length));
    /* звіт Check: здатність підмінює продукт і контекст, потік той самий */
    const c = await runPage('/check/abc', 'check_report', { report_id: 'r1', vehicle: { title: 'BMW 5' } }, null, 'відповідь 3');
    c.A.registerCapability({ id: 'check-report', product: 'check', dock: true, applies: x => x.page_type === 'check_report', request: body => Object.assign(body, { context: { vehicle: 'BMW 5', page: body.context }, others: [1], report_id: 'r1' }) });
    c.A.open(); await c.A.ask('чи варто?'); await new Promise(r => setTimeout(r, 0));
    const th3 = c.A.thread(), q3 = c.sent[0];
    if (th3.id !== 'thread-1' || th3.messages.length !== 6) errs.push('у звіті потік розірвався: ' + th3.messages.length);
    if (!q3 || q3.product !== 'check' || q3.report_id !== 'r1' || !q3.others || q3.context.page.page_type !== 'check_report') errs.push('здатність звіту не застосувалась до запиту');
    if (th3.messages[4].report_id !== 'r1') errs.push('репліка про звіт не позначена report_id');
    if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
    console.log('один помічник на 6 сторінках · один потік через навігацію · фокус окремо від розмови · здатності звітів у спільному shell · контекст без секретів');
    console.log('CHAT UI TEST PASSED');
  })();
}

/* 4. api/chat.js: у гаража своя предметна область, старі продукти не зачеплені */
{
  const a = fs.readFileSync('api/chat.js', 'utf8');
  if (!/const DOMAIN_GARAGE = /.test(a)) errs.push('нема предметної області гаража');
  if (!/product === 'garage' \? DOMAIN_GARAGE/.test(a)) errs.push('гараж не вибирає свою предметну область');
  if (a.includes('\u2014')) errs.push('довге тире в api/chat.js');
}

/* 5. словники: усі t()-рядки chat.js перекладені */
{
  const c = fs.readFileSync('chat.js', 'utf8');
  const keys = new Set(); let m; const re = /\bt\('((?:[^'\\]|\\.)*)'\)/g;
  while ((m = re.exec(c))) keys.add(m[1].replace(/\\'/g, "'"));
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) {
    const s = fs.readFileSync(f, 'utf8');
    for (const k of keys) if (!s.includes("'" + k.replace(/'/g, "\\'") + "':")) errs.push(f + ': нема перекладу "' + k + '"');
  }
}
