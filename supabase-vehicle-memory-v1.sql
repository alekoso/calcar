-- CalCar Vehicle Memory V1: одна canonical сутність на VIN і обʼєктивна
-- історія авто в часі. Файл ідемпотентний і ЛИШЕ аддитивний: нові таблиці,
-- нові колонки, приватний bucket, заповнення ПОРОЖНІХ звʼязків старих
-- рядків. Нічого не видаляється, не перейменовується, типи не змінюються,
-- зміст старих знімків не переписується, RLS не послаблюється.

-- 1. Vehicle: canonical id, покоління, службові часи (vin лишається PK і UNIQUE)
alter table vehicles add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_id_key') then
    alter table vehicles add constraint vehicles_id_key unique (id);
  end if;
end $$;
alter table vehicles add column if not exists generation text;
alter table vehicles add column if not exists created_at timestamptz not null default now();
alter table vehicles add column if not exists updated_at timestamptz not null default now();

-- 2. Listing: одне оголошення площадки; може жити без VIN і привʼязатись пізніше
create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  vin text,
  source text not null,
  source_listing_id text not null,
  url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_status text,
  snapshots_count integer not null default 0,
  seen_count integer not null default 1,
  last_snapshot_id uuid,
  last_fingerprint text,
  created_at timestamptz not null default now(),
  unique (source, source_listing_id)
);
create index if not exists listings_vehicle on listings (vehicle_id);
create index if not exists listings_vin on listings (vin);
alter table listings enable row level security;

-- 3. Snapshot: звʼязки з Vehicle і Listing, версії парсера і схеми
alter table vehicle_snapshots add column if not exists vehicle_id uuid;
alter table vehicle_snapshots add column if not exists listing_id uuid;
alter table vehicle_snapshots add column if not exists parser_version text;
alter table vehicle_snapshots add column if not exists schema_version text;
create index if not exists vehicle_snapshots_listing on vehicle_snapshots (listing_id, captured_at desc);
create index if not exists vehicle_snapshots_vehicle on vehicle_snapshots (vehicle_id, captured_at desc);

-- 4. PhotoAsset: один бінарник на content hash; SnapshotPhoto: кадр у знімку
create table if not exists photo_assets (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null unique,
  source_url text,
  provenance text,
  mime_type text,
  width integer,
  height integer,
  byte_size integer,
  storage_path text,
  storage_status text not null default 'metadata_only',
  first_vehicle_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists photo_assets_vehicle on photo_assets (first_vehicle_id);
alter table photo_assets enable row level security;

create table if not exists snapshot_photos (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references vehicle_snapshots(id),
  vehicle_id uuid,
  listing_id uuid,
  photo_asset_id uuid references photo_assets(id),
  kind text not null default 'listing',
  event_key text,
  position integer not null,
  source_url_at_observation text,
  photo_identity text,
  storage_status text,
  reason text,
  observed_at timestamptz not null default now(),
  unique (snapshot_id, kind, position)
);
create index if not exists snapshot_photos_asset on snapshot_photos (photo_asset_id);
create index if not exists snapshot_photos_vehicle on snapshot_photos (vehicle_id);
create index if not exists snapshot_photos_identity on snapshot_photos (photo_identity);
alter table snapshot_photos enable row level security;

-- 5. Приватний bucket для evidence-кадрів: доступ лише service role
insert into storage.buckets (id, name, public) values ('vehicle-evidence', 'vehicle-evidence', false)
  on conflict (id) do nothing;

-- 6. Заповнення ПОРОЖНІХ звʼязків старих даних (зміст рядків не чіпається)
-- 6а. Vehicle для кожного VIN, який уже бачили (без декодера: наступний Check декодує)
insert into vehicles (vin, make, model, year, first_seen_at, last_seen_at, snapshots_count)
select s.vin, min(s.make), min(s.model), min(s.year), min(s.captured_at), max(coalesce(s.last_seen_at, s.captured_at)), count(*)
from vehicle_snapshots s where s.vin is not null group by s.vin
on conflict (vin) do nothing;
-- 6б. Listing для кожної пари (площадка, id оголошення) зі старих знімків
insert into listings (vehicle_id, vin, source, source_listing_id, url, first_seen_at, last_seen_at, current_status, snapshots_count)
select v.id, max(s.vin), lower(s.source_domain), coalesce(s.source_listing_id, substring(s.source_url from '_(\d{5,})\.html')),
       min(s.source_url), min(s.captured_at), max(coalesce(s.last_seen_at, s.captured_at)), 'unknown', count(*)
from vehicle_snapshots s left join vehicles v on v.vin = s.vin
where s.source_domain is not null and coalesce(s.source_listing_id, substring(s.source_url from '_(\d{5,})\.html')) is not null
group by v.id, lower(s.source_domain), coalesce(s.source_listing_id, substring(s.source_url from '_(\d{5,})\.html'))
on conflict (source, source_listing_id) do nothing;
-- 6в. звʼязки знімків: лише там, де вони порожні
update vehicle_snapshots s set vehicle_id = v.id from vehicles v where s.vehicle_id is null and s.vin = v.vin;
update vehicle_snapshots s set listing_id = l.id from listings l
  where s.listing_id is null and lower(s.source_domain) = l.source
    and coalesce(s.source_listing_id, substring(s.source_url from '_(\d{5,})\.html')) = l.source_listing_id;
update vehicle_snapshots set schema_version = 'snap-v0' where schema_version is null;
