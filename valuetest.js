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
    /* якір "сьогодні" це нижча з двох цін; друга лишається контекстом */
    const below = V.buildValueCurve({ ...base, price: 41000, price_context: RIA(45000) });
    ok('4d. A: оголошення дешевше за середню: якір це ціна оголошення', below.status === 'ok' && below.current.value === 41000 && below.current.source === 'listing_price' && below.listing === null);
    ok('4d1. F: середня площадки стає другою позначкою з назвою джерела', below.average && below.average.value === 45000 && below.average.source_name === 'AUTO.RIA');
    const belowAlone = V.buildValueCurve({ ...base, price: 41000, price_context: null });
    ok('4d2. F: друга позначка криву не зміщує', JSON.stringify(below.points) === JSON.stringify(belowAlone.points) && belowAlone.average === null);
    ok('4d3. G: якір реально змінює Pc кривої', JSON.stringify(below.points) !== JSON.stringify(same.points) && below.points.find(p => p.today).value === 41000 && same.points.find(p => p.today).value === 45000);
    ok('4d4. G: прогноз через 5 років нижчий за сьогодні', below.future.value < 41000 && above.future.value < 45000 && below.future.value < above.future.value);
    ok('4d5. B: оголошення дорожче: якір це середня, оголошення окремо', above.current.source === 'marketplace_average' && above.average === null && above.listing.value === 58500);
    const onlyAvg = V.buildValueCurve({ ...base, price: null, price_context: RIA(45000) });
    ok('4d6. D: є лише середня: вона і якір, позначок немає', onlyAvg.status === 'ok' && onlyAvg.current.value === 45000 && onlyAvg.current.source === 'marketplace_average' && onlyAvg.listing === null && onlyAvg.average === null);
    const twin = V.buildValueCurve({ ...base, price: 44980, price_context: RIA(45010) });
    ok('4d7. однакові після округлення ціни не дають другої позначки', twin.current.value === 44980 && twin.current.source === 'listing_price' && twin.average === null && twin.listing === null);
    /* приймальний випадок: нова близько 52 тис., середня 23 200, оголошення 19 000 */
    const accept = V.buildValueCurve({ price: 19000, currency: 'USD', price_context: RIA(23200), country: 'UA', year: 2021, nowMs: NOW,
      candidates: [{ amount: 50400, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'unknown', model_year: 2021, source_url: 'https://example.com/p', source_host: 'example.com', source_excerpt: 'x', confidence: 'medium' }],
      vehicle: { fuel: 'electric', battery_kwh: 88 } });
    ok('4d8. приймальний випадок: сьогодні 19 000, середня контекстом, прогноз нижчий', accept.status === 'ok' && accept.current.value === 19000 && accept.current.source === 'listing_price'
      && accept.average.value === 23200 && near(accept.new_price.value, 50000, 54000) && accept.future.value < 19000);
    const reverse = V.buildValueCurve({ price: 27000, currency: 'USD', price_context: RIA(23200), country: 'UA', year: 2021, nowMs: NOW });
    ok('4d9. зворотний випадок: сьогодні 23 200, оголошення 27 000 окремо', reverse.current.value === 23200 && reverse.current.source === 'marketplace_average' && reverse.listing.value === 27000 && reverse.listing.delta_percent === 16 && reverse.average === null);
    const none = V.buildValueCurve({ ...base, price: 41000, price_context: null });
    ok('4e. H: без середньої якір це ціна оголошення, позначки немає', none.status === 'ok' && none.current.value === 41000 && none.current.source === 'listing_price' && none.listing === null);
    const otherCur = V.buildValueCurve({ ...base, price: 1700000, currency: 'UAH', price_context: RIA(45000) });
    ok('4f. E: середня в іншій валюті не порівнюється з ціною оголошення', otherCur.current.source === 'listing_price' && otherCur.current.value === 1700000 && otherCur.average === null && otherCur.market.currency === 'UAH' && otherCur.new_price.basis === 'reverse_estimate');
    ok('4g. ринок і валюта явні у контракті', above.market.country === 'UA' && above.market.currency === 'USD' && above.version === V.VALUE_VERSION);
    const wild = V.buildValueCurve({ ...base, price: 450000, price_context: RIA(45000) });
    ok('4h. очевидно хибна ціна оголошення ні якорем, ні позначкою не стає', wild.status === 'ok' && wild.listing === null && wild.current.value === 45000);
    const tiny = V.buildValueCurve({ ...base, price: 5000, price_context: RIA(45000) });
    ok('4h1. оголошення утричі дешевше за середню якорем не стає', tiny.current.value === 45000 && tiny.current.source === 'marketplace_average' && tiny.average === null);
  }
  ok('4i. без ціни графіка немає', V.buildValueCurve({ currency: 'USD', year: 2019, nowMs: NOW }).status === 'hidden');
  ok('4j. без року графіка немає', V.buildValueCurve({ price: 20000, currency: 'USD', nowMs: NOW }).reason === 'no_vehicle_year');
  ok('4k. без валюти графіка немає', V.buildValueCurve({ price: 20000, year: 2019, nowMs: NOW }).reason === 'no_currency');
  ok('4l. абсурдна ціна це відсутня ціна', V.buildValueCurve({ price: 12, currency: 'USD', year: 2019, nowMs: NOW }).status === 'hidden' && V.buildValueCurve({ price: 9e9, currency: 'USD', year: 2019, nowMs: NOW }).status === 'hidden');
  ok('4m. порожній виклик не падає', V.buildValueCurve().status === 'hidden');

  /* ===== 4. нова ціна ===== */
  const cand = (amount, o = {}) => ({ amount, currency: 'USD', market: 'UA', price_kind: 'local_list', trim_match: 'unknown', model_year: null, source_url: 'https://example.com/p', source_host: 'example.com', source_excerpt: 'x', confidence: 'medium', ...o });
  const np = o => V.resolveNewPrice({ market: 'UA', currency: 'USD', ...o, vehicle: { year: 2021, ...(o.vehicle || {}) } });
  {
    const r = np({ pc: 58500, T: 1, candidates: [] });
    ok('5a. I: без джерела зворотна оцінка, приблизна, не факт', r.basis === 'reverse_estimate' && r.approx === true && r.fact === null && near(r.value, 68000, 69500));
    /* RAV4: справжня ціна нижча за зворотну оцінку, і вона перемагає */
    const T = 5, pc = 22000, rev = V.reverseNewPrice(pc, T);
    const rav = np({ pc, T, candidates: [cand(27000)] });
    ok('5b. max(MSRP, зворотна) не застосовується', rev > 35000 && rav.basis === 'local_list' && rav.value === 27000 && rav.approx === true);
    const exact = np({ pc, T, candidates: [cand(27000, { trim_match: 'exact', text_years: [2021] })] });
    ok('5c. точна локальна ціна версії не позначена приблизною', exact.approx === false && exact.strength === 'strong' && exact.fact && exact.fact.amount === 27000);
    /* E: базовий MSRP нижчий за поточну ціну дорогої конфігурації */
    const porsche = np({ pc: 340000, T: 1.2, candidates: [cand(250000, { trim_match: 'base' })] });
    ok('5d. E: базова ціна під дорогою конфігурацією відкинута', porsche.basis === 'reverse_estimate' && porsche.value > 340000 && porsche.fact === null && porsche.rejected.some(x => x.reason === 'incompatible_with_current_value'));
    const curve = V.buildValueCurve({ price: 340000, currency: 'USD', country: 'UA', year: 2025, nowMs: NOW, candidates: [cand(250000, { trim_match: 'base' })] });
    ok('5e. E: графік не стартує нижче поточної ціни', curve.status === 'ok' && curve.points[0].value > 340000 && curve.points.every((p, i) => i === 0 || p.value < curve.points[i - 1].value));
    /* §30 B: точна локальна ціна не вища за ринок */
    const strongLow = V.buildValueCurve({ price: 30000, currency: 'USD', country: 'UA', year: 2024, nowMs: NOW, candidates: [cand(28000, { trim_match: 'exact', source_year: 2024 })] });
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
    ok('5y. MSRP іншого модельного року не якір', byCandYear.basis === 'reverse_estimate' && byCandYear.rejected.some(r => r.reason === 'msrp_other_model_year'));
    const byMy = np({ pc: 23700, T: 5.2, candidates: [cand(45000, { market: 'US', price_kind: 'source_msrp', model_year: 2022 })], vehicle: { fuel: 'electric', battery_kwh: 88, year: 2021, model_year: 2022 } });
    ok('5y1. модельний рік з декодера чи аналізу теж підходить', byMy.basis === 'localized_msrp' && byMy.localization === 'ua_bev_2019_2025');

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
    const uah = np({ pc: 40000, T: 3, candidates: [cand(2300000, { currency: 'UAH', model_year: 2023, source_year: 2023 })], vehicle: { year: 2023 } });
    ok('5n. гривнева ціна приводиться до USD за курсом року', uah.basis === 'local_list' && near(uah.value, 60000, 66000) && uah.fact.amount === 2300000 && uah.fact.currency === 'UAH');
    ok('5o. стара гривнева ціна без курсу не перераховується', V.toUsd(100000, 'UAH', 2001) === null && V.toUsd(100, 'GBP', 2020) === null && V.toUsd(100, 'USD', 2020) === 100);
    const c2 = V.buildValueCurve({ price: 22000, currency: 'USD', country: 'UA', year: 2021, nowMs: NOW, candidates: [cand(27000, { trim_match: 'exact', text_years: [2021] })], identity: { make: 'Make', model: 'Model', generation: 'G1', trim: 'T1' } });
    ok('5p. факт несе область MI: марка, модель, покоління, версія, рік, ринок, валюта, джерело, довіра',
      c2.new_price.fact && ['make', 'model', 'generation', 'trim', 'model_year', 'market', 'currency', 'amount', 'source_url', 'confidence'].every(k => c2.new_price.fact[k] !== undefined && c2.new_price.fact[k] !== null));
    const c3 = V.buildValueCurve({ price: 22000, currency: 'USD', country: 'UA', year: 2021, nowMs: NOW });
    ok('5q. розрахована оцінка фактом не стає', c3.new_price.basis === 'reverse_estimate' && c3.new_price.fact === null && c3.new_price.approx === true);
    ok('5r. запобіжник росте з віком і обмежений', V.minNewToCurrentRatio(0) === 1 && Math.abs(V.minNewToCurrentRatio(1) - 1.06) < 1e-9 && Math.abs(V.minNewToCurrentRatio(30) - 1.14) < 1e-9);
  }

  /* ===== походження ціни нового авто: узгодженість у часі і драбина цін ===== */
  {
    /* реальний випадок: авто 2021 року, жива сторінка цін дилера без дати,
       чотири гривневі ціни без назв версій */
    const results = [{ ref: 'S1', url: 'https://dealer.example.ua/auto/new-cars/model/prices-and-specs.html', host: 'dealer.example.ua', title: 'Ціни та комплектації',
      snippet: 'офіційний дилер 608 300 грн ЗАВАНТАЖИТИ ・ 697 180 грн ЗАВАНТАЖИТИ ・ 790 740 грн ЗАВАНТАЖИТИ ・ 946 130 грн ЗАВАНТАЖИТИ', date: null }];
    const raw = [{ result_ref: 'S1', amount: 697180, currency: 'UAH', market: 'UA', price_kind: 'local_list', trim_match: 'unknown', model_year: 2021 },
      { result_ref: 'S1', amount: 608300, currency: 'UAH', market: 'UA', price_kind: 'local_list', trim_match: 'base', model_year: 2021 }];
    const v = V.validateCandidates(raw, results, { brand: 'Brand', year: 2021, nowYear: 2026 });
    ok('6g. кандидат несе факти про час джерела і драбину цін', v.candidates.length === 2 && v.candidates[0].source_year === null && v.candidates[0].text_years.length === 0 && v.candidates[0].price_ladder === true);
    const xt = V.buildValueCurve({ price: 20700, currency: 'USD', price_context: RIA(24020), country: 'UA', year: 2021, nowMs: NOW, candidates: v.candidates, vehicle: { fuel: 'petrol', displacement_l: 2.5 } });
    ok('6h. 1: гривнева ціна без дати не стає ціною року авто', xt.new_price.basis === 'reverse_estimate' && xt.new_price.fact === null && xt.new_price.source === null
      && xt.new_price.rejected.length === 2 && xt.new_price.rejected.every(r => r.reason === 'price_date_unknown'));
    ok('6i. 3: працює зворотна оцінка, і причина видна у звіті', xt.new_price.rejection_reason === 'price_date_unknown' && xt.new_price.approx === true
      && xt.new_price.rejected[0].amount === 697180 && xt.new_price.rejected[0].currency === 'UAH' && /dealer\.example\.ua/.test(xt.new_price.rejected[0].ref));
    const oldBad = Math.round(697180 / 27.29);
    ok('6j. 19: якір більше не біля поточної ціни, траєкторія не пласка', xt.status === 'ok' && xt.new_price.value > oldBad * 1.25 && xt.new_price.value > 20700 * 1.5 && xt.current.value === 20700 && xt.future.value < 20700);
    /* найбільше падіння на початку, далі повільніше */
    const at = t => xt.points.reduce((b, p) => Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b).value;
    ok('6k. 19: перший рік втрачає більше, ніж кожен наступний', (xt.points[0].value - at(1)) > (at(1) - at(2)) && (at(1) - at(2)) > (at(4) - at(5)));

    const dated = o => ({ amount: 946130, currency: 'UAH', market: 'UA', price_kind: 'local_list', trim_match: 'exact', model_year: 2021, source_url: 'https://example.com/a', source_host: 'example.com', source_excerpt: 'x', confidence: 'medium', source_date: null, source_year: null, text_years: [], price_ladder: false, ...o });
    const good = np({ pc: 20700, T: 5.25, candidates: [dated({ source_date: '12 бер. 2021 р.', source_year: 2021 })] });
    ok('6l. 2: та сама версія, дата джерела в році авто: сильний якір за курсом того року', good.basis === 'local_list' && good.strength === 'strong' && good.approx === false && near(good.value, 33000, 36000) && good.fact.price_year === 2021);
    const later = np({ pc: 20700, T: 5.25, candidates: [dated({ source_date: '3 лют. 2023 р.', source_year: 2023 })] });
    ok('6m. 1: сторінка помітно пізніша за рік авто: ціна не якір', later.basis === 'reverse_estimate' && later.rejected[0].reason === 'source_date_mismatch' && later.rejected[0].source_date === '3 лют. 2023 р.');
    const inText = np({ pc: 20700, T: 5.25, candidates: [dated({ text_years: [2021] })] });
    ok('6n. без дати, але рік авто стоїть у тексті джерела: приймається', inText.basis === 'local_list' && inText.fact.price_year === 2021);
    const laterText = np({ pc: 20700, T: 5.25, candidates: [dated({ text_years: [2021, 2024] })] });
    ok('6o. у тексті є пізніший рік: не приймається', laterText.basis === 'reverse_estimate' && laterText.rejected[0].reason === 'source_date_mismatch');
    const ladder = np({ pc: 20700, T: 5.25, candidates: [dated({ trim_match: 'unknown', source_year: 2021, price_ladder: true })] });
    ok('6p. драбина цін без назви версії: не якір навіть з датою', ladder.basis === 'reverse_estimate' && ladder.rejected[0].reason === 'ambiguous_trim_ladder');
    const usdUndated = np({ pc: 20700, T: 5.25, candidates: [dated({ amount: 34000, currency: 'USD' })] });
    ok('6q. ціна в USD без дати лишається слабким якорем, сильним не стає', usdUndated.basis === 'local_list' && usdUndated.strength === 'weak' && usdUndated.approx === true);
    const usdLate = np({ pc: 20700, T: 5.25, candidates: [dated({ amount: 34000, currency: 'USD', source_year: 2025 })] });
    ok('6r. ціна в USD з пізнішої сторінки: не якір', usdLate.basis === 'reverse_estimate' && usdLate.rejected[0].reason === 'source_date_mismatch');
    ok('6s. рік з дати пошуковика', V.sourceYear('12 бер. 2022 р.', 2026) === 2022 && V.sourceYear('Mar 3, 2021', 2026) === 2021 && V.sourceYear('3 days ago', 2026) === 2026 && V.sourceYear(null, 2026) === null && V.sourceYear('', 2026) === null);
    ok('6t. роки в тексті не плутаються з цінами', JSON.stringify(V.yearsInText('Nissan X-Trail 2021: від 697 180 грн, 2 021 000, оновлення 2023')) === JSON.stringify([2021, 2023]) && V.yearsInText('ціна 2 025 000 грн').length === 0);
    ok('6u. драбина: три і більше цін одного порядку', V.pricesNear(697180, results[0].snippet) === 4 && V.pricesNear(39820, 'Starting MSRP $39,820 for 2025') === 1);
    const prov = good.fact;
    const provCurve = V.buildValueCurve({ price: 20700, currency: 'USD', country: 'UA', year: 2021, nowMs: NOW, candidates: [dated({ source_date: '12 бер. 2021 р.', source_year: 2021 })] });
    ok('6v. походження у звіті: джерело, ціна, валюта, дата, рік ціни, ринок', prov && provCurve.new_price.source && provCurve.new_price.source.url === 'https://example.com/a' && provCurve.new_price.source.price === 946130
      && provCurve.new_price.source.currency === 'UAH' && provCurve.new_price.source.date === '12 бер. 2021 р.' && provCurve.new_price.source.price_year === 2021 && provCurve.new_price.source.market === 'UA'
      && provCurve.new_price.rejection_reason === null && provCurve.new_price.basis === 'local_list');
    ok('6w. без курсів і без мереж: узгодженість рахується з уже зібраного', !/fetch\(|exchange|nbu|bank\.gov/i.test(fs.readFileSync('api/value.js', 'utf8').replace(/searchSerper|deps\.callModel/g, '')));
  }

  /* ===== MSRP модельного року: точна версія, медіана сімʼї, середина ===== */
  {
    /* офіційний прайс модельного року з кількома версіями в одному джерелі */
    const results = [{ ref: 'S1', url: 'https://media.example.com/2014-model-suggested-retail-prices', host: 'media.example.com', title: '2014 Model Suggested Retail Prices',
      snippet: 'V350 AWD $63,000 · V450 AWD $64,550 · V550 AWD $88,600 · V63 $118,160', date: 'Oct 14, 2013' }];
    const raw = [['V350 AWD', 63000], ['V450 AWD', 64550], ['V550 AWD', 88600], ['V63', 118160]].map(([v, a]) => ({ result_ref: 'S1', amount: a, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'unknown', model_year: 2014, version: v }));
    const v = V.validateCandidates(raw, results, { brand: 'Brand', year: 2014, nowYear: 2026 });
    ok('13a. усі ціни версій з одного джерела проходять з назвами версій', v.candidates.length === 4 && v.candidates.map(c => c.version).join('|') === 'V350 AWD|V450 AWD|V550 AWD|V63');
    const gl = (trim, cands, extra) => V.buildValueCurve({ price: 20900, currency: 'USD', country: 'UA', year: 2014, nowMs: NOW, candidates: cands,
      vehicle: { fuel: 'petrol', displacement_l: 3, make: 'Brand', model: 'Model', trim, model_year: 2015, ...(extra || {}) } });
    const rev = gl(null, []);
    ok('13b. G: без MSRP працює зворотна оцінка без змін', rev.new_price.basis === 'reverse_estimate' && rev.new_price.msrp === null && rev.new_price.value === Math.round(V.reverseNewPrice(20900, V.vehicleAgeYears(2014, NOW))));
    /* GL-подібний випадок: версія невідома, 4 ціни версій: медіана */
    const med = gl(null, v.candidates);
    ok('13c. C, H: версія невідома, 4 ціни: середнє двох центральних, зворотна оцінка нижче діапазону не вибирає', med.status === 'ok' && med.new_price.basis === 'msrp_median' && med.new_price.value === 76575
      && rev.new_price.value < 63000 && med.new_price.approx === true && med.new_price.fact === null);
    const sel = med.new_price.msrp && med.new_price.msrp.selection;
    ok('13d. походження вибору: метод, рік, кількість, ціни, межі, обране, джерело, версія невідома', sel && sel.method === 'msrp_median' && sel.model_year === 2014 && sel.candidate_count === 4
      && JSON.stringify(sel.values) === JSON.stringify([63000, 64550, 88600, 118160]) && sel.min === 63000 && sel.max === 118160 && sel.selected === 76575 && sel.localization === null
      && /media\.example\.com/.test(sel.sources[0]) && sel.trim_known === false && sel.exact_trim_matched === false);
    ok('13e. прогноз від нового якоря нижчий за сьогодні; формула кривої та сама', med.current.value === 20900 && med.future.value < 20900 && med.points[0].value === 76575
      && Math.abs(med.points.find(p => p.today).value - 20900) < 1);
    const exact = gl('V450', v.candidates);
    ok('13f. A: відома версія: точна MSRP версії, а не медіана сімʼї', exact.new_price.basis === 'source_msrp' && exact.new_price.value === 64550
      && exact.new_price.msrp.exact.version === 'V450 AWD' && exact.new_price.msrp.selection.method === 'exact_version' && exact.new_price.fact.amount === 64550);
    const unmatched = gl('V500', v.candidates);
    ok('13f1. версію знаємо, але її ціни в джерелі нема: медіана, і це видно в походженні', unmatched.new_price.basis === 'msrp_median' && unmatched.new_price.msrp.selection.trim_known === true && unmatched.new_price.msrp.selection.exact_trim_matched === false);
    const single = gl('V450', [v.candidates[1]]);
    ok('13g. одна MSRP саме цієї версії без відомого режиму ввезення: береться як є', single.new_price.basis === 'source_msrp' && single.new_price.value === 64550 && !single.new_price.localization);
    const singleUnknown = gl(null, [v.candidates[1]]);
    ok('13h. одна MSRP невідомої версії без режиму ввезення: не якір і не сімʼя', singleUnknown.new_price.basis === 'reverse_estimate' && singleUnknown.new_price.rejection_reason === 'historical_localization_unknown');
    /* B, D, E: 5, 3, 2 ціни */
    const fam = list => list.map((a, k) => ({ ...v.candidates[0], amount: a, version: 'V' + k }));
    const r5 = gl(null, fam([60000, 70000, 80000, 90000, 150000]));
    ok('13i. B: 5 цін: середня за порядком', r5.new_price.basis === 'msrp_median' && r5.new_price.value === 80000 && r5.new_price.msrp.selection.candidate_count === 5);
    const r3 = gl(null, fam([100000, 60000, 70000]));
    ok('13j. D: 3 ціни: середня за порядком', r3.new_price.basis === 'msrp_median' && r3.new_price.value === 70000);
    const r2 = gl(null, fam([60000, 100000]));
    ok('13j1. E, F: 2 ціни (або лише межі min/max): середина', r2.new_price.basis === 'msrp_midpoint' && r2.new_price.value === 80000 && r2.new_price.msrp.selection.min === 60000 && r2.new_price.msrp.selection.max === 100000);
    const dupes = gl(null, fam([63000, 63000, 88600, 88600]));
    ok('13j2. однакові ціни рахуються як одна', dupes.new_price.basis === 'msrp_midpoint' && dupes.new_price.value === 75800 && dupes.new_price.msrp.selection.candidate_count === 2);
    /* I: зворотна оцінка вища за всю сімʼю: медіана все одно */
    const high = V.buildValueCurve({ price: 60000, currency: 'USD', country: 'UA', year: 2014, nowMs: NOW, candidates: v.candidates, vehicle: { fuel: 'petrol', displacement_l: 3, model_year: 2014 } });
    ok('13k. I: зворотна оцінка вища за найдорожчу версію: обрана медіана', V.reverseNewPrice(60000, high.age_years) > 118160 && high.new_price.basis === 'msrp_median' && high.new_price.value === 76575);
    /* медіана нижча за поточну ціну: базові ціни під дорогою конфігурацією, не якір */
    const optioned = V.buildValueCurve({ price: 170000, currency: 'USD', country: 'UA', year: 2025, nowMs: NOW,
      candidates: v.candidates.map(c => ({ ...c, model_year: 2025 })), vehicle: { fuel: 'petrol', displacement_l: 3, model_year: 2025 } });
    ok('13k1. медіана нижча за поточну ціну: не якір, графік не йде вгору', optioned.status === 'ok' && optioned.new_price.basis === 'reverse_estimate' && optioned.new_price.rejected.some(r => r.reason === 'incompatible_with_current_value')
      && optioned.points.every((p, k) => k === 0 || p.value < optioned.points[k - 1].value));
    /* MSRP США з відомим режимом ввезення: медіана локалізується */
    const rav = [['LE', 26250], ['XLE', 28960], ['Limited', 36380]].map(([ver, a]) => ({ amount: a, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'unknown', model_year: 2021, version: ver,
      source_url: 'https://example.com/rav', source_host: 'example.com', source_excerpt: 'x', confidence: 'medium', source_date: null, source_year: null, text_years: [2021], price_ladder: false }));
    const ravMed = V.buildValueCurve({ price: 27000, currency: 'USD', country: 'UA', year: 2021, nowMs: NOW, candidates: rav, vehicle: { fuel: 'petrol', displacement_l: 2.5 } });
    ok('13l. медіана MSRP США з режимом ввезення року локалізується', ravMed.new_price.basis === 'msrp_median' && ravMed.new_price.msrp.selection.selected === 28960
      && ravMed.new_price.value === Math.round(V.localizeUsMsrpToUA(28960, { fuel: 'petrol', displacement_l: 2.5, year: 2021 }).value) && ravMed.new_price.localization === 'ua_ice_2019');
    /* J, K: інший модельний рік і різні джерела */
    const other = V.buildValueCurve({ price: 20900, currency: 'USD', country: 'UA', year: 2014, nowMs: NOW, candidates: v.candidates.map(c => ({ ...c, model_year: 2017 })), vehicle: { fuel: 'petrol', model_year: 2014 } });
    ok('13m. J: ціни іншого модельного року в сімʼю не йдуть', other.new_price.basis === 'reverse_estimate' && other.new_price.rejected.every(r => r.reason === 'msrp_other_model_year'));
    const mixed = V.resolveNewPrice({ market: 'UA', currency: 'USD', pc: 20900, T: 12.25, vehicle: { year: 2014 }, candidates: [
      { ...v.candidates[0], source_url: 'https://a.example/1' }, { ...v.candidates[3], source_url: 'https://b.example/2' }] });
    ok('13m1. K: ціни з різних джерел (інша модель чи покоління) в одну сімʼю не складаються', mixed.basis === 'reverse_estimate' && mixed.msrp === null);
    const otherMarket = V.resolveNewPrice({ market: 'UA', currency: 'USD', pc: 20900, T: 12.25, vehicle: { year: 2014 }, candidates: v.candidates.map(c => ({ ...c, market: 'EU', currency: 'EUR' })) });
    ok('13m2. ціни іншого ринку в сімʼю не йдуть', otherMarket.basis === 'reverse_estimate' && otherMarket.rejected.every(r => r.reason === 'market_not_supported'));
    /* лише стартова ціна: нижня межа, не сімʼя */
    const base = gl(null, [{ ...v.candidates[0], trim_match: 'base' }]);
    ok('13m3. лише стартова ціна моделі року: нижня межа для зворотної оцінки', base.new_price.basis === 'msrp_base_floor' && base.new_price.value === 63000 && base.new_price.msrp.selection.method === 'base_floor');
    ok('13m4. медіана без ваг популярності і без імовірностей', !/popular|weight|probab|share/i.test(fs.readFileSync('api/value.js', 'utf8').slice(fs.readFileSync('api/value.js', 'utf8').indexOf('/* D. версія невідома'), fs.readFileSync('api/value.js', 'utf8').indexOf('/* E. одна MSRP'))));
    ok('13m5. сохранність рахується від медіани як від джерела, не unknown', med.retention.state !== 'unknown' && med.retention.basis === 'msrp_median');
    ok('13n. зіставлення версій: привід і назва моделі не заважають, інша версія не збігається', V.trimMatches('GL 450 4MATIC', 'GL450', { model: 'GL-Class' }) && V.trimMatches('Highlander Limited AWD', 'Limited', { model: 'Highlander' })
      && !V.trimMatches('Limited Platinum', 'Limited', {}) && !V.trimMatches('V450', 'V350', {}) && !V.trimMatches(null, 'X', {}) && !V.trimMatches('X', '', {}));
    ok('13o. у модулі немає цін моделей і марок', !/mercedes|gl-class|gl450|63,?000|64,?550/i.test(fs.readFileSync('api/value.js', 'utf8')));
    ok('13q. пояснення джерела ціни нового авто для кожного методу', ['reverse_estimate', 'localized_msrp', 'local_list', 'source_msrp', 'msrp_range', 'msrp_median', 'msrp_midpoint', 'msrp_base_floor'].every(k => new RegExp('\\b' + k + ': t\\(').test(fs.readFileSync('result-check.html', 'utf8'))));
    ok('13p. правило витягу: кожна версія окремим записом з назвою', /return EVERY version price as a separate entry/.test(V.VALUE_RULES) && V.valueResponseFormat().json_schema.schema.properties.new_price_candidates.items.required.includes('version'));
  }

  /* ===== New price v2.1: спершу версія, далі технічний еквівалент, агрегат, сімʼя ===== */
  {
    const PT = (fuel, d, cyl, hp, drive, perf = false) => ({ fuel, displacement_l: d, cylinders: cyl, power_hp: hp, drive, performance: perf });
    const mk = (version, amount, pt, url = 'https://example.com/v') => ({ amount, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'unknown', model_year: 2013, version, powertrain: pt,
      source_url: url, source_host: 'example.com', source_excerpt: 'x', confidence: 'medium', source_date: null, source_year: null, text_years: [2013], price_ladder: false });
    /* сімʼя модельного року ринку США: дизель, два бензинові V8 4.7 різної віддачі, AMG */
    const fam = [mk('X350 BlueTEC 4MATIC', 63000, PT('diesel', 3.0, 6, 240, 'awd')), mk('X450 4MATIC', 64550, PT('petrol', 4.7, 8, 362, 'awd')),
      mk('X550 4MATIC', 88600, PT('petrol', 4.7, 8, 429, 'awd')), mk('X63 AMG', 118160, PT('petrol', 5.5, 8, 550, 'awd', true))];
    const veh = (over = {}) => ({ fuel: 'petrol', engine: '4,7 л бензин V8, 435 л.с.', drive: 'полный', trim: 'X 500 4Matic', title: 'Brand X-Class 2013', make: 'Brand', model: 'X-Class', model_year: null, ...over });
    const run = (cands, over) => V.buildValueCurve({ price: 17999, currency: 'USD', price_context: { average_price: 27000, currency: 'USD', source_name: 'AUTO.RIA' }, country: 'UA', year: 2013, nowMs: NOW, candidates: cands, vehicle: veh(over) });
    /* 1-3: точна версія і її написання */
    const ex = run([...fam, mk('X500 4MATIC', 92000, PT('petrol', 4.7, 8, 435, 'awd'))]);
    ok('15a. 1, 2: точна версія X500 перемагає еквівалент, агрегат і сімʼю', ex.new_price.basis === 'source_msrp' && ex.new_price.value === 92000 && ex.new_price.msrp.selection.method === 'exact_version'
      && ex.new_price.msrp.selection.exact_version_candidates.length === 1);
    ok('15b. 3: X500 / X 500 / X500 4MATIC / X 500 4Matic одна версія', ['X500', 'X 500', 'X500 4MATIC', 'X 500 4Matic'].every(v => V.trimMatches(v, 'X 500 4Matic', { model: 'X-Class' })) && !V.trimMatches('X550 4MATIC', 'X 500 4Matic', { model: 'X-Class' }));
    /* 4: точної нема, є технічний еквівалент іншого ринку */
    const eq = run(fam);
    ok('15c. 4: точної версії нема: X550 (4.7 V8 бензин 429 к.с., повний) еквівалент X500 435 к.с.', eq.new_price.basis === 'msrp_equivalent_version' && eq.new_price.value === 88600
      && eq.new_price.msrp.selection.method === 'equivalent_version' && eq.new_price.msrp.selection.equivalent_version_candidates.map(c => c.version).join() === 'X550 4MATIC', JSON.stringify(eq.new_price.msrp && eq.new_price.msrp.selection.rejected_versions));
    const sel = eq.new_price.msrp.selection;
    ok('15d. провенанс: версія і агрегат авто, усі кандидати, причини відмов', sel.vehicle_version === 'X 500 4Matic' && sel.vehicle_powertrain.displacement_l === 4.7 && sel.vehicle_powertrain.power_hp === 435
      && sel.all_candidates.length === 4 && sel.rejected_versions.some(r => r.version === 'X350 BlueTEC 4MATIC' && r.reason === 'wrong_fuel') && sel.rejected_versions.some(r => r.version === 'X63 AMG' && r.reason === 'performance_mismatch')
      && sel.rejected_versions.some(r => r.version === 'X450 4MATIC' && r.reason === 'different_output') && sel.selected === 88600 && sel.market === 'US');
    /* 5: сам лише V8 нічого не доводить */
    const v8only = V.compareTechnical(V.vehiclePowertrain({ engine: 'V8' }), V.cleanPowertrain(PT('petrol', 4.7, 8, 429, 'awd')));
    ok('15e. 5: лише "V8" не робить еквівалентом', v8only.level !== 'equivalent');
    const noPower = run(fam, { engine: '4,7 л бензин V8' });
    ok('15f. 5: без потужності однаковий V8 4.7 це лише сумісний агрегат, не еквівалент', noPower.new_price.basis === 'msrp_powertrain_midpoint' && noPower.new_price.value === 76575
      && noPower.new_price.msrp.selection.equivalent_version_candidates.length === 0 && noPower.new_price.msrp.selection.powertrain_candidates.length === 2);
    /* 6, 7: лінійка продуктивності */
    ok('15g. 6: звичайний V8 не бере AMG', !eq.new_price.msrp.selection.powertrain_candidates.some(c => /AMG/.test(c.version)));
    const amg = run(fam, { engine: '5,5 л бензин V8, 557 л.с.', trim: 'X 63 AMG', title: 'Brand X 63 AMG 2013' });
    ok('15h. 7: справжній AMG бере AMG-ціну (тут навіть точною назвою)', amg.new_price.value === 118160 && ['source_msrp', 'msrp_equivalent_version'].includes(amg.new_price.basis));
    const amgEq = run(fam, { engine: '5,5 л бензин V8, 557 л.с.', trim: 'Performance 63', title: 'Brand X AMG 2013' });
    ok('15h1. 7: AMG під іншою назвою: технічний еквівалент лише серед AMG', amgEq.new_price.basis === 'msrp_equivalent_version' && amgEq.new_price.value === 118160);
    /* 8, 9: агрегат без еквівалента */
    const three = [mk('A 4.7', 60000, PT('petrol', 4.7, 8, 300, 'awd')), mk('B 4.7', 70000, PT('petrol', 4.7, 8, 340, 'awd')), mk('C 4.7', 100000, PT('petrol', 4.7, 8, 380, 'awd')), mk('D diesel', 50000, PT('diesel', 3.0, 6, 240, 'awd'))];
    const pt3 = run(three);
    ok('15i. 8: три сумісні агрегати: медіана саме їх', pt3.new_price.basis === 'msrp_powertrain_median' && pt3.new_price.value === 70000 && pt3.new_price.msrp.selection.powertrain_candidates.length === 3);
    const pt2 = run(three.slice(1));
    ok('15j. 9: два сумісні: середина', pt2.new_price.basis === 'msrp_powertrain_midpoint' && pt2.new_price.value === 85000);
    /* 10: одна слабка сумісність: уся сімʼя */
    const weakOne = run([mk('A 4.7', 60000, PT('petrol', 4.7, 8, 300, 'awd')), mk('D diesel', 50000, PT('diesel', 3.0, 6, 240, 'awd')), mk('E diesel', 90000, PT('diesel', 3.0, 6, 300, 'awd'))]);
    ok('15k. 10: одна слабка сумісна ціна: медіана всієї сімʼї', weakOne.new_price.basis === 'msrp_median' && weakOne.new_price.value === 60000);
    /* 11: без даних про агрегат: як було */
    const noMeta = run(fam.map(c => ({ ...c, powertrain: null })), { engine: null, fuel: null, drive: null });
    ok('15l. 11: без метаданих агрегату: медіана сімʼї як у 1e68e3d', noMeta.new_price.basis === 'msrp_median' && noMeta.new_price.value === 76575);
    /* 12: без MSRP */
    const none = run([]);
    ok('15m. 12: без MSRP: зворотна оцінка', none.new_price.basis === 'reverse_estimate');
    /* обладнання і коефіцієнти */
    const src = fs.readFileSync('api/value.js', 'utf8');
    ok('15n. двигун не виводить обладнання і не множить ціну', !/equipment|burmester|massage|panoram/i.test(src.slice(src.indexOf('/* ---------- Силовий агрегат для вибору MSRP'), src.indexOf('/* Чи та сама версія')))
      && !/\* ?1\.\d|price\s*\*|premium_factor|coefficient/i.test(src.slice(src.indexOf('export function compareTechnical'), src.indexOf('const centralOf'))));
    ok('15o. витяг: агрегат версії в тому самому виклику', /powertrain: the powertrain of THAT version/.test(V.VALUE_RULES) && V.valueResponseFormat().json_schema.schema.properties.new_price_candidates.items.required.includes('powertrain'));
    const v = V.validateCandidates([{ result_ref: 'S1', amount: 88600, currency: 'USD', market: 'US', price_kind: 'source_msrp', trim_match: 'unknown', model_year: 2013, version: 'X550', powertrain: { fuel: 'petrol', displacement_l: 4.7, cylinders: 8, power_hp: 429, drive: 'awd', performance: false } }],
      [{ ref: 'S1', url: 'https://e.x/p', host: 'e.x', title: '2013 X550 MSRP', snippet: '$88,600' }], { year: 2013 });
    ok('15p. кандидат несе чистий агрегат', v.candidates[0].powertrain.power_hp === 429 && v.candidates[0].powertrain.performance === false && JSON.stringify(V.cleanPowertrain({ fuel: 'coal', cylinders: 99, displacement_l: 'x' })) === JSON.stringify({ fuel: null, displacement_l: null, cylinders: null, power_hp: null, drive: null, performance: false }));
    ok('15q. розбір двигуна звіту', JSON.stringify(V.vehiclePowertrain({ fuel: 'petrol', engine: '4,7 л бензин V8, 435 л.с.', drive: 'полный', trim: 'GL 500 4Matic' })) === JSON.stringify(PT('petrol', 4.7, 8, 435, 'awd'))
      && V.vehiclePowertrain({ engine: '2,0 л дизель, 140 кВт' }).power_hp === 188 && V.vehiclePowertrain({ engine: '3.0 TDI 249 к.с.' }).fuel === 'diesel' && V.vehiclePowertrain({ trim: 'GL 63 AMG' }).performance === true && V.vehiclePowertrain({ trim: 'M Sport' }).performance === false);
    /* 19: медіана нижча за поточну ціну відкидається */
    const low = V.buildValueCurve({ price: 130000, currency: 'USD', country: 'UA', year: 2013, nowMs: NOW, candidates: fam, vehicle: veh() });
    ok('15r. 19: еквівалент нижчий за поточну ціну: не якір, зворотна оцінка, сохранність невідома', low.new_price.basis === 'reverse_estimate' && low.new_price.rejected.some(r => r.reason === 'incompatible_with_current_value') && low.retention.state === 'unknown');
    /* 13-18: сохранність за методом */
    const r = basis => V.retentionContext({ newPrice: 100000, basis, representative: 24000, T: 12.25 }).state;
    ok('15s. 13-16: точна, еквівалент, агрегат, сімʼя: сохранність рахується', ['source_msrp', 'localized_msrp', 'msrp_equivalent_version', 'msrp_powertrain_median', 'msrp_powertrain_midpoint', 'msrp_median', 'msrp_midpoint', 'local_list'].every(b => r(b) === 'heavy_depreciation'));
    ok('15t. 17, 18: стартова ціна і зворотна оцінка: невідомо', r('msrp_base_floor') === 'unknown' && r('reverse_estimate') === 'unknown' && V.retentionBasisMeaningful('msrp_base_floor') === false && V.RETENTION_UNKNOWN_BASIS.size === 2);
    ok('15u. пояснення під графіком для нових методів', ['msrp_equivalent_version', 'msrp_powertrain_median', 'msrp_powertrain_midpoint'].every(k => new RegExp('\\b' + k + ': t\\(').test(fs.readFileSync('result-check.html', 'utf8'))));
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
  const F = (direction, text) => ({ direction, text });
  {
    const s = V.sanitizeMarketValue({ liquidity: { level: 'high', reasons: ['Популярна модель \u2014 широкий попит', 'Друга причина', 'Третя причина', 'Четверта причина'] },
      price_forces: [F('supports', 'Один чинник тримає ціну'), F('reduces', 'Два чинники знижують ціну'), F('supports', 'Три'), F('reduces', 'Чотири чинники'), F('supports', 'Пʼять чинників'), F('reduces', 'Шість чинників'), F('supports', 'Сім чинників'),
        F('sideways', 'Невідомий напрямок'), { text: 'без напрямку' }, F('reduces', 'один чинник тримає ціну')] });
    ok('7a. не більше 3 причин і 6 сил з напрямком', s.liquidity.reasons.length === 3 && s.price_forces.length === 6 && s.price_forces.every(f => ['supports', 'reduces'].includes(f.direction)));
    ok('7b. довге тире прибрано', !/[\u2014\u2013]/.test(JSON.stringify(s)) && s.liquidity.reasons[0] === 'Популярна модель, широкий попит');
    const dup = V.sanitizeMarketValue({ liquidity: { level: 'low', reasons: ['Вузьке коло покупців'] }, price_forces: [F('reduces', 'вузьке коло покупців'), F('reduces', 'Дороге утримання прискорює втрату вартості')] });
    ok('7c. картки не повторюють одне речення', dup.price_forces.length === 1 && dup.price_forces[0].text === 'Дороге утримання прискорює втрату вартості');
    ok('7d. невідомий рівень це unknown, без числових оцінок', V.sanitizeMarketValue({ liquidity: { level: '8.7/10', reasons: ['Причина така'] }, price_forces: [] }).liquidity.level === 'unknown');
    ok('7e. порожня відповідь це null', V.sanitizeMarketValue({ liquidity: { level: 'high', reasons: [] }, price_forces: [] }) === null && V.sanitizeMarketValue(null) === null);
    ok('7f. рівень без причин не показується як факт', V.sanitizeMarketValue({ liquidity: { level: 'high', reasons: [] }, price_forces: [F('supports', 'Один чинник')] }).liquidity.level === 'unknown');
    const schema = V.valueResponseFormat().json_schema;
    ok('7g. схема strict: ліквідність, сили з напрямком, кандидати', schema.strict === true && JSON.stringify(schema.schema.required) === JSON.stringify(['liquidity', 'price_forces', 'new_price_candidates'])
      && JSON.stringify(schema.schema.properties.price_forces.items.properties.direction.enum) === JSON.stringify(['supports', 'reduces']));
    ok('7h. правила: без памʼяті про ціни, технічні твердження лише з контексту', /Never supply a price from memory/.test(V.VALUE_RULES) && /ONLY when MODEL_CONTEXT supports/.test(V.VALUE_RULES) && /level "unknown"/.test(V.VALUE_RULES));
    ok('7i. ліквідність це модель і версія, не це оголошення: без ціни, знижки, середньої, стану, історії', /marketability of the model and version, not of this particular listing/.test(V.VALUE_RULES)
      && /Never use: this listing's price, any discount or the marketplace average, the seller, or this car's condition, mileage, accident, flood or history/.test(V.VALUE_RULES)
      && !/price position against the marketplace average/.test(V.VALUE_RULES));
    ok('7j. сили ціни пояснюють сохранність вартості, голий атрибут неприйнятний', /how well THIS MODEL AND VERSION keeps its original value as it ages/.test(V.VALUE_RULES) && /A bare attribute \("All-wheel drive", "Premium positioning", "Practical body"\) is not acceptable/.test(V.VALUE_RULES)
      && /Never mention this listing's price, any discount, the marketplace average, the seller, or this car's condition, mileage, accident, flood or history/.test(V.VALUE_RULES));
    ok('7k. та сама причина в обох картках можлива, але кожна відповідає на своє питання', /liquidity explains ease of resale and price_forces explains retained value/.test(V.VALUE_RULES));
  }

  /* ===== сохранність вартості і вибір історії картки ===== */
  {
    ok('14a. базова крива та сама, що у зворотної оцінки', /const observed = pc \/ p0, expected = retentionFactor\(t\), index = observed \/ expected;/.test(fs.readFileSync('api/value.js', 'utf8')));
    ok('14b. пороги в одному місці', V.RETENTION_THRESHOLDS.heavy === 0.8 && V.RETENTION_THRESHOLDS.strong === 1.2);
    const ctx = (p0, pc, T, basis = 'local_list') => V.retentionContext({ newPrice: p0, basis, representative: pc, representativeSource: 'marketplace_average', T });
    /* A: старий преміальний SUV */
    const a = ctx(105000, 24000, 12.25);
    ok('14c. A: новий понад $100k, 12 років, зараз $24k: сильна амортизація', a.state === 'heavy_depreciation' && a.retention_index < 0.8, JSON.stringify(a));
    /* B: машина, що тримає ціну */
    const b = ctx(35000, 27000, 5.25);
    ok('14d. B: $35k, 5 років, $27k: хороша сохранність', b.state === 'strong_retention' && b.retention_index > 1.2, JSON.stringify(b));
    /* C: звичайна масова машина */
    const c = ctx(30000, 15500, 5.25);
    ok('14e. C: звичайна амортизація', c.state === 'normal_depreciation', JSON.stringify(c));
    /* D: ціна нового відновлена зворотною оцінкою: висновок був би циклічним */
    const d = ctx(V.reverseNewPrice(20000, 6), 20000, 6, 'reverse_estimate');
    ok('14f. D: ціна нового зі зворотної оцінки: стан unknown без циклічного висновку', d.state === 'unknown' && d.reason === 'new_price_from_reverse_estimate' && Math.abs(d.retention_index - 1) < 0.01);
    ok('14g. нестача даних: unknown', V.retentionContext({ newPrice: null, representative: 20000, T: 3 }).state === 'unknown' && V.retentionContext({ newPrice: 30000, representative: 20000, T: 0 }).state === 'unknown');
    ok('14h. діапазон MSRP як межа: стан рахується', ctx(63000, 20900, 12.25, 'msrp_range').state === 'heavy_depreciation');
    /* репрезентативна ціна: середня площадки, інакше оголошення; якір графіка не змінюється */
    const cheap = V.buildValueCurve({ price: 19000, currency: 'USD', price_context: RIA(27000), country: 'UA', year: 2021, nowMs: NOW,
      candidates: [{ amount: 34000, currency: 'USD', market: 'UA', price_kind: 'local_list', trim_match: 'exact', model_year: 2021, source_url: 'https://e.x/a', source_host: 'e.x', source_excerpt: 'x', confidence: 'medium', source_date: 'Mar 1, 2021', source_year: 2021, text_years: [], price_ladder: false }] });
    ok('14i. сохранність за середньою площадки, якір графіка лишається нижчою ціною', cheap.current.value === 19000 && cheap.retention.representative_current_value === 27000 && cheap.retention.representative_current_value_source === 'marketplace_average');
    const noAvg = V.buildValueCurve({ price: 19000, currency: 'USD', country: 'UA', year: 2021, nowMs: NOW });
    ok('14j. без середньої: ціна оголошення; зворотна оцінка дає unknown', noAvg.retention.representative_current_value === 19000 && noAvg.retention.representative_current_value_source === 'listing_price' && noAvg.retention.state === 'unknown');
    const pricier = V.buildValueCurve({ price: 27000, currency: 'USD', price_context: RIA(23200), country: 'UA', year: 2021, nowMs: NOW });
    ok('14k. середня як якір: вона ж і для сохранності', pricier.retention.representative_current_value === 23200);

    /* вибір історії за станом */
    const forces = [F('supports', 'S1 тримає ціну'), F('reduces', 'R1 прискорює втрату'), F('supports', 'S2'), F('reduces', 'R2'), F('reduces', 'R3'), F('supports', 'S3'), F('reduces', 'R4'), F('reduces', 'R5')];
    const heavy = V.composeWhyPrice(forces, 'heavy_depreciation');
    ok('14l. сильна амортизація: лише сили, що знижують вартість, до чотирьох', heavy.length === 4 && heavy.every(x => /^R/.test(x)));
    const strong = V.composeWhyPrice(forces, 'strong_retention');
    ok('14m. хороша сохранність: лише те, що підтримує', strong.length === 3 && strong.every(x => /^S/.test(x)));
    const strongFew = V.composeWhyPrice([F('supports', 'S1'), F('reduces', 'R1'), F('supports', 'S2')], 'strong_retention');
    ok('14m1. мало підтримувальних: одна протилежна для чесності', JSON.stringify(strongFew) === JSON.stringify(['S1', 'S2', 'R1']));
    const normal = V.composeWhyPrice(forces, 'normal_depreciation');
    ok('14n. звичайна: обидві сторони навперемін', normal.length === 4 && normal.filter(x => /^S/.test(x)).length === 2 && normal.filter(x => /^R/.test(x)).length === 2);
    ok('14o. unknown: нейтрально, обидві сторони', JSON.stringify(V.composeWhyPrice(forces, 'unknown')) === JSON.stringify(normal));
    const heavyFew = V.composeWhyPrice([F('reduces', 'R1'), F('supports', 'S1'), F('supports', 'S2')], 'heavy_depreciation');
    ok('14p. мало сил потрібного напрямку: одна протилежна для чесності', JSON.stringify(heavyFew) === JSON.stringify(['R1', 'S1']));
    ok('14q. порожньо не ламає', V.composeWhyPrice(null, 'heavy_depreciation').length === 0 && V.composeMarketValue(null, null) === null);
    const mv = V.composeMarketValue({ liquidity: { level: 'medium', reasons: ['L1'] }, price_forces: forces }, a);
    ok('14r. у звіті: ліквідність як є, історія ціни зі станом', mv.liquidity.level === 'medium' && mv.why_price.retention_state === 'heavy_depreciation' && mv.why_price.reasons.length === 4 && !('price_forces' in mv));
    ok('14s. невідомий стан від моделі не приймається', V.composeMarketValue({ liquidity: { level: 'low', reasons: ['L'] }, price_forces: forces }, { state: 'sehr gut' }).why_price.retention_state === 'unknown');
    /* E: дешеве оголошення не змінює ліквідність: у виклик ціна не йде */
    const check = fs.readFileSync('api/check.js', 'utf8');
    const callArgs = check.slice(check.indexOf('valueResearch.analyze({'), check.indexOf('let mainSystem = mainMsg.system;'));
    ok('14t. E, F: у виклик ліквідності не йдуть ціна оголошення, середня площадки, пробіг', !/listing_price|price_context|listing\.price|odometer/.test(callArgs) && /market: \{ country: listing\.country \|\| null \}/.test(callArgs));
    ok('14u. G: у виклик не йдуть історія, стан і розбіжності цього авто', !/history|auction|discrep|score|damage|flood|seller/i.test(callArgs.replace(/\/\*[\s\S]*?\*\//g, '')));
    ok('14v. стан сохранності не йде в Оцінку CalCar і впевненість', ['api/score-v4.js', 'api/score-v3.js', 'api/confidence.js'].every(f => !/retention|why_price|price_forces/.test(fs.readFileSync(f, 'utf8'))));
    ok('14w. стан сохранності не пишеться в MI', !/retention/.test(fs.readFileSync('api/mi-research.js', 'utf8')) && !/rpc\(|research_persist|candidate_claim/.test(fs.readFileSync('api/value.js', 'utf8')));
    ok('14x. у звіт іде складена історія', /parsed\.market_value = composeMarketValue\(valueResult\.market_value, valueCurve && valueCurve\.retention\)/.test(check));
  }

  /* ===== 6. паралельний виклик ===== */
  {
    const ID = { make: 'Toyota', model: 'Highlander', year: 2025, trim: 'Limited', generation: 'XU70' };
    const SEARCH = async q => ({ query: q, ok: true, items: [{ link: 'https://www.toyota.com/highlander', title: '2025 Highlander Limited', snippet: 'MSRP $47,575 for Limited' }] });
    const reply = obj => async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'm' });
    const GOOD = { liquidity: { level: 'high', reasons: ['Широке коло покупців.', 'Стійкий попит.'] }, price_forces: [{ direction: 'supports', text: 'Практичний кузов підтримує попит і ціну' }, { direction: 'supports', text: 'Гібридна економічність тримає вартість' }, { direction: 'reduces', text: 'Вік знижує вартість' }],
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
    ok('9b. Check підключає модуль', /import \{ startValueResearch, buildValueCurve, composeMarketValue \} from '\.\/value\.js';/.test(check));
    const iStart = check.indexOf('startValueResearch({'), iAnalyze = check.indexOf('valueResearch.analyze({'), iMain = check.indexOf('let data = await callModel(mainBody'), iWait = check.indexOf('await Promise.race([valuePromise');
    ok('9c. пошук стартує до основного аналізу, виклик не чекається перед ним, результат забирається після', iStart > 0 && iStart < iAnalyze && iAnalyze < iMain && iMain < iWait);
    ok('9d. основний виклик не чекає секцію', !/await valueResearch\.analyze|await valuePromise/.test(check));
    ok('9e. очікування після аналізу обмежене 6 с', /Promise\.race\(\[valuePromise, new Promise\(r => setTimeout\(\(\) => r\(null\), Math\.max\(0, Math\.min\(6000,/.test(check));
    ok('9f. секція у звіті: market_value, _meta.value_curve і тайминг', /parsed\.market_value = composeMarketValue\(valueResult\.market_value/.test(check) && /value_curve: valueCurve,/.test(check) && /mark\('value_section'/.test(check));
    ok('9g. Score рахується без секції: breakdown не згадує вартість', !/computeScoreV4\([^)]*value/i.test(check));
    ok('9h. основна схема відповіді не змінена секцією', !/market_value|liquidity/.test(read('api/check-schema.js')));
    const S = await import('./api/share.js');
    const pub = S.publicReport({ vehicle: { title: 'x' }, market_value: { liquidity: { level: 'high', reasons: ['a'] }, price_factors: [] }, _meta: { value_curve: { status: 'ok' }, timings: { value_section: {} } } });
    const pub2 = S.publicReport({ vehicle: { title: 'x' }, score_breakdown: { final: 6.3 }, confidence: { overall_internal: 80, text_key: 'Studied in detail' }, market_value: { liquidity: { level: 'high', reasons: ['a'] }, price_factors: ['b'] },
      _meta: { value_curve: { status: 'ok', current: { value: 19000, source: 'listing_price' }, average: { value: 23200, source_name: 'AUTO.RIA' } }, price_context: { average_price: 23200 } } });
    ok('9i0. L: публічний звіт несе все для ряду рішення: бал, впевненість, графік з обома цінами, тексти', pub2.score_breakdown.final === 6.3 && pub2.confidence.text_key === 'Studied in detail' && pub2._meta.value_curve.average.value === 23200
      && pub2._meta.price_context.average_price === 23200 && pub2.market_value.price_factors.length === 1);
    ok('9i. публічний звіт віддає секцію, але не тайминги', pub.market_value && pub._meta.value_curve && pub._meta.timings === undefined);
    for (const f of ['api/value.js', 'value-chart.js', 'valuetest.js']) ok('9j. ' + f + ' без довгого тире', !read(f).includes(String.fromCharCode(0x2014)));
    ok('9k. розрахована оцінка не пишеться в MI', !/rpc\(|research_persist|candidate_claim|supabase/i.test(read('api/value.js')));
  }

  /* ===== сторінка і графік ===== */
  {
    const page = fs.readFileSync('result-check.html', 'utf8');
    const iVerdict = page.indexOf('<div class="card" id="verdictCard"'), iValue = page.indexOf('id="valueCard"'), iRisks = page.indexOf('id="risksCard"');
    const iSlot = page.indexOf('<div class="sc-slot" id="scoreSlot"></div>'), iPair = page.indexOf('<div class="val-pair" id="valPair"');
    ok('10a. 12: порядок: оцінка і впевненість, висновок, ринкова вартість, ліквідність і чинники, ризики', iSlot > 0 && iSlot < iVerdict && iVerdict < iValue && iValue < iPair && iPair < iRisks
      && page.indexOf('id="valLiqBox"') > iPair && page.indexOf('id="valLiqBox"') < page.indexOf('id="valWhyBox"') && page.indexOf('id="valWhyBox"') < iRisks);
    ok('10b. між висновком і ринковою вартістю немає іншої картки', (page.slice(iVerdict, iValue).match(/<div class="card[ "]/g) || []).length === 2);
    ok('10b1. 11: одна картка оцінки і одна секція вартості, без дублів', page.split('id="scoreSlot"').length === 2 && page.split('id="valueCard"').length === 2 && page.split('id="valLiqBox"').length === 2 && page.split('id="valWhyBox"').length === 2
      && (page.match(/renderScoreBlock\(D\);/g) || []).length === 1 && (page.match(/renderValueSection\(D\);/g) || []).length === 1);
    const vcss = page.slice(page.indexOf('/* ---- ринкова вартість (Value v1) ----'), page.indexOf('/* висновок CalCar це головна'));
    ok('10b2. оцінка повернута до горизонтального вигляду: жодної вертикальної розкладки', !/dv-row|decisionRow|has-chart/.test(page) && /\.sc-card\{display:grid;grid-template-columns:minmax\(170px,30%\) 1px minmax\(0,1fr\)/.test(page));
    ok('10b3. 13: одна картка на всю ширину: графік і праворуч стовпчик чисел близько чверті', /<div class="card val-card" id="valueCard"/.test(page) && /\.vc-body\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(176px,24%\)/.test(vcss));
    ok('10b4. чіп ринку: просто країна, тихий, у шапці картки', /mk\.textContent = t\('Ukraine'\)/.test(page) && /\.val-chip\{[^}]*color:var\(--muted\)/.test(vcss)
      && /id="valueCard"[^>]*>\s*<div class="val-head">\s*<h2>Market value<\/h2>\s*<span class="val-chip" id="valMarket"/.test(page));
    ok('10b5. прогноз справжнім пунктиром і тихіший за історію', /\.vc-forecast\{stroke:var\(--faint\)[^}]*stroke-linecap:butt[^}]*stroke-dasharray:7 5/.test(vcss));
    ok('10b6. заливка ледь помітна, сітка і осі тихі', /\.vc-area\{fill:var\(--brand\);opacity:\.07\}/.test(vcss) && /\.vc-grid\{stroke:var\(--surface-2\)/.test(vcss) && /\.vc-tick\{[^}]*fill:var\(--faint\)/.test(vcss));
    ok('10b7. числа у стовпчику без окремих рамок: лише тонкі розділювачі; усі ціни однакової типографіки', /\.vc-kpi \+ \.vc-kpi\{border-top:1px solid var\(--line\)\}/.test(vcss) && !/\.vc-kpi\{[^}]*(border-radius|background|box-shadow)/.test(vcss)
      && !/\.vc-kpi\.ctx \.vc-num/.test(page) && /\.vc-num\{font-size:24px/.test(vcss));
    ok('10b8. другої позначки на графіку немає: ні стилю, ні малювання', !/vc-listing-dot|vc-link/.test(page) && !/vc-listing-dot|vc-link|L\.listing/.test(fs.readFileSync('value-chart.js', 'utf8')));
    /* 15: ліквідність і чинники ціни однієї будови */
    const pairHtml = page.slice(iPair, iRisks);
    ok('10b9. 15: дві картки однієї будови: той самий клас, заголовок і рядки', (pairHtml.match(/<div class="card mk-card"/g) || []).length === 2 && (pairHtml.match(/<h3>/g) || []).length === 2 && (pairHtml.match(/class="mk-rows"/g) || []).length === 2 && !/<ul|<li/.test(pairHtml));
    ok('10b12. 15: рядки обох карток малюються тим самим шаблоном з іконкою', (page.match(/\.map\(mkRow\)\.join\(''\)/g) || []).length === 2
      && /function mkRow\(text\) \{\s*return '<div class="mk-row"><span class="mk-ic">' \+ mkIcon\(text\) \+ '<\/span><span class="mk-tx">' \+ esc\(clean\(text\)\) \+ '<\/span><\/div>';/.test(page));
    ok('10b12a. стан ліквідності в рядку заголовка тихим статусом', /<div class="mk-head"><h3>Liquidity<\/h3><span class="mk-state" id="valLiqLevel"><\/span><\/div>/.test(page)
      && /\.mk-state\{display:inline-flex[^}]*border-radius:999px[^}]*font-size:12\.5px/.test(vcss) && !/\.mk-state:hover|cursor:pointer/.test(vcss.slice(vcss.indexOf('.mk-state{'), vcss.indexOf('.mk-state{') + 400)));
    ok('10b12b. обидві картки мають ту саму шапку і ті самі рядки', (pairHtml.match(/<div class="mk-head"><h3>/g) || []).length === 2 && /\.mk-row\{display:grid;grid-template-columns:32px minmax\(0,1fr\)/.test(vcss)
      && /\.mk-ic\{[^}]*width:32px;height:32px/.test(vcss));
    {
      const fn = (() => { const a = page.indexOf('function mkIcon('); let d = 0; for (let k = page.indexOf('{', a); k < page.length; k++) { if (page[k] === '{') d++; else if (page[k] === '}') { d--; if (d === 0) return page.slice(a, k + 1); } } return ''; })();
      const mkIcon = new Function(fn + '; return mkIcon;')();
      const kind = txt => { const svg = mkIcon(txt); return svg; };
      const same = (a, b) => kind(a) === kind(b);
      ok('10b12c. іконки за змістом: попит, ціна, утримання, привід, вік, електро; невпізнане нейтральне',
        same('Популярная модель с широким кругом покупателей.', 'Широка аудиторія покупців.') && same('Цена ниже средней по площадке.', 'Ціна нижча за середню.')
        && same('Высокая стоимость содержания', 'Дороге обслуговування') && same('Полный привод', 'Повний привід') && same('Возраст модели', 'Вік моделі')
        && same('Неопределённость по ресурсу батареи', 'Battery degradation') && same('Быстрое удешевление электромобилей', 'Battery degradation') && !same('Дорогая электроника', 'Battery degradation') && !same('Полный привод', 'Цена ниже средней') && same('Что-то совсем иное', 'Something unrelated')
        && /<svg viewBox="0 0 24 24"[^>]*aria-hidden="true">/.test(kind('x')) && !/[<>]script/i.test(kind('<script>')));
    }
    ok('10b12d. чинників ціни не більше чотирьох рядків, причин ліквідності не більше трьох', /const factors = whyRaw\.filter\(x => typeof x === 'string' && x\.trim\(\)\)\.slice\(0, 4\);/.test(page) && /mv\.why_price && Array\.isArray\(mv\.why_price\.reasons\) \? mv\.why_price\.reasons : \(mv && Array\.isArray\(mv\.price_factors\) \? mv\.price_factors : \[\]\)/.test(page) && /lq\.reasons\.filter\(x => typeof x === 'string' && x\.trim\(\)\)\.slice\(0, 3\)/.test(page));
    ok('10b13. без яскравих лаймових маркерів списку', !/\.mk-[a-z]+[^{]*\{[^}]*var\(--brand\)/.test(vcss) && /\.mk-row \+ \.mk-row\{border-top:1px solid var\(--line\)\}/.test(vcss));
    ok('10b14. дві рівні картки поруч, на вузькому екрані одна під одною; числа над графіком', /\.val-pair\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:20px/.test(vcss)
      && /@media\(max-width:860px\)\{[\s\S]*?\.vc-body\{grid-template-columns:minmax\(0,1fr\)[\s\S]*?\.vc-rail\{order:-1[\s\S]*?\.val-pair\{grid-template-columns:minmax\(0,1fr\)/.test(vcss));
    ok('10b16. статус сохранності у заголовку другої картки: той самий тихий статус, з даних кривої', /<h3>Why this car costs what it does<\/h3><span class="mk-state" id="valWhyState" hidden><\/span>/.test(page)
      && /const retState = vc && vc\.retention && RET\[vc\.retention\.state\] && mv && mv\.why_price \? RET\[vc\.retention\.state\] : null;/.test(page) && !/unknown:/.test(page.slice(page.indexOf('const RET = {'), page.indexOf('const RET = {') + 300)));
    ok('10b15. тексти карток: лише наявні причини і чинники, без переписування', /reasons\.map\(mkRow\)/.test(page) && /factors\.map\(mkRow\)/.test(page) && /esc\(clean\(text\)\)/.test(page));
    /* I, J: рендер оцінки і впевненості не змінений цією задачею */
    const fnSrc = name => { const a = page.indexOf('function ' + name + '('); let d = 0; for (let k = page.indexOf('{', a); k < page.length; k++) { if (page[k] === '{') d++; else if (page[k] === '}') { d--; if (d === 0) return page.slice(a, k + 1); } } return ''; };
    const scoreFn = fnSrc('renderScoreBlock');
    ok('10b10. I, J: бал і впевненість беруться зі збережених даних звіту, без вартості', /bd && typeof bd\.final === 'number' \? bd\.final/.test(scoreFn) && /D\.confidence\.overall_internal/.test(scoreFn) && !/value_curve|market_value|valueCard/.test(scoreFn));
    ok('10b11. рендер вартості не чіпає бал і впевненість', !/score_breakdown|confidence|scoreSlot|scoreCard/.test(fnSrc('renderValueSection')));
    ok('10c. графік, ліквідність і чинники в одній картці', /id="valChart"/.test(page) && /id="valLiqBox"/.test(page) && /id="valWhyBox"/.test(page));
    ok('10d. value-chart.js підключений', /<script src="\/value-chart\.js"><\/script>/.test(page));
    ok('10e. рендер викликається після висновку', /renderValueSection\(D\);/.test(page) && page.indexOf('renderValueSection(D);') > page.indexOf('renderScoreBlock(D);'));
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
      ok('11f. ширина ' + width + ': у розкладці графіка немає другої ціни', !('listing' in L));
    }
    {
      const vcA = V.buildValueCurve({ price: 19000, currency: 'USD', price_context: RIA(23200), country: 'UA', year: 2021, nowMs: NOW });
      const La = C.layout(vcA, 640, 260);
      ok('11f1. друга ціна лишається в даних для стовпчика чисел, графік її не малює', C.usable(vcA) && vcA.average.value === 23200 && vcA.current.value === 19000 && !('listing' in La));
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
    ok('11i. шкала за кривою: друга ціна поза кривою шкалу не розширює', over.listing.value === 120000 && Lo.ys.top >= over.new_price.value && Lo.ys.top < 120000 && Lo.Y(0) === Lo.pad.t + Lo.ih);
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
    ok('11q. 8: знака приблизності в секції немає ніде', !/≈|≈/.test(chartSrc) && !/≈/.test(page.slice(page.indexOf('function renderValueSection'), page.indexOf('function fill('))));
    ok('11q1. невизначеність несе підпис: оцінка новою, сьогодні, прогноз', /t\(vc\.new_price\.approx \? 'Estimated when new' : 'When new'\)/.test(chartSrc) && /item\(curTxt, t\('Today'\), 'now'\)/.test(chartSrc) && /item\(futTxt, t\('Forecast in 5 years'\)\)/.test(chartSrc));
    ok('11q2. середня як контекст: назва джерела або нейтральний підпис', /vc\.average\.source_name \? t\('\{name\} average'\)\.replace\('\{name\}', vc\.average\.source_name\) : t\('Marketplace average'\)/.test(chartSrc) && !/AUTO\.RIA/.test(chartSrc));
    ok('11r. ціна оголошення точна; середня і прогноз округлені', /money\(vc\.listing\.value, cur\)/.test(chartSrc) && /curTxt = money\(isAvg \? r100\(vc\.current\.value\) : vc\.current\.value, cur\)/.test(chartSrc) && /futTxt = money\(r100\(vc\.future\.value\), cur\)/.test(chartSrc));
    {
      const todayCircles = chartSrc.match(/el\('circle', \{ cx: L\.px\[ti\][^}]*\}\)/g) || [];
      ok('11w. на лінії "сьогодні" рівно одна позначка: лаймовий якір кривої', todayCircles.length === 1 && /'class': 'vc-today'/.test(todayCircles[0]));
      ok('11x. друга ціна лишається у стовпчику праворуч (оголошення або середня)', /rail \+= item\(money\(vc\.listing\.value, cur\)/.test(chartSrc) && /rail \+= item\(money\(r100\(vc\.average\.value\), cur\)/.test(chartSrc));
    }
    ok('11s. числа винесені зі шапки графіка у стовпчик праворуч', /'<div class="vc-rail">' \+ rail \+ '<\/div><\/div>'/.test(chartSrc) && !/vc-stats|class="vc-listing"/.test(chartSrc));
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
    const keys = ['Market value', 'Liquidity', 'Why this car costs what it does', 'Easy to resell', 'Average resale', 'Hard to resell', 'Not enough data', 'Ukraine', 'When new', 'Today', '{name} average', 'Marketplace average', 'Estimated when new', 'Forecast in 5 years', 'Lost much of its value', 'Typical depreciation', 'Holds its value well', 'The new-car price is the US list price of this version.', 'The new-car price is estimated from the current price and age, within the list prices of this model year.', 'The new-car price is estimated from the US list prices of this model year.', 'The new-car price is the US list price of the technically equivalent version.', 'The new-car price is estimated from US list prices of versions with this powertrain.',
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
