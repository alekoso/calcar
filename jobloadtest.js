/* Завантаження публічного звіту за токеном: /api/check-job і сторінка.
   Сервер: читання job з таймаутом і одним повтором, увесь ендпоінт
   гарантовано вкладається в maxDuration; обидві спроби невдалі -> 503 зі
   структурованим логом, не 200 і не "job ще триває".
   Сторінка: збій мережі чи 5xx це НЕ стадії аналізу; швидкі обмежені
   повтори 1-2-3-5 с; після 5 збоїв поспіль людське повідомлення; ручний
   повтор перечитує той самий job і не створює новий Check; 404 не
   повторюється. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };

const TOK = 'AbCdEfGhIjKlMnOpQrStUv';

(async () => {
  /* ---------- 1. сервер ---------- */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_jobload_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
  const J = await import('file://' + path.join(dir, 'api', 'check-job.js'));
  const src = fs.readFileSync('api/check-job.js', 'utf8');

  /* бюджет: дві спроби + пауза + PATCH застряглого job менше maxDuration із запасом */
  const maxD = Number((src.match(/export const config = \{ maxDuration: (\d+) \}/) || [])[1]) * 1000;
  const worst = J.JOB_READ_ATTEMPTS * J.JOB_READ_TIMEOUT_MS + J.JOB_READ_BACKOFF_MS + J.JOB_PATCH_TIMEOUT_MS;
  ok(maxD === 15000, 'maxDuration check-job не 15 с');
  ok(worst <= maxD - 1500, 'гірший випадок ' + worst + ' мс не лишає запасу до ' + maxD);
  ok(J.JOB_READ_ATTEMPTS === 2 && J.JOB_READ_TIMEOUT_MS >= 4000 && J.JOB_READ_TIMEOUT_MS <= 6000, 'читання: 2 спроби по ~5 с');

  const fetchBak = globalThis.fetch;
  const envBak = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const errBak = console.error;
  const logs = [];
  console.error = s => { try { logs.push(JSON.parse(s)); } catch (e) { logs.push(s); } };
  /* скриптований Supabase REST: кожен елемент це одна відповідь на GET */
  const hang = () => (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const rowOk = { status: 'done', stage: 'done', report: null, error: null, url: 'https://x', vin: null, lang: 'ru', created_at: new Date().toISOString(), updated_at: null, finished_at: null };
  const answer = step => async (url, opts) => {
    if (step === 'timeout') return hang()(url, opts);
    if (step === 'network') throw new TypeError('fetch failed');
    if (typeof step === 'number') return { ok: false, status: step, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [step] };
  };
  const script = steps => { let i = 0; const calls = []; globalThis.fetch = (url, opts = {}) => { calls.push({ url: String(url), method: opts.method || 'GET' }); return answer(steps[Math.min(i++, steps.length - 1)])(url, opts); }; return calls; };
  const fast = { timeoutMs: 30, backoffMs: 1 };
  try {
    /* перша спроба вдала */
    logs.length = 0; let calls = script([rowOk]);
    let r = await J.readJobRow('https://db/x', {}, TOK, fast);
    ok(r.ok && r.attempts === 1 && calls.length === 1 && logs.length === 0, 'сервер: вдале читання з першої спроби');
    /* таймаут -> повтор -> успіх */
    logs.length = 0; calls = script(['timeout', rowOk]);
    r = await J.readJobRow('https://db/x', {}, TOK, fast);
    ok(r.ok && r.attempts === 2 && calls.length === 2, 'сервер: таймаут не повторено');
    ok(logs.length === 1 && logs[0].op === 'check_job_read' && logs[0].attempt === 1 && logs[0].final === false && logs[0].error_type === 'timeout', 'сервер: лог першої невдалої спроби');
    /* 5xx Supabase -> повтор -> успіх; мережа -> повтор -> успіх */
    calls = script([503, rowOk]); r = await J.readJobRow('https://db/x', {}, TOK, fast);
    ok(r.ok && calls.length === 2, 'сервер: 5xx Supabase не повторено');
    calls = script(['network', rowOk]); r = await J.readJobRow('https://db/x', {}, TOK, fast);
    ok(r.ok && calls.length === 2, 'сервер: мережеву помилку не повторено');
    /* 4xx це не тимчасово: без повтору */
    calls = script([401, rowOk]); r = await J.readJobRow('https://db/x', {}, TOK, fast);
    ok(!r.ok && !r.transient && calls.length === 1 && r.error_type === 'http_4xx', 'сервер: 4xx повторено або позначено тимчасовим');
    /* обидві спроби невдалі: структурований лог, токен лише відбитком */
    logs.length = 0; calls = script(['timeout', 'timeout']);
    r = await J.readJobRow('https://db/x', {}, TOK, fast);
    ok(!r.ok && r.transient && r.error_type === 'timeout' && calls.length === 2, 'сервер: дві невдалі спроби');
    const fin = logs.find(l => l && l.final === true);
    ok(fin && fin.op === 'check_job_read' && fin.attempt === 2 && typeof fin.duration_ms === 'number' && fin.error_type === 'timeout' && /^[0-9a-f]{12}$/.test(fin.token_ref), 'сервер: фінальний лог без operation/attempt/duration/error_type/token_ref: ' + JSON.stringify(fin));
    ok(!JSON.stringify(logs).includes(TOK), 'сервер: токен потрапив у лог відкритим текстом');

    /* обробник: обидві спроби невдалі -> 503, не 200 і не pending */
    process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv';
    const call = async () => { const out = { h: {} }; const res = { setHeader(k, v) { out.h[k] = v; }, status(n) { out.s = n; return this; }, json(o) { out.o = o; return this; } }; await J.default({ method: 'GET', query: { token: TOK, lang: 'ru' } }, res); return out; };
    const realSetTimeout = globalThis.setTimeout;
    /* справжні 5 с не чекаємо: таймер читання спрацьовує одразу */
    globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 1000 ? 1 : ms, ...a);
    try {
      script(['timeout', 'timeout']);
      let h = await call();
      ok(h.s === 503 && h.h['retry-after'] && h.o && !h.o.status && h.o.error, 'обробник: після двох таймаутів не 503: ' + JSON.stringify(h));
      script(['network', 'network']);
      h = await call();
      ok(h.s === 503, 'обробник: мережа двічі не 503');
      script([500, rowOk]);
      h = await call();
      ok(h.s === 200 && h.o.status === 'done', 'обробник: 5xx -> повтор -> 200 done');
      script([403]);
      h = await call();
      ok(h.s === 500, 'обробник: постійна помилка Supabase не 500');
    } finally { globalThis.setTimeout = realSetTimeout; }
  } finally {
    globalThis.fetch = fetchBak; console.error = errBak;
    process.env.SUPABASE_URL = envBak.u || ''; process.env.SUPABASE_SERVICE_ROLE_KEY = envBak.k || '';
    if (!envBak.u) delete process.env.SUPABASE_URL; if (!envBak.k) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  /* ---------- 2. сторінка ---------- */
  const page = fs.readFileSync('result-check.html', 'utf8');
  const grab = name => {
    const i = page.search(new RegExp('(async )?function ' + name + '\\('));
    if (i < 0) { errs.push('нема функції ' + name); return ''; }
    let depth = 0;
    for (let k = page.indexOf('{', page.indexOf(')', i)); k < page.length; k++) {
      if (page[k] === '{') depth++;
      else if (page[k] === '}') { depth--; if (depth === 0) return page.slice(i, k + 1); }
    }
    return '';
  };
  const fnSrc = ['jobReadOnce', 'jobReadResilient', 'jobLoadFailed', 'loadByToken', 'openTokenReport'].map(grab).join('\n');

  /* steps: 'done' | 'running' | 'notjson' | 'network' | число (HTTP статус) */
  function mount(steps) {
    const st = { calls: [], pauses: [], booted: false, started: 0, stopped: 0, replaced: null, retryFn: null };
    let i = 0;
    const fetchStub = (url, opts = {}) => {
      st.calls.push({ url: String(url), method: opts.method || 'GET' });
      const s = steps[Math.min(i++, steps.length - 1)];
      if (s === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      if (typeof s === 'number') return Promise.resolve({ ok: s >= 200 && s < 300, status: s, json: async () => { throw new SyntaxError('html'); } });
      if (s === 'notjson') return Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
      const job = s === 'done' ? { status: 'done', slug: 'audi-a4-2014', report: { vehicle: { make: 'Audi' }, _meta: {} } } : { status: 'running', stage: 'history' };
      return Promise.resolve({ ok: true, status: 200, json: async () => job });
    };
    const classes = new Set();
    const body = { innerHTML: '', classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } };
    const els = { loadBox: { className: 'ld', innerHTML: '' }, jobRetry: { addEventListener: (ev, fn) => { st.retryFn = fn; } } };
    const document = { body, title: 'Report', visibilityState: 'visible' };
    const timer = (fn, ms) => { if (ms >= 20000) return 0; st.pauses.push(ms); setImmediate(fn); return 0; };
    const f = new Function('fetch', 'setTimeout', 'clearTimeout', 'document', 'window', 'location', 'history', 'console', 'st', 'els',
      "let ld = null, AWAIT_TITLE = null, DATA = null, READONLY = false, SHARE_SLUG = null;\n"
      + "const OPEN_TOKEN = '" + TOK + "';\n"
      + "const STAGE_IDX = { queued: 0, history: 1, ai: 2, scoring: 3 };\n"
      + "const $ = id => els[id] || null; const t = s => s; const esc = s => String(s);\n"
      + "const isLocalAuthor = () => false;\n"
      + "function loadingStart() { st.started++; ld = { rid: 'r', setStage() {} }; }\n"
      + "function loadingStop() { st.stopped++; }\n"
      + "async function loadingFinish() {}\n"
      + "function boot() { st.booted = true; st.data = DATA; }\n"
      + fnSrc + "\nreturn { openTokenReport, body: () => document.body, cls: c => document.body.classList.contains(c) };");
    const api = f(fetchStub, timer, () => {}, document, { calcarLang: () => 'ru' }, { replace: u => { st.replaced = u; } }, { replaceState() {} }, { warn() {}, log() {} }, st, els);
    return { st, api, els, body, classes };
  }
  const flush = () => new Promise(r => setTimeout(r, 5));

  /* 200 done */
  let m = mount(['done']);
  await m.api.openTokenReport();
  ok(m.st.booted && m.st.calls.length === 1 && m.st.started === 0 && m.st.pauses.length === 0, 'сторінка: 200 done не відкрив звіт одразу');
  ok(/^\/api\/check-job\?token=AbCdEfGhIjKlMnOpQrStUv&lang=ru$/.test(m.st.calls[0].url) && m.st.calls[0].method === 'GET', 'сторінка: читає не той ендпоінт: ' + m.st.calls[0].url);
  /* 200 running -> стадії аналізу, пауза 3 с -> done */
  m = mount(['running', 'done']);
  await m.api.openTokenReport();
  ok(m.st.started === 1 && m.st.pauses.join() === '3000' && m.st.booted, 'сторінка: running не показав стадії аналізу або не дочекався done');
  /* один 504 -> повтор через 1 с -> done, стадій аналізу нема */
  m = mount([504, 'done']);
  await m.api.openTokenReport();
  ok(m.st.booted && m.st.started === 0 && m.st.pauses.join() === '1000' && !m.classes.has('await-job'), 'сторінка: 504 -> повтор -> done: ' + JSON.stringify(m.st.pauses));
  /* кілька тимчасових збоїв (503, 502, мережа, не-JSON) -> відновлення */
  m = mount([503, 502, 'network', 'notjson', 'done']);
  await m.api.openTokenReport();
  ok(m.st.booted && m.st.started === 0 && m.st.pauses.join() === '1000,2000,3000,5000', 'сторінка: 4 збої поспіль -> відновлення: ' + JSON.stringify(m.st.pauses));
  /* мережа -> відновлення */
  m = mount(['network', 'done']);
  await m.api.openTokenReport();
  ok(m.st.booted && m.st.calls.length === 2, 'сторінка: мережева помилка не відновилась');
  /* 5 збоїв поспіль -> людське повідомлення, не стадії аналізу */
  m = mount([504, 503, 'network', 502, 504, 'done']);
  await m.api.openTokenReport();
  ok(!m.st.booted && m.st.calls.length === 5 && m.st.started === 0, 'сторінка: після 5 збоїв не зупинилась: ' + m.st.calls.length);
  ok(m.st.pauses.join() === '1000,2000,3000,5000', 'сторінка: паузи повторів не 1-2-3-5 с: ' + JSON.stringify(m.st.pauses));
  ok(m.classes.has('await-job') && m.els.loadBox.className === 'ld on', 'сторінка: скелетон не прибраний');
  const box = m.els.loadBox.innerHTML;
  ok(box.includes('Could not load the report') && box.includes('This may be a temporary error. Please try again.') && box.includes('Try loading again') && box.includes('role="alert"'), 'сторінка: нема людського повідомлення: ' + box);
  ok(!/Analyzing|not ready/i.test(box), 'сторінка: помилка показана як стадії аналізу');
  /* ручний повтор: той самий GET check-job, новий Check не створюється */
  ok(typeof m.st.retryFn === 'function', 'сторінка: кнопка повтору без обробника');
  m.st.retryFn(); await flush(); await flush();
  ok(m.st.booted && m.st.calls.length === 6 && !m.classes.has('await-job'), 'сторінка: ручний повтор не відкрив звіт');
  ok(m.st.calls.every(c => c.method === 'GET' && c.url.startsWith('/api/check-job?token=' + TOK)), 'сторінка: повтор ходить не в check-job того самого токена');
  ok(!m.st.calls.some(c => /\/api\/check(\?|$)/.test(c.url)), 'сторінка: повтор створює новий Check');
  /* збій посеред очікування: стадії прибираються, показується помилка */
  m = mount(['running', 504, 504, 504, 504, 504]);
  await m.api.openTokenReport();
  ok(m.st.started === 1 && m.st.stopped >= 1 && m.els.loadBox.innerHTML.includes('Could not load the report') && !m.st.booted, 'сторінка: збій під час running не прибрав стадії');
  /* 404: без повторів і без нескінченного циклу */
  m = mount([404, 'done']);
  await m.api.openTokenReport();
  ok(m.st.calls.length === 1 && m.st.pauses.length === 0 && !m.st.booted && m.body.innerHTML.includes('Report not found'), 'сторінка: 404 повторюється');

  /* розмітка, стилі і словники */
  ok(/\.jf-btn\{/.test(page) && /\.job-fail\{/.test(page), 'сторінка: нема стилів повідомлення');
  ok(/if \(OPEN_TOKEN\) \{ await openTokenReport\(\); return; \}/.test(page), 'сторінка: init не через openTokenReport');
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) {
    const d = fs.readFileSync(f, 'utf8');
    for (const k of ['Could not load the report', 'This may be a temporary error. Please try again.', 'Try loading again']) ok(d.includes("'" + k + "':"), f + ': нема ' + k);
  }
  ok(/'Try loading again': 'Попробовать снова'/.test(fs.readFileSync('i18n/ru.js', 'utf8')), 'ru: кнопка не «Попробовать снова»');

  if (errs.length) { console.log('JOB LOAD TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('job load: сервер 2 спроби по 5 с у межах 15 с · 503 зі структурованим логом без токена · сторінка: збій не показується як стадії аналізу · повтори 1-2-3-5 с · 5 збоїв -> повідомлення · ручний повтор той самий job · 404 без повторів');
})().catch(e => { console.log('JOB LOAD TEST CRASHED:', e); process.exit(1); });
