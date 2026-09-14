/* Model Intelligence Catalog: smoke-тести карток каталогу.

   Кожна картка каталогу отримує тут свій блок: очікувані опубліковані і
   заблоковані кандидати, точний пакет версії, негативна застосовність до
   суміжних ідентичностей (інша версія того самого покоління, еталонна
   картка того самого кузова, невідомий ринок продажу, часткова
   ідентичність), відсутність витоку заблокованого тексту і поведінка
   матчера версій на реальних написах Check.

   Картка 1: BMW 530i xDrive G30 B48 (B46B20O0), US MY2017-2020, префікс G.

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

t(27, 'еталонна картка Model S у пакеті не зрушена', `
  declare p jsonb;
  begin
  p := mi_test.pack(${TESLA}, 'report');
  ${A(`(select bool_and(mi_test.has(p, r)) from unnest(array['T-002#a','T-010','T-022#a','T-050#a']) r)`, 'the Model S pack lost reference knowledge')}
  ${A(`mi_test.check_in_pack(p, 'Inspect the LDU speed sensor for coolant', 'must')`, 'the Model S lost its speed sensor check')}
  end;`);

/* ---- Підсумок ---- */

if (errs.length) {
  console.error('micatalogtest: помилок ' + errs.length + ' із ' + checks + ' перевірок');
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('micatalogtest: усі ' + checks + ' перевірок пройшли');
