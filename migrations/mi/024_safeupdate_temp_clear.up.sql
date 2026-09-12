-- Міграція 24: сумісність із safeupdate у сесіях PostgREST.
--
-- Проблема, знайдена у продакшні автоматичною тінню Phase 7.6. Виклик
-- `public.mi_shadow_pack` через PostgREST падав з HTTP 400,
-- SQLSTATE 21000, `DELETE requires a WHERE clause`.
--
-- Причина не в логіці MI. Supabase вантажить бібліотеку `safeupdate` у
-- сесії ролі `authenticator` (`session_preload_libraries = supautils,
-- safeupdate`), а саме цією роллю ходить PostgREST. Бібліотека забороняє
-- DELETE і UPDATE без WHERE. Роль `postgres`, якою йдуть перевірки через
-- psql і MCP, цієї бібліотеки не вантажить, тому весь ручний shadow
-- Phase 7.4 проходив, а автоматичний ламався на першому ж DELETE.
--
-- Оскільки виклик RPC це одна транзакція, помилка відкочувала і ті
-- спостереження, які міст уже записав. Саме тому у продакшні не лишалось
-- жодного сліду.
--
-- Виправлення мінімальне і механічне: сім очищень ТИМЧАСОВИХ таблиць
-- дістають явний `where true`. Жодної durable-таблиці тут немає: усі сім
-- це `create temporary table if not exists ... on commit drop`.
--
-- Тіла функцій в усьому іншому побайтово ті самі, що у міграціях 013,
-- 015 і 022. Семантика резолвера, компілятора, матчера, правил
-- ідентичності і застосовності, Vehicle Memory, пакетів знань, Score,
-- Verdict і звіту не змінюється.
--
-- Сім виправлених операторів:
--   mi.resolve_identity      delete from tmp_obs      (015, резолвер)
--   mi.build_fragment        delete from tmp_scope    (013, компіляція)
--   mi.build_fragment        delete from tmp_claims   (013, компіляція)
--   mi.build_partial_payload delete from tmp_scope    (022, компіляція)
--   mi.build_partial_payload delete from tmp_claims   (022, компіляція)
--   mi.compile_pack          delete from tmp_eval     (022, компіляція)
--   mi.compile_pack          delete from tmp_pick     (022, компіляція)

-- ---------- mi.resolve_identity (джерело: 015_identity_resolver.up.sql) ----------

create or replace function mi.resolve_identity(p_vin text, p_obs jsonb)
returns bigint language plpgsql as $$
declare
  v_id bigint; v_ver text; r record; res jsonb; obs jsonb;
  v_vmy bigint; v_version bigint; v_market text; v_year int;
  v_gen bigint; v_line bigint; v_brand bigint;
  fitted record; cur_present boolean; cat text;
  alias_res jsonb; sid bigint; note text;
begin
  if coalesce(btrim(p_vin), '') = '' then raise exception 'vin is required'; end if;
  v_ver := mi.identity_version(p_obs);

  -- Той самий набір спостережень не породжує нового рядка.
  select id into v_id from mi_vm.resolved_identity
   where vin = p_vin and identity_version = v_ver;
  if found then return v_id; end if;

  insert into mi_vm.resolved_identity (vin, identity_version, resolver_version, inputs)
  values (p_vin, v_ver, mi.resolver_version(), p_obs)
  returning id into v_id;

  -- 4.1. Аліаси розвʼязуються до всього іншого. Неоднозначний аліас не
  -- вгадується: спостереження втрачає значення і лишається у провенансі.
  create temporary table if not exists tmp_obs (o jsonb, amb boolean default false) on commit drop;
  delete from tmp_obs where true;
  for obs in select o from jsonb_array_elements(p_obs) o loop
    if obs ? 'value_alias' and not (obs ? 'value_subject') then
      alias_res := mi.resolve_alias(obs->>'value_alias', (obs->>'alias_scope')::bigint);
      if (alias_res->>'ambiguous')::boolean then
        insert into tmp_obs values (obs || jsonb_build_object('alias_note', alias_res->>'note'), true);
        continue;
      end if;
      obs := obs || jsonb_build_object('value_subject', alias_res->>'subject_id');
    end if;
    insert into tmp_obs values (obs, false);
  end loop;

  -- 4.2. Кожен ключ виміру розвʼязується окремо.
  for r in
    select o->>'dimension' as dim,
           o->>'role' as role,
           coalesce(o->>'slot', 'na') as slot,
           jsonb_agg(o) as obs
      from tmp_obs where not amb and o->>'dimension' is not null
     group by 1, 2, 3
  loop
    cat := mi.dimension_category(r.dim, r.slot);
    res := mi.resolve_dimension(r.obs, cat);

    insert into mi_vm.resolved_identity_dimension (
      identity_id, dimension, role_code, slot, value_subject_id, value_text,
      value_num, value_date, value_bool, confidence, resolution_status,
      provenance, conflict_note)
    values (v_id, r.dim::mi.identity_dimension, r.role, r.slot::mi.config_slot,
      (res->>'value_subject')::bigint, res->>'value_text',
      (res->>'value_num')::numeric, (res->>'value_date')::date,
      (res->>'value_bool')::boolean,
      (res->>'confidence')::mi.confidence,
      (res->>'status')::mi.resolution_status,
      jsonb_build_object('category', cat, 'basis', res->>'basis',
        'supporting', res->'supporting', 'conflicting', res->'conflicting',
        'candidates', res->'candidates', 'note', res->>'note',
        'resolver_version', mi.resolver_version(), 'resolved_at', now()),
      case when res->>'status' = 'conflicted'
           then coalesce(res->>'note', 'sources disagree') else null end)
    on conflict do nothing;
  end loop;

  -- 4.3. Неоднозначні аліаси лишають слід: вимір існує зі статусом
  -- unresolved, щоб мовчазного зникнення не сталось.
  for r in
    select o->>'dimension' as dim, o->>'role' as role,
           coalesce(o->>'slot', 'na') as slot, jsonb_agg(o) as obs
      from tmp_obs where amb and o->>'dimension' is not null
     group by 1, 2, 3
  loop
    if exists (select 1 from mi_vm.resolved_identity_dimension d
                where d.identity_id = v_id and d.dimension = r.dim::mi.identity_dimension
                  and coalesce(d.role_code, '') = coalesce(r.role, '')
                  and d.slot = r.slot::mi.config_slot) then
      continue;
    end if;
    insert into mi_vm.resolved_identity_dimension (
      identity_id, dimension, role_code, slot, confidence, resolution_status, provenance)
    values (v_id, r.dim::mi.identity_dimension, r.role, r.slot::mi.config_slot,
      'low', 'unresolved',
      jsonb_build_object('category', 'alias', 'note', 'alias is ambiguous without context',
        'supporting', r.obs, 'resolver_version', mi.resolver_version()))
    on conflict do nothing;
  end loop;

  perform mi.resolve_hierarchy(v_id);
  perform mi.resolve_fitment(v_id);
  return v_id;
end $$;

-- ---------- mi.build_fragment (джерело: 013_check_retrieval.up.sql) ----------

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
  delete from tmp_scope where true;
  insert into tmp_scope select * from mi.vmy_scope(p_vmy_id);

  create temporary table if not exists tmp_claims (claim_id bigint) on commit drop;
  delete from tmp_claims where true;
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
    -- Канонічні перевірки версії. Вони потрапляють у фрагмент як
    -- СУТНОСТІ каталогу і більше не потребують окремого клейма про себе.
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'check_id', ci.subject_id,
               'area', mi.subject_area(ci.subject_id),
               'label', ks.label,
               'method', ci.test_method_code,
               'scope_subject_id', ci.scope_subject_id,
               'why_en', ci.why_en,
               'proves_en', ci.proves_en,
               'cannot_prove_en', ci.cannot_prove_en,
               'conditions', to_jsonb(ci.conditions),
               'priority', ci.default_priority,
               'materially_resolves', ci.materially_resolves,
               'resolves_dimension', ci.resolves_dimension,
               'buyer_importance', mi.check_importance(ci.subject_id),
               'covers', (select jsonb_agg(jsonb_build_object(
                            'subject_id', cc.target_subject_id, 'role', cc.role,
                            'issue_key', i.issue_key, 'severity', i.severity)
                            order by cc.target_subject_id)
                            from mi.check_covers cc
                            left join mi.issue i on i.subject_id = cc.target_subject_id
                           where cc.check_id = ci.subject_id),
               -- Походження перевірки живе у клеймах про неї. Якщо
               -- клейма немає, тут чесний null, а не вигаданий доказ.
               'claims', (select jsonb_agg(t2.claim_id order by t2.claim_id)
                            from tmp_claims t2 join mi.claim c2 on c2.id = t2.claim_id
                           where c2.subject_id = ci.subject_id)
             ) order by ci.subject_id)
        from mi.check_item ci
        join mi.knowledge_subject ks on ks.id = ci.subject_id
       where ci.subject_id in (select subject_id from tmp_scope)
    ), '[]'::jsonb),
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

-- ---------- mi.build_partial_payload (джерело: 022_partial_identity.up.sql) ----------

create or replace function mi.build_partial_payload(p_identity jsonb, p_purpose mi.pack_purpose)
returns jsonb language plpgsql as $$
declare
  v_version bigint := (p_identity->>'version')::bigint;
  v_cands bigint[]; v_deps jsonb; v_fp text; v_payload jsonb; v_snap bigint; n_vmy_only int;
begin
  v_cands := mi.partial_candidates(p_identity);

  create temporary table if not exists tmp_scope (
    subject_id bigint, relation text, role_code text) on commit drop;
  delete from tmp_scope where true;
  insert into tmp_scope select * from mi.partial_scope(v_version, v_cands);

  create temporary table if not exists tmp_claims (claim_id bigint) on commit drop;
  delete from tmp_claims where true;
  insert into tmp_claims
  select c.id from mi.claim c
    join mi.knowledge_subject ks on ks.id = c.subject_id
   where c.status = 'published'
     and c.subject_id in (select subject_id from tmp_scope)
     and mi.scope_admits((select s.relation from tmp_scope s where s.subject_id = c.subject_id
                           order by s.relation limit 1), ks.kind, c.propagation);

  select jsonb_agg(jsonb_build_object('subject_id', s.id, 'knowledge_rev', s.knowledge_rev)
                   order by s.id)
    into v_deps
    from mi.knowledge_subject s
   where s.id in (select subject_id from tmp_scope)
      or s.id in (select c.subject_id from mi.claim c join tmp_claims t on t.claim_id = c.id);

  v_fp := mi.fragment_fingerprint(coalesce(v_deps, '[]'::jsonb));
  select max(id) into v_snap from mi.knowledge_snapshot;

  select jsonb_build_object(
    'vmy_id', null,
    'version_id', v_version,
    'candidate_vmy_ids', to_jsonb(v_cands),
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
    -- Канонічні перевірки версії. Вони потрапляють у фрагмент як
    -- СУТНОСТІ каталогу і більше не потребують окремого клейма про себе.
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'check_id', ci.subject_id,
               'area', mi.subject_area(ci.subject_id),
               'label', ks.label,
               'method', ci.test_method_code,
               'scope_subject_id', ci.scope_subject_id,
               'why_en', ci.why_en,
               'proves_en', ci.proves_en,
               'cannot_prove_en', ci.cannot_prove_en,
               'conditions', to_jsonb(ci.conditions),
               'priority', ci.default_priority,
               'materially_resolves', ci.materially_resolves,
               'resolves_dimension', ci.resolves_dimension,
               'buyer_importance', mi.check_importance(ci.subject_id),
               'covers', (select jsonb_agg(jsonb_build_object(
                            'subject_id', cc.target_subject_id, 'role', cc.role,
                            'issue_key', i.issue_key, 'severity', i.severity)
                            order by cc.target_subject_id)
                            from mi.check_covers cc
                            left join mi.issue i on i.subject_id = cc.target_subject_id
                           where cc.check_id = ci.subject_id),
               -- Походження перевірки живе у клеймах про неї. Якщо
               -- клейма немає, тут чесний null, а не вигаданий доказ.
               'claims', (select jsonb_agg(t2.claim_id order by t2.claim_id)
                            from tmp_claims t2 join mi.claim c2 on c2.id = t2.claim_id
                           where c2.subject_id = ci.subject_id)
             ) order by ci.subject_id)
        from mi.check_item ci
        join mi.knowledge_subject ks on ks.id = ci.subject_id
       where ci.subject_id in (select subject_id from tmp_scope)
    ), '[]'::jsonb),
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

  -- Знання, субʼєкт якого сам кандидатний VMY або сутність про нього.
  -- Без точного VMY воно недосяжне і лише рахується.
  select count(*) into n_vmy_only
    from mi.claim c
   where c.status = 'published'
     and c.subject_id in (
       select unnest(v_cands)
       union select i.subject_id from mi.issue i where i.about_subject_id = any (v_cands)
       union select m.subject_id from mi.maintenance_item m where m.about_subject_id = any (v_cands)
       union select k.subject_id from mi.check_item k where k.scope_subject_id = any (v_cands)
       union select s.subject_id from mi.component_state_type s where s.applies_to_subject_id = any (v_cands));

  return v_payload || jsonb_build_object('fingerprint', v_fp, 'snapshot_id', v_snap,
                                         'vmy_only_count', n_vmy_only);
end $$;

-- ---------- mi.compile_pack (джерело: 022_partial_identity.up.sql) ----------

create or replace function mi.compile_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare
  v_vmy bigint; frag mi.pack_fragment%rowtype; cfg jsonb;
  v_log jsonb := '[]'::jsonb; v_pack jsonb;
  n_total int; n_kept int; n_elig int; n_cap int; n_status_out int; n_merged int;
  v_partial jsonb;
begin
  v_vmy := (p_identity->>'vmy')::bigint;
  cfg := mi.purpose_budget(p_purpose);

  -- Phase 7.3: частковий шлях. Без точного VMY, але з підтвердженою
  -- версією зміст збирається синхронно в межах версії і її кандидатних
  -- VMY. Точний шлях нижче не змінений: фрагмент VMY як і раніше лише
  -- читається, синхронної збірки фрагмента немає.
  if v_vmy is null then
    if p_identity->>'version' is null then
      return jsonb_build_object('fragment_available', false, 'reason', 'version_not_identified');
    end if;
    v_partial := mi.build_partial_payload(p_identity, p_purpose);
    frag.payload := v_partial;
    frag.fingerprint := v_partial->>'fingerprint';
    frag.snapshot_id := (v_partial->>'snapshot_id')::bigint;
    frag.valid := true;
  else
  select * into frag from mi.pack_fragment
   where vmy_id = v_vmy and purpose = p_purpose and locale = p_locale
     and budget_profile = p_budget and compiler_version = mi.compiler_version();

  if not found or not frag.valid then
    return jsonb_build_object('fragment_available', false,
      'reason', case when not found then 'fragment_missing' else 'invalidated' end);
  end if;
  end if;

  -- 8.1. Оцінка кожного клейма фрагмента.
  create temporary table if not exists tmp_eval (
    claim_id bigint, status text, basis text, area text, importance smallint,
    knowledge_type text, severity text, priority text, entry jsonb, preds jsonb
  ) on commit drop;
  delete from tmp_eval where true;

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

  -- Канонічні перевірки оцінюються тими самими правилами і входять у
  -- ту саму таблицю відбору. Клейм про перевірку для цього не потрібен.
  -- Канонічна перевірка це ІДЕНТИЧНІСТЬ обʼєкта перевірки. Ключ
  -- дедуплікації це check_item.id, а не текст. Опубліковані клейми про ту
  -- саму перевірку доповнюють її метаданими і доказом, але другого
  -- екземпляра не створюють.
  insert into tmp_eval
  select null::bigint,
         cv->>'status', cv->>'basis', e->>'area',
         greatest((e->>'buyer_importance')::smallint,
                  coalesce(enr.max_importance, 0)::smallint),
         'check_item',
         null,
         e->>'priority',
         jsonb_build_object(
           'subject_kind', 'check_item',
           'check_subject_id', (e->>'check_id')::bigint,
           'text_en', e->>'why_en',
           'buyer_importance', greatest((e->>'buyer_importance')::int,
                                        coalesce(enr.max_importance, 0)),
           'entry_source', 'canonical_entity',
           'enriched_by_claims', coalesce(enr.notes, '[]'::jsonb),
           'check', jsonb_build_object(
             'method', e->>'method', 'why_en', e->>'why_en',
             'proves_en', e->>'proves_en', 'cannot_prove_en', e->>'cannot_prove_en',
             'conditions', e->'conditions', 'priority', e->>'priority',
             'materially_resolves', (e->>'materially_resolves')::boolean,
             'resolves_dimension', e->>'resolves_dimension',
             'covers', e->'covers')),
         cv->'predicates'
    from jsonb_array_elements(frag.payload->'checks') e
    cross join lateral mi.eval_check((e->>'check_id')::bigint, p_identity) cv
    left join lateral (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'claim_id', t.claim_id,
               'text', t.entry->>'text_en',
               'knowledge_type', t.entry->>'knowledge_type',
               'confidence', t.entry->>'confidence',
               'buyer_importance', (t.entry->>'buyer_importance')::int,
               'buyer_implication', t.entry->>'buyer_implication_en',
               'status', t.status,
               'basis', t.basis,
               'recurrence', t.entry->>'recurrence_class',
               'supports', t.entry->'supports',
               'contested', case when (t.entry->>'contested')::boolean then
                              jsonb_build_object('is_contested', true,
                                'note', t.entry->>'contested_note_en') else null end))
               order by t.claim_id) as notes,
             max((t.entry->>'buyer_importance')::int) as max_importance
        from tmp_eval t
       where t.claim_id is not null
         and t.entry->>'subject_kind' = 'check_item'
         and (t.entry->>'subject_id')::bigint = (e->>'check_id')::bigint
    ) enr on true;

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
    pick_key text, claim_id bigint, tier int, rank_key text, area text, entry jsonb,
    status text, basis text, preds jsonb
  ) on commit drop;
  delete from tmp_pick where true;

  insert into tmp_pick
  select coalesce('claim:' || t.claim_id::text,
                  'check:' || (t.entry->>'check_subject_id')),
         t.claim_id,
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
         lpad(coalesce(t.claim_id, 900000000 + (t.entry->>'check_subject_id')::bigint)::text, 12, '0'),
         t.area, t.entry, t.status, t.basis, t.preds
    from tmp_eval t
   where
     -- Клейм ПРО перевірку не створює другого екземпляра перевірки:
     -- він приєднується до канонічного запису як доповнення.
     not (t.claim_id is not null and t.entry->>'subject_kind' = 'check_item')
     and (t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
      or (t.status = 'CONDITIONAL'
          and t.importance >= (cfg->>'conditional_min_importance')::int
          and (
            t.basis = 'conflicted'
            or exists (
              select 1 from tmp_eval c
               where c.entry->'check'->>'materially_resolves' = 'true'
                 and c.claim_id is distinct from t.claim_id
                 and c.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'CONDITIONAL')
                 and (
                   exists (select 1 from jsonb_array_elements(t.preds) pr
                            where pr->>'result' = 'UNKNOWN'
                              and pr->>'dimension' = c.entry->'check'->>'resolves_dimension')
                   or (c.entry->'check'->>'resolves_dimension' is null and c.area = t.area)
                 ))
          )));

  select count(*) into n_elig from tmp_pick;
  select count(*) into n_status_out from tmp_eval
   where status in ('EXCLUDED', 'EXCLUDED_ASSUMED');
  select count(*) into n_merged from tmp_eval
   where claim_id is not null and entry->>'subject_kind' = 'check_item'
     and status not in ('EXCLUDED', 'EXCLUDED_ASSUMED');

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
      'merged_into_checks', n_merged,
      'filtered_by_policy', n_total - n_status_out - n_merged - n_cap,
      'truncated_count', n_cap - n_kept,
      'counts', (select jsonb_object_agg(status, n)
                   from (select status, count(*) n from tmp_eval group by status) s))
      -- Лише частковий пакет несе ці ключі; точний пакет байт у байт той самий.
      || case when v_partial is null then '{}'::jsonb else jsonb_build_object(
           'identity_precision', 'partial',
           'version_id', (p_identity->>'version')::bigint,
           'unresolved_dimensions', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                                       from unnest(array['vmy', 'market_sold', 'model_year']) d
                                      where p_identity->>d is null),
           'candidate_vmy_count', jsonb_array_length(v_partial->'candidate_vmy_ids'),
           'candidate_vmy_ids', v_partial->'candidate_vmy_ids',
           'inaccessible_vmy_only_count', (v_partial->>'vmy_only_count')::int) end,
    'identity_summary', mi.identity_summary(p_identity),
    'coverage_statement', case when v_partial is null then mi.coverage_statement(frag.id, p_identity)
                               else mi.coverage_statement_from_gaps(v_partial->'gaps', p_identity) end,
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

