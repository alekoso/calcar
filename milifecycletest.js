/* Model Intelligence Phase 2: життєвий цикл знання на живій базі.

   Перевіряє: staging і публікацію, перевірки якості, атомарність,
   дедуплікацію і злиття, повторюваність доказів, ревізії знання,
   інвалідацію фрагментів, успадкування і межі прав.

   Кожна перевірка виконується у власній транзакції з відкатом, тому
   фікстура лишається незмінною і порядок перевірок не має значення.

   Запуск:
     MI_TEST_DB_URL=postgres://... node milifecycletest.js
     MI_PSQL=/шлях/до/psql (необовʼязково)

   До продакшн-бази тест не підключається ніколи. */

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

function why(e) {
  const out = String(e.stderr || e.message);
  const line = out.split('\n').find(l => /ERROR|FATAL/.test(l));
  return (line || out.split('\n')[0] || '').trim().slice(0, 240);
}

const exec = sql => run([], sql);
const scalar = sql => run(['-t', '-A'], sql).trim();

/* Перевірка: скрипт має пройти цілком. Твердження всередині скрипта
   падають через raise exception, тому psql повертає ненульовий код. */
function test(name, sql) {
  checks++;
  try { exec('begin;\n' + sql + '\nrollback;'); } catch (e) { errs.push(name + ': ' + why(e)); }
}

/* Перевірка: оператор МАЄ впасти. */
function rejects(name, sql) {
  checks++;
  try {
    exec('begin;\n' + sql + '\nrollback;');
    errs.push(name + ': оператор пройшов, хоча мав бути відхилений');
  } catch (e) { /* очікувано */ }
}

/* ---- Передумови ---- */

if (!DB) {
  console.error('milifecycletest: не задано MI_TEST_DB_URL, тест не запускався.');
  process.exit(2);
}
try { execFileSync(PSQL, ['--version'], { stdio: 'pipe' }); } catch {
  console.error('milifecycletest: psql недоступний.');
  process.exit(2);
}

try {
  run(['-f', path.join(FIX, '000_test_prelude.sql')], '');
  for (const m of UPS) run(['-f', path.join(DIR, m + '.up.sql')], '');
  run(['-f', path.join(FIX, '010_lifecycle_fixture.sql')], '');
} catch (e) {
  console.error('milifecycletest: не вдалося підготувати базу: ' + why(e));
  process.exit(1);
}

/* Спільні шматки сценаріїв. */
const SUBJ = "select subject_id into v_subj from mi.component_variant where variant_code = 'LC_VAR';";

const OWNER_PATTERN_SETUP = `
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, proposed_causal_status, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'owner_pattern',
      'Owners report the same behaviour after long ownership.', 'low', 'observed_association', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group, context)
  select v_cid, id, 'supports', 'owner a', 'thread:a1', '{"mileage_km":120000}'::jsonb
    from mi.source where title = 'LC owner A1';
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group, context)
  select v_cid, id, 'supports', 'owner b', 'thread:b1', '{"mileage_km":150000}'::jsonb
    from mi.source where title = 'LC owner B1';
  v_claim := mi.publish_candidate(v_cid, 'tester');`;

/* ---- 1. Кандидат стає опублікованим знанням ---- */

test('1. кандидат -> публікація', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value,
      proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact',
      'Bulletin LC-1 documents the coolant routing.', 'document_ref',
      '{"doc_id":"LC-1"}'::jsonb, 'high', 'new', 3)
  returning id into v_cid;

  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin excerpt', 'doc:LC-1'
    from mi.source where title = 'LC official bulletin';

  v_claim := mi.publish_candidate(v_cid, 'tester');

  if not exists (select 1 from mi.claim
                 where id = v_claim and status = 'published' and published_snapshot_id is not null) then
    raise exception 'claim is not published';
  end if;
  if (select count(*) from mi.evidence where claim_id = v_claim) <> 1 then
    raise exception 'evidence was not copied';
  end if;
  if not exists (select 1 from mi.candidate_claim
                 where id = v_cid and review_status = 'approved' and published_claim_id = v_claim) then
    raise exception 'candidate was not marked approved';
  end if;
  if not exists (select 1 from mi.publish_batch b
                 join mi.knowledge_snapshot s on s.id = b.snapshot_id
                 where v_subj = any (b.touched_subject_ids)) then
    raise exception 'publish batch did not record the touched subject';
  end if;
  if not exists (select 1 from mi.recurrence_summary where claim_id = v_claim) then
    raise exception 'recurrence was not computed';
  end if;
end $$;`);

/* ---- 2. Провалена перевірка не пише канонічних рядків ---- */

test('2. провалений gate -> жодного канонічного запису', `
do $$
declare v_cid bigint; v_subj bigint; v_gate jsonb; v_before bigint; v_after bigint;
begin
  ${SUBJ}
  select count(*) into v_before from mi.claim;
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'known_issue', 'A parts shop page claims frequent failures.', 'low', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'shop page', 'shop:1' from mi.source where title = 'LC parts shop';

  v_gate := mi.run_gate(v_cid);
  if (v_gate->>'passed')::boolean then raise exception 'gate must fail on vendor only evidence'; end if;
  if (select gate_result from mi.candidate_claim where id = v_cid) is null then
    raise exception 'gate result was not stored';
  end if;

  begin
    perform mi.publish_candidate(v_cid, 'tester');
    raise exception 'ASSERT publish must fail';
  exception when others then
    if sqlerrm like 'ASSERT%' then raise; end if;
  end;

  select count(*) into v_after from mi.claim;
  if v_after <> v_before then raise exception 'canonical claim written despite failed gate'; end if;
end $$;`);

/* ---- 3. Часткова невдача відкочує всю публікацію ---- */

test('3. помилка всередині публікації відкочує її повністю', `
do $$
declare v_cid bigint; v_subj bigint; v_claims bigint; v_ev bigint; v_snap bigint;
begin
  ${SUBJ}
  select count(*) into v_claims from mi.claim;
  select count(*) into v_ev from mi.evidence;
  select count(*) into v_snap from mi.knowledge_snapshot;

  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value,
      proposed_confidence, proposed_links, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-9 replaces an earlier note.',
      'document_ref', '{"doc_id":"LC-9"}'::jsonb, 'high',
      '{"supersedes": 999999999}'::jsonb, 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-9' from mi.source where title = 'LC official bulletin';

  begin
    perform mi.publish_candidate(v_cid, 'tester');
    raise exception 'ASSERT publish must fail on unknown superseded claim';
  exception when others then
    if sqlerrm like 'ASSERT%' then raise; end if;
  end;

  if (select count(*) from mi.claim) <> v_claims then raise exception 'claim leaked'; end if;
  if (select count(*) from mi.evidence) <> v_ev then raise exception 'evidence leaked'; end if;
  if (select count(*) from mi.knowledge_snapshot) <> v_snap then raise exception 'snapshot leaked'; end if;
end $$;`);

/* ---- 4. Пряме створення опублікованого клейма неможливе ---- */

rejects('4a. прямий INSERT опублікованого клейма відхилено', `
insert into mi.claim (subject_id, knowledge_type, text_en, normalized_assertion,
    confidence, buyer_importance, dedup_key, status)
select subject_id, 'official_fact', 'direct write', 'direct write', 'high', 3, 'direct-1', 'published'
from mi.component_variant where variant_code = 'LC_VAR';`);

test('4b. роль дослідження не має права писати канонічні клейми', `
do $$
begin
  if has_table_privilege('mi_ingest', 'mi.claim', 'INSERT') then
    raise exception 'mi_ingest must not hold INSERT on mi.claim';
  end if;
  if has_table_privilege('mi_ingest', 'mi.evidence', 'INSERT') then
    raise exception 'mi_ingest must not hold INSERT on mi.evidence';
  end if;
  if not has_table_privilege('mi_ingest', 'mi.candidate_claim', 'INSERT') then
    raise exception 'mi_ingest must be able to write staging';
  end if;
  if not has_function_privilege('mi_ingest', 'mi.publish_candidate(bigint, text, text)', 'EXECUTE') then
    raise exception 'mi_ingest must be able to call publish_candidate';
  end if;
end $$;`);

/* ---- 5. Знання опублікованого клейма не змінюється збоку ---- */

test('5. застосовність і докази опублікованого клейма захищені', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_gen bigint;
begin
  ${SUBJ}
  select subject_id into v_gen from mi.generation where platform_code = 'LCG';
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-2 lists the affected build window.',
      'document_ref', '{"doc_id":"LC-2"}'::jsonb, 'high', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-2' from mi.source where title = 'LC official bulletin';
  v_claim := mi.publish_candidate(v_cid, 'tester');

  begin
    insert into mi.claim_applicability (claim_id, dimension, operator, ref_subject_id)
    values (v_claim, 'generation', 'eq', v_gen);
    raise exception 'ASSERT applicability write must be rejected';
  exception when others then if sqlerrm like 'ASSERT%' then raise; end if; end;

  begin
    update mi.evidence set excerpt = 'rewritten' where claim_id = v_claim;
    raise exception 'ASSERT evidence update must be rejected';
  exception when others then if sqlerrm like 'ASSERT%' then raise; end if; end;

  begin
    delete from mi.evidence where claim_id = v_claim;
    raise exception 'ASSERT evidence delete must be rejected';
  exception when others then if sqlerrm like 'ASSERT%' then raise; end if; end;

  -- Дописування доказу дозволене: provenance лише накопичується.
  insert into mi.evidence (claim_id, source_id, stance, independence_group)
  select v_claim, id, 'supports', 'thread:extra' from mi.source where title = 'LC owner B1';
  if (select count(*) from mi.evidence where claim_id = v_claim) <> 2 then
    raise exception 'appending evidence must be allowed';
  end if;
end $$;`);

/* ---- 6. Дублікат зливається, а не подвоює знання ---- */

test('6. точний дублікат зливається у наявний клейм', `
do $$
declare v_c1 bigint; v_c2 bigint; v_claim1 bigint; v_claim2 bigint; v_subj bigint; v_key text;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-3 documents the same fact.',
      'document_ref', '{"doc_id":"LC-3"}'::jsonb, 'high', 'new', 3)
  returning id into v_c1;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_c1, id, 'supports', 'first', 'doc:LC-3' from mi.source where title = 'LC official bulletin';
  v_claim1 := mi.publish_candidate(v_c1, 'tester');

  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-3 documents the same fact.',
      'document_ref', '{"doc_id":"LC-3"}'::jsonb, 'high', 'new', 3)
  returning id into v_c2;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_c2, id, 'supports', 'second independent document', 'doc:LC-3-second'
    from mi.source where title = 'LC official bulletin 2';
  v_claim2 := mi.publish_candidate(v_c2, 'tester');

  if v_claim1 <> v_claim2 then raise exception 'duplicate produced a second claim'; end if;
  if not exists (select 1 from mi.candidate_claim
                 where id = v_c2 and review_status = 'merged' and merge_into_claim_id = v_claim1) then
    raise exception 'second candidate was not merged';
  end if;
  select dedup_key into v_key from mi.claim where id = v_claim1;
  if (select count(*) from mi.claim where dedup_key = v_key and status = 'published') <> 1 then
    raise exception 'more than one published claim shares the dedup key';
  end if;
  if (select count(*) from mi.evidence where claim_id = v_claim1) <> 2 then
    raise exception 'merged evidence was not carried over';
  end if;
end $$;`);

/* ---- 7. Повторюваність доказів ---- */

test('7. повторюваність рахується по незалежних групах', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_r record;
begin
  ${OWNER_PATTERN_SETUP}
  select * into v_r from mi.recurrence_summary where claim_id = v_claim;
  if v_r.independent_groups <> 2 then
    raise exception 'expected 2 independent groups, got %', v_r.independent_groups;
  end if;
  if v_r.recurrence_class <> 'anecdote' then
    raise exception 'two groups must stay anecdote, got %', v_r.recurrence_class;
  end if;
  if v_r.contradicting_groups <> 0 then raise exception 'unexpected contradictions'; end if;
  if v_r.specialist_support then raise exception 'no specialist support was provided'; end if;
  if (select evidence_summary->>'independent_groups' from mi.claim where id = v_claim) <> '2' then
    raise exception 'evidence summary does not match';
  end if;
end $$;`);

/* ---- 8. Зміна видимого у пакеті піднімає ревізію ---- */

test('8. нова незалежна група змінює клас і піднімає ревізію', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_rev bigint; v_rev2 bigint; v_hash text; v_hash2 text;
begin
  ${OWNER_PATTERN_SETUP}
  select knowledge_rev into v_rev from mi.knowledge_subject where id = v_subj;
  select pack_visible_hash into v_hash from mi.recurrence_summary where claim_id = v_claim;

  insert into mi.evidence (claim_id, source_id, stance, excerpt, independence_group, context)
  select v_claim, id, 'supports', 'owner c', 'thread:c1', '{"mileage_km":180000}'::jsonb
    from mi.source where title = 'LC owner C1';

  select knowledge_rev into v_rev2 from mi.knowledge_subject where id = v_subj;
  select pack_visible_hash into v_hash2 from mi.recurrence_summary where claim_id = v_claim;

  if (select recurrence_class from mi.recurrence_summary where claim_id = v_claim) <> 'repeated_pattern' then
    raise exception 'three independent groups must become repeated_pattern';
  end if;
  if v_hash2 = v_hash then raise exception 'pack visible hash did not change'; end if;
  if v_rev2 <> v_rev + 1 then raise exception 'knowledge_rev did not bump: % -> %', v_rev, v_rev2; end if;
end $$;`);

/* ---- 9. Доказ без зміни видимого ревізію не піднімає ---- */

test('9. доказ у наявній групі ревізію не піднімає', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_rev bigint; v_rev2 bigint; v_hash text; v_hash2 text;
begin
  ${OWNER_PATTERN_SETUP}
  select knowledge_rev into v_rev from mi.knowledge_subject where id = v_subj;
  select pack_visible_hash into v_hash from mi.recurrence_summary where claim_id = v_claim;

  -- Ще одне джерело тієї самої групи: кількість незалежних груп не росте.
  insert into mi.evidence (claim_id, source_id, stance, excerpt, independence_group, context)
  select v_claim, id, 'supports', 'same thread, another post', 'thread:a1', '{"mileage_km":121000}'::jsonb
    from mi.source where title = 'LC owner A2';

  select knowledge_rev into v_rev2 from mi.knowledge_subject where id = v_subj;
  select pack_visible_hash into v_hash2 from mi.recurrence_summary where claim_id = v_claim;

  if (select independent_groups from mi.recurrence_summary where claim_id = v_claim) <> 2 then
    raise exception 'independent group count must stay 2';
  end if;
  if v_hash2 <> v_hash then raise exception 'pack visible hash changed unexpectedly'; end if;
  if v_rev2 <> v_rev then raise exception 'knowledge_rev bumped without pack visible change'; end if;
end $$;`);

/* ---- 10. Публікація піднімає ревізію ---- */

test('10. публікація клейма піднімає ревізію subject', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_rev bigint; v_rev2 bigint;
begin
  ${SUBJ}
  select knowledge_rev into v_rev from mi.knowledge_subject where id = v_subj;
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-4 confirms the part number.',
      'document_ref', '{"doc_id":"LC-4"}'::jsonb, 'high', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-4' from mi.source where title = 'LC official bulletin';
  v_claim := mi.publish_candidate(v_cid, 'tester');
  select knowledge_rev into v_rev2 from mi.knowledge_subject where id = v_subj;
  if v_rev2 <= v_rev then raise exception 'publishing did not bump knowledge_rev'; end if;
end $$;`);

/* ---- 11. Успадкування ---- */

test('11. новий клейм успадковує старий, текст старого не переписується', `
do $$
declare v_c1 bigint; v_c2 bigint; v_old bigint; v_new bigint; v_subj bigint; v_text text;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Coolant service interval is four years.',
      'interval', '{"km":0,"months":48}'::jsonb, 'high', 'new', 3)
  returning id into v_c1;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_c1, id, 'supports', 'manual', 'doc:LC-5' from mi.source where title = 'LC official bulletin';
  v_old := mi.publish_candidate(v_c1, 'tester');
  select text_en into v_text from mi.claim where id = v_old;

  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence,
      proposed_links, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Coolant is now declared a lifetime fill.',
      'interval', '{"km":0,"months":0}'::jsonb, 'high',
      jsonb_build_object('supersedes', v_old), 'new', 3)
  returning id into v_c2;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_c2, id, 'supports', 'updated manual', 'doc:LC-6' from mi.source where title = 'LC official bulletin';
  v_new := mi.publish_candidate(v_c2, 'tester');

  if (select status from mi.claim where id = v_old) <> 'superseded' then
    raise exception 'old claim was not superseded';
  end if;
  if (select superseded_by_id from mi.claim where id = v_old) <> v_new then
    raise exception 'supersede link is missing';
  end if;
  if (select supersedes_id from mi.claim where id = v_new) <> v_old then
    raise exception 'new claim does not point at the old one';
  end if;
  if (select text_en from mi.claim where id = v_old) <> v_text then
    raise exception 'text of a published claim was rewritten';
  end if;
  if (select effective_to_kind from mi.claim where id = v_old) <> 'known' then
    raise exception 'superseded claim must carry a known end boundary';
  end if;
  if not exists (select 1 from mi.claim where id = v_old and published_snapshot_id is not null) then
    raise exception 'audit trail of the old claim was lost';
  end if;
end $$;`);

/* ---- 12. Зміна застосовності піднімає ревізію ---- */

test('12. предикат перевірки піднімає ревізію свого subject', `
do $$
declare v_chk bigint; v_subj bigint; v_rev bigint; v_rev2 bigint; v_fam bigint;
begin
  ${SUBJ}
  select subject_id into v_fam from mi.component_family where family_key = 'LC_FAM';
  insert into mi.knowledge_subject (kind, label) values ('check_item', 'LC check') returning id into v_chk;
  insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
      cannot_prove_en, default_priority, materially_resolves, resolves_dimension)
  values (v_chk, 'borescope', v_fam, 'why', 'state today', 'remaining life', 'must', true, 'component_variant');

  select knowledge_rev into v_rev from mi.knowledge_subject where id = v_chk;
  insert into mi.claim_applicability (owner_subject_id, dimension, operator, attr_key, attr_value)
  values (v_chk, 'variant_attribute', 'attr_eq', 'cylinder_bore_technology', 'alusil');
  select knowledge_rev into v_rev2 from mi.knowledge_subject where id = v_chk;

  if v_rev2 <> v_rev + 1 then raise exception 'applicability change did not bump the subject'; end if;
end $$;`);

/* ---- 13. Синтез без опор ---- */

test('13. синтез без опорних клеймів не проходить перевірку', `
do $$
declare v_cid bigint; v_subj bigint; v_gate jsonb; v_ok boolean;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, reviewer, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'calcar_synthesis',
      'The base is sound, the risk sits around it.', 'medium', 'tester', 'new', 3)
  returning id into v_cid;
  v_gate := mi.run_gate(v_cid);
  if (v_gate->>'passed')::boolean then raise exception 'synthesis without support must fail'; end if;
  select (r->>'ok')::boolean into v_ok
    from jsonb_array_elements(v_gate->'rules') r where r->>'code' = 'synthesis_support';
  if v_ok is null or v_ok then raise exception 'synthesis_support rule did not fire'; end if;
end $$;`);

/* ---- 14. Неоднозначний аліас ---- */

test('14. неоднозначний аліас блокує публікацію', `
do $$
declare v_cid bigint; v_subj bigint; v_gate jsonb; v_ok boolean;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC Dup Alias', v_subj, 'official_fact', 'Bulletin LC-7 mentions the ambiguous name.',
      'document_ref', '{"doc_id":"LC-7"}'::jsonb, 'high', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-7' from mi.source where title = 'LC official bulletin';

  v_gate := mi.run_gate(v_cid);
  select (r->>'ok')::boolean into v_ok
    from jsonb_array_elements(v_gate->'rules') r where r->>'code' = 'alias_unambiguous';
  if v_ok is null or v_ok then raise exception 'alias ambiguity was not detected'; end if;

  begin
    perform mi.publish_candidate(v_cid, 'tester');
    raise exception 'ASSERT publish must be blocked by ambiguity';
  exception when others then if sqlerrm like 'ASSERT%' then raise; end if; end;
end $$;`);

/* ---- 15. Тільки постачальник послуг ---- */

test('15. відома проблема лише з вендорського джерела не публікується', `
do $$
declare v_cid bigint; v_subj bigint; v_gate jsonb; v_vendor boolean; v_issue boolean;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'known_issue', 'The shop calls this a primary failure point.', 'low', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'shop page', 'shop:2' from mi.source where title = 'LC parts shop';

  v_gate := mi.run_gate(v_cid);
  select (r->>'ok')::boolean into v_vendor
    from jsonb_array_elements(v_gate->'rules') r where r->>'code' = 'vendor_not_alone';
  select (r->>'ok')::boolean into v_issue
    from jsonb_array_elements(v_gate->'rules') r where r->>'code' = 'known_issue_evidence';
  if v_vendor is null or v_vendor then raise exception 'vendor_not_alone rule did not fire'; end if;
  if v_issue is null or v_issue then raise exception 'known_issue_evidence rule did not fire'; end if;
end $$;`);

/* ---- 16 і 17. Фрагменти і черга побудови ---- */

test('16. залежний фрагмент стає недійсним', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_vmy bigint; v_frag bigint;
begin
  ${SUBJ}
  select subject_id into v_vmy from mi.version_market_year where model_year = 2018;
  insert into mi.pack_fragment (vmy_id, purpose, compiler_version, fingerprint, payload)
  values (v_vmy, 'decision', 'test-1', 'fp-1', '{}'::jsonb) returning id into v_frag;
  insert into mi.fragment_dependency (fragment_id, subject_id, knowledge_rev)
  select v_frag, id, knowledge_rev from mi.knowledge_subject where id = v_subj;

  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-8 changes the described behaviour.',
      'document_ref', '{"doc_id":"LC-8"}'::jsonb, 'high', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-8' from mi.source where title = 'LC official bulletin';
  v_claim := mi.publish_candidate(v_cid, 'tester');

  if (select valid from mi.pack_fragment where id = v_frag) then
    raise exception 'dependent fragment stayed valid after a knowledge change';
  end if;
end $$;`);

test('17. запит на перебудову створюється і дедуплікується', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_vmy bigint; v_frag bigint; v_frag2 bigint;
        v_cnt bigint; v_req bigint;
begin
  ${SUBJ}
  select subject_id into v_vmy from mi.version_market_year where model_year = 2018;
  insert into mi.pack_fragment (vmy_id, purpose, compiler_version, fingerprint, payload)
  values (v_vmy, 'decision', 'test-2', 'fp-2', '{}'::jsonb) returning id into v_frag;
  insert into mi.fragment_dependency (fragment_id, subject_id, knowledge_rev)
  select v_frag, id, knowledge_rev from mi.knowledge_subject where id = v_subj;

  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-10 adds a first change.',
      'document_ref', '{"doc_id":"LC-10"}'::jsonb, 'high', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-10' from mi.source where title = 'LC official bulletin';
  perform mi.publish_candidate(v_cid, 'tester');

  select count(*), max(requested_count) into v_cnt, v_req
    from mi.build_request where vmy_id = v_vmy and purpose = 'decision' and reason = 'invalidated';
  if v_cnt <> 1 then raise exception 'expected exactly one build request, got %', v_cnt; end if;

  -- Другий фрагмент і друга зміна: запит не дублюється, а рахується.
  insert into mi.pack_fragment (vmy_id, purpose, compiler_version, fingerprint, payload)
  values (v_vmy, 'decision', 'test-3', 'fp-3', '{}'::jsonb) returning id into v_frag2;
  insert into mi.fragment_dependency (fragment_id, subject_id, knowledge_rev)
  select v_frag2, id, knowledge_rev from mi.knowledge_subject where id = v_subj;

  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-11 adds a second change.',
      'document_ref', '{"doc_id":"LC-11"}'::jsonb, 'high', 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-11' from mi.source where title = 'LC official bulletin';
  perform mi.publish_candidate(v_cid, 'tester');

  select count(*), max(requested_count) into v_cnt, v_req
    from mi.build_request where vmy_id = v_vmy and purpose = 'decision' and reason = 'invalidated';
  if v_cnt <> 1 then raise exception 'build request was duplicated'; end if;
  if v_req < 2 then raise exception 'repeated invalidation was not counted, got %', v_req; end if;
end $$;`);

/* ---- 18. Після відкату не лишається сиріт ---- */

test('18. відкат не лишає осиротілих доказів і звʼязків', `
do $$
declare v_claims bigint; v_ev bigint; v_links bigint; v_sup bigint; v_app bigint;
        v_cid bigint; v_subj bigint;
begin
  ${SUBJ}
  select count(*) into v_claims from mi.claim;
  select count(*) into v_ev from mi.evidence;
  select count(*) into v_links from mi.claim_link;
  select count(*) into v_sup from mi.claim_support;
  select count(*) into v_app from mi.claim_applicability;

  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value, proposed_confidence,
      proposed_applicability, proposed_links, review_status, proposed_buyer_importance)
  values ('LC_VAR', v_subj, 'official_fact', 'Bulletin LC-12 will fail late in publishing.',
      'document_ref', '{"doc_id":"LC-12"}'::jsonb, 'high',
      jsonb_build_array(jsonb_build_object('dimension', 'market_operated', 'operator', 'eq', 'tag', 'US')),
      '{"supersedes": 999999998}'::jsonb, 'new', 3)
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin', 'doc:LC-12' from mi.source where title = 'LC official bulletin';

  begin
    perform mi.publish_candidate(v_cid, 'tester');
    raise exception 'ASSERT publish must fail';
  exception when others then if sqlerrm like 'ASSERT%' then raise; end if; end;

  if (select count(*) from mi.claim) <> v_claims then raise exception 'claim leaked'; end if;
  if (select count(*) from mi.evidence) <> v_ev then raise exception 'evidence leaked'; end if;
  if (select count(*) from mi.claim_link) <> v_links then raise exception 'link leaked'; end if;
  if (select count(*) from mi.claim_support) <> v_sup then raise exception 'support leaked'; end if;
  if (select count(*) from mi.claim_applicability) <> v_app then raise exception 'applicability leaked'; end if;
  if exists (select 1 from mi.evidence e left join mi.claim c on c.id = e.claim_id where c.id is null) then
    raise exception 'orphan evidence found';
  end if;
end $$;`);

/* ---- 21..29. Phase 3.2: buyer-метадані переживають публікацію ---- */

/* Спільний каркас: офіційний факт із явною важливістю і buyer-текстом. */
const BUYER = (imp, impl, contested, note, extra) => `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint; v_imp smallint; v_impl text;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value,
      proposed_confidence, proposed_buyer_importance, proposed_buyer_implication_en,
      proposed_contested, proposed_contested_note_en, review_status)
  values ('LC_VAR', v_subj, 'official_fact',
      'Bulletin LC-9 documents the coolant routing.', 'document_ref',
      '{"doc_id":"LC-9"}'::jsonb, 'high', ${imp}, ${impl}, ${contested}, ${note}, 'new')
  returning id into v_cid;

  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin excerpt', 'doc:LC-9'
    from mi.source where title = 'LC official bulletin';

  v_claim := mi.publish_candidate(v_cid, 'tester');
  select buyer_importance, buyer_implication_en into v_imp, v_impl
    from mi.claim where id = v_claim;
  ${extra}
end $$;`;

test('21. важливість 5 доходить до клейма', BUYER(5, "'top signal'", 'false', 'null', `
  if v_imp <> 5 then raise exception 'importance became %', v_imp; end if;`));

test('22. важливість 1 доходить до клейма', BUYER(1, "'minor detail'", 'false', 'null', `
  if v_imp <> 1 then raise exception 'importance became %', v_imp; end if;`));

test('23. важливість не підмінюється замовчуванням 3', BUYER(4, "'matters for price'", 'false', 'null', `
  if v_imp = 3 then raise exception 'importance silently defaulted to 3'; end if;
  if v_imp <> 4 then raise exception 'importance became %', v_imp; end if;`));

test('24. buyer-текст доходить дослівно',
  BUYER(2, "'Do not pay for the look: the identification number decides.'", 'false', 'null', `
  if v_impl is distinct from 'Do not pay for the look: the identification number decides.' then
    raise exception 'buyer implication changed to %', v_impl;
  end if;`));

rejects('25. суперечливе знання без пояснення не публікується',
  BUYER(3, "'context'", 'true', 'null', ''));

test('26. суперечливе знання з поясненням публікується',
  BUYER(3, "'context'", 'true', "'Two owner groups read the same data differently.'", `
  if not exists (select 1 from mi.claim where id = v_claim and contested
                   and contested_note_en = 'Two owner groups read the same data differently.') then
    raise exception 'contested flag or note did not survive';
  end if;`));

test('27. несуперечливе знання пояснення не вимагає',
  BUYER(3, "'context'", 'false', 'null', `
  if exists (select 1 from mi.claim where id = v_claim and contested) then
    raise exception 'claim became contested on its own';
  end if;`));

rejects('28. кандидат без важливості не публікується', `
do $$
declare v_cid bigint; v_claim bigint; v_subj bigint;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, value_kind, structured_value,
      proposed_confidence, review_status)
  values ('LC_VAR', v_subj, 'official_fact',
      'Bulletin LC-10 documents the coolant routing.', 'document_ref',
      '{"doc_id":"LC-10"}'::jsonb, 'high', 'new')
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, independence_group)
  select v_cid, id, 'supports', 'bulletin excerpt', 'doc:LC-10'
    from mi.source where title = 'LC official bulletin';
  v_claim := mi.publish_candidate(v_cid, 'tester');
end $$;`);

rejects('29. важливість поза межами 1..5 не потрапляє у staging', `
do $$
declare v_subj bigint;
begin
  ${SUBJ}
  insert into mi.candidate_claim (proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_buyer_importance, review_status)
  values ('LC_VAR', v_subj, 'official_fact', 'Out of range importance.', 6, 'new');
end $$;`);

/* ---- Прибирання ---- */

try {
  for (const m of [...UPS].reverse()) run(['-f', path.join(DIR, m + '.down.sql')], '');
  const left = scalar("select count(*) from information_schema.schemata where schema_name in ('mi','mi_vm');");
  checks++;
  if (left !== '0') errs.push('фінальний відкат: схеми лишились');
} catch (e) {
  checks++;
  errs.push('фінальний відкат: ' + why(e));
}

if (errs.length) {
  console.error('milifecycletest: помилок ' + errs.length + ' із ' + checks + ' перевірок');
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('milifecycletest: усі ' + checks + ' перевірок пройшли');
