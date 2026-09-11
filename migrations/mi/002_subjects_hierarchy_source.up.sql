-- CalCar Model Intelligence, міграція 02: реєстр subjects, джерела,
-- ієрархія автомобіля (бренд, модельний ряд, покоління, версія, версія x ринок x рік).
--
-- Порядок відносно плану: mi.source створюється тут, бо на нього посилаються
-- аліаси і fitment уже в міграції 03. Це єдине відхилення від нумерації
-- плану, продиктоване залежностями.
--
-- Константна колонка kind у кожній сутності разом із складеним FK на
-- (id, kind) реєстру гарантує, що рядок сутності не може існувати без
-- реєстру і не може посилатись на subject іншого виду.

-- ---------- 1. Реєстр subjects ----------

create table if not exists mi.knowledge_subject (
  id            bigint generated always as identity primary key,
  kind          mi.subject_kind not null,
  -- knowledge_rev змінюється, коли змінюється будь-яке знання, здатне
  -- змінити скомпільований фрагмент для цього subject. Механізм bump
  -- реалізується у Phase 2.
  knowledge_rev bigint not null default 1,
  label         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint knowledge_subject_id_kind_key unique (id, kind)
);
alter table mi.knowledge_subject enable row level security;
create index if not exists knowledge_subject_kind_idx on mi.knowledge_subject (kind);

comment on column mi.knowledge_subject.knowledge_rev is 'Локальний годинник валідності кешу. Глобальний mi.knowledge_snapshot існує окремо і служить лише для audit і відтворення.';

-- ---------- 2. Джерела ----------

create table if not exists mi.source (
  id            bigint generated always as identity primary key,
  source_type   mi.source_type not null,
  quality       mi.source_quality not null,
  url           text,
  reference     text,
  title         text,
  lang          char(2),
  platform      text,
  market_code   text references mi.market (code),
  published_at  date,
  updated_at_src date,
  retrieved_at  timestamptz not null default now(),
  access_status mi.access_status not null default 'ok',
  notes         text,
  created_at    timestamptz not null default now(),
  -- Природний ключ джерела: адреса, а за її відсутності нормалізоване
  -- посилання на документ. Обчислюється базою, тому дублі неможливі.
  natural_key   text generated always as (
    coalesce(nullif(url, ''), 'ref:' || lower(btrim(coalesce(reference, ''))))
  ) stored,
  constraint source_identity_ck check (num_nonnulls(nullif(url, ''), nullif(reference, '')) >= 1),
  constraint source_natural_key unique (natural_key)
);
alter table mi.source enable row level security;
create index if not exists source_type_quality_idx on mi.source (source_type, quality);
create index if not exists source_platform_idx on mi.source (platform);

-- ---------- 3. Ієрархія автомобіля ----------

create table if not exists mi.brand (
  subject_id bigint primary key,
  kind       mi.subject_kind generated always as ('brand'::mi.subject_kind) stored,
  name       text not null,
  country    text,
  created_at timestamptz not null default now(),
  constraint brand_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint brand_name_key unique (name)
);
alter table mi.brand enable row level security;

alter table mi.fluid_spec drop constraint if exists fluid_spec_brand_fk;
alter table mi.fluid_spec add constraint fluid_spec_brand_fk
  foreign key (brand_scope) references mi.brand (subject_id) on delete restrict;

create table if not exists mi.model_line (
  subject_id bigint primary key,
  kind       mi.subject_kind generated always as ('model_line'::mi.subject_kind) stored,
  brand_id   bigint not null references mi.brand (subject_id) on delete restrict,
  name       text not null,
  created_at timestamptz not null default now(),
  constraint model_line_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint model_line_brand_name_key unique (brand_id, name)
);
alter table mi.model_line enable row level security;

-- Покоління і фаза. Фаза це окремий рядок із посиланням phase_of_id на
-- батьківське покоління; знання батька успадковується обома фазами.
-- Вікна виробництва несуть вид межі: known, open, unknown.
create table if not exists mi.generation (
  subject_id              bigint primary key,
  kind                    mi.subject_kind generated always as ('generation'::mi.subject_kind) stored,
  model_line_id           bigint not null references mi.model_line (subject_id) on delete restrict,
  platform_code           text not null,
  phase                   text not null default 'base',
  phase_of_id             bigint references mi.generation (subject_id) on delete restrict,
  powertrain_types        mi.powertrain[] not null,
  default_system_profile  text not null,
  prod_from               date not null default date '0001-01-01',
  prod_from_kind          mi.boundary_kind not null default 'open',
  prod_to                 date not null default date '9999-12-31',
  prod_to_kind            mi.boundary_kind not null default 'open',
  created_at              timestamptz not null default now(),
  constraint generation_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint generation_key unique (model_line_id, platform_code, phase),
  constraint generation_phase_ck check (phase_of_id is null or phase <> 'base'),
  constraint generation_self_ck check (phase_of_id is null or phase_of_id <> subject_id),
  constraint generation_window_ck check (prod_from <= prod_to),
  constraint generation_from_kind_ck check ((prod_from_kind = 'known') = (prod_from <> date '0001-01-01')),
  constraint generation_to_kind_ck check ((prod_to_kind = 'known') = (prod_to <> date '9999-12-31')),
  constraint generation_powertrain_ck check (array_length(powertrain_types, 1) >= 1)
);
alter table mi.generation enable row level security;
create index if not exists generation_model_line_idx on mi.generation (model_line_id);
create index if not exists generation_phase_of_idx on mi.generation (phase_of_id);

create table if not exists mi.vehicle_version (
  subject_id             bigint primary key,
  kind                   mi.subject_kind generated always as ('vehicle_version'::mi.subject_kind) stored,
  generation_id          bigint not null references mi.generation (subject_id) on delete restrict,
  version_code           text not null,
  name_en                text not null,
  powertrain             mi.powertrain not null,
  system_profile_override text,
  created_at             timestamptz not null default now(),
  constraint vehicle_version_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint vehicle_version_key unique (generation_id, version_code)
);
alter table mi.vehicle_version enable row level security;
create index if not exists vehicle_version_generation_idx on mi.vehicle_version (generation_id);

-- Версія x ринок x модельний рік. Модельний рік зберігається як атрибут,
-- але застосовність рахується по вікну виробництва.
create table if not exists mi.version_market_year (
  subject_id     bigint primary key,
  kind           mi.subject_kind generated always as ('version_market_year'::mi.subject_kind) stored,
  version_id     bigint not null references mi.vehicle_version (subject_id) on delete restrict,
  market_code    text not null references mi.market (code),
  model_year     smallint not null,
  prod_from      date not null default date '0001-01-01',
  prod_from_kind mi.boundary_kind not null default 'open',
  prod_to        date not null default date '9999-12-31',
  prod_to_kind   mi.boundary_kind not null default 'open',
  base_price     numeric(12,2),
  currency       char(3),
  meta           jsonb,
  created_at     timestamptz not null default now(),
  constraint vmy_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint vmy_key unique (version_id, market_code, model_year),
  constraint vmy_model_year_ck check (model_year between 1990 and 2100),
  constraint vmy_window_ck check (prod_from <= prod_to),
  constraint vmy_from_kind_ck check ((prod_from_kind = 'known') = (prod_from <> date '0001-01-01')),
  constraint vmy_to_kind_ck check ((prod_to_kind = 'known') = (prod_to <> date '9999-12-31')),
  constraint vmy_price_ck check ((base_price is null) = (currency is null))
);
alter table mi.version_market_year enable row level security;
create index if not exists vmy_version_idx on mi.version_market_year (version_id);
create index if not exists vmy_market_year_idx on mi.version_market_year (market_code, model_year);
