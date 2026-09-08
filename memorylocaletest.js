/* Мова тіла памʼяті помічника.

   Памʼять (user_memory.memory) генерує модель за NOTE_SPEC. Чотири заголовки
   розділів це технічні маркери формату: вони завжди українські, за ними
   сторінка кабінету розбирає нотатку і показує їх уже мовою інтерфейсу
   (memorytest). А ось ТІЛО розділів людина читає як є, тому воно мусить бути
   мовою інтерфейсу: при RU-локалі російською, а не українською, незалежно
   від мови, якою людина писала в чаті.

   Тест тримає три речі:
   1. контракт запиту до моделі в обох шляхах оновлення памʼяті (api/memory.js
      і службовий блок api/chat.js): правило "мовою інтерфейсу" у специфікації
      і рядок МОВА НОТАТКИ з назвою саме тієї мови, яку передала сторінка;
   2. детектор мови тіла нотатки і записану відповідь продакшн-генератора
      (2026-09-08, lang=ru, вхідна нотатка українською, репліки російською):
      тіло російське, заголовки лишились технічними;
   3. CALCAR_LIVE=1: той самий запит до живого /api/memory на проді, тіло
      відповіді мусить бути російським. Без прапорця мережа не потрібна. */
const fs = require('fs');
const errs = [];
const HEADINGS = ['Людина:', 'Уподобання й обмеження:', 'Активний пошук:', 'Рішення:'];

/* ---------- детектор: заголовки не рахуємо, дивимось лише на тіло ---------- */
function bodyLines(note) {
  return String(note || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !HEADINGS.includes(l));
}
function localeOfBody(note) {
  const body = bodyLines(note).join('\n');
  const ua = (body.match(/[іїєґ]/gi) || []).length;
  const ru = (body.match(/[ыэъё]/gi) || []).length;
  const cyr = (body.match(/[а-яіїєґ]/gi) || []).length;
  if (!cyr) return /[a-z]/i.test(body) ? 'en' : 'empty';
  if (ua && !ru) return 'ua';
  if (ru && !ua) return 'ru';
  if (!ua && !ru) return 'cyr';   /* без маркерних літер: не розрізнити */
  return 'mixed';
}
function headingsIntact(note) {
  const lines = String(note || '').split(/\r?\n/).map(l => l.trim());
  return HEADINGS.every(h => lines.includes(h));
}

/* ---------- 1. контракт запиту до моделі ---------- */
const memSrc = fs.readFileSync('api/memory.js', 'utf8');
const chatSrc = fs.readFileSync('api/chat.js', 'utf8');
for (const [name, src] of [['api/memory.js', memSrc], ['api/chat.js', chatSrc]]) {
  if (/Мовою, якою переважно пише користувач/.test(src)) errs.push(name + ': специфікація досі велить писати мовою користувача');
  if (!/- Мовою інтерфейсу CalCar, яку сервіс передає окремим рядком МОВА НОТАТКИ/.test(src)) errs.push(name + ': у специфікації нема правила мови інтерфейсу');
  if (!/Заголовки чотирьох розділів лишаються рівно такими, як у цій специфікації/.test(src)) errs.push(name + ': специфікація дозволяє перекладати технічні заголовки');
  if (!/МОВА НОТАТКИ: ' \+ LANG_NAME\[lang\]/.test(src)) errs.push(name + ': мова інтерфейсу не передається в запит генератора');
}
const UA_NOTE = 'Людина:\nШукає авто в Україні, розбирається в техніці на середньому рівні.\n\nУподобання й обмеження:\nБюджет до 25 000 доларів. Кузов універсал або кросовер. Пробіг до 150 000 км.\n\nАктивний пошук:\nДивиться BMW 5 Series 2018 року.\n\nРішення:\n2026-09-01: відсіяв Audi A6 2016 через нерозкриту історію обслуговування.';
const MESSAGES = [
  { role: 'user', content: 'Кстати, я решил: бюджет поднимаю до 30 тысяч долларов, и хочу только полный привод.' },
  { role: 'assistant', content: 'Понял, запомню: бюджет до 30 000 долларов и только полный привод.' },
];
const WANT = { ru: 'російською', ua: 'українською', en: 'англійською (English)' };

(async () => {
  /* справжній handler під підміненим fetch: ловимо, що саме піде моделі */
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { default: handler } = await import('./api/memory.js');
  for (const lang of ['ru', 'ua', 'en']) {
    let sent = null;
    global.fetch = async (url, init) => { sent = JSON.parse(init.body); return { json: async () => ({ choices: [{ message: { content: UA_NOTE } }] }) }; };
    let status = 0, body = null;
    const res = { status(s) { status = s; return res; }, json(b) { body = b; return res; } };
    await handler({ method: 'POST', body: { lang, memory: UA_NOTE, messages: MESSAGES } }, res);
    if (status !== 200 || !body || typeof body.memory !== 'string') { errs.push('memory.js (' + lang + '): handler не повернув нотатку: ' + status + ' ' + JSON.stringify(body)); continue; }
    if (!sent) { errs.push('memory.js (' + lang + '): запит до моделі не пішов'); continue; }
    const sys = sent.messages.find(m => m.role === 'system').content, user = sent.messages.find(m => m.role === 'user').content;
    if (!sys.includes('Мовою інтерфейсу CalCar')) errs.push('memory.js (' + lang + '): системний промпт без правила мови інтерфейсу');
    if (!user.includes('МОВА НОТАТКИ: ' + WANT[lang] + '.')) errs.push('memory.js (' + lang + '): у запиті нема "МОВА НОТАТКИ: ' + WANT[lang] + '."');
    if (!user.includes('ПОТОЧНА НОТАТКА:\n' + UA_NOTE)) errs.push('memory.js (' + lang + '): поточна нотатка передається зміненою');
  }
  /* chat.js: службовий блок памʼяті всередині відповіді чату несе ту саму мову */
  if (!/MEMORY_TASK \+ '\\nМОВА НОТАТКИ: ' \+ LANG_NAME\[lang\] \+ '\.'/.test(chatSrc)) errs.push('api/chat.js: службовий блок памʼяті не передає мову інтерфейсу');

  /* ---------- 2. детектор і записана відповідь проду ---------- */
  if (localeOfBody(UA_NOTE) !== 'ua') errs.push('детектор не впізнає українське тіло: ' + localeOfBody(UA_NOTE));
  if (!headingsIntact(UA_NOTE)) errs.push('детектор заголовків зламаний');
  /* відповідь продакшн-генератора на UA_NOTE + MESSAGES при lang=ru, записано 2026-09-08 */
  const PROD_RU = 'Людина:\nИщет авто в Украине, разбирается в технике на среднем уровне.\n\nУподобання й обмеження:\nБюджет до 30 000 долларов. Кузов универсал или кроссовер. Только полный привод. Пробег до 150 000 км.\n\nАктивний пошук:\nСмотрит BMW 5 Series 2018 года.\n\nРішення:\n2026-09-01: отсеял Audi A6 2016 из-за нераскрытой истории обслуживания.';
  if (localeOfBody(PROD_RU) !== 'ru') errs.push('записана відповідь проду при lang=ru не російська: ' + localeOfBody(PROD_RU));
  if (!headingsIntact(PROD_RU)) errs.push('записана відповідь проду втратила технічні заголовки');
  if (!/30 000/.test(PROD_RU) || !/полный привод/i.test(PROD_RU) || !/Audi A6 2016/.test(PROD_RU)) errs.push('записана відповідь проду загубила факти при зміні мови');
  for (const l of bodyLines(PROD_RU)) if (/[іїєґ]/i.test(l)) errs.push('у російському тілі лишився український рядок: ' + l.slice(0, 50));

  /* ---------- 3. живий прод за прапорцем ---------- */
  if (process.env.CALCAR_LIVE === '1') {
    const r = await fetch('https://www.calcar.io/api/memory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: 'ru', memory: UA_NOTE, messages: MESSAGES }) });
    const j = await r.json().catch(() => null);
    const note = j && j.memory;
    if (!note) errs.push('live: /api/memory не повернув нотатку: ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    else {
      const loc = localeOfBody(note);
      if (loc !== 'ru') errs.push('live: тіло памʼяті при lang=ru не російське (' + loc + '):\n' + note);
      if (!headingsIntact(note)) errs.push('live: технічні заголовки змінені:\n' + note);
      console.log('live /api/memory (lang=ru): тіло ' + loc + ', заголовки ' + (headingsIntact(note) ? 'на місці' : 'зламані'));
    }
  }

  if (errs.length) { console.log('MEMORY LOCALE TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('мова памʼяті: правило інтерфейсу в обох специфікаціях · МОВА НОТАТКИ ru/ua/en у запиті · записана відповідь проду російська із технічними заголовками' + (process.env.CALCAR_LIVE === '1' ? ' · живий прод' : ''));
  console.log('MEMORY LOCALE TEST PASSED');
})().catch(e => { console.log('MEMORY LOCALE TEST CRASHED:', e.stack || e.message); process.exit(1); });
