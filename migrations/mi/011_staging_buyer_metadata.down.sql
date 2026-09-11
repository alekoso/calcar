-- Відкат міграції 11.
--
-- Повертає mi.check_gate і mi.publish_candidate до версії міграції 10 і
-- прибирає buyer-колонки staging. Після відкату канонічний клейм знову
-- отримує buyer_importance константою 3, як це було до Phase 3.2.

create or replace function mi.check_gate(p_candidate_id bigint)
returns jsonb language plpgsql as $$
declare
  c mi.candidate_claim%rowtype;
  subj_kind mi.subject_kind;
  rules jsonb := '[]'::jsonb;
  passed boolean := true;
  n_official int; n_spec_primary int; n_owner_groups int; n_vendor int;
  n_total int; n_plat int; n_mkt int; n_ctx int;
  n_support int; n_support_types int; n_alias int;
  shape_ok boolean; ok boolean;
begin
  select * into c from mi.candidate_claim where id = p_candidate_id;
  if not found then raise exception 'candidate % not found', p_candidate_id; end if;

  select count(*) filter (where s.source_type in ('official', 'legal')),
         count(*) filter (where s.source_type = 'specialist' and s.quality = 'primary'),
         count(distinct ce.independence_group) filter (where s.source_type = 'owner' and ce.stance = 'supports'),
         count(*) filter (where s.source_type in ('vendor', 'aggregator')),
         count(*),
         count(distinct s.platform) filter (where s.source_type = 'owner'),
         count(distinct s.market_code) filter (where s.source_type = 'owner'),
         count(distinct ce.independence_group) filter (where ce.context ? 'mileage_km' or ce.context ? 'age_years')
    into n_official, n_spec_primary, n_owner_groups, n_vendor, n_total, n_plat, n_mkt, n_ctx
    from mi.candidate_evidence ce join mi.source s on s.id = ce.source_id
   where ce.candidate_id = p_candidate_id;

  select count(*), count(distinct cl.knowledge_type)
    into n_support, n_support_types
    from jsonb_array_elements_text(coalesce(c.proposed_links->'supports', '[]'::jsonb)) t(v)
    join mi.claim cl on cl.id = t.v::bigint and cl.status = 'published';

  select count(distinct target_subject_id) into n_alias
    from mi.subject_alias where alias_norm = lower(btrim(coalesce(c.proposed_subject_text, '')));

  if c.resolved_subject_id is not null then
    select kind into subj_kind from mi.knowledge_subject where id = c.resolved_subject_id;
  end if;

  -- 1. Subject розвʼязаний
  ok := c.resolved_subject_id is not null;
  rules := rules || jsonb_build_object('code', 'subject_resolved', 'ok', ok,
    'detail', 'candidate must be normalized to a knowledge subject');
  passed := passed and ok;

  -- 2. Аліас однозначний
  ok := n_alias <= 1;
  rules := rules || jsonb_build_object('code', 'alias_unambiguous', 'ok', ok,
    'detail', format('%s subjects share this alias', n_alias));
  passed := passed and ok;

  -- 3. Тип знання заданий
  ok := c.proposed_knowledge_type is not null;
  rules := rules || jsonb_build_object('code', 'knowledge_type_set', 'ok', ok, 'detail', null);
  passed := passed and ok;

  -- 4. Форма застосовності
  shape_ok := true;
  if c.proposed_applicability is not null then
    if jsonb_typeof(c.proposed_applicability) <> 'array' then
      shape_ok := false;
    else
      select bool_and(e ? 'dimension' and e ? 'operator') into shape_ok
        from jsonb_array_elements(c.proposed_applicability) e;
      shape_ok := coalesce(shape_ok, true);
    end if;
  end if;
  rules := rules || jsonb_build_object('code', 'applicability_shape', 'ok', shape_ok,
    'detail', 'each predicate needs dimension and operator');
  passed := passed and shape_ok;

  -- 5. Поширення знання вниз вимагає явного рішення рецензента
  ok := c.proposed_propagation = 'exact' or coalesce(btrim(c.review_note), '') <> '';
  rules := rules || jsonb_build_object('code', 'propagation_justified', 'ok', ok,
    'detail', 'propagation other than exact requires a review note');
  passed := passed and ok;

  -- 6. Широке знання потребує широкого джерела
  ok := not (subj_kind in ('component_family', 'brand', 'model_line')
             and c.proposed_propagation = 'descendants')
        or (n_official > 0 or n_spec_primary > 0);
  rules := rules || jsonb_build_object('code', 'broad_claim_broad_source', 'ok', ok,
    'detail', 'family or brand wide knowledge needs official or primary specialist source');
  passed := passed and ok;

  -- 7. Число без одиниці не публікується
  ok := c.value_kind is null or c.value_kind not in ('quantity', 'range')
        or (c.structured_value ? 'unit');
  rules := rules || jsonb_build_object('code', 'numeric_unit', 'ok', ok,
    'detail', 'quantity and range need a unit');
  passed := passed and ok;

  -- 8. Вартість без ринку і дати не публікується
  ok := c.value_kind is null or c.value_kind <> 'cost'
        or (c.structured_value ?& array['market', 'as_of']);
  rules := rules || jsonb_build_object('code', 'cost_market_asof', 'ok', ok,
    'detail', 'cost needs market and as_of');
  passed := passed and ok;

  -- 9. Постачальник послуг сам по собі нічого не встановлює
  ok := not (n_total > 0 and n_vendor = n_total);
  rules := rules || jsonb_build_object('code', 'vendor_not_alone', 'ok', ok,
    'detail', 'vendor or aggregator sources alone cannot establish knowledge');
  passed := passed and ok;

  -- 10. Правила за типом знання
  if c.proposed_knowledge_type = 'official_fact' then
    ok := n_official > 0;
    rules := rules || jsonb_build_object('code', 'official_source', 'ok', ok,
      'detail', 'official fact needs an official or legal source');
    passed := passed and ok;

    ok := c.text_en !~ '[0-9]' or c.value_kind is not null;
    rules := rules || jsonb_build_object('code', 'structured_when_numeric', 'ok', ok,
      'detail', 'official fact carrying numbers or document ids needs value_kind');
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'known_issue' then
    ok := n_official > 0 or (n_spec_primary >= 1 and n_owner_groups >= 2);
    rules := rules || jsonb_build_object('code', 'known_issue_evidence', 'ok', ok,
      'detail', 'needs official source, or primary specialist plus two independent owner groups');
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'specialist_practice' then
    ok := n_spec_primary >= 1;
    rules := rules || jsonb_build_object('code', 'specialist_source', 'ok', ok, 'detail', null);
    passed := passed and ok;
    ok := c.proposed_causal_status is not null;
    rules := rules || jsonb_build_object('code', 'causal_status_set', 'ok', ok, 'detail', null);
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'owner_practice' then
    ok := n_owner_groups >= 3 and (n_plat >= 2 or n_mkt >= 2);
    rules := rules || jsonb_build_object('code', 'owner_practice_recurrence', 'ok', ok,
      'detail', 'needs three independent groups across two platforms or two markets');
    passed := passed and ok;
    ok := c.proposed_causal_status is not null;
    rules := rules || jsonb_build_object('code', 'causal_status_set', 'ok', ok, 'detail', null);
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'owner_pattern' then
    ok := n_owner_groups >= 2;
    rules := rules || jsonb_build_object('code', 'owner_pattern_groups', 'ok', ok,
      'detail', 'needs at least two independent owner groups');
    passed := passed and ok;
    ok := n_ctx >= 2;
    rules := rules || jsonb_build_object('code', 'owner_pattern_context', 'ok', ok,
      'detail', 'at least two groups must carry mileage or age context');
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'calcar_synthesis' then
    ok := n_support >= 2 and n_support_types >= 2;
    rules := rules || jsonb_build_object('code', 'synthesis_support', 'ok', ok,
      'detail', 'needs at least two supporting published claims of two knowledge types');
    passed := passed and ok;
    ok := coalesce(btrim(c.reviewer), '') <> '';
    rules := rules || jsonb_build_object('code', 'human_review', 'ok', ok,
      'detail', 'synthesis requires a named reviewer in v1');
    passed := passed and ok;
  end if;

  return jsonb_build_object('passed', passed, 'checked_at', now(), 'rules', rules);
end $$;

create or replace function mi.publish_candidate(
  p_candidate_id bigint, p_reviewer text, p_override_reason text default null)
returns bigint
language plpgsql security definer set search_path = pg_catalog, mi, public as $$
declare
  c mi.candidate_claim%rowtype;
  gate jsonb; sig text; key text;
  existing_id bigint; snap_id bigint; batch_id bigint; new_id bigint;
  sup_id bigint; n_ev int := 0;
begin
  if coalesce(btrim(p_reviewer), '') = '' then
    raise exception 'reviewer is required';
  end if;

  select * into c from mi.candidate_claim where id = p_candidate_id for update;
  if not found then raise exception 'candidate % not found', p_candidate_id; end if;
  if c.review_status in ('approved', 'rejected', 'merged') then
    raise exception 'candidate % is already %', p_candidate_id, c.review_status;
  end if;

  update mi.candidate_claim set reviewer = p_reviewer where id = p_candidate_id;
  c.reviewer := p_reviewer;

  gate := mi.check_gate(p_candidate_id);
  update mi.candidate_claim
     set gate_result = gate, gate_checked_at = now(), review_status = 'gate_pending'
   where id = p_candidate_id;

  if not (gate->>'passed')::boolean then
    if coalesce(btrim(p_override_reason), '') = '' then
      raise exception 'quality gate failed for candidate %: %', p_candidate_id, gate->'rules';
    end if;
    update mi.candidate_claim
       set review_note = concat_ws(' | ', review_note, 'gate override: ' || p_override_reason)
     where id = p_candidate_id;
  end if;

  sig := mi.applicability_signature(c.proposed_applicability);
  key := mi.dedup_key(c.resolved_subject_id, c.proposed_knowledge_type, c.proposed_layer,
                      sig, c.text_en, c.value_kind);

  -- Дедуплікація: те саме твердження про той самий subject з тією самою
  -- застосовністю не створює другий опублікований клейм.
  select id into existing_id from mi.claim
   where dedup_key = key and status = 'published' limit 1;

  if existing_id is not null then
    insert into mi.evidence (claim_id, source_id, stance, excerpt, excerpt_lang,
                             independence_group, context, retrieved_at)
    select existing_id, ce.source_id, ce.stance, ce.excerpt, ce.excerpt_lang,
           ce.independence_group, ce.context, now()
      from mi.candidate_evidence ce
     where ce.candidate_id = p_candidate_id
    on conflict on constraint evidence_key do nothing;

    update mi.candidate_claim
       set review_status = 'merged', merge_into_claim_id = existing_id,
           published_claim_id = null, reviewed_at = now()
     where id = p_candidate_id;
    return existing_id;
  end if;

  insert into mi.knowledge_snapshot (note) values ('publish candidate ' || p_candidate_id)
    returning id into snap_id;
  insert into mi.publish_batch (snapshot_id, actor) values (snap_id, p_reviewer)
    returning id into batch_id;

  -- Контекст публікації: лише всередині нього сторожі пропускають запис
  -- канонічного знання. Він локальний для транзакції.
  perform set_config('mi.publish_context', batch_id::text, true);

  insert into mi.claim (subject_id, knowledge_type, text_en, normalized_assertion,
      value_kind, structured_value, confidence, buyer_implication_en, buyer_importance,
      layer, causal_status, propagation, propagation_note, status, dedup_key,
      applicability_signature, published_snapshot_id, reviewed_at, reviewed_by, review_note)
  values (c.resolved_subject_id, c.proposed_knowledge_type, c.text_en,
      mi.normalize_assertion(c.text_en), c.value_kind, c.structured_value,
      coalesce(c.proposed_confidence, 'low'), null, 3,
      c.proposed_layer, c.proposed_causal_status, c.proposed_propagation,
      case when c.proposed_propagation = 'exact' then null else c.review_note end,
      'published', key, sig, snap_id, now(), p_reviewer, c.review_note)
  returning id into new_id;

  if c.proposed_applicability is not null then
    insert into mi.claim_applicability (claim_id, group_no, dimension, operator, config_scope,
        ref_subject_id, include_revisions, attr_key, attr_value, tag,
        value_date_from, value_date_to, value_num_from, value_num_to,
        value_from_kind, value_to_kind)
    select new_id,
      coalesce((e->>'group_no')::smallint, 1),
      (e->>'dimension')::mi.identity_dimension,
      (e->>'operator')::mi.pred_operator,
      coalesce((e->>'config_scope')::mi.config_slot, 'current'),
      (e->>'ref_subject_id')::bigint,
      coalesce((e->>'include_revisions')::boolean, false),
      e->>'attr_key', e->>'attr_value', e->>'tag',
      (e->>'value_date_from')::date, (e->>'value_date_to')::date,
      (e->>'value_num_from')::numeric, (e->>'value_num_to')::numeric,
      (e->>'value_from_kind')::mi.boundary_kind, (e->>'value_to_kind')::mi.boundary_kind
    from jsonb_array_elements(c.proposed_applicability) e;
  end if;

  insert into mi.evidence (claim_id, source_id, stance, excerpt, excerpt_lang,
                           independence_group, context, retrieved_at)
  select new_id, ce.source_id, ce.stance, ce.excerpt, ce.excerpt_lang,
         ce.independence_group, ce.context, now()
    from mi.candidate_evidence ce where ce.candidate_id = p_candidate_id;
  get diagnostics n_ev = row_count;

  if c.proposed_links ? 'links' then
    insert into mi.claim_link (claim_id, target_subject_id, role_code)
    select new_id, (e->>'target_subject_id')::bigint, e->>'role_code'
      from jsonb_array_elements(c.proposed_links->'links') e
    on conflict on constraint claim_link_key do nothing;
  end if;

  if c.proposed_knowledge_type = 'calcar_synthesis' and c.proposed_links ? 'supports' then
    insert into mi.claim_support (synthesis_claim_id, supporting_claim_id)
    select new_id, t.v::bigint
      from jsonb_array_elements_text(c.proposed_links->'supports') t(v)
    on conflict do nothing;
  end if;

  -- Успадкування: старий клейм не переписується, а стає superseded.
  if c.proposed_links ? 'supersedes' then
    sup_id := (c.proposed_links->>'supersedes')::bigint;
    update mi.claim set supersedes_id = sup_id where id = new_id;
    update mi.claim
       set status = 'superseded', superseded_by_id = new_id,
           effective_to = current_date, effective_to_kind = 'known'
     where id = sup_id and status = 'published';
    if not found then
      raise exception 'claim % cannot be superseded: not published', sup_id;
    end if;
  end if;

  perform mi.recompute_recurrence(new_id);

  update mi.candidate_claim
     set review_status = 'approved', published_claim_id = new_id, reviewed_at = now()
   where id = p_candidate_id;

  perform set_config('mi.publish_context', '', true);
  return new_id;
end $$;

-- Колонки прибираються останніми: до цього моменту функції вже не
-- посилаються на них.
alter table mi.candidate_claim drop constraint if exists candidate_claim_importance_ck;

alter table mi.candidate_claim
  drop column if exists proposed_contested_note_en,
  drop column if exists proposed_contested,
  drop column if exists proposed_buyer_implication_en,
  drop column if exists proposed_buyer_importance;
