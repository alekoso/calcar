# Model Intelligence, Phase 3.1: розбір заблокованого еталонного знання

Phase 3 залила три заморожені картки і лишила 98 атомів заблокованими.
Цей прохід визначає долю кожного з них ДО побудови компілятора пакетів.

Архітектура, схема і перевірки якості Phase 2 лишаються FROZEN. Компілятор
не пишеться, схема не змінюється, перевірки якості не змінюються глобально,
Model Intelligence до Check не підключається, нового дослідження не робиться.

Дані: `data/mi/reference/140_reclassified.sql`.
Перевірка: `MI_TEST_DB_URL=... node mibackloadtest.js`.

## 1. Категорії

- **A. RECLASSIFY.** Доказів з реєстру картки вистачає, але заморожений
  тип знання або формулювання сильніші, ніж джерела дозволяють. Створено
  нового кандидата через staging; старий заблокований кандидат збережений
  для аудиту і знає, хто його замінив.
- **B. NEEDS_EVIDENCE.** Знання важливе для покупця, але наявних доказів
  не вистачає. Лишається у staging, потрапляє у список пріоритетів.
- **C. CORRECTLY_BLOCKED.** Доказів мало, важливість для покупця невисока,
  додаткове дослідження зараз не виправдане. Це не помилка системи.
- **D. TRUE_CONFLICT.** Заморожені документи логічно суперечать одне
  одному. Показано і НЕ розвʼязано самостійно.

Підсумок по 98 заблокованих атомах:

| Категорія | BMW | Tesla | Porsche | Разом |
|---|---|---|---|---|
| A | 6 | 3 | 8 | 17 |
| B | 18 | 20 | 13 | 51 |
| C | 21 | 3 | 4 | 28 |
| D | 0 | 1 | 1 | 2 |
| **Разом** | **45** | **27** | **26** | **98** |

Окремо розібрані ще 10 атомів, які у Phase 3 вважались split: одна їхня
половина опублікована, друга заблокована. З них 1 потрапив у A (T-020),
5 у B, 4 у C. Разом матриця нижче покриває 108 атомів.

## 2. Що саме перекласифіковано

18 нових кандидатів, усі опубліковані, жодного через override. Набір
джерел у кожного той самий, що був у Phase 3: нових джерел не додано.

Два правила переписування:

1. Перекласифікація не посилює клейм відносно доказів.
2. Якщо старий текст містив слова про ПОШИРЕНІСТЬ у парку, текст
   переписаний на мову ПОВТОРЮВАНОСТІ доказів: скільки незалежних звітів
   і що саме в них написано. Перекласифікація без зміни тексту у таких
   випадках недопустима, і тест це перевіряє окремо.

| Було | Стало | Скільки |
|---|---|---|
| known_issue | owner_pattern | 3 |
| known_issue | specialist_practice | 3 |
| owner_practice | owner_pattern | 7 |
| owner_pattern | specialist_practice | 1 |
| owner_pattern | official_fact (звужено) | 1 |
| official_fact | specialist_practice | 1 |
| specialist_practice | calcar_synthesis | 1 |
| calcar_synthesis (тип не змінено, долучені опори) | | 1 |

#### C-037: `known_issue` -> `owner_pattern`

Слова про поширеність у старому тексті: **most frequent**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | The electric wastegate actuator is the single most frequent engine repair reported on the 2018 and 2019 M550i, setting fault 123704 and the surrounding 1234xx and 1235xx family; the part costs about 650 dollars and a dealer charges between 1,100 and 2,000 dollars, aftermarket parts bring the fault back, and the third update shares the same category of failure. |
| Стало | Five independent owner reports on the 2018 and 2019 M550i describe replacing the electric wastegate actuator at mileages between 51,000 and 169,000 kilometres, setting fault 123704 and the surrounding 1234xx and 1235xx family. The part is quoted at about 650 dollars and a dealer at between 1,100 and 2,000 dollars, and two of the reports say aftermarket parts brought the fault back. |

#### C-066: `owner_practice` -> `owner_pattern`

| | Текст |
|---|---|
| Було | Owners and specialist workshops in hot and dusty climates wash the radiator pack once a year with the pack removed, run only 98 to 100 octane fuel, keep idling to a minimum and watch the coolant level; the same practice recurs among independent owners of the G12 and the G30. |
| Стало | Two independent owner reports from hot and dusty conditions, at 90,000 and at 160,000 kilometres, describe the same routine: washing the radiator pack once a year with the pack removed, running only 98 to 100 octane fuel, keeping idling to a minimum and watching the coolant level. A specialist blog describes the same routine. |

#### C-067: `owner_practice` -> `owner_pattern`

Слова про поширеність у старому тексті: **widespread**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | A cold thermostat, a resistor placed between the temperature sensor and the engine control unit, is widespread in the former Soviet states and is disputed by owners themselves, who call it a nail in the coffin under load. |
| Стало | Two independent owner reports from the former Soviet states, both around 90,000 kilometres, describe a cold thermostat, a resistor placed between the temperature sensor and the engine control unit, and owners in the same threads dispute it, calling it a nail in the coffin under load. |

#### C-072: `specialist_practice` -> `calcar_synthesis`

Слова про поширеність у старому тексті: **weak point**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | The 8HP75 is rated at 750 Nm, which the factory third update reaches through the same transmission, and stage two exceeds it; vendors name clutch pack E and the C and E hubs as the weak points under load, and the ATC13-1 transfer case as a weak point at high power. |
| Стало | The factory itself asks this transmission for 750 Nm only on the later engine of the same family, so a reflashed car of this model year is asking more of it than the factory ever did. The absence of observed transmission failures on standard cars does not carry over to reflashed ones, and the specific failure points named by tuning vendors are not established by any independent source. |

#### C-081: `owner_practice` -> `owner_pattern`

| | Текст |
|---|---|
| Було | Owners of this car change the transmission, transfer case and differential fluids between 80,000 and 160,000 kilometres; one owner did so at 80,000 and again at 160,000 kilometres with no trouble by 160,000. |
| Стало | Two independent owner reports describe changing the transmission, transfer case and differential fluids between 80,000 and 160,000 kilometres, one of them at 80,000 and again at 160,000 kilometres with no trouble by that point. |

#### C-093: `owner_pattern` -> `official_fact`

| | Текст |
|---|---|
| Було | The all wheel drive system is rear biased, feels confident in winter on winter tyres and is noticeably worse on all season run flats. |
| Стало | The all wheel drive system of this version is rear biased. |

#### P-023: `known_issue` -> `specialist_practice`

| | Текст |
|---|---|
| Було | When the diaphragm of the air oil separator tears, the crankcase goes under vacuum and the result is white smoke, oil consumption, a whistle, oiled plugs and damaged catalysts; the part sits under the intake, dealer estimates run to several thousand and diaphragm repair kits exist. |
| Стало | A workshop repair procedure for this engine describes the failure of the air oil separator: when the diaphragm tears the crankcase goes under intake vacuum, which produces white smoke, oil consumption, a whistle, oiled plugs and damaged catalysts. The part sits under the intake, dealer estimates run to several thousand, and diaphragm repair kits exist. |

#### P-024: `known_issue` -> `owner_pattern`

Слова про поширеність у старому тексті: **weak point**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | The high pressure fuel pump is a weak point of this V8: long cranking, hesitation, the P0087 fault and limp mode, costing a thousand to two and a half thousand dollars. |
| Стало | Two independent buyer threads for this car advise checking the high pressure fuel pump and describe long cranking, hesitation, the P0087 fault and limp mode, with the repair quoted between one thousand and two and a half thousand dollars. |

#### P-051#a: `known_issue` -> `owner_pattern`

Слова про поширеність у старому тексті: **the symptoms are**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | The symptoms are judder and snatch under acceleration at low speed, on the second to third change, a grinding feel and clicking; the cause is degradation of the friction additives. Early on, fluid and a calibration cure it, and later the replacement costs five to five and a half thousand dollars, with the actuator available separately. |
| Стало | Two independent owner reports, at 140,000 and 150,000 kilometres, describe judder and snatch under acceleration at low speed, on the second to third change, with a grinding feel and clicking. Workshop articles attribute it to degradation of the friction additives in the fluid. Fresh fluid with a calibration removed the symptom at an early stage in these reports, and a later replacement was quoted between five and five and a half thousand dollars, with the actuator available separately. |

#### P-053#a: `owner_practice` -> `owner_pattern`

| | Текст |
|---|---|
| Було | Owners say the torque vectoring rear differential likes frequent fluid changes and clatters otherwise; the capacity is one litre for the open differential and two with the lock. |
| Стало | Three independent buyer threads describe the torque vectoring rear differential as wanting frequent fluid changes and clattering otherwise, and give the capacity as one litre for the open differential and two litres with the lock. |

#### P-060#a: `known_issue` -> `specialist_practice`

Слова про поширеність у старому тексті: **typically, typical**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | Air struts on this generation leak at any corner, typically closer to 200,000 kilometres but sometimes earlier, and the compressor burns out once there is a leak; the original compressor is reported unavailable, remanufactured units are unreliable, and an aftermarket set costs about 3,800 dollars plus about eight hours. |
| Стало | An in-depth repair guide for this air suspension describes struts leaking at any corner and the compressor burning out once a leak is present; one owner report places a leak near 200,000 kilometres. The original compressor is reported unavailable, remanufactured units are described as unreliable, and an aftermarket set was quoted at about 3,800 dollars plus about eight hours of labour. |

#### P-072: `owner_practice` -> `owner_pattern`

Слова про поширеність у старому тексті: **as a matter of course**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | The air conditioning and scuttle drains block and put water into the footwells and the modules, so owners clean and shorten them as a matter of course. |
| Стало | Three independent buyer threads describe the air conditioning and scuttle drains blocking and putting water into the footwells and the modules, and describe cleaning and shortening them as one of the first jobs on the car. |

#### P-081: `calcar_synthesis` -> `calcar_synthesis`

| | Текст |
|---|---|
| Було | CalCar gives no annual running cost figure for this car, because the spread created by the optional air suspension, active anti roll system and ceramic brakes is too wide for one number to mean anything. |
| Стало | CalCar gives no annual running cost figure for this car. What drives the spread is optional hardware: the air suspension, the active anti roll system and the ceramic brakes each carry a liability that a car without them does not have, and the transfer case behind them was covered by an extended warranty that has now expired. A single annual number would describe no actual car. |

#### P-082: `owner_practice` -> `owner_pattern`

Слова про поширеність у старому тексті: **owner consensus**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | The owner consensus is that service history matters more than mileage on this car, that a pre-purchase inspection by a specialist pays for itself ten times over, and that cars without records are best avoided. |
| Стало | Three independent buyer threads for this car advise the same thing: service records matter more than the odometer, a pre-purchase inspection by a marque specialist is worth its cost, and cars without records are best avoided. |

#### T-020#a: `official_fact` -> `specialist_practice`

| | Текст |
|---|---|
| Було | The pack is built from sixteen modules of 444 cylindrical cells, 7,104 cells in total. |
| Стало | An independent teardown of this pack counted sixteen modules of 444 cylindrical cells, 7,104 cells in total. |

#### T-029: `owner_practice` -> `owner_pattern`

Слова про поширеність у старому тексті: **careful owners**. Текст переписаний обовʼязково.

| | Текст |
|---|---|
| Було | Careful owners keep the state of charge between fifty and eighty or ninety percent day to day, charge to full only before a trip, avoid leaving the car below ten to twenty percent for long, charge slowly overnight and use rapid charging only when they need it. |
| Стало | Two long term owner reports on this pack, at eight and nine years of age, describe the same charging routine: fifty to eighty or ninety percent day to day, a full charge only before a trip, not leaving the car below ten to twenty percent for long, slow overnight charging and rapid charging only when needed. |

#### T-051: `owner_pattern` -> `specialist_practice`

| | Текст |
|---|---|
| Було | The instrument cluster uses the same kind of memory and flickers or goes black, and it is not covered by the recall. |
| Стало | Independent media unit repair specialists report that the instrument cluster uses the same kind of flash memory as the media unit and flickers or goes black for the same reason, and that it is not covered by the recall. |

#### T-052: `known_issue` -> `specialist_practice`

| | Текст |
|---|---|
| Було | The yellow border around the central screen is the adhesive discolouring under ultraviolet light and heat and is cured with an ultraviolet treatment, while bubbling and delamination need a new digitizer. |
| Стало | Independent screen repair specialists describe the yellow border around the central screen as the adhesive discolouring under ultraviolet light and heat, curable with an ultraviolet treatment, while bubbling and delamination need a new digitizer. |
### Чому саме ці, і чому не більше

Перекласифікація застосована ЛИШЕ там, де наявний набір джерел механічно
задовольняє інший тип знання:

- `known_issue` -> `owner_pattern`, якщо є дві незалежні групи власників і
  дві з них несуть пробіг або вік;
- `known_issue` або `owner_pattern` -> `specialist_practice`, якщо серед
  джерел є первинний спеціаліст;
- `owner_practice` -> `owner_pattern`, якщо груп менше трьох або вони на
  одній площадці і одному ринку;
- `official_fact` -> `specialist_practice`, якщо факт насправді походить
  з розбирання або майстерні, а не з документа виробника;
- `specialist_practice` -> `calcar_synthesis`, якщо твердження є висновком
  із уже опублікованих клеймів, а власні джерела це лише вендори.

Там, де жоден інший тип не проходить механічно, перекласифікації немає:
підганяти тип під дані означало б послабити перевірку в обхід.

## 3. Матриця заблокованих атомів

Скорочення у колонці «Дія»:

- **офіційний або юридичний документ**: потрібен сам бюлетень, відкликання,
  прайс-лист або позов;
- **первинне спеціалістське джерело**: майстерня з власним описом механізму
  або ремонту, розбирання з вимірюванням;
- **другий незалежний власницький тред**: саме другий ТРЕД, а не третій
  пост у тому самому; для `owner_pattern` та сама площадка підходить;
- **3 групи на двох площадках або двох ринках**: потрібно для
  `owner_practice`, і саме цього реєстри Tesla і Porsche дати не можуть;
- **пробіг або вік у вже наявних групах**: джерел достатньо, бракує
  контексту в тих самих тредах.

### BMW M550i xDrive G30 MY2018

| Атом | Тип у Phase 3 | Чому не пройшов | Категорія | Важливість | Дія |
|---|---|---|---|---|---|
| C-005 | official_fact | офіційного джерела немає | B | 4 | чекає на доказ: офіційний або юридичний документ / первинне спеціалістське джерело |
| C-010 | official_fact | офіційного джерела немає | C | 1 | лишається заблокованим |
| C-014 | official_fact | офіційного джерела немає | B | 3 | чекає на доказ: офіційний або юридичний документ |
| C-037 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | A | 4 | перекласифіковано і опубліковано |
| C-040 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| C-041 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 2 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| C-042 | specialist_practice | немає первинного спеціаліста | C | 2 | лишається заблокованим |
| C-044 | specialist_practice | немає первинного спеціаліста | B | 2 | чекає на доказ: первинне спеціалістське джерело |
| C-045 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-046 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-047 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-048 | owner_pattern | менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-050 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-053 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| C-054 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 2 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| C-055 | specialist_practice | лише вендор або агрегатор; немає первинного спеціаліста | C | 2 | лишається заблокованим |
| C-062 | official_fact | офіційного джерела немає | B | 4 | чекає на доказ: офіційний або юридичний документ |
| C-064 | official_fact | офіційного джерела немає | B | 3 | чекає на доказ: офіційний або юридичний документ / другий незалежний власницький тред (та сама площадка підходить) |
| C-065 | official_fact | лише вендор або агрегатор; офіційного джерела немає | C | 2 | лишається заблокованим |
| C-066 | owner_practice | менше 3 груп або одна платформа і один ринок | A | 3 | перекласифіковано і опубліковано |
| C-067 | owner_practice | менше 3 груп або одна платформа і один ринок | A | 3 | перекласифіковано і опубліковано |
| C-070 | specialist_practice | лише вендор або агрегатор; немає первинного спеціаліста | C | 2 | лишається заблокованим |
| C-071 | specialist_practice | лише вендор або агрегатор; немає первинного спеціаліста | C | 2 | лишається заблокованим |
| C-072 | specialist_practice | лише вендор або агрегатор; немає первинного спеціаліста | A | 3 | перекласифіковано і опубліковано |
| C-081 | owner_practice | менше 3 груп або одна платформа і один ринок | A | 3 | перекласифіковано і опубліковано |
| C-090 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 4 | чекає на доказ: офіційний або юридичний документ |
| C-091 | specialist_practice | немає первинного спеціаліста | B | 2 | чекає на доказ: первинне спеціалістське джерело / офіційний або юридичний документ |
| C-093 | owner_pattern | менше 2 груп із пробігом або віком | A | 2 | перекласифіковано і опубліковано |
| C-100 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| C-101 | known_issue | лише вендор або агрегатор; немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | C | 2 | лишається заблокованим |
| C-102 | owner_pattern | менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: пробіг або вік у вже наявних групах |
| C-104 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-111 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 2 | чекає на доказ: пробіг або вік у вже наявних групах |
| C-112 | specialist_practice | немає первинного спеціаліста | B | 2 | чекає на доказ: первинне спеціалістське джерело / другий незалежний власницький тред (та сама площадка підходить) |
| C-113 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 2 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| C-114 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-116 | owner_pattern | менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| C-121 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| C-123 | known_issue + official_fact | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників»; офіційного джерела немає | C | 2 | лишається заблокованим |
| C-124 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-125 | owner_pattern | менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| C-126 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| C-131 | specialist_practice | немає первинного спеціаліста | C | 2 | лишається заблокованим |
| C-141 | specialist_practice | немає первинного спеціаліста | B | 3 | чекає на доказ: первинне спеціалістське джерело / другий незалежний власницький тред (та сама площадка підходить) |
| C-142 | specialist_practice | лише вендор або агрегатор; немає первинного спеціаліста | C | 2 | лишається заблокованим |
| C-143 | specialist_practice | немає первинного спеціаліста | B | 5 | чекає на доказ: первинне спеціалістське джерело / пробіг або вік у вже наявних групах |
| C-144 | owner_pattern + specialist_practice | менше 2 груп власників; менше 2 груп із пробігом або віком; немає первинного спеціаліста | C | 2 | лишається заблокованим |
| C-145 | specialist_practice | немає первинного спеціаліста | B | 3 | чекає на доказ: пробіг або вік у вже наявних групах |

### Tesla Model S P85D MY2015

| Атом | Тип у Phase 3 | Чому не пройшов | Категорія | Важливість | Дія |
|---|---|---|---|---|---|
| T-001 | official_fact | офіційного джерела немає | B | 4 | чекає на доказ: офіційний або юридичний документ |
| T-003 | official_fact + owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком; офіційного джерела немає | B | 4 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| T-011 | owner_pattern + specialist_practice | менше 2 груп власників; менше 2 груп із пробігом або віком; немає первинного спеціаліста | B | 5 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| T-012 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| T-014 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| T-020 | official_fact | офіційного джерела немає | A | 2 | перекласифіковано і опубліковано |
| T-021 | owner_pattern + specialist_practice | менше 2 груп власників; менше 2 груп із пробігом або віком; немає первинного спеціаліста | B | 5 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| T-024 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | D | 5 | рішення власника |
| T-025 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 4 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| T-026 | owner_pattern + specialist_practice | менше 2 груп власників; менше 2 груп із пробігом або віком; немає первинного спеціаліста | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| T-028 | official_fact + owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком; офіційного джерела немає | B | 5 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / офіційний або юридичний документ |
| T-029 | owner_practice | менше 3 груп або одна платформа і один ринок | A | 4 | перекласифіковано і опубліковано |
| T-030 | owner_practice + specialist_practice | менше 3 груп або одна платформа і один ринок; немає первинного спеціаліста | B | 5 | чекає на доказ: первинне спеціалістське джерело |
| T-040 | specialist_practice | лише вендор або агрегатор; немає первинного спеціаліста | C | 2 | лишається заблокованим |
| T-041 | owner_pattern + specialist_practice | лише вендор або агрегатор; менше 2 груп власників; менше 2 груп із пробігом або віком; немає первинного спеціаліста | B | 5 | чекає на доказ: первинне спеціалістське джерело / офіційний або юридичний документ |
| T-042 | official_fact + owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком; офіційного джерела немає | B | 5 | чекає на доказ: офіційний або юридичний документ |
| T-043 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 4 | чекає на доказ: офіційний або юридичний документ |
| T-044 | calcar_synthesis | немає 2 опублікованих опор двох типів | B | 4 | чекає на доказ: спершу T-041 |
| T-051 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | A | 3 | перекласифіковано і опубліковано |
| T-052 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | A | 2 | перекласифіковано і опубліковано |
| T-053 | official_fact + owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком; офіційного джерела немає | B | 3 | чекає на доказ: первинне спеціалістське джерело / другий незалежний власницький тред (та сама площадка підходить) |
| T-060 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| T-061 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 4 | чекає на доказ: офіційний або юридичний документ |
| T-062 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| T-063 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| T-064 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| T-065 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 4 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| T-066 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 3 | чекає на доказ: первинне спеціалістське джерело / другий незалежний власницький тред (та сама площадка підходить) |
| T-070 | owner_pattern | менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: пробіг або вік у вже наявних групах |
| T-073 | owner_pattern + specialist_practice | менше 2 груп із пробігом або віком; немає первинного спеціаліста | C | 2 | лишається заблокованим |

### Porsche Cayenne GTS 958.1 MY2013

| Атом | Тип у Phase 3 | Чому не пройшов | Категорія | Важливість | Дія |
|---|---|---|---|---|---|
| P-003 | specialist_practice | немає первинного спеціаліста | B | 2 | чекає на доказ: первинне спеціалістське джерело |
| P-006 | official_fact | офіційного джерела немає | B | 5 | чекає на доказ: офіційний або юридичний документ |
| P-020 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | D | 5 | рішення власника |
| P-022 | specialist_practice | немає первинного спеціаліста | B | 3 | чекає на доказ: первинне спеціалістське джерело |
| P-023 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | A | 4 | перекласифіковано і опубліковано |
| P-024 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | A | 4 | перекласифіковано і опубліковано |
| P-025 | owner_practice | менше 3 груп або одна платформа і один ринок | B | 2 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| P-027 | official_fact | офіційного джерела немає | C | 2 | лишається заблокованим |
| P-029 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| P-030 | owner_practice | менше 3 груп або одна платформа і один ринок | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) |
| P-040 | specialist_practice | немає первинного спеціаліста | B | 3 | чекає на доказ: первинне спеціалістське джерело / офіційний або юридичний документ |
| P-041 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 3 | чекає на доказ: первинне спеціалістське джерело |
| P-051 | known_issue + specialist_practice | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників»; немає первинного спеціаліста | A | 5 | перекласифіковано і опубліковано |
| P-052 | specialist_practice | немає первинного спеціаліста | B | 4 | чекає на доказ: первинне спеціалістське джерело |
| P-053 | official_fact + owner_practice | менше 3 груп або одна платформа і один ринок; офіційного джерела немає | A | 2 | перекласифіковано і опубліковано |
| P-054 | specialist_practice | немає первинного спеціаліста | B | 2 | чекає на доказ: первинне спеціалістське джерело |
| P-060 | known_issue + owner_practice | менше 3 груп або одна платформа і один ринок; немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | A | 4 | перекласифіковано і опубліковано |
| P-061 | known_issue | немає офіційного джерела і немає пари «первинний спеціаліст + 2 групи власників» | B | 4 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| P-062 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| P-063 | official_fact + specialist_practice | немає первинного спеціаліста; офіційного джерела немає | B | 4 | чекає на доказ: первинне спеціалістське джерело / офіційний або юридичний документ |
| P-064 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 2 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| P-070 | owner_pattern | менше 2 груп із пробігом або віком | B | 2 | чекає на доказ: пробіг або вік у вже наявних групах |
| P-071 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| P-072 | owner_practice | менше 3 груп або одна платформа і один ринок | A | 3 | перекласифіковано і опубліковано |
| P-073 | owner_pattern | менше 2 груп власників; менше 2 груп із пробігом або віком | C | 1 | лишається заблокованим |
| P-080 | owner_pattern | менше 2 груп із пробігом або віком | B | 3 | чекає на доказ: пробіг або вік у вже наявних групах |
| P-081 | calcar_synthesis | немає 2 опублікованих опор двох типів | A | 3 | перекласифіковано і опубліковано |
| P-082 | owner_practice | менше 3 груп або одна платформа і один ринок | A | 4 | перекласифіковано і опубліковано |
| P-083 | owner_pattern | менше 2 груп із пробігом або віком | C | 2 | лишається заблокованим |
| P-084 | official_fact + owner_pattern | менше 2 груп із пробігом або віком; офіційного джерела немає | B | 3 | чекає на доказ: офіційний або юридичний документ |

## 4. Список пріоритетних доказів (категорія B, важливість 4 і 5)

Дослідження у цьому проході НЕ проводилось. Це перелік того, що саме треба
знайти, щоб знання розблокувалось.

| Атом | Важливість | Що саме потрібно |
|---|---|---|
| C-143 | 5 | первинне спеціалістське джерело / пробіг або вік у вже наявних групах |
| P-006 | 5 | офіційний або юридичний документ |
| T-011 | 5 | другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| T-021 | 5 | другий незалежний власницький тред (та сама площадка підходить) |
| T-028 | 5 | другий незалежний власницький тред (та сама площадка підходить) / офіційний або юридичний документ |
| T-030 | 5 | первинне спеціалістське джерело |
| T-041 | 5 | первинне спеціалістське джерело / офіційний або юридичний документ |
| T-042 | 5 | офіційний або юридичний документ |
| C-005 | 4 | офіційний або юридичний документ / первинне спеціалістське джерело |
| C-062 | 4 | офіційний або юридичний документ |
| C-090 | 4 | офіційний або юридичний документ |
| P-052 | 4 | первинне спеціалістське джерело |
| P-061 | 4 | другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| P-063 | 4 | первинне спеціалістське джерело / офіційний або юридичний документ |
| T-001 | 4 | офіційний або юридичний документ |
| T-003 | 4 | другий незалежний власницький тред (та сама площадка підходить) |
| T-025 | 4 | другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
| T-043 | 4 | офіційний або юридичний документ |
| T-044 | 4 | спершу T-041 |
| T-061 | 4 | офіційний або юридичний документ |
| T-065 | 4 | другий незалежний власницький тред (та сама площадка підходить) / первинне спеціалістське джерело |
Двадцять один рядок, з них двадцять із заблокованих атомів і один (P-052)
з атома, у якого опублікована лише офіційна половина.

Що видно зі списку:

- **Tesla домінує**: тринадцять із двадцяти одного. Причина не в тому, що
  машина гірше вивчена, а в тому, що весь власницький реєстр картки це
  одна площадка. Другий ТРЕД там знайти легко, другу ПЛОЩАДКУ важко, і
  саме тому жоден `owner_practice` цієї картки пройти не може.
- **Найдорожчі прогалини Tesla** це вартість заміни приводу (T-011),
  норма ємності пака для 2015 року (T-021), ціни заміни пака (T-028),
  процедура читання здоровʼя пака (T-030), зарядка US-машини в Європі
  (T-041) і політика безкоштовної швидкої зарядки (T-042). Це рівно ті
  шість чисел, які визначають, чи варто брати конкретну машину.
- **Porsche**: найцінніший відсутній документ це офіційний список
  комплектації MY2013 US (P-006). Від нього залежить, чи була пневмопідвіска
  опцією, а від цього залежить уся застосовність P-060 і P-061.
- **BMW**: чотири прогалини, з них найважливіша це повна діагностика перед
  покупкою (C-143), яку картка позначає обовʼязковою.

## 5. Скільки лишилось заблокованим

| | Після Phase 3 | Після Phase 3.1 |
|---|---|---|
| Матеріальних атомів | 194 | 194 |
| Кандидатів | 236 | 254 |
| Опублікованих клеймів | 111 | 129 |
| Заблокованих кандидатів | 125 | 125 |
| Заблокованих атомів | 98 | 81 |

Кількість заблокованих КАНДИДАТІВ не змінилась і не мала змінитись: старі
заблоковані кандидати збережені для аудиту, а перекласифіковані додані як
нові. Зменшилась кількість заблокованих АТОМІВ: 98 -> 81.

Покриття по атомах:

| Картка | reclassified | represented | split | merged | rejected | blocked | Разом |
|---|---|---|---|---|---|---|---|
| BMW | 6 | 48 | 10 | 0 | 0 | 39 | 103 |
| Tesla | 4 | 15 | 6 | 0 | 0 | 24 | 49 |
| Porsche | 8 | 9 | 7 | 0 | 0 | 18 | 42 |
| **Разом** | **18** | **72** | **23** | **0** | **0** | **81** | **194** |

18 + 72 + 23 + 0 + 0 + 81 = 194. Сума сходиться.

Опубліковані клейми за типом знання:

| Тип знання | Після Phase 3 | Після Phase 3.1 |
|---|---|---|
| official_fact | 58 | 59 |
| owner_pattern | 15 | 25 |
| specialist_practice | 14 | 19 |
| calcar_synthesis | 12 | 14 |
| known_issue | 11 | 11 |
| owner_practice | 1 | 1 |
| **Разом** | **111** | **129** |

Помітно головне: жоден `known_issue` не додався, а `owner_pattern` виріс
на дві третини. Перекласифікація рухала знання ВНИЗ по силі твердження,
а не вгору. `owner_practice` так і лишився з одним клеймом: три групи на
двох площадках у трьох картках трапляються рівно один раз.

Повторюваність доказів у всіх 18 перекласифікованих клеймах вийшла
`anecdote`, включно з C-037, у якого пʼять незалежних груп: усі пʼять на
одній площадці і одному ринку, а `repeated_pattern` вимагає двох площадок
або двох ринків. Це правильно і показує, чому окремий сигнал повторюваності
потрібен: пʼять тредів одного форуму це не те саме, що три треди трьох.

## 6. Вісімнадцять атомів, названих official_fact без офіційного джерела

Перевірено всі вісімнадцять. Жоден не має у реєстрі картки ні документа
виробника, ні юридичного джерела.

| Атом | Що насправді стоїть у реєстрі | Категорія | Важливість |
|---|---|---|---|
| C-005 | оголошення розбирань і стаття продавця запчастин | B | 4 |
| C-010 | незалежний тест і каталог специфікацій | C | 1 |
| C-014 | стаття продавця запчастин і поисковий переказ | B | 3 |
| C-062 | каталог мастил і поисковий переказ | B | 4 |
| C-064 | власницький тред і каталог свічок | B | 3 |
| C-065 | лише поисковий переказ | C | 2 |
| C-123#b | поисковий переказ і власницький документ | C | 2 |
| P-006 | преса і вторинний гід покупця | B | 5 |
| P-027 | лише преса | C | 2 |
| P-053#b | вторинна майстерня | B | 2 |
| P-063#a | каталог запчастин | B | 4 |
| P-084#a | довідкова преса | B | 3 |
| T-001 | сторонні бази специфікацій | B | 4 |
| T-003#a | один власницький тред | B | 4 |
| T-020#a | **первинне розбирання з вимірюванням** | **A** | 2 |
| T-028#a | власницькі документи і рахунки | B | 5 |
| T-042#a | власницький тред і буєр-гід | B | 5 |
| T-053#a | вторинний спеціалістський переказ | B | 3 |

Перекласифікувати вдалось рівно один: T-020#a, де джерело є первинним
спеціалістом (розбирання з вимірюванням), тому знання законно живе як
`specialist_practice`. Решта сімнадцять не мають ЖОДНОГО типу знання, під
який їх можна підвести без послаблення перевірки: каталог, прайс-агрегатор
і поисковий переказ у замороженій моделі не встановлюють нічого.

Це системний висновок про самі картки: при їх складанні мітка
`official_fact` часто ставилась за характером твердження («це специфікація»)
замість характеру джерела («це документ виробника»). Перевірка якості
ловить саме цю підміну.

## 7. Чотири атоми, розібрані окремо

### C-037, актуатори wastegate на BMW

**Категорія A.** Це найчистіший приклад підміни повторюваності поширеністю.

Старий текст називав актуатор «the single most frequent engine repair
reported on the 2018 and 2019 M550i». Пʼять незалежних власницьких тредів
справді описують цю заміну, але жоден не дає знаменника: скільки машин
парку її НЕ потребувало, невідомо. Твердження про перше місце серед
ремонтів з таких даних не виводиться.

Окремо: `known_issue` тут недосяжний і після переписування. Офіційного
джерела саме про G30 немає, первинного спеціаліста немає. Офіційні
сервісні акції існують (C-038), але лише для G12 і лише для вужчих вікон
виробництва, і вони завантажені окремим клеймом із предикатом на G12, щоб
не перенестись на G30.

Після перекласифікації клейм живе як `owner_pattern` з пʼятьма групами,
повторюваність `anecdote` (одна площадка, один ринок), і текст описує рівно
те, що є: пʼять звітів, діапазон пробігів 51,000..169,000 км, ціни.

### P-020, задири на Porsche 4.8 V8

**Категорія D.** Пряма суперечність між двома замороженими документами.

Appendix P архітектури v1.1 стверджує:

> «P-020 (задиры 958 через пересказ Rennlist): known_issue сохраняется,
> потому что есть primary specialist (LN Engineering) плюс
> owner-корроборация ≥ 2 групп по пересказу»

Реєстр джерел картки Porsche наводить рівно ОДНЕ власницьке джерело:
S-P-OWN-01, один тред Rennlist. Двох груп у картці немає.

Тобто Appendix P описує доказову базу, якої у самій картці не існує. Це не
питання суворості правила: правило вимагає двох груп, картка дає одну, а
архітектура стверджує, що груп дві.

Варіанти, між якими має вибрати власник, і які самостійно НЕ застосовані:

1. визнати, що Appendix P помилився у підрахунку, і перекласифікувати
   клейм у `specialist_practice`: первинний спеціаліст є, і такий клейм
   пройде перевірку сьогодні без жодних змін у правилах;
2. знайти другу власницьку групу і лишити `known_issue`;
3. визнати, що для `known_issue` первинного спеціаліста з описом механізму
   достатньо, і змінити правило, що є зміною замороженої перевірки.

Важливість 5: тяжкість катастрофічна, а ендоскопія восьми циліндрів це
обовʼязкова перевірка, яка вже опублікована окремою сутністю.

### T-024, BMS_u029 на Tesla

**Категорія D.** Та сама форма суперечності.

Appendix P стверджує, що `known_issue` зберігається за схемою
«specialist + owner». Первинний спеціаліст у реєстрі є (S-T-SPEC-06),
власницька група одна (S-T-OWN-11). Правило вимагає двох.

Відмінність від P-020: тут перекласифікація у `specialist_practice` теж
пройшла б механічно, але вона змінила б зміст. Клейм каже, що це КІНЕЦЬ
ЖИТТЯ ранніх паків і що виробник їх не ремонтує, а міняє. Це твердження про
поведінку парку, а не про практику майстерні, тому перевести його у
спеціалістську практику означало б переписати те, що картка стверджує.
Саме тому дія не застосована.

Важливість 5: це єдиний відомий сценарій, у якому здоровий на вигляд пак
помирає за календарем, а не за пробігом, і один задокументований випадок
стався на 39,000 миль.

### T-010, течія приводу Tesla

**Категорія D, але клейм ОПУБЛІКОВАНИЙ.** Суперечність не в публікації, а
в класі повторюваності.

Appendix P стверджує, що цей клейм має нести `strong_consensus`, і
обґрунтовує це підтримкою спеціаліста: Tesla сама змінила конструкцію.
Правило повторюваності у міграції 010 присвоює `strong_consensus` лише
тоді, коли є пʼять або більше незалежних власницьких груп, є підтримка
первинного спеціаліста і не більше однієї суперечливої групи. Картка дає
дві власницькі групи, тому клас вийшов `anecdote`.

Клейм опублікований і працює. Розходиться лише сигнал, який побачить
компілятор: `anecdote` замість `strong_consensus`. Для головного ризику
заднього приводу цієї машини це заниження.

Варіанти для власника, самостійно НЕ застосовані:

1. лишити як є і визнати, що Appendix P описував намір, а не правило;
2. знайти три додаткові власницькі групи;
3. додати у правило шлях «конструктивна зміна виробника плюс первинний
   спеціаліст дають strong_consensus без пʼяти груп», що є зміною
   замороженої перевірки.

## 8. Пʼятий конфлікт: staging не вміє нести те, чого вимагає клейм

Знайдено під час цього проходу, і він блокує компілятор сильніше за три
попередні.

`mi.claim` має поля `buyer_implication_en` і `buyer_importance`, причому
`buyer_importance` обовʼязкове і обмежене діапазоном 1..5. Заморожена
архітектура використовує важливість як сигнал для компілятора і для
черговості у звіті.

Проте:

- у `mi.candidate_claim` НЕМАЄ колонок ні для `buyer_implication_en`, ні
  для `buyer_importance`, ні для `contested` і `contested_note_en`, ні для
  `policy_status` і `refresh_class`;
- `mi.publish_candidate` записує `buyer_implication_en = null` і
  `buyer_importance = 3` КОНСТАНТОЮ для кожного клейма.

Наслідки, які видно на реальних даних:

1. Усі 129 опублікованих клеймів мають важливість 3. Оцінки важливості,
   зроблені у цьому самому проході, зберегти нікуди.
2. Поле `buyer_implication` є у КОЖНОМУ з 194 атомів трьох карток
   («Каждый пункт это сигнал, а не гарантия», «Самый дорогой не-моторный
   ремонт», «MUST CHECK на любом пробеге») і не завантажене нікуди.
   Buyer-facing текст карток втрачено при заливці.
3. C-067 картка позначає як `owner_practice (contested)`, а суперечливий
   офіційний доказ до клейма долучений; але прапорець `contested` лишився
   `false`, бо staging не має чим його передати.

Це суперечність між замороженою схемою клейма і замороженою схемою
staging, і виправити її можна лише змінивши одне з двох, тобто зламавши
заморозку. Самостійно нічого не змінено.

## 9. Справжні конфлікти: підсумок

| Конфлікт | Що з чим | Що заблоковано |
|---|---|---|
| P-020 | Appendix P стверджує 2 групи власників, картка дає 1 | `known_issue` про задири на Porsche |
| T-024 | те саме | `known_issue` про кінець життя пака |
| T-010 | Appendix P хоче `strong_consensus`, правило вимагає 5 груп, картка дає 2 | сигнал повторюваності занижений |
| Staging | `mi.claim` вимагає важливість, `mi.candidate_claim` не має її передати | важливість і buyer-текст усіх 194 атомів |

Перші три стосуються по одному клейму кожен. Четвертий стосується всіх.

## 10. GO / NO-GO до Pack Compiler

**Рішення: NO-GO до одного рішення власника, далі GO.**

Phase 3 давала GO з умовою «компілятор має чесно показувати порожнечу».
Phase 3.1 знайшла причину переглянути це.

Що тепер готове:

- 129 опублікованих клеймів, усі шість типів знання, три картки;
- 81 заблокований атом замість 98, і кожен має категорію і названу причину;
- 51 атом категорії B має конкретний перелік того, що саме треба знайти,
  причому окремо сказано, де потрібен другий ТРЕД, де друга ПЛОЩАДКА, а де
  просто пробіг у вже наявних джерелах;
- 28 атомів категорії C свідомо лишаються заблокованими, і це не дефект;
- перекласифікація перевірена тестом: старий кандидат живий і заблокований,
  новий не може мати той самий текст, атом не змінився, override немає.

Що блокує:

**Компілятор не може ранжувати те, що збирає.** Усі 129 клеймів мають
`buyer_importance = 3`, бо staging не має чим передати інше значення, а
функція публікації пише константу. Компілятор, який складає пакет рішення,
муситиме або ігнорувати важливість зовсім, або отримувати її з якогось
іншого місця, якого ще немає. Разом із втраченим `buyer_implication` це
означає, що пакет для звіту доведеться складати з голого `text_en` без
buyer-facing шару, який картки фактично містять.

Це рішення власника, бо будь-який ремонт ламає заморозку:

1. додати колонки `buyer_importance`, `buyer_implication_en`, `contested`
   і `contested_note_en` у `mi.candidate_claim` і передавати їх у
   `mi.publish_candidate` (аддитивна зміна схеми плюс зміна функції);
2. або лишити як є і будувати компілятор без важливості, відклавши
   ранжування;
3. або перенести buyer-шар у окрему сутність поза staging.

Після цього рішення GO без застережень, з умовою Phase 3 у силі:
компілятор повинен повідомляти, що по subject є заблоковане знання, і не
видавати неповноту за відсутність проблем. Для Porsche це критично: вісім
із двадцяти шести заблокованих атомів цієї картки перекласифіковано, але
пневмопідвіска, активний стабілізатор і керамічні гальма досі стоять на
одному джерелі кожен.

## 10a. Що змінилось після Phase 3.2

Пʼятий конфлікт із розділу 8 усунуто міграцією 011: `mi.candidate_claim`
отримав `proposed_buyer_importance`, `proposed_buyer_implication_en`,
`proposed_contested` і `proposed_contested_note_en`, а
`mi.publish_candidate` більше не пише важливість константою. Подробиці:
`docs/model-intelligence/staging-buyer-metadata.md`.

Оцінки важливості з розділів 3 і 4 цього документа тепер зберігаються у
базі, а не лише тут. Доказова частина не зрушилась: 129 опублікованих
клеймів, 125 заблокованих кандидатів, 81 заблокований атом, розподіл
причин блокування збігається рядок у рядок.

## 11. Що НЕ робилось

Компілятор пакетів знань не писався. Схема не змінювалась. Перевірки
якості не змінювались і не послаблювались глобально. Model Intelligence до
Check не підключався. Нового веб-дослідження не проводилось: жодне джерело
у Phase 3.1 не додане, набір джерел кожного перекласифікованого кандидата
збігається з набором у Phase 3. До продакшн-Supabase нічого не
застосовувалось.

Перевірено на тимчасовому PostgreSQL 17.11 (Postgres.app 2.9.6-17) на
127.0.0.1:55433, знесеному після перевірки.
