/* CalCar page context: спільний інтерфейс, через який будь-яка сторінка
   розповідає помічнику, що людина зараз бачить.

   Сторінка реєструє постачальника: CalCarContext.register(function(){ ... }),
   а споживач (чат) бере готовий конверт: CalCarContext.get().

   Навіщо окремий шар: помічнику не можна віддавати сиру сторінку. Тут лежить
   рівно те, що людина бачить, у зрозумілих полях, і нічого зайвого.

   Конверт: locale, route, page_type, entity (type/id), vehicle, report_id,
   post_id, section, facts. Порожні поля не їдуть.

   page_type: check_landing | check_report | import_landing | import_report |
              garage_feed | garage_vehicle | cabinet */
(function () {
  var providers = [];
  /* Чорний список: у конверт ніколи не потрапляють ключі, схожі на секрет.
     Сторінка може помилитись і покласти зайве, тут це відсікається. */
  var SECRET = /(pass|token|secret|key|auth|session|cookie|jwt|anon|bearer|credential)/i;
  var MAX_STR = 1200;

  function clean(v, depth) {
    if (v == null) return undefined;
    if (typeof v === 'string') { var s = v.trim(); return s ? s.slice(0, MAX_STR) : undefined; }
    if (typeof v === 'number') return isFinite(v) ? v : undefined;
    if (typeof v === 'boolean') return v;
    if (depth >= 4) return undefined;
    if (Array.isArray(v)) {
      var arr = v.slice(0, 24).map(function (x) { return clean(x, depth + 1); }).filter(function (x) { return x !== undefined; });
      return arr.length ? arr : undefined;
    }
    if (typeof v !== 'object') return undefined;
    var out = {}, n = 0;
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      if (SECRET.test(k)) continue;
      var c = clean(v[k], depth + 1);
      if (c !== undefined) { out[k] = c; n++; }
      if (n >= 40) break;
    }
    return n ? out : undefined;
  }

  var API = {
    /* провайдер повертає частину конверта; останній зареєстрований головніший */
    register: function (fn) { if (typeof fn === 'function') providers.push(fn); return API; },
    get: function (extra) {
      var env = {
        locale: (window.calcarLang && window.calcarLang()) || 'en',
        route: location.pathname.replace(/\/+$/, '') || '/'
      };
      for (var i = 0; i < providers.length; i++) {
        var part;
        try { part = providers[i](); } catch (e) { part = null; }
        if (part && typeof part === 'object') for (var k in part) if (part[k] !== undefined && part[k] !== null) env[k] = part[k];
      }
      if (extra && typeof extra === 'object') for (var j in extra) if (extra[j] !== undefined && extra[j] !== null) env[j] = extra[j];
      return clean(env, 0) || { locale: env.locale, route: env.route };
    },
    /* який продукт обслуговує розмову: від нього залежить предметна область моделі */
    product: function () {
      var p = (API.get() || {}).page_type || '';
      if (p.indexOf('garage') === 0) return 'garage';
      if (p.indexOf('import') === 0) return 'import';
      return 'check';
    }
  };
  window.CalCarContext = API;
})();
