-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Імітація того, що продакшн-Check УЖЕ зберігає після перевірки
-- оголошення: рядок `vehicles` із декодом NHTSA, знімок оголошення і,
-- де це було, аукціонна подія. Нічого нового не вигадано: набір полів
-- рівно той, який пише `api/vehicle-memory.js` і `api/check.js`.
--
-- VIN синтетичні. Значення декоду взяті у тій формі, у якій їх віддає
-- vPIC: Make, Model, Trim, Series, ModelYear.

create schema if not exists mi_test;

create or replace function mi_test.seed_check(
  p_vin text, p_make text, p_model text, p_trim text, p_series text,
  p_year int, p_domain text, p_country text, p_price numeric, p_odo int,
  p_auction_house text default null, p_lot text default null,
  p_sale_date date default null)
returns void language plpgsql as $$
declare v_listing uuid; v_snap uuid;
begin
  delete from public.vehicle_identity_observation where vin = p_vin;
  delete from public.auction_events where vin = p_vin;
  delete from public.vehicle_snapshots where vin = p_vin;
  delete from public.listings where vin = p_vin;
  delete from public.vehicles where vin = p_vin;

  -- Рядок Vehicle у тому вигляді, як його пише upsertVehicle після декоду.
  insert into public.vehicles (vin, make, model, year, model_year, trim, nhtsa,
      decoder_version, first_seen_at, last_seen_at, snapshots_count)
  values (p_vin, p_make, p_model, p_year, p_year, p_trim,
      jsonb_strip_nulls(jsonb_build_object('Make', p_make, 'Model', p_model,
        'Trim', p_trim, 'Series', p_series, 'ModelYear', p_year::text)),
      'vpic-v1', '2026-02-10', '2026-02-10', 1);

  insert into public.listings (vin, source, source_listing_id, url,
      first_seen_at, last_seen_at, current_status)
  values (p_vin, p_domain, 'L-' || right(p_vin, 5),
      'https://' || p_domain || '/L-' || right(p_vin, 5),
      '2026-02-10', '2026-02-10', 'active')
  returning id into v_listing;

  insert into public.vehicle_snapshots (captured_at, vin, source_url, source_domain,
      country, price_amount, price_currency, odometer_km, year, make, model,
      listing, photos, listing_id, listing_fingerprint, first_seen_at, last_seen_at, seen_count)
  values ('2026-02-10', p_vin, 'https://' || p_domain || '/L-' || right(p_vin, 5), p_domain,
      p_country, p_price, 'USD', p_odo, p_year, p_make, p_model,
      jsonb_build_object('title', p_make || ' ' || p_model), '["a.jpg"]'::jsonb,
      v_listing, 'lf-v1:seed', '2026-02-10', '2026-02-10', 1)
  returning id into v_snap;

  if p_auction_house is not null then
    insert into public.auction_events (auction_house, lot_id, vin, sale_date,
        odometer_value, odometer_unit, odometer_status, title_status,
        source_urls, record, first_seen_at, checked_at)
    values (p_auction_house, p_lot, p_vin, p_sale_date,
        round(p_odo / 1.609344), 'mi', 'actual', 'CLEAN',
        jsonb_build_array('https://' || p_auction_house || '.test/' || p_lot),
        '{}'::jsonb, '2026-02-10', '2026-02-10');
  end if;
end $$;

-- Три еталонні машини у тому вигляді, у якому їх побачив би Check,
-- плюс одна машина, якої Model Intelligence не знає взагалі.
create or replace function mi_test.seed_all_checks() returns void language plpgsql as $$
begin
  perform mi_test.seed_check('WBAJB9C50JB0S0001', 'BMW', '5-Series', 'M550i xDrive', 'M550i xDrive',
      2018, 'autoscout', 'US', 41000, 120000, 'copart', 'LOT-A1', date '2025-11-02');
  perform mi_test.seed_check('5YJSA1E28FF0S0002', 'Tesla', 'Model S', 'P85D', 'P85D',
      2015, 'cars', 'UA', 21000, 150000, 'copart', 'LOT-A2', date '2025-08-14');
  perform mi_test.seed_check('WP1AD2A2XDL0S0003', 'Porsche', 'Cayenne', 'GTS', 'GTS',
      2013, 'mobile', 'US', 32000, 140000, 'iaai', 'LOT-A3', date '2025-06-01');
  -- Машина поза корпусом: очікується чесне мовчання.
  perform mi_test.seed_check('WVWZZZ1KZAW0S0004', 'Volkswagen', 'Golf', 'GTI', 'GTI',
      2010, 'mobile', 'EU', 9000, 210000, null, null, null);
end $$;
