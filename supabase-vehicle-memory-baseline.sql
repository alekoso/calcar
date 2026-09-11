-- CalCar Vehicle Memory: ВІДНОВЛЕНИЙ базовий DDL двох центральних таблиць.
--
-- Аудит Phase 6 знайшов, що `vehicle_snapshots` і `auction_events`
-- читаються і пишуться продакшн-кодом, але їхнього CREATE TABLE у
-- репозиторії не було: обидві створювались руками у Supabase, а файли
-- `supabase-vehicle-intelligence.sql` і `supabase-vehicle-memory-v1.sql`
-- лише додавали до них колонки.
--
-- Цей файл знятий із ЖИВОЇ продакшн-схеми 2026-09-11 (project
-- jzgnigrkexqnzmxujjex, PostgreSQL 17.6) читанням системного каталогу.
-- Нічого не перепроєктовано і нічого не змінено: структура, типи,
-- замовчування, обмеження, індекси і стан RLS відтворені як є.
--
-- Файл ідемпотентний і ЛИШЕ аддитивний. На продакшні він нічого не
-- змінює, бо всі обʼєкти вже існують. Його призначення: чиста база,
-- зібрана з репозиторію, має відтворювати схему, з якою працює код.
--
-- Порядок застосування: цей файл ПЕРЕД
-- `supabase-vehicle-intelligence.sql` і `supabase-vehicle-memory-v1.sql`.
--
-- Обидві таблиці мають RLS увімкненим і ЖОДНОЇ політики: доступ лише
-- через service role. Це навмисно і не послаблюється.

-- ---------- 1. vehicle_snapshots ----------
--
-- Незмінний стан оголошення на момент спостереження. Ключ сурогатний,
-- пошук іде по (vin, captured_at), (listing_id, captured_at),
-- (vehicle_id, captured_at) і по адресі. FK у таблиці немає жодного:
-- `report_id`, `vehicle_id` і `listing_id` це мʼякі посилання, і саме
-- тому знімок переживає видалення звіту.
--
-- Колонки 1..16 це базова таблиця; 17..19 додав
-- `supabase-vehicle-intelligence.sql` (пункт 1), 20..32 той самий файл
-- (пункт 3), 33..36 додав `supabase-vehicle-memory-v1.sql` (пункт 3).
-- Тут вони зведені разом, щоб чиста база збиралась одним проходом.

create table if not exists public.vehicle_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  captured_at           timestamptz not null default now(),
  vin                   text,
  plate                 text,
  source_url            text not null,
  source_domain         text not null,
  country               text,
  price_amount          numeric,
  price_currency        text,
  odometer_km           integer,
  year                  smallint,
  make                  text,
  model                 text,
  listing               jsonb not null default '{}'::jsonb,
  photos                jsonb not null default '[]'::jsonb,
  report_id             uuid,
  seller_text           text,
  listing_fields        jsonb,
  job_token             text,
  source_listing_id     text,
  listing_fingerprint   text,
  first_seen_at         timestamptz,
  last_seen_at          timestamptz,
  seen_count            integer,
  title                 text,
  location              text,
  seller_meta           jsonb,
  listing_status        text,
  photo_items           jsonb,
  photo_set_fingerprint text,
  seller_claims         jsonb,
  raw_page_text         text,
  vehicle_id            uuid,
  listing_id            uuid,
  parser_version        text,
  schema_version        text,
  constraint vin_shape check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$')
);
alter table public.vehicle_snapshots enable row level security;

create index if not exists snapshots_vin_time
  on public.vehicle_snapshots (vin, captured_at desc) where vin is not null;
create index if not exists snapshots_plate_time
  on public.vehicle_snapshots (plate, captured_at desc) where plate is not null;
create index if not exists snapshots_url_time
  on public.vehicle_snapshots (source_url, captured_at desc);
create index if not exists vehicle_snapshots_vin_captured
  on public.vehicle_snapshots (vin, captured_at desc);
create index if not exists vehicle_snapshots_listing
  on public.vehicle_snapshots (listing_id, captured_at desc);
create index if not exists vehicle_snapshots_vehicle
  on public.vehicle_snapshots (vehicle_id, captured_at desc);

-- ---------- 2. auction_events ----------
--
-- Подія аукціону. Ключ (auction_house, lot_id): один лот це одна подія.
-- `sale_date` це час ПОДІЇ, `checked_at` і `first_seen_at` це час нашого
-- знання про неї. Саме тому знайдений у 2026 лот 2021 року лягає у
-- історію правильною датою.

create table if not exists public.auction_events (
  auction_house    text not null,
  lot_id           text not null,
  vin              text not null,
  sale_date        date,
  odometer_value   integer,
  odometer_unit    text not null default 'unknown',
  odometer_status  text not null default 'unknown',
  primary_damage   text,
  secondary_damage text,
  title_status     text,
  source_urls      jsonb not null default '[]'::jsonb,
  record           jsonb not null default '{}'::jsonb,
  first_seen_at    timestamptz not null default now(),
  checked_at       timestamptz not null default now(),
  primary key (auction_house, lot_id),
  constraint auction_events_odometer_unit_check
    check (odometer_unit = any (array['mi', 'km', 'unknown'])),
  constraint auction_events_odometer_status_check
    check (odometer_status = any (array['actual', 'not_actual', 'exempt', 'unknown']))
);
alter table public.auction_events enable row level security;

create index if not exists auction_events_vin on public.auction_events (vin);
