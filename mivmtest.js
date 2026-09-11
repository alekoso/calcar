/* Vehicle Memory Phase 6.1: блокери аудиту закриті.

   Перевіряється дописувальна історія спостережень про машину, розрізнення
   часу події і часу знання, корінь походження, мʼяке виправлення і
   круговий шлях памʼять -> адаптер -> резолвер -> компілятор.

   Ні резолвер, ні компілятор семантично не змінювались.

   Запуск:
     MI_TEST_DB_URL=postgres://... node mivmtest.js
     MI_PSQL=/шлях/до/psql (необовʼязково)

   До продакшн-бази тест не підключається ніколи. */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations', 'mi');
const FIX = path.join(__dirname, 'tests', 'mi', 'fixtures');
const DATA = path.join(__dirname, 'data', 'mi', 'reference');
const PSQL = process.env.MI_PSQL || 'psql';
const DB = process.env.MI_TEST_DB_URL || '';
const errs = [];
const notes = [];
let checks = 0;

const UPS = ['001_schemas_enums_lookups', '002_subjects_hierarchy_source',
  '003_components_equipment_state', '004_issue_maintenance_check',
  '005_claims_applicability_evidence', '006_staging', '007_mi_vm_interface',
  '008_fragments_packs_operations', '009_validation_permissions',
  '010_knowledge_lifecycle', '011_staging_buyer_metadata', '012_pack_compiler',
  '013_check_retrieval', '014_check_dedup', '015_identity_resolver',
  '016_vm_adapter', '017_pack_purpose_key'];

function run(args, sql) {
  return execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, ...args],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
}
function why(e) {
  const out = String(e.stderr || e.message);
  const line = out.split('\n').find(l => /ERROR|FATAL/.test(l));
  return (line || out.split('\n')[0] || '').trim().slice(0, 260);
}
const exec = sql => run([], sql);
const scalar = sql => run(['-t', '-A'], sql).trim();

function t(n, name, body, note) {
  checks++;
  try { exec('begin;\ndo $g$\nbegin\n' + body + '\nend $g$;\nrollback;'); }
  catch (e) { errs.push(n + '. ' + name + ': ' + why(e)); }
  if (note) notes.push(n + '. ' + note);
}

if (!DB) { console.error('mivmtest: не задано MI_TEST_DB_URL.'); process.exit(2); }
try { execFileSync(PSQL, ['--version'], { stdio: 'pipe' }); } catch {
  console.error('mivmtest: psql недоступний.'); process.exit(2); }

try {
  run(['-f', path.join(FIX, '000_test_prelude.sql')], '');
  for (const f of ['supabase-jobs.sql', 'supabase-vehicle-memory-baseline.sql',
                   'supabase-vehicle-intelligence.sql', 'supabase-vehicle-memory-v1.sql',
                   'supabase-vehicle-memory-v2.sql']) {
    run(['-f', path.join(__dirname, f)], '');
  }
  for (const m of UPS) run(['-f', path.join(DIR, m + '.up.sql')], '');
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.sql')).sort();
  exec(files.map(f => fs.readFileSync(path.join(DATA, f), 'utf8')).join('\n'));
  run(['-f', path.join(FIX, '020_identity_fixtures.sql')], '');
  run(['-f', path.join(FIX, '021_golden_fixture.sql')], '');
  run(['-f', path.join(FIX, '030_raw_observations.sql')], '');
  run(['-f', path.join(FIX, '040_vm_timeline.sql')], '');
  exec("select mi_test.build_timeline();");
  exec(`do $$ declare y record; p mi.pack_purpose; begin
          for y in select subject_id from mi.version_market_year loop
            foreach p in array array['decision','report','component','chat']::mi.pack_purpose[] loop
              perform mi.build_fragment(y.subject_id, p);
            end loop;
          end loop;
        end $$;`);
} catch (e) {
  console.error('mivmtest: не вдалося підготувати базу: ' + why(e));
  process.exit(1);
}

const A = (cond, msg) => `if not (${cond}) then raise exception '${msg}'; end if;`;
const VIN = "'5YJSA1E28FF0T0001'";

/* ---- 1..4. Історія ідентичності дописується ---- */

t(1, 'кілька спостережень ідентичності зберігаються', `
  declare n int;
  begin
  select count(*) into n from public.vehicle_identity_observation where vin = ${VIN};
  ${A('n >= 6', 'identity observations were not stored')}
  ${A(`(select count(*) from public.vehicle_identity_observation
         where vin = ${VIN} and dimension = 'model_year') = 2`,
      'the second model year observation overwrote the first')}
  end;`);

t(2, 'розбіжність декодерів зберігається і видно як конфлікт', `
  declare i bigint; st text;
  begin
  ${A(`(select count(distinct value_num) from public.vehicle_identity_observation
         where vin = ${VIN} and dimension = 'model_year') = 2`,
      'the disagreeing values collapsed into one')}
  i := mi.resolve_from_memory(${VIN});
  select resolution_status::text into st from mi_vm.resolved_identity_dimension
   where identity_id = i and dimension = 'model_year';
  ${A("st = 'conflicted'", 'two strong sources that disagree did not produce a conflict')}
  ${A(`(select jsonb_array_length(provenance->'candidates') from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'model_year') = 2`,
      'both sides of the disagreement were not kept')}
  end;`);

t(3, 'історія дати виробництва зберігається', `
  declare n int;
  begin
  perform mi.vm_record_identity(${VIN}, 'production_date', 'build_sheet', null, null,
    date '2015-02-11', null, '2026-03-01'::timestamptz, 'high', 'build-sheet-2', 'doc');
  select count(*) into n from public.vehicle_identity_observation
   where vin = ${VIN} and dimension = 'production_date';
  ${A('n = 1', 'the production date observation was not stored')}
  ${A(`(select value_date from public.vehicle_identity_observation
         where vin = ${VIN} and dimension = 'production_date') = date '2015-02-11'`,
      'the production date value was lost')}
  declare i2 bigint;
  begin
    i2 := mi.resolve_from_memory(${VIN});
    ${A("(mi.identity_json(i2)->>'production_date') is not null", 'the production date did not reach the resolver contract')}
  end;
  end;`);

t(4, 'історія ринку продажу зберігається окремо від ринку експлуатації', `
  declare j jsonb; i bigint;
  begin
  i := mi.resolve_from_memory(${VIN});
  j := mi.identity_json(i);
  ${A("j->>'market_sold' = 'US'", 'the market of sale was lost')}
  ${A("j->>'market_operated' is not null", 'the market of operation was lost')}
  ${A(`(select count(distinct value_text) from public.vehicle_identity_observation
         where vin = ${VIN} and dimension = 'market_operated') = 2`,
      'the history of the operating market collapsed')}
  end;`);

/* ---- 5..6. Заводський і поточний компонент ---- */

t(5, 'заводський компонент лишається після заміни', `
  declare i bigint;
  begin
  ${A(`(select count(*) from public.component_observation
         where vin = ${VIN} and role_code = 'mcu' and observation_kind = 'factory') = 1`,
      'the factory component observation disappeared')}
  ${A(`(select variant_code from public.component_observation
         where vin = ${VIN} and role_code = 'mcu' and observation_kind = 'factory') = 'MCU1'`,
      'the factory component was overwritten by the replacement')}
  i := mi.resolve_from_memory(${VIN}, null, '2025-01-01'::timestamptz);
  ${A(`(select value_subject_id from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'component_variant'
           and role_code = 'mcu' and slot = 'factory')
        = (select subject_id from mi.component_variant where variant_code = 'MCU1')`,
      'the resolver lost the factory component')}
  end;`);

t(6, 'поточний компонент це заміна', `
  declare i bigint;
  begin
  i := mi.resolve_from_memory(${VIN}, null, '2025-01-01'::timestamptz);
  ${A(`(select value_subject_id from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'component_variant'
           and role_code = 'mcu' and slot = 'current')
        = (select subject_id from mi.component_variant where variant_code = 'MCU2')`,
      'the current component is not the replacement')}
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'component_variant'
           and role_code = 'mcu' and slot = 'current')::text = 'confirmed'`,
      'the documented replacement is not confirmed')}
  end;`);

/* ---- 7..8. Права і вимірювання ---- */

t(7, 'історія прав зберігається', `
  declare n int;
  begin
  perform mi.vm_record_entitlement(${VIN}, 'free_unlimited_supercharging', 'absent',
    '2026-03-01'::timestamptz, 'manufacturer', 'removed after the salvage title');
  select count(*) into n from mi_vm.entitlement_state where vin = ${VIN};
  ${A('n = 2', 'the entitlement history was overwritten instead of appended')}
  ${A(`(select state::text from mi_vm.entitlement_state where vin = ${VIN}
         order by checked_at desc limit 1) = 'absent'`, 'the newest entitlement state is wrong')}
  ${A(`(select state::text from mi_vm.entitlement_state where vin = ${VIN}
         order by checked_at asc limit 1) = 'present'`, 'the earlier entitlement state was lost')}
  end;`);

t(8, 'вимірювання дописуються у часі', `
  declare n int;
  begin
  perform mi.vm_record_measurement(${VIN}, 'battery_diagnostics',
    '{"nominal_full_pack_kwh": 66.1}'::jsonb, '2026-03-01'::timestamptz, null, null, 'diagnostics');
  select count(*) into n from mi_vm.measurement where vin = ${VIN} and method_code = 'battery_diagnostics';
  ${A('n = 2', 'the second measurement replaced the first')}
  ${A(`(select (value->>'nominal_full_pack_kwh')::numeric from mi_vm.measurement
         where vin = ${VIN} order by measured_at asc limit 1) = 68.4`,
      'the earlier measurement was changed')}
  end;`);

/* ---- 9..11. Час, походження, виправлення ---- */

t(9, 'пізно знайдена подія має інший час події і час знання', `
  declare ev int; kn int;
  begin
  select jsonb_array_length(mi.vm_observations(${VIN}, '2022-01-01'::timestamptz, null)) into ev;
  select jsonb_array_length(mi.vm_observations(${VIN}, null, '2022-01-01'::timestamptz)) into kn;
  ${A('ev > 0', 'the event time view lost the 2021 auction')}
  ${A('kn = 0', 'the knowledge time view already knew about a record ingested in 2026')}
  ${A(`(select count(*) from jsonb_array_elements(
          mi.vm_observations(${VIN}, '2022-01-01'::timestamptz, null)) o
         where o->>'source_type' = 'auction') = ev`,
      'the event time view at 2022 contains something other than the auction')}
  end;`);

t(10, 'корінь походження не дає хибної незалежності', `
  declare i bigint; n int;
  begin
  -- Аукціон і переписане з нього оголошення несуть один корінь.
  ${A(`(select count(*) from public.vehicle_identity_observation
         where vin = ${VIN} and provenance_root = 'auction:copart:LOT-77001') = 1`,
      'the copied listing lost its provenance root')}
  i := mi.resolve_from_memory(${VIN});
  select jsonb_array_length(provenance->'supporting') into n
    from mi_vm.resolved_identity_dimension
   where identity_id = i and dimension = 'mileage_km';
  ${A('n = 1', 'two observations sharing one origin were counted as independent')}
  end;`);

t(11, 'виправлення не видаляє історію', `
  declare obs_id uuid; n_before int; n_after int; i bigint;
  begin
  select count(*) into n_before from public.vehicle_identity_observation where vin = ${VIN};
  select o.id into obs_id from public.vehicle_identity_observation o
   where o.vin = ${VIN} and o.dimension = 'model_year' and o.value_num = 2014;
  ${A(`mi.vm_invalidate('vehicle_identity_observation', obs_id, 'importer document referred to another car')`,
      'the invalidation did not apply')}
  select count(*) into n_after from public.vehicle_identity_observation where vin = ${VIN};
  ${A('n_after = n_before', 'the invalidation deleted the row instead of marking it')}
  ${A(`(select o.invalidated_at is not null and o.invalidated_reason is not null
          from public.vehicle_identity_observation o where o.id = obs_id)`,
      'the invalidation left no trace')}
  -- Недійсне спостереження більше не доходить до резолвера, конфлікт зник.
  i := mi.resolve_from_memory(${VIN});
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'model_year')::text = 'confirmed'`,
      'the invalidated observation still feeds the resolver')}
  end;`);

/* ---- 12..13. Круговий шлях ---- */

t(12, 'резолвер споживає адаптер памʼяті', `
  declare i bigint; j jsonb; p jsonb;
  begin
  i := mi.resolve_from_memory(${VIN}, null, '2025-01-01'::timestamptz);
  j := mi.identity_json(i);
  ${A("j->>'vmy' is not null", 'the memory did not yield a resolved version market year')}
  p := mi.compile_pack(j, 'report');
  ${A("(p->'pack'->>'fragment_available')::boolean", 'the compiler could not use the memory derived identity')}
  ${A("(p->'pack'->'pack_meta'->>'included_count')::int > 0", 'the pack came out empty')}
  ${A(`mi.persist_pack(i, 'decision') is not null`, 'the pack could not be persisted')}
  end;`);

t(13, 'Tesla: MCU1 у заводі, MCU2 зараз, знання про старий блок виключене', `
  declare i bigint; j jsonb;
  begin
  i := mi.resolve_from_memory(${VIN}, null, '2025-01-01'::timestamptz);
  j := mi.identity_json(i);
  ${A(`(select count(*) from jsonb_array_elements(j->'components') c
         where c->>'role' = 'mcu') = 2`, 'the two media unit slots collapsed into one')}
  ${A(`(select c->>'status' from jsonb_array_elements(j->'components') c
         where c->>'role' = 'mcu' and c->>'slot' = 'factory') = 'confirmed'`,
      'the factory media unit is not confirmed')}
  ${A("mi.eval_claim(mi_test.claim('T-050#a'), j)->>'status' = 'EXCLUDED'",
      'knowledge about the replaced media unit still applies')}
  -- Слабкі ролі, яких заміна не торкалась, лишаються припущенням.
  ${A("mi.eval_claim(mi_test.claim('T-023'), j)->>'status' = 'APPLICABLE_ASSUMED'",
      'an untouched weak role lost its assumption')}
  ${A("mi.eval_claim(mi_test.claim('T-010'), j)->>'status' = 'APPLICABLE_ASSUMED'",
      'the rear drive unit lost its assumption')}
  end;`);

t(14, 'відновлений базовий DDL відтворює структуру, з якою працює код', `
  declare n int;
  begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicle_snapshots';
  ${A('n = 36', 'the recovered snapshot table does not have the 36 production columns')}
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'auction_events';
  ${A('n = 14', 'the recovered auction table does not have the 14 production columns')}
  ${A(`(select count(*) from pg_constraint where conname = 'vin_shape') = 1`,
      'the production vin shape constraint was not reproduced')}
  ${A(`(select relrowsecurity from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
         where ns.nspname = 'public' and c.relname = 'vehicle_snapshots')`,
      'row level security is not enabled on the recovered table')}
  end;`);

/* ---- 15..24. Phase 6.2: призначення входить у ключ пакета ---- */

/* Спільна підготовка: розвʼязана з памʼяті ідентичність Tesla на зрізі
   знання, де заміна медіаблока вже відома. */
const IDENT = `mi.resolve_from_memory(${VIN}, null, '2025-01-01'::timestamptz)`;

t(15, 'пакет рішення зберігається', `
  declare i bigint; p bigint;
  begin
  i := ${IDENT};
  p := mi.persist_pack(i, 'decision');
  ${A('p is not null', 'the decision pack was not persisted')}
  ${A(`(select purpose::text from mi.knowledge_pack where id = p) = 'decision'`,
      'the stored row has the wrong purpose')}
  end;`);

t(16, 'пакет звіту з тим самим відбитком теж зберігається', `
  declare i bigint; d bigint; r bigint;
  begin
  i := ${IDENT};
  d := mi.persist_pack(i, 'decision');
  r := mi.persist_pack(i, 'report');
  ${A('r is not null', 'the report pack was refused after the decision pack')}
  ${A(`(select kp1.fingerprint from mi.knowledge_pack kp1 where kp1.id = d)
        = (select kp2.fingerprint from mi.knowledge_pack kp2 where kp2.id = r)`,
      'the two purposes did not share the fragment fingerprint, so the collision was not reproduced')}
  end;`);

t(17, 'це різні рядки', `
  declare i bigint; d bigint; r bigint; n int;
  begin
  i := ${IDENT};
  d := mi.persist_pack(i, 'decision');
  r := mi.persist_pack(i, 'report');
  ${A('d <> r', 'the report pack reused the row of the decision pack')}
  select count(*) into n from mi.knowledge_pack where identity_id = i;
  ${A('n = 2', 'the two packs did not produce two rows')}
  end;`);

t(18, 'призначення кожного збережене правильно', `
  declare i bigint; d bigint; r bigint;
  begin
  i := ${IDENT};
  d := mi.persist_pack(i, 'decision');
  r := mi.persist_pack(i, 'report');
  ${A(`(select kp.purpose::text from mi.knowledge_pack kp where kp.id = d) = 'decision'`,
      'the decision row lost its purpose')}
  ${A(`(select kp.purpose::text from mi.knowledge_pack kp where kp.id = r) = 'report'`,
      'the report row lost its purpose')}
  ${A(`(select (kp.payload->'pack_meta'->>'purpose') from mi.knowledge_pack kp where kp.id = d) = 'decision'`,
      'the decision payload does not describe itself as a decision pack')}
  ${A(`(select (kp.payload->'pack_meta'->>'purpose') from mi.knowledge_pack kp where kp.id = r) = 'report'`,
      'the report payload does not describe itself as a report pack')}
  end;`);

t(19, 'запис звіту не змінює пакет рішення', `
  declare i bigint; d bigint; before_included int; after_included int; before_bytes int;
  begin
  i := ${IDENT};
  d := mi.persist_pack(i, 'decision');
  select (kp.payload->'pack_meta'->>'included_count')::int, octet_length(kp.payload::text)
    into before_included, before_bytes from mi.knowledge_pack kp where kp.id = d;
  perform mi.persist_pack(i, 'report');
  select (kp.payload->'pack_meta'->>'included_count')::int
    into after_included from mi.knowledge_pack kp where kp.id = d;
  ${A('before_included = after_included', 'writing the report pack changed the decision payload')}
  ${A(`(select octet_length(kp.payload::text) from mi.knowledge_pack kp where kp.id = d) = before_bytes`,
      'the decision payload was rewritten by the report write')}
  end;`);

t(20, 'повторний запис рішення не змінює пакет звіту', `
  declare i bigint; r bigint; before_included int;
  begin
  i := ${IDENT};
  perform mi.persist_pack(i, 'decision');
  r := mi.persist_pack(i, 'report');
  select (kp.payload->'pack_meta'->>'included_count')::int
    into before_included from mi.knowledge_pack kp where kp.id = r;
  perform mi.persist_pack(i, 'decision');
  ${A(`(select (kp.payload->'pack_meta'->>'included_count')::int
         from mi.knowledge_pack kp where kp.id = r) = before_included`,
      'retrying the decision pack changed the report payload')}
  ${A(`(select kp.purpose::text from mi.knowledge_pack kp where kp.id = r) = 'report'`,
      'the report row lost its purpose after a decision retry')}
  end;`);

t(21, 'те саме рішення двічі дає той самий рядок', `
  declare i bigint; a bigint; b bigint; n int;
  begin
  i := ${IDENT};
  a := mi.persist_pack(i, 'decision');
  b := mi.persist_pack(i, 'decision');
  ${A('a = b', 'persisting the same decision pack twice created a second row')}
  select count(*) into n from mi.knowledge_pack where identity_id = i and purpose = 'decision';
  ${A('n = 1', 'the decision pack exists more than once')}
  end;`);

t(22, 'той самий звіт двічі дає той самий рядок', `
  declare i bigint; a bigint; b bigint; n int;
  begin
  i := ${IDENT};
  a := mi.persist_pack(i, 'report');
  b := mi.persist_pack(i, 'report');
  ${A('a = b', 'persisting the same report pack twice created a second row')}
  select count(*) into n from mi.knowledge_pack where identity_id = i and purpose = 'report';
  ${A('n = 1', 'the report pack exists more than once')}
  end;`);

t(23, 'зовнішній ключ на розвʼязану ідентичність лишається живим', `
  declare i bigint; d bigint; n int;
  begin
  i := ${IDENT};
  d := mi.persist_pack(i, 'decision');
  ${A(`(select kp.identity_id from mi.knowledge_pack kp where kp.id = d) = i`,
      'the pack lost its identity reference')}
  ${A(`exists (select 1 from mi_vm.resolved_identity ri where ri.id = i)`,
      'the referenced identity does not exist')}
  select count(*) into n from pg_constraint
   where conrelid = 'mi.knowledge_pack'::regclass and contype = 'f'
     and confrelid = 'mi_vm.resolved_identity'::regclass;
  ${A('n = 1', 'the foreign key to the resolved identity is gone')}
  -- Ключ унікальності тепер справді містить призначення.
  ${A(`(select pg_get_constraintdef(oid) from pg_constraint
         where conname = 'knowledge_pack_key') like '%purpose%'`,
      'the uniqueness key still does not include the purpose')}
  end;`);

t(24, 'Tesla з памʼяті зберігає обидва призначення', `
  declare i bigint; d bigint; r bigint;
  begin
  i := ${IDENT};
  ${A(`(mi.identity_json(i)->>'vmy') is not null`, 'the memory derived identity has no version market year')}
  d := mi.persist_pack(i, 'decision');
  r := mi.persist_pack(i, 'report');
  ${A('d is not null and r is not null and d <> r', 'the memory derived identity could not hold both purposes')}
  -- Обидва пакети несуть одну й ту саму розвʼязану заміну медіаблока.
  ${A(`(select count(*) from mi.knowledge_pack kp
         where kp.identity_id = i
           and kp.applicability_log::text like '%' || mi_test.claim('T-050#a')::text || '%') = 2`,
      'the two packs do not share the same applicability log subject')}
  ${A(`(select count(distinct kp.purpose) from mi.knowledge_pack kp where kp.identity_id = i) = 2`,
      'the two rows do not hold two distinct purposes')}
  end;`);

if (errs.length) {
  console.error('mivmtest: помилок ' + errs.length + ' із ' + checks);
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('mivmtest: усі ' + checks + ' перевірок пройшли');
for (const n of notes) console.log('   note ' + n);
