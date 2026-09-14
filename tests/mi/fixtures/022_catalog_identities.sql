-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Ідентичності для smoke-тестів карток MI Catalog. Побудовані тими самими
-- помічниками, що і golden-ідентичності (020_identity_fixtures.sql), і
-- потребують їх. VIN тут немає: ідентичність задається каталогом.

-- Картка 1: BMW 530i xDrive G30 B46B20O0, US MY2018, 130 тис. км, 8 років.
create or replace function mi_test.id_530ix() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('530I_XDRIVE', 2018, 'US'),
                              'mileage_km', to_jsonb(130000)),
           'age_years', to_jsonb(8));
$$;

-- Той самий автомобіль модельного року 2020: інший головний пристрій,
-- інші відклики за датою виробництва.
create or replace function mi_test.id_530ix_2020() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('530I_XDRIVE', 2020, 'US'),
                              'mileage_km', to_jsonb(90000)),
           'age_years', to_jsonb(6));
$$;

-- Суміжна версія: 530i із заднім приводом, той самий мотор і коробка,
-- без роздатки.
create or replace function mi_test.id_530i_rwd() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('530I', 2018, 'US'),
                              'mileage_km', to_jsonb(130000)),
           'age_years', to_jsonb(8));
$$;

-- Машина з auto.ria: ринок продажу невідомий, ринок експлуатації UA.
create or replace function mi_test.id_530ix_ua() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.id_530ix(), 'market_sold', 'null'::jsonb),
           'market_operated', '"UA"'::jsonb);
$$;
