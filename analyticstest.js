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
  /* автоматична подія лендингу */
  const lv = b.win.CALCAR_EVENTS.find(e => e.name === 'landing_view');
  if (!lv) errs.push('на /check нема автоматичної landing_view');
  else if (lv.props.product !== 'check' || lv.props.lang !== 'ru') errs.push('landing_view без product/lang: ' + JSON.stringify(lv.props));
  /* плейсхолдери з коментаря конфігу (phc_..., G-XXXXXXX) це не ключі */
  if (/phc_[A-Za-z0-9]{10,}|G-(?!X+\b)[A-Z0-9]{6,}/.test(an + pub)) errs.push('у коді захардкоджений ключ аналітики');
}

/* ---------- 2. таксономія: лише відомі імена ---------- */
{
  const b = browser({ path: '/' });
  const WANT = ['landing_view', 'analysis_started', 'analysis_completed', 'report_viewed', 'report_shared', 'assistant_opened', 'memory_opened', 'memory_saved', 'deep_check_clicked'];
  for (const w of WANT) if (!b.win.calcar.events.includes(w)) errs.push('події "' + w + '" нема в таксономії');
  if (b.win.calcar.track('page_view_custom', {})) errs.push('невідома подія пройшла');
  if (!b.win.calcar.track('analysis_started', { marketplace: 'auto.ria.com' })) errs.push('відома подія не пройшла');
  const ev = b.win.CALCAR_EVENTS[b.win.CALCAR_EVENTS.length - 1];
  if (ev.props.marketplace !== 'auto.ria.com') errs.push('дозволена властивість загублена');
  for (const k of ['page', 'product', 'lang', 'signed_in', 'acq_source']) if (!(k in ev.props)) errs.push('у події нема базової властивості ' + k);
}

/* ---------- 3. приватне не проходить, навіть якщо передали ---------- */
{
  const b = browser({ path: '/check/AB12CD' });
  b.win.calcar.track('assistant_opened', {
    text: 'мій бюджет 20 тисяч', message: 'hello', memory: 'Людина: ...', seller_description: 'продам авто',
    description: 'x', prompt: 'p', content: 'c', email: 'a@b.c', phone: '+380', token: 'abc', vin: 'WBA12345678901234',
    listing_url: 'https://auto.ria.com/uk/auto_x.html', title: 'BMW X5', note: 'n', payment_card: '4111',
    long: 'x'.repeat(200), multiline: 'a\nb', ok_number: 3, ok_flag: true, marketplace: 'auto.ria.com',
  });
  const p = b.win.CALCAR_EVENTS[b.win.CALCAR_EVENTS.length - 1].props;
  for (const k of ['text', 'message', 'memory', 'seller_description', 'description', 'prompt', 'content', 'email', 'phone', 'token', 'listing_url', 'title', 'note', 'payment_card', 'long', 'multiline']) {
    if (k in p) errs.push('приватна властивість пройшла в подію: ' + k);
  }
  if (p.ok_number !== 3 || p.ok_flag !== true || p.marketplace !== 'auto.ria.com') errs.push('нешкідливі властивості загублені');
  /* VIN: без потреби не шлемо; у санітайзері окремої заборони нема, тому
     жодна сторінка не має передавати vin у track() */
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

/* ---------- 5. session replay: маскування і блокування ---------- */
{
  if (!/maskAllInputs: true/.test(an)) errs.push('replay не маскує поля вводу');
  const block = (an.match(/blockSelector: '([^']+)'/) || [])[1] || '';
  for (const sel of ['.cc-panel', '#memCard', '#authBox']) if (!block.includes(sel)) errs.push('replay не блокує ' + sel);
  if (!block.includes('[data-private-block]')) errs.push('нема загального маркера приватного блоку для replay');
  if (!/autocapture: false/.test(an)) errs.push('autocapture увімкнений: він тягне текст кнопок і полів');
  /* поле відгуку і редактор памʼяті позначені приватними */
  if (!/<div class="fb-more" id="fbMore" hidden data-private-block>/.test(S['result-check.html'])) errs.push('поле відгуку не приховане від replay');
  for (const id of ['memCard', 'authBox']) if (!S['cabinet.html'].includes('id="' + id + '"')) errs.push('cabinet.html: нема #' + id + ', селектор блокування replay порожній');
  if (!fs.readFileSync('chat.js', 'utf8').includes('cc-panel')) errs.push('chat.js: панель помічника не .cc-panel, replay її не блокує');
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
    'check.html': ['analysis_started', 'analysis_completed'],
    'import.html': ['analysis_started', 'analysis_completed'],
    'result-check.html': ['report_viewed', 'report_shared'],
    'result.html': ['report_viewed'],
    'cabinet.html': ['memory_opened', 'memory_saved'],
  };
  for (const [f, names] of Object.entries(EV)) for (const n of names) if (!S[f].includes("track('" + n + "'")) errs.push(f + ': нема події ' + n);
  if (!/track\('analysis_completed', \{ [^}]*success: true/.test(S['check.html']) || !/duration_ms/.test(S['check.html'])) errs.push('check.html: analysis_completed без success/duration_ms');
  if (!/setPerson\(\{ checks_started/.test(S['check.html'])) errs.push('check.html: лічильник перевірок людини не ведеться (другий/третій Check)');
  /* assistant_opened і data-track живуть у самому шарі */
  if (!/calcar-chat-state/.test(an) || !/data-track/.test(an)) errs.push('шар не слухає відкриття помічника або data-track');
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
  const vc = r.slice(r.indexOf('id="verdictCard"'), r.indexOf('id="risksCard"'));
  if (!/<div class="fb" id="fbBox">/.test(vc)) errs.push('блок відгуку не в картці вердикту');
  if (vc.indexOf('class="pd-cta"') > vc.indexOf('id="fbBox"')) errs.push('відгук стоїть перед CTA чату');
  if (!/data-fb="positive"/.test(vc) || !/data-fb="negative"/.test(vc)) errs.push('нема кнопок 👍/👎');
  if (!/id="fbText"[^>]*maxlength="1000"/.test(vc)) errs.push('поле "чого не вистачило" без ліміту');
  if (!/fetch\('\/api\/feedback'/.test(r)) errs.push('відгук не йде в /api/feedback');
  if (!/report_ref: r, product: 'check', verdict, text: text \|\| '', anon_id: window\.calcar \? window\.calcar\.aid\(\) : null/.test(r)) errs.push('тіло відгуку не те (report_ref/verdict/text/anon_id)');
  if (/calcar\.track\('[^']*feedback/.test(r)) errs.push('текст відгуку або сама подія відгуку йде в аналітику');
  if (/score[^\n]*fb|fb[^\n]*score/i.test((r.match(/\/\* Відгук про звіт[\s\S]*?\}\)\(\);/) || [''])[0])) errs.push('відгук чіпає Score');
  const table = fs.readFileSync('supabase-feedback.sql', 'utf8');
  for (const col of ['report_ref', 'user_id', 'anon_id', 'verdict', 'text', 'created_at']) if (!table.includes(col)) errs.push('supabase-feedback.sql: нема колонки ' + col);
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
  for (const k of ['Next', 'Skip', 'Done', 'Open memory', 'This is your personal car assistant. It knows your current reports, can explain any conclusion, and over time remembers which cars and conditions suit you.', 'This is where CalCar keeps what it knows about your preferences. If you have already discussed choosing a car with ChatGPT or Claude, you can bring that context here instead of starting from scratch.']) {
    if (!src.includes("'" + k + "'")) errs.push('у турі нема тексту "' + k.slice(0, 30) + '"');
    for (const d of ['i18n/ua.js', 'i18n/ru.js']) if (!fs.readFileSync(d, 'utf8').includes("'" + k + "':")) errs.push('нема перекладу туру "' + k.slice(0, 30) + '" у ' + d);
  }
  /* поведінка під заглушкою: показ, крок 1 -> клік по помічнику -> крок 2 -> Готово; повторно не показується */
  function run(opts) {
    const store = Object.assign({}, opts.storage || {});
    const listeners = {}; const els = {}; let pops = [];
    const mk = id => ({ id, cls: new Set(), classList: { add(c) { this._.cls.add(c); }, remove(c) { this._.cls.delete(c); }, contains(c) { return this._.cls.has(c); } }, getBoundingClientRect: () => ({ left: 100, width: 120, bottom: 50 }), closest(sel) { return sel === '#' + id ? this : null; } });
    for (const id of ['aiBtn', 'lncBtn']) { els[id] = mk(id); els[id].classList._ = els[id]; }
    const body = { cls: new Set(opts.bodyCls || []), classList: { contains(c) { return body.cls.has(c); } }, appendChild(el) { pops.push(el); } };
    let timers = [];
    const doc = {
      readyState: 'complete', body, head: { appendChild() {} },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      getElementById: id => (opts.noBtns ? null : els[id] || null),
      createElement: tag => {
        const el = { tag, style: {}, buttons: {}, _html: '', remove() { pops = pops.filter(p => p !== el); }, setAttribute() {}, offsetWidth: 320,
          querySelector(sel) { return el.buttons[sel] || (el.buttons[sel] = { onclick: null }); } };
        Object.defineProperty(el, 'innerHTML', { set(v) { el._html = v; }, get() { return el._html; } });
        return el;
      },
    };
    const win = { document: doc, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, location: { pathname: opts.path || '/', href: '' }, t: x => x, innerWidth: 1200, addEventListener() {}, setTimeout: (fn) => { timers.push(fn); }, MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }, JSON, Math, String, Object };
    win.window = win;
    vm.createContext(win);
    vm.runInContext(src, win);
    timers.forEach(fn => fn());
    return { store, els, pops: () => pops, fire: (t, ev) => (listeners[t] || []).forEach(fn => fn(ev)), win };
  }
  let r = run({ path: '/check' });
  if (!r.els.aiBtn.cls.has('tour-pulse')) errs.push('крок 1 не підсвічує кнопку помічника');
  if (r.pops().length !== 1 || !/1 \/ 2/.test(r.pops()[0]._html)) errs.push('крок 1 без поповера');
  r.fire('click', { target: r.els.aiBtn });
  if (r.els.aiBtn.cls.has('tour-pulse') || !r.els.lncBtn.cls.has('tour-pulse')) errs.push('клік по помічнику не переводить на крок 2');
  if (!/2 \/ 2/.test((r.pops()[0] || {})._html || '')) errs.push('крок 2 без поповера про памʼять');
  r.pops()[0].buttons['.tour-side'].onclick();
  if (r.store.calcar_tour !== 'done' || r.pops().length) errs.push('Готово не завершує тур');
  /* Пропустити на кроці 1 */
  r = run({ path: '/' });
  r.pops()[0].buttons['.tour-side'].onclick();
  if (r.store.calcar_tour !== 'skip' || r.els.aiBtn.cls.has('tour-pulse')) errs.push('Пропустити не завершує тур');
  /* Далі -> крок 2 -> Відкрити памʼять */
  r = run({ path: '/' });
  r.pops()[0].buttons['.tour-main'].onclick();
  if (!r.els.lncBtn.cls.has('tour-pulse')) errs.push('Далі не переводить на крок 2');
  r.pops()[0].buttons['.tour-main'].onclick();
  if (r.store.calcar_tour !== 'done' || r.win.location.href !== '/cabinet.html#memory') errs.push('Відкрити памʼять не веде в памʼять кабінету');
  /* повторно не показується: done, skip, тред помічника, публічний звіт, read-only */
  for (const [name, opts] of Object.entries({
    'після done': { storage: { calcar_tour: 'done' } },
    'після skip': { storage: { calcar_tour: 'skip' } },
    'кому вже відповідав помічник': { storage: { calcar_assistant_thread: JSON.stringify({ id: 'x', messages: [{ role: 'user', text: 'hi' }] }) } },
    'на публічному звіті': { path: '/check/r/bmw-x5/AbCdEf12' },
    'на read-only звіті': { path: '/check/AB12CD', bodyCls: ['readonly', 'report-ready'] },
  })) {
    const x = run(opts);
    if (x.pops().length || x.els.aiBtn.cls.has('tour-pulse')) errs.push('тур показується ' + name);
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
  if (!/contacts: \{\n    telegram: '',\n    email: '',\n  \}/.test(pub)) errs.push('calcar-public.js: контакти не порожні за замовчуванням або іншої форми');
  for (const key of ['posthog_key', 'posthog_host', 'ga4_id', 'contacts.telegram', 'contacts.email']) if (!pub.includes(key)) errs.push('calcar-public.js: у коментарі нема, що заповнити: ' + key);
  /* контакти: під заглушкою з заповненим конфігом колонка зʼявляється */
  const hdr = (S['check.html'].match(/<script>\n\/\* Спільна поведінка шапки[\s\S]*?<\/script>/) || [''])[0].replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  const col = { hidden: true, kids: [], appendChild(a) { this.kids.push(a); } };
  const ctx = { window: { CALCAR_PUBLIC: { contacts: { telegram: 'https://t.me/calcar', email: 'hello@calcar.io' } }, matchMedia: () => ({ matches: true }) }, document: { addEventListener() {}, getElementById: id => (id === 'ftContacts' ? col : null), createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] } };
  ctx.window.document = ctx.document; vm.createContext(ctx); vm.runInContext(hdr, ctx);
  if (col.hidden || col.kids.length !== 2 || col.kids[0].href !== 'https://t.me/calcar' || col.kids[1].href !== 'mailto:hello@calcar.io') errs.push('контакти футера не заповнюються з конфігу');
  const col2 = { hidden: true, kids: [], appendChild(a) { this.kids.push(a); } };
  const ctx2 = { window: { CALCAR_PUBLIC: { contacts: { telegram: 'javascript:alert(1)', email: 'not-an-email' } }, matchMedia: () => ({ matches: true }) }, document: { addEventListener() {}, getElementById: id => (id === 'ftContacts' ? col2 : null), createElement: () => ({}), querySelector: () => null, querySelectorAll: () => [] } };
  ctx2.window.document = ctx2.document; vm.createContext(ctx2); vm.runInContext(hdr, ctx2);
  if (!col2.hidden || col2.kids.length) errs.push('невалідні контакти потрапили у футер');
  /* Check: підпис, підказка і плейсхолдер */
  const c = S['check.html'];
  if (!c.includes('<label class="hf-label" for="urlInput">Car listing link</label>')) errs.push('check.html: нема підпису поля');
  if (!c.includes('placeholder="https://auto.ria.com/..."')) errs.push('check.html: плейсхолдер не приклад адреси');
  if (!c.includes('<div class="hf-help">For example, paste a link to an AUTO.RIA listing</div>')) errs.push('check.html: нема підказки під полем');
  for (const d of ['i18n/ua.js', 'i18n/ru.js']) {
    const t = fs.readFileSync(d, 'utf8');
    for (const k of ['Car listing link', 'For example, paste a link to an AUTO.RIA listing', 'Contact', 'Was this analysis useful?', 'What was missing?', 'Transfer from ChatGPT / Claude', 'CalCar does not know much about you yet']) if (!t.includes("'" + k + "':")) errs.push(d + ': нема ключа "' + k + '"');
  }
  /* мова памʼяті: одна й та сама правило в обох специфікаціях, мова інтерфейсу передається */
  const mem = fs.readFileSync('api/memory.js', 'utf8'), chat = fs.readFileSync('api/chat.js', 'utf8');
  if (/Мовою, якою переважно пише користувач/.test(mem + chat)) errs.push('NOTE_SPEC досі пише памʼять мовою користувача, а не інтерфейсу');
  if (!/МОВА НОТАТКИ: ' \+ LANG_NAME\[lang\]/.test(mem) || !/МОВА НОТАТКИ: ' \+ LANG_NAME\[lang\]/.test(chat)) errs.push('мова інтерфейсу не передається в генератор памʼяті');
}

function finish() {
  if (errs.length) { console.log('ANALYTICS TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('аналітика: вхолосту без ключів · таксономія · приватне не проходить · uuid без fingerprinting · replay маскує · 6 сторінок + identify · відгук sanitize/UI/SQL · тур: спільний блок, 2 кроки, один раз · контакти з конфігу · копірайт Check · мова памʼяті');
  console.log('ANALYTICS TEST PASSED');
}
