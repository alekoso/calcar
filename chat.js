/* CalCar Assistant: один персональний помічник на всю платформу.

   Один UI, одна історія розмови, одна памʼять, один стан, один контракт із
   /api/chat. Кнопки "Запитати CalCar" у продуктах не відкривають окремих чатів:
   вони відкривають цього самого помічника і передають йому фокус (контекст
   того, що людина зараз бачить). Фокус міняється при навігації, розмова ні.

   Архітектура:
     thread (localStorage, один на браузер, стабільний id)
       -> shell (шапка, полотно, composer; один компонент скрізь)
       -> сторінковий контекст (context.js) + фокус (картка над розмовою)
       -> здатності (capabilities), які реєструють сторінки:
            Check/Import звіт: повний контекст звіту, інші звіти людини, фото,
            запис розмови у рядок звіту; Гараж: публікація, авто; кабінет.

   Публічний API:
     CalCarChat.open({ focus, quote })   відкрити; focus = { label, title, subtitle, context }
     CalCarChat.close() / toggle()
     CalCarChat.setFocus(focus | null)
     CalCarChat.setQuote(text)
     CalCarChat.registerCapability({ id, applies(ctx), product, request(body, ctx), afterReply(data, userText, reply, ctx), suggestions(ctx), dock })
     CalCarChat.thread()                 { id, messages }
     CalCarChat.ask(text)

   Персональний шар: для залогіненої людини помічник підвантажує нотатку
   памʼяті (user_memory.memory) і наскрізний хвіст реплік (recent_turns), а
   після відповіді оновлює їх. Це ті самі механізми, що були в чаті звітів,
   тепер вони працюють на кожній сторінці. Дані людини не вигадуються: без
   сесії памʼяті просто нема. */
(function () {
  if (window.CalCarChat) return;

  var t = function (s) { return (window.t ? window.t(s) : s); };
  var THREAD_KEY = 'calcar_assistant_thread';
  var LEGACY_KEY = 'calcarGlobalChat';
  var MAX_THREAD = 40, SEND_LAST = 12, DOCK_MIN = 900;

  /* ---------- стилі: один дизайн у всіх продуктах ---------- */
  var CSS = '' +
  '.cc-fab{position:fixed;right:20px;bottom:20px;z-index:120;display:inline-flex;align-items:center;gap:9px;height:48px;padding:0 18px 0 15px;border:1px solid rgba(20,22,25,.08);border-radius:26px;background:var(--brand);color:var(--ink);font-family:inherit;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 8px 24px rgba(20,22,25,.16);transition:background .15s,transform .15s}' +
  '.cc-fab:hover{background:var(--brand-hover)}.cc-fab:active{transform:scale(.97)}' +
  '.cc-fab svg{width:19px;height:19px;flex:0 0 auto}' +
  '.cc-fab.hide{display:none}' +
  '.cc-ov{position:fixed;inset:0;background:rgba(15,25,40,.28);z-index:125;opacity:0;pointer-events:none;transition:opacity .22s}' +
  '.cc-ov.open{opacity:1;pointer-events:auto}' +
  '.cc-panel{position:fixed;top:0;right:0;bottom:0;width:380px;max-width:100vw;z-index:130;display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--line);box-shadow:-16px 0 40px rgba(20,22,25,.05);transform:translateX(102%);transition:transform .26s cubic-bezier(.22,.61,.36,1)}' +
  '.cc-panel.open{transform:none}' +
  '.cc-head{flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 14px 0 18px;height:57px;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line);box-shadow:0 2px 8px rgba(20,22,25,.04)}' +
  '.cc-head .cc-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}' +
  '.cc-head b{font-size:14px;font-weight:700;letter-spacing:-.2px;color:var(--ink)}' +
  '.cc-head span{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.cc-head span:empty{display:none}' +
  '.cc-x{width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-family:inherit;transition:background .15s,color .15s}' +
  '.cc-x:hover{background:var(--surface-2);color:var(--ink)}' +
  /* картка фокуса: закріплена над полотном, компактна, знімається */
  '.cc-focus{flex-shrink:0;display:none;align-items:center;gap:10px;margin:10px 16px 0;padding:8px 8px 8px 12px;background:var(--card);border:1px solid var(--line);border-radius:12px}' +
  '.cc-focus.on{display:flex}' +
  '.cc-focus .cc-fi{width:8px;height:8px;border-radius:50%;background:var(--brand);flex:0 0 auto}' +
  '.cc-focus .cc-fb{flex:1;min-width:0}' +
  '.cc-focus .cc-fl{display:block;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.cc-focus .cc-ft{display:block;font-size:13px;font-weight:700;color:var(--ink);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.cc-focus .cc-fx{width:26px;height:26px;border:none;border-radius:50%;background:transparent;color:var(--faint);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-family:inherit;flex:0 0 auto}' +
  '.cc-focus .cc-fx:hover{background:var(--surface-2);color:var(--ink)}' +
  '.cc-canvas{flex:1;overflow-y:auto;display:flex;flex-direction:column}' +
  '.cc-msgs{display:flex;flex-direction:column;gap:16px;padding:18px 18px 8px}' +
  '.cc-msg{max-width:95%;font-size:14.5px;line-height:1.62;white-space:pre-wrap;word-wrap:break-word}' +
  '.cc-msg.ai{align-self:flex-start;background:var(--card);border-radius:18px;padding:12px 14px;color:var(--text);box-shadow:0 1px 2px rgba(20,22,25,.05),0 6px 18px rgba(20,22,25,.04)}' +
  '.cc-msg.user{align-self:flex-end;max-width:80%;background:#202328;color:#fff;border-radius:16px;padding:10px 14px}' +
  '.cc-msg.typing{align-self:flex-start;background:var(--card);border-radius:18px;padding:12px 14px;display:flex;gap:5px}' +
  '.cc-msg.typing i{width:6px;height:6px;border-radius:50%;background:var(--faint);animation:cc-blink 1.2s infinite}' +
  '@keyframes cc-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}' +
  /* порожній стан: один на всі продукти */
  '.cc-empty{display:none;padding:28px 22px 6px;text-align:center}' +
  '.cc-empty.on{display:block}' +
  '.cc-empty svg{width:34px;height:34px;color:var(--brand-active);margin-bottom:8px}' +
  '.cc-empty b{display:block;font-size:15px;color:var(--ink);margin-bottom:4px}' +
  '.cc-empty p{font-size:13.5px;color:var(--muted);line-height:1.5;max-width:280px;margin:0 auto}' +
  '.cc-sugg{display:flex;flex-wrap:wrap;gap:8px;padding:12px 18px 18px}' +
  '.cc-sugg:empty{display:none}' +
  '.cc-sugg button{border:1px solid var(--line);background:var(--card);border-radius:20px;padding:8px 14px;font-size:13px;font-family:inherit;color:var(--ink);cursor:pointer;text-align:left;transition:border-color .15s,background .15s}' +
  '.cc-sugg button:hover{border-color:var(--brand);background:var(--brand-soft)}' +
  /* composer: одна картка, лаймовий лише send */
  '.cc-composer{position:relative;flex-shrink:0;padding:8px 14px 10px}' +
  '.cc-box{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:8px 8px 6px;box-shadow:0 1px 2px rgba(20,22,25,.04),0 8px 24px rgba(20,22,25,.06);transition:border-color .15s,box-shadow .15s}' +
  '.cc-box:focus-within{border-color:var(--line-strong);box-shadow:0 1px 2px rgba(20,22,25,.05),0 10px 28px rgba(20,22,25,.09)}' +
  '.cc-ta-wrap{position:relative}' +
  /* textarea і накладка з пілюлями збігаються в метриках до пікселя: одне правило */
  '.cc-box textarea,.cc-ta-overlay{display:block;width:100%;border:none;background:transparent;resize:none;outline:none;font-family:inherit;font-size:14.5px;line-height:1.5;letter-spacing:normal;padding:2px 6px;min-height:calc(3em + 4px);max-height:120px;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal}' +
  '.cc-box textarea{color:transparent;caret-color:var(--text)}' +
  '.cc-box textarea::selection{color:transparent}' +
  '.cc-box textarea::placeholder{color:var(--faint)}' +
  '.cc-ta-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden;color:var(--text)}' +
  '.cc-ref-pill{position:relative;border-radius:6px;background:var(--surface-2);box-shadow:0 0 0 2px var(--surface-2);cursor:pointer;pointer-events:auto}' +
  '.cc-row{display:flex;align-items:center;gap:8px;margin-top:2px}' +
  '.cc-attach{width:34px;height:34px;border:none;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;font-weight:700;font-size:15px;transition:background .15s,color .15s}' +
  '.cc-attach:hover{background:var(--surface-2);color:var(--ink)}' +
  '.cc-attach[hidden]{display:none}' +
  '.cc-send{margin-left:auto;width:36px;height:36px;border:none;border-radius:50%;background:var(--brand);color:var(--ink);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .12s}' +
  '.cc-send:hover{background:var(--brand-hover)}.cc-send:active{transform:scale(.94)}.cc-send:disabled{opacity:.45;cursor:default}' +
  '.cc-files{display:none;flex-wrap:wrap;gap:6px;padding:0 4px 8px}' +
  '.cc-chip{display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--line);border-radius:14px;padding:4px 10px;font-size:12px;max-width:100%}' +
  '.cc-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}' +
  '.cc-chip button{border:none;background:none;cursor:pointer;color:var(--faint);font-size:13px;padding:0;line-height:1}' +
  '.cc-quote{display:none;align-items:flex-start;gap:8px;margin:0 4px 8px;padding:8px 10px;border-left:3px solid var(--brand);background:var(--surface-2);border-radius:8px;font-size:12.5px;color:var(--ink-2);line-height:1.4}' +
  '.cc-quote span{flex:1;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}' +
  '.cc-quote button{border:none;background:none;cursor:pointer;color:var(--faint);font-size:13px;padding:0;line-height:1;flex:0 0 auto}' +
  /* попап згадки звіту через @ */
  '.cc-mention{position:absolute;left:8px;right:8px;bottom:calc(100% + 6px);z-index:5;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 28px rgba(20,22,25,.12);padding:6px;display:none}' +
  '.cc-mention input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none;margin-bottom:4px}' +
  '.cc-mention input:focus{border-color:var(--line-strong)}' +
  '.cc-mention-list{max-height:220px;overflow-y:auto}' +
  '.cc-mention-item{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:none;background:none;text-align:left;padding:8px 10px;border-radius:9px;font-family:inherit;font-size:13px;color:var(--ink);cursor:pointer}' +
  '.cc-mention-item.on{background:var(--surface-2)}' +
  '.cc-mention-item .ttl2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
  '.cc-mention-item .age{flex:0 0 auto;font-size:11.5px;color:var(--muted)}' +
  '.cc-mention-empty{padding:12px 14px;font-size:12.5px;color:var(--muted)}' +
  '.cc-note{display:flex;align-items:center;justify-content:center;gap:5px;margin-top:6px;font-size:11px;color:var(--faint)}' +
  '@media(max-width:760px){' +
    '.cc-fab{right:14px;bottom:14px;height:46px;padding:0 16px 0 13px}' +
    '.cc-panel{top:auto;left:0;right:0;bottom:0;width:auto;height:88vh;border-left:0;border-top:1px solid var(--line);border-radius:18px 18px 0 0;transform:translateY(102%);box-shadow:0 -14px 44px rgba(20,22,25,.18)}' +
    '.cc-panel.open{transform:none}' +
    '.cc-head{height:52px}' +
    '.cc-composer{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}' +
  '}';

  var I = {
    spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    send: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
    clip: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    shield: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  }

  /* ---------- один потік розмови на весь CalCar ---------- */
  var thread = { id: null, messages: [] };
  function loadThread() {
    try { var raw = localStorage.getItem(THREAD_KEY); if (raw) thread = JSON.parse(raw); } catch (e) {}
    if (!thread || typeof thread !== 'object') thread = { id: null, messages: [] };
    if (!Array.isArray(thread.messages)) thread.messages = [];
    if (!thread.id) thread.id = uuid();
    /* попередній глобальний чат жив у sessionStorage: забираємо його один раз */
    if (!thread.messages.length) {
      try {
        var old = JSON.parse(sessionStorage.getItem(LEGACY_KEY) || '[]');
        if (Array.isArray(old) && old.length) thread.messages = old.map(function (m) { return { role: m.role, content: m.content }; });
        sessionStorage.removeItem(LEGACY_KEY);
      } catch (e) {}
    }
    saveThread();
  }
  function saveThread() {
    thread.messages = thread.messages.slice(-MAX_THREAD);
    try { localStorage.setItem(THREAD_KEY, JSON.stringify(thread)); } catch (e) {}
  }

  /* ---------- стан ---------- */
  var els = {}, booted = false, sending = false;
  var caps = [];                 /* здатності сторінок */
  var focus = null, focusDismissed = false;
  var quote = '';
  var pendingFiles = [], pendingRefs = [];
  var sb = null;                 /* Supabase-клієнт сторінки, якщо є */
  var MEMORY = null, MEM_UID = null, RECENT_TURNS = [], memLastLen = 0, memTimer = null, memLoaded = false;
  var REF_LIST = null, mentionIdx = 0, mentionPos = -1, mentionReplace = -1;

  function pageCtx(extra) { return window.CalCarContext ? window.CalCarContext.get(extra) : (extra || {}); }
  function activeCaps(ctx) { return caps.filter(function (c) { try { return !c.applies || c.applies(ctx); } catch (e) { return false; } }); }
  function productFor(ctx) {
    var ac = activeCaps(ctx);
    for (var i = ac.length - 1; i >= 0; i--) if (ac[i].product) return ac[i].product;
    var p = String(ctx.page_type || '');
    return p.indexOf('garage') === 0 ? 'garage' : p.indexOf('import') === 0 ? 'import' : 'check';
  }
  function wantsDock() { return activeCaps(pageCtx()).some(function (c) { return c.dock; }); }

  /* Фокус, виведений зі сторінки: звіт або авто це і є те, про що людина
     дивиться. Явний фокус (кнопка "Запитати CalCar") головніший. */
  function derivedFocus() {
    var c = pageCtx();
    var v = c.vehicle && (c.vehicle.title || [c.vehicle.make, c.vehicle.model, c.vehicle.year].filter(Boolean).join(' '));
    if (c.page_type === 'check_report' && v) return { label: t('Check report'), title: v, context: {} };
    if (c.page_type === 'import_report' && v) return { label: t('Import calculation'), title: v, context: {} };
    if (c.page_type === 'garage_vehicle' && v) return { label: t('My car'), title: v, context: {} };
    if (c.page_type === 'garage_post' && c.post) return { label: c.content_type === 'calcar_article' ? t('CalCar article') : t('Owner post'), title: v || 'CalCar', subtitle: c.post.title, context: {} };
    return null;
  }
  function currentFocus() { return focus || (focusDismissed ? null : derivedFocus()); }
  function renderFocus() {
    var f = currentFocus();
    els.focus.classList.toggle('on', !!f);
    els.sub.textContent = f ? f.title : '';
    if (!f) return;
    els.focus.querySelector('.cc-fl').textContent = f.label || '';
    els.focus.querySelector('.cc-ft').textContent = f.subtitle ? f.title + ' · ' + f.subtitle : f.title;
  }

  /* ---------- памʼять помічника: одна нотатка на акаунт, хвіст реплік ---------- */
  function client() {
    if (sb) return sb;
    if (window.SB) return (sb = window.SB);
    try { if (typeof SB !== 'undefined' && SB) return (sb = SB); } catch (e) {}
    try {
      if (window.supabase && window.CALCAR_SUPABASE && window.CALCAR_SUPABASE.url) sb = window.supabase.createClient(window.CALCAR_SUPABASE.url, window.CALCAR_SUPABASE.anon);
    } catch (e) {}
    return sb;
  }
  async function loadMemory() {
    if (memLoaded) return; memLoaded = true;
    var c = client(); if (!c) return;
    try {
      var s = await c.auth.getSession();
      if (!s || !s.data || !s.data.session) return;
      MEM_UID = s.data.session.user.id;
      var r = await c.from('user_memory').select('memory,recent_turns').eq('user_id', MEM_UID).maybeSingle();
      var data = r && r.data;
      /* порожній рядок, не null: для /api/chat це знак, що нотатку є куди зберегти */
      MEMORY = (data && data.memory) || '';
      RECENT_TURNS = Array.isArray(data && data.recent_turns) ? data.recent_turns.slice(-12) : [];
      memLastLen = thread.messages.length;
    } catch (e) {}
  }
  function memTurn(role, text, f) {
    return { report_id: (f && f.context && f.context.report_id) || pageCtx().report_id || null, title: (f && f.title) || null, at: new Date().toISOString(), role: role, text: String(text || '').slice(0, 280) };
  }
  async function saveChatMemory(note, userText, aiText, f) {
    if (!MEM_UID || !client()) return;
    var patch = { user_id: MEM_UID, updated_at: new Date().toISOString() };
    if (typeof note === 'string' && note.trim()) { MEMORY = note.trim(); patch.memory = MEMORY; }
    RECENT_TURNS = RECENT_TURNS.concat([memTurn('user', userText, f), memTurn('assistant', aiText, f)]).slice(-12);
    patch.recent_turns = RECENT_TURNS;
    try { await client().from('user_memory').upsert(patch); } catch (e) {}
  }
  /* після відповіді нотатка тихо оновлюється раз на кілька реплік */
  function scheduleMemoryUpdate() {
    if (!MEM_UID) return;
    if (thread.messages.length - memLastLen < 4) return;
    clearTimeout(memTimer);
    memTimer = setTimeout(async function () {
      try {
        var r = await fetch('/api/memory', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ memory: MEMORY, messages: thread.messages.slice(-10).map(function (m) { return { role: m.role, content: m.content }; }), lang: window.calcarLang ? window.calcarLang() : 'en' }) });
        var data = await r.json().catch(function () { return {}; });
        if (!r.ok || typeof data.memory !== 'string') return;
        MEMORY = data.memory || '';
        memLastLen = thread.messages.length;
        await client().from('user_memory').upsert({ user_id: MEM_UID, memory: MEMORY, updated_at: new Date().toISOString() });
      } catch (e) {}
    }, 8000);
  }

  /* ---------- @-згадка звіту: список звітів людини для порівняння ---------- */
  async function loadRefList() {
    if (REF_LIST) return REF_LIST;
    REF_LIST = [];
    var c = client(); if (!c) return REF_LIST;
    try {
      var s = await c.auth.getSession();
      if (!s || !s.data || !s.data.session) return REF_LIST;
      var r = await c.from('reports').select('id,title,kind,created_at').order('created_at', { ascending: false }).limit(20);
      var cur = pageCtx().report_id || null;
      REF_LIST = (r.data || []).filter(function (x) { return x.id !== cur; });
    } catch (e) {}
    return REF_LIST;
  }
  function refDays(iso) {
    var d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
    return d === 0 ? t('today') : d + ' ' + t('days ago');
  }
  function mentionRows() {
    var q = (els.mentionSearch.value || '').trim().toLowerCase();
    return (REF_LIST || []).filter(function (r) { return !q || String(r.title || '').toLowerCase().indexOf(q) > -1; }).slice(0, 8);
  }
  function mentionOpenNow() { return els.mention.style.display !== 'none' && els.mention.style.display !== ''; }
  function renderMention() {
    var list = els.mentionList, rows = mentionRows();
    if (mentionIdx >= rows.length) mentionIdx = Math.max(0, rows.length - 1);
    list.innerHTML = '';
    if (!rows.length) { var d = document.createElement('div'); d.className = 'cc-mention-empty'; d.textContent = t('No reports yet'); list.appendChild(d); return; }
    rows.forEach(function (r, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'cc-mention-item' + (i === mentionIdx ? ' on' : '');
      var nm = document.createElement('span'); nm.className = 'ttl2'; nm.textContent = r.title || t('Estimate');
      var age = document.createElement('span'); age.className = 'age'; age.textContent = refDays(r.created_at);
      b.append(nm, age);
      b.onmouseenter = function () { mentionIdx = i; var on = list.querySelector('.cc-mention-item.on'); if (on) on.classList.remove('on'); b.classList.add('on'); };
      /* вибір на pointerdown із preventDefault до втрати фокуса, інакше по машині не влучити */
      b.onpointerdown = function (e) { e.preventDefault(); pickMention(r); };
      list.appendChild(b);
    });
  }
  function openMention(pos) {
    mentionPos = pos; mentionIdx = 0;
    els.mention.style.display = 'block';
    els.mentionSearch.value = '';
    renderMention();
    loadRefList().then(renderMention);
    els.mentionSearch.focus();
  }
  function closeMention(back) { els.mention.style.display = 'none'; mentionPos = -1; mentionReplace = -1; if (back) els.text.focus(); }
  function renderTaOverlay() {
    var field = els.text, ov = els.overlay;
    ov.innerHTML = '';
    var text = field.value, marks = [], from = 0;
    pendingRefs.forEach(function (ref) { var i = text.indexOf(ref.title, from); if (i === -1) return; marks.push({ ref: ref, start: i, end: i + ref.title.length }); from = i + ref.title.length; });
    var pos = 0;
    marks.forEach(function (m) {
      if (m.start > pos) ov.appendChild(document.createTextNode(text.slice(pos, m.start)));
      var pill = document.createElement('span'); pill.className = 'cc-ref-pill'; pill.dataset.refId = m.ref.id; pill.textContent = text.slice(m.start, m.end);
      ov.appendChild(pill); pos = m.end;
    });
    ov.appendChild(document.createTextNode(text.slice(pos)));
    ov.scrollTop = field.scrollTop;
  }
  function refSpans() {
    var text = els.text.value, spans = [], from = 0;
    pendingRefs.forEach(function (ref) { var i = text.indexOf(ref.title, from); if (i === -1) return; spans.push({ start: i, end: i + ref.title.length }); from = i + ref.title.length; });
    return spans;
  }
  function refSync() { els.text.dispatchEvent(new Event('input', { bubbles: true })); }
  function dropErasedRefs() {
    var text = els.text.value, from = 0;
    pendingRefs = pendingRefs.filter(function (ref) { var i = text.indexOf(ref.title, from); if (i === -1) return false; from = i + ref.title.length; return true; });
  }
  function pickMention(r) {
    var field = els.text;
    var dup = pendingRefs.some(function (x) { return x.id === r.id; });
    var picked = { id: r.id, title: r.title || t('Estimate'), kind: r.kind === 'check' ? 'check' : 'import' };
    if (mentionReplace >= 0 && pendingRefs[mentionReplace]) {
      if (!dup) { var old = pendingRefs[mentionReplace]; pendingRefs[mentionReplace] = picked; field.value = field.value.replace(old.title, picked.title); }
    } else {
      /* максимум два прикріплені звіти */
      if (!dup && pendingRefs.length >= 2) { closeMention(true); return; }
      if (!dup) pendingRefs.push(picked);
      var name = picked.title + ' ';
      if (mentionPos >= 0 && field.value[mentionPos] === '@') field.value = field.value.slice(0, mentionPos) + name + field.value.slice(mentionPos + 1);
      else field.value += (field.value && !/\s$/.test(field.value) ? ' ' : '') + name;
    }
    refSync(); closeMention(true);
  }
  function mentionKeydown(e) {
    var rows = mentionRows();
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionIdx = Math.min(rows.length - 1, mentionIdx + 1); renderMention(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = Math.max(0, mentionIdx - 1); renderMention(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[mentionIdx]) pickMention(rows[mentionIdx]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMention(true); }
  }
  function bindMention() {
    var field = els.text, inp = els.mentionSearch;
    field.addEventListener('input', function (e) {
      dropErasedRefs(); renderTaOverlay();
      if (e.data === '@') { openMention(field.selectionStart - 1); return; }
      if (mentionOpenNow() && (mentionPos < 0 || field.value[mentionPos] !== '@')) closeMention(false);
    });
    field.addEventListener('scroll', function () { els.overlay.scrollTop = field.scrollTop; });
    els.overlay.addEventListener('click', function (e) {
      var pill = e.target.closest('.cc-ref-pill'); if (!pill) return;
      e.preventDefault();
      mentionReplace = pendingRefs.findIndex(function (r) { return r.id === pill.dataset.refId; });
      openMention(-1);
    });
    /* пілюля атомарна для клавіатури: Backspace зносить її цілком, стрілки перестрибують */
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace') {
        if (field.selectionStart !== field.selectionEnd) return;
        var p = field.selectionStart;
        var span = refSpans().filter(function (sp) { return sp.end === p; })[0];
        if (!span) return;
        e.preventDefault();
        field.value = field.value.slice(0, span.start) + field.value.slice(p);
        field.setSelectionRange(span.start, span.start);
        refSync(); return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var back = e.key === 'ArrowLeft', collapsed = field.selectionStart === field.selectionEnd;
      if (!collapsed && !e.shiftKey) return;
      var backward = field.selectionDirection === 'backward';
      var p2 = collapsed ? field.selectionStart : (backward ? field.selectionStart : field.selectionEnd);
      var anchor = collapsed ? p2 : (backward ? field.selectionEnd : field.selectionStart);
      var span2 = refSpans().filter(function (sp) { return back ? sp.end === p2 : sp.start === p2; })[0];
      if (!span2) return;
      e.preventDefault();
      var q = back ? span2.start : span2.end;
      if (e.shiftKey) field.setSelectionRange(Math.min(anchor, q), Math.max(anchor, q), q < anchor ? 'backward' : 'forward');
      else field.setSelectionRange(q, q);
    });
    field.addEventListener('keydown', function (e) { if (e.key === 'Escape' && mentionOpenNow()) closeMention(true); });
    els.atBtn.addEventListener('click', function () {
      var p = field.selectionStart != null ? field.selectionStart : field.value.length;
      field.value = field.value.slice(0, p) + '@' + field.value.slice(p);
      field.setSelectionRange(p + 1, p + 1);
      refSync(); openMention(p);
    });
    inp.addEventListener('keydown', mentionKeydown);
    inp.addEventListener('input', function () { mentionIdx = 0; renderMention(); });
    document.addEventListener('click', function (e) {
      if (mentionOpenNow() && !e.target.closest('.cc-mention') && !e.target.closest('.cc-ref-pill') && e.target !== els.atBtn && e.target !== field) closeMention(false);
    });
  }
  /* повні дані прикріплених звітів по id: без фото, урізані до ключового */
  async function refPayload() {
    if (!pendingRefs.length || !client()) return null;
    var out = [];
    try {
      var r = await client().from('reports').select('id,title,kind,created_at,data').in('id', pendingRefs.map(function (x) { return x.id; }));
      pendingRefs.forEach(function (ref) {
        var row = (r.data || []).filter(function (x) { return x.id === ref.id; })[0];
        var d = (row && row.data) || {}, meta = d._meta || {};
        out.push({ id: ref.id, title: (row && row.title) || ref.title, kind: (row && row.kind) || ref.kind, created_at: (row && row.created_at) || null,
          vehicle: d.vehicle || null, verdict: d.verdict || null, risks: d.risks || null, flags: d.flags || null, damage_note: d.damage_note || null,
          totals: d.totals || d._snapshot || null,
          meta: { vin: meta.vin || null, price: meta.price || null, damage: meta.damage || null, lot_number: meta.lot_number || null, mileage: meta.mileage || null } });
      });
    } catch (e) { pendingRefs.forEach(function (ref) { out.push({ id: ref.id, title: ref.title, kind: ref.kind }); }); }
    return out.slice(0, 2);
  }

  /* ---------- файли: фото і PDF до 3 на повідомлення ---------- */
  function readAsDataURL(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('read')); }; r.readAsDataURL(f); }); }
  async function shrinkImage(f) {
    var url = await readAsDataURL(f);
    if (f.size < 700 * 1024) return url;
    var img = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = url; });
    var k = Math.min(1, 1600 / Math.max(img.width, img.height));
    var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .85);
  }
  function renderFiles() {
    var row = els.files; row.innerHTML = '';
    row.style.display = pendingFiles.length ? 'flex' : 'none';
    pendingFiles.forEach(function (p, i) {
      var chip = document.createElement('span'); chip.className = 'cc-chip';
      var nm = document.createElement('span'); nm.textContent = (p.kind === 'pdf' ? 'PDF · ' : '') + p.name;
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕';
      x.onclick = function () { pendingFiles.splice(i, 1); renderFiles(); };
      chip.append(nm, x); row.appendChild(chip);
    });
  }
  function renderQuote() {
    els.quote.style.display = quote ? 'flex' : 'none';
    els.quoteText.textContent = quote;
  }
  /* єдиний шлях очищення після відправки: поле, накладка, пілюлі, цитата, файли разом */
  function resetComposer() {
    els.text.value = ''; els.text.style.height = '';
    pendingRefs.splice(0); pendingFiles.splice(0); quote = '';
    renderTaOverlay(); renderFiles(); renderQuote();
  }

  /* ---------- підказки: один компонент, дані від сторінки або за типом сторінки ---------- */
  function suggestionsFor(ctx) {
    var out = [];
    activeCaps(ctx).forEach(function (c) { if (c.suggestions) { try { out = out.concat(c.suggestions(ctx) || []); } catch (e) {} } });
    if (out.length) return out.slice(0, 5);
    var f = currentFocus();
    if (f && f.context && f.context.content_type === 'owner_post') return [t('Is this relevant for my car?'), t('How much does such a repair cost?'), t('Find similar cases')];
    if (f && f.context && f.context.content_type === 'calcar_article') return [t('What of this applies to my car?'), t('Find similar cases')];
    var p = String(ctx.page_type || '');
    if (p === 'garage_vehicle') return [t('What should I service next?'), t('What is this car worth now?')];
    if (p.indexOf('import') === 0) return [t('How is the landed cost calculated?'), t('Which damage is a red flag?')];
    if (p.indexOf('garage') === 0) return [t('What can you help with in the Garage?'), t('What should I service next?')];
    return [t('How does a CalCar check work?'), t('What to look at in a used car listing?')];
  }

  /* ---------- побудова ---------- */
  function boot() {
    if (booted) return; booted = true;
    loadThread();
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'cc-fab'; fab.id = 'ccFab';
    fab.setAttribute('aria-label', t('Ask CalCar'));
    fab.innerHTML = I.spark + '<span>' + esc(t('Ask CalCar')) + '</span>';
    var ov = document.createElement('div'); ov.className = 'cc-ov'; ov.id = 'ccOverlay';
    var panel = document.createElement('div');
    panel.className = 'cc-panel'; panel.id = 'ccPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'CalCar Assistant');
    panel.innerHTML =
      '<div class="cc-head"><div class="cc-t"><b>CalCar Assistant</b><span id="ccSub"></span></div>' +
      '<button class="cc-x" type="button" id="ccClose" aria-label="' + esc(t('Close')) + '">' + I.x + '</button></div>' +
      '<div class="cc-focus" id="ccFocus"><i class="cc-fi"></i><div class="cc-fb"><span class="cc-fl"></span><span class="cc-ft"></span></div>' +
      '<button class="cc-fx" type="button" id="ccFocusX" title="' + esc(t('Remove context')) + '" aria-label="' + esc(t('Remove context')) + '">' + I.x + '</button></div>' +
      '<div class="cc-canvas" id="ccCanvas">' +
      '<div class="cc-empty" id="ccEmpty">' + I.spark + '<b>CalCar Assistant</b><p>' + esc(t('Ask me about a car, a report, or whatever is open on the page right now.')) + '</p></div>' +
      '<div class="cc-msgs" id="ccMsgs"></div>' +
      '<div class="cc-sugg" id="ccSugg"></div></div>' +
      '<div class="cc-composer">' +
      '<div class="cc-mention" id="ccMention"><input type="text" id="ccMentionSearch" placeholder="' + esc(t('Search reports by name')) + '" autocomplete="off"><div class="cc-mention-list" id="ccMentionList"></div></div>' +
      '<div class="cc-box">' +
      '<div class="cc-quote" id="ccQuote"><span id="ccQuoteText"></span><button type="button" id="ccQuoteX" aria-label="' + esc(t('Remove quote')) + '">✕</button></div>' +
      '<div class="cc-files" id="ccFiles"></div>' +
      '<div class="cc-ta-wrap"><textarea id="ccText" rows="1" placeholder="' + esc(t('Ask a question')) + '"></textarea><div class="cc-ta-overlay" id="ccOverlayTa" aria-hidden="true"></div></div>' +
      '<div class="cc-row">' +
      '<button class="cc-attach" type="button" id="ccAttach" title="' + esc(t('Attach a photo or PDF')) + '" aria-label="' + esc(t('Attach a file')) + '">' + I.clip + '</button>' +
      '<button class="cc-attach" type="button" id="ccAt" title="' + esc(t('Add a report for comparison')) + '" aria-label="' + esc(t('Add a report for comparison')) + '">@</button>' +
      '<input type="file" id="ccFile" accept="image/*,application/pdf" multiple style="display:none">' +
      '<button class="cc-send" type="button" id="ccSend" aria-label="' + esc(t('Send')) + '">' + I.send + '</button>' +
      '</div></div>' +
      '<div class="cc-note">' + I.shield + esc(t('CalCar sees the page you are on')) + '</div></div>';
    document.body.append(fab, ov, panel);

    els = {
      fab: fab, ov: ov, panel: panel,
      sub: panel.querySelector('#ccSub'), focus: panel.querySelector('#ccFocus'),
      canvas: panel.querySelector('#ccCanvas'), empty: panel.querySelector('#ccEmpty'), msgs: panel.querySelector('#ccMsgs'), sugg: panel.querySelector('#ccSugg'),
      text: panel.querySelector('#ccText'), overlay: panel.querySelector('#ccOverlayTa'), send: panel.querySelector('#ccSend'),
      attach: panel.querySelector('#ccAttach'), atBtn: panel.querySelector('#ccAt'), file: panel.querySelector('#ccFile'), files: panel.querySelector('#ccFiles'),
      quote: panel.querySelector('#ccQuote'), quoteText: panel.querySelector('#ccQuoteText'),
      mention: panel.querySelector('#ccMention'), mentionSearch: panel.querySelector('#ccMentionSearch'), mentionList: panel.querySelector('#ccMentionList')
    };

    fab.addEventListener('click', function () { API.open(); });
    ov.addEventListener('click', API.close);
    panel.querySelector('#ccClose').addEventListener('click', API.close);
    panel.querySelector('#ccFocusX').addEventListener('click', function () { focus = null; focusDismissed = true; renderFocus(); renderSugg(); });
    panel.querySelector('#ccQuoteX').addEventListener('click', function () { quote = ''; renderQuote(); });
    els.send.addEventListener('click', function () { submit(); });
    els.text.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });
    els.text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !mentionOpenNow()) { e.preventDefault(); submit(); } });
    els.attach.addEventListener('click', function () { els.file.click(); });
    els.file.addEventListener('change', async function () {
      var input = els.file, list = Array.prototype.slice.call(input.files || []);
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        if (pendingFiles.length >= 3) { msg('ai', t('Up to 3 files per message')); break; }
        try {
          if (f.type === 'application/pdf') {
            if (f.size > 2.5 * 1024 * 1024) { msg('ai', t('PDF is too large, 2.5 MB limit')); continue; }
            pendingFiles.push({ name: f.name, kind: 'pdf', data: await readAsDataURL(f) });
          } else if (/^image\//.test(f.type)) pendingFiles.push({ name: f.name, kind: 'image', data: await shrinkImage(f) });
        } catch (e) {}
      }
      input.value = ''; renderFiles();
    });
    els.sugg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) submit(b.textContent.trim()); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open') && !mentionOpenNow()) API.close(); });
    window.addEventListener('resize', function () { if (panel.classList.contains('open')) layout(); });
    bindMention();

    thread.messages.forEach(function (m) { msg(m.role === 'assistant' ? 'ai' : 'user', m.content); });
    renderEmpty();
  }

  function layout() {
    var dock = wantsDock() && window.innerWidth > DOCK_MIN;
    document.body.classList.toggle('chat-docked', dock);
    els.ov.classList.toggle('open', !dock);
    document.documentElement.style.overflow = window.innerWidth <= 760 ? 'hidden' : '';
  }
  function msg(role, text) {
    var el = document.createElement('div');
    el.className = 'cc-msg ' + role; el.textContent = text;
    els.msgs.appendChild(el);
    els.canvas.scrollTop = els.canvas.scrollHeight;
    return el;
  }
  function renderEmpty() { els.empty.classList.toggle('on', !thread.messages.length); }
  function renderSugg() {
    els.sugg.innerHTML = '';
    if (thread.messages.length) return;
    suggestionsFor(pageCtx()).forEach(function (q) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = q; els.sugg.appendChild(b);
    });
  }

  function submit(forced) {
    var text = String(forced != null ? forced : els.text.value).trim();
    if ((!text && !pendingFiles.length) || sending) return;
    send(text);
  }
  async function send(text) {
    sending = true; els.send.disabled = true;
    els.sugg.innerHTML = '';
    var f = currentFocus();
    var ctx = pageCtx(f && f.context);
    var product = productFor(ctx);
    var atts = pendingFiles.slice();
    var refs = await refPayload();
    var q = quote || null;
    resetComposer();
    /* в історії лише текст із маркером файлів: самі файли великі і йдуть тільки з цим повідомленням */
    var shown = text + (atts.length ? (text ? '\n' : '') + t('Attached files:') + ' ' + atts.map(function (a) { return a.name; }).join(', ') : '');
    var tag = { at: new Date().toISOString(), page_type: ctx.page_type || null, report_id: ctx.report_id || null, post_id: ctx.post_id || null };
    thread.messages.push(Object.assign({ role: 'user', content: shown }, tag));
    saveThread(); renderEmpty();
    msg('user', shown);
    var sendMessages = thread.messages.slice(-SEND_LAST).map(function (m) { return { role: m.role, content: m.content }; });
    if (atts.length) {
      var last = sendMessages[sendMessages.length - 1];
      sendMessages[sendMessages.length - 1] = { role: 'user', content: [{ type: 'text', text: last.content }].concat(atts.map(function (a) {
        return a.kind === 'image' ? { type: 'image_url', image_url: { url: a.data, detail: 'high' } } : { type: 'file', file: { filename: a.name, file_data: a.data } };
      })) };
    }
    var typing = msg('typing', '');
    typing.innerHTML = '<i></i><i style="animation-delay:.2s"></i><i style="animation-delay:.4s"></i>';
    var body = {
      product: product, thread_id: thread.id, messages: sendMessages, context: ctx,
      memory: MEMORY, recent_turns: RECENT_TURNS, referenced_reports: refs, quoted_text: q,
      report_id: ctx.report_id || null,
      lang: window.calcarLang ? window.calcarLang() : 'en'
    };
    var ac = activeCaps(ctx);
    ac.forEach(function (c) { if (c.request) { try { body = c.request(body, ctx) || body; } catch (e) {} } });
    try {
      var r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      var data = await r.json().catch(function () { return {}; });
      typing.remove();
      if (!r.ok || !data.reply) throw new Error(data.error || t('Could not answer, try again'));
      thread.messages.push(Object.assign({ role: 'assistant', content: data.reply }, tag));
      saveThread();
      msg('ai', data.reply);
      saveChatMemory(data.memory_update, shown, data.reply, f);
      scheduleMemoryUpdate();
      ac.forEach(function (c) { if (c.afterReply) { try { c.afterReply(data, shown, data.reply, ctx); } catch (e) {} } });
    } catch (e) {
      typing.remove();
      msg('ai', (e && e.message) || t('Could not answer, try again'));
    } finally {
      sending = false; els.send.disabled = false;
      if (window.innerWidth > 560) els.text.focus();
    }
  }

  var API = {
    open: function (opts) {
      boot();
      opts = opts || {};
      if (opts.focus) { focus = opts.focus; focusDismissed = false; }
      if (typeof opts.quote === 'string') { quote = opts.quote.trim().slice(0, 500); renderQuote(); }
      renderFocus(); renderEmpty(); renderSugg();
      els.panel.classList.add('open');
      els.fab.classList.add('hide');
      layout();
      loadMemory();
      if (window.innerWidth > 560) setTimeout(function () { els.text.focus(); }, 60);
      els.canvas.scrollTop = els.canvas.scrollHeight;
    },
    close: function () {
      if (!booted) return;
      els.panel.classList.remove('open'); els.ov.classList.remove('open'); els.fab.classList.remove('hide');
      document.body.classList.remove('chat-docked');
      document.documentElement.style.overflow = '';
    },
    toggle: function () { if (booted && els.panel.classList.contains('open')) API.close(); else API.open(); },
    isOpen: function () { return !!(booted && els.panel.classList.contains('open')); },
    setFocus: function (f) { focus = f || null; focusDismissed = !f; if (booted) { renderFocus(); renderSugg(); } },
    setQuote: function (text) { quote = String(text || '').trim().slice(0, 500); if (booted) renderQuote(); },
    registerCapability: function (cap) { if (cap && typeof cap === 'object') caps.push(cap); return API; },
    thread: function () { if (!thread.id) loadThread(); return { id: thread.id, messages: thread.messages.slice() }; },
    ask: function (text, opts) { API.open(opts); submit(text); },
    mounted: function () { return booted; }
  };
  window.CalCarChat = API;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
