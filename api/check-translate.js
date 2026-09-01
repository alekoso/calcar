/* CalCar Check: переклад готового звіту на мову інтерфейсу.
   Дані і структура не змінюються, перекладається лише текстовий шар.
   Дешевше і швидше за повторний аналіз. Нуль залежностей. */

export const config = { maxDuration: 120 };

const MODEL = process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra';

import { resolveLocale, LANG_NAME_ACC, errText } from './locale.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  /* цільова мова перекладу: явна локаль CalCar; невідома -> English */
  const lang = resolveLocale(req.body?.lang);
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: errText(lang, 'ai_not_configured') });

  try {
    const { report } = req.body || {};
    if (!report || typeof report !== 'object') {
      return res.status(400).json({ error: errText(lang, 'translate_need_report') });
    }

    /* _meta не перекладаємо і не ганяємо через модель */
    const { _meta, translations, ...body } = report;
    const src = JSON.stringify(body);
    if (src.length > 60000) return res.status(400).json({ error: errText(lang, 'translate_report_too_big') });

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
            content: 'Ти перекладач структурованих звітів. Переклади ВСІ текстові значення JSON на ' + LANG_NAME_ACC[lang] + ' мову. ЗАЛИШ БЕЗ ЗМІН: ключі, структуру, числа, null, enum-значення (status, severity, verdict, level, grade, fuel), VIN, держномери, URL, назви брендів і моделей, одиниці на кшталт "км" перекладай природно. НІКОЛИ не використовуй символ довгого тире. Відповідай лише валідним JSON тієї самої структури.',
          },
          { role: 'user', content: src },
        ],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || errText(lang, 'ai_unavailable') });

    let translated;
    try {
      translated = JSON.parse((data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim());
    } catch (e) {
      return res.status(502).json({ error: errText(lang, 'translate_failed') });
    }
    return res.status(200).json({ report: translated });
  } catch (e) {
    return res.status(500).json({ error: errText(lang, 'internal', e.message) });
  }
}
