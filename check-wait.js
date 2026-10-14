/* Waiting telemetry goes only to CalCar. No GA4/Ads events or report data. */
(function () {
  'use strict';
  var STORE = 'calcar_wait_v1', TICKET = 'calcar_wait_handoff_v1';
  var active = null, auth = null, interval = null, displayed = Object.create(null);
  function read(store, key, fallback) { try { return JSON.parse(store.getItem(key)) || fallback; } catch (_) { return fallback; } }
  function write(store, key, value) { try { store.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function uuid() { return crypto.randomUUID(); }
  function saved() { return read(localStorage, STORE, {}); }
  function persist(ctx) {
    var all = saved(), now = Date.now(); all[ctx.id] = ctx;
    Object.keys(all).forEach(function (id) { if (now - all[id].at > 31 * 86400000) delete all[id]; });
    write(localStorage, STORE, all);
  }
  function accountHeaders() {
    try { return Promise.resolve(auth && auth()).then(function (s) { return s && s.access_token ? { authorization: 'Bearer ' + s.access_token } : {}; }).catch(function () { return {}; }); }
    catch (_) { return Promise.resolve({}); }
  }
  // Each packet has a stable sequence. Retrying cannot create duplicate rows.
  function send(packet, final) {
    var headers = { 'content-type': 'application/json' };
    var run = function (h) {
      var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 2000);
      return fetch('/api/check-wait', { method: 'POST', headers: Object.assign({}, headers, h),
        body: JSON.stringify(packet), keepalive: true, signal: ctl.signal }).then(function (r) {
          return r.ok ? r.json().then(function (j) { return j.ok === true; }) : false;
        }).catch(function () { return false; }).finally(function () { clearTimeout(tm); });
    };
    // A private write credential permits immediate final delivery, no async auth dependency.
    var task = final && packet.secret ? run({}) : accountHeaders().then(run);
    task.then(function (ok) { if (!ok && !final) setTimeout(function () { accountHeaders().then(run); }, 2000); }).catch(function () {});
  }
  function tickTime(a) {
    var now = Date.now(), delta = Math.max(0, now - a.clock);
    if (a.visible) a.visibleMs += delta;
    a.clock = now;
  }
  function emit(kind, final) {
    var a = active; if (!a) return;
    tickTime(a);
    send({ id: a.ctx.id, token: a.ctx.token || null, secret: a.ctx.secret, initial_visit: a.ctx.initial_visit,
      visit: a.visit, seq: a.seq++, kind: kind, elapsed_ms: Math.max(0, Date.now() - a.ctx.at),
      visible_ms: a.visibleMs, stage: a.stage }, final);
  }
  function stop() { if (interval !== null) clearInterval(interval); interval = null; }
  function activate(ctx, visit, seq, visibleMs) {
    stop(); active = { ctx: ctx, visit: visit || uuid(), seq: seq || 0,
      clock: Date.now(), visible: document.visibilityState !== 'hidden', visibleMs: visibleMs || 0,
      stage: 'request', waiting: true, handoff: false };
    interval = setInterval(function () { if (active && active.waiting) emit('heartbeat', false); }, 12000);
  }
  function begin() {
    if (active && active.waiting) emit('leave', true);
    var ctx = { id: uuid(), secret: uuid().replace(/-/g,'') + uuid().replace(/-/g,''), initial_visit: uuid(), at: Date.now() };
    persist(ctx); activate(ctx, ctx.initial_visit); emit('started', false); emit('waiting', false);
    return { id: ctx.id, secret: ctx.secret, initial_visit: ctx.initial_visit };
  }
  function resume(id) {
    var ctx = saved()[id]; if (!ctx) return;
    if (active && active.ctx.id === id && active.waiting) return;
    activate(ctx); emit('resume', false);
  }
  // The job token binds the attempt server-side through its own packet; the generation request stays untouched.
  function accepted(token) { if (active && token) { active.ctx.token = token; persist(active.ctx); emit('accepted', false); } }
  function byToken(token) { var all = saved(); var hit = null; Object.keys(all).some(function (id) { if (all[id].token === token) { hit = all[id]; return true; } return false; }); return hit; }
  function resumeToken(token) { var ctx = byToken(token); if (!ctx) return; var ticket = read(sessionStorage, TICKET, {}); if (ticket.id === ctx.id && ticket.expires > Date.now()) return; resume(ctx.id); }
  function stage(value) { if (active) active.stage = value || 'unknown'; }
  function handoff() {
    if (!active) return;
    active.stage = 'done'; active.handoff = true; active.waiting = false;
    emit('handoff', false); stop();
    write(sessionStorage, TICKET, { id: active.ctx.id, visit: active.visit, seq: active.seq,
      visibleMs: active.visibleMs, expires: Date.now() + 120000 });
  }
  function failed() { if (active) { active.stage = 'error'; emit('client_error', false); active.waiting = false; stop(); } }
  function viewed(token) {
    if (!token || displayed[token]) return;
    var local = byToken(token), ticket = read(sessionStorage, TICKET, {});
    // With no local proof only a server-verified account can qualify this view; the server finds the attempt by the job token.
    var ctx = local || { id: null, token: token, at: Date.now(), secret: null, initial_visit: null };
    var id = token;
    var same = !!local && ticket.id === local.id && ticket.expires > Date.now();
    if (!active || active.ctx.token !== token) activate(ctx, same ? ticket.visit : null, same ? ticket.seq : 0, same ? ticket.visibleMs : 0);
    active.waiting = false; active.stage = 'done'; stop();
    function visible() {
      if (document.visibilityState === 'hidden' || displayed[id]) return;
      if (!active || active.ctx.token !== token) return;
      displayed[id] = true; emit('viewed', false);
      document.removeEventListener('visibilitychange', visible);
      write(sessionStorage, TICKET, {});
    }
    visible(); if (!displayed[id]) document.addEventListener('visibilitychange', visible);
  }
  document.addEventListener('visibilitychange', function () {
    if (!active || !active.waiting) return;
    tickTime(active); active.visible = document.visibilityState !== 'hidden';
    emit(active.visible ? 'visible' : 'hidden', !active.visible);
  });
  window.addEventListener('pagehide', function () {
    if (!active || active.handoff || !active.waiting) return;
    emit('leave', true); active.waiting = false; stop();
  });
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted && active && !active.handoff && !displayed[active.ctx.token]) resume(active.ctx.id);
  });
  // Every entry point is fail-open, including unavailable storage/crypto.
  var api = { begin: begin, resume: resume, accepted: accepted, resumeToken: resumeToken, stage: stage, handoff: handoff, failed: failed, viewed: viewed,
    configure: function (getSession) { auth = getSession; } };
  window.CalCarWait = {};
  Object.keys(api).forEach(function (k) { window.CalCarWait[k] = function () { try { return api[k].apply(null, arguments); } catch (_) { return null; } }; });
})();
