/* Phase 7: міст із Check у Model Intelligence і тіньовий пакет.

   Перевіряється рівно один зріз: те, що Check УЖЕ знає про машину
   (декод NHTSA, знімок оголошення, аукціонна подія), перетворюється на
   спостереження Vehicle Memory, а з них збирається тіньовий пакет знань.

   Тінь офлайн: `api/check.js` цей шлях не імпортує і не викликає.
   Продакшн-звіт від тесту не змінюється жодним чином.

   Головне, що тут доводиться: міст не вгадує. Якщо напис оголошення не
   сходиться рівно з однією версією каталогу, версія не пишеться взагалі,
   і тінь чесно мовчить замість того, щоб підставити схожу машину.

   Запуск:
     MI_TEST_DB_URL=postgres://... node mishadowtest.js
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

const UPS = ['001_schemas_enums_lookups', '002_subjects_hierarchy_source',
  '003_components_equipment_state', '004_issue_maintenance_check',
  '005_claims_applicability_evidence', '006_staging', '007_mi_vm_interface',
  '008_fragments_packs_operations', '009_validation_permissions',
  '010_knowledge_lifecycle', '011_staging_buyer_metadata', '012_pack_compiler',
  '013_check_retrieval', '014_check_dedup', '015_identity_resolver',
  '016_vm_adapter', '017_pack_purpose_key', '018_ingest_bridge',
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
function js(n, name, fn) {
  checks++;
  try { fn(); } catch (e) { errs.push(n + '. ' + name + ': ' + String(e.message || e).slice(0, 260)); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

if (!DB) { console.error('mishadowtest: не задано MI_TEST_DB_URL.'); process.exit(2); }
try { execFileSync(PSQL, ['--version'], { stdio: 'pipe' }); } catch {
  console.error('mishadowtest: psql недоступний.'); process.exit(2); }

try {
  run(['-f', path.join(FIX, '000_test_prelude.sql')], '');
  for (const f of PRODUCT_SCHEMA) run(['-f', path.join(__dirname, f)], '');
  for (const m of UPS) run(['-f', path.join(DIR, m + '.up.sql')], '');
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.sql')).sort();
  exec(files.map(f => fs.readFileSync(path.join(DATA, f), 'utf8')).join('\n'));
  run(['-f', path.join(FIX, '020_identity_fixtures.sql')], '');
  run(['-f', path.join(FIX, '021_golden_fixture.sql')], '');
  run(['-f', path.join(FIX, '050_check_ingest.sql')], '');
  run(['-f', path.join(FIX, '060_production_replay.sql')], '');
  exec(`do $$ declare y record; p mi.pack_purpose; begin
          for y in select subject_id from mi.version_market_year loop
            foreach p in array array['decision','report','component','chat']::mi.pack_purpose[] loop
              perform mi.build_fragment(y.subject_id, p);
            end loop;
          end loop;
        end $$;`);
  exec('select mi_test.seed_all_checks();');
  exec('select mi_test.seed_production_replay();');
} catch (e) {
  console.error('mishadowtest: не вдалося підготувати базу: ' + why(e));
  process.exit(1);
}

const A = (cond, msg) => `if not (${cond}) then raise exception '${msg}'; end if;`;
const BMW = "'WBAJB9C50JB0S0001'";
const TESLA = "'5YJSA1E28FF0S0002'";
const POR = "'WP1AD2A2XDL0S0003'";
const VW = "'WVWZZZ1KZAW0S0004'";

/* ---- 1..6. Зіставлення версії: рівно одна або жодної ---- */

t(1, 'три еталонні машини впізнаються з даних Check', `
  declare j jsonb;
  begin
  foreach j in array array[mi.ingest_identity_from_check(${BMW}),
                           mi.ingest_identity_from_check(${TESLA}),
                           mi.ingest_identity_from_check(${POR})] loop
    ${A("(j->'version_match'->>'version_id') is not null",
        'a reference car known to the catalogue was not matched from Check data')}
    ${A("(j->'version_match'->>'ambiguous')::boolean = false",
        'the match of a reference car is ambiguous')}
  end loop;
  end;`);

t(2, 'невідомий бренд не вгадується', `
  declare j jsonb;
  begin
  j := mi.ingest_identity_from_check(${VW});
  ${A("(j->'version_match'->>'version_id') is null", 'a car outside the corpus was matched to some version')}
  ${A("j->'version_match'->>'note' = 'brand is not in the catalogue'",
      'the refusal to match did not name its reason')}
  end;`);

t(3, 'версія не пишеться, поки зіставлення не однозначне', `
  declare j jsonb; n int;
  begin
  delete from public.vehicle_identity_observation where vin = ${VW};
  j := mi.ingest_identity_from_check(${VW});
  select count(*) into n from public.vehicle_identity_observation
   where vin = ${VW} and dimension = 'version';
  ${A('n = 0', 'a version was written for a car the catalogue does not know')}
  ${A(`(select count(*) from public.vehicle_identity_observation
         where vin = ${VW} and dimension = 'model_year') = 1`,
      'the model year was dropped together with the unmatched version')}
  end;`);

t(4, 'неоднозначний напис блокує запис версії', `
  declare j jsonb; vid bigint; sid bigint;
  begin
  -- Другий каталожний аліас на ТОЙ САМИЙ напис, але на іншу версію:
  -- напис перестає вказувати рівно на одну машину.
  select v.subject_id into vid from mi.vehicle_version v where v.version_code = '540I';
  insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind, scope_subject_id)
  select vid, 'M550i xDrive', 'm550i xdrive', 'community', 'brand', b.subject_id
    from mi.brand b where b.name = 'BMW';
  j := mi.ingest_identity_from_check(${BMW});
  ${A("(j->'version_match'->>'ambiguous')::boolean = true", 'an ambiguous label was not reported as ambiguous')}
  ${A("(j->'version_match'->>'version_id') is null", 'an ambiguous label still produced a version')}
  end;`, 'неоднозначність каталогу не дає тіні підставити схожу машину');

t(5, 'модельний рік розводить два однакові написи', `
  declare j jsonb; vid bigint;
  begin
  -- Той самий напис вішається на 540i, у якого у каталозі є лише 2018.
  -- Машина 2019 року: рік лишає рівно одну версію, і саме він це вирішує.
  select v.subject_id into vid from mi.vehicle_version v where v.version_code = '540I';
  insert into mi.subject_alias (target_subject_id, alias, alias_norm, alias_kind, scope_kind, scope_subject_id)
  select vid, 'M550i xDrive', 'm550i xdrive', 'community', 'brand', b.subject_id
    from mi.brand b where b.name = 'BMW';
  update public.vehicles set year = 2019, model_year = 2019,
         nhtsa = jsonb_set(nhtsa, '{ModelYear}', '"2019"') where vin = ${BMW};
  delete from public.vehicle_identity_observation where vin = ${BMW};
  j := mi.ingest_identity_from_check(${BMW});
  ${A("(j->'version_match'->>'matched_by') = 'alias_and_model_year'",
      'the model year did not break the tie between two identical labels')}
  ${A(`(j->'version_match'->>'version_id')::bigint
       = (select subject_id from mi.vehicle_version where version_code = 'M550I_XDRIVE')`,
      'the tie was broken towards the wrong version')}
  end;`, 'рік звужує неоднозначність, але сам по собі збігу не створює');

t(6, 'зіставлення не залежить від регістру і зайвих пробілів', `
  declare j jsonb;
  begin
  update public.vehicles set trim = '  m550I   XDRIVE ' where vin = ${BMW};
  delete from public.vehicle_identity_observation where vin = ${BMW};
  j := mi.ingest_identity_from_check(${BMW});
  ${A("(j->'version_match'->>'version_id') is not null", 'normalisation of the label failed')}
  end;`);

/* ---- 7..11. Що саме міст переносить у памʼять ---- */

t(7, 'ринок продажу береться з аукціону, ринок експлуатації з оголошення', `
  begin
  perform mi.ingest_identity_from_check(${TESLA});
  ${A(`(select value_text from public.vehicle_identity_observation
         where vin = ${TESLA} and dimension = 'market_sold') = 'US'`,
      'the market of sale did not come from the US auction record')}
  ${A(`(select value_text from public.vehicle_identity_observation
         where vin = ${TESLA} and dimension = 'market_operated') = 'UA'`,
      'the market of operation did not come from the listing')}
  end;`, 'продана у США, їздить в Україні: два різні ринки, а не один');

t(8, 'без аукціону ринок продажу не вигадується', `
  begin
  perform mi.ingest_identity_from_check(${VW});
  ${A(`not exists (select 1 from public.vehicle_identity_observation
         where vin = ${VW} and dimension = 'market_sold')`,
      'a market of sale was invented for a car with no auction record')}
  end;`);

t(9, 'час події і час знання розрізняються', `
  begin
  perform mi.ingest_identity_from_check(${BMW});
  ${A(`(select observed_at::date from public.vehicle_identity_observation
         where vin = ${BMW} and dimension = 'market_sold') = date '2025-11-02'`,
      'the market of sale was stamped with the ingestion moment, not the sale date')}
  ${A(`(select observed_at from public.vehicle_identity_observation
         where vin = ${BMW} and dimension = 'market_sold')
       < (select ingested_at from public.vehicle_identity_observation
           where vin = ${BMW} and dimension = 'market_sold')`,
      'the event time is not earlier than the knowledge time')}
  end;`);

t(10, 'повторний виклик нічого не дописує', `
  declare n1 int; n2 int; j jsonb;
  begin
  perform mi.ingest_identity_from_check(${BMW});
  select count(*) into n1 from public.vehicle_identity_observation where vin = ${BMW};
  j := mi.ingest_identity_from_check(${BMW});
  select count(*) into n2 from public.vehicle_identity_observation where vin = ${BMW};
  ${A('n1 = n2', 'a repeated ingestion duplicated the observations')}
  ${A("(j->>'written')::int = 0", 'a repeated ingestion reported new writes')}
  end;`);

t(11, 'міст не чіпає продуктові таблиці Check', `
  declare v1 text; v2 text; s1 text; s2 text;
  begin
  select md5(string_agg(vin || coalesce(trim,'') || coalesce(year::text,''), '|' order by vin))
    into v1 from public.vehicles;
  select md5(string_agg(id::text || coalesce(price_amount::text,''), '|' order by id))
    into s1 from public.vehicle_snapshots;
  perform mi.ingest_identity_from_check(${BMW});
  perform mi.ingest_identity_from_check(${TESLA});
  select md5(string_agg(vin || coalesce(trim,'') || coalesce(year::text,''), '|' order by vin))
    into v2 from public.vehicles;
  select md5(string_agg(id::text || coalesce(price_amount::text,''), '|' order by id))
    into s2 from public.vehicle_snapshots;
  ${A('v1 = v2', 'the bridge modified the vehicles table')}
  ${A('s1 = s2', 'the bridge modified the listing snapshots')}
  end;`);

/* ---- 12..18. Тіньовий пакет ---- */

t(12, 'тінь збирає пакет для трьох еталонних машин', `
  declare v text; p jsonb;
  begin
  foreach v in array array[${BMW}, ${TESLA}, ${POR}] loop
    p := mi.shadow_pack(v);
    ${A("(p->>'mi_available')::boolean = true", 'the shadow pack was not available for a reference car')}
    ${A("(p->'decision'->'meta'->>'included_count')::int > 0", 'the decision pack came back empty')}
    ${A("(p->'report'->'meta'->>'included_count')::int > 0", 'the report pack came back empty')}
  end loop;
  end;`);

t(13, 'невпізнана машина отримує чесну відмову, а не порожній пакет', `
  declare p jsonb;
  begin
  p := mi.shadow_pack(${VW});
  ${A("(p->>'mi_available')::boolean = false", 'a car outside the corpus got a pack')}
  ${A("p->>'reason' = 'identity_unresolved'", 'the refusal did not name its reason')}
  ${A("p->'decision' is null and p->'report' is null", 'a refused shadow still carried pack content')}
  end;`);

t(14, 'призначення дають різні пакети', `
  declare p jsonb;
  begin
  p := mi.shadow_pack(${BMW});
  ${A("(p->'report'->'meta'->>'included_count')::int >= (p->'decision'->'meta'->>'included_count')::int",
      'the report pack is smaller than the decision pack')}
  ${A("p->'decision'->'meta'->>'purpose' = 'decision' and p->'report'->'meta'->>'purpose' = 'report'",
      'the two packs do not carry their own purpose')}
  end;`);

t(15, 'заява про покриття супроводжує пакет', `
  declare p jsonb;
  begin
  p := mi.shadow_pack(${BMW});
  ${A("jsonb_array_length(p->'coverage_statement') > 0", 'the pack came without a coverage statement')}
  ${A(`exists (select 1 from jsonb_array_elements(p->'coverage_statement') e
                where (e->>'blocked_total')::int > 0)`,
      'the coverage statement hides that knowledge was held back')}
  ${A(`not exists (select 1 from jsonb_array_elements(p->'coverage_statement') e
                    where e->>'confidence_note' is null)`,
      'an area of the coverage statement has no plain statement of what is missing')}
  end;`, 'відсутність опублікованої проблеми це не доказ, що проблеми немає');

t(16, 'текст заблокованого кандидата у тінь не потрапляє', `
  declare blob text; n int;
  begin
  blob := mi.shadow_pack(${BMW})::text || mi.shadow_pack(${TESLA})::text || mi.shadow_pack(${POR})::text;
  select count(*) into n from mi.candidate_claim c
   where c.published_claim_id is null and length(c.text_en) > 40
     and blob like '%' || c.text_en || '%';
  ${A('n = 0', 'the text of a blocked candidate reached the shadow pack')}
  ${A(`(select count(*) from mi.candidate_claim
         where published_claim_id is null and length(text_en) > 40) > 0`,
      'there is no blocked candidate to test against')}
  end;`);

t(17, 'тінь показує розвʼязані компоненти, а не припущення без позначки', `
  declare p jsonb;
  begin
  p := mi.shadow_pack(${BMW});
  ${A(`not exists (select 1 from jsonb_array_elements(p->'identity_summary'->'components') c
                    where c->>'resolution_status' is null)`,
      'a component reached the shadow without its resolution status')}
  ${A(`exists (select 1 from jsonb_array_elements(p->'identity_summary'->'components') c
                where c->>'resolution_status' = 'assumed_factory' and c->>'line' like 'ASSUMED FACTORY:%')`,
      'an assumed component is not marked as assumed in its own line')}
  end;`);

t(18, 'тінь повторювана: той самий VIN дає той самий пакет', `
  declare a jsonb; b jsonb;
  begin
  a := mi.shadow_pack(${POR});
  b := mi.shadow_pack(${POR});
  ${A("a->'decision' = b->'decision' and a->'report' = b->'report'",
      'two shadow runs on the same VIN produced different packs')}
  end;`);

/* ---- 19..21. Гаряча дорога: промах і влучання ---- */

t(19, 'влучання у фрагмент повертає пакет, а не заявку на збірку', `
  declare i bigint; res jsonb; before int; after int;
  begin
  perform mi.ingest_identity_from_check(${BMW});
  i := mi.resolve_from_memory(${BMW});
  select count(*) into before from mi.build_request;
  res := mi.request_pack(mi.identity_json(i), 'decision');
  select count(*) into after from mi.build_request;
  ${A("(res->'pack'->>'fragment_available')::boolean = true", 'a hit on an existing fragment was read as a miss')}
  ${A('after = before', 'a build request was queued for a fragment that already exists')}
  end;`, 'регресія: до міграції 19 гаряча дорога ніколи не віддавала пакет');

t(20, 'промах фрагмента і далі не компілює синхронно', `
  declare i bigint; res jsonb; target bigint; before int; after int;
  begin
  perform mi.ingest_identity_from_check(${BMW});
  i := mi.resolve_from_memory(${BMW});
  target := (mi.identity_json(i)->>'vmy')::bigint;
  delete from mi.pack_fragment where vmy_id = target;
  select count(*) into before from mi.build_request;
  res := mi.request_pack(mi.identity_json(i), 'decision');
  select count(*) into after from mi.build_request;
  ${A("(res->>'fragment_available')::boolean = false", 'a missing fragment was compiled on the hot path')}
  ${A('after > before', 'no build request was queued for the miss')}
  ${A(`(select count(*) from mi.pack_fragment where vmy_id = target) = 0`,
      'the compiler built a fragment on the hot path')}
  end;`);

t(21, 'тінь при промаху фрагмента не вигадує пакет', `
  declare i bigint; target bigint; p jsonb;
  begin
  perform mi.ingest_identity_from_check(${POR});
  i := mi.resolve_from_memory(${POR});
  target := (mi.identity_json(i)->>'vmy')::bigint;
  delete from mi.pack_fragment where vmy_id = target;
  p := mi.shadow_pack(${POR});
  ${A("(p->>'mi_available')::boolean = false", 'a missing fragment still produced a shadow pack')}
  ${A("p->>'reason' in ('fragment_missing','knowledge_missing','invalidated')",
      'the shadow refusal did not name a known reason')}
  ${A("p->'identity_summary' is not null",
      'the shadow dropped the resolved identity together with the missing knowledge')}
  end;`);

t(22, 'рік поза каталогом не вигадує VMY: частковий пакет без кандидатів', `
  declare j jsonb; p jsonb;
  begin
  -- Напис версії каталогу відомий, а такого року у каталозі немає. Міст
  -- пише обидва спостереження окремо і рік не «виправляє». До Phase 7.3
  -- тінь тут відмовляла; тепер вона віддає частковий пакет, у якому
  -- жодного кандидатного VMY немає і конфігурація не вигадується.
  update public.vehicles set year = 1998, model_year = 1998,
         nhtsa = jsonb_set(nhtsa, '{ModelYear}', '"1998"') where vin = ${POR};
  update public.vehicle_snapshots set year = 1998 where vin = ${POR};
  delete from public.vehicle_identity_observation where vin = ${POR};
  j := mi.ingest_identity_from_check(${POR});
  ${A("(j->'version_match'->>'version_id') is not null", 'the known label stopped matching')}
  ${A(`(select value_num from public.vehicle_identity_observation
         where vin = ${POR} and dimension = 'model_year') = 1998`,
      'the bridge silently corrected the model year it was given')}
  p := mi.shadow_pack(${POR});
  ${A("(p->>'mi_available')::boolean and p->>'identity_precision' = 'partial'", 'a confirmed version got no pack')}
  ${A("(p->'decision'->'meta'->>'candidate_vmy_count')::int = 0", 'a VMY was invented for a year outside the catalogue')}
  end;`, 'міст записує, резолвер вирішує: рік поза каталогом дає нуль кандидатів, а не підставлений VMY');

/* ---- 23..25. Реальний вхід продакшну ----

   Рядки нижче це точна копія продакшну на 2026-09-11. У Phase 7.1
   перевірки 23 і 24 фіксували, чого бракувало; у Phase 7.3 міст навчився
   брати версію з розбору Check і перестав писати рік оголошення, тому
   вони переписані, як і планувалось. */

t(23, 'реальні машини продакшну отримують частковий пакет', `
  declare v text; p jsonb; j jsonb;
  begin
  -- До Phase 7.3 тут фіксувався провал: версія жила лише у звіті Check.
  -- Тепер міст читає vehicle.trim звіту як спостереження з низькою
  -- довірою, а без точного VMY працює частковий шлях.
  foreach v in array array['WBAJB9C50JB049616','WBAJB9C51JB035787','WBAJB9C51JB049950',
                           '5YJSA1H23FFP69703','WP1ZZZ92ZDLA45155'] loop
    p := mi.shadow_pack(v);
    ${A("(p->>'mi_available')::boolean and p->>'identity_precision' = 'partial'", 'a real production car got no partial pack')}
    j := mi.identity_json((p->>'identity_id')::bigint);
    ${A("j->>'version_basis' = 'check_inference' and j->>'market_sold' is null and j->>'vmy' is null",
        'a real car version is not inferred, or a market or VMY was invented')}
  end loop;
  end;`, 'пʼять реальних машин: версія з розбору Check, ринок не вигадано, пакет частковий');

t(24, 'на реальних даних міст не пише рік оголошення', `
  declare n int;
  begin
  perform mi.ingest_identity_from_check('WBAJB9C50JB049616');
  select count(*) into n from public.vehicle_identity_observation
   where vin = 'WBAJB9C50JB049616';
  ${A('n = 2', 'the bridge wrote something other than the inferred version plus market of operation')}
  ${A(`not exists (select 1 from public.vehicle_identity_observation
         where vin = 'WBAJB9C50JB049616' and dimension = 'model_year')`,
      'the listing registration year was written as the model year')}
  ${A(`(select source_kind from public.vehicle_identity_observation
         where vin = 'WBAJB9C50JB049616' and dimension = 'version') = 'check_inference'`,
      'the version did not come from the Check inference')}
  ${A(`not exists (select 1 from public.vehicle_identity_observation
         where vin = 'WBAJB9C50JB049616' and dimension = 'market_sold')`,
      'a market of sale appeared for a car with no auction record')}
  end;`, 'auto.ria дає рік реєстрації 2017; модельний рік лишається невідомим, а не хибним');

t(25, 'конвеєр справний: з трьома входами реальна машина доходить до пакета', `
  declare i bigint; j jsonb; p jsonb; v text := 'WBAJB9C50JB049616';
  begin
  perform mi.ingest_identity_from_check(v);
  -- Рік оголошення це рік реєстрації: гасимо його причиною, а не мовчки.
  update public.vehicle_identity_observation
     set invalidated_at = now(),
         invalidated_reason = 'auto.ria показує рік першої реєстрації, а не модельний'
   where vin = v and dimension = 'model_year';
  perform mi.vm_record_identity(v, 'version', 'vin_decoder', 'M550I_XDRIVE',
          null, null, null, now(), 'high', 'phase71', 'report', null, null, now());
  perform mi.vm_record_identity(v, 'model_year', 'build_sheet', null, 2018,
          null, null, now(), 'high', 'phase71-y', 'vin-pos-10', null, null, now());
  perform mi.vm_record_identity(v, 'market_sold', 'auction', 'US',
          null, null, null, now(), 'medium', 'phase71-m', 'manual', null, null, now());
  i := mi.resolve_from_memory(v);
  j := mi.identity_json(i);
  ${A("(j->>'vmy') is not null", 'the three missing inputs still did not resolve a version market year')}
  p := mi.shadow_pack(v);
  ${A("(p->>'mi_available')::boolean = true", 'the pipeline did not complete even with every input supplied')}
  ${A("(p->'decision'->'meta'->>'included_count')::int > 0", 'the decision pack is empty')}
  ${A("jsonb_array_length(p->'coverage_statement') > 0", 'the coverage statement is missing')}
  end;`, 'BMW: decision 40, report 67, 4 області покриття, 3 компоненти');

/* ---- 26..29. Публічна точка входу ---- */

js(26, 'публічна функція існує і працює під службовою роллю', () => {
  const n = scalar(`select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                     where ns.nspname = 'public' and p.proname = 'mi_shadow_pack';`);
  assert(n === '1', 'public.mi_shadow_pack is missing');
  const ok = scalar(`select public.mi_shadow_pack(${BMW})->>'mi_available';`);
  assert(ok === 'true', 'the public entry point did not return a pack');
});

js(27, 'права публічної функції не роздані клієнтським ролям', () => {
  const pub = scalar(`select has_function_privilege('public', 'public.mi_shadow_pack(text)', 'execute');`);
  assert(pub === 'f', 'PUBLIC can execute the shadow entry point');
  const def = scalar(`select prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                       where ns.nspname = 'public' and p.proname = 'mi_shadow_pack';`);
  assert(def === 't', 'the shadow entry point is not security definer');
  const sp = scalar(`select array_to_string(proconfig, ',') from pg_proc p
                      join pg_namespace ns on ns.oid = p.pronamespace
                      where ns.nspname = 'public' and p.proname = 'mi_shadow_pack';`);
  assert(/search_path=/.test(sp), 'the security definer function has no pinned search path');
});

js(28, 'клієнт тіні мовчки вимикається без ключів і не кидає', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import('${path.join(__dirname, 'api', 'mi-shadow.js').replace(/\\/g, '/')}').then(async m => {
      const a = await m.miShadowPack('WBAJB9C50JB0S0001', { base: '', key: '' });
      const b = await m.miShadowPack('', { base: 'https://x.test', key: 'k' });
      const c = await m.miShadowPack('WBAJB9C50JB0S0001', { base: 'http://127.0.0.1:1', key: 'k', timeoutMs: 300 });
      console.log(JSON.stringify([a.reason, b.reason, c.reason, m.shadowSummary(a)]));
    });`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const [a, b, c, summary] = JSON.parse(out.trim().split('\n').pop());
  assert(a === 'no_credentials', 'the client did not stay silent without credentials');
  assert(b === 'no_vin', 'the client did not stay silent without a VIN');
  assert(c === 'error' || c === 'timeout', 'an unreachable host did not degrade quietly: ' + c);
  assert(summary === 'mi:off(no_credentials)', 'the log summary is wrong: ' + summary);
});

js(29, 'тінь ніде не підключена до продакшн-Check', () => {
  const check = fs.readFileSync(path.join(__dirname, 'api', 'check.js'), 'utf8');
  assert(!/mi-shadow|mi_shadow_pack/.test(check), 'api/check.js references the shadow path');
  const job = fs.readFileSync(path.join(__dirname, 'api', 'check-job.js'), 'utf8');
  assert(!/mi-shadow|mi_shadow_pack/.test(job), 'api/check-job.js references the shadow path');
});

if (errs.length) {
  console.error('mishadowtest: помилок ' + errs.length + ' із ' + checks);
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('mishadowtest: усі ' + checks + ' перевірок пройшли');
for (const n of notes) console.log('   note ' + n);
