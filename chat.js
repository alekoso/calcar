/* CalCar Chat: спільний глобальний помічник платформи.

   Одна реалізація на всі сторінки, де свого чату ще нема: Check і Import
   вітрини, Гараж, кабінет. На сторінках звіту (result.html, result-check.html)
   уже живе свій докований чат по конкретному авто з памʼяттю, цитуванням і
   згадками інших звітів: там цей файл СВІДОМО не монтується, щоб на одній
   сторінці не було двох чатів. Ознака: наявність #chatPanel у розмітці.

   Що людина бачить, помічник дізнається з window.CalCarContext (context.js),
   а не з сирого DOM. Розмова живе в sessionStorage і переживає звичайну
   навігацію по CalCar у межах вкладки.

   Публічний API:
     CalCarChat.open(opts)  opts: { context, intro, suggestions }
     CalCarChat.close()
     CalCarChat.ask(text)   відкрити і одразу поставити питання */
(function () {
  if (window.CalCarChat) return;
  if (document.getElementById('chatPanel')) return; /* у сторінки свій чат */

  var t = function (s) { return (window.t ? window.t(s) : s); };
  var HIST_KEY = 'calcarGlobalChat';
  var MAX_HIST = 30;

  var CSS = '' +
  '.cc-fab{position:fixed;right:20px;bottom:20px;z-index:120;display:inline-flex;align-items:center;gap:9px;height:48px;padding:0 18px 0 15px;border:1px solid rgba(20,22,25,.08);border-radius:26px;background:var(--brand);color:var(--ink);font-family:inherit;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 8px 24px rgba(20,22,25,.16);transition:background .15s,transform .15s}' +
  '.cc-fab:hover{background:var(--brand-hover)}.cc-fab:active{transform:scale(.97)}' +
  '.cc-fab svg{width:19px;height:19px;flex:0 0 auto}' +
  '.cc-fab.hide{display:none}' +
  '.cc-ov{position:fixed;inset:0;background:rgba(15,25,40,.28);z-index:125;opacity:0;pointer-events:none;transition:opacity .22s}' +
  '.cc-ov.open{opacity:1;pointer-events:auto}' +
  '.cc-panel{position:fixed;top:0;right:0;bottom:0;width:394px;max-width:100vw;z-index:130;background:var(--bg);border-left:1px solid var(--line);display:flex;flex-direction:column;transform:translateX(102%);transition:transform .24s cubic-bezier(.22,.7,.3,1);box-shadow:-18px 0 44px rgba(20,22,25,.10)}' +
  '.cc-panel.open{transform:none}' +
  '.cc-head{flex-shrink:0;display:flex;align-items:center;gap:12px;padding:12px 14px 12px 18px;background:var(--card);border-bottom:1px solid var(--line)}' +
  '.cc-head .cc-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}' +
  '.cc-head b{font-size:14px;font-weight:700;letter-spacing:-.2px;color:var(--ink)}' +
  '.cc-head span{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.cc-x{border:none;background:none;color:var(--muted);cursor:pointer;padding:7px;margin:-7px;border-radius:9px;display:inline-flex;font-family:inherit}' +
  '.cc-x:hover{background:var(--surface-2);color:var(--ink)}' +
  '.cc-canvas{flex:1;overflow-y:auto;display:flex;flex-direction:column}' +
  '.cc-msgs{display:flex;flex-direction:column;gap:16px;padding:20px 18px}' +
  '.cc-msg{max-width:95%;font-size:14.5px;line-height:1.62;white-space:pre-wrap;word-wrap:break-word}' +
  '.cc-msg.ai{align-self:flex-start;color:var(--ink)}' +
  '.cc-msg.user{align-self:flex-end;background:var(--ink);color:#fff;border-radius:16px 16px 4px 16px;padding:10px 14px}' +
  '.cc-msg.typing{align-self:flex-start;background:var(--card);border-radius:16px;padding:12px 14px;display:flex;gap:5px}' +
  '.cc-msg.typing i{width:6px;height:6px;border-radius:50%;background:var(--faint);animation:cc-blink 1.2s infinite}' +
  '@keyframes cc-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}' +
  '.cc-about{flex:0 0 auto;margin:16px 18px 0;padding:10px 12px;background:var(--brand-soft);border:1px solid #DCEFAE;border-radius:11px;font-size:12.5px;color:var(--brand-ink);line-height:1.45}' +
  '.cc-about b{display:block;font-weight:800;margin-bottom:2px}' +
  '.cc-sugg{display:flex;flex-wrap:wrap;gap:8px;padding:0 18px 18px}' +
  '.cc-sugg button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:18px;padding:8px 13px;font-size:13px;font-family:inherit;cursor:pointer;text-align:left;transition:border-color .15s,background .15s}' +
  '.cc-sugg button:hover{border-color:var(--brand);background:var(--brand-soft)}' +
  '.cc-composer{flex-shrink:0;padding:8px 14px 12px}' +
  '.cc-box{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:8px 10px 8px 14px;box-shadow:0 1px 2px rgba(20,22,25,.04)}' +
  '.cc-box:focus-within{border-color:var(--line-strong);box-shadow:0 1px 2px rgba(20,22,25,.05),0 10px 28px rgba(20,22,25,.09)}' +
  '.cc-box textarea{display:block;width:100%;border:none;outline:none;resize:none;background:none;font-family:inherit;font-size:14.5px;line-height:1.5;color:var(--text);max-height:140px}' +
  '.cc-box textarea::placeholder{color:var(--faint)}' +
  '.cc-row{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:2px}' +
  '.cc-send{width:34px;height:34px;flex:0 0 auto;border:none;border-radius:50%;background:var(--brand);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;transition:background .15s,transform .1s}' +
  '.cc-send:hover{background:var(--brand-hover)}.cc-send:active{transform:scale(.94)}.cc-send:disabled{opacity:.45;cursor:default}' +
  '.cc-note{display:flex;align-items:center;gap:5px;margin-top:7px;padding:0 4px;font-size:11px;color:var(--faint)}' +
  '@media(max-width:760px){' +
    '.cc-fab{right:14px;bottom:14px;height:46px;padding:0 16px 0 13px}' +
    '.cc-panel{top:auto;left:0;right:0;bottom:0;width:auto;height:88vh;border-left:0;border-top:1px solid var(--line);border-radius:18px 18px 0 0;transform:translateY(102%);box-shadow:0 -14px 44px rgba(20,22,25,.18)}' +
    '.cc-panel.open{transform:none}' +
    '.cc-composer{padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}' +
  '}';

  var ICON_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

  var els = {}, hist = [], booted = false, pending = null, sending = false;

  function boot() {
    if (booted) return; booted = true;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'cc-fab'; fab.id = 'ccFab';
    fab.setAttribute('aria-label', t('Ask CalCar'));
    fab.innerHTML = ICON_SPARK + '<span>' + esc(t('Ask CalCar')) + '</span>';

    var ov = document.createElement('div'); ov.className = 'cc-ov'; ov.id = 'ccOverlay';

    var panel = document.createElement('div');
    panel.className = 'cc-panel'; panel.id = 'ccPanel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'CalCar Assistant');
    panel.innerHTML =
      '<div class="cc-head"><div class="cc-t"><b>CalCar Assistant</b><span id="ccSub"></span></div>' +
      '<button class="cc-x" type="button" id="ccClose" aria-label="' + esc(t('Close')) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="cc-canvas" id="ccCanvas">' +
      '<div class="cc-about" id="ccAbout" hidden></div>' +
      '<div class="cc-msgs" id="ccMsgs"></div>' +
      '<div class="cc-sugg" id="ccSugg"></div></div>' +
      '<div class="cc-composer"><div class="cc-box">' +
      '<textarea id="ccText" rows="1" placeholder="' + esc(t('Ask a question')) + '"></textarea>' +
      '<div class="cc-row"><button class="cc-send" id="ccSend" type="button" aria-label="' + esc(t('Send')) + '">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>' +
      '</button></div></div>' +
      '<div class="cc-note">' + esc(t('CalCar sees the page you are on')) + '</div></div>';

    document.body.append(fab, ov, panel);
    els = {
      fab: fab, ov: ov, panel: panel,
      msgs: panel.querySelector('#ccMsgs'), canvas: panel.querySelector('#ccCanvas'),
      sugg: panel.querySelector('#ccSugg'), about: panel.querySelector('#ccAbout'),
      sub: panel.querySelector('#ccSub'), text: panel.querySelector('#ccText'), send: panel.querySelector('#ccSend')
    };

    fab.addEventListener('click', function () { API.open(); });
    ov.addEventListener('click', API.close);
    panel.querySelector('#ccClose').addEventListener('click', API.close);
    els.send.addEventListener('click', function () { submit(); });
    els.text.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 140) + 'px'; });
    els.text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) API.close(); });

    try { hist = JSON.parse(sessionStorage.getItem(HIST_KEY) || '[]'); } catch (e) { hist = []; }
    hist.slice(-MAX_HIST).forEach(function (m) { msg(m.role === 'assistant' ? 'ai' : 'user', m.content); });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function msg(role, text) {
    var el = document.createElement('div');
    el.className = 'cc-msg ' + role;
    el.textContent = text;
    els.msgs.appendChild(el);
    els.canvas.scrollTop = els.canvas.scrollHeight;
    return el;
  }
  function suggestions(list) {
    els.sugg.innerHTML = '';
    if (hist.length || !list || !list.length) { els.sugg.style.display = 'none'; return; }
    els.sugg.style.display = 'flex';
    list.slice(0, 5).forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = q;
      b.onclick = function () { submit(q); };
      els.sugg.appendChild(b);
    });
  }

  function submit(forced) {
    var text = String(forced != null ? forced : els.text.value).trim();
    if (!text || sending) return;
    els.text.value = ''; els.text.style.height = 'auto';
    els.sugg.style.display = 'none';
    send(text);
  }

  async function send(text) {
    sending = true; els.send.disabled = true;
    hist.push({ role: 'user', content: text });
    msg('user', text);
    var typing = msg('typing', '');
    typing.innerHTML = '<i></i><i style="animation-delay:.2s"></i><i style="animation-delay:.4s"></i>';
    var ctx = (window.CalCarContext ? window.CalCarContext.get(pending && pending.context) : (pending && pending.context) || {});
    var product = window.CalCarContext ? window.CalCarContext.product() : 'check';
    if (pending && pending.context && pending.context.page_type) {
      var pt = String(pending.context.page_type);
      product = pt.indexOf('garage') === 0 ? 'garage' : pt.indexOf('import') === 0 ? 'import' : 'check';
    }
    try {
      var r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: product,
          messages: hist.slice(-12).map(function (m) { return { role: m.role, content: m.content }; }),
          context: ctx,
          lang: window.calcarLang ? window.calcarLang() : 'en'
        })
      });
      var data = await r.json().catch(function () { return {}; });
      typing.remove();
      if (!r.ok || !data.reply) throw new Error(t('Could not answer, try again'));
      hist.push({ role: 'assistant', content: data.reply });
      msg('ai', data.reply);
      try { sessionStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(-MAX_HIST))); } catch (e) {}
    } catch (e) {
      typing.remove();
      msg('ai', t('Could not answer, try again'));
    } finally {
      sending = false; els.send.disabled = false;
    }
  }

  var API = {
    open: function (opts) {
      boot();
      opts = opts || {};
      pending = opts;
      if (opts.intro) { els.about.hidden = false; els.about.innerHTML = '<b>' + esc(opts.intro.title || '') + '</b>' + esc(opts.intro.text || ''); }
      else els.about.hidden = true;
      els.sub.textContent = opts.subtitle || '';
      suggestions(opts.suggestions);
      els.panel.classList.add('open');
      els.ov.classList.add('open');
      els.fab.classList.add('hide');
      document.documentElement.style.overflow = window.innerWidth <= 760 ? 'hidden' : '';
      if (window.innerWidth > 560) setTimeout(function () { els.text.focus(); }, 60);
      els.canvas.scrollTop = els.canvas.scrollHeight;
    },
    close: function () {
      if (!booted) return;
      els.panel.classList.remove('open');
      els.ov.classList.remove('open');
      els.fab.classList.remove('hide');
      document.documentElement.style.overflow = '';
    },
    ask: function (text, opts) { API.open(opts); submit(text); },
    /* для тестів і сторінок: чи вже змонтований глобальний чат */
    mounted: function () { return booted; }
  };
  window.CalCarChat = API;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
