-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Синтетична історія однієї машини у Vehicle Memory: пʼять моментів, з
-- яких резолвер має відновити ідентичність. VIN синтетичний.
--
-- Ключовий момент історії це T3: аукціон 2021 року, ЗНАЙДЕНИЙ у 2026.
-- Його час події і час знання розходяться на пʼять років, і саме на
-- цьому перевіряється різниця між двома зрізами.

create schema if not exists mi_test;

create or replace function mi_test.build_timeline(p_vin text default '5YJSA1E28FF0T0001')
returns void language plpgsql as $$
declare v_snap1 uuid; v_snap2 uuid; v_snap3 uuid; v_listing1 uuid; v_listing2 uuid;
begin
  delete from public.component_observation where vin = p_vin;
  delete from public.vehicle_identity_observation where vin = p_vin;
  delete from mi_vm.component_state_instance where vin = p_vin;
  delete from mi_vm.entitlement_state where vin = p_vin;
  delete from mi_vm.measurement where vin = p_vin;
  delete from public.auction_events where vin = p_vin;
  delete from public.vehicle_snapshots where vin = p_vin;
  delete from public.listings where vin = p_vin;

  -- ---------- T1 (2023-03-01): перше оголошення ----------
  insert into public.listings (vin, source, source_listing_id, url, first_seen_at, last_seen_at, current_status)
  values (p_vin, 'autoscout', 'AS-1001', 'https://autoscout.test/AS-1001',
          '2023-03-01', '2023-03-01', 'active')
  returning id into v_listing1;

  insert into public.vehicle_snapshots (captured_at, vin, source_url, source_domain, country,
      price_amount, price_currency, odometer_km, year, make, model, listing, photos,
      seller_text, listing_id, listing_fingerprint, first_seen_at, last_seen_at, seen_count)
  values ('2023-03-01', p_vin, 'https://autoscout.test/AS-1001', 'autoscout', 'US',
      42000, 'USD', 120000, 2015, 'Tesla', 'Model S',
      '{"title":"Tesla Model S P85D"}'::jsonb, '["p1.jpg","p2.jpg"]'::jsonb,
      'No accidents. Original owner.', v_listing1, 'lf-v1:aaa', '2023-03-01', '2023-03-01', 1)
  returning id into v_snap1;

  -- Ідентичність із декодера VIN, спостережена тоді ж.
  perform mi.vm_record_identity(p_vin, 'version', 'vin_decoder', 'P85D', null, null, null,
    '2023-03-01', 'high', 'vin', 'vin:decoder', 'vpic-v1', v_snap1, '2023-03-01');
  perform mi.vm_record_identity(p_vin, 'market_sold', 'vin_decoder', 'US', null, null, null,
    '2023-03-01', 'high', 'vin', 'vin:decoder', 'vpic-v1', v_snap1, '2023-03-01');
  perform mi.vm_record_identity(p_vin, 'model_year', 'vin_decoder', null, 2015, null, null,
    '2023-03-01', 'high', 'vin', 'vin:decoder', 'vpic-v1', v_snap1, '2023-03-01');
  perform mi.vm_record_identity(p_vin, 'market_operated', 'listing', 'US', null, null, null,
    '2023-03-01', 'medium', 'listing:AS-1001', 'autoscout', null, v_snap1, '2023-03-01');
  -- Заводський медіаблок: те, з чим машина зійшла з конвеєра.
  perform mi.vm_record_component(p_vin, 'mcu', 'factory', 'MCU1', 'vin_decoder',
    '2023-03-01', null, 'PRESENT', 'high', 'vin', 'vin:decoder', null, null, v_snap1, '2023-03-01');
  -- Право перевірене в акаунті виробника: присутнє.
  perform mi.vm_record_entitlement(p_vin, 'free_unlimited_supercharging', 'present',
    '2023-03-01', 'manufacturer', 'checked in the account');

  -- ---------- T2 (2023-06-01): змінились ціна і опис ----------
  insert into public.vehicle_snapshots (captured_at, vin, source_url, source_domain, country,
      price_amount, price_currency, odometer_km, year, make, model, listing, photos,
      seller_text, listing_id, listing_fingerprint, first_seen_at, last_seen_at, seen_count)
  values ('2023-06-01', p_vin, 'https://autoscout.test/AS-1001', 'autoscout', 'US',
      38000, 'USD', 124000, 2015, 'Tesla', 'Model S',
      '{"title":"Tesla Model S P85D"}'::jsonb, '["p1.jpg","p2.jpg","p3.jpg"]'::jsonb,
      'Minor cosmetic repair on the rear bumper.', v_listing1, 'lf-v1:bbb',
      '2023-06-01', '2023-06-01', 1)
  returning id into v_snap2;

  -- ---------- T3: аукціон 2021 року, знайдений у 2026 ----------
  -- Час події 2021-07-14, час знання 2026-01-20. Саме тут два зрізи
  -- розходяться.
  insert into public.auction_events (auction_house, lot_id, vin, sale_date,
      odometer_value, odometer_unit, odometer_status, primary_damage, title_status,
      source_urls, record, first_seen_at, checked_at)
  values ('copart', 'LOT-77001', p_vin, date '2021-07-14',
      68000, 'mi', 'actual', 'Front end', 'SALVAGE',
      '["https://copart.test/LOT-77001"]'::jsonb, '{}'::jsonb,
      '2026-01-20', '2026-01-20');

  -- Оголошення, переписане з аукціону: ТОЙ САМИЙ корінь походження.
  -- Для резолвера це один доказ, а не два незалежні.
  perform mi.vm_record_identity(p_vin, 'market_operated', 'listing', 'UA', null, null, null,
    '2026-01-20', 'medium', 'auction:copart:LOT-77001', 'ria:copy', null, null, '2026-01-20');

  -- ---------- T4 (2024-09-10): заміна медіаблока ----------
  perform mi.vm_record_component_state(p_vin, 'tesla_mcu2_retrofit', 'mcu',
    date '2024-09-10', 138000, 'independent',
    '{"invoice":"SRV-2024-0910"}'::jsonb, null, 'high', 'vehicle_memory', null);
  perform mi.vm_record_component(p_vin, 'mcu', 'replacement', 'MCU2', 'vehicle_memory',
    '2024-09-10', 'MCU1', 'PRESENT', 'high', 'service:SRV-2024-0910',
    'invoice', 138000, '{"invoice":"SRV-2024-0910"}'::jsonb, null, '2024-09-10');
  -- Вимірювання того самого візиту.
  perform mi.vm_record_measurement(p_vin, 'battery_diagnostics',
    '{"nominal_full_pack_kwh": 68.4}'::jsonb, '2024-09-10', null, null, 'diagnostics');

  -- ---------- T5 (2026-02-01): нове оголошення на іншій площадці ----------
  insert into public.listings (vin, source, source_listing_id, url, first_seen_at, last_seen_at, current_status)
  values (p_vin, 'ria', 'RIA-5500', 'https://ria.test/RIA-5500',
          '2026-02-01', '2026-02-01', 'active')
  returning id into v_listing2;

  insert into public.vehicle_snapshots (captured_at, vin, source_url, source_domain, country,
      price_amount, price_currency, odometer_km, year, make, model, listing, photos,
      seller_text, listing_id, listing_fingerprint, first_seen_at, last_seen_at, seen_count)
  values ('2026-02-01', p_vin, 'https://ria.test/RIA-5500', 'ria', 'UA',
      21000, 'USD', 150000, 2015, 'Tesla', 'Model S',
      '{"title":"Tesla Model S P85D"}'::jsonb, '["r1.jpg"]'::jsonb,
      'Imported from the United States.', v_listing2, 'lf-v1:ccc',
      '2026-02-01', '2026-02-01', 1)
  returning id into v_snap3;

  -- Другий декодер розходиться з першим у модельному році: два рядки,
  -- обидва лишаються, і резолвер має побачити конфлікт.
  perform mi.vm_record_identity(p_vin, 'model_year', 'build_sheet', null, 2014, null, null,
    '2026-02-01', 'high', 'build-sheet', 'importer document', 'doc-v1', v_snap3, '2026-02-01');
end $$;
