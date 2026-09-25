# MI: аудит преміального обладнання (available vs installed)

Дата: 2026-09-25. Стан репозиторію: `main` 98b99a5 (MI міграції 001..026,
картки 1..3 у продакшні). Тип: аудит архітектури і даних. Нічого не
реалізовано, міграцій немає, продакшн не чіпався.

## 1. Висновок

**GO WITH LIMITATIONS.**

Model Intelligence вже містить майже всю потрібну модель: брендову
сутність обладнання, доступність на рівні версія x ринок x рік з видами
standard / optional / in_package / not_available, вміст пакетів, аліаси,
предикати `equipment_present` і `equipment_absent`, елемент `equipment`
в ідентичності і правило якоря (021): опційне обладнання без доказу дає
CONDITIONAL, а не APPLICABLE. Правило «доступне не означає встановлене»
уже записане у контракті каталогу і захищене тестами (P-053, H-064, H-065).

Бракує трьох речей: компілятор не віддає список доступного обладнання у
пакет; Check не записує спостереження обладнання у Vehicle Memory як
`equipment_present`; у сутності обладнання немає ознаки «важливе для
покупця». Усе це додається одним аддитивним кроком без другої паралельної
підсистеми.

Обмеження: марки, де обладнання йде комплектаціями без окремих опцій
(Hyundai), лягають у модель лише через прийом «комплектація як пакет»,
бо trim не є виміром ідентичності і не читається з VIN. Ціни опцій
потребують дати прайс-листа, якої у схемі немає.

Друга паралельна архітектура вже існує на боці застосунку:
`public.model_option_catalog` (шар накопичення знань, `knowledge-seed.js`
наповнює його «з памʼяті» моделі). Рекомендація: не розвивати його,
канонічне джерело доступності це MI; `public.option_dict` лишається
словником спостережень Check і звʼязується з MI через
`equipment_item.legacy_option_id`, який уже є у схемі.

## 2. Що MI вже вміє (перевірено у коді)

| Потреба | Наявне | Де |
|---|---|---|
| Канонічна сутність обладнання на рівні бренду | `mi.equipment_item (brand_id, equipment_key unique per brand, oem_code, item_kind option/package/system_config/wheel_tire_setup, implements_variant_id, legacy_option_id)` | 003 |
| Доступність на точній ідентичності | `mi.equipment_availability (vmy_id, item_id, availability standard/optional/in_package/not_available, price, currency, sop_from/to з видами меж, requires_item_id, source_id)` | 003 |
| Вміст пакетів | `mi.package_content (package_id, item_id)`; вид package перевіряє тригер | 003, 009 |
| Обладнання як компонент | `equipment_item.implements_variant_id` (Porsche: повітряна підвіска, PDCC, PCCB реалізують варіанти компонентів) | 003, 102 |
| Аліаси і коди | `mi.subject_alias (alias_kind official/catalog/community/legal, scope brand/model_line/generation/...)`; картка Porsche тримає PDCC, PCCB, PASM як аліаси бренду і код `0C8` як catalog-аліас | 002, 102 |
| Візуальні ознаки | `mi.equipment_visual_hint (cue_key, specificity definitive/strong/ambiguous/not_visually_resolvable, combination_group, negative_note)`: таблиця є, її не читає жоден код і корпус порожній | 003 |
| Предикати застосовності | `equipment_present`, `equipment_absent` (ref на equipment_item), оцінка: немає запису у ідентичності це UNKNOWN, conflicted це UNKNOWN, є запис це MATCH або NO_MATCH | 005, 012 |
| Ідентичність | `identity.equipment = [{item, present, slot, status}]` з `mi_vm.resolved_identity_dimension`; категорія розвʼязання `current_hardware` для слота current, `factory_identity` для factory | 015, 023 |
| Якір на обладнання | Знання про опційне обладнання без доказу наявності CONDITIONAL; standard у точному VMY доводиться самим VMY | 021 |
| Область фрагмента | `vmy_scope` і `partial_scope` включають усі `equipment_availability` VMY, знання про обладнання видиме у пакеті (area `equipment`) | 012, 022 |
| Перевірки, що розвʼязують обладнання | `check_item.resolves_dimension = equipment_present / equipment_absent`, `check_covers role resolves_identity` (Tucson AWD, кнопковий запуск) | 004, 105 |
| Ознака цінності на боці Check | `equipment_v2.value_tier standard/notable/high_value`, `confidence_level vehicle_data/seller_and_visual/visual/seller/listing_data`, `factory_status confirmed/unknown` | api/check.js |
| Концепти обладнання у Vision | `EQUIPMENT_CONCEPTS` (harman_kardon, burmester, bowers_wilkins, hud, seat_ventilation, adaptive_cruise, surround_camera ...) і `applyCurrentVisualEquipmentGate` | api/current-visual.js |

Контракт каталогу (розділ 12) уже забороняє позначати опційне обладнання
як встановлене на VIN.

## 3. Чого бракує

1. **Пакет не віддає доступність.** `mi.compile_pack` повертає `pack_meta`,
   `identity_summary`, `coverage_statement`, `systems[]` (issues, claims,
   maintenance, check_items, states за областями), `entitlements`,
   `comparisons`. Рядки `equipment_availability` лише розширюють область
   і живлять якір, у вихід не потрапляють. `equipment_candidates` немає.
2. **Check не пише обладнання у Vehicle Memory як ідентичність.** Міст
   (018, 025) записує лише `model_year` і `version`. `mi.vm_record_identity`
   уміє будь-який вимір, але його для `equipment_present` ніхто не викликає.
   Тому `identity.equipment` у продакшні завжди порожній, а всі клейми про
   опційне обладнання завжди CONDITIONAL.
3. **Немає ознаки важливості на сутності.** `buyer_importance` є лише у
   клеймів. Щоб відібрати 8..12 «преміальних» кандидатів без клейму на
   кожен, потрібна ознака на `equipment_item`.
4. **Ціна без дати.** `equipment_availability.price/currency` є, рік і
   ринок дає сам VMY, але дати прайс-листа немає, а `source_id` nullable.
5. **Немає виміру комплектації (trim).** Для марок із пакетуванням по
   комплектаціях (Hyundai) доступність визначається trim, якого немає ні
   у версії, ні у VIN.
6. **Два словники опцій.** `public.option_dict` / `option_alias` (Check) і
   `mi.equipment_item` / `mi.subject_alias` (MI) не звʼязані даними, хоча
   поле `legacy_option_id` для цього передбачене.
7. **Візуальні ознаки не використовуються** і не мають джерела правди.

## 4. Рекомендована мінімальна архітектура

Підтверджую запропоновану власником трирівневу модель, і вона вже
збігається зі схемою:

```
brand-level canonical feature   = mi.equipment_item (brand_id + equipment_key)
availability / applicability    = mi.equipment_availability (per VMY, + sop window,
                                  + in_package/requires_item_id, + source)
installed on VIN                = mi_vm.resolved_identity_dimension equipment_present
                                  (з vehicle_identity_observation, категорія current_hardware)
```

Три області не змішуються: канонічна сутність нічого не каже про
доступність; доступність нічого не каже про встановлення; встановлення
береться лише з доказів про конкретний VIN.

Рішення по пунктах уточнення:

- **Коди опцій змінюються між поколіннями, ринками, роками.** У BMW коди
  SA брендові і стабільні (610, 688, 6F1, 6UK однакові для G30 і G11), у
  Tesla коди конфігуратора стабільні для функції ($APF2), але привʼязані до
  моделі для коліс ($W39B), у Hyundai кодів немає. Тому `oem_code` на
  сутності лише для стабільних брендових кодів; коди, що залежать від
  покоління чи ринку, це `mi.subject_alias` з `alias_kind = catalog` і
  `scope_kind = generation` (або `model_line`). Нової таблиці не треба,
  Porsche `0C8` уже так записаний.
- **Вміст пакетів змінюється по роках.** `package_content` без часу і VMY
  описує лише брендовий «звичайний» склад. Обовʼязкове правило: у картках
  членство описується рядками `equipment_availability` елементів з
  `availability = in_package` і `requires_item_id = пакет` на конкретному
  VMY. BMW ZDA/ZDB 2017 і 2018 різняться саме так.
- **Одна функція, різні реалізації.** Канонічна сутність одна (Bowers &
  Wilkins для BMW), технічна ревізія живе у `component_variant` через
  `implements_variant_id`, коли знання про залізо (проблеми, ремонт)
  різне для поколінь. Якщо різниться лише маркетингова назва, це аліас.
- **Різні маркетингові назви.** Одна сутність, коли функція для покупця
  та сама (Driving Assistance Plus у різних роках); різні сутності, коли
  склад функції різний (Active Driving Assistant 5AS проти Active Driving
  Assistant Plus 5AT: другий містить ACC, перший ні). Критерій: чи змінює
  назва відповідь на питання «що вміє машина».
- **Комплектація як пакет.** Для марок без окремих опцій trim заводиться
  як `equipment_item` виду `package` (Tucson Ultimate), а його зміст як
  `in_package` рядки на VMY. Наявність trim підтверджується даними
  оголошення або шильдиком, не VIN. Це обмеження, не помилка моделі.

## 5. Семантика даних

- `equipment_item.value_tier` (нова колонка, `standard | notable | high_value`,
  nullable): та сама шкала, що `equipment_v2.value_tier` у Check. У
  кандидати пакета входять лише `notable` і `high_value`. Це якісна
  ознака, не ціна, і не залежить від ринку.
- Ціна опції: лишається на `equipment_availability` (ринок і рік дає VMY),
  додається `price_as_of date` і правило «ціна лише з `source_id`».
  Ціна одного року і ринку ніколи не переноситься на інший VMY: інший рядок.
- Доступність: `standard` (у комплектації з заводу для цього VMY),
  `optional` (замовна), `in_package` (лише у складі `requires_item_id`),
  `not_available` (явно недоступна). UNKNOWN не зберігається: відсутність
  рядка означає «не досліджено», і компілятор про такий елемент мовчить.
- Вікна `sop_from / sop_to` для змін усередині модельного року (Tesla:
  Autopilot стандарт з 04/2019, Enhanced Autopilot знято 02/2019).

## 6. Правила застосовності

- Точний VMY: кандидат є, якщо існує рядок доступності цього VMY і його
  вікно не виключає відомої дати виробництва. `not_available` виключає.
- Частковий шлях (без VMY): обʼєднання рядків усіх кандидатних VMY версії,
  з позначкою «доступність залежить від року»; відомий рік поза роками
  версії уже дає `version_excluded_by_model_year` (026), кандидатів немає.
- Ідентичність каже `present = false` (доказ відсутності): кандидат
  показується як «відсутнє, підтверджено», знання про нього EXCLUDED
  (наявна поведінка `equipment_absent`).
- Ідентичність мовчить: статус кандидата `not_confirmed`, знання про
  обладнання CONDITIONAL (021). Ніколи не «встановлено».
- `standard` у точному VMY: «стандарт для цієї версії», знання APPLICABLE
  (наявна поведінка), але у розділі комплектації позначається саме як
  заводський стандарт, а не як підтверджене на фото.
- Залежності: `requires_item_id` виконує роль «потребує пакет»; кандидат
  `in_package` без доказу пакета лишається `not_confirmed`.
- Відомий несумісний мотор або привід виключає елемент лише через
  предикат клейму, не через доступність: доступність описує VMY, а привід
  на Tucson це саме обладнання (`eq:tucson_awd`).

## 7. Політика джерел

Рядки `equipment_availability` це сутності каталогу, а не клейми, тому
gate їх не перевіряє. Правило контракту (додати до розділу 4):

- рядок доступності вимагає `source_id` типу `official` або `legal`:
  прайс-гайд виробника, ordering guide, брошура, архів конфігуратора,
  технічний документ виробника;
- вторинне джерело допускається лише за відсутності офіційного і лише з
  `quality = secondary` у джерелі; тест каталогу рахує такі рядки і
  забороняє їх для `value_tier = high_value`;
- ціна лише з джерела і датою;
- перевірка тестом, як golden-тести, без обмеження у БД: наявні рядки
  Porsche (без `source_id`) дозаповнюються з реєстру джерел картки.

## 8. Інтеграція у пакет

Реальна структура пакета: `pack_meta`, `identity_summary`,
`coverage_statement`, `systems[{area, issues, claims, maintenance,
check_items, states}]`, `entitlements`, `comparisons`. Правильне місце
для кандидатів це новий верхньорівневий ключ, брат `entitlements`, а не
`systems`: обладнання не є знанням про систему і не проходить через
`tmp_pick`, бюджет і стелю умовного знання.

```
equipment_candidates: [{
  item_id, equipment_key, name_en, item_kind, value_tier,
  availability: standard | optional | in_package,
  package: {item_id, name_en} | null,
  codes: [{code, scope}],           -- oem_code і catalog-аліаси
  identity: present | absent | not_confirmed,
  identity_basis: confirmed | assumed_factory | unresolved,
  price: {amount, currency, as_of} | null,
  visual_cues: [{cue_key, specificity, description_en}],
  applies_to: exact | candidate_years[]   -- частковий шлях
}]
```

Джерело: `mi.build_fragment` кладе доступність VMY у payload фрагмента
(поруч із `claims`, `checks`, `gaps`), `mi.build_partial_payload` те
саме для обʼєднання кандидатних VMY; `mi.compile_pack` накладає
`identity.equipment` і будує список. Це змінює склад фрагмента, отже
`mi.compiler_version` піднімається і всі фрагменти перезбираються за
правилом 4.4 контракту. Decision-пакет отримує лише `high_value`;
report і chat усі `notable` і вище.

## 9. Підтвердження на конкретному VIN

Наявні рівні Check і їхнє місце в ідентичності:

| `equipment_v2.confidence_level` | Запис у Vehicle Memory | Ранг `current_hardware` (023) |
|---|---|---|
| `vehicle_data` (декод VIN, build data) | `equipment_present`, `source_kind = build_sheet` або `vin_decoder` | 55 / 10 (заводський слот: `factory_identity`, 95 / 100) |
| `seller_and_visual`, `visual` з definitive-ознакою | `equipment_present`, `source_kind = current_vision` | 80 |
| `listing_data` (структуроване поле оголошення) | `equipment_present`, `source_kind = listing`, confidence low | 30 |
| `seller` (слова продавця) | не записується | нема |

Шлях: після `sanitizeEquipment` і канонічного злиття Check зіставляє
назву з `mi.subject_alias` (scope brand) або з `option_dict` через
`legacy_option_id` і викликає `mi.vm_record_identity(..., 'equipment_present',
p_bool)` для рівнів із таблиці. Резолвер уже вміє звести кілька
спостережень за рангом і позначити конфлікт. У пакеті кандидат отримує
`present` лише з розвʼязаного виміру; UI показує три групи, наявні дві
(«Підтверджено», «Видно на фото», «Дані оголошення») і нову «Доступно
для версії, не підтверджено».

## 10. Відсутність

Відсутність доказу не є доказом відсутності. `equipment_absent` пишеться
лише з детермінованих джерел: build sheet або декод VIN виробника, який
перелічує встановлені опції (BMW), або `not_available` у каталозі для
цього VMY. Vision ніколи не пише відсутність. Кандидат без запису
лишається `not_confirmed`; клейм про нього CONDITIONAL. Це наявна
семантика (P-053, H-065), змін не потребує.

## 11. Інтеграція з Vision

`mi.equipment_visual_hint` уже описує потрібне: `definitive` (читабельний
напис або шильдик, розвʼязує сам), `strong` (лише у комбінації групи),
`ambiguous` (ніколи не розвʼязує), `negative_note` (чого ознака не
доводить). Правила:

- ознаки заводяться людиною з офіційних матеріалів або загальновідомого
  брендування (напис Burmester на решітці динаміка, кнопка вентиляції
  сидіння), не з висновків моделі; текст ознаки це не доказ, а інструкція
  пошуку;
- у пакет ознаки йдуть як `visual_cues` кандидатів, Vision отримує їх як
  цільові запитання замість відкритого «що бачиш»;
- висновок Vision стає спостереженням `equipment_present` лише для
  `definitive` ознаки з читабельним брендом або для повної `strong`-групи;
  ключі `EQUIPMENT_CONCEPTS` у `current-visual.js` зіставляються з
  `cue_key`;
- сама Vision-відповідь ніколи не пишеться у MI як знання.

## 12. Калібрувальна перевірка джерел

**BMW 530i xDrive G30 US MY2018.** Джерело: офіційний BMW of North America
Pricing Guide 5 Series Sedan (G30) MY2018 (press.bmwgroup.com, вкладення
T0266788EN_US); є і гайд MY2017. Документ дає коди SA, ціни по чотирьох
моделях (530i, 530i xDrive, 540i, 540i xDrive), склад пакетів і
залежності. Приклади для 530i xDrive: ZDA Driving Assistance $1,700 (5AS);
ZDB Driving Assistance Plus +$1,700 (5AT: ACC stop & go, lane keeping,
traffic jam assistant); 610 Head-up Display $1,100, входить у ZDA;
688 Harman Kardon $875 (потребує ZMP або ZPP); 6F1 Bowers & Wilkins
Diamond $4,200 (потребує ZPX, виключає 688); 6UK Night Vision $2,300;
ZLS Luxury Seating $4,050 (453 вентиляція, 456 multi-contour, 4T7 масаж);
ZDH Dynamic Handling $1,950 (223 DDC, 2VA Adaptive Drive, 2VH Integral
Active Steering лише у частині колонок); 2VH окремо $1,150, несумісний з
ZDH; ZPK Parking Assistance $700 (ZX3 Surround View 3D); ZPX Executive
$2,100 (552 Icon Adaptive LED, 6WB цифрові прилади, soft-close);
ZMP M Sport $4,900. Застосовність: точно до VMY US 2018 і моделі,
залежності лягають у `requires_item_id`. Прогалини: зміни цін усередині
року, гайди MY2019 і MY2020 ще не перевірені, вміст пакетів між роками
різниться і потребує рядків на кожен VMY. Оцінка: **придатно, найкращий
випадок.**

**Tesla Model 3 LR AWD US MY2019.** Джерело: архів офіційного
конфігуратора tesla.com/model3/design (Wayback, травень і серпень 2019),
JSON з кодами і цінами: $APBS Autopilot 0 (стандарт), $APF2 Full
Self-Driving $6,000, $APPB Enhanced Autopilot $5,000 (застаріле),
$W39B 19" Sport Wheels $1,500, $W38B 18" Aero 0, $IN3PB Premium Interior
0 (стандарт LR AWD через $PRM31), $IN3PW біло-чорний салон $1,000,
фарби $1,000..$2,000, $SC04 доступ до Supercharger. Значущих елементів
мало: FSD, EAP, 19" колеса, білий салон, Premium Interior як стандарт,
пізніше Acceleration Boost. Застосовність: зміни по місяцях усередині
MY2019 лягають у `sop_from/to`; половина списку це права (entitlement),
які картка 2 уже моделює. Прогалини: tesla.com віддає 403, лише Wayback;
Monroney і коди опцій конкретного VIN недоступні; ціна потребує дати.
Оцінка: **придатно з обмеженнями, низька додана вартість поверх картки 2.**

**Hyundai Tucson TL 2.4 US MY2020.** Джерело: офіційний 2020 Tucson
Product Guide Features (hyundainews.com, 12 стор.), матриця S/– по
комплектаціях SE, Value, SEL, Sport, Limited, Ultimate. Приклади:
панорамний дах лише Ultimate; вентиляція передніх сидінь лише Ultimate;
підігрів задніх сидінь Ultimate; Surround View Monitor Limited і Ultimate;
Smart Cruise Control stop & go Sport і Ultimate, але не Limited;
безконтактні двері багажника Sport, Limited, Ultimate; LED-фари Sport,
Limited, Ultimate; Infinity 315 Вт (Limited, Ultimate за документом);
HTRAC AWD опція на всіх. Окремих опцій немає. Застосовність: залежить
від trim, якого немає у VIN (vPIC дає список комплектацій, не одну) і в
ідентичності MI; потрібен прийом «комплектація як пакет» і доказ trim з
оголошення. Прогалини: матрицю треба обмежити комплектаціями з мотором
2.4 (SE і Value це 2.0), цін немає і не потрібно. Оцінка: **придатно
лише через пакет-комплектацію, найслабший випадок.**

Загальний висновок: у двох з трьох марок офіційні документи дають
повний список, коди і залежності; масштабування реальне для брендів із
прайс-гайдами (BMW, Porsche, Mercedes, Audi), середнє для конфігураторних
(Tesla), слабке для комплектаційних (Hyundai, Toyota), де кандидатом
стає сама комплектація.

## 13. Мінімальний план реалізації

Фаза E0, без міграції (тільки дані і контракт):
- контракт: правило джерела для доступності, членство пакетів на VMY,
  «комплектація як пакет», три області (канон, доступність, VIN);
- картка 1: `equipment_item` бренду BMW (10..12 елементів з гайда MY2018)
  і `equipment_availability` для VMY US 2018 з `source_id`, коди як
  `subject_alias catalog` бренду, залежності через `requires_item_id`;
  дозаповнити `source_id` рядкам Porsche;
- тести: `micatalogtest` перевіряє, що кожен рядок доступності карток має
  офіційне джерело і що знання про опційне обладнання 530i лишається
  CONDITIONAL без доказу.

Фаза E1, одна аддитивна міграція 027 і компілятор:
- `alter table mi.equipment_item add value_tier text check (...)`;
  `alter table mi.equipment_availability add price_as_of date`,
  `check (price is null or source_id is not null)` для нових рядків через
  тригер (наявні рядки Porsche без ціни);
- `mi.build_fragment`, `mi.build_partial_payload`: доступність у payload;
  `mi.compile_pack`: `equipment_candidates`; `mi.compiler_version` → pc-1.1.0;
  перезбірка всіх фрагментів (правило 4.4);
- тести: `migoldentest` (склад пакета незмінний, крім нового ключа),
  `micatalogtest` (кандидати: точний VMY, частковий шлях, AWD/FWD,
  `not_confirmed` за замовчуванням, `absent` з доказу), `mishadowwiretest`
  (форма відповіді), `mipartialtest` (частковий шлях без вигаданої
  доступності).

Фаза E2, застосунок без зміни схеми MI:
- `api/check.js`: після злиття `equipment_v2` запис `equipment_present`
  через `mi.vm_record_identity` для рівнів `vehicle_data` і `visual`
  (definitive), зіставлення назв через `mi.subject_alias`;
- `api/current-visual.js`: цільові `visual_cues` з пакета замість
  відкритого переліку;
- `result-check.html`: третя група «Доступно для версії, не
  підтверджено» (i18n у трьох мовах);
- `mi.equipment_visual_hint`: перші ознаки для елементів картки 1.

Файли і функції, яких це торкнеться: `migrations/mi/027_*`,
`mi.build_fragment` і `mi.build_partial_payload` (024),
`mi.compile_pack` (026), `mi.compiler_version` (012),
`data/mi/reference/103_entities_bmw_530i.sql`, `102_entities_porsche.sql`
(джерела), `105_entities_hyundai_tucson.sql` (пакети-комплектації),
`docs/model-intelligence/catalog-contract.md`, `micatalogtest.js`,
`migoldentest.js`, `mishadowwiretest.js`, пізніше `api/check.js`,
`api/current-visual.js`, `result-check.html`, `i18n/*`.

## 14. Ризики і відкриті питання

- Підняття версії компілятора інвалідує всі 80 фрагментів продакшну:
  публікація лише з повною перезбіркою і звіркою пакетів.
- Спостереження з тексту оголошення (`listing`, ранг 30) можуть
  «підтверджувати» обладнання, якого немає; тому `listing_data` дає лише
  низьку довіру і не переважає відсутність з build sheet.
- Аліаси загального виду (premium_audio) не мають зіставлятися з
  брендованою сутністю (Bowers & Wilkins): зіставлення лише за брендовим
  або кодовим аліасом.
- Trim як пакет: доказ комплектації слабкий (оголошення, шильдик); для
  Hyundai більшість кандидатів лишиться `not_confirmed`.
- Tesla: межа між обладнанням і правом (FSD це право, колеса це
  обладнання) має бути записана у контракті, щоб не дублювати картку 2.
- Ринки: картки поки US; коди BMW брендові, але доступність і пакети для
  EU інші, тому рядки доступності завжди на VMY ринку.
- Два словники (option_dict і subject_alias) до фази E2 живуть паралельно;
  `model_option_catalog` не наповнювати.

## 15. Рекомендація

Найменша наступна фаза: **E0** (контракт плюс обладнання картки 1 BMW з
офіційного прайс-гайда MY2018 і тест джерела), бо вона не змінює схему,
компілятор і продакшн-функції і одразу дає реальний корпус для E1.

Відповідь на головне питання: **так, можливість додається без другої
паралельної архітектури обладнання поза Model Intelligence.** Брендова
канонічна сутність, доступність на VMY і встановлення з доказів VIN уже
є трьома різними обʼєктами схеми MI; потрібні лише вивід кандидатів у
пакет, ознака цінності, дата ціни і запис спостережень Check у Vehicle
Memory. Паралельну гілку `model_option_catalog` слід зупинити.
