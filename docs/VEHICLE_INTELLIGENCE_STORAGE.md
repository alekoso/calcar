# Vehicle Intelligence Storage: технічний контракт

Код: `api/vehicle-memory.js` (сутності і REST), `api/check.js` (пайплайн),
схема: `supabase.sql` + `supabase-vehicle-intelligence.sql` + `supabase-vehicle-memory-v1.sql`.
Тести: `vehiclememorytest.js`, `durabletest.js`.

## Сутності

| Сутність | Таблиця | Ключ | Що це |
|---|---|---|---|
| Vehicle | `vehicles` | `vin` (PK, UNIQUE), `id` uuid | одна canonical сутність на VIN: марка, модель, рік, покоління, декод NHTSA із `decoder_version` |
| Listing | `listings` | `(source, source_listing_id)` UNIQUE | одне оголошення площадки; `vehicle_id` може бути null, поки VIN не знайдено |
| Snapshot | `vehicle_snapshots` | `id`, `listing_id`, `vehicle_id` | immutable стан оголошення: ціна, пробіг, ПОВНИЙ текст продавця, `raw_page_text`, `photo_items`, поля площадки, локація, продавець, статус, `listing_fingerprint`, `parser_version`, `schema_version` |
| PhotoAsset | `photo_assets` + Storage bucket `vehicle-evidence` (private) | `content_hash` (SHA-256) UNIQUE | один бінарник на hash, `storage_status`: `stored` / `metadata_only` / `unavailable` |
| SnapshotPhoto | `snapshot_photos` | `(snapshot_id, kind, position)` UNIQUE | кадр у знімку: позиція, URL на момент спостереження, `photo_identity`, `kind` `listing` або `historical_evidence`, `event_key` |
| Report | `reports`, `check_jobs` | `id` / `token` | user-specific: рішення, чат, контекст покупця; посилається на `_meta.vehicle_id`, `listing_id`, `snapshot_id` |

## Правила

- **one VIN -> one Vehicle.** `upsertVehicle` з `on_conflict=vin`, null не затирає відоме. Друге оголошення того самого VIN це новий Listing, не новий Vehicle.
- **source + source_listing_id -> Listing.** Без id площадки ключем стає `url:<sha1 нормалізованої адреси>`.
- **Listing без VIN живе.** Знімки копляться з `vehicle_id = null`. Коли VIN знайдено, `attachVehicleToListing` заповнює порожні `vehicle_id` у listing і його знімках. Це єдиний дозволений UPDATE старих знімків: зміст не змінюється.
- **Snapshot immutable.** Новий рядок лише коли `listingFingerprint` (ціна, валюта, пробіг, текст продавця, впорядковані `photoIdentity` кадрів, комплектація площадки, факти історії, рік, назва, статус) відрізняється від останнього знімка цього Listing. Ринковий контекст у відбиток не входить.
- **Unchanged fingerprint -> dedup.** Оновлюються лише `last_seen_at` і `seen_count` знімка і listing. 100 Check однієї незмінної сторінки = 1 знімок.
- **Exact photo hash -> one binary.** Кадр завантажується з публічної адреси площадки без обходу захисту, хешується SHA-256; існуючий hash дає лише звʼязок. Зниклий (404) або захищений (401/403) кадр лишає `unavailable` з URL, ідентичністю і позицією. Perceptual-дедуп не робиться: змінена версія кадру теж частина історії.
- **Old evidence never overwritten.** Після AI у знімок лише дописується `seller_claims.ai_discrepancies`. Raw-доказ (текст продавця, повний текст сторінки, кадри) важливіший за AI-інтерпретацію: старий текст можна проаналізувати повторно сильнішою моделлю.
- **Report != Vehicle Memory.** Персональне рішення, чат і памʼять користувача не потрапляють у shared-таблиці і не віддаються іншому користувачу.
- **Historical visual.** Один canonical набір історичних кадрів + одна нормалізована інтерпретація на `(vin, fingerprint кадрів, HISTORICAL_VISUAL_VERSION)`; сигнали, що піднімають тяжкість, приймаються лише з кадром і ознакою у `signal_evidence`, інакше `indeterminate`.

## Diff між знімками (майбутній UI, дані вже є)

Ціна: `price_amount`; пробіг: `odometer_km`; текст: `seller_text`; кадри: `snapshot_photos` за `photo_asset_id` і `photo_identity`; заяви: `seller_claims`; статус: `listing_status` і `listings.current_status`; повторна поява: новий Listing того самого `vehicle_id`; зміна продавця/площадки: `seller_meta`, `listings.source`.

## Нове поле оголошення

Додати у `snapshotRow`; якщо воно змінює стан оголошення, додати у `listingFingerprint` і підняти `LISTING_FINGERPRINT_VERSION`. Нове поле знімка публічним у звіті не стає: `_meta` віддається лише через allowlist `api/share.js`.
