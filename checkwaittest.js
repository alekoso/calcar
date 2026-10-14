/* Waiting telemetry of Check (check-wait.js, api/check-wait.js,
   supabase-check-wait.sql): the attempt, its private secret and the job are
   bound without ever touching GA4/Ads; every packet is validated and
   deduplicated by (check, visit, seq); a stranger on a share link cannot
   count as the initiator's view; nothing about the car leaves the page.

   Run: node checkwaittest.js */
const fs = require('fs');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);

(async () => {
  const api = await import('/Users/admin/Desktop/calcar/api/check-wait.js');
  const client = fs.readFileSync('check-wait.js', 'utf8');
  const sql = fs.readFileSync('supabase-check-wait.sql', 'utf8');
  const home = fs.readFileSync('check.html', 'utf8');
  const page = fs.readFileSync('result-check.html', 'utf8');
  const share = fs.readFileSync('api/share.js', 'utf8');
  const check = fs.readFileSync('api/check.js', 'utf8');
  const ID = '1b4e28ba-2fa1-4d3b-9e8a-1f2a3b4c5d6e', V = '2c4e28ba-2fa1-4d3b-9e8a-1f2a3b4c5d6e', SECRET = 'a'.repeat(64);

  /* ---- validation ---- */
  ok('1. identity needs a v4 uuid id, a v4 visit and a 64-hex secret; the secret is hashed, never stored', api.identity({ id: ID, initial_visit: V, secret: SECRET }).secret_hash.length === 64 && !JSON.stringify(api.identity({ id: ID, initial_visit: V, secret: SECRET })).includes(SECRET) && api.identity({ id: ID, initial_visit: V, secret: 'short' }) === null && api.identity({ id: 'x', initial_visit: V, secret: SECRET }) === null);
  ok('2. event body: known kinds and stages only, integer seq within range, ms clamped to 31 days', api.eventBody({ id: ID, visit: V, seq: 3, kind: 'heartbeat', elapsed_ms: 12000.9, visible_ms: 9000, stage: 'ai' }).elapsed_ms === 12000 && api.eventBody({ id: ID, visit: V, seq: 3, kind: 'nope', elapsed_ms: 1, visible_ms: 1 }) === null && api.eventBody({ id: ID, visit: V, seq: -1, kind: 'leave', elapsed_ms: 1, visible_ms: 1 }) === null && api.eventBody({ id: ID, visit: V, seq: 1, kind: 'leave', elapsed_ms: 1, visible_ms: 1, stage: 'weird' }).stage === 'unknown' && api.eventBody({ id: ID, visit: V, seq: 1, kind: 'leave', elapsed_ms: 32 * 86400000, visible_ms: 1 }) === null);
  ok('2a. the attempt is addressed by id or, for a view only, by the job token; accepted needs the token; a bad token is dropped', api.eventBody({ visit: V, seq: 0, kind: 'viewed', token: 'ueNiqqJ-c8drD7Fg9sY-5w', elapsed_ms: 1, visible_ms: 1 }).job_token === 'ueNiqqJ-c8drD7Fg9sY-5w' && api.eventBody({ visit: V, seq: 0, kind: 'heartbeat', token: 'ueNiqqJ-c8drD7Fg9sY-5w', elapsed_ms: 1, visible_ms: 1 }) === null && api.eventBody({ id: ID, visit: V, seq: 1, kind: 'accepted', elapsed_ms: 1, visible_ms: 1 }) === null && api.eventBody({ id: ID, visit: V, seq: 1, kind: 'accepted', token: 'bad token!', elapsed_ms: 1, visible_ms: 1 }) === null && api.eventBody({ id: ID, visit: V, seq: 1, kind: 'accepted', token: 'ueNiqqJ-c8drD7Fg9sY-5w', elapsed_ms: 1, visible_ms: 1 }).check_id === ID);

  /* ---- handler with a mocked Supabase ---- */
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); if (/\/auth\/v1\/user$/.test(url)) return { ok: opts.headers.authorization === 'Bearer goodjwt', json: async () => ({ id: '55555555-5555-4555-8555-555555555555' }) }; return { ok: true, json: async () => true }; };
  const res = () => { const r = { code: 0, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
  const run = async (req) => { const r = res(); await api.default(req, r); return r; };
  const packet = { id: ID, visit: V, seq: 0, kind: 'started', elapsed_ms: 0, visible_ms: 0, stage: 'request', secret: SECRET, initial_visit: V };
  process.env.CHECK_WAIT_ANALYTICS_ENABLED = ''; process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk';
  ok('3. disabled by env: 503, nothing written', (await run({ method: 'POST', headers: { origin: 'https://calcar.io' }, body: packet })).code === 503 && calls.length === 0);
  process.env.CHECK_WAIT_ANALYTICS_ENABLED = '1';
  ok('4. only POST', (await run({ method: 'GET', headers: {}, body: packet })).code === 405);
  ok('5. foreign origin rejected, own origins and no origin accepted', (await run({ method: 'POST', headers: { origin: 'https://evil.example' }, body: packet })).code === 403 && (await run({ method: 'POST', headers: { origin: 'https://www.calcar.io' }, body: packet })).code === 200 && (await run({ method: 'POST', headers: {}, body: packet })).code === 200);
  ok('6. bad or oversized body: 400 / 413', (await run({ method: 'POST', headers: {}, body: '{bad' })).code === 400 && (await run({ method: 'POST', headers: {}, body: { ...packet, pad: 'x'.repeat(3000) } })).code === 413 && (await run({ method: 'POST', headers: {}, body: { ...packet, kind: 'nope' } })).code === 400);
  ok('7. a packet without secret and without a signed-in user is refused before any database call', (() => { const n = calls.length; return run({ method: 'POST', headers: {}, body: { ...packet, secret: null, initial_visit: null } }).then(r => r.code === 400 && calls.length === n); })() instanceof Promise);
  await (async () => { const n = calls.length; const r = await run({ method: 'POST', headers: {}, body: { ...packet, secret: null, initial_visit: null } }); ok('7a. (resolved) refused: 400 and no database call', r.code === 400 && calls.length === n); })();
  calls.length = 0;
  const r1 = await run({ method: 'POST', headers: { authorization: 'Bearer goodjwt' }, body: { ...packet, kind: 'viewed', seq: 4, secret: null, initial_visit: null } });
  const rpc = calls.find(c => /rpc\/record_check_wait$/.test(c.url));
  const rpcBody = JSON.parse(rpc.opts.body);
  ok('8. signed-in viewer: the user id comes from the auth server, the RPC gets the hashed secret (null here) and the user id, never the raw secret or the bearer', r1.code === 200 && rpcBody.p_user_id === '55555555-5555-4555-8555-555555555555' && rpcBody.p_secret_hash === null && !JSON.stringify(rpcBody).includes('goodjwt') && rpc.opts.headers.authorization === 'Bearer srk', JSON.stringify(rpcBody));
  calls.length = 0;
  const r1b = await run({ method: 'POST', headers: { authorization: 'Bearer goodjwt' }, body: { visit: V, seq: 0, kind: 'viewed', token: 'ueNiqqJ-c8drD7Fg9sY-5w', elapsed_ms: 1, visible_ms: 1, stage: 'done' } });
  const rpcB = JSON.parse(calls.find(c => /rpc\/record_check_wait$/.test(c.url)).opts.body);
  ok('8a. a view from another device carries only the job token: the RPC gets p_job_token and a null check_id, the event itself holds no token', r1b.code === 200 && rpcB.p_job_token === 'ueNiqqJ-c8drD7Fg9sY-5w' && rpcB.p_event.check_id === null && !('job_token' in rpcB.p_event), JSON.stringify(rpcB));
  calls.length = 0;
  const r2 = await run({ method: 'POST', headers: { authorization: 'Bearer badjwt' }, body: packet });
  const rpc2 = JSON.parse(calls.find(c => /rpc\/record_check_wait$/.test(c.url)).opts.body);
  ok('9. a bad bearer is not an identity: user null, the secret hash still carries the write', r2.code === 200 && rpc2.p_user_id === null && rpc2.p_secret_hash && rpc2.p_secret_hash.length === 64 && rpc2.p_secret_hash !== SECRET);
  ok('10. the event sent to the database carries no page data: only ids, seq, kind, times and stage', JSON.stringify(Object.keys(rpc2.p_event).sort()) === JSON.stringify(['check_id', 'elapsed_ms', 'kind', 'seq', 'stage', 'visible_ms', 'visit_id']));
  calls.length = 0;
  const r3 = await run({ method: 'POST', headers: {}, body: { ...packet, kind: 'accepted', seq: 2, token: 'ueNiqqJ-c8drD7Fg9sY-5w' } });
  const rpc3 = JSON.parse(calls.find(c => /rpc\/record_check_wait$/.test(c.url)).opts.body);
  ok('11. accepted: the job binds through the secret path of the same endpoint (p_job_token with the hashed secret); the generation request is not involved', r3.code === 200 && rpc3.p_job_token === 'ueNiqqJ-c8drD7Fg9sY-5w' && rpc3.p_secret_hash.length === 64 && rpc3.p_event.kind === 'accepted' && !('bindJob' in api));
  global.fetch = realFetch;

  /* ---- client ---- */
  ok('12. the client never touches GA4, Ads, dataLayer or window.calcar and sends no url, vin, token or report', !/gtag|dataLayer|window\.calcar\b|conversion/.test(client) && !/vin|report|url\b/i.test(client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/fetch\('\/api\/check-wait'/, '')));
  ok('13. the client sends only to /api/check-wait with keepalive and a 2 s timeout, retries once by the same seq', /fetch\('\/api\/check-wait'/.test(client) && /keepalive: true/.test(client) && /setTimeout\(function \(\) \{ ctl\.abort\(\); \}, 2000\)/.test(client) && /seq: a\.seq\+\+/.test(client) && /if \(!ok && !final\) setTimeout/.test(client));
  ok('13a. the job token binds through an accepted packet and the view is addressed by the job token', /function accepted\(token\) \{ if \(active && token\) \{ active\.ctx\.token = token; persist\(active\.ctx\); emit\('accepted', false\); \} \}/.test(client) && /function viewed\(token\)/.test(client) && /token: a\.ctx\.token \|\| null/.test(client));
  ok('14. heartbeat every 12 s only while waiting; stopped on handoff, failure and view', /setInterval\(function \(\) \{ if \(active && active\.waiting\) emit\('heartbeat', false\); \}, 12000\)/.test(client) && /function handoff\(\) \{[\s\S]*?stop\(\);/.test(client) && /function failed\(\)[\s\S]*?stop\(\);/.test(client) && /function viewed\(token\)[\s\S]*?active\.waiting = false; active\.stage = 'done'; stop\(\);/.test(client));
  ok('15. the view counts once per check and only while the page is visible; the handoff ticket ties it to the original visit for 120 s', /if \(!token \|\| displayed\[token\]\) return;/.test(client) && /document\.visibilityState === 'hidden' \|\| displayed\[id\]/.test(client) && /expires: Date\.now\(\) \+ 120000/.test(client));
  ok('16. leaving the page during the wait is a final keepalive packet; the handoff to the report page is not a leave', /addEventListener\('pagehide'[\s\S]*?if \(!active \|\| active\.handoff \|\| !active\.waiting\) return;\n\s+emit\('leave', true\)/.test(client));
  ok('17. every public entry point is wrapped fail-open and local storage is pruned after 31 days', /window\.CalCarWait\[k\] = function \(\) \{ try \{ return api\[k\]\.apply\(null, arguments\); \} catch \(_\) \{ return null; \} \};/.test(client) && /31 \* 86400000/.test(client));

  /* ---- wiring ---- */
  ok('18. check.html: attempt begins at run start, after the field loses focus; the generation request body stays url + lang; the job is accepted by token, pending unchanged, handoff before navigation, failure recorded, resume by token', /try \{ input\.blur\(\); \} catch \(e\) \{\}\n  const runStart = Date\.now\(\);/.test(home) && /if \(window\.CalCarWait\) window\.CalCarWait\.begin\(\);/.test(home) && /body: JSON\.stringify\(\{ url, lang: reqLang \}\)/.test(home) && !/wait_analytics/.test(home) && /pendingSet\(\{ token, url, at: Date\.now\(\), lang: reqLang \}\);/.test(home) && /CalCarWait\.accepted\(token\)/.test(home) && (home.match(/CalCarWait\.handoff\(\);\n\s+location\.href = dest;/g) || []).length === 2 && (home.match(/CalCarWait\.failed\(\)/g) || []).length === 2 && /CalCarWait\.resumeToken\(pj\.token\)/.test(home));
  ok('19. result-check.html: resume by token, stage from the server, failure on job error, view after the report is rendered and after the videos hook, by job token (share_token in the cabinet)', /CalCarWait\.resumeToken\(OPEN_TOKEN\)/.test(page) && /CalCarWait\.stage\(j\.stage\)/.test(page) && (page.match(/CalCarWait\.failed\(\)/g) || []).length === 2 && /try \{ videosInit\(DATA\); \} catch \(e\) \{\}\n[\s\S]{0,160}?if \(window\.CalCarWait\) window\.CalCarWait\.viewed\(OPEN_TOKEN \|\| \(DATA\._meta && DATA\._meta\.share_token\) \|\| null\);/.test(page));
  ok('20. api/check.js and api/share.js are untouched: the generation request reads no telemetry field and the report carries no attempt id', !/wait_analytics|analytics_check_id|check-wait/.test(check) && !/analytics_check_id/.test(share));
  ok('21. the report payload and the public allowlist carry nothing of the telemetry', !/secret|wait_analytics|analytics_check_id/.test(share));
  ok('22. GA4 / Ads untouched: analytics.js and calcar-public.js are not in this change', !fs.readFileSync('analytics.js', 'utf8').includes('check-wait') && !fs.readFileSync('calcar-public.js', 'utf8').includes('wait'));

  /* ---- schema ---- */
  ok('23. SQL: both tables under RLS with anon and authenticated revoked; functions executable by service_role only; events keyed by (check, visit, seq)', /alter table public\.check_wait_attempts enable row level security/.test(sql) && /alter table public\.check_wait_events enable row level security/.test(sql) && /revoke all on public\.check_wait_attempts, public\.check_wait_events from anon, authenticated/.test(sql) && /revoke all on function public\.record_check_wait\(jsonb,text,uuid,uuid,text\) from public,anon,authenticated/.test(sql) && /primary key\(check_id,visit_id,seq\)/.test(sql));
  ok('24. SQL: a view counts only for a done, bound job; a stranger (no secret, other account) is refused; the account binds only with the private secret; the job binds once, through the secret, to an existing job', /if k='viewed' and \(a\.job_token is null or not exists\(select 1 from check_jobs where token=a\.job_token and status='done'\)\) then return false; end if;/.test(sql) && /coalesce\(a\.secret_hash=p_secret_hash,false\) or coalesce\(p_user_id is not null and a\.user_id=p_user_id,false\)/.test(sql) && /if a\.user_id is null and p_user_id is not null and a\.secret_hash=p_secret_hash then/.test(sql) && /if k='accepted' then\n\s+if p_job_token is null or a\.secret_hash is distinct from p_secret_hash then return false; end if;/.test(sql) && /if exists\(select 1 from check_wait_attempts where job_token=p_job_token\) then return false; end if;/.test(sql) && !/bind_check_wait/.test(sql));
  ok('25. SQL: the job link survives a job row deletion; a 31-day window; no view is never proof of a closed tab (lost_contact_unknown)', /references public\.check_jobs\(token\) on delete set null/.test(sql) && /interval '31 days'/.test(sql) && /lost_contact_unknown/.test(sql) && /still_observing/.test(sql));
  ok('26. SQL: retention function for old telemetry exists and is service_role only', /function public\.check_wait_prune\(/.test(sql) && /grant execute on function public\.check_wait_prune\(interval\) to service_role/.test(sql));

  for (const f of ['check-wait.js', 'api/check-wait.js', 'supabase-check-wait.sql', 'docs/analytics/check-wait-report.sql', 'checkwaittest.js']) ok('no em dash in ' + f, !fs.readFileSync(f, 'utf8').includes(DASH));
  if (errs.length) { console.log('CHECK WAIT TEST FAILED (' + errs.length + '/' + checks + '):'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('check wait telemetry: ' + checks + ' checks · validation · handler auth/origin/limits · secret hashed · no page data · client fail-open, dedup by seq, heartbeat 12 s · wiring · GA4/Ads untouched · schema RLS, done-only view, stranger refused, retention');
})().catch(e => { console.log('CHECK WAIT TEST CRASHED:', e.stack || e.message); process.exit(1); });
