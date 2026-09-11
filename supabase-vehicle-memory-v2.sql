-- CalCar Vehicle Memory V2: дві таблиці спостережень, яких бракувало.
--
-- Аудит Phase 6 знайшов пʼять вимірів, які резолвер ідентичності вміє
-- приймати, а памʼять не вміє зберігати: дата виробництва, ринок
-- продажу, варіант компонента, заміна компонента і права. Права,
-- документовані події заміни і вимірювання закриваються без зміни схеми,
-- бо таблиці під них уже існують у `mi_vm` з міграції 007. Лишаються два
-- види спостережень, під які таблиці справді немає.
--
-- Файл ідемпотентний і ЛИШЕ аддитивний: дві нові таблиці, жодної зміни
-- наявних, жодного переписування рядків, RLS увімкнений без політик
-- (доступ лише через service role), як у решті спільних таблиць памʼяті.
--
-- Обидві таблиці ДОПИСУВАЛЬНІ. Виправлення робиться не оновленням рядка,
-- а проставленням `invalidated_at` разом із причиною і, за потреби,
-- новим рядком. Історія ніколи не зникає.
--
-- Обидві таблиці розрізняють ЧАС ПОДІЇ і ЧАС ЗНАННЯ:
--   observed_at  коли факт був істинним про машину;
--   ingested_at  коли CalCar про нього дізнався.
-- Саме тому аукціон 2021 року, знайдений у 2026, лягає в історію
-- правильною датою і при цьому не зʼявляється у відповіді на питання
-- «що CalCar знав у 2022».
--
-- `provenance_root` це корінь походження. Оголошення, переписане з
-- аукціону, несе той самий корінь і для резолвера рахується ОДНИМ
-- доказом, а не двома незалежними.
--
-- Жодна з таблиць не є канонічною істиною. Це історія спостережень.
-- Рядок `vehicles` лишається зручним кешем останніх значень, але
-- історична істина від нього більше не залежить.

-- ---------- 1. Спостереження ідентичності ----------

create table if not exists public.vehicle_identity_observation (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null,
  vehicle_id      uuid,
  -- Вимір у термінах резолвера: production_date, model_year,
  -- market_sold, market_operated, brand, model_line, generation,
  -- version, trim, first_sale_date.
  dimension       text not null,
  value_text      text,
  value_num       numeric,
  value_date      date,
  value_bool      boolean,
  -- Тип джерела у термінах старшинства резолвера: vin_decoder,
  -- build_sheet, manufacturer, vehicle_memory, diagnostics, user,
  -- current_vision, historical_vision, auction, listing, catalog.
  source_kind     text not null,
  source_ref      text,
  decoder_version text,
  confidence      text check (confidence is null or confidence in ('high', 'medium', 'low')),
  provenance_root text,
  observed_at     timestamptz not null,
  ingested_at     timestamptz not null default now(),
  snapshot_id     uuid,
  invalidated_at  timestamptz,
  invalidated_reason text,
  constraint vio_value_present check (
    num_nonnulls(value_text, value_num, value_date, value_bool) >= 1),
  constraint vio_invalidated_reason check (
    invalidated_at is null or coalesce(btrim(invalidated_reason), '') <> '')
);
alter table public.vehicle_identity_observation enable row level security;
create index if not exists vio_vin_dim on public.vehicle_identity_observation (vin, dimension, observed_at desc);
create index if not exists vio_vin_ingested on public.vehicle_identity_observation (vin, ingested_at desc);
create index if not exists vio_root on public.vehicle_identity_observation (provenance_root);

comment on table public.vehicle_identity_observation is
  'Дописувальна історія спостережень про ідентичність VIN. Не канонічна істина: два джерела, що розходяться, дають два рядки, і розбіжність видно.';

-- ---------- 2. Спостереження компонента ----------

create table if not exists public.component_observation (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null,
  vehicle_id      uuid,
  -- Роль у термінах каталогу Model Intelligence: engine, transmission,
  -- transfer_case, battery_pack, drive_unit_front, drive_unit_rear, mcu,
  -- adas_hw, charger, modem, suspension_system, brake_system і решта.
  role_code       text not null,
  -- Вид спостереження. factory це заводська конфігурація,
  -- current_observed це те, що стоїть зараз, replacement це подія
  -- заміни, removal це знятий вузол.
  observation_kind text not null
    check (observation_kind in ('factory', 'current_observed', 'replacement', 'removal')),
  -- Код варіанта у каталозі Model Intelligence. Текст, а не FK: памʼять
  -- не повинна ламатись від того, що каталог ще не знає цього варіанта.
  variant_code    text,
  -- Для заміни: що стояло до неї. Заповнюється лише коли це відомо і не
  -- виводиться з попередніх рядків, щоб не вигадувати історію.
  previous_variant_code text,
  state           text not null default 'PRESENT'
    check (state in ('PRESENT', 'ABSENT', 'UNKNOWN')),
  source_kind     text not null,
  source_ref      text,
  confidence      text check (confidence is null or confidence in ('high', 'medium', 'low')),
  provenance_root text,
  observed_at     timestamptz not null,
  ingested_at     timestamptz not null default now(),
  snapshot_id     uuid,
  mileage_km      integer check (mileage_km is null or mileage_km >= 0),
  documents       jsonb,
  invalidated_at  timestamptz,
  invalidated_reason text,
  constraint co_replacement_variant check (
    observation_kind <> 'replacement' or variant_code is not null),
  constraint co_invalidated_reason check (
    invalidated_at is null or coalesce(btrim(invalidated_reason), '') <> '')
);
alter table public.component_observation enable row level security;
create index if not exists co_vin_role on public.component_observation (vin, role_code, observed_at desc);
create index if not exists co_vin_ingested on public.component_observation (vin, ingested_at desc);
create index if not exists co_root on public.component_observation (provenance_root);

comment on table public.component_observation is
  'Дописувальна історія спостережень про компоненти конкретного VIN. Заводський рядок ніколи не видаляється при заміні: заміна це НОВИЙ рядок іншого виду.';
