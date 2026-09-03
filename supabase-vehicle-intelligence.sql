-- CalCar Vehicle Intelligence: аддитивна еволюція сховища.
-- Файл ідемпотентний, лише додає колонки; нічого не видаляє, не змінює
-- типи і не переписує старі рядки. Код працює і без цих колонок
-- (PostgREST відхилить лише вставку з невідомою колонкою, тому сервер
-- перед записом не покладається на них як на обовʼязкові).

-- 1. Повний знімок оголошення: через роки має бути видно, що САМЕ
--    показував і писав продавець. Старі рядки ніколи не перезаписуються:
--    кожен Check додає новий рядок vehicle_snapshots.
alter table vehicle_snapshots add column if not exists seller_text text;
alter table vehicle_snapshots add column if not exists listing_fields jsonb;
alter table vehicle_snapshots add column if not exists job_token text;
comment on column vehicle_snapshots.seller_text is 'Повний текст продавця з оголошення на момент знімка (до 3000 символів парсера)';
comment on column vehicle_snapshots.listing_fields is 'Структуровані поля площадки: комплектація, ціновий контекст, факти історії, покоління, посилання на архів, usa_photos';
comment on column vehicle_snapshots.job_token is 'Токен durable-аналізу, з якого зроблено знімок';

-- 2. Канонізація історичного візуалу: діагностика consensus-читання
--    (A/B, за конфлікту C) поверх того самого набору кадрів.
alter table historical_visual_cache add column if not exists reads_count integer;
alter table historical_visual_cache add column if not exists conflict_detected boolean;
alter table historical_visual_cache add column if not exists canonicalized_at timestamptz;
alter table historical_visual_cache add column if not exists extractor_version text;
alter table historical_visual_cache add column if not exists consensus jsonb;
comment on column historical_visual_cache.consensus is 'Матеріальні сигнали кожного читання і перелік полів, де читання розійшлися';

-- 3. Vehicle Memory V0: immutable-знімки з дедуплікацією за відбитком стану
--    оголошення і канонічна ідентичність авто.
alter table vehicle_snapshots add column if not exists source_listing_id text;
alter table vehicle_snapshots add column if not exists listing_fingerprint text;
alter table vehicle_snapshots add column if not exists first_seen_at timestamptz;
alter table vehicle_snapshots add column if not exists last_seen_at timestamptz;
alter table vehicle_snapshots add column if not exists seen_count integer;
alter table vehicle_snapshots add column if not exists title text;
alter table vehicle_snapshots add column if not exists location text;
alter table vehicle_snapshots add column if not exists seller_meta jsonb;
alter table vehicle_snapshots add column if not exists listing_status text;
alter table vehicle_snapshots add column if not exists photo_items jsonb;
alter table vehicle_snapshots add column if not exists photo_set_fingerprint text;
alter table vehicle_snapshots add column if not exists seller_claims jsonb;
alter table vehicle_snapshots add column if not exists raw_page_text text;
create index if not exists vehicle_snapshots_vin_captured on vehicle_snapshots (vin, captured_at desc);
comment on column vehicle_snapshots.listing_fingerprint is 'Детермінований відбиток стану оголошення (ціна, пробіг, текст продавця, кадри, поля площадки, статус). Той самий відбиток не створює новий рядок, лише продовжує last_seen_at';
comment on column vehicle_snapshots.photo_items is 'Впорядкований список кадрів: оригінальний URL і стабільна ідентичність (без CDN-хоста і query). Бінарники не копіюються: оригінал може зникнути';
comment on column vehicle_snapshots.raw_page_text is 'Повний текст сторінки на момент знімка (до 200 000 символів): raw-доказ важливіший за AI-інтерпретацію';

create table if not exists vehicles (
  vin text primary key,
  make text,
  model text,
  year smallint,
  model_year smallint,
  trim text,
  fuel text,
  nhtsa jsonb,
  decoder_version text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  snapshots_count integer not null default 0,
  last_listing_url text,
  last_source_listing_id text
);
alter table vehicles enable row level security;
comment on table vehicles is 'Канонічна ідентичність авто за VIN: декод NHTSA із версією декодера; наступний Check не декодує повторно';
