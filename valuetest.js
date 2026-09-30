/* Value v1 (api/value.js, value-chart.js, секція у result-check.html):
   тест без мережі і без бази.

   Що доводиться:
   1. крива: одна неперервна функція до і після "сьогодні", без зламу;
      суцільна частина закінчується рівно на сьогодні, прогноз рівно 5 років,
      точки кожні 6 місяців; жодних NaN/Infinity на крайніх входах;
   2. калібрування форми (Cayenne, Highlander, RAV4, S63, 20+ років, ~$30k,
      ~$300k) без захардкоджених виходів у модулі;
   3. якір "сьогодні": середня площадки, інакше ціна оголошення; ціна
      оголошення це окрема позначка і криву не зміщує;
   4. якір "новою": локальна ціна -> MSRP США з локалізацією -> зворотна
      оцінка; max(MSRP, зворотна) НЕ застосовується; базовий MSRP під
      дорогою конфігурацією відкидається; точна локальна ціна нижча за
      ринок ховає графік, а не підробляє джерело;
   5. кандидати ціни: лише з числом у тексті джерела; довіру ставить код;
   6. паралельний виклик: збій і вимикач не ламають Check;
   7. межі: Score і Confidence секцію не читають; розрахована оцінка не є
      фактом; публічний звіт віддає секцію; сторінка і словники.

   Запуск: node valuetest.js */

const fs = require('fs');
const vm = require('vm');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const near = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;

(async () => {
  const V = await import('./api/value.js');
  const NOW = Date.UTC(2026, 8, 30);

  /* ===== 1. крива ===== */
  const curveOf = (P0, Pc, T) => V.fitCurve(P0, Pc, T);
  {
    const c = curveOf(140000, 23600, 13);
    ok('1a. крива проходить через нову ціну', Math.abs(V.priceAt(c, 0) - 140000) < 1e-6);
    ok('1b. крива проходить через сьогодні', Math.abs(V.priceAt(c, 13) - 23600) < 1e-6);
    /* без зламу: нахил зліва і справа від "сьогодні" збігається */
    const h = 1e-4;
    const left = (V.priceAt(c, 13) - V.priceAt(c, 13 - h)) / h, right = (V.priceAt(c, 13 + h) - V.priceAt(c, 13)) / h;
    ok('1c. нахил неперервний на сьогодні', Math.abs(left - right) / Math.abs(left) < 1e-3, left + ' / ' + right);
    /* монотонне спадання і сповільнення */
    let mono = true, slowing = true, prevDrop = Infinity;
    for (let t = 1; t <= 18; t++) {
      const drop = V.priceAt(c, t - 1) - V.priceAt(c, t);
      if (drop <= 0) mono = false;
      if (drop > prevDrop + 1e-9) slowing = false;
      prevDrop = drop;
    }
    ok('1d. ціна лише спадає', mono);
    ok('1e. спад щороку повільніший', slowing);
    ok('1f. підлога нижча за сьогоднішню ціну', c.F < 23600 && c.F > 0);

    const pts = V.curvePoints(c, NOW);
    const today = pts.filter(p => p.today);
    ok('1g. рівно одна точка "сьогодні"', today.length === 1 && today[0].value === 23600 && today[0].forecast === false);
    ok('1h. перша точка це нова ціна', pts[0].t === 0 && pts[0].value === 140000);
    const fc = pts.filter(p => p.forecast);
    ok('1i. прогноз рівно 5 років піврічними точками', fc.length === 10 && Math.abs(fc[fc.length - 1].t - 18) < 1e-6);
    ok('1j. суцільна частина без прогнозних точок після сьогодні', pts.findIndex(p => p.forecast) === pts.indexOf(today[0]) + 1);
    const steps = pts.slice(2).map((p, i) => p.t - pts[i + 1].t);
    ok('1k. крок 6 місяців', steps.every(s => Math.abs(s - 0.5) < 1e-6), JSON.stringify(steps.slice(0, 4)));
    ok('1l. дати YYYY-MM, сьогодні це місяць розрахунку', pts.every(p => /^\d{4}-\d{2}$/.test(p.date)) && today[0].date === '2026-09' && fc[fc.length - 1].date === '2031-09');
    ok('1m. жодних нечислових значень', pts.every(p => Number.isFinite(p.value) && p.value > 0));
  }
  /* крайні входи: без NaN, без кривої */
  for (const [name, a] of [['P0 = Pc', [20000, 20000, 5]], ['P0 < Pc', [15000, 20000, 5]], ['T = 0', [30000, 20000, 0]], ['T < 0', [30000, 20000, -1]], ['NaN', [NaN, 20000, 5]],
    ['Infinity', [Infinity, 20000, 5]], ['нуль', [30000, 0, 5]], ['рядок', ['30000', 20000, 5]], ['null', [null, null, null]]]) {
    ok('1n. ' + name + ': кривої немає', V.fitCurve(...a) === null);
  }
  ok('1o. priceAt без кривої це null', V.priceAt(null, 3) === null && V.curvePoints(null, NOW).length === 0);
  {
    /* ціна біля підлоги: дуже старе і дуже знецінене авто */
    const c = curveOf(200000, 4000, 25);
    ok('1p. знецінене авто: підлога 60% поточної, крива є', c && Math.abs(c.F - 2400) < 1e-6 && V.priceAt(c, 30) > c.F && V.priceAt(c, 30) < 4000);
  }

  /* ===== 2. калібрування форми ===== */
  {
    const c = curveOf(140000, 23600, 13);
    ok('2a. Cayenne: перший рік 110-120 тис., не 84', near(V.priceAt(c, 1), 110000, 120000), String(V.priceAt(c, 1)));
    ok('2b. Cayenne: другий рік 90-100 тис.', near(V.priceAt(c, 2), 90000, 100000), String(V.priceAt(c, 2)));
    ok('2c. Cayenne: десятий рік 27-33 тис.', near(V.priceAt(c, 10), 27000, 33000), String(V.priceAt(c, 10)));
    ok('2d. Cayenne: +5 років 17-21 тис.', near(V.priceAt(c, 18), 17000, 21000), String(V.priceAt(c, 18)));
  }
  {
    const c = curveOf(71500, 58500, 1);
    ok('2e. Highlander: +5 років 40-45 тис.', near(V.priceAt(c, 6), 40000, 45000), String(V.priceAt(c, 6)));
    /* прогноз НЕ повторює обвал першого року щороку */
    const firstYearDrop = 71500 - 58500;
    ok('2f. Highlander: наступний рік втрачає менше за перший', (58500 - V.priceAt(c, 2)) < firstYearDrop * 0.6);
    ok('2g. Highlander: +1 рік 50-56 тис., +2 роки 47-52 тис.', near(V.priceAt(c, 2), 50000, 56000) && near(V.priceAt(c, 3), 47000, 52000));
  }
  {
    /* та сама родина формул, без коефіцієнтів марок: авто, що тримає ціну,
       лишається вище за знецінене преміальне */
    const rav = curveOf(34000, 27000, 5), cay = curveOf(140000, 23600, 13), s63 = curveOf(230000, 42000, 11);
    const keep = (c, t) => V.priceAt(c, t) / c.P0;
    ok('2h. RAV4 тримає частку ціни краще за Cayenne і S63 у тому самому віці', keep(rav, 5) > keep(cay, 5) && keep(rav, 5) > keep(s63, 5));
    ok('2i. RAV4: за 5 років уперед втрачає менше 20%', V.priceAt(rav, 10) / 27000 > 0.8, String(V.priceAt(rav, 10)));
    ok('2j. S63: перший рік втрачає понад 15%', V.priceAt(s63, 1) / 230000 < 0.85);
    const src = fs.readFileSync('api/value.js', 'utf8');
    ok('2k. у модулі немає марок і моделей', !/toyota|porsche|mercedes|cayenne|highlander|rav4|bmw/i.test(src));
  }
  for (const [name, P0, Pc, T] of [['20+ років', 45000, 6000, 24], ['~$30k', 30000, 24500, 2], ['~$300k', 300000, 210000, 2], ['1 рік', 68800, 58500, 1], ['5 років', 50000, 28000, 5], ['15 років', 60000, 9000, 15], ['25 років', 40000, 5000, 25]]) {
    const c = curveOf(P0, Pc, T), pts = V.curvePoints(c, NOW);
    ok('2l. ' + name + ': крива і точки є, прогноз нижчий за сьогодні і вищий за підлогу', !!c && pts.length >= 12 && pts[pts.length - 1].value < Pc && pts[pts.length - 1].value > c.F);
  }

  /* ===== зворотна оцінка ===== */
  ok('3a. 1 рік: 58 500 / 0.85', Math.abs(V.reverseNewPrice(58500, 1) - 58500 / 0.85) < 1e-6);
  ok('3b. 2 роки: 0.85 * 0.90', Math.abs(V.retentionFactor(2) - 0.765) < 1e-9);
  ok('3c. 5 років: 0.85 * 0.90 * 0.92^3', Math.abs(V.retentionFactor(5) - 0.85 * 0.9 * Math.pow(0.92, 3)) < 1e-9);
  ok('3d. 11 років включає 0.97', Math.abs(V.retentionFactor(11) - 0.85 * 0.9 * Math.pow(0.92, 3) * Math.pow(0.95, 5) * 0.97) < 1e-9);
  ok('3e. неповний рік плавний', V.retentionFactor(0.5) > 0.85 && V.retentionFactor(0.5) < 1 && V.retentionFactor(1.5) < 0.85 && V.retentionFactor(1.5) > 0.765);
  ok('3f. без ціни оцінки немає', V.reverseNewPrice(null, 3) === null && V.reverseNewPrice(0, 3) === null);
  ok('3g. вік: рік 2025 у вересні 2026 це трохи більше року', near(V.vehicleAgeYears(2025, NOW), 1.2, 1.3));
  ok('3h. вік: цьогорічне авто не молодше пів року', V.vehicleAgeYears(2026, NOW) === V.MIN_AGE_YEARS);
  ok('3i. вік: сміття це null', V.vehicleAgeYears(null, NOW) === null && V.vehicleAgeYears(1800, NOW) === null && V.vehicleAgeYears(2040, NOW) === null && V.vehicleAgeYears('abc', NOW) === null);

  /* ===== 3. сьогодні і позначка оголошення ===== */
  const RIA = avg => ({ average_price: avg, currency: 'USD', source_name: 'AUTO.RIA' });
  {
    const base = { currency: 'USD', country: 'UA', year: 2019, nowMs: NOW };
    const above = V.buildValueCurve({ ...base, price: 58500, price_context: RIA(45000) });
    const same = V.buildValueCurve({ ...base, price: 45000, price_context: RIA(45000) });
    ok('4a. F: якір це середня площадки', above.status === 'ok' && above.current.value === 45000 && above.current.source === 'marketplace_average' && above.current.source_name === 'AUTO.RIA');
    ok('4b. F: позначка оголошення +30% над кривою', above.listing && above.listing.value === 58500 && above.listing.delta_percent === 30);
    ok('4c. F: завищена ціна продавця криву не зміщує', JSON.stringify(above.points) === JSON.stringify(same.points));
    const below = V.buildValueCurve({ ...base, price: 41000, price_context: RIA(45000) });
    ok('4d. G: позначка нижче середньої', below.listing && below.listing.delta_percent === -9 && below.current.value === 45000);
    const none = V.buildValueCurve({ ...base, price: 41000, price_context: null });
    ok('4e. H: без середньої якір це ціна оголошення, позначки немає', none.status === 'ok' && none.current.value === 41000 && none.current.source === 'listing_price' && none.listing === null);
    const otherCur = V.buildValueCurve({ ...base, price: 1700000, currency: 'UAH', price_context: RIA(45000) });
    ok('4f. середня в іншій валюті не змішується з ціною оголошення', otherCur.current.source === 'listing_price' && otherCur.market.currency === 'UAH' && otherCur.new_price.basis === 'reverse_estimate');
    ok('4g. ринок і валюта явні у контракті', above.market.country === 'UA' && above.market.currency === 'USD' && above.version === V.VALUE_VERSION);
    const wild = V.buildValueCurve({ ...base, price: 450000, price_context: RIA(45000) });
    ok('4h. очевидно хибна ціна оголошення позначкою не стає', wild.status === 'ok' && wild.listing === null);
  }
  ok('4i. без ціни графіка немає', V.buildValueCurve({ currency: 'USD', year: 2019, nowMs: NOW }).status === 'hidden');
  ok('4j. без року графіка немає', V.buildValueCurve({ price: 20000, currency: 'USD', nowMs: NOW }).reason === 'no_vehicle_year');
  ok('4k. без валюти графіка немає', V.buildValueCurve({ price: 20000, year: 2019, nowMs: NOW }).reason === 'no_currency');
  ok('4l. абсурдна ціна це відсутня ціна', V.buildValueCurve({ price: 12, currency: 'USD', year: 2019, nowMs: NOW }).status === 'hidden' && V.buildValueCurve({ price: 9e9, currency: 'USD', year: 2019, nowMs: NOW }).status === 'hidden');
  ok('4m. порожній виклик не падає', V.buildValueCurve().status === 'hidden');

  /* ===== 4. нова ціна ===== */
  const cand = (amount, o = {}) => ({ amount, currency: 'USD', market: 'UA', price_kind: 'local_list', trim_match: 'unknown', model_year: null, source_url: 'https://example.com/p', source_host: 'example.com', source_excerpt: 'x', confidence: 'medium', ...o });
  const np = o => V.resolveNewPrice({ market: 'UA', currency: 'USD', ...o });
  {
    const r = np({ pc: 58500, T: 1, candidates: [] });
    ok('5a. I: без джерела зворотна оцінка, приблизна, не факт', r.basis === 'reverse_estimate' && r.approx === true && r.fact === null && near(r.value, 68000, 69500));
    /* RAV4: справжня ціна нижча за зворотну оцінку, і вона перемагає */
    const T = 5, pc = 22000, rev = V.reverseNewPrice(pc, T);
    const rav = np({ pc, T, candidates: [cand(27000)] });
    ok('5b. max(MSRP, зворотна) не застосовується', rev > 35000 && rav.basis === 'local_list' && rav.value === 27000 && rav.approx === true);
    const exact = np({ pc, T, candidates: [cand(27000, { trim_match: 'exact' })] });
    ok('5c. точна локальна ціна версії не позначена приблизною', exact.approx === false && exact.strength === 'strong' && exact.fact && exact.fact.amount === 27000);
    /* E: базовий MSRP нижчий за поточну ціну дорогої конфігурації */
    const porsche = np({ pc: 340000, T: 1.2, candidates: [cand(250000, { trim_match: 'base' })] });
    ok('5d. E: базова ціна під дорогою конфігурацією відкинута', porsche.basis === 'reverse_estimate' && porsche.value > 340000 && porsche.fact === null && porsche.rejected.some(x => x.reason === 'incompatible_with_current_value'));
    const curve = V.buildValueCurve({ price: 340000, currency: 'USD', country: 'UA', year: 2025, nowMs: NOW, candidates: [cand(250000, { trim_match: 'base' })] });
    ok('5e. E: графік не стартує нижче поточної ціни', curve.status === 'ok' && curve.points[0].value > 340000 && curve.points.every((p, i) => i === 0 || p.value < curve.points[i - 1].value));
    /* §30 B: точна локальна ціна не вища за ринок */
    const strongLow = V.buildValueCurve({ price: 30000, currency: 'USD', country: 'UA', year: 2024, nowMs: NOW, candidates: [cand(28000, { trim_match: 'exact' })] });
    ok('5f. точна локальна ціна нижча за ринок: графік сховано, джерело не підроблено', strongLow.status === 'hidden' && strongLow.reason === 'strong_anchor_not_above_market' && strongLow.new_price.value === 28000 && !strongLow.points);
    const huge = np({ pc: 20000, T: 3, candidates: [cand(900000)] });
    ok('5g. зайвий нуль у джерелі відкинуто', huge.basis === 'reverse_estimate' && huge.rejected.some(x => x.reason === 'implausibly_high'));
    /* порядок: локальна ціна перед MSRP США */
    const both = np({ pc: 40000, T: 3, candidates: [cand(48000, { market: 'US', price_kind: 'source_msrp' }), cand(62000)] });
    ok('5h. локальна ціна того самого ринку перед MSRP джерела', both.basis === 'local_list' && both.value === 62000);
    const us = np({ pc: 40000, T: 3, candidates: [cand(48000, { market: 'US', price_kind: 'source_msrp' })], vehicle: { fuel: 'petrol', displacement_l: 2.5, year: 2023 } });
    const expect = V.localizeUsMsrpToUA(48000, { fuel: 'petrol', displacement_l: 2.5, year: 2023 });
    ok('5i. MSRP США локалізується режимом року авто', us.basis === 'localized_msrp' && us.value === Math.round(expect.value) && us.approx === true && us.fact.market === 'US' && us.fact.amount === 48000 && us.localization === 'ua_ice_2019');
    ok('5j. B: ДВЗ без регресії: мито 10%, акциз, ПДВ 20%, логістика', expect.regime === 'ua_ice_2019' && Math.abs(expect.value - ((48000 * 1.1 + 2.5 * 50 * 1.08) * 1.2 + V.IMPORT_LOGISTICS_USD)) < 1e-6);
    ok('5k. B: гібрид і дизель за тарифом Import', Math.abs(V.localizeUsMsrpToUA(10000, { fuel: 'hybrid', year: 2022 }).value - ((11000 + 108) * 1.2 + V.IMPORT_LOGISTICS_USD)) < 1e-6
      && Math.abs(V.localizeUsMsrpToUA(10000, { fuel: 'diesel', displacement_l: 4, year: 2022 }).value - ((11000 + 4 * 150 * 1.08) * 1.2 + V.IMPORT_LOGISTICS_USD)) < 1e-6);

    /* A: електромобіль 2021 року. Перевіряється ПОВЕДІНКА податків, а не
       цільове число: мито 0, ПДВ немає, акциз 1 EUR за кВт*год, логістика */
    const bev = V.localizeUsMsrpToUA(45000, { fuel: 'electric', battery_kwh: 88, year: 2021 });
    ok('5s. A: BEV 2021: мито 0%, ПДВ звільнено', bev && bev.regime === 'ua_bev_2019_2025' && bev.duty === 0 && bev.vat === 0);
    ok('5t. A: BEV 2021: акциз 1 EUR за кВт*год', Math.abs(bev.excise - 88 * 1.08) < 1e-6);
    ok('5u. A: BEV 2021: сума це MSRP + акциз + логістика, без 10% і 20%', Math.abs(bev.value - (45000 + 88 * 1.08 + V.IMPORT_LOGISTICS_USD)) < 1e-6 && bev.value < 45000 * 1.1);
    const iceSame = V.localizeUsMsrpToUA(45000, { fuel: 'petrol', displacement_l: 2.0, year: 2021 });
    ok('5v. A: той самий MSRP для ДВЗ локалізується дорожче, ніж для BEV 2021', iceSame.value > bev.value + 45000 * 0.25);
    const bevNoKwh = V.localizeUsMsrpToUA(45000, { fuel: 'electric', year: 2021 });
    ok('5w. A: невідома ємність батареї не вмикає мито і ПДВ', bevNoKwh.duty === 0 && bevNoKwh.vat === 0 && bevNoKwh.excise === 0);
    const bevCurve = np({ pc: 23700, T: 5.2, candidates: [cand(45000, { market: 'US', price_kind: 'source_msrp', model_year: 2021 })], vehicle: { fuel: 'electric', battery_kwh: 88, year: 2021 } });
    ok('5x. A: BEV 2021 доходить до якоря історичним режимом', bevCurve.basis === 'localized_msrp' && bevCurve.localization === 'ua_bev_2019_2025' && bevCurve.value === Math.round(bev.value));
    /* рік кандидата важливіший за рік авто: режим того року, до якого належить ціна */
    const byCandYear = np({ pc: 23700, T: 5.2, candidates: [cand(45000, { market: 'US', price_kind: 'source_msrp', model_year: 2021 })], vehicle: { fuel: 'electric', battery_kwh: 88, year: 2026 } });
    ok('5y. режим береться за роком ціни', byCandYear.localization === 'ua_bev_2019_2025');

    /* C: режим невідомий: сьогоднішні правила історичною правдою не стають */
    ok('5z. C: рік без відомого режиму: локалізації немає', V.localizeUsMsrpToUA(45000, { fuel: 'electric', battery_kwh: 60, year: 2016 }) === null
      && V.localizeUsMsrpToUA(45000, { fuel: 'petrol', displacement_l: 2.5, year: 2012 }) === null
      && V.localizeUsMsrpToUA(45000, { fuel: 'petrol', displacement_l: 2.5 }) === null
      && V.localizeUsMsrpToUA(45000, { year: 2021 }) === null);
    const oldIce = np({ pc: 9000, T: 14, candidates: [cand(32000, { market: 'US', price_kind: 'source_msrp' })], vehicle: { fuel: 'petrol', displacement_l: 2.5, year: 2012 } });
    ok('5aa. C: невідомий режим дає зворотну оцінку, не сьогоднішні податки', oldIce.basis === 'reverse_estimate' && oldIce.fact === null && oldIce.rejected.some(x => x.reason === 'historical_localization_unknown'));
    ok('5ab. режими: BEV 2019-2025 окремо від BEV 2026 і ДВЗ', V.uaImportRegime('electric', 2019).id === 'ua_bev_2019_2025' && V.uaImportRegime('electric', 2025).id === 'ua_bev_2019_2025'
      && V.uaImportRegime('electric', 2026).id === 'ua_bev_2026' && V.uaImportRegime('electric', 2018) === null && V.uaImportRegime('hybrid', 2021).id === 'ua_ice_2019' && V.uaImportRegime('petrol', 2018) === null);
    ok('5ac. у модулі немає цін моделей: лише режими', !/mach|mustang|ford/i.test(fs.readFileSync('api/value.js', 'utf8')));
    const eu = np({ pc: 40000, T: 3, candidates: [cand(55000, { market: 'EU', price_kind: 'source_msrp', currency: 'EUR' })] });
    ok('5l. ціна іншого ринку якорем не стає', eu.basis === 'reverse_estimate' && eu.rejected.some(x => x.reason === 'market_not_supported'));
    const de = V.resolveNewPrice({ market: 'DE', currency: 'EUR', pc: 40000, T: 3, candidates: [cand(62000)] });
    ok('5m. інший ринок чи валюта графіка: лише зворотна оцінка', de.basis === 'reverse_estimate' && de.fact === null);
    const uah = np({ pc: 40000, T: 3, candidates: [cand(2300000, { currency: 'UAH', model_year: 2023 })] });
    ok('5n. гривнева ціна приводиться до USD за курсом року', uah.basis === 'local_list' && near(uah.value, 60000, 66000) && uah.fact.amount === 2300000 && uah.fact.currency === 'UAH');
    ok('5o. стара гривнева ціна без курсу не перераховується', V.toUsd(100000, 'UAH', 2001) === null && V.toUsd(100, 'GBP', 2020) === null && V.toUsd(100, 'USD', 2020) === 100);
    const c2 = V.buildValueCurve({ price: 22000, currency: 'USD', country: 'UA', year: 2021, nowMs: NOW, candidates: [cand(27000, { trim_match: 'exact' })], identity: { make: 'Make', model: 'Model', generation: 'G1', trim: 'T1' } });
    ok('5p. факт несе область MI: марка, модель, покоління, версія, рік, ринок, валюта, джерело, довіра',
      c2.new_price.fact && ['make', 'model', 'generation', 'trim', 'model_year', 'market', 'currency', 'amount', 'source_url', 'confidence'].every(k => c2.new_price.fact[k] !== undefined && c2.new_price.fact[k] !== null));
    const c3 = V.buildValueCurve({ price: 22000, currency: 'USD', country: 'UA', year: 2021, nowMs: NOW });
    ok('5q. розрахована оцінка фактом не стає', c3.new_price.basis === 'reverse_estimate' && c3.new_price.fact === null && c3.new_price.approx === true);
    ok('5r. запобіжник росте з віком і обмежений', V.minNewToCurrentRatio(0) === 1 && Math.abs(V.minNewToCurrentRatio(1) - 1.06) < 1e-9 && Math.abs(V.minNewToCurrentRatio(30) - 1.14) < 1e-9);
  }

  /* ===== 5. кандидати зі сниппетів ===== */
  {
    ok('6a. числа з тексту', JSON.stringify(V.numbersInText('MSRP $45,270, from 1 599 000 грн or 45.270 and 2025 year 39995')) === JSON.stringify([45270, 1599000, 45270, 2025, 39995]));
    ok('6b. число є в тексті', V.amountInText(45270, 'starting MSRP of $45,270') && !V.amountInText(45270, 'starting MSRP of $46,270') && !V.amountInText(45, 'price 45'));
    const results = [
      { ref: 'S1', url: 'https://www.toyota.com/highlander', host: 'toyota.com', title: '2025 Highlander', snippet: 'Starting MSRP $39,820' },
      { ref: 'S2', url: 'https://blog.example.com/x', host: 'blog.example.com', title: 'Ціни', snippet: 'Новий Highlander в Україні від 2 599 000 грн' },
    ];
    const raw = [
      { result_ref: 'S1', amount: 39820, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'base', model_year: 2025 },
      { result_ref: 'S2', amount: 2599000, currency: 'UAH', market: 'UA', price_kind: 'local_list', trim_match: 'base', model_year: null },
      { result_ref: 'S1', amount: 52000, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'exact', model_year: 2025 },
      { result_ref: 'S9', amount: 39820, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'base', model_year: 2025 },
      { result_ref: 'S1', amount: 39820, currency: 'GBP', market: 'US', price_kind: 'source_msrp', trim_match: 'base', model_year: 2025 },
      { result_ref: 'S1', amount: 39820, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'base', model_year: 2019 },
    ];
    const v = V.validateCandidates(raw, results, { brand: 'Toyota', year: 2025 });
    ok('6c. приймаються лише ціни з числом у тексті свого джерела', v.candidates.length === 2 && v.candidates[0].amount === 39820 && v.candidates[1].amount === 2599000);
    ok('6d. вигадана ціна, чуже посилання, чужа валюта, чужий рік відкинуті', ['amount_not_in_source', 'unknown_result_ref', 'bad_shape', 'other_model_year'].every(r => v.dropped.some(d => d.reason === r)));
    ok('6e. довіру ставить код за доменом', v.candidates[0].confidence === 'high' && v.candidates[1].confidence === 'medium' && v.candidates[0].source_url === results[0].url);
    ok('6f. сміття не падає', V.validateCandidates(null, null).candidates.length === 0 && V.validateCandidates([null, 5, {}], results).candidates.length === 0);
  }

  /* ===== тексти ===== */
  {
    const s = V.sanitizeMarketValue({ liquidity: { level: 'high', reasons: ['Популярна модель \u2014 широкий попит', 'Друга', 'Третя причина', 'Четверта причина'] }, price_factors: ['Один чинник', 'Два чинники', 'Три чинники', 'Чотири', 'Пʼять чинників', 'Шість чинників', 'друга'] });
    ok('7a. не більше 3 причин і 5 чинників', s.liquidity.reasons.length === 3 && s.price_factors.length === 5);
    ok('7b. довге тире прибрано', !/[\u2014\u2013]/.test(JSON.stringify(s)) && s.liquidity.reasons[0] === 'Популярна модель, широкий попит');
    const dup = V.sanitizeMarketValue({ liquidity: { level: 'low', reasons: ['Вузьке коло покупців'] }, price_factors: ['вузьке коло покупців', 'Дороге утримання'] });
    ok('7c. картки не повторюють одне речення', dup.price_factors.length === 1 && dup.price_factors[0] === 'Дороге утримання');
    ok('7d. невідомий рівень це unknown, без числових оцінок', V.sanitizeMarketValue({ liquidity: { level: '8.7/10', reasons: ['Причина така'] }, price_factors: [] }).liquidity.level === 'unknown');
    ok('7e. порожня відповідь це null', V.sanitizeMarketValue({ liquidity: { level: 'high', reasons: [] }, price_factors: [] }) === null && V.sanitizeMarketValue(null) === null);
    ok('7f. рівень без причин не показується як факт', V.sanitizeMarketValue({ liquidity: { level: 'high', reasons: [] }, price_factors: ['Один чинник'] }).liquidity.level === 'unknown');
    const schema = V.valueResponseFormat().json_schema;
    ok('7g. схема strict з трьома полями', schema.strict === true && JSON.stringify(schema.schema.required) === JSON.stringify(['liquidity', 'price_factors', 'new_price_candidates']));
    ok('7h. правила: без памʼяті про ціни, технічні твердження лише з контексту', /Never supply a price from memory/.test(V.VALUE_RULES) && /ONLY when MODEL_CONTEXT supports/.test(V.VALUE_RULES) && /level "unknown"/.test(V.VALUE_RULES));
  }

  /* ===== 6. паралельний виклик ===== */
  {
    const ID = { make: 'Toyota', model: 'Highlander', year: 2025, trim: 'Limited', generation: 'XU70' };
    const SEARCH = async q => ({ query: q, ok: true, items: [{ link: 'https://www.toyota.com/highlander', title: '2025 Highlander Limited', snippet: 'MSRP $47,575 for Limited' }] });
    const reply = obj => async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm' });
    const GOOD = { liquidity: { level: 'high', reasons: ['Широке коло покупців.', 'Стійкий попит.'] }, price_factors: ['Практичний кузов', 'Гібридна економічність', 'Широка аудиторія'],
      new_price_candidates: [{ result_ref: 'S1', amount: 47575, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'exact', model_year: 2025 }] };
    const queries = [];
    let bodySeen = null;
    const ctrl = V.startValueResearch({ market: 'UA', currency: 'USD', identity: ID }, { searchSerper: q => { queries.push(q); return SEARCH(q); }, callModel: async b => { bodySeen = b; return reply(GOOD)(); }, env: {} });
    const res = await ctrl.analyze({ langDirective: 'LANG', modelContext: 'CTX-BLOCK' });
    ok('8a. два паралельні запити про ціну нового авто', queries.length === 2 && /Україні/.test(queries[0]) && /MSRP/.test(queries[1]) && /Limited/.test(queries[1]));
    ok('8b. результат: тексти і перевірений кандидат', res && res.market_value.liquidity.level === 'high' && res.candidates.length === 1 && res.candidates[0].amount === 47575 && ctrl.state.status === 'ok');
    ok('8c. виклик: strict-схема, low effort, контекст моделі і сниппети у вході', bodySeen.response_format.json_schema.strict === true && bodySeen.reasoning_effort === 'low'
      && /CTX-BLOCK/.test(bodySeen.messages[1].content) && /S1\. \[toyota\.com\]/.test(bodySeen.messages[1].content) && /LANG/.test(bodySeen.messages[1].content));
    ok('8d. повторний analyze не робить другого виклику', ctrl.analyze() === ctrl.analyze());
    const curve = V.buildValueCurve({ price: 58500, currency: 'USD', country: 'UA', year: 2025, nowMs: NOW, candidates: res.candidates, vehicle: { fuel: 'hybrid' } });
    ok('8e0. режим локалізації видно у звіті', curve.new_price.localization === 'ua_ice_2019');
    ok('8e. кандидат доходить до графіка як локалізований MSRP', curve.status === 'ok' && curve.new_price.basis === 'localized_msrp' && curve.new_price.approx === true);

    const failing = V.startValueResearch({ market: 'UA', currency: 'USD', identity: ID }, { searchSerper: SEARCH, callModel: async () => { throw new Error('boom'); }, env: {} });
    const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' '));
    const r2 = await failing.analyze({});
    console.log = log;
    ok('8f. збій виклику: null, Check живий, є структурований лог', r2 === null && failing.state.status === 'error' && lines.some(l => /\[value\]/.test(l) && /"op":"analyze"/.test(l)));
    const apiErr = V.startValueResearch({ market: 'UA', currency: 'USD', identity: ID }, { searchSerper: SEARCH, callModel: async () => ({ error: { message: 'rate limit' } }), env: {} });
    console.log = () => {}; const r3 = await apiErr.analyze({}); console.log = log;
    ok('8g. помилка API: null', r3 === null && apiErr.state.status === 'error');
    const searchDown = V.startValueResearch({ market: 'UA', currency: 'USD', identity: ID }, { searchSerper: async () => { throw new Error('net'); }, callModel: reply({ ...GOOD, new_price_candidates: [] }), env: {} });
    const r4 = await searchDown.analyze({});
    ok('8h. пошук упав: тексти є, кандидатів немає', r4 && r4.market_value && r4.candidates.length === 0);
    let called = 0;
    const off = V.startValueResearch({ market: 'UA', currency: 'USD', identity: ID }, { searchSerper: async q => { called++; return SEARCH(q); }, callModel: async () => { called++; return {}; }, env: { VALUE_SECTION: 'off' } });
    ok('8i. вимикач VALUE_SECTION=off: жодного виклику', (await off.analyze({})) === null && called === 0 && off.state.reason === 'disabled');
    let searched = 0;
    const foreign = V.startValueResearch({ market: null, currency: 'EUR', identity: ID }, { searchSerper: async q => { searched++; return SEARCH(q); }, callModel: reply({ ...GOOD, new_price_candidates: [] }), env: {} });
    const r5 = await foreign.analyze({});
    ok('8j. не Україна: ціну нового авто не шукаємо, тексти є', searched === 0 && r5 && r5.market_value && r5.candidates.length === 0);
    const weak = V.startValueResearch({ market: 'UA', currency: 'USD', identity: { make: null, model: null, year: 2020 } }, { searchSerper: SEARCH, callModel: reply(GOOD), env: {} });
    ok('8k. без марки і моделі виклику немає', (await weak.analyze({})) === null && weak.state.reason === 'identity_too_weak');
    const invented = V.startValueResearch({ market: 'UA', currency: 'USD', identity: ID }, { searchSerper: SEARCH, callModel: reply({ ...GOOD, new_price_candidates: [{ ...GOOD.new_price_candidates[0], amount: 71500 }] }), env: {} });
    const r6 = await invented.analyze({});
    ok('8l. ціна з памʼяті моделі не проходить', r6.candidates.length === 0 && invented.state.dropped.some(d => d.reason === 'amount_not_in_source'));
  }

  /* ===== 7. межі і проводка ===== */
  {
    const read = f => fs.readFileSync(f, 'utf8');
    for (const f of ['api/score-v4.js', 'api/score-v3.js', 'api/score.js', 'api/confidence.js', 'api/damage-score.js']) {
      ok('9a. ' + f + ' не читає секцію вартості', !/value_curve|market_value|value\.js|liquidity/.test(read(f)));
    }
    const check = read('api/check.js');
    ok('9b. Check підключає модуль', /import \{ startValueResearch, buildValueCurve \} from '\.\/value\.js';/.test(check));
    const iStart = check.indexOf('startValueResearch({'), iAnalyze = check.indexOf('valueResearch.analyze({'), iMain = check.indexOf('let data = await callModel(mainBody'), iWait = check.indexOf('await Promise.race([valuePromise');
    ok('9c. пошук стартує до основного аналізу, виклик не чекається перед ним, результат забирається після', iStart > 0 && iStart < iAnalyze && iAnalyze < iMain && iMain < iWait);
    ok('9d. основний виклик не чекає секцію', !/await valueResearch\.analyze|await valuePromise/.test(check));
    ok('9e. очікування після аналізу обмежене 6 с', /Promise\.race\(\[valuePromise, new Promise\(r => setTimeout\(\(\) => r\(null\), Math\.max\(0, Math\.min\(6000,/.test(check));
    ok('9f. секція у звіті: market_value, _meta.value_curve і тайминг', /parsed\.market_value = valueResult\.market_value/.test(check) && /value_curve: valueCurve,/.test(check) && /mark\('value_section'/.test(check));
    ok('9g. Score рахується без секції: breakdown не згадує вартість', !/computeScoreV4\([^)]*value/i.test(check));
    ok('9h. основна схема відповіді не змінена секцією', !/market_value|liquidity/.test(read('api/check-schema.js')));
    const S = await import('./api/share.js');
    const pub = S.publicReport({ vehicle: { title: 'x' }, market_value: { liquidity: { level: 'high', reasons: ['a'] }, price_factors: [] }, _meta: { value_curve: { status: 'ok' }, timings: { value_section: {} } } });
    ok('9i. публічний звіт віддає секцію, але не тайминги', pub.market_value && pub._meta.value_curve && pub._meta.timings === undefined);
    for (const f of ['api/value.js', 'value-chart.js', 'valuetest.js']) ok('9j. ' + f + ' без довгого тире', !read(f).includes(String.fromCharCode(0x2014)));
    ok('9k. розрахована оцінка не пишеться в MI', !/rpc\(|research_persist|candidate_claim|supabase/i.test(read('api/value.js')));
  }

  /* ===== сторінка і графік ===== */
  {
    const page = fs.readFileSync('result-check.html', 'utf8');
    const iVerdict = page.indexOf('<div class="card" id="verdictCard"'), iValue = page.indexOf('id="valueCard"'), iRisks = page.indexOf('id="risksCard"');
    ok('10a. секція стоїть одразу після висновку і перед ризиками', iVerdict > 0 && iVerdict < iValue && iValue < iRisks);
    const between = page.slice(iVerdict, iValue);
    ok('10b. між висновком і секцією немає іншої картки', (between.match(/<div class="card[ "]/g) || []).length === 1);
    const sec = page.slice(page.indexOf('<div class="val-sec" id="valueCard"'), iRisks);
    ok('10b1. три незалежні картки без спільної рамки', /^<div class="val-sec"/.test(sec) && (sec.match(/<div class="card val-(main|box)"/g) || []).length === 3 && !/class="card val-card"/.test(page));
    const vcss = page.slice(page.indexOf('/* ---- ринкова вартість'), page.indexOf('/* висновок CalCar це головна'));
    ok('10b2. без внутрішніх розділювачів між частинами', !/\.val-(side|box|main)[^{]*\{[^}]*border-(left|top)/.test(vcss));
    ok('10b3. праві картки природної висоти, графік близько 69%', /\.val-grid\{[^}]*grid-template-columns:minmax\(0,2\.2fr\) minmax\(0,1fr\)[^}]*align-items:start/.test(vcss));
    ok('10b4. чіп ринку: просто країна, тихий', /mk\.textContent = t\('Ukraine'\)/.test(page) && !/Market: Ukraine/.test(page) && /\.val-chip\{[^}]*color:var\(--muted\)/.test(vcss));
    ok('10b5. прогноз справжнім пунктиром, не крапками', /\.vc-forecast\{[^}]*stroke-linecap:butt[^}]*stroke-dasharray:7 5/.test(vcss));
    ok('10b6. лаймова заливка ледь помітна', /\.vc-area\{fill:var\(--brand\);opacity:\.1\}/.test(vcss));
    ok('10c. графік, ліквідність і чинники в одній картці', /id="valChart"/.test(page) && /id="valLiqBox"/.test(page) && /id="valWhyBox"/.test(page));
    ok('10d. value-chart.js підключений', /<script src="\/value-chart\.js"><\/script>/.test(page));
    ok('10e. рендер викликається після висновку', /renderValueSection\(D\);/.test(page) && page.indexOf('renderValueSection(D);') > page.indexOf('renderScoreBlock(D);'));
    ok('10f. мобільна розкладка в один стовпчик', /@media\(max-width:860px\)\{\s*\.val-grid\{grid-template-columns:1fr\}/.test(page) && /\.val-side\{display:flex;flex-direction:column/.test(page));
    ok('10g. дотик: вертикальний скрол лишається сторінці', /\.vc-plot\{[^}]*touch-action:pan-y/.test(page));
    ok('10h. нових кольорів немає: лише токени', !/\.(val|vc)-[a-z-]+[^{]*\{[^}]*#(?!fff\b)[0-9a-fA-F]{3,6}/.test(page.slice(page.indexOf('/* ---- ринкова вартість'), page.indexOf('/* висновок CalCar це головна'))));
    ok('10i. відсоток знецінення за роки не показується', !/за \d+ років|% over|percent over/.test(fs.readFileSync('value-chart.js', 'utf8')));

    const w = {}; vm.runInNewContext(fs.readFileSync('value-chart.js', 'utf8'), { window: w, Intl, Math, Date, String, Number, parseInt, isFinite, Object });
    const C = w.CalCarValueChart;
    const vc = V.buildValueCurve({ price: 26000, currency: 'USD', price_context: RIA(23600), country: 'UA', year: 2013, nowMs: NOW, candidates: [cand(140000)] });
    ok('11a. збережені точки придатні до малювання', C.usable(vc) === true);
    ok('11b. зіпсовані дані не малюються', !C.usable(null) && !C.usable({ status: 'hidden' }) && !C.usable({ ...vc, points: vc.points.map((p, i) => i === 3 ? { ...p, value: NaN } : p) }) && !C.usable({ ...vc, points: vc.points.slice(0, 2) }) && !C.usable({ ...vc, points: [vc.points[1], vc.points[0], vc.points[2]] }));
    for (const width of [300, 375, 640, 720]) {
      const L = C.layout(vc, width, 260);
      const inside = L.px.every(x => x >= L.pad.l - 0.01 && x <= width - L.pad.r + 0.01) && L.py.every(y => y >= L.pad.t - 0.01 && y <= 260 - L.pad.b + 0.01);
      ok('11c. ширина ' + width + ': усі точки в межах полотна', inside);
      ok('11d. ширина ' + width + ': x зростає, y після першої точки не піднімається', L.px.every((x, i) => i === 0 || x > L.px[i - 1]) && L.py.every((y, i) => i === 0 || y >= L.py[i - 1] - 0.01));
      ok('11e. ширина ' + width + ': "сьогодні" це остання суцільна точка', vc.points[L.todayIdx].today === true);
      const yL = L.Y(vc.listing.value);
      ok('11f. ширина ' + width + ': позначка оголошення вище кривої і в межах полотна', yL < L.py[L.todayIdx] && yL >= L.pad.t);
    }
    /* D: вісь Y від нуля з ефективною верхньою межею */
    for (const max of [30000, 53000, 60000, 63000, 140000, 300000, 411000, 7500, 1250000]) {
      for (const maxI of [5, 7]) {
        const sc = C.yScale(max, maxI);
        ok('11g. max ' + max + ' (до ' + maxI + ' поділок): від нуля, стеля над значенням і не вища за 1.35x', sc.ticks[0] === 0 && sc.top >= max * 1.05 - 1e-6 && sc.top <= max * 1.35
          && sc.ticks.length >= 3 && sc.ticks.length <= maxI + 1 && sc.ticks[sc.ticks.length - 1] === Math.round(sc.top), JSON.stringify(sc.ticks));
        ok('11h. max ' + max + ': рівний крок', sc.ticks.every((v, i) => i === 0 || Math.abs((v - sc.ticks[i - 1]) - sc.step) < 1));
      }
    }
    ok('11h1. ~50-60 тис. не отримує стелю 80 тис.', C.yScale(53000, 7).top <= 60000 && C.yScale(60000, 7).top < 80000 && C.yScale(60000, 5).top < 80000);
    ok('11h2. дешеве і дороге авто мають різні шкали', C.yScale(30000, 7).step < C.yScale(300000, 7).step);
    const over = V.buildValueCurve({ price: 120000, currency: 'USD', price_context: RIA(45000), country: 'UA', year: 2024, nowMs: NOW });
    const Lo = C.layout(over, 640, 260);
    ok('11i. позначка оголошення поза кривою розширює шкалу', Lo.ys.top >= 120000 && Lo.Y(120000) >= Lo.pad.t && Lo.Y(0) === Lo.pad.t + Lo.ih);
    ok('11j. підписи осі і сум', C.axisMoney(20000, 'USD') === '$20k' && C.axisMoney(100000, 'USD') === '$100k' && C.axisMoney(1500000, 'USD') === '$1.5M' && C.axisMoney(12500, 'USD') === '$12.5k' && C.money(23600, 'USD') === '$23\u00a0600' && C.money(23600, 'UAH') === '23\u00a0600\u00a0UAH');
    /* E: вісь X: рік кінця прогнозу підписаний на правому краю */
    for (const [age, maxLabels] of [[0.5, 8], [1.25, 8], [5, 8], [13.25, 8], [25, 8], [25, 5], [40, 4]]) {
      const tMax = age + 5;
      const ticks = C.xTicks(tMax, Date.UTC(2031, 8, 1), maxLabels);
      const last = ticks[ticks.length - 1];
      ok('11k. вік ' + age + ', до ' + maxLabels + ' підписів: ' + ticks.length, ticks.length >= 2 && ticks.length <= Math.max(2, maxLabels)
        && last.year === 2031 && Math.abs(last.t - tMax) < 1e-9 && ticks.every((x, i) => x.t >= -1e-9 && (i === 0 || (x.t > ticks[i - 1].t && x.year > ticks[i - 1].year))));
    }
    ok('11k1. молоде авто: підписи щороку, сьогодні теж підписане', C.xTicks(6.25, Date.UTC(2031, 8, 1), 8).some(x => x.year === 2026 && Math.abs(x.t - 1.25) < 1e-9));
    /* F: формат головних чисел */
    const chartSrc = fs.readFileSync('value-chart.js', 'utf8');
    ok('11q. F: середня площадки округлена до сотні з позначкою приблизності', /curTxt = isAvg \? '\\u2248\\u00a0' \+ money\(Math\.round\(vc\.current\.value \/ 100\) \* 100, cur\) : money\(vc\.current\.value, cur\)/.test(chartSrc));
    ok('11r. F: ціна оголошення точна, без знака приблизності', /esc\(money\(vc\.listing\.value, cur\)\)/.test(chartSrc));
    ok('11s. F: прогноз лишається приблизним', /futTxt = '≈\\u00a0' \+ money\(roundApprox\(vc\.future\.value\), cur\)/.test(chartSrc));
    ok('11t. підказка на сьогодні показує точне значення джерела', /var exact = active === L\.todayIdx/.test(chartSrc));
    ok('11u. підпис "Сьогодні" біля вертикальної лінії', /'class': 'vc-now-lbl' \}, t\('Today'\)\)/.test(chartSrc));
    ok('11v. взаємодія збережена: миша, дотик, клавіатура', ['pointermove', 'pointerdown', 'pointerleave', 'touchmove', 'keydown'].every(e => chartSrc.includes("addEventListener('" + e + "'")));
    /* прилипання до найближчої піврічної точки */
    const L = C.layout(vc, 640, 260);
    ok('11l. вибір прилипає до найближчої точки', C.nearestIndex(L.px, L.px[5] + 1) === 5 && C.nearestIndex(L.px, -50) === 0 && C.nearestIndex(L.px, 9999) === vc.points.length - 1);
    ok('11m. підпис місяця трьома мовами', /2021/.test(C.monthLabel({ date: '2021-06' }, 'uk-UA')) && /^Июнь 2021$/.test(C.monthLabel({ date: '2021-06' }, 'ru-RU')) && /^June 2021$/.test(C.monthLabel({ date: '2021-06' }, 'en-US')));
    /* гладка лінія без викидів: дотичні не міняють знак на монотонних даних */
    const m = C.tangents(L.px, L.py);
    ok('11n. інтерполяція монотонна: лінія ніде не йде вгору', m.every(x => Number.isFinite(x) && x >= -1e-9));
    const d = C.pathThrough(L.px, L.py, m, 0, L.todayIdx) + C.pathThrough(L.px, L.py, m, L.todayIdx, vc.points.length - 1);
    ok('11o. шлях без NaN', !/NaN|undefined|Infinity/.test(d) && /^M/.test(d));
    /* дотична в точці "сьогодні" одна для суцільної і пунктирної частини */
    ok('11p. суцільна і пунктирна частини мають спільну дотичну', Number.isFinite(m[L.todayIdx]));

    /* словники */
    const dicts = { CALCAR_DICTS: {} };
    for (const f of ['i18n/ru.js', 'i18n/ua.js']) vm.runInNewContext(fs.readFileSync(f, 'utf8'), { window: dicts });
    const keys = ['Market value', 'Liquidity', 'Why this car costs what it does', 'Easy to resell', 'Average resale', 'Hard to resell', 'Not enough data', 'Ukraine', 'When new', 'Today', 'Average today', 'In 5 years',
      'Forecast', 'This listing', '{pct} vs average', 'Value over time', 'The new-car price is estimated from the current price and age.', 'The new-car price is the US list price plus import costs to Ukraine.',
      'The new-car price is the list price in Ukraine.', 'The forecast is a model estimate, not a guarantee.'];
    for (const lang of ['ru', 'ua']) {
      const missing = keys.filter(k => !dicts.CALCAR_DICTS[lang][k]);
      ok('12a. словник ' + lang + ' має всі рядки секції', missing.length === 0, missing.join(' | '));
    }
    const used = [...(page.slice(page.indexOf('function renderValueSection'), page.indexOf('function fill(')) + fs.readFileSync('value-chart.js', 'utf8')).matchAll(/\bt\('([^']+)'\)/g)].map(x => x[1]);
    ok('12b. кожен рядок t() секції є у словниках', used.length >= 10 && used.every(k => dicts.CALCAR_DICTS.ru[k] && dicts.CALCAR_DICTS.ua[k]), used.filter(k => !dicts.CALCAR_DICTS.ru[k] || !dicts.CALCAR_DICTS.ua[k]).join(' | '));
  }

  if (errs.length) {
    console.error('valuetest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('valuetest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('valuetest CRASHED:', e.stack || e.message); process.exit(1); });
