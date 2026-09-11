-- Відкат міграції 13.
--
-- Міграція 13 нічого не створювала у схемі: вона лише замінила пʼять
-- функцій і додала три нові. Відкат повертає пʼять замінених до версії
-- міграції 12 дослівно і прибирає три нові.
--
-- Після відкату канонічні перевірки знову потрапляють у пакет лише через
-- окремий клейм про себе, а обладнання знову класифікується як
-- «equipment» незалежно від реалізуючого варіанта.

create or replace function mi.subject_area(p_subject_id bigint)
returns text language plpgsql stable as $$
declare
  k mi.subject_kind; anchor bigint; kindcode text; area text;
begin
  select kind into k from mi.knowledge_subject where id = p_subject_id;
  if k is null then return 'other'; end if;

  -- Сутності знання вказують на те, про що вони: беремо їхній якір.
  if k = 'issue' then
    select about_subject_id into anchor from mi.issue where subject_id = p_subject_id;
  elsif k = 'maintenance_item' then
    select about_subject_id into anchor from mi.maintenance_item where subject_id = p_subject_id;
  elsif k = 'check_item' then
    select scope_subject_id into anchor from mi.check_item where subject_id = p_subject_id;
  elsif k = 'component_state_type' then
    select applies_to_subject_id into anchor from mi.component_state_type where subject_id = p_subject_id;
  end if;

  if anchor is not null and anchor <> p_subject_id then
    return mi.subject_area(anchor);
  end if;

  if k = 'component_variant' then
    select f.family_kind_code into kindcode
      from mi.component_variant v join mi.component_family f on f.subject_id = v.family_id
     where v.subject_id = p_subject_id;
  elsif k = 'component_family' then
    select family_kind_code into kindcode from mi.component_family where subject_id = p_subject_id;
  elsif k = 'entitlement' then
    return 'entitlement';
  elsif k = 'equipment_item' then
    return 'equipment';
  elsif k in ('brand', 'model_line', 'generation', 'vehicle_version', 'version_market_year') then
    return 'vehicle';
  end if;

  area := case kindcode
    when 'engine'            then 'engine'
    when 'transmission'      then 'transmission'
    when 'transfer_case'     then 'drivetrain'
    when 'differential'      then 'drivetrain'
    when 'drive_unit'        then 'drivetrain'
    when 'battery_pack'      then 'battery'
    when 'charger'           then 'charging'
    when 'modem'             then 'electronics'
    when 'infotainment'      then 'electronics'
    when 'adas_hw'           then 'driver_assistance'
    when 'electrical'        then 'electronics'
    when 'suspension_system' then 'chassis'
    when 'brake_system'      then 'chassis'
    when 'body_module'       then 'body'
    when 'hvac'              then 'body'
    else null end;

  return coalesce(area, 'other');
end $$;

create or replace function mi.claim_anchor_variant(p_claim_id bigint)
returns bigint language plpgsql stable as $$
declare sid bigint; k mi.subject_kind; anchor bigint;
begin
  select subject_id into sid from mi.claim where id = p_claim_id;
  if sid is null then return null; end if;
  select kind into k from mi.knowledge_subject where id = sid;
  if k = 'component_variant' then return sid; end if;

  if k = 'issue' then
    select about_subject_id into anchor from mi.issue where subject_id = sid;
  elsif k = 'maintenance_item' then
    select about_subject_id into anchor from mi.maintenance_item where subject_id = sid;
  elsif k = 'check_item' then
    select scope_subject_id into anchor from mi.check_item where subject_id = sid;
  elsif k = 'component_state_type' then
    select applies_to_subject_id into anchor from mi.component_state_type where subject_id = sid;
  end if;

  if anchor is null then return null; end if;
  if (select kind from mi.knowledge_subject where id = anchor) = 'component_variant' then
    return anchor;
  end if;
  return null;
end $$;

create or replace function mi.pack_bucket(p_area text, p_kind text)
returns jsonb language plpgsql stable as $$
declare res jsonb; cond text;
begin
  -- Ключі, яких у клейма немає, присутні у payload зі значенням JSON null,
  -- тому перевіряється саме тип, а не SQL NULL.
  cond := case p_kind
    when 'issue'       then $c$jsonb_typeof(p.entry->'issue') = 'object'$c$
    when 'check'       then $c$jsonb_typeof(p.entry->'check') = 'object'$c$
    when 'maintenance' then $c$jsonb_typeof(p.entry->'maintenance') = 'object'$c$
    when 'state'       then $c$jsonb_typeof(p.entry->'state') = 'object'$c$
    when 'entitlement' then $c$jsonb_typeof(p.entry->'entitlement') = 'object'$c$
    when 'comparison'  then $c$p.entry->>'subject_kind' = 'vehicle_version'$c$
    else $c$jsonb_typeof(p.entry->'issue') is distinct from 'object'
          and jsonb_typeof(p.entry->'check') is distinct from 'object'
          and jsonb_typeof(p.entry->'maintenance') is distinct from 'object'
          and jsonb_typeof(p.entry->'state') is distinct from 'object'
          and jsonb_typeof(p.entry->'entitlement') is distinct from 'object'
          and p.entry->>'subject_kind' is distinct from 'vehicle_version'$c$ end;

  execute format($q$
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'claim_id', p.claim_id,
             'text', p.entry->>'text_en',
             'knowledge_type', p.entry->>'knowledge_type',
             'confidence', p.entry->>'confidence',
             'buyer_importance', (p.entry->>'buyer_importance')::int,
             'buyer_implication', p.entry->>'buyer_implication_en',
             'status', p.status,
             'basis', p.basis,
             'condition_text', case when p.status = 'CONDITIONAL'
                                    then mi.condition_text(e.preds) else null end,
             'layer', p.entry->>'layer',
             'recurrence', p.entry->>'recurrence_class',
             'value', p.entry->'structured_value',
             'contested', case when (p.entry->>'contested')::boolean then
                            jsonb_build_object('is_contested', true,
                              'note', p.entry->>'contested_note_en') else null end,
             'supports', p.entry->'supports',
             'issue', p.entry->'issue',
             'check', p.entry->'check',
             'maintenance', p.entry->'maintenance',
             'state', p.entry->'state',
             'entitlement', p.entry->'entitlement'
           )) order by p.rank_key), '[]'::jsonb)
      from tmp_pick p join tmp_eval e on e.claim_id = p.claim_id
     where (%s) and (%L is null or p.area = %L)
  $q$, cond, p_area, p_area) into res;
  return res;
end $$;

create or replace function mi.build_fragment(
  p_vmy_id bigint, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns bigint language plpgsql as $$
declare
  v_frag bigint; v_deps jsonb; v_fp text; v_payload jsonb; v_snap bigint;
begin
  if not exists (select 1 from mi.version_market_year where subject_id = p_vmy_id) then
    raise exception 'unknown version_market_year %', p_vmy_id;
  end if;

  create temporary table if not exists tmp_scope (
    subject_id bigint, relation text, role_code text) on commit drop;
  delete from tmp_scope;
  insert into tmp_scope select * from mi.vmy_scope(p_vmy_id);

  create temporary table if not exists tmp_claims (claim_id bigint) on commit drop;
  delete from tmp_claims;
  insert into tmp_claims
  select c.id from mi.claim c
   where c.status = 'published'
     and c.subject_id in (select subject_id from tmp_scope)
     and mi.claim_in_scope(c.id, p_vmy_id);

  -- Залежності: усі subjects замикання плюс subjects узятих клеймів.
  -- Виключені клейми теж лишаються залежністю: зміна предиката здатна
  -- повернути їх назад, і фрагмент має про це дізнатись.
  select jsonb_agg(jsonb_build_object('subject_id', s.id, 'knowledge_rev', s.knowledge_rev)
                   order by s.id)
    into v_deps
    from mi.knowledge_subject s
   where s.id in (select subject_id from tmp_scope)
      or s.id in (select c.subject_id from mi.claim c join tmp_claims t on t.claim_id = c.id);

  v_fp := mi.fragment_fingerprint(coalesce(v_deps, '[]'::jsonb));
  select max(id) into v_snap from mi.knowledge_snapshot;

  -- Статичний зміст фрагмента: усе, що не залежить від конкретної машини.
  select jsonb_build_object(
    'vmy_id', p_vmy_id,
    'built_for_purpose', p_purpose,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
               'claim_id', c.id,
               'subject_id', c.subject_id,
               'subject_kind', ks.kind,
               'area', mi.subject_area(c.subject_id),
               'knowledge_type', c.knowledge_type,
               'confidence', c.confidence,
               'buyer_importance', c.buyer_importance,
               'buyer_implication_en', c.buyer_implication_en,
               'text_en', c.text_en,
               'layer', c.layer,
               'value_kind', c.value_kind,
               'structured_value', c.structured_value,
               'contested', c.contested,
               'contested_note_en', c.contested_note_en,
               'propagation', c.propagation,
               'recurrence_class', rs.recurrence_class,
               'evidence_summary', c.evidence_summary,
               'supports', (select jsonb_agg(cs.supporting_claim_id order by cs.supporting_claim_id)
                              from mi.claim_support cs where cs.synthesis_claim_id = c.id),
               'issue', (select jsonb_build_object('issue_key', i.issue_key, 'name_en', i.name_en,
                                  'severity', i.severity, 'sensitivity', i.sensitivity,
                                  'mechanism_en', i.mechanism_en)
                           from mi.issue i where i.subject_id = c.subject_id),
               'check', (select jsonb_build_object('method', ci.test_method_code,
                                  'why_en', ci.why_en, 'proves_en', ci.proves_en,
                                  'cannot_prove_en', ci.cannot_prove_en,
                                  'priority', ci.default_priority,
                                  'materially_resolves', ci.materially_resolves,
                                  'resolves_dimension', ci.resolves_dimension)
                           from mi.check_item ci where ci.subject_id = c.subject_id),
               'maintenance', (select jsonb_build_object('service_kind', mm.service_kind_code,
                                  'fluid_spec', mm.fluid_spec_code, 'capacity_note_en', mm.capacity_note_en)
                           from mi.maintenance_item mm where mm.subject_id = c.subject_id),
               'state', (select jsonb_build_object('state_key', st.state_key, 'state_kind', st.state_kind,
                                  'sanctioned_by_oem', st.sanctioned_by_oem)
                           from mi.component_state_type st where st.subject_id = c.subject_id),
               'entitlement', (select jsonb_build_object('entitlement_key', en.entitlement_key,
                                  'name_en', en.name_en, 'binding', en.binding,
                                  'revocable', en.revocable, 'revoke_reasons', en.revoke_reasons)
                           from mi.entitlement en where en.subject_id = c.subject_id)
             ) order by c.id)
        from mi.claim c
        join tmp_claims t on t.claim_id = c.id
        join mi.knowledge_subject ks on ks.id = c.subject_id
        left join mi.recurrence_summary rs on rs.claim_id = c.id
    ), '[]'::jsonb),
    -- Агрегована метадані про прогалини. ТІЛЬКИ лічильники і класи
    -- причин: текст заблокованого кандидата сюди не потрапляє ніколи.
    'gaps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'area', area,
               'blocked_high_importance', hi,
               'blocked_total', tot,
               'gap_classes', classes) order by area)
        from (
          select area,
                 count(distinct cand) as tot,
                 count(distinct cand) filter (where imp >= 4) as hi,
                 jsonb_agg(distinct gap_class) as classes
            from (
              select mi.subject_area(k.resolved_subject_id) as area,
                     k.id as cand,
                     coalesce(k.proposed_buyer_importance, 0) as imp,
                     case r->>'code'
                       when 'owner_pattern_groups' then 'insufficient_owner_independence'
                       when 'owner_pattern_context' then 'insufficient_owner_independence'
                       when 'owner_practice_recurrence' then 'insufficient_owner_independence'
                       when 'specialist_source' then 'missing_specialist'
                       when 'official_source' then 'missing_official'
                       when 'known_issue_evidence' then 'missing_official'
                       when 'vendor_not_alone' then 'vendor_only_evidence'
                       when 'synthesis_support' then 'missing_supporting_claims'
                       else 'other' end as gap_class
                from mi.candidate_claim k,
                     lateral jsonb_array_elements(k.gate_result->'rules') r
               where k.review_status not in ('approved', 'merged', 'rejected')
                 and k.resolved_subject_id in (select subject_id from tmp_scope)
                 and k.gate_result is not null
                 and (r->>'ok')::boolean is false
            ) x group by area
        ) y
    ), '[]'::jsonb)
  ) into v_payload;

  insert into mi.pack_fragment (vmy_id, purpose, locale, budget_profile, compiler_version,
                                fingerprint, payload, payload_bytes, snapshot_id, valid, built_at)
  values (p_vmy_id, p_purpose, p_locale, p_budget, mi.compiler_version(),
          v_fp, v_payload, octet_length(v_payload::text), v_snap, true, now())
  on conflict on constraint pack_fragment_key do update
    set fingerprint = excluded.fingerprint, payload = excluded.payload,
        payload_bytes = excluded.payload_bytes, snapshot_id = excluded.snapshot_id,
        valid = true, built_at = now()
  returning id into v_frag;

  delete from mi.fragment_dependency where fragment_id = v_frag;
  insert into mi.fragment_dependency (fragment_id, subject_id, knowledge_rev)
  select v_frag, (e->>'subject_id')::bigint, (e->>'knowledge_rev')::bigint
    from jsonb_array_elements(coalesce(v_deps, '[]'::jsonb)) e;

  update mi.build_request set status = 'done', finished_at = now()
   where vmy_id = p_vmy_id and purpose = p_purpose and status in ('queued', 'running');

  return v_frag;
end $$;

create or replace function mi.compile_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare
  v_vmy bigint; frag mi.pack_fragment%rowtype; cfg jsonb;
  v_log jsonb := '[]'::jsonb; v_pack jsonb;
  n_total int; n_kept int; n_elig int; n_cap int; n_status_out int;
begin
  v_vmy := (p_identity->>'vmy')::bigint;
  cfg := mi.purpose_budget(p_purpose);

  select * into frag from mi.pack_fragment
   where vmy_id = v_vmy and purpose = p_purpose and locale = p_locale
     and budget_profile = p_budget and compiler_version = mi.compiler_version();

  if not found or not frag.valid then
    return jsonb_build_object('fragment_available', false,
      'reason', case when not found then 'fragment_missing' else 'invalidated' end);
  end if;

  -- 8.1. Оцінка кожного клейма фрагмента.
  create temporary table if not exists tmp_eval (
    claim_id bigint, status text, basis text, area text, importance smallint,
    knowledge_type text, severity text, priority text, entry jsonb, preds jsonb
  ) on commit drop;
  delete from tmp_eval;

  insert into tmp_eval
  select (e->>'claim_id')::bigint,
         ev->>'status', ev->>'basis', e->>'area',
         (e->>'buyer_importance')::smallint,
         e->>'knowledge_type',
         e->'issue'->>'severity',
         e->'check'->>'priority',
         e,
         ev->'predicates'
    from jsonb_array_elements(frag.payload->'claims') e,
         lateral mi.eval_claim((e->>'claim_id')::bigint, p_identity) ev;

  select count(*) into n_total from tmp_eval;

  v_log := coalesce((select jsonb_agg(jsonb_build_object(
                       'claim_id', claim_id, 'status', status, 'basis', basis,
                       'predicates', preds) order by claim_id) from tmp_eval), '[]'::jsonb);

  -- 8.2. Що взагалі має право потрапити у пакет.
  -- Виключене знання не потрапляє ніколи. Умовне знання потрапляє лише
  -- тоді, коли воно справді здатне змінити рішення І невизначеність
  -- знімається конкретною перевіркою, або коли сама ідентичність
  -- суперечлива.
  create temporary table if not exists tmp_pick (
    claim_id bigint, tier int, rank_key text, area text, entry jsonb,
    status text, basis text
  ) on commit drop;
  delete from tmp_pick;

  insert into tmp_pick
  select t.claim_id,
         case
           when t.importance = 5 then 1
           when t.severity in ('catastrophic', 'major') and t.status = 'APPLICABLE' then 1
           when t.priority = 'must' and t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED') then 1
           when t.importance = 4 then 2
           when t.importance = 3 then 3
           else 4 end,
         -- Ключ сортування детермінований і не залежить від LLM.
         lpad((10 - coalesce(t.importance, 0))::text, 2, '0') || '|' ||
         case t.status when 'APPLICABLE' then '1' when 'APPLICABLE_ASSUMED' then '2'
                       when 'APPLICABLE_CONTEXT' then '3' else '4' end || '|' ||
         case coalesce(t.severity, 'zz') when 'catastrophic' then '1' when 'major' then '2'
                       when 'moderate' then '3' when 'minor' then '4' else '9' end || '|' ||
         lpad(t.claim_id::text, 12, '0'),
         t.area, t.entry, t.status, t.basis
    from tmp_eval t
   where t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
      or (t.status = 'CONDITIONAL'
          and t.importance >= (cfg->>'conditional_min_importance')::int
          and (
            t.basis = 'conflicted'
            or exists (
              select 1 from tmp_eval c
               where c.entry->'check'->>'materially_resolves' = 'true'
                 and c.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'CONDITIONAL')
                 and (
                   exists (select 1 from jsonb_array_elements(t.preds) pr
                            where pr->>'result' = 'UNKNOWN'
                              and pr->>'dimension' = c.entry->'check'->>'resolves_dimension')
                   or (c.entry->'check'->>'resolves_dimension' is null and c.area = t.area)
                 ))
          ));

  select count(*) into n_elig from tmp_pick;
  select count(*) into n_status_out from tmp_eval
   where status in ('EXCLUDED', 'EXCLUDED_ASSUMED');

  -- 8.3. Стеля умовного знання на область: список проблем усіх можливих
  -- ревізій користувачу не показується.
  delete from tmp_pick p
   where p.status = 'CONDITIONAL'
     and (select count(*) from tmp_pick q
           where q.area = p.area and q.status = 'CONDITIONAL' and q.rank_key < p.rank_key)
         >= (cfg->>'conditional_per_area')::int;

  select count(*) into n_cap from tmp_pick;

  -- 8.4. Бюджет. Обрізання детерміноване: за рангом, а не випадково.
  delete from tmp_pick p
   where (select count(*) from tmp_pick q where q.rank_key < p.rank_key)
         >= (cfg->>'max_claims')::int;

  select count(*) into n_kept from tmp_pick;

  -- 8.5. Складання пакета.
  select jsonb_build_object(
    'fragment_available', true,
    'pack_meta', jsonb_build_object(
      'compiler_version', mi.compiler_version(),
      'purpose', p_purpose, 'locale', p_locale, 'budget_profile', p_budget,
      'fragment_id', frag.id, 'fragment_fingerprint', frag.fingerprint,
      'snapshot_id', frag.snapshot_id,
      'evaluated_count', n_total,
      'included_count', n_kept,
      -- Три різні причини не потрапити у пакет рахуються окремо, бо
      -- означають різне: знання не про цю машину, знання надто умовне
      -- для цього призначення, знання не вмістилось у бюджет.
      'excluded_by_status', n_status_out,
      'filtered_by_policy', n_total - n_status_out - n_cap,
      'truncated_count', n_cap - n_kept,
      'counts', (select jsonb_object_agg(status, n)
                   from (select status, count(*) n from tmp_eval group by status) s)),
    'identity_summary', mi.identity_summary(p_identity),
    'coverage_statement', mi.coverage_statement(frag.id, p_identity),
    'systems', coalesce((
      select jsonb_agg(sys order by sys->>'area') from (
        select jsonb_build_object(
          'area', area,
          'issues', mi.pack_bucket(area, 'issue'),
          'claims', mi.pack_bucket(area, 'claim'),
          'maintenance', mi.pack_bucket(area, 'maintenance'),
          'check_items', mi.pack_bucket(area, 'check'),
          'states', mi.pack_bucket(area, 'state')) as sys
          from (select distinct area from tmp_pick) a
      ) z), '[]'::jsonb),
    'entitlements', mi.pack_bucket(null, 'entitlement'),
    'comparisons', mi.pack_bucket(null, 'comparison')
  ) into v_pack;

  return jsonb_build_object('pack', v_pack, 'applicability_log', v_log);
end $$;

drop function if exists mi.eval_check(bigint, jsonb);
drop function if exists mi.check_importance(bigint);
drop function if exists mi.subject_anchor_variant(bigint);
