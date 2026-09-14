# Vehicle History v2 Audit

Аудит, не реалізація. Жодної міграції, жодної зміни схеми, коду, даних
продакшну, Score чи Verdict. Жодного платного Check. Продакшн читався лише
запитами SELECT і викликом `mi.vm_observations` (оголошена `stable`, нічого
не пише). Дата аудиту: 2026-09-14. Стан коду: `60503ad` (main).

Питання аудиту: чи здатна поточна Vehicle Memory зберегти і відтворити
реальну історію одного VIN протягом 5..10 років і десятків джерел без
втрати старих даних, перезапису історичних станів, дублювання канонічної
машини, змішування машин, подвійного рахування переписаних джерел,
плутанини часу події і часу знання, тихого переписування історії після
виправлень і без того, щоб LLM відновлювала хронологію з сирих таблиць.

## Рівні доказів

Кожен важливий висновок позначений одним із рівнів:

| Позначка | Значення |
|---|---|
| PROVEN_BY_REAL_DATA | видно у продакшн-даних |
| PROVEN_BY_CODE_SCHEMA | випливає з коду, DDL, SQL-функцій або тестів на синтетичних даних |
| PROVEN_BY_BOTH | і те, і те |
| NOT_YET_PROVABLE | у продакшні немає даних, щоб це підтвердити або спростувати |

PASS лише за кодом чесно так і підписаний. Набір даних малий і молодий, і
відсутність збоїв у ньому доказом PASS не є.

## Обсяг продакшн-даних, з якими працював аудит

Усі дані від 2026-08-17 до 2026-09-14, тобто 28 днів.

| Таблиця | Рядків | Примітка |
|---|---|---|
| `vehicles` | 77 | 0 порушень форми VIN, 0 дублів за upper(trim(vin)) |
| `listings` | 82 | 5 без VIN, 7 з ключем `url:<sha1>` (BaT), максимум **1** оголошення на машину |
| `vehicle_snapshots` | 226 | **157 без `listing_fingerprint`** (до появи дедуплікації), 67 `snap-v1`, 32 із `seen_count > 1`, 69 із `seller_claims.ai_discrepancies` |
| `photo_assets` | 2284 | 2283 `stored`, 1 `metadata_only` |
| `snapshot_photos` | 3075 | 2879 `listing`, 196 `historical_evidence` |
| `auction_events` | 4 | **усі 4 із `sale_date = null`** |
| `auction_checks` | 11 | 8 `found` без відповідної події |
| `vehicle_identity_observation` | 18 | у всіх 18 `observed_at = ingested_at`, `invalidated_at` ніде |
| `component_observation` | 0 | |
| `mi_vm.resolved_identity` | 8 | по одному рядку на VIN |
| `mi_vm.component_state_instance`, `entitlement_state`, `measurement` | 0 | |
| `equipment_observation` | 2197 | 225 із `retrofit = true` |
| `issue_observation` | 20 | 19 `seller_statement`, 1 `visible_defect` |
| `historical_visual_cache` | 24 | |
| `check_jobs` | 237 | 212 `done`, 52 різних VIN |
| `reports` (`kind = 'check'`) | 39 | 37 різних VIN |

Чого у даних НЕМАЄ взагалі: жодного VIN на двох площадках, жодного VIN із
двома оголошеннями, жодної аукціонної події з датою, жодного спостереження
компонента, права чи вимірювання, жодного виправлення, жодної події,
знайденої пізніше за її дату. Це визначає, що можна довести даними, а що
лише кодом.

## 1. Executive verdict

**GO WITH MINIMAL AMENDMENTS.**

Хребет здоровий і це доведено на реальних даних: один VIN це одна машина
(0 дублів на 77 машинах), оголошення відокремлене від машини, знімки
дописуються і дедуплікуються за відбитком (15 Check однієї незмінної
сторінки Tesla дали 1 знімок), кадри дедуплікуються за SHA-256 і
зберігають позицію, нові таблиці спостережень несуть обидва часи, корінь
походження і мʼяке виправлення, резолвер дедуплікує докази за коренем і
зберігає обидві сторони конфлікту.

Що заважає одразу будувати історію для користувача:

1. **Один справжній блокер: ключ аукціонної події `(auction_house, lot_id)`
   у поєднанні з `merge-duplicates` і парсером, який на сторінках stat.vin
   дістає одну й ту саму константу `45129191` як lot id для пʼяти різних
   VIN.** Один такий хибний рядок уже лежить в `auction_events` (ЗАЗ Sens
   `Y6DT1311070334890`, дім COPART, без кадрів, одометра і дати). Наступний
   Check іншої машини з тим самим джерелом і розпізнаним домом мовчки
   перепише `vin` цієї події. Це і змішування машин, і тихий перезапис.
   PROVEN_BY_BOTH.
2. Час події для аукціонів існує у схемі і ніколи не заповнюється у
   даних (`sale_date` null у 4 із 4). У оголошень часу події немає взагалі.
   Для цих двох доменів обидва зрізи часу зливаються в один.
3. Помилка парсера пишеться як спостереження і не відрізняється від
   справжньої зміни оголошення. Porsche: 93 000 км у пʼяти знімках, потім
   153 000 км, при тому що сторінка весь час містила обидва числа. Зріз
   «стан на 2026-08-30» повертає 93 000. Знімок не має механізму
   виправлення без видалення (VM-5), тому хибне спостереження або лишається
   назавжди, або видаляється разом із історією.
4. Резолвер обирає скаляр за силою джерела, а не за часом: аукціонний
   одометр (ранг 70) перекриє пробіг оголошення (ранг 50) як «поточний».
   Історичний пробіг стає конкурентом поточного.
5. Переписане джерело рахується як незалежне: кадр «історичного доказу» з
   carsniper.com.ua для `WVGZZZCR6TD014831` має той самий SHA-256, що і
   кадр самого оголошення цієї машини.

Жоден із пунктів 2..5 не є втратою даних: сирі докази збережені і з них
усе відновлюється. Але без поправок історія для користувача покаже
хибний відкат пробігу, хибну аукціонну подію і подвоєні докази.

## 2. Current architecture map

Фактичний ланцюг для одного Check (`api/check.js`, `api/vehicle-memory.js`):

```
сторінка оголошення
  -> extractListing (check.js:251..): VIN лише регекспом VIN_RE, upper-case,
     17 символів, має і літери, і цифри; держномер як запасний ключ
  -> readVehicle(vin) / декод NHTSA (check.js:2564..2582)
  -> upsertVehicle(vin, patch)              vehicles, on_conflict=vin, merge-duplicates
  -> observeListing(l, url, {vehicleId})    resolveListing -> listings (source, source_listing_id)
                                            attachVehicleToListing (лише порожні звʼязки)
                                            listingFingerprint -> dedup або новий vehicle_snapshots
  -> preservePhotos(kind='listing')         photo_assets (SHA-256), snapshot_photos (позиція)
  -> readAuctionCache / findAuctionRecord   auction_events (limit 1 за checked_at) або auction_checks
  -> writeAuctionEvent / writeAuctionCache  auction_events on_conflict=(auction_house,lot_id) merge;
                                            auction_checks on_conflict=vin merge
  -> preservePhotos(kind='historical_evidence', event_key)
  -> readHvCache / writeHvCache             historical_visual_cache (vin, fingerprint, hv_version), ignore-duplicates
  -> readSnapshots(vin)                     ЗЛАМАНО: select created_at, колонки немає, HTTP 400
  -> AI, Score, Verdict
  -> patchSnapshotClaims(snapshot)          vehicle_snapshots.seller_claims (PATCH, перезапис ai_discrepancies)
  -> writeKnowledge                         equipment_observation, issue_observation, observation_coverage,
                                            усі ignore-duplicates за ключем зі snapshot_id
  -> jobWrite(done)                         check_jobs.report
  -> runMiShadow -> public.mi_shadow_pack   mi.ingest_identity_from_check -> vehicle_identity_observation
                                            mi.resolve_from_memory -> mi.vm_observations -> mi.resolve_identity
                                            -> mi_vm.resolved_identity(+_dimension) -> mi.request_pack
клієнт (result-check.html:1900)             reports (insert), потім update({data}) при перекладі і чаті
```

Читання Vehicle Memory у продукті сьогодні: `readVehicle` (кеш декоду),
`observeListing` (останній знімок для дедуплікації), `readAuctionCache`
(одна остання подія), `readHvCache`, `snapshotHasPhotos`, `readSnapshots`
(не працює). Нічого з цього не збирає хронологію. Єдиний читач історії як
історії це `mi.vm_observations`.

## 3. History storage map

| Домен | Таблиці | Шлях запису | Ключ ідентичності | Час події | Час знання | Походження | Лише дописування | Дедуп | Виправлення | Зріз у часі | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|
| listing | `listings`, `vehicle_snapshots` | `observeListing` | `(source, source_listing_id)`; знімок `id` | **немає** (VM-4) | `captured_at` | `source_url`, `source_domain`, `parser_version` (з 2026-08-31) | знімок так; `listings.current_status/last_*` і `snapshot.last_seen_at/seen_count` мутуються | `listing_fingerprint` | **немає** (VM-5) | так, але лише за часом знання | PARTIAL |
| price | `vehicle_snapshots.price_amount/price_currency` | те саме | знімок | немає | `captured_at` | знімок | так | у складі відбитка | немає | так, за часом знання | PARTIAL |
| mileage | `vehicle_snapshots.odometer_km`; `auction_events.odometer_value/unit/status`; `vehicle_identity_observation` (не пишеться) | `observeListing`, `writeAuctionEvent` | знімок; подія | немає / `sale_date` (порожній) | `captured_at` / `first_seen_at` | знімок; `record.field_provenance.mileage` | знімок так; подія **перезаписується** | відбиток / ключ події | немає | за часом знання | PARTIAL |
| seller claims | `vehicle_snapshots.seller_text`, `raw_page_text`, `seller_claims`, `listing_fields.history_facts`; `issue_observation` (`seller_statement`) | `observeListing`, `patchSnapshotClaims`, `writeKnowledge` | знімок; `(vin, snapshot_id, event_key)` | немає | `captured_at`, `observed_at` (default now) | знімок; evidence-таблиця | сирий текст так; **`seller_claims.ai_discrepancies` перезаписується** кожним Check | так | немає | за часом знання | PARTIAL |
| photos | `photo_assets`, `snapshot_photos`, `vehicle_snapshots.photos/photo_items` | `preservePhotos` | `content_hash`; `(snapshot_id, kind, position)` | немає | `observed_at` | `source_url_at_observation`, `photo_identity`, `kind`, `event_key` (рядок) | так | SHA-256 | немає | за часом знання | PARTIAL |
| auction | `auction_events`, `auction_checks` | `writeAuctionEvent`, `writeAuctionCache` | `(auction_house, lot_id)`; **`vin`** у кеші | `sale_date` (0 із 4 заповнено) | `first_seen_at`, `checked_at` | `source_urls`, `record.field_provenance` по полях | **ні**: merge-duplicates перезаписує все, крім `first_seen_at` і злитих `source_urls`; кеш перезаписується цілком | ключ події; **колізія lot_id доведена** | немає (VM-5) | лише за `first_seen_at` | FAIL |
| damage | `auction_events.primary/secondary_damage`; `historical_visual_cache`; `issue_observation` (`visible_defect`); поточний Vision лише у `reports.data` | `writeAuctionEvent`, `writeHvCache`, `writeKnowledge` | подія; `(vin, fingerprint, hv_version)` | `sale_date` (порожній) | `first_seen_at`, `created_at` | так | подія ні; hv-кеш так (ignore-duplicates, версійований) | так | немає | частково | PARTIAL |
| identity | `vehicles` (кеш), `vehicle_identity_observation` | `upsertVehicle`; `mi.ingest_identity_from_check` | `vin`; `id` | `observed_at` | `ingested_at` | `source_kind`, `source_ref`, `provenance_root`, `decoder_version` | `vehicles` ні (merge на місці); спостереження так | `not exists` за (vin, dimension, source_kind[, value або корінь]) | `invalidated_at` + `mi.vm_invalidate` (ніхто не викликає) | так, обидва зрізи | PASS за схемою, PARTIAL за даними |
| component | `component_observation`, `mi_vm.component_state_instance` | `mi.vm_record_component`, `mi.vm_record_component_state`: **продакшн не викликає** | `id` | `observed_at` / `occurred_on` | `ingested_at` / `created_at` | так | так | ні (немає unique) | `invalidated_at` (лише `component_observation`) | так, обидва зрізи | PASS за схемою, NOT_YET_PROVABLE даними |
| equipment | `equipment_observation` (+`_evidence`) | `writeKnowledge` | `(vin, snapshot_id, option_id)` | немає | `observed_at` (default now) | evidence-таблиця, `check_id` (FK на `reports`, `set null`) | так | так, у межах знімка | `verification_status` (ніхто не ставить) | за часом знання | PARTIAL |
| entitlement | `mi_vm.entitlement_state` | `mi.vm_record_entitlement`: продакшн не викликає | `(vin, entitlement_id, checked_at)` | `checked_at` | `checked_at` (один час) | `source_kind` | так за конструкцією | так | немає | за одним часом | PASS за схемою, NOT_YET_PROVABLE |
| measurements | `mi_vm.measurement` | `mi.vm_record_measurement`: продакшн не викликає | `id` | `measured_at` | `created_at` | `source_kind` | так | ні | немає | так | PASS за схемою, NOT_YET_PROVABLE |
| reports | `reports`, `check_jobs` | клієнт `result-check.html:1900`; `jobWrite` | `id`; `token` | немає | `created_at` | `_meta.vehicle_id/listing_id/snapshot_id` (мʼякі) | **ні**: клієнт оновлює `data` (переклад, чат), користувач може видалити | немає | немає | немає | не Vehicle Memory за контрактом, але джерело `check_inference` |

## 4. PASS / PARTIAL / FAIL findings

### Area 1. Canonical Vehicle identity: PASS

- Ключ: `vehicles.vin` PK, `vehicles.id` unique, обидва застосовуються.
  `upsertVehicle` іде через `on_conflict=vin` з `merge-duplicates`; null не
  затирає відоме. PROVEN_BY_BOTH: 77 машин, 0 дублів за `upper(btrim(vin))`,
  0 порушень форми, 0 розбіжностей `listings.vin`/`vehicles.vin` і
  `vehicle_snapshots.vin`/`vehicles.vin` через `vehicle_id`.
- Нормалізація: VIN дістається лише з `VIN_RE` (17 символів, без I/O/Q) і
  одразу `toUpperCase()` (`check.js:265`). Інших шляхів присвоєння
  `listing.vin` у коді немає: ні з JSON площадки, ні з тіла запиту.
  Варіації регістру і пробілів у базу потрапити не можуть.
  PROVEN_BY_CODE_SCHEMA (у даних жодного відхилення).
- Той самий VIN на іншій площадці: новий `listings` рядок з тим самим
  `vehicle_id`, нова машина не створюється. PROVEN_BY_CODE_SCHEMA
  (`vehiclememorytest.js`); **NOT_YET_PROVABLE даними**: максимум 1
  оголошення на машину, 1 джерело на машину.
- Повторний Check того самого оголошення: те саме оголошення, дедуп знімка.
  PROVEN_BY_REAL_DATA: Tesla, 15 Check після 2026-09-03 12:22 дали один
  знімок із `seen_count = 15`.
- Оголошення без VIN живе окремо (5 у даних) і привʼязується пізніше через
  `attachVehicleToListing`, який заповнює лише порожні `vehicle_id`.
  Відвʼязати оголошення або привʼязати до двох машин код не вміє:
  `listings.vehicle_id` пишеться лише коли він null. Держномер як другий
  ключ звʼязування зберігається, але привʼязку по ньому ніхто не робить.
- Шлях, що створює Vehicle без пошуку наявного: відсутній. `upsertVehicle`
  єдиний писар, і він завжди upsert по VIN.

Обмеження, не помилка: VIN на 11..16 символів (мото, старі авто) регексп
не бере, хоча `vin_shape` знімка їх допускає.

### Area 2. Listing != Vehicle: PASS за схемою, PARTIAL за поведінкою

- Ідентичність оголошення: `(source, source_listing_id)`, а без id
  площадки `url:<sha1 нормалізованої адреси>` (7 таких у даних, усі BaT).
  Зміна трекінгових параметрів адреси ключа не змінює.
- Новий знімок лише при зміні `listingFingerprint` (ціна, валюта, пробіг,
  текст продавця, впорядковані ідентичності кадрів, комплектація площадки,
  факти історії, рік, назва, статус). Старий рядок ніколи не змінює змісту.
  PROVEN_BY_REAL_DATA: Subaru BaT дав 5 знімків із 5 відбитками, ціна
  2 888 -> 4 992 USD, усі рядки живі; Porsche має ціни 24 999, 23 500,
  22 700 у трьох окремих рядках.
- Що НЕ так у поведінці:
  1. **Знімки до 2026-09-03 не дедуплікувались.** 157 рядків без відбитка:
     Tesla 27 рядків за один ранок із тим самим змістом, BMW
     `WBAJE7C34HG887901` 14. Це не втрата, а шум, який множив і
     `equipment_observation` (Tesla: 27 знімків по 6..10 спостережень
     кожен, разом 282 рядки на 114 опцій). Після появи відбитка проблема
     зникла. PROVEN_BY_REAL_DATA.
  2. Відбиток включає набір кадрів, а витяг галереї BaT нестабільний:
     120, 120, 120, 68, 16 кадрів у пʼяти послідовних знімках Subaru при
     незмінному оголошенні. Кожна така варіація народжує «змінений стан».
     Історія оголошення отримує події, яких у оголошення не було.
     PROVEN_BY_REAL_DATA.
  3. Статус: `listing_status` у знімку (`active` 66, `inactive` 3, null 157)
     і `listings.current_status` (перезаписується). Історія статусу є лише
     через ланцюжок знімків. Зникле оголошення (404) знімка не створює:
     Check падає раніше за `observeListing`. Отже «оголошення зникло» у
     памʼяті не виражається. PROVEN_BY_CODE_SCHEMA.
  4. Зміна продавця: `seller_meta` у знімку є, у відбиток не входить, тому
     сама по собі новий знімок не створює. Побачити її можна лише якщо
     разом змінилось щось інше.

### Area 3. Append-only chronology: PARTIAL

Матриця у розділі 3. Коротко: знімки, кадри, спостереження ідентичності,
комплектації і знахідок дописуються. Перезаписуються на місці: `vehicles`,
`listings` (статус і останні посилання), `auction_events` (усе, крім
`first_seen_at`), `auction_checks` (цілком), `vehicle_snapshots.seller_claims
.ai_discrepancies`, `last_seen_at`, `seen_count`.

Бажана історія «82 000 -> 89 000 -> 74 000 км» зберігається трьома
знімками і третє спостереження перше не перезаписує. PROVEN_BY_REAL_DATA на
Porsche і на `WBAJA9C5XJB033667` (104 000 -> 90 000). Але позначити третє як
хибне або як відкат нема чим: у знімка немає `invalidated_at`, а у
резолвера пробіг береться одним останнім знімком (`vm_observations`, 3.6,
`limit 1`).

### Area 4. Event time vs knowledge time: PARTIAL

| Домен | Час події | Час знання | Стан у даних |
|---|---|---|---|
| `vehicle_identity_observation` | `observed_at` | `ingested_at` | у всіх 18 рядках однакові: міст ставить `decoded_at = vehicles.first_seen_at` або `captured_at` знімка в обидві колонки |
| `component_observation`, `mi_vm.*` | є | є | 0 рядків |
| `auction_events` | `sale_date` | `first_seen_at`, `checked_at` | **`sale_date` null у 4 із 4**; `vm_observations` тоді бере `first_seen_at` як час події |
| `vehicle_snapshots` | **немає** | `captured_at` | обидва зрізи це `captured_at` |
| `equipment_observation`, `issue_observation`, `snapshot_photos` | немає | `observed_at` (default now) | лише час знання |

Сценарій «аукціон 2022 року, знайдений у 2026»: схема виражає його
правильно, адаптер фільтрує по обох зрізах, тест `mivmtest` 9 це
доводить на синтетиці. PROVEN_BY_CODE_SCHEMA. Але жодна реальна подія
дати не має: парсер не витягнув `sale_date` з жодного з чотирьох
дзеркал (`sale_date_raw` теж null). Отже у продакшні сьогодні аукціон
2022 року, знайдений у 2026, ліг би у історію датою 2026. Це не дефект
схеми, а дефект наповнення. NOT_YET_PROVABLE даними для аукціонів;
для оголошень часу події не існує за конструкцією (VM-4).

Питання «що сталося до X» і «що CalCar знав на Y» різняться лише для
двох нових таблиць спостережень. Для всієї решти поверхні історії це одне
й те саме питання.

### Area 5. Provenance and provenance roots: PARTIAL

Джерело видно скрізь: `source_url`/`source_domain`/`parser_version` у
знімку, `source_url_at_observation`/`photo_identity` у кадрі,
`source_urls` і `record.field_provenance` (по полях, з `evidence_type`) у
події, `source_kind`/`source_ref`/`decoder_version` у спостереженнях.
Сирий доказ: `raw_page_text` (лише 69 знімків з 226), `seller_text`,
бінарники кадрів у приватному bucket.

Корінь походження існує лише у `vehicle_identity_observation` і
`component_observation`. Для знімків і подій `vm_observations` будує його
детерміновано: `listing:<listing_id>` і `auction:<house>:<lot>`. Дзеркала
одного лота (vincheck.by, usacars.bg, americamotors) правильно згортаються
в один корінь дому і лота. PROVEN_BY_BOTH.

Де незалежність порушена:

1. **Переписане оголошення як історичний доказ.** Кадр
   `historical_evidence` з `event_key = serper:carsniper.com.ua:1166359` для
   `WVGZZZCR6TD014831` має той самий `photo_asset_id`, що і кадр
   `listing` цього ж VIN. Агрегатор carsniper переписує auto.ria, а
   `findAuctionRecord` визнав його «знайденим записом» з `identity.confidence
   = high`. У памʼяті обидва кадри мають різні ключі і жодного спільного
   кореня. PROVEN_BY_REAL_DATA.
2. `auction_checks.status = 'found'` для 8 VIN із джерел `serper:stat.vin`,
   `serper:carsniper.com.ua`, `serper:poctra.com` без жодної події в
   `auction_events`: доказ живе лише у кеші, який перезаписується.
3. `check_inference` має корінь `report:<id>`, але `reports.data`
   оновлюється клієнтом (переклад, чат) і видаляється користувачем. Корінь
   може вказувати на змінений або зниклий документ. Спостереження при
   цьому лишається. PROVEN_BY_CODE_SCHEMA (`result-check.html:1316,1784`,
   `cabinet.html:1061`).

### Area 6. Photo history: PARTIAL

- Ідентичність кадру: SHA-256 бінарника (`photo_assets.content_hash`) плюс
  `photo_identity` (хост без CDN-номера і query розміру) для випадку, коли
  бінарник недоступний. Звʼязок зі знімком через `snapshot_photos` з
  позицією, URL на момент спостереження, `kind` і `event_key`. Порядок у
  межах знімка збережений: 0 прогалин позицій у 3075 рядках.
- Той самий кадр на іншому оголошенні: один `photo_assets`, два звʼязки.
  PROVEN_BY_REAL_DATA: 47 кадрів спільні для кількох оголошень, 9 для
  кількох машин. Усі 9 це службові зображення BaT (шаблони «QoTW Winner»,
  банер «BaT and Ti», скриншоти), які витяг галереї бере як кадри
  оголошення для Subaru `JF1GG29674G821516`, Audi `WAUML54B53N103131` і
  пʼяти оголошень без VIN. Машини не змішані, але хронологія кадрів
  містить не-кадри.
- Пізніше оголошення з новими кадрами: новий знімок, нові звʼязки, старі
  лишаються. Поточні і історичні кадри розрізняються `kind`.
- Час: лише `observed_at` (знання). Дата зйомки або публікації відсутня.
- «До ремонту -> після ремонту -> поточне оголошення»: виразимо через
  `kind = historical_evidence` з `event_key` події і `kind = listing`
  пізнішого знімка, без втрати походження. Але звʼязок з подією це рядок
  `event_key`, не посилання: у даних є `COPART:57082475` і просто `COPART`
  (lot id був невідомий на момент запису). PROVEN_BY_REAL_DATA.
- **Втрата, яка вже сталась:** 158 знімків із 226 (35 VIN) мають лише URL
  кадрів у `photos` і жодного `snapshot_photos`; 26 VIN не мають жодного
  збереженого бінарника. Це знімки до 2026-09-03. Досохранення робиться лише
  для поточного знімка Check, старі рядки ніхто не обходить. CDN площадки
  ці адреси не гарантує. PROVEN_BY_REAL_DATA.

### Area 7. Mileage history: PARTIAL

Де живе пробіг:

| Місце | Природа |
|---|---|
| `vehicle_snapshots.odometer_km` | історичне спостереження оголошення, з часом знання |
| `auction_events.odometer_value/unit/status` | пробіг лота, з одиницею і статусом (`actual/not_actual/exempt/unknown`); дата події порожня |
| `vehicles` | пробігу не має (добре) |
| `listing.odometer_km` у `_meta` звіту | зручне поточне значення поза памʼяттю |
| `mi_vm.resolved_identity_dimension` `mileage_km` | розвʼязане «поточне» |

Детерміновано побудувати «дата -> пробіг -> джерело -> корінь -> статус»
можна зі знімків і подій. Одиниці збережені (`mi`/`km`/`unknown`), адаптер
конвертує `round(mi * 1.609344)`. PROVEN_BY_BOTH.

Що не так:

1. **Помилка парсера нерозрізнена від зміни оголошення.** Porsche
   `WP1ZZZ92ZDLA45155`: пʼять знімків 26..27.08 з 93 000 км, потім 153 000
   км. Текст сторінки в усіх знімках містить «93 тис.км | 153 тис.км | 153
   тис. км | 147 тис. км | 80 тис. км»: блок схожих оголошень. Старий
   парсер брав перше число, `parser-2026-08-31` бере правильне. Історія
   тепер каже «93 000 -> 153 000 за пʼять днів», а зріз
   `vm_observations('WP1ZZZ92ZDLA45155', '2026-08-30', null)` повертає
   `mileage_km = 93000`. Виправити без видалення нема чим. PROVEN_BY_REAL_DATA.
2. `WBAJA9C5XJB033667`: 104 000 -> 90 000 за два дні. У пізніших знімках
   перша згадка на сторінці стала «90 тис.км». Це правка продавця чи інший
   блок сторінки: **UNKNOWN**, бо у легасі-знімках `raw_page_text` порожній
   (0 символів), доказу для розбору немає.
3. **Історичний пробіг конкурує з поточним.** `vm_observations` віддає
   пробіг оголошення (`listing`, ранг 50 для scalar) і пробіг аукціону
   (`auction`, ранг 70) як два спостереження одного виміру `mileage_km`.
   `resolve_dimension` обирає за рангом, час не враховує. Для
   `WBAJE7C34HG887901` це 160 000 км (оголошення, 2026-09-09) проти 159 320
   км (лот COPART, дата невідома): переможе лот. Реальний випадок дасть
   `mileage_km` роками застарілий. PROVEN_BY_CODE_SCHEMA на реальних вхідних
   даних (резолюцію не запускав: вона пише).
4. **Читання історії пробігу в продукті мертве.** `readSnapshots`
   (`check.js:600`) робить `select=odometer_km,source_url,created_at`, а
   колонки `created_at` у `vehicle_snapshots` немає. Edge-лог Check від
   2026-09-14 06:46:16: `GET | 400 | .../vehicle_snapshots?vin=eq.WVWZZZ7MZ6V009287
   &select=odometer_km,source_url,created_at&order=created_at.asc`. Функція
   повертає `[]`, `mileage_context.historical_points` завжди порожній, крім
   аукціонної точки. PROVEN_BY_BOTH.
5. Виявлення відкату, неможливих стрибків, одночасних розбіжностей: ніде не
   реалізоване. Дані для цього є.

### Area 8. Price / listing history: PARTIAL

Ціна і валюта у кожному знімку, валюта не нормалізується (USD з «$»
auto.ria, як на сторінці). Правки ціни дають новий знімок.
PROVEN_BY_REAL_DATA (Porsche, Subaru, Audi Q5 три ціни). Продавець:
`seller_meta` у знімку. Площадка: `listings.source`. Повторна поява як
нове оголошення: новий рядок `listings` того самого `vehicle_id`,
NOT_YET_PROVABLE даними. Зникнення не виражається (див. Area 2).
Ринковий контекст (`price_context`) свідомо поза відбитком.

### Area 9. Auction history: FAIL

- Подія перезаписується: `writeAuctionEvent` шле повний рядок з
  `merge-duplicates`; зберігаються лише `first_seen_at` (не шлеться) і
  злиття `source_urls`. Повторний розбір того самого лота затирає дату,
  одометр і ушкодження попереднього. Виправлений запис не «супереседить», а
  замінює. PROVEN_BY_CODE_SCHEMA.
- Кілька подій на VIN: схема дозволяє, читання ні: `readAuctionCache` бере
  `order=checked_at.desc&limit=1`, `ingest_identity_from_check` бере
  найранішу за `sale_date`. Друга подія у продукт не потрапляє.
- Кадри події: `snapshot_photos.kind = historical_evidence` з рядковим
  `event_key`, привʼязані до знімка оголошення, а не до події. Подія без
  Check оголошення кадрів не має.
- Пізніше оголошення і рання подія звʼязані лише спільним `vin`.
- Час події не заповнюється (Area 4).
- **Колізія ключа.** Парсер stat.vin віддає `lot_id = 45129191`,
  `lot_id_source = direct`, `evidence_type = vin_scoped`, для пʼяти різних
  VIN (`TMBJX21U258812857`, `TMBLN9NS2R8506389`, `KMHS281HGMU335923`,
  `Y6DT1311070334890`, `JMB0RK9607J003076`). У чотирьох дім не розпізнаний,
  тому `writeAuctionEvent` їх пропустив. У ЗАЗ Sens дім розпізнаний як
  COPART (`evidence_type = labelled_field`), і рядок `(COPART, 45129191,
  vin = Y6DT...)` записаний без кадрів, одометра і дати. Наступна машина з
  stat.vin і розпізнаним домом отримає той самий ключ, і `merge-duplicates`
  перепише `vin` події. Це тихе перенесення події на іншу машину.
  PROVEN_BY_REAL_DATA (пʼять збігів, один рядок події) і
  PROVEN_BY_CODE_SCHEMA (upsert без перевірки VIN). Сам ЗАЗ Sens 2007 року
  випуску в Україні на COPART не бував: подія хибна і вже впливатиме на
  міст (`market_sold = US`, ранг 70, provenance `auction:COPART:45129191`)
  при наступному Check.
- `auction_checks`: кеш по VIN, перезаписується, зберігає `found` для
  джерел, що не є аукціонами (carsniper, stat.vin без дому). Це не історія,
  але саме тут лежать 8 із 12 «знайдених» результатів.

### Area 10. Component history: PASS за схемою, NOT_YET_PROVABLE даними

`component_observation` розрізняє `factory`, `current_observed`,
`replacement`, `removal`, несе `variant_code`, `previous_variant_code`,
обидва часи, корінь, `invalidated_at`. `mi_vm.component_state_instance`
несе задокументовану подію з `occurred_on`, пробігом, документами.
Адаптер кладе заводське у слот `factory`, заміну і поточне у `current`, і
заводський рядок при заміні не зникає. Резолвер тримає слоти окремо
(`miresolvertest` 5, 6; `mivmtest` 5, 6, 13). Нове спостереження історію
не перезаписує: unique-обмежень немає, лише insert. PROVEN_BY_CODE_SCHEMA.

У продакшні 0 рядків в обох таблицях і жодного писаря: Check не викликає
`mi.vm_record_component*`. Для Tesla/MCU, батарей, приводів, коробок,
ADAS, зарядника, модема історії сьогодні не існує. Це не архітектурна
прогалина, а відсутність наповнення.

### Area 11. Equipment / entitlement history: PARTIAL

- `equipment_observation` розрізняє `PRESENT/ABSENT/UNKNOWN`, має `retrofit`
  і `factory_market`, історію по знімках і evidence. Слотів
  заводське/поточне немає: одна булева `retrofit` (225 із 2197 `true`,
  10 %, що виглядає завищено; поза обсягом аудиту). Час лише знання.
- Право окремо від заліза: `mi_vm.entitlement_state` з ключем `(vin,
  entitlement_id, checked_at)` дописується за конструкцією, історія
  зберігається, адаптер бере найсвіжіше у межах зрізу. Резолвер не виводить
  право з заліза (`miresolvertest` 10). PROVEN_BY_CODE_SCHEMA. 0 рядків.
- Заводське проти ретрофіту, поточне залізо проти заводського без
  видалення: у `component_observation` так; у `equipment_observation` лише
  прапорцем.

### Area 12. Conflicting evidence: PARTIAL

Резолвер: `confirmed`, `assumed_factory`, `conflicted`, `unresolved`
(`mi.resolution_status`). `superseded` як статусу немає; його роль
виконують `invalidated_at` плюс новий рядок. Обидві сторони конфлікту
зберігаються у `provenance.supporting/conflicting/candidates`. Два сильні
джерела дають `conflicted`, два однакової сили для незмінної заводської
ідентичності теж (`miresolvertest` 7, `mipartialtest` 22). Корінь
походження знімає подвійне рахування (`miresolvertest` 12, `mivmtest` 10).
PROVEN_BY_CODE_SCHEMA; реальних конфліктів у даних немає (усі 8
ідентичностей мають лише `confirmed` і `unresolved`).

Де «останній запис перемагає» лишається:

| Місце | Що втрачається |
|---|---|
| `vehicles` (merge на місці; `make` з оголошення перекриває декод) | історія атрибутів кешу; є у спостереженнях |
| `auction_events` merge | попередній розбір лота |
| `auction_checks` merge по VIN | попередній результат пошуку |
| `vehicle_snapshots.seller_claims.ai_discrepancies` PATCH | попередня AI-інтерпретація того самого знімка |
| `listings.current_status`, `last_*` | історія статусу (є у знімках) |
| `vm_observations` 3.6: пробіг `limit 1` | попередні пробіги не доходять до резолвера |
| `reports.data` update клієнтом | попередній стан звіту |

Окремий випадок: **неправильний декод без контр-доказу.** `KMHS281HGMU335923`
(Hyundai Santa Fe, оголошення 2020): NHTSA не декодував марку і модель,
але дав `ModelYear = 1991`; `WDC2923241A051752` (Mercedes C292, оголошення
2016): `ModelYear = 2001`. Обидва записані у `vehicles.model_year`. Міст
запише їх як `vin_decoder`, `high`, ранг 100, а рік оголошення свідомо не
пише (міграція 020). Конфлікт не виникне, хибний рік стане підтвердженим.
PROVEN_BY_REAL_DATA (рядки `vehicles`) і PROVEN_BY_CODE_SCHEMA (міст);
спостережень для цих VIN ще немає, бо їхні Check були до виправлення 024.

### Area 13. Corrections / invalidation: PARTIAL

- Нові таблиці: `invalidated_at` з обовʼязковою причиною (check-обмеження),
  `mi.vm_invalidate`, читання завжди відсіює недійсне, рядок лишається
  (`mivmtest` 11). PROVEN_BY_CODE_SCHEMA. У продакшні жодного виклику і
  жодного недійсного рядка.
- `vehicle_snapshots`, `auction_events`, `snapshot_photos`, `equipment_
  observation`, `issue_observation`: механізму немає. `verification_status`
  у двох останніх існує, але не ставиться.
- **VM-5 підтверджений даними як потреба, а не як теорія:** хибний пробіг
  Porsche (5 знімків) і хибна подія ЗАЗ Sens можна лише видалити разом із
  історією або лишити назавжди. Рішення: **SHOULD FIX BEFORE USER-FACING
  HISTORY**, не блокер: даних не втрачається, втрачається лише можливість
  чесно їх позначити.

### Area 14. Point-in-time reconstruction: PARTIAL

Перевірено на реальних даних викликом `mi.vm_observations` (без запису):

| VIN | Зріз | Результат |
|---|---|---|
| `WP1ZZZ92ZDLA45155` | повний | 4 спостереження: рік 2013 (декод), версія GTS (check_inference), ринок UA, пробіг **153 000** (знімок 2026-09-10) |
| той самий | подія до 2026-08-30 | 3: рік, версія, пробіг **93 000** (знімок 2026-08-27) |
| той самий | знання до 2026-08-30 | ідентично зрізу події: для знімків обидва зрізи це `captured_at` |
| `5YJSA1H23FFP69703` | повний | 4: версія P85D, ринок UA, рік 2015, пробіг 167 000 |
| `WBAJE7C34HG887901` | повний | 2: пробіг 160 000 (оголошення) і 159 320 (лот, `observed_at = null`, бо `sale_date` порожній) |

Висновки:

- Зріз ідентичності і компонентів: обидва питання розрізняються.
  PROVEN_BY_CODE_SCHEMA (`mivmtest` 9); у даних немає жодного рядка з
  `observed_at <> ingested_at`.
- Зріз оголошень: лише час знання. Зріз аукціонів: лише час знання, поки
  `sale_date` не заповнюється.
- Ціна, статус, кадри, комплектація, знахідки: відновлюються за часом
  знання через `captured_at`/`observed_at` знімка. Час події відсутній.
- Зріз повертає хибне спостереження як істину, якщо його нічим позначити
  (Porsche 93 000).
- Читання «майбутніх» полів: `last_seen_at` і `seen_count` знімка пишуться
  пізніше за `captured_at`, тому рядок, прочитаний станом на T, несе
  значення з майбутнього. Зміст знімка чистий.
- Компонент, дізнаний через роки; виправлений пробіг; пізніше оголошення
  зі старим сервісом: усе NOT_YET_PROVABLE даними.

### Area 15. Repeated Check semantics: PASS за наявними даними

Tesla `5YJSA1H23FFP69703`, 32 успішні Check:

| Що | Результат |
|---|---|
| canonical Vehicle | один, `vehicles.id = 788c388f…` |
| оголошення | одне, `2dd73c09…` |
| знімки | 27 без відбитка (до 12:22 2026-09-03), далі 1 знімок, `seen_count = 15`, `last_seen_at` 2026-09-12 |
| звіти | 1 (`reports`), 32 `check_jobs` |
| комплектація | 27 × 6..10 рядків (легасі) + 72 рядки на дедуплікованому знімку, не множаться далі |
| ідентичність | 3 спостереження, не подвоєні тінню (Phase 7.4 запускала тінь двічі, автоматична тінь після 7.7); 1 `resolved_identity` |
| кадри | 30 звʼязків на дедуплікованому знімку; 27 легасі-знімків без бінарників |

Нові докази дописуються, старі лишаються: Subaru 5 знімків, Porsche три
ціни. Резолвер читає накопичену памʼять: `mi.resolve_from_memory`.
Поточний стан змінюється лише від нового доказу: `identity_version` це
md5 від версії резолвера і відсортованого набору спостережень, той самий
набір дає той самий рядок (`miresolvertest` 18, `mishadowtest` 10, 18).
PROVEN_BY_BOTH для ідентичних доказів; для «новий доказ дає новий рядок,
старий лишається» PROVEN_BY_CODE_SCHEMA (жоден VIN не має двох рядків).

### Area 16. Vehicle History -> Decision Engine: див. розділ 11

### Area 18. MI bridge as a Vehicle History writer: PASS за схемою, PARTIAL за поведінкою

`mi.ingest_identity_from_check` (міграція 023) пише чотири види
спостережень: модельний рік з декоду, версію з декоду (`match_version`),
версію з розбору Check (`match_version_text` по `reports.data->vehicle->trim`),
ринок продажу з аукціону, ринок експлуатації зі знімка.

| Питання | Відповідь | Доказ |
|---|---|---|
| 1. дописує чи перезаписує | лише insert через `mi.vm_record_identity`; жодного update | PROVEN_BY_CODE_SCHEMA |
| 2. точні дублікати | `not exists` за (vin, dimension, source_kind, значення або корінь); повторний виклик пише 0 | PROVEN_BY_BOTH (`mishadowtest` 10; Tesla 3 рядки після кількох тіней; Touareg `written = 2` потім `0`) |
| 3. семантично рівні спостереження множаться | версія з Check пишеться раз на звіт (корінь `report:<id>`); різні формулювання одної версії дають один `version_code` і один `vkey` у резолвері; межа множення = кількість звітів по VIN | PROVEN_BY_BOTH (`mipartialtest` 21; у даних 4 рядки на 4 звіти) |
| 4. конфлікти зберігаються | два звіти з різними версіями каталогу: обидва рядки живуть, резолвер дає `conflicted`, обидва у `candidates` | PROVEN_BY_CODE_SCHEMA (`mipartialtest` 22); у даних 0 конфліктів |
| 5. програшний доказ лишається запитуваним | так: `vehicle_identity_observation` не змінюється, `provenance.conflicting` у розвʼязаному вимірі | PROVEN_BY_CODE_SCHEMA |
| 6. хто перемагає | `factory_identity`: `vin_decoder` 100, `auction` 70, `listing` 40, `check_inference` 40; поріг 40, сильний конфлікт від 70; рівна сила при різних значеннях = `conflicted` | PROVEN_BY_CODE_SCHEMA (`mi.source_rank`) |
| 7. декод перебиває check_inference | так, 100 проти 40, висновок лишається у `conflicting` | PROVEN_BY_CODE_SCHEMA (`mipartialtest` 20); **NOT_YET_PROVABLE даними**: у продакшні жодного рядка `version` від `vin_decoder`, `match_version` не влучив у жоден з 8 VIN |
| 8. зміна розвʼязаного стану без видалення доказів | новий набір спостережень дає новий `resolved_identity`, старий рядок і його виміри лишаються | PROVEN_BY_CODE_SCHEMA; у даних по 1 рядку на VIN |
| 9. ідемпотентність повторних Check | так: 0 нових рядків, той самий `identity_version` | PROVEN_BY_BOTH |

Сирі спостереження і поточна розвʼязана ідентичність розділені: перше у
`vehicle_identity_observation` (дописування), друге у `mi_vm.resolved_
identity(_dimension)` (нова версія на новий набір доказів). Це правильна
конструкція.

Що у мосту слабке:

- **Хибний декод стає високою довірою без контр-доказу** (Area 12).
- **Хибна аукціонна подія стає ринком продажу** (Area 9): ЗАЗ Sens отримає
  `market_sold = US`.
- **Час події = час знання** для всіх чотирьох видів: міст ставить
  `decoded_at` (це `vehicles.first_seen_at`) і `captured_at` знімка в обидві
  колонки. Для декоду це припустимо, для аукціону міст бере `sale_date`,
  але він порожній.
- **Джерело `check_inference` не є незмінним записом**: `reports.data`
  оновлюється клієнтом і видаляється користувачем; корінь `report:<id>` може
  вести в нікуди. `equipment_observation.check_id` при видаленні звіту стає
  null через FK, тобто та сама втрата провенансу вже закладена і в старий шар
  знань.
- Міст не пише: пробіг (адаптер бере його зі знімків напряму), ціну,
  ушкодження, компоненти, права. Це не помилка, а межа Phase 7.

## 5. Blockers

**B1. Ключ аукціонної події дозволяє перенести подію на іншу машину.**
`auction_events` PK `(auction_house, lot_id)`, запис через
`on_conflict=auction_house,lot_id` з `resolution=merge-duplicates` і `vin` у
тілі. Парсер віддає нестабільний lot id (`45129191` для пʼяти VIN зі
stat.vin, `evidence_type = vin_scoped`). Один хибний рядок уже записаний.
Наступний збіг ключа з іншим VIN перепише `vin` події без сліду. Порушує
одразу два інваріанти головного питання: змішування машин і тихий
перезапис. PROVEN_BY_BOTH. Поки не сталося жодного міжмашинного перезапису
(0 випадків), але умова відтворюється кожним Check машини зі stat.vin.

Інших блокерів немає. Втрат історичних даних, які вже сталися і не
відновлюються, дві, і обидві не архітектурні: 158 легасі-знімків без
бінарників кадрів і 157 без `raw_page_text`. Це наслідок того, що Vehicle
Memory доростала поетапно, а не помилка поточної конструкції.

## 6. Later items

| Пункт | Рішення | Чому |
|---|---|---|
| **VM-4** `listing_published_at` | LATER | жодне поточне джерело не віддає дату публікації у парс; колонка без писаря нічого не дасть. Коли зʼявиться джерело з датою, це одна аддитивна колонка |
| **VM-4** `provenance_root` на знімку і події | LATER | адаптер будує корінь детерміновано з `listing_id` і `(house, lot_id)`, і на реальних даних дзеркала лота згорнуті правильно; колонка знадобиться, коли джерело саме повідомить походження (переписаний лот у оголошенні) |
| **VM-5** мʼяке виправлення для `vehicle_snapshots` і `auction_events` | **SHOULD FIX BEFORE USER-FACING HISTORY** | потреба доведена даними: хибний пробіг Porsche і хибна подія ЗАЗ Sens не мають чесного виходу |
| Досохранення кадрів і сирого тексту легасі-знімків | LATER, одноразовий backfill | 158 знімків, 26 VIN без жодного бінарника; URL площадки не вічні |
| Нестабільний витяг галереї BaT створює хибні «зміни оголошення» | LATER | шум, не втрата |
| `readSnapshots` мертвий (`created_at`) | LATER для памʼяті, але це продуктовий дефект: історичні точки пробігу ніколи не доходять до рішення | лежить у `api/check.js`, не у схемі |
| Службові зображення BaT як кадри оголошення | LATER | фільтр витягу, не памʼять |
| `seller_claims.ai_discrepancies` перезаписується | LATER | інтерпретація, не сирий доказ; сирий текст лишається |
| Мутація `last_seen_at`/`seen_count` знімка | NOT A PROBLEM | зміст знімка не чіпається; для точного зрізу ці поля треба ігнорувати |
| `reports` як джерело `check_inference` мутабельне і видаляється | LATER | копіювати `trim_text` у `source_ref` спостереження при записі, тоді доказ не залежить від життя звіту |
| `equipment_observation` без слотів заводське/поточне | LATER | компонентний шар це `component_observation`, обладнання лишається спостереженням знімка |
| Час події для `equipment_observation`, `issue_observation`, `snapshot_photos` | LATER | у цих таблиць час події збігається з часом знімка; окремої колонки не бракує, поки джерело не дає дати |
| Лише одна аукціонна подія на VIN доходить до продукту | LATER | читання, не сховище |

## 7. Data-loss / overwrite risks

| # | Де | Що втрачається | Рівень доказу | Пріоритет |
|---|---|---|---|---|
| 1 | `auction_events` merge-duplicates за `(house, lot)` | `vin` події при колізії lot id; попередні дата, одометр, ушкодження при повторному розборі | PROVEN_BY_BOTH | BLOCKER (колізія), SHOULD FIX (перезапис полів) |
| 2 | `auction_checks` merge за `vin` | попередній результат пошуку; єдине сховище для `found` без канонічного лота (8 із 12) | PROVEN_BY_REAL_DATA | SHOULD FIX |
| 3 | `vehicle_snapshots.seller_claims` PATCH | попередня AI-інтерпретація того самого знімка | PROVEN_BY_BOTH (69 знімків) | LATER |
| 4 | `vehicles` merge на місці | історія атрибутів кешу; `make` оголошення перекриває декод | PROVEN_BY_BOTH | NOT A PROBLEM (історія у спостереженнях) |
| 5 | `listings.current_status/last_*` | історія статусу поза знімками | PROVEN_BY_CODE_SCHEMA | NOT A PROBLEM |
| 6 | 158 легасі-знімків без `snapshot_photos` | кадри після зникнення з CDN | PROVEN_BY_REAL_DATA | LATER (backfill) |
| 7 | 157 легасі-знімків без `raw_page_text`, 166 без `seller_text` | можливість повторного розбору сильнішою моделлю; розсуд «парсер чи продавець» для `WBAJA9C5XJB033667` уже неможливий | PROVEN_BY_REAL_DATA | вже сталося, не відновлюється |
| 8 | Check, який падає до `observeListing` (404, блокування) | жодного знімка, факт зникнення оголошення | PROVEN_BY_CODE_SCHEMA | LATER |
| 9 | `reports` видаляє користувач; `check_id` у `equipment_observation` стає null | провенанс `check_inference` і `check_id` | PROVEN_BY_CODE_SCHEMA | LATER |
| 10 | `vm_observations` 3.6 `limit 1` | попередні пробіги не бачить резолвер | PROVEN_BY_CODE_SCHEMA | SHOULD FIX (для хронології) |
| 11 | помилка парсера як спостереження без виправлення | не втрата, а незнімна хибна історія | PROVEN_BY_REAL_DATA | SHOULD FIX (VM-5) |

## 8. Provenance risks

1. Переписане джерело як незалежне: carsniper як «історичний доказ» того
   самого кадру (PROVEN_BY_REAL_DATA). Механізму спорідненості між
   `snapshot_photos.event_key` і `listing` немає; хеш кадру збігається, але
   ніхто його не порівнює.
2. Агрегатори класифайдів (carsniper, stat.vin без дому) визнаються
   «знайденим аукціонним записом» з `identity.confidence = high`.
   PROVEN_BY_REAL_DATA (8 записів кешу).
3. `lot_id` з `evidence_type = vin_scoped` на дзеркалі не є ідентифікатором
   лота, а стає ключем події. PROVEN_BY_REAL_DATA.
4. Хибний декод NHTSA для не-американських VIN пишеться як `high`.
   PROVEN_BY_REAL_DATA (2 машини).
5. Корінь `report:<id>` вказує на мутабельний документ користувача.
   PROVEN_BY_CODE_SCHEMA.
6. `event_key = 'COPART'` без lot id (8 кадрів `WBAJE7C34HG887901`): доказ
   привʼязаний до дому, а не до події. PROVEN_BY_REAL_DATA.
7. Позитивно: дзеркала одного лота згорнуті в один корінь `auction:COPART:
   <lot>`, `record.field_provenance` зберігає джерело і тип доказу для
   кожного поля окремо, кадри лота проходять `photoHasProvenance` (VIN або
   lot у адресі). Це вже краще за більшість того, що є на ринку.

## 9. Chronology risks

1. Аукціонний час події не заповнюється: 0 із 4. Пізно знайдена подія ляже
   датою знаходження. PROVEN_BY_REAL_DATA.
2. Оголошення не має часу події за конструкцією (VM-4). Старе оголошення,
   знайдене сьогодні, виглядатиме сьогоднішнім. PROVEN_BY_CODE_SCHEMA.
3. Пробіг розвʼязується за рангом, не за часом: аукціон 70 проти оголошення
   50. Історичне стає поточним. PROVEN_BY_CODE_SCHEMA.
4. Помилка парсера як подія хронології (Porsche 93 000 -> 153 000).
   PROVEN_BY_REAL_DATA.
5. Нестабільний витяг галереї як подія хронології (Subaru 120 -> 68 -> 16
   кадрів). PROVEN_BY_REAL_DATA.
6. Міст ставить `observed_at = ingested_at` для всіх спостережень; для
   `market_operated` це `captured_at` знімка, що коректно, для `model_year`
   це `vehicles.first_seen_at`, що є часом знання. Різниця зрізів існує
   лише у схемі, у даних її немає. PROVEN_BY_REAL_DATA (18 із 18).
7. `last_seen_at`/`seen_count` несуть майбутнє у минулий рядок.
   PROVEN_BY_CODE_SCHEMA.
8. Читання хронології у продукті зламане (`readSnapshots`). PROVEN_BY_BOTH.

## 10. Real VIN case studies

### 10.1. Tesla Model S P85D `5YJSA1H23FFP69703`: повторні Check

Джерело: auto.ria `40185075`, 17 000 USD, 167 000 км.
Vehicle `788c388f…`, Listing `2dd73c09…`, 32 успішні Check, 1 збережений звіт.
Знімки: 27 без відбитка з 07:37 до 12:10 2026-09-03 (кожен Check = рядок,
без кадрів у `snapshot_photos`, без сирого тексту), потім один знімок
`lf-v1:b7eed177…` з `seen_count = 15` і `last_seen_at` 2026-09-12.
Спостереження: `model_year 2015` (декод, high), `version P85D`
(check_inference, low, корінь `report:4f90ef5b…`), `market_operated UA`
(listing). Розвʼязана ідентичність одна, часткова (версія без VMY).
Комплектація 282 рядки на 114 опцій (27 легасі-знімків множили).
Історичні кадри: 8, `autoria_history`.
Збережено: усе з 12:22 2026-09-03, ідемпотентно. Втрачено: бінарники 27
ранкових галерей (лише URL), сирий текст тих самих знімків. Для історії
машини ці 27 рядків це шум одного дня, а не історія.

### 10.2. BMW 530i xDrive `WBAJE7C34HG887901`: аукціонна подія

auto.ria `40359409`, 31 900 USD, 160 000 км. 11 Check, 15 знімків (14
легасі), 1 звіт. Подія `(COPART, 49495925)` з дзеркала vincheck.by:
одометр 98 997 mi, статус `unknown`, `Front end` / `Side`, **`sale_date`
null**, 20 кадрів у `record`, 8 у `snapshot_photos` з `event_key =
'COPART'` (без lot id: на момент запису кадрів lot був невідомий).
`vm_observations`: пробіг 160 000 (оголошення) і 159 320 (лот, `observed_at`
null). Резолвер віддасть 159 320 як поточний (ранг 70 > 50).
Збережено: подія, її провенанс по полях, кадри лота як докази. Втрачено:
дата продажу (не витягнута), звʼязок кадрів з конкретним лотом. Ризик:
повторний розбір лота перепише подію.

### 10.3. Porsche Cayenne GTS `WP1ZZZ92ZDLA45155`: історія ціни і пробігу, еталон MI

auto.ria `39577545`. 11 Check, 8 знімків (7 легасі). Ціна 24 999 -> 23 500
-> 22 700 USD у трьох окремих рядках. Пробіг 93 000 у пʼяти знімках (26..27.08),
153 000 з 31.08. Текст сторінки в усіх знімках містить «93 тис.км | 153
тис.км | 153 тис. км | 147 тис. км | 80 тис. км»: перше число з блоку
схожих оголошень, старий парсер брав його. Спостереження: рік 2013
(декод), версія GTS (check_inference), ринок UA. Ідентичність часткова:
Cayenne GTS 958.1, кандидатний VMY 153, пакет 8 APPLICABLE, 23 CONDITIONAL
(Phase 7.7 stage-1). Зріз на 2026-08-30 повертає пробіг 93 000.
Збережено: справжня історія ціни; докази для викриття помилки парсера
(текст сторінки). Втрачено: нічого. Не виразимо: позначка «93 000 хибне».

### 10.4. Subaru Impreza WRX `JF1GG29674G821516`: BaT, нестабільна галерея

bringatrailer, ключ `url:<sha1>`, `source_listing_id` відсутній. 15 Check,
5 знімків із 5 відбитками: ціна 2 888 -> 4 992 (торги), кадри 120, 120,
120, 68, 16. 6 знахідок `issue_observation`. Службові зображення BaT
(шаблони, банери) у галереї, спільні з Audi `WAUML54B53N103131` і пʼятьма
оголошеннями без VIN: `photo_assets` 1b587c20…, 21e24227…, 60c9e7b6…,
82dbae35…, 8666d43e…, 95766ff6…. Машини не змішані (звʼязки окремі),
але хронологія кадрів містить не-кадри, а хронологія оголошення містить
три «зміни», яких не було.

### 10.5. ЗАЗ Sens `Y6DT1311070334890` і VW Touareg 2025 `WVGZZZCR6TD014831`: хибні докази

ЗАЗ: 1 Check, подія `(COPART, 45129191)` зі stat.vin: без кадрів, одометра,
дати; lot id той самий, що у чотирьох інших VIN зі stat.vin. Подія хибна.
Міст при наступному Check запише `market_sold = US`. Позначити недійсною
нема чим.
Touareg: `auction_checks.found` з carsniper.com.ua, 1 «історичний» кадр,
хеш якого дорівнює кадру власного оголошення. Один доказ, два ключі,
жодного спільного кореня.

### 10.6. BMW `WBAJA9C5XJB033667`: нерозвʼязна розбіжність

4 легасі-знімки, 2 звіти: 104 000 км 24..26.08, потім 90 000 км 26.08.
Перша згадка на сторінці змінилась. Правка продавця чи інший блок:
UNKNOWN, `raw_page_text` порожній. Це ілюстрація ціни втрати сирого
тексту: доказ був на сторінці, у памʼяті його немає.

## 11. Decision Engine readiness

| Сигнал | Стан | Підстава |
|---|---|---|
| хронологія пробігу | PARTIAL | дані у знімках і подіях є; немає позначки хибних точок, немає часу події аукціону, резолвер бере одну точку, продуктове читання зламане |
| хронологія ціни | READY (дані), PARTIAL (споживач) | знімки несуть ціну і валюту; жодного споживача і жодного часу події |
| хронологія аукціонів | NOT READY | дата події не заповнюється, ключ подій ненадійний, одна подія на VIN у читанні |
| хронологія власників | NOT READY | сутності немає; є `seller_meta` знімка і держномер |
| хронологія ушкоджень | PARTIAL | ушкодження лота і `historical_visual_cache` (версійований, з consensus) є; поточний Vision лише у звіті; часу події немає |
| хронологія кадрів | PARTIAL | кадри, позиція, kind, event_key, хеш; час лише знання; не-кадри у галереї; легасі без бінарників |
| хронологія компонентів | NOT READY | таблиці і адаптер готові, 0 рядків, писаря немає |
| хронологія оголошень | PARTIAL | оголошення і знімки є; зникнення і повторна поява не виражаються; хибні зміни від витягу |
| конфлікти | PARTIAL | резолвер дає статуси і сторони для ідентичності; для пробігу, ціни, кадрів конфлікт ніхто не рахує |
| провенанс | PARTIAL | корінь є у спостереженнях, детермінований для знімків і подій; переписані джерела не згортаються |
| покриття / довіра | PARTIAL | `observation_coverage` по знімку (`seller_text`, `listing_data`, `visual`), `confidence` у спостереженнях; агрегованої довіри по VIN немає |

Рішення не повинно ходити у десяток сирих таблиць саме. Сьогодні воно і не
ходить: єдиний читач історії це `mi.vm_observations`, і він вже нормалізує
чотири домени у один формат. Це готовий зародок Vehicle History Resolver.

## 12. Minimal amendments proposal

Жодне не реалізоване. Порядок за пріоритетом.

### A1. Подія аукціону не змінює VIN (BLOCKER)

- Проблема: `writeAuctionEvent` робить upsert за `(house, lot)` з `vin` у
  тілі; парсер дає нестабільний lot id.
- Чому важливо: подія однієї машини мовчки стає подією іншої.
- Найменша зміна: у `writeAuctionEvent` перед upsert читати наявний рядок
  (вже читається для `source_urls`) і, якщо `vin` відрізняється, не писати
  і логувати конфлікт; lot id з `evidence_type = vin_scoped` на не-лотових
  адресах не вважати канонічним і не створювати з нього подію. Хибний рядок
  ЗАЗ Sens позначити недійсним після A3.
- Таблиці/функції: `api/check.js writeAuctionEvent`, `api/auction.js
  extractLotMeta`.
- Міграція: **ні** (код). Опційно пізніше unique `(auction_house, lot_id,
  vin)` замість PK, але це зміна PK, і її не варто робити зараз.

### A2. Аукціонна подія не перезаписується, а версіонується (SHOULD FIX)

- Проблема: `merge-duplicates` затирає дату, одометр, ушкодження.
- Чому важливо: виправлений розбір знищує попередній; історія знання про
  подію зникає.
- Найменша зміна: писати лише порожні поля (`coalesce` на боці функції або
  `resolution=ignore-duplicates` плюс окремий PATCH лише порожніх колонок);
  повний новий розбір класти у `record.revisions[]` дописуванням.
- Таблиці: `auction_events`. Міграція: **ні**.

### A3. VM-5: мʼяке виправлення для знімків і подій (SHOULD FIX)

- Проблема: хибне спостереження не позначити.
- Чому важливо: Porsche 93 000, ЗАЗ Sens.
- Найменша зміна: `invalidated_at timestamptz`, `invalidated_reason text` на
  `vehicle_snapshots` і `auction_events`; `mi.vm_observations` і всі читачі
  відсіюють недійсне; розширити `mi.vm_invalidate`.
- Міграція: **так**, аддитивна, дві колонки на дві таблиці.

### A4. Час події для аукціону і для знімка (SHOULD FIX для аукціону, LATER для знімка)

- Проблема: `sale_date` не витягується; у знімка колонки немає.
- Найменша зміна: аукціон: витяг `sale_date` з дзеркал (парсер, без схеми);
  поки дати немає, `vm_observations` має віддавати `observed_at = null`, а не
  `first_seen_at`, щоб не видавати час знання за час події. Знімок: VM-4
  колонка `listing_published_at`, коли зʼявиться джерело.
- Міграція: ні для аукціону; так (одна колонка) для знімка, пізніше.

### A5. Пробіг: час важливіший за ранг (SHOULD FIX)

- Проблема: `resolve_dimension` для `scalar` обирає за рангом; адаптер
  віддає одну точку зі знімків.
- Найменша зміна: для `mileage_km` адаптер віддає всі точки з датами; вимір
  «поточний пробіг» бере найпізніше за часом події серед джерел не нижче
  порога, решта у `supporting` як хронологія. Це зміна `vm_observations` 3.6
  і правило у `resolve_dimension` для scalar, без зміни схеми.
- Міграція: **ні** (нова версія функцій, forward-only, як 024).

### A6. Переписане джерело згортається до кореня (SHOULD FIX)

- Проблема: carsniper/stat.vin як незалежний історичний доказ.
- Найменша зміна: `preservePhotos` для `historical_evidence` перевіряє, чи
  хеш уже привʼязаний до `listing`-кадру того самого `vehicle_id`, і тоді
  пише `event_key = 'copy_of_listing'` (або не пише зовсім); джерела з
  `HISTORICAL_DOMAINS` без розпізнаного дому не отримують `status = found`.
- Міграція: **ні**.

### A7. Декод без марки і моделі не дає високої довіри (SHOULD FIX)

- Проблема: `ModelYear` від NHTSA при відсутності `Make`/`Model` це здогадка
  за десятим символом з хибним століттям.
- Найменша зміна: міст пише `model_year` з `vin_decoder` лише коли декод
  дав `Make` і `Model`; інакше `confidence = low` або не пише; рік оголошення
  писати як `listing`, ранг 40, щоб розбіжність була видимою.
- Міграція: ні (нова версія `ingest_identity_from_check`).

Разом: одна аддитивна міграція (A3) і пʼять правок коду або версій функцій.
Жодного перепроєктування.

## 13. User-facing Vehicle History GO / NO-GO

**GO на проєктування після A1, A3, A5, A6.** A2, A4, A7 можуть іти
паралельно з проєктуванням. Без A1 історія може показати чужу подію; без A3
історія покаже хибний відкат і хибний аукціон і не матиме способу це
прибрати; без A5 «поточний пробіг» може бути аукціонним; без A6 один кадр
буде і оголошенням, і історичним доказом.

Що для користувача можна показати вже сьогодні без ризику: історію ціни,
історію знімків одного оголошення з кадрами, факт аукціонної події з
провенансом по полях (без дати). Що не можна: хронологію пробігу як
таку, кілька подій, компоненти, права.

## 14. Final architecture recommendation

Так, цільовий ланцюг має бути саме таким:

```
сирі докази (знімки, події, кадри, спостереження)
  -> Vehicle Memory (дописувальні таблиці з обома часами і коренем)
  -> детермінований Vehicle History Resolver / Compiler
  -> Vehicle History Pack
  -> Score / Confidence / Verdict / LLM
```

Скільки вже є:

| Шар | Стан |
|---|---|
| сирі докази | є: знімки з сирим текстом (з 2026-08-31), кадри з хешами, події з провенансом по полях, `historical_visual_cache` |
| Vehicle Memory | є для ідентичності і компонентів (обидва часи, корінь, виправлення); частково для оголошень, кадрів, аукціонів (лише час знання, без виправлення) |
| Resolver | є для ідентичності (`mi.resolve_identity` з дедупом за коренем, конфліктами, слотами); зародок для скалярів; нічого для хронологій ціни, кадрів, подій |
| Compiler / Pack | є для знань про модель (`mi.compile_pack`); для історії машини немає |
| Decision Engine | читає лише `reports.data` і `_meta`; єдина спроба читати історію (`readSnapshots`) зламана |

Оцінка: зі стека існує близько 60 % за обсягом і 80 % за принципами.
`mi.vm_observations` уже є тим місцем, з якого росте Vehicle History
Resolver: він нормалізує чотири домени в один формат, розрізняє зрізи і
несе корінь. Бракує не нової архітектури, а трьох речей: чесного часу
події там, де він є у джерелі, мʼякого виправлення у двох старих таблицях
і правила «час важливіший за ранг» для змінних у часі вимірів.

## Unproven Vehicle History Invariants

Жоден із цих експериментів під час аудиту не запускався.

| # | Інваріант | Чому даних недостатньо | Мінімальний експеримент | VIN | Обсяг | Що порівняти | PASS | FAIL |
|---|---|---|---|---|---|---|---|---|
| U1 | той самий VIN на другій площадці дає друге оголошення тієї самої машини | максимум 1 оголошення на машину | Check того самого VIN на іншій площадці (olx, rst, dealer) | будь-який уже перевірений, напр. Porsche `WP1ZZZ92ZDLA45155`, якщо є друге оголошення | 1 Check | `listings` по `vehicle_id`; `vehicles` count по VIN; `vehicle_snapshots.vehicle_id` | 2 оголошення, 1 машина, знімки обох оголошень з одним `vehicle_id` | 2 рядки `vehicles` або оголошення без `vehicle_id` |
| U2 | знайдена пізніше подія з датою лягає часом події, а не часом знання | `sale_date` null у всіх подіях | Check VIN, лот якого має дату на дзеркалі, або ручний запис події з датою через SQL на стенді | VIN з відомим Copart-лотом і датою | 1 Check або 1 insert | `auction_events.sale_date` не null; `vm_observations(vin, '<дата+1д>', null)` містить подію, `vm_observations(vin, null, '<дата+1д>')` не містить | обидва зрізи різняться | `sale_date` null або зрізи однакові |
| U3 | новий доказ дає новий `resolved_identity`, старий лишається | по 1 рядку на VIN | після появи нового спостереження (напр. другий звіт з іншою версією) запустити тінь | Tesla або BMW `WBAJB9C50JB049616` | 1 Check + 1 тінь | `mi_vm.resolved_identity` по VIN: 2 рядки, різні `identity_version`; перший незмінний | 2 рядки | 1 рядок зі зміненими вимірами |
| U4 | два звіти з різними версіями каталогу дають `conflicted`, обидва спостереження живі | 0 конфліктів у даних | Check VIN, де LLM назве іншу версію, ніж раніше | BMW G30 з написом `540i` проти `M550i` | 1 Check | `vehicle_identity_observation` 2 рядки `version`; вимір `version` = `conflicted`, `candidates` 2 | так | один рядок або `confirmed` |
| U5 | декод перебиває `check_inference` | 0 рядків `version` від `vin_decoder` | VIN, чий `nhtsa.Series/Trim` збігається з аліасом каталогу | Tesla з `Trim = P85D` у vPIC, якщо є | 1 Check | вимір `version`: `basis = vin_decoder`, `conflicting` містить `check_inference` | так | `basis = check_inference` |
| U6 | заміна компонента лишає заводський слот і змінює поточний | 0 рядків компонентів у продакшні | один виклик `mi.vm_record_component` на стенді або перший продуктовий писар | Tesla `5YJSA1H23FFP69703`, роль `mcu` | 2 insert (factory, replacement) | `identity_json.components`: `factory = MCU1`, `current = MCU2` | так | один слот або перезапис |
| U7 | виправлення не змінює історію | 0 виправлень | `mi.vm_invalidate` на стенді для хибного рядка | Porsche після A3 | 1 update | рядок існує з `invalidated_at`; `vm_observations` його не віддає; зріз до виправлення його теж не віддає (це очікувана межа: виправлення не має часу дії) | так | рядок зник або далі читається |
| U8 | повторний Check через місяці з новою ціною дає новий знімок, старий незмінний | усі зміни в межах днів | повторний Check оголошення, що змінилось | Audi Q5 `WA1BNAFY0J2236614` (3 ціни) | 1 Check | `vehicle_snapshots` по `listing_id`: +1 рядок, старі байт у байт ті самі (порівняти `md5(row_to_json)` без `last_seen_at/seen_count`) | так | зміна старого рядка |
| U9 | повторний розбір того самого лота не втрачає попередній | 1 розбір на подію | повторний Check `WBAJE7C34HG887901` після зміни парсера | той самий | 1 Check | `auction_events` до/після: `sale_date/odometer/damage` | після A2: старі значення збережені | перезапис (сьогоднішня поведінка, очікуваний FAIL) |
| U10 | колізія lot id не переносить подію | 1 хибний рядок | Check іншого VIN зі stat.vin, для якого дім розпізнається | будь-який VIN зі stat.vin з полем COPART на сторінці | 1 Check | `auction_events` де `lot_id = '45129191'`: `vin` | після A1: рядок ЗАЗ незмінний, нового не створено | `vin` змінився (сьогоднішня поведінка, очікуваний FAIL) |
| U11 | історичний пробіг не стає поточним | резолюція для BMW 887901 не запускалась | тінь для `WBAJE7C34HG887901` | той самий | 1 тінь (пише `resolved_identity`) | вимір `mileage_km`: значення і `basis` | після A5: 160 000, `listing`, аукціон у `supporting` | 159 320 (сьогоднішня поведінка, очікуваний FAIL) |
| U12 | зниклі оголошення виражаються у памʼяті | 404 не породжує знімка | Check адреси зниклого оголошення відомого VIN | Tesla, якщо оголошення зняте | 1 Check | `listings.current_status`, новий знімок `inactive` | статус `inactive` з часом | нічого не записано (сьогоднішня поведінка) |

## Що аудит свідомо не робив

Не створював міграцію 025, не змінював схеми, код, дані, не викликав
жодної функції, що пише (`resolve_from_memory`, `ingest_identity_from_
check`, `shadow_pack`), не запускав Check, не видаляв і не позначав хибні
рядки, не будував Vehicle History Pack, не чіпав Score і Verdict. Усі
поправки розділу 12 лишаються пропозиціями до окремого схвалення власника.
