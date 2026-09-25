-- Відкат міграції 27: дослівні тексти compile_pack (026), vm_observations
-- (016) і resolve_identity (024), потім прибрати входи, функції, таблицю
-- пакетів і колонку цінності. Спостереження обладнання у
-- public.vehicle_identity_observation лишаються: відкат не переписує даних,
-- а без предмета каталогу адаптер 016 їх і так не розвʼязує у subject.

drop function if exists public.mi_record_equipment(text, jsonb);
drop function if exists public.mi_equipment_candidates(text);
drop function if exists mi.record_equipment(text, jsonb);
drop function if exists mi.equipment_candidates_for_vin(text);

create or replace function mi.compile_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare
  v_vmy bigint; frag mi.pack_fragment%rowtype; cfg jsonb;
  v_log jsonb := '[]'::jsonb; v_pack jsonb;
  n_total int; n_kept int; n_elig int; n_cap int; n_status_out int; n_merged int;
  v_partial jsonb; v_excl jsonb;
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
    -- Міграція 26: відомий модельний рік, якого немає серед років версії,
    -- суперечить самій версії. Застосовність версії NO_MATCH, частковий
    -- пакет цієї версії не будується. Невідомий рік нічого не виключає.
    v_excl := mi.version_year_exclusion(p_identity);
    if v_excl is not null then
      return v_excl;
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

create or replace function mi.vm_observations(
  p_vin text,
  p_as_of_event timestamptz default null,
  p_as_of_knowledge timestamptz default null)
returns jsonb language plpgsql stable as $$
declare res jsonb := '[]'::jsonb;
  ev timestamptz := coalesce(p_as_of_event, 'infinity'::timestamptz);
  kn timestamptz := coalesce(p_as_of_knowledge, 'infinity'::timestamptz);
begin
  -- 3.1. Ідентичність: дата виробництва, ринки, рік, ієрархія.
  -- Значення, що йде у резолвер як subject, шукається у каталозі за
  -- кодом; те, чого каталог не знає, лишається текстом і резолвер
  -- чесно не розвʼяже його у subject.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(o.source_ref, o.source_kind),
             'source_type', o.source_kind,
             'dimension', o.dimension,
             'slot', 'na',
             'observed_at', o.observed_at::date,
             'confidence', coalesce(o.confidence, 'medium'),
             'provenance_root', o.provenance_root,
             'value_subject', case o.dimension
               when 'version' then (select subject_id from mi.vehicle_version where version_code = o.value_text)
               when 'generation' then (select subject_id from mi.generation where platform_code = o.value_text and phase = 'base')
               else null end,
             'value_text', case when o.dimension in ('version', 'generation') then null else o.value_text end,
             'value_num', o.value_num,
             'value_date', o.value_date,
             'value_bool', o.value_bool))
             order by o.observed_at, o.id)
      from public.vehicle_identity_observation o
     where o.vin = p_vin and o.invalidated_at is null
       and o.observed_at <= ev and o.ingested_at <= kn), '[]'::jsonb);

  -- 3.2. Компоненти. Заводське спостереження лягає у слот factory,
  -- поточне і заміна у слот current. Заводський рядок при заміні НЕ
  -- зникає: це два різні спостереження, і обидва доходять до резолвера.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(c.source_ref, c.source_kind),
             'source_type', c.source_kind,
             'dimension', 'component_variant',
             'role', c.role_code,
             'slot', case when c.observation_kind = 'factory' then 'factory' else 'current' end,
             'observed_at', c.observed_at::date,
             'confidence', coalesce(c.confidence, 'medium'),
             'provenance_root', c.provenance_root,
             'value_subject', (select subject_id from mi.component_variant where variant_code = c.variant_code)))
             order by c.observed_at, c.id)
      from public.component_observation c
     where c.vin = p_vin and c.invalidated_at is null
       and c.state = 'PRESENT' and c.variant_code is not null
       and c.observed_at <= ev and c.ingested_at <= kn), '[]'::jsonb);

  -- 3.3. Задокументовані події заміни з mi_vm: тип стану знає, який
  -- варіант лишається після нього, і саме він іде у поточний слот.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(s.source_kind, 'vehicle_memory'),
             'source_type', 'vehicle_memory',
             'dimension', 'component_variant',
             'role', coalesce(s.role_code, cr.code),
             'slot', 'current',
             'observed_at', s.occurred_on,
             'confidence', s.confidence::text,
             'provenance_root', 'vm_state:' || s.id::text,
             'value_subject', st.resulting_variant_id))
             order by s.occurred_on nulls last, s.id)
      from mi_vm.component_state_instance s
      join mi.component_state_type st on st.subject_id = s.state_type_id
      left join mi.component_role cr on cr.code = s.role_code
     where s.vin = p_vin and st.resulting_variant_id is not null
       and coalesce(s.occurred_on::timestamptz, s.created_at) <= ev
       and s.created_at <= kn), '[]'::jsonb);

  -- 3.4. Сам факт стану як стан: резолвер уміє його прийняти окремо.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(s.source_kind, 'vehicle_memory'),
             'source_type', 'vehicle_memory',
             'dimension', 'component_state_present',
             'slot', 'na',
             'observed_at', s.occurred_on,
             'confidence', s.confidence::text,
             'provenance_root', 'vm_state:' || s.id::text,
             'value_subject', s.state_type_id,
             'value_bool', true))
             order by s.id)
      from mi_vm.component_state_instance s
     where s.vin = p_vin
       and coalesce(s.occurred_on::timestamptz, s.created_at) <= ev
       and s.created_at <= kn), '[]'::jsonb);

  -- 3.5. Права. Береться найсвіжіша перевірка кожного права у межах
  -- обраних зрізів: право це стан, а не подія, і історія лежить поруч.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(e.source_kind, 'manufacturer'),
             'source_type', coalesce(e.source_kind, 'manufacturer'),
             'dimension', 'entitlement_state',
             'slot', 'na',
             'observed_at', e.checked_at::date,
             'confidence', 'high',
             'provenance_root', 'vm_entitlement:' || e.entitlement_id::text,
             'value_subject', e.entitlement_id,
             'value_text', e.state::text))
             order by e.entitlement_id)
      from (select distinct on (entitlement_id) * from mi_vm.entitlement_state
             where vin = p_vin and checked_at <= ev and checked_at <= kn
             order by entitlement_id, checked_at desc) e), '[]'::jsonb);

  -- 3.6. Пробіг і ринок експлуатації з історії оголошень і аукціонів.
  -- Знімок несе час знання у captured_at; дати публікації оголошення у
  -- памʼяті немає, тому для нього обидва зрізи це captured_at.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', 'snapshot:' || v.id::text,
             'source_type', 'listing',
             'dimension', 'mileage_km',
             'slot', 'na',
             'observed_at', v.captured_at::date,
             'confidence', 'medium',
             'provenance_root', 'listing:' || coalesce(v.listing_id::text, v.source_url),
             'value_num', v.odometer_km))
             order by v.captured_at desc)
      from (select * from public.vehicle_snapshots
             where vin = p_vin and odometer_km is not null
               and captured_at <= ev and captured_at <= kn
             order by captured_at desc limit 1) v), '[]'::jsonb);

  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', 'auction:' || a.auction_house || ':' || a.lot_id,
             'source_type', 'auction',
             'dimension', 'mileage_km',
             'slot', 'na',
             'observed_at', a.sale_date,
             'confidence', case a.odometer_status when 'actual' then 'high' else 'low' end,
             'provenance_root', 'auction:' || a.auction_house || ':' || a.lot_id,
             'value_num', case when a.odometer_unit = 'mi'
                               then round(a.odometer_value * 1.609344)
                               else a.odometer_value end))
             order by a.sale_date desc)
      from public.auction_events a
     where a.vin = p_vin and a.odometer_value is not null
       and coalesce(a.sale_date::timestamptz, a.first_seen_at) <= ev
       and a.first_seen_at <= kn), '[]'::jsonb);

  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', 'auction:' || a.auction_house || ':' || a.lot_id,
             'source_type', 'auction',
             'dimension', 'salvage_status',
             'slot', 'na',
             'observed_at', a.sale_date,
             'confidence', 'high',
             'provenance_root', 'auction:' || a.auction_house || ':' || a.lot_id,
             'value_bool', true))
             order by a.sale_date desc)
      from public.auction_events a
     where a.vin = p_vin and a.title_status is not null
       and a.title_status ~* 'salvage|junk|rebuilt'
       and coalesce(a.sale_date::timestamptz, a.first_seen_at) <= ev
       and a.first_seen_at <= kn), '[]'::jsonb);

  return res;
end $$;

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

drop function if exists mi.equipment_candidates(jsonb);
drop function if exists mi.equipment_item_by_ref(text);
drop trigger if exists equipment_availability_packages_ck on mi.equipment_availability;
drop function if exists mi.equipment_availability_packages_ck();
alter table mi.equipment_availability drop column if exists package_ids;
alter table mi.equipment_item drop constraint if exists equipment_item_value_tier_ck;
alter table mi.equipment_item drop column if exists value_tier;
