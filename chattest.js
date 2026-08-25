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

/* збираємо запит, який пішов би в модель, замість реального виклику;
   modelReply дозволяє підмінити текст відповіді моделі в конкретній перевірці */
let sent = null, modelReply = 'ок';
global.fetch = async (url, opts) => {
  sent = JSON.parse(opts.body);
  return { json: async () => ({ choices: [{ message: { content: modelReply } }], usage: {} }) };
};
process.env.OPENAI_API_KEY = 'test';

async function call(product, memory, extra) {
  sent = null;
  const { default: handler } = await import('file://' + tmp);
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  const body = { messages: [{ role: 'user', content: 'що ти знаєш про мене?' }], context: { vehicle: { title: 'BMW X5 2019' } }, ...(extra || {}) };
  if (product === 'check') body.product = 'check';
  if (memory !== undefined) body.memory = memory;
  /* [chat]-лог самої функції глушимо точково: глобальна підміна console.log
     колись зʼїла б і повідомлення про падіння тесту */
  const prevLog = console.log;
  console.log = () => {};
  try { await handler({ method: 'POST', body }, res); } finally { console.log = prevLog; }
  if (!sent) throw new Error('запит до моделі не зібрався');
  return out;
}
async function sys(product, memory, extra) {
  await call(product, memory, extra);
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

    /* 6. довга нотатка ріжеться по 3000, а не валить запит */
    const long = 'А'.repeat(2990) + 'ХВІСТ' + 'Б'.repeat(1000);
    const cut = await sys(product, long);
    if (!cut.includes('А'.repeat(2990))) errs.push('обрізало памʼять раніше за 3000 символів' + p);
    if (cut.includes('Б'.repeat(20))) errs.push('памʼять не обрізана по 3000 символів' + p);

    /* 7. службовий блок памʼяті: просимо лише коли є куди зберегти (memory рядком) */
    if (!withMem.includes('СЛУЖБОВИЙ БЛОК ПАМʼЯТІ')) errs.push('нема службового блоку памʼяті при рядковій memory' + p);
    if (!withMem.includes('[[MEMORY]]')) errs.push('нема маркера памʼяті в інструкції' + p);
    const emptyStr = await sys(product, '');
    if (!emptyStr.includes('СЛУЖБОВИЙ БЛОК ПАМʼЯТІ')) errs.push('порожній рядок memory мусив вмикати службовий блок (перша нотатка)' + p);
    for (const guest of [undefined, null, 42]) {
      const g = await sys(product, guest);
      if (g.includes('СЛУЖБОВИЙ БЛОК ПАМʼЯТІ')) errs.push('службовий блок просять у гостя (' + JSON.stringify(guest) + ')' + p);
    }

    /* 8. розбір відповіді моделі: нотатка відрізається і їде окремим полем */
    modelReply = 'Відповідь по суті.\n[[MEMORY]]\nЛюдина:\nКиїв, пригін зі США.';
    let r = await call(product, MEM);
    if (r.body.reply !== 'Відповідь по суті.') errs.push('службовий блок не відрізано від відповіді' + p);
    if (r.body.memory_update !== 'Людина:\nКиїв, пригін зі США.') errs.push('нотатка не поїхала полем memory_update' + p);

    /* нотатка без змін: поле не шлеться, зайвого запису в БД не буде */
    modelReply = 'Відповідь.\n[[MEMORY]]\n' + MEM;
    r = await call(product, MEM);
    if (r.body.memory_update !== undefined) errs.push('незмінна нотатка мусила не давати memory_update' + p);
    if (r.body.reply !== 'Відповідь.') errs.push('відповідь зіпсована при незмінній нотатці' + p);

    /* блока нема: відповідь як звичайна, памʼять просто не оновилась */
    modelReply = 'Звичайна відповідь без блока.';
    r = await call(product, MEM);
    if (r.body.reply !== 'Звичайна відповідь без блока.' || r.body.memory_update !== undefined || r.code !== 200) {
      errs.push('відповідь без службового блока зламалась' + p);
    }

    /* битий блок (маркер є, нотатка порожня): користувачу все одно йде відповідь */
    modelReply = 'Відповідь є.\n[[MEMORY]]\n   ';
    r = await call(product, MEM);
    if (r.body.reply !== 'Відповідь є.' || r.body.memory_update !== undefined || r.code !== 200) {
      errs.push('порожній службовий блок зламав відповідь' + p);
    }
    modelReply = 'ок';

    /* 9. наскрізний хвіст розмов доходить до інструкції */
    const turn = (rid, title, text, i) => ({ report_id: rid, title, at: '2026-08-2' + (i % 10) + 'T10:0' + (i % 10) + ':00Z', role: i % 2 ? 'assistant' : 'user', text });
    const tail = [
      turn('AAA', 'BMW X5 2019', 'питання по цьому звіту 1', 0),
      turn('BBB', 'Audi Q8 2020', 'чужий звіт, стара репліка', 1),
      turn('AAA', 'BMW X5 2019', 'питання по цьому звіту 2', 2),
      turn('CCC', 'Tesla Model Y', 'чужа репліка 2', 3),
      turn('CCC', 'Tesla Model Y', 'чужа репліка 3', 4),
      turn('BBB', 'Audi Q8 2020', 'чужа репліка 4', 5),
      turn('AAA', 'BMW X5 2019', 'питання по цьому звіту 3', 6),
      turn('BBB', 'Audi Q8 2020', 'чужа найсвіжіша 5', 7),
    ];
    const wTail = await sys(product, MEM, { report_id: 'AAA', recent_turns: tail });
    if (!wTail.includes('НЕДАВНІ РОЗМОВИ')) errs.push('нема блоку недавніх розмов' + p);
    for (const q of ['питання по цьому звіту 1', 'питання по цьому звіту 2', 'питання по цьому звіту 3']) {
      if (!wTail.includes(q)) errs.push('загубилась репліка цього ж звіту: ' + q + p);
    }
    if (!wTail.includes('цей самий звіт')) errs.push('репліки поточного звіту не позначені' + p);
    if (!wTail.includes('чужа найсвіжіша 5')) errs.push('свіжа чужа репліка не потрапила' + p);
    if (wTail.includes('чужий звіт, стара репліка')) errs.push('взято понад 4 чужі репліки (стара мусила випасти)' + p);
    const cntOthers = (wTail.match(/Audi Q8 2020|Tesla Model Y/g) || []).length;
    if (cntOthers > 4) errs.push('чужих реплік більше за 4: ' + cntOthers + p);

    /* поточних понад 8: разом однаково не більше 8 */
    const many = Array.from({ length: 12 }, (_, i) => turn('AAA', 'BMW X5 2019', 'реп' + i + 'ліка', i));
    const wMany = await sys(product, MEM, { report_id: 'AAA', recent_turns: many });
    const cnt = (wMany.match(/цей самий звіт/g) || []).length;
    if (cnt !== 8) errs.push('ліміт 8 реплік не тримається: ' + cnt + p);
    if (wMany.includes('реп0ліка') || !wMany.includes('реп11ліка')) errs.push('витіснення не з найстаріших' + p);

    /* сміттєвий хвіст не ламає запит і не лишає undefined у блоці */
    for (const junk of [null, 42, { a: 1 }, 'рядок', [null, 5, {}, { role: 'user' }, { role: 'x', text: 'зайве' }, { role: 'user', text: '   ' }]]) {
      const g = await call(product, MEM, { report_id: 'AAA', recent_turns: junk });
      if (g.code !== 200 || !g.body.reply) errs.push('сміттєвий recent_turns зламав запит: ' + JSON.stringify(junk).slice(0, 40) + p);
      const gs = sent.messages.find(m => m.role === 'system').content;
      if (gs.includes('НЕДАВНІ РОЗМОВИ')) errs.push('блок розмов зʼявився зі сміття: ' + JSON.stringify(junk).slice(0, 40) + p);
      if (gs.includes('undefined')) errs.push('undefined у інструкції від сміттєвого хвоста' + p);
    }

    /* репліка без title і довша за 280: назва-заглушка, текст обрізаний */
    const longTurn = [{ report_id: null, title: null, at: null, role: 'user', text: 'Ц'.repeat(300) }];
    const wLong = await sys(product, MEM, { recent_turns: longTurn });
    if (!wLong.includes('звіт без назви')) errs.push('нема заглушки для репліки без назви' + p);
    if (!wLong.includes('Ц'.repeat(280)) || wLong.includes('Ц'.repeat(281))) errs.push('текст репліки не обрізаний по 280' + p);

    /* порожній хвіст: блока нема і порожнього заголовка теж */
    if (withMem.includes('НЕДАВНІ РОЗМОВИ')) errs.push('блок розмов є при порожньому хвості' + p);

    /* 10. правило продукту діє і на згенерований блок */
    const dashTail = await sys(product, MEM, { report_id: 'AAA', recent_turns: [turn('AAA', 'BMW \u2014 X5', 'текст із \u2014 тире', 0)] });
    if (withMem.includes('\u2014')) errs.push('довге тире у системній інструкції' + p);
    if (dashTail.includes('\u2014')) errs.push('довге тире просочилось із хвоста' + p);
  }

  /* 11. контракт зі сторінками: memory, recent_turns, report_id і збереження нотатки */
  for (const f of ['result.html', 'result-check.html']) {
    const s = fs.readFileSync(f, 'utf8');
    if (!/memory:\s*MEMORY/.test(s)) errs.push('сторінка ' + f + ' більше не шле memory у /api/chat');
    if (!/recent_turns:\s*RECENT_TURNS/.test(s)) errs.push('сторінка ' + f + ' не шле recent_turns у /api/chat');
    if (!/report_id:/.test(s)) errs.push('сторінка ' + f + ' не шле report_id у /api/chat');
    if (!s.includes('saveChatMemory(')) errs.push('сторінка ' + f + ' не зберігає memory_update з відповіді');
    if (!s.includes("select('memory,recent_turns')")) errs.push('сторінка ' + f + ' не читає recent_turns з user_memory');
  }

  /* 12. специфікація нотатки: копії в api/memory.js і api/chat.js посимвольно рівні */
  const specOf = file => {
    const m = fs.readFileSync(file, 'utf8').match(/const NOTE_SPEC = `([\s\S]*?)`;/);
    return m && m[1];
  };
  const specMem = specOf('api/memory.js'), specChat = specOf('api/chat.js');
  if (!specMem || !specChat) errs.push('NOTE_SPEC не знайдено в одному з файлів');
  else if (specMem !== specChat) errs.push('NOTE_SPEC розійшовся між api/memory.js і api/chat.js');
  if (specMem && !/Людина:[\s\S]*Уподобання й обмеження:[\s\S]*Активний пошук:[\s\S]*Рішення:/.test(specMem)) {
    errs.push('NOTE_SPEC не містить чотирьох розділів у порядку');
  }

  fs.unlinkSync(tmp);
  if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('памʼять і службовий блок · відбір хвоста розмов (свій звіт увесь, чужих до 4, разом до 8) · сміття не ламає · NOTE_SPEC збігається · контракт сторінок');
  console.log('CHAT MEMORY TEST PASSED');
})().catch(e => { console.log('FAILED:', e.message); process.exit(1); });
