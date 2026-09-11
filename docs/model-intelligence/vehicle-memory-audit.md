# Phase 6: аудит Vehicle Memory під вимоги резолвера ідентичності

Аудит, не переробка. Схема не змінювалась, міграцій немає, продакшн не
чіпався. Висновки зроблені з КОДУ і SQL у репозиторії, а не зі старих
проєктних документів.

Питання аудиту вузьке: чи може наявна Vehicle Memory стати довготривалою
памʼяттю по VIN, з якої резолвер Phase 5 зможе брати факти і відповідати
на «що CalCar знав про VIN X на момент T» і «що змінилось між T1 і T2».

## A. Мапа того, що є

### Таблиці

| Таблиця | Ключ | Що зберігає | Де оголошена |
|---|---|---|---|
| `vehicles` | `vin` PK, `id` uuid unique | канонічна машина: марка, модель, рік, покоління, декод NHTSA, `decoder_version` | `supabase-vehicle-intelligence.sql` |
| `listings` | `(source, source_listing_id)` unique | епізод оголошення на площадці | `supabase-vehicle-memory-v1.sql` |
| `vehicle_snapshots` | `id`, індекси по `(vin, captured_at)`, `(listing_id, captured_at)` | незмінний стан оголошення: ціна, пробіг, повний текст продавця, `raw_page_text`, кадри, поля площадки, статус, `listing_fingerprint` | **ніде не створюється, лише ALTER** |
| `photo_assets` | `content_hash` unique | один бінарник на SHA-256, `storage_status` | `supabase-vehicle-memory-v1.sql` |
| `snapshot_photos` | `(snapshot_id, kind, position)` unique | кадр у знімку: позиція, URL на момент спостереження, `photo_identity` | `supabase-vehicle-memory-v1.sql` |
| `auction_events` | `(auction_house, lot_id)` | подія аукціону: дата продажу, одометр, ушкодження, титул, кадри | **ніде не створюється** |
| `auction_checks` | `vin` PK | TTL-кеш «не знайдено» | `supabase-auction-cache.sql` |
| `historical_visual_cache` | `(vin, fingerprint, hv_version)` | канонічне читання історичних кадрів, `consensus`, `conflict_detected` | `supabase-jobs.sql` |
| `equipment_observation` (+`_evidence`) | `(vin, snapshot_id, option_id)` | комплектація конкретного VIN зі станом і прапорцем `retrofit` | `supabase-knowledge.sql` |
| `issue_observation` (+`_evidence`) | `(vin, snapshot_id, event_key)` | знахідки по конкретній машині: коди, сервісні записи, документи | `supabase-knowledge.sql` |
| `observation_coverage` | | чесний знаменник покриття | `supabase-knowledge.sql` |
| `mi_vm.component_state_instance` | `id`, індекс по `vin` | стан компонента конкретної машини | `migrations/mi/007` |
| `mi_vm.entitlement_state` | `(vin, entitlement_id, checked_at)` | стан права у часі | `migrations/mi/007` |
| `mi_vm.measurement` | `id`, індекс `(vin, method_code, measured_at)` | вимірювання з методом і терміном придатності | `migrations/mi/007` |

### Код, що пише памʼять

- `api/vehicle-memory.js`: `upsertVehicle`, `resolveListing`,
  `attachVehicleToListing`, `observeListing`, `patchSnapshotClaims`,
  `preservePhotos`.
- `api/check.js`: оркестрація, `writeAuctionEvent`, `writeAuctionCache`,
  `writeKnowledge`.

### Дві знахідки вже на рівні мапи

1. **`vehicle_snapshots` і `auction_events` не мають DDL у репозиторії.**
   Обидві лише ALTER-яться або пишуться через REST. Базова структура двох
   центральних таблиць памʼяті живе тільки у продакшн-Supabase.
2. **Три таблиці, створені саме для цього, не використовуються.**
   `mi_vm.component_state_instance`, `mi_vm.entitlement_state` і
   `mi_vm.measurement` існують із міграції 007 і ключовані по VIN.
   Продакшн не пише у них НІЧОГО.

## B. Інваріанти

| Інваріант | Вердикт | Підстава |
|---|---|---|
| A. один VIN це одна машина | **PASS** | `vehicles.vin` це PK, `upsertVehicle` йде через `on_conflict=vin`; друге оголошення того самого VIN дає новий Listing, не новий Vehicle |
| B. оголошення це не машина | **PASS** | окрема таблиця, багато оголошень на один `vehicle_id`, оголошення живе без VIN і привʼязується пізніше через `attachVehicleToListing` |
| C. історія тільки дописується | **PARTIAL** | знімки дописуються і їхній ЗМІСТ не переписується; але `vehicles` оновлюється на місці, `listings.current_status` перезаписується, а `last_seen_at` і `seen_count` самого знімка мутуються після вставки |
| D. час події це не час запису | **PARTIAL** | `auction_events` має і `sale_date`, і `checked_at`; у знімків є тільки час запису: `snapshotRow` ставить `first_seen_at = now()`, дати публікації оголошення немає ніде |
| E. походження | **PARTIAL** | джерело є скрізь (`source`, `source_url`, `photo_assets.provenance`, `auction_events.source_urls`); кореня походження немає, тому переписане з аукціону оголошення не відрізняється від незалежного спостереження |

## C. Матриця контракту з резолвером

Для кожного виміру, який резолвер Phase 5 вміє приймати.

| Вимір | Де зберігається | Поточне | Історія | Походження | Завод/поточне | Конфлікт |
|---|---|---|---|---|---|---|
| VIN | `vehicles.vin` | так | не потрібна | не потрібне | не потрібне | не потрібен |
| бренд, модель, версія | `vehicles.make/model/trim`, `vehicle_snapshots.make/model` | так | лише у знімках; рядок `vehicles` перезаписується | частково (`decoder_version`) | не потрібне | **ні** |
| модельний рік | `vehicles.year/model_year`, `vehicle_snapshots.year` | так | у знімках | частково | не потрібне | **ні** |
| дата виробництва | **ніде** | **ні** | **ні** | **ні** | не потрібне | **ні** |
| ринок продажу | **ніде** | **ні** | **ні** | **ні** | не потрібне | **ні** |
| ринок експлуатації | `vehicle_snapshots.country`, `location` | так | так | так | не потрібне | ні |
| пробіг | `vehicle_snapshots.odometer_km`, `auction_events.odometer_value/unit/status` | так | **так** | так | не потрібне | ні, розбіжність видно, але не позначена |
| варіанти компонентів | **ніде** | **ні** | **ні** | **ні** | **ні** | **ні** |
| заміна компонента | `mi_vm.component_state_instance` існує і **порожня** | ні | ні | так за конструкцією | так за конструкцією | ні |
| обладнання | `equipment_observation` (+ evidence), `listing_fields.listing_equipment` | так | **так**, по знімках | **так** | частково: є `retrofit` і `factory_market`, слотів немає | ні |
| права | `mi_vm.entitlement_state` існує і **порожня** | ні | так за конструкцією | частково | не потрібне | ні |
| стан компонента | `mi_vm.component_state_instance` порожня | ні | ні | так | так | ні |
| діагностика | `issue_observation` (dtc, сервіс, огляд), `mi_vm.measurement` порожня | так | так | так | не потрібне | ні |
| факти Vision | `historical_visual_cache`; поточний Vision лише всередині `reports.data` | так | так для історичного | частково | не потрібне | **так** (`conflict_detected`, `consensus`) |

Підсумок матриці: зі шістнадцяти вимірів резолвера повністю покриті
шість, частково пʼять, і пʼять не покриті зовсім.

## D. Відновлення стану на момент часу

Перевірено на реальній семантиці таблиць по сценарію T1..T5.

| Що відновлюється | Вердикт | Чому |
|---|---|---|
| T1 перше оголошення, кадри, пробіг, ціна | **PASS** | `where captured_at <= T order by captured_at desc limit 1` по `listing_id` |
| T2 зміна ціни і опису | **PASS** | інший `listing_fingerprint` дає новий рядок, старий лишається |
| T3 знайдено аукціонну подію | **PARTIAL** | подія має `sale_date` і `checked_at`, але повторний запис того самого лота перезаписує попередні значення |
| T4 заміна компонента | **FAIL** | зберігати нема де |
| T5 нове оголошення на іншій площадці | **PASS** | новий Listing того самого `vehicle_id` |

Читання майбутніх даних потрібне в одному місці: `last_seen_at` і
`seen_count` знімка ЗАПИСУЮТЬСЯ пізніше, тому рядок, прочитаний станом на
T, несе значення з майбутнього. Зміст знімка при цьому чистий. Атрибути
`vehicles` відновити на момент T неможливо взагалі: вони перезаписані.

## E. Час події проти часу знання

- **Час знання** є всюди: `captured_at` у знімків, `checked_at` у
  аукціонних подій, `created_at` у решти. Питання «що CalCar знав на T»
  для оголошень відповідається.
- **Час події** є лише у аукціону (`sale_date`). У оголошень
  `first_seen_at` це момент нашого запису, а не дата публікації.

Наслідок для названого сценарію: аукціон 2021 року, знайдений у 2026,
представимий правильно, бо `sale_date = 2021` і `checked_at = 2026`
живуть окремо. Старе оголошення, знайдене сьогодні, виглядатиме як таке,
що зʼявилось сьогодні.

## F. Історія заводського і поточного компонента

**FAIL.** Варіантів компонентів памʼять не зберігає взагалі: ні
заводських, ні поточних. Найближче, що є, це `equipment_observation` з
булевим `retrofit`, і це про обладнання, а не про роль компонента.

Найважливіше: таблиця під це вже існує.
`mi_vm.component_state_instance` має `vin`, `state_type_id`, `role_code`,
`occurred_on`, `mileage_km`, `performer_kind`, `documents`,
`measurements`, `confidence`, `source_kind`, `snapshot_id`. Заводський
варіант при цьому бере на себе Model Intelligence через
`mi.version_fitment`, а результат заміни дає
`mi.component_state_type.resulting_variant_id`. Саме так Phase 5
розвʼязала медіаблок Tesla у тесті.

Тобто задокументована ПОДІЯ заміни виражається без жодної зміни схеми,
щойно продакшн почне писати цю таблицю. Не виражається інше: просте
спостереження поточного варіанта без події (Vision побачив MCU2, запису
про ретрофіт немає).

## G. Хронологія оголошень, цін, пробігу і кадрів

| Ланцюг | Вердикт |
|---|---|
| VIN -> оголошення -> знімок -> ціна і валюта | **PASS** |
| VIN -> знімки -> пробіг у часі | **PASS**, і окремо `auction_events.odometer_value` з `odometer_status` |
| зміна тексту продавця | **PASS**, `seller_text` і `raw_page_text` у кожному знімку |
| кадри: один бінарник на hash, звʼязок зі знімком, порядок | **PASS**, `photo_assets` + `snapshot_photos.position`; зниклий кадр лишає `unavailable` з URL і позицією |
| кадр, видалений продавцем пізніше | **PASS**, лишається у своєму знімку |

Perceptual-дедуп свідомо відсутній, і код це прямо пояснює: змінена
версія кадру сама є частиною історії. Це правильне рішення, міняти не
треба.

## H. Походження

Джерело видно скрізь. Немає одного: **кореня походження**. Резолвер
Phase 5 дедуплікує докази саме по `provenance_root`, і у фікстурі Tesla
ознака salvage приходить з аукціону і з переписаного оголошення як ОДИН
доказ. Памʼять зараз такого поля не має, тому резолвер, під'єднаний до
реальних даних, порахує це двома незалежними доказами.

## I. Ризики втрати даних

| Ризик | Де | Наслідок |
|---|---|---|
| перезапис атрибутів машини | `upsertVehicle` зливає непорожні поля у місці | історії декодованої ідентичності немає, розбіжність двох декодерів не видно |
| перезапис події аукціону | `on_conflict=auction_house,lot_id` з `merge-duplicates` | повторний розбір того самого лота затирає попередні дату, одометр і ушкодження |
| мутація знімка після вставки | `last_seen_at`, `seen_count`, `seller_claims.ai_discrepancies` | рядок не повністю незмінний; повторний AI-розбір затирає попередню інтерпретацію |
| перезапис статусу оголошення | `listings.current_status` | історії статусу немає |
| відсутність виправлення без видалення | ніде немає `invalidated_at` чи супересесії | помилкове спостереження можна лише лишити або видалити назавжди |
| DDL поза репозиторієм | `vehicle_snapshots`, `auction_events` | структура двох центральних таблиць не відтворюється з коду |

## J. Структурні прогалини за рангом

**BLOCKER**

1. **Варіантів компонентів немає ніде.** Резолверу потрібні заводський і
   поточний варіант на роль. Для Tesla це пак, приводи, медіаблок, модем,
   зарядник і залізо асистентів, тобто саме те, що визначає вартість.
2. **Прав немає ніде.** `mi_vm.entitlement_state` порожня. Право на
   швидку зарядку і програмні опції не зберігаються.
3. **Дати виробництва і ринку продажу немає ніде.** Обидва прямо потрібні
   резолверу: дата виробництва розвʼязує ревізійні межі, ринок продажу
   обмежує офіційні продовження гарантії.

**HIGH**

4. **Атрибути `vehicles` перезаписуються.** Немає ні історії, ні конфлікту.
5. **Часу події для оголошень немає.** Старе оголошення виглядає новим.
6. **Кореня походження немає.** Дедуплікація резолвера не має на що спертись.
7. **Механізму виправлення без видалення немає.**

**MEDIUM**

8. DDL `vehicle_snapshots` і `auction_events` поза репозиторієм.
9. Повторна поява того самого лота перезаписує подію.
10. Знімок мутується після вставки.

**LOW**

11. Немає явної позначки поточної резолюції серед версій одного VIN.
12. `observation_coverage` не покриває нові виміри резолвера.

## K. Мінімальні поправки

Показано найменшу можливу зміну, а не переробку.

### VM-1. Почати писати три вже наявні таблиці. Зміни схеми НЕМАЄ.

Закриває BLOCKER 2 повністю, BLOCKER 1 частково і всю діагностику.

| Таблиця | Хто має писати | Що саме |
|---|---|---|
| `mi_vm.entitlement_state` | Check після перевірки акаунта або документів | `(vin, entitlement_id, state, checked_at, source_kind, note)` |
| `mi_vm.component_state_instance` | Check при знайденому документі про заміну або ретрофіт | `(vin, state_type_id, role_code, occurred_on, mileage_km, documents, confidence, source_kind, snapshot_id)` |
| `mi_vm.measurement` | Check і Garage при діагностиці | `(vin, method_code, check_item_id, value, measured_at, expires_at, source_kind)` |

Вартість: лише код. Схема заморожена і цього не вимагає.

### VM-2. Одна таблиця спостережень ідентичності. Закриває BLOCKER 3 і HIGH 4.

```sql
create table if not exists public.vehicle_identity_observation (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null,
  field           text not null,   -- make, model, model_year, production_date,
                                   -- market_sold, generation, trim
  value_text      text,
  value_date      date,
  value_num       numeric,
  source_kind     text not null,   -- vin_decoder, build_sheet, listing, auction, user
  source_ref      text,
  decoder_version text,
  confidence      text,
  provenance_root text,
  observed_at     timestamptz not null,
  ingested_at     timestamptz not null default now(),
  snapshot_id     uuid references public.vehicle_snapshots(id),
  invalidated_at  timestamptz,
  invalidated_reason text
);
create index if not exists vio_vin_field on public.vehicle_identity_observation (vin, field, observed_at desc);
```

Одна таблиця дає одразу: дату виробництва, ринок продажу, історію
атрибутів машини, конфлікт двох декодерів як два рядки, корінь
походження, обидва часи і мʼяке виправлення. `vehicles` лишається кешем
останнього значення і більше не є джерелом істини для історії.

### VM-3. Одна таблиця спостережень компонента. Закриває решту BLOCKER 1.

```sql
create table if not exists public.component_observation (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null,
  snapshot_id     uuid references public.vehicle_snapshots(id),
  role_code       text not null,
  slot            text not null check (slot in ('factory','current')),
  variant_ref     text,            -- код варіанта каталогу Model Intelligence
  state           text not null check (state in ('PRESENT','ABSENT','UNKNOWN')),
  confidence      text,
  source_kind     text not null,
  provenance_root text,
  observed_at     timestamptz not null,
  ingested_at     timestamptz not null default now(),
  invalidated_at  timestamptz,
  invalidated_reason text,
  unique (vin, snapshot_id, role_code, slot, variant_ref)
);
```

Потрібна для випадку «спостереження поточного варіанта без події заміни»,
якого `component_state_instance` не покриває за конструкцією.

### VM-4. Дві колонки на знімок. Закриває HIGH 5 і HIGH 6.

```sql
alter table vehicle_snapshots
  add column if not exists listing_published_at timestamptz,
  add column if not exists provenance_root text;
alter table auction_events
  add column if not exists provenance_root text;
```

### VM-5. Мʼяке виправлення. Закриває HIGH 7.

```sql
alter table vehicle_snapshots
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_reason text;
alter table auction_events
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_reason text;
```

Разом: дві нові таблиці і сім колонок. Жодна наявна колонка не
змінюється, жоден рядок не переписується, RLS не послаблюється.

## L. Чого міняти НЕ треба

- Ланцюг оголошення, знімок, кадр, ціна, пробіг. Він правильний і вже
  дописувальний.
- Дедуплікацію знімків за `listing_fingerprint`. Сто перевірок незмінної
  сторінки дають один знімок, і це правильно.
- Дедуплікацію кадрів за SHA-256 і свідому відмову від perceptual-дедупу.
- Відокремлення `reports` і памʼяті користувача від спільних таблиць.
- `historical_visual_cache` з ключем по версії: нова версія читання дає
  новий рядок, а не затирає старий. Це вже правильна семантика, і її
  варто повторити у нових таблицях.
- Модель `equipment_observation` і `issue_observation`: вони вже
  дописувальні, мають evidence і привʼязку до знімка.

## M. Рекомендація

**Варіант 2: мінімальні поправки VM v2. Переробка не потрібна.**

Хребет памʼяті здоровий. Один VIN це одна машина, оголошення відокремлене
від машини, знімки незмінні і мають походження, кадри дедупліковані за
вмістом і не зникають з історії. Те, чого бракує, це не інша архітектура,
а чотири відсутні види спостережень і два відсутні поля часу і походження.

Найдешевша частина роботи взагалі не є зміною схеми: три таблиці під
стани, права і вимірювання вже існують у замороженій схемі і чекають, щоб
у них почали писати.

## N. GO / NO-GO до продакшн-інтеграції

**NO-GO зараз. GO після VM-1, VM-2 і VM-3.**

Причина проста і перевірена на реальних даних Phase 5. Резолвер сьогодні
дав би для BMW майже повну ідентичність, бо вона вся виводиться з VIN і
каталогу. Для Tesla він дав би заводське припущення по всіх замінних
ролях і НЕ зміг би дізнатись ні про заміну пака, ні про стан права на
швидку зарядку, тобто саме про ті два факти, які на десятирічній машині
визначають рішення. Для Porsche він не отримав би дати виробництва, і
найважливіший клейм про клеєні трубки охолодження лишився б умовним і
відсіявся б політикою пакета.

VM-4 і VM-5 не блокують інтеграцію, але без VM-4 дедуплікація доказів
резолвера працюватиме неправильно на переписаних оголошеннях, а без VM-5
першу ж помилкову аукціонну прив'язку доведеться видаляти назавжди.

Physical Schema Amendment #1 (`mi.system_area`) і поправка
`knowledge_pack_key` з Phase 5 лишаються відкритими і до цього аудиту
стосунку не мають.
