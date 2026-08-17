/* CalCar Check: переклад готового звіту на мову інтерфейсу.
   Дані і структура не змінюються, перекладається лише текстовий шар.
   Дешевше і швидше за повторний аналіз. Нуль залежностей. */

export const config = { maxDuration: 120 };

const MODEL = process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra';

const LANG_NAME = { ua: 'українську', ru: 'російську', en: 'англійську (English)' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY не налаштовано' });

  try {
    const { report, lang } = req.body || {};
    if (!report || typeof report !== 'object' || !LANG_NAME[lang]) {
      return res.status(400).json({ error: 'Потрібні report і lang (ua|ru|en)' });
    }

    /* _meta не перекладаємо і не ганяємо через модель */
    const { _meta, translations, ...body } = report;
    const src = JSON.stringify(body);
    if (src.length > 60000) return res.status(400).json({ error: 'Звіт завеликий' });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Ти перекладач структурованих звітів. Переклади ВСІ текстові значення JSON на ' + LANG_NAME[lang] + ' мову. ЗАЛИШ БЕЗ ЗМІН: ключі, структуру, числа, null, enum-значення (status, severity, verdict, level, grade, fuel), VIN, держномери, URL, назви брендів і моделей, одиниці на кшталт "км" перекладай природно. НІКОЛИ не використовуй символ довгого тире. Відповідай лише валідним JSON тієї самої структури.',
          },
          { role: 'user', content: src },
        ],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'AI недоступний, спробуй ще раз' });

    let translated;
    try {
      translated = JSON.parse((data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim());
    } catch (e) {
      return res.status(502).json({ error: 'Переклад не вдався, спробуй ще раз' });
    }
    return res.status(200).json({ report: translated });
  } catch (e) {
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
