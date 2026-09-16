/* CalCar: канонічна хронологія "Історії авто" для показу.

   Рядки history пише модель, і порядок, і тривалість між подіями в них не
   гарантовані (бувало 05.2023 перед 04.2023, а "2 роки 8 місяців" стояло
   не між тими подіями). Тут код:
   1. розбирає дату з точністю (MM.YYYY або YYYY);
   2. сортує строго за зростанням; за однакової дати порядок стабільний:
      спершу менш точна дата (YYYY) перед місяцями того ж року, далі
      вихідний порядок; події без дати йдуть у кінці у вихідному порядку;
   3. ЛИШЕ після сортування рахує тривалість між сусідніми датованими
      подіями (текст моделі gap ігнорується);
   4. номер власника бере тільки зі структурованого owner_ordinal (реєстр,
      api/history-owners.js), а порядкові слова про власника з тексту
      моделі прибирає, щоб не було "третій власник" поруч із бейджем або
      без доказу. */
(function () {
  function parseDate(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var m = /^(?:\d{1,2}\.)?(\d{1,2})\.(\d{4})$/.exec(s);
    if (m) {
      var mo = parseInt(m[1], 10);
      if (mo >= 1 && mo <= 12) return { y: parseInt(m[2], 10), m: mo, precision: 'month' };
      return null;
    }
    m = /^(\d{4})$/.exec(s);
    if (m) return { y: parseInt(m[1], 10), m: null, precision: 'year' };
    return null;
  }

  function compare(a, b) {
    if (a.d && !b.d) return -1;
    if (!a.d && b.d) return 1;
    if (a.d && b.d) {
      if (a.d.y !== b.d.y) return a.d.y - b.d.y;
      /* YYYY без місяця стоїть перед місяцями того ж року */
      var am = a.d.m == null ? 0 : a.d.m, bm = b.d.m == null ? 0 : b.d.m;
      if (am !== bm) return am - bm;
    }
    return a.i - b.i;
  }

  /* тривалість між сусідніми датованими подіями в місяцях і точність */
  function gapBetween(prev, cur) {
    if (!prev || !cur) return null;
    if (prev.precision === 'month' && cur.precision === 'month') {
      var months = (cur.y - prev.y) * 12 + (cur.m - prev.m);
      return months > 0 ? { months: months, precision: 'month' } : null;
    }
    var years = cur.y - prev.y;
    return years > 0 ? { months: years * 12, precision: 'year' } : null;
  }

  var FORMS = {
    en: { year: { one: 'year', other: 'years' }, month: { one: 'month', other: 'months' } },
    ru: { year: { one: 'год', few: 'года', many: 'лет', other: 'года' }, month: { one: 'месяц', few: 'месяца', many: 'месяцев', other: 'месяца' } },
    uk: { year: { one: 'рік', few: 'роки', many: 'років', other: 'року' }, month: { one: 'місяць', few: 'місяці', many: 'місяців', other: 'місяця' } }
  };
  function langCode(lang) {
    var l = String(lang || 'en').toLowerCase();
    if (l === 'ua' || l === 'uk') return 'uk';
    return l === 'ru' ? 'ru' : 'en';
  }
  function unit(n, kind, lang) {
    var code = langCode(lang), forms = FORMS[code][kind], cat = 'other';
    try { cat = new Intl.PluralRules(code).select(n); } catch (e) { cat = n === 1 ? 'one' : 'other'; }
    return n + ' ' + (forms[cat] || forms.other);
  }
  function formatGap(gap, lang) {
    if (!gap || !(gap.months > 0)) return null;
    var y = Math.floor(gap.months / 12), mo = gap.months % 12, parts = [];
    if (y) parts.push(unit(y, 'year', lang));
    if (mo && gap.precision === 'month') parts.push(unit(mo, 'month', lang));
    return parts.join(' ') || null;
  }

  /* порядкове слово про власника як окреме уточнення: ", третій власник",
     "(3-й власник)", "; 2nd owner", "owner #3". "На нового власника" не чіпаємо */
  var L = 'a-zа-яіїєґёʼ\'’';
  var ORD = '(?:\\d{1,2}\\s*[-‑]?\\s*(?:й|я|ій|ий|ый|ой|го|st|nd|rd|th)?|перш[' + L + ']*|перв[' + L + ']*|друг[' + L + ']*|втор[' + L + ']*|трет[' + L + ']*|четверт[' + L + ']*|п[ʼ\'’]?ят[' + L + ']*|first|second|third|fourth|fifth)';
  var OWNER = '(?:власник[' + L + ']*|владел[' + L + ']*|owner)';
  var ORDINAL_CLAUSE = new RegExp('\\s*[,;:(]\\s*(?:' + ORD + '\\s+' + OWNER + '|' + OWNER + '\\s*(?:#|№)\\s*\\d{1,2})\\s*\\)?', 'gi');
  /* порядковий номер у самій фразі події: "to the second owner", "на третьего
     владельца", "на другого власника" -> "новий власник" без номера */
  var ORDINAL_PHRASES = [
    [new RegExp('\\bto\\s+(?:the|a|an)\\s+' + ORD + '\\s+owner\\b', 'gi'), 'to a new owner'],
    [new RegExp('(^|[^' + L + '])(на|к)\\s+' + ORD + '\\s+владельц[' + L + ']*', 'gi'), '$1$2 нового владельца'],
    [new RegExp('(^|[^' + L + '])(на|до)\\s+' + ORD + '\\s+власник[' + L + ']*', 'gi'), '$1$2 нового власника']
  ];
  function stripOwnerOrdinal(text) {
    var s = String(text == null ? '' : text);
    var out = s.replace(ORDINAL_CLAUSE, '');
    ORDINAL_PHRASES.forEach(function (p) { out = out.replace(p[0], p[1]); });
    out = out.replace(/\s{2,}/g, ' ').trim();
    return out || s;
  }

  /* history (як у звіті) -> [{ date, event, gap, owner_ordinal }] у канонічному порядку.
     ordinalSource: рядки, з яких брати owner_ordinal (оригінал до перекладу);
     береться лише при тій самій довжині і тих самих датах */
  function normalize(history, lang, ordinalSource) {
    var list = Array.isArray(history) ? history : [];
    var src = Array.isArray(ordinalSource) && ordinalSource.length === list.length ? ordinalSource : list;
    var items = list.map(function (h, i) {
      var row = h && typeof h === 'object' ? h : {};
      var o = src[i] && typeof src[i] === 'object' ? src[i] : {};
      var ord = (o.date === row.date && o.owner_ordinal_source === 'registry' && Number.isInteger(o.owner_ordinal) && o.owner_ordinal > 0) ? o.owner_ordinal : null;
      return { i: i, d: parseDate(row.date), date: row.date == null ? '' : String(row.date), event: stripOwnerOrdinal(row.event), owner_ordinal: ord };
    }).filter(function (x) { return x.event || x.date; });
    items.sort(compare);
    var prev = null;
    return items.map(function (x) {
      var gap = x.d ? formatGap(gapBetween(prev, x.d), lang) : null;
      if (x.d) prev = x.d;
      return { date: x.date, event: x.event, gap: gap, owner_ordinal: x.owner_ordinal };
    });
  }

  window.CalCarTimeline = { parseDate: parseDate, formatGap: formatGap, stripOwnerOrdinal: stripOwnerOrdinal, normalize: normalize };
})();
