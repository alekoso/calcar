/* Чат-помічник: памʼять про власника мусить доходити до системної інструкції.
   Баг, який ловить цей тест: сторінки слали body.memory, а api/chat.js його
   взагалі не читав, і додатково правило про сторонні питання відсікало
   питання про саму людину. Перевіряємо обидва продукти однаково. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
const MEM = ['Імʼя: Олексій, Київ.',
  'Зараз їздить на Audi Q7 2016, 3.0 TDI, пробіг 190 тис.',
  'Шукає сімейний кросовер до 25 тис доларів.',
  'Не хоче фарбовані авто, боїться пневмопідвіски.'].join('\n');

/* api/chat.js це ESM-функція Vercel: щоб імпортувати її з CommonJS-тесту,
   кладемо копію з розширенням .mjs, як garagetest.js робить для node --check */
const src = fs.readFileSync('api/chat.js', 'utf8');
const tmp = path.join(os.tmpdir(), 'calcar_chattest.mjs');
fs.writeFileSync(tmp, src);

/* збираємо запит, який пішов би в модель, замість реального виклику */
let sent = null;
global.fetch = async (url, opts) => {
  sent = JSON.parse(opts.body);
  return { json: async () => ({ choices: [{ message: { content: 'ок' } }], usage: {} }) };
};
process.env.OPENAI_API_KEY = 'test';

async function sys(product, memory, question) {
  sent = null;
  const { default: handler } = await import('file://' + tmp);
  const res = { status() { return this; }, json() { return this; } };
  const body = { messages: [{ role: 'user', content: question || 'що ти знаєш про мене?' }], context: { vehicle: { title: 'BMW X5 2019' } } };
  if (product === 'check') body.product = 'check';
  if (memory !== undefined) body.memory = memory;
  /* [chat]-лог самої функції глушимо точково: глобальна підміна console.log
     колись зʼїла б і повідомлення про падіння тесту */
  const prevLog = console.log;
  console.log = () => {};
  try { await handler({ method: 'POST', body }, res); } finally { console.log = prevLog; }
  if (!sent) throw new Error('запит до моделі не зібрався');
  return sent.messages.find(m => m.role === 'system').content;
}

(async () => {
  for (const product of ['check', 'import']) {
    const p = ' (' + product + ')';

    /* 1. непорожня памʼять доходить до системної інструкції цілком */
    const withMem = await sys(product, MEM);
    if (!withMem.includes(MEM)) errs.push('памʼять не потрапила в системну інструкцію' + p);
    if (!withMem.includes('ПРОФІЛЬ ВЛАСНИКА')) errs.push('нема блоку профілю власника' + p);
    if (!withMem.includes('Audi Q7')) errs.push('нинішнє авто власника загубилось' + p);

    /* 2. предметна область не підмінилась */
    const domain = product === 'check' ? 'з оголошення на вторинному ринку' : 'з американського страхового аукціону';
    if (!withMem.includes(domain)) errs.push('підмінилась предметна область' + p);

    /* 3. інструкція дозволяє порівнювати авто власника з авто зі звіту */
    if (!/ПОРІВНЯННЯ З ЇЇ АВТО/.test(withMem)) errs.push('нема дозволу порівнювати з авто власника' + p);

    /* 4. знята суперечність: питання про саму людину більше не сторонні */
    if (withMem.includes('На питання не по цьому авто чи не по темі пригону відповідай одним реченням')) {
      errs.push('повернулось правило, яке відсікало питання про власника' + p);
    }

    /* 5. порожня памʼять: явна заборона вигадувати, без сміття в тексті */
    for (const empty of [undefined, '', '   ', null, 42, { a: 1 }]) {
      const noMem = await sys(product, empty);
      if (!noMem.includes('нотатки про цю людину поки нема')) errs.push('нема блоку порожнього профілю для ' + JSON.stringify(empty) + p);
      /* дивимось саме перший рядок блоку: туди підставилось би "undefined" чи "[object Object]" */
      const head = (noMem.split('ПРОФІЛЬ ВЛАСНИКА')[1] || '').split('\n')[0];
      if (/undefined|\[object Object\]|null|42/.test(head)) errs.push('сміття замість памʼяті для ' + JSON.stringify(empty) + p);
    }

    /* 6. довга нотатка ріжеться по 2000, а не валить запит */
    const long = 'А'.repeat(1990) + 'ХВІСТ' + 'Б'.repeat(1000);
    const cut = await sys(product, long);
    if (!cut.includes('А'.repeat(1990))) errs.push('обрізало памʼять раніше за 2000 символів' + p);
    if (cut.includes('Б'.repeat(20))) errs.push('памʼять не обрізана по 2000 символів' + p);

    /* 7. правило продукту діє і на згенерований блок */
    if (withMem.includes('\u2014')) errs.push('довге тире у системній інструкції' + p);
  }

  /* 8. контракт зі сторінками: обидві сторінки мусять слати memory */
  for (const f of ['result.html', 'result-check.html']) {
    const s = fs.readFileSync(f, 'utf8');
    if (!/memory:\s*MEMORY/.test(s)) errs.push('сторінка ' + f + ' більше не шле memory у /api/chat');
  }

  fs.unlinkSync(tmp);
  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('памʼять у системній інструкції · check і import · порожня і довга нотатка · суперечність знята · контракт сторінок');
  console.log('CHAT MEMORY TEST PASSED');
})().catch(e => { console.log('FAILED:', e.message); process.exit(1); });
