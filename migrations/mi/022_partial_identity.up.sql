-- Міграція 22: часткова ідентичність (Amendment A, схвалено власником).
--
-- До цієї міграції Model Intelligence віддавала знання лише для точного
-- VMY: без ринку або модельного року машина отримувала нуль клеймів, хоча
-- оцінювач уже вміє UNKNOWN і CONDITIONAL. Аудит:
-- docs/model-intelligence/partial-identity-audit.md.
--
-- Точний шлях VMY не змінюється: фрагмент читається як і раніше, заявка
-- на збірку ставиться як і раніше, пакет той самий байт у байт. Доведено
-- знімком усіх точних пакетів до і після.
--
-- Якщо VMY не розвʼязано, але версію підтверджено:
--   * покоління, ряд і бренд виводяться з версії;
--   * кандидатні VMY це VMY версії, сумісні з кожним ПІДТВЕРДЖЕНИМ виміром;
--   * невідомі виміри не фільтрують кандидатів;
--   * компоненти без точного VMY не припускаються;
--   * знання про сам VMY недосяжне і лише рахується;
--   * семантика eval_claim не змінюється (якір на родину і обладнання
--     додано глобально міграцією 21);
--   * пакет несе identity_precision = partial, unresolved_dimensions,
--     candidate_vmy_count, inaccessible_vmy_only_count і заяву про
--     покриття часткового обсягу.
--
-- Схема не змінюється. Частковий зміст збирається синхронно в межах
-- версії: це beta-реалізація без нового виду фрагмента.
--
-- Джерела текстів: resolve_hierarchy 015, compile_pack 014, request_pack 019,
-- persist_pack 017, shadow_pack 018, coverage_statement 012, build_fragment 013.

-- ---------- 1. Резолвер ----------

create or replace function mi.resolve_hierarchy(p_identity bigint)
returns void language plpgsql as $$
declare
  v_version bigint; v_market text; v_year int; v_vmy bigint;
  v_gen bigint; v_line bigint; v_brand bigint; n int; st text;
begin
  select value_subject_id into v_version from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = 'version' and resolution_status = 'confirmed';
  select coalesce(value_text, tag) into v_market from (
    select value_text, null::text as tag from mi_vm.resolved_identity_dimension
     where identity_id = p_identity and dimension = 'market_sold'
       and resolution_status = 'confirmed') t;
  select value_num::int into v_year from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = 'model_year' and resolution_status = 'confirmed';

  if v_version is not null and v_market is not null and v_year is not null then
    select subject_id into v_vmy from mi.version_market_year
     where version_id = v_version and market_code = v_market and model_year = v_year;
  end if;

  if v_vmy is not null then
    insert into mi_vm.resolved_identity_dimension (identity_id, dimension, slot,
        value_subject_id, confidence, resolution_status, provenance)
    values (p_identity, 'vmy', 'na', v_vmy, 'high', 'confirmed',
      jsonb_build_object('category', 'derived', 'basis', 'catalog',
        'note', 'derived from a confirmed version, market and model year'))
    on conflict do nothing;

    select v.generation_id, g.model_line_id, m.brand_id into v_gen, v_line, v_brand
      from mi.version_market_year y
      join mi.vehicle_version v on v.subject_id = y.version_id
      join mi.generation g on g.subject_id = v.generation_id
      join mi.model_line m on m.subject_id = g.model_line_id
     where y.subject_id = v_vmy;

    insert into mi_vm.resolved_identity_dimension (identity_id, dimension, slot,
        value_subject_id, confidence, resolution_status, provenance)
    select p_identity, d, 'na', s, 'high', 'confirmed',
           jsonb_build_object('category', 'derived', 'basis', 'catalog',
             'note', 'contained by the resolved version and market year')
      from (values ('generation'::mi.identity_dimension, v_gen),
                   ('model_line', v_line), ('brand', v_brand)) t(d, s)
     where s is not null
    on conflict do nothing;
  else
    -- Явно фіксуємо, що VMY не розвʼязано, і чому саме.
    insert into mi_vm.resolved_identity_dimension (identity_id, dimension, slot,
        confidence, resolution_status, provenance)
    values (p_identity, 'vmy', 'na', 'low', 'unresolved',
      jsonb_build_object('category', 'derived', 'note',
        format('version %s, market %s, model year %s: all three are required',
               coalesce(v_version::text, 'unresolved'),
               coalesce(v_market, 'unresolved'),
               coalesce(v_year::text, 'unresolved'))))
    on conflict do nothing;

    -- Phase 7.3: VMY не розвʼязано, але версію підтверджено. Покоління,
    -- ряд і бренд випливають із версії вкладеністю каталогу, це не
    -- здогадка. Ринок і рік при цьому НЕ підставляються.
    if v_version is not null then
      select v.generation_id, g.model_line_id, m.brand_id into v_gen, v_line, v_brand
        from mi.vehicle_version v
        join mi.generation g on g.subject_id = v.generation_id
        join mi.model_line m on m.subject_id = g.model_line_id
       where v.subject_id = v_version;

      insert into mi_vm.resolved_identity_dimension (identity_id, dimension, slot,
          value_subject_id, confidence, resolution_status, provenance)
      select p_identity, d, 'na', s, 'high', 'confirmed',
             jsonb_build_object('category', 'derived', 'basis', 'catalog',
               'note', 'contained by the confirmed version; the version market year is unresolved')
        from (values ('generation'::mi.identity_dimension, v_gen),
                     ('model_line', v_line), ('brand', v_brand)) t(d, s)
       where s is not null
      on conflict do nothing;
    end if;
  end if;
end $$;

-- ---------- 2. Кандидатні VMY ----------

-- Усі VMY підтвердженої версії, сумісні з КОЖНИМ підтвердженим виміром.
-- Невідомий вимір не фільтрує і нічого не вигадує. Межа вікна виробництва
-- з видом unknown машину не виключає.
create or replace function mi.partial_candidates(p_identity jsonb)
returns bigint[] language sql stable as $$
  select coalesce(array_agg(y.subject_id order by y.subject_id), '{}'::bigint[])
    from mi.version_market_year y
   where y.version_id = (p_identity->>'version')::bigint
     and (p_identity->>'model_year' is null
          or y.model_year = (p_identity->>'model_year')::numeric::int)
     and (p_identity->>'market_sold' is null
          or y.market_code = p_identity->>'market_sold')
     and (p_identity->>'production_date' is null
          or ((y.prod_from_kind <> 'known' or (p_identity->>'production_date')::date >= y.prod_from)
          and (y.prod_to_kind <> 'known' or (p_identity->>'production_date')::date <= y.prod_to)));
$$;

-- ---------- 3. Частковий обсяг знання ----------

-- Та сама будова, що mi.vmy_scope, з двома відмінностями: сам VMY у
-- замикання не входить (без точного VMY у знання про нього немає
-- субʼєкта), а заводська конфігурація береться по всіх кандидатних VMY.
-- Компоненти при цьому НЕ припускаються: обсяг лише робить знання
-- видимим, а неявні групи якоря роблять його умовним.
create or replace function mi.partial_scope(p_version_id bigint, p_vmy_ids bigint[])
returns table (subject_id bigint, relation text, role_code text)
language sql stable as $$
  with ver as (
    select v.subject_id as version_id, v.generation_id, g.phase_of_id,
           g.model_line_id, m.brand_id
      from mi.vehicle_version v
      join mi.generation g on g.subject_id = v.generation_id
      join mi.model_line m on m.subject_id = g.model_line_id
     where v.subject_id = p_version_id
  ),
  cands as (
    select y.subject_id as vmy_id from mi.version_market_year y
     where y.subject_id = any (p_vmy_ids) and y.version_id = p_version_id
  ),
  hierarchy as (
    select version_id as sid, 'ancestor'::text as rel from ver
    union all select generation_id, 'ancestor' from ver
    union all select phase_of_id, 'ancestor' from ver where phase_of_id is not null
    union all select model_line_id, 'ancestor' from ver
    union all select brand_id, 'ancestor' from ver
  ),
  fitted as (
    select distinct f.variant_id as sid, 'fitted'::text as rel, f.role_code
      from mi.version_fitment f
     where f.vmy_id in (select vmy_id from cands)
       and f.prod_from_kind <> 'unknown' and f.prod_to_kind <> 'unknown'
  ),
  rev_ancestors as (
    with recursive up as (
      select v.subject_id, v.revision_of_id, 1 as depth
        from mi.component_variant v
       where v.subject_id in (select sid from fitted)
      union all
      select p.subject_id, p.revision_of_id, up.depth + 1
        from mi.component_variant p join up on p.subject_id = up.revision_of_id
    )
    select subject_id, 'revision_ancestor'::text, null::text from up where depth > 1
  ),
  families as (
    select distinct v.family_id, 'family'::text, null::text
      from mi.component_variant v where v.subject_id in (select sid from fitted)
  ),
  equipment as (
    select distinct a.item_id, 'equipment'::text, null::text
      from mi.equipment_availability a where a.vmy_id in (select vmy_id from cands)
  ),
  entitlements as (
    select e.subject_id, 'entitlement'::text, null::text
      from mi.entitlement e where e.brand_id in (select brand_id from ver)
  ),
  base as (
    select sid, rel, null::text as role_code from hierarchy where sid is not null
    union all select sid, rel, role_code from fitted
    union all select * from rev_ancestors
    union all select * from families
    union all select * from equipment
    union all select * from entitlements
  ),
  knowledge as (
    select i.subject_id, 'issue'::text, null::text from mi.issue i
      where i.about_subject_id in (select sid from base) and i.status = 'active'
    union all
    select m.subject_id, 'maintenance'::text, null::text from mi.maintenance_item m
      where m.about_subject_id in (select sid from base)
    union all
    select c.subject_id, 'check'::text, null::text from mi.check_item c
      where c.scope_subject_id in (select sid from base)
    union all
    select s.subject_id, 'state'::text, null::text from mi.component_state_type s
      where s.applies_to_subject_id in (select sid from base)
  )
  select sid, rel, role_code from base
  union all
  select * from knowledge;
$$;

-- Правило поширення за відношенням: дослівно те саме, що у
-- mi.claim_in_scope, але без повторного обчислення замикання на кожен
-- клейм. mi.claim_in_scope для точного шляху не змінюється.
create or replace function mi.scope_admits(
  p_relation text, p_kind mi.subject_kind, p_propagation mi.propagation)
returns boolean language sql immutable as $$
  select case
    when p_relation is null then false
    when p_relation = 'family' then p_propagation in ('descendants', 'family_context')
    when p_relation = 'revision_ancestor' then p_propagation = 'descendants'
    when p_relation = 'ancestor' and p_kind in ('brand', 'model_line')
      then p_propagation = 'descendants'
    else true end;
$$;

-- ---------- 4. Частковий зміст пакета ----------

-- Будує в памʼяті обʼєкт тієї самої форми, що payload фрагмента
-- (claims, checks, gaps), тими самими виразами, скопійованими з
-- mi.build_fragment. Нічого не записує: фрагментів без VMY немає.
-- Пошук обмежено версією і її кандидатними VMY: жодного проходу по всіх
-- опублікованих клеймах, лише вибірка за subject_id з обсягу.
create or replace function mi.build_partial_payload(p_identity jsonb, p_purpose mi.pack_purpose)
returns jsonb language plpgsql as $$
declare
  v_version bigint := (p_identity->>'version')::bigint;
  v_cands bigint[]; v_deps jsonb; v_fp text; v_payload jsonb; v_snap bigint; n_vmy_only int;
begin
  v_cands := mi.partial_candidates(p_identity);

  create temporary table if not exists tmp_scope (
    subject_id bigint, relation text, role_code text) on commit drop;
  delete from tmp_scope;
  insert into tmp_scope select * from mi.partial_scope(v_version, v_cands);

  create temporary table if not exists tmp_claims (claim_id bigint) on commit drop;
  delete from tmp_claims;
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

-- ---------- 5. Покриття часткового обсягу ----------

create or replace function mi.coverage_statement_from_gaps(p_gaps jsonb, p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare res jsonb;
begin
  execute $q$
    with applicable as (
      select area, knowledge_type from tmp_eval
       where status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
    ),
    lvl as (
      select area,
             count(*) filter (where knowledge_type = 'official_fact') as official,
             count(*) filter (where knowledge_type = 'specialist_practice') as specialist,
             count(*) filter (where knowledge_type in ('owner_pattern','owner_practice')) as owner,
             count(*) filter (where knowledge_type = 'known_issue') as known_issue,
             count(*) filter (where knowledge_type = 'calcar_synthesis') as synthesis
        from applicable group by area
    ),
    gaps as (
      select g->>'area' as area,
             (g->>'blocked_high_importance')::int as hi,
             (g->>'blocked_total')::int as tot,
             g->'gap_classes' as classes
        from jsonb_array_elements($1) g
    ),
    merged as (
      select coalesce(l.area, gp.area) as area,
             coalesce(l.official,0) o, coalesce(l.specialist,0) s, coalesce(l.owner,0) w,
             coalesce(l.known_issue,0) ki, coalesce(l.synthesis,0) sy,
             coalesce(gp.hi,0) hi, coalesce(gp.tot,0) tot, coalesce(gp.classes,'[]'::jsonb) cls
        from lvl l full join gaps gp on gp.area = l.area
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'area', area,
        'official', case when o >= 3 then 'strong' when o >= 1 then 'medium' else 'none' end,
        'specialist', case when s >= 3 then 'strong' when s >= 1 then 'medium' else 'none' end,
        'owner', case when w >= 3 then 'strong' when w >= 1 then 'medium' else 'none' end,
        'known_issues', ki,
        'synthesis', sy,
        'blocked_high_importance', hi,
        'blocked_total', tot,
        'gap_classes', cls,
        'confidence_note',
          case
            when o = 0 and s = 0 and w = 0 then
              'No published knowledge of this area reaches this car. This is absence of coverage, not evidence that the area is trouble free.'
            when hi > 0 then
              'Independent owner or specialist coverage of this area is incomplete: '
                || hi || ' high importance findings are held back for lack of evidence.'
            when s = 0 and w = 0 then
              'Only manufacturer documents cover this area; independent confirmation is missing.'
            when o = 0 then
              'No manufacturer document covers this area; the knowledge here is independent only.'
            else 'Coverage of this area draws on more than one kind of source.'
          end) order by area), '[]'::jsonb)
      from merged
  $q$ into res using coalesce(p_gaps, '[]'::jsonb);
  return res;
end $$;

-- ---------- 6. Компілятор ----------

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
  delete from tmp_pick;

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

-- ---------- 7. Гаряча дорога, збереження, тінь ----------

create or replace function mi.request_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare v_vmy bigint; res jsonb; v_reason mi.build_reason;
begin
  v_vmy := (p_identity->>'vmy')::bigint;

  -- Phase 7.3: без точного VMY фрагмента немає і будувати у фоні нічого:
  -- частковий пакет уже зібрано синхронно, промах означає, що не
  -- підтверджена навіть версія. Заявка у чергу не ставиться.
  if v_vmy is null then
    return mi.compile_pack(p_identity, p_purpose, p_locale, p_budget);
  end if;

  res := mi.compile_pack(p_identity, p_purpose, p_locale, p_budget);

  -- Прапорець успіху лежить у `pack`, прапорець промаху на верхньому рівні.
  if coalesce((res->'pack'->>'fragment_available')::boolean,
              (res->>'fragment_available')::boolean, false) then
    return res;
  end if;

  -- Синхронної компіляції у гарячій дорозі немає СВІДОМО: Check не чекає.
  v_reason := case
    when res->>'reason' = 'invalidated' then 'invalidated'
    when exists (select 1 from mi.claim c
                  where c.status = 'published' and mi.claim_in_scope(c.id, v_vmy))
      then 'fragment_missing'
    else 'knowledge_missing' end;

  insert into mi.build_request (reason, vmy_id, identity_descriptor, purpose, status)
  values (v_reason, v_vmy, p_identity, p_purpose, 'queued')
  on conflict on constraint build_request_key do update
    set requested_count = mi.build_request.requested_count + 1,
        last_requested_at = now(),
        status = case when mi.build_request.status = 'done' then 'queued'::mi.request_status
                      else mi.build_request.status end;

  return jsonb_build_object('fragment_available', false, 'reason', v_reason,
    'coverage_statement', '[]'::jsonb,
    'pack_meta', jsonb_build_object('compiler_version', mi.compiler_version(),
      'purpose', p_purpose, 'included_count', 0, 'truncated_count', 0));
end $$;

create or replace function mi.persist_pack(
  p_identity bigint, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns bigint language plpgsql as $$
declare
  ident jsonb; compiled jsonb; v_pack bigint; v_frag bigint; v_snap bigint; v_iv text;
begin
  ident := mi.identity_json(p_identity);
  -- Phase 7.3: частковий пакет зберігається так само; без версії нічого.
  if ident->>'vmy' is null and ident->>'version' is null then
    raise exception 'identity % has no resolved version', p_identity;
  end if;

  compiled := mi.compile_pack(ident, p_purpose, p_locale, p_budget);
  -- Успішна компіляція повертає {pack, applicability_log}; прапорець
  -- доступності фрагмента лежить усередині пакета, а при промаху на
  -- верхньому рівні. Перевіряються обидва місця.
  if not coalesce((compiled->'pack'->>'fragment_available')::boolean,
                  (compiled->>'fragment_available')::boolean, false) then
    return null;
  end if;

  v_frag := (compiled->'pack'->'pack_meta'->>'fragment_id')::bigint;
  v_snap := (compiled->'pack'->'pack_meta'->>'snapshot_id')::bigint;
  if v_snap is null then select max(id) into v_snap from mi.knowledge_snapshot; end if;
  select identity_version into v_iv from mi_vm.resolved_identity where id = p_identity;

  insert into mi.knowledge_pack (identity_id, identity_version, fragment_id, purpose,
      locale, budget_profile, compiler_version, fingerprint, payload, applicability_log,
      snapshot_id, stale)
  values (p_identity, v_iv, v_frag, p_purpose, p_locale, p_budget,
      mi.compiler_version(),
      compiled->'pack'->'pack_meta'->>'fragment_fingerprint',
      compiled->'pack', compiled->'applicability_log', v_snap, false)
  on conflict on constraint knowledge_pack_key do update
    set payload = excluded.payload, applicability_log = excluded.applicability_log,
        fragment_id = excluded.fragment_id, snapshot_id = excluded.snapshot_id,
        identity_id = excluded.identity_id,
        stale = false, created_at = now()
  returning id into v_pack;

  return v_pack;
end $$;

create or replace function mi.shadow_pack(p_vin text)
returns jsonb language plpgsql as $$
declare ing jsonb; v_id bigint; ident jsonb; dec jsonb; rep jsonb;
begin
  ing := mi.ingest_identity_from_check(p_vin);
  v_id := mi.resolve_from_memory(p_vin);
  ident := mi.identity_json(v_id);

  -- Phase 7.3: відмова лише тоді, коли не підтверджена навіть версія.
  if ident->>'version' is null then
    return jsonb_build_object(
      'vin', p_vin, 'mi_available', false, 'reason', 'identity_unresolved',
      'diagnostic', case when ing->'version_match'->>'note' = 'brand is not in the catalogue'
                         then 'brand_not_in_catalog' else 'version_not_identified' end,
      'ingest', ing, 'identity_id', v_id,
      'unresolved', (select jsonb_agg(jsonb_build_object('dimension', d.dimension,
                        'status', d.resolution_status, 'note',
                        coalesce(d.conflict_note, d.provenance->>'note')))
                       from mi_vm.resolved_identity_dimension d
                      where d.identity_id = v_id
                        and d.resolution_status in ('unresolved', 'conflicted')));
  end if;

  dec := mi.request_pack(ident, 'decision');
  rep := mi.request_pack(ident, 'report');

  if not coalesce((dec->'pack'->>'fragment_available')::boolean,
                  (dec->>'fragment_available')::boolean, false) then
    return jsonb_build_object('vin', p_vin, 'mi_available', false,
      'reason', coalesce(dec->>'reason', 'fragment_unavailable'),
      'diagnostic', coalesce(dec->>'reason', 'fragment_unavailable'),
      'ingest', ing, 'identity_id', v_id, 'identity_summary', mi.identity_summary(ident));
  end if;

  return jsonb_build_object(
    'vin', p_vin, 'mi_available', true, 'identity_id', v_id,
    'identity_precision', coalesce(dec->'pack'->'pack_meta'->>'identity_precision', 'exact'),
    'ingest', ing,
    'identity_summary', dec->'pack'->'identity_summary',
    'coverage_statement', dec->'pack'->'coverage_statement',
    'decision', jsonb_build_object('meta', dec->'pack'->'pack_meta',
                                   'systems', dec->'pack'->'systems'),
    'report', jsonb_build_object('meta', rep->'pack'->'pack_meta',
                                 'systems', rep->'pack'->'systems'));
end $$;
