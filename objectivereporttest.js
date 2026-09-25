/* ЗВІТ = ПРО АВТО, ЧАТ = ПРО АВТО ДЛЯ ЦІЄЇ ЛЮДИНИ.
   Висновок звіту (purchase_decision) будується без особистого контексту:
   бюджет, вподобання, памʼять помічника, інші авто людини не доходять до
   моделі висновку взагалі (межа даних, а не фільтр слів після генерації).
   Публічний звіт не успадковує вподобань автора. Чат CalCar AI і далі
   отримує памʼять і вподобання поточної людини. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_objective_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) {
  let s = fs.readFileSync('api/' + x, 'utf8');
  /* збирачі промпту внутрішні: у тимчасовій копії відкриваємо їх для перевірки */
  if (x === 'check.js') s += '\nexport { PROMPT as __PROMPT, renderDecisionContext as __renderDecisionContext };\n';
  fs.writeFileSync(path.join(dir, 'api', x), s);
}
const src = fs.readFileSync('api/check.js', 'utf8');
const home = fs.readFileSync('check.html', 'utf8');
const page = fs.readFileSync('result-check.html', 'utf8');

/* два різні користувачі, одне й те саме авто і ті самі докази */
const USER_30K = {
  url: 'https://auto.ria.com/uk/auto_bmw_x5_1.html', lang: 'ru',
  buyer_context: { note: 'Бюджет до 30 000 $. Сімʼя, потрібен великий багажник, лише бензин, важливий комфорт.' },
  recent_reports: [{ title: 'Toyota RAV4 2020', vin: 'JTM1', created_at: new Date().toISOString(), price: 29000 }],
  memory: 'бюджет 30 тисяч', budget: 30000, preferences: { fuel: 'petrol' },
};
const USER_50K = {
  url: 'https://auto.ria.com/uk/auto_bmw_x5_1.html', lang: 'ru',
  buyer_context: { note: 'Бюджет до 50 000 $. Хочу максимальну динаміку, дизель підходить.' },
  recent_reports: [{ title: 'Porsche Cayenne 2019', vin: 'WP1', created_at: new Date().toISOString(), price: 49000 }],
  memory: 'бюджет 50 тисяч', budget: 50000, preferences: { fuel: 'diesel' },
};
const PERSONAL_MARKERS = ['30 000', '50 000', '30000', '50000', 'Бюджет до', 'великий багажник', 'максимальну динаміку', 'RAV4', 'Cayenne', 'BUYER_CONTEXT', 'RECENT_REPORTS', 'бюджет 30', 'бюджет 50'];

(async () => {
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const S = await import('file://' + path.join(dir, 'api', 'share.js'));

  /* ---------- 1. модель висновку не отримує особистого контексту ---------- */
  /* обробник читає з тіла запиту лише службові поля; особисті не читаються зовсім */
  const bodyFields = new Set([...src.matchAll(/req\.body(?:\?\.|\s*&&\s*req\.body\.|\.)([A-Za-z_]+)/g)].map(m => m[1]));
  const ALLOWED = new Set(['url', 'lang', 'sync', 'bench_effort', 'cv_mode', 'cv_odo_verify', 'decision_style', 'photo_pick']);
  for (const f of bodyFields) ok(ALLOWED.has(f), 'check.js читає з тіла запиту неслужбове поле: ' + f);
  ok(!/const\s*\{[^}]*\}\s*=\s*req\.body/.test(src) && !/\.\.\.req\.body/.test(src), 'check.js розпаковує тіло запиту цілком');
  ok(!/buyer_context|recent_reports|sanitizeBuyerContext|selectRecentReports/.test(src.replace(/buyer_context_used/g, '')), 'check.js досі знає про особистий контекст');
  ok(/decisionContext = objectiveDecisionContext\(\{ mileage \}\);/.test(src), 'контекст рішення будується не через обʼєктивну межу');
  /* сторінка Check навіть не надсилає особистого: лише адреса і мова */
  ok(/body: JSON\.stringify\(\{ url, lang: window\.calcarLang\(\) \}\)/.test(home), 'check.html шле в /api/check не лише адресу і мову');
  ok(!/user_memory|buyer_context|recent_reports|collectDecisionContext/.test(home), 'check.html досі збирає особистий контекст для звіту');
  /* межа ігнорує все, крім обʼєктивних фактів, навіть якщо особисте хтось підсуне */
  const mileage = C.buildMileageContext({ odometer_km: 120000, age_months: 96, powertrain: 'petrol', historical_points: [{ km: 90000, date: '2023-05-01', source: 'auction_record' }] });
  const dcA = C.objectiveDecisionContext({ mileage, ...USER_30K });
  const dcB = C.objectiveDecisionContext({ mileage, ...USER_50K });
  ok(dcA && Object.keys(dcA).join() === 'mileage', 'обʼєктивна межа пропустила особисте: ' + JSON.stringify(Object.keys(dcA || {})));

  /* ---------- 2. бюджет 30k і 50k -> той самий вхід моделі висновку ---------- */
  const listing = {
    url: USER_30K.url, title: 'BMW X5 xDrive40i 2019', price: 33500, currency: 'USD', odometer_km: 120000, year: 2019,
    vin: 'WBACR6C58K1234567', text: 'Продаю BMW X5, один власник в Україні.', photos: [],
    price_context: { position: 'below_average', delta_percent: -9, avg_price: 36800, sample_size: 42, position_classifier: 'calcar_threshold' },
  };
  const langDir = 'Мова відповіді: русский.';
  const pA = C.__PROMPT(listing, null, null, langDir, 'a', null, dcA, null);
  const pB = C.__PROMPT(listing, null, null, langDir, 'a', null, dcB, null);
  const flat = p => JSON.stringify(p);
  ok(flat(pA) === flat(pB), 'користувачі з бюджетом 30k і 50k отримали РІЗНИЙ вхід моделі висновку');
  /* і той самий вхід, що й для анонімного гостя без жодного профілю */
  const pGuest = C.__PROMPT(listing, null, null, langDir, 'a', null, C.objectiveDecisionContext({ mileage }), null);
  ok(flat(pA) === flat(pGuest), 'вхід моделі висновку для людини з профілем відрізняється від гостьового');
  for (const mk of PERSONAL_MARKERS) ok(!flat(pA).includes(mk), 'у вхід моделі висновку потрапило особисте: ' + mk);
  ok(/MILEAGE_CONTEXT/.test(flat(pA)), 'обʼєктивний контекст пробігу зник із входу');

  /* ---------- 3. обʼєктивний ринковий контекст ціни лишається ---------- */
  ok(flat(pA).includes('below_average') && flat(pA).includes('delta_percent'), 'ринковий price_context зник із входу висновку');
  ok(/Ціну оцінюй лише відносно ринку і цінності самого авто \(structured price_context\), а не відносно чийогось бюджету/.test(src), 'нема правила: ціна відносно ринку, не бюджету');
  ok(/ЗАБОРОНЕНО згадувати чи припускати бюджет покупця/.test(src), 'нема заборони бюджету у висновку');

  /* ---------- 4/6. збережений і публічний звіт не містять особистого ---------- */
  /* _meta.decision_inputs нового звіту: лише пробіг і позначка, що особисте виключене */
  const metaBlock = (src.match(/decision_inputs: decisionContext \? \{[\s\S]*?\} : null,/) || [''])[0];
  ok(/mileage_context: decisionContext\.mileage \|\| null,/.test(metaBlock) && /personal_context: 'excluded'/.test(metaBlock), '_meta.decision_inputs не обʼєктивний: ' + metaBlock);
  ok(!/buyer|recent|memory|budget/.test(metaBlock), '_meta.decision_inputs зберігає особисте');
  /* звіт, зібраний для будь-кого з цих людей, однаковий; публічний серіалізатор
     навіть старі особисті входи не пропускає */
  const report = {
    vehicle: { title: 'BMW X5 2019' },
    purchase_decision: { recommendation: 'consider_with_checks', headline: 'Ціна нижча за ринок, але ремонт треба підтвердити.', reasoning: 'Ціна $33 500 приблизно на 9% нижча за середній орієнтир схожих пропозицій.' },
    _meta: { url: listing.url, decision_inputs: { mileage_context: mileage, personal_context: 'excluded' }, share_token: 'tok', share_slug: 'bmw-x5-2019' },
  };
  const legacy = JSON.parse(JSON.stringify(report));
  legacy._meta.decision_inputs = { mileage_context: mileage, buyer_context_used: true, recent_reports: [{ title: 'Toyota RAV4 2020' }] };
  for (const r of [report, legacy]) {
    const pub = JSON.stringify(S.publicReport(r));
    ok(!/decision_inputs|buyer_context|recent_reports|RAV4/.test(pub), 'публічний звіт містить входи рішення чи особисте');
    ok(pub.includes('на 9% нижча за середній орієнтир'), 'публічний звіт втратив обʼєктивний ціновий контекст висновку');
  }
  /* публічний перегляд не показує CTA чату автора */
  ok(/body\.readonly #aiBtn,body\.readonly \.pd-cta/.test(page), 'публічний звіт показує CTA чату');

  /* ---------- 5/8. чат і далі отримує вподобання поточної людини ---------- */
  let sent = null;
  const fetchBak = global.fetch;
  global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return { json: async () => ({ choices: [{ message: { content: 'ок' } }], usage: {} }) }; };
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
  try {
    const { default: chat } = await import('file://' + path.join(dir, 'api', 'chat.js'));
    const res = { status() { return this; }, json(b) { this.b = b; return this; } };
    const logBak = console.log; console.log = () => {};
    try {
      await chat({ method: 'POST', body: { product: 'check', memory: USER_30K.buyer_context.note, messages: [{ role: 'user', content: 'Підходить мені ця машина?' }], context: { vehicle: { title: 'BMW X5 2019' }, decision_inputs: report._meta.decision_inputs } } }, res);
    } finally { console.log = logBak; }
    const sys = sent && sent.messages.find(m => m.role === 'system');
    ok(sys && sys.content.includes('Бюджет до 30 000 $'), 'чат не отримав вподобань поточної людини');
    ok(sys && /Персоналізація це твоя робота/.test(sys.content), 'чат не знає, що персоналізація на ньому');
    ok(res.b && res.b.reply === 'ок', 'чат не відповів');
  } finally { global.fetch = fetchBak; }

  /* ---------- 7. генерація звіту працює: промпт зібраний, контракт на місці ---------- */
  ok(pA.system && pA.system.length > 5000 && pA.user, 'промпт основного виклику не зібрався');
  ok(/purchase_decision/.test(pA.system), 'промпт без purchase_decision');

  /* ---------- CTA чату ---------- */
  ok(/<span>Discuss with CalCar AI<\/span><\/button>/.test(page) && /<span class="pd-cta-hint">Discuss the car with your preferences in mind\.<\/span>/.test(page), 'CTA чату без нового тексту');
  const ru = fs.readFileSync('i18n/ru.js', 'utf8'), ua = fs.readFileSync('i18n/ua.js', 'utf8');
  ok(ru.includes("'Discuss with CalCar AI': 'Обсудить с CalCar AI'") && ru.includes("'Discuss the car with your preferences in mind.': 'Обсуди машину с учётом своих предпочтений.'"), 'ru: CTA');
  ok(ua.includes("'Discuss with CalCar AI': 'Обговорити з CalCar AI'") && ua.includes("'Discuss the car with your preferences in mind.': 'Обговори авто з урахуванням своїх уподобань.'"), 'ua: CTA');

  if (errs.length) { console.log('OBJECTIVE REPORT TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('objective report: тіло запиту без особистого · бюджет 30k і 50k -> ідентичний вхід моделі висновку · ринковий price_context лишився · _meta і публічний звіт без особистого · чат отримує вподобання людини · CTA "Обсудить с CalCar AI"');
})().catch(e => { console.log('OBJECTIVE REPORT TEST CRASHED:', e); process.exit(1); });
