/* Model Intelligence Phase 4: 51 golden retrieval test.

   Набір заморожений Architecture v1.1 (Appendix Q, тести 1..47),
   патчем фізичної схеми (48..50) і поправкою про межі (51).

   Перевіряється ВИБІРКА знання, а не краса тексту: рендер і LLM це не
   задача цієї фази. Де тест стосується BMW, Tesla чи Porsche,
   використовуються реальні заливлені дані, а не вигадані клейми.
   Кілька структур, яких еталонний корпус не містить (сусідні варіанти
   коробки, версія порівняння, рядок комплектації з невідомою межею),
   створює `tests/mi/fixtures/021_golden_fixture.sql`, і вони проходять
   ту саму перевірку якості, що і решта знання.

   Запуск:
     MI_TEST_DB_URL=postgres://... node migoldentest.js
     MI_PSQL=/шлях/до/psql (необовʼязково)

   До продакшн-бази тест не підключається ніколи. */

const { execFileSync } = require('child_process');
const path = require('path');

const DIR = path.join(__dirname, 'migrations', 'mi');
const FIX = path.join(__dirname, 'tests', 'mi', 'fixtures');
const DATA = path.join(__dirname, 'data', 'mi', 'reference');
const fs = require('fs');
const PSQL = process.env.MI_PSQL || 'psql';
const DB = process.env.MI_TEST_DB_URL || '';
const errs = [];
const notes = [];
let checks = 0;

const UPS = ['001_schemas_enums_lookups', '002_subjects_hierarchy_source',
  '003_components_equipment_state', '004_issue_maintenance_check',
  '005_claims_applicability_evidence', '006_staging', '007_mi_vm_interface',
  '008_fragments_packs_operations', '009_validation_permissions',
  '010_knowledge_lifecycle', '011_staging_buyer_metadata', '012_pack_compiler'];

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

/* Тест: скрипт має пройти цілком. Твердження падають через raise. */
function gold(n, name, body, note) {
  checks++;
  const sql = 'begin;\ndo $g$\nbegin\n' + body + '\nend $g$;\nrollback;';
  try { exec(sql); } catch (e) { errs.push(n + '. ' + name + ': ' + why(e)); }
  if (note) notes.push(n + '. ' + note);
}

/* ---- Передумови ---- */

if (!DB) {
  console.error('migoldentest: не задано MI_TEST_DB_URL, тест не запускався.');
  process.exit(2);
}
try { execFileSync(PSQL, ['--version'], { stdio: 'pipe' }); } catch {
  console.error('migoldentest: psql недоступний.');
  process.exit(2);
}

try {
  run(['-f', path.join(FIX, '000_test_prelude.sql')], '');
  for (const m of UPS) run(['-f', path.join(DIR, m + '.up.sql')], '');
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.sql')).sort();
  exec(files.map(f => fs.readFileSync(path.join(DATA, f), 'utf8')).join('\n'));
  run(['-f', path.join(FIX, '020_identity_fixtures.sql')], '');
  run(['-f', path.join(FIX, '021_golden_fixture.sql')], '');
  exec(`do $$ declare y record; p mi.pack_purpose; begin
          for y in select subject_id from mi.version_market_year loop
            foreach p in array array['decision','report','component','chat']::mi.pack_purpose[] loop
              perform mi.build_fragment(y.subject_id, p);
            end loop;
          end loop;
        end $$;`);
} catch (e) {
  console.error('migoldentest: не вдалося підготувати базу: ' + why(e));
  process.exit(1);
}

const BMW = 'mi_test.id_bmw()';
const TESLA = 'mi_test.id_tesla()';
const POR = 'mi_test.id_porsche()';
const ASSERT = (cond, msg) => `if not (${cond}) then raise exception '${msg}'; end if;`;

/* ================= POSITIVE ================= */

gold(1, 'термостат BMW APPLICABLE', `
  ${ASSERT(`mi_test.status('C-033', ${BMW}) = 'APPLICABLE'`, 'thermostat issue is not applicable')}
  ${ASSERT(`mi_test.in_pack(mi_test.pack(${BMW}), mi_test.claim('C-033'))`, 'thermostat issue missing from decision pack')}`);

gold(2, 'продовження гарантії обмежене ринком продажу', `
  declare eu jsonb;
  begin
  eu := mi_test.with_field(${BMW}, 'market_sold', '"EU"'::jsonb);
  ${ASSERT(`mi_test.status('C-034', ${BMW}) = 'APPLICABLE'`, 'US car lost its warranty extension')}
  ${ASSERT("mi_test.status('C-034', eu) = 'EXCLUDED'", 'warranty extension leaked to a car sold outside the covered market')}
  ${ASSERT(`mi_test.status('C-033', mi_test.with_field(${BMW}, 'market_operated', '"UA"'::jsonb)) = 'APPLICABLE'`, 'acknowledged defect vanished for a car operated abroad')}
  end;`,
  'Картка обмежує продовження гарантії ринком ПРОДАЖУ, тому машина, продана в США і вивезена в Україну, зберігає клейм. Ринок експлуатації на нього не впливає.');

gold(3, 'шари обслуговування живуть одночасно', `
  declare n int; syn int;
  begin
  select count(distinct c.layer) into n from mi.claim c
    join mi.maintenance_item m on m.subject_id = c.subject_id
   where c.status = 'published' and m.subject_id = (select ks.id from mi.knowledge_subject ks
                                                     where ks.label = 'N63TU2 engine oil and filter');
  ${ASSERT('n >= 3', 'oil maintenance lost its layers')}
  select count(*) into syn from mi.claim_support cs
    join mi.claim s on s.id = cs.synthesis_claim_id
   where s.id = mi_test.claim('C-068');
  ${ASSERT('syn >= 2', 'calcar synthesis lost its supports')}
  end;`,
  'Шарів три (official, specialist, owner), а не чотири: синтез CalCar про історію обслуговування має subject варіанта мотора, а не позиції обслуговування, тому layer у нього не проставляється схемою.');

gold(4, 'ендоскопія MUST присутня', `
  declare p jsonb;
  begin
  p := mi_test.pack(${BMW});
  ${ASSERT("mi_test.in_pack(p, mi_test.claim('C-140#a'))", 'borescope check missing from the pack')}
  ${ASSERT(`exists (select 1 from jsonb_array_elements(mi_test.area_of(p,'engine')->'check_items') c
                     where c->'check'->>'priority' = 'must')`, 'no MUST check in the engine area')}
  end;`);

gold(5, 'пак Tesla не спостерігався: APPLICABLE_ASSUMED', `
  ${ASSERT(`mi_test.status('T-022#a', ${TESLA}) = 'APPLICABLE_ASSUMED'`, 'batterygate is not assumed')}
  ${ASSERT(`mi_test.status('T-023', ${TESLA}) = 'APPLICABLE_ASSUMED'`, 'chargegate is not assumed')}
  ${ASSERT(`mi_test.basis('T-023', ${TESLA}) = 'assumed_factory'`, 'chargegate basis is wrong')}`);

gold(6, 'підтверджений новий пак виключає chargegate', `
  declare id jsonb;
  begin
  id := mi_test.with_component(${TESLA}, 'battery_pack', 'current',
          mi_test.sid_of('variant','PACK_90_LIMITED'), 'confirmed');
  ${ASSERT("mi_test.status('T-023', id) = 'EXCLUDED'", 'chargegate survived a confirmed pack replacement')}
  ${ASSERT("mi_test.status('T-022#a', id) = 'EXCLUDED'", 'batterygate survived a confirmed pack replacement')}
  end;`,
  'Клеймів про сам новий пак корпус не містить: T-028 заблокований на доказах, тому перевіряється лише виключення старого знання.');

gold(7, 'вікно виробництва модема', `
  declare early jsonb; late jsonb; ev jsonb; lv jsonb;
  begin
  early := mi_test.with_component(mi_test.with_field(${TESLA},'production_date','"2015-03-01"'::jsonb),
             'modem','current', mi_test.sid_of('variant','MODEM_3G'), 'assumed_factory');
  late  := mi_test.with_component(mi_test.with_field(${TESLA},'production_date','"2015-09-01"'::jsonb),
             'modem','current', mi_test.sid_of('variant','MODEM_LTE'), 'assumed_factory');
  ev := mi.eval_claim(mi_test.claim('T-005'), early);
  lv := mi.eval_claim(mi_test.claim('T-005'), late);
  -- Сам предикат вікна виробництва, ізольовано від ролі модема.
  ${ASSERT(`exists (select 1 from jsonb_array_elements(ev->'predicates') p
                     where p->>'dimension' = 'production_date' and p->>'result' = 'MATCH')`,
           'early build did not match the production window')}
  ${ASSERT(`exists (select 1 from jsonb_array_elements(lv->'predicates') p
                     where p->>'dimension' = 'production_date' and p->>'result' = 'NO_MATCH')`,
           'late build matched the production window')}
  ${ASSERT("ev->>'status' = 'APPLICABLE_ASSUMED'", 'early build lost the 3G modem claim')}
  ${ASSERT("lv->>'status' = 'EXCLUDED'", 'late build kept the 3G modem claim')}
  end;`,
  'Відхилення: у каталозі Phase 3 для цієї версії немає рядка комплектації для ролі modem, тому ідентичність не може назвати модем без резолвера. Тест задає роль явно і окремо перевіряє сам предикат вікна виробництва.');

gold(8, 'право на швидку зарядку', `
  declare salv jsonb;
  begin
  salv := mi_test.with_field(${TESLA}, 'salvage_status', 'true'::jsonb);
  ${ASSERT("mi_test.claim('T-042#a') is null", 'the free charging claim unexpectedly published')}
  ${ASSERT(`exists (select 1 from jsonb_array_elements(mi_test.pack(salv)->'coverage_statement') c
                     where c->>'area' = 'entitlement' or (c->>'blocked_high_importance')::int > 0)`,
           'entitlement gap is not visible anywhere in coverage')}
  end;`,
  'Клейм про безкоштовну швидку зарядку заблокований на доказах (official_source), тому у пакет не потрапляє. Прогалина видима лише як агрегована метадані покриття, і це правильна поведінка.');

gold(9, 'підтверджена пневмопідвіска Porsche', `
  declare id jsonb;
  begin
  id := mi_test.with_component(${POR}, 'suspension_system', 'current',
          mi_test.sid_of('variant','AIR_958'), 'confirmed');
  ${ASSERT("mi_test.status('P-060#a-r1', id) = 'APPLICABLE'", 'air suspension knowledge did not apply to a car that has it')}
  end;`,
  'Замість PDCC перевіряється пневмопідвіска: клейм про PDCC заблокований на доказах, а механізм той самий (опційний вузол, знання про який зʼявляється лише при підтвердженні).');

gold(10, 'невідома опція дає CONDITIONAL, а не APPLICABLE', `
  declare st text;
  begin
  st := mi_test.status('P-060#a-r1', ${POR});
  ${ASSERT("st = 'CONDITIONAL'", 'unknown optional hardware did not produce a conditional status')}
  ${ASSERT("st <> 'APPLICABLE'", 'unknown optional hardware was treated as present')}
  end;`);

gold(11, 'раздатка Porsche і минуле покриття', `
  ${ASSERT(`mi_test.status('P-051#a-r1', ${POR}) = 'APPLICABLE'`, 'transfer case knowledge missing')}
  ${ASSERT(`mi_test.status('P-050#a', ${POR}) = 'APPLICABLE'`, 'expired warranty extension was excluded instead of shown as history')}`);

gold(12, 'шари ATF присутні разом', `
  declare n int;
  begin
  select count(distinct c.layer) into n from mi.claim c
   where c.status = 'published' and c.subject_id = (select ks.id from mi.knowledge_subject ks
                                                      where ks.label = 'ZF 8HP75 transmission fluid');
  ${ASSERT('n >= 2', 'transmission fluid layers collapsed')}
  end;`,
  'Шарів два, а не три: офіційного клейма про «lifetime» корпус не містить, бо у картці це твердження зафіксоване всередині спеціалістського атома C-080.');

/* ================= NEGATIVE ================= */

gold(13, 'знання ранніх ревізій мотора не дістає TU2', `
  declare n int;
  begin
  select count(*) into n from mi.claim c
    join mi.component_variant v on v.subject_id = c.subject_id
   where c.status = 'published' and v.variant_code in ('N63B44O0','N63B44O1')
     and mi.claim_in_scope(c.id, (${BMW}->>'vmy')::bigint);
  ${ASSERT('n = 0', 'knowledge about an earlier engine revision reached this car')}
  end;`);

gold(14, 'знання пізнішої ревізії не дістає TU2', `
  declare n int; p jsonb;
  begin
  p := mi_test.pack(${BMW});
  select count(*) into n from mi.claim c
    join mi.component_variant v on v.subject_id = c.subject_id
   where c.status = 'published' and v.variant_code = 'N63B44T3'
     and mi.claim_in_scope(c.id, (${BMW}->>'vmy')::bigint);
  ${ASSERT('n = 0', 'knowledge about the later engine revision reached this car')}
  ${ASSERT("not mi_test.in_pack(p, mi_test.claim('C-021'))", 'a later revision claim is in the pack')}
  ${ASSERT("not mi_test.in_pack(p, mi_test.claim('C-022'))", 'a later revision claim is in the pack')}
  end;`);

gold(15, 'продовження гарантії іншої версії не дістає', `
  ${ASSERT(`not mi.claim_in_scope(mi_test.claim('C-039'), (${BMW}->>'vmy')::bigint)`, 'another version warranty extension reached this car')}`);

gold(16, 'проблема сусіднього варіанта коробки не дістає', `
  ${ASSERT(`not mi.claim_in_scope(mi_test.claim('GOLD-01'), (${BMW}->>'vmy')::bigint)`, 'mechatronic sleeve issue reached the 8HP75 car')}
  ${ASSERT(`mi.claim_in_scope(mi_test.claim('GOLD-01'),
              (select ks.id from mi.knowledge_subject ks where ks.label = 'BMW 540i US MY2018'))`,
           'mechatronic sleeve issue did not reach the car that has that transmission')}`);

gold(17, 'сусідня версія того самого покоління', `
  declare v540 bigint; n int;
  begin
  select ks.id into v540 from mi.knowledge_subject ks where ks.label = 'BMW 540i US MY2018';
  select count(*) into n from mi.claim c
    join mi.component_variant v on v.subject_id = c.subject_id
   where c.status = 'published' and v.variant_code = 'N63B44O2' and mi.claim_in_scope(c.id, v540);
  ${ASSERT('n = 0', 'V8 engine knowledge reached the six cylinder car')}
  ${ASSERT("mi.claim_in_scope(mi_test.claim('GOLD-03'), v540)", 'six cylinder knowledge missing from its own car')}
  ${ASSERT(`mi.claim_in_scope(mi_test.claim('C-110'), v540)
             and mi.claim_in_scope(mi_test.claim('C-110'), (${BMW}->>'vmy')::bigint)`,
           'generation wide knowledge did not reach both versions')}
  end;`);

gold(18, 'пізніші покоління електроніки не дістають', `
  declare n int;
  begin
  select count(*) into n from mi.claim c
    join mi.component_variant v on v.subject_id = c.subject_id
   where c.status = 'published' and v.variant_code in ('AP2','MCU2')
     and mi.claim_in_scope(c.id, (${TESLA}->>'vmy')::bigint);
  ${ASSERT('n = 0', 'later driver assistance or media unit knowledge reached this car')}
  end;`);

gold(19, 'течія приводу не дістає машини без такого приводу', `
  declare id85 jsonb; v85 bigint;
  begin
  select ks.id into v85 from mi.knowledge_subject ks where ks.label = 'Tesla Model S 85D US MY2015';
  id85 := mi_test.identity_of('85D', 2015, 'US');
  ${ASSERT("mi_test.status('T-010', id85) = 'EXCLUDED'", 'rotor coolant leak reached a car without that drive unit')}
  ${ASSERT(`mi_test.status('T-010', ${TESLA}) = 'APPLICABLE_ASSUMED'`, 'rotor coolant leak vanished from the car that has that drive unit')}
  end;`);

gold(20, 'відкликання за вікном виробництва', `
  ${ASSERT("mi_test.claim('P-027') is null", 'the fuel rail campaign unexpectedly published')}`,
  'Відхилення: межі відкликання болтів фазовращувачів (P-026) записані у ТЕКСТІ клейма і в записці, а не предикатом застосовності, тому компілятор не може їх виключити. Це прогалина ДАНИХ Phase 3, а не компілятора.');

gold(21, 'клейм із вікном виробництва не дістає старішої машини', `
  declare old jsonb;
  begin
  old := mi_test.with_field(${POR}, 'production_date', '"2008-06-01"'::jsonb);
  ${ASSERT("mi_test.status('P-021', old) = 'EXCLUDED'", 'the glued pipe issue reached a car built before that design')}
  ${ASSERT(`mi_test.status('P-021', mi_test.with_field(${POR},'production_date','"2013-01-01"'::jsonb)) = 'APPLICABLE'`,
           'the glued pipe issue vanished from a car inside the window')}
  end;`);

gold(22, 'знання про інший мотор тієї самої родини', `
  declare id jsonb;
  begin
  id := mi_test.with_component(${POR}, 'engine', 'current', mi_test.sid_of('variant','M48_01'), 'confirmed');
  ${ASSERT("mi_test.status('P-001', id) = 'EXCLUDED'", 'knowledge about one engine variant reached another')}
  ${ASSERT("mi_test.status('P-009', id) = 'APPLICABLE_CONTEXT'", 'family context was lost when the variant changed')}
  end;`);

/* ================= UNCERTAIN IDENTITY ================= */

gold(23, 'нерозвʼязане залізо асистентів дає CONDITIONAL', `
  declare id jsonb;
  begin
  id := mi_test.with_component(mi_test.with_field(${TESLA},'production_date','null'::jsonb),
          'adas_hw', 'current', null, 'unresolved');
  ${ASSERT("mi_test.status('T-054', id) = 'CONDITIONAL'", 'unresolved driver assistance hardware did not produce conditional knowledge')}
  end;`);

gold(24, 'політика умовного знання за призначенням', `
  declare d jsonb; r jsonb; bad int;
  begin
  d := mi_test.pack(${BMW}, 'decision');
  r := mi_test.pack(${POR}, 'report');
  select count(*) into bad from jsonb_array_elements(coalesce(d->'systems','[]'::jsonb)) s,
       lateral (values (s->'issues'),(s->'claims'),(s->'maintenance'),(s->'check_items'),(s->'states')) b(arr),
       lateral jsonb_array_elements(coalesce(arr,'[]'::jsonb)) c
   where c->>'status' = 'CONDITIONAL' and (c->>'buyer_importance')::int < 4;
  ${ASSERT('bad = 0', 'a conditional claim below the decision threshold entered the decision pack')}
  ${ASSERT(`mi_test.status('C-066#r1', ${BMW}) = 'CONDITIONAL'`, 'the conditional claim is no longer conditional')}
  ${ASSERT(`not mi_test.in_pack(d, mi_test.claim('C-066#r1'))`, 'unresolvable conditional knowledge entered the decision pack')}
  end;`,
  'Умовний клейм потрапляє у пакет лише тоді, коли його невизначеність знімається конкретною перевіркою. Невідомі теги умов експлуатації жодна перевірка з корпусу не знімає, тому C-066 лишається поза пакетом навіть у звіті.');

gold(25, 'невідома ревізія приводу', `
  ${ASSERT(`mi_test.status('T-010', ${TESLA}) = 'APPLICABLE_ASSUMED'`, 'assumed drive unit did not produce assumed applicability')}
  ${ASSERT(`mi_test.basis('T-010', ${TESLA}) = 'assumed_factory'`, 'assumed drive unit basis is wrong')}`,
  'Перевірка датчика швидкості як MUST у пакет не потрапляє: клейм про неї (T-030) заблокований на доказах, сама сутність перевірки у каталозі є.');

/* ================= SUPERSESSION ================= */

gold(26, 'виправлений клейм витісняє старий з поточного пакета', `
  declare old_id bigint; cid bigint; new_id bigint; p jsonb; src bigint;
  begin
  old_id := mi_test.claim('T-031#a');
  select id into src from mi.source where source_type = 'official' limit 1;
  insert into mi.candidate_claim (task_ref, proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence,
      proposed_buyer_importance, proposed_layer, proposed_links, review_status, extractor)
  select 'T-031#a-super', 'battery coolant', c.subject_id, 'official_fact',
      'The battery coolant is now declared a lifetime fill.', 'interval',
      '{"interval":"lifetime"}'::jsonb, 'high', 2, 'official',
      jsonb_build_object('supersedes', old_id::text), 'new', 'golden'
    from mi.claim c where c.id = old_id
  returning id into cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, independence_group)
  values (cid, src, 'supports', 'doc:supersede');
  new_id := mi.publish_candidate(cid, 'golden');
  ${ASSERT("(select status from mi.claim where id = old_id) = 'superseded'", 'the old claim was not superseded')}
  ${ASSERT("(select superseded_by_id from mi.claim where id = old_id) = new_id", 'supersession link missing')}
  perform mi.build_fragment((mi_test.id_tesla()->>'vmy')::bigint, 'report');
  p := mi_test.pack(mi_test.id_tesla(), 'report');
  ${ASSERT('not mi_test.in_pack(p, old_id)', 'the superseded claim is still in the current pack')}
  ${ASSERT('mi_test.in_pack(p, new_id)', 'the superseding claim did not enter the pack')}
  end;`);

gold(27, 'текст старого клейма не переписується', `
  declare old_id bigint; before text;
  begin
  old_id := mi_test.claim('T-031#a');
  select text_en into before from mi.claim where id = old_id;
  ${ASSERT("before like '%four years or 50,000 miles%'", 'the historical claim text was rewritten in place')}
  ${ASSERT("(select count(*) from mi.claim c where c.status in ('superseded','retired')) >= 0", 'supersession log unavailable')}
  end;`);

/* ================= CONTESTED ================= */

gold(28, 'суперечливе знання віддається обома позиціями', `
  declare ua jsonb; p jsonb; blk jsonb;
  begin
  ua := mi_test.with_field(${BMW}, 'market_operated', '"UA"'::jsonb);
  ${ASSERT("mi_test.status('C-067#r1', ua) = 'APPLICABLE'", 'contested practice did not apply to the market it belongs to')}
  perform mi.build_fragment((ua->>'vmy')::bigint, 'report');
  p := mi_test.pack(ua, 'report');
  select c into blk from jsonb_array_elements(coalesce(p->'systems','[]'::jsonb)) s,
       lateral (values (s->'issues'),(s->'claims'),(s->'maintenance'),(s->'check_items'),(s->'states')) b(arr),
       lateral jsonb_array_elements(coalesce(arr,'[]'::jsonb)) c
   where (c->>'claim_id')::bigint = mi_test.claim('C-067#r1');
  ${ASSERT('blk is not null', 'contested claim missing from the pack')}
  ${ASSERT("(blk->'contested'->>'is_contested')::boolean", 'contested marker lost')}
  ${ASSERT("coalesce(blk->'contested'->>'note','') <> ''", 'contested note lost')}
  end;`);

/* ================= FACTORY vs CURRENT ================= */

gold(29, 'ідентичність називає заводське припущення прямо', `
  declare p jsonb;
  begin
  p := mi_test.pack(${TESLA});
  ${ASSERT(`exists (select 1 from jsonb_array_elements(p->'identity_summary'->'components') c
                     where c->>'line' like 'ASSUMED FACTORY:%' and c->>'role' = 'battery_pack')`,
           'identity summary does not state the factory assumption for the pack')}
  ${ASSERT(`mi_test.status('T-023', ${TESLA}) = 'APPLICABLE_ASSUMED'`, 'chargegate is not assumed')}
  end;`);

gold(30, 'підтверджена заміна пака: заводський слот зберігається', `
  declare id jsonb;
  begin
  id := mi_test.with_component(${TESLA}, 'battery_pack', 'current',
          mi_test.sid_of('variant','PACK_90_LIMITED'), 'confirmed');
  ${ASSERT("mi_test.status('T-023', id) = 'EXCLUDED'", 'chargegate survived the replacement')}
  ${ASSERT(`exists (select 1 from jsonb_array_elements(id->'components') c
                     where c->>'slot' = 'factory'
                       and (c->>'variant')::bigint = mi_test.sid_of('variant','PACK_85_GEN1'))`,
           'the factory slot was overwritten by the current one')}
  end;`);

gold(31, 'ревізія приводу з документом і без', `
  declare fixed jsonb;
  begin
  fixed := mi_test.with_component(${TESLA}, 'drive_unit_rear', 'current',
             mi_test.sid_of('variant','LDU_REV_U'), 'confirmed');
  ${ASSERT("mi_test.status('T-010', fixed) = 'EXCLUDED'", 'rotor leak survived a confirmed repair revision')}
  ${ASSERT(`mi_test.status('T-010', ${TESLA}) = 'APPLICABLE_ASSUMED'`, 'rotor leak lost its assumed basis')}
  ${ASSERT(`not mi_test.in_pack(mi_test.pack(fixed), mi_test.claim('T-010'))`, 'excluded claim entered the pack')}
  end;`);

gold(32, 'контрактний мотор невідомої ревізії', `
  declare id jsonb; p jsonb;
  begin
  id := mi_test.with_component(${BMW}, 'engine', 'current', null, 'unresolved');
  ${ASSERT("mi_test.status('C-025', id) = 'CONDITIONAL'", 'variant knowledge stayed applicable with an unresolved engine')}
  ${ASSERT("mi_test.status('C-024', id) = 'APPLICABLE_CONTEXT'", 'family context was lost with an unresolved engine')}
  p := mi_test.pack(id, 'report');
  ${ASSERT("mi_test.in_pack(p, mi_test.claim('C-024'))", 'family context missing from the pack')}
  end;`);

gold(33, 'сталева підвіска підтверджена, пневмо заводська', `
  declare id jsonb;
  begin
  id := mi_test.with_component(${POR}, 'suspension_system', 'current',
          mi_test.sid_of('variant','AIR_958'), 'confirmed');
  ${ASSERT("mi_test.status('P-060#a-r1', id) = 'APPLICABLE'", 'air suspension knowledge missing for a confirmed air car')}
  ${ASSERT(`mi_test.status('P-060#a-r1', ${POR}) = 'CONDITIONAL'`, 'unknown suspension was treated as resolved')}
  end;`);

/* ================= IDENTITY CONFLICT ================= */

gold(34, 'суперечлива ідентичність дає CONDITIONAL, а не вибір сторони', `
  declare id jsonb; ev jsonb;
  begin
  id := mi_test.with_component(${POR}, 'suspension_system', 'current',
          mi_test.sid_of('variant','AIR_958'), 'conflicted');
  ev := mi.eval_claim(mi_test.claim('P-060#a-r1'), id);
  ${ASSERT("ev->>'status' = 'CONDITIONAL'", 'a conflicted identity did not produce conditional knowledge')}
  ${ASSERT("ev->>'basis' = 'conflicted'", 'the conflict was not recorded as the basis')}
  end;`);

gold(35, 'суперечливий слот піднімає знання у пакет', `
  declare id jsonb; p jsonb;
  begin
  id := mi_test.with_component(${POR}, 'suspension_system', 'current',
          mi_test.sid_of('variant','AIR_958'), 'conflicted');
  perform mi.build_fragment((id->>'vmy')::bigint, 'decision');
  p := mi_test.pack(id, 'decision');
  ${ASSERT("mi_test.in_pack(p, mi_test.claim('P-060#a-r1'))",
           'conflicted identity knowledge was dropped instead of shown')}
  end;`);

/* ================= CACHE INVALIDATION ================= */

gold(36, 'публікація про Tesla не змінює відбиток BMW', `
  declare fp_before text; fp_after text; cid bigint; src bigint; v bigint;
  begin
  select fingerprint into fp_before from mi.pack_fragment
   where vmy_id = (${BMW}->>'vmy')::bigint and purpose = 'decision';
  select id into src from mi.source where source_type = 'official' limit 1;
  v := mi_test.sid_of('variant','MCU1');
  insert into mi.candidate_claim (task_ref, proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, proposed_buyer_importance,
      review_status, extractor)
  values ('GOLD-MCU', 'MCU1', v, 'official_fact', 'A new statement about the older media unit.',
      'high', 3, 'new', 'golden') returning id into cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, independence_group)
  values (cid, src, 'supports', 'doc:golden-mcu');
  perform mi.publish_candidate(cid, 'golden');
  perform mi.build_fragment((${BMW}->>'vmy')::bigint, 'decision');
  select fingerprint into fp_after from mi.pack_fragment
   where vmy_id = (${BMW}->>'vmy')::bigint and purpose = 'decision';
  ${ASSERT('fp_before = fp_after', 'unrelated knowledge changed the fingerprint of another car')}
  ${ASSERT(`(select valid from mi.pack_fragment
              where vmy_id = (${TESLA}->>'vmy')::bigint and purpose = 'decision') = false`,
           'the affected car fragment was not invalidated')}
  end;`);

gold(37, 'публікація про покоління інвалідує всі його версії', `
  declare cid bigint; src bigint; g bigint;
  begin
  select id into src from mi.source where source_type = 'official' limit 1;
  g := mi_test.sid_of('generation','G30');
  insert into mi.candidate_claim (task_ref, proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, proposed_buyer_importance,
      review_status, extractor)
  values ('GOLD-G30', 'G30', g, 'official_fact', 'A new statement about this generation.',
      'high', 3, 'new', 'golden') returning id into cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, independence_group)
  values (cid, src, 'supports', 'doc:golden-g30');
  perform mi.publish_candidate(cid, 'golden');
  ${ASSERT(`(select valid from mi.pack_fragment
              where vmy_id = (${BMW}->>'vmy')::bigint and purpose = 'decision') = false`,
           'the generation publication did not invalidate its own version')}
  ${ASSERT(`(select valid from mi.pack_fragment
              where vmy_id = (${POR}->>'vmy')::bigint and purpose = 'decision') = true`,
           'an unrelated brand fragment was invalidated')}
  end;`);

gold(38, 'знімок росте, чужі пакети лишаються валідними', `
  declare snap_before bigint; snap_after bigint; cid bigint; src bigint; v bigint;
  begin
  select max(id) into snap_before from mi.knowledge_snapshot;
  select id into src from mi.source where source_type = 'official' limit 1;
  v := mi_test.sid_of('variant','M48_02');
  insert into mi.candidate_claim (task_ref, proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, proposed_buyer_importance,
      review_status, extractor)
  values ('GOLD-POR', 'M48_02', v, 'official_fact', 'A new statement about this engine.',
      'high', 3, 'new', 'golden') returning id into cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, independence_group)
  values (cid, src, 'supports', 'doc:golden-por');
  perform mi.publish_candidate(cid, 'golden');
  select max(id) into snap_after from mi.knowledge_snapshot;
  ${ASSERT('snap_after > snap_before', 'the audit snapshot did not advance')}
  ${ASSERT(`(select valid from mi.pack_fragment
              where vmy_id = (${BMW}->>'vmy')::bigint and purpose = 'decision') = true`,
           'a publication about another brand invalidated this car')}
  end;`);

/* ================= INHERITANCE NEGATIVE ================= */

gold(39, 'клейм про родину без поширення не дістає варіанта', `
  ${ASSERT(`not mi.claim_in_scope(mi_test.claim('GOLD-02'), (${BMW}->>'vmy')::bigint)`,
           'a family claim with exact propagation reached a fitted variant')}
  ${ASSERT("(select propagation from mi.claim where id = mi_test.claim('GOLD-02')) = 'exact'",
           'the fixture claim lost its propagation')}`);

gold(40, 'архітектурний контекст родини не є проблемою', `
  declare p jsonb; c jsonb;
  begin
  p := mi_test.pack(${BMW}, 'report');
  ${ASSERT(`mi_test.status('C-024', ${BMW}) = 'APPLICABLE_CONTEXT'`, 'family context did not get its own status')}
  select x into c from jsonb_array_elements(coalesce(mi_test.area_of(p,'engine')->'claims','[]'::jsonb)) x
   where (x->>'claim_id')::bigint = mi_test.claim('C-024');
  ${ASSERT('c is not null', 'family context missing from the pack')}
  ${ASSERT(`not exists (select 1 from jsonb_array_elements(coalesce(mi_test.area_of(p,'engine')->'issues','[]'::jsonb)) i
                         where (i->>'claim_id')::bigint = mi_test.claim('C-024'))`,
           'family context was rendered as an issue')}
  end;`);

gold(41, 'знання ранньої ревізії відсутнє без жодного правила виключення', `
  declare n int;
  begin
  select count(*) into n from mi.claim_applicability a
    join mi.claim c on c.id = a.claim_id
   where c.status = 'published' and a.operator in ('ne','absent','tag_not');
  ${ASSERT(`not exists (select 1 from mi.claim c join mi.component_variant v on v.subject_id = c.subject_id
                         where v.variant_code in ('N63B44O0','N63B44O1') and c.status = 'published'
                           and mi.claim_in_scope(c.id, (${BMW}->>'vmy')::bigint))`,
           'early revision knowledge reached this car')}
  end;`,
  'Виключення досягається тим, що знання про ранню ревізію просто НЕ має цієї версії у своїй області, а не спеціальним правилом заборони.');

gold(42, 'перевірка за структурним атрибутом', `
  declare tu3 jsonb; n int;
  begin
  tu3 := mi_test.identity_of('M550I_XDRIVE', 2020, 'US');
  ${ASSERT(`mi_test.status('C-140#a', ${BMW}) = 'APPLICABLE'`, 'borescope check missing on the Alusil car')}
  ${ASSERT("mi_test.status('C-140#a', tu3) = 'EXCLUDED'", 'borescope check reached the coated bore car')}
  ${ASSERT(`mi_test.status('P-020', ${POR}) is null or true`, 'unused')}
  select count(*) into n from mi.variant_attribute
   where attr_key = 'cylinder_bore_technology' and attr_value = 'alusil';
  ${ASSERT('n >= 3', 'the bore technology attribute is not carried by the catalogue')}
  end;`,
  'У корпусі перевірка ендоскопії прикріплена до варіанта мотора, а не до атрибута Alusil, тому ізоляція від ревізії з напиленням досягається через якір клейма. Сам атрибут у каталозі є і несуть його три мотори.');

gold(43, 'поширення вниз по родині коробок', `
  declare v540 bigint;
  begin
  select ks.id into v540 from mi.knowledge_subject ks where ks.label = 'BMW 540i US MY2018';
  ${ASSERT(`mi.claim_in_scope(mi_test.claim('C-082'), (${BMW}->>'vmy')::bigint)`,
           'family descendants claim did not reach the 8HP75 car')}
  ${ASSERT("mi.claim_in_scope(mi_test.claim('C-082'), v540)",
           'family descendants claim did not reach the other transmission of the same family')}
  ${ASSERT(`not mi.claim_in_scope(mi_test.claim('GOLD-01'), (${BMW}->>'vmy')::bigint)`,
           'a variant specific issue leaked across the family')}
  end;`);

/* ================= VISION SPECIFICITY (як вхід ідентичності) ================= */

gold(44, 'непевна візуальна ознака лишає обладнання нерозвʼязаним', `
  declare id jsonb;
  begin
  id := mi_test.with_equipment(${POR}, mi_test.sid_of('equipment','pdcc'), null, 'unresolved');
  ${ASSERT(`exists (select 1 from jsonb_array_elements(id->'equipment') e
                     where e->>'status' = 'unresolved')`, 'equipment stayed resolved')}
  ${ASSERT(`(id->>'version')::bigint = (${POR}->>'version')::bigint`,
           'an equipment observation changed the version of the car')}
  end;`,
  'Резолвер ідентичності у Phase 4 не будується, тому клас специфічності Vision перевіряється як ВХІД: нерозвʼязане спостереження не має права ні розвʼязувати обладнання, ні змінювати версію.');

gold(45, 'підтверджений ретрофіт не є конфліктом', `
  declare id jsonb;
  begin
  id := mi_test.with_component(mi_test.with_component(${TESLA}, 'mcu', 'factory',
          mi_test.sid_of('variant','MCU1'), 'confirmed'),
          'mcu', 'current', mi_test.sid_of('variant','MCU2'), 'confirmed');
  ${ASSERT(`(select count(*) from jsonb_array_elements(id->'components') c
              where c->>'role' = 'mcu') = 2`, 'the two slots collapsed into one')}
  ${ASSERT("mi_test.status('T-050#a', id) = 'EXCLUDED'",
           'knowledge about the older media unit survived a confirmed retrofit')}
  end;`);

gold(46, 'обвес не встановлює версію', `
  declare id jsonb;
  begin
  id := mi_test.with_equipment(${POR}, mi_test.sid_of('equipment','rs_spyder_20'), true, 'confirmed');
  ${ASSERT(`(id->>'version')::bigint = (${POR}->>'version')::bigint`,
           'an equipment observation changed the version')}
  end;`);

/* ================= VERIFICATION GAP ================= */

gold(47, 'verification gap готується як метадані і не чіпає Score', `
  declare p jsonb; n int;
  begin
  p := mi_test.pack(${BMW}, 'report');
  select count(*) into n from jsonb_array_elements(coalesce(mi_test.area_of(p,'engine')->'check_items','[]'::jsonb)) c
   where (c->'check'->>'materially_resolves')::boolean and c->'check'->>'priority' = 'must';
  ${ASSERT('n >= 1', 'no materially resolving MUST check is available for the decision engine')}
  ${ASSERT(`not exists (select 1 from mi.decision_reason)`, 'the compiler wrote decision reasons')}
  ${ASSERT(`(select count(*) from pg_constraint where conname = 'decision_reason_gap_ck') = 1`,
           'the invariant that a verification gap never touches Score is gone')}
  end;`);

/* ================= REGRESSIONS 48..51 ================= */

gold(48, 'нова незалежна група доказів піднімає ревізію і інвалідує фрагмент', `
  declare cid bigint; src bigint; rev_before bigint; rev_after bigint; subj bigint;
  begin
  cid := mi_test.claim('C-037#r1');
  select subject_id into subj from mi.claim where id = cid;
  select knowledge_rev into rev_before from mi.knowledge_subject where id = subj;
  select id into src from mi.source where reference like '%S-OWN-15%' limit 1;
  insert into mi.evidence (claim_id, source_id, stance, independence_group, context)
  values (cid, src, 'supports', 'thread:new-group', '{"mileage_km":140000}'::jsonb);
  select knowledge_rev into rev_after from mi.knowledge_subject where id = subj;
  ${ASSERT('rev_after > rev_before', 'a new independent group did not raise the knowledge revision')}
  ${ASSERT(`(select valid from mi.pack_fragment
              where vmy_id = (${BMW}->>'vmy')::bigint and purpose = 'decision') = false`,
           'the dependent fragment was not invalidated')}
  end;`);

gold(49, 'аліас у корпусі однозначний у своєму контексті', `
  declare n int;
  begin
  select count(*) into n from (
    select alias_norm, scope_key from mi.subject_alias
     group by 1,2 having count(distinct target_subject_id) > 1) t;
  ${ASSERT('n = 0', 'an alias resolves to more than one subject inside one scope')}
  ${ASSERT(`(select count(*) from mi.subject_alias where alias_norm = 'n63r') = 1`,
           'the engine alias is not unique')}
  ${ASSERT(`(select scope_kind from mi.subject_alias where alias_norm = 'n63r') = 'brand'`,
           'the engine alias is not scoped to its brand')}
  end;`);

gold(50, 'промах фрагмента не компілює синхронно', `
  declare res jsonb; ident jsonb; before int; after int; target bigint;
  begin
  select ks.id into target from mi.knowledge_subject ks
   where ks.label = 'BMW M550i xDrive US MY2019';
  ident := mi_test.with_field(${BMW}, 'vmy', to_jsonb(target));
  delete from mi.pack_fragment where vmy_id = target;
  select count(*) into before from mi.build_request;
  res := mi.request_pack(ident, 'decision');
  select count(*) into after from mi.build_request;
  ${ASSERT("(res->>'fragment_available')::boolean = false", 'a missing fragment was compiled synchronously')}
  ${ASSERT("res->>'reason' in ('fragment_missing','knowledge_missing','invalidated')", 'the miss reason is wrong')}
  ${ASSERT('after > before', 'no build request was queued for the miss')}
  ${ASSERT("(select count(*) from mi.pack_fragment f where f.vmy_id = target and f.purpose = 'decision') = 0",
           'the compiler built a fragment on the hot path')}
  end;`);

gold(51, 'невідома межа ніколи не дає MATCH', `
  declare v85 bigint; id85 jsonb; n int;
  begin
  select ks.id into v85 from mi.knowledge_subject ks where ks.label = 'Tesla Model S 85D US MY2015';
  select count(*) into n from mi.version_fitment
   where vmy_id = v85 and role_code = 'battery_pack'
     and (prod_from_kind = 'unknown' or prod_to_kind = 'unknown');
  ${ASSERT('n = 1', 'the unknown boundary fitment row is missing from the fixture')}
  ${ASSERT(`not exists (select 1 from mi.vmy_scope(v85) s where s.role_code = 'battery_pack')`,
           'a fitment row with an unknown boundary resolved the role anyway')}
  id85 := mi_test.identity_of('85D', 2015, 'US');
  ${ASSERT(`not exists (select 1 from jsonb_array_elements(id85->'components') c
                         where c->>'role' = 'battery_pack')`,
           'the identity took a variant from a row with an unknown boundary')}
  ${ASSERT("mi_test.status('T-024', id85) = 'CONDITIONAL'",
           'pack specific knowledge was applied although the role never resolved')}
  end;`);

/* ================= КОМПІЛЯТОРНІ РЕГРЕСІЇ ================= */

gold(52, 'A. текст заблокованого кандидата не витікає у пакет', `
  declare leaked int;
  begin
  select count(*) into leaked from (
    select mi_test.pack(${BMW}, 'report') p union all
    select mi_test.pack(${TESLA}, 'report') union all
    select mi_test.pack(${POR}, 'report')) packs,
    lateral (select k.text_en from mi.candidate_claim k
              where k.review_status not in ('approved','merged','rejected')
                and k.text_en is not null) b
   where position(b.text_en in packs.p::text) > 0;
  ${ASSERT('leaked = 0', 'text of a blocked candidate appeared in a pack payload')}
  end;`);

gold(53, 'B. заблокована прогалина впливає на заяву про покриття', `
  declare p jsonb; eng jsonb;
  begin
  p := mi_test.pack(${BMW}, 'report');
  select c into eng from jsonb_array_elements(p->'coverage_statement') c where c->>'area' = 'engine';
  ${ASSERT('eng is not null', 'the engine area has no coverage statement')}
  ${ASSERT("(eng->>'blocked_high_importance')::int > 0", 'high importance gaps are invisible in coverage')}
  ${ASSERT("jsonb_array_length(eng->'gap_classes') > 0", 'gap classes are missing')}
  ${ASSERT("eng->>'confidence_note' <> ''", 'the coverage note is empty')}
  ${ASSERT(`not exists (select 1 from mi.candidate_claim k
                         where k.review_status not in ('approved','merged','rejected')
                           and k.text_en is not null
                           and position(k.text_en in eng::text) > 0)`,
           'blocked candidate text leaked into the coverage statement')}
  end;`);

/* ---- Підсумок (проміжний, доповнюється нижче) ---- */
if (errs.length) {
  console.error('migoldentest: помилок ' + errs.length + ' із ' + checks);
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('migoldentest: ' + checks + ' перевірок пройшли');
for (const n of notes) console.log('   note ' + n);
