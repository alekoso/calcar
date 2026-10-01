/* CalCar: графік вартості авто для звіту Check.

   Формули тут НЕМА. Якорі і точки кривої (кожні 6 місяців, від нового авто
   через сьогодні і ще на 5 років) рахує api/value.js і кладе в
   _meta.value_curve. Цей файл лише малює їх у SVG і дає взаємодію:
   наведення мишею, дотик і рух пальцем, стрілки клавіатури; вибір завжди
   прилипає до найближчої піврічної точки. Лінія до "сьогодні" суцільна,
   прогноз пунктирний, математично це одна крива. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function group(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); }

  /* повна сума: "$23 600"; інша валюта кодом після числа */
  function money(n, currency) {
    var s = group(n);
    if (currency === 'USD') return '$' + s;
    if (currency === 'EUR') return '€' + s;
    return s + '\u00a0' + (currency || '');
  }
  /* приблизні значення не вдають точність до долара */
  function roundApprox(n) {
    var step = n >= 20000 ? 1000 : n >= 5000 ? 500 : 100;
    return Math.round(n / step) * step;
  }
  function roundPoint(n) {
    var step = n >= 10000 ? 100 : 50;
    return Math.round(n / step) * step;
  }
  /* підпис осі: "$20k", "$1.5M" */
  function axisMoney(n, currency) {
    var sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
    var s;
    if (n >= 1000000) s = (Math.round(n / 100000) / 10) + 'M';
    else if (n >= 1000) s = (Math.round(n / 100) / 10) + 'k';
    else s = String(Math.round(n));
    return sym + s;
  }

  /* Вісь Y завжди від нуля: авто, що тримає ціну, мусить і виглядати так,
     а обрізана знизу шкала робить скромне знецінення драматичним. Зайву
     порожнечу прибирає ВЕРХНЯ межа: найменша "гарна" стеля над найбільшим
     видимим значенням із запасом 5%, з прийнятною кількістю поділок */
  var NICE = [1, 2, 2.5, 5];
  function yScale(maxValue, maxIntervals) {
    var need = maxValue * 1.05, maxI = maxIntervals || 7, minI = Math.min(3, maxI);
    var pow = Math.pow(10, Math.floor(Math.log(need) / Math.LN10) - 1);
    var best = null;
    for (var e = 0; e < 3; e++) {
      for (var i = 0; i < NICE.length; i++) {
        var step = NICE[i] * pow * Math.pow(10, e);
        var n = Math.ceil(need / step - 1e-9);
        if (n < minI || n > maxI) continue;
        var top = n * step;
        if (!best || top < best.top - 1e-6 || (Math.abs(top - best.top) < 1e-6 && n < best.n)) best = { top: top, step: step, n: n };
      }
    }
    if (!best) best = { top: need, step: need / minI, n: minI };
    var ticks = [];
    for (var k = 0; k <= best.n; k++) ticks.push(Math.round(k * best.step));
    return { top: best.top, step: best.step, ticks: ticks };
  }

  /* Підписи років відраховуються від КІНЦЯ прогнозу: останній рік прогнозу
     завжди підписаний на правому краю, і графік не тягнеться далі за
     останній підпис. Крок 1, 2, 5 або 10 років за доступною шириною */
  function xTicks(tMax, endMs, maxLabels) {
    var endYear = new Date(endMs).getUTCFullYear();
    var steps = [1, 2, 5, 10, 20], step = 20;
    for (var i = 0; i < steps.length; i++) if (Math.floor(tMax / steps[i]) + 1 <= Math.max(2, maxLabels)) { step = steps[i]; break; }
    var out = [];
    for (var back = 0; back <= tMax + 1e-9; back += step) out.unshift({ t: tMax - back, year: endYear - back });
    return out;
  }

  function pointMs(p) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(p.date || ''));
    return m ? Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1) : null;
  }
  function monthLabel(p, locale) {
    var ms = pointMs(p);
    if (ms === null) return '';
    var s;
    try { s = new Intl.DateTimeFormat(locale || 'en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms)); }
    catch (e) { s = p.date; }
    s = s.replace(/\s*(г\.|р\.)$/, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* монотонна кубічна інтерполяція (Fritsch-Carlson): гладка лінія через
     піврічні точки без викидів і без зламу на "сьогодні" */
  function tangents(xs, ys) {
    var n = xs.length, d = [], m = [], i;
    for (i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / ((xs[i + 1] - xs[i]) || 1e-9));
    m.push(d[0]);
    for (i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { var tau = 3 / Math.sqrt(h); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
    }
    return m;
  }
  function pathThrough(xs, ys, m, from, to) {
    var r = function (v) { return Math.round(v * 100) / 100; };
    var s = 'M' + r(xs[from]) + ' ' + r(ys[from]);
    for (var i = from; i < to; i++) {
      var h = (xs[i + 1] - xs[i]) / 3;
      s += 'C' + r(xs[i] + h) + ' ' + r(ys[i] + m[i] * h) + ' ' + r(xs[i + 1] - h) + ' ' + r(ys[i + 1] - m[i + 1] * h) + ' ' + r(xs[i + 1]) + ' ' + r(ys[i + 1]);
    }
    return s;
  }

  /* чи придатні збережені дані до малювання: жодних NaN у розмітці */
  function usable(vc) {
    if (!vc || vc.status !== 'ok' || !Array.isArray(vc.points) || vc.points.length < 3) return false;
    for (var i = 0; i < vc.points.length; i++) {
      var p = vc.points[i];
      if (!p || typeof p.t !== 'number' || !isFinite(p.t) || typeof p.value !== 'number' || !isFinite(p.value) || p.value <= 0) return false;
      if (i && p.t <= vc.points[i - 1].t) return false;
    }
    return !!(vc.current && isFinite(vc.current.value) && vc.new_price && isFinite(vc.new_price.value));
  }

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  /* геометрія окремо від DOM: її перевіряє тест */
  function layout(vc, width, height) {
    var pts = vc.points, n = pts.length;
    var narrow = width < 480;
    var pad = { l: narrow ? 44 : 52, r: 20, t: 30, b: 28 };
    var iw = Math.max(40, width - pad.l - pad.r), ih = Math.max(40, height - pad.t - pad.b);
    var tMax = pts[n - 1].t;
    /* друга ціна (оголошення чи середня площадки) живе лише у стовпчику
       чисел праворуч; на графіку і в шкалі її немає */
    var maxV = Math.max(vc.new_price.value, vc.current.value);
    for (var i = 0; i < n; i++) if (pts[i].value > maxV) maxV = pts[i].value;
    var ys = yScale(maxV, narrow ? 5 : 7);
    var X = function (t) { return pad.l + (t / tMax) * iw; };
    var Y = function (v) { return pad.t + ih - (v / ys.top) * ih; };
    var todayIdx = 0;
    for (i = 0; i < n; i++) if (!pts[i].forecast) todayIdx = i;
    return { pad: pad, iw: iw, ih: ih, tMax: tMax, ys: ys, X: X, Y: Y, todayIdx: todayIdx, narrow: narrow,
      px: pts.map(function (p) { return X(p.t); }), py: pts.map(function (p) { return Y(p.value); }) };
  }

  function nearestIndex(px, x) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < px.length; i++) { var d = Math.abs(px[i] - x); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  function render(host, vc, opts) {
    opts = opts || {};
    var t = opts.t || function (s) { return s; };
    var locale = opts.locale || 'en';
    if (!host) return false;
    if (!usable(vc)) { host.innerHTML = ''; host.hidden = true; return false; }
    host.hidden = false;
    var cur = vc.market && vc.market.currency;
    var pts = vc.points;
    var isAvg = vc.current.source === 'marketplace_average';
    /* до сотні; для шестизначних сум до тисячі */
    var r100 = function (n) { var step = n >= 100000 ? 1000 : 100; return Math.round(n / step) * step; };
    /* Головні числа без знака приблизності: невизначеність каже підпис
       ("Оцінка новою", "Прогноз через 5 років"). Розрахункові значення
       округлені; ціна оголошення це реальне число і лишається точною */
    var newTxt = money(vc.new_price.approx ? roundApprox(vc.new_price.value) : vc.new_price.value, cur);
    var curTxt = money(isAvg ? r100(vc.current.value) : vc.current.value, cur);
    var futTxt = money(r100(vc.future.value), cur);
    var item = function (value, label, cls) {
      return '<div class="vc-kpi' + (cls ? ' ' + cls : '') + '"><span class="vc-num">' + esc(value) + '</span><span class="vc-lbl">' + esc(label) + '</span></div>';
    };
    /* праворуч від графіка: нова, сьогодні, через 5 років; нижче тихіше
       друга ціна як контекст (середня площадки або ціна оголошення) */
    var rail = item(newTxt, t(vc.new_price.approx ? 'Estimated when new' : 'When new'))
      + item(curTxt, t('Estimated today'), 'now')
      + item(futTxt, t('Forecast in 5 years'));
    if (vc.listing) {
      /* якір це середня площадки: ціна оголошення лишається довідковою */
      rail += item(money(vc.listing.value, cur), t('Listing price'), 'ctx');
    } else if (vc.average && typeof vc.average.value === 'number' && isFinite(vc.average.value)) {
      /* якір це ціна оголошення: середня площадки лишається контекстом */
      rail += item(money(r100(vc.average.value), cur), vc.average.source_name ? t('{name} average').replace('{name}', vc.average.source_name) : t('Marketplace average'), 'ctx');
    }
    host.innerHTML = '<div class="vc-body"><div class="vc-plot" tabindex="0" role="group" aria-label="' + esc(t('Value over time')) + '"><div class="vc-tip" hidden></div></div>'
      + '<div class="vc-rail">' + rail + '</div></div>';
    var plot = host.querySelector('.vc-plot');
    var tip = host.querySelector('.vc-tip');
    var active = -1;
    var svg = null, L = null, cross = null, dot = null;

    function draw() {
      /* картка ще не видима (звіт під скелетоном): ширини немає, малювати
         нема за чим; ResizeObserver намалює, щойно вона зʼявиться */
      var width = Math.round(plot.clientWidth || 0);
      if (width < 120) return;
      var height = width < 480 ? 220 : 300;
      if (svg) plot.removeChild(svg);
      L = layout(vc, width, height);
      svg = el('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, 'class': 'vc-svg', 'aria-hidden': 'true' });
      var base = L.pad.t + L.ih, i;
      /* сітка і підписи осі Y */
      for (i = 0; i < L.ys.ticks.length; i++) {
        var v = L.ys.ticks[i], y = L.Y(v);
        svg.appendChild(el('line', { x1: L.pad.l, x2: L.pad.l + L.iw, y1: y, y2: y, 'class': v === 0 ? 'vc-axis' : 'vc-grid' }));
        svg.appendChild(el('text', { x: L.pad.l - 8, y: y + 4, 'text-anchor': 'end', 'class': 'vc-tick' }, axisMoney(v, cur)));
      }
      /* підписи років: від кінця прогнозу назад */
      var startMs = pointMs(pts[0]), nowMs = pointMs(pts[L.todayIdx]);
      if (startMs !== null && nowMs !== null) {
        var endMs = pointMs(pts[pts.length - 1]);
        var xt = xTicks(L.tMax, endMs === null ? nowMs : endMs, Math.floor(L.iw / 56));
        var lastX = -Infinity;
        for (i = 0; i < xt.length; i++) {
          var x = L.X(xt[i].t);
          /* підпис біля лівого краю не налазить на наступний */
          if (x - lastX < 40) continue;
          lastX = x;
          var edgeL = x < L.pad.l + 14, edgeR = x > L.pad.l + L.iw - 14;
          svg.appendChild(el('line', { x1: x, x2: x, y1: base, y2: base + 4, 'class': 'vc-axis' }));
          svg.appendChild(el('text', { x: x, y: base + 18, 'text-anchor': edgeR ? 'end' : edgeL ? 'start' : 'middle', 'class': 'vc-tick' }, String(xt[i].year)));
        }
      }
      var m = tangents(L.px, L.py), last = pts.length - 1, ti = L.todayIdx;
      var solid = pathThrough(L.px, L.py, m, 0, ti);
      svg.appendChild(el('path', { d: solid + 'L' + L.px[ti] + ' ' + base + 'L' + L.px[0] + ' ' + base + 'Z', 'class': 'vc-area' }));
      svg.appendChild(el('line', { x1: L.px[ti], x2: L.px[ti], y1: L.pad.t - 6, y2: base, 'class': 'vc-now' }));
      /* ліворуч від лінії розрахована історія, праворуч прогноз */
      var nearR = L.px[ti] > L.pad.l + L.iw - 40, nearL = L.px[ti] < L.pad.l + 40;
      svg.appendChild(el('text', { x: L.px[ti] + (nearR ? -6 : nearL ? 6 : 0), y: L.pad.t - 12, 'text-anchor': nearR ? 'end' : nearL ? 'start' : 'middle', 'class': 'vc-now-lbl' }, t('Today')));
      svg.appendChild(el('path', { d: solid, 'class': 'vc-line' }));
      svg.appendChild(el('path', { d: pathThrough(L.px, L.py, m, ti, last), 'class': 'vc-line vc-forecast' }));
      svg.appendChild(el('circle', { cx: L.px[0], cy: L.py[0], r: 4, 'class': 'vc-end' }));
      svg.appendChild(el('circle', { cx: L.px[last], cy: L.py[last], r: 4, 'class': 'vc-end vc-end-f' }));
      /* на лінії "сьогодні" одна позначка: якір кривої */
      svg.appendChild(el('circle', { cx: L.px[ti], cy: L.py[ti], r: 5.5, 'class': 'vc-today' }));
      cross = el('line', { x1: 0, x2: 0, y1: L.pad.t, y2: base, 'class': 'vc-cross', visibility: 'hidden' });
      dot = el('circle', { cx: 0, cy: 0, r: 5, 'class': 'vc-active', visibility: 'hidden' });
      svg.appendChild(cross); svg.appendChild(dot);
      plot.insertBefore(svg, tip);
      if (active >= 0) select(active);
    }

    function select(i) {
      if (!L) return;
      active = Math.max(0, Math.min(pts.length - 1, i));
      var p = pts[active], x = L.px[active], y = L.py[active];
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
      var exact = active === L.todayIdx || (active === 0 && !vc.new_price.approx);
      var val = money(exact ? p.value : roundPoint(p.value), cur);
      var label = active === 0 ? t('When new') : active === L.todayIdx ? t('Estimated today') : p.forecast ? t('Forecast') : '';
      tip.innerHTML = '<span class="vc-tip-d">' + esc(monthLabel(p, locale)) + '</span><b>' + esc(val) + '</b>' + (label ? '<span class="vc-tip-f">' + esc(label) + '</span>' : '');
      tip.hidden = false;
      var w = plot.clientWidth, tw = tip.offsetWidth || 120;
      var left = Math.max(4, Math.min(w - tw - 4, x - tw / 2));
      var top = y - (tip.offsetHeight || 56) - 12;
      if (top < 2) top = y + 14;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function clear() {
      active = -1; tip.hidden = true;
      if (cross) cross.setAttribute('visibility', 'hidden');
      if (dot) dot.setAttribute('visibility', 'hidden');
    }
    function fromEvent(e) {
      if (!L) return;
      var r = plot.getBoundingClientRect();
      select(nearestIndex(L.px, e.clientX - r.left));
    }
    /* миша: наведення; дотик: торкання і горизонтальний рух (вертикальний
       скрол сторінки лишається за браузером: touch-action pan-y у стилях) */
    plot.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) fromEvent(e); });
    plot.addEventListener('pointerdown', fromEvent);
    plot.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') clear(); });
    plot.addEventListener('touchmove', function (e) { if (e.touches && e.touches[0]) fromEvent(e.touches[0]); }, { passive: true });
    plot.addEventListener('keydown', function (e) {
      if (!L) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); select((active < 0 ? L.todayIdx : active) + (e.key === 'ArrowRight' ? 1 : -1)); }
      else if (e.key === 'Escape') clear();
    });
    plot.addEventListener('blur', clear);
    document.addEventListener('pointerdown', function (e) { if (active >= 0 && !plot.contains(e.target)) clear(); });

    draw();
    if (typeof ResizeObserver === 'function') {
      var lastW = plot.clientWidth;
      new ResizeObserver(function () { var w = plot.clientWidth; if (w && Math.abs(w - lastW) > 1) { lastW = w; draw(); } }).observe(plot);
    } else {
      window.addEventListener('resize', draw);
    }
    return true;
  }

  window.CalCarValueChart = {
    render: render, usable: usable, layout: layout, yScale: yScale, xTicks: xTicks, nearestIndex: nearestIndex,
    money: money, axisMoney: axisMoney, roundApprox: roundApprox, monthLabel: monthLabel, tangents: tangents, pathThrough: pathThrough
  };
})();
