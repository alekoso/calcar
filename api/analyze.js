export const config = { maxDuration: 60 };

const PROMPT = (vin, nhtsa) => `Ти — експертна система calcar, яка оцінює пошкоджені авто з американських страхових аукціонів (Copart/IAAI) для пригону в Україну.

VIN від користувача: ${vin || 'не вказано'}
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

Потім склади кошторис. Ціни — орієнтовні для ринку України в доларах США, за трьома категоріями: "orig" (нова оригінальна; якщо в продажу зазвичай відсутня — null), "alt" (нова неоригінальна, Тайвань типу TYC/Depo; для механічних/безпекових деталей може бути null), "used" (б/в оригінал з розборки). Обери рекомендовану категорію "cat" за логікою досвідченого майстра (кузовщина під фарбування — alt; оптика, капот, подушки — used; де вибору нема — що є).

Роботи (фарбування, рихтування, збірка, діагностика, калібрування радарів якщо треба, SRS якщо треба) — окремим списком з орієнтовними цінами для України. Плюс резерв на приховані пошкодження пропорційно характеру удару.

Відповідай ЛИШЕ валідним JSON без markdown, без пояснень, точно за схемою:
{
 "vehicle": {"title":"Марка Модель Рік","year":2024,"fuel":"petrol|diesel|hybrid|electric","displacement_l":2.5,"engine":"2.5 л бензин, назва двигуна","transmission":"Автомат, 8 ст.","drive":"Повний AWD","trim":"XLE або null","equipment":["опція 1","опція 2"],"mileage_note":"пробіг з одометра якщо видно, милі та км"},
 "lot_notes":"розбіжності та аномалії одним-двома реченнями, або null",
 "flags":[{"status":"ok|warn|bad|unknown","text":"Подушки безпеки: ..."},{"status":"...","text":"Силова структура: ..."},{"status":"...","text":"Затоплення: ..."},{"status":"...","text":"..."}],
 "damage_note":"2-3 речення: характер удару, що збігається/не збігається з заявленим, що неможливо оцінити по фото",
 "parts":[{"name":"Бампер передній","sub":"Під фарбування","conf":"sure|likely","cat":"orig|alt|used","prices":{"orig":null,"alt":210,"used":160}}],
 "works":[{"name":"Рихтування, фарбування, збірка","sub":"Орієнтир для України","price":850}],
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
    const { vin, images } = req.body || {};
    if (!Array.isArray(images) || images.length < 3) {
      return res.status(400).json({ error: 'Потрібно щонайменше 3 фото' });
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

    /* --- збираємо контент для vision --- */
    const content = [];
    for (const img of images.slice(0, 12)) {
      if (/^data:image\/(?:jpeg|png|webp);base64,/.test(img)) {
        content.push({ type: 'image_url', image_url: { url: img, detail: 'high' } });
      }
    }
    if (content.length < 3) {
      return res.status(400).json({ error: 'Фото не розпізнані, спробуй ще раз' });
    }
    content.push({ type: 'text', text: PROMPT(vin, nhtsa) });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        max_tokens: 6000,
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

    parsed._meta = { vin: vin || null, analyzed_at: new Date().toISOString() };
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
