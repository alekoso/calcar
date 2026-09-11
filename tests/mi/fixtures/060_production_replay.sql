-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Phase 7.1: точна копія РЕАЛЬНИХ рядків продакшну для пʼяти VIN, які
-- за звітом Check відповідають трьом еталонним карткам. Дані зняті
-- читанням з продакшн-Supabase (проект jzgnigrkexqnzmxujjex) і не
-- підправлені: null лишаються null, регістр марки лишається як є.
--
-- Сенс фікстури: прогнати справжній вхід через справжній міст, не
-- чіпаючи продакшн, і побачити, що саме станеться з живими даними.
--
-- Що показав звіт Check по цих машинах (поле data->vehicle->modification):
--   WBAJB9C50JB049616  M550i xDrive, 4,4 л V8 455 к.с.
--   WBAJB9C51JB035787  M550i xDrive, 4,4 л V8 455 к.с.
--   WBAJB9C51JB049950  M550i xDrive, 4,4 л V8 455 к.с.
--   5YJSA1H23FFP69703  P85D, електро 85 кВт·год
--   WP1ZZZ92ZDLA45155  GTS 4.8 AT, 420 к.с.
-- Жодне з цих значень НЕ лежить у public.vehicles: воно є лише у звіті.

create schema if not exists mi_test;

create or replace function mi_test.seed_production_replay() returns void language plpgsql as $$
declare v_listing uuid;
begin
  delete from public.vehicle_identity_observation where vin in
    ('WBAJB9C50JB049616','WBAJB9C51JB035787','WBAJB9C51JB049950',
     '5YJSA1H23FFP69703','WP1ZZZ92ZDLA45155');
  delete from public.vehicle_snapshots where vin in
    ('WBAJB9C50JB049616','WBAJB9C51JB035787','WBAJB9C51JB049950',
     '5YJSA1H23FFP69703','WP1ZZZ92ZDLA45155');
  delete from public.listings where vin in
    ('WBAJB9C50JB049616','WBAJB9C51JB035787','WBAJB9C51JB049950',
     '5YJSA1H23FFP69703','WP1ZZZ92ZDLA45155');
  delete from public.vehicles where vin in
    ('WBAJB9C50JB049616','WBAJB9C51JB035787','WBAJB9C51JB049950',
     '5YJSA1H23FFP69703','WP1ZZZ92ZDLA45155');

  -- Три BMW: декод NHTSA взагалі відсутній, trim порожній.
  insert into public.vehicles (vin, make, model, year, model_year, trim, nhtsa,
      decoder_version, first_seen_at, last_seen_at, snapshots_count) values
    ('WBAJB9C50JB049616', 'bmw', '5 series', 2017, null, null, null, null,
     '2026-08-30 19:14:25.132675+00', '2026-09-01 13:57:42.615256+00', 11),
    ('WBAJB9C51JB035787', 'bmw', '5 series', 2017, null, null, null, null,
     '2026-08-20 19:21:17.106188+00', '2026-08-20 19:21:17.106188+00', 1),
    ('WBAJB9C51JB049950', 'bmw', '5 series', 2018, null, null, null, null,
     '2026-08-17 10:41:40.654238+00', '2026-08-17 10:41:40.654238+00', 1);

  -- Tesla: декод є, але модифікації в ньому немає.
  insert into public.vehicles (vin, make, model, year, model_year, trim, nhtsa,
      decoder_version, first_seen_at, last_seen_at, snapshots_count) values
    ('5YJSA1H23FFP69703', 'TESLA', 'Model S', 2015, 2015, null,
     '{"Make": "TESLA", "Model": "Model S", "BodyClass": "Hatchback/Liftback/Notchback",
       "ModelYear": "2015", "PlantCountry": "UNITED STATES (USA)",
       "FuelTypePrimary": "Electric", "ElectrificationLevel": "BEV (Battery Electric Vehicle)"}'::jsonb,
     'vpic-v1', '2026-09-03 12:22:11.214+00', '2026-09-03 12:22:11.214+00', 1);

  -- Porsche: декод є, але в ньому немає навіть моделі.
  insert into public.vehicles (vin, make, model, year, model_year, trim, nhtsa,
      decoder_version, first_seen_at, last_seen_at, snapshots_count) values
    ('WP1ZZZ92ZDLA45155', 'porsche', 'cayenne', 2013, 2013, null,
     '{"Make": "PORSCHE", "ModelYear": "2013", "PlantCountry": "GERMANY"}'::jsonb,
     'vpic-v1', '2026-08-26 19:46:03.591174+00', '2026-09-10 07:20:32.570477+00', 8);

  -- Знімки: усі auto.ria.com, країна UA. Аукціонних подій у жодної з
  -- цих машин у продакшні НЕМАЄ, тому їх тут теж немає.
  insert into public.listings (vin, source, source_listing_id, url,
      first_seen_at, last_seen_at, current_status)
  select v.vin, 'auto.ria.com', 'L-' || right(v.vin, 6),
         'https://auto.ria.com/L-' || right(v.vin, 6),
         v.first_seen_at, v.last_seen_at, 'active'
    from public.vehicles v
   where v.vin in ('WBAJB9C50JB049616','WBAJB9C51JB035787','WBAJB9C51JB049950',
                   '5YJSA1H23FFP69703','WP1ZZZ92ZDLA45155');

  insert into public.vehicle_snapshots (captured_at, vin, source_url, source_domain,
      country, price_amount, price_currency, odometer_km, year, make, model,
      listing, photos, listing_id, listing_fingerprint, first_seen_at, last_seen_at, seen_count)
  select v.last_seen_at, v.vin, l.url, 'auto.ria.com', 'UA',
         25000, 'USD', 125000, v.year, v.make, v.model,
         jsonb_build_object('title', 'auto.ria listing'), '["a.jpg"]'::jsonb,
         l.id, 'lf-v1:replay:' || v.vin, v.first_seen_at, v.last_seen_at, 1
    from public.vehicles v join public.listings l on l.vin = v.vin
   where v.vin in ('WBAJB9C50JB049616','WBAJB9C51JB035787','WBAJB9C51JB049950',
                   '5YJSA1H23FFP69703','WP1ZZZ92ZDLA45155');
end $$;
