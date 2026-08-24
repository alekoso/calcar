export const config = { maxDuration: 300 };

const PROMPT = (vin, nhtsa, damage, lot, langDirective) => `Ти експертна система calcar, яка оцінює пошкоджені авто з американських страхових аукціонів (Copart/IAAI) для пригону в Україну.

${langDirective}
VIN від користувача: ${vin || 'не вказано'}
Заявлений тип пошкодження з аукціону: ${damage || 'не вказано'}
${lot ? `
ОФІЦІЙНІ ДАНІ ЛОТА З АУКЦІОНУ (це факти, не вигадуй інше):
${JSON.stringify({
  lot: lot.lot_number, title: lot.title, trim: lot.trim, engine: lot.engine,
  fuel: lot.fuel, displacement_l: lot.displacement_l, battery_kwh: lot.battery_kwh,
  transmission: lot.transmission, drive: lot.drive, body: lot.body,
  odometer_mi: lot.odometer_mi, odometer_status: lot.odometer_status,
  primary_damage: lot.primary_damage, secondary_damage: lot.secondary_damage,
  title_code: lot.title_code, title_group: lot.title_group,
  keys: lot.keys, run_and_drive: lot.run_and_drive, airbags: lot.airbags,
  location: lot.sale_location, est_retail_value: lot.est_retail_value,
  equipment: lot.equipment,
})}
Використовуй ці дані як основу для "vehicle" (комплектація, двигун, коробка, привід, пробіг переведи в км). Фото аналізуй окремо і звіряй із заявленим пошкодженням.
Якщо run_and_drive = false, це означає, що авто не заводилось або не рухалось на майданчику: додай це в ризики.
Якщо keys = "NO", додай позицію на виготовлення ключа.
Якщо airbags = "Deployed", це ОФІЦІЙНІ дані аукціону: статус подушок щонайменше "bad", по фото визнач, які саме спрацювали, і додай усі відповідні позиції (подушки, піропатрони, SRS).
` : ''}
Дані декодування VIN від NHTSA: ${nhtsa ? JSON.stringify(nhtsa) : 'недоступні'}

Проаналізуй фото лота. ОБОВ'ЯЗКОВИЙ порядок аналізу: спочатку пройди чек-лист зон безпеки, зона за зоною:
1. Кермо великим планом: чи ціла подушка (тканина, шви, кришка емблеми, чи звисає спрацьований мішок)
2. Колінна зона водія під кермом
3. Торпедо з боку пасажира
4. Стеля та стійки (шторки)
5. Сидіння (бокові подушки) та ремені (чи вистрелені піропатрони)
6. Підлога та салон: сліди води, мул, розводи
7. Моторний відсік: рідини, зміщення агрегатів, високовольтна проводка якщо гібрид/електро
8. Силова структура (лонжерони, телевізор, стійки): видимі деформації

ПРАВИЛА ЧЕСНОСТІ (найважливіше):
- НІКОЛИ не пиши статус "ok" для подушок/структури/затоплення, якщо це не підтверджено чітко видимим доказом на фото. Якщо зону не видно або фото нечітке, статус "unknown" з текстом "по фото не перевіряється, потрібна діагностика".
- Якщо бачиш спрацьовану подушку, статус "bad" і додай відповідні позиції в кошторис (подушка, можливо колінна, піропатрони ременів, прошивка блока SRS).
- Звіряй заявлений тип пошкодження з тим, що видно на фото, і відзначай розбіжності.
- Відзначай аномалії: пробіг непропорційний року, CHECK на панелі, сліди таксі/фліту.
- Якщо на фото є наліпка з VIN, прочитай його у "vin_detected". Якщо VIN користувача задано і він НЕ збігається зі зчитаним з фото, додай прапорець "bad": "VIN не збігається з фото".
- Моторний відсік оглядай ПРИСКІПЛИВО: шукай тріщини та розломи на видимих агрегатах: помпа, впускний колектор, кришки, розширювальні бачки, корпуси, патрубки, кронштейни. Знайдена тріщина = окрема позиція в кошторисі зі статусом "sure". Це найчастіше пропущені й найдорожчі позиції.
- Великі кузовні деталі (капот, дах, двері, крила) додавай як "sure" ЛИШЕ якщо деформація однозначно видна на фото. Якщо деталь виглядає рівною, навіть поруч із зоною удару, не додавай її взагалі або додай як "likely" з приміткою "перевірити".
- Шукай сліди ПОПЕРЕДНІХ ремонтів по всьому авто, не лише в зоні удару: різниця відтінку фарби, шагрень, нерівні зазори, свіжий герметик, сліди шпаклівки, відремонтовані бампери, нештатні деталі. Знайдене обов'язково запиши в "lot_notes".
- "flags": рівно 4 короткі підсумкові прапорці, кожен до 10 слів. Уся деталізація по зонах: у масиві "zones", по одному короткому реченню на зону.
- НІКОЛИ не використовуй символ довгого тире у жодному тексті відповіді. Пиши кому, двокрапку або крапку.
- Про затоплення пиши ЛИШЕ якщо є реальні ознаки (розводи, мул, іржа, конденсат у фарах, вологі килими) або якщо заявлений тип пошкодження flood/water. Якщо авто має явний удар і салон сухий, взагалі не згадуй затоплення ані у flags, ані як пораду. Не заповнюй прапорці заради кількості: 3-5 прапорців про найцінніше для рішення по ЦЬОМУ лоту.
- Якщо заявлений тип пошкодження вказано: звір його з фото. Збігається: підтверди одним рядком у damage_note. НЕ збігається або на фото видно більше: прапорець bad про розбіжність.
- У "flags" ЗАБОРОНЕНО писати "не перевіряється" чи "неможливо оцінити". Для статусу unknown пиши конкретну дію та що поставлено на карту: "Структура: потрібен замір лонжеронів на стапелі", "Затоплення: перевір під килимами при огляді". Прапорець має нести цінність, а не констатувати відсутність даних.

Потім склади кошторис. Ціни орієнтовні для ринку України в доларах США, за трьома категоріями: "orig" (нова оригінальна; якщо в продажу зазвичай відсутня: null), "alt" (нова неоригінальна, Тайвань типу TYC/Depo; для механічних/безпекових деталей може бути null), "used" (б/в оригінал з розборки). Обери рекомендовану категорію "cat" за логікою досвідченого майстра (кузовщина під фарбування: alt; оптика, капот, подушки: used; де вибору нема: що є).

СТАН САЛОНУ оцінюй по фото окремо від удару. Брудний салон: додай позицію хімчистки; потріскані, порвані або поламані сидіння: ремонт чи перетяжку конкретного сидіння; поламані елементи салону: заміну. Це реальні витрати покупця, вони мають бути в кошторисі.
ПОПЕРЕДЖЕННЯ АУКЦІОНУ (announcements, highlights: несправність приводу, двигуна, КПП тощо) ОБОВ'ЯЗКОВО відображаються двічі: прапорцем зі статусом warn або bad І позицією в кошторисі (мінімум діагностика вузла з ціною, плюс резерв якщо характер несправності незрозумілий). Ігнорувати попередження заборонено.
Якщо пошкоджена деталь відповідає преміум-опції з комплектації, називай її точно за опцією ("Ліва фара BMW Laserlight", а не "Фара ліва"), став ціну САМЕ ЦІЄЇ версії деталі, не базової, і додай у позицію "premium":true. Базові деталі поле premium не отримують.
Роботи (фарбування, рихтування, збірка, діагностика, калібрування радарів якщо треба, SRS якщо треба) додай окремим списком з орієнтовними цінами для України. Плюс резерв на приховані пошкодження пропорційно характеру удару.

Окремо склади "maintenance": планове обслуговування за пробігом. ЖОРСТКЕ правило: лише позиції, які ТОЧНО потрібні. Це: (а) розхідники з відомим ресурсом, до якого пробіг цього авто наблизився або перевищив (масло+фільтри; свічки; помпа; ремені/ролики; гальмівні колодки лише якщо пробіг явно за їх ресурсом); (б) обов'язкове після ДТП або довгого простою. ЗАБОРОНЕНО додавати загальні "перевірки", "діагностики", "сервіси", "балансування" та інший наповнювач заради списку. Для електромобілів не вигадуй ТО двигуна внутрішнього згоряння. Якщо впевнених позицій немає, повертай порожній масив. Краще порожньо, ніж вигадано. Ціни для України, запчастина+робота разом.

Окремо познач дорогу комплектацію:
- у "vehicle.premium_options" перелічи ті пункти з vehicle.equipment, які СУТТЄВО дорожчі за базове оснащення САМЕ ЦІЄЇ моделі: матричні або лазерні фари, радари та камери асистентів, адаптивна підвіска, панорама, high-end аудіо, високовольтна частина. Звичайні LED-фари, клімат, шкіра, камера заднього виду це НЕ преміум, якщо для цієї моделі й року вони штатні або недорогі. Якщо сумніваєшся, НЕ познач. Рядки мають ТОЧНО збігатися з рядками у vehicle.equipment. Якщо таких нема, порожній масив.
- у корені "equipment_impact": дорогі опції цього авто, ЯКІ ЗАЧЕПЛЕНІ ЦИМ УДАРОМ або змінюють вартість чи технологію саме цього ремонту (фара в зоні удару, радар у пошкодженому бампері з обов'язковим калібруванням, датчики в дзеркалі тощо). До кожної: 1 речення, що саме дорожчає і чому. БЕЗ окремої ціни: вартість деталі вже стоїть у кошторисі запчастин. Тільки реально дотичне до цього ремонту, не перелік усіх опцій. Якщо удар не зачіпає дорогу комплектацію, порожній масив.

Окремо склади "model_notes.issues": типові слабкі місця САМЕ ЦІЄЇ ВЕРСІЇ авто. Вхідні дані для відбору: марка + модель + рік + конкретний двигун + тип силової установки (бензин/дизель/гібрид/PHEV/електро) + фактичний пробіг цього авто.
Жорсткі правила відбору:
- 0-4 пункти. Краще один влучний пункт або порожній масив, ніж список загальних. Заповнювати блок заради обсягу заборонено.
- Кожен пункт мусить бути ЗАДОКУМЕНТОВАНОЮ особливістю САМЕ цієї моделі і покоління. Приклад правильного: знос роздавальної коробки на Macan цього покоління. ЗАБОРОНЕНІ загальні твердження, які пасують будь-якому авто: "на вікових автомобілях можуть підтікати помпа і патрубки", "на V6 можливі вікові течі ущільнень". Тест: якщо речення без змін можна перенести на інше авто, викинь пункт.
- Тільки проблеми, актуальні при ЦЬОМУ пробігу: якщо болячка зазвичай проявляється після 150-200 тис. км, а авто пройшло 40 тис., НЕ показуй її. І навпаки: для авто з пробігом 200+ тис. км ресурсні вузли це головна тема.
- Тільки цей двигун і ця версія: для B48 не пиши проблеми B58; для PHEV пиши про високовольтну батарею, зарядний модуль і eDrive, а не болячки чисто бензинової версії; для бензинової не пиши про батарею.
- Кожен пункт: title (назва вузла чи проблеми), unit (двигун чи система, якщо доречно), detail (1-2 речення: у чому проблема, як проявляється і чому актуально для цього пробігу), severity (high лише для дорогих або небезпечних вузлів, med відчутне, low дрібниця).
- БЕЗ цін: це довідковий блок, не кошторис.
- Якщо по цій версії нічого певного не знаєш, повертай порожній масив. Вигадувати чи писати загальні фрази ("можливий знос підвіски") заборонено.

Відповідай ЛИШЕ валідним JSON без markdown, без пояснень, точно за схемою:
{
 "vehicle": {"title":"Марка Модель Рік","year":2024,"fuel":"petrol|diesel|hybrid|electric","displacement_l":2.5,"engine":"2.5 л бензин, назва двигуна","transmission":"Автомат, 8 ст.","drive":"Повний AWD","trim":"осмислений рівень комплектації (M Sport, xLine, Premium) або null. НІКОЛИ не бери літери з назви моделі: 'i' з '540i' це НЕ trim. Якщо версія позначається однією-двома літерами, пиши разом із моделлю: 'Macan S', а не просто 'S'","equipment":["опція 1","опція 2"],"premium_options":["опція 1"],"mileage_note":"пробіг ОДНИМ рядком: число з даних лота в милях і км, без повторів. Показання з фото одометра згадуй ЛИШЕ якщо вони суттєво (понад ~5%) відрізняються від заявлених, тоді вкажи розбіжність прямо. Статус одометра згадуй лише якщо він НЕ ACTUAL: коротко, наприклад: одометр NOT ACTUAL, пробіг не підтверджений"},
 "lot_notes":"ТІЛЬКИ розбіжності та аномалії: пошкодження, яких немає в аукціонному описі; суперечності між фото і даними лота; сліди попередніх ремонтів. НЕ переказуй статуси, які вже є в даних (Run and Drive, ключі, статус одометра, тип пошкодження), вони показані в інтерфейсі окремо. Якщо розбіжностей нема, null",
 "vin_detected":"VIN з наліпки/шильдика на фото, якщо читається, інакше null",
 "flags":[{"status":"ok|warn|bad|unknown","text":"Подушки безпеки: коротко"},{"status":"...","text":"Силова структура: коротко"},{"status":"...","text":"Затоплення: коротко"},{"status":"...","text":"Приховані ризики: коротко"}],
 "zones":[{"zone":"Кермо","status":"ok|warn|bad|unknown","note":"1 коротке речення"},{"zone":"Колінна зона водія","status":"...","note":"..."},{"zone":"Торпедо пасажира","status":"...","note":"..."},{"zone":"Стеля та стійки","status":"...","note":"..."},{"zone":"Сидіння та ремені","status":"...","note":"..."},{"zone":"Підлога і салон","status":"...","note":"..."},{"zone":"Моторний відсік","status":"...","note":"..."},{"zone":"Силова структура","status":"...","note":"..."}],
 "damage_note":"2-3 речення: характер удару, що збігається/не збігається з заявленим, що неможливо оцінити по фото",
 "parts":[{"name":"Бампер передній","sub":"Під фарбування","conf":"sure|likely","cat":"orig|alt|used","premium":false,"prices":{"orig":null,"alt":210,"used":160}}],
 "works":[{"name":"Рихтування, фарбування, збірка","sub":"Орієнтир для України","price":850}],
 "maintenance":[{"name":"Заміна масла та фільтрів","sub":"З огляду на пробіг","price":120}],
 "equipment_impact":[{"feature":"Матрична фара ліва","detail":"1 коротке речення: що дорожчає і чому"}],
 "model_notes":{"issues":[{"unit":"Двигун B58","title":"PCV та клапанна кришка","detail":"1-2 речення: у чому проблема, як проявляється, чому актуально для цього пробігу","severity":"low|med|high"}]},
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
    const { vin, images, damage, state, bid, lot } = req.body || {};
    const lang = ['ua', 'ru', 'en'].includes(req.body?.lang) ? req.body.lang : 'ua';
    const LANG_NAME = { ua: 'українською', ru: 'російською', en: 'англійською (English)' };
    const langDirective = 'МОВА ВІДПОВІДІ: усі текстові значення (title, назви деталей і робіт, тексти прапорців, зони, нотатки, damage_note, mileage_note, equipment) пиши ' + LANG_NAME[lang] + '. Ключі JSON та enum-значення (fuel, status, cat, mode) залишай точно за схемою, латиницею.';
    const bidNum = (Number(bid) > 0 && Number(bid) < 1000000) ? Math.round(Number(bid)) : null;
    const damageStr = (typeof damage === 'string' && damage.trim()) ? damage.trim().slice(0, 60) : null;
    const stateStr = (typeof state === 'string' && /^[A-Z]{2}$/.test(state)) ? state : null;
    let imgs = (Array.isArray(images) ? images : []).filter(
      i => typeof i === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(i)
    );

    /* Фото лота НЕ качаємо на сервер: віддаємо моделі прямі посилання.
       Це прибирає ~14 с завантаження і ~20 МБ base64 з запиту, критично
       для ліміту функції 60 с. Резервний шлях (завантаження) нижче,
       спрацьовує лише якщо модель не змогла забрати картинки сама. */
    /* Тариф Pro: ліміт функції 300 с, тому за замовчуванням максимальна
       якість фото. PHOTO_QUALITY=med примусово увімкне середню роздільність. */
    const wantMax = process.env.PHOTO_QUALITY !== 'med';
    const pickUrl = im => (wantMax ? (im.url || im.med) : (im.med || im.url));
    const lotPhotoUrls = (lot && Array.isArray(lot.images))
      ? lot.images.slice(0, 16).map(pickUrl).filter(u => typeof u === 'string' && /^https:/.test(u))
      : [];

    async function downloadLotPhotos() {
      const PHOTO_BUDGET_MS = 45000;   /* на все завантаження */
      const PER_PHOTO_MS = 15000;      /* на одне фото */
      const MAX_PHOTOS = 12;
      const started = Date.now();

      const picked = lot.images.slice(0, MAX_PHOTOS).map(im => ({ url: pickUrl(im) }));
      if (!picked.length) return [];
      const grab = async im => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), PER_PHOTO_MS);
        try {
          const r = await fetch(im.url, { signal: ctl.signal });
          if (!r.ok) return null;
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 6_000_000) return null;
          const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
          if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
          return `data:${mime};base64,` + buf.toString('base64');
        } catch (e) { return null; }
        finally { clearTimeout(t); }
      };

      /* кожне фото має і власний таймаут, і спільний дедлайн:
         що не встигло до дедлайну, повертає null, запит іде далі */
      const withDeadline = p => Promise.race([
        p,
        new Promise(resolve => setTimeout(() => resolve(null), Math.max(0, PHOTO_BUDGET_MS - (Date.now() - started)))),
      ]);
      const results = await Promise.all(picked.map(im => withDeadline(grab(im)).catch(() => null)));

      const out = results.filter(Boolean);
      console.log('[analyze] fallback photos', out.length, 'of', picked.length, 'in', Date.now() - started, 'ms');
      return out;
    }
    const hasVin = typeof vin === 'string' && vin.length === 17;
    const photoCount = imgs.length || lotPhotoUrls.length;
    if (photoCount === 0 && !hasVin && !lot) {
      return res.status(400).json({ error: 'Додай фото лота або повний VIN (17 символів)' });
    }
    if (!lot && imgs.length > 0 && imgs.length < 3) {
      return res.status(400).json({ error: 'Для розбору пошкоджень потрібно щонайменше 3 фото. Або залиш лише VIN, порахуємо без розбору' });
    }

    /* --- VIN decode via NHTSA (безкоштовно) --- */
    let nhtsa = null;
    const vinRaw = (typeof vin === 'string' && vin.length >= 11) ? vin : (lot?.vin || '');
    const vinClean = vinRaw.replace(/[^A-HJ-NPR-Z0-9*]/gi, '').slice(0, 17);
    if (vinClean.length >= 11) {
      /* NHTSA vPIC вміє декодувати часткові VIN із зірочками */
      try {
        const r = await fetch(
          `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vinClean)}?format=json`
        );
        const j = await r.json();
        const row = j?.Results?.[0];
        if (row) {
          nhtsa = {};
          for (const k of ['Make','Model','ModelYear','Trim','Series','FuelTypePrimary','ElectrificationLevel','DisplacementL','EngineHP','TransmissionStyle','TransmissionSpeeds','DriveType','BodyClass','PlantCountry']) {
            if (row[k]) nhtsa[k] = row[k];
          }
        }
      } catch (e) { /* NHTSA недоступна, працюємо без неї */ }
    }

    /* --- лише VIN, без фото: комплектація + калькулятор, без AI --- */
    if (imgs.length === 0 && lotPhotoUrls.length === 0) {
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
        flags: [{ status: 'unknown', text: ({
          ua: 'Фото не додані, стан авто, подушки та пошкодження не аналізувалися',
          ru: 'Фото не добавлены, состояние авто, подушки и повреждения не анализировались',
          en: 'No photos were added; condition, airbags, and damage were not analyzed',
        })[lang] }],
        damage_note: ({
          ua: 'Це прорахунок лише за VIN: комплектація, розмитнення і логістика. Щоб отримати розбір пошкоджень і кошторис ремонту, зроби новий прорахунок із фото лота.',
          ru: 'Это расчет только по VIN: комплектация, растаможка и логистика. Чтобы получить разбор повреждений и смету ремонта, сделай новый расчет с фото лота.',
          en: 'This is a VIN-only estimate: equipment, customs, and logistics. To get a damage breakdown and repair estimate, run a new estimate with lot photos.',
        })[lang],
        parts: [], works: [], maintenance: [], reserve: 0,
        mode: 'vin_only',
        _meta: { vin, damage: damageStr, state: stateStr, bid: bidNum, lang, analyzed_at: new Date().toISOString() }
      });
    }

    /* --- збираємо контент для vision --- */
    const promptText = PROMPT(vin, nhtsa, damageStr || lot?.primary_damage || null, lot || null, langDirective);
    const buildContent = sources => {
      const c = [];
      for (const img of sources.slice(0, 16)) {
        if (/^data:image\/(?:jpeg|png|webp);base64,/.test(img) || /^https:\/\//.test(img)) {
          c.push({ type: 'image_url', image_url: { url: img, detail: 'high' } });
        }
      }
      if (c.length) c.push({ type: 'text', text: promptText });
      return c;
    };

    let usingUrls = imgs.length === 0 && lotPhotoUrls.length > 0;
    let content = buildContent(usingUrls ? lotPhotoUrls : imgs);

    if (content.length - 1 < 3) {
      return res.status(400).json({
        error: lot
          ? 'З аукціону вдалося отримати замало фото для розбору. Завантаж фото вручну'
          : 'Фото не розпізнані, спробуй ще раз',
      });
    }

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

    /* Тариф Pro дає час на повноцінний аналіз: глибокі роздуми за замовчуванням.
       REASONING_EFFORT у Vercel env може змінити рівень, 'off' вимикає надсилання. */
    const EFFORT = process.env.REASONING_EFFORT || 'high';
    const modelBody = (c, withEffort = true) => {
      const b = {
        model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: c }],
      };
      if (withEffort && EFFORT !== 'off') b.reasoning_effort = EFFORT;
      return b;
    };

    const t0 = Date.now();
    let data = await callModel(modelBody(content), 240000);

    /* модель не підтримує reasoning_effort → пробуємо без нього */
    if (data?.error && /reasoning_effort|unknown|unsupported|unrecognized/i.test(String(data.error.message || ''))) {
      console.log('[analyze] reasoning_effort unsupported, retrying without it');
      data = await callModel(modelBody(content, false), Math.max(60000, 250000 - (Date.now() - t0)));
    }

    /* якщо модель не змогла забрати картинки за посиланням, резервний шлях:
       качаємо фото самі і повторюємо меншим набором */
    const imgErr = data?.error && /image|url|download|fetch/i.test(String(data.error.message || ''));
    if (imgErr && usingUrls) {
      console.log('[analyze] url mode failed, falling back to download:', data.error.message);
      const downloaded = await downloadLotPhotos();
      if (downloaded.length >= 3) {
        content = buildContent(downloaded.slice(0, 5));
        usingUrls = false;
        data = await callModel(modelBody(content), Math.max(60000, 250000 - (Date.now() - t0)));
      }
    }
    console.log('[analyze] mode', usingUrls ? 'urls' : 'base64',
      '| photos', content.length - 1,
      '| effort', EFFORT,
      '| ai', Date.now() - t0, 'ms',
      '| tokens', JSON.stringify(data?.usage || {}));

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
    const lotVin = lot?.vin && !lot.vin_masked ? lot.vin : null;
    parsed._meta = {
      lang,
      vin: hasVin ? vin : (lotVin || detected || lot?.vin || null),
      vin_source: hasVin ? 'user' : (lotVin ? 'lot' : (detected ? 'photo' : (lot?.vin ? 'lot_masked' : null))),
      damage: damageStr || lot?.primary_damage || null,
      state: stateStr || lot?.location_state || null,
      bid: bidNum || lot?.current_bid || null,
      lot_number: lot?.lot_number || null,
      lot_url: lot?.lot_url || null,
      title_code: lot?.title_code || null,
      keys: lot?.keys || null,
      run_and_drive: lot?.run_and_drive ?? null,
      sale_date: lot?.sale_date || null,
      sale_status: lot?.sale_status || null,
      airbags: lot?.airbags || null,
      est_retail_value: lot?.est_retail_value || null,
      battery_kwh: lot?.battery_kwh || null,
      photos: (lot?.images || []).slice(0, 12).map(i => i.url),
      analyzed_at: new Date().toISOString(),
    };
    return res.status(200).json(parsed);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Аналіз не встиг завершитись. Спробуй ще раз, зазвичай з другої спроби швидше' });
    }
    return res.status(500).json({ error: 'Внутрішня помилка: ' + e.message });
  }
}
