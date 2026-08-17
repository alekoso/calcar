/* CalCar Check: чат по конкретному оголошенню.
   Отримує історію повідомлень і урізаний звіт, відповідає по суті без вигадок.
   Нуль залежностей, як і решта API. */

export const config = { maxDuration: 120 };

const MODEL = process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra';

const LANG_NAME = { ua: 'українською', ru: 'російською', en: 'англійською (English)' };

const SYSTEM = (ctx, lang) => `Ти AI-помічник CalCar Check. Користувач щойно отримав звіт незалежної перевірки оголошення про продаж вживаного авто і ставить питання по ЦЬОМУ авто.

ЗВІТ (JSON, єдине джерело фактів):
${ctx}

ПРАВИЛА:
- Відповідай ${LANG_NAME[lang] || 'мовою останнього питання користувача'}.
- Коротко і по суті: 2-6 речень або короткий список. Без вступів "чудове питання".
- Єдине джерело фактів про це авто: звіт вище. НІЧОГО не вигадуй понад нього. Якщо у звіті даних немає, чесно скажи, що по цьому авто таких даних нема, і порадь, як користувач може перевірити це сам на огляді.
- Загальні знання про модель, ринок і торг використовувати можна, але завжди відділяй їх від фактів про це конкретне авто.
- Будь чесним: якщо ризик серйозний, кажи прямо. Рішення завжди за користувачем.
- НІКОЛИ не використовуй символ довгого тире. Пиши кому, двокрапку або крапку.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY не налаштовано' });

  try {
    const { messages, report, lang } = req.body || {};

    /* санітайз історії: останні 12, кожне до 2000 символів, лише user/assistant */
    const msgs = (Array.isArray(messages) ? messages : [])
      .slice(-12)
      .map(m => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content || '').slice(0, 2000),
      }))
      .filter(m => m.content);
    if (!msgs.length) return res.status(400).json({ error: 'Порожнє повідомлення' });

    let ctx = '{}';
    try { ctx = JSON.stringify(report || {}).slice(0, 6000); } catch (e) {}

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM(ctx, lang) }, ...msgs],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ error: data?.error?.message || 'AI недоступний, спробуй ще раз' });
    }
    const reply = (data.choices?.[0]?.message?.content || '').trim();
    if (!reply) return res.status(502).json({ error: 'AI повернув порожню відповідь, спробуй ще раз' });

    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
