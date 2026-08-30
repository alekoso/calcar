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
  /* severe + подушки + unknown ремонт: помітно нижче */
  if (!near(f('6SYMZ7'), 6.5, 6.9)) errs.push('watchpoint severe+SRS (6SYMZ7): ' + f('6SYMZ7'));
  /* acceptance WP7V3G (свіжий Check): severe підтверджений подушками,
     нормальна хронологія пробігу БЕЗ конфлікту і БЕЗ rollback */
  if (!near(f('WP7V3G'), 6.5, 6.9)) errs.push('acceptance WP7V3G: ' + f('WP7V3G'));
  if (res['WP7V3G'].v3.normalized_current_problems.some(p => /MILEAGE|ROLLBACK/.test(p.type))) errs.push('WP7V3G: нормальна хронологія оштрафована');
  /* TYTP3J: глибока деформація БЕЗ підтвердження подушками/структурою = moderate */
  if (!near(f('TYTP3J'), 8.8, 9.0)) errs.push('TYTP3J moderate/vc: ' + f('TYTP3J'));
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
  if (!(f('HX8KT5') > f('6SYMZ7'))) errs.push('причинність: moderate не вища за severe: ' + f('HX8KT5') + ' vs ' + f('6SYMZ7'));
  /* moderate без unresolved SRS > moderate + unresolved SRS */
  if (!(f('HX8KT5') > f('8FVRYG'))) errs.push('причинність: moderate без SRS-concern не вища за moderate+SRS: ' + f('HX8KT5') + ' vs ' + f('8FVRYG'));
  /* severe-подія важча за moderate-подію за розміром штрафу */
  const penOf = pid => Math.max(0, ...res[pid].v3.accident_events.map(e => e.final_event_penalty));
  if (!(penOf('6SYMZ7') > penOf('HX8KT5'))) errs.push('причинність: штраф severe не більший за moderate: ' + penOf('6SYMZ7') + ' vs ' + penOf('HX8KT5'));
  /* acceptance 2HGRSW (BMW 113 тис., 8 років, petrol): вісь Пробіг
     більше НЕ 10 за саму послідовну хронологію */
  const bmwMil = res['2HGRSW'] && res['2HGRSW'].v3.score_dimensions.mileage;
  if (!bmwMil || bmwMil.score_available !== true) errs.push('2HGRSW: вісь Пробіг недоступна');
  else {
    if (bmwMil.score >= 8.5) errs.push('2HGRSW: 113 тис. отримали зависокий Пробіг: ' + bmwMil.score);
    if (!(bmwMil.score >= 6.5 && bmwMil.score <= 7.8)) errs.push('2HGRSW: Пробіг поза смугою: ' + bmwMil.score);
  }
  if (res['2HGRSW'] && !near(res['2HGRSW'].v3.final, 6.0, 6.2)) errs.push('2HGRSW: фінал зʼїхав: ' + f('2HGRSW'));

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
  console.log('pid      | v3  | Історія | Іст.пробігу | Пошк/відн | Стан за фото | Технічні');
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
