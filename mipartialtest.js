/* Phase 7.3: часткова ідентичність, глобальний якір на родину і
   обладнання, модифікація з розбору Check, рік лише з декоду.

   Головне, що тут доводиться:
   - точний шлях VMY не змінився нічим, крім схваленого якоря: база
     спершу піднімається на міграціях 001..019, знімаються ВСІ точні
     пакети, потім накочуються 020..023 і пакети знімаються знову;
   - машина з підтвердженою версією, але без ринку чи року, отримує
     знання, а не відмову, і нічого не вигадується;
   - опційний PTV+ не стає застосовним без доказу наявності ні на
     точному, ні на частковому шляху;
   - рік оголошення більше не пишеться як модельний рік;
   - висновок розбору Check лише спостереження з низькою довірою: декод
     його перебиває, справжня розбіжність видна, резолвер нічого не
     вирішує за LLM.

   Запуск:
     MI_TEST_DB_URL=postgres://... node mipartialtest.js
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

const PRODUCT_SCHEMA = ['supabase-jobs.sql', 'supabase-vehicle-memory-baseline.sql',
  'supabase-vehicle-intelligence.sql', 'supabase-vehicle-memory-v1.sql',
  'supabase-vehicle-memory-v2.sql'];

const LEGACY = ['001_schemas_enums_lookups', '002_subjects_hierarchy_source',
  '003_components_equipment_state', '004_issue_maintenance_check',
  '005_claims_applicability_evidence', '006_staging', '007_mi_vm_interface',
  '008_fragments_packs_operations', '009_validation_permissions',
  '010_knowledge_lifecycle', '011_staging_buyer_metadata', '012_pack_compiler',
  '013_check_retrieval', '014_check_dedup', '015_identity_resolver',
  '016_vm_adapter', '017_pack_purpose_key', '018_ingest_bridge',
  '019_request_pack_hit'];
const AMEND = ['020_bridge_decoded_year', '021_anchor_family_equipment',
  '022_partial_identity', '023_report_version_inference'];

function run(args, sql) {
  return execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, ...args],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
}
function why(e) {
  const out = String(e.stderr || e.message);
  const line = out.split('\n').find(l => /ERROR|FATAL/.test(l));
  return (line || out.split('\n')[0] || '').trim().slice(0, 300);
}
const exec = sql => run([], sql);

function t(n, name, body, note) {
  checks++;
  try { exec('begin;\ndo $g$\nbegin\n' + body + '\nend $g$;\nrollback;'); }
  catch (e) { errs.push(n + '. ' + name + ': ' + why(e)); }
  if (note) notes.push(n + '. ' + note);
}

if (!DB) { console.error('mipartialtest: не задано MI_TEST_DB_URL.'); process.exit(2); }
try { execFileSync(PSQL, ['--version'], { stdio: 'pipe' }); } catch {
  console.error('mipartialtest: psql недоступний.'); process.exit(2); }

/* Знімок кожного точного пакета: каталожна ідентичність кожного VMY у
   чотирьох призначеннях, золоті ідентичності фікстури 020 і ідентичності,
   які резолвер будує із сирих спостережень фікстури 030. VIN резолвера
   залежить від фази, щоб поточна фаза справді проходила новий резолвер. */
const SNAPSHOT_SQL = `
create table if not exists mi_test.exact_snap (phase text, label text, pack jsonb, log jsonb,
  primary key (phase, label));

create or replace function mi_test.take_exact_snapshot(p_phase text) returns int language plpgsql as $$
declare y record; p mi.pack_purpose; ident jsonb; r jsonb; n int := 0; src record; i bigint;
begin
  delete from mi_test.exact_snap where phase = p_phase;
  for y in select v.version_code, y2.model_year, y2.market_code
             from mi.version_market_year y2 join mi.vehicle_version v on v.subject_id = y2.version_id loop
    ident := mi_test.identity_of(y.version_code, y.model_year, y.market_code);
    foreach p in array array['decision','report','component','chat']::mi.pack_purpose[] loop
      r := mi.compile_pack(ident, p);
      insert into mi_test.exact_snap values (p_phase,
        format('catalog:%s/%s/%s:%s', y.version_code, y.market_code, y.model_year, p), r->'pack', r->'applicability_log');
      n := n + 1;
    end loop;
  end loop;
  for src in select * from (values ('golden:bmw', mi_test.id_bmw()), ('golden:tesla', mi_test.id_tesla()),
                                   ('golden:porsche', mi_test.id_porsche())) t(lbl, ident) loop
    foreach p in array array['decision','report']::mi.pack_purpose[] loop
      r := mi.compile_pack(src.ident, p);
      insert into mi_test.exact_snap values (p_phase, src.lbl || ':' || p, r->'pack', r->'applicability_log');
      n := n + 1;
    end loop;
  end loop;
  for src in select * from (values ('resolver:bmw', mi_test.raw_bmw()), ('resolver:tesla', mi_test.raw_tesla()),
                                   ('resolver:porsche', mi_test.raw_porsche())) t(lbl, obs) loop
    i := mi.resolve_identity('SNAP-' || p_phase || '-' || src.lbl, src.obs);
    ident := mi.identity_json(i);
    foreach p in array array['decision','report']::mi.pack_purpose[] loop
      r := mi.compile_pack(ident, p);
      insert into mi_test.exact_snap values (p_phase, src.lbl || ':' || p, r->'pack', r->'applicability_log');
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- Прибирає всі ключі basis на будь-якій глибині.
create or replace function mi_test.strip_basis(j jsonb) returns jsonb language sql immutable as $$
  select case jsonb_typeof(j)
    when 'object' then (select coalesce(jsonb_object_agg(k, mi_test.strip_basis(v)), '{}'::jsonb)
                          from jsonb_each(j) e(k, v) where k <> 'basis')
    when 'array' then (select coalesce(jsonb_agg(mi_test.strip_basis(v) order by ord), '[]'::jsonb)
                         from jsonb_array_elements(j) with ordinality a(v, ord))
    else j end $$;

-- Лог як мультимножина: без basis, без статусу P-053 і, для поточної
-- фази, без неявних груп якоря на родину і обладнання. Порядок записів
-- канонічних перевірок у лозі не визначений (сортування за claim_id,
-- який у них null), тому порівнюється множина, а не масив.
create or replace function mi_test.norm_log(p_log jsonb, p_drop_anchor boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from (
    select (e - 'basis' - 'predicates' - 'status')
           || jsonb_build_object(
                'status', case when (e->>'claim_id')::bigint = mi_test.claim('P-053#a-r1') then 'P053'
                               else e->>'status' end,
                'predicates', coalesce((
                   select jsonb_agg(p - 'basis' order by o)
                     from jsonb_array_elements(coalesce(e->'predicates', '[]'::jsonb)) with ordinality x(p, o)
                    where not (p_drop_anchor and p->>'group' = '0'
                               and p->>'dimension' in ('component_family', 'equipment_present'))), '[]'::jsonb)) as x
      from jsonb_array_elements(p_log) e) s $$;
`;

/* Часткова ідентичність: лише те, що випливає з версії, плюс явно
   передані рік і ринок. Компонентів немає. */
const HELPERS_SQL = `
create or replace function mi_test.partial_of(p_code text, p_year int default null, p_market text default null)
returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('version', v.subject_id, 'generation', v.generation_id,
           'model_line', g.model_line_id, 'brand', m.brand_id, 'model_year', p_year, 'market_sold', p_market))
         || jsonb_build_object('components', '[]'::jsonb, 'equipment', '[]'::jsonb,
                               'entitlements', '[]'::jsonb, 'states', '[]'::jsonb)
    from mi.vehicle_version v join mi.generation g on g.subject_id = v.generation_id
    join mi.model_line m on m.subject_id = g.model_line_id where v.version_code = p_code $$;

create or replace function mi_test.item_of(p_label text) returns bigint language sql stable as $$
  select ei.subject_id from mi.equipment_item ei join mi.knowledge_subject ks on ks.id = ei.subject_id
   where ks.label = p_label $$;

-- Машина у тому вигляді, як її пише Check, і звіт Check з полем vehicle.trim.
create or replace function mi_test.seed_vehicle(p_vin text, p_make text, p_model text,
    p_trim text, p_nhtsa jsonb, p_model_year int, p_listing_year int)
returns void language sql as $$
  insert into public.vehicles (vin, make, model, year, model_year, trim, nhtsa, decoder_version,
      first_seen_at, last_seen_at, snapshots_count)
  values (p_vin, p_make, p_model, p_listing_year, p_model_year, p_trim, p_nhtsa,
      case when p_nhtsa is null then null else 'vpic-v1' end, '2026-08-01', '2026-08-01', 1) $$;

create or replace function mi_test.add_report(p_vin text, p_trim text, p_at timestamptz)
returns void language sql as $$
  insert into public.reports (created_at, kind, data)
  values (p_at, 'check', jsonb_build_object('_meta', jsonb_build_object('vin', p_vin),
                                            'vehicle', jsonb_build_object('trim', p_trim))) $$;

-- Усі claim_id, що дійшли до пакета.
create or replace function mi_test.pack_claims(p_pack jsonb) returns bigint[] language sql immutable as $$
  select coalesce(array_agg(distinct (x #>> '{}')::bigint), '{}'::bigint[])
    from jsonb_path_query(p_pack, '$.**.claim_id') x where jsonb_typeof(x) = 'number' $$;
`;

try {
  run(['-f', path.join(FIX, '000_test_prelude.sql')], '');
  for (const f of PRODUCT_SCHEMA) run(['-f', path.join(__dirname, f)], '');
  for (const m of LEGACY) run(['-f', path.join(DIR, m + '.up.sql')], '');
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.sql')).sort();
  exec(files.map(f => fs.readFileSync(path.join(DATA, f), 'utf8')).join('\n'));
  for (const f of ['020_identity_fixtures', '021_golden_fixture', '030_raw_observations']) {
    run(['-f', path.join(FIX, f + '.sql')], '');
  }
  exec(`do $$ declare y record; p mi.pack_purpose; begin
          for y in select subject_id from mi.version_market_year order by subject_id loop
            foreach p in array array['decision','report','component','chat']::mi.pack_purpose[] loop
              perform mi.build_fragment(y.subject_id, p);
            end loop;
          end loop;
        end $$;`);
  exec(SNAPSHOT_SQL);
  exec("select mi_test.take_exact_snapshot('legacy');");
  for (const m of AMEND) run(['-f', path.join(DIR, m + '.up.sql')], '');
  exec("select mi_test.take_exact_snapshot('current');");
  run(['-f', path.join(FIX, '050_check_ingest.sql')], '');
  run(['-f', path.join(FIX, '060_production_replay.sql')], '');
  exec(HELPERS_SQL);
  exec('select mi_test.seed_all_checks(); select mi_test.seed_production_replay();');
} catch (e) {
  console.error('mipartialtest: не вдалося підготувати базу: ' + why(e));
  process.exit(1);
}

const A = (cond, msg) => `if not (${cond}) then raise exception '${msg}'; end if;`;
const BMW = "'WBAJB9C50JB049616'";
const TSL = "'5YJSA1H23FFP69703'";
const POR = "'WP1ZZZ92ZDLA45155'";

/* ---- 1..5. Точний шлях VMY ---- */

t(1, 'точні пакети не змінились нічим, крім схваленого якоря', `
  declare r record; n int := 0; bad text := ''; p053 bigint := mi_test.claim('P-053#a-r1');
  begin
  for r in select l.label, l.pack lp, c.pack cp, l.log ll, c.log cl
             from mi_test.exact_snap l
             join mi_test.exact_snap c on c.label = l.label and c.phase = 'current'
            where l.phase = 'legacy' loop
    n := n + 1;
    if mi_test.strip_basis(r.lp) <> mi_test.strip_basis(r.cp) then
      if not (r.label like '%GTS/US/2013%' or r.label like '%porsche%') then
        bad := bad || r.label || ' pack; ';
      elsif not (array(select unnest(mi_test.pack_claims(r.lp)) except select unnest(mi_test.pack_claims(r.cp))) = array[p053]
                 and cardinality(array(select unnest(mi_test.pack_claims(r.cp)) except select unnest(mi_test.pack_claims(r.lp)))) = 0
                 and (r.cp->'pack_meta'->'counts'->>'CONDITIONAL')::int = (r.lp->'pack_meta'->'counts'->>'CONDITIONAL')::int + 1
                 and (r.cp->'pack_meta'->'counts'->>'APPLICABLE')::int = (r.lp->'pack_meta'->'counts'->>'APPLICABLE')::int - 1) then
        bad := bad || r.label || ' porsche; ';
      end if;
    end if;
    if mi_test.norm_log(r.ll, false) <> mi_test.norm_log(r.cl, true) then
      bad := bad || r.label || ' log; ';
    end if;
  end loop;
  ${A('n = 44', 'the snapshot does not cover all 44 exact packs')}
  ${A("bad = ''", 'the exact path changed beyond the anchor fix')}
  end;`, 'на 44 точних пакетах змінилися лише basis родинного знання і PTV+ (APPLICABLE -> CONDITIONAL)');

t(2, 'точний пакет не несе метаданих часткової ідентичності і читає фрагмент', `
  begin
  ${A(`not exists (select 1 from mi_test.exact_snap where phase = 'current'
         and (pack->'pack_meta' ? 'identity_precision' or pack->'pack_meta'->>'fragment_id' is null))`,
      'an exact pack looks like a partial one')}
  end;`);

t(3, 'промах фрагмента на точному шляху і далі не компілює синхронно', `
  declare ident jsonb; target bigint; before int; after int; res jsonb;
  begin
  ident := mi_test.identity_of('M550I_XDRIVE', 2019, 'US');
  target := (ident->>'vmy')::bigint;
  delete from mi.pack_fragment where vmy_id = target;
  select count(*) into before from mi.build_request;
  res := mi.request_pack(ident, 'decision');
  select count(*) into after from mi.build_request;
  ${A("(res->>'fragment_available')::boolean = false and res->>'reason' = 'fragment_missing'", 'an exact miss was not reported as a miss')}
  ${A('after > before', 'an exact miss no longer queues a build request')}
  ${A('not exists (select 1 from mi.pack_fragment where vmy_id = target)', 'the exact hot path built a fragment')}
  end;`);

t(4, 'PTV+ на точному шляху: без доказу обладнання умовне', `
  declare id jsonb; ptv bigint := mi_test.item_of('Porsche Torque Vectoring Plus');
  begin
  id := mi_test.identity_of('GTS', 2013, 'US');
  ${A("mi_test.status('P-053#a-r1', id) = 'CONDITIONAL'", 'optional PTV+ knowledge is applicable without equipment evidence')}
  ${A("not mi_test.in_pack(mi_test.pack(id, 'report'), mi_test.claim('P-053#a-r1'))", 'optional PTV+ knowledge reached the report pack')}
  ${A("mi_test.status('P-053#a-r1', mi_test.with_equipment(id, ptv, true)) = 'APPLICABLE'", 'confirmed PTV+ did not make the knowledge applicable')}
  ${A("mi_test.status('P-053#a-r1', mi_test.with_equipment(id, ptv, false)) like 'EXCLUDED%'", 'confirmed absence of PTV+ did not exclude the knowledge')}
  ${A("mi_test.status('P-053#a-r1', mi_test.with_equipment(id, ptv, true, 'conflicted')) = 'CONDITIONAL'", 'conflicting PTV+ evidence was treated as proof')}
  end;`, 'регресія P-053: доступність опції у VMY більше не доказ її наявності');

t(5, 'якір на родину і стандартне обладнання', `
  declare id jsonb; id2 jsonb; std bigint := mi_test.item_of('PASM with steel springs');
  begin
  id := mi_test.identity_of('M550I_XDRIVE', 2018, 'US');
  ${A("mi_test.status('C-057', id) = 'APPLICABLE' and mi_test.basis('C-057', id) = 'assumed_strong'",
      'family knowledge on an assumed strong role changed status or lost its basis')}
  id2 := mi_test.with_component(mi_test.with_component(id, 'engine', 'current', null, null), 'engine', 'factory', null, null);
  ${A("mi_test.status('C-057', id2) = 'CONDITIONAL'", 'family knowledge stayed applicable with the engine unresolved')}
  ${A(`mi.anchor_other_result(jsonb_build_object('kind', 'equipment_item', 'subject_id', std),
         mi_test.identity_of('GTS', 2013, 'US')) is null`, 'standard equipment of the exact VMY gained an implicit group')}
  ${A(`mi.anchor_other_result(jsonb_build_object('kind', 'equipment_item', 'subject_id', std),
         mi_test.identity_of('GTS', 2013, 'US') - 'vmy')->>'result' = 'UNKNOWN'`,
      'standard equipment was assumed without an exact VMY')}
  end;`);

/* ---- 6..14. Частковий шлях ---- */

t(6, 'частковий пакет BMW лише з версії', `
  declare p jsonb;
  begin
  p := mi_test.pack(mi_test.partial_of('M550I_XDRIVE'), 'report');
  ${A("(p->>'fragment_available')::boolean", 'a confirmed version got no pack')}
  ${A("p->'pack_meta'->>'identity_precision' = 'partial'", 'the pack does not say it is partial')}
  ${A("p->'pack_meta'->'unresolved_dimensions' = '[\"market_sold\", \"model_year\", \"vmy\"]'::jsonb", 'unresolved dimensions are wrong')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 3", 'candidate VMY count is wrong')}
  ${A("(p->'pack_meta'->>'inaccessible_vmy_only_count')::int = 7", 'VMY-only knowledge count is wrong')}
  ${A("(p->'pack_meta'->'counts'->>'APPLICABLE')::int > 0", 'no knowledge is applicable')}
  ${A("jsonb_array_length(p->'coverage_statement') > 0", 'the partial pack has no coverage statement')}
  ${A("p->'pack_meta'->>'fragment_id' is null", 'a partial pack claims a fragment')}
  ${A("not (mi_test.claim('C-001') = any (mi_test.pack_claims(p)))", 'VMY-anchored knowledge reached a partial pack')}
  end;`);

t(7, 'частковий пакет Tesla лише з версії', `
  declare p jsonb;
  begin
  p := mi_test.pack(mi_test.partial_of('P85D'), 'report');
  ${A("(p->>'fragment_available')::boolean and p->'pack_meta'->>'identity_precision' = 'partial'", 'Tesla version got no partial pack')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 1", 'Tesla candidate VMY count is wrong')}
  ${A("(p->'pack_meta'->>'inaccessible_vmy_only_count')::int = 1", 'Tesla VMY-only count is wrong')}
  ${A("(p->'pack_meta'->'counts'->>'APPLICABLE')::int > 0", 'no Tesla knowledge is applicable')}
  end;`);

t(8, 'частковий пакет Porsche лише з версії, PTV+ умовне', `
  declare id jsonb; p jsonb;
  begin
  id := mi_test.partial_of('GTS');
  p := mi_test.pack(id, 'report');
  ${A("(p->>'fragment_available')::boolean and p->'pack_meta'->>'identity_precision' = 'partial'", 'Porsche version got no partial pack')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 2", 'Porsche candidate VMY count is wrong')}
  ${A("(p->'pack_meta'->>'inaccessible_vmy_only_count')::int = 2", 'Porsche VMY-only count is wrong')}
  ${A("mi_test.status('P-053#a-r1', id) = 'CONDITIONAL'", 'optional PTV+ knowledge is applicable on the partial path')}
  ${A("not (mi_test.claim('P-053#a-r1') = any (mi_test.pack_claims(p)))", 'optional PTV+ knowledge reached a partial pack')}
  end;`, 'регресія P-053 на частковому шляху');

t(9, 'невідомий ринок не вимикає пакет', `
  declare p jsonb;
  begin
  p := mi_test.pack(mi_test.partial_of('M550I_XDRIVE', 2018), 'decision');
  ${A("(p->>'fragment_available')::boolean", 'an unknown market killed the pack')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 1", 'the confirmed model year did not narrow the candidates')}
  ${A("p->'pack_meta'->'unresolved_dimensions' = '[\"market_sold\", \"vmy\"]'::jsonb", 'unresolved dimensions are wrong')}
  end;`);

t(10, 'невідомий модельний рік не вимикає пакет', `
  declare p jsonb;
  begin
  p := mi_test.pack(mi_test.partial_of('M550I_XDRIVE', null, 'US'), 'decision');
  ${A("(p->>'fragment_available')::boolean", 'an unknown model year killed the pack')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 3", 'an unknown dimension filtered the candidates')}
  ${A("p->'pack_meta'->'unresolved_dimensions' = '[\"model_year\", \"vmy\"]'::jsonb", 'unresolved dimensions are wrong')}
  end;`);

t(11, 'підтверджений рік без VMY у каталозі не вигадує конфігурацію', `
  declare p jsonb; n int;
  begin
  p := mi_test.pack(mi_test.partial_of('M550I_XDRIVE', 2017), 'report');
  ${A("(p->>'fragment_available')::boolean", 'a year outside the catalogue killed the pack')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 0", 'a VMY was invented for a year the catalogue does not have')}
  select count(*) into n from unnest(mi_test.pack_claims(p)) c
   where mi.claim_anchor_variant(c) is not null
      or mi.subject_anchor_other((select subject_id from mi.claim where id = c)) is not null;
  ${A('n = 0', 'factory configuration knowledge reached a car with no candidate VMY')}
  end;`);

t(12, 'частковий шлях не припускає компонентів', `
  declare code text; p jsonb;
  begin
  foreach code in array array['M550I_XDRIVE', 'P85D', 'GTS'] loop
    p := mi_test.pack(mi_test.partial_of(code), 'report');
    ${A("p->'identity_summary'->'components' = '[]'::jsonb", 'a component was assumed without an exact VMY')}
    ${A("p::text not like '%assumed_factory%' and p::text not like '%assumed_strong%'", 'a partial pack carries a factory assumption')}
  end loop;
  end;`);

t(13, 'текст заблокованого кандидата не потрапляє у частковий пакет', `
  declare blob text := ''; code text; pur text; n int;
  begin
  foreach code in array array['M550I_XDRIVE', 'P85D', 'GTS'] loop
    foreach pur in array array['decision', 'report'] loop
      blob := blob || mi_test.pack(mi_test.partial_of(code), pur)::text;
    end loop;
  end loop;
  select count(*) into n from mi.candidate_claim c
   where c.published_claim_id is null and length(c.text_en) > 40 and blob like '%' || c.text_en || '%';
  ${A('n = 0', 'blocked candidate text leaked into a partial pack')}
  end;`);

t(14, 'резолвер: з версії виводиться ієрархія, ринок і рік не вигадуються', `
  declare i bigint; j jsonb; ver bigint;
  begin
  select subject_id into ver from mi.vehicle_version where version_code = 'M550I_XDRIVE';
  i := mi.resolve_identity('PARTIAL-VERSION-ONLY', jsonb_build_array(jsonb_build_object(
         'source', 'dec', 'source_type', 'vin_decoder', 'dimension', 'version', 'slot', 'na',
         'observed_at', '2026-08-01', 'confidence', 'high', 'value_subject', ver)));
  j := mi.identity_json(i);
  ${A("(j->>'version')::bigint = " + "ver and j->>'generation' is not null and j->>'model_line' is not null and j->>'brand' is not null",
      'the hierarchy was not derived from the confirmed version')}
  ${A("j->>'vmy' is null and j->>'market_sold' is null and j->>'model_year' is null", 'a missing dimension was invented')}
  ${A(`(select provenance->>'basis' from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'generation') = 'catalog'`, 'the derived generation does not say it came from the catalogue')}
  ${A(`(select resolution_status::text from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'vmy') = 'unresolved'`, 'the version market year is not recorded as unresolved')}
  end;`);

/* ---- 15..16. Збереження і гаряча дорога часткового пакета ---- */

t(15, 'частковий пакет зберігається і повтор не дублює рядок', `
  declare i bigint; ver bigint; a bigint; b bigint;
  begin
  select subject_id into ver from mi.vehicle_version where version_code = 'P85D';
  i := mi.resolve_identity('PARTIAL-PERSIST', jsonb_build_array(jsonb_build_object(
         'source', 'dec', 'source_type', 'vin_decoder', 'dimension', 'version', 'slot', 'na',
         'observed_at', '2026-08-01', 'confidence', 'high', 'value_subject', ver)));
  a := mi.persist_pack(i, 'decision');
  b := mi.persist_pack(i, 'decision');
  ${A('a is not null and a = b', 'a partial pack was not stored idempotently')}
  ${A('(select fragment_id from mi.knowledge_pack where id = a) is null', 'a stored partial pack points to a fragment')}
  end;`);

t(16, 'частковий запит не ставить заявку на збірку', `
  declare before int; after int; res jsonb;
  begin
  select count(*) into before from mi.build_request;
  res := mi.request_pack(mi_test.partial_of('GTS'), 'decision');
  res := mi.request_pack(mi_test.partial_of('GTS') - 'version', 'decision');
  select count(*) into after from mi.build_request;
  ${A('after = before', 'a request without an exact VMY queued a build request')}
  ${A("res->>'reason' = 'version_not_identified'", 'a request without a version did not name its reason')}
  end;`);

/* ---- 17..23. Міст: рік і висновок розбору Check ---- */

t(17, 'рік оголошення не пишеться як модельний рік', `
  declare j jsonb;
  begin
  j := mi.ingest_identity_from_check(${BMW});
  ${A(`not exists (select 1 from public.vehicle_identity_observation
         where vin = ${BMW} and dimension = 'model_year')`, 'the listing registration year was written as the model year')}
  ${A("j->>'listing_year_not_used' = '2017' and j->>'model_year' is null", 'the ignored listing year is not visible')}
  end;`, 'WBAJB9C50JB049616: оголошення каже 2017, модельний рік лишається невідомим, а не хибним');

t(18, 'рік із декоду і далі пишеться', `
  begin
  perform mi.ingest_identity_from_check(${TSL});
  ${A(`(select value_num from public.vehicle_identity_observation
         where vin = ${TSL} and dimension = 'model_year' and source_kind = 'vin_decoder') = 2015`,
      'the decoded model year was lost')}
  end;`);

t(19, 'модифікація з розбору Check це спостереження з низькою довірою', `
  declare o record; i bigint;
  begin
  perform mi.ingest_identity_from_check(${BMW});
  select * into o from public.vehicle_identity_observation where vin = ${BMW} and dimension = 'version';
  ${A("o.source_kind = 'check_inference' and o.confidence = 'low' and o.value_text = 'M550I_XDRIVE'",
      'the Check modification was not recorded as a low confidence inference')}
  ${A("o.provenance_root like 'report:%' and o.source_ref = o.provenance_root", 'the inference does not point to its report')}
  i := mi.resolve_from_memory(${BMW});
  ${A(`(select resolution_status::text || '/' || confidence::text || '/' || (provenance->>'basis')
          from mi_vm.resolved_identity_dimension where identity_id = i and dimension = 'version')
       = 'confirmed/low/check_inference'`, 'the version is not confirmed with low confidence from the inference')}
  ${A("mi.identity_json(i)->>'version_basis' = 'check_inference'", 'the identity does not say its version is inferred')}
  end;`);

t(20, 'детермінований декод перебиває висновок Check', `
  declare i bigint; row mi_vm.resolved_identity_dimension;
  begin
  perform mi_test.seed_vehicle('PARTDECODER000001', 'bmw', '5 series', '540i',
    '{"Make": "BMW", "Model": "5-Series", "Trim": "540i", "ModelYear": "2018"}'::jsonb, 2018, 2018);
  perform mi_test.add_report('PARTDECODER000001', 'M550i xDrive', '2026-08-02');
  perform mi.ingest_identity_from_check('PARTDECODER000001');
  i := mi.resolve_from_memory('PARTDECODER000001');
  select * into row from mi_vm.resolved_identity_dimension where identity_id = i and dimension = 'version';
  ${A("row.resolution_status = 'confirmed' and row.value_subject_id = (select subject_id from mi.vehicle_version where version_code = '540I')",
      'the inference overrode the deterministic decode')}
  ${A("row.provenance->>'basis' = 'vin_decoder'", 'the decode is not the basis of the version')}
  ${A(`exists (select 1 from jsonb_array_elements(row.provenance->'conflicting') c
                where c->>'source_type' = 'check_inference')`, 'the disagreeing inference is not visible')}
  end;`);

t(21, 'різні формулювання однієї версії не конфліктують', `
  declare i bigint; row mi_vm.resolved_identity_dimension;
  begin
  perform mi_test.seed_vehicle('PARTWORDING000001', 'bmw', '5 series', null, null, null, 2017);
  perform mi_test.add_report('PARTWORDING000001', 'M550i xDrive', '2026-08-02');
  perform mi_test.add_report('PARTWORDING000001', 'BMW M550i xDrive', '2026-08-03');
  perform mi.ingest_identity_from_check('PARTWORDING000001');
  ${A(`(select count(*) from public.vehicle_identity_observation
         where vin = 'PARTWORDING000001' and source_kind = 'check_inference') = 2`, 'both reports were not recorded')}
  i := mi.resolve_from_memory('PARTWORDING000001');
  select * into row from mi_vm.resolved_identity_dimension where identity_id = i and dimension = 'version';
  ${A("row.resolution_status = 'confirmed' and row.conflict_note is null", 'two wordings of one version produced a conflict')}
  end;`);

t(22, 'справжня розбіжність висновків лишається конфліктом', `
  declare i bigint; s jsonb;
  begin
  perform mi_test.seed_vehicle('PARTDISAGREE00001', 'bmw', '5 series', null, null, null, 2018);
  perform mi_test.add_report('PARTDISAGREE00001', 'M550i xDrive', '2026-08-02');
  perform mi_test.add_report('PARTDISAGREE00001', '540i', '2026-08-03');
  perform mi.ingest_identity_from_check('PARTDISAGREE00001');
  i := mi.resolve_from_memory('PARTDISAGREE00001');
  ${A(`(select resolution_status::text from mi_vm.resolved_identity_dimension
         where identity_id = i and dimension = 'version') = 'conflicted'`, 'two different inferred versions did not conflict')}
  ${A("mi.identity_json(i)->>'version' is null", 'a conflicted version reached the identity')}
  s := mi.shadow_pack('PARTDISAGREE00001');
  ${A("(s->>'mi_available')::boolean = false and s->>'diagnostic' = 'version_not_identified'", 'a conflicted version still produced a pack')}
  end;`, 'рівні за силою джерела, що розходяться, більше не розвʼязуються алфавітом');

t(23, 'неоднозначний або надто конкретний текст не пишеться', `
  declare j jsonb;
  begin
  perform mi_test.seed_vehicle('PARTAMBIGUOUS0001', 'porsche', 'cayenne', null, null, null, 2013);
  perform mi_test.add_report('PARTAMBIGUOUS0001', 'GTS or Turbo', '2026-08-02');
  perform mi_test.add_report('PARTAMBIGUOUS0001', 'Cayenne Turbo S', '2026-08-03');
  j := mi.ingest_identity_from_check('PARTAMBIGUOUS0001');
  ${A(`not exists (select 1 from public.vehicle_identity_observation
         where vin = 'PARTAMBIGUOUS0001' and dimension = 'version')`, 'an ambiguous or over-specific text was written as a version')}
  ${A("(j->'report_versions'->0->'match'->>'ambiguous')::boolean", 'the ambiguous text was not reported as ambiguous')}
  ${A("j->'report_versions'->1->'match'->'unexplained_tokens' = '[\"s\"]'::jsonb", 'the unexplained token of Turbo S is not visible')}
  end;`);

/* ---- 24..28. Реальні машини продакшну ---- */

t(24, 'BMW продакшну отримує знання без вигаданого ринку і року', `
  declare s jsonb; j jsonb;
  begin
  s := mi.shadow_pack(${BMW});
  ${A("(s->>'mi_available')::boolean and s->>'identity_precision' = 'partial'", 'the real BMW got no partial pack')}
  j := mi.identity_json((s->>'identity_id')::bigint);
  ${A("j->>'market_sold' is null and j->>'model_year' is null and j->>'vmy' is null", 'a missing identity value was invented for the real BMW')}
  ${A("(s->'decision'->'meta'->>'candidate_vmy_count')::int = 3", 'the real BMW candidate count is wrong')}
  ${A("(s->'report'->'meta'->'counts'->>'APPLICABLE')::int > 0", 'the real BMW received no applicable knowledge')}
  end;`);

t(25, 'Tesla продакшну: версія з розбору, рік з декоду', `
  declare s jsonb; j jsonb;
  begin
  s := mi.shadow_pack(${TSL});
  j := mi.identity_json((s->>'identity_id')::bigint);
  ${A("(s->>'mi_available')::boolean and s->>'identity_precision' = 'partial'", 'the real Tesla got no partial pack')}
  ${A("(j->>'version')::bigint = (select subject_id from mi.vehicle_version where version_code = 'P85D')", 'the real Tesla version was not identified')}
  ${A("(j->>'model_year')::int = 2015 and j->>'market_sold' is null", 'the real Tesla year or market is wrong')}
  ${A("(s->'decision'->'meta'->>'candidate_vmy_count')::int = 1", 'the real Tesla candidate count is wrong')}
  end;`);

t(26, 'Porsche продакшну: частковий пакет, PTV+ не застосовне', `
  declare s jsonb; j jsonb; p jsonb;
  begin
  s := mi.shadow_pack(${POR});
  j := mi.identity_json((s->>'identity_id')::bigint);
  ${A("(s->>'mi_available')::boolean and s->>'identity_precision' = 'partial'", 'the real Porsche got no partial pack')}
  ${A("(j->>'version')::bigint = (select subject_id from mi.vehicle_version where version_code = 'GTS')", 'the real Porsche version was not identified')}
  ${A("(j->>'model_year')::int = 2013 and j->>'market_sold' is null", 'the real Porsche year or market is wrong')}
  ${A("mi_test.status('P-053#a-r1', j) = 'CONDITIONAL'", 'PTV+ knowledge is applicable on the real Porsche')}
  p := mi.request_pack(j, 'report')->'pack';
  ${A("not (mi_test.claim('P-053#a-r1') = any (mi_test.pack_claims(p)))", 'PTV+ knowledge reached the real Porsche pack')}
  ${A("(s->'decision'->'meta'->>'inaccessible_vmy_only_count')::int = 2", 'US VMY-only knowledge is not counted as inaccessible')}
  end;`, 'US-знання про сам VMY (прайс, EPA, відклики) для Porsche недосяжне: ринок невідомий');

t(27, 'бренд поза каталогом і далі відмовляє з причиною', `
  declare s jsonb;
  begin
  s := mi.shadow_pack('WVWZZZ1KZAW0S0004');
  ${A("(s->>'mi_available')::boolean = false and s->>'diagnostic' = 'brand_not_in_catalog'", 'a car outside the corpus was not refused with its reason')}
  end;`);

t(28, 'підсумок ідентичності позначає висновок Check, а декод ні', `
  declare s jsonb; e jsonb;
  begin
  s := mi.shadow_pack(${BMW});
  ${A("s->'identity_summary'->>'version_note' like 'INFERRED FROM CHECK ANALYSIS:%'", 'the inferred version is not marked in the summary')}
  e := mi.shadow_pack('5YJSA1E28FF0S0002');
  ${A("(e->>'mi_available')::boolean and e->>'identity_precision' = 'exact'", 'the decoded synthetic Tesla lost its exact pack')}
  ${A("not (e->'identity_summary' ? 'version_note') and not (e->'identity_summary' ? 'version')", 'a decoded exact identity gained inference markers')}
  end;`);

if (errs.length) {
  console.error('mipartialtest: помилок ' + errs.length + ' із ' + checks);
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('mipartialtest: усі ' + checks + ' перевірок пройшли');
for (const n of notes) console.log('   note ' + n);
