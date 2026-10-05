/* Check: лист "звіт готовий" за явним opt-in.
   Сервер (api/check-email.js) проганяється проти памʼятної заглушки
   PostgREST, Supabase Auth, Resend і PostHog: перевіряються opt-in, один
   лист на Check, гонка з уже готовим job, посилання для гостя і для того,
   хто увійшов, збій провайдера. Клієнтський блок check.html виконується у
   vm з мінімальним DOM: памʼять адреси гостя, відсутність авто-opt-in,
   приватність подій. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const errs = [];
const ok = (cond, msg) => { if (!cond) errs.push(msg); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_email_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

const VIN = 'WDC1668741A123456';
const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'owner@example.com' };
const JWT = 'jwt-good';
const report = () => ({ vehicle: { title: 'Mercedes-Benz GL 63 AMG', year: 2014 }, verdict: { score: 70 }, chat_private: 'x', _meta: { vin: VIN, lang: 'ru', share_token: null } });

/* ---- памʼятна заглушка зовнішніх сервісів ---- */
function makeWorld() {
  const w = { jobs: [], reports: [], mails: [], idem: new Set(), events: [], resendFail: 0, resendDown: false, log: [] };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const match = (row, params) => {
    for (const [k, v] of params) {
      if (['select', 'limit', 'order'].includes(k)) continue;
      if (k === 'or') {
        const parts = v.slice(1, -1).split(/,(?=[a-z_]+\.)/);
        const hit = parts.some(p => {
          const m = p.match(/^([a-z_]+)\.(is\.null|lt\."(.+)")$/);
          if (!m) throw new Error('or: ' + p);
          return m[2] === 'is.null' ? row[m[1]] == null : (row[m[1]] != null && row[m[1]] < m[3]);
        });
        if (!hit) return false;
        continue;
      }
      const val = k === 'data->_meta->>share_token' ? (row.data && row.data._meta && row.data._meta.share_token) : row[k];
      if (v === 'is.null') { if (val != null) return false; }
      else if (v === 'not.is.null') { if (val == null) return false; }
      else if (v.startsWith('eq.')) { if (String(val) !== v.slice(3)) return false; }
      else throw new Error('filter: ' + k + '=' + v);
    }
    return true;
  };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    w.log.push(method + ' ' + u.pathname);
    if (u.hostname === 'api.resend.com') {
      if (w.resendDown) return json(503, { message: 'down' });
      if (w.resendFail > 0) { w.resendFail--; return json(500, { message: 'fail' }); }
      const key = init.headers['idempotency-key'];
      if (!w.idem.has(key)) { w.idem.add(key); w.mails.push({ ...body, key, auth: init.headers.authorization }); }
      return json(200, { id: 'mail_1' });
    }
    if (u.hostname.endsWith('posthog.com')) { w.events.push(body); return json(200, {}); }
    if (url === 'https://calcar.io/calcar-public.js') return { ok: true, status: 200, text: async () => "window.CALCAR_PUBLIC = { analytics: { posthog_key: 'phc_test', posthog_host: 'https://eu.i.posthog.com' } };" };
    if (u.pathname === '/auth/v1/user') {
      return init.headers.authorization === 'Bearer ' + JWT ? json(200, USER) : json(401, {});
    }
    const table = u.pathname.replace('/rest/v1/', '');
    const rows = table === 'check_jobs' ? w.jobs : table === 'reports' ? w.reports : null;
    if (!rows) return json(404, {});
    const params = [...u.searchParams];
    if (method === 'GET') return json(200, rows.filter(r => match(r, params)));
    if (method === 'PATCH') {
      const hit = rows.filter(r => match(r, params));
      hit.forEach(r => Object.assign(r, body));
      return json(200, hit.map(r => ({ ...r })));
    }
    if (method === 'POST') {
      const row = { id: 'r' + (rows.length + 1), created_at: new Date().toISOString(), ...body };
      rows.push(row);
      return json(201, [row]);
    }
    return json(405, {});
  };
  w.job = (token, patch = {}) => {
    const row = { token, status: 'running', stage: 'ai', url: 'https://x.test/1', vin: null, lang: 'ru', user_id: null, report: null, created_at: new Date().toISOString(),
      email_requested_at: null, email_recipient: null, email_claimed_at: null, email_sent_at: null, email_error: null, email_aid: null, ...patch };
    w.jobs.push(row);
    return row;
  };
  w.finish = row => { const r = report(); r._meta.share_token = row.token; Object.assign(row, { status: 'done', stage: 'done', report: r }); };
  return w;
}
const fakeRes = () => ({ _s: 200, _o: null, _h: {}, setHeader(k, v) { this._h[k] = v; }, status(n) { this._s = n; return this; }, json(o) { this._o = o; return this; } });
const TOK = n => ('tok' + n + 'AAAAAAAAAAAAAAAAAAAAAA').slice(0, 22);

(async () => {
  process.env.SUPABASE_URL = 'https://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.RESEND_API_KEY = 're_test';
  const E = await import('file://' + path.join(dir, 'api', 'check-email.js'));
  const S = await import('file://' + path.join(dir, 'api', 'share.js'));
  const realFetch = globalThis.fetch, realErr = console.error, realLog = console.log;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  console.log = (...a) => logged.push(a.join(' '));
  const use = w => { globalThis.fetch = w.fetch; };
  const optIn = async (body, jwt) => { const res = fakeRes(); await E.default({ method: 'POST', body, headers: jwt ? { authorization: 'Bearer ' + jwt } : {} }, res); return res; };

  /* 1. без opt-in листа немає, хоч скільки разів завершується job */
  let w = makeWorld(); use(w);
  let j = w.job(TOK(1), { user_id: null }); w.finish(j);
  let d = await E.deliverReportEmail(j.token);
  ok(!d.sent && w.mails.length === 0, '1: лист пішов без opt-in');
  ok(!(await E.presaveOptedInReport(j.token, j.report)) && w.reports.length === 0, '1: звіт збережено в кабінет без opt-in');

  /* 2. хто увійшов: opt-in -> рівно один лист після READY, адреса з акаунта */
  w = makeWorld(); use(w);
  j = w.job(TOK(2));
  let r = await optIn({ token: j.token, email: 'other@evil.test', lang: 'ru' }, JWT);
  ok(r._s === 200 && r._o.ok && r._o.sent === false, '2: opt-in того, хто увійшов, не прийнято');
  ok(r._o.masked === 'o***@example.com', '2: маска адреси: ' + r._o.masked);
  ok(j.email_recipient === USER.email && j.user_id === USER.id, '2: адреса мала бути з акаунта, не з тіла запиту');
  ok(w.mails.length === 0, '2: лист пішов до завершення job');
  w.finish(j);
  ok(await E.presaveOptedInReport(j.token, j.report), '2: звіт не збережено в кабінет до done');
  d = await E.deliverReportEmail(j.token);
  ok(d.sent && w.mails.length === 1, '2: після READY мав піти один лист');
  ok(w.mails[0].to[0] === USER.email && w.mails[0].from === 'CalCar <reports@calcar.io>', '2: отримувач або відправник');
  ok(w.mails[0].subject === 'CalCar: анализ Mercedes-Benz GL 63 AMG готов', '2: тема: ' + w.mails[0].subject);
  ok(j.email_sent_at, '2: email_sent_at не записано');

  /* 14. посилання того, хто увійшов: саме його збережений звіт у кабінеті */
  ok(w.reports.length === 1 && w.reports[0].user_id === USER.id && w.reports[0].data._meta.share_token === j.token, '14: звіт у кабінеті один і цього користувача');
  ok(w.reports[0].data.chat_private === undefined, '14: у кабінет пішло поле поза allowlist');
  ok(w.mails[0].html.includes('https://calcar.io/check/' + w.reports[0].public_id + '?src=email'), '14: лист не веде на /check/<public_id>');
  ok(/^[A-HJ-NP-Z2-9]{6}$/.test(w.reports[0].public_id), '14: формат public_id');

  /* 10, 11. повторне завершення і повторний opt-in (reload, подвійний клік) */
  await E.deliverReportEmail(j.token); await E.deliverReportEmail(j.token);
  r = await optIn({ token: j.token }, JWT);
  ok(r._s === 200 && r._o.sent === true, '11: повторний opt-in після відправки мав бути спокійним');
  ok(w.mails.length === 1 && w.reports.length === 1, '10/11: повтор дав другий лист або дубль звіту');
  ok(w.events.filter(e => e.event === 'report_email_sent').length === 1, '10: report_email_sent не раз');

  /* одночасні завершення: рядок захоплює лише один виклик */
  w = makeWorld(); use(w);
  j = w.job(TOK(3)); await optIn({ token: j.token, email: 'g@example.com' }); w.finish(j);
  const both = await Promise.all([E.deliverReportEmail(j.token), E.deliverReportEmail(j.token), E.deliverReportEmail(j.token)]);
  ok(both.filter(x => x.sent).length === 1 && w.mails.length === 1, '10: паралельні завершення дали не один лист');

  /* 3, 4, 13. гість: без email Check живе, з email opt-in лежить на сервері, посилання публічне */
  w = makeWorld(); use(w);
  j = w.job(TOK(4));
  r = await optIn({ token: j.token, email: 'not-an-email' });
  ok(r._s === 400 && !j.email_requested_at, '4: кривий email прийнято');
  r = await optIn({ token: j.token });
  ok(r._s === 400 && !j.email_requested_at, '3: порожній email створив opt-in');
  r = await optIn({ token: j.token, email: ' guest@example.com ', aid: '0f8fad5b-d9cb-469f-a165-70867728950e', lang: 'ua' });
  ok(r._s === 200 && j.email_requested_at && j.email_recipient === 'guest@example.com' && j.user_id === null, '4: opt-in гостя не збережено');
  ok(r._o.masked === 'g***@example.com' && !JSON.stringify(r._o).includes('guest@'), '4: відповідь віддає повну адресу');
  /* 9. сторінка закрита: далі працює лише сервер */
  w.finish(j);
  d = await E.deliverReportEmail(j.token);
  ok(d.sent && w.mails.length === 1 && w.mails[0].to[0] === 'guest@example.com', '9: лист гостю не пішов без сторінки');
  const guestLink = 'https://calcar.io' + S.sharePath(j.report, j.token) + '?src=email';
  ok(w.mails[0].html.includes(guestLink) && w.mails[0].text.includes(guestLink), '13: лист гостя не веде на публічний токен');
  ok(w.reports.length === 0, '13: для гостя створено запис у кабінеті');
  ok(!w.mails[0].html.includes(VIN) && !guestLink.includes(VIN) && !/@/.test(guestLink), '8: у листі або посиланні є VIN чи email');
  ok(w.mails[0].subject === 'CalCar: анализ Mercedes-Benz GL 63 AMG готов', '9: мова листа це мова самого Check');
  ok(!/pdf|attachment/i.test(JSON.stringify(Object.keys(w.mails[0]))), '9: у листі вкладення');
  /* публічний звіт за токеном читається без акаунта і без полів листа */
  const J = await import('file://' + path.join(dir, 'api', 'check-job.js'));
  const jr = fakeRes(); await J.default({ method: 'GET', query: { token: j.token }, headers: {} }, jr);
  ok(jr._s === 200 && jr._o.status === 'done' && jr._o.report && jr._o.report.vehicle, '13: звіт гостя не відкривається за токеном');
  ok(!JSON.stringify(jr._o).includes('guest@example.com'), '13: адреса потрапила в публічну відповідь job');
  /* подія з сервера: без адреси, VIN і токена */
  const ev = w.events[0];
  ok(ev && ev.event === 'report_email_sent' && ev.distinct_id === '0f8fad5b-d9cb-469f-a165-70867728950e', '15: report_email_sent гостя');
  ok(ev && ev.properties.authenticated === false && ev.properties.locale === 'ru', '15: властивості події');
  ok(!/guest@|example\.com/.test(JSON.stringify(w.events)) && !JSON.stringify(w.events).includes(VIN) && !JSON.stringify(w.events).includes(j.token), '15: email, VIN або токен у PostHog');

  /* 12. гонка: job уже READY на момент opt-in -> лист одразу з ендпоінта */
  w = makeWorld(); use(w);
  j = w.job(TOK(5)); w.finish(j);
  ok(!(await E.deliverReportEmail(j.token)).sent, '12: лист до opt-in');
  r = await optIn({ token: j.token, email: 'late@example.com' });
  ok(r._s === 200 && r._o.sent === true && w.mails.length === 1, '12: готовий job лишився без листа після opt-in');
  /* те саме для того, хто увійшов: звіт зберігає сам відправник */
  w = makeWorld(); use(w);
  j = w.job(TOK(6)); w.finish(j);
  r = await optIn({ token: j.token }, JWT);
  ok(r._o.sent === true && w.reports.length === 1 && w.mails[0].html.includes('/check/' + w.reports[0].public_id + '?'), '12: гонка для того, хто увійшов');
  /* сторінка встигла зберегти звіт сама: сервер бере її рядок, дубля немає */
  w = makeWorld(); use(w);
  j = w.job(TOK(7)); w.finish(j);
  w.reports.push({ id: 'own', user_id: USER.id, kind: 'check', public_id: 'ABC234', created_at: '2026-01-01', data: { vehicle: {}, _meta: { share_token: j.token } } });
  await optIn({ token: j.token }, JWT);
  ok(w.reports.length === 1 && w.mails[0].html.includes('https://calcar.io/check/ABC234?src=email'), '14: дубль звіту або чуже посилання');

  /* 16. провайдер упав: Check готовий і доступний, позначки "надіслано" немає */
  w = makeWorld(); use(w); w.resendDown = true;
  j = w.job(TOK(8)); await optIn({ token: j.token, email: 'g@example.com' }); w.finish(j);
  d = await E.deliverReportEmail(j.token);
  ok(!d.sent && j.status === 'done' && j.report && !j.email_sent_at && j.email_claimed_at === null && /provider_503/.test(j.email_error), '16: збій провайдера зачепив job: ' + JSON.stringify(d));
  ok(logged.some(l => /"op":"report_email_send"/.test(l) && /"http_status":503/.test(l)), '16: збій провайдера не залоговано');
  ok(!logged.some(l => /example\.com/.test(l)), '15: адреса потрапила в лог');
  /* провайдер повернувся: повторний opt-in надсилає, і лише раз */
  w.resendDown = false;
  r = await optIn({ token: j.token, email: 'g@example.com' });
  ok(r._o.sent === true && w.mails.length === 1, '16: після відновлення провайдера лист не пішов');
  /* тимчасовий 5xx лікується повтором у межах однієї відправки */
  w = makeWorld(); use(w); w.resendFail = 1;
  j = w.job(TOK(9)); await optIn({ token: j.token, email: 'g@example.com' }); w.finish(j);
  ok((await E.deliverReportEmail(j.token)).sent && w.mails.length === 1, '16: один 5xx мав вилікуватись повтором');
  /* без ключа провайдера: тихо, з логом, Check цілий */
  w = makeWorld(); use(w); delete process.env.RESEND_API_KEY;
  j = w.job(TOK(10)); await optIn({ token: j.token, email: 'g@example.com' }); w.finish(j);
  d = await E.deliverReportEmail(j.token);
  ok(!d.sent && d.reason === 'provider_not_configured' && w.mails.length === 0, '16: без ключа');
  process.env.RESEND_API_KEY = 're_test';

  /* межі opt-in: чужий токен, job з помилкою, старий job, кривий JWT */
  w = makeWorld(); use(w);
  ok((await optIn({ token: TOK(11), email: 'g@example.com' }))._s === 404, 'невідомий токен мав дати 404');
  ok((await optIn({ token: 'short', email: 'g@example.com' }))._s === 404, 'кривий токен мав дати 404');
  j = w.job(TOK(12), { status: 'error' });
  ok((await optIn({ token: j.token, email: 'g@example.com' }))._s === 409, 'job з помилкою прийняв opt-in');
  j = w.job(TOK(13), { status: 'done', created_at: new Date(Date.now() - E.OPT_IN_WINDOW_MS - 1000).toISOString() });
  ok((await optIn({ token: j.token, email: 'g@example.com' }))._s === 409 && !j.email_requested_at, 'старий job прийняв opt-in');
  j = w.job(TOK(14));
  ok((await optIn({ token: j.token, email: 'g@example.com' }, 'jwt-bad'))._s === 401 && !j.email_requested_at, 'кривий JWT прийнято');
  const getRes = fakeRes(); await E.default({ method: 'GET', headers: {} }, getRes);
  ok(getRes._s === 405, 'GET мав дати 405');
  /* адресу можна виправити, поки лист не надіслано */
  await optIn({ token: j.token, email: 'typo@example.com' }); await optIn({ token: j.token, email: 'right@example.com' });
  w.finish(j); await E.deliverReportEmail(j.token);
  ok(w.mails.length === 1 && w.mails[0].to[0] === 'right@example.com', 'виправлена адреса не застосувалась');

  /* лист: три мови, без довгого тире, кнопка і короткий текст */
  for (const [lang, subj, cta] of [['en', 'CalCar: the BMW X5 analysis is ready', 'Open report'], ['ua', 'CalCar: аналіз BMW X5 готовий', 'Відкрити звіт'], ['ru', 'CalCar: анализ BMW X5 готов', 'Открыть отчёт']]) {
    const m = E.buildReportEmail({ lang, title: 'BMW X5', link: 'https://calcar.io/check/r/bmw-x5/t?src=email' });
    ok(m.subject === subj, 'тема ' + lang + ': ' + m.subject);
    ok(m.html.includes('>' + cta + '</a>') && m.text.includes(cta + ': https://calcar.io/'), 'кнопка ' + lang);
    ok(m.html.length < 2500, 'лист ' + lang + ' не короткий');
  }
  ok(E.buildReportEmail({ lang: 'xx', title: '<b>"x"</b>', link: 'https://calcar.io/a' }).html.includes('&lt;b&gt;'), 'назва авто не екранована');
  ok(E.maskEmail('a.sok@gmail.com') === 'a***@gmail.com' && E.maskEmail('x') === '', 'maskEmail');
  ok(E.normalizeEmail('a@b.co') === 'a@b.co' && !E.normalizeEmail('a@b') && !E.normalizeEmail('a b@c.de') && !E.normalizeEmail('a@b.co, x@y.zz'), 'normalizeEmail');

  globalThis.fetch = realFetch; console.error = realErr; console.log = realLog;

  /* ---- сервер: сторожі в коді ---- */
  const chk = fs.readFileSync('api/check.js', 'utf8');
  const iPre = chk.indexOf("await reportEmailHook('presaveOptedInReport', token, shim._o);"), iDone = chk.indexOf("const ok = await jobWrite(token, { status: 'done'"), iSend = chk.indexOf("if (ok) await reportEmailHook('deliverReportEmail', token);"), iMi = chk.indexOf('await runMiShadow({ token');
  ok(iPre > 0 && iPre < iDone && iDone < iSend && iSend < iMi, 'check.js: порядок presave -> done -> лист -> тінь MI порушено');
  ok(!/^import [^\n]*check-email/m.test(chk) && /const m = await import\('\.\/check-email\.js'\);/.test(chk), 'check.js: модуль листа має підвантажуватись динамічно, не статичним імпортом');
  /* збій модуля листа не ламає Check: хук ловить помилку */
  {
    const hookSrc = chk.slice(chk.indexOf('async function reportEmailHook('), chk.indexOf('async function jobCreate('));
    const hook = new Function('console', hookSrc.replace("await import('./check-email.js')", "(() => { throw new Error('boom'); })()") + '; return reportEmailHook;')({ error() {} });
    ok((await hook('deliverReportEmail', 'x')) === null, 'check.js: збій модуля листа не перехоплено');
  }
  const jobSrc = fs.readFileSync('api/check-job.js', 'utf8');
  ok(!/email_/.test(jobSrc), 'check-job.js вибирає колонки листа в публічну відповідь');
  const sql = fs.readFileSync('supabase-check-email.sql', 'utf8');
  for (const c of ['email_requested_at', 'email_recipient', 'email_claimed_at', 'email_sent_at', 'email_error', 'email_aid']) ok(new RegExp('add column if not exists ' + c + ' ').test(sql), 'міграція без колонки ' + c);
  ok(!/drop |delete |update |policy/i.test(sql.replace(/^--.*$/gm, '')), 'міграція не лише аддитивна');
  /* регресія c52d160: Vercel збирає api/ у CommonJS (package.json з
     "type":"module" немає), import.meta там синтаксична помилка, і падає
     завантаження модуля разом з усіма, хто його імпортує (api/check.js) */
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
    ok(!/import\.meta/.test(fs.readFileSync('api/' + f, 'utf8')), 'api/' + f + ': import.meta ламає CommonJS-збірку Vercel');
  }
  for (const f of ['api/check-email.js', 'supabase-check-email.sql', 'checkemailtest.js']) ok(!fs.readFileSync(f, 'utf8').includes(String.fromCharCode(8212)), f + ': довге тире');

  /* ---- клієнт: блок листа з check.html у vm ---- */
  const ch = fs.readFileSync('check.html', 'utf8');
  const a = ch.indexOf("const GUEST_EMAIL_KEY = 'calcar_guest_email';"), b = ch.indexOf('/* звіт цього job уже в кабінеті?');
  ok(a > 0 && b > a, 'check.html: блок листа не знайдено');
  ok(/<div class="ld" id="loadBox"><\/div>\s*<div class="em" id="emailBox" data-private-block><\/div>/.test(ch), 'check.html: блок листа не під індикатором аналізу');
  const block = ch.slice(a, b);
  function page({ session, stored, hint, sessionP }) {
    const els = {}, store = { ...(stored || {}) }, calls = [], tracked = [];
    const el = id => els[id] || (els[id] = { id, innerHTML: '', className: '', textContent: '', disabled: false, onsubmit: null });
    const doc = { getElementById: id => {
      const box = el('emailBox');
      if (id !== 'emailBox' && !new RegExp('id="' + id + '"').test(box.innerHTML)) return null;
      const e = el(id);
      if (id === 'emIn' && e._html !== box.innerHTML) { e._html = box.innerHTML; e.value = ((box.innerHTML.match(/id="emIn"[^>]* value="([^"]*)"/) || [])[1] || ''); }
      return e;
    } };
    const ctx = vm.createContext({
      document: doc, console,
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      SB: { auth: { getSession: () => (sessionP || Promise.resolve(session)).then(x => ({ data: { session: x } })) } },
      window: { calcar: { aid: () => '0f8fad5b-d9cb-469f-a165-70867728950e', track: (n, p) => tracked.push({ n, p }) }, calcarLang: () => 'ru', CALCAR_SIGNED_IN: hint },
      t: s => s, esc: s => String(s),
      safeJson: async r => r.json(),
      fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, masked: 'm***@example.com', sent: false }) }; },
    });
    vm.runInContext("const PENDING_KEY = 'calcar_pending_check';\n"
      + "function pendingGet(){ try { const j = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); return j && j.token ? j : null; } catch (e) { return null; } }\n"
      + "function pendingSet(j){ if (j) localStorage.setItem(PENDING_KEY, JSON.stringify(j)); else localStorage.removeItem(PENDING_KEY); }\n"
      + block + '\nthis.emailBoxShow = emailBoxShow;', ctx);
    return { ctx, els, store, calls, tracked, el, doc, submit: async () => { await doc.getElementById('emForm').onsubmit({ preventDefault() {} }); } };
  }
  const T1 = TOK(21), T2 = TOK(22);
  const pend = tk => ({ calcar_pending_check: JSON.stringify({ token: tk, url: 'https://x.test/1', at: Date.now() }) });

  /* 3. гість без email: блок є, запиту немає, Check не чіпається */
  let p = page({ session: null, stored: pend(T1) });
  await p.ctx.emailBoxShow(T1);
  ok(p.els.emailBox.className === 'em on' && /id="emIn"/.test(p.els.emailBox.innerHTML), '3: гість не бачить поля email');
  ok(p.calls.length === 0, '3: запит пішов без натискання');
  ok(/>Get the report by email</.test(p.els.emailBox.innerHTML) && />Email me<\/button>/.test(p.els.emailBox.innerHTML) && p.els.emailBox.innerHTML.includes('Leave your email: you can wait here or come back via the link in the email.'), '3: текст блоку гостя не той');
  await p.submit();
  ok(p.calls.length === 0 && p.els.emErr.className === 'em-err on', '3: порожній email пішов на сервер');
  /* 4, 5. гість ввів email: opt-in на сервер, адреса в localStorage */
  p.doc.getElementById('emIn').value = 'guest@example.com';
  await p.submit();
  ok(p.calls.length === 1 && p.calls[0].url === '/api/check-email' && p.calls[0].body.email === 'guest@example.com' && p.calls[0].body.token === T1, '4: opt-in гостя не пішов на сервер');
  ok(!p.calls[0].init.headers.authorization, '4: гість надіслав Authorization');
  ok(p.store.calcar_guest_email === 'guest@example.com', '5: email гостя не запамʼятався');
  /* підтвердження без адреси: "Звіт прийде на пошту ✓", галочка в кінці */
  ok(/em-ok/.test(p.els.emailBox.innerHTML) && !p.els.emailBox.innerHTML.includes('m***@example.com') && !p.els.emailBox.innerHTML.includes('guest@'), '4: немає спокійного підтвердження або в ньому адреса');
  ok(/<div class="em-ok">The report will arrive by email <span class="em-ok-ic" aria-hidden="true">✓<\/span><\/div>/.test(p.els.emailBox.innerHTML), '4: галочка не в кінці речення');
  ok(p.els.emailBox.innerHTML.includes('You can keep waiting here or close the page.') && !p.els.emailBox.innerHTML.includes('You can close this page.'), '4: підтвердження каже лише "сторінку можна закрити"');
  /* 15. подія без адреси */
  ok(p.tracked.length === 1 && p.tracked[0].n === 'report_email_opted_in' && !/guest|example|@/.test(JSON.stringify(p.tracked)), '15: подія opt-in з адресою або відсутня');
  /* 11. reload під час того самого Check: підтвердження, без нового запиту */
  let p2 = page({ session: null, stored: p.store });
  await p2.ctx.emailBoxShow(T1);
  ok(/em-ok/.test(p2.els.emailBox.innerHTML) && p2.calls.length === 0, '11: reload не показав підтвердження або надіслав запит');
  /* 6, 7. наступний Check: поле заповнене, але opt-in сам не вмикається */
  p2 = page({ session: null, stored: { ...pend(T2), calcar_guest_email: p.store.calcar_guest_email } });
  await p2.ctx.emailBoxShow(T2);
  ok(p2.doc.getElementById('emIn').value === 'guest@example.com', '6: поле не заповнене збереженою адресою');
  ok(p2.calls.length === 0 && !/em-ok/.test(p2.els.emailBox.innerHTML), '7: збережена адреса сама ввімкнула відправку');
  /* 8. змінена адреса оновлює localStorage */
  p2.doc.getElementById('emIn').value = 'new@example.com';
  await p2.submit();
  ok(p2.calls.length === 1 && p2.calls[0].body.email === 'new@example.com' && p2.store.calcar_guest_email === 'new@example.com', '8: нова адреса не оновила localStorage');
  /* подвійне натискання: один запит */
  let p3 = page({ session: null, stored: { ...pend(T1), calcar_guest_email: 'g@example.com' } });
  await p3.ctx.emailBoxShow(T1);
  const h = p3.doc.getElementById('emForm').onsubmit;
  await Promise.all([h({ preventDefault() {} }), h({ preventDefault() {} })]);
  ok(p3.calls.length === 1, '6: подвійне натискання дало ' + p3.calls.length + ' запити');
  /* 2. хто увійшов: поля немає, маска адреси акаунта, адреса в запит не йде */
  p3 = page({ session: { access_token: 'AT', user: { email: 'owner@example.com' } }, stored: { ...pend(T1), calcar_guest_email: 'g@example.com' } });
  await p3.ctx.emailBoxShow(T1);
  /* хто увійшов: без поля і без маски адреси акаунта, кнопка "Надіслати на пошту" */
  ok(!/id="emIn"/.test(p3.els.emailBox.innerHTML) && !p3.els.emailBox.innerHTML.includes('o***@example.com') && !p3.els.emailBox.innerHTML.includes('owner@') && !/em-addr/.test(p3.els.emailBox.innerHTML), '2: тому, хто увійшов, показано поле або адресу');
  ok(/>Get the report by email</.test(p3.els.emailBox.innerHTML) && />Send to my email<\/button>/.test(p3.els.emailBox.innerHTML) && p3.els.emailBox.innerHTML.includes('You can wait here or close the page: we will send a link when the analysis is ready.'), '2: текст блоку для того, хто увійшов, не той');
  ok(p3.calls.length === 0, '1: запит без натискання для того, хто увійшов');
  await p3.submit();
  ok(p3.calls.length === 1 && p3.calls[0].init.headers.authorization === 'Bearer AT' && p3.calls[0].body.email === undefined, '2: запит того, хто увійшов');
  ok(p3.store.calcar_guest_email === 'g@example.com', '2: адреса акаунта переписала адресу гостя');
  ok(JSON.parse(p3.store.calcar_pending_check).mailedAuth === true, '2: сторінка не знає, що звіт збереже сервер');

  /* getSession у живому браузері буває повільним (блокування авторизації між
     вкладками, оновлення токена): блок не чекає на нього і є одразу */
  {
    let relS = null;
    const slow = () => new Promise(r => { relS = r; });
    /* увійшов (стан шапки): вид акаунта одразу, хоча сесія ще не дочитана */
    let q = page({ stored: {}, hint: true, sessionP: slow() });
    const shown = q.ctx.emailBoxShow(T1);
    ok(q.els.emailBox.className === 'em on' && />Send to my email</.test(q.els.emailBox.innerHTML) && !/id="emIn"/.test(q.els.emailBox.innerHTML), 'блок того, хто увійшов, чекає на getSession');
    /* натискання до сесії: запит іде лише після неї і з її токеном */
    const subQ = q.submit();
    await new Promise(r => setImmediate(r));
    ok(q.calls.length === 0, 'opt-in пішов до того, як дочитана сесія');
    const sess = { access_token: 'AT2', user: { email: 'owner@example.com' } };
    q.ctx.SB.auth.getSession = async () => ({ data: { session: sess } });
    relS(sess); await shown; await subQ;
    ok(q.calls.length === 1 && q.calls[0].init.headers.authorization === 'Bearer AT2' && q.calls[0].body.email === undefined, 'opt-in після сесії не того, хто увійшов');
    /* гість (стан шапки): поле одразу, без очікування */
    q = page({ stored: { calcar_guest_email: 'g@example.com' }, hint: false, sessionP: slow() });
    q.ctx.emailBoxShow(T1);
    ok(q.els.emailBox.className === 'em on' && /id="emIn"/.test(q.els.emailBox.innerHTML) && q.doc.getElementById('emIn').value === 'g@example.com', 'блок гостя чекає на getSession або без збереженої адреси');
    relS(null);
    /* стан шапки розійшовся з сесією: той самий блок у правильному виді */
    q = page({ stored: {}, hint: false, sessionP: slow() });
    const sh2 = q.ctx.emailBoxShow(T1);
    ok(/id="emIn"/.test(q.els.emailBox.innerHTML), 'без сесії не вид гостя');
    relS({ access_token: 'AT3', user: { email: 'o@example.com' } }); await sh2;
    ok(q.els.emailBox.className === 'em on' && !/id="emIn"/.test(q.els.emailBox.innerHTML) && />Send to my email</.test(q.els.emailBox.innerHTML), 'після дочитаної сесії вид не виправлено');
    /* сесія без адреси: блоку немає, як і раніше */
    q = page({ stored: {}, hint: true, sessionP: slow() });
    const sh3 = q.ctx.emailBoxShow(T1);
    relS({ access_token: 'AT4', user: {} }); await sh3;
    ok(q.els.emailBox.className === 'em' && q.els.emailBox.innerHTML === '', 'сесія без адреси лишила блок');
    ok(/render\(hint\);\n  const session = await sessionP;/.test(ch), 'check.html: блок знову малюється після getSession');
  }

  /* приватність у джерелі: адреса не йде в URL, консоль чи аналітику */
  ok(!/console\.\w+\([^)]*(email|emIn|acct)/i.test(block), '15: адреса в console');
  ok(!/track\([^)]*(email:|acct|masked)/.test(block) && !/[?&]email=/.test(block), '15: адреса в події або URL');
  ok(/findSavedByToken\(token, serverSaves \? 4 : 1\)/.test(ch), 'check.html: сторінка не шукає готовий рядок перед збереженням');
  /* блок зʼявляється одразу з індикатором, не після відповіді сервера з токеном */
  ok(/const rid = loadingStart\(\);\n[^\n]*\n  let tokenReady = \(\) => \{\};\n  emailBoxShow\(new Promise\(res => \{ tokenReady = res; \}\)\);\n\n  try \{\n    const r = await fetch\('\/api\/check'/.test(ch) && /tokenReady\(token\);\n\s+data = await pollJob\(token\);/.test(ch) && /emailBoxShow\(pj\.token\);/.test(ch), 'check.html: блок листа зʼявляється із запізненням');
  /* токен ще не прийшов: блок уже є, запит чекає на токен і йде з ним */
  let rel = null;
  let pw = page({ session: null, stored: {} });
  await pw.ctx.emailBoxShow(new Promise(r => { rel = r; }));
  ok(pw.els.emailBox.className === 'em on' && /id="emIn"/.test(pw.els.emailBox.innerHTML), 'блок листа не показано до токена');
  pw.doc.getElementById('emIn').value = 'guest@example.com';
  const sub = pw.submit();
  await new Promise(r => setImmediate(r));
  ok(pw.calls.length === 0, 'opt-in пішов на сервер без токена');
  pw.store.calcar_pending_check = JSON.stringify({ token: T1, url: 'https://x.test/1', at: Date.now() });
  rel(T1); await sub;
  ok(pw.calls.length === 1 && pw.calls[0].body.token === T1 && /em-ok/.test(pw.els.emailBox.innerHTML) && JSON.parse(pw.store.calcar_pending_check).mailed, 'opt-in після появи токена не пішов з цим токеном');
  /* Check упав до токена: opt-in на сервер не йде, показано помилку */
  pw = page({ session: null, stored: {} });
  await pw.ctx.emailBoxShow(new Promise(r => { rel = r; }));
  pw.doc.getElementById('emIn').value = 'guest@example.com';
  const sub2 = pw.submit(); rel(null); await sub2;
  ok(pw.calls.length === 0 && pw.els.emErr.className === 'em-err on', 'без токена opt-in пішов на сервер');

  /* аналітика: події в таксономії, санітайзер ріже адресу під будь-яким ключем */
  const an = fs.readFileSync('analytics.js', 'utf8');
  ok(/'report_email_opted_in', 'report_opened_from_email'\]/.test(an), 'analytics.js: подій листа немає в таксономії');
  ok(/var DENY = \/[^\n]*email[^\n]*vin/.test(an), 'analytics.js: санітайзер більше не ріже email і vin');
  const rc = fs.readFileSync('result-check.html', 'utf8');
  ok(/const FROM_EMAIL = new URLSearchParams\(location\.search\)\.get\('src'\) === 'email';/.test(rc) && /if \(FROM_EMAIL && window\.calcar\) window\.calcar\.track\('report_opened_from_email', \{ product: 'check' \}\);/.test(rc), 'result-check.html: report_opened_from_email');

  /* нові рядки інтерфейсу перекладені */
  const dict = code => { const win = { CALCAR_DICTS: {} }; vm.runInNewContext(fs.readFileSync('i18n/' + code + '.js', 'utf8'), { window: win }); return win.CALCAR_DICTS[code]; };
  const keys = [...block.matchAll(/t\('([^']+)'\)/g)].map(m => m[1]);
  ok(keys.length >= 9, 'ключів інтерфейсу менше, ніж очікувалось: ' + keys.length);
  for (const code of ['ua', 'ru']) { const dd = dict(code); for (const k of keys) ok(dd[k], 'i18n/' + code + '.js без ключа: ' + k); }

  if (errs.length) { console.log('checkemailtest: FAIL\n- ' + errs.join('\n- ')); process.exit(1); }
  console.log('checkemailtest: OK');
})().catch(e => { console.error('checkemailtest: crashed', e); process.exit(1); });
