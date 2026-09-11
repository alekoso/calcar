-- CalCar Model Intelligence, міграція 08: фрагменти версій, скомпільовані
-- пакети знань, черга побудови.
--
-- Компілятор у цій фазі НЕ пишеться. Тут лише сховище для:
-- статичного фрагмента версії (будується офлайн при публікації),
-- пакета конкретного VIN (фрагмент плюс накладка по ідентичності),
-- черги запитів на побудову (жодної синхронної компіляції у Check).

-- ---------- 1. Статичний фрагмент версії ----------

-- У v1 locale лише 'en': канонічний текст англійський, переклад робиться
-- на рендері, тому вимір locale не розмножує фрагменти.
create table if not exists mi.pack_fragment (
  id               bigint generated always as identity primary key,
  vmy_id           bigint not null references mi.version_market_year (subject_id) on delete cascade,
  purpose          mi.pack_purpose not null,
  locale           char(2) not null default 'en',
  budget_profile   text not null default 'default',
  compiler_version text not null,
  fingerprint      text not null,
  payload          jsonb not null,
  payload_bytes    integer,
  snapshot_id      bigint references mi.knowledge_snapshot (id) on delete set null,
  valid            boolean not null default true,
  built_at         timestamptz not null default now(),
  constraint pack_fragment_key unique (vmy_id, purpose, locale, budget_profile, compiler_version)
);
alter table mi.pack_fragment enable row level security;
create index if not exists pack_fragment_valid_idx on mi.pack_fragment (valid, built_at);

-- Залежності фрагмента: усі subjects, чиї клейми оцінювались, разом із
-- ревізією на момент побудови. Включно з виключеними: зміна предиката
-- здатна повернути їх назад. Це і є матеріалізоване замикання.
create table if not exists mi.fragment_dependency (
  fragment_id   bigint not null references mi.pack_fragment (id) on delete cascade,
  subject_id    bigint not null references mi.knowledge_subject (id) on delete cascade,
  knowledge_rev bigint not null,
  constraint fragment_dependency_pk primary key (fragment_id, subject_id)
);
alter table mi.fragment_dependency enable row level security;
-- Зворотний індекс для точкової інвалідації: зміна знання про один subject
-- знаходить лише ті фрагменти, що від нього залежать.
create index if not exists fragment_dependency_subject_idx on mi.fragment_dependency (subject_id);

-- ---------- 2. Скомпільований пакет знань ----------

create table if not exists mi.knowledge_pack (
  id                 bigint generated always as identity primary key,
  identity_id        bigint not null references mi_vm.resolved_identity (id) on delete cascade,
  identity_version   text not null,
  fragment_id        bigint references mi.pack_fragment (id) on delete set null,
  purpose            mi.pack_purpose not null,
  locale             char(2) not null default 'en',
  budget_profile     text not null default 'default',
  compiler_version   text not null,
  fingerprint        text not null,
  payload            jsonb not null,
  -- Журнал оцінки предикатів: відповідає на питання, чому клейм потрапив
  -- у пакет і чому сусідній клейм було виключено.
  applicability_log  jsonb not null,
  snapshot_id        bigint not null references mi.knowledge_snapshot (id) on delete restrict,
  stale              boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint knowledge_pack_key unique (identity_version, fingerprint)
);
alter table mi.knowledge_pack enable row level security;
create index if not exists knowledge_pack_identity_idx on mi.knowledge_pack (identity_id, purpose, created_at desc);

-- ---------- 3. Черга побудови і сигнал попиту ----------

-- Промах фрагмента НЕ блокує Check: сюди ставиться запит, Check іде далі.
-- reason розрізняє дві різні ситуації:
--   fragment_missing  знання по версії є, фрагмент ще не зібраний;
--   knowledge_missing знання по версії ще немає, це сигнал попиту
--                     на дослідження;
--   invalidated       фрагмент застарів після публікації.
create table if not exists mi.build_request (
  id                  bigint generated always as identity primary key,
  reason              mi.build_reason not null,
  vmy_id              bigint references mi.version_market_year (subject_id) on delete cascade,
  vmy_key             bigint generated always as (coalesce(vmy_id, 0)) stored,
  identity_descriptor jsonb,
  purpose             mi.pack_purpose not null,
  status              mi.request_status not null default 'queued',
  requested_count     integer not null default 1,
  first_requested_at  timestamptz not null default now(),
  last_requested_at   timestamptz not null default now(),
  finished_at         timestamptz,
  error               text,
  constraint build_request_key unique (vmy_key, purpose, reason),
  constraint build_request_target_ck
    check (vmy_id is not null or identity_descriptor is not null)
);
alter table mi.build_request enable row level security;
create index if not exists build_request_status_idx on mi.build_request (status, last_requested_at);
