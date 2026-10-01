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
    ok('5-6. рядок середньої лише коли вона є: оголошення, середня або нічого', /if \(vc\.listing\) \{[\s\S]*?rail \+= item\([\s\S]*?\} else if \(vc\.average && typeof vc\.average\.value === 'number' && isFinite\(vc\.average\.value\)\) \{[\s\S]*?rail \+= item\(/.test(chart)
      && (chart.match(/rail \+= item\(/g) || []).length === 2);
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
      && /JSON\.stringify\(nhtsaForPrompt\(nhtsa\)\)/.test(src) && /if \(row\.ErrorCode != null && row\.ErrorCode !== ''\) nhtsa\.ErrorCode/.test(src));
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
    const src = fs.readFileSync('api/check.js', 'utf8');
    ok('18e. Check описує події після привʼязки номерів', /parsed\.history = annotateOwnerOrdinals\(parsed\.history, listing\.history_facts\);\n[^\n]*\n\s*if \(Array\.isArray\(parsed\.history\)\) parsed\.history = describeOwnerEvents\(parsed\.history, listing\.history_facts, lang\);/.test(src));
  }

  /* ===== межі ===== */
  {
    for (const f of ['api/score-v4.js', 'api/confidence.js']) ok('20. ' + f + ' не читає декодер, власників і стовпчик цін', !/decoderYearTrusted|ModelYearUntrusted|describeOwnerEvents|vc-kpi/.test(fs.readFileSync(f, 'utf8')));
  }

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('integritytest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('integritytest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('integritytest CRASHED:', e.stack || e.message); process.exit(1); });
