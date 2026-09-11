-- Відкат міграції 14: повертає mi.pack_bucket і mi.compile_pack до
-- версій міграції 13. Схема не чіпалась, тому більше нічого не потрібно.
-- Практично: застосуйте 013_check_retrieval.up.sql ще раз.

create or replace function mi.pack_bucket(p_area text, p_kind text)
returns jsonb language plpgsql stable as $$
declare res jsonb; cond text;
begin
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
             'check_subject_id', (p.entry->>'check_subject_id')::bigint,
             'entry_source', coalesce(p.entry->>'entry_source', 'claim'),
             'text', p.entry->>'text_en',
             'knowledge_type', p.entry->>'knowledge_type',
             'confidence', p.entry->>'confidence',
             'buyer_importance', (p.entry->>'buyer_importance')::int,
             'buyer_implication', p.entry->>'buyer_implication_en',
             'status', p.status,
             'basis', p.basis,
             'condition_text', case when p.status = 'CONDITIONAL'
                                    then mi.condition_text(p.preds) else null end,
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
      from tmp_pick p
     where (%s) and (%L is null or p.area = %L)
  $q$, cond, p_area, p_area) into res;
  return res;
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

  -- Канонічні перевірки оцінюються тими самими правилами і входять у
  -- ту саму таблицю відбору. Клейм про перевірку для цього не потрібен.
  insert into tmp_eval
  select null::bigint,
         cv->>'status', cv->>'basis', e->>'area',
         (e->>'buyer_importance')::smallint,
         'check_item',
         null,
         e->>'priority',
         jsonb_build_object(
           'subject_kind', 'check_item',
           'check_subject_id', (e->>'check_id')::bigint,
           'text_en', e->>'why_en',
           'buyer_importance', (e->>'buyer_importance')::int,
           'entry_source', 'catalogue',
           'check', jsonb_build_object(
             'method', e->>'method', 'why_en', e->>'why_en',
             'proves_en', e->>'proves_en', 'cannot_prove_en', e->>'cannot_prove_en',
             'conditions', e->'conditions', 'priority', e->>'priority',
             'materially_resolves', (e->>'materially_resolves')::boolean,
             'resolves_dimension', e->>'resolves_dimension',
             'covers', e->'covers', 'claims', e->'claims')),
         cv->'predicates'
    from jsonb_array_elements(frag.payload->'checks') e,
         lateral mi.eval_check((e->>'check_id')::bigint, p_identity) cv;

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
    status text, basis text, preds jsonb
  ) on commit drop;
  delete from tmp_pick;

  insert into tmp_pick
  select coalesce(t.claim_id, -(t.entry->>'check_subject_id')::bigint),
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
   where t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
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
