export const config = { maxDuration: 60 };

const PROMPT = (vin, nhtsa, damage) => `Ти — експертна система calcar, яка оцінює пошкоджені авто з американських страхових аукціонів (Copart/IAAI) для пригону в Україну.

VIN від користувача: ${vin || 'не вказано'}
Заявлений тип пошкодження з аукціону: ${damage || 'не вказано'}
Дані декодування VIN від NHTSA: ${nhtsa ? JSON.stringify(nhtsa) : 'недоступні'}

Проаналізуй фото лота. ОБОВ'ЯЗКОВИЙ порядок аналізу — спочатку пройди чек-лист зон безпеки, зона за зоною:
1. Кермо великим планом: чи ціла подушка (тканина, шви, кришка емблеми, чи звисає спрацьований мішок)
2. Колінна зона водія під кермом
3. Торпедо з боку пасажира
4. Стеля та стійки (шторки)
5. Сидіння (бокові подушки) та ремені (чи вистрелені піропатрони)
6. Підлога та салон: сліди води, мул, розводи
7. Моторний відсік: рідини, зміщення агрегатів, високовольтна проводка якщо гібрид/електро
8. Силова структура: лонжерони, телевізор, стійки — видимі деформації

ПРАВИЛА ЧЕСНОСТІ (найважливіше):
- НІКОЛИ не пиши статус "ok" для подушок/структури/затоплення, якщо це не підтверджено чітко видимим доказом на фото. Якщо зону не видно або фото нечітке — статус "unknown" з текстом "по фото не перевіряється, потрібна діагностика".
- Якщо бачиш спрацьовану подушку — статус "bad" і додай відповідні позиції в кошторис (подушка, можливо колінна, піропатрони ременів, прошивка блока SRS).
- Звіряй заявлений тип пошкодження з тим, що видно на фото, і відзначай розбіжності.
- Відзначай аномалії: пробіг непропорційний року, CHECK на панелі, сліди таксі/фліту.
- Якщо на фото є наліпка з VIN — прочитай його у "vin_detected". Якщо VIN користувача задано і він НЕ збігається зі зчитаним з фото — додай прапорець "bad": "VIN не збігається з фото".
- Моторний відсік оглядай ПРИСКІПЛИВО: шукай тріщини та розломи на видимих агрегатах — помпа, впускний колектор, кришки, розширювальні бачки, корпуси, патрубки, кронштейни. Знайдена тріщина = окрема позиція в кошторисі зі статусом "sure". Це найчастіше пропущені й найдорожчі позиції.
- Великі кузовні деталі (капот, дах, двері, крила) додавай як "sure" ЛИШЕ якщо деформація однозначно видна на фото. Якщо деталь виглядає рівною, навіть поруч із зоною удару — не додавай її взагалі або додай як "likely" з приміткою "перевірити".
- Шукай сліди ПОПЕРЕДНІХ ремонтів по всьому авто, не лише в зоні удару: різниця відтінку фарби, шагрень, нерівні зазори, свіжий герметик, сліди шпаклівки, відремонтовані бампери, нештатні деталі. Знайдене — обов'язково в "lot_notes".
- "flags": рівно 4 короткі підсумкові прапорці, кожен до 10 слів. Уся деталізація по зонах: у масиві "zones", по одному короткому реченню на зону.
- НІКОЛИ не використовуй символ довгого тире (—) у жодному тексті відповіді. Пиши кому, двокрапку або крапку.
- Про затоплення пиши ЛИШЕ якщо є реальні ознаки (розводи, мул, іржа, конденсат у фарах, вологі килими) або якщо заявлений тип пошкодження flood/water. Якщо авто має явний удар і салон сухий, взагалі не згадуй затоплення ані у flags, ані як пораду. Не заповнюй прапорці заради кількості: 3-5 прапорців про найцінніше для рішення по ЦЬОМУ лоту.
- Якщо заявлений тип пошкодження вказано: звір його з фото. Збігається: підтверди одним рядком у damage_note. НЕ збігається або на фото видно більше: прапорець bad про розбіжність.
- У "flags" ЗАБОРОНЕНО писати "не перевіряється" чи "неможливо оцінити". Для статусу unknown пиши конкретну дію та що поставлено на карту: "Структура: потрібен замір лонжеронів на стапелі", "Затоплення: перевір під килимами при огляді". Прапорець має нести цінність, а не констатувати відсутність даних.

Потім склади кошторис. Ціни — орієнтовні для ринку України в доларах США, за трьома категоріями: "orig" (нова оригінальна; якщо в продажу зазвичай відсутня — null), "alt" (нова неоригінальна, Тайвань типу TYC/Depo; для механічних/безпекових деталей може бути null), "used" (б/в оригінал з розборки). Обери рекомендовану категорію "cat" за логікою досвідченого майстра (кузовщина під фарбування — alt; оптика, капот, подушки — used; де вибору нема — що є).

Роботи (фарбування, рихтування, збірка, діагностика, калібрування радарів якщо треба, SRS якщо треба) — окремим списком з орієнтовними цінами для України. Плюс резерв на приховані пошкодження пропорційно характеру удару.

Окремо склади "maintenance": планове обслуговування за пробігом. ЖОРСТКЕ правило: лише позиції, які ТОЧНО потрібні. Це: (а) розхідники з відомим ресурсом, до якого пробіг цього авто наблизився або перевищив (масло+фільтри; свічки; помпа; ремені/ролики; гальмівні колодки лише якщо пробіг явно за їх ресурсом); (б) обов'язкове після ДТП або довгого простою. ЗАБОРОНЕНО додавати загальні "перевірки", "діагностики", "сервіси", "балансування" та інший наповнювач заради списку. Для електромобілів не вигадуй ТО двигуна внутрішнього згоряння. Якщо впевнених позицій немає, повертай порожній масив. Краще порожньо, ніж вигадано. Ціни для України, запчастина+робота разом.

Відповідай ЛИШЕ валідним JSON без markdown, без пояснень, точно за схемою:
{
 "vehicle": {"title":"Марка Модель Рік","year":2024,"fuel":"petrol|diesel|hybrid|electric","displacement_l":2.5,"engine":"2.5 л бензин, назва двигуна","transmission":"Автомат, 8 ст.","drive":"Повний AWD","trim":"XLE або null","equipment":["опція 1","опція 2"],"mileage_note":"пробіг з одометра якщо видно, милі та км"},
 "lot_notes":"розбіжності та аномалії одним-двома реченнями, або null",
 "vin_detected":"VIN з наліпки/шильдика на фото, якщо читається, інакше null",
 "flags":[{"status":"ok|warn|bad|unknown","text":"Подушки безпеки: коротко"},{"status":"...","text":"Силова структура: коротко"},{"status":"...","text":"Затоплення: коротко"},{"status":"...","text":"Приховані ризики: коротко"}],
 "zones":[{"zone":"Кермо","status":"ok|warn|bad|unknown","note":"1 коротке речення"},{"zone":"Колінна зона водія","status":"...","note":"..."},{"zone":"Торпедо пасажира","status":"...","note":"..."},{"zone":"Стеля та стійки","status":"...","note":"..."},{"zone":"Сидіння та ремені","status":"...","note":"..."},{"zone":"Підлога і салон","status":"...","note":"..."},{"zone":"Моторний відсік","status":"...","note":"..."},{"zone":"Силова структура","status":"...","note":"..."}],
 "damage_note":"2-3 речення: характер удару, що збігається/не збігається з заявленим, що неможливо оцінити по фото",
 "parts":[{"name":"Бампер передній","sub":"Під фарбування","conf":"sure|likely","cat":"orig|alt|used","prices":{"orig":null,"alt":210,"used":160}}],
 "works":[{"name":"Рихтування, фарбування, збірка","sub":"Орієнтир для України","price":850}],
 "maintenance":[{"name":"Заміна масла та фільтрів","sub":"З огляду на пробіг","price":120}],
 "reserve":400
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY не налаштований у Vercel' });
  }

  try {
    const { vin, images, damage, state, bid } = req.body || {};
    const bidNum = (Number(bid) > 0 && Number(bid) < 1000000) ? Math.round(Number(bid)) : null;
    const damageStr = (typeof damage === 'string' && damage.trim()) ? damage.trim().slice(0, 60) : null;
    const stateStr = (typeof state === 'string' && /^[A-Z]{2}$/.test(state)) ? state : null;
    const imgs = (Array.isArray(images) ? images : []).filter(
      i => typeof i === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(i)
    );
    const hasVin = typeof vin === 'string' && vin.length === 17;
    if (imgs.length === 0 && !hasVin) {
      return res.status(400).json({ error: 'Додай фото лота або повний VIN (17 символів)' });
    }
    if (imgs.length > 0 && imgs.length < 3) {
      return res.status(400).json({ error: 'Для розбору пошкоджень потрібно щонайменше 3 фото. Або залиш лише VIN — порахуємо без розбору' });
    }

    /* --- VIN decode via NHTSA (безкоштовно) --- */
    let nhtsa = null;
    if (vin && vin.length >= 11) {
      try {
        const r = await fetch(
          `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`
        );
        const j = await r.json();
        const row = j?.Results?.[0];
        if (row) {
          nhtsa = {};
          for (const k of ['Make','Model','ModelYear','Trim','Series','FuelTypePrimary','ElectrificationLevel','DisplacementL','EngineHP','TransmissionStyle','TransmissionSpeeds','DriveType','BodyClass','PlantCountry']) {
            if (row[k]) nhtsa[k] = row[k];
          }
        }
      } catch (e) { /* NHTSA недоступна — працюємо без неї */ }
    }

    /* --- лише VIN, без фото: комплектація + калькулятор, без AI --- */
    if (imgs.length === 0) {
      if (!nhtsa) {
        return res.status(400).json({ error: 'VIN не декодувався. Перевір символи або додай фото' });
      }
      const fuelRaw = ((nhtsa.FuelTypePrimary || '') + ' ' + (nhtsa.ElectrificationLevel || '')).toLowerCase();
      const fuel = /hev|hybrid/.test(fuelRaw) ? 'hybrid'
        : /electric|bev/.test(fuelRaw) ? 'electric'
        : /diesel/.test(fuelRaw) ? 'diesel' : 'petrol';
      const disp = parseFloat(nhtsa.DisplacementL) || null;
      const fuelUa = {petrol:'бензин', diesel:'дизель', hybrid:'гібрид', electric:'електро'}[fuel];
      return res.status(200).json({
        vehicle: {
          title: [nhtsa.Make, nhtsa.Model, nhtsa.ModelYear].filter(Boolean).join(' ') || 'Авто',
          year: Number(nhtsa.ModelYear) || null,
          fuel, displacement_l: disp,
          engine: [disp ? disp + ' л' : null, fuelUa, nhtsa.EngineHP ? nhtsa.EngineHP + ' к.с.' : null].filter(Boolean).join(', ') || null,
          transmission: [nhtsa.TransmissionStyle, nhtsa.TransmissionSpeeds ? nhtsa.TransmissionSpeeds + ' ст.' : null].filter(Boolean).join(', ') || null,
          drive: nhtsa.DriveType || null,
          trim: nhtsa.Trim || nhtsa.Series || null,
          equipment: [],
          mileage_note: null
        },
        lot_notes: null,
        flags: [{ status: 'unknown', text: 'Фото не додані, стан авто, подушки та пошкодження не аналізувалися' }],
        damage_note: 'Це прорахунок лише за VIN: комплектація, розмитнення і логістика. Щоб отримати розбір пошкоджень і кошторис ремонту, зроби новий прорахунок із фото лота.',
        parts: [], works: [], maintenance: [], reserve: 0,
        mode: 'vin_only',
        _meta: { vin, damage: damageStr, state: stateStr, bid: bidNum, analyzed_at: new Date().toISOString() }
      });
    }

    /* --- збираємо контент для vision --- */
    const content = [];
    for (const img of imgs.slice(0, 12)) {
      if (/^data:image\/(?:jpeg|png|webp);base64,/.test(img)) {
        content.push({ type: 'image_url', image_url: { url: img, detail: 'high' } });
      }
    }
    if (content.length < 3) {
      return res.status(400).json({ error: 'Фото не розпізнані, спробуй ще раз' });
    }
    content.push({ type: 'text', text: PROMPT(vin, nhtsa, damageStr) });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await r.json();
    if (data.error) {
      return res.status(502).json({ error: 'AI: ' + (data.error.message || 'помилка запиту') });
    }

    const text = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) {
      return res.status(502).json({ error: 'AI повернув невалідну відповідь, спробуй ще раз' });
    }

    const detected = (typeof parsed.vin_detected === 'string' && parsed.vin_detected.length === 17)
      ? parsed.vin_detected.toUpperCase() : null;
    parsed._meta = {
      vin: hasVin ? vin : detected,
      vin_source: hasVin ? 'user' : (detected ? 'photo' : null),
      damage: damageStr,
      state: stateStr,
      bid: bidNum,
      analyzed_at: new Date().toISOString(),
    };
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
