/* Компонент "Оцінка CalCar + повнота перевірки" у result-check.html.
   Окрема компактна картка перед вердиктом: ліворуч бал, праворуч повнота.
   Функції компонента виконуються на заглушках DOM: користувач НЕ бачить
   штрафів, ваг і формули Score; внутрішнє число повноти ніде не видно;
   маркер стоїть на збереженому overall_internal, риска "достатньо" = 70;
   старий звіт v3 відкривається без вигаданої повноти; бал береться як є. */
const fs = require('fs');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };
const page = fs.readFileSync('result-check.html', 'utf8');

const grab = name => {
  const i = page.indexOf('function ' + name + '(');
  if (i < 0) { errs.push('нема функції ' + name); return ''; }
  let depth = 0;
  for (let k = page.indexOf('{', i); k < page.length; k++) {
    if (page[k] === '{') depth++;
    else if (page[k] === '}') { depth--; if (depth === 0) return page.slice(i, k + 1); }
  }
  return '';
};
const src = ['coverageRail', 'renderScoreBlock'].map(grab).join('\n');

function mount(D) {
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', hidden: true, style: {}, setAttribute() {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, right: 400, top: 0, bottom: 60 }), contains: () => false, focus() {} });
  ['scoreSlot', 'scorePop', 'scoreOv'].forEach(el);
  const $ = id => (['scoreCard', 'scoreClose'].includes(id) ? el(id) : els[id] || null);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fn = new Function('$', 'esc', 't', 'document', 'window', src + '\nreturn { renderScoreBlock };');
  fn($, esc, s => s, { addEventListener() {} }, { addEventListener() {}, matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 800 }).renderScoreBlock(D);
  return { slot: els.scoreSlot.innerHTML, pop: els.scorePop.innerHTML };
}
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const conf = (v, over = {}) => ({ confidence_version: 'v1', overall_internal: v, text_key: v >= 85 ? 'Studied in detail' : v >= 70 ? 'Enough data' : v >= 40 ? 'Partially checked' : 'Data is limited', sufficient_tick: 70,
  domains: { history: { status: 'partial', score_internal: 51.1 }, photos: { status: 'partial', score_internal: 42 }, mileage: { status: 'partial', score_internal: 40 }, identity: { status: 'complete', score_internal: 100 } }, caps_applied: [], ...over });
const ITEMS = [
  { key: 'accident_latest_medium', input: 'accident_history', amount: 1.2, label_key: 'Accident history: medium damage' },
  { key: 'input7:age', input: 'vehicle_age', amount: 0.51, label_key: 'Vehicle age' },
  { key: 'input8:owners', input: 'vehicle_owners', amount: 0.3, label_key: 'Number of owners', params: { owners_count: 4 } },
  { key: 'input4:intensity', input: 'mileage_intensity', amount: 0.42, label_key: 'Mileage intensity above the norm for this powertrain' },
];
const v4 = (final, items = ITEMS) => ({ score_version: 'v4', score_available: true, final, items, inputs: { vehicle_age: { penalty: 0.51 } } });

/* 1. закрита картка: бал ліворуч, повнота праворуч, нічого зайвого */
for (const [final, cov] of [[7.6, 88], [9.4, 71], [3.2, 45]]) {
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(cov), score_breakdown: v4(final) });
  const card = text(r.slot);
  ok(card.includes('CalCar Score') && card.includes(final.toFixed(1)) && card.includes('/ 10'), 'картка без балу ' + final);
  ok(card.includes('Check coverage') && card.includes(conf(cov).text_key), 'картка без повноти ' + cov);
  ok(/class="sc-sep"/.test(r.slot), 'нема тонкого роздільника колонок');
  ok(!/detected risk|dot ok|score-shield/i.test(r.slot), 'у картці ризик-лейбл, крапка чи щит');
  /* 2. штрафи і формула не видні ні в картці, ні в панелі */
  const all = card + ' ' + text(r.pop);
  ok(!/−\s?\d|−\s?\d|-\d\.\d/.test(all), 'видно значення штрафів: ' + (all.match(/[−-]\s?\d[\d.]*/) || [''])[0]);
  for (const leak of ['Accident', 'Vehicle age', 'Number of owners', 'Mileage intensity', 'What affected the score', 'Score details', 'Vehicle history', 'Damage and repair', '0.51', '1.2', '0.42']) ok(!all.includes(leak), 'розкрито внутрішнє: ' + leak);
  /* 3. внутрішнє число повноти не видно, маркер на збереженому значенні, риска 70 */
  ok(!new RegExp('\\b' + cov + '\\b').test(all), 'видно внутрішнє число повноти ' + cov);
  ok(!/%/.test(all) && !/\b(High|Medium|Low)\b/.test(all), 'відсотки чи High/Medium/Low');
  const knobs = [...(r.slot + r.pop).matchAll(/cv-knob" data-pos="([\d.]+)" style="left:([\d.]+)%/g)];
  ok(knobs.length === 2 && knobs.every(k => Number(k[1]) === cov && Number(k[2]) === cov), 'маркер не на збереженому overall_internal ' + cov);
  ok((r.slot.match(/cv-tick" style="left:70%/g) || []).length === 1 && /cv-tick" style="left:70%/.test(r.pop), 'риска достатньо не на 70');
  ok(card.includes('Limited data') && card.includes('Sufficient') && card.includes('Well covered'), 'підписи шкали в картці');
  /* 4. панель: пояснення без математики, повнота, покриття доменів */
  const pt = text(r.pop);
  ok(pt.includes('An assessment of this specific car based on confirmed data'), 'нема пояснення оцінки');
  ok(pt.includes('Data coverage') && pt.includes('Photos and current condition') && pt.includes('Vehicle data'), 'нема покриття доменів');
  ok(!/probab|ймовірн|вероятн/i.test(pt), 'формулювання про ймовірність правильності');
}
/* 5. бал не перераховується фронтендом */
{
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(90), score_breakdown: v4(8.8, [{ key: 'input7:age', input: 'vehicle_age', amount: 0.3 }]) });
  ok(text(r.slot).includes('8.8') && !text(r.slot).includes('9.7'), 'фронтенд перерахував бал');
}
/* 6. старий звіт v3: відкривається, повноти не вигадано, старі псевдо-підоцінки сховані */
{
  const r = mount({ verdict: { summary: 'x', score: 6.7 }, score_breakdown: { score_version: 'v3', score_available: true, final: 6.7, score_dimensions: { history: { score_available: true, score: 6.5 }, mileage: { score_available: true, score: 7.3 } } } });
  const all = text(r.slot + ' ' + r.pop);
  ok(all.includes('6.7'), 'v3: бал');
  ok(!/cv-knob|cv-rail/.test(r.slot + r.pop), 'v3: вигадана шкала повноти');
  ok(all.includes('No coverage data for this check'), 'v3: нейтральний текст про повноту');
  ok(!all.includes('6.5') && !all.includes('7.3') && !all.includes('Score details'), 'v3: старі підоцінки показані');
}
/* 7. найстаріший звіт і недоступний Score */
{
  ok(text(mount({ verdict: { summary: 'x', score: 7.44 } }).slot).includes('7.4'), 'легасі verdict.score');
  const u = mount({ verdict: { summary: 'x' }, confidence: conf(50), score_breakdown: { score_version: 'v4', score_available: false, final: null, items: ITEMS } });
  ok(text(u.slot).includes('Not enough data to score') && /cv-knob/.test(u.slot), 'недоступний Score: текст і повнота');
}
/* 8. структура сторінки і CSS */
{
  const iSlot = page.indexOf('<div class="sc-slot" id="scoreSlot"></div>'), iVerdict = page.indexOf('<div class="card" id="verdictCard"');
  ok(iSlot > 0 && iSlot < iVerdict, 'картка оцінки має стояти ОКРЕМО перед вердиктом');
  const verdictMarkup = page.slice(iVerdict, page.indexOf('<div class="v-text" id="vText">'));
  ok(!/scoreSlot|sc-card/.test(verdictMarkup), 'картка оцінки всередині блоку вердикту');
  ok(!/function scoreCausalRows|function scoreAmount/.test(page), 'функції показу штрафів лишились');
  const css = (page.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  const m = /\.sc-v\{[^}]*font-size:(\d+)px/.exec(css);
  ok(m && Number(m[1]) >= 36 && Number(m[1]) <= 40, 'бал не 36-40px: ' + (m && m[1]));
  ok(/\.sc-card\{[^}]*grid-template-columns/.test(css), 'дві колонки на десктопі');
  ok(/@media\(max-width:620px\)\{[\s\S]*?\.sc-card\{grid-template-columns:minmax\(0,1fr\)/.test(css), 'стек на телефоні');
  ok(/\.sc-pop\{[^}]*border-radius:12px[^}]*box-shadow:0 10px 28px rgba\(20,22,25,\.16\)/.test(css), 'панель не в мові шкали пробігу');
  ok(/@media\(max-width:620px\)\{[\s\S]*?\.sc-pop\{[^}]*bottom:12px/.test(css), 'нема мобільної шторки');
  ok(!/\.cv-[a-z]+\{[^}]*var\(--(red|amber|green)\)/.test(css) && /\.cv-fill\{[^}]*var\(--brand\)/.test(css), 'шкала повноти в кольорах ризику');
  ok(/aria-expanded/.test(page) && /e\.key === 'Escape'/.test(page), 'клавіатура: aria-expanded і Esc');
}
/* 9. словники */
{
  const keys = ['CalCar Score', 'Check coverage', 'Sufficient', 'Limited data', 'Well covered', 'Data is limited', 'Partially checked', 'Enough data', 'Studied in detail',
    'Data coverage', 'Photos and current condition', 'No coverage data for this check', 'Not applicable',
    'An assessment of this specific car based on confirmed data about its history, condition, mileage and other available facts.'];
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) { const d = fs.readFileSync(f, 'utf8'); for (const k of keys) ok(d.includes("'" + k + "':"), f + ': нема ' + k); }
}

if (errs.length) { console.error('SCORE UI TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
console.log('score ui: окрема компактна картка перед вердиктом · бал 36-40px · штрафи і формула не видні · повнота без внутрішнього числа, маркер = збережене значення, риска 70 · v3 без вигаданої повноти · стек на телефоні');
