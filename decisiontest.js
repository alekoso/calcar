/* Decision Engine: валідація purchase_decision і контракт рендера.
   Битий висновок не валить звіт, а вмикає старий рендер verdict.summary. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
/* check.js імпортує score.js і auction.js: збираємо tmp-пакет як у e2e */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_dec_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of ['check.js', 'score.js', 'score-v3.js', 'auction.js']) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

const VALID = {
  recommendation: 'go_see',
  headline: 'Їхати дивитись, але спершу два питання продавцю',
  summary_short: 'Ціна нижча за ринок через ДТП у США, але удар за фото некритичний. Історія пробігу логічна. Головна невідомість: якість відновлення SRS.',
  reasoning: 'Абзац один.\n\nАбзац два.',
  why_consider: ['Ціна нижча за ринок', 'Логічна хронологія пробігу'],
  main_concerns: ['Якість відновлення SRS не підтверджена'],
  must_check: ['SRS: подушки стріляли за аукціонним фото auction_event_1'],
  questions_for_seller: ['Чому пробіг у поточному оголошенні менший, ніж торік?'],
  value_context: 'Ціна виглядає нижчою за аналоги, і причина цьому: аукціонне минуле.',
  missing_but_important: ['Сервісної історії нема: попросити виписку з СТО'],
};

(async () => {
  const { sanitizePurchaseDecision } = await import('file://' + path.join(dir, 'api', 'check.js'));
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

  /* 1. валідна структура проходить цілою */
  let out = sanitizePurchaseDecision(VALID, 6.5);
  if (!out || out.recommendation !== 'go_see' || out.why_consider.length !== 2) errs.push('валідне рішення покалічене');
  if (out.score_conflict) errs.push('go_see при 6.5 позначений конфліктом');

  /* 2. битий чи відсутній: null, звіт живе, рендер старий */
  for (const bad of [null, undefined, 42, 'text', [], {}, { recommendation: 'maybe' },
    { ...VALID, headline: '' }, { ...VALID, reasoning: null }, { ...VALID, summary_short: '   ' }]) {
    if (sanitizePurchaseDecision(bad, 6.5) !== null) errs.push('битий висновок пройшов: ' + JSON.stringify(bad).slice(0, 60));
  }

  /* 3. summary_short ріжеться по 400, списки по 8, сміття в списках відсіюється */
  out = sanitizePurchaseDecision({ ...VALID, summary_short: 'Д'.repeat(500), must_check: [...Array(12)].map((x, i) => 'пункт ' + i).concat([42, '', null]) }, 6.5);
  if (out.summary_short.length !== 400) errs.push('summary_short не обрізаний по 400: ' + out.summary_short.length);
  if (out.must_check.length !== 8) errs.push('must_check не обрізаний по 8: ' + out.must_check.length);

  /* 4. сумісність із балом: червоні прапорці */
  out = quiet(() => sanitizePurchaseDecision({ ...VALID, recommendation: 'skip' }, 8.4));
  if (!out.score_conflict) errs.push('skip при 8.4 без прапорця');
  out = quiet(() => sanitizePurchaseDecision({ ...VALID, recommendation: 'buy' }, 4.2));
  if (!out.score_conflict) errs.push('buy при 4.2 без прапорця');
  out = sanitizePurchaseDecision({ ...VALID, recommendation: 'buy' }, 8.8);
  if (out.score_conflict) errs.push('buy при 8.8 хибно позначений');

  /* 5. промпт: структура, стиль, заборони, узгодженість, два варіанти */
  const src = fs.readFileSync('api/check.js', 'utf8');
  for (const k of ['"purchase_decision"', 'recommendation": buy | go_see | negotiate | skip',
    'покупця-перекупника', 'без страхувальної ковдри', 'пасує будь-якому авто цієї моделі, це брак',
    'ПРИКЛАДИ СТИЛЮ МІРКУВАННЯ', 'decision_style', 'DECISION_STYLE',
    '"історія чиста", коли джерела історії не підтверджені, це брак']) {
    if (!src.includes(k)) errs.push('check.js: нема "' + k.slice(0, 40) + '"');
  }
  if (!/decisionStyle === 'a' \? DECISION_FEWSHOT : ''/.test(src)) errs.push('check.js: варіант B не вимикає few-shot');

  /* 6. рендер: шари, фолбек без порожніх секцій, рядки в словниках */
  const page = fs.readFileSync('result-check.html', 'utf8');
  for (const el of ['id="pdBlock"', 'id="pdHeadline"', 'id="pdShort"', 'id="pdMoreBtn"', 'id="pdReasoning"']) {
    if (!page.includes(el)) errs.push('result-check.html: нема ' + el);
  }
  if (!page.includes("if (pd && pd.headline)")) errs.push('result-check.html: нема гілки нового рішення');
  if (!page.includes("if (!(pd && pd.headline)) $('verdictCard').style.display = ''")) errs.push('result-check.html: фолбек на verdict.summary зламаний');
  if (!page.includes("$('vText').style.display = 'none'")) errs.push('result-check.html: старий текст не ховається при новому блоці');
  /* екран на v2 із фолбеком на легасі для старих звітів, підпис на місці */
  if (!page.includes('D.score_v2_preview')) errs.push('result-check.html: екран не читає score_v2_preview');
  if (!page.includes("typeof vd.score === 'number'")) errs.push('result-check.html: зник фолбек на легасі оцінку');
  if (!page.includes('Наша оцінка авто на основі даних, які вдалося перевірити.')) errs.push('result-check.html: нема пояснення оцінки в tooltip');
  for (const d of ['i18n/ru.js', 'i18n/en.js']) {
    const dict = fs.readFileSync(d, 'utf8');
    for (const k of ['Читати повний розбір', 'Питання продавцю', 'Чого ми не перевірили', 'Наша оцінка авто на основі даних, які вдалося перевірити.']) {
      if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('валідація структури · битий висновок дає старий рендер · 400/8 ліміти · сумісність із балом · промпт і два стилі · словники');
  console.log('DECISION TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
