-- Відкат міграції 22: функції повертаються до попередніх текстів, нові прибираються.

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
  end if;
end $$;

create or replace function mi.compile_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare
  v_vmy bigint; frag mi.pack_fragment%rowtype; cfg jsonb;
  v_log jsonb := '[]'::jsonb; v_pack jsonb;
  n_total int; n_kept int; n_elig int; n_cap int; n_status_out int; n_merged int;
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

create or replace function mi.request_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare v_vmy bigint; res jsonb; v_reason mi.build_reason;
begin
  v_vmy := (p_identity->>'vmy')::bigint;
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
  if ident->>'vmy' is null then
    raise exception 'identity % has no resolved version, market and year', p_identity;
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

  if ident->>'vmy' is null then
    return jsonb_build_object(
      'vin', p_vin, 'mi_available', false, 'reason', 'identity_unresolved',
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
      'ingest', ing, 'identity_id', v_id, 'identity_summary', mi.identity_summary(ident));
  end if;

  return jsonb_build_object(
    'vin', p_vin, 'mi_available', true, 'identity_id', v_id,
    'ingest', ing,
    'identity_summary', dec->'pack'->'identity_summary',
    'coverage_statement', dec->'pack'->'coverage_statement',
    'decision', jsonb_build_object('meta', dec->'pack'->'pack_meta',
                                   'systems', dec->'pack'->'systems'),
    'report', jsonb_build_object('meta', rep->'pack'->'pack_meta',
                                 'systems', rep->'pack'->'systems'));
end $$;

drop function if exists mi.coverage_statement_from_gaps(jsonb, jsonb);
drop function if exists mi.build_partial_payload(jsonb, mi.pack_purpose);
drop function if exists mi.scope_admits(text, mi.subject_kind, mi.propagation);
drop function if exists mi.partial_scope(bigint, bigint[]);
drop function if exists mi.partial_candidates(jsonb);
