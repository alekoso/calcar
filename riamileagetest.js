/* Віджет AUTO.RIA "Пробіг" над хронологією. Внутрішньо неможливий за
   датами запис (зафіксовано ПІЗНІШЕ за саму перевірку) не є фактом
   пробігу: до моделі (історія, розбіжності, ризики, висновок) він не
   доходить, Score його не бачить. Узгоджений віджет лишається.
   Форма даних точно як у реальному Infiniti QX60 (25.09.2026): перевірено
   3 червня 2025, "останній зафіксований" 35 тис. від 07.10.2025, а
   хронологія 24 -> 34 -> 81 -> 82 тис. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };

const DASH = '\u2014';
const QX60 = 'Перевірено AUTO.RIA по VIN-коду 5N1CL0MB5KC570086 Застави, оренди, обтяження Перевірено 25 вересня 2026 Тип обтяження не виявлено Обмеження відчуження дозволено відчужувати '
  + 'Пробіг Перевірено 3 червня 2025 Останній перевірений пробіг 35 тис.км • 11 місяців тому останній зафіксований від 07.10.2025 джерело фіксації ' + DASH + ' Дилерське СТО '
  + 'Пробіг від продавця 82 тис.км ДТП та страхові випадки Перевірено 29 липня 2025 ДТП Немає офіційно зареєстрованих Страхові випадки в Україні Не виявлено '
  + 'Історія авто за VIN-кодом 24.09.26 Продається на AUTO.RIA Продавець вказав пробіг 82 тис. км 30.01.25 Продавалось на AUTO.RIA Продавець вказав пробіг 81 тис. км '
  + '08.12.24 Перевірено технічний стан на СТО Переглянути звіт 14.11.23 Перереєстрація ТЗ при видачі індивідуального номерного знаку 4-ий власник '
  + '14.11.23 Перереєстрація на нового власника за дог. купiвлi-продажу (СГ) 18.01.23 Перереєстрація при заміні номерного знаку 3-ій власник '
  + '22.09.22 Перереєстрація ТЗ на нов. власн. по договору укладеному в ТСЦ 17.09.22 Перевірено історію авто в Україні та Європі Переглянути звіт '
  + '12.03.22 Продавалось на AUTO.RIA Продавець вказав пробіг 34 тис. км 2-ий власник 20.01.22 Перереєстрація ТЗ на нов. власн. по договору укладеному в ТСЦ '
  + '30.04.21 Зафіксовано пробіг 24 тис. км Джерело фіксації ' + DASH + ' дилерське СТО 1-ий власник 23.06.20 Реєстрація нового тз, привезеного з-за кордону по ВМД';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_mwidget_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

(async () => {
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const V4 = await import('file://' + path.join(dir, 'api', 'score-v4.js'));

  /* 1. QX60: запис пізніше за перевірку -> відкинутий, у тексті для моделі його нема */
  const r = C.screenMileageWidget(QX60);
  ok(r.widget && r.widget.status === 'rejected' && r.widget.reason === 'record_after_check', 'неможливий віджет не відкинутий: ' + JSON.stringify(r.widget));
  ok(r.widget.check_date === '2025-06-03' && r.widget.record_date === '2025-10-07' && r.widget.km === 35000, 'технічний слід віджета неповний: ' + JSON.stringify(r.widget));
  ok(!/35 тис|07\.10\.2025|Останній перевірений пробіг|Дилерське СТО/.test(r.text), 'у тексті для моделі лишився неможливий запис');
  /* решта блоку перевірки і вся хронологія на місці */
  for (const keep of ['Пробіг від продавця 82 тис.км', 'ДТП та страхові випадки', '30.01.25 Продавалось на AUTO.RIA Продавець вказав пробіг 81 тис. км', '12.03.22 Продавалось на AUTO.RIA Продавець вказав пробіг 34 тис. км', '30.04.21 Зафіксовано пробіг 24 тис. км', 'Тип обтяження не виявлено']) {
    ok(r.text.includes(keep), 'загубилось: ' + keep);
  }
  ok(QX60.includes('35 тис.км'), 'вхідний текст змінено на місці (сирий доказ мусить лишатися)');

  /* 2. хронологія: 24k -> 34k -> 81k -> 82k, без 35k */
  const hf = C.extractHistoryFacts(r.text);
  const pts = [...new Map(hf.mileage_points.map(p => [p.date + '|' + p.km, p])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const chrono = [...pts.map(p => p.km), 82000];
  ok(JSON.stringify(chrono) === '[24000,34000,81000,82000]', 'хронологія не 24 -> 34 -> 81 -> 82: ' + JSON.stringify(chrono));
  ok(!hf.mileage_points.some(p => p.km === 35000), 'точка 35 тис. потрапила в хронологію');

  /* 3. Score v4: скрутки нема, вхід пробігу чистий */
  const mileagePoints = [...hf.mileage_points, { km: 82000, date: '2026-09-25', source: 'listing', family: 'current' }];
  const rb = V4.detectRollback(mileagePoints);
  ok(rb.rollback === null, 'хибна скрутка в Score: ' + JSON.stringify(rb.rollback));

  /* 4. узгоджений віджет (запис до дати перевірки) лишається як є */
  const okText = QX60.replace('від 07.10.2025', 'від 07.10.2024');
  const k = C.screenMileageWidget(okText);
  ok(k.widget.status === 'kept' && k.text === okText, 'узгоджений віджет вирізано');
  /* той самий день або наступна доба: не неможливо */
  ok(C.screenMileageWidget(QX60.replace('від 07.10.2025', 'від 04.06.2025')).widget.status === 'kept', 'допуск доби не працює');

  /* 4б. блок перевірки двічі в тексті для моделі (як на реальній сторінці QX60): обидва входження вирізані */
  const twice = C.screenMileageWidget(QX60 + ' Опис від продавця Авто офіційне. ' + QX60);
  ok(twice.widget.removed === 2 && !/35 тис|07\.10\.2025/.test(twice.text) && (twice.text.match(/Пробіг від продавця 82 тис\.км/g) || []).length === 2, 'друге входження віджета лишилось');

  /* 5. російська версія сторінки */
  const RU = 'Пробег Проверено 3 июня 2025 Последний проверенный пробег 35 тыс.км • 11 месяцев назад последний зафиксированный от 07.10.2025 источник фиксации ' + DASH + ' Дилерское СТО Пробег от продавца 82 тыс.км ДТП и страховые случаи';
  const ru = C.screenMileageWidget(RU);
  ok(ru.widget.status === 'rejected' && !/35 тыс/.test(ru.text) && ru.text.includes('Пробег от продавца 82 тыс.км'), 'RU: неможливий віджет не відкинутий');

  /* 6. без віджета і з абзацами: текст не чіпається */
  const plain = 'Опис від продавця\n\nАвто в гарному стані.\n\nОдин власник.';
  ok(C.screenMileageWidget(plain).text === plain && C.screenMileageWidget(plain).widget === null, 'текст без віджета змінено');

  /* 7. проводка: модель отримує відфільтрований текст, сирий текст сторінки не змінюється */
  const src = fs.readFileSync('api/check.js', 'utf8');
  ok(/const mileageWidget = screenMileageWidget\(aiTextRaw\);\s*const aiText = mileageWidget\.text;/.test(src), 'текст для моделі не проходить через фільтр віджета');
  ok(/\.\.\.extractListingMeta\(html, url, flat, text\)/.test(src), 'сирий текст сторінки (raw_page_text) більше не повний');
  ok(/mileage_widget: listing\.mileage_widget \|\| null,/.test(src), 'нема технічного сліду рішення в _meta');
  const share = fs.readFileSync('api/share.js', 'utf8');
  ok(!/mileage_widget/.test(share), 'технічний слід віджета потрапив у публічний звіт');

  if (errs.length) { console.log('MILEAGE WIDGET TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('mileage widget: запис пізніше за перевірку відкинутий до моделі · хронологія 24 -> 34 -> 81 -> 82 · без хибної скрутки · узгоджений віджет лишається · RU · сирий текст цілий');
})().catch(e => { console.log('MILEAGE WIDGET TEST CRASHED:', e); process.exit(1); });
