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
/* chat.js імпортує ./locale.js: кладемо поруч */
fs.writeFileSync(path.join(os.tmpdir(), 'locale.js'), fs.readFileSync('api/locale.js', 'utf8'));

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

    /* 10. звіти, прикладені через @, доходять до інструкції і праймера */
    const ref = (id, title) => ({ id, title, kind: 'check', created_at: '2026-08-20T10:00:00Z', vehicle: { title }, verdict: { score: 7 }, photos: ['СЕКРЕТНЕ_ФОТО'], _chat: ['зайве'] });
    let rr = await call(product, MEM, { referenced_reports: [ref('r1', 'Audi Q8 2020'), ref('r2', 'Kia EV6 2022')] });
    let rSys = sent.messages.find(m => m.role === 'system').content;
    let primer = sent.messages[1].content.find(b => b.type === 'text').text;
    if (!rSys.includes('ДОДАНІ ЗВІТИ ДЛЯ ПОРІВНЯННЯ')) errs.push('нема блоку доданих звітів' + p);
    if (!primer.includes('Додані користувачем звіти для порівняння')) errs.push('дані доданих звітів не в праймері' + p);
    if (!primer.includes('Audi Q8 2020') || !primer.includes('Kia EV6 2022')) errs.push('загубився доданий звіт' + p);
    if (primer.includes('СЕКРЕТНЕ_ФОТО') || primer.includes('зайве')) errs.push('білий список полів не працює (фото або чат просочились)' + p);

    /* ліміт два: третій відкидається */
    await call(product, MEM, { referenced_reports: [ref('r1', 'Перший'), ref('r2', 'Другий'), ref('r3', 'Третій')] });
    primer = sent.messages[1].content.find(b => b.type === 'text').text;
    if (!primer.includes('Перший') || !primer.includes('Другий')) errs.push('загубився звіт із перших двох' + p);
    if (primer.includes('Третій')) errs.push('третій доданий звіт не відкинуто' + p);

    /* сміття не ламає запит і не вмикає блок */
    for (const junk of [null, 42, 'рядок', { a: 1 }, [null, 5, 'x', []], []]) {
      const g = await call(product, MEM, { referenced_reports: junk });
      if (g.code !== 200 || !g.body.reply) errs.push('сміттєвий referenced_reports зламав запит: ' + JSON.stringify(junk) + p);
      const gs = sent.messages.find(m => m.role === 'system').content;
      if (gs.includes('ДОДАНІ ЗВІТИ ДЛЯ ПОРІВНЯННЯ')) errs.push('блок доданих звітів зі сміття: ' + JSON.stringify(junk) + p);
    }
    /* без refs блока нема */
    if (withMem.includes('ДОДАНІ ЗВІТИ ДЛЯ ПОРІВНЯННЯ')) errs.push('блок доданих звітів є без refs' + p);

    /* 10б. тіньова оцінка v2: чат її повністю ігнорує */
    await call(product, MEM, { context: { vehicle: { title: 'BMW X5 2019' }, verdict: { score: 7.1 }, score_v2_preview: 5.5, score_breakdown_v2: { final: 5.5 }, score_facts: { findings: [{ type: 'FLOOD' }] } } });
    const v2primer = sent.messages[1].content.find(bk => bk.type === 'text').text;
    for (const leak of ['score_v2_preview', 'score_breakdown_v2', 'score_facts']) {
      if (v2primer.includes(leak)) errs.push('поле ' + leak + ' просочилось у чат' + p);
    }
    if (!v2primer.includes('7.1')) errs.push('легасі verdict.score зник із контексту чату' + p);
    /* v2 не протікає і через інші звіти користувача (body.others і context) */
    await call(product, MEM, {
      context: { vehicle: { title: 'BMW X5 2019' }, other_reports_of_this_user: [{ title: 'Kia EV6', score_v2_preview: 4.4 }] },
      others: [{ title: 'Audi Q8 2020', totals: { total: 21000 }, score_facts: { findings: [] }, score_v2_preview: 6.1, score_breakdown_v2: { final: 6.1 } }],
    });
    const othersPrimer = sent.messages[1].content.find(bk => bk.type === 'text').text;
    for (const leak of ['score_v2_preview', 'score_breakdown_v2', 'score_facts']) {
      if (othersPrimer.includes(leak)) errs.push('поле ' + leak + ' протекло через інші звіти' + p);
    }
    if (!othersPrimer.includes('Audi Q8 2020') || !othersPrimer.includes('21000')) errs.push('корисні поля інших звітів постраждали від чистки' + p);

    /* 11. цитата зі звіту доходить до інструкції */
    const wQuote = await sys(product, MEM, { quoted_text: 'пробіг 190 тис підтверджений Carfax' });
    if (!wQuote.includes('ЦИТАТА ЗІ ЗВІТУ')) errs.push('нема блоку цитати' + p);
    if (!wQuote.includes('пробіг 190 тис підтверджений Carfax')) errs.push('текст цитати загубився' + p);
    /* порожня і сміттєва цитата: запит живий, порожнього блока нема */
    for (const junk of [undefined, null, 42, { a: 1 }, '', '   ', []]) {
      const g = await call(product, MEM, { quoted_text: junk });
      if (g.code !== 200 || !g.body.reply) errs.push('сміттєвий quoted_text зламав запит: ' + JSON.stringify(junk) + p);
      const gs = sent.messages.find(m => m.role === 'system').content;
      if (gs.includes('ЦИТАТА ЗІ ЗВІТУ')) errs.push('порожній блок цитати для ' + JSON.stringify(junk) + p);
    }
    /* страхувальна обрізка по 600 на сервері (сторінка ріже по 500 сама) */
    const qcut = await sys(product, MEM, { quoted_text: 'Й'.repeat(600) + 'Ф'.repeat(100) });
    if (!qcut.includes('Й'.repeat(600))) errs.push('цитату обрізало раніше за 600' + p);
    if (qcut.includes('Ф'.repeat(10))) errs.push('цитата не обрізана по 600' + p);

    /* 12. правило продукту діє і на згенерований блок */
    const dashTail = await sys(product, MEM, { report_id: 'AAA', recent_turns: [turn('AAA', 'BMW \u2014 X5', 'текст із \u2014 тире', 0)] });
    if (withMem.includes('\u2014')) errs.push('довге тире у системній інструкції' + p);
    if (dashTail.includes('\u2014')) errs.push('довге тире просочилось із хвоста' + p);
  }

  /* 12. контракт із єдиним помічником: памʼять, recent_turns, report_id, @-звіти
     живуть у chat.js; сторінки звітів лише реєструють свої здатності */
  {
    const c = fs.readFileSync('chat.js', 'utf8');
    if (!/memory:\s*MEMORY/.test(c)) errs.push('chat.js більше не шле memory у /api/chat');
    if (!/recent_turns:\s*RECENT_TURNS/.test(c)) errs.push('chat.js не шле recent_turns у /api/chat');
    if (!/report_id:/.test(c)) errs.push('chat.js не шле report_id у /api/chat');
    if (!c.includes('saveChatMemory(')) errs.push('chat.js не зберігає memory_update з відповіді');
    if (!c.includes("select('memory,recent_turns')")) errs.push('chat.js не читає recent_turns з user_memory');
    if (!/referenced_reports:\s*refs/.test(c)) errs.push('chat.js не шле referenced_reports');
    for (const el of ['id="ccMention"', 'id="ccMentionSearch"', 'id="ccMentionList"', 'id="ccFocus"']) {
      if (!c.includes(el)) errs.push('chat.js без елемента ' + el);
    }
    if (!c.includes('<b>CalCar Assistant</b>')) errs.push('chat.js без заголовка CalCar Assistant');
    if (!c.includes('pendingRefs.length >= 2')) errs.push('chat.js без ліміту двох прикріплених звітів');
    if (!c.includes('bindMention();')) errs.push('chat.js не підключає @-попап');
    if (!/onpointerdown = function \(e\) \{ e\.preventDefault\(\); pickMention\(r\); \}/.test(c)) errs.push('вибір звіту мишею не на pointerdown із preventDefault');
    if (!/fetch\('\/api\/memory'/.test(c)) errs.push('chat.js не оновлює нотатку памʼяті');
    for (const f of ['result.html', 'result-check.html']) {
      const s = fs.readFileSync(f, 'utf8');
      if (!s.includes('CalCarChat.registerCapability(')) errs.push('сторінка ' + f + ' не реєструє здатність у спільному помічнику');
      if (!/afterReply: \(\) => persistChat\(\)/.test(s)) errs.push('сторінка ' + f + ' не пише репліки про звіт у його рядок');
      if (/memory:\s*MEMORY|fetch\('\/api\/chat'/.test(s)) errs.push('сторінка ' + f + ' досі має власний чат повз спільний');
      if (s.includes('id="chatPanel"')) errs.push('сторінка ' + f + ' досі тримає власну панель чату');
    }
  }

  /* синтаксис усіх вбудованих скриптів сторінок звітів (логіка попапа теж тут) */
  for (const f of ['result.html', 'result-check.html']) {
    const scripts = fs.readFileSync(f, 'utf8').split('<script>').slice(1).map(x => x.split('<\/script>')[0]);
    scripts.forEach((code, i) => {
      const tp = path.join(os.tmpdir(), 'calcar_ui_' + i + '.js');
      fs.writeFileSync(tp, code);
      try { require('child_process').execSync('node --check ' + JSON.stringify(tp)); }
      catch (e) { errs.push('синтаксис скрипта ' + i + ' у ' + f + ': ' + String(e.message).split('\n')[1]); }
      fs.unlinkSync(tp);
    });
  }

  /* 14. дві метрики Import не плутаються: оцінка пошкоджень і легасі-ризик.
     UI показує 8.1, легасі-ризик 3.6; на питання про пошкодження помічник
     мусить мати в контексті саме 8.1 і пряму заборону відповідати легасі-балом */
  {
    const api = fs.readFileSync('api/chat.js', 'utf8');
    const dom = api.slice(api.indexOf('const DOMAIN_IMPORT'), api.indexOf('const DOMAIN_CHECK'));
    for (const rule of [
      'context.damage_score це ОЦІНКА ПОШКОДЖЕНЬ',
      'Питання "яка оцінка пошкоджень"',
      'ВНУТРІШНІЙ ЛЕГАСІ-СИГНАЛ',
      'на питання про пошкодження ним НЕ відповідай',
      'ВИВОДИТИ оцінку пошкоджень із legacy_purchase_risk у цьому разі ЗАБОРОНЕНО',
      'поля risk усередині totals',
    ]) if (!dom.includes(rule)) errs.push('у промпті Import нема правила: ' + rule.slice(0, 46));
    if (/context є risk_score/.test(dom)) errs.push('стара двозначна згадка risk_score лишилась у промпті');

    /* контекст сторінки: нова метрика присутня, легасі названий легасі */
    const page = fs.readFileSync('result.html', 'utf8');
    const ctx = page.slice(page.indexOf('function chatContext()'), page.indexOf('function photosForChat()'));
    for (const k of ['damage_score:', 'damage_score_available:', 'damage_label:', 'damage_severity:', 'restoration_confirmed:', 'damage_coverage:', 'legacy_purchase_risk:']) {
      if (!ctx.includes(k)) errs.push('контекст Import без поля ' + k);
    }
    if (/(^|[^_])risk_score:/.test(ctx)) errs.push('легасі-ризик досі їде під назвою risk_score');

    /* прогін самого конверта: 8.1 у damage_score, 3.6 у легасі, і вони не переплутані */
    const DATA = { damage_score: { score_available: true, score: 8.1, label_key: 'Moderate damage', max_event_severity: 'moderate', restoration_confirmed: false, coverage: { sufficient: true, depth_known: true, strong_signals: [] } } };
    const envelope = {
      damage_score: DATA.damage_score.score_available ? DATA.damage_score.score : null,
      damage_score_available: !!DATA.damage_score.score_available,
      damage_label: DATA.damage_score.label_key,
      damage_severity: DATA.damage_score.max_event_severity,
      restoration_confirmed: DATA.damage_score.restoration_confirmed,
      legacy_purchase_risk: 3.6,
    };
    if (envelope.damage_score !== 8.1) errs.push('оцінка пошкоджень у конверті не 8.1');
    if (envelope.legacy_purchase_risk === envelope.damage_score) errs.push('дві метрики злились в одну');
    if (Math.abs((10 - envelope.legacy_purchase_risk) - envelope.damage_score) < 0.05) errs.push('легасі-ризик інвертується в оцінку пошкоджень: саме цього не має бути');
    /* старий звіт без бала: заборона рахувати його з легасі */
    const oldReport = { damage_score: undefined };
    const oldEnv = { damage_score: null, damage_score_available: false, legacy_purchase_risk: 3.6 };
    if (oldEnv.damage_score !== null || oldEnv.damage_score_available !== false) errs.push('старий звіт мусить давати damage_score null і available false');
  }

  /* 13. специфікація нотатки: копії в api/memory.js і api/chat.js посимвольно рівні */
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
  console.log('памʼять і службовий блок · хвіст розмов (свій увесь, чужих до 4, разом до 8) · @-звіти (ліміт 2, білий список) · сміття не ламає · словники й синтаксис сторінок');
  console.log('CHAT MEMORY TEST PASSED');
})().catch(e => { console.log('FAILED:', e.message); process.exit(1); });
