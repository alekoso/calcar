-- CalCar Model Intelligence, міграція 04: проблеми, обслуговування, перевірки.
--
-- Issue має стабільну ідентичність issue_key (сумісну з полем
-- public.issue_observation.issue_key) і НЕ має поля частоти: повторюваність
-- доказів це властивість доказів, а не парку. Реальна поширеність без
-- знаменника лишається невідомою.
--
-- Обслуговування не має єдиного поля інтервалу: офіційний, спеціалістський,
-- власницький і синтез CalCar живуть як окремі клейми з різним layer.

-- ---------- 1. Проблеми ----------

create table if not exists mi.issue (
  subject_id        bigint primary key,
  kind              mi.subject_kind generated always as ('issue'::mi.subject_kind) stored,
  issue_key         text not null,
  about_subject_id  bigint not null references mi.knowledge_subject (id) on delete restrict,
  name_en           text not null,
  mechanism_en      text,
  severity          mi.severity not null,
  sensitivity       mi.sensitivity not null,
  status            mi.entity_status not null default 'active',
  created_at        timestamptz not null default now(),
  constraint issue_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint issue_key_unique unique (issue_key)
);
alter table mi.issue enable row level security;
create index if not exists issue_about_idx on mi.issue (about_subject_id);
create index if not exists issue_status_idx on mi.issue (status);

comment on table mi.issue is 'Канонічна ідентичність проблеми. Симптоми, коди, ремонти, профілактика і вартість живуть як клейми, повʼязані через mi.claim_link.';

-- ---------- 2. Обслуговування ----------

create table if not exists mi.maintenance_item (
  subject_id        bigint primary key,
  kind              mi.subject_kind generated always as ('maintenance_item'::mi.subject_kind) stored,
  about_subject_id  bigint not null references mi.knowledge_subject (id) on delete restrict,
  service_kind_code text not null references mi.service_kind (code),
  fluid_spec_code   text references mi.fluid_spec (code),
  capacity_note_en  text,
  created_at        timestamptz not null default now(),
  constraint maintenance_item_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint maintenance_item_key unique (about_subject_id, service_kind_code)
);
alter table mi.maintenance_item enable row level security;
create index if not exists maintenance_item_service_idx on mi.maintenance_item (service_kind_code);

-- ---------- 3. Перевірки ----------

-- cannot_prove_en обовʼязкове: перевірка підтверджує стан сьогодні і не
-- гарантує залишковий ресурс. Це поле несе цей інваріант у схемі.
create table if not exists mi.check_item (
  subject_id         bigint primary key,
  kind               mi.subject_kind generated always as ('check_item'::mi.subject_kind) stored,
  test_method_code   text not null references mi.test_method (code),
  scope_subject_id   bigint not null references mi.knowledge_subject (id) on delete restrict,
  why_en             text not null,
  proves_en          text not null,
  cannot_prove_en    text not null,
  conditions         text[],
  default_priority   mi.priority not null default 'good',
  -- materially_resolves = true означає, що ця перевірка справді знімає саме
  -- цю невизначеність; лише така перевірка може утворити verification gap.
  materially_resolves boolean not null default false,
  resolves_dimension mi.identity_dimension,
  created_at         timestamptz not null default now(),
  constraint check_item_subject_fk foreign key (subject_id, kind)
    references mi.knowledge_subject (id, kind) on delete restrict,
  constraint check_item_key unique (test_method_code, scope_subject_id, why_en)
);
alter table mi.check_item enable row level security;
create index if not exists check_item_scope_idx on mi.check_item (scope_subject_id);
create index if not exists check_item_method_idx on mi.check_item (test_method_code);

-- Одна перевірка закриває кілька цілей, одна ціль може вимагати кількох
-- перевірок.
create table if not exists mi.check_covers (
  check_id          bigint not null references mi.check_item (subject_id) on delete cascade,
  target_subject_id bigint not null references mi.knowledge_subject (id) on delete cascade,
  role              mi.cover_role not null,
  created_at        timestamptz not null default now(),
  constraint check_covers_pk primary key (check_id, target_subject_id)
);
alter table mi.check_covers enable row level security;
create index if not exists check_covers_target_idx on mi.check_covers (target_subject_id, role);
