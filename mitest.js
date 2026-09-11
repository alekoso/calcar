/* Model Intelligence Phase 1: перевірка міграцій на живій базі.

   Що робить:
   1) застосовує prelude і 001..009 up;
   2) застосовує ще раз і перевіряє ідемпотентність;
   3) прогоняє позитивний smoke (бренд, покоління, версія, VMY, родина,
      варіант, обладнання, чернетковий кандидат) у транзакції з відкатом;
   4) прогоняє негативні перевірки: складений FK на вид subject, межі
      known/open/unknown, предикат без невідомої межі, аліаси в межах
      scope, ключ обладнання, сторожі пакета, шару і тега, інваріант
      verification gap;
   5) відкочує 009..001 down і перевіряє, що схеми зникли;
   6) застосовує наново і відкочує знову.

   Потребує psql і адресу ТЕСТОВОЇ бази:
     MI_TEST_DB_URL=postgres://... node mitest.js
     MI_PSQL=/шлях/до/psql (необовʼязково)

   До продакшн-бази цей тест не підключається ніколи: адреса задається
   явно змінною оточення. */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations', 'mi');
const FIX = path.join(__dirname, 'tests', 'mi', 'fixtures');
const PSQL = process.env.MI_PSQL || 'psql';
const DB = process.env.MI_TEST_DB_URL || '';
const errs = [];
let checks = 0;

const UPS = ['001_schemas_enums_lookups', '002_subjects_hierarchy_source',
  '003_components_equipment_state', '004_issue_maintenance_check',
  '005_claims_applicability_evidence', '006_staging', '007_mi_vm_interface',
  '008_fragments_packs_operations', '009_validation_permissions',
  '010_knowledge_lifecycle', '011_staging_buyer_metadata', '012_pack_compiler', '013_check_retrieval', '014_check_dedup', '015_identity_resolver'];

function run(args, sql) {
  return execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, ...args],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
}

/* З виводу psql беремо саме рядок помилки, а не перші рядки попереджень. */
function why(e) {
  const out = String(e.stderr || e.message);
  const line = out.split('\n').find(l => /ERROR|FATAL/.test(l));
  return (line || out.split('\n')[0] || '').trim().slice(0, 240);
}

const exec = sql => run([], sql);
const file = f => run(['-f', path.join(DIR, f)], '');
const fixture = f => run(['-f', path.join(FIX, f)], '');
const scalar = sql => run(['-t', '-A'], sql).trim();

function ok(name, fn) {
  checks++;
  try { fn(); } catch (e) { errs.push(name + ': ' + why(e)); }
}

/* Негативна перевірка: оператор МАЄ впасти. */
function rejects(name, sql) {
  checks++;
  try {
    exec('begin;\n' + sql + '\nrollback;');
    errs.push(name + ': оператор пройшов, хоча мав бути відхилений');
  } catch (e) { /* очікувано */ }
}

function applyAll() {
  fixture('000_test_prelude.sql');
  for (const m of UPS) file(m + '.up.sql');
}

function rollbackAll() {
  for (const m of [...UPS].reverse()) file(m + '.down.sql');
}

/* ---- 0. Передумови ---- */

if (!DB) {
  console.error('mitest: не задано MI_TEST_DB_URL, тест не запускався.');
  console.error('Приклад: MI_TEST_DB_URL=postgres://localhost/calcar_mi_test node mitest.js');
  process.exit(2);
}
try {
  execFileSync(PSQL, ['--version'], { stdio: 'pipe' });
} catch {
  console.error('mitest: psql недоступний. Вкажіть MI_PSQL або додайте psql у PATH.');
  process.exit(2);
}

for (const m of UPS) {
  for (const side of ['up', 'down']) {
    const f = path.join(DIR, m + '.' + side + '.sql');
    if (!fs.existsSync(f)) errs.push('немає файлу ' + m + '.' + side + '.sql');
  }
}

/* ---- 1. Застосування і ідемпотентність ---- */

ok('перше застосування', applyAll);
ok('повторне застосування (ідемпотентність)', applyAll);

ok('52 таблиці у mi і mi_vm', () => {
  const n = scalar("select count(*) from pg_tables where schemaname in ('mi','mi_vm');");
  if (n !== '52') throw new Error('очікували 52, маємо ' + n);
});

ok('44 enum у схемі mi', () => {
  const n = scalar("select count(*) from pg_type t join pg_namespace s on s.oid=t.typnamespace where s.nspname='mi' and t.typtype='e';");
  if (n !== '44') throw new Error('очікували 44, маємо ' + n);
});

ok('RLS увімкнений на всіх таблицях mi і mi_vm', () => {
  const n = scalar("select count(*) from pg_tables where schemaname in ('mi','mi_vm') and not rowsecurity;");
  if (n !== '0') throw new Error('без RLS лишилось таблиць: ' + n);
});

ok('словники засіяні', () => {
  const n = scalar('select (select count(*) from mi.component_role) || \'/\' || (select count(*) from mi.test_method) || \'/\' || (select count(*) from mi.market);');
  if (n !== '17/16/9') throw new Error('несподівані обсяги словників: ' + n);
});

ok('engine, transmission, transfer_case мають strong', () => {
  const n = scalar("select string_agg(code, ',' order by code) from mi.component_role where assumption_strength='strong';");
  if (n !== 'engine,transfer_case,transmission') throw new Error('маємо: ' + n);
});

ok('замінних ролей рівно 12 і решта weak', () => {
  const n = scalar("select count(*) from mi.component_role where is_replaceable;");
  const w = scalar("select count(*) from mi.component_role where assumption_strength='weak';");
  if (n !== '12' || w !== '9') throw new Error('replaceable=' + n + ', weak=' + w);
});

ok('усі FK валідні', () => {
  const n = scalar("select count(*) from pg_constraint c join pg_namespace s on s.oid=c.connamespace where s.nspname in ('mi','mi_vm') and c.contype='f' and not c.convalidated;");
  if (n !== '0') throw new Error('неваліданих FK: ' + n);
});

ok('частковий унікальний індекс дедуплікації існує', () => {
  const n = scalar("select count(*) from pg_indexes where schemaname='mi' and indexname='claim_dedup_published_key' and indexdef ilike '%where (status = %';");
  if (n !== '1') throw new Error('індекс не знайдено або він не частковий');
});

ok('унікальний індекс по виразу для вимірювань ідентичності існує', () => {
  const n = scalar("select count(*) from pg_indexes where schemaname='mi_vm' and indexname='resolved_identity_dimension_key' and indexdef ilike '%COALESCE%';");
  if (n !== '1') throw new Error('індекс по виразу не знайдено');
});

/* ---- 2. Позитивний smoke: граф BMW ---- */

ok('smoke-граф будується і відкочується', () => {
  exec(`
begin;
with s as (insert into mi.knowledge_subject (kind, label) values ('brand','BMW') returning id)
insert into mi.brand (subject_id, name) select id, 'BMW' from s;

with s as (insert into mi.knowledge_subject (kind, label) values ('model_line','5 Series') returning id)
insert into mi.model_line (subject_id, brand_id, name)
select s.id, b.subject_id, '5 Series' from s, mi.brand b where b.name='BMW';

with s as (insert into mi.knowledge_subject (kind, label) values ('generation','G30 pre-LCI') returning id)
insert into mi.generation (subject_id, model_line_id, platform_code, phase, powertrain_types,
                           default_system_profile, prod_from, prod_from_kind)
select s.id, m.subject_id, 'G30', 'pre_lci', array['ice']::mi.powertrain[], 'ice_default',
       date '2016-10-01', 'known'
from s, mi.model_line m where m.name='5 Series';

with s as (insert into mi.knowledge_subject (kind, label) values ('vehicle_version','M550i xDrive') returning id)
insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain)
select s.id, g.subject_id, 'M550i_xDrive', 'BMW M550i xDrive', 'ice'
from s, mi.generation g where g.platform_code='G30';

with s as (insert into mi.knowledge_subject (kind, label) values ('version_market_year','M550i US 2018') returning id)
insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
                                    prod_from, prod_from_kind, prod_to, prod_to_kind)
select s.id, v.subject_id, 'US', 2018, date '2017-03-01', 'known', date '2018-06-30', 'known'
from s, mi.vehicle_version v where v.version_code='M550i_xDrive';

with s as (insert into mi.knowledge_subject (kind, label) values ('component_family','N63') returning id)
insert into mi.component_family (subject_id, family_key, family_kind_code, architecture_en)
select s.id, 'N63', 'engine', 'Twin turbo V8 with turbochargers inside the vee' from s;

with s as (insert into mi.knowledge_subject (kind, label) values ('component_variant','N63B44O2') returning id)
insert into mi.component_variant (subject_id, family_id, variant_code, name_en)
select s.id, f.subject_id, 'N63B44O2', 'N63TU2 (N63R)' from s, mi.component_family f where f.family_key='N63';

insert into mi.variant_attribute (variant_id, attr_key, attr_value)
select subject_id, 'cylinder_bore_technology', 'alusil' from mi.component_variant where variant_code='N63B44O2';

insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind)
select subject_id, 'N63TU2', 'n63tu2', 'community', 'global' from mi.component_variant where variant_code='N63B44O2';

insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment, prod_from, prod_from_kind)
select y.subject_id, 'engine', v.subject_id, 'standard', date '2017-03-01', 'known'
from mi.version_market_year y, mi.component_variant v
where y.model_year=2018 and v.variant_code='N63B44O2';

with s as (insert into mi.knowledge_subject (kind, label) values ('equipment_item','Dynamic Handling Package') returning id)
insert into mi.equipment_item (subject_id, brand_id, equipment_key, oem_code, item_kind, name_en)
select s.id, b.subject_id, 'bmw_dynamic_handling_package_g30', 'ZDH', 'package', 'Dynamic Handling Package'
from s, mi.brand b where b.name='BMW';

insert into mi.equipment_visual_hint (equipment_id, cue_key, specificity, negative_note_en)
select subject_id, 'blue_calipers', 'ambiguous', 'Blue calipers alone never identify a version or a package'
from mi.equipment_item where equipment_key='bmw_dynamic_handling_package_g30';

insert into mi.candidate_claim (proposed_subject_text, text_en, proposed_knowledge_type, review_status)
values ('N63TU2', 'Coolant can migrate from the thermostat connector into the engine harness.', 'known_issue', 'new');

rollback;`);
});

ok('після відкату smoke база порожня', () => {
  const n = scalar('select (select count(*) from mi.brand) + (select count(*) from mi.knowledge_subject) + (select count(*) from mi.candidate_claim);');
  if (n !== '0') throw new Error('лишились рядки: ' + n);
});

/* ---- 3. Негативні перевірки ---- */

rejects('сутність не може посилатись на subject іншого виду', `
with s as (insert into mi.knowledge_subject (kind, label) values ('generation','wrong kind') returning id)
insert into mi.brand (subject_id, name) select id, 'Wrong' from s;`);

rejects('known-межа не може стояти на сентинелі', `
with s as (insert into mi.knowledge_subject (kind, label) values ('component_family','F') returning id)
insert into mi.component_family (subject_id, family_key, family_kind_code) select id, 'F1', 'engine' from s;
with s as (insert into mi.knowledge_subject (kind, label) values ('component_variant','V') returning id)
insert into mi.component_variant (subject_id, family_id, variant_code, name_en, prod_from_kind)
select s.id, f.subject_id, 'V1', 'V1', 'known' from s, mi.component_family f where f.family_key='F1';`);

rejects('unknown-межа не може стояти на реальній даті', `
with s as (insert into mi.knowledge_subject (kind, label) values ('component_family','F') returning id)
insert into mi.component_family (subject_id, family_key, family_kind_code) select id, 'F2', 'engine' from s;
with s as (insert into mi.knowledge_subject (kind, label) values ('component_variant','V') returning id)
insert into mi.component_variant (subject_id, family_id, variant_code, name_en, prod_from, prod_from_kind)
select s.id, f.subject_id, 'V2', 'V2', date '2015-06-01', 'unknown' from s, mi.component_family f where f.family_key='F2';`);

rejects('предикат не приймає невідому межу', `
with s as (insert into mi.knowledge_subject (kind, label) values ('issue','i') returning id)
insert into mi.claim_applicability (owner_subject_id, dimension, operator, value_date_from, value_date_to,
                                    value_from_kind, value_to_kind)
select id, 'production_date', 'in_range', date '0001-01-01', date '9999-12-31', 'unknown', 'open' from s;`);

rejects('аліас не дублюється в межах scope', `
with s as (insert into mi.knowledge_subject (kind, label) values ('component_family','A') returning id)
insert into mi.component_family (subject_id, family_key, family_kind_code) select id, 'A1', 'engine' from s;
insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind)
select subject_id, 'Dup', 'dup', 'community', 'global' from mi.component_family where family_key='A1';
insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind)
select subject_id, 'Dup', 'dup', 'community', 'global' from mi.component_family where family_key='A1';`);

rejects('ключ обладнання унікальний у межах бренда', `
with s as (insert into mi.knowledge_subject (kind, label) values ('brand','B') returning id)
insert into mi.brand (subject_id, name) select id, 'B1' from s;
with s as (insert into mi.knowledge_subject (kind, label) values ('equipment_item','E') returning id)
insert into mi.equipment_item (subject_id, brand_id, equipment_key, item_kind, name_en)
select s.id, b.subject_id, 'k1', 'option', 'E1' from s, mi.brand b where b.name='B1';
with s as (insert into mi.knowledge_subject (kind, label) values ('equipment_item','E') returning id)
insert into mi.equipment_item (subject_id, brand_id, equipment_key, item_kind, name_en)
select s.id, b.subject_id, 'k1', 'option', 'E2' from s, mi.brand b where b.name='B1';`);

rejects('у пакет не можна класти не-пакет', `
with s as (insert into mi.knowledge_subject (kind, label) values ('brand','B') returning id)
insert into mi.brand (subject_id, name) select id, 'B2' from s;
with s as (insert into mi.knowledge_subject (kind, label) values ('equipment_item','E') returning id)
insert into mi.equipment_item (subject_id, brand_id, equipment_key, item_kind, name_en)
select s.id, b.subject_id, 'p1', 'option', 'NotAPackage' from s, mi.brand b where b.name='B2';
with s as (insert into mi.knowledge_subject (kind, label) values ('equipment_item','E') returning id)
insert into mi.equipment_item (subject_id, brand_id, equipment_key, item_kind, name_en)
select s.id, b.subject_id, 'p2', 'option', 'Child' from s, mi.brand b where b.name='B2';
insert into mi.package_content (package_id, item_id)
select (select subject_id from mi.equipment_item where equipment_key='p1'),
       (select subject_id from mi.equipment_item where equipment_key='p2');`);

rejects('шар практики неможливий у клейма не про обслуговування', `
with s as (insert into mi.knowledge_subject (kind, label) values ('issue','i2') returning id)
insert into mi.claim (subject_id, knowledge_type, text_en, normalized_assertion, confidence,
                      buyer_importance, dedup_key, layer)
select id, 'known_issue', 'x', 'x', 'medium', 3, 'k-layer', 'official' from s;`);

rejects('невідомий тег умови відхиляється', `
with s as (insert into mi.knowledge_subject (kind, label) values ('issue','i3') returning id)
insert into mi.claim_applicability (owner_subject_id, dimension, operator, tag)
select id, 'condition_tag', 'tag_has', 'no_such_tag' from s;`);

rejects('verification gap не може впливати на Score', `
insert into public.reports (id) values ('11111111-1111-1111-1111-111111111111');
insert into mi.decision_reason (report_id, code, kind, affects)
values ('11111111-1111-1111-1111-111111111111', 'VG_x_borescope', 'verification_gap',
        array['score','decision_confidence']::mi.reason_affects[]);`);

rejects('синтез обовʼязковий для опор', `
with s as (insert into mi.knowledge_subject (kind, label) values ('issue','i4') returning id)
insert into mi.claim (subject_id, knowledge_type, text_en, normalized_assertion, confidence,
                      buyer_importance, dedup_key)
select id, 'known_issue', 'a', 'a', 'medium', 3, 'k-a' from s;
with s as (insert into mi.knowledge_subject (kind, label) values ('issue','i5') returning id)
insert into mi.claim (subject_id, knowledge_type, text_en, normalized_assertion, confidence,
                      buyer_importance, dedup_key)
select id, 'known_issue', 'b', 'b', 'medium', 3, 'k-b' from s;
insert into mi.claim_support (synthesis_claim_id, supporting_claim_id)
select (select id from mi.claim where dedup_key='k-a'), (select id from mi.claim where dedup_key='k-b');`);

/* ---- 4. Відкат і повторне застосування ---- */

ok('повний відкат', rollbackAll);

ok('після відкату схем немає', () => {
  const n = scalar("select count(*) from information_schema.schemata where schema_name in ('mi','mi_vm');");
  if (n !== '0') throw new Error('схеми лишились: ' + n);
});

ok('повторне застосування після відкату', applyAll);

ok('після повторного застосування знову 52 таблиці', () => {
  const n = scalar("select count(*) from pg_tables where schemaname in ('mi','mi_vm');");
  if (n !== '52') throw new Error('очікували 52, маємо ' + n);
});

ok('фінальний відкат', rollbackAll);

/* ---- Підсумок ---- */

if (errs.length) {
  console.error('mitest: помилок ' + errs.length + ' із ' + checks + ' перевірок');
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('mitest: усі ' + checks + ' перевірок пройшли');
