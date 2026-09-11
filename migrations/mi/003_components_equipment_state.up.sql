-- CalCar Model Intelligence, міграція 03: компонентні родини і варіанти,
-- атрибути варіантів, аліаси з контекстом, обладнання, доступність,
-- комплектація версії, права, типи станів компонента.
--
-- Апаратна ревізія це component_variant із заповненим revision_of_id.
-- Окремої сутності ревізії немає свідомо.

-- ---------- 1. Компонентні родини і варіанти ----------

create table if not exists mi.component_family (
  subject_id       bigint primary key,
  kind             mi.subject_kind generated always as ('component_family'::mi.subject_kind) stored,
  brand_id         bigint references mi.brand (subject_id) on delete restrict,
  family_key       text not null,
  family_kind_code text not null references mi.component_kind (code),
  architecture_en  text,
  attributes       jsonb,
  created_at       timestamptz not null default now(),
  constraint component_family_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint component_family_key unique (family_key)
);
alter table mi.component_family enable row level security;
create index if not exists component_family_brand_idx on mi.component_family (brand_id);
create index if not exists component_family_kind_idx on mi.component_family (family_kind_code);

create table if not exists mi.component_variant (
  subject_id     bigint primary key,
  kind           mi.subject_kind generated always as ('component_variant'::mi.subject_kind) stored,
  family_id      bigint not null references mi.component_family (subject_id) on delete restrict,
  variant_code   text not null,
  name_en        text not null,
  revision_of_id bigint references mi.component_variant (subject_id) on delete restrict,
  supersedes_id  bigint references mi.component_variant (subject_id) on delete restrict,
  prod_from      date not null default date '0001-01-01',
  prod_from_kind mi.boundary_kind not null default 'open',
  prod_to        date not null default date '9999-12-31',
  prod_to_kind   mi.boundary_kind not null default 'open',
  attributes     jsonb,
  created_at     timestamptz not null default now(),
  constraint component_variant_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint component_variant_key unique (family_id, variant_code),
  constraint component_variant_self_ck check (revision_of_id is null or revision_of_id <> subject_id),
  constraint component_variant_supersede_ck check (supersedes_id is null or supersedes_id <> subject_id),
  constraint component_variant_window_ck check (prod_from <= prod_to),
  constraint component_variant_from_kind_ck check ((prod_from_kind = 'known') = (prod_from <> date '0001-01-01')),
  constraint component_variant_to_kind_ck check ((prod_to_kind = 'known') = (prod_to <> date '9999-12-31'))
);
alter table mi.component_variant enable row level security;
create index if not exists component_variant_family_idx on mi.component_variant (family_id);
create index if not exists component_variant_revision_idx on mi.component_variant (revision_of_id);

-- Структурні атрибути варіанта, за якими можна писати предикати.
-- Ключ під FK, щоб не з'явилось двох написань того самого атрибута.
create table if not exists mi.variant_attribute (
  variant_id bigint not null references mi.component_variant (subject_id) on delete cascade,
  attr_key   text not null references mi.attribute_key (code),
  attr_value text not null,
  source_id  bigint references mi.source (id),
  created_at timestamptz not null default now(),
  constraint variant_attribute_pk primary key (variant_id, attr_key)
);
alter table mi.variant_attribute enable row level security;
create index if not exists variant_attribute_lookup_idx on mi.variant_attribute (attr_key, attr_value);

-- ---------- 2. Аліаси з контекстом ----------

-- Один аліас може означати різне у різних контекстах, тому унікальність
-- рахується в межах scope. Якщо контексту не вистачає, резолвер повертає
-- неоднозначність і НЕ вгадує.
create table if not exists mi.subject_alias (
  id                bigint generated always as identity primary key,
  target_subject_id bigint not null references mi.knowledge_subject (id) on delete cascade,
  alias             text not null,
  alias_norm        text not null,
  lang              char(2),
  alias_kind        mi.alias_kind not null,
  scope_kind        mi.alias_scope not null default 'global',
  scope_subject_id  bigint references mi.knowledge_subject (id) on delete restrict,
  scope_key         bigint generated always as (coalesce(scope_subject_id, 0)) stored,
  source_id         bigint references mi.source (id),
  created_at        timestamptz not null default now(),
  constraint subject_alias_scope_ck check ((scope_kind = 'global') = (scope_subject_id is null)),
  constraint subject_alias_key unique (scope_key, alias_norm)
);
alter table mi.subject_alias enable row level security;
create index if not exists subject_alias_norm_idx on mi.subject_alias (alias_norm);
create index if not exists subject_alias_target_idx on mi.subject_alias (target_subject_id);

-- ---------- 3. Обладнання ----------

-- Стабільна внутрішня ідентичність це (brand_id, equipment_key).
-- OEM-код не є ідентичністю: один код повторюється між поколіннями
-- і ринками з різним змістом.
create table if not exists mi.equipment_item (
  subject_id           bigint primary key,
  kind                 mi.subject_kind generated always as ('equipment_item'::mi.subject_kind) stored,
  brand_id             bigint not null references mi.brand (subject_id) on delete restrict,
  equipment_key        text not null,
  oem_code             text,
  item_kind            mi.equipment_kind not null,
  name_en              text not null,
  implements_variant_id bigint references mi.component_variant (subject_id) on delete restrict,
  legacy_option_id     uuid,
  created_at           timestamptz not null default now(),
  constraint equipment_item_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint equipment_item_key unique (brand_id, equipment_key)
);
alter table mi.equipment_item enable row level security;
create index if not exists equipment_item_oem_code_idx on mi.equipment_item (brand_id, oem_code);
create index if not exists equipment_item_legacy_idx on mi.equipment_item (legacy_option_id);

-- Візуальні ознаки і право Vision підтверджувати наявність.
-- definitive і дозволена комбінація strong розвʼязують equipment_present;
-- ambiguous не розвʼязує ніколи.
create table if not exists mi.equipment_visual_hint (
  id                bigint generated always as identity primary key,
  equipment_id      bigint not null references mi.equipment_item (subject_id) on delete cascade,
  cue_key           text not null,
  specificity       mi.visual_specificity not null,
  combination_group smallint,
  required_in_group smallint,
  description_en    text,
  negative_note_en  text,
  created_at        timestamptz not null default now(),
  constraint equipment_visual_hint_key unique (equipment_id, cue_key),
  constraint equipment_visual_hint_group_ck
    check ((specificity = 'strong') = (combination_group is not null))
);
alter table mi.equipment_visual_hint enable row level security;
create index if not exists equipment_visual_hint_cue_idx on mi.equipment_visual_hint (cue_key);

create table if not exists mi.package_content (
  package_id bigint not null references mi.equipment_item (subject_id) on delete cascade,
  item_id    bigint not null references mi.equipment_item (subject_id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint package_content_pk primary key (package_id, item_id),
  constraint package_content_self_ck check (package_id <> item_id)
);
alter table mi.package_content enable row level security;
create index if not exists package_content_item_idx on mi.package_content (item_id);

create table if not exists mi.equipment_availability (
  id              bigint generated always as identity primary key,
  vmy_id          bigint not null references mi.version_market_year (subject_id) on delete cascade,
  item_id         bigint not null references mi.equipment_item (subject_id) on delete restrict,
  availability    mi.availability not null,
  price           numeric(12,2),
  currency        char(3),
  sop_from        date not null default date '0001-01-01',
  sop_from_kind   mi.boundary_kind not null default 'open',
  sop_to          date not null default date '9999-12-31',
  sop_to_kind     mi.boundary_kind not null default 'open',
  requires_item_id bigint references mi.equipment_item (subject_id) on delete restrict,
  source_id       bigint references mi.source (id),
  created_at      timestamptz not null default now(),
  constraint equipment_availability_key unique (vmy_id, item_id, sop_from),
  constraint equipment_availability_window_ck check (sop_from <= sop_to),
  constraint equipment_availability_from_kind_ck check ((sop_from_kind = 'known') = (sop_from <> date '0001-01-01')),
  constraint equipment_availability_to_kind_ck check ((sop_to_kind = 'known') = (sop_to <> date '9999-12-31')),
  constraint equipment_availability_price_ck check ((price is null) = (currency is null))
);
alter table mi.equipment_availability enable row level security;
create index if not exists equipment_availability_vmy_idx on mi.equipment_availability (vmy_id);
create index if not exists equipment_availability_item_idx on mi.equipment_availability (item_id);

-- ---------- 4. Комплектація версії компонентами ----------

-- Що саме стоїть у VMY у якій ролі і в якому вікні. Невідома межа вікна
-- НІКОЛИ не дає збіг: така строка не розвʼязує роль.
create table if not exists mi.version_fitment (
  id              bigint generated always as identity primary key,
  vmy_id          bigint not null references mi.version_market_year (subject_id) on delete cascade,
  role_code       text not null references mi.component_role (code),
  variant_id      bigint not null references mi.component_variant (subject_id) on delete restrict,
  fitment         mi.fitment_kind not null,
  package_item_id bigint references mi.equipment_item (subject_id) on delete restrict,
  prod_from       date not null default date '0001-01-01',
  prod_from_kind  mi.boundary_kind not null default 'open',
  prod_to         date not null default date '9999-12-31',
  prod_to_kind    mi.boundary_kind not null default 'open',
  source_id       bigint references mi.source (id),
  created_at      timestamptz not null default now(),
  constraint version_fitment_key unique (vmy_id, role_code, variant_id, prod_from),
  constraint version_fitment_window_ck check (prod_from <= prod_to),
  constraint version_fitment_from_kind_ck check ((prod_from_kind = 'known') = (prod_from <> date '0001-01-01')),
  constraint version_fitment_to_kind_ck check ((prod_to_kind = 'known') = (prod_to <> date '9999-12-31')),
  constraint version_fitment_package_ck check ((fitment = 'in_package') = (package_item_id is not null))
);
alter table mi.version_fitment enable row level security;
create index if not exists version_fitment_vmy_role_idx on mi.version_fitment (vmy_id, role_code);
create index if not exists version_fitment_variant_idx on mi.version_fitment (variant_id);

-- ---------- 5. Права (software entitlements) ----------

-- Наявність заліза не дорівнює праву: право може бути відкликане
-- виробником без жодної зміни конфігурації автомобіля.
create table if not exists mi.entitlement (
  subject_id          bigint primary key,
  kind                mi.subject_kind generated always as ('entitlement'::mi.subject_kind) stored,
  brand_id            bigint not null references mi.brand (subject_id) on delete restrict,
  entitlement_key     text not null,
  name_en             text not null,
  binding             mi.binding not null,
  transferable_private boolean not null default false,
  transferable_dealer boolean not null default false,
  revocable           boolean not null default false,
  revoke_reasons      text[],
  network_dependency  boolean not null default false,
  requires_variant_id bigint references mi.component_variant (subject_id) on delete restrict,
  requires_item_id    bigint references mi.equipment_item (subject_id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint entitlement_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint entitlement_key unique (brand_id, entitlement_key)
);
alter table mi.entitlement enable row level security;

-- ---------- 6. Типи станів компонента ----------

-- Ремонт, переборка, заміна, ретрофіт і несанкціонована модифікація як
-- знання: що це означає. Конкретний екземпляр стану живе у Vehicle Memory.
create table if not exists mi.component_state_type (
  subject_id                bigint primary key,
  kind                      mi.subject_kind generated always as ('component_state_type'::mi.subject_kind) stored,
  state_key                 text not null,
  state_kind                mi.state_kind not null,
  applies_to_subject_id     bigint not null references mi.knowledge_subject (id) on delete restrict,
  resulting_variant_id      bigint references mi.component_variant (subject_id) on delete restrict,
  resulting_equipment_change mi.equipment_change,
  resulting_item_id         bigint references mi.equipment_item (subject_id) on delete restrict,
  sanctioned_by_oem         boolean not null default false,
  created_at                timestamptz not null default now(),
  constraint component_state_type_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint component_state_type_key unique (state_key),
  constraint component_state_type_equipment_ck
    check ((resulting_equipment_change is null) = (resulting_item_id is null))
);
alter table mi.component_state_type enable row level security;
create index if not exists component_state_type_applies_idx on mi.component_state_type (applies_to_subject_id);
