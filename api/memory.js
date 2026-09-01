/* CalCar: оновлення памʼяті про користувача.
   Отримує поточну нотатку і хвіст розмови, повертає оновлену нотатку.
   Зберігає її сам клієнт у свою таблицю user_memory (під RLS). */

export const config = { maxDuration: 60 };

import { resolveLocale, errText } from './locale.js';

const MODEL = process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra';

/* Специфікація нотатки памʼяті. УВАГА: точна копія цієї константи живе
   в api/chat.js (новий шлях оновлення памʼяті всередині відповіді чату).
   Змінюючи текст тут, зміни і там: chattest.js звіряє копії посимвольно. */
const NOTE_SPEC = `Нотатка ведеться ЧОТИРМА розділами з такими заголовками, саме в цьому порядку:

Людина:
ринок, де людина шукає авто (Україна, пригін зі США, інше); рівень технічної грамотності; стиль використання авто (місто, траса, сімʼя, робота).

Уподобання й обмеження:
бюджет; тип кузова; паливо; марки; ставлення до битих авто зі США; допустимий пробіг; що для людини важливіше (надійність, комфорт, динаміка).

Активний пошук:
що людина шукає прямо зараз, вимоги, кандидати. Розділ ОБОВʼЯЗКОВО закривається: якщо людина написала, що купила авто або припинила пошук, очисти розділ, а підсумок перенеси одним рядком у Рішення.

Рішення:
журнал з датами: які авто людина дивилась, що відсіяла чи обрала і чому. До 10 рядків, свіжі витісняють старі.

Загальні правила нотатки:
- Свіже перемагає застаріле. Без повторів, без разових дрібниць.
- Дані конкретних звітів (кошториси, ціни, VIN, деталі пошкоджень) не копіюй: вони приходять окремо разом зі звітом.
- Порожній розділ лишай самим заголовком, не вигадуй вміст.
- Пиши стисло, рядками. Мʼякий ліміт 2500 символів: наближаючись до нього, стискай формулювання і викидай найменш цінне.
- Мовою, якою переважно пише користувач.
- НІКОЛИ не використовуй символ довгого тире.`;

const SYSTEM = `Ти ведеш памʼять CalCar про користувача. CalCar це сервіс, де людина прораховує пригін авто з аукціонів США і перевіряє оголошення на вторинному ринку.

Отримаєш поточну нотатку памʼяті (може бути порожня) і хвіст останньої розмови користувача з помічником по конкретному авто.

Онови нотатку.

${NOTE_SPEC}

Нічого не вигадуй: якщо в розмові немає нової інформації про людину, поверни нотатку без змін. Якщо нотатка ще не має розділів, переклади її наявний зміст у структуру вище.

Відповідай ЛИШЕ текстом нотатки, без пояснень і лапок. Якщо нотатка має бути порожньою, поверни порожній рядок.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const lang = resolveLocale(req.body?.lang);
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: errText(lang, 'ai_not_configured') });

  try {
    const { memory, messages } = req.body || {};
    const hist = (Array.isArray(messages) ? messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10)
      .map(m => (m.role === 'user' ? 'Користувач: ' : 'Помічник: ') + m.content.slice(0, 500))
      .join('\n');
    if (!hist) return res.status(400).json({ error: errText(lang, 'memory_empty') });

    const cur = typeof memory === 'string' ? memory.slice(0, 3000) : '';

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45000);
    let data;
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        signal: ctl.signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
        },
        body: JSON.stringify({
          model: MODEL,
          max_completion_tokens: 1600,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: 'Сьогодні: ' + new Date().toISOString().slice(0, 10) + '\n\nПОТОЧНА НОТАТКА:\n' + (cur || '(порожня)') + '\n\nХВІСТ РОЗМОВИ:\n' + hist },
          ],
        }),
      });
      data = await r.json();
    } finally { clearTimeout(t); }

    if (data?.error) return res.status(502).json({ error: 'AI: ' + (data.error.message || errText(lang, 'ai_request_failed')) });
    let out = (data?.choices?.[0]?.message?.content || '').trim();
    /* модель інколи обгортає лапками або пише "(порожня)": чистимо */
    out = out.replace(/^["'`]+|["'`]+$/g, '').replace(/^\(порожня\)$/i, '').slice(0, 2800);
    return res.status(200).json({ memory: out });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: errText(lang, 'memory_timeout') });
    return res.status(500).json({ error: errText(lang, 'internal', e.message) });
  }
}
