-- CalCar Model Intelligence, міграція 07: інтерфейс між Vehicle Memory
-- і Model Intelligence.
--
-- Тут зʼявляється VIN. У схемі mi VIN не зберігається ніколи: Model
-- Intelligence знає, що означає компонент чи стан, а Vehicle Memory знає,
-- що саме спостерігалось у конкретної машини.
--
-- Порядок відносно плану: інтерфейс створюється до фрагментів і пакетів,
-- бо пакет посилається на розвʼязану ідентичність.
--
-- vin зберігається як текст без FK на vehicles: це той самий прийом, що вже
-- діє у шарі накопичення знань (public.equipment_observation).

-- ---------- 1. Розвʼязана ідентичність ----------

create table if not exists mi_vm.resolved_identity (
  id               bigint generated always as identity primary key,
  vin              text not null,
  identity_version text not null,
  resolver_version text not null,
  inputs           jsonb,
  resolved_at      timestamptz not null default now(),
  constraint resolved_identity_key unique (vin, identity_version)
);
alter table mi_vm.resolved_identity enable row level security;
create index if not exists resolved_identity_vin_idx on mi_vm.resolved_identity (vin, resolved_at desc);

-- Одне вимірювання ідентичності. Для замінних ролей заводське і поточне
-- значення це РІЗНІ рядки з різним slot: поточне не виводиться із
-- заводського мовчки.
--
-- resolution_status:
--   confirmed       підтверджено джерелом достатньої специфічності;
--   assumed_factory поточне не спостерігалось, ознак заміни немає;
--   conflicted      два джерела того самого слота розходяться;
--   unresolved      достатнього джерела немає.
create table if not exists mi_vm.resolved_identity_dimension (
  id                bigint generated always as identity primary key,
  identity_id       bigint not null references mi_vm.resolved_identity (id) on delete cascade,
  dimension         mi.identity_dimension not null,
  role_code         text references mi.component_role (code),
  slot              mi.config_slot not null default 'na',
  value_subject_id  bigint references mi.knowledge_subject (id) on delete restrict,
  value_text        text,
  value_num         numeric,
  value_date        date,
  value_bool        boolean,
  confidence        mi.confidence not null,
  resolution_status mi.resolution_status not null,
  provenance        jsonb not null,
  conflict_note     text,
  created_at        timestamptz not null default now(),
  constraint resolved_identity_dimension_conflict_ck
    check (resolution_status <> 'conflicted' or conflict_note is not null),
  constraint resolved_identity_dimension_role_ck
    check (dimension <> 'component_variant' or role_code is not null)
);
alter table mi_vm.resolved_identity_dimension enable row level security;
-- Унікальність виражається індексом по виразу, а не табличним обмеженням:
-- частина колонок значення необовʼязкова.
create unique index if not exists resolved_identity_dimension_key
  on mi_vm.resolved_identity_dimension (
    identity_id, dimension, coalesce(role_code, ''), slot,
    coalesce(value_subject_id, 0), coalesce(value_text, '')
  );
create index if not exists resolved_identity_dimension_lookup_idx
  on mi_vm.resolved_identity_dimension (identity_id, dimension);

-- ---------- 2. Стани компонентів конкретної машини ----------

create table if not exists mi_vm.component_state_instance (
  id             bigint generated always as identity primary key,
  vin            text not null,
  state_type_id  bigint not null references mi.component_state_type (subject_id) on delete restrict,
  role_code      text references mi.component_role (code),
  occurred_on    date,
  mileage_km     integer,
  performer_kind mi.performer not null default 'unknown',
  documents      jsonb,
  measurements   jsonb,
  confidence     mi.confidence not null default 'medium',
  source_kind    text,
  snapshot_id    uuid references public.vehicle_snapshots (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint component_state_instance_mileage_ck check (mileage_km is null or mileage_km >= 0)
);
alter table mi_vm.component_state_instance enable row level security;
create index if not exists component_state_instance_vin_idx on mi_vm.component_state_instance (vin);
create index if not exists component_state_instance_type_idx on mi_vm.component_state_instance (state_type_id);

-- ---------- 3. Стан прав ----------

create table if not exists mi_vm.entitlement_state (
  id             bigint generated always as identity primary key,
  vin            text not null,
  entitlement_id bigint not null references mi.entitlement (subject_id) on delete restrict,
  state          mi.entitlement_status not null,
  checked_at     timestamptz not null default now(),
  source_kind    text,
  note           text,
  constraint entitlement_state_key unique (vin, entitlement_id, checked_at)
);
alter table mi_vm.entitlement_state enable row level security;
create index if not exists entitlement_state_vin_idx on mi_vm.entitlement_state (vin);

-- ---------- 4. Вимірювання ----------

-- Метод вимірювання бере той самий словник, що і метод перевірки, тому
-- borescope у чек-листі і borescope у вимірюванні це одне поняття.
-- expires_at несе термін придатності: поточне здоровʼя не дорівнює
-- залишковому ресурсу.
create table if not exists mi_vm.measurement (
  id            bigint generated always as identity primary key,
  vin           text not null,
  method_code   text not null references mi.test_method (code),
  check_item_id bigint references mi.check_item (subject_id) on delete set null,
  value         jsonb not null,
  measured_at   timestamptz not null,
  expires_at    timestamptz,
  source_kind   text,
  created_at    timestamptz not null default now(),
  constraint measurement_expiry_ck check (expires_at is null or expires_at > measured_at)
);
alter table mi_vm.measurement enable row level security;
create index if not exists measurement_vin_idx on mi_vm.measurement (vin, method_code, measured_at desc);

-- ---------- 5. Причини рішення ----------

-- Межа з Decision Engine. Інваріанти схеми:
-- verification gap НІКОЛИ не впливає на Score;
-- припущення впливає лише на контекст і чек-лист.
create table if not exists mi.decision_reason (
  id             bigint generated always as identity primary key,
  report_id      uuid not null references public.reports (id) on delete cascade,
  code           text not null,
  kind           mi.reason_kind not null,
  issue_id       bigint references mi.issue (subject_id) on delete set null,
  check_item_id  bigint references mi.check_item (subject_id) on delete set null,
  affects        mi.reason_affects[] not null,
  explanation_en text,
  created_at     timestamptz not null default now(),
  constraint decision_reason_affects_ck check (array_length(affects, 1) >= 1),
  constraint decision_reason_gap_ck
    check (kind <> 'verification_gap' or not ('score' = any (affects))),
  constraint decision_reason_assumption_ck
    check (kind <> 'assumption'
           or affects <@ array['context','checklist']::mi.reason_affects[])
);
alter table mi.decision_reason enable row level security;
create index if not exists decision_reason_report_idx on mi.decision_reason (report_id);
create index if not exists decision_reason_kind_idx on mi.decision_reason (kind);
