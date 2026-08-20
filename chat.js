export const config = { maxDuration: 60 };

/* Один помічник на обидва продукти CalCar. Відрізняється лише предметна
   область: прорахунок пригону з аукціону США (import) чи перевірка оголошення
   на вторинному ринку (check). Уся механіка спільна. */

const DOMAIN_IMPORT = `Ти чат-помічник CalCar по конкретному авто з американського страхового аукціону (Copart/IAAI), яке користувач розглядає для пригону в Україну.

У першому повідомленні користувача передані: фото лота, дані аукціону, результат AI-розбору пошкоджень, кошторис із правками користувача, поточні підсумки і бал ризику. Це головне джерело фактів по цьому авто. Користувач може прикріплювати файли (звіт Carfax, додаткові фото, інші документи): використовуй їх як додаткове джерело фактів і звіряй із даними лота.

СИСТЕМА КООРДИНАТ (найважливіше):
- Користувач свідомо обирає серед БИТИХ авто. Пошкодження це не недолік лота, а причина низької ціни і суть цього ринку. Оцінюй лот відносно інших пошкоджених авто, а не відносно цілого авто з салону.
- Реально важкі фактори: спрацьовані подушки, деформація силової структури і лонжеронів, затоплення, пожежа, biohazard, пошкодження батареї чи високовольтної частини у гібридів та електро, "не заводиться" без зрозумілої причини.
- Типовий робочий матеріал, який НЕ є приводом відмовляти: удар у зад або перед без спрацювання подушок і без структурних деформацій, косметика, розбита оптика, навісні панелі. Задній удар без подушок у цьому ринку один з найкращих сценаріїв, а не привід для "не рекомендую".
- У context є risk_score: детермінований бал 0-10, порахований з фактів звіту. Шкала: до 3 низький ризик, 3-5 помірний, 5-7 підвищений, понад 7 високий. Твоя якісна оцінка МУСИТЬ узгоджуватися з цим балом. Суперечити балу можна лише тоді, коли ти спираєшся на конкретний факт (з фото, файла або даних лота), і тоді назви цей факт прямо.
- Питання "чи варто брати": зваж підсумок під ключ, характер пошкоджень і ризик-бал, відповідай по суті з цифрами: що за сценарій, де вигода, де ризик. Чесна оцінка, а не підтакування і не перестрахування. Рішення завжди за користувачем.`;

const DOMAIN_CHECK = `Ти чат-помічник CalCar по конкретному авто з оголошення на вторинному ринку, яке користувач розглядає до купівлі.

У першому повідомленні користувача передані: фото оголошення, фото з аукціону США до ремонту (якщо авто звідти) і повний звіт перевірки CalCar. Це головне джерело фактів по цьому авто. Користувач може прикріплювати файли (звіт діагностики, додаткові фото, документи): використовуй їх як додаткове джерело і звіряй із даними звіту.

СИСТЕМА КООРДИНАТ (найважливіше):
- Тут людина обирає серед готових авто на ринку, тому головне питання не "чи битий", а ЧИ ЧЕСНО описане авто і скільки коштуватиме помилка. Знайдена невідповідність між словами продавця і даними важить більше за сам факт ремонту.
- У звіті є verdict.score: оцінка авто від 0 до 10, де БІЛЬШЕ значить КРАЩЕ (це протилежна шкала до ризик-балу в прорахунках пригону, не переплутай). Твоя якісна оцінка мусить узгоджуватися з нею. Суперечити можна лише спираючись на конкретний факт зі звіту чи фото, і тоді назви цей факт прямо.
- Блок risks це найдорожчі статті витрат саме для цього авто. Розрізняй знайдену проблему і потенційний ризик моделі: дорогий у ремонті двигун не означає, що він несправний у цього екземпляра.
- Якщо є фото з аукціону США, вони показують реальний обсяг пошкоджень ДО ремонту: спирайся на них, коли питають про якість відновлення.
- Ціни в оголошенні це ціна готового авто в Україні. Якщо порівнюєш із прорахунком пригону, памʼятай: там сума під ключ після ремонту і розмитнення, це різні речі.
- Питання "чи варто брати": відповідай по суті, з опорою на оцінку, знайдені розбіжності і ключові ризики. Чесно, без підтакування і без перестрахування. Рішення завжди за користувачем.`;

const SYSTEM = (product, memory) => `${product === 'check' ? DOMAIN_CHECK : DOMAIN_IMPORT}
${memory ? `
ПАМʼЯТЬ ПРО КОРИСТУВАЧА (CalCar веде її між розмовами, людина може редагувати в кабінеті):
${memory}
Використовуй ці факти природно (звертайся на імʼя, враховуй бюджет і вподобання), але не цитуй нотатку дослівно і не переказуй її без потреби. Ціни і плани могли застаріти.` : ''}

ІНШІ ПРОРАХУНКИ КОРИСТУВАЧА (context.other_reports_of_this_user, якщо є):
- Це авто, які ця людина вже аналізувала: назва, дата аналізу (analyzed_at і days_ago), пошкодження, пробіг, підсумок під ключ і ризик на момент збереження (totals), хвіст переписки (chat_tail).
- Використовуй їх для порівнянь ("чи це краще за ту BMW?") і для розуміння, що людина шукає.
- ЧАС ОБОВ'ЯЗКОВИЙ: згадуючи інший звіт, називай, коли він робився ("ти дивився її 3 місяці тому"). Якщо звіту понад ~60 днів: ціни й доступність лота застарілі, скажи це прямо і порівнюй лише характеристики авто (стан, пробіг, комплектацію, ризик), а не ціни. Лот зі старого звіту майже напевно вже проданий, не пропонуй "взяти його натомість".
- ПОРІВНЯННЯ НА ЗАПИТ: якщо просять порівняти це авто з конкретним із минулих ("порівняй з тією BMW"), знайди його в списку за назвою чи лотом і порівняй структуровано по пунктах: пошкодження і проблемні прапорці, пробіг, двигун і привід, комплектація, ризик, підсумок під ключ (якщо totals є в обох). Заверши чіткою відповіддю, яке авто виглядає кращою покупкою і чому. Памʼятай: фото того авто ти не бачиш, порівнюєш за даними звіту.
- Якщо потрібного авто в списку нема (у контексті лише 12 останніх), скажи чесно, що не бачиш такого прорахунку, і попроси уточнити назву або відкрити той звіт у кабінеті.
- Якщо звітів нема в context, значить людина не залогінена або інших прорахунків не існує: не вигадуй їх.

Правила:
- Відповідай тією мовою, якою користувач поставив останнє питання: російською на російське, українською на українське, англійською на англійське. Тексти звіту можуть бути українською, російською або англійською, це не впливає на мову твоєї відповіді.
- Коротко і по суті: 1-4 речення на просте питання. Списки лише коли їх реально просять або без них незрозуміло.
- Спирайся на передані дані, фото і прикріплені файли. Не вигадуй фактів про це авто. Якщо чогось у даних немає або по фото не видно, скажи прямо і порадь, як перевірити.
- Усі ціни в доларах США, орієнтовні для ринку України. Підсумок "під ключ" вже порахований у totals, використовуй його.
- Можеш рахувати: наприклад, перерахувати підсумок з іншою ставкою (мито 10% від ставки, ПДВ 20% від ставки+мита+акцизу, акциз не змінюється).
- НІКОЛИ не використовуй символ довгого тире, пиши кому, двокрапку або крапку.
- На питання не по цьому авто чи не по темі пригону відповідай одним реченням і повертай до теми.`;


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY не налаштований у Vercel' });
  }

  try {
    const body = req.body || {};
    /* сторінка Check шле report/others окремими полями, сторінка Import
       кладе все в context: приймаємо обидві форми */
    const { messages, photos } = body;
    const product = body.product === 'check' ? 'check' : 'import';
    const memory = typeof body.memory === 'string' ? body.memory.slice(0, 2000) : null;
    let context = body.context || body.report || {};
    if (Array.isArray(body.others) && body.others.length) {
      context = Object.assign({}, context, { other_reports_of_this_user: body.others.slice(0, 12) });
    }

    const sanitizeBlocks = content => {
      let nImg = 0, nFile = 0;
      const blocks = content.map(b => {
        if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          return { type: 'text', text: b.text.slice(0, 4000) };
        }
        if (b && b.type === 'image_url' && typeof b.image_url?.url === 'string') {
          const u = b.image_url.url;
          const okUrl = /^https:\/\//.test(u) || /^data:image\/(?:jpeg|png|webp);base64,/.test(u);
          if (okUrl && u.length <= 4500000 && ++nImg <= 4) {
            return { type: 'image_url', image_url: { url: u, detail: 'high' } };
          }
        }
        if (b && b.type === 'file' && typeof b.file?.file_data === 'string') {
          const d = b.file.file_data;
          if (/^data:application\/pdf;base64,/.test(d) && d.length <= 3600000 && ++nFile <= 2) {
            return { type: 'file', file: { filename: String(b.file.filename || 'document.pdf').slice(0, 80), file_data: d } };
          }
        }
        return null;
      }).filter(Boolean);
      return blocks.length ? blocks : null;
    };
    const hist = (Array.isArray(messages) ? messages : [])
      .slice(-12)
      .map(m => {
        if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
        if (typeof m.content === 'string') {
          return m.content.trim() ? { role: m.role, content: m.content.slice(0, 4000) } : null;
        }
        if (Array.isArray(m.content)) {
          const blocks = sanitizeBlocks(m.content);
          return blocks ? { role: m.role, content: blocks } : null;
        }
        return null;
      })
      .filter(Boolean);
    if (!hist.length || hist[hist.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Порожнє питання' });
    }

    /* фото: https-посилання аукціону дешеві (detail low), data:-фото обмежуємо трьома */
    const raw = Array.isArray(photos) ? photos.filter(u => typeof u === 'string') : [];
    const https = raw.filter(u => /^https:\/\//.test(u)).slice(0, 6);
    const datas = https.length ? [] : raw.filter(u => /^data:image\/(?:jpeg|png|webp);base64,/.test(u)).slice(0, 3);
    const imgs = [...https, ...datas];

    const ctxText = 'Дані по цьому авто (JSON):\n' + JSON.stringify(context || {}).slice(0, 42000);
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
        /* CHAT_MODEL дозволяє поставити чату швидшу/дешевшу модель окремо від analyze */
        model: process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        max_completion_tokens: 2500,
        messages: [
          { role: 'system', content: SYSTEM(product, memory) },
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

    console.log('[chat]', product, '| photos', imgs.length,
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
