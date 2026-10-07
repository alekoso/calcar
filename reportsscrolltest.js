/* Браузерна регресія прокрутки списку звітів у кабінеті (headless Chrome через CDP).

   Регресія після 25bb07c: людина повернулась зі звіту кнопкою Back (позиція
   відновилась), потім відкрила інший звіт У НОВІЙ ВКЛАДЦІ і прокрутила список
   угору; за мить список стрибав назад на стару позицію. Причина: supabase-js
   шле SIGNED_IN в усі вкладки, коли нова вкладка створює клієнт (і коли
   вкладка знову видима), cabinet.html на кожну таку подію перезапускає
   showList(), а reportsScrollRestore() знову застосовував стару позицію зі
   стану запису історії.

   Стенд: локальний сервер віддає cabinet.html, supabase-js підмінено
   заглушкою, яка, як справжня 2.x, розсилає SIGNED_IN іншим вкладкам через
   BroadcastChannel при створенні клієнта; список із 60 звітів приходить
   через 400 мс. Сторінка звіту теж створює клієнт. Мережі назовні немає.
   Без Chrome тест пропускається (CHROME_PATH задає інший шлях). */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.log('reportsscrolltest: Chrome не знайдено, браузерний тест пропущено (CHROME_PATH)'); process.exit(0); }

const ROOT = __dirname;
const STUB = `(function () {
  const subs = [];
  const session = { user: { id: 'u1', email: 'qa@example.test' }, access_token: 'x' };
  const ch = new BroadcastChannel('sb-stub-auth');
  window.__sbEvents = [];
  const fire = ev => { window.__sbEvents.push(ev); subs.forEach(f => f(ev, session)); };
  ch.onmessage = e => fire(e.data.event);
  window.__sbFire = fire;
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: 'r' + i, public_id: 'P' + (1000 + i), kind: 'check', title: 'BMW X5 ' + i, vtitle: 'BMW X5 xDrive40i ' + i, created_at: new Date(Date.now() - i * 864e5).toISOString() }));
  function q() {
    const chain = new Proxy(function () {}, { get(t, k) {
      if (k === 'then') { const p = new Promise(r => setTimeout(() => r({ data: rows, error: null }), 400)); return p.then.bind(p); }
      return () => chain; } });
    return chain;
  }
  window.supabase = { createClient() {
    setTimeout(() => ch.postMessage({ event: 'SIGNED_IN' }), 300);
    return {
      auth: { getSession: async () => ({ data: { session } }),
        onAuthStateChange(f) { subs.push(f); setTimeout(() => f('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        signOut: async () => {} },
      from: () => q(), rpc: () => q(), channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    };
  } };
})();`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((q, s) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/__sbstub.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(STUB); }
  if (p === '/cabinet') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return s.end(fs.readFileSync(path.join(ROOT, 'cabinet.html'), 'utf8').replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/__sbstub.js')); }
  if (p.startsWith('/check/')) { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return s.end('<!doctype html><title>report</title><script src="/__sbstub.js"></script><script>supabase.createClient()</script><h1>report</h1><div style="height:3000px"></div>'); }
  /* config.js не віддається: заглушці ключі не потрібні */
  if (p === '/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end('window.CALCAR_SUPABASE={url:"http://stub",anon:"stub"};'); }
  if (p.startsWith('/api/')) { s.writeHead(404, { 'content-type': 'application/json' }); return s.end('{}'); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_scroll_'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=1280,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  /* сторож: тест ніколи не висить */
  const watchdog = setTimeout(() => { console.log('reportsscrolltest: FAIL (таймаут стенду)'); done(1); }, 120000);
  const done = code => { clearTimeout(watchdog); try { chrome.kill(); } catch (e) {} server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(code); };
  let ws, id = 0; const pend = new Map();
  for (let i = 0; i < 75 && !ws; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2000) })).json(); const p = l.find(x => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch (e) {} if (!ws) await sleep(200); }
  if (!ws) { console.log('reportsscrolltest: Chrome не стартував'); return done(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const pages = async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()).filter(x => x.type === 'page').length;
  const errs = [];
  const check = (name, cond, info) => { if (!cond) errs.push(name + ' ' + JSON.stringify(info)); };
  const Y = () => ev('Math.round(scrollY)');
  const near = (a, b) => Math.abs(a - b) <= 30;
  const cardPoint = () => ev(`(() => { const el = document.elementFromPoint(400, 450); const c = el && el.closest('.rcard'); const r = c.querySelector('.rt').getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2), href: c.querySelector('a.rt').getAttribute('href') }; })()`);
  const click = async (pt, button = 'left', modifiers = 0) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button, clickCount: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button, clickCount: 1, modifiers });
  };
  try {
    await send('Page.enable');
    /* D. свіжий візит починається звичайно */
    await send('Page.navigate', { url: base + '/cabinet' }); await sleep(2500);
    await ev(`localStorage.setItem('calcar_tour','done'); 1`);
    const cards = await ev(`document.querySelectorAll('#reports .rcard').length`);
    check('D: свіжий візит не з початку списку', (await Y()) === 0 && cards === 60, { y: await Y(), cards });

    /* A. той самий таб: ~1500 -> звіт -> Back -> ~1500 */
    await ev('scrollTo(0, 1500); 1'); await sleep(300);
    let pt = await cardPoint();
    await click(pt); await sleep(1500);
    const onReport = await ev('location.pathname');
    await ev('history.back(); 1'); await sleep(2500);
    check('A: Back не повернув на ~1500', near(await Y(), 1500) && /^\/check\//.test(onReport), { y: await Y(), onReport });

    /* B. новий таб: Cmd+клік, середня кнопка, правий клік + "відкрити в новій вкладці";
       одразу вручну вгору на ~500 і чекаємо довше за будь-який рендер */
    for (const how of ['meta-click', 'middle-click', 'context-menu']) {
      await ev('scrollTo(0, 1500); 1'); await sleep(300);
      const stateBefore = await ev('JSON.stringify(history.state)');
      const n0 = await pages(), e0 = await ev('window.__sbEvents.length');
      pt = await cardPoint();
      if (how === 'meta-click') await click(pt, 'left', process.platform === 'darwin' ? 4 : 2);
      else if (how === 'middle-click') await click(pt, 'middle');
      else { await click(pt, 'right'); await send('Target.createTarget', { url: base + pt.href, background: true }); }
      await sleep(150);
      await ev('scrollTo(0, 500); 1');
      await sleep(3500);
      const y = await Y(), n1 = await pages(), e1 = await ev('window.__sbEvents.length');
      check('B ' + how + ': вкладка не лишилась на ~500 або новий таб не відкрився', near(y, 500) && n1 === n0 + 1 && (await ev('location.pathname')) === '/cabinet', { y, newTabs: n1 - n0 });
      check('B ' + how + ': стенд не відтворив подію входу з іншої вкладки', e1 > e0, { authEvents: e1 - e0 });
      check('B ' + how + ': новий таб записав чи відновив намір прокрутки', stateBefore === (await ev('JSON.stringify(history.state)')), { stateBefore });
    }

    /* C. після спожитого відновлення повторний рендер не повертає стару позицію */
    await ev('scrollTo(0, 300); 1'); await sleep(200);
    await ev(`window.__sbFire('SIGNED_IN'); window.__sbFire('TOKEN_REFRESHED'); 1`); await sleep(2000);
    check('C: повторний рендер повернув стару позицію', near(await Y(), 300), { y: await Y() });
    await ev('scrollTo(0, 200); location.reload(); 1'); await sleep(2500);
    check('C: reload після спожитого відновлення стрибнув на стару позицію', !near(await Y(), 1500), { y: await Y() });

    /* A2. нове збереження відновлюється рівно один раз */
    await ev('scrollTo(0, 1200); 1'); await sleep(300);
    pt = await cardPoint(); await click(pt); await sleep(1500);
    await ev('history.back(); 1'); await sleep(2500);
    const yBack = await Y();
    await ev('scrollTo(0, 100); 1'); await sleep(200);
    await ev(`window.__sbFire('SIGNED_IN'); 1`); await sleep(2000);
    check('A2: Back не відновив ~1200 або наступний рендер зсунув людину', near(yBack, 1200) && near(await Y(), 100), { yBack, y: await Y() });
  } catch (e) {
    errs.push('збій стенду: ' + (e && e.message));
  }
  if (errs.length) { console.log('reportsscrolltest: FAIL\n- ' + errs.join('\n- ')); return done(1); }
  console.log('reportsscrolltest: OK (Back відновлює один раз; новий таб і повторний рендер не рухають список; свіжий візит з початку)');
  done(0);
})().catch(e => { console.error('reportsscrolltest: crashed', e); process.exit(1); });
