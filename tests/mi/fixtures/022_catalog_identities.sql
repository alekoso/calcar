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

-- Суміжна версія для негативного тесту: 530i із заднім приводом, той
-- самий мотор і коробка, без роздатки. Живе ЛИШЕ на стенді і з
-- синтетичною міткою: справжня мітка «530i» міститься у тексті «530i
-- xDrive» і робила б матчер тексту двозначним, тому у продакшн-каталог
-- ця версія не заводиться, поки матчер не віддає перевагу найдовшій мітці.
do $$
declare v_gen bigint; v_ver bigint; v_vmy bigint; v_eng bigint; v_tr bigint;
begin
  select subject_id into v_gen from mi.generation where platform_code = 'G30' and phase = 'base';
  select subject_id into v_eng from mi.component_variant where variant_code = 'B46B20O0';
  select subject_id into v_tr from mi.component_variant where variant_code = 'ZF_8HP50';
  if not exists (select 1 from mi.vehicle_version where version_code = '530I_RWD_FIXTURE') then
    insert into mi.knowledge_subject (kind, label) values ('vehicle_version', 'BMW 530i G30 rear drive (test fixture)') returning id into v_ver;
    insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain)
    values (v_ver, v_gen, '530I_RWD_FIXTURE', 'rear drive test fixture', 'ice');
    insert into mi.knowledge_subject (kind, label) values ('version_market_year', 'BMW 530i G30 rear drive (test fixture) US MY2018') returning id into v_vmy;
    insert into mi.version_market_year (subject_id, version_id, market_code, model_year, prod_from, prod_from_kind, prod_to, prod_to_kind)
    values (v_vmy, v_ver, 'US', 2018, date '2017-07-01', 'known', date '9999-12-31', 'unknown');
    insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment)
    values (v_vmy, 'engine', v_eng, 'standard'), (v_vmy, 'transmission', v_tr, 'standard');
  end if;
end $$;

create or replace function mi_test.id_530i_rwd() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('530I_RWD_FIXTURE', 2018, 'US'),
                              'mileage_km', to_jsonb(130000)),
           'age_years', to_jsonb(8));
$$;

-- Машина з auto.ria: ринок продажу невідомий, ринок експлуатації UA.
create or replace function mi_test.id_530ix_ua() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.id_530ix(), 'market_sold', 'null'::jsonb),
           'market_operated', '"UA"'::jsonb);
$$;
