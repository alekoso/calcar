-- CalCar: шар накопичення знань (Model Knowledge + Observations + Derived).
-- Файл ідемпотентний: повторний запуск нічого не ламає і не чистить дані.
-- До Supabase застосовує ВЛАСНИК вручну; код цієї міграції сам не виконує.
--
-- RLS: на всіх таблицях увімкнений, політик НЕМАЄ свідомо: anon і
-- authenticated не бачать нічого, читає і пише лише service_role
-- (хук Check, recompute-скрипт, seed-скрипт).

-- ---------- 1. Словник опцій ----------

create table if not exists public.option_dict (
  option_id      uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  category       text not null check (category in
    ('comfort','interior','multimedia','assist','exterior','performance','safety','other'))
);
alter table public.option_dict enable row level security;

create table if not exists public.option_alias (
  alias_norm text primary key,          -- lower(trim(alias)): одне написання -> рівно одна опція
  alias      text not null,
  lang       text,
  option_id  uuid not null references public.option_dict(option_id) on delete cascade
);
alter table public.option_alias enable row level security;
create index if not exists option_alias_option on public.option_alias (option_id);

-- ---------- 2. Спостереження комплектації ----------

create table if not exists public.equipment_observation (
  id          uuid primary key default gen_random_uuid(),
  vin         text not null,
  snapshot_id uuid not null references public.vehicle_snapshots(id) on delete cascade,
  check_id    uuid references public.reports(id) on delete set null,
  option_id   uuid not null references public.option_dict(option_id),
  state       text not null check (state in ('PRESENT','ABSENT','UNKNOWN')),
  confidence  text check (confidence in ('high','medium','low')),
  -- retrofit=false НЕ означає factory: заводське походження підтверджує
  -- лише відповідний provenance/evidence (factory_status у звіті)
  retrofit    boolean not null default false,
  make text, model text, generation text,
  model_year smallint,
  -- ринки розділені: listing_market = де авто продається зараз,
  -- factory_market = ринок заводської конфігурації, ЛИШЕ якщо достовірно відомий
  listing_market text,
  factory_market text,
  engine text, trim text, drivetrain text,
  observed_at timestamptz not null default now(),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','rejected')),
  -- ідемпотентність у межах снапшота: повтор не плодить і не перезаписує;
  -- новий снапшот тієї ж машини створює нові рядки, старі недоторкані
  unique (vin, snapshot_id, option_id)
);
alter table public.equipment_observation enable row level security;
create index if not exists eq_obs_option_state on public.equipment_observation (option_id, state);
create index if not exists eq_obs_vin          on public.equipment_observation (vin);
create index if not exists eq_obs_model        on public.equipment_observation (make, model, generation);

create table if not exists public.equipment_observation_evidence (
  id             uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.equipment_observation(id) on delete cascade,
  source_type    text not null check (source_type in
    ('vehicle_data','listing_data','seller_text','visual','historical','document')),
  source_ref  text,
  source_url  text,
  description text,
  -- що СТВЕРДЖУЄ саме цей доказ (ABSENT можливий лише від джерела, здатного
  -- довести відсутність: vehicle_data/document; це контролює хук)
  claim_state text check (claim_state in ('PRESENT','ABSENT','UNKNOWN')),
  -- реальний рівень впевненості цього доказу, якщо він є;
  -- НЕ призначається автоматично за source чи display-групою
  confidence  text check (confidence in ('high','medium','low')),
  -- детермінований ключ доказу для ідемпотентності
  evidence_key text not null,
  unique (observation_id, evidence_key)
);
alter table public.equipment_observation_evidence enable row level security;
create index if not exists eq_ev_obs on public.equipment_observation_evidence (observation_id);

-- ---------- 3. Покриття джерел (чесний знаменник) ----------

create table if not exists public.observation_coverage (
  id            uuid primary key default gen_random_uuid(),
  vin           text not null,
  snapshot_id   uuid not null references public.vehicle_snapshots(id) on delete cascade,
  source_type   text not null check (source_type in
    ('vehicle_data','listing_data','seller_text','visual','historical','document')),
  -- complete для Equipment допустимий ЛИШЕ від джерела, здатного дати повний
  -- перелік (підтверджений повний заводський build sheet). Перегляд усієї
  -- фотогалереї це НЕ повне покриття комплектації: visual завжди partial,
  -- а факт повного перегляду галереї живе окремо в gallery_complete
  completeness  text not null check (completeness in ('complete','partial')),
  constraint visual_never_complete check (not (source_type = 'visual' and completeness = 'complete')),
  gallery_complete boolean,             -- лише для visual: чи переглянута вся галерея
  covered_areas jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  unique (snapshot_id, source_type)
);
alter table public.observation_coverage enable row level security;
create index if not exists cov_vin on public.observation_coverage (vin);

-- ---------- 4. Спостереження несправностей ----------

create table if not exists public.issue_observation (
  id          uuid primary key default gen_random_uuid(),
  vin         text not null,
  snapshot_id uuid not null references public.vehicle_snapshots(id) on delete cascade,
  check_id    uuid references public.reports(id) on delete set null,
  issue_type  text not null check (issue_type in
    ('dtc','service_record','inspection_record','historical_record',
     'visible_defect','document','seller_statement')),
  -- event_key = ЯКА КОНКРЕТНА подія (event_id / source_ref / код DTC /
  -- id документа; нормалізований title лише fallback): ключ ідемпотентності
  event_key   text not null,
  -- issue_key = ЯКА ЦЕ проблема семантично (для агрегації однакової болячки
  -- між машинами; той самий ключ доступний у model_issue_catalog)
  issue_key   text,
  title       text not null,
  detail      text,
  make text, model text, generation text,
  model_year smallint,
  listing_market text,
  factory_market text,
  engine text, trim text, drivetrain text,
  observed_at timestamptz not null default now(),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','rejected')),
  unique (vin, snapshot_id, event_key)
);
alter table public.issue_observation enable row level security;
create index if not exists iss_obs_vin   on public.issue_observation (vin);
create index if not exists iss_obs_model on public.issue_observation (make, model, generation, issue_key);

create table if not exists public.issue_observation_evidence (
  id             uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.issue_observation(id) on delete cascade,
  source_type    text not null check (source_type in
    ('vehicle_data','listing_data','seller_text','visual','historical','document')),
  source_ref  text,
  source_url  text,
  description text,
  confidence  text check (confidence in ('high','medium','low')),
  evidence_key text not null,
  unique (observation_id, evidence_key)
);
alter table public.issue_observation_evidence enable row level security;
create index if not exists iss_ev_obs on public.issue_observation_evidence (observation_id);

-- ---------- 5. Каталоги (заповнює ЛИШЕ seed-скрипт; спостереження їх не редагують) ----------

create table if not exists public.model_option_catalog (
  id             uuid primary key default gen_random_uuid(),
  make text not null, model text not null, generation text not null,
  option_id      uuid not null references public.option_dict(option_id),
  availability   text not null check (availability in ('standard','optional')),
  year_from smallint, year_to smallint,
  markets        jsonb not null default '[]',
  applies_to     jsonb not null default '{}',
  visual_markers jsonb not null default '[]',
  -- provenance кожного факту: факт без source_url не записується
  source_url  text not null,
  source_title text,
  source_type text not null check (source_type in
    ('manufacturer','press_release','catalog','review','forum','other')),
  retrieved_at timestamptz not null,
  applicability text,
  confidence  text check (confidence in ('high','medium','low')),
  evidence_excerpt text,
  unique (make, model, generation, option_id, source_url)
);
alter table public.model_option_catalog enable row level security;
create index if not exists moc_model on public.model_option_catalog (make, model, generation);

create table if not exists public.model_issue_catalog (
  id uuid primary key default gen_random_uuid(),
  make text not null, model text not null, generation text not null,
  -- той самий семантичний ключ проблеми, що і в issue_observation.issue_key
  issue_key text,
  title text not null,
  detail text,
  applies_to jsonb not null default '{}',
  year_from smallint, year_to smallint,
  source_url text not null,
  source_title text,
  source_type text not null check (source_type in
    ('manufacturer','press_release','catalog','review','forum','tsb','recall','other')),
  retrieved_at timestamptz not null,
  applicability text,
  confidence text check (confidence in ('high','medium','low')),
  evidence_excerpt text,
  unique (make, model, generation, title, source_url)
);
alter table public.model_issue_catalog enable row level security;
create index if not exists mic_model on public.model_issue_catalog (make, model, generation, issue_key);

-- ---------- 6. Derived-кеш (повністю rebuildable; Check його НЕ оновлює) ----------
-- Частоти рахуються по УНІКАЛЬНИХ VIN, не по снапшотах: повторні оголошення
-- однієї машини prevalence не збільшують. Знаменник vehicles_covered враховує
-- coverage: серед машин, де джерело могло бачити цю категорію.

create table if not exists public.derived_option_stats (
  id uuid primary key default gen_random_uuid(),
  make text not null, model text not null, generation text,
  model_year smallint, engine text, trim text, drivetrain text,   -- null = зріз "усі"
  option_id uuid not null references public.option_dict(option_id),
  vehicles_present  integer not null default 0,
  vehicles_absent   integer not null default 0,
  vehicles_unknown  integer not null default 0,
  vehicles_covered  integer not null default 0,
  recomputed_at timestamptz not null default now()
);
alter table public.derived_option_stats enable row level security;
create unique index if not exists dos_key on public.derived_option_stats
  (make, model, coalesce(generation,''), coalesce(model_year,0),
   coalesce(engine,''), coalesce(trim,''), coalesce(drivetrain,''), option_id);

create table if not exists public.derived_issue_stats (
  id uuid primary key default gen_random_uuid(),
  make text not null, model text not null, generation text,
  model_year smallint, engine text, trim text, drivetrain text,
  issue_key text not null,
  vehicles_affected integer not null default 0,
  vehicles_total    integer not null default 0,
  recomputed_at timestamptz not null default now()
);
alter table public.derived_issue_stats enable row level security;
create unique index if not exists dis_key on public.derived_issue_stats
  (make, model, coalesce(generation,''), coalesce(model_year,0),
   coalesce(engine,''), coalesce(trim,''), coalesce(drivetrain,''), issue_key);
