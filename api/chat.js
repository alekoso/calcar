export const config = { maxDuration: 60 };

const SYSTEM = `Ти чат-помічник CalCar по конкретному авто з американського страхового аукціону (Copart/IAAI), яке користувач розглядає для пригону в Україну.

У першому повідомленні користувача передані: фото лота, дані аукціону, результат AI-розбору пошкоджень, кошторис із правками користувача і поточні підсумки. Це єдине джерело фактів по цьому авто.

Правила:
- Відповідай українською, коротко і по суті: 1-4 речення на просте питання. Списки лише коли їх реально просять або без них незрозуміло.
- Спирайся на передані дані і фото. Не вигадуй фактів про це авто. Якщо чогось у даних немає або по фото не видно, скажи прямо і порадь, як перевірити.
- Усі ціни в доларах США, орієнтовні для ринку України. Підсумок "під ключ" вже порахований у totals, використовуй його.
- Можеш рахувати: наприклад, перерахувати підсумок з іншою ставкою (мито 10% від ставки, ПДВ 20% від ставки+мита+акцизу, акциз не змінюється).
- Питання "чи варто брати": зваж ризики зі звіту і різницю між підсумком та ринковою ціною, дай чесну оцінку, а не підтакування. Рішення завжди за користувачем.
- НІКОЛИ не використовуй символ довгого тире, пиши кому, двокрапку або крапку.
- На питання не по цьому авто чи не по темі пригону відповідай одним реченням і повертай до теми.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY не налаштований у Vercel' });
  }

  try {
    const { messages, context, photos } = req.body || {};

    const hist = (Array.isArray(messages) ? messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!hist.length || hist[hist.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Порожнє питання' });
    }

    /* фото: https-посилання аукціону дешеві (detail low), data:-фото обмежуємо трьома */
    const raw = Array.isArray(photos) ? photos.filter(u => typeof u === 'string') : [];
    const https = raw.filter(u => /^https:\/\//.test(u)).slice(0, 6);
    const datas = https.length ? [] : raw.filter(u => /^data:image\/(?:jpeg|png|webp);base64,/.test(u)).slice(0, 3);
    const imgs = [...https, ...datas];

    const ctxText = 'Дані по цьому авто (JSON):\n' + JSON.stringify(context || {}).slice(0, 30000);
    const primer = {
      role: 'user',
      content: [
        ...imgs.map(u => ({ type: 'image_url', image_url: { url: u, detail: 'low' } })),
        { type: 'text', text: ctxText },
      ],
    };

    /* для чату важлива швидкість: reasoning мінімальний, окремо від analyze */
    const EFFORT = process.env.CHAT_REASONING_EFFORT || 'low';
    const modelBody = (withEffort = true) => {
      const b = {
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        max_completion_tokens: 2500,
        messages: [
          { role: 'system', content: SYSTEM },
          primer,
          { role: 'assistant', content: 'Прийняв, я вивчив дані і фото цього авто. Питай.' },
          ...hist,
        ],
      };
      if (withEffort && EFFORT !== 'off') b.reasoning_effort = EFFORT;
      return b;
    };

    const callModel = async (body, ms) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          signal: ctl.signal,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
          },
          body: JSON.stringify(body),
        });
        return await resp.json();
      } finally { clearTimeout(t); }
    };

    const t0 = Date.now();
    let data = await callModel(modelBody(), 50000);

    /* модель не підтримує reasoning_effort → пробуємо без нього */
    if (data?.error && /reasoning_effort|unknown|unsupported|unrecognized/i.test(String(data.error.message || ''))) {
      data = await callModel(modelBody(false), Math.max(15000, 52000 - (Date.now() - t0)));
    }

    console.log('[chat] photos', imgs.length,
      '| hist', hist.length,
      '| ai', Date.now() - t0, 'ms',
      '| tokens', JSON.stringify(data?.usage || {}));

    if (data.error) {
      return res.status(502).json({ error: 'AI: ' + (data.error.message || 'помилка запиту') });
    }
    const reply = (data.choices?.[0]?.message?.content || '').trim();
    if (!reply) {
      return res.status(502).json({ error: 'AI повернув порожню відповідь, спробуй ще раз' });
    }
    return res.status(200).json({ reply });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Відповідь не встигла за відведений час, спробуй ще раз' });
    }
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
