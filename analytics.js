/* CalCar analytics: один тонкий шар подій для всіх сторінок.

   Архітектура:
   - PostHog: продуктові події, воронки, retention, шляхи, session replay.
   - GA4: залучення, UTM, реклама, нові/повернені користувачі.
   - Обидва вмикаються лише коли в calcar-public.js задано ключі. Без них
     цей файл працює "вхолосту": події складаються в буфер window.CALCAR_EVENTS
     (останні 50) і в мережу не йдуть. Деплой ключів не потребує.

   Ідентичність:
   - Анонімний відвідувач отримує один стабільний id на браузер
     (localStorage calcar_aid). Жодного fingerprinting: лише випадковий uuid,
     який людина може стерти разом із даними сайту. Між пристроями він не
     звʼязується, і ми цього не обіцяємо.
   - Після входу сторінка викликає calcar.identify(user_id): PostHog
     склеює анонімну історію з акаунтом (alias), GA4 отримує user_id.

   Приватність: у події НІКОЛИ не потрапляють текст чату, вміст памʼяті,
   опис продавця, приватні поля форм, платіжні дані. Санітайзер пропускає
   лише короткі примітивні значення з дозволених ключів. Session replay
   маскує всі поля вводу і повністю блокує панель помічника, редактор
   памʼяті та поля входу.

   Таксономія (мінімум для beta):
     landing_view, analysis_started, analysis_completed, report_viewed,
     report_shared, assistant_opened, memory_opened, memory_saved,
     deep_check_clicked.
   Другий/третій Check визначаються в PostHog як "analysis_started виконано
   N разів" (властивість людини checks_started дублює це для зручності). */
(function () {
  var PUB = (window.CALCAR_PUBLIC && window.CALCAR_PUBLIC.analytics) || {};
  var AID_KEY = 'calcar_aid', UTM_KEY = 'calcar_utm', UID_KEY = 'calcar_uid';
  var EVENTS = ['landing_view', 'analysis_started', 'analysis_completed', 'report_viewed', 'report_shared',
    'assistant_opened', 'memory_opened', 'memory_saved', 'deep_check_clicked'];
  /* ключі, які можуть нести приватний текст: відкидаються завжди */
  var DENY = /text|message|memory|description|seller|prompt|content|email|phone|token|password|card|payment|query|url|title|note/i;
  var ALLOW_URL_KEYS = /^(page|product)$/;

  function ls(get, k, v) { try { return get ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256 | 0; });
    a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128;
    var h = [].slice.call(a).map(function (b) { return (b + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  /* один стабільний анонімний id на браузер */
  function aid() {
    var v = ls(true, AID_KEY);
    if (!v || !/^[0-9a-f-]{36}$/.test(v)) { v = uuid(); ls(false, AID_KEY, v); }
    return v;
  }
  /* перше торкання: utm і реферер запамʼятовуються один раз на браузер */
  function firstTouch() {
    var saved = null;
    try { saved = JSON.parse(ls(true, UTM_KEY) || 'null'); } catch (e) {}
    if (saved) return saved;
    var q = {}, sp;
    try { sp = new URLSearchParams(location.search); } catch (e) { sp = null; }
    if (sp) ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'].forEach(function (k) { var v = sp.get(k); if (v) q[k] = String(v).slice(0, 80); });
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    var out = { source: q.utm_source || (ref && ref !== location.hostname ? ref : 'direct'), medium: q.utm_medium || null, campaign: q.utm_campaign || null, ref: ref || null, at: new Date().toISOString() };
    if (q.gclid) out.gclid = true;
    if (q.fbclid) out.fbclid = true;
    ls(false, UTM_KEY, JSON.stringify(out));
    return out;
  }
  function product() {
    var p = location.pathname;
    if (/^\/(check|check\.html|result-check\.html)?$|^\/check\//.test(p) || p === '/') return 'check';
    if (/^\/import|result\.html/.test(p)) return 'import';
    if (/^\/garage/.test(p)) return 'garage';
    if (/cabinet/.test(p)) return 'cabinet';
    return 'other';
  }
  function page() {
    /* адреса без токенів звітів і ідентифікаторів: шлях сторінки, не звіту */
    var p = location.pathname.replace(/\/check\/r\/[^/]+\/[A-Za-z0-9_-]+$/, '/check/r/*').replace(/\/check\/[A-Z0-9]{4,12}$/, '/check/*').replace(/\/garage\/.+$/, '/garage/*');
    return p.replace(/\.html$/, '') || '/';
  }
  /* санітайзер: лише дозволені короткі примітиви, жодного приватного тексту */
  function clean(props) {
    var out = {};
    if (!props || typeof props !== 'object') return out;
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (DENY.test(k) && !ALLOW_URL_KEYS.test(k)) return;
      if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; return; }
      if (typeof v === 'string') { if (v.length <= 80 && !/\s{2,}|\n/.test(v)) out[k] = v; return; }
    });
    return out;
  }

  var ph = null, ga = false, ready = { ph: false, ga: false };
  var buffer = [];
  window.CALCAR_EVENTS = buffer;

  function base() {
    var ft = firstTouch();
    return { page: page(), product: product(), lang: (window.calcarLang ? window.calcarLang() : 'en'), signed_in: !!window.CALCAR_SIGNED_IN, acq_source: ft.source, acq_medium: ft.medium, acq_campaign: ft.campaign };
  }
  function track(name, props) {
    if (EVENTS.indexOf(name) < 0) { try { console.warn('[calcar-analytics] unknown event', name); } catch (e) {} return false; }
    var p = Object.assign(base(), clean(props));
    var ev = { name: name, props: p, at: Date.now() };
    buffer.push(ev); if (buffer.length > 50) buffer.shift();
    try { document.dispatchEvent(new CustomEvent('calcar-analytics', { detail: ev })); } catch (e) {}
    if (ph) { try { ph.capture(name, p); } catch (e) {} }
    if (ga) { try { window.gtag('event', name, p); } catch (e) {} }
    return true;
  }
  function identify(userId) {
    if (!userId || typeof userId !== 'string') return;
    var prev = ls(true, UID_KEY);
    ls(false, UID_KEY, userId);
    if (ph) { try { ph.identify(userId); } catch (e) {} }
    if (ga) { try { window.gtag('config', PUB.ga4_id, { user_id: userId }); } catch (e) {} }
    if (prev !== userId) buffer.push({ name: '$identify', props: { signed_in: true }, at: Date.now() });
  }
  function setPerson(props) {
    var p = clean(props);
    if (ph) { try { ph.people && ph.people.set ? ph.people.set(p) : ph.capture('$set', { $set: p }); } catch (e) {} }
    if (ga) { try { window.gtag('set', 'user_properties', p); } catch (e) {} }
  }

  /* ---------- PostHog ---------- */
  function loadPostHog() {
    if (!PUB.posthog_key || !/^phc_/.test(PUB.posthog_key)) return;
    var host = PUB.posthog_host || 'https://eu.i.posthog.com';
    /* офіційний сніпет: черга викликів до завантаження бібліотеки */
    !function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split('.'); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } } (p = t.createElement('script')).type = 'text/javascript', p.crossOrigin = 'anonymous', p.async = !0, p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js', (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = 'posthog', u.people = u.people || [], u.toString = function (t) { var e = 'posthog'; return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e }, u.people.toString = function () { return u.toString(1) + '.people (stub)' }, o = 'init capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId'.split(' '), n = 0; n < o.length; n++) g(u, o[n]); e._i.push([i, s, a]) }, e.__SV = 1) }(document, window.posthog || []);
    window.posthog.init(PUB.posthog_key, {
      api_host: host,
      persistence: 'localStorage+cookie',
      /* анонімний distinct_id це наш стабільний calcar_aid */
      bootstrap: { distinctID: aid() },
      capture_pageview: true,
      capture_pageleave: true,
      /* autocapture вимкнено: він тягне текст полів і кнопок, нам потрібні лише наші події */
      autocapture: false,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-private], .cc-panel, .cc-msg, #memView, #memText, .mem-view',
        blockSelector: '.cc-panel, #memCard, #authBox, [data-private-block]',
      },
      loaded: function (inst) { ph = inst; ready.ph = true; var uid = ls(true, UID_KEY); if (uid) { try { inst.identify(uid); } catch (e) {} } },
    });
    ph = window.posthog;
  }
  /* ---------- GA4 ---------- */
  function loadGA() {
    if (!PUB.ga4_id || !/^G-[A-Z0-9]+$/.test(PUB.ga4_id)) return;
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + PUB.ga4_id;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    var cfg = { send_page_view: true };
    var uid = ls(true, UID_KEY); if (uid) cfg.user_id = uid;
    window.gtag('config', PUB.ga4_id, cfg);
    ga = true;
  }

  /* ---------- автоматичні події ---------- */
  function autoEvents() {
    var p = location.pathname.replace(/\.html$/, '');
    if (p === '/' || p === '/check' || p === '/import') track('landing_view', { product: product() });
    /* помічник відкрився: chat.js повідомляє подією стану, лічимо лише відкриття */
    document.addEventListener('calcar-chat-state', function (e) { if (e.detail && e.detail.open) track('assistant_opened', {}); });
    /* контекстні кнопки: data-track="deep_check_clicked" достатньо */
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
      if (!el) return;
      var name = el.getAttribute('data-track');
      if (EVENTS.indexOf(name) > -1) track(name, {});
    });
  }

  aid(); firstTouch();
  loadPostHog(); loadGA();
  window.calcar = { track: track, identify: identify, setPerson: setPerson, aid: aid, acquisition: firstTouch, events: EVENTS, enabled: function () { return { posthog: !!PUB.posthog_key, ga4: !!PUB.ga4_id }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoEvents); else autoEvents();
})();
