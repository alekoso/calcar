/* CalCar: оновлення памʼяті про користувача.
   Отримує поточну нотатку і хвіст розмови, повертає оновлену нотатку.
   Зберігає її сам клієнт у свою таблицю user_memory (під RLS). */

export const config = { maxDuration: 60 };

const MODEL = process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra';

const SYSTEM = `Ти ведеш коротку памʼять CalCar про користувача. CalCar це сервіс, де людина прораховує пригін авто з аукціонів США і перевіряє оголошення на вторинному ринку.

Отримаєш поточну нотатку памʼяті (може бути порожня) і хвіст останньої розмови користувача з помічником по конкретному авто.

Онови нотатку:
- Зберігай лише те, що корисно памʼятати МІЖ розмовами: імʼя, місто, на чому їздить зараз, що шукає (тип авто, моделі), бюджет, важливі вподобання і страхи (наприклад "не хоче фарбовані", "боїться пневмопідвіски"), прийняті рішення по конкретних авто ("відмовився від S63 через турбіни").
- НЕ зберігай: технічні деталі конкретного звіту, разові питання, те, що вже є у звітах.
- Прибирай застаріле, обʼєднуй повтори. Нічого не вигадуй: якщо в розмові немає нової інформації про людину, поверни нотатку без змін.
- Пиши стисло, рядками, максимум 900 символів. Мовою, якою переважно пише користувач.
- НІКОЛИ не використовуй символ довгого тире.

Відповідай ЛИШЕ текстом нотатки, без пояснень і лапок. Якщо нотатка має бути порожньою, поверни порожній рядок.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY не налаштовано' });

  try {
    const { memory, messages } = req.body || {};
    const hist = (Array.isArray(messages) ? messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10)
      .map(m => (m.role === 'user' ? 'Користувач: ' : 'Помічник: ') + m.content.slice(0, 500))
      .join('\n');
    if (!hist) return res.status(400).json({ error: 'Порожня розмова' });

    const cur = typeof memory === 'string' ? memory.slice(0, 2000) : '';

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
          max_completion_tokens: 700,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: 'ПОТОЧНА НОТАТКА:\n' + (cur || '(порожня)') + '\n\nХВІСТ РОЗМОВИ:\n' + hist },
          ],
        }),
      });
      data = await r.json();
    } finally { clearTimeout(t); }

    if (data?.error) return res.status(502).json({ error: 'AI: ' + (data.error.message || 'помилка') });
    let out = (data?.choices?.[0]?.message?.content || '').trim();
    /* модель інколи обгортає лапками або пише "(порожня)": чистимо */
    out = out.replace(/^["'`]+|["'`]+$/g, '').replace(/^\(порожня\)$/i, '').slice(0, 1200);
    return res.status(200).json({ memory: out });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Не встигли, спробуй пізніше' });
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
