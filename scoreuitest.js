/* Компонент "Оцінка CalCar + впевненість в оцінці" у result-check.html.
   Окрема компактна картка перед вердиктом: ліворуч бал по центру своєї
   колонки, праворуч впевненість в оцінці на всю колонку, шеврон у кінці
   її заголовка. Функції компонента виконуються на заглушках DOM: користувач
   НЕ бачить штрафів, ваг і формули Score; внутрішнє число повноти ніде не
   видно; маркер стоїть на збереженому overall_internal, риска "достатньо" =
   70; міні-рейки доменів мають чорну риску значення в межах 0..100; клік
   по інфо НЕ відкриває панель; старий звіт v3 відкривається без вигаданої
   впевненості; бал береться як є. */
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
const src = ['popoverPosition', 'sheetScrollLock', 'coverageRail', 'renderScoreBlock'].map(grab).join('\n');

function stub(id, extra = {}) {
  const attrs = {}, listeners = {};
  const classes = new Set();
  return Object.assign({ id, innerHTML: '', hidden: true, style: {}, dataset: {}, attrs, listeners, classes,
    classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, contains: c => classes.has(c) }, offsetWidth: 300, offsetHeight: 120,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return attrs[k]; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    fire(ev, e = {}) { for (const fn of listeners[ev] || []) fn(Object.assign({ stopPropagation() { this.stopped = true; }, preventDefault() {}, target: { closest: () => null } }, e)); },
    getBoundingClientRect: () => ({ left: 100, right: 400, top: 50, bottom: 80, width: 300 }),
    contains: () => false, focus() { this.focused = true; } }, extra);
}
function mount(D, { hover = false } = {}) {
  const els = {};
  const infos = [stub('info-score', { dataset: { tip: 'score' } }), stub('info-conf', { dataset: { tip: 'conf' } })];
  ['scoreSlot', 'scorePop', 'scoreOv', 'scTip', 'scoreToggle', 'scoreClose'].forEach(id => { els[id] = stub(id); });
  els.scoreCard = stub('scoreCard', { querySelectorAll: sel => (sel === '.sc-info' ? infos : []) });
  const $ = id => els[id] || null;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const doc = stub('document', { documentElement: { style: {} } });
  const win = stub('window', { matchMedia: q => ({ matches: hover && /hover:hover/.test(q) }), innerWidth: 1280, innerHeight: 800 });
  const fn = new Function('$', 'esc', 't', 'document', 'window', src + '\nreturn { renderScoreBlock };');
  fn($, esc, s => s, doc, win).renderScoreBlock(D);
  return { slot: els.scoreSlot.innerHTML, pop: els.scorePop.innerHTML, els, infos, doc };
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
const TIPS_SRC = (page.match(/const TIPS = \{[\s\S]*?\n  \};/) || [''])[0];
ok(TIPS_SRC, 'нема тексту підказок TIPS');
const LEAKS = ['Accident', 'Vehicle age', 'Number of owners', 'Mileage intensity', 'What affected the score', 'Score details', 'Vehicle history', 'Damage and repair', '0.51', '1.2', '0.42', 'weight', 'penalt', 'formula'];

/* 1. закрита картка: бал ліворуч по центру колонки, впевненість праворуч */
for (const [final, cov] of [[9.0, 91], [5.1, 74], [3.2, 50]]) {
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(cov), score_breakdown: v4(final) });
  const card = text(r.slot);
  ok(card.includes('CalCar Score') && card.includes(final.toFixed(1)) && card.includes('/ 10'), 'картка без балу ' + final);
  ok(card.includes('Confidence in the score') && card.includes(conf(cov).text_key), 'картка без впевненості в оцінці ' + cov);
  ok(!card.includes('Check coverage'), 'у закритій картці лишилась стара назва "Полнота проверки"');
  ok(/^<div class="sc-card" id="scoreCard">/.test(r.slot) && !/<button[^>]*class="sc-card/.test(r.slot), 'картка має бути блоком, не кнопкою (всередині кнопки інфо)');
  ok(/class="sc-col score"/.test(r.slot) && /class="sc-sep"/.test(r.slot) && /class="sc-col conf"/.test(r.slot), 'нема двох колонок з роздільником');
  ok(!/detected risk|dot ok|score-shield/i.test(r.slot), 'у картці ризик-лейбл, крапка чи щит');
  /* дві кнопки інфо з aria-label, шеврон у кінці заголовка правої колонки */
  ok(/<button type="button" class="sc-info" data-tip="score" aria-label="About CalCar Score" aria-expanded="false" aria-controls="scTip">/.test(r.slot), 'нема інфо-кнопки біля балу');
  ok(/<button type="button" class="sc-info" data-tip="conf" aria-label="About confidence in the score" aria-expanded="false" aria-controls="scTip">/.test(r.slot), 'нема інфо-кнопки біля впевненості');
  const confCol = r.slot.slice(r.slot.indexOf('class="sc-col conf"'));
  const confHead = confCol.slice(0, confCol.indexOf('class="sc-cov-t"'));
  ok(/id="scoreToggle" aria-haspopup="dialog" aria-expanded="false" aria-controls="scorePop" aria-label="Show score details"/.test(confHead), 'шеврон не в кінці заголовка впевненості');
  ok((r.slot.match(/id="scoreToggle"/g) || []).length === 1, 'шеврон має бути один');
  /* 2. штрафи і формула не видні ні в картці, ні в панелі, ні в підказках */
  const all = card + ' ' + text(r.pop) + ' ' + TIPS_SRC;
  ok(!/−\s?\d|-\d\.\d/.test(all), 'видно значення штрафів: ' + (all.match(/[−-]\s?\d[\d.]*/) || [''])[0]);
  for (const leak of LEAKS) ok(!all.includes(leak), 'розкрито внутрішнє: ' + leak);
  /* 3. внутрішнє число повноти не видно, маркер на збереженому значенні, риска 70 */
  ok(!new RegExp('\\b' + cov + '\\b').test(card + ' ' + text(r.pop)), 'видно внутрішнє число повноти ' + cov);
  ok(!/%/.test(card + text(r.pop) + TIPS_SRC) && !/\b(High|Medium|Low)\b/.test(all), 'відсотки чи High/Medium/Low');
  const knobs = [...(r.slot + r.pop).matchAll(/cv-knob" data-pos="([\d.]+)" style="left:([\d.]+)%/g)];
  ok(knobs.length === 2 && knobs.every(k => Number(k[1]) === cov && Number(k[2]) === cov), 'маркер не на збереженому overall_internal ' + cov);
  ok((r.slot.match(/cv-tick" style="left:70%/g) || []).length === 1 && /cv-tick" style="left:70%/.test(r.pop), 'риска достатньо не на 70');
  ok(card.includes('Limited data') && card.includes('Well covered'), 'підписи кінців шкали в картці');
  /* над шкалою лише заголовок стану: окремого підпису "Достатньо" біля позначки немає */
  ok(!/sc-tick-l/.test(r.slot + r.pop) && !/>Sufficient</.test(r.slot + r.pop), 'над шкалою знову зайвий підпис "Достатньо"');
  /* 4. панель: пояснення, впевненість в оцінці, далі повнота перевірки з доменами */
  const pt = text(r.pop);
  ok(pt.includes('An assessment of this specific car based on confirmed data'), 'нема пояснення оцінки');
  const iConf = pt.indexOf('Confidence in the score'), iCov = pt.indexOf('Check coverage');
  ok(iConf > 0 && iCov > iConf, 'у панелі впевненість в оцінці має йти перед повнотою перевірки');
  ok(pt.slice(iConf, iCov).includes(conf(cov).text_key), 'у панелі нема тексту впевненості');
  ok(['History', 'Photos and current condition', 'Mileage', 'Vehicle identification'].every(l => pt.slice(iCov).includes(l)), 'повнота перевірки без чотирьох доменів');
  ok(!pt.includes('Data coverage'), 'стара назва розділу доменів');
  ok(!/probab|ймовірн|вероятн/i.test(pt + TIPS_SRC), 'формулювання про ймовірність правильності');
}
/* 5. міні-рейки: чорна риска значення, на 0 і на 100 не виходить за рейку */
{
  const c = conf(88, { domains: { history: { status: 'partial', score_internal: 0 }, photos: { status: 'partial', score_internal: 3 }, mileage: { status: 'partial', score_internal: 70 }, identity: { status: 'complete', score_internal: 100 } } });
  const r = mount({ verdict: { summary: 'x' }, confidence: c, score_breakdown: v4(8.1) });
  const marks = [...r.pop.matchAll(/class="cv-mark" data-pos="([\d.]+)" style="left:calc\(([\d.]+)% - ([\d.]+)px\)"/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
  ok(marks.length === 4, 'не в кожній міні-рейці є риска значення: ' + marks.length);
  ok(JSON.stringify(marks.map(m => m[0])) === '[0,3,70,100]', 'риски не на збережених значеннях доменів');
  ok(marks.every(([v, pct, px]) => pct === v && Math.abs(px - v / 50) < 0.01), 'риска зміщена неправильно');
  ok(marks[0][1] === 0 && marks[0][2] === 0 && marks[3][1] === 100 && marks[3][2] === 2, 'риска виходить за рейку на 0 чи 100');
  const n = mount({ verdict: { summary: 'x' }, confidence: conf(60, { domains: { history: { status: 'not_applicable' }, photos: { score_internal: 50 }, mileage: { score_internal: 50 }, identity: { score_internal: 50 } } }), score_breakdown: v4(6) });
  ok(text(n.pop).includes('Not applicable') && (n.pop.match(/cv-mark/g) || []).length === 3, 'домен "не застосовно" отримав рейку');
}
/* 6. взаємодія: клік по інфо відкриває підказку і НЕ відкриває панель */
{
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: v4(7.6) });
  const [iScore, iConf] = r.infos, pop = r.els.scorePop, tip = r.els.scTip, card = r.els.scoreCard;
  let stopped = false;
  iScore.fire('click', { stopPropagation() { stopped = true; } });
  ok(!tip.hidden && stopped && pop.hidden, 'клік по інфо відкрив панель або не відкрив підказку');
  ok(iScore.attrs['aria-expanded'] === 'true', 'інфо без aria-expanded=true');
  ok(text(tip.innerHTML).includes('CalCar Score is the overall assessment of this specific car') && text(tip.innerHTML).includes('The higher the score, the fewer significant problems'), 'текст підказки балу');
  /* клік, що спливає з інфо до картки, панель не відкриває */
  card.fire('click', { target: { closest: sel => (sel === '.sc-info' ? iScore : null) } });
  ok(pop.hidden, 'клік по інфо, що дійшов до картки, відкрив панель');
  /* друга підказка замінює першу */
  iConf.fire('click');
  ok(!tip.hidden && iScore.attrs['aria-expanded'] === 'false' && text(tip.innerHTML).includes('Shows how thoroughly CalCar was able to verify the data') && text(tip.innerHTML).includes('the higher the confidence in the score'), 'текст підказки впевненості');
  /* Esc спершу закриває підказку, панель лишається як була */
  r.doc.fire('keydown', { key: 'Escape' });
  ok(tip.hidden && iConf.focused, 'Esc не закрив підказку або не повернув фокус');
  /* картка статична: клік по ній нічого не відкриває; шеврон (дотик,
     клавіатура) відкриває панель; наступний Esc закриває її */
  card.fire('click');
  ok(pop.hidden && !(card.listeners.click || []).length && !(card.listeners.mouseenter || []).length, 'картка досі реагує на клік чи наведення');
  r.els.scoreToggle.fire('click', { detail: 0 });
  ok(!pop.hidden && r.els.scoreToggle.attrs['aria-expanded'] === 'true', 'шеврон не відкрив панель');
  r.doc.fire('keydown', { key: 'Escape' });
  ok(pop.hidden && r.els.scoreToggle.attrs['aria-expanded'] === 'false' && r.els.scoreToggle.focused, 'Esc не закрив панель');
  /* закріплена підказка закривається кліком поза нею; відкриття панелі закриває підказку */
  iScore.fire('click'); r.doc.fire('click', { target: {} });
  ok(tip.hidden, 'клік поза підказкою її не закрив');
  iScore.fire('click'); r.els.scoreToggle.fire('click', { detail: 0 });
  ok(tip.hidden && !pop.hidden, 'відкриття панелі не закрило підказку');
  /* дотик: повторний тап по шеврону закриває, тап поза ним закриває */
  ok(!pop.classList.contains('hover-open'), 'дотик: панель позначена як відкрита наведенням');
  r.els.scoreToggle.fire('click', { detail: 1 });
  ok(pop.hidden && r.els.scoreToggle.attrs['aria-expanded'] === 'false', 'повторний тап по шеврону не закрив панель');
  r.els.scoreToggle.fire('click', { detail: 1 }); r.doc.fire('click', { target: {} });
  ok(pop.hidden, 'тап поза шевроном не закрив панель');
}
/* 6b. миша: наведення на шеврон відкриває панель, відведення закриває, клік не потрібен */
{
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: v4(7.6) }, { hover: true });
  const tg = r.els.scoreToggle, pop = r.els.scorePop, card = r.els.scoreCard;
  card.fire('mouseenter'); card.fire('click');
  ok(pop.hidden, 'наведення чи клік по картці відкрили панель');
  tg.fire('mouseenter');
  ok(!pop.hidden && tg.attrs['aria-expanded'] === 'true', 'наведення на шеврон не відкрило панель');
  /* відкрита наведенням панель не перехоплює курсор: повторні mouseenter не закривають її, mouseleave з панелі не приходить */
  ok(pop.classList.contains('hover-open') && /\.sc-pop\.hover-open\{pointer-events:none\}/.test(page), 'панель, відкрита наведенням, перехоплює курсор (мерехтіння)');
  tg.fire('mouseenter'); tg.fire('mouseenter');
  ok(!pop.hidden, 'повторне наведення закрило панель');
  ok(!(pop.listeners.mouseenter || []).length && !(pop.listeners.mouseleave || []).length, 'панель має власні обробники наведення');
  tg.fire('click', { detail: 1 });
  ok(!pop.hidden, 'клік мишею по вже відкритому наведенням шеврону закрив панель');
  tg.fire('mouseleave');
  ok(pop.hidden && tg.attrs['aria-expanded'] === 'false', 'відведення миші з шеврону не закрило панель');
  /* клавіатура: Enter/Space дають click з detail 0 і перемикають */
  tg.fire('click', { detail: 0 });
  ok(!pop.hidden, 'Enter/Space не відкрили панель');
  ok(!pop.classList.contains('hover-open'), 'панель, відкрита з клавіатури, не приймає курсор');
  tg.fire('click', { detail: 0 });
  ok(pop.hidden, 'Enter/Space не закрили панель');
  /* фокус з клавіатури показує панель, втрата фокусу закриває */
  tg.matches = sel => sel === ':focus-visible';
  tg.fire('focus');
  ok(!pop.hidden, 'фокус з клавіатури не показав панель');
  tg.fire('blur', { relatedTarget: null });
  ok(pop.hidden, 'втрата фокусу не закрила панель');
}
/* 6b1. панель привʼязана до шеврона, а не до картки чи низу вікна */
{
  const pos = new Function(grab('popoverPosition') + '\nreturn popoverPosition;')();
  const W = 360, VW = 1280, VH = 800;
  const trig = (top, right = 1180) => ({ left: right - 28, right, top, bottom: top + 28, width: 28, height: 28 });
  const adjacent = (p, r, h) => { const gapY = Math.max(p.top - r.bottom, r.top - (p.top + h), 0), gapX = Math.max(p.left - r.right, r.left - (p.left + W), 0); return gapY <= 12 && gapX <= 12; };
  const below = pos(trig(200), W, 420, VW, VH);
  ok(below.side === 'below' && below.top === 236 && below.left + W === 1180, 'AF: панель має стояти одразу під шевроном з правим краєм на його рівні: ' + JSON.stringify(below));
  const above = pos(trig(560), W, 420, VW, VH);
  ok(above.side === 'above' && above.top + 420 === 552 && adjacent(above, trig(560), 420), 'AG: без місця знизу панель має стати над шевроном: ' + JSON.stringify(above));
  const side = pos(trig(300), W, 620, VW, VH);
  ok(side.side === 'left' && side.left + W === 1180 - 28 - 8 && adjacent(side, trig(300), 620), 'AG: без місця знизу і зверху панель має стати збоку від шеврона: ' + JSON.stringify(side));
  for (const top of [20, 150, 300, 450, 600, 740]) for (const h of [200, 420, 620]) {
    const r = trig(top), p = pos(r, W, h, VW, VH);
    ok(adjacent(p, r, h), 'AH: панель відірвалась від шеврона (top ' + top + ', h ' + h + '): ' + JSON.stringify(p));
    ok(p.left >= 12 && p.left + W <= VW - 12 && p.top >= 12 && (p.top + h <= VH - 12 || h > VH - 24), 'панель вийшла за вікно: ' + JSON.stringify(p));
    ok(!(p.top + h >= VH - 12 && r.bottom < VH - h - 60 && p.side === 'below'), 'AH: панель притиснута до низу вікна далеко від шеврона');
  }
  const narrow = pos({ left: 300, right: 328, top: 300, bottom: 328 }, W, 620, 720, VH);
  ok(narrow.side === 'right' && narrow.left === 336, 'ліворуч місця немає: панель має стати праворуч від шеврона: ' + JSON.stringify(narrow));
  ok(/popoverPosition\(toggle\.getBoundingClientRect\(\), pop\.offsetWidth, pop\.offsetHeight, window\.innerWidth, window\.innerHeight\)/.test(page) && !/card\.getBoundingClientRect\(\)/.test(grab('renderScoreBlock')), 'панель має рахуватись від самого шеврона');
}
/* 6c. стиль: картка статична, інтерактивний лише шеврон */
{
  const cardCss = (/\.sc-card\{[^}]*\}/.exec(page) || [''])[0];
  ok(!/cursor:pointer|transition/.test(cardCss) && !/\.sc-card:hover/.test(page), 'картка досі має курсор-руку чи реакцію на наведення');
  ok(/\.sc-tog:hover,\.sc-tog\[aria-expanded="true"\]\{color:var\(--ink\);background:var\(--bg\)\}/.test(page) && /\.sc-tog\{[^}]*cursor:pointer/.test(page), 'шеврон без стану наведення');
}
/* 7. бал не перераховується фронтендом */
{
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(90), score_breakdown: v4(8.8, [{ key: 'input7:age', input: 'vehicle_age', amount: 0.3 }]) });
  ok(text(r.slot).includes('8.8') && !text(r.slot).includes('9.7'), 'фронтенд перерахував бал');
}
/* 8. старий звіт v3: лише бал, впевненості не вигадано, старі підоцінки сховані */
{
  const r = mount({ verdict: { summary: 'x', score: 6.7 }, score_breakdown: { score_version: 'v3', score_available: true, final: 6.7, score_dimensions: { history: { score_available: true, score: 6.5 }, mileage: { score_available: true, score: 7.3 } } } });
  const all = text(r.slot + ' ' + r.pop);
  ok(all.includes('6.7'), 'v3: бал');
  ok(/^<div class="sc-card solo" id="scoreCard">/.test(r.slot) && !/sc-col conf|sc-sep/.test(r.slot), 'v3: картка не лише з балом');
  ok(!/cv-knob|cv-rail|cv-mark/.test(r.slot + r.pop), 'v3: вигадана шкала');
  ok(!all.includes('Confidence in the score') && !all.includes('Check coverage'), 'v3: вигадана впевненість в оцінці');
  ok(/id="scoreToggle"/.test(r.slot) && /data-tip="score"/.test(r.slot) && !/data-tip="conf"/.test(r.slot), 'v3: без шеврона або з інфо впевненості');
  ok(!all.includes('6.5') && !all.includes('7.3') && !all.includes('Score details'), 'v3: старі підоцінки показані');
}
/* 9. найстаріший звіт і недоступний Score */
{
  ok(text(mount({ verdict: { summary: 'x', score: 7.44 } }).slot).includes('7.4'), 'легасі verdict.score');
  const u = mount({ verdict: { summary: 'x' }, confidence: conf(50), score_breakdown: { score_version: 'v4', score_available: false, final: null, items: ITEMS } });
  ok(text(u.slot).includes('Not enough data to score') && /cv-knob/.test(u.slot), 'недоступний Score: текст і впевненість');
}
/* 10. структура сторінки і CSS */
{
  const iSlot = page.indexOf('<div class="sc-slot" id="scoreSlot"></div>'), iVerdict = page.indexOf('<div class="card" id="verdictCard"');
  ok(iSlot > 0 && iSlot < iVerdict, 'картка оцінки має стояти ОКРЕМО перед вердиктом');
  const verdictMarkup = page.slice(iVerdict, page.indexOf('<div class="v-text" id="vText">'));
  ok(!/scoreSlot|sc-card/.test(verdictMarkup), 'картка оцінки всередині блоку вердикту');
  ok(/<div class="sc-tip" id="scTip" role="tooltip" hidden><\/div>/.test(page), 'нема контейнера підказки');
  ok(!/function scoreCausalRows|function scoreAmount/.test(page), 'функції показу штрафів лишились');
  const css = (page.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');
  const m = /\.sc-v\{[^}]*font-size:(\d+)px/.exec(css);
  ok(m && Number(m[1]) >= 36 && Number(m[1]) <= 40, 'бал не 36-40px: ' + (m && m[1]));
  ok(/\.sc-v small\{[^}]*font-size:16px;font-weight:500;color:var\(--muted\)/.test(css), '"/ 10" не менший і не вторинний');
  ok(/\.sc-card\{[^}]*grid-template-columns:minmax\(170px,30%\) 1px minmax\(0,1fr\)/.test(css), 'колонки не ~30/70');
  ok(/\.sc-col\.score\{align-items:center;text-align:center\}/.test(css), 'бал не по центру своєї колонки');
  ok(/\.sc-col\.conf \.sc-hrow\{justify-content:space-between\}/.test(css), 'заголовок впевненості не на всю ширину колонки');
  ok(/\.sc-tog\{[^}]*width:32px;height:32px/.test(css) && !/\.sc-chev\{/.test(css), 'шеврон не 32x32 або лишився старий абсолютний');
  ok(/\.sc-card \.sc-meter\{max-width:720px/.test(css), 'шкала в картці не отримала ширини колонки');
  ok(/\.cv-mark\{position:absolute;top:-3px;bottom:-3px;width:2px;[^}]*background:var\(--ink\)\}/.test(css), 'риска міні-рейки не тонка чорна');
  ok(/\.sc-tip\{[^}]*border-radius:12px[^}]*box-shadow:0 10px 28px rgba\(20,22,25,\.16\)/.test(css), 'підказка не в мові панелі пробігу');
  ok(/@media\(max-width:620px\)\{[\s\S]*?\.sc-card\{grid-template-columns:minmax\(0,1fr\)[\s\S]*?\.sc-col\.score\{align-items:flex-start;text-align:left\}/.test(css), 'на телефоні не стек або бал не зліва');
  ok(/\.sc-pop\{[^}]*border-radius:12px[^}]*box-shadow:0 10px 28px rgba\(20,22,25,\.16\)/.test(css), 'панель не в мові шкали пробігу');
  ok(/@media\(max-width:620px\)\{[\s\S]*?\.sc-pop\{[^}]*bottom:12px/.test(css), 'нема мобільної шторки');
  ok(!/\.cv-[a-z]+\{[^}]*var\(--(red|amber|green)\)/.test(css) && /\.cv-fill\{[^}]*var\(--brand\)/.test(css), 'шкала повноти в кольорах ризику');
}
/* 10b. стеля балу (ceiling-v1): один рядок із причиною в панелі; без стелі
   рядка нема; нерозвʼязана базова ідентичність показує свою причину
   замість "мало даних" */
{
  const withCeil = Object.assign(v4(8.0), { score_ceiling: { active: true, value: 9.0, reason_code: 'moderate_historical_damage', reason_key: 'the car had moderate damage in the past' } });
  const r = mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: withCeil });
  ok(text(r.pop).includes('Maximum score is limited to 9.0: the car had moderate damage in the past.'), 'у панелі нема рядка стелі');
  ok(/<span class="sc-note sc-ceil">/.test(r.pop), 'рядок стелі без класу sc-ceil');
  ok(text(r.slot).includes('8.0'), 'бал картки не збережений final');
  ok(!/9\.0/.test(text(r.slot)), 'значення стелі потрапило в закриту картку');
  const n = mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: v4(8.0) });
  ok(!/Maximum score|sc-ceil/.test(n.pop + n.slot), 'без стелі зʼявився рядок стелі');
  const near10 = Object.assign(v4(9.6), { score_ceiling: { active: true, value: 9.97, reason_code: 'evidence_weak', reason_key: 'part of the data about this specific car could not be verified' } });
  ok(!/Maximum score|sc-ceil/.test(mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: near10 }).pop), 'стеля 9.97 показана як "обмежена до 10.0"');
  const tenth = Object.assign(v4(9.0), { score_ceiling: { active: true, value: 9.46, reason_code: 'evidence_weak', reason_key: 'part of the data about this specific car could not be verified' } });
  ok(text(mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: tenth }).pop).includes('Maximum score is limited to 9.5: part of the data'), 'стеля 9.46 не показана як 9.5');
  const off = Object.assign(v4(8.0), { score_ceiling: { active: false, value: 10, reason_code: null, reason_key: null } });
  ok(!/Maximum score|sc-ceil/.test(mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: off }).pop), 'неактивна стеля показана');
  const idc = Object.assign(v4(null), { score_available: false, score_unavailable_reason: 'core_identity_unresolved', final: null });
  const u = mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: idc });
  ok(text(u.slot).includes('Vehicle identity not established') && !text(u.slot).includes('Not enough data to score'), 'конфлікт ідентичності показаний як брак даних');
  const other = Object.assign(v4(null), { score_available: false, score_unavailable_reason: 'insufficient_evidence', final: null });
  ok(text(mount({ verdict: { summary: 'x' }, confidence: conf(80), score_breakdown: other }).slot).includes('Not enough data to score'), 'звичайна недоступність втратила свій текст');
  ok(/\.sc-note\.sc-ceil\{color:var\(--ink-2\)\}/.test(page), 'нема стилю рядка стелі');
}
/* 11. словники */
{
  const keys = ['CalCar Score', 'Confidence in the score', 'Maximum score is limited to {v}', 'Vehicle identity not established', 'Check coverage', 'Limited data', 'Well covered', 'Data is limited', 'Partially checked', 'Enough data', 'Studied in detail',
    'Photos and current condition', 'Vehicle identification', 'Not applicable', 'About CalCar Score', 'About confidence in the score', 'Show score details',
    'An assessment of this specific car based on confirmed data about its history, condition, mileage and other available facts.',
    ...[...TIPS_SRC.matchAll(/'([^']{20,})'/g)].map(m => m[1])];
  ok(keys.length >= 20, 'тексти підказок не знайдені для перевірки словників');
  for (const f of ['i18n/ru.js', 'i18n/ua.js']) { const d = fs.readFileSync(f, 'utf8'); for (const k of keys) ok(d.includes("'" + k + "':"), f + ': нема ' + k); }
  const ru = fs.readFileSync('i18n/ru.js', 'utf8'), ua = fs.readFileSync('i18n/ua.js', 'utf8');
  ok(/'Confidence in the score': 'Уверенность в оценке'/.test(ru) && /'Confidence in the score': 'Впевненість в оцінці'/.test(ua), 'назва впевненості в оцінці');
  ok(/'Check coverage': 'Полнота проверки'/.test(ru), 'назва розділу доменів');
}

if (errs.length) { console.error('SCORE UI TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
console.log('score ui: бал по центру лівої колонки · впевненість в оцінці на всю праву колонку, шеврон у її заголовку · інфо не відкриває панель, Esc спершу підказку · штрафи і формула не видні · маркер = збережене значення, риска 70 · чорні риски міні-рейок у межах 0..100 · v3 лише бал');
