-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Мінімальний синтетичний граф для перевірок життєвого циклу знання.
-- Жодних реальних даних про автомобілі: назви навмисно штучні, щоб цей
-- набір не можна було сплутати з back-loading еталонних карток.

-- ---------- Ієрархія ----------

with s as (insert into mi.knowledge_subject (kind, label) values ('brand', 'LC Brand') returning id)
insert into mi.brand (subject_id, name) select id, 'LifecycleBrand' from s;

with s as (insert into mi.knowledge_subject (kind, label) values ('model_line', 'LC Line') returning id)
insert into mi.model_line (subject_id, brand_id, name)
select s.id, b.subject_id, 'LC Line' from s, mi.brand b where b.name = 'LifecycleBrand';

with s as (insert into mi.knowledge_subject (kind, label) values ('generation', 'LCG') returning id)
insert into mi.generation (subject_id, model_line_id, platform_code, powertrain_types, default_system_profile)
select s.id, m.subject_id, 'LCG', array['ice']::mi.powertrain[], 'ice_default'
from s, mi.model_line m where m.name = 'LC Line';

with s as (insert into mi.knowledge_subject (kind, label) values ('generation', 'LCG2') returning id)
insert into mi.generation (subject_id, model_line_id, platform_code, powertrain_types, default_system_profile)
select s.id, m.subject_id, 'LCG2', array['ice']::mi.powertrain[], 'ice_default'
from s, mi.model_line m where m.name = 'LC Line';

with s as (insert into mi.knowledge_subject (kind, label) values ('vehicle_version', 'LC Version') returning id)
insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain)
select s.id, g.subject_id, 'LC_VERSION', 'Lifecycle Version', 'ice'
from s, mi.generation g where g.platform_code = 'LCG';

with s as (insert into mi.knowledge_subject (kind, label) values ('version_market_year', 'LC VMY') returning id)
insert into mi.version_market_year (subject_id, version_id, market_code, model_year)
select s.id, v.subject_id, 'US', 2018 from s, mi.vehicle_version v where v.version_code = 'LC_VERSION';

-- ---------- Компоненти ----------

with s as (insert into mi.knowledge_subject (kind, label) values ('component_family', 'LC Family') returning id)
insert into mi.component_family (subject_id, family_key, family_kind_code, architecture_en)
select id, 'LC_FAM', 'engine', 'Synthetic family for lifecycle tests' from s;

with s as (insert into mi.knowledge_subject (kind, label) values ('component_variant', 'LC Variant') returning id)
insert into mi.component_variant (subject_id, family_id, variant_code, name_en)
select s.id, f.subject_id, 'LC_VAR', 'Lifecycle variant' from s, mi.component_family f where f.family_key = 'LC_FAM';

-- Ревізія варіанта: потрібна для перевірки, що поширення вмикається лише явно.
with s as (insert into mi.knowledge_subject (kind, label) values ('component_variant', 'LC Variant rev') returning id)
insert into mi.component_variant (subject_id, family_id, variant_code, name_en, revision_of_id)
select s.id, f.subject_id, 'LC_VAR_R', 'Lifecycle variant revision', v.subject_id
from s, mi.component_family f, mi.component_variant v
where f.family_key = 'LC_FAM' and v.variant_code = 'LC_VAR';

insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment)
select y.subject_id, 'engine', v.subject_id, 'standard'
from mi.version_market_year y, mi.component_variant v
where y.model_year = 2018 and v.variant_code = 'LC_VAR';

-- ---------- Проблема і обслуговування ----------

with s as (insert into mi.knowledge_subject (kind, label) values ('issue', 'LC Issue') returning id)
insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity)
select s.id, 'lc_issue', v.subject_id, 'Lifecycle issue', 'Synthetic mechanism', 'major', 'mixed'
from s, mi.component_variant v where v.variant_code = 'LC_VAR';

with s as (insert into mi.knowledge_subject (kind, label) values ('maintenance_item', 'LC Maintenance') returning id)
insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code)
select s.id, v.subject_id, 'engine_oil' from s, mi.component_variant v where v.variant_code = 'LC_VAR';

-- ---------- Джерела ----------

insert into mi.source (source_type, quality, url, title, platform, market_code, access_status) values
  ('official',   'primary',   'https://example.test/lc/official-1', 'LC official bulletin', 'oem',        'US', 'ok'),
  ('official',   'primary',   'https://example.test/lc/official-2', 'LC official bulletin 2', 'oem',      'EU', 'ok'),
  ('specialist', 'primary',   'https://example.test/lc/spec-1',     'LC specialist',        'workshop',   'US', 'ok'),
  ('owner',      'secondary', 'https://example.test/lc/owner-a1',   'LC owner A1',          'forum_a',    'US', 'ok'),
  ('owner',      'secondary', 'https://example.test/lc/owner-a2',   'LC owner A2',          'forum_a',    'US', 'ok'),
  ('owner',      'secondary', 'https://example.test/lc/owner-b1',   'LC owner B1',          'forum_b',    'EU', 'ok'),
  ('owner',      'secondary', 'https://example.test/lc/owner-c1',   'LC owner C1',          'forum_c',    'UA', 'ok'),
  ('vendor',     'low',       'https://example.test/lc/vendor-1',   'LC parts shop',        'shop',       'US', 'ok');

-- ---------- Неоднозначний аліас ----------

-- Один напис вказує на два різні subject у двох різних контекстах.
-- Без контексту резолвер не має права вгадувати, і публікація блокується.
insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind, scope_subject_id)
select v.subject_id, 'LC Dup Alias', 'lc dup alias', 'community', 'generation', g.subject_id
from mi.component_variant v, mi.generation g
where v.variant_code = 'LC_VAR' and g.platform_code = 'LCG';

insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind, scope_subject_id)
select v.subject_id, 'LC Dup Alias', 'lc dup alias', 'community', 'generation', g.subject_id
from mi.component_variant v, mi.generation g
where v.variant_code = 'LC_VAR_R' and g.platform_code = 'LCG2';
