/* Чотири правки звіту Check: тест без мережі і без бази.

   1. Ліквідність: іконка рядка по центру всього тексту причини.
   2. Ринкова вартість: усі ціни правого стовпчика однієї типографіки;
      без середньої площадки рядка немає зовсім.
   3. Рік з декодера VIN: лише з чистого декоду vPIC (ErrorCode "0");
      неповний декод (код 8 і подібні) рік не дає і розбіжностей не
      створює, сам рік лишається в провенансі.
   4. Історія власників: подія, де модель написала лише номер власника,
      отримує дію з реєстру; конкретна дія реєстру важить більше за
      загальну "перереєстрацію".

   Запуск: node integritytest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

(async () => {
  const page = fs.readFileSync('result-check.html', 'utf8');

  /* ===== 1. ліквідність: вирівнювання іконок ===== */
  {
    const row = (/\.mk-row\{[^}]*\}/.exec(page) || [''])[0];
    const tx = (/\.mk-tx\{[^}]*\}/.exec(page) || [''])[0];
    ok('1. рядок вирівнює іконку по центру всього тексту причини', /align-items:center/.test(row) && !/align-items:start/.test(row));
    ok('2. без ручного зсуву тексту під один рядок', !/padding-top|margin-top/.test(tx));
    ok('3. розмір іконки і сітка рядка ті самі, текст переноситься', /grid-template-columns:32px minmax\(0,1fr\)/.test(row) && /\.mk-ic\{[^}]*width:32px;height:32px/.test(page) && /overflow-wrap:anywhere/.test(tx));
  }

  /* ===== 2. ринкова вартість: стовпчик чисел ===== */
  {
    const chart = fs.readFileSync('value-chart.js', 'utf8');
    ok('4. ціна середньої площадки тієї самої типографіки, що й решта', !/\.vc-kpi\.ctx \.vc-num/.test(page) && /\.vc-num\{font-size:24px;font-weight:700/.test(page));
    ok('4a. підпис другої ціни може лишатись другорядним, ціна ні', !/\.vc-kpi\.ctx[^{]*\{[^}]*font-size/.test(page.replace(/@media\(max-width:860px\)\{[\s\S]*?\n  \}\n/, '')));
    const vm = require('vm');
    const w = {};
    vm.runInNewContext(chart, { window: w, Intl, Math, Date, String, Number, parseInt, isFinite, Object });
    ok('5-6. рядок середньої лише коли вона є; рядок ціни оголошення лише коли вона є', /if \(fin\(tp\.average\)\) rail \+= item\(/.test(chart) && /if \(fin\(tp\.listing\)\) rail \+= item\(/.test(chart)
      && (chart.match(/rail \+= item\(/g) || []).length === 3);
    ok('7. розділювач належить рядку, а не стовпчику: без порожнього місця', /\.vc-kpi \+ \.vc-kpi\{border-top:1px solid var\(--line\)\}/.test(page) && !/\.vc-rail\{[^}]*(min-height|height|grid-template-rows)/.test(page));
    const V = await import('./api/value.js');
    const NOW = Date.UTC(2026, 8, 30);
    const withAvg = V.buildValueCurve({ price: 17999, currency: 'USD', price_context: { average_price: 27000, currency: 'USD', source_name: 'AUTO.RIA' }, country: 'UA', year: 2013, nowMs: NOW });
    const noAvg = V.buildValueCurve({ price: 17999, currency: 'USD', country: 'UA', year: 2013, nowMs: NOW });
    ok('8. якір "сьогодні" той самий: нижча з двох цін', withAvg.current.value === 17999 && withAvg.average.value === 27000 && noAvg.current.value === 17999 && !noAvg.average && !noAvg.listing);
    ok('9. крива та сама: без середньої і з нею однакові точки', JSON.stringify(withAvg.points) === JSON.stringify(noAvg.points));
  }

  /* ===== 3. рік з декодера VIN ===== */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_integrity_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  {
    const clean = { Make: 'TOYOTA', Model: 'RAV4', ModelYear: '2013', ErrorCode: '0', ErrorText: '0 - VIN decoded clean. Check Digit (9th position) is correct' };
    ok('10. чистий декод: рік лишається і може дати справжню розбіжність', C.decoderYearTrusted(clean) && C.gateDecoderYear(clean).ModelYear === '2013' && C.nhtsaForPrompt(C.gateDecoderYear(clean)).ModelYear === '2013');
    /* реальна відповідь vPIC для WDC1668731A298010 */
    const gl = { Make: 'MERCEDES-BENZ', Model: 'GL-Class', ModelYear: '2001', BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)', ErrorCode: '8', ErrorText: '8 - No detailed data available currently' };
    const g = C.gateDecoderYear(gl);
    ok('11. код 8 (детальних даних нема): рік не стає модельним роком', !C.decoderYearTrusted(gl) && g.ModelYear === undefined);
    ok('11a. в аналіз іде лише розібране: без року, статусу і провенансу', JSON.stringify(C.nhtsaForPrompt(g)) === JSON.stringify({ Make: 'MERCEDES-BENZ', Model: 'GL-Class', BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)' }));
    for (const code of ['1', '6', '11', '14', '1,8', '0,8', '400', '', null, undefined]) {
      const n = { Make: 'X', ModelYear: '2001', ...(code === undefined ? {} : { ErrorCode: code }) };
      ok('12. статус ' + JSON.stringify(code) + ': рік не авторитетний', !C.decoderYearTrusted(n) && C.gateDecoderYear(n).ModelYear === undefined);
    }
    ok('13. невпевнений рік лишається в провенансі', g.ModelYearUntrusted === '2001' && g.ErrorCode === '8' && /No detailed data/.test(g.ErrorText));
    ok('13a. без року нічого не змінюється, порожнє не ламає', C.gateDecoderYear(null) === null && JSON.stringify(C.gateDecoderYear({ Make: 'X', ErrorCode: '8' })) === JSON.stringify({ Make: 'X', ErrorCode: '8' }));
    const src = fs.readFileSync('api/check.js', 'utf8');
    ok('14. GL: у Check рік декодера проходить гейт до будь-якого використання', /nhtsa = gateDecoderYear\(nhtsa\);/.test(src)
      && src.indexOf('nhtsa = gateDecoderYear(nhtsa);') < src.indexOf('const up = await upsertVehicle(listing.vin')
      && /JSON\.stringify\(nhtsaForPrompt\(trustedDecoderView\(nhtsa\)\)\)/.test(src) && /if \(row\.ErrorCode != null && row\.ErrorCode !== ''\) nhtsa\.ErrorCode/.test(src));
    ok('14a. провенанс декодера у звіті', /decoder: nhtsa \? \{ error_code: nhtsa\.ErrorCode \|\| null, model_year_trusted: decoderYearTrusted\(nhtsa\), model_year_untrusted: nhtsa\.ModelYearUntrusted \|\| null \}/.test(src));
    ok('14b. кешовані декоди без статусу перерахуються', /NHTSA_DECODER_VERSION = 'vpic-v2'/.test(fs.readFileSync('api/vehicle-memory.js', 'utf8')));
    ok('14c. без марки-винятків і без власного розбору 10-го символу', !/WDC|WDD|W1K|tenth|10-го символу|charAt\(9\)|\[9\]/.test(src.slice(src.indexOf('export function decoderYearTrusted'), src.indexOf('export function nhtsaForPrompt'))));
  }

  /* ===== 4. історія власників ===== */
  {
    const H = await import('file://' + path.join(dir, 'api', 'history-owners.js'));
    const reg = '1-ий власник 26.11.13 Первинна реєстрація нового ТЗ • 2-ий власник 24.12.13 Перереєстрація на нового власника • 3-ій власник 04.09.15 Перереєстрація на нового власника • 4-ий власник 24.08.23 Перереєстрація на нового власника';
    const ev = H.parseOwnerEvents(reg);
    ok('15a. реєстр: номер, дата і дія', ev.length === 4 && ev[0].operation === 'first_registration' && ev.slice(1).every(e => e.operation === 'owner_reregistration'));
    const hist = [{ date: '11.2013', event: 'Первая регистрация автомобиля.' }, { date: '12.2013', event: 'Второй владелец.' }, { date: '09.2015', event: 'Третий владелец.' },
      { date: '06.2022', event: 'Дилерское СТО зафиксировало пробег 77 000 км.' }, { date: '08.2023', event: 'Четвертый владелец.' }];
    const facts = { owners_count: 4, owner_events: ev };
    const out = H.describeOwnerEvents(H.annotateOwnerOrdinals(hist, facts), facts, 'ru');
    ok('15. перший власник: "Первая регистрация автомобиля" і бейдж 1', out[0].event === 'Первая регистрация автомобиля.' && out[0].owner_ordinal === 1);
    ok('16. зміна власника: "Перерегистрация на нового владельца" і бейдж 2', out[1].event === 'Перерегистрация на нового владельца.' && out[1].owner_ordinal === 2);
    ok('17. та сама дія для 4-го власника', out[4].event === 'Перерегистрация на нового владельца.' && out[4].owner_ordinal === 4);
    ok('19. жодного "Второй владелец" поруч із бейджем "2-й владелец"', !out.some(r => r.owner_ordinal && /владелец\.?$/i.test(r.event) && !/нового/.test(r.event)));
    ok('19a. подія без номера власника не змінюється', out[3].event === 'Дилерское СТО зафиксировало пробег 77 000 км.' && !out[3].event_source);
    /* конкретна дія реєстру важить більше */
    const regSpecific = '1-ий власник 09.04.11 Реєстрацiя ТЗ привезеного з-за кордону • 2-ий власник 22.04.15 Вторинна реєстрація тз, придбаного в торговельній організації • 3-ій власник 11.05.23 Перереєстрація на нового власника за дог. купiвлi-продажу (СГ)';
    const ev2 = H.parseOwnerEvents(regSpecific);
    const hist2 = [{ date: '04.2011', event: '1-й владелец.' }, { date: '04.2015', event: 'Второй владелец' }, { date: '05.2023', event: 'Третий владелец.' }];
    const f2 = { owners_count: 3, owner_events: ev2 };
    const out2 = H.describeOwnerEvents(H.annotateOwnerOrdinals(hist2, f2), f2, 'ru');
    ok('18. конкретна дія реєстру: ввезення, торговельна організація, купівля-продаж', out2[0].event === 'Регистрация после ввоза из-за границы.' && out2[1].event === 'Регистрация после покупки в торговой организации.'
      && out2[2].event === 'Перерегистрация на нового владельца по договору купли-продажи.', JSON.stringify(out2.map(r => r.event)));
    const keep = H.describeOwnerEvents(H.annotateOwnerOrdinals([{ date: '04.2011', event: 'Регистрация автомобиля, ввезённого из США.' }, { date: '04.2015', event: 'Регистрация после покупки у дилера.' }, { date: '05.2023', event: 'Третий владелец.' }], f2), f2, 'ru');
    ok('18a. змістовний текст моделі не перезаписується', keep[0].event === 'Регистрация автомобиля, ввезённого из США.' && keep[1].event === 'Регистрация после покупки у дилера.' && keep[2].event === 'Перерегистрация на нового владельца по договору купли-продажи.');
    const ua = H.describeOwnerEvents(H.annotateOwnerOrdinals([{ date: '11.2013', event: 'Перший власник.' }, { date: '12.2013', event: 'Другий власник.' }, { date: '09.2015', event: '3-й власник' }, { date: '08.2023', event: 'Четвертий власник' }], facts), facts, 'ua');
    const en = H.describeOwnerEvents(H.annotateOwnerOrdinals([{ date: '11.2013', event: 'First owner.' }, { date: '12.2013', event: 'Second owner.' }, { date: '09.2015', event: '3rd owner' }, { date: '08.2023', event: 'Fourth owner' }], facts), facts, 'en');
    ok('18b. українською і англійською', ua[0].event === 'Перша реєстрація автомобіля.' && ua[1].event === 'Перереєстрація на нового власника.' && en[0].event === 'First registration of the car.' && en[3].event === 'Re-registration to a new owner.');
    const noReg = H.describeOwnerEvents([{ date: '12.2013', event: 'Второй владелец.' }], { owner_events: [] }, 'ru');
    ok('18c. без номера з реєстру нічого не вигадується', noReg[0].event === 'Второй владелец.');
    ok('18d. не вигадуємо продаж, спадщину чи дилера без запису реєстру', H.classifyOwnerOperation('Перереєстрація на нового власника') === 'owner_reregistration' && H.classifyOwnerOperation('') === null && H.classifyOwnerOperation('Зміна номерного знака') === null);
    /* номер власника в бейджі, а не в реченні; пропуски в нумерації допустимі */
    {
      const evs = [{ date: '2013-11-15', ordinal: 1, operation: 'first_registration' }, { date: '2014-02-23', ordinal: 2, operation: 'owner_reregistration' }, { date: '2014-03-22', ordinal: 3, operation: 'owner_reregistration' },
        { date: '2014-08-23', ordinal: 4, operation: 'trade_purchase' }, { date: '2015-10-17', ordinal: 5, operation: 'owner_reregistration' }, { date: '2017-09-05', ordinal: 6, operation: 'inheritance' }, { date: '2025-02-28', ordinal: 7, operation: 'owner_reregistration' }];
      const f7 = { owners_count: 7, owner_events: evs };
      const real = [{ date: '11.2013', event: 'Первая регистрация автомобиля.' }, { date: '08.2014', event: 'Вторичная регистрация после покупки через торговую организацию, четвёртый владелец.' },
        { date: '09.2017', event: 'Перерегистрация по наследству, шестой владелец.' }, { date: '12.2023', event: 'На дилерском СТО зафиксирован пробег 94 000 км.' },
        { date: '02.2025', event: 'Перерегистрация по договору дарения, седьмой владелец.' }, { date: '09.2026', event: 'Текущее объявление с заявленным пробегом 106 000 км.' }];
      const o = H.describeOwnerEvents(H.annotateOwnerOrdinals(real, f7), f7, 'ru');
      ok('20a. реальний GL63: бейджі 1, 4, 6, 7 з пропусками', JSON.stringify(o.map(r => r.owner_ordinal || null)) === '[1,4,6,null,7,null]', JSON.stringify(o.map(r => r.owner_ordinal || null)));
      ok('20b. номер прибраний з речення, конкретна дія лишилась', o[1].event === 'Вторичная регистрация после покупки через торговую организацию.' && o[2].event === 'Перерегистрация по наследству.' && o[4].event === 'Перерегистрация по договору дарения.' && o[0].event === 'Первая регистрация автомобиля.',
        JSON.stringify(o.map(r => r.event)));
      ok('20c. рядки без події реєстру не змінюються і бейджа не мають', o[3].event === 'На дилерском СТО зафиксирован пробег 94 000 км.' && !o[3].owner_ordinal && !o[5].owner_ordinal);
      const ua7 = H.describeOwnerEvents(H.annotateOwnerOrdinals([{ date: '11.2013', event: 'Перша реєстрація автомобіля.' }, { date: '09.2017', event: 'Перереєстрація за правом спадщини, шостий власник.' }, { date: '02.2025', event: 'Перереєстрація на сьомого власника за договором дарування.' }], f7), f7, 'ua');
      const en7 = H.describeOwnerEvents(H.annotateOwnerOrdinals([{ date: '11.2013', event: 'First registration of the car.' }, { date: '09.2017', event: 'Re-registration by inheritance, sixth owner.' }, { date: '02.2025', event: 'Registration to the 7th owner under a gift agreement.' }], f7), f7, 'en');
      ok('20d. українською і англійською', ua7[1].event === 'Перереєстрація за правом спадщини.' && ua7[2].event === 'Перереєстрація на нового власника за договором дарування.' && ua7[2].owner_ordinal === 7
        && en7[1].event === 'Re-registration by inheritance.' && en7[2].event === 'Registration to a new owner under a gift agreement.' && en7[1].owner_ordinal === 6, JSON.stringify([ua7.map(r => r.event), en7.map(r => r.event)]));
      const noChip = H.describeOwnerEvents([{ date: '09.2017', event: 'Перерегистрация по наследству, шестой владелец.' }], { owner_events: [] }, 'ru');
      ok('20e. без номера з реєстру текст не чіпається і номер не вигадується', noChip[0].event === 'Перерегистрация по наследству, шестой владелец.' && !noChip[0].owner_ordinal);
      ok('20f. сторінка показує номер бейджем', /h\.owner_ordinal \? ' <span class="badge reg-badge">' \+ esc\(t\('Owner #\{n\}'\)\.replace\('\{n\}', h\.owner_ordinal\)\)/.test(fs.readFileSync('result-check.html', 'utf8')));
    }
    const src = fs.readFileSync('api/check.js', 'utf8');
    ok('18e. Check описує події після привʼязки номерів', /parsed\.history = annotateOwnerOrdinals\(parsed\.history, listing\.history_facts\);\n[^\n]*\n\s*if \(Array\.isArray\(parsed\.history\)\) parsed\.history = describeOwnerEvents\(parsed\.history, listing\.history_facts, lang\);/.test(src));
    /* реальний Range Rover SALGS2EF5DA122430: реєстр дав 1-го, 2-го, 3-го і 4-го
       власника, модель написала події лише 1-го і 4-го. Кожна подія реєстру
       в хронології; дія окремо, номер окремо; нічого не вигадується */
    {
      const rr = [{ gap: null, date: '07.2019', event: 'ДТП у США, зафіксовано пробіг 138 000 км.' },
        { gap: 'x', date: '10.2021', event: 'Перша реєстрація в Україні після ввезення.' },
        { gap: 'x', date: '08.2022', event: 'Продаж через AUTO.RIA, заявлений пробіг 140 000 км.' },
        { gap: 'x', date: '10.2024', event: 'Продаж через AUTO.RIA, заявлений пробіг 149 000 км.' },
        { gap: 'x', date: '05.2025', event: 'Перереєстрація на нового власника в Україні.' },
        { gap: 'x', date: '11.2025', event: 'Продаж через AUTO.RIA, заявлений пробіг 167 000 км.' },
        { gap: 'x', date: '09.2026', event: 'Продаж через AUTO.RIA, заявлений пробіг 178 000 км.' }];
      const rf = { owners_count: 4, owner_events: [{ date: '2021-10-29', ordinal: 1, operation: 'import_registration' }, { date: '2023-02-07', ordinal: 2, operation: 'owner_reregistration' },
        { date: '2024-01-05', ordinal: 3, operation: 'sale_registration' }, { date: '2025-05-14', ordinal: 4, operation: 'owner_reregistration' }] };
      const full = H.addMissingOwnerEvents(H.describeOwnerEvents(H.annotateOwnerOrdinals(rr, rf), rf, 'ua'), rf, 'ua');
      const owners = full.filter(r => r.owner_ordinal);
      ok('21a. Range Rover: усі власники з реєстру в хронології 1 -> 2 -> 3 -> 4', owners.map(r => r.owner_ordinal).join() === '1,2,3,4', JSON.stringify(full.map(r => [r.date, r.owner_ordinal || null])));
      ok('21b. пропущені події з датою і дією реєстру, номер окремо', owners[1].date === '02.2023' && owners[1].event === 'Перереєстрація на нового власника.'
        && owners[2].date === '01.2024' && owners[2].event === 'Перереєстрація на нового власника за договором купівлі-продажу.' && !/2|3|друг|трет/i.test(owners[1].event + owners[2].event), JSON.stringify(owners));
      ok('21c. хронологічний порядок і жоден рядок моделі не загубився', full.length === rr.length + 2 && full.map(r => r.date).join() === '07.2019,10.2021,08.2022,02.2023,01.2024,10.2024,05.2025,11.2025,09.2026');
      ok('21d. рядки моделі з номером не дублюються', full.filter(r => r.owner_ordinal === 1).length === 1 && full.filter(r => r.owner_ordinal === 4).length === 1);
      /* неузгоджений реєстр (дірка в нумерації чи інша кількість): нічого не додаємо */
      const bad = { owners_count: 4, owner_events: [rf.owner_events[0], rf.owner_events[2], rf.owner_events[3]] };
      ok('21e. неузгоджений реєстр не створює подій', H.addMissingOwnerEvents(rr, bad, 'ua').length === rr.length);
      ok('21f. без реєстру нічого не вигадується', H.addMissingOwnerEvents(rr, { owner_events: [] }, 'ua').length === rr.length);
      ok('21g. мова дії = мова звіту', H.addMissingOwnerEvents(rr, rf, 'en').some(r => r.owner_ordinal === 3 && r.event === 'Re-registration to a new owner under a sale agreement.') || H.addMissingOwnerEvents(rr, rf, 'en').some(r => r.owner_ordinal === 3 && /^Re-registration/.test(r.event)));
      ok('21h. Check додає пропущені події після опису', /parsed\.history = describeOwnerEvents\(parsed\.history, listing\.history_facts, lang\);\n[^\n]*\n\s*if \(Array\.isArray\(parsed\.history\)\) parsed\.history = addMissingOwnerEvents\(parsed\.history, listing\.history_facts, lang\);/.test(fs.readFileSync('api/check.js', 'utf8')));
    }
  }

  /* ===== 5. разова чистка року старого декодера ===== */
  {
    const Y = require('./vehicle-year-cleanup.js');
    const legacy = (vin, my, year, extra) => ({ vin, model_year: my, year, decoder_version: 'vpic-v1', nhtsa: { Make: 'X', ModelYear: String(my) }, ...(extra || {}) });
    ok('Y20. чистий декод не чіпається', Y.classifyLegacyYear(legacy('1FADP3J2XJL279655', 2018, 2018), { code: '0' }).action === 'SKIP');
    const gl = legacy('WDC1668731A298010', 2001, 2013);
    const glPlan = Y.classifyLegacyYear(gl, { code: '8', text: '8 - No detailed data available currently' });
    ok('Y21. рік неповного декоду виявлено', glPlan.action === 'NULL' && glPlan.reason === 'unreliable_decode_no_trusted_year');
    ok('Y22. довірений рік з іншого джерела стає на місце', Y.classifyLegacyYear(gl, { code: '8' }, { WDC1668731A298010: 2013 }).action === 'REPLACE' && Y.classifyLegacyYear(gl, { code: '8' }, { WDC1668731A298010: 2013 }).replacement === 2013);
    ok('Y23. довіреного року нема: null, без вгадування з року оголошення', glPlan.replacement === null && gl.year === 2013);
    ok('Y24. GL: 2001 не лишається канонічним, коли є довірений 2013', Y.classifyLegacyYear(gl, { code: '8' }, { WDC1668731A298010: 2013 }).replacement === 2013 && Y.classifyLegacyYear(gl, { code: '8' }).replacement !== 2001);
    ok('Y25. без масових видалень: інший декодер, рік не з декодера, невідомий статус, підтверджений рік: SKIP',
      Y.classifyLegacyYear({ ...gl, decoder_version: 'vpic-v2' }, { code: '8' }).action === 'SKIP'
      && Y.classifyLegacyYear({ ...gl, model_year: 2013 }, { code: '8' }).action === 'SKIP'
      && Y.classifyLegacyYear(gl, null).action === 'SKIP' && Y.classifyLegacyYear(gl, { code: '8' }, { WDC1668731A298010: 2001 }).action === 'SKIP'
      && Y.classifyLegacyYear({ ...gl, model_year: null }, { code: '8' }).action === 'SKIP');
    const n = Y.gatedNhtsa({ Make: 'X', ModelYear: '2001' }, { code: '8', text: 'No detailed data' });
    ok('Y26. nhtsa: статус декоду і рік як недовірений', n.ModelYear === undefined && n.ModelYearUntrusted === '2001' && n.ErrorCode === '8' && Y.gatedNhtsa({ ModelYear: '2018' }, { code: '0' }).ModelYear === '2018');
    const src = fs.readFileSync('vehicle-year-cleanup.js', 'utf8');
    ok('Y27. запис лише з --apply і з умовою на старе значення', /const apply = process\.argv\.includes\('--apply'\);/.test(src) && /if \(!apply\) \{ console\.log\('сухий прогін: нічого не записано'\); return; \}/.test(src)
      && /vehicles\?vin=eq\.' \+ encodeURIComponent\(p\.row\.vin\) \+ '&model_year=eq\.' \+ p\.row\.model_year \+ '&decoder_version=eq\.' \+ DECODER_LEGACY/.test(src));
    ok('Y28. без розбору 10-го символу і без винятків для марок', !/charAt\(9\)|\[9\]|substr\(9|WDC|WDD|W1K/.test(src.replace(/Mercedes 2013 ставав 2001/, '')));
  }

  /* ===== межі ===== */
  {
    for (const f of ['api/score-v4.js', 'api/confidence.js']) ok('20. ' + f + ' не читає декодер, власників і стовпчик цін', !/decoderYearTrusted|ModelYearUntrusted|describeOwnerEvents|vc-kpi/.test(fs.readFileSync(f, 'utf8')));
  }

  /* ===== ризики: що дорого і чому, без "не підтверджено діагностикою" ===== */
  {
    const src = fs.readFileSync('api/check.js', 'utf8');
    const rule = src.slice(src.indexOf('"risks": до 5 КЛЮЧОВИХ РИЗИКІВ'), src.indexOf('\n', src.indexOf('"risks": до 5 КЛЮЧОВИХ РИЗИКІВ')));
    ok('R1. правило: ризик каже, що дорого і чому; загальне "не підтверджено діагностикою" заборонене', /ЩО може коштувати дорого/.test(rule) && /ЗАБОРОНЕНІ/.test(rule) && /НЕ ризик: сам факт, що CalCar чи сторонній сервіс не оглядав авто/.test(rule));
    ok('R2. "не підтверджено" лишається для конкретної заяви продавця чи документа', /доречне ЛИШЕ для конкретної заяви продавця чи документа/.test(rule));
    ok('R3. типова болячка моделі без привʼязки до машини лишається в model_notes', /САМІ ПО СОБІ недостатні для risks/.test(rule) && /model_notes\.issues/.test(rule));
    const g = C.genericUnverifiedRisks;
    const generic = ['Состояние двигателя не подтверждено независимой диагностикой', 'Стан пневмопідвіски не підтверджено незалежною перевіркою', 'Engine condition not confirmed by independent diagnostics', 'Коробка не проверена на СТО'];
    ok('R4. Y: загальні заголовки ловляться трьома мовами', generic.every(t => g([{ title: t }]).length === 1), generic.filter(t => g([{ title: t }]).length !== 1).join(' | '));
    const fine = ['Пневмоподвеска', 'Двигатель и автоматическая коробка', 'Ремонт АКПП заявлен продавцом, но документально не подтвержден', 'Страховой случай 2021 года', 'Днище и подкапотное пространство не показаны'];
    ok('R5. Z, AA: вузол і ціна помилки, заява продавця, подія машини не чіпаються', fine.every(t => g([{ title: t }]).length === 0), fine.filter(t => g([{ title: t }]).length).join(' | '));
    ok('R6. детектор лише діагностика: текст ризиків код не переписує', /risks_generic_unverified:/.test(src) && !/parsed\.risks\s*=\s*parsed\.risks\.filter\([^)]*genericUnverified/.test(src) && g(null).length === 0);
    /* версія з площадки: структурований рядок після покоління */
    const block = src.slice(src.indexOf('let modification = null;'), src.indexOf('if (cand) modification = cand.slice(0, 60);'));
    const run = (html, generation) => new Function('html', 'isRia', 'generation', block + 'if (cand) modification = cand.slice(0, 60);\n}\nreturn modification;')(html, true, generation);
    const html = '{"id":"basicInfoGenerationBase","items":[{"content":"X166 •"},{"content":"Brand-AMG X 63 AT (557 к.с.)"}]}';
    ok('R7. модифікація читається зі структурованого рядка площадки', run(html, 'X166') === 'Brand-AMG X 63 AT (557 к.с.)', String(run(html, 'X166')));
    ok('R8. рядка немає або в ньому лише покоління: версії немає, нічого не вигадано', run('{"id":"other"}', 'X166') === null && run('{"id":"basicInfoGenerationBase","items":[{"content":"X166"}]}', 'X166') === null);
    ok('R9. версія площадки йде у вибір ціни нового лише коли канонічна версія (чистий декодер і площадка) її не дала; у конфлікті пошук не звужується', /trim: spec0\.version && spec0\.version\.conflict \? null : \(\(spec0\.version && spec0\.version\.value\) \|\| listing\.modification \|\| null\)/.test(src) && (src.match(/trim: (?:spec0|vehicleSpec)\.version\.value \|\| null/g) || []).length >= 3 && !/\(nhtsa && \(nhtsa\.Trim \|\| nhtsa\.Series\)\) \|\| listing\.modification \|\| null, body/.test(src));
  }

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('integritytest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('integritytest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('integritytest CRASHED:', e.stack || e.message); process.exit(1); });
