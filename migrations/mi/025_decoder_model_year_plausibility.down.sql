-- Відкат міграції 25: міст повертається до версії міграції 023, помічники
-- правдоподібності прибираються. Рядки vehicle_identity_observation, уже
-- записані з invalidated_at, лишаються: відкат не переписує даних.

create or replace function mi.ingest_identity_from_check(p_vin text)
returns jsonb language plpgsql as $$
declare
  v record; snap record; auc record; m jsonb;
  n_written int := 0; v_year int; cands text[]; v_market text;
  decoded_at timestamptz;
  rep record; rm jsonb; rep_log jsonb := '[]'::jsonb;
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

  -- 2.2b. Версія з розбору Check: `reports.data->vehicle->trim`. Це
  -- висновок LLM, а не декод, тому джерело окреме (`check_inference`),
  -- довіра низька, а корінь походження це конкретний звіт. Версія пишеться
  -- лише тоді, коли текст називає рівно одну версію каталогу у межах
  -- бренду і модельного ряду. Різні формулювання однієї версії дають той
  -- самий version_code і тому не конфліктують. Резолвер нічого з LLM не
  -- вирішує: він бачить лише спостереження і їхню силу.
  for rep in
    select r.id, r.created_at, r.data->'vehicle'->>'trim' as trim_text
      from public.reports r
     where r.kind = 'check' and r.data->'_meta'->>'vin' = p_vin
       and coalesce(btrim(r.data->'vehicle'->>'trim'), '') <> ''
     order by r.created_at, r.id
  loop
    rm := mi.match_version_text(coalesce(v.make, v.nhtsa->>'Make'), v.model, rep.trim_text);
    rep_log := rep_log || jsonb_build_object('report_id', rep.id, 'text', rep.trim_text, 'match', rm);
    if (rm->>'version_id') is not null and not exists (
        select 1 from public.vehicle_identity_observation o
         where o.vin = p_vin and o.dimension = 'version' and o.source_kind = 'check_inference'
           and o.provenance_root = 'report:' || rep.id::text and o.invalidated_at is null) then
      perform mi.vm_record_identity(p_vin, 'version', 'check_inference',
        (select version_code from mi.vehicle_version where subject_id = (rm->>'version_id')::bigint),
        null, null, null, rep.created_at, 'low', 'report:' || rep.id::text,
        'report:' || rep.id::text, null, null, rep.created_at);
      n_written := n_written + 1;
    end if;
  end loop;

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
    'listing_year_not_used', v.year,
    'report_versions', rep_log);
end $$;

drop function if exists mi.decoder_model_year_plausibility(text, jsonb, int, int);
drop function if exists mi.vin_year_code_years(text);
