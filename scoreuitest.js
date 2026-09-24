/* Компонент "Оцінка CalCar + повнота перевірки" у result-check.html.
   Функції компонента виконуються на заглушках DOM: причинні штрафи Score v4
   замість старих підоцінок, внутрішнє число повноти ніде не видно, маркер
   стоїть на збереженому overall_internal, риска "достатньо" = 70, старий
   звіт v3 не ламається і не отримує вигаданої повноти, бал береться як є. */
const fs = require('fs');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };
const page = fs.readFileSync('result-check.html', 'utf8');

/* виділяємо функції компонента з тексту сторінки */
const grab = name => {
  const i = page.indexOf('function ' + name + '(');
  if (i < 0) { errs.push('нема функції ' + name); return ''; }
  let depth = 0, j = page.indexOf('{', i);
  for (let k = j; k < page.length; k++) {
    if (page[k] === '{') depth++;
    else if (page[k] === '}') { depth--; if (depth === 0) return page.slice(i, k + 1); }
  }
  return '';
};
const src = ['scoreAmount', 'scoreCausalRows', 'coverageRail', 'renderScoreBlock'].map(grab).join('\n');

function mount(D) {
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', hidden: true, style: {}, setAttribute() {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, right: 400, top: 0, bottom: 60 }), contains: () => false, focus() {} });
  ['scoreSlot', 'scorePop', 'scoreOv'].forEach(el);
  const env = {
    $: id => (['scoreCard', 'scoreClose'].includes(id) ? el(id) : els[id] || null),
    esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    t: s => s,
    document: { addEventListener() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 800 },
  };
  const fn = new Function('$', 'esc', 't', 'document', 'window', src + '\nreturn { renderScoreBlock, scoreCausalRows, coverageRail, scoreAmount };');
  const api = fn(env.$, env.esc, env.t, env.document, env.window);
  api.renderScoreBlock(D);
  return { slot: els.scoreSlot.innerHTML, pop: els.scorePop.innerHTML, api };
}
const visibleText = html => html.replace(/<[^>]*>/g, ' ');
const conf = (v, over = {}) => ({ confidence_version: 'v1', overall_internal: v, text_key: v >= 85 ? 'Studied in detail' : v >= 70 ? 'Enough data' : v >= 40 ? 'Partially checked' : 'Data is limited', sufficient_tick: 70,
  domains: { history: { status: 'partial', score_internal: 51.1 }, photos: { status: 'partial', score_internal: 42 }, mileage: { status: 'partial', score_internal: 40 }, identity: { status: 'complete', score_internal: 100 } }, caps_applied: [], ...over });
const v4 = (items, final) => ({ score_version: 'v4', score_available: true, final, items, inputs: {} });

/* 1. v4: причинні штрафи, без старих псевдо-підоцінок */
{
  const D = { verdict: { summary: 'x', score: 7.3 }, confidence: conf(66), score_breakdown: v4([
    { key: 'accident_latest_medium', input: 'accident_history', amount: 1.2 },
    { key: 'input7:age', input: 'vehicle_age', amount: 0.51 },
    { key: 'input8:owners', input: 'vehicle_owners', amount: 0.2, params: { owners_count: 3 } },
    { key: 'input2:dent:front', input: 'body_condition', amount: 0.5 }, { key: 'input2:corrosion:roof', input: 'body_condition', amount: 0.6 },
    { key: 'input4:intensity', input: 'mileage_intensity', amount: 0.3 },
  ], 7.3) };
  const r = mount(D);
  const tx = visibleText(r.pop);
  for (const lbl of ['Accident: medium damage', 'Vehicle age', 'Number of owners', 'Body condition from photos', 'Mileage intensity', 'What affected the score']) ok(tx.includes(lbl), 'v4: нема рядка ' + lbl);
  for (const legacy of ['Vehicle history', 'Damage and repair', 'Condition from photos', 'Score details']) ok(!tx.includes(legacy), 'v4: старий псевдо-рядок ' + legacy);
  ok(tx.includes('−1.1'), 'кузов згрупований в один рядок: 0.5 + 0.6 = 1.1');
  ok(tx.indexOf('Accident: medium damage') < tx.indexOf('Body condition from photos') && tx.indexOf('Body condition from photos') < tx.indexOf('Vehicle age'), 'рядки відсортовані за вагою штрафу');
  ok(/7\.3/.test(visibleText(r.slot)), 'бал у закритій картці');
  /* 2. внутрішнє число повноти ніде не видно */
  ok(!/\b66\b/.test(tx) && !/\b66\b/.test(visibleText(r.slot)), 'внутрішнє число повноти видно користувачу');
  ok(!/%/.test(tx), 'відсотки у видимому тексті');
  ok(!/High|Medium|Low\b/.test(tx.replace(/Low detected risk|High detected risk/g, '')), 'рівні High/Medium/Low у повноті');
  /* 3. маркер = збережений overall_internal, риска достатньо = 70 */
  const knobs = [...r.pop.matchAll(/cv-knob" data-pos="([\d.]+)" style="left:([\d.]+)%/g), ...r.slot.matchAll(/cv-knob" data-pos="([\d.]+)" style="left:([\d.]+)%/g)];
  ok(knobs.length === 2, 'маркер у картці і в панелі: ' + knobs.length);
  for (const k of knobs) ok(Number(k[1]) === 66 && Number(k[2]) === 66, 'маркер не на збереженому значенні: ' + k[0]);
  ok(/cv-tick" style="left:70%/.test(r.pop) && /cv-tick" style="left:70%/.test(r.slot), 'риска достатньо не на 70');
  ok(tx.includes('Partially checked') && tx.includes('Limited data') && tx.includes('Sufficient') && tx.includes('Well covered'), 'текст і підписи шкали');
  ok(tx.includes('Photos and current condition') && tx.includes('Vehicle data'), 'рядки покриття доменів');
}
/* 4. бал не перераховується фронтендом: показується збережений final як є */
{
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(90), score_breakdown: v4([{ key: 'input7:age', input: 'vehicle_age', amount: 0.3 }], 8.8) });
  ok(/8\.8/.test(visibleText(r.slot)) && !/9\.7/.test(visibleText(r.slot)), 'фронтенд перерахував бал замість збереженого final');
}
/* 5. без штрафів: нейтральний текст */
{
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(88), score_breakdown: v4([], 10) });
  ok(visibleText(r.pop).includes('No significant factors lowering the score were found.'), 'нема тексту "суттєвих факторів не знайдено"');
}
/* 6. старий звіт v3: без вигаданої повноти, осі як fallback */
{
  const r = mount({ verdict: { summary: 'x', score: 6.7 }, score_breakdown: { score_version: 'v3', score_available: true, final: 6.7, score_dimensions: { history: { score_available: true, score: 6.5 }, mileage: { score_available: true, score: 7.3 } } } });
  const tx = visibleText(r.pop);
  ok(!/cv-knob/.test(r.pop + r.slot), 'v3: зʼявилась шкала повноти без знімка');
  ok(tx.includes('No coverage data for this check'), 'v3: нема нейтрального тексту про повноту');
  ok(tx.includes('Score details') && tx.includes('6.5'), 'v3: fallback осей відсутній');
  ok(/6\.7/.test(visibleText(r.slot)), 'v3: бал');
}
/* 7. найстаріший звіт лише з verdict.score і Score недоступний */
{
  const r = mount({ verdict: { summary: 'x', score: 7.44 } });
  ok(/7\.4/.test(visibleText(r.slot)), 'легасі verdict.score');
  const u = mount({ verdict: { summary: 'x' }, confidence: conf(50), score_breakdown: { score_version: 'v4', score_available: false, final: null, items: [{ key: 'input7:age', input: 'vehicle_age', amount: 1 }] } });
  ok(visibleText(u.slot).includes('Not enough data to score'), 'недоступний Score: текст');
  ok(!visibleText(u.pop).includes('What affected the score'), 'недоступний Score: штрафи не показуються без числа');
  ok(/cv-knob/.test(u.pop), 'недоступний Score: повнота показується');
}
/* 8. CSS: дизайн-система шкали пробігу, мобільна шторка без переповнення */
{
  const css = (page.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  ok(/\.sc-pop\{[^}]*border-radius:12px[^}]*box-shadow:0 10px 28px rgba\(20,22,25,\.16\)/.test(css), 'панель не в стилі шкали пробігу');
  ok(/\.mi-pop\{[^}]*border-radius:12px[^}]*box-shadow:0 10px 28px rgba\(20,22,25,\.16\)/.test(css), 'шкала пробігу змінилась');
  ok(/\.sc-pop\{[^}]*max-width:calc\(100vw - 32px\)/.test(css), 'панель ширша за екран');
  ok(/@media\(max-width:620px\)\{[\s\S]*?\.sc-pop\{[^}]*bottom:12px/.test(css), 'нема мобільної шторки знизу');
  ok(!/\.cv-[a-z]+\{[^}]*var\(--(red|amber|green)\)/.test(css), 'шкала повноти використовує кольори ризику');
  ok(/\.cv-fill\{[^}]*var\(--brand\)/.test(css), 'акцент повноти не лаймовий');
  ok(!/id="scoreDot"|class="dot ok" id="scoreDot"/.test(page), 'зелена крапка повернулась');
  ok(/aria-expanded/.test(page) && /e\.key === 'Escape'/.test(page), 'клавіатура: aria-expanded і Esc');
}
/* 9. словники: усі нові рядки перекладені */
{
  const keys = ['CalCar Score', 'Check coverage', 'Sufficient', 'Limited data', 'Well covered', 'Data is limited', 'Partially checked', 'Enough data', 'Studied in detail',
    'What affected the score', 'No significant factors lowering the score were found.', 'Data coverage', 'Photos and current condition', 'No coverage data for this check', 'Score details', 'Not applicable'];
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) {
    const d = fs.readFileSync(f, 'utf8');
    for (const k of keys) ok(d.includes("'" + k + "':"), f + ': нема ' + k);
  }
  const ru = fs.readFileSync('i18n/ru.js', 'utf8');
  ok(/'Check coverage': 'Полнота проверки'/.test(ru) && /'Enough data': 'Данных достаточно'/.test(ru) && /'Well covered': 'Хорошо изучено'/.test(ru), 'ru: ключові переклади');
}

if (errs.length) { console.error('SCORE UI TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
console.log('score ui: причинні штрафи v4 · повнота без внутрішнього числа · маркер = збережене значення, риска 70 · v3 без вигаданої повноти · бал не перераховується · мобільна шторка · словники');
