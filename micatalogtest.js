/* Model Intelligence Catalog: smoke-тести карток каталогу.

   Кожна картка каталогу отримує тут свій блок: очікувані опубліковані і
   заблоковані кандидати, точний пакет версії, негативна застосовність до
   суміжних ідентичностей (інша версія того самого покоління, еталонна
   картка того самого кузова, невідомий ринок продажу, часткова
   ідентичність), відсутність витоку заблокованого тексту і поведінка
   матчера версій на реальних написах Check.

   Картка 1: BMW 530i xDrive G30 B48 (B46B20O0), US MY2017-2020, префікс G.
   Картка 2: Tesla Model 3 Long Range AWD (pre-Highland), US MY2018-2023, префікс M.
   Картка 3: Hyundai Tucson TL 2.4 GDI Theta II, US MY2018-2021, префікс H.

   Запуск:
     MI_TEST_DB_URL=postgres://... node micatalogtest.js
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
let checks = 0;

/* Міграції беруться з теки у порядку номерів: список не може відстати
   від продакшну, як сталось між 023 і 024. */
const UPS = fs.readdirSync(DIR).filter(f => /^\d+_.*\.up\.sql$/.test(f)).sort();

const PRODUCT_SCHEMA = ['supabase-jobs.sql', 'supabase-vehicle-memory-baseline.sql',
  'supabase-vehicle-intelligence.sql', 'supabase-vehicle-memory-v1.sql',
  'supabase-vehicle-memory-v2.sql'];

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

function t(n, name, body) {
  checks++;
  const sql = 'begin;\ndo $g$\nbegin\n' + body + '\nend $g$;\nrollback;';
  try { exec(sql); } catch (e) { errs.push(n + '. ' + name + ': ' + why(e)); }
}
/* NULL у твердженні це провал, а не пропуск: порівняння з NULL версією
   не має мовчки проходити. */
const A = (cond, msg) => `if not coalesce((${cond}), false) then raise exception '${msg}'; end if;`;

/* Часткова ідентичність, як у mipartialtest: лише версія і те, що з неї
   випливає; компонентів немає. Усі claim_id пакета. */
const HELPERS_SQL = `
create or replace function mi_test.partial_of(p_code text, p_year int default null, p_market text default null)
returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('version', v.subject_id, 'generation', v.generation_id,
           'model_line', g.model_line_id, 'brand', m.brand_id, 'model_year', p_year, 'market_sold', p_market))
         || jsonb_build_object('components', '[]'::jsonb, 'equipment', '[]'::jsonb,
                               'entitlements', '[]'::jsonb, 'states', '[]'::jsonb)
    from mi.vehicle_version v join mi.generation g on g.subject_id = v.generation_id
    join mi.model_line m on m.subject_id = g.model_line_id where v.version_code = p_code $$;

create or replace function mi_test.pack_claims(p_pack jsonb) returns bigint[] language sql immutable as $$
  select coalesce(array_agg(distinct (x #>> '{}')::bigint), '{}'::bigint[])
    from jsonb_path_query(p_pack, '$.**.claim_id') x where jsonb_typeof(x) = 'number' $$;

create or replace function mi_test.has(p_pack jsonb, p_task_ref text) returns boolean language sql stable as $$
  select mi_test.claim(p_task_ref) is not null and mi_test.claim(p_task_ref) = any (mi_test.pack_claims(p_pack)) $$;


-- Опубліковані клейми, чий subject це N63 або сутність про N63: точна
-- множина замість регулярного виразу по task_ref, бо C-031 (політика
-- бренду) законно дістає і 530i.
create or replace function mi_test.n63_claims() returns bigint[] language sql stable as $$
  with n63 as (
    select id from mi.knowledge_subject where label ilike '%N63%'
    union select subject_id from mi.issue where about_subject_id in (select id from mi.knowledge_subject where label ilike '%N63%')
    union select subject_id from mi.maintenance_item where about_subject_id in (select id from mi.knowledge_subject where label ilike '%N63%')
    union select subject_id from mi.check_item where scope_subject_id in (select id from mi.knowledge_subject where label ilike '%N63%')
    union select subject_id from mi.component_state_type where applies_to_subject_id in (select id from mi.knowledge_subject where label ilike '%N63%'))
  select coalesce(array_agg(c.id), '{}'::bigint[]) from mi.claim c where c.status = 'published' and c.subject_id in (select id from n63) $$;

create or replace function mi_test.check_in_pack(p_pack jsonb, p_label text, p_priority text default null)
returns boolean language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_pack->'systems','[]'::jsonb)) s,
         lateral jsonb_array_elements(coalesce(s->'check_items','[]'::jsonb)) c
     where (c->>'check_subject_id')::bigint = (select id from mi.knowledge_subject where label = p_label)
       and (p_priority is null or c->'check'->>'priority' = p_priority)) $$;
`;

if (!DB) { console.error('micatalogtest: не задано MI_TEST_DB_URL, тест не запускався.'); process.exit(2); }
try { execFileSync(PSQL, ['--version'], { stdio: 'pipe' }); } catch {
  console.error('micatalogtest: psql недоступний.'); process.exit(2);
}

try {
  run(['-f', path.join(FIX, '000_test_prelude.sql')], '');
  for (const f of PRODUCT_SCHEMA) run(['-f', path.join(__dirname, f)], '');
  for (const m of UPS) run(['-f', path.join(DIR, m)], '');
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.sql')).sort();
  exec(files.map(f => fs.readFileSync(path.join(DATA, f), 'utf8')).join('\n'));
  for (const f of ['020_identity_fixtures', '022_catalog_identities']) run(['-f', path.join(FIX, f + '.sql')], '');
  exec(HELPERS_SQL);
  exec(`do $$ declare y record; p mi.pack_purpose; begin
          for y in select subject_id from mi.version_market_year order by subject_id loop
            foreach p in array array['decision','report','component','chat']::mi.pack_purpose[] loop
              perform mi.build_fragment(y.subject_id, p);
            end loop;
          end loop;
        end $$;`);
} catch (e) {
  console.error('micatalogtest: не вдалося підготувати базу: ' + why(e));
  process.exit(1);
}

const X = 'mi_test.id_530ix()';        // 530i xDrive US MY2018, точна ідентичність
const X20 = 'mi_test.id_530ix_2020()'; // той самий автомобіль MY2020
const RWD = 'mi_test.id_530i_rwd()';   // суміжна версія: 530i з заднім приводом (лише фікстура стенду)
const UA = 'mi_test.id_530ix_ua()';    // ринок продажу невідомий
const M550 = 'mi_test.id_bmw()';       // еталонна картка того самого кузова
const M3 = 'mi_test.id_m3()';           // картка 2: Model 3 Long Range AWD US MY2018
const M321 = 'mi_test.id_m3_2021()';    // той самий автомобіль після оновлення, MY2021
const M319 = 'mi_test.id_m3_2019()';    // MY2019: два компʼютери Autopilot як optional
const M3RWD = 'mi_test.id_m3_rwd()';    // суміжна версія: Long Range із заднім приводом (лише фікстура)
const TESLA = 'mi_test.id_tesla()';     // еталонна картка Model S P85D того самого бренду
const TUC = 'mi_test.id_tucson24(2020)';              // картка 3: Tucson 2.4 US MY2020, привід і дата невідомі
const TUC18 = 'mi_test.id_tucson24(2018)';
const TUC19 = 'mi_test.id_tucson24(2019)';
const TUC21 = 'mi_test.id_tucson24(2021)';
const TUCAWD = 'mi_test.id_tucson24_drive(true)';     // MY2020 з підтвердженим повним приводом
const TUCFWD = 'mi_test.id_tucson24_drive(false)';    // MY2020 з підтвердженим переднім приводом
const TUC19IN = "mi_test.id_tucson24_built(2019, date '2019-03-01')";   // усередині вікна відклику 195
const TUC19OUT = "mi_test.id_tucson24_built(2019, date '2019-08-15')";  // після вікна
const NU19 = 'mi_test.id_tucson_nu20(2019)';          // суміжна версія: Tucson TL з Nu 2.0 (лише фікстура)
const NU20 = 'mi_test.id_tucson_nu20(2020)';

/* ================= Картка 1: BMW 530i xDrive G30 ================= */

t(1, 'опубліковано те, що має бути опубліковане', `
  ${A(`(select count(*) from unnest(array['G-001','G-003','G-004','G-015','G-016','G-017','G-019','G-020','G-022#a','G-022#b','G-023','G-024','G-035','G-036','G-037','G-038','G-039','G-043','G-044','G-045']) r
         where mi_test.claim(r) is null) = 0`, 'a high value candidate of card 1 is not published')}`);

t(2, 'заблоковано те, чому доказів бракує, і саме на доказах', `
  ${A(`(select count(*) from mi.candidate_claim k
         where k.task_ref in ('G-025','G-026#b','G-027','G-028','G-029','G-030','G-031','G-032','G-041','G-042')
           and (k.published_claim_id is not null or (k.gate_result->>'passed')::boolean is not false)) = 0`,
       'a candidate that lacks evidence got published')}
  ${A(`(select count(*) from mi.candidate_claim k, jsonb_array_elements(k.gate_result->'rules') r
         where k.task_ref like 'G-%' and k.review_status = 'gate_pending' and (r->>'ok')::boolean is false
           and r->>'code' not in ('owner_pattern_groups','owner_pattern_context','specialist_source',
                                  'vendor_not_alone','known_issue_evidence','official_source')) = 0`,
       'a card 1 candidate is blocked by a rule other than an evidence rule')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'G-%' and review_note like '%gate override%') = 0", 'an override was used')}`);

t(3, 'лічильники картки 1', `
  ${A("(select count(distinct split_part(task_ref,'#',1)) from mi.candidate_claim where task_ref like 'G-%') = 45", 'atom count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'G-%') = 47", 'candidate count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'G-%' and review_status = 'approved') = 37", 'published count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'G-%' and review_status = 'merged') = 0", 'a card 1 candidate merged into an older claim')}`);

t(4, 'точний пакет 530i xDrive MY2018 несе своє знання і успадковує G30', `
  declare p jsonb; d jsonb;
  begin
  p := mi_test.pack(${X}, 'report'); d := mi_test.pack(${X}, 'decision');
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['G-001','G-003','G-004','G-007','G-010','G-016','G-017','G-018','G-019','G-020','G-022#a','G-022#b','G-023','G-024','G-026#a','G-034','G-035','G-036','G-037','G-038','G-039','G-044','G-045']) r)`,
       'an expected card 1 claim is missing from the report pack')}
  ${A(`(select bool_and(mi_test.has(d, r)) from unnest(array['G-001','G-016','G-022#a','G-037','G-044']) r)`,
       'a high importance claim is missing from the decision pack')}
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['C-110','C-082','C-092','C-031']) r)`,
       'generation, family or brand knowledge of the reference corpus did not reach the 530i')}
  end;`);

t(5, 'знання N63 і M550i не дістає 530i', `
  declare p jsonb; d jsonb;
  begin
  p := mi_test.pack(${X}, 'report'); d := mi_test.pack(${X}, 'decision');
  ${A(`array_length(mi_test.n63_claims(), 1) >= 20`, 'the N63 claim set is unexpectedly small')}
  ${A(`not (mi_test.n63_claims() && mi_test.pack_claims(p)) and not (mi_test.n63_claims() && mi_test.pack_claims(d))`,
       'N63 engine knowledge leaked into the 530i pack')}
  ${A(`not mi_test.has(p, 'C-002') and not mi_test.has(p, 'C-083') and not mi_test.has(p, 'C-080') and not mi_test.has(p, 'C-039')`,
       'M550i or 530e specific knowledge leaked into the 530i pack')}
  ${A(`mi_test.status('C-051', ${X}) <> 'APPLICABLE' and mi_test.status('C-033', ${X}) <> 'APPLICABLE'`,
       'an N63 issue evaluates as applicable to a B46 car')}
  ${A(`mi_test.status('C-080', ${X}) = 'EXCLUDED'`, 'the 8HP75 fluid claim reaches the 8HP50')}
  end;`);

t(6, 'знання 530i не дістає M550i, крім спільної роздатки і покоління', `
  declare p jsonb;
  begin
  p := mi_test.pack(${M550}, 'report');
  ${A(`mi_test.has(p, 'G-016') and mi_test.has(p, 'G-017')`, 'the shared ATC13-1 knowledge did not reach the M550i')}
  ${A(`(select bool_and(not mi_test.has(p, r)) from unnest(array['G-001','G-003','G-004','G-022#a','G-022#b','G-023','G-024','G-045','G-019','G-020','G-026#a','G-036']) r)`,
       'B46 engine, 8HP50 or 530i version knowledge leaked into the M550i pack')}
  -- Знання, заякорене на родині B48, на машині з мотором іншої родини
  -- компілятор читає як UNKNOWN (CONDITIONAL), а не як «ні»: слот мотора
  -- розвʼязаний, але порівняння родин він не робить. Тому тут перевіряється
  -- те, що знання НЕ застосовне і НЕ доходить до пакета; сама семантика
  -- UNKNOWN замість NO_MATCH задокументована у звіті картки як прогалина
  -- компілятора і не змінюється цим потоком.
  ${A(`mi_test.status('G-024', ${M550}) not in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT') and not mi_test.has(p, 'G-024')`, 'the four and six cylinder expansion tank claim applies to the V8')}
  ${A(`mi_test.status('G-022#a', ${M550}) not in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT') and not mi_test.has(p, 'G-022#a')`, 'the B48 oil filter housing claim applies to the V8')}
  end;`);

t(7, 'xDrive-знання не стає знанням про 530i з заднім приводом', `
  declare p jsonb;
  begin
  p := mi_test.pack(${RWD}, 'report');
  ${A(`(select bool_and(not mi_test.has(p, r)) from unnest(array['G-001','G-004','G-014','G-016','G-017','G-018']) r)`,
       'transfer case or xDrive version knowledge leaked into the rear drive 530i')}
  ${A(`mi_test.has(p, 'G-022#a') and mi_test.has(p, 'G-045') and mi_test.has(p, 'C-110')`,
       'shared engine, transmission or generation knowledge did not reach the rear drive 530i')}
  ${A(`not mi_test.check_in_pack(p, 'xDrive low speed turning road test')`, 'the xDrive road test reached a rear drive car')}
  end;`);

t(8, 'рік і дата виробництва обмежують лише те, де вони є межею', `
  declare p20 jsonb;
  begin
  p20 := mi_test.pack(${X20}, 'report');
  ${A(`mi_test.status('G-015', ${X20}) = 'APPLICABLE' and mi_test.has(p20, 'G-015')`, 'the starter recall does not reach a 2020 car built in the window')}
  ${A(`mi_test.status('G-015', ${X}) = 'EXCLUDED'`, 'the starter recall reaches a 2018 car built before the window')}
  ${A(`mi_test.status('G-009', ${X20}) = 'APPLICABLE' and mi_test.status('G-010', ${X20}) = 'EXCLUDED'`, 'the 2020 head unit boundary is wrong')}
  ${A(`mi_test.status('G-010', ${X}) = 'APPLICABLE' and mi_test.status('G-009', ${X}) = 'EXCLUDED'`, 'the 2018 head unit boundary is wrong')}
  ${A(`mi_test.status('G-002', ${X}) = 'EXCLUDED' and mi_test.status('G-002', ${X20}) = 'EXCLUDED'`, 'the 2021 engine revision claim reaches a pre-facelift car')}
  ${A(`mi_test.status('G-011', mi_test.with_field(${X}, 'production_date', '"2018-05-20"'::jsonb)) = 'APPLICABLE'`, 'the crankshaft sensor recall misses a car built inside its window')}
  ${A(`mi_test.status('G-011', ${X}) = 'EXCLUDED'`, 'the crankshaft sensor recall reaches a car built outside its window')}
  ${A(`mi_test.status('G-022#a', ${X20}) = 'APPLICABLE' and mi_test.status('G-016', ${X20}) = 'APPLICABLE'`, 'component knowledge without a year boundary lost a model year')}
  end;`);

t(9, 'невідомий ринок продажу знижує точність, а не прибирає знання', `
  declare p jsonb;
  begin
  p := mi_test.pack(${UA}, 'report');
  ${A(`mi_test.status('G-016', ${UA}) = 'APPLICABLE' and mi_test.status('G-022#a', ${UA}) = 'APPLICABLE'`, 'component knowledge vanished with the market')}
  ${A(`mi_test.status('G-001', ${UA}) = 'CONDITIONAL' and mi_test.status('G-035', ${UA}) = 'CONDITIONAL'`, 'market-bound knowledge is not conditional on an unknown market')}
  ${A(`mi_test.has(p, 'G-016') and mi_test.has(p, 'G-022#a') and mi_test.has(p, 'G-037') and mi_test.has(p, 'G-045')`, 'the unknown-market pack lost component knowledge')}
  ${A(`(select (p->'pack_meta'->>'included_count')::int) >= 15`, 'the unknown-market pack is nearly empty')}
  end;`);

t(10, 'часткова ідентичність лише з версії дає пакет без вигаданих компонентів', `
  declare p jsonb;
  begin
  p := mi_test.pack(mi_test.partial_of('530I_XDRIVE'), 'report');
  ${A("(p->>'fragment_available')::boolean and p->'pack_meta'->>'identity_precision' = 'partial'", 'the version alone got no partial pack')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 4", 'the four US model years are not all candidates')}
  ${A(`mi_test.has(p, 'G-037') and mi_test.has(p, 'G-039')`, 'generation knowledge did not reach the partial pack')}
  ${A(`not (mi_test.n63_claims() && mi_test.pack_claims(p))`, 'N63 knowledge leaked into the partial 530i pack')}
  ${A(`mi_test.status('G-022#a', mi_test.partial_of('530I_XDRIVE')) in ('CONDITIONAL', 'APPLICABLE', 'APPLICABLE_ASSUMED')`, 'engine knowledge on the partial path is neither applicable nor conditional')}
  end;`);

t(11, 'текст заблокованих кандидатів не витікає у пакети', `
  ${A(`(select count(*) from mi.candidate_claim k
         where k.task_ref like 'G-%' and k.review_status = 'gate_pending'
           and (position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${X}, 'report'))) > 0
             or position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${X}, 'decision'))) > 0
             or position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${UA}, 'report'))) > 0)) = 0`,
       'blocked text of card 1 leaked into a pack')}`);

t(12, 'канонічні перевірки картки доходять до пакета', `
  declare p jsonb;
  begin
  p := mi_test.pack(${X}, 'report');
  ${A(`mi_test.check_in_pack(p, 'B46/B48 cooling system inspection under the intake', 'must')`, 'the cooling inspection is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Recall completion check by VIN', 'must')`, 'the recall lookup is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'xDrive low speed turning road test')`, 'the transfer case road test is missing')}
  ${A(`mi_test.check_in_pack(p, 'Full diagnostic scan before purchase')`, 'the generation diagnostic scan did not reach the 530i')}
  ${A(`not mi_test.check_in_pack(p, 'Borescope all eight N63 cylinders')`, 'the N63 borescope reached a four cylinder car')}
  end;`);

t(13, 'матчер версій розрізняє 530i xDrive, 530i і M550i на реальних написах', `
  ${A(`(mi.match_version('BMW', array['xDrive', '530i', '530i xDrive'], 2017)->>'version_id')::bigint = mi_test.sid_of('version', '530I_XDRIVE')`, 'decoder labels of a 530i xDrive do not resolve')}
  ${A(`mi.match_version('BMW', array['530i'], 2018)->>'version_id' is null`, 'a bare 530i label resolved to a catalogue version although the rear drive car is not catalogued')}
  ${A(`(mi.match_version_text('BMW', '5 series', '530i xDrive')->>'version_id')::bigint = mi_test.sid_of('version', '530I_XDRIVE')`, 'the Check text 530i xDrive does not resolve')}
  ${A(`mi.match_version_text('BMW', '5 series', '530i Steptronic')->>'version_id' is null and (mi.match_version_text('BMW', '5 series', '530i Steptronic')->>'ambiguous')::boolean is false`, 'the rear drive text resolved to a version it is not, or became ambiguous')}
  ${A(`(mi.match_version_text('BMW', '5 series', 'M550i xDrive')->>'version_id')::bigint = mi_test.sid_of('version', 'M550I_XDRIVE')`, 'adding the 530i broke the M550i match')}
  ${A(`mi.match_version_text('BMW', '5 series', '540i Steptronic, Luxury Line')->>'version_id' is null`, 'a 540i text resolved to a catalogue version it is not')}`);

t(14, 'еталонна картка M550i у пакеті не зрушена', `
  declare p jsonb;
  begin
  p := mi_test.pack(${M550}, 'report');
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['C-001','C-033','C-051','C-080','C-083','C-110']) r)`, 'the M550i pack lost reference knowledge')}
  ${A(`mi_test.check_in_pack(p, 'Borescope all eight N63 cylinders', 'must')`, 'the M550i lost its borescope check')}
  end;`);

/* ================= Картка 2: Tesla Model 3 Long Range AWD ================= */

t(15, 'картка 2: опубліковано те, що має бути опубліковане', `
  ${A(`(select count(*) from unnest(array['M-001','M-003','M-006','M-007','M-009','M-010','M-011','M-013','M-015','M-016','M-017','M-021','M-023','M-024','M-026','M-027','M-031','M-032','M-035','M-036','M-037','M-038','M-039','M-040','M-042','M-044','M-045','M-046','M-047','M-049#a','M-052','M-053']) r
         where mi_test.claim(r) is null) = 0`, 'a high value candidate of card 2 is not published')}`);

t(16, 'картка 2: заблоковано те, чому доказів бракує, і саме на доказах', `
  ${A(`(select count(*) from mi.candidate_claim k
         where k.task_ref in ('M-012','M-014','M-019','M-043','M-048','M-051')
           and (k.published_claim_id is not null or (k.gate_result->>'passed')::boolean is not false)) = 0`,
       'a card 2 candidate that lacks evidence got published')}
  ${A(`(select count(*) from mi.candidate_claim k, jsonb_array_elements(k.gate_result->'rules') r
         where k.task_ref like 'M-%' and k.review_status = 'gate_pending' and (r->>'ok')::boolean is false
           and r->>'code' not in ('owner_pattern_groups','owner_pattern_context','specialist_source',
                                  'vendor_not_alone','known_issue_evidence','official_source',
                                  'broad_claim_broad_source')) = 0`,
       'a card 2 candidate is blocked by a rule other than an evidence rule')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'M-%' and review_note like '%gate override%') = 0", 'an override was used in card 2')}`);

t(17, 'лічильники картки 2', `
  ${A("(select count(distinct split_part(task_ref,'#',1)) from mi.candidate_claim where task_ref like 'M-%') = 53", 'card 2 atom count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'M-%') = 56", 'card 2 candidate count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'M-%' and review_status = 'approved') = 50", 'card 2 published count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'M-%' and review_status = 'merged') = 0", 'a card 2 candidate merged into an older claim')}`);

t(18, 'точний пакет Model 3 MY2018 несе знання до оновлення і жодного після нього', `
  declare p jsonb; d jsonb;
  begin
  p := mi_test.pack(${M3}, 'report'); d := mi_test.pack(${M3}, 'decision');
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['M-001','M-006','M-007','M-009','M-010','M-013','M-015','M-016','M-017','M-021','M-024','M-026','M-027','M-037','M-038','M-039','M-042','M-044','M-046','M-047','M-049#a','M-049#b','M-052','M-053']) r)`,
       'an expected card 2 claim is missing from the MY2018 report pack')}
  ${A(`(select bool_and(not mi_test.has(p, r)) from unnest(array['M-002','M-003','M-004','M-011','M-023','M-031','M-032','M-033','M-035','M-036','M-050']) r)`,
       'knowledge of the refreshed or later cars leaked into the MY2018 pack')}
  ${A(`(select bool_and(mi_test.has(d, r)) from unnest(array['M-006','M-007','M-016','M-021','M-042','M-053']) r)`,
       'a high importance claim is missing from the MY2018 decision pack')}
  ${A(`mi_test.status('M-009', ${M3}) = 'APPLICABLE_ASSUMED' and mi_test.status('M-013', ${M3}) = 'APPLICABLE_ASSUMED'`,
       'family and variant knowledge is not assumed from the factory fitment')}
  ${A(`mi_test.status('M-024', ${M3}) = 'CONDITIONAL' and mi_test.status('M-026', ${M3}) = 'CONDITIONAL'`,
       'a production date bound recall is not conditional without a build date')}
  ${A(`(select count(*) from mi.candidate_claim k where k.published_claim_id = any (mi_test.pack_claims(p)) and k.task_ref not like 'M-%') = 0`,
       'knowledge of another card reached the Model 3')}
  end;`);

t(19, 'MY2021 отримує тепловий насос і новий пак, втрачає PTC, компʼютер 2.5 і відклики 2017..2020', `
  declare p jsonb;
  begin
  p := mi_test.pack(${M321}, 'report');
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['M-003','M-011','M-023','M-026','M-028','M-031','M-035','M-036','M-038','M-050','M-052']) r)`,
       'refreshed car knowledge is missing from the MY2021 pack')}
  ${A(`(select bool_and(not mi_test.has(p, r)) from unnest(array['M-001','M-002','M-013','M-024','M-027','M-029','M-037','M-039','M-049#b']) r)`,
       'pre-refresh knowledge leaked into the MY2021 pack')}
  ${A(`coalesce(mi_test.status('M-013', ${M321}), 'EXCLUDED') in ('EXCLUDED', 'EXCLUDED_ASSUMED')`,
       'the Autopilot 2.5 recall is not excluded on a car with the FSD computer')}
  end;`);

t(20, 'MY2019 без заводського припущення про компʼютер: знання про 2.5 стає умовним, не зникає і не стверджується', `
  declare p jsonb;
  begin
  p := mi_test.pack(${M319}, 'report');
  ${A(`mi_test.status('M-013', ${M319}) = 'CONDITIONAL'`, 'the Autopilot 2.5 knowledge is not conditional on a mixed year')}
  ${A(`not mi_test.has(p, 'M-013')`, 'a low importance conditional claim entered the report pack')}
  ${A(`mi_test.has(p, 'M-037') and mi_test.has(p, 'M-001') and mi_test.has(p, 'M-027')`, 'MY2019 lost its pre-refresh knowledge')}
  ${A(`mi_test.check_in_pack(p, 'Read the Autopilot computer version on the screen', 'must')`, 'the hardware identification check is missing on the mixed year')}
  end;`);

t(21, 'суміжна версія із заднім приводом ділить покоління і компоненти, не версію', `
  declare p jsonb;
  begin
  p := mi_test.pack(${M3RWD}, 'report');
  ${A(`(select bool_and(not mi_test.has(p, r)) from unnest(array['M-001','M-002','M-005','M-006','M-007','M-052','M-053']) r)`,
       'version level knowledge of the Long Range AWD reached the rear drive fixture')}
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['M-008','M-013','M-021','M-024','M-037','M-038','M-042','M-046']) r)`,
       'generation, component or line knowledge did not reach the rear drive fixture')}
  end;`);

t(22, 'права бренду не витікають у Model S і Model 3 не витікає у BMW', `
  declare s jsonb; b jsonb;
  begin
  s := mi_test.pack(${TESLA}, 'report'); b := mi_test.pack(${X}, 'report');
  ${A(`(select count(*) from mi.candidate_claim k where k.task_ref like 'M-%' and k.published_claim_id = any (mi_test.pack_claims(s))) = 0`,
       'Model 3 knowledge reached the Model S P85D pack')}
  ${A(`not mi_test.check_in_pack(s, 'Run a direct current charging session on the Model 3')`, 'a Model 3 check reached the Model S pack')}
  ${A(`(select count(*) from mi.candidate_claim k where k.task_ref like 'M-%' and k.published_claim_id = any (mi_test.pack_claims(b))) = 0`,
       'Model 3 knowledge reached the BMW 530i pack')}
  ${A(`(select count(*) from mi.claim c join mi.candidate_claim k on k.published_claim_id = c.id
         join mi.knowledge_subject sj on sj.id = c.subject_id
         left join mi.issue i on i.subject_id = c.subject_id
        where k.task_ref like 'M-%' and (sj.kind = 'entitlement' or i.about_subject_id in (select subject_id from mi.entitlement))
          and not exists (select 1 from mi.claim_applicability a where a.claim_id = c.id and a.dimension = 'model_line')) = 0`,
       'a card 2 claim on a brand entitlement carries no model line scope')}
  end;`);

t(23, 'текст заблокованих кандидатів картки 2 не витікає у пакети', `
  ${A(`(select count(*) from mi.candidate_claim k
         where k.task_ref like 'M-%' and k.review_status = 'gate_pending'
           and (position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${M3}, 'report'))) > 0
             or position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${M321}, 'report'))) > 0
             or position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${M3}, 'decision'))) > 0)) = 0`,
       'blocked text of card 2 leaked into a pack')}`);

t(24, 'канонічні перевірки картки 2 доходять до пакета', `
  declare p jsonb;
  begin
  p := mi_test.pack(${M3}, 'report');
  ${A(`mi_test.check_in_pack(p, 'Verify Autopilot, Full Self-Driving and connectivity in the account after transfer', 'must')`, 'the rights check is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Run a direct current charging session on the Model 3', 'must')`, 'the fast charging session is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Cabin heat and defrost test', 'must')`, 'the heat test is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Read the manufacture month on the door jamb label', 'must')`, 'the build date check is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Read pack capacity and battery alerts', 'must')`, 'the pack health check is missing or not MUST')}
  ${A(`not mi_test.check_in_pack(p, 'Inspect the LDU speed sensor for coolant')`, 'a Model S check reached the Model 3')}
  end;`);

t(25, 'матчер версій резолвить написи Long Range AWD і мовчить на Long Range, Dual Motor і Performance', `
  ${A(`(mi.match_version_text('Tesla', 'Model 3', 'Long Range AWD')->>'version_id')::bigint = mi_test.sid_of('version', 'M3_LR_AWD')`, 'the text Long Range AWD does not resolve')}
  ${A(`(mi.match_version_text('Tesla', 'Model 3', 'Long Range Dual Motor AWD')->>'version_id')::bigint = mi_test.sid_of('version', 'M3_LR_AWD')`, 'the text Long Range Dual Motor AWD does not resolve')}
  ${A(`(mi.match_version_text('Tesla', 'Model 3', 'LR AWD')->>'version_id')::bigint = mi_test.sid_of('version', 'M3_LR_AWD')`, 'the community label LR AWD does not resolve')}
  ${A(`mi.match_version_text('Tesla', 'Model 3', 'Long Range')->>'version_id' is null and (mi.match_version_text('Tesla', 'Model 3', 'Long Range')->>'ambiguous')::boolean is false`, 'the rear drive text Long Range resolved to the AWD car or became ambiguous')}
  ${A(`mi.match_version_text('Tesla', 'Model 3', 'Dual Motor')->>'version_id' is null`, 'the bare text Dual Motor resolved to a catalogue version')}
  ${A(`mi.match_version_text('Tesla', 'Model 3', 'Long Range AWD Performance')->>'version_id' is null`, 'a Performance text resolved to the Long Range AWD')}
  ${A(`mi.match_version_text('Tesla', 'Model 3', 'Standard Range Plus')->>'version_id' is null`, 'a Standard Range text resolved to a catalogue version')}
  ${A(`(select bool_and(mi.match_version_text('Tesla', 'Model 3', t)->>'version_id' is null and (mi.match_version_text('Tesla', 'Model 3', t)->>'ambiguous')::boolean is false
                        and mi.match_version_text('Tesla', null, t)->>'version_id' is null)
         from unnest(array['Model 3 Long Range', 'Tesla Model 3 Long Range', 'Model 3 Dual Motor', 'Tesla Model 3 Dual Motor', 'Dual Motor AWD']) t)`,
       'a generic Model 3 Long Range or Dual Motor text resolved to the Long Range AWD')}
  ${A(`(select bool_and((mi.match_version_text('Tesla', 'Model 3', t)->>'version_id')::bigint = mi_test.sid_of('version', 'M3_LR_AWD')
                        and (mi.match_version_text('Tesla', null, t)->>'version_id')::bigint = mi_test.sid_of('version', 'M3_LR_AWD'))
         from unnest(array['Model 3 Long Range AWD', 'Tesla Model 3 Long Range Dual Motor', 'Model 3 LR AWD']) t)`,
       'a full Long Range AWD label does not resolve with or without the model line')}
  ${A(`(mi.match_version_text('Tesla', 'Model S', 'P85D')->>'version_id')::bigint = mi_test.sid_of('version', 'P85D')`, 'adding the Model 3 broke the Model S match')}`);

t(26, 'часткова ідентичність Model 3 лише з версії дає пакет, лише з ряду не дає', `
  declare p jsonb; q jsonb;
  begin
  p := mi_test.pack(mi_test.partial_of('M3_LR_AWD'), 'report');
  ${A("(p->>'fragment_available')::boolean and p->'pack_meta'->>'identity_precision' = 'partial'", 'the version alone got no partial pack')}
  ${A("(p->'pack_meta'->>'candidate_vmy_count')::int = 6", 'the six US model years are not all candidates')}
  ${A(`mi_test.has(p, 'M-006') and mi_test.has(p, 'M-021') and mi_test.has(p, 'M-053')`, 'version and line knowledge did not reach the partial pack')}
  q := mi.compile_pack(jsonb_build_object('brand', (select subject_id from mi.brand where name = 'Tesla'), 'model_line', (select subject_id from mi.model_line where name = 'Model 3'),
         'model_year', 2019, 'market_sold', 'US', 'components', '[]'::jsonb, 'equipment', '[]'::jsonb, 'entitlements', '[]'::jsonb, 'states', '[]'::jsonb), 'report');
  ${A("(q->>'fragment_available')::boolean is false and q->>'reason' = 'version_not_identified'", 'a decode that names only the model line produced a pack')}
  end;`);

t(28, 'часткова ідентичність Model 3: широке знання застосовне, залежне від виміру умовне', `
  declare v jsonb; y jsonb; y21 jsonb; p jsonb; q jsonb;
  begin
  v := mi_test.partial_of('M3_LR_AWD'); y := mi_test.partial_of('M3_LR_AWD', 2018, 'US'); y21 := mi_test.partial_of('M3_LR_AWD', 2021, 'US');
  p := mi_test.pack(v, 'report'); q := mi_test.pack(y, 'report');
  -- лише версія: знання версії і ряду застосовне, знання року і компонентів умовне
  ${A(`mi_test.status('M-006', v) = 'APPLICABLE' and mi_test.status('M-007', v) = 'APPLICABLE' and mi_test.status('M-015', v) = 'APPLICABLE' and mi_test.status('M-053', v) = 'APPLICABLE'`,
       'version or line knowledge is not applicable on the version-only identity')}
  ${A(`mi_test.status('M-001', v) = 'CONDITIONAL' and mi_test.status('M-003', v) = 'CONDITIONAL' and mi_test.status('M-027', v) = 'CONDITIONAL'`,
       'model year bound knowledge is not conditional without a model year')}
  ${A(`mi_test.status('M-009', v) = 'CONDITIONAL' and mi_test.status('M-013', v) = 'CONDITIONAL' and mi_test.status('M-037', v) = 'CONDITIONAL' and mi_test.status('M-042', v) = 'CONDITIONAL'`,
       'component bound knowledge is not conditional without components')}
  ${A(`mi_test.has(p, 'M-006') and mi_test.has(p, 'M-021') and mi_test.has(p, 'M-053') and mi_test.has(p, 'M-037') and mi_test.has(p, 'M-024')`,
       'the version-only pack lost applicable or resolvable conditional knowledge')}
  ${A(`not mi_test.has(p, 'M-001') and not mi_test.has(p, 'M-003')`, 'a year bound rating entered the version-only pack')}
  -- версія і рік, без компонентів: рік знімає рейтинг і відклики за роком, компоненти лишаються умовними
  ${A(`mi_test.status('M-001', y) = 'APPLICABLE' and mi_test.status('M-027', y) = 'APPLICABLE' and mi_test.status('M-003', y) = 'EXCLUDED'`,
       'the model year did not settle year bound knowledge')}
  ${A(`mi_test.status('M-037', y) = 'CONDITIONAL' and mi_test.status('M-013', y) = 'CONDITIONAL' and mi_test.status('M-035', y) = 'CONDITIONAL'`,
       'component knowledge became applicable without a fitment on the partial path')}
  ${A(`mi_test.has(q, 'M-001') and mi_test.has(q, 'M-027') and mi_test.has(q, 'M-037') and not mi_test.has(q, 'M-035') and not mi_test.has(q, 'M-003')`,
       'the version plus year pack has the wrong membership')}
  ${A(`mi_test.status('M-003', y21) = 'APPLICABLE' and mi_test.status('M-001', y21) = 'EXCLUDED' and mi_test.status('M-035', y21) = 'CONDITIONAL' and mi_test.status('M-037', y21) = 'CONDITIONAL'`,
       'the refreshed year did not settle year bound knowledge on the partial path')}
  ${A(`(select count(*) from mi.candidate_claim k where k.published_claim_id = any (mi_test.pack_claims(p)) and k.task_ref not like 'M-%') = 0`,
       'knowledge of another card reached the partial Model 3 pack')}
  end;`);

t(27, 'еталонна картка Model S у пакеті не зрушена', `
  declare p jsonb;
  begin
  p := mi_test.pack(${TESLA}, 'report');
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['T-002#a','T-010','T-022#a','T-050#a']) r)`, 'the Model S pack lost reference knowledge')}
  ${A(`mi_test.check_in_pack(p, 'Inspect the LDU speed sensor for coolant', 'must')`, 'the Model S lost its speed sensor check')}
  end;`);

/* ================= Картка 3: Hyundai Tucson TL 2.4 GDI Theta II ================= */

t(29, 'картка 3: опубліковано те, що має бути опубліковане', `
  ${A(`(select count(*) from unnest(array['H-001','H-004','H-010','H-011','H-012','H-013','H-014','H-020','H-021','H-030','H-040','H-041','H-050','H-052','H-053','H-060','H-065','H-070','H-080#a','H-080#b','H-081','H-082','H-090','H-032','H-042']) r
         where mi_test.claim(r) is null) = 0`, 'a high value candidate of card 3 is not published')}`);

t(30, 'картка 3: заблоковано те, чому доказів бракує, і саме на доказах', `
  ${A(`(select count(*) from mi.candidate_claim k
         where k.task_ref in ('H-025','H-031')
           and (k.published_claim_id is not null or (k.gate_result->>'passed')::boolean is not false)) = 0`,
       'a card 3 candidate that lacks evidence got published')}
  ${A(`(select count(*) from mi.candidate_claim k, jsonb_array_elements(k.gate_result->'rules') r
         where k.task_ref like 'H-%' and k.review_status = 'gate_pending' and (r->>'ok')::boolean is false
           and r->>'code' not in ('owner_pattern_groups','owner_pattern_context','specialist_source',
                                  'vendor_not_alone','known_issue_evidence','official_source',
                                  'broad_claim_broad_source')) = 0`,
       'a card 3 candidate is blocked by a rule other than an evidence rule')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'H-%' and review_note like '%gate override%') = 0", 'an override was used in card 3')}`);

t(31, 'лічильники і шкала важливості картки 3', `
  ${A("(select count(distinct split_part(task_ref,'#',1)) from mi.candidate_claim where task_ref like 'H-%') = 36", 'card 3 atom count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'H-%') = 40", 'card 3 candidate count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'H-%' and review_status = 'approved') = 38", 'card 3 published count changed')}
  ${A("(select count(*) from mi.candidate_claim where task_ref like 'H-%' and review_status = 'merged') = 0", 'a card 3 candidate merged into an older claim')}
  ${A(`(select array_agg(task_ref order by task_ref) from mi.candidate_claim where task_ref like 'H-%' and review_status = 'approved' and proposed_buyer_importance = 5) = array['H-020','H-090']`,
       'importance 5 of card 3 is not exactly the bearing failure and the import synthesis')}`);

t(32, 'точні пакети Tucson 2.4 за роками: покриття 2018..2019 і його відсутність 2020..2021', `
  declare p18 jsonb; p19 jsonb; p20 jsonb; p21 jsonb; d20 jsonb;
  begin
  p18 := mi_test.pack(${TUC18}, 'report'); p19 := mi_test.pack(${TUC19}, 'report');
  p20 := mi_test.pack(${TUC}, 'report'); p21 := mi_test.pack(${TUC21}, 'report'); d20 := mi_test.pack(${TUC}, 'decision');
  ${A(`(select bool_and(mi_test.has(p20, r)) from unnest(array['H-001','H-004','H-010','H-013','H-020','H-021','H-030','H-040','H-050','H-052','H-053','H-060','H-070','H-081','H-090','H-032','H-042']) r)`,
       'an expected claim is missing from the MY2020 report pack')}
  ${A(`(select bool_and(not mi_test.has(p20, r)) from unnest(array['H-002','H-011','H-012','H-014','H-022','H-041','H-080#a','H-080#c','H-080#d']) r)`,
       '2018 or 2019 coverage knowledge leaked into the MY2020 pack')}
  ${A(`(select bool_and(mi_test.has(p18, r)) from unnest(array['H-002','H-011','H-012','H-014','H-041','H-080#d','H-020','H-090']) r) and not mi_test.has(p18, 'H-013') and not mi_test.has(p18, 'H-021')`,
       'the MY2018 pack has the wrong coverage knowledge')}
  ${A(`mi_test.has(p19, 'H-022') and mi_test.has(p19, 'H-080#a') and mi_test.has(p19, 'H-012') and not mi_test.has(p19, 'H-013') and not mi_test.has(p19, 'H-002')`,
       'the MY2019 pack has the wrong year bound knowledge')}
  ${A(`mi_test.has(p21, 'H-013') and mi_test.has(p21, 'H-021') and mi_test.has(p21, 'H-080#c') and not mi_test.has(p21, 'H-011') and not mi_test.has(p21, 'H-080#b')`,
       'the MY2021 pack has the wrong year bound knowledge')}
  ${A(`mi_test.status('H-012', ${TUC19}) = 'CONDITIONAL' and mi_test.status('H-014', ${TUC18}) = 'CONDITIONAL'`,
       'the certain 2018 and 2019 extension is asserted without the dealer lookup')}
  ${A(`mi_test.status('H-020', ${TUC21}) = 'APPLICABLE' and mi_test.status('H-030', ${TUC21}) = 'APPLICABLE'`,
       'component knowledge of the Theta II 2.4 did not transfer to the 2021 engine')}
  ${A(`(select bool_and(mi_test.has(d20, r)) from unnest(array['H-020','H-090','H-010','H-013','H-053']) r)`,
       'a high importance claim is missing from the MY2020 decision pack')}
  ${A(`(d20->'pack_meta'->>'truncated_count')::int = 0`, 'the MY2020 decision pack dropped knowledge at the budget cap')}
  ${A(`(select count(*) from mi.candidate_claim k where k.published_claim_id = any (mi_test.pack_claims(p20) || mi_test.pack_claims(p18)) and k.task_ref not like 'H-%') = 0`,
       'knowledge of another card reached the Tucson')}
  end;`);

t(33, 'привід Tucson: знання про AWD умовне без приводу, застосовне на AWD, виключене на FWD', `
  declare p jsonb; a jsonb; f jsonb;
  begin
  p := mi_test.pack(${TUC}, 'report'); a := mi_test.pack(${TUCAWD}, 'report'); f := mi_test.pack(${TUCFWD}, 'report');
  ${A(`mi_test.status('H-065', ${TUC}) = 'CONDITIONAL' and mi_test.status('H-064#a', ${TUC}) = 'CONDITIONAL'`, 'AWD knowledge is not conditional when the drive is unknown')}
  ${A(`mi_test.status('H-065', ${TUCAWD}) = 'APPLICABLE' and mi_test.status('H-064#b', ${TUCAWD}) = 'APPLICABLE'`, 'AWD knowledge is not applicable on a confirmed AWD car')}
  ${A(`coalesce(mi_test.status('H-065', ${TUCFWD}), 'EXCLUDED') = 'EXCLUDED' and not mi_test.has(f, 'H-065') and not mi_test.has(f, 'H-064#a')`, 'AWD knowledge reached a front-wheel drive car')}
  ${A(`mi_test.has(p, 'H-065') and mi_test.check_in_pack(p, 'Confirm all-wheel drive on the Tucson: AWD LOCK button and rear drive shaft')`, 'the drive check does not accompany the conditional AWD knowledge')}
  ${A(`mi_test.has(f, 'H-020') and mi_test.has(f, 'H-090') and mi_test.has(a, 'H-020')`, 'the drive changed engine knowledge')}
  end;`);

t(34, 'дата виробництва: відклик ABS-модуля умовний без дати, розвʼязується датою', `
  declare p jsonb;
  begin
  p := mi_test.pack(${TUC19}, 'report');
  ${A(`mi_test.status('H-080#a', ${TUC19}) = 'CONDITIONAL' and mi_test.has(p, 'H-080#a')`, 'the 2019 build window recall is not conditional in the report without a build date')}
  ${A(`mi_test.check_in_pack(p, 'Read the manufacture month on the door jamb label of the Tucson', 'must')`, 'the build date check is missing or not MUST')}
  ${A(`mi_test.status('H-080#a', ${TUC19IN}) = 'APPLICABLE' and coalesce(mi_test.status('H-080#a', ${TUC19OUT}), 'EXCLUDED') = 'EXCLUDED'`, 'the build date does not settle the recall window')}
  ${A(`mi_test.status('H-081', ${TUC19OUT}) = 'APPLICABLE'`, 'the generation level recall description disappeared with the build date')}
  end;`);

t(35, 'суміжна версія Tucson TL з Nu 2.0 не отримує знання Theta II, продовжень і перевірок мотора', `
  declare p19 jsonb; p20 jsonb;
  begin
  p19 := mi_test.pack(${NU19}, 'report'); p20 := mi_test.pack(${NU20}, 'report');
  ${A(`(select count(*) from mi.candidate_claim k where k.published_claim_id = any (mi_test.pack_claims(p19) || mi_test.pack_claims(p20))
         and k.task_ref not in ('H-080#a','H-080#b','H-081','H-082')) = 0`,
       'engine, version or extension knowledge of the 2.4 reached the Nu 2.0 fixture')}
  ${A(`mi_test.has(p19, 'H-080#a') and mi_test.has(p19, 'H-081') and mi_test.has(p20, 'H-080#b')`, 'generation level recall knowledge did not reach the Nu 2.0 fixture')}
  ${A(`not mi_test.check_in_pack(p19, 'Read stored engine codes for P1326 on the Tucson 2.4') and not mi_test.check_in_pack(p19, 'Ask a Hyundai dealer to look up T3G, campaign 953, TXXC and TXXI on the VIN')`,
       'a Theta II check reached the Nu 2.0 fixture')}
  ${A(`coalesce(mi_test.status('H-012', ${NU19}), 'EXCLUDED') = 'EXCLUDED' and coalesce(mi_test.status('H-014', ${NU19}), 'EXCLUDED') = 'EXCLUDED'`,
       'the extension of the 2.4 is not excluded on a 2019 Nu 2.0 car')}
  end;`);

t(36, 'картка 3 не витікає у BMW і Tesla, клейми про право несуть предикат версії', `
  ${A(`(select count(*) from (values (mi_test.pack(${X}, 'report')), (mi_test.pack(${M3}, 'report')), (mi_test.pack(${M550}, 'report')), (mi_test.pack(${TESLA}, 'report'))) v(p), mi.candidate_claim k
         where k.task_ref like 'H-%' and k.published_claim_id = any (mi_test.pack_claims(p))) = 0`,
       'Tucson knowledge reached a BMW or Tesla pack')}
  ${A(`(select count(*) from mi.claim c join mi.candidate_claim k on k.published_claim_id = c.id
         join mi.knowledge_subject sj on sj.id = c.subject_id
        where k.task_ref like 'H-%' and sj.kind = 'entitlement'
          and not exists (select 1 from mi.claim_applicability a where a.claim_id = c.id and a.dimension in ('version', 'model_line'))) = 0`,
       'a card 3 claim on a brand entitlement carries no version or model line scope')}`);

t(37, 'текст заблокованих кандидатів картки 3 не витікає у пакети', `
  ${A(`(select count(*) from mi.candidate_claim k
         where k.task_ref like 'H-%' and k.review_status = 'gate_pending'
           and (position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${TUC}, 'report'))) > 0
             or position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${TUC19}, 'report'))) > 0
             or position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(${TUC21}, 'decision'))) > 0
             or position(left(k.text_en, 60) in mi_test.pack_text(mi_test.pack(mi_test.partial_of('TL_THETA2_24'), 'report'))) > 0)) = 0`,
       'blocked text of card 3 leaked into a pack')}`);

t(38, 'канонічні перевірки картки 3 доходять до пакета', `
  declare p jsonb;
  begin
  p := mi_test.pack(${TUC}, 'report');
  ${A(`mi_test.check_in_pack(p, 'Cold start and rev test for connecting rod knock', 'must')`, 'the knock test is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Read stored engine codes for P1326 on the Tucson 2.4', 'must')`, 'the P1326 scan is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Check the oil level on the dipstick of the Tucson 2.4', 'must')`, 'the oil level check is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Ask for oil change records and the Hyundai campaign history', 'must')`, 'the records check is missing or not MUST')}
  ${A(`mi_test.check_in_pack(p, 'Read the eighth VIN character for the Tucson engine code', 'must')`, 'the VIN engine check is missing or not MUST')}
  ${A(`mi_test.check_in_pack(mi_test.pack(${TUC19}, 'report'), 'Ask a Hyundai dealer to look up T3G, campaign 953, TXXC and TXXI on the VIN', 'must')`, 'the extension lookup is missing on a 2019 car')}
  ${A(`not mi_test.check_in_pack(p, 'Read pack capacity and battery alerts') and not mi_test.check_in_pack(p, 'Read the manufacture month on the door jamb label')`, 'a Tesla check reached the Tucson')}
  end;`);

t(39, 'матчер резолвить написи 2.4 і мовчить на 2.0, 1.6, 2.5, комплектаціях і інших моделях', `
  ${A(`(select bool_and((mi.match_version_text('Hyundai', 'Tucson', t)->>'version_id')::bigint = mi_test.sid_of('version', 'TL_THETA2_24'))
         from unnest(array['2.4 GDI', '2.4L', 'Theta II 2.4', '2.4', '2.4 AWD', 'Tucson 2.4', 'Hyundai Tucson 2.4 AWD', '2.4L FWD']) t)`,
       'a Tucson 2.4 label does not resolve')}
  ${A(`(select bool_and(mi.match_version_text('Hyundai', 'Tucson', t)->>'version_id' is null and (mi.match_version_text('Hyundai', 'Tucson', t)->>'ambiguous')::boolean is false)
         from unnest(array['2.0 GDI', '2.0L', 'SE 2.0 FWD', 'Nu 2.0 GDI 4-cylinder', '2.0L 4 cyl AWD', '2.0 4 AWD', '4 2', '1.6 Turbo', '2.5', 'SEL', 'Limited AWD', 'TL', 'Tucson TL', 'AWD']) t)`,
       'a non 2.4 or engine-less Tucson text resolved to the 2.4 version')}
  ${A(`mi.match_version_text('Hyundai', null, 'Sonata 2.4 GDI')->>'version_id' is null and mi.match_version_text('Hyundai', 'Sonata', '2.4 GDI')->>'version_id' is null
       and mi.match_version_text('Kia', 'Sportage', '2.4 GDI')->>'version_id' is null`, 'an adjacent Hyundai or Kia Theta II text resolved to the Tucson')}
  ${A(`(mi.match_version_text('Tesla', 'Model 3', 'Long Range AWD')->>'version_id')::bigint = mi_test.sid_of('version', 'M3_LR_AWD')
       and (mi.match_version_text('BMW', '5 series', '530i xDrive')->>'version_id')::bigint = mi_test.sid_of('version', '530I_XDRIVE')`, 'adding the Tucson broke an earlier card match')}`);

t(40, 'часткова ідентичність Tucson: версія без року, рік без приводу, ряд без версії', `
  declare v jsonb; y jsonb; p jsonb; q jsonb; r jsonb;
  begin
  v := mi_test.partial_of('TL_THETA2_24'); y := mi_test.partial_of('TL_THETA2_24', 2020, 'US');
  p := mi_test.pack(v, 'report'); q := mi_test.pack(y, 'report');
  ${A("(p->>'fragment_available')::boolean and p->'pack_meta'->>'identity_precision' = 'partial' and (p->'pack_meta'->>'candidate_vmy_count')::int = 4", 'the version alone got no partial pack over the four years')}
  ${A(`mi_test.status('H-090', v) = 'APPLICABLE' and mi_test.status('H-010', v) = 'APPLICABLE' and mi_test.status('H-053', v) = 'APPLICABLE'`, 'version knowledge is not applicable on the version-only identity')}
  ${A(`mi_test.status('H-020', v) = 'CONDITIONAL' and mi_test.has(p, 'H-020') and mi_test.has(p, 'H-090')`, 'the bearing failure is not carried as conditional knowledge on the version-only identity')}
  ${A(`mi_test.status('H-011', v) = 'CONDITIONAL' and mi_test.status('H-013', v) = 'CONDITIONAL' and not mi_test.has(p, 'H-011') and not mi_test.has(p, 'H-013')`, 'year bound coverage is asserted without a model year')}
  ${A(`mi_test.check_in_pack(p, 'Read the eighth VIN character for the Tucson engine code', 'must')`, 'the engine identity check is missing on the version-only pack')}
  ${A(`mi_test.status('H-013', y) = 'APPLICABLE' and coalesce(mi_test.status('H-012', y), 'EXCLUDED') = 'EXCLUDED' and mi_test.status('H-065', y) = 'CONDITIONAL' and mi_test.status('H-080#b', y) = 'CONDITIONAL'`, 'the version plus year identity has the wrong statuses')}
  ${A(`mi_test.has(q, 'H-013') and mi_test.has(q, 'H-020') and not mi_test.has(q, 'H-011') and not mi_test.has(q, 'H-080#a')`, 'the version plus year pack has the wrong membership')}
  r := mi.compile_pack(jsonb_build_object('brand', (select subject_id from mi.brand where name = 'Hyundai'), 'model_line', (select subject_id from mi.model_line where name = 'Tucson'),
         'generation', (select subject_id from mi.generation where platform_code = 'TL'),
         'model_year', 2020, 'market_sold', 'US', 'components', '[]'::jsonb, 'equipment', '[]'::jsonb, 'entitlements', '[]'::jsonb, 'states', '[]'::jsonb), 'report');
  ${A("(r->>'fragment_available')::boolean is false and r->>'reason' = 'version_not_identified'", 'a Tucson TL identity without the engine produced a pack')}
  ${A(`(select count(*) from mi.candidate_claim k where k.published_claim_id = any (mi_test.pack_claims(p)) and k.task_ref not like 'H-%') = 0`, 'knowledge of another card reached the partial Tucson pack')}
  end;`);

/* ================= Інваріант застосовності (міграція 026) =================
   UNKNOWN означає, що вимір справді невідомий. Відомий вимір, що суперечить
   застосовності, дає NO_MATCH, а не UNKNOWN чи CONDITIONAL. */

t(41, 'відомий модельний рік поза роками версії: часткового пакета версії немає', `
  declare q jsonb; d jsonb;
  begin
  q := mi.compile_pack(mi_test.partial_of('TL_THETA2_24', 2015, 'US'), 'report');
  d := mi.compile_pack(mi_test.partial_of('TL_THETA2_24', 2015, 'US'), 'decision');
  ${A(`(q->>'fragment_available')::boolean is false and q->>'reason' = 'version_excluded_by_model_year'`, 'a 2015 Tucson got a partial pack of the 2018-2021 Tucson 2.4')}
  ${A(`q->'pack' is null and cardinality(mi_test.pack_claims(q)) = 0`, 'claims of the Tucson 2.4 card reached a 2015 Tucson')}
  ${A(`(q->'version_model_years') = '[2018,2019,2020,2021]'::jsonb and (q->>'model_year')::int = 2015`, 'the exclusion does not name the known year and the version years')}
  ${A(`(d->>'fragment_available')::boolean is false and d->>'reason' = 'version_excluded_by_model_year'`, 'the decision purpose still falls back for a known contradictory year')}
  ${A(`mi.request_pack(mi_test.partial_of('TL_THETA2_24', 2015, 'US'), 'report')->>'reason' = 'version_excluded_by_model_year'`, 'the request path still falls back for a known contradictory year')}
  end;`);

t(42, 'відомий рік поза роками версії: Model 3 2017 і 530i xDrive 2016', `
  declare q jsonb; b jsonb;
  begin
  q := mi.compile_pack(mi_test.partial_of('M3_LR_AWD', 2017, 'US'), 'report');
  b := mi.compile_pack(mi_test.partial_of('530I_XDRIVE', 2016, 'US'), 'report');
  ${A(`(q->>'fragment_available')::boolean is false and q->>'reason' = 'version_excluded_by_model_year' and cardinality(mi_test.pack_claims(q)) = 0`, 'a 2017 Model 3 got the 2018-2023 Long Range AWD partial pack')}
  ${A(`(b->>'fragment_available')::boolean is false and b->>'reason' = 'version_excluded_by_model_year' and cardinality(mi_test.pack_claims(b)) = 0`, 'a 2016 530i got the 2017-2020 530i xDrive partial pack')}
  ${A(`(mi_test.pack(mi_test.partial_of('530I_XDRIVE', 2017, 'US'), 'report')->>'fragment_available')::boolean
       and (mi_test.pack(mi_test.partial_of('M3_LR_AWD', 2023, 'US'), 'report')->>'fragment_available')::boolean
       and (mi_test.pack(mi_test.partial_of('TL_THETA2_24', 2018, 'US'), 'report')->>'fragment_available')::boolean`, 'a boundary year inside the version range lost its partial pack')}
  end;`);

t(43, 'невідомий рік лишається невідомим: частковий пакет і умовне знання працюють', `
  declare v jsonb; p jsonb;
  begin
  v := mi_test.partial_of('TL_THETA2_24'); p := mi_test.pack(v, 'report');
  ${A(`(p->>'fragment_available')::boolean and (p->'pack_meta'->>'candidate_vmy_count')::int = 4`, 'the version without a year lost its partial pack')}
  ${A(`mi_test.status('H-013', v) = 'CONDITIONAL' and mi_test.status('H-020', v) = 'CONDITIONAL' and mi_test.has(p, 'H-020')`, 'year and component dependent knowledge is no longer conditional without a year')}
  ${A(`(mi_test.pack(mi_test.partial_of('M3_LR_AWD'), 'report')->>'fragment_available')::boolean
       and (mi_test.pack(mi_test.partial_of('530I_XDRIVE'), 'report')->>'fragment_available')::boolean`, 'a version without a year lost its partial pack on cards 1 or 2')}
  end;`);

t(44, 'відомий N63 проти знання родини і варіанта B48: NO_MATCH, не CONDITIONAL', `
  ${A(`(select bool_and(mi_test.status(r, ${M550}) = 'EXCLUDED') from unnest(array['G-043','G-019','G-021','G-022#a','G-023','G-024','G-026#a']) r)`,
       'B48 family or variant knowledge is not excluded on a known N63 car')}
  ${A(`exists (select 1 from jsonb_array_elements(mi.eval_claim(mi_test.claim('G-043'), ${M550})->'predicates') pr
               where pr->>'dimension' = 'component_family' and pr->>'result' = 'NO_MATCH' and pr->>'observed' is not null)`,
       'the family anchor of G-043 does not record the observed incompatible engine')}
  ${A(`exists (select 1 from jsonb_array_elements(mi.eval_claim(mi_test.claim('G-019'), ${M550})->'predicates') pr
               where pr->>'dimension' = 'component_variant' and pr->>'result' = 'NO_MATCH' and pr->>'observed' is not null)`,
       'the variant anchor of G-019 (B46B20O0 oil service) is not NO_MATCH on a known N63 car')}
  ${A(`mi.eval_check((select c.subject_id from mi.check_item c where c.scope_subject_id in (select subject_id from mi.component_family where family_key = 'BMW_B48')
                      or c.scope_subject_id in (select v.subject_id from mi.component_variant v join mi.component_family f on f.subject_id = v.family_id where f.family_key = 'BMW_B48') limit 1), ${M550})->>'status' = 'EXCLUDED'`,
       'a B48 check is not excluded on a known N63 car')}
  ${A(`mi_test.status('G-043', ${X}) in ('APPLICABLE', 'APPLICABLE_ASSUMED') and mi_test.status('G-022#a', ${X}) = 'APPLICABLE'`, 'B48 knowledge stopped applying to the B48 car')}`);

t(45, 'відомий Nu 2.0 проти знання Theta II 2.4: NO_MATCH у клеймах, перевірках і предикатах', `
  ${A(`(select bool_and(mi_test.status(r, ${NU19}) = 'EXCLUDED' and mi_test.status(r, ${NU20}) = 'EXCLUDED') from unnest(array['H-003','H-020','H-021','H-030','H-040','H-050','H-060']) r)`,
       'Theta II 2.4 knowledge is not excluded on a known Nu 2.0 car')}
  ${A(`mi.eval_check((select subject_id from mi.check_item c join mi.knowledge_subject k on k.id = c.subject_id where k.label = 'Cold start and rev test for connecting rod knock'), ${NU19})->>'status' = 'EXCLUDED'`,
       'the Theta II knock check is not excluded on a known Nu 2.0 car')}
  ${A(`mi.eval_predicate(jsonb_populate_record(null::mi.claim_applicability, jsonb_build_object('dimension', 'component_family', 'operator', 'eq',
         'ref_subject_id', (select subject_id from mi.component_family where family_key = 'HYUNDAI_THETA_II'), 'group_no', 1, 'config_scope', 'current')), ${NU19})->>'result' = 'NO_MATCH'
       and mi.eval_predicate(jsonb_populate_record(null::mi.claim_applicability, jsonb_build_object('dimension', 'component_variant', 'operator', 'eq',
         'ref_subject_id', (select subject_id from mi.component_variant where variant_code = 'THETA2_24_GDI'), 'group_no', 1, 'config_scope', 'current')), ${NU19})->>'result' = 'NO_MATCH'`,
       'an explicit Theta II family or variant predicate is not NO_MATCH on a known Nu 2.0 car')}
  ${A(`mi_test.status('H-020', ${TUC}) = 'APPLICABLE'`, 'Theta II knowledge stopped applying to the Theta II car')}`);

t(46, 'невідомий компонент лишається невідомим: UNKNOWN і CONDITIONAL там, де роль не розвʼязана', `
  declare u jsonb; w jsonb;
  begin
  u := mi_test.partial_of('TL_THETA2_24', 2020, 'US');
  w := jsonb_set(mi_test.id_tucson_nu20(2019), '{components}', '[]'::jsonb);
  ${A(`mi_test.status('H-020', u) = 'CONDITIONAL' and mi_test.status('H-060', u) = 'CONDITIONAL'`, 'engine knowledge is not conditional when the engine is unresolved')}
  ${A(`mi_test.status('H-020', w) = 'CONDITIONAL'`, 'engine knowledge is not conditional on a car whose engine is unresolved')}
  ${A(`mi_test.status('H-070', ${NU19}) = 'CONDITIONAL'`, 'transmission knowledge became excluded although the transmission role of the car is unresolved')}
  ${A(`mi_test.status('H-020', jsonb_set(${NU19}, '{components}', (select jsonb_agg(jsonb_set(e, '{status}', '"conflicted"')) from jsonb_array_elements(${NU19}->'components') e))) = 'CONDITIONAL'`,
       'a conflicted engine observation was treated as a known incompatible engine')}
  ${A(`mi_test.status('M-042', ${M3}) in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'CONDITIONAL')`, 'Model 3 low voltage knowledge in the shared other role changed status')}
  end;`);

t(47, 'слабке заводське припущення про іншу родину дає EXCLUDED_ASSUMED, а не впевнене виключення', `
  ${A(`mi.eval_claim(mi_test.claim('M-009'), ${TESLA})->>'status' = 'EXCLUDED_ASSUMED'`,
       'the Model 3 thermal family claim on a Model S with an assumed PTC heater is not an assumed exclusion')}
  ${A(`exists (select 1 from jsonb_array_elements(mi.eval_claim(mi_test.claim('M-009'), ${TESLA})->'predicates') pr
               where pr->>'dimension' = 'component_family' and pr->>'result' = 'ASSUMED_NO_MATCH' and pr->>'basis' = 'assumed_factory')`,
       'a weak factory assumption was turned into a confirmed exclusion')}`);

/* ---- Підсумок ---- */

if (errs.length) {
  console.error('micatalogtest: помилок ' + errs.length + ' із ' + checks + ' перевірок');
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('micatalogtest: усі ' + checks + ' перевірок пройшли');
