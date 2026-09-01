/* CalCar Score: калібрувальний тест на curated GOLD-наборі реальних кейсів
   (calibration-gold.json). Тримає watchpoints v3 initial production
   calibration БЕЗ зміни коефіцієнтів; перегляд чисел = свідоме оновлення
   і цього теста, і config. Синтетичні інваріанти живуть у scorev3test.js. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp2 = path.join(os.tmpdir(), 'calcar_calib_v2.mjs');
const tmp3 = path.join(os.tmpdir(), 'calcar_calib_v3.mjs');
fs.writeFileSync(tmp2, fs.readFileSync('api/score.js', 'utf8'));
fs.writeFileSync(tmp3, fs.readFileSync('api/score-v3.js', 'utf8'));

const errs = [];
const gold = JSON.parse(fs.readFileSync('calibration-gold.json', 'utf8'));

(async () => {
  const { computeScore } = await import('file://' + tmp2);
  const { computeScoreV3, SCORE_CONFIG_V3 } = await import('file://' + tmp3);
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

  /* охайність gold-набору: свідомі рядки, без сміття і дублів */
  const pids = new Set();
  for (const r of gold.cases) {
    if (!r.pid || !r.cov || typeof r.cov !== 'object') errs.push('gold-рядок без pid/cov: ' + JSON.stringify(r).slice(0, 60));
    if (pids.has(r.pid)) errs.push('дубль pid у gold-наборі: ' + r.pid);
    pids.add(r.pid);
  }

  const res = {};
  const sevDist = { minor: 0, moderate: 0, severe: 0, indeterminate: 0 };
  let events = 0;
  for (const r of gold.cases) {
    const v2 = quiet(() => computeScore(r.findings, r.cov));
    const v3 = computeScoreV3({
      findings: r.findings,
      coverageInputs: r.cov,
      vehicle: r.vehicle || null,
      auctionMeta: (r.cov.auction_record_exists && r.auction && r.auction.lot_id) ? r.auction : null,
      historicalVisual: r.hv || null,
      accidentRecord: r.accident_recorded === true ? { recorded: true, note: r.accident_note || null } : null,
    });
    res[r.pid] = { v2, v3 };
    for (const e of v3.accident_events || []) { events++; sevDist[e.derived_severity]++; }
  }
  const f = pid => res[pid] && res[pid].v3.final;
  const near = (x, lo, hi) => typeof x === 'number' && x >= lo - 1e-9 && x <= hi + 1e-9;

  /* watchpoints v3-initial (коефіцієнти НЕ міняти, поки не набереться
     достатня вибірка: орієнтир 50+ реальних accident events у корпусі) */
  if (SCORE_CONFIG_V3.ACCIDENT_BASE !== 0.3) errs.push('watchpoint: ACCIDENT_BASE зʼїхав з 0.3');
  if (SCORE_CONFIG_V3.CALIBRATION_TAG !== gold.config_tag) errs.push('config_tag gold-набору не збігається з SCORE_CONFIG_V3');
  /* indeterminate-ДТП з записом площадки: верх шкали, стеля тримає */
  if (!near(f('5C6HJ7'), 9.1, 9.3)) errs.push('watchpoint indeterminate-ДТП (5C6HJ7): ' + f('5C6HJ7'));
  /* moderate + невідомий ремонт без подушок: ~8.7 */
  if (!near(f('HX8KT5'), 8.6, 8.8)) errs.push('watchpoint moderate/unknown (HX8KT5): ' + f('HX8KT5'));
  if (!near(f('AXGFW9'), 8.6, 8.8)) errs.push('watchpoint moderate/unknown (AXGFW9): ' + f('AXGFW9'));
  /* moderate + подушки + непідтверджена SRS */
  if (!near(f('8FVRYG'), 8.0, 8.2)) errs.push('watchpoint moderate+SRS (8FVRYG): ' + f('8FVRYG'));
  /* severity-корекція 2026-09-01: подушки більше НЕ корроборують
     major_deformation. Події "навісні панелі + подушки" свідомо
     перекласифіковані в moderate (1.3 + SRS 0.6 = 1.9), severe тепер
     вимагає ФІЗИЧНОГО доказу: несуча деформація, структура, зміщене
     колесо. Старі смуги 6.5-6.9 оновлені свідомо, НЕ підгонкою */
  if (!near(f('6SYMZ7'), 8.0, 8.2)) errs.push('watchpoint moderate+SRS після re-tier (6SYMZ7): ' + f('6SYMZ7'));
  const syE = res['6SYMZ7'].v3.accident_events[0];
  if (!syE || syE.derived_severity !== 'moderate') errs.push('6SYMZ7: подушки без несучої деформації мали дати moderate, а не ' + (syE && syE.derived_severity));
  /* acceptance WP7V3G (свіжий Check): подушки + деформація навісних панелей
     = moderate; нормальна хронологія пробігу БЕЗ конфлікту і БЕЗ rollback */
  if (!near(f('WP7V3G'), 8.0, 8.2)) errs.push('acceptance WP7V3G: ' + f('WP7V3G'));
  /* acceptance K530EB (WBAJA9C55JB252679): удар лише по навісних панелях +
     розкриті подушки = moderate 8.1; до корекції давав severe 6.7 */
  if (!near(f('K530EB'), 8.0, 8.2)) errs.push('acceptance 530e (K530EB): ' + f('K530EB'));
  const kE = res['K530EB'].v3.accident_events[0];
  if (!kE || kE.derived_severity !== 'moderate') errs.push('K530EB: мав бути moderate, а не ' + (kE && kE.derived_severity));
  if (kE && kE.final_event_penalty !== 1.3) errs.push('K530EB: штраф події не 1.3: ' + kE.final_event_penalty);
  if (!res['K530EB'].v3.unresolved_safety_concerns.some(c => c.type === 'SRS_RESTORATION_UNVERIFIED' && c.penalty === 0.6)) errs.push('K530EB: SRS restoration 0.6 загублений');
  /* acceptance M550LB (WBAJB9C50JB049616): видима деформація НЕСУЧОЇ
     передньої зони тримає severe без подушок-корроборації */
  if (!near(f('M550LB'), 6.5, 6.9)) errs.push('acceptance M550i (M550LB): ' + f('M550LB'));
  const mE = res['M550LB'].v3.accident_events[0];
  if (!mE || mE.derived_severity !== 'severe') errs.push('M550LB: мав бути severe, а не ' + (mE && mE.derived_severity));
  if (!mE || !mE.severity_basis.includes('inner_module_substantial_damage')) errs.push('M550LB: severe не через суттєве ушкодження внутрішньої зони: ' + JSON.stringify(mE && mE.severity_basis));
  /* severe БЕЗ заявленого структурного: кап 5.5 не вмикається */
  if (res['M550LB'].v3.applied_hard_caps.some(c => c.name.includes('STRUCTURAL'))) errs.push('M550LB: severe помилково увімкнув structural кап');
  if (mE && mE.structural !== false) errs.push('M550LB: structural заявлений без structural evidence');
  /* K530EB: легасі major_deformation_visible=true у кейсі Є, і саме він
     БІЛЬШЕ не робить подію severe: глибина вирішує */
  const kHv = gold.cases.find(c => c.pid === 'K530EB').hv;
  if (kHv.major_deformation_visible !== true) errs.push('K530EB: легасі-прапорець прибрали з кейса, регрес більше нічого не доводить');
  if (kE && kE.severity_basis.some(b => /major_deformation/.test(b))) errs.push('K530EB: major_deformation досі в severity_basis');
  /* "розібраний передок" без деформації внутрішніх елементів: НЕ severe */
  for (const pid of ['TYTP3J', '2HGRSW', 'AXGFW9']) {
    const e = res[pid].v3.accident_events[0];
    if (!e) { errs.push(pid + ': подія зникла'); continue; }
    if (e.derived_severity === 'severe') errs.push(pid + ': вскритий передок без деформації став severe');
    if (!e.severity_basis.includes('inner_module_exposed_without_deformation')) errs.push(pid + ': нема ознаки "вскрито без деформації": ' + JSON.stringify(e.severity_basis));
  }
  if (res['WP7V3G'].v3.normalized_current_problems.some(p => /MILEAGE|ROLLBACK/.test(p.type))) errs.push('WP7V3G: нормальна хронологія оштрафована');
  /* TYTP3J: глибока деформація БЕЗ підтвердження подушками/структурою =
     moderate. Бал 8.9 -> 8.7 свідомо: visually_consistent став
     нейтральним (він доводить лише відсутність видимих протиріч) */
  if (!near(f('TYTP3J'), 8.6, 8.8)) errs.push('TYTP3J moderate/vc: ' + f('TYTP3J'));
  const tyE = res['TYTP3J'].v3.accident_events[0];
  if (!tyE || tyE.derived_severity !== 'moderate') errs.push('TYTP3J: непідтверджена деформація мала бути moderate, а не ' + (tyE && tyE.derived_severity));
  /* flood: кап тримає */
  if (f('M3PKUY') !== 4.5) errs.push('watchpoint flood cap (M3PKUY): ' + f('M3PKUY'));
  if (!res['M3PKUY'].v3.applied_hard_caps.some(c => c.name.includes('FLOOD'))) errs.push('flood без капа');
  /* eligibility: недостатні кейси лишаються недоступними в ОБОХ версіях */
  for (const pid of ['XBFHQ6', 'VE2Q7H']) {
    if (res[pid].v3.score_available !== false) errs.push(pid + ': v3 мав бути недоступний');
    if (res[pid].v2.score_available !== false) errs.push(pid + ': v2 мав бути недоступний');
  }
  /* Проблема v2 була НЕ в самих значеннях 6.9-7.2, а в причинно
     неправильній кластеризації РІЗНИХ машин біля однієї точки. Тому
     зникнення старої проблеми тримають лише ПРИЧИННІ інваріанти нижче;
     реальна машина має право чесно отримати 6.9-7.2 зі своїх findings,
     coverage і капів. Кількість балів у смузі лишається суто
     діагностичною метрикою в звіті калібрування (друк наприкінці) */
  if (!(f('M679AQ') > f('HX8KT5'))) errs.push('причинність: чиста не вища за moderate: ' + f('M679AQ') + ' vs ' + f('HX8KT5'));
  if (!(f('HX8KT5') > f('6SYMZ7'))) errs.push('причинність: moderate без подушок не вища за moderate+SRS: ' + f('HX8KT5') + ' vs ' + f('6SYMZ7'));
  if (!(f('K530EB') > f('M550LB'))) errs.push('причинність: навісний удар не вищий за несучу деформацію: ' + f('K530EB') + ' vs ' + f('M550LB'));
  /* moderate без unresolved SRS > moderate + unresolved SRS */
  if (!(f('HX8KT5') > f('8FVRYG'))) errs.push('причинність: moderate без SRS-concern не вища за moderate+SRS: ' + f('HX8KT5') + ' vs ' + f('8FVRYG'));
  /* severe-подія важча за moderate-подію за розміром штрафу */
  const penOf = pid => Math.max(0, ...res[pid].v3.accident_events.map(e => e.final_event_penalty));
  if (!(penOf('M550LB') > penOf('HX8KT5'))) errs.push('причинність: штраф severe не більший за moderate: ' + penOf('M550LB') + ' vs ' + penOf('HX8KT5'));
  /* acceptance 2HGRSW (BMW 113 тис., 8 років, petrol): вісь Пробіг
     більше НЕ 10 за саму послідовну хронологію */
  const bmwMil = res['2HGRSW'] && res['2HGRSW'].v3.score_dimensions.mileage;
  if (!bmwMil || bmwMil.score_available !== true) errs.push('2HGRSW: вісь Пробіг недоступна');
  else {
    /* annual ~13.8к при reference petrol 12к: low-8, не 10 і не старі 7.3 */
    if (!(bmwMil.score >= 8.0 && bmwMil.score <= 8.5)) errs.push('2HGRSW: Пробіг поза low-8 смугою: ' + bmwMil.score);
    if (bmwMil.age_source !== 'model_year_midpoint') errs.push('2HGRSW: несподіване джерело віку: ' + bmwMil.age_source);
  }
  /* re-tier 2026-09-01: фронт по навісних панелях + подушка = moderate */
  if (res['2HGRSW'] && !near(res['2HGRSW'].v3.final, 7.4, 7.6)) errs.push('2HGRSW: фінал зʼїхав: ' + f('2HGRSW'));

  /* показаний бал ніколи не вище стелі чи капа */
  for (const [pid, r] of Object.entries(res)) {
    if (typeof r.v3.final !== 'number') continue;
    if (r.v3.final > r.v3.coverage_cap + 1e-9) errs.push(pid + ': бал ' + r.v3.final + ' вище стелі ' + r.v3.coverage_cap);
    for (const c of r.v3.applied_hard_caps) if (r.v3.final > c.value + 1e-9) errs.push(pid + ': бал вище капа ' + c.name);
  }
  if (!events) errs.push('gold-набір без жодної accident-події: розподіл severity не перевіряється');

  fs.unlinkSync(tmp2); fs.unlinkSync(tmp3);
  if (errs.length) {
    console.error('CALIBRATION TEST FAILED:');
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }
  /* діагностика: підоцінки по gold-набору (пояснювальний шар, у формулу не входить) */
  console.log('pid      | v3  | Історія | Пробіг | Пошк/відн | Стан за фото | Технічні');
  for (const [pid, r] of Object.entries(res)) {
    if (typeof r.v3.final !== 'number') continue;
    const d = r.v3.score_dimensions || {};
    const cell = k => (d[k] && d[k].score_available ? d[k].score.toFixed(1) : '  - ');
    console.log([pid.padEnd(8), r.v3.final.toFixed(1), '  ' + cell('history'), '  ' + cell('mileage'), '   ' + cell('damage_repair'), '   ' + cell('current_condition'), '  ' + cell('technical')].join(' | '));
  }

  /* діагностика розподілу (НЕ pass/fail): скільки балів у смузі 6.9-7.2 */
  const finals = Object.values(res).map(r => r.v3.final).filter(x => typeof x === 'number');
  const diagWin = finals.filter(x => x >= 6.9 && x <= 7.2).length;
  console.log('gold-набір ' + gold.cases.length + ' кейсів · події ' + events + ' · severity ' + JSON.stringify(sevDist) + ' · watchpoints v3-initial тримаються');
  console.log('діагностика розподілу: у смузі 6.9-7.2 зараз ' + diagWin + ' з ' + finals.length + ' (інформаційно, не критерій)');
  console.log('CALIBRATION TEST PASSED');
})().catch(e => { console.error('CALIBRATION TEST CRASHED:', e); process.exit(1); });
