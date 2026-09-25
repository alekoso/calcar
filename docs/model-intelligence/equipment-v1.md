# Equipment v1: обладнання конкретного авто з каталогу MI

Статус: у продакшні з 2026-09-25. Аудит, з якого виросла реалізація:
`equipment-availability-audit.md`.

## Ланцюжок

```
VIN -> розвʼязана ідентичність (міст Check -> Vehicle Memory -> резолвер)
    -> mi.equipment_item (каталог бренду) + mi.equipment_availability (версія x ринок x рік)
    -> equipment_candidates[]
    -> Check шукає саме їх: дані VIN, поля і текст оголошення, Current Vision
    -> результат про ЦЕ авто -> наявний блок комплектації (equipment_v2)
    -> підтверджене -> Vehicle Memory (vehicle_identity_observation)
```

Інваріант: **доступність не є наявністю**. Кандидат каже лише, що опцію
можна було замовити. У звіті вона зʼявляється тільки з доказом про саме
це авто, і лише такий доказ пишеться у Vehicle Memory. Відсутність не
стверджується ніколи: «не знайшли» лишається «не підтверджено».

## Схема (міграція 027, аддитивна)

| Що | Навіщо |
|---|---|
| `mi.equipment_item.value_tier` | детермінована цінність: `standard`, `notable`, `high_value`; порожньо = не класифіковано і цілеспрямовано не шукається |
| `mi.equipment_availability.package_ids` + тригер | у яких пакетах опція доступна на ЦЬОМУ VMY; лише пакети того самого бренду. Окремої таблиці немає: склад схеми зафіксовано в 009 (52 таблиці) |
| `mi.equipment_candidates(identity)` | кандидати. Точний VMY: `scope exact`. Лише версія: кандидатні VMY з `mi.partial_candidates`, опція не на всіх з них або з вікном, яке не звірити, дає `applicability conditional`. Відомий рік поза версією, ринок чи дата поза вікном, підтверджена відсутність: кандидата немає. `not_available` не повертається ніколи |
| `mi.compile_pack` | ключ `equipment_candidates` у пакеті (рахується наживо, фрагмент і версія компілятора не змінюються) |
| `mi.vm_observations` | `equipment_present/absent` з памʼяті йдуть у слот `current` із subject предмета (`value_text = 'бренд:ключ'`) |
| `mi.resolve_identity` | ключ групування обладнання включає предмет: кілька опцій одного авто не зливаються в одну розбіжність |
| `public.mi_equipment_candidates(vin)` | вхід Check. Бренд без класифікованого обладнання відповідає `no_equipment_catalog` ДО мосту, нічого не пишучи |
| `public.mi_record_equipment(vin, rows)` | запис: лише `equipment_present`, лише предмет каталогу, лише `build_sheet` або `current_vision`, лише з коренем походження, ідемпотентно |

Обидва входи: `security definer`, `search_path` фіксований, EXECUTE лише
у `postgres` і `service_role` (як `mi_shadow_pack`).

## Калібрувальний зріз: BMW 530i xDrive G30, US MY2018

Файл `data/mi/reference/114_equipment_bmw_530i.sql`. Джерело кожного
рядка: S-G-OFF-02, BMW of North America pricing guide MY2018 (effective
1 July 2017), колонка 530i xDrive.

Пакети: ZDA Driving Assistance (1 700), ZDB Driving Assistance Plus
(1 700, вимагає ZDA), ZDH Dynamic Handling (1 950), ZLS Luxury Seating
(4 050), ZPX Executive (2 100, вимагає ZDA), ZPK Parking Assistance (700),
ZLP Lighting (1 050), ZMP M Sport (4 900).

Опції: 610 Head-up Display (1 100, також у ZDA), 688 Harman Kardon (875),
6F1 Bowers & Wilkins Diamond (4 200, вимагає ZPX), 6UK Night Vision
(2 300, вимагає ZPX), 223 Dynamic Damper Control (1 000, також у ZDH), 6FH
Rear-seat entertainment Professional (2 200, вимагає ZPX); лише в пакеті:
5AT Active Driving Assistant Plus (ZDB), 2VH Integral Active Steering
(ZDH), 453 вентиляція і 4T7 масаж передніх сидінь (ZLS), ZX3 Surround View
3D (ZPK, ZPX), 552 Icon Adaptive LED (ZLP, ZPX), 6WB Dynamic Digital
Instrument Cluster (ZPX).

Свідомо не заведено: базове оснащення, дрібні опції, Premium Package ZPP
(масовий пакет базового комфорту), позиції лише 540i (2VA, ZX5, ZX6, 5DV,
окремий 2VH), умови «ZMP або ZPP» (одним посиланням не виражаються).
Самі OEM-коди аліасами для пошуку не є.

Візуальні ознаки: `definitive` для HUD, Harman Kardon, B&W, вентиляції,
масажу, Surround View, екранів задніх пасажирів; `ambiguous` для
цифрової панелі, адаптивного круїзу і LED-фар (базові виглядають схоже);
`not_visually_resolvable` для 2VH і 223.

## Check (`api/mi-equipment.js`, `api/check.js`)

1. Після Vehicle Memory (авто вже декодоване і в памʼяті) Check запитує
   кандидатів. Значущі (`notable`, `high_value`) ідуть далі.
2. Current Vision отримує підказку лише з `definitive`-ознак, чекає її не
   довше 3 с від свого старту; повний прохід по кадрах не скорочується.
3. Основний виклик отримує блок `MI_EQUIPMENT_CANDIDATES`: що шукати у
   vehicle_data, listing_data і тексті продавця; без доказу опцію не
   згадувати ні як наявну, ні як відсутню; поза переліком шукати як завжди.
4. Знахідка Vision поза словником понять, що збігається з кандидатом
   (наприклад Night Vision), вноситься під офіційною назвою з доказом на
   кадр і проходить `sanitizeEquipment` як visual.
5. Після валідації і перевіряльника пункт, що збігається з кандидатом
   (аліас цілими словами, найдовший збіг; концепт Vision лише для
   `definitive`), отримує `mi` і, якщо має доказ про ЦЕ авто
   (`vehicle_data`, `seller_and_visual`, `visual`, `listing_data`), ще й
   `value_tier` з каталогу. Пункт лише зі слів продавця позначається, але
   цінності від каталогу не отримує. Рівень доказу каталог не змінює.
6. У Vehicle Memory ідуть лише `vehicle_data` (`build_sheet`) і фото
   (`current_vision`) з коренем `snapshot:<id>` чи `check:<token>`.
   `listing_data` не пишеться: у резолвері воно нижче порогу
   підтвердження, а непідтверджене `present` дало б хибний MATCH у
   предикатах обладнання.
7. Телеметрія: `_meta.mi_equipment` (кандидати, підказки, збіги,
   підтверджені, запис у памʼять). Вимикач: env `MI_EQUIPMENT=off`.

UI не змінювався: рамка `.eq-chip.hv` уже читає `value_tier ===
'high_value'`, тому преміальна позначка каталогу доходить до неї лише на
підтверджених пунктах. Рядка «Підтверджено преміум-опцій: N» немає:
чесного знаменника немає (Vision бачить лише частину салону, дані
оголошення неповні), а без нього число вводило б в оману.

## `model_option_catalog`

Трасування: пише лише `knowledge-seed.js` (запуск руками), читає
`knowledge-recompute.js` (derived-кеш), Check не читав ніколи; у
продакшні 0 рядків. Seed більше в неї не пише; `knowledgetest` стежить,
щоб ні seed, ні `api/` до неї не поверталися. Таблиця лишається у схемі
порожньою: видалення це destructive-міграція і рішення власника.
Канонічний каталог обладнання: MI.

## Тести

- `micatalogtest.js` 48..56: склад зрізу, пакети, вимоги, джерело,
  порядок; чужий рік, версія, ринок, бренд; умовність невідомих вимірів і
  вікна; OPTIONAL не стає INSTALLED; запис і повернення з памʼяті кількох
  предметів; підтверджена відсутність; відмова без мосту; права входів;
  тригер пакетів.
- `mipartialtest.js` 1, 1b: точні пакети не змінились, крім нового ключа;
  ключ є лише на VMY зрізу.
- `miequipmenttest.js`: тексти для моделей, зіставлення назв, AVAILABLE !=
  INSTALLED, маркер лише на підтверджених, рядки памʼяті, відкритий
  пошук, вставка з Vision, клієнт RPC на заглушці, проводка в Check.
- `miequipmenthttptest.js`: PostgREST + service_role (потребує ключа у
  змінних оточення; без них чесно пропускається).
- `knowledgetest.js`: `model_option_catalog` не пишеться і не читається.

## Обмеження v1

- Один калібрувальний VMY (530i xDrive US MY2018). Інші BMW, Tesla,
  Hyundai, Porsche без `value_tier` цілеспрямовано не шукаються.
- Пакет не виводиться зі складу: знайдені 453 і 4T7 не означають ZLS.
- Підтвердження з памʼяті (попередній Check того самого VIN) повертається
  в ідентичність і в предикати застосовності MI, але окремим пунктом у
  звіт не виводиться.
- `listing_data` підтверджує пункт у звіті, але у Vehicle Memory не
  пишеться.
