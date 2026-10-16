/* Звʼязок анонімного відвідувача, Check, авто, звіту і подій перегляду:
   check_ref (uuid однієї спроби) + anon_id (calcar_aid) у check_jobs, ті самі
   id у подіях PostHog, роль глядача author/visitor. Без мережі і без БД. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const home = fs.readFileSync('check.html', 'utf8');
const page = fs.readFileSync('result-check.html', 'utf8');
const anal = fs.readFileSync('analytics.js', 'utf8');
const checkSrc = fs.readFileSync('api/check.js', 'utf8');
const jobSrc = fs.readFileSync('api/check-job.js', 'utf8');
const sql = fs.readFileSync('supabase-check-analytics.sql', 'utf8');
let n = 0;
function ok(cond, msg) { n++; assert(cond, msg); }

function browser(store = {}) {
  const document = {
    readyState: 'complete', referrer: '', visibilityState: 'visible',
    createElement: () => ({}), head: { appendChild() {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    documentElement: { getBoundingClientRect: () => ({ top: 0, height: 1000 }) },
    body: { classList: { contains: () => false } },
  };
  const w = {
    CALCAR_PUBLIC: { analytics: { ga4_id: 'G-TEST123456', google_ads_id: 'AW-123456', google_ads_check_label: 'testLabel' } },
    location: { pathname: '/check/r/car/private-token', search: '', hostname: 'calcar.io' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } },
    document, crypto: webcrypto, TextEncoder, URL, URLSearchParams, CustomEvent: function () {}, console,
    setInterval: (f, ms) => { const h = setInterval(f, ms); h.unref(); return h; }, clearInterval, setTimeout,
    addEventListener() {}, removeEventListener() {}, innerHeight: 800,
  };
  w.window = w; w.self = w;
  vm.runInNewContext(anal, w);
  return w;
}
const events = (w, name) => w.CALCAR_EVENTS.filter(e => e.name === name);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ---------- 1. analytics.js: check_ref на спробу, aid на браузер ---------- */
  const store = {};
  const w = browser(store);
  const ref1 = w.calcar.newCheckRef(), ref2 = w.calcar.newCheckRef();
  ok(UUID.test(ref1) && UUID.test(ref2) && ref1 !== ref2, 'check_ref: uuid v4, новий на кожну спробу');
  const aid = w.calcar.aid();
  ok(UUID.test(aid) && browser(store).calcar.aid() === aid, 'aid стабільний між сесіями того самого браузера');
  /* перший Check, другий Check того самого гостя: різні check_ref, той самий aid */
  w.calcar.track('check_started', { product: 'check', marketplace: 'auto.ria.com', check_number: 1, check_ref: ref1 });
  w.calcar.track('check_started', { product: 'check', marketplace: 'auto.ria.com', check_number: 2, check_ref: ref2 });
  const started = events(w, 'check_started');
  ok(started.length === 2 && started[0].props.check_ref === ref1 && started[1].props.check_ref === ref2, 'check_started несе check_ref спроби');
  ok(!started.some(e => Object.keys(e.props).some(k => /token|vin|url/i.test(k))), 'у подіях нема токена, VIN чи адреси');
  /* помилка генерації: check_completed не було, конверсій нема */
  ok(events(w, 'check_completed').length === 0, 'без готового звіту нема check_completed');
  /* check_completed з check_ref; Ads conversion як раніше: один на job, transaction_id не з check_ref */
  ok(w.calcar.checkCompleted('private-token', { product: 'check', check_ref: ref1 }), 'check_completed пройшов');
  ok(!w.calcar.checkCompleted('private-token', { product: 'check', check_ref: ref1 }), 'повторний check_completed того самого job не пройшов');
  await sleep(30);
  const conv = (w.dataLayer || []).filter(x => x[0] === 'event' && x[1] === 'conversion');
  ok(conv.length === 1 && conv[0][2].send_to === 'AW-123456/testLabel' && !conv[0][2].transaction_id.includes(ref1), 'Ads: одна конверсія, transaction_id без check_ref');
  ok(events(w, 'check_completed')[0].props.check_ref === ref1, 'check_completed несе check_ref');

  /* ---------- 2. report_viewed і пороги активності несуть check_ref і роль ---------- */
  w.calcar.reportViewed({ product: 'check', readonly: true, shared_link: true, check_ref: ref1, viewer_role: 'visitor' });
  const rv = events(w, 'report_viewed');
  ok(rv.length === 1 && rv[0].props.check_ref === ref1 && rv[0].props.viewer_role === 'visitor', 'report_viewed несе check_ref і viewer_role');
  w.calcar.reportViewed({ product: 'check', check_ref: ref2, viewer_role: 'author' });
  ok(events(w, 'report_viewed').length === 1, 'повторне відкриття того самого перегляду не дублює report_viewed');
  vm.runInNewContext('Date.now = (function (t) { return function () { return t + 31000; }; })(Date.now());', w);
  await sleep(1150);
  const act = events(w, 'report_active_30s');
  ok(act.length === 1 && act[0].props.check_ref === ref1 && act[0].props.viewer_role === 'visitor', 'report_active_30s несе той самий check_ref і роль');
  /* без check_ref (старий кеш сторінки) подія все одно проходить, поле просто відсутнє */
  const w2 = browser({});
  w2.calcar.reportViewed({ product: 'check', check_ref: undefined, viewer_role: 'author' });
  ok(events(w2, 'report_viewed').length === 1 && !('check_ref' in events(w2, 'report_viewed')[0].props), 'відсутній check_ref не ламає подію');

  /* ---------- 3. сторінка Check: заголовки, тіло запиту, pending, автор ---------- */
  ok(/body: JSON\.stringify\(\{ url, lang: reqLang \}\)/.test(home), 'тіло /api/check лишилось адреса + мова');
  ok(/headers: checkHeaders\(checkRef\),/.test(home), 'заголовки запиту будує checkHeaders');
  ok(/const checkRef = \(window\.calcar && window\.calcar\.newCheckRef\) \? window\.calcar\.newCheckRef\(\) : null;/.test(home), 'check_ref народжується до запиту');
  ok(/track\('check_started', \{ product: 'check', marketplace, check_number: n, check_ref: checkRef \|\| undefined \}\)/.test(home), 'check_started зі check_ref');
  ok(/pendingSet\(\{ token, url, at: Date\.now\(\), lang: reqLang, ref: checkRef \}\);/.test(home), 'pending зберігає ref: перезавантаження під час очікування не губить звʼязок');
  ok(/trackCompleted\(data, token, runStart, checkRef\);/.test(home) && /trackCompleted\(report, pj\.token, pj\.at, pj\.ref \|\| null\);/.test(home), 'check_completed з ref у звичайному і відновленому потоці');
  ok(/finalizeReport\(data, token, checkRef\)/.test(home) && /finalizeReport\(report, pj\.token, pj\.ref \|\| null\)/.test(home) && /created_at: new Date\(\)\.toISOString\(\), ref: ref \|\| null \}\);/.test(home), 'локальний список автора зберігає ref');
  ok(/check_ref: ref \|\| undefined,/.test(home), 'trackCompleted кладе check_ref у властивості');
  const fnSrc = home.match(/function checkHeaders\(ref\)\{[\s\S]*?\n\}/)[0];
  const ctx = { window: { calcar: { aid: () => aid } } };
  vm.runInNewContext(fnSrc + '; this.out = { a: checkHeaders(ref1), b: checkHeaders(null) };', Object.assign(ctx, { ref1 }));
  ok(ctx.out.a['x-calcar-check-ref'] === ref1 && ctx.out.a['x-calcar-aid'] === aid && ctx.out.a['content-type'] === 'application/json', 'checkHeaders: ref і aid заголовками');
  ok(!('x-calcar-check-ref' in ctx.out.b) && ctx.out.b['x-calcar-aid'] === aid, 'без ref заголовок ref не шлеться');
  const ctx2 = { window: {} };
  vm.runInNewContext(fnSrc + '; this.out = checkHeaders("x");', ctx2);
  ok(Object.keys(ctx2.out).join() === 'content-type,x-calcar-check-ref', 'без analytics.js лише content-type і ref');

  /* ---------- 4. сервер: заголовки -> рядок job, не в розбір ---------- */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_identity_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const good = C.jobIdentity({ headers: { 'x-calcar-check-ref': ref1.toUpperCase(), 'x-calcar-aid': aid } });
  ok(good.analytics_ref === ref1 && good.anon_id === aid, 'валідні заголовки -> analytics_ref і anon_id');
  const bad = C.jobIdentity({ headers: { 'x-calcar-check-ref': 'WBA3B3C50FF546249', 'x-calcar-aid': 'me@example.com' } });
  ok(UUID.test(bad.analytics_ref) && bad.anon_id === null, 'не-uuid ігнорується: ref генерує сервер, anon_id порожній');
  const none = C.jobIdentity({ headers: {} });
  ok(UUID.test(none.analytics_ref) && none.anon_id === null && none.analytics_ref !== bad.analytics_ref, 'без заголовків job усе одно має власний analytics_ref');
  ok(/jobCreate\(\{ token, status: 'queued', stage: 'queued', url: jobUrl\.split\('#'\)\[0\], lang: jobLang, user_id: null, \.\.\.jobIdentity\(req\) \}\)/.test(checkSrc), 'рядок job створюється з ідентичністю');
  ok(!/x-calcar-aid|x-calcar-check-ref|analytics_ref|anon_id/.test(checkSrc.slice(checkSrc.indexOf('async function runCheck'))), 'ядро розбору (runCheck) ідентичність не читає');
  ok(/select=status,stage,report,error,url,vin,lang,created_at,updated_at,finished_at,analytics_ref&limit=1/.test(jobSrc) && /ref: row\.analytics_ref \|\| null,/.test(jobSrc), '/api/check-job віддає ref (не токен) для подій перегляду');
  ok(!/anon_id/.test(jobSrc), '/api/check-job не віддає anon_id автора');

  /* ---------- 5. сторінка звіту: автор чи відвідувач ---------- */
  ok(/ANALYTICS_REF = j\.ref \|\| null;/.test(page), 'сторінка бере ref з відповіді job');
  ok(/const viewerRole = \(!READONLY \|\| isLocalAuthor\(roleToken\)\) \? 'author' : 'visitor';/.test(page), 'роль: автор (цей браузер або свій збережений звіт), інакше visitor');
  ok(/check_ref: ANALYTICS_REF \|\| localRef\(roleToken\) \|\| undefined, viewer_role: viewerRole,/.test(page), 'report_viewed несе check_ref і viewer_role');
  ok(/checkCompleted\(OPEN_TOKEN, \{ product: 'check', check_ref: ANALYTICS_REF \|\| undefined,/.test(page), 'check_completed на сторінці звіту (автор дочекався там) з check_ref');
  const roleSrc = "function isLocalAuthor(token){ return !!token && localRecent().some(x => x && x.token === token); }\n" + page.match(/function localRef\(token\)\{.*\}\n/)[0]
    + 'this.role = (READONLY, token) => (!READONLY || isLocalAuthor(token)) ? "author" : "visitor"; this.ref = localRef;';
  const rc = { localRecent: () => [{ token: 'mine-token', ref: ref1 }] };
  vm.runInNewContext(roleSrc, rc);
  ok(rc.role(true, 'someone-elses-token') === 'visitor' && rc.ref('someone-elses-token') === null, 'чужий звіт за публічним посиланням: visitor, без локального ref');
  ok(rc.role(true, 'mine-token') === 'author' && rc.ref('mine-token') === ref1, 'свій звіт у цьому браузері: author, ref з локального списку');
  ok(rc.role(false, null) === 'author', 'власник збереженого звіту (не readonly): author');

  /* ---------- 6. міграція: лише додавання ---------- */
  ok(/add column if not exists analytics_ref uuid/.test(sql) && /add column if not exists anon_id text/.test(sql), 'колонки analytics_ref uuid і anon_id text');
  ok(!/\b(drop|delete|update|truncate|alter column|rename)\b/i.test(sql), 'міграція без руйнівних операцій і без перезапису старих даних');
  ok(/create index if not exists/.test(sql) && !/create unique index/.test(sql), 'індекси неунікальні: повторний заголовок не ламає створення job');

  /* ---------- 7. приватність: санітайзер не пропускає токен/VIN навіть з check_ref поруч ---------- */
  w.calcar.track('report_viewed', { product: 'check', check_ref: ref2, share_token: 'private-token', vin: 'WBA3B3C50FF546249' });
  const last = w.CALCAR_EVENTS[w.CALCAR_EVENTS.length - 1];
  ok(last.props.check_ref === ref2 && !('share_token' in last.props) && !('vin' in last.props), 'токен і VIN відкинуті, check_ref пройшов');

  console.log('check identity: ' + n + ' checks · check_ref на спробу, aid на браузер · заголовки, тіло url+lang · job row · check-job ref · author/visitor · міграція адитивна · Ads без змін');
})().catch(e => { console.error(e); process.exitCode = 1; });
