/* CalCar analytics: один тонкий шар подій для всіх сторінок.

   Архітектура:
   - PostHog: лише кастомні продуктові події (воронки, retention). Session
     replay, autocapture, pageview, heatmaps і web vitals вимкнені.
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
   лише короткі примітивні значення з дозволених ключів. Адресу сторінки,
   яку PostHog додає сам, before_send зводить до шляху без токенів і query.

   Таксономія beta (лише ці події, кліки поодинці не трекаються):
     check_started (check_number), check_completed (раз на job),
     report_viewed (раз на перегляд готового звіту),
     report_active_30s/60s/180s (накопичений ВИДИМИЙ час),
     report_scroll_25/50/75/100 (кожен поріг раз),
     seller_description_opened, share_clicked, calcar_ai_clicked,
     feedback_yes, feedback_no, feedback_submitted (useful + reason, без тексту),
     chat_opened, chat_message_sent, settings_opened, memory_opened, memory_updated,
     report_email_opted_in, report_opened_from_email (з браузера),
     report_email_sent (із сервера після відправки листа; без адреси).
   Номер перевірки: лічильник браузера calcar_checks_n (стартує не нижче
   кількості вже збережених локальних перевірок), плюс властивість людини
   checks_started; після входу identify склеює анонімну історію з акаунтом. */
(function () {
  var PUB = (window.CALCAR_PUBLIC && window.CALCAR_PUBLIC.analytics) || {};
  var AID_KEY = 'calcar_aid', UTM_KEY = 'calcar_utm', UID_KEY = 'calcar_uid';
  var EVENTS = ['check_started', 'check_completed', 'report_viewed',
    'report_active_30s', 'report_active_60s', 'report_active_180s',
    'report_scroll_25', 'report_scroll_50', 'report_scroll_75', 'report_scroll_100',
    'seller_description_opened', 'share_clicked', 'calcar_ai_clicked',
    'feedback_yes', 'feedback_no', 'feedback_submitted',
    /* якими функціями користуються: лише факт дії, без тексту чату і памʼяті */
    'chat_opened', 'chat_message_sent', 'settings_opened', 'memory_opened', 'memory_updated',
    /* лист "звіт готовий": лише факт, адреса у властивості не потрапляє.
       report_email_sent надсилає сервер (api/check-email.js) */
    'report_email_opted_in', 'report_opened_from_email'];
  var CHECKS_N_KEY = 'calcar_checks_n', DONE_KEY = 'calcar_done_checks';
  /* ключі, які можуть нести приватний текст: відкидаються завжди */
  var DENY = /text|message|memory|description|seller|prompt|content|email|phone|token|password|card|payment|query|url|title|note|vin|plate/i;
  /* значення, схожі на VIN чи email, відкидаються під будь-яким ключем */
  var DENY_VALUE = /\b[A-HJ-NPR-Z0-9]{17}\b|[^\s@]+@[^\s@]+\.[^\s@]+/i;
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
      if (typeof v === 'string') { if (v.length <= 80 && !/\s{2,}|\n/.test(v) && !DENY_VALUE.test(v)) out[k] = v; return; }
    });
    return out;
  }

  var ph = null, ga = false, ready = { ph: false, ga: false };
  var buffer = [];
  window.CALCAR_EVENTS = buffer;

  function base() {
    var ft = firstTouch();
    return { page: page(), product: product(), locale: (window.calcarLang ? window.calcarLang() : 'en'), authenticated: !!window.CALCAR_SIGNED_IN, acq_source: ft.source, acq_medium: ft.medium, acq_campaign: ft.campaign };
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
  var URL_PROPS = ['$current_url', '$initial_current_url', '$session_entry_url'];
  var PATH_PROPS = ['$pathname', '$initial_pathname', '$session_entry_pathname'];
  var REF_PROPS = ['$referrer', '$initial_referrer', '$session_entry_referrer'];
  function scrubProps(o) {
    if (!o || typeof o !== 'object') return;
    URL_PROPS.forEach(function (k) { if (k in o) o[k] = location.origin + page(); });
    PATH_PROPS.forEach(function (k) { if (k in o) o[k] = page(); });
    REF_PROPS.forEach(function (k) { if (k in o && o[k] && o[k] !== '$direct') { try { o[k] = new URL(o[k]).origin; } catch (e) { o[k] = null; } } });
  }
  function scrub(ev) {
    if (!ev) return ev;
    scrubProps(ev.properties);
    scrubProps(ev.$set);
    scrubProps(ev.$set_once);
    if (ev.properties) { scrubProps(ev.properties.$set); scrubProps(ev.properties.$set_once); }
    return ev;
  }
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
      /* лише наші кастомні події: без $pageview/$pageleave (адреса звіту несе токен),
         без autocapture (тягне текст кнопок і полів), без replay, heatmaps,
         web vitals, dead/rage clicks, винятків і опитувань */
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      rageclick: false,
      disable_session_recording: true,
      capture_heatmaps: false,
      enable_heatmaps: false,
      capture_performance: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_surveys: true,
      disable_web_experiments: true,
      advanced_disable_feature_flags: true,
      /* жодних догружених модулів (recorder, web-vitals, surveys, toolbar) */
      disable_external_dependency_loading: true,
      person_profiles: 'always',
      /* страховка, якщо replay колись увімкнуть: поля і приватні панелі закриті */
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-private], .cc-panel, .cc-msg, #memView, #memText, .mem-view',
        blockSelector: '.cc-panel, #memCard, #authBox, [data-private-block]',
      },
      /* SDK сам додає адресу і реферер до кожної події: залишаємо лише
         знеособлений шлях сторінки і хост реферера, без query і токенів */
      before_send: scrub,
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

  /* ---------- номер перевірки і завершення ---------- */
  /* наступний номер Check цього браузера: не нижче seed (кількість уже
     збережених локальних перевірок + 1), далі лише зростає */
  function nextCheckNumber(seed) {
    var n = parseInt(ls(true, CHECKS_N_KEY), 10);
    if (!(n >= 0)) n = 0;
    n = Math.max(n + 1, seed > 0 ? Math.floor(seed) : 1);
    ls(false, CHECKS_N_KEY, String(n));
    return n;
  }
  /* check_completed рівно раз на job: ключ це токен job (або інший стабільний ref) */
  function checkCompleted(ref, props) {
    if (!ref) return false;
    var done = [];
    try { done = JSON.parse(ls(true, DONE_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(done)) done = [];
    var key = String(ref).slice(0, 80);
    if (done.indexOf(key) > -1) return false;
    done.push(key); ls(false, DONE_KEY, JSON.stringify(done.slice(-50)));
    return track('check_completed', props);
  }
  function bucketSec(ms) {
    var s = ms / 1000;
    return s < 60 ? '<60s' : s < 120 ? '60-120s' : s < 180 ? '120-180s' : s < 300 ? '180-300s' : '300s+';
  }
  function scoreBucket(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 'none';
    var f = Math.max(0, Math.min(9, Math.floor(v)));
    return f + '-' + (f + 1);
  }

  /* ---------- активний час і глибина прокрутки звіту ----------
     Час рахується лише поки вкладка видима (document.visibilityState),
     у фоні таймер стоїть. Кожен поріг раз на перегляд звіту. */
  var ACTIVE_STEPS = [30, 60, 180], SCROLL_STEPS = [25, 50, 75, 100];
  function makeActiveTimer(fire, now) {
    now = now || function () { return Date.now(); };
    var acc = 0, since = null, sent = {};
    function check() {
      var total = acc + (since !== null ? now() - since : 0);
      ACTIVE_STEPS.forEach(function (sec) { if (!sent[sec] && total >= sec * 1000) { sent[sec] = true; fire('report_active_' + sec + 's'); } });
      return total;
    }
    return {
      visible: function (on) {
        if (on && since === null) since = now();
        else if (!on && since !== null) { acc += now() - since; since = null; }
        check();
      },
      tick: check,
      done: function () { return ACTIVE_STEPS.every(function (sec) { return sent[sec]; }); },
    };
  }
  function makeScrollDepth(fire) {
    var sent = {};
    return function (pct) {
      SCROLL_STEPS.forEach(function (st) { if (!sent[st] && pct >= (st === 100 ? 98 : st)) { sent[st] = true; fire('report_scroll_' + st); } });
    };
  }
  /* report_viewed лише коли готовий звіт справді видимий; потім таймер і прокрутка */
  var viewed = false;
  function reportViewed(props, endEl) {
    if (viewed) return;
    var base = clean(props);
    function start() {
      if (viewed || document.visibilityState === 'hidden') return;
      viewed = true;
      document.removeEventListener('visibilitychange', start);
      track('report_viewed', base);
      var fire = function (n) { track(n, { product: base.product }); };
      var timer = makeActiveTimer(fire);
      timer.visible(true);
      var iv = setInterval(function () { timer.tick(); if (timer.done()) clearInterval(iv); }, 1000);
      document.addEventListener('visibilitychange', function () { timer.visible(document.visibilityState !== 'hidden'); });
      var depth = makeScrollDepth(fire), pend = false;
      function measure() {
        pend = false;
        var el = endEl || document.documentElement;
        var r = el.getBoundingClientRect(), h = r.height || 1;
        depth(Math.round((window.innerHeight - r.top) / h * 100));
      }
      /* не на кожну подію прокрутки: вимір не частіше ніж раз на 200 мс */
      window.addEventListener('scroll', function () { if (!pend) { pend = true; setTimeout(measure, 200); } }, { passive: true });
    }
    start();
    if (!viewed) document.addEventListener('visibilitychange', start);
  }

  /* ---------- автоматичні події ---------- */
  function autoEvents() {
    /* CalCar AI: кнопка шапки і CTA висновку звіту; лічимо клік, не текст */
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('#aiBtn, #pdChatBtn') : null;
      if (el) track('calcar_ai_clicked', { placement: el.id === 'pdChatBtn' ? 'report_conclusion' : 'header' });
    });
  }

  aid(); firstTouch();
  loadPostHog(); loadGA();
  window.calcar = { track: track, identify: identify, setPerson: setPerson, aid: aid, acquisition: firstTouch, events: EVENTS,
    nextCheckNumber: nextCheckNumber, checkCompleted: checkCompleted, reportViewed: reportViewed, bucketSec: bucketSec, scoreBucket: scoreBucket,
    _activeTimer: makeActiveTimer, _scrollDepth: makeScrollDepth,
    enabled: function () { return { posthog: !!PUB.posthog_key, ga4: !!PUB.ga4_id }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoEvents); else autoEvents();
})();
