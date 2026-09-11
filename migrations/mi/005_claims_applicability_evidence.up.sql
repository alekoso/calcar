-- CalCar Model Intelligence, міграція 05: аудит публікацій, клейми,
-- предикати застосовності, звʼязки, докази, похідна повторюваність.
--
-- Порядок відносно плану: mi.knowledge_snapshot і mi.publish_batch створені
-- тут, бо на знімок посилається сам клейм.
--
-- Застосовність: клейм застосовний, якщо виконані ВСІ групи (all_of),
-- а група виконана, якщо виконаний БУДЬ-ЯКИЙ її предикат (any_of).
-- Ядро застосовності зберігається типізованими рядками, не JSONB.

-- ---------- 1. Аудит публікацій ----------

create table if not exists mi.knowledge_snapshot (
  id                  bigint generated always as identity primary key,
  published_at        timestamptz not null default now(),
  note                text,
  compiler_min_version text
);
alter table mi.knowledge_snapshot enable row level security;

create table if not exists mi.publish_batch (
  id                 bigint generated always as identity primary key,
  snapshot_id        bigint not null references mi.knowledge_snapshot (id) on delete restrict,
  actor              text not null,
  touched_subject_ids bigint[] not null default '{}',
  created_at         timestamptz not null default now()
);
alter table mi.publish_batch enable row level security;
create index if not exists publish_batch_snapshot_idx on mi.publish_batch (snapshot_id);

-- ---------- 2. Клейм ----------

create table if not exists mi.claim (
  id                     bigint generated always as identity primary key,
  subject_id             bigint not null references mi.knowledge_subject (id) on delete restrict,
  knowledge_type         mi.knowledge_type not null,
  text_en                text not null,
  normalized_assertion   text not null,
  value_kind             mi.value_kind,
  structured_value       jsonb,
  confidence             mi.confidence not null,
  buyer_implication_en   text,
  buyer_importance       smallint not null,
  layer                  mi.practice_layer,
  causal_status          mi.causal_status,
  contested              boolean not null default false,
  contested_note_en      text,
  policy_status          mi.policy_status,
  -- Поширення знання вниз: за замовчуванням лише сам subject. Знання НЕ
  -- спускається на конкретніші ревізії без явного дозволу.
  propagation            mi.propagation not null default 'exact',
  propagation_note       text,
  refresh_class          mi.refresh_class not null default 'slow',
  status                 mi.claim_status not null default 'draft',
  effective_from         date not null default date '0001-01-01',
  effective_from_kind    mi.boundary_kind not null default 'open',
  effective_to           date not null default date '9999-12-31',
  effective_to_kind      mi.boundary_kind not null default 'open',
  supersedes_id          bigint references mi.claim (id) on delete restrict,
  superseded_by_id       bigint references mi.claim (id) on delete restrict,
  review_note            text,
  reviewed_at            timestamptz,
  reviewed_by            text,
  -- Похідні поля: обчислюються при публікації і при зміні доказів,
  -- у bump ревізії самі по собі НЕ беруть участі.
  applicability_signature text not null default '',
  dedup_key              text not null,
  evidence_summary       jsonb,
  published_snapshot_id  bigint references mi.knowledge_snapshot (id) on delete restrict,
  created_at             timestamptz not null default now(),
  constraint claim_importance_ck check (buyer_importance between 1 and 5),
  constraint claim_value_ck check (structured_value is null or value_kind is not null),
  constraint claim_policy_ck check (policy_status is null or knowledge_type = 'official_fact'),
  constraint claim_practice_causal_ck
    check (knowledge_type not in ('owner_practice','specialist_practice') or causal_status is not null),
  constraint claim_contested_ck check (contested = false or contested_note_en is not null),
  constraint claim_propagation_note_ck
    check (propagation = 'exact' or propagation_note is not null),
  constraint claim_published_ck
    check (status <> 'published' or published_snapshot_id is not null),
  constraint claim_self_supersede_ck check (supersedes_id is null or supersedes_id <> id),
  constraint claim_window_ck check (effective_from <= effective_to),
  constraint claim_effective_from_kind_ck
    check ((effective_from_kind = 'known') = (effective_from <> date '0001-01-01')),
  constraint claim_effective_to_kind_ck
    check ((effective_to_kind = 'known') = (effective_to <> date '9999-12-31'))
);
alter table mi.claim enable row level security;
create index if not exists claim_subject_status_idx on mi.claim (subject_id, status);
create index if not exists claim_status_type_idx on mi.claim (status, knowledge_type);
create index if not exists claim_supersedes_idx on mi.claim (supersedes_id);
create index if not exists claim_refresh_idx on mi.claim (refresh_class, reviewed_at);
create index if not exists claim_snapshot_idx on mi.claim (published_snapshot_id);
-- Дедуплікація діє лише серед опублікованих: ключ враховує тип знання,
-- шар і підпис застосовності, тому official, specialist і owner
-- НЕ зливаються через схожий текст.
create unique index if not exists claim_dedup_published_key
  on mi.claim (dedup_key) where status = 'published';
create index if not exists claim_text_search_idx
  on mi.claim using gin (to_tsvector('english', text_en));

-- ---------- 3. Предикати застосовності ----------

create table if not exists mi.claim_applicability (
  id                bigint generated always as identity primary key,
  claim_id          bigint references mi.claim (id) on delete cascade,
  owner_subject_id  bigint references mi.knowledge_subject (id) on delete cascade,
  group_no          smallint not null default 1,
  dimension         mi.identity_dimension not null,
  operator          mi.pred_operator not null,
  config_scope      mi.config_slot not null default 'current',
  ref_subject_id    bigint references mi.knowledge_subject (id) on delete restrict,
  include_revisions boolean not null default false,
  attr_key          text references mi.attribute_key (code),
  attr_value        text,
  tag               text,
  value_date_from   date,
  value_date_to     date,
  value_num_from    numeric,
  value_num_to      numeric,
  -- Межі предиката бувають лише відомі або відкриті: якщо автор не
  -- встановив межу, він не пише діапазонний предикат зовсім.
  value_from_kind   mi.boundary_kind,
  value_to_kind     mi.boundary_kind,
  created_at        timestamptz not null default now(),
  constraint claim_applicability_owner_ck check (num_nonnulls(claim_id, owner_subject_id) = 1),
  constraint claim_applicability_from_kind_ck check (value_from_kind is null or value_from_kind <> 'unknown'),
  constraint claim_applicability_to_kind_ck check (value_to_kind is null or value_to_kind <> 'unknown'),
  constraint claim_applicability_dimension_ck check (
    case
      when dimension in ('brand','model_line','generation','version','vmy',
                         'component_variant','component_family','equipment_present',
                         'equipment_absent','entitlement_state','component_state_present')
        then ref_subject_id is not null
             and attr_key is null and tag is null
             and value_date_from is null and value_date_to is null
             and value_num_from is null and value_num_to is null
             and value_from_kind is null and value_to_kind is null
      when dimension = 'variant_attribute'
        then attr_key is not null and attr_value is not null
             and ref_subject_id is null and tag is null
             and value_date_from is null and value_date_to is null
             and value_num_from is null and value_num_to is null
             and value_from_kind is null and value_to_kind is null
      when dimension in ('market_sold','market_operated','condition_tag','salvage_status')
        then tag is not null
             and ref_subject_id is null and attr_key is null
             and value_date_from is null and value_date_to is null
             and value_num_from is null and value_num_to is null
             and value_from_kind is null and value_to_kind is null
      when dimension in ('production_date','first_sale_date')
        then value_date_from is not null and value_date_to is not null
             and value_from_kind is not null and value_to_kind is not null
             and value_num_from is null and value_num_to is null
             and ref_subject_id is null and attr_key is null and tag is null
             and value_date_from <= value_date_to
             and ((value_from_kind = 'known') = (value_date_from <> date '0001-01-01'))
             and ((value_to_kind = 'known') = (value_date_to <> date '9999-12-31'))
      when dimension in ('mileage_km','age_years','model_year')
        then value_num_from is not null and value_num_to is not null
             and value_from_kind is not null and value_to_kind is not null
             and value_date_from is null and value_date_to is null
             and ref_subject_id is null and attr_key is null and tag is null
             and value_num_from <= value_num_to
             and ((value_from_kind = 'known') = (value_num_from <> '-Infinity'::numeric))
             and ((value_to_kind = 'known') = (value_num_to <> 'Infinity'::numeric))
      else false
    end
  )
);
alter table mi.claim_applicability enable row level security;
create index if not exists claim_applicability_claim_idx on mi.claim_applicability (claim_id, group_no);
create index if not exists claim_applicability_owner_idx on mi.claim_applicability (owner_subject_id);
create index if not exists claim_applicability_ref_idx on mi.claim_applicability (dimension, ref_subject_id);

-- ---------- 4. Звʼязки клеймів ----------

create table if not exists mi.claim_link (
  id                bigint generated always as identity primary key,
  claim_id          bigint not null references mi.claim (id) on delete cascade,
  target_subject_id bigint not null references mi.knowledge_subject (id) on delete cascade,
  role_code         text not null references mi.link_role (code),
  created_at        timestamptz not null default now(),
  constraint claim_link_key unique (claim_id, target_subject_id, role_code)
);
alter table mi.claim_link enable row level security;
create index if not exists claim_link_target_idx on mi.claim_link (target_subject_id, role_code);

-- Синтез CalCar без опорних клеймів не публікується: перевірка кількості
-- опор це справа gate, а сам звʼязок зберігається тут.
create table if not exists mi.claim_support (
  synthesis_claim_id  bigint not null references mi.claim (id) on delete cascade,
  supporting_claim_id bigint not null references mi.claim (id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint claim_support_pk primary key (synthesis_claim_id, supporting_claim_id),
  constraint claim_support_self_ck check (synthesis_claim_id <> supporting_claim_id)
);
alter table mi.claim_support enable row level security;
create index if not exists claim_support_supporting_idx on mi.claim_support (supporting_claim_id);

-- ---------- 5. Докази ----------

-- Зберігається лише цитата і метадані, не повні копії сторінок.
-- independence_group обовʼязкова: один тред або один автор це одна група.
create table if not exists mi.evidence (
  id                 bigint generated always as identity primary key,
  claim_id           bigint not null references mi.claim (id) on delete cascade,
  source_id          bigint not null references mi.source (id) on delete restrict,
  stance             mi.stance not null,
  excerpt            text,
  excerpt_lang       char(2),
  independence_group text not null,
  context            jsonb,
  retrieved_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint evidence_key unique (claim_id, source_id, independence_group),
  constraint evidence_excerpt_ck check (excerpt is null or length(excerpt) <= 2000)
);
alter table mi.evidence enable row level security;
create index if not exists evidence_claim_idx on mi.evidence (claim_id);
create index if not exists evidence_source_idx on mi.evidence (source_id);
create index if not exists evidence_group_idx on mi.evidence (independence_group);

-- ---------- 6. Похідна повторюваність доказів ----------

-- Це властивість доказів, а не парку машин. Поширеність у v1 не
-- обчислюється і не зберігається: без знаменника вона невідома.
create table if not exists mi.recurrence_summary (
  claim_id             bigint primary key references mi.claim (id) on delete cascade,
  independent_groups   integer not null default 0,
  contradicting_groups integer not null default 0,
  markets              text[],
  mileage_km           integer[],
  age_years            smallint[],
  specialist_support   boolean not null default false,
  recurrence_class     mi.recurrence not null default 'anecdote',
  -- Хеш полів, видимих у Knowledge Pack: зміна саме цього хеша піднімає
  -- ревізію subject у Phase 2.
  pack_visible_hash    text not null,
  computed_at          timestamptz not null default now()
);
alter table mi.recurrence_summary enable row level security;
