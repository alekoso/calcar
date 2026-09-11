/* Model Intelligence Phase 5: резолвер ідентичності і накладка по VIN.

   Резолвер перетворює сирі спостереження про конкретну машину на
   mi_vm.resolved_identity і виміри, а результат згодовується вже
   готовому компілятору Phase 4, який НЕ змінювався.

   Запуск:
     MI_TEST_DB_URL=postgres://... node miresolvertest.js
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
  '013_check_retrieval', '014_check_dedup', '015_identity_resolver', '016_vm_adapter', '017_pack_purpose_key', '018_ingest_bridge',
  '019_request_pack_hit', '020_bridge_decoded_year', '021_anchor_family_equipment',
  '022_partial_identity', '023_report_version_inference'];

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

if (!DB) { console.error('miresolvertest: не задано MI_TEST_DB_URL.'); process.exit(2); }
try { execFileSync(PSQL, ['--version'], { stdio: 'pipe' }); } catch {
  console.error('miresolvertest: psql недоступний.'); process.exit(2); }

try {
  run(['-f', path.join(FIX, '000_test_prelude.sql')], '');
  for (const vf of ['supabase-jobs.sql', 'supabase-vehicle-memory-baseline.sql',
                    'supabase-vehicle-intelligence.sql', 'supabase-vehicle-memory-v1.sql',
                    'supabase-vehicle-memory-v2.sql']) {
    run(['-f', path.join(__dirname, vf)], '');
  }
  for (const m of UPS) run(['-f', path.join(DIR, m + '.up.sql')], '');
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.sql')).sort();
  exec(files.map(f => fs.readFileSync(path.join(DATA, f), 'utf8')).join('\n'));
  run(['-f', path.join(FIX, '020_identity_fixtures.sql')], '');
  run(['-f', path.join(FIX, '021_golden_fixture.sql')], '');
  run(['-f', path.join(FIX, '030_raw_observations.sql')], '');
  exec(`do $$ declare y record; p mi.pack_purpose; begin
          for y in select subject_id from mi.version_market_year loop
            foreach p in array array['decision','report','component','chat']::mi.pack_purpose[] loop
              perform mi.build_fragment(y.subject_id, p);
            end loop;
          end loop;
        end $$;`);
} catch (e) {
  console.error('miresolvertest: не вдалося підготувати базу: ' + why(e));
  process.exit(1);
}

const A = (cond, msg) => `if not (${cond}) then raise exception '${msg}'; end if;`;
const BMW = `mi.resolve_identity('WBAJB9C50JB000001', mi_test.raw_bmw())`;
const TESLA = `mi.resolve_identity('5YJSA1E28FF000002', mi_test.raw_tesla())`;
const POR = `mi.resolve_identity('WP1AD2A2XDLA00003', mi_test.raw_porsche())`;

/* ---- 1..3. Базове розвʼязання ---- */

t(1, 'точні дані VIN дають confirmed', `
  declare i bigint;
  begin
  i := ${BMW};
  ${A("(select resolution_status from mi_vm.resolved_identity_dimension where identity_id=i and dimension='version')::text = 'confirmed'", 'version is not confirmed from the vin')}
  ${A("(select resolution_status from mi_vm.resolved_identity_dimension where identity_id=i and dimension='vmy')::text = 'confirmed'", 'version market year was not derived')}
  ${A("mi.identity_subject(i,'vmy') = (select y.subject_id from mi.version_market_year y join mi.vehicle_version v on v.subject_id=y.version_id where v.version_code='M550I_XDRIVE' and y.model_year=2018)", 'the wrong version market year was derived')}
  ${A("mi.identity_subject(i,'brand') is not null and mi.identity_subject(i,'generation') is not null", 'the hierarchy above the version was not filled')}
  end;`);

t(2, 'без дати складання залежна від неї ревізія не розвʼязується', `
  declare i bigint; st text;
  begin
  i := ${TESLA};
  ${A("not exists (select 1 from mi_vm.resolved_identity_dimension where identity_id=i and dimension='production_date' and resolution_status='confirmed')", 'a production date appeared from nowhere')}
  ${A("(mi.identity_json(i)->>'production_date') is null", 'the identity contract carries an invented production date')}
  st := mi.eval_claim(mi_test.claim('T-005'), mi.identity_json(i))->>'status';
  ${A("st = 'CONDITIONAL'", 'a date dependent claim was resolved without a date')}
  end;`);

t(3, 'сильна роль дає заводське припущення', `
  declare i bigint; j jsonb;
  begin
  i := ${BMW}; j := mi.identity_json(i);
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='engine' and slot='current')::text
        = 'assumed_factory'`, 'the engine current slot is not an assumption')}
  ${A("mi.eval_claim(mi_test.claim('C-025'), j)->>'basis' = 'assumed_strong'", 'a strong role did not produce the strong basis')}
  ${A("mi.eval_claim(mi_test.claim('C-025'), j)->>'status' = 'APPLICABLE'", 'a strong assumption did not produce plain applicability')}
  end;`);

/* ---- 4..6. Слабкі ролі, заміна, заводський слот ---- */

t(4, 'слабка роль Tesla лишається припущенням', `
  declare i bigint; j jsonb;
  begin
  i := ${TESLA}; j := mi.identity_json(i);
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='battery_pack' and slot='current')::text
        = 'assumed_factory'`, 'the battery current slot is not an assumption')}
  ${A("mi.eval_claim(mi_test.claim('T-023'), j)->>'status' = 'APPLICABLE_ASSUMED'", 'a weak role did not produce assumed applicability')}
  ${A("mi.eval_claim(mi_test.claim('T-023'), j)->>'basis' = 'assumed_factory'", 'the weak basis is wrong')}
  end;`);

t(5, 'задокументована заміна перекриває ТІЛЬКИ поточний слот', `
  declare i bigint;
  begin
  i := ${TESLA};
  ${A(`(select value_subject_id from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='mcu' and slot='current')
        = mi_test.sid_of('variant','MCU2')`, 'the documented replacement did not reach the current slot')}
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='mcu' and slot='current')::text
        = 'confirmed'`, 'the documented replacement is not confirmed')}
  ${A("mi.eval_claim(mi_test.claim('T-050#a'), mi.identity_json(i))->>'status' = 'EXCLUDED'", 'knowledge about the replaced unit still applies')}
  end;`);

t(6, 'заводський слот зберігається окремо після заміни', `
  declare i bigint;
  begin
  i := ${TESLA};
  ${A(`(select value_subject_id from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='mcu' and slot='factory')
        = mi_test.sid_of('variant','MCU1')`, 'the factory slot was overwritten by the replacement')}
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='mcu' and slot='factory')::text
        = 'assumed_factory'`, 'the factory slot lost its status')}
  ${A(`(select count(*) from jsonb_array_elements(mi.vin_overlay(i)->'components') c
         where c->>'role' = 'mcu') = 2`, 'the vin overlay lost one of the two slots')}
  end;`);

/* ---- 7..8. Конфлікт і аліас ---- */

t(7, 'два сильні джерела, що розходяться, дають conflicted', `
  declare i bigint; obs jsonb;
  begin
  obs := mi_test.raw_porsche() || jsonb_build_array(
      mi_test.obs('vm:service-record','vehicle_memory','component_variant','suspension_system','current',
                  mi_test.sid_of('variant','AIR_958'),null,null,null,null,null,'high','vm'),
      mi_test.obs('vision:current','current_vision','component_variant','suspension_system','current',
                  mi_test.sid_of('variant','PDCC_958'),null,null,null,null,null,'high','vision2'));
  i := mi.resolve_identity('WP1CONFLICT000001', obs);
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='suspension_system'
           and slot='current')::text = 'conflicted'`, 'two disagreeing strong sources did not produce a conflict')}
  ${A(`(select value_subject_id from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='suspension_system'
           and slot='current') is null`, 'the resolver picked a side of the conflict on its own')}
  ${A(`(select jsonb_array_length(provenance->'candidates') from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='suspension_system'
           and slot='current') = 2`, 'both sides of the conflict were not kept')}
  ${A(`(select conflict_note is not null from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='suspension_system'
           and slot='current')`, 'the conflict has no explanation')}
  end;`);

t(8, 'неоднозначний аліас не вгадується', `
  declare i bigint; obs jsonb; res jsonb;
  begin
  -- Той самий напис у двох контекстах.
  insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind, scope_subject_id)
  values (mi_test.sid_of('variant','N63B44O2'), 'Shared Name', 'shared name', 'community',
          'generation', mi_test.sid_of('generation','G30')),
         (mi_test.sid_of('variant','B58B30'), 'Shared Name', 'shared name', 'community',
          'generation', mi_test.sid_of('generation','F90'));
  res := mi.resolve_alias('Shared Name');
  ${A("(res->>'ambiguous')::boolean", 'an ambiguous alias was silently resolved')}
  ${A("res->>'subject_id' is null", 'an ambiguous alias returned a guess')}
  obs := jsonb_build_array(
    mi_test.obs('vin:X','vin_decoder','version',null,'na',mi_test.sid_of('version','M550I_XDRIVE'),null,null,null,null,null,'high','vin'),
    mi_test.obs('vin:X','vin_decoder','market_sold',null,'na',null,null,'US',null,null,null,'high','vin'),
    mi_test.obs('vin:X','vin_decoder','model_year',null,'na',null,null,null,2018,null,null,'high','vin'),
    mi_test.obs('doc','build_sheet','component_variant','engine','factory',null,'Shared Name',null,null,null,null,'high','bs'));
  i := mi.resolve_identity('WBAAMBIGUOUS00001', obs);
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='component_variant' and role_code='engine'
           and slot='factory')::text in ('unresolved','assumed_factory')`,
      'an ambiguous alias produced a confirmed component')}
  end;`);

/* ---- 9..12. Обладнання, права, ринки, дедуп ---- */

t(9, 'обладнання з Vision не стає заводською опцією', `
  declare i bigint; j jsonb;
  begin
  i := ${POR}; j := mi.identity_json(i);
  ${A(`(select count(*) from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='equipment_present' and slot='current') = 1`,
      'the visual observation did not reach the current equipment slot')}
  ${A(`not exists (select 1 from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='equipment_present' and slot='factory')`,
      'a visual observation was written into the factory equipment slot')}
  ${A(`(select count(*) from jsonb_array_elements(j->'equipment') e) = 1`,
      'the compiler contract lost the current equipment')}
  end;`);

t(10, 'право не виводиться з заліза', `
  declare i bigint; obs jsonb;
  begin
  -- Спостереження ЛИШЕ про залізо: жодного слова про право.
  obs := jsonb_build_array(
    mi_test.obs('vin:Y','vin_decoder','version',null,'na',mi_test.sid_of('version','P85D'),null,null,null,null,null,'high','vin'),
    mi_test.obs('vin:Y','vin_decoder','market_sold',null,'na',null,null,'US',null,null,null,'high','vin'),
    mi_test.obs('vin:Y','vin_decoder','model_year',null,'na',null,null,null,2015,null,null,'high','vin'),
    mi_test.obs('vision:current','current_vision','component_variant','adas_hw','current',
                mi_test.sid_of('variant','AP1'),null,null,null,null,null,'high','vision'));
  i := mi.resolve_identity('5YJHARDWARE00001', obs);
  ${A(`not exists (select 1 from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='entitlement_state')`,
      'an entitlement was inferred from a hardware observation')}
  ${A(`(select jsonb_array_length(mi.identity_json(i)->'entitlements')) = 0`,
      'the compiler contract invented an entitlement')}
  -- А коли право приходить із системи виробника, воно зʼявляється.
  i := ${TESLA};
  ${A(`(select count(*) from mi_vm.resolved_identity_dimension d
         where d.identity_id = i and d.dimension = 'entitlement_state'
           and d.resolution_status = 'confirmed') = 1`,
      'an entitlement from the manufacturer account was lost')}
  end;`);

t(11, 'ринок продажу і ринок експлуатації різні', `
  declare i bigint; j jsonb;
  begin
  i := ${TESLA}; j := mi.identity_json(i);
  ${A("j->>'market_sold' = 'US'", 'the market of sale was lost')}
  ${A("j->>'market_operated' = 'UA'", 'the market of operation was lost')}
  ${A("j->>'market_sold' <> j->>'market_operated'", 'the two markets collapsed into one')}
  end;`);

t(12, 'спільне походження не рахується двічі', `
  declare i bigint; n int;
  begin
  i := ${TESLA};
  -- Аукціон і переписане з нього оголошення мають один корінь.
  select jsonb_array_length(provenance->'supporting') into n
    from mi_vm.resolved_identity_dimension
   where identity_id=i and dimension='salvage_status';
  ${A('n = 1', 'a listing copied from an auction was counted as a second independent source')}
  ${A(`(select resolution_status from mi_vm.resolved_identity_dimension
         where identity_id=i and dimension='salvage_status')::text = 'confirmed'`,
      'the salvage flag was lost')}
  end;`);

/* ---- 13..16. Кругова дорога до компілятора ---- */

t(13, 'вихід резолвера годується компілятору', `
  declare i bigint; p jsonb;
  begin
  i := ${BMW};
  p := mi.compile_pack(mi.identity_json(i), 'report');
  ${A("(p->'pack'->>'fragment_available')::boolean", 'the compiler could not use the resolved identity')}
  ${A("(p->'pack'->'pack_meta'->>'included_count')::int > 0", 'the resolved identity produced an empty pack')}
  ${A("jsonb_array_length(p->'pack'->'identity_summary'->'components') >= 3", 'the identity summary lost the components')}
  end;`);

t(14, 'пакет BMW збігається з очікуванням Phase 4', `
  declare a jsonb; b jsonb;
  begin
  a := mi.compile_pack(mi.identity_json(${BMW}), 'report')->'pack'->'pack_meta';
  b := mi.compile_pack(mi_test.id_bmw(), 'report')->'pack'->'pack_meta';
  ${A("a->>'evaluated_count' = b->>'evaluated_count'", 'the evaluated count diverged from the Phase 4 fixture')}
  ${A("a->>'included_count' = b->>'included_count'", 'the included count diverged from the Phase 4 fixture')}
  ${A("a->'counts' = b->'counts'", 'the status distribution diverged from the Phase 4 fixture')}
  end;`);

t(15, 'пакет Tesla збігається з точністю до навмисної визначеності', `
  declare a jsonb; b jsonb;
  begin
  a := mi.compile_pack(mi.identity_json(${TESLA}), 'report')->'pack'->'pack_meta';
  b := mi.compile_pack(mi_test.id_tesla(), 'report')->'pack'->'pack_meta';
  ${A("a->>'evaluated_count' = b->>'evaluated_count'", 'the evaluated set changed')}
  ${A("(a->'counts'->>'APPLICABLE')::int = (b->'counts'->>'APPLICABLE')::int", 'plain applicable knowledge changed')}
  -- Різниця рівно в тому, що резолвер ЗНАЄ про заміну медіаблока:
  -- знання про старий блок стало виключеним, а не припущеним.
  ${A("(a->'counts'->>'EXCLUDED')::int > 0", 'the documented replacement did not exclude anything')}
  ${A(`(a->'counts'->>'APPLICABLE_ASSUMED')::int + (a->'counts'->>'EXCLUDED')::int
        = (b->'counts'->>'APPLICABLE_ASSUMED')::int`,
      'the excluded knowledge does not account exactly for the drop in assumed knowledge')}
  end;`,
  'Пакет Tesla відрізняється від фікстури Phase 4 рівно на ті клейми, які резолвер зміг виключити завдяки задокументованій заміні медіаблока. Решта збігається.');

t(16, 'невідома дата складання Porsche зберігає умовність', `
  declare i bigint; j jsonb;
  begin
  i := ${POR}; j := mi.identity_json(i);
  ${A("j->>'production_date' is null", 'a production date was invented for this car')}
  ${A("mi.eval_claim(mi_test.claim('P-021'), j)->>'status' = 'CONDITIONAL'", 'the glued pipe claim lost its conditional status')}
  ${A(`mi.eval_claim(mi_test.claim('P-021'),
        mi_test.with_field(j,'production_date', to_jsonb('2013-01-15'::text)))->>'status' = 'APPLICABLE'`,
      'a known build date does not resolve the claim')}
  end;`);

/* ---- 17..19. Збереження, ідемпотентність, накладка ---- */

t(17, 'пакет зберігається з посиланням на розвʼязану ідентичність', `
  declare i bigint; p bigint;
  begin
  i := ${BMW};
  p := mi.persist_pack(i, 'decision');
  ${A('p is not null', 'the pack was not persisted')}
  ${A(`(select identity_id from mi.knowledge_pack where id = p) = i`, 'the pack lost its identity reference')}
  ${A(`(select jsonb_array_length(applicability_log) from mi.knowledge_pack where id = p) > 0`, 'the pack was stored without its applicability log')}
  ${A(`(select stale from mi.knowledge_pack where id = p) = false`, 'a freshly built pack is marked stale')}
  ${A(`mi.persist_pack(i, 'decision') = p`, 'persisting the same pack twice created a second row')}
  end;`);

t(18, 'повторний розбір ідемпотентний, змінений доказ дає нову версію', `
  declare i1 bigint; i2 bigint; i3 bigint; n int;
  begin
  i1 := ${BMW};
  i2 := ${BMW};
  ${A('i1 = i2', 'the same observations produced a second identity row')}
  select count(*) into n from mi_vm.resolved_identity_dimension where identity_id = i1;
  ${A('n = 17', 'the dimension set changed on a repeated resolve')}
  i3 := mi.resolve_identity('WBAJB9C50JB000001', mi_test.raw_bmw() || jsonb_build_array(
          mi_test.obs('vm','vehicle_memory','mileage_km',null,'na',null,null,null,130000,null,null,'high','vm2')));
  ${A('i3 <> i1', 'changed evidence did not produce a new resolution')}
  ${A(`(select count(*) from mi_vm.resolved_identity where vin = 'WBAJB9C50JB000001') = 2`,
      'the previous resolution was lost instead of kept')}
  end;`);

t(19, 'накладка по VIN не несе загального знання про модель', `
  declare i bigint; o jsonb;
  begin
  i := ${TESLA}; o := mi.vin_overlay(i);
  ${A("o->>'vin' = '5YJSA1E28FF000002'", 'the overlay lost the vehicle it describes')}
  ${A("jsonb_array_length(o->'components') > 0", 'the overlay has no component state')}
  -- Жодного тексту опублікованого клейма у накладці бути не може.
  ${A(`not exists (select 1 from mi.claim c where c.status = 'published'
                    and length(c.text_en) > 40 and position(c.text_en in o::text) > 0)`,
      'generic model knowledge leaked into the vin overlay')}
  ${A("o->'unresolved' is not null", 'the overlay hides what could not be resolved')}
  end;`);

if (errs.length) {
  console.error('miresolvertest: помилок ' + errs.length + ' із ' + checks);
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('miresolvertest: усі ' + checks + ' перевірок пройшли');
for (const n of notes) console.log('   note ' + n);
