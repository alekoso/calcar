/* Beta-prep: аналітика, відгук, тур і навігація.

   Аналітика тримається на одному тонкому шарі (analytics.js) поверх
   публічного конфігу (calcar-public.js). Тест ганяє справжній код під
   заглушкою браузера і перевіряє те, що легко зламати непомітно:
     - без ключів у мережу нічого не йде, події лишаються в буфері;
     - у події проходять лише імена з таксономії;
     - приватний текст (чат, памʼять, опис продавця, VIN, email) не проходить
       навіть якщо його передали у властивостях;
     - анонімний id це uuid у localStorage, без fingerprinting;
     - session replay маскує поля і блокує панель помічника, памʼять, вхід;
     - шар підключений на всіх шести сторінках, identify викликається
       зі спільного блоку шапки за підтвердженою сесією.
   Плюс: санітайзер відгуку, тур першого запуску (спільний блок побайтово
   один, стан і умови показу), контакти футера з конфігу, копірайт Check. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const PAGES = ['check.html', 'import.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const S = Object.fromEntries(PAGES.map(p => [p, fs.readFileSync(p, 'utf8')]));
const pub = fs.readFileSync('calcar-public.js', 'utf8');
const an = fs.readFileSync('analytics.js', 'utf8');

/* ---------- заглушка браузера ---------- */
function browser(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage || {});
  const listeners = {};
  const scripts = [];
  const doc = {
    readyState: 'complete', referrer: opts.referrer || '',
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    dispatchEvent: () => true,
    createElement: () => ({ setAttribute() {}, set src(v) { scripts.push(v); }, get src() { return ''; } }),
    getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
    head: { appendChild: el => { if (el.src) scripts.push(el.src); } },
    body: { classList: { contains: () => false } },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  };
  const win = {
    CALCAR_PUBLIC: opts.pub || { analytics: { posthog_key: '', posthog_host: '', ga4_id: '' }, contacts: {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555', getRandomValues: a => a },
    location: { pathname: opts.path || '/', search: opts.search || '', hostname: 'calcar.io' },
    calcarLang: () => 'ru', CALCAR_SIGNED_IN: false,
    document: doc, console: { warn() {} },
    URLSearchParams, URL, CustomEvent: function (n, o) { this.type = n; this.detail = o && o.detail; }, Object, Array, String, Number, JSON, Date, Math, RegExp, Uint8Array,
  };
  win.window = win; win.self = win;
  vm.createContext(win);
  vm.runInContext(an, win);
  return { win, store, listeners, scripts, fire: (t, ev) => (listeners[t] || []).forEach(fn => fn(ev)) };
}

/* ---------- 1. без ключів: вхолосту, у мережу нічого ---------- */
{
  const b = browser({ path: '/check' });
  if (!b.win.calcar || typeof b.win.calcar.track !== 'function') errs.push('нема window.calcar.track');
  if (b.scripts.length) errs.push('без ключів підвантажились зовнішні скрипти: ' + b.scripts.join(','));
  const en = b.win.calcar.enabled();
  if (en.posthog || en.ga4) errs.push('без ключів аналітика вважає себе увімкненою');
  if (!Array.isArray(b.win.CALCAR_EVENTS)) errs.push('нема буфера подій CALCAR_EVENTS');
  /* жодних автоматичних подій на завантаженні: лише кастомні дії */
  if (b.win.CALCAR_EVENTS.length) errs.push('на завантаженні сторінки пішли автоматичні події: ' + b.win.CALCAR_EVENTS.map(e => e.name).join(','));
  /* плейсхолдери з коментаря конфігу (phc_..., G-XXXXXXX) це не ключі */
  if (/phc_[A-Za-z0-9]{10,}|G-(?!X+\b)[A-Z0-9]{6,}/.test(an)) errs.push('у analytics.js захардкоджений ключ аналітики (місце ключа: calcar-public.js)');
  /* у публічному конфігу ключ або порожній, або справжній публічний phc_ */
  const pk = (pub.match(/posthog_key: '([^']*)'/) || [])[1];
  if (pk === undefined || (pk && !/^phc_[A-Za-z0-9]{20,}$/.test(pk))) errs.push('calcar-public.js: posthog_key не phc_ і не порожній');
  if (!/posthog_host: 'https:\/\/eu\.i\.posthog\.com'/.test(pub)) errs.push('calcar-public.js: PostHog не в EU-регіоні');
}

/* ---------- 2. таксономія: лише відомі імена ---------- */
{
  const b = browser({ path: '/' });
  const WANT = ['check_started', 'check_completed', 'report_viewed', 'report_active_30s', 'report_active_60s', 'report_active_180s',
    'report_scroll_25', 'report_scroll_50', 'report_scroll_75', 'report_scroll_100', 'seller_description_opened', 'share_clicked',
    'calcar_ai_clicked', 'feedback_yes', 'feedback_no', 'feedback_submitted',
    'chat_opened', 'chat_message_sent', 'settings_opened', 'memory_opened', 'memory_updated',
    'report_email_opted_in', 'report_opened_from_email'];
  if (JSON.stringify(b.win.calcar.events.slice().sort()) !== JSON.stringify(WANT.slice().sort())) errs.push('таксономія не збігається з beta-списком: ' + b.win.calcar.events.join(','));
  for (const old of ['landing_view', 'analysis_started', 'analysis_completed', 'report_shared', 'assistant_opened', 'youtube_block_viewed']) if (b.win.calcar.track(old, {})) errs.push('стара подія ' + old + ' пройшла');
  for (const w of WANT) if (!b.win.calcar.events.includes(w)) errs.push('події "' + w + '" нема в таксономії');
  if (b.win.calcar.track('page_view_custom', {})) errs.push('невідома подія пройшла');
  if (!b.win.calcar.track('check_started', { marketplace: 'auto.ria.com' })) errs.push('відома подія не пройшла');
  const ev = b.win.CALCAR_EVENTS[b.win.CALCAR_EVENTS.length - 1];
  if (ev.props.marketplace !== 'auto.ria.com') errs.push('дозволена властивість загублена');
  for (const k of ['page', 'product', 'locale', 'authenticated', 'acq_source']) if (!(k in ev.props)) errs.push('у події нема базової властивості ' + k);
}

/* ---------- 3. приватне не проходить, навіть якщо передали ---------- */
{
  const b = browser({ path: '/check/AB12CD' });
  b.win.calcar.track('chat_message_sent', {
    text: 'мій бюджет 20 тисяч', message: 'hello', memory: 'Людина: ...', seller_description: 'продам авто',
    description: 'x', prompt: 'p', content: 'c', email: 'a@b.c', phone: '+380', token: 'abc', vin: 'WBA12345678901234',
    listing_url: 'https://auto.ria.com/uk/auto_x.html', title: 'BMW X5', car_vin: 'x', plate: 'AA1234BB',
    model_ref: 'WBAJA7C51KWW12345', contact: 'a@b.co', note: 'n', payment_card: '4111',
    long: 'x'.repeat(200), multiline: 'a\nb', ok_number: 3, ok_flag: true, marketplace: 'auto.ria.com',
  });
  const p = b.win.CALCAR_EVENTS[b.win.CALCAR_EVENTS.length - 1].props;
  for (const k of ['text', 'message', 'memory', 'seller_description', 'description', 'prompt', 'content', 'email', 'phone', 'token', 'vin', 'car_vin', 'plate', 'model_ref', 'contact', 'listing_url', 'title', 'note', 'payment_card', 'long', 'multiline']) {
    if (k in p) errs.push('приватна властивість пройшла в подію: ' + k);
  }
  if (p.ok_number !== 3 || p.ok_flag !== true || p.marketplace !== 'auto.ria.com') errs.push('нешкідливі властивості загублені');
  /* VIN і email відкидаються і за ключем, і за формою значення; плюс жодна
     сторінка не передає vin у track() */
  for (const f of PAGES) if (/calcar\.track\([^)]*\bvin\b/.test(S[f])) errs.push(f + ': VIN передається в аналітику');
  /* адреса події без токена звіту */
  if (p.page !== '/check/*') errs.push('адреса звіту не знеособлена: ' + p.page);
  const b2 = browser({ path: '/check/r/bmw-x5-2019/AbCdEfGh123' });
  b2.win.calcar.track('report_viewed', {});
  if (b2.win.CALCAR_EVENTS[b2.win.CALCAR_EVENTS.length - 1].props.page !== '/check/r/*') errs.push('токен публічного посилання потрапив у адресу події');
}

/* ---------- 4. ідентичність: uuid у localStorage, без fingerprinting ---------- */
{
  const b = browser({ path: '/' });
  const id = b.win.calcar.aid();
  if (!/^[0-9a-f-]{36}$/.test(id) || b.store.calcar_aid !== id) errs.push('анонімний id не uuid у localStorage');
  if (b.win.calcar.aid() !== id) errs.push('анонімний id не стабільний у межах браузера');
  const b2 = browser({ path: '/', storage: { calcar_aid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } });
  if (b2.win.calcar.aid() !== 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') errs.push('збережений анонімний id не використовується');
  if (/canvas|webgl|AudioContext|plugins|deviceMemory|hardwareConcurrency|screen\.(width|height)/.test(an)) errs.push('у шарі аналітики є ознаки fingerprinting');
  /* identify: користувач записується, буфер відмічає склейку */
  b.win.calcar.identify('user-uuid-1');
  if (b.store.calcar_uid !== 'user-uuid-1') errs.push('identify не запамʼятовує user id');
  if (!b.win.CALCAR_EVENTS.some(e => e.name === '$identify')) errs.push('identify не відмічений у буфері');
  /* перше торкання: utm запамʼятовується один раз */
  const b3 = browser({ path: '/', search: '?utm_source=tg&utm_medium=post&utm_campaign=beta1' });
  const acq = b3.win.calcar.acquisition();
  if (acq.source !== 'tg' || acq.medium !== 'post' || acq.campaign !== 'beta1') errs.push('utm першого торкання не збережено: ' + JSON.stringify(acq));
  const b4 = browser({ path: '/', search: '?utm_source=other', storage: { calcar_utm: b3.store.calcar_utm } });
  if (b4.win.calcar.acquisition().source !== 'tg') errs.push('utm першого торкання перезаписано пізнішим візитом');
}

/* ---------- 5. PostHog: лише кастомні події, без replay/heatmaps/web vitals ---------- */
{
  const b = browser({ path: '/check/r/bmw-x5-2019/AbCdEfGh123', pub: { analytics: { posthog_key: 'phc_' + 'x'.repeat(40), posthog_host: 'https://eu.i.posthog.com', ga4_id: '' }, contacts: {} } });
  b.win.location.origin = 'https://calcar.io';
  const init = b.win.posthog && b.win.posthog._i && b.win.posthog._i[0];
  if (!init) errs.push('з ключем PostHog не ініціалізується');
  else {
    const c = init[1];
    if (c.api_host !== 'https://eu.i.posthog.com') errs.push('PostHog не на EU-хості: ' + c.api_host);
    const OFF = { autocapture: false, capture_pageview: false, capture_pageleave: false, disable_session_recording: true, capture_heatmaps: false, enable_heatmaps: false, capture_performance: false, capture_dead_clicks: false, capture_exceptions: false, rageclick: false, disable_surveys: true, disable_external_dependency_loading: true };
    for (const [k, v] of Object.entries(OFF)) if (c[k] !== v) errs.push('PostHog: ' + k + ' має бути ' + v + ', а не ' + c[k]);
    if (typeof c.before_send !== 'function') errs.push('PostHog без before_send: адреса з токеном звіту піде як є');
    else {
      const ev = c.before_send({ event: 'report_viewed', properties: {
        $current_url: 'https://calcar.io/check/r/bmw-x5-2019/AbCdEfGh123?vin=WBA12345678901234&email=a@b.c',
        $pathname: '/check/r/bmw-x5-2019/AbCdEfGh123', $referrer: 'https://auto.ria.com/uk/auto_bmw_x5_123.html?id=9',
        $set_once: { $initial_current_url: 'https://calcar.io/check/r/bmw-x5-2019/AbCdEfGh123?vin=WBA12345678901234', $initial_referrer: '$direct' },
      } });
      const p = ev.properties, flat = JSON.stringify(ev);
      if (p.$current_url !== 'https://calcar.io/check/r/*') errs.push('$current_url не знеособлений: ' + p.$current_url);
      if (p.$pathname !== '/check/r/*') errs.push('$pathname не знеособлений: ' + p.$pathname);
      if (p.$referrer !== 'https://auto.ria.com') errs.push('$referrer не зведений до хоста: ' + p.$referrer);
      if (p.$set_once.$initial_referrer !== '$direct') errs.push('$direct реферер зіпсований');
      if (/WBA12345678901234|a@b\.c|AbCdEfGh123|auto_bmw/.test(flat)) errs.push('VIN, email, токен або адреса оголошення пройшли в PostHog: ' + flat);
    }
  }
  /* страховка replay лишається: якщо колись увімкнуть, приватне закрите */
  if (!/maskAllInputs: true/.test(an)) errs.push('replay не маскує поля вводу');
  const block = (an.match(/blockSelector: '([^']+)'/) || [])[1] || '';
  for (const sel of ['.cc-panel', '#memCard', '#authBox', '[data-private-block]']) if (!block.includes(sel)) errs.push('replay не блокує ' + sel);
  if (!/<div class="fbx-more" id="fbMore" inert data-private-block>/.test(S['result-check.html'])) errs.push('поле відгуку не приховане від replay');
  for (const id of ['memCard', 'authBox']) if (!S['cabinet.html'].includes('id="' + id + '"')) errs.push('cabinet.html: нема #' + id + ', селектор блокування replay порожній');
  if (!fs.readFileSync('chat.js', 'utf8').includes('cc-panel')) errs.push('chat.js: панель помічника не .cc-panel, replay її не блокує');
}

/* ---------- 5b. поведінка подій: раз, пауза, номер, приватність payload ---------- */
{
  /* активний час: у прихованій вкладці стоїть, кожен поріг раз */
  const b = browser({ path: '/check/r/x/AbCdEfGh123' });
  let clock = 0; const fired = [];
  const tm = b.win.calcar._activeTimer(n => fired.push(n), () => clock);
  tm.visible(true); clock = 20000; tm.tick();
  tm.visible(false); clock = 600000; tm.tick();
  if (fired.length) errs.push('активний час біг у прихованій вкладці: ' + fired.join(','));
  tm.visible(true); clock = 610000; tm.tick();
  if (fired.join() !== 'report_active_30s') errs.push('30 с активного часу не дали рівно report_active_30s: ' + fired.join());
  clock = 650000; tm.tick(); clock = 800000; tm.tick(); tm.tick(); tm.visible(false); tm.visible(true); tm.tick();
  if (fired.join() !== 'report_active_30s,report_active_60s,report_active_180s') errs.push('пороги активного часу не по разу: ' + fired.join());
  /* прокрутка: кожен поріг раз, без проміжних подій */
  const sf = []; const depth = b.win.calcar._scrollDepth(n => sf.push(n));
  [10, 30, 30, 55, 20, 80, 97, 99, 100, 120].forEach(depth);
  if (sf.join() !== 'report_scroll_25,report_scroll_50,report_scroll_75,report_scroll_100') errs.push('пороги прокрутки не по разу: ' + sf.join());
  /* номер перевірки: зростає, не нижче вже збережених локальних перевірок */
  const n1 = b.win.calcar.nextCheckNumber(1), n2 = b.win.calcar.nextCheckNumber(1), n3 = b.win.calcar.nextCheckNumber(2);
  if (n1 !== 1 || n2 !== 2 || n3 !== 3) errs.push('check_number не 1,2,3: ' + [n1, n2, n3]);
  const bOld = browser({ path: '/' });
  if (bOld.win.calcar.nextCheckNumber(5) !== 5) errs.push('check_number нижчий за вже збережені перевірки');
  /* check_completed раз на job */
  const before = b.win.CALCAR_EVENTS.length;
  b.win.calcar.checkCompleted('job-tok-1', { product: 'check', score_bucket: '7-8' });
  b.win.calcar.checkCompleted('job-tok-1', { product: 'check' });
  b.win.calcar.checkCompleted('job-tok-2', { product: 'check' });
  if (b.win.CALCAR_EVENTS.slice(before).filter(e => e.name === 'check_completed').length !== 2) errs.push('check_completed не раз на job');
  if (b.win.calcar.scoreBucket(7.4) !== '7-8' || b.win.calcar.scoreBucket(10) !== '9-10' || b.win.calcar.scoreBucket(null) !== 'none') errs.push('score_bucket не той');
  if (b.win.calcar.bucketSec(95000) !== '60-120s') errs.push('generation_time_bucket не той');
  /* report_viewed: прихована вкладка відкладає, потім рівно раз */
  const b2 = browser({ path: '/check/r/x/AbCdEfGh123' });
  const d2 = b2.win.document; d2.visibilityState = 'hidden'; d2.removeEventListener = () => {};
  d2.documentElement = { getBoundingClientRect: () => ({ top: 0, height: 1000 }) };
  Object.assign(b2.win, { setInterval: () => 1, clearInterval() {}, addEventListener() {}, innerHeight: 800 });
  b2.win.calcar.reportViewed({ product: 'check', readonly: false });
  const views = () => b2.win.CALCAR_EVENTS.filter(e => e.name === 'report_viewed').length;
  if (views() !== 0) errs.push('report_viewed у прихованій вкладці');
  d2.visibilityState = 'visible'; b2.fire('visibilitychange');
  b2.win.calcar.reportViewed({ product: 'check' }); b2.fire('visibilitychange');
  if (views() !== 1) errs.push('report_viewed не рівно раз: ' + views());
  /* PostHog недоступний: track не кидає, звіт живе */
  const b3 = browser({ path: '/check/r/x/AbCdEfGh123', pub: { analytics: { posthog_key: 'phc_' + 'y'.repeat(40), posthog_host: 'https://eu.i.posthog.com', ga4_id: '' }, contacts: {} } });
  b3.win.posthog.capture = () => { throw new Error('blocked'); };
  try { b3.win.calcar.track('share_clicked', {}); b3.win.calcar.checkCompleted('t', {}); } catch (e) { errs.push('збій PostHog ламає виклик track'); }
  /* payload у PostHog: чат, памʼять, відгук без тексту, VIN, email, токена */
  const sent = []; b3.win.posthog.capture = (n, p) => sent.push({ n, p });
  b3.win.calcar.track('chat_message_sent', { page_type: 'check_report', attachments: 1, message: 'мій бюджет 20к', content: 'x', body: 'y', text: 'z' });
  b3.win.calcar.track('memory_updated', { action: 'saved', memory: 'Людина шукає X5', content: 'пам', note: 'n' });
  b3.win.calcar.track('feedback_submitted', { useful: false, reason: 'data_error', comment: 'VIN WBAJA7C51KWW12345 неправильний', text: 'приватний текст' });
  b3.win.calcar.track('chat_opened', { page_type: 'check_report', email: 'a@b.co', vin: 'WBAJA7C51KWW12345', plate: 'AA1234BB', listing_url: 'https://auto.ria.com/x', token: 'AbCdEfGh123' });
  const flat = JSON.stringify(sent);
  if (sent.length !== 4) errs.push('у PostHog дійшло не 4 події: ' + sent.length);
  if (/бюджет|Людина|пам|приватний|WBAJA7C51KWW12345|a@b\.co|AA1234BB|auto\.ria\.com\/x|AbCdEfGh123/.test(flat)) errs.push('чутливі дані в payload PostHog: ' + flat);
  const fs1 = sent.find(x => x.n === 'feedback_submitted');
  if (!fs1 || fs1.p.useful !== false || fs1.p.reason !== 'data_error') errs.push('feedback_submitted загубив useful/reason');
  if (sent[0].p.attachments !== 1 || sent[0].p.page_type !== 'check_report') errs.push('безпечні властивості чату загублені');
}

/* ---------- 6. підключення і події на сторінках ---------- */
{
  const INCLUDE = '<script src="/calcar-public.js"></script>\n<script src="/analytics.js"></script>';
  for (const f of PAGES) {
    const s = S[f];
    if (!s.includes(INCLUDE)) errs.push(f + ': шар аналітики не підключений');
    else if (s.indexOf(INCLUDE) > s.indexOf('<script src="/chat.js">')) errs.push(f + ': аналітика підключена після chat.js, подія відкриття помічника може загубитись');
    if (!/window\.CALCAR_USER_ID = /.test(s)) errs.push(f + ': user id для identify не виставляється');
    if (!s.includes("if (signedIn && window.CALCAR_USER_ID && window.calcar) window.calcar.identify(window.CALCAR_USER_ID);")) errs.push(f + ': identify не викликається зі спільного блоку шапки');
  }
  const EV = {
    'check.html': ["track('check_started'", 'calcar.checkCompleted('],
    'result-check.html': ['calcar.reportViewed(', "track('share_clicked'", "track('seller_description_opened'", "'feedback_yes'", "'feedback_no'", "track('feedback_submitted'", 'calcar.checkCompleted('],
    'cabinet.html': ["memory: 'memory_opened'", "account: 'settings_opened'", "track('memory_updated'"],
  };
  const chatSrc = fs.readFileSync('chat.js', 'utf8');
  for (const [f, names] of Object.entries(EV)) for (const n of names) if (!S[f].includes(n)) errs.push(f + ': нема ' + n);
  for (const n of ["ctrack('chat_opened'", "ctrack('chat_message_sent'"]) if (!chatSrc.includes(n)) errs.push('chat.js: нема ' + n);
  /* старі події не шлються ніде */
  for (const f of PAGES) if (/track\('(analysis_started|analysis_completed|report_shared|memory_saved|landing_view|youtube_)/.test(S[f])) errs.push(f + ': стара подія поза beta-таксономією');
  if (!/setPerson\(\{ checks_started: n \}\)/.test(S['check.html'])) errs.push('check.html: лічильник перевірок людини не ведеться');
  /* check_completed лише на успіху: у catch завершення нема */
  const runFn = S['check.html'].slice(S['check.html'].indexOf("statusEl.className = 'hf-status';\n"), S['check.html'].indexOf('/* Спільна поведінка шапки'));
  if (/catch \(e\) \{[^}]*trackCompleted/.test(runFn)) errs.push('check_completed шлеться на помилці');
  if (!/data = await pollJob\(token\);\n    \} else \{[\s\S]{0,160}?\n    \}\n\n    trackCompleted\(data, token, runStart\);/.test(S['check.html'])) errs.push('check_completed не після готового звіту');
  if (!/const report = await pollJob\(pj\.token\);\n    trackCompleted\(report, pj\.token, pj\.at\);/.test(S['check.html'])) errs.push('відновлене опитування не шле check_completed');
  /* CalCar AI: кнопка шапки і CTA висновку */
  if (!/closest\('#aiBtn, #pdChatBtn'\)/.test(an)) errs.push('calcar_ai_clicked не слухає #aiBtn/#pdChatBtn');
  /* chat_opened лише на перехід закрито -> відкрито; chat_message_sent лише після успішної відповіді */
  if (!/var wasOpen = els\.panel\.classList\.contains\('open'\);\n\s*els\.panel\.classList\.add\('open'\);\n\s*if \(!wasOpen\) ctrack\('chat_opened'/.test(chatSrc)) errs.push('chat_opened не ідемпотентний');
  if (!/if \(!r\.ok \|\| !data\.reply\) throw[\s\S]{0,400}ctrack\('chat_message_sent'/.test(chatSrc)) errs.push('chat_message_sent не після успішної відповіді');
  const cmsCall = (chatSrc.match(/ctrack\('chat_message_sent', \{[^}]*\}\)/) || [''])[0];
  if (/text|shown|content|message|body|memory|data\.reply|messages/.test(cmsCall.replace("'chat_message_sent'", ''))) errs.push('chat_message_sent несе текст: ' + cmsCall);
  const memCall = (S['cabinet.html'].match(/track\('memory_updated', \{[^}]*\}\)/) || [''])[0];
  if (!memCall || /ta\.value|memory:|saved =|okMsg|text[,}]/.test(memCall)) errs.push('memory_updated несе вміст памʼяті: ' + memCall);
  if (!/\{ error \} = await SB\.from\('user_memory'\)[\s\S]{0,200}else \{[\s\S]{0,200}track\('memory_updated'/.test(S['cabinet.html'])) errs.push('memory_updated не лише після успішного збереження');
  if (!/if \(name !== curTab && TAB_EVENTS\[name\]\)/.test(S['cabinet.html'])) errs.push('memory_opened/settings_opened не раз на фактичне відкриття');
}

/* ---------- 7. відгук про звіт ---------- */
(async () => {
  const { sanitizeFeedback } = await import('./api/feedback.js');
  const ok = sanitizeFeedback({ report_ref: 'AbC123xyz', verdict: 'positive', text: '  бракує історії ДТП \u2014 і ціни ', anon_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', page: '/check/*', product: 'check' });
  if (ok.error) errs.push('коректний відгук відхилено: ' + ok.error);
  else {
    if (ok.text !== 'бракує історії ДТП , і ціни') errs.push('текст відгуку не почищений: ' + JSON.stringify(ok.text));
    if (ok.anon_id !== 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') errs.push('anon_id загублений');
  }
  if (!sanitizeFeedback({ report_ref: 'x', verdict: 'positive' }).error) errs.push('короткий report_ref пройшов');
  if (!sanitizeFeedback({ report_ref: 'AbC123xyz', verdict: 'meh' }).error) errs.push('невідомий verdict пройшов');
  if (sanitizeFeedback({ report_ref: 'AbC123xyz', verdict: 'negative', anon_id: 'not-a-uuid' }).anon_id !== null) errs.push('невалідний anon_id пройшов');
  if (sanitizeFeedback({ report_ref: 'AbC123xyz', verdict: 'negative', text: 'x'.repeat(5000) }).text.length !== 1000) errs.push('текст відгуку не обрізаний до 1000');
  if (sanitizeFeedback({ report_ref: '../../etc', verdict: 'negative' }).error !== 'bad_ref') errs.push('report_ref зі сміттям пройшов');
  /* UI: після вердикту, два стани, без модалки, на Score не впливає */
  const r = S['result-check.html'];
  const vc = r.slice(r.indexOf('<div class="card fbx" id="fbBox" hidden>'), r.indexOf('\n</div>\n\n<footer>'));
  /* beta-відгук: останній блок звіту, схований до перевірки воріт */
  if (!vc) errs.push('відгук не останній блок звіту або не схований');
  if (/class="fb" id="fbBox"|data-fb="positive"[^>]*>👍/.test(r)) errs.push('старий постійний блок відгуку повернувся');
  if (!/Was the report useful\?/.test(vc) || !/data-fb="positive">Yes</.test(vc) || !/data-fb="negative">Not really</.test(vc)) errs.push('нема питання і кнопок Так / Не зовсім');
  if (!/id="fbText"[^>]*maxlength="1000"/.test(vc)) errs.push('поле "що покращити" без ліміту');
  if (/fbBox[\s\S]{0,400}setTimeout\(\s*\(\)\s*=>\s*\{?\s*box\.hidden\s*=\s*false/.test(r)) errs.push('відгук показується за таймером');
  if (!/fetch\('\/api\/feedback'/.test(r)) errs.push('відгук не йде в /api/feedback');
  if (!/report_ref: r, product: 'check', verdict, reason: reason \|\| null, text: text \|\| '', anon_id: window\.calcar \? window\.calcar\.aid\(\) : null/.test(r)) errs.push('тіло відгуку не те (report_ref/verdict/reason/text/anon_id)');
  /* в аналітику лише так/ні і категорія причини, текст ніколи */
  const fbJs = r.slice(r.indexOf('const FEEDBACK_FIRST_N'), r.indexOf('window.calcarFeedbackInit = init'));
  const fbTracks = fbJs.match(/track\([^;]*'feedback_[a-z]+'[^;]*;/g) || [];
  if (fbTracks.length < 3) errs.push('події відгуку не знайдені: ' + fbTracks.length);
  for (const c of fbTracks) if (/txt|text|value/.test(c)) errs.push('текст відгуку йде в аналітику: ' + c);
  if (!/track\('feedback_submitted', \{ useful: false, reason \}\)/.test(fbJs)) errs.push('feedback_submitted без useful/reason');
  /* причина лише з переліку і лише для "не зовсім" */
  if (sanitizeFeedback({ report_ref: 'AbC123xyz', verdict: 'negative', reason: 'data_error' }).reason !== 'data_error') errs.push('причина загублена');
  if (sanitizeFeedback({ report_ref: 'AbC123xyz', verdict: 'negative', reason: 'drop table' }).reason !== null) errs.push('невідома причина пройшла');
  if (sanitizeFeedback({ report_ref: 'AbC123xyz', verdict: 'positive', reason: 'other' }).reason !== null) errs.push('причина в позитивного відгуку');
  if (/score[^\n]*fb|fb[^\n]*score/i.test((r.match(/\/\* Відгук про звіт[\s\S]*?\}\)\(\);/) || [''])[0])) errs.push('відгук чіпає Score');
  const table = fs.readFileSync('supabase-feedback.sql', 'utf8');
  for (const col of ['report_ref', 'user_id', 'anon_id', 'verdict', 'reason', 'text', 'lang', 'created_at']) if (!table.includes(col)) errs.push('supabase-feedback.sql: нема колонки ' + col);
  if (!/enable row level security/i.test(table)) errs.push('supabase-feedback.sql: RLS не увімкнений');
  finish();
})().catch(e => { errs.push('feedback: ' + (e.stack || e.message)); finish(); });

/* ---------- 8. тур першого запуску ---------- */
function tourChecks() {
  const blocks = new Map();
  for (const f of PAGES) {
    const m = S[f].match(/<script>\n\/\* Перший запуск CalCar: тур із двох кроків[\s\S]*?\n<\/script>/);
    if (!m) { errs.push(f + ': нема блоку туру'); continue; }
    blocks.set(f, m[0]);
    /* тур стоїть після спільного блоку шапки і перед лаунчером */
    if (S[f].indexOf('/* Спільна поведінка шапки') > S[f].indexOf(m[0])) errs.push(f + ': тур стоїть перед блоком шапки');
    if (S[f].indexOf('/* Лаунчер продуктів CalCar: спільний блок') < S[f].indexOf(m[0])) errs.push(f + ': тур стоїть після лаунчера');
  }
  if (new Set(blocks.values()).size > 1) errs.push('блок туру розійшовся між сторінками');
  const src = (blocks.get('check.html') || '').replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  if (!src) return;
  if (!/prefers-reduced-motion:reduce\)\{\.tour-pulse::after\{animation:none/.test(src)) errs.push('пульсація не вимикається за prefers-reduced-motion');
  if (!/'calcar_tour'/.test(src)) errs.push('стан туру не в localStorage calcar_tour');
  for (const k of ['Next', 'Skip', 'Done', 'Open memory', 'Sign in', 'Create an account and your reports will be saved: you can come back to previous checks at any time.', 'This is your personal car assistant. It knows your current reports, can explain any conclusion, and over time remembers which cars and conditions suit you.', 'This is where CalCar keeps what it knows about your preferences. If you have already discussed choosing a car with another AI assistant, you can bring that context here instead of starting from scratch.']) {
    if (!src.includes("'" + k + "'")) errs.push('у турі нема тексту "' + k.slice(0, 30) + '"');
    for (const d of ['i18n/ua.js', 'i18n/ru.js']) if (!fs.readFileSync(d, 'utf8').includes("'" + k + "':")) errs.push('нема перекладу туру "' + k.slice(0, 30) + '" у ' + d);
  }
  if (!/z-index:420/.test(src)) errs.push('поповер туру не вище за панель меню (410)');
  if (!/p\.right \+ 12/.test(src) || !/p\.top - h - 12/.test(src)) errs.push('поповер кроку 2 не ставиться поруч із меню (праворуч на десктопі, над шторкою на телефоні)');
  if (!/pop\.addEventListener\('click', function \(e\) \{ e\.stopPropagation\(\); \}\)/.test(src)) errs.push('кліки по поповеру доходять до лаунчера і закривають меню');
  /* поведінка під заглушкою: крок 1 -> Далі -> меню відкрите, рядок памʼяті
     підсвічений, поповер поруч -> Готово; гість бачить рядок памʼяті; Skip;
     клік по помічнику; продовження після переходу; повторно не показується */
  function run(opts) {
    const store = Object.assign({}, opts.storage || {});
    const listeners = {}; const els = {}; let pops = []; let timers = [];
    const mkCls = () => { const set = new Set(); return { add(...c) { c.forEach(x => set.add(x)); }, remove(...c) { c.forEach(x => set.delete(x)); }, contains: c => set.has(c), _set: set }; };
    const mk = id => { const e = { id, classList: mkCls(), getBoundingClientRect: () => ({ left: 100, width: 120, top: 30, bottom: 50, right: 456 }), closest(sel) { return sel === '#' + id ? e : null; } }; e.cls = e.classList._set; return e; };
    for (const id of ['aiBtn', 'lncBtn', 'lncPanel', 'authLink']) els[id] = mk(id);
    els.authLink.getAttribute = () => '/cabinet.html';
    els.lncBtn.click = () => { els.lncPanel.classList.add('open'); };
    const wrap = mk('accWrap'); if (opts.anon) wrap.classList.add('anon');
    const memRow = mk('memRow');
    const body = { cls: new Set(opts.bodyCls || []), classList: { contains(c) { return body.cls.has(c); } }, appendChild(el) { pops.push(el); } };
    const doc = {
      readyState: 'complete', body, head: { appendChild() {} },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      getElementById: id => (opts.noBtns ? null : els[id] || null),
      querySelector: sel => (sel === '.acc-wrap' ? wrap : sel === '.acc-menu a[href="/cabinet.html#memory"]' ? memRow : null),
      createElement: tag => {
        const el = { tag, style: {}, buttons: {}, _html: '', offsetWidth: 320, offsetHeight: 160, remove() { pops = pops.filter(p => p !== el); }, setAttribute() {}, addEventListener() {},
          querySelector(sel) { return el.buttons[sel] || (el.buttons[sel] = { onclick: null }); } };
        Object.defineProperty(el, 'innerHTML', { set(v) { el._html = v; }, get() { return el._html; } });
        return el;
      },
    };
    const win = { document: doc, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, location: { pathname: opts.path || '/', href: '' }, t: x => x, innerWidth: 1200, innerHeight: 800, addEventListener() {}, matchMedia: () => ({ matches: !!opts.mobile }), setTimeout: fn => { timers.push(fn); }, MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }, JSON, Math, String, Object };
    win.window = win;
    vm.createContext(win);
    vm.runInContext(src, win);
    const flush = () => { while (timers.length) timers.shift()(); };
    flush();
    return { store, els, wrap, memRow, pops: () => pops, flush, fire: (t, ev) => { (listeners[t] || []).forEach(fn => fn(ev)); flush(); }, win };
  }
  let r = run({ path: '/check' });
  if (!r.els.aiBtn.cls.has('tour-pulse')) errs.push('крок 1 не підсвічує кнопку помічника');
  if (r.pops().length !== 1 || !/1 \/ 2/.test(r.pops()[0]._html)) errs.push('крок 1 без поповера');
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  if (!r.els.lncPanel.cls.has('open')) errs.push('Далі не відкриває меню');
  if (r.els.aiBtn.cls.has('tour-pulse') || !r.memRow.cls.has('tour-pulse') || !r.memRow.cls.has('tour-row')) errs.push('крок 2 не підсвічує рядок памʼяті помічника');
  if (r.els.lncBtn.cls.has('tour-pulse')) errs.push('крок 2 підсвічує кнопку меню замість рядка памʼяті');
  if (!/2 \/ 2/.test((r.pops()[0] || {})._html || '')) errs.push('крок 2 без поповера про памʼять');
  if (r.store.calcar_tour !== 'step2') errs.push('крок 2 не запамʼятовується як step2');
  if (r.pops()[0].style.left !== '468px') errs.push('поповер кроку 2 не праворуч від меню: left=' + r.pops()[0].style.left);
  if (r.wrap.cls.has('tour-memory')) errs.push('увійшлому користувачу вмикається гостьовий показ рядка памʼяті');
  r.pops()[0].buttons['.tour-side'].onclick();
  if (r.store.calcar_tour !== 'done' || r.pops().length || r.memRow.cls.has('tour-pulse')) errs.push('Готово не завершує тур');
  /* гість: рядок памʼяті тимчасово показується, після туру ховається знову */
  r = run({ path: '/', anon: true });
  if (!/1 \/ 3/.test(r.pops()[0]._html)) errs.push('гість не бачить, що кроків три');
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  if (!r.wrap.cls.has('tour-memory')) errs.push('гостю не показується рядок памʼяті на кроці 2');
  if (!/2 \/ 3/.test(r.pops()[0]._html) || !/>Next</.test(r.pops()[0]._html) || !/>Skip</.test(r.pops()[0]._html)) errs.push('крок 2 гостя не веде далі до кроку про акаунт');
  /* крок 3 лише гостю: "Увійти" в тому самому меню, пояснення про збережені звіти */
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  if (r.pops().length !== 1 || !/3 \/ 3/.test(r.pops()[0]._html) || !/Create an account and your reports will be saved/.test(r.pops()[0]._html)) errs.push('гостю не показано крок про акаунт');
  if (!r.els.authLink.cls.has('tour-pulse') || r.memRow.cls.has('tour-pulse') || !r.els.lncPanel.cls.has('open')) errs.push('крок 3 не підсвічує "Увійти" у відкритому меню');
  if (r.wrap.cls.has('tour-memory')) errs.push('гостьовий показ рядка памʼяті не знімається після кроку 2');
  if (!/>Sign in</.test(r.pops()[0]._html) || !/>Done</.test(r.pops()[0]._html)) errs.push('крок 3 без "Увійти" і "Готово"');
  /* "Готово" закриває тур без реєстрації і нікуди не веде */
  r.pops()[0].buttons['.tour-side'].onclick();
  if (r.store.calcar_tour !== 'done' || r.pops().length || r.win.location.href !== '' || r.els.authLink.cls.has('tour-pulse')) errs.push('крок 3: "Готово" не завершує тур або змушує входити');
  /* "Увійти" веде на вхід */
  r = run({ path: '/', anon: true });
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  r.pops()[0].buttons['.tour-main'].onclick();
  if (r.store.calcar_tour !== 'done' || r.win.location.href !== '/cabinet.html') errs.push('крок 3: "Увійти" не веде на вхід');
  /* "Пропустити" на кроці 2 гостя завершує тур */
  r = run({ path: '/', anon: true });
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  r.pops()[0].buttons['.tour-side'].onclick();
  if (r.store.calcar_tour !== 'skip' || r.pops().length) errs.push('гість не може пропустити тур на кроці 2');
  /* хто увійшов: кроків два, третього немає, крок 2 веде в памʼять */
  r = run({ path: '/' });
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  if (r.store.calcar_tour !== 'done' || r.win.location.href !== '/cabinet.html#memory' || r.pops().length || r.els.authLink.cls.has('tour-pulse')) errs.push('тому, хто увійшов, показано крок про акаунт або "Відкрити памʼять" не веде в памʼять');
  /* телефон: поповер над шторкою */
  r = run({ path: '/', mobile: true });
  r.pops()[0].buttons['.tour-main'].onclick(); r.flush();
  if (r.pops()[0].style.left !== '12px' || r.pops()[0].style.top !== '12px') errs.push('на телефоні поповер кроку 2 не над шторкою: ' + r.pops()[0].style.left + '/' + r.pops()[0].style.top);
  r.pops()[0].buttons['.tour-side'].onclick();
  /* Пропустити на кроці 1 */
  r = run({ path: '/' });
  r.pops()[0].buttons['.tour-side'].onclick();
  if (r.store.calcar_tour !== 'skip' || r.els.aiBtn.cls.has('tour-pulse')) errs.push('Пропустити не завершує тур');
  /* відкриття помічника = крок 1; крок 2 після закриття панелі помічника */
  r = run({ path: '/' });
  r.fire('calcar-chat-state', { detail: { open: true } });
  if (r.els.aiBtn.cls.has('tour-pulse') || r.pops().length) errs.push('після відкриття помічника крок 1 не знято');
  if (r.els.lncPanel.cls.has('open')) errs.push('меню відкрилось поверх розмови з помічником');
  if (r.store.calcar_tour !== 'step2') errs.push('відкриття помічника не запамʼятовує крок 1 як пройдений');
  r.fire('calcar-chat-state', { detail: { open: false } });
  if (!r.els.lncPanel.cls.has('open') || !r.memRow.cls.has('tour-pulse')) errs.push('після закриття помічника крок 2 не показався');
  /* продовження після переходу: step2 у сховищі -> одразу крок 2 */
  r = run({ path: '/import', storage: { calcar_tour: 'step2' } });
  if (!r.els.lncPanel.cls.has('open') || !r.memRow.cls.has('tour-pulse') || !/2 \/ 2/.test((r.pops()[0] || {})._html || '')) errs.push('крок 2 не продовжується на наступній сторінці');
  /* повторно не показується: done, skip, тред помічника, публічний звіт, read-only */
  for (const [name, opts] of Object.entries({
    'після done': { storage: { calcar_tour: 'done' } },
    'після skip': { storage: { calcar_tour: 'skip' } },
    'кому вже відповідав помічник': { storage: { calcar_assistant_thread: JSON.stringify({ id: 'x', messages: [{ role: 'user', text: 'hi' }] }) } },
    'на публічному звіті': { path: '/check/r/bmw-x5/AbCdEf12' },
    'на read-only звіті': { path: '/check/AB12CD', bodyCls: ['readonly', 'report-ready'] },
  })) {
    const x = run(opts);
    if (x.pops().length || x.els.aiBtn.cls.has('tour-pulse') || x.els.lncPanel.cls.has('open')) errs.push('тур показується ' + name);
  }
  /* хто вже має памʼять: кабінет ставить done */
  if (!/if \(saved\.trim\(\)\) \{ try \{ localStorage\.setItem\('calcar_tour', 'done'\); \}/.test(S['cabinet.html'])) errs.push('кабінет не відмічає тур пройденим для тих, хто вже має памʼять');
}
tourChecks();

/* ---------- 9. навігація і контакти ---------- */
{
  for (const f of PAGES) {
    const s = S[f];
    if (!s.includes("var col = document.getElementById('ftContacts'), c = window.CALCAR_PUBLIC && window.CALCAR_PUBLIC.contacts;")) errs.push(f + ': контакти футера не читаються з конфігу');
  }
  /* Telegram заданий власником (публічний канал підтримки), email лишається порожнім, поки не заданий */
  if (!/contacts: \{\n    telegram: 'https:\/\/t\.me\/calcar_ai',\n    email: '',\n  \}/.test(pub)) errs.push('calcar-public.js: контакти не ті (Telegram t.me/calcar_ai, email порожній)');
  for (const key of ['posthog_key', 'posthog_host', 'ga4_id', 'contacts.telegram', 'contacts.email']) if (!pub.includes(key)) errs.push('calcar-public.js: у коментарі нема, що заповнити: ' + key);
  /* контакти: під заглушкою з заповненим конфігом колонка зʼявляється */
  const hdr = (S['check.html'].match(/<script>\n\/\* Спільна поведінка шапки[\s\S]*?<\/script>/) || [''])[0].replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  const col = { hidden: true, kids: [], appendChild(a) { this.kids.push(a); } };
  const ctx = { window: { CALCAR_PUBLIC: { contacts: { telegram: 'https://t.me/calcar', email: 'hello@calcar.io' } }, matchMedia: () => ({ matches: true }) }, document: { addEventListener() {}, getElementById: id => (id === 'ftContacts' ? col : null), createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] } };
  ctx.window.document = ctx.document; vm.createContext(ctx); vm.runInContext(hdr, ctx);
  if (col.hidden || col.kids.length !== 2 || col.kids[0].href !== 'https://t.me/calcar' || col.kids[1].href !== 'mailto:hello@calcar.io') errs.push('контакти футера не заповнюються з конфігу');
  /* Telegram у футері показується як іконка + @handle, не як слово "Telegram" і не як адреса */
  if (!/@calcar$/.test(col.kids[0].innerHTML || '') || !/tg-ic/.test(col.kids[0].innerHTML || '')) errs.push('Telegram у футері не "іконка + @handle": ' + col.kids[0].innerHTML);
  const col2 = { hidden: true, kids: [], appendChild(a) { this.kids.push(a); } };
  const ctx2 = { window: { CALCAR_PUBLIC: { contacts: { telegram: 'javascript:alert(1)', email: 'not-an-email' } }, matchMedia: () => ({ matches: true }) }, document: { addEventListener() {}, getElementById: id => (id === 'ftContacts' ? col2 : null), createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] } };
  ctx2.window.document = ctx2.document; vm.createContext(ctx2); vm.runInContext(hdr, ctx2);
  if (!col2.hidden || col2.kids.length) errs.push('невалідні контакти потрапили у футер');
  /* Check: підпис, підказка і плейсхолдер */
  const c = S['check.html'];
  if (!c.includes('<label class="hf-label" for="urlInput">Car listing link</label>')) errs.push('check.html: нема підпису поля');
  /* плейсхолдер це дія людини, а не обрізана адреса (landingtest.js) */
  if (!c.includes('placeholder="Paste a vehicle listing link"')) errs.push('check.html: плейсхолдер не людська дія');
  /* приклад джерела під полем, типовий час окремо під кнопкою (landingtest.js) */
  if (!c.includes('<div class="hf-help">For example, a listing from a supported marketplace</div>')) errs.push('check.html: нема підказки під полем');
  if (!c.includes('<span class="hf-time">Usually ~90 sec</span>')) errs.push('check.html: нема типового часу перевірки');
  for (const d of ['i18n/ua.js', 'i18n/ru.js']) {
    const t = fs.readFileSync(d, 'utf8');
    for (const k of ['Car listing link', 'Paste a vehicle listing link', 'For example, a listing from a supported marketplace', 'Contact', 'Did this analysis help you decide?', 'Yes', 'Not really', 'What was missing?', 'Transfer from an AI chat', 'CalCar does not know much about you yet']) if (!t.includes("'" + k + "':")) errs.push(d + ': нема ключа "' + k + '"');
  }
  /* мова памʼяті: одна й та сама правило в обох специфікаціях, мова інтерфейсу передається */
  const mem = fs.readFileSync('api/memory.js', 'utf8'), chat = fs.readFileSync('api/chat.js', 'utf8');
  if (/Мовою, якою переважно пише користувач/.test(mem + chat)) errs.push('NOTE_SPEC досі пише памʼять мовою користувача, а не інтерфейсу');
  if (!/МОВА НОТАТКИ: ' \+ LANG_NAME\[lang\]/.test(mem) || !/МОВА НОТАТКИ: ' \+ LANG_NAME\[lang\]/.test(chat)) errs.push('мова інтерфейсу не передається в генератор памʼяті');
}

function finish() {
  if (errs.length) { console.log('ANALYTICS TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('аналітика: вхолосту без ключів · таксономія · приватне не проходить · uuid без fingerprinting · PostHog лише кастомні події, URL знеособлений · 6 сторінок + identify · відгук sanitize/UI/SQL · тур: спільний блок, 2 кроки, один раз · контакти з конфігу · копірайт Check · мова памʼяті');
  console.log('ANALYTICS TEST PASSED');
}
