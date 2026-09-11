-- Відкат міграції 23: попередні тексти функцій, нові прибираються.

create or replace function mi.source_rank(p_category text, p_source_type text)
returns int language sql immutable as $$
  select coalesce(case p_category

    when 'factory_identity' then case p_source_type
      when 'vin_decoder'      then 100
      when 'build_sheet'      then 95
      when 'manufacturer'     then 95
      when 'auction'          then 70
      when 'user'             then 60
      when 'vehicle_memory'   then 55
      when 'listing'          then 40
      when 'catalog'          then 20
      when 'historical_vision' then 0
      when 'current_vision'   then 0
      else 0 end

    when 'current_hardware' then case p_source_type
      when 'vehicle_memory'   then 100
      when 'diagnostics'      then 95
      when 'user'             then 85
      when 'current_vision'   then 80
      when 'build_sheet'      then 55
      when 'historical_vision' then 50
      when 'auction'          then 40
      when 'listing'          then 30
      when 'manufacturer'     then 30
      when 'vin_decoder'      then 10
      else 0 end

    -- Право це запис у системах виробника, а не залізо. Жодне
    -- спостереження заліза не має тут ваги взагалі.
    when 'entitlement' then case p_source_type
      when 'manufacturer'     then 100
      when 'vehicle_memory'   then 90
      when 'user'             then 70
      when 'auction'          then 50
      when 'listing'          then 25
      else 0 end

    when 'scalar' then case p_source_type
      when 'vehicle_memory'   then 90
      when 'diagnostics'      then 85
      when 'auction'          then 70
      when 'user'             then 65
      when 'listing'          then 50
      when 'vin_decoder'      then 40
      when 'current_vision'   then 30
      else 0 end

    else 0 end, 0);
$$;

create or replace function mi.resolve_dimension(p_obs jsonb, p_category text)
returns jsonb language plpgsql stable as $$
declare
  best jsonb; second jsonb; n_values int;
  conf_thr int := mi.confirm_threshold(p_category);
  strong_thr int := mi.strong_threshold(p_category);
  status text; note text := null;
begin
  -- Дедуплікація за коренем походження: з кожного кореня лишається лише
  -- найсильніше спостереження. Переписане оголошення не подвоює доказ.
  with deduped as (
    select distinct on (coalesce(o->>'provenance_root', o->>'source'))
           o, mi.source_rank(p_category, o->>'source_type') as rank
      from jsonb_array_elements(p_obs) o
     order by coalesce(o->>'provenance_root', o->>'source'),
              mi.source_rank(p_category, o->>'source_type') desc,
              o->>'source'
  ),
  grouped as (
    select coalesce(o->>'value_subject', o->>'value_text', o->>'value_num',
                    o->>'value_date', o->>'value_bool', 'null') as vkey,
           max(rank) as rank,
           jsonb_agg(jsonb_build_object('source', o->>'source',
                       'source_type', o->>'source_type',
                       'observed_at', o->>'observed_at',
                       'confidence', o->>'confidence',
                       'provenance_root', o->>'provenance_root',
                       'rank', rank) order by rank desc) as obs,
           (array_agg(o order by rank desc))[1] as sample
      from deduped group by 1
  )
  select (select to_jsonb(g) from grouped g order by g.rank desc, g.vkey limit 1),
         (select to_jsonb(g) from grouped g order by g.rank desc, g.vkey offset 1 limit 1),
         (select count(*) from grouped)
    into best, second, n_values;

  if best is null then
    return jsonb_build_object('status', 'unresolved', 'basis', 'no observation',
      'supporting', '[]'::jsonb, 'conflicting', '[]'::jsonb, 'candidates', '[]'::jsonb);
  end if;

  if n_values > 1
     and (best->>'rank')::int >= strong_thr
     and (second->>'rank')::int >= strong_thr then
    status := 'conflicted';
    note := format('two sources of comparable strength disagree: rank %s against rank %s',
                   best->>'rank', second->>'rank');
  elsif (best->>'rank')::int >= conf_thr then
    status := 'confirmed';
  else
    status := 'unresolved';
    note := format('strongest observation has rank %s, below the threshold of %s',
                   best->>'rank', conf_thr);
  end if;

  return jsonb_build_object(
    'status', status,
    'basis', coalesce(best->'sample'->>'source_type', 'unknown'),
    'value_subject', case when status = 'conflicted' then null
                          else (best->'sample'->>'value_subject')::bigint end,
    'value_text', case when status = 'conflicted' then null else best->'sample'->>'value_text' end,
    'value_num', case when status = 'conflicted' then null
                      else (best->'sample'->>'value_num')::numeric end,
    'value_date', case when status = 'conflicted' then null
                       else (best->'sample'->>'value_date')::date end,
    'value_bool', case when status = 'conflicted' then null
                       else (best->'sample'->>'value_bool')::boolean end,
    'confidence', coalesce(best->'sample'->>'confidence', 'low'),
    'supporting', best->'obs',
    'conflicting', coalesce(second->'obs', '[]'::jsonb),
    -- Обидві сторони конфлікту зберігаються: резолвер не обирає сам.
    'candidates', case when n_values > 1 then jsonb_build_array(
                         jsonb_build_object('value', best->>'vkey', 'rank', best->>'rank'),
                         jsonb_build_object('value', second->>'vkey', 'rank', second->>'rank'))
                       else '[]'::jsonb end,
    'note', note);
end $$;

create or replace function mi.identity_json(p_identity bigint)
returns jsonb language plpgsql stable as $$
declare res jsonb;
begin
  select jsonb_strip_nulls(jsonb_build_object(
    'identity_id', p_identity,
    'vin', (select vin from mi_vm.resolved_identity where id = p_identity),
    'identity_version', (select identity_version from mi_vm.resolved_identity where id = p_identity),
    'brand',       mi.identity_subject(p_identity, 'brand'),
    'model_line',  mi.identity_subject(p_identity, 'model_line'),
    'generation',  mi.identity_subject(p_identity, 'generation'),
    'version',     mi.identity_subject(p_identity, 'version'),
    'vmy',         mi.identity_subject(p_identity, 'vmy'),
    'market_sold',     mi.identity_text(p_identity, 'market_sold'),
    'market_operated', mi.identity_text(p_identity, 'market_operated'),
    'production_date', mi.identity_date(p_identity, 'production_date'),
    'first_sale_date', mi.identity_date(p_identity, 'first_sale_date'),
    'model_year',  mi.identity_num(p_identity, 'model_year'),
    'mileage_km',  mi.identity_num(p_identity, 'mileage_km'),
    'age_years',   mi.identity_num(p_identity, 'age_years'),
    'salvage_status', (select value_bool from mi_vm.resolved_identity_dimension
                        where identity_id = p_identity and dimension = 'salvage_status'
                          and resolution_status = 'confirmed' limit 1),
    'condition_tags', (select jsonb_agg(value_text order by value_text)
                         from mi_vm.resolved_identity_dimension
                        where identity_id = p_identity and dimension = 'condition_tag'
                          and resolution_status = 'confirmed'
                          and coalesce(value_bool, true)),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('role', role_code, 'slot', slot,
               'variant', value_subject_id, 'status', resolution_status)
               order by role_code, slot)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension = 'component_variant'
         and role_code is not null), '[]'::jsonb),
    'equipment', coalesce((
      select jsonb_agg(jsonb_build_object('item', value_subject_id,
               'present', case when dimension = 'equipment_absent'
                               then not coalesce(value_bool, true)
                               else coalesce(value_bool, true) end,
               'slot', slot, 'status', resolution_status) order by value_subject_id, slot)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension in ('equipment_present', 'equipment_absent')
         and slot = 'current'), '[]'::jsonb),
    'entitlements', coalesce((
      select jsonb_agg(jsonb_build_object('entitlement', value_subject_id,
               'state', coalesce(value_text, 'unknown')) order by value_subject_id)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension = 'entitlement_state'
         and resolution_status = 'confirmed'), '[]'::jsonb),
    'states', coalesce((
      select jsonb_agg(jsonb_build_object('state_type', value_subject_id,
               'present', coalesce(value_bool, true)) order by value_subject_id)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension = 'component_state_present'
         and resolution_status = 'confirmed'), '[]'::jsonb)
  )) into res;
  return res;
end $$;

create or replace function mi.identity_summary(p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare lines jsonb := '[]'::jsonb; c jsonb; vname text; nm text;
begin
  select label into vname from mi.knowledge_subject where id = (p_identity->>'vmy')::bigint;

  for c in select e from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
           where e->>'slot' = 'current' order by e->>'role' loop
    select label into nm from mi.knowledge_subject where id = (c->>'variant')::bigint;
    lines := lines || jsonb_build_object(
      'role', c->>'role',
      'slot', 'current',
      'variant', nm,
      'resolution_status', c->>'status',
      'assumption_strength', (select assumption_strength from mi.component_role where code = c->>'role'),
      'line', case c->>'status'
        when 'assumed_factory' then 'ASSUMED FACTORY: ' || coalesce(nm, 'unknown')
                                    || ', no sign of replacement was observed.'
        when 'conflicted' then 'CONFLICTED: ' || (c->>'role') || ' has two sources that disagree.'
        when 'unresolved' then 'UNRESOLVED: ' || (c->>'role') || ' could not be established.'
        else 'CONFIRMED: ' || coalesce(nm, 'unknown') end);
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'vmy', vname,
    'market_sold', p_identity->>'market_sold',
    'market_operated', p_identity->>'market_operated',
    'production_date', p_identity->>'production_date',
    'model_year', p_identity->>'model_year',
    'mileage_km', p_identity->>'mileage_km',
    'age_years', p_identity->>'age_years',
    'salvage_status', p_identity->'salvage_status',
    'condition_tags', p_identity->'condition_tags',
    'components', lines));
end $$;

create or replace function mi.ingest_identity_from_check(p_vin text)
returns jsonb language plpgsql as $$
declare
  v record; snap record; auc record; m jsonb;
  n_written int := 0; v_year int; cands text[]; v_market text;
  decoded_at timestamptz;
begin
  select * into v from public.vehicles where vin = p_vin;
  if not found then
    return jsonb_build_object('vin', p_vin, 'written', 0, 'note', 'no vehicle row');
  end if;
  decoded_at := coalesce(v.first_seen_at, now());

  -- 2.1. Модельний рік ЛИШЕ з декодера. `vehicles.year` пише оголошення
  -- (рік першої реєстрації або рік із заголовка), і модельним роком він
  -- не є: хибний рік прибирає кандидатні VMY і разом із ними знання.
  -- `vehicles.model_year` пише Check з ModelYear декоду NHTSA.
  v_year := coalesce(v.model_year,
    case when coalesce(v.nhtsa->>'ModelYear', '') ~ '^[0-9]{4}$'
         then (v.nhtsa->>'ModelYear')::int end);
  if v_year is not null and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'model_year'
         and o.source_kind = 'vin_decoder' and o.value_num = v_year) then
    perform mi.vm_record_identity(p_vin, 'model_year', 'vin_decoder', null, v_year, null, null,
      decoded_at, 'high', 'vin:' || p_vin, 'nhtsa', v.decoder_version, null, decoded_at);
    n_written := n_written + 1;
  end if;

  -- 2.2. Версія. Кандидати беруться з нормалізованих колонок і з декоду;
  -- жоден із них не є здогадкою, це рядки, які вже лежать у базі.
  cands := array_remove(array[
    v.trim, v.model, nullif(btrim(coalesce(v.model, '') || ' ' || coalesce(v.trim, '')), ''),
    v.nhtsa->>'Series', v.nhtsa->>'Trim', v.nhtsa->>'Model',
    nullif(btrim(coalesce(v.nhtsa->>'Model', '') || ' ' || coalesce(v.nhtsa->>'Trim', '')), '')
  ], null);
  m := mi.match_version(coalesce(v.make, v.nhtsa->>'Make'), cands, v_year);

  if (m->>'version_id') is not null and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'version' and o.source_kind = 'vin_decoder') then
    perform mi.vm_record_identity(p_vin, 'version', 'vin_decoder',
      (select version_code from mi.vehicle_version where subject_id = (m->>'version_id')::bigint),
      null, null, null, decoded_at, 'high', 'vin:' || p_vin,
      'nhtsa:' || coalesce(m->>'matched_by', 'unknown'), v.decoder_version, null, decoded_at);
    n_written := n_written + 1;
  end if;

  -- 2.3. Ринок продажу. Декодер його НЕ дає: країна складання це не
  -- ринок продажу. Єдине чесне джерело у наявних даних це аукціон:
  -- лот у США означає, що машина продавалась на ринку США.
  select * into auc from public.auction_events
   where vin = p_vin order by coalesce(sale_date, first_seen_at::date) asc limit 1;
  if found then
    v_market := case when lower(auc.auction_house) in ('copart', 'iaai', 'iaa') then 'US' else null end;
    if v_market is not null and not exists (
        select 1 from public.vehicle_identity_observation o
         where o.vin = p_vin and o.dimension = 'market_sold' and o.source_kind = 'auction') then
      perform mi.vm_record_identity(p_vin, 'market_sold', 'auction', v_market, null, null, null,
        coalesce(auc.sale_date::timestamptz, auc.first_seen_at), 'medium',
        'auction:' || auc.auction_house || ':' || auc.lot_id,
        auc.auction_house, null, null, auc.first_seen_at);
      n_written := n_written + 1;
    end if;
  end if;

  -- 2.4. Ринок експлуатації з найсвіжішого знімка оголошення.
  select * into snap from public.vehicle_snapshots
   where vin = p_vin and country is not null order by captured_at desc limit 1;
  if found and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'market_operated'
         and o.source_kind = 'listing' and o.value_text = snap.country) then
    perform mi.vm_record_identity(p_vin, 'market_operated', 'listing', snap.country, null, null, null,
      snap.captured_at, 'medium',
      'listing:' || coalesce(snap.listing_id::text, snap.source_url),
      snap.source_domain, null, snap.id, snap.captured_at);
    n_written := n_written + 1;
  end if;

  return jsonb_build_object('vin', p_vin, 'written', n_written, 'version_match', m,
    'model_year', v_year,
    'model_year_source', case when v_year is null then null else 'vin_decoder' end,
    -- Рік оголошення видно, але у памʼять як модельний рік він не йде.
    'listing_year_not_used', v.year);
end $$;

drop function if exists mi.match_version_text(text, text, text);
drop function if exists mi.tokens_contain(text[], text[]);
drop function if exists mi.text_tokens(text);
