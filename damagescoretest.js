/* Damage Score: спільна проекція замороженої accident-моделі Check.
   Тест доводить три речі: другої моделі пошкоджень нема, Check не
   змінився, невідомо не штрафує. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const errs = [];

/* api/* це ESM: збираємо tmp-пакет, як в інших тестах */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_ds_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of ['damage-score.js', 'score-v3.js', 'visual-signals.js']) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

(async () => {
  const M = await import('file://' + path.join(dir, 'api', 'damage-score.js'));
  const V3 = await import('file://' + path.join(dir, 'api', 'score-v3.js'));
  const { computeDamageScore: ds, damageCoverage, labelForDamage } = M;
  const CFG = V3.SCORE_CONFIG_V3;

  /* ---- 1. жодної власної ваги: усі числа з SCORE_CONFIG_V3 ---- */
  {
    const src = fs.readFileSync('api/damage-score.js', 'utf8');
    const body = src.slice(src.indexOf('export function computeDamageScore'));
    /* у тілі розрахунку не має бути голих числових ваг, окрім нейтральних 10, 0, 100 і 1 */
    const nums = (body.match(/(?<![\w.])\d+\.\d+(?![\w])/g) || []).filter(n => !['0.0'].includes(n));
    if (nums.length) errs.push('у Damage Score зʼявилась власна числова вага: ' + nums.join(', '));
    for (const fn of ['resolveAccidentEvents', 'deriveSeverity', 'normalizeCurrentProblems', 'resolveDamageDepth']) {
      if (!src.includes(fn + '(')) errs.push('не використовується спільна функція ' + fn);
    }
    if (/function (deriveSeverity|resolveAccidentEvents|resolveDamageDepth)/.test(src)) errs.push('друга копія accident-логіки в damage-score.js');
    for (const f of ['mileage', 'odometer', 'title_code', 'keys', 'equipment', 'price']) {
      if (new RegExp('\\b' + f + '\\b').test(body)) errs.push('у формулу просочився нерелевантний фактор: ' + f);
    }
  }

  /* ---- 2. Check не змінився: ті самі функції дають ті самі штрафи ---- */
  {
    const hv = { damage_depth: 'exterior_panels_only', fascia_status: 'damaged_but_mounted', visible_damage_zones: ['капот', 'бампер'], srs_visual_status: 'deployed_visible' };
    const auctionMeta = { lot_id: '1', house: 'copart', sale_date: '2026-01-01', primary_damage: 'Front End', airbags: { deployed: true, raw: 'DEPLOYED' } };
    const v3 = V3.computeScoreV3({ findings: [], coverageInputs: { identity_confirmed: true, photos_count: 8, auction_record_exists: true }, auctionMeta, historicalVisual: hv });
    const d = ds({ findings: [], auctionMeta, hv, coverage: { photos_analyzed: 8, auction_damage_known: true } });
    const a = v3.accident_events[0], b = d.accident_events[0];
    if (!a || !b) errs.push('подія не побудувалась в одній із моделей');
    else {
      if (a.derived_severity !== b.derived_severity) errs.push('severity розійшлась: ' + a.derived_severity + ' проти ' + b.derived_severity);
      if (a.final_event_penalty !== b.final_event_penalty) errs.push('штраф події розійшовся: ' + a.final_event_penalty + ' проти ' + b.final_event_penalty);
    }
    const s3 = (v3.unresolved_safety_concerns[0] || {}).penalty, sd = (d.unresolved_safety_concerns[0] || {}).penalty;
    if (s3 !== sd) errs.push('SRS restoration розійшовся: ' + s3 + ' проти ' + sd);
  }

  const ev = (src, d) => [{ source: src, ref: 'x', description: d }];
  const F = (type, id, extra = {}) => ({ type, event_id: id, evidence: ev('current_photos', 'фото'), ...extra });
  const LOT = { lot_id: '551', house: 'copart', sale_date: '2026-09-10' };
  const COV = { photos_analyzed: 8, auction_damage_known: true };
  const run = o => ds({ coverage: COV, ...o });

  /* ---- 3. контрольні кейси калібрування Check ---- */
  const k530 = run({ auctionMeta: { ...LOT, primary_damage: 'Front End', airbags: { deployed: true, raw: 'DEPLOYED' } },
    hv: { damage_depth: 'exterior_panels_only', fascia_status: 'damaged_but_mounted', visible_damage_zones: ['капот', 'бампер'] } });
  if (k530.accident_events[0].derived_severity !== 'moderate') errs.push('530e: не moderate');
  if (k530.accident_events[0].final_event_penalty !== 1.3) errs.push('530e: штраф події не 1.3: ' + k530.accident_events[0].final_event_penalty);
  if (k530.safety_penalty !== 0.6) errs.push('530e: SRS restoration не 0.6');
  if (k530.score !== 8.1) errs.push('530e: Damage Score не 8.1: ' + k530.score);
  if (k530.label_key !== 'Moderate damage') errs.push('530e: ярлик не Moderate damage: ' + k530.label_key);

  const m550 = run({ auctionMeta: { ...LOT, primary_damage: 'Front End', airbags: { deployed: true, raw: 'DEPLOYED' } },
    hv: { damage_depth: 'inner_structure_or_module', inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial', inner_components_exposed: true, visible_damage_zones: ['перед', 'капот'] } });
  if (m550.accident_events[0].derived_severity !== 'severe') errs.push('M550i: не severe');
  if (m550.accident_events[0].final_event_penalty !== 2.7) errs.push('M550i: штраф події не 2.7: ' + m550.accident_events[0].final_event_penalty);
  if (m550.score !== 6.7) errs.push('M550i: Damage Score не 6.7: ' + m550.score);
  if (m550.label_key !== 'Serious damage') errs.push('M550i: ярлик не Serious damage: ' + m550.label_key);
  if (m550.applied_hard_caps.some(c => c.name.includes('STRUCTURAL'))) errs.push('M550i: severe без structural-заяви не має вмикати кап');

  /* ---- 4. severe + підтверджений ремонт: бал росте, ярлик не мʼякшає ---- */
  const restored = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' },
    hv: { damage_depth: 'inner_structure_or_module', inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial', inner_components_exposed: true, visible_damage_zones: ['перед'] },
    findings: [F('STRUCTURAL_DAMAGE', 'a1', { repair_status: 'confirmed_ok' })] });
  if (!(restored.score > m550.score)) errs.push('підтверджений ремонт не підняв бал');
  if (restored.label_key !== 'Serious damage') errs.push('severe після ремонту знизився до ' + restored.label_key + ': історична тяжкість мусить бути підлогою');
  if (restored.restoration_confirmed !== true) errs.push('відновлення не позначене');
  if (restored.applied_hard_caps.length) errs.push('confirmed_ok не зняв структурний кап');

  /* ---- 5. структурне без підтвердженого ремонту: кап 5.5 ---- */
  const structural = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' },
    hv: { damage_depth: 'inner_structure_or_module', inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'substantial', inner_components_exposed: true, visible_damage_zones: ['перед'] },
    findings: [F('STRUCTURAL_DAMAGE', 'a1', { repair_status: 'unknown' })] });
  if (structural.score !== 5.5) errs.push('структурне без ремонту: не 5.5, а ' + structural.score);

  /* ---- 6. кілька незалежних аварій сумуються існуючим резолвером ---- */
  const multi = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' },
    hv: { damage_depth: 'exterior_panels_only', fascia_status: 'damaged_but_mounted', visible_damage_zones: ['перед'] },
    findings: [F('STRUCTURAL_DAMAGE', 'old_2019', { repair_status: 'unknown', evidence: ev('historical_listing', 'ДТП 2019, задня частина') })] });
  if (multi.accident_events.length !== 2) errs.push('дві незалежні аварії не розділились: ' + multi.accident_events.length);
  if (multi.accident_penalty !== 4) errs.push('штрафи двох подій не склались у 4: ' + multi.accident_penalty);

  /* ---- 7. затоплення і пожежа: існуючі штрафи і капи ---- */
  const flood = run({ auctionMeta: { ...LOT, primary_damage: 'Water/Flood' }, hv: { damage_depth: 'exterior_panels_only', fascia_status: 'intact_mounted', visible_damage_zones: ['салон'] },
    findings: [F('FLOOD', 'f1', { evidence: ev('us_auction', 'Water/Flood у даних лота') })] });
  if (flood.score !== 4.5) errs.push('затоплення: не 4.5, а ' + flood.score);
  if (flood.label_key !== 'Severe damage') errs.push('затоплення: ярлик ' + flood.label_key);
  const fire = run({ auctionMeta: { ...LOT, primary_damage: 'Burn' }, hv: { damage_depth: 'exterior_panels_only', fascia_status: 'intact_mounted', visible_damage_zones: ['моторний відсік'] },
    findings: [F('FIRE', 'b1', { evidence: ev('us_auction', 'Burn у даних лота') })] });
  if (fire.score !== 4.5) errs.push('пожежа: не 4.5, а ' + fire.score);

  /* ---- 8. inner-module БЕЗ заяви про несучу структуру ---- */
  const innerLoc = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' },
    hv: { damage_depth: 'inner_structure_or_module', inner_component_deformation_visible: 'visible', inner_component_damage_extent: 'localized', inner_components_exposed: true, visible_damage_zones: ['перед'] } });
  if (innerLoc.accident_events[0].derived_severity !== 'moderate') errs.push('inner localized мав бути moderate');
  if (innerLoc.applied_hard_caps.length) errs.push('inner localized не має вмикати кап');

  /* ---- 9. рівно 10 лише коли пошкоджень нема; косметика < 10 ---- */
  const clean = run({ auctionMeta: { ...LOT, primary_damage: 'Normal Wear' }, hv: { damage_depth: 'exterior_panels_only', fascia_status: 'intact_mounted', visible_damage_zones: [], cosmetic_only: false } });
  if (clean.score !== 10) errs.push('без пошкоджень мав бути рівно 10, а не ' + clean.score);
  const cosmetic = run({ auctionMeta: { ...LOT, primary_damage: 'Minor Dent/Scratches' },
    hv: { damage_depth: 'exterior_panels_only', fascia_status: 'intact_mounted', cosmetic_only: true, visible_damage_zones: ['задній бампер'] } });
  if (!(cosmetic.score < 10)) errs.push('підтверджена косметика не має давати рівно 10: ' + cosmetic.score);
  if (cosmetic.accident_events[0].derived_severity !== 'minor') errs.push('косметика не minor: ' + cosmetic.accident_events[0].derived_severity);

  /* ---- 10. покриття: не кількість фото ---- */
  const badPhotos = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' }, hv: { damage_depth: 'indeterminate', fascia_status: 'not_visible' }, coverage: { photos_analyzed: 4, auction_damage_known: true } });
  if (badPhotos.score_available) errs.push('4 слабких фото + опис лота не мали дати бал');
  const manyPhotos = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' }, hv: { damage_depth: 'indeterminate', fascia_status: 'not_visible' }, coverage: { photos_analyzed: 20, auction_damage_known: true } });
  if (manyPhotos.score_available) errs.push('багато фото без видимої зони удару не мали дати бал');
  const goodExterior = run({ auctionMeta: { ...LOT, primary_damage: 'Rear End' }, hv: { damage_depth: 'exterior_panels_only', fascia_status: 'intact_mounted', visible_damage_zones: ['задній бампер'] }, coverage: { photos_analyzed: 8, auction_damage_known: true } });
  if (!goodExterior.score_available) errs.push('8 добрих зовнішніх кадрів із визначеною глибиною мали дати бал');
  const twoStrong = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' }, hv: { damage_depth: 'indeterminate', load_bearing_structure_deformation_visible: true, visible_damage_zones: ['перед'] }, coverage: { photos_analyzed: 2, auction_damage_known: false } });
  if (!twoStrong.score_available) errs.push('2 кадри з очевидною деформацією несучих мали дати бал');
  const noData = run({ auctionMeta: { ...LOT, primary_damage: 'Front End' }, hv: null, coverage: { photos_analyzed: 0, auction_damage_known: true } });
  if (noData.score_available) errs.push('без фото і без сигналів бал показувати не можна');

  /* ---- 11. невідомо не дорівнює погано ---- */
  {
    const known = run({ auctionMeta: { ...LOT, primary_damage: 'Rear End' }, hv: { damage_depth: 'exterior_panels_only', fascia_status: 'intact_mounted', visible_damage_zones: ['задній бампер'], inner_component_deformation_visible: 'not_visible' } });
    const unknown = run({ auctionMeta: { ...LOT, primary_damage: 'Rear End' }, hv: { damage_depth: 'exterior_panels_only', fascia_status: 'intact_mounted', visible_damage_zones: ['задній бампер'], inner_component_deformation_visible: 'indeterminate' } });
    if (unknown.score < known.score) errs.push('невідомий стан внутрішніх елементів оштрафував бал: ' + unknown.score + ' проти ' + known.score);
  }

  /* ---- 12. ярлики і межі ---- */
  if (labelForDamage(9.0, 'indeterminate') !== 'Minor damage') errs.push('9.0 не Minor');
  if (labelForDamage(7.0, 'indeterminate') !== 'Moderate damage') errs.push('7.0 не Moderate');
  if (labelForDamage(5.5, 'indeterminate') !== 'Serious damage') errs.push('5.5 не Serious');
  if (labelForDamage(5.4, 'indeterminate') !== 'Severe damage') errs.push('5.4 не Severe');
  if (labelForDamage(9.5, 'severe') !== 'Serious damage') errs.push('історичний severe не тримає підлогу ярлика');

  /* ---- 13. словники мають ярлики ---- */
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) {
    const s = fs.readFileSync(f, 'utf8');
    for (const k of ['Damage assessment', 'Minor damage', 'Moderate damage', 'Serious damage', 'Severe damage', 'Not enough data', 'restoration confirmed']) {
      if (!s.includes("'" + k + "':")) errs.push(f + ': нема ключа "' + k + '"');
    }
  }

  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('спільна модель без власних ваг · 530e 8.1 · M550i 6.7 · severe+ремонт тримає ярлик · покриття не за числом фото · unknown не штрафує');
  console.log('DAMAGE SCORE TEST PASSED');
})();
