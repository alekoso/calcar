-- Відкат міграції 20: повернення мосту з міграції 018.

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

  -- 2.1. Модельний рік із декодера.
  v_year := coalesce(v.model_year, v.year);
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

  return jsonb_build_object('vin', p_vin, 'written', n_written, 'version_match', m);
end $$;
