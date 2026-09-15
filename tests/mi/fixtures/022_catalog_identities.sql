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

-- Картка 2: Tesla Model 3 Long Range AWD, US MY2018 (апаратура 2.5, PTC,
-- свинцева 12 В, Intel, пак 2018), 110 тис. км, 7 років.
create or replace function mi_test.id_m3() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('M3_LR_AWD', 2018, 'US'),
                              'mileage_km', to_jsonb(110000)),
           'age_years', to_jsonb(7));
$$;

-- Той самий автомобіль після оновлення: MY2021 (тепловий насос, пак 2021,
-- FSD-компʼютер, ще свинцева 12 В і Intel).
create or replace function mi_test.id_m3_2021() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('M3_LR_AWD', 2021, 'US'),
                              'mileage_km', to_jsonb(70000)),
           'age_years', to_jsonb(4));
$$;

-- MY2019: рік без заводського припущення про компʼютер Autopilot.
create or replace function mi_test.id_m3_2019() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('M3_LR_AWD', 2019, 'US'),
                              'mileage_km', to_jsonb(95000)),
           'age_years', to_jsonb(6));
$$;

-- Той самий MY2018 із salvage-титулом (аукціонний сценарій).
create or replace function mi_test.id_m3_salvage() returns jsonb language sql stable as $$
  select mi_test.with_field(mi_test.id_m3(), 'salvage_status', 'true'::jsonb);
$$;

-- Суміжна версія для негативного тесту: Long Range із заднім приводом,
-- той самий задній привод, пак і PTC, без переднього привода. Живе ЛИШЕ
-- на стенді і з синтетичною міткою: справжня мітка «Long Range»
-- міститься у тексті «Long Range AWD».
do $$
declare v_gen bigint; v_ver bigint; v_vmy bigint;
begin
  select subject_id into v_gen from mi.generation where platform_code = 'M3_PRE_HIGHLAND';
  if not exists (select 1 from mi.vehicle_version where version_code = 'M3_LR_RWD_FIXTURE') then
    insert into mi.knowledge_subject (kind, label) values ('vehicle_version', 'Tesla Model 3 rear drive long range (test fixture)') returning id into v_ver;
    insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain)
    values (v_ver, v_gen, 'M3_LR_RWD_FIXTURE', 'rear drive long range test fixture', 'bev');
    insert into mi.knowledge_subject (kind, label) values ('version_market_year', 'Tesla Model 3 rear drive long range (test fixture) US MY2018') returning id into v_vmy;
    insert into mi.version_market_year (subject_id, version_id, market_code, model_year, prod_from, prod_from_kind, prod_to, prod_to_kind)
    values (v_vmy, v_ver, 'US', 2018, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');
    insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment)
    select v_vmy, r.role, cv.subject_id, 'standard'
      from (values ('battery_pack', 'M3_PACK_LR_2018'), ('drive_unit_rear', 'M3_RDU_LR'),
                   ('cabin_heater', 'M3_PTC'), ('other', 'M3_LV_LEAD_ACID'),
                   ('mcu', 'M3_ICE_INTEL'), ('adas_hw', 'AP2_5')) r(role, code)
      join mi.component_variant cv on cv.variant_code = r.code;
  end if;
end $$;

create or replace function mi_test.id_m3_rwd() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('M3_LR_RWD_FIXTURE', 2018, 'US'),
                              'mileage_km', to_jsonb(110000)),
           'age_years', to_jsonb(7));
$$;

-- Картка 3: Hyundai Tucson TL 2.4 GDI Theta II, US. Точна ідентичність
-- MY2020 без обладнання і без дати виробництва: привід і дата невідомі.
create or replace function mi_test.id_tucson24(p_year int default 2020) returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('TL_THETA2_24', p_year, 'US'),
                              'mileage_km', to_jsonb(110000)),
           'age_years', to_jsonb(2026 - p_year));
$$;

-- Той самий автомобіль із відомим приводом: повний (true) або передній (false).
create or replace function mi_test.id_tucson24_drive(p_awd boolean, p_year int default 2020) returns jsonb language sql stable as $$
  select jsonb_set(mi_test.id_tucson24(p_year), '{equipment}',
           jsonb_build_array(jsonb_build_object(
             'item', (select subject_id from mi.equipment_item where equipment_key = 'tucson_tl_awd'),
             'present', p_awd, 'status', 'confirmed')));
$$;

-- Той самий автомобіль із відомою датою виробництва.
create or replace function mi_test.id_tucson24_built(p_year int, p_date date) returns jsonb language sql stable as $$
  select mi_test.with_field(mi_test.id_tucson24(p_year), 'production_date', to_jsonb(p_date::text));
$$;

-- Суміжна версія для негативного тесту: Tucson TL з мотором Nu 2.0 GDI.
-- Живе ЛИШЕ на стенді і з синтетичними мітками: мотор Nu у каталог не
-- заводиться, його продовження TXXM/T6G не входять у картку.
do $$
declare v_gen bigint; v_brand bigint; v_fam bigint; v_var bigint; v_ver bigint; v_vmy bigint; y int;
begin
  select subject_id into v_gen from mi.generation where platform_code = 'TL';
  select subject_id into v_brand from mi.brand where name = 'Hyundai';
  if not exists (select 1 from mi.vehicle_version where version_code = 'TL_NU20_FIXTURE') then
    insert into mi.knowledge_subject (kind, label) values ('component_family', 'Hyundai Nu inline four (test fixture)') returning id into v_fam;
    insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en)
    values (v_fam, v_brand, 'HYUNDAI_NU_FIXTURE', 'engine', 'test fixture');
    insert into mi.knowledge_subject (kind, label) values ('component_variant', 'Hyundai Nu 2.0 GDI (test fixture)') returning id into v_var;
    insert into mi.component_variant (subject_id, family_id, variant_code, name_en, prod_from, prod_from_kind, prod_to, prod_to_kind)
    values (v_var, v_fam, 'NU20_GDI_FIXTURE', 'test fixture', date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');
    insert into mi.knowledge_subject (kind, label) values ('vehicle_version', 'Hyundai Tucson TL two litre (test fixture)') returning id into v_ver;
    insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain)
    values (v_ver, v_gen, 'TL_NU20_FIXTURE', 'nu fixture', 'ice');
    foreach y in array array[2019, 2020] loop
      insert into mi.knowledge_subject (kind, label) values ('version_market_year', 'Hyundai Tucson TL two litre (test fixture) US MY' || y) returning id into v_vmy;
      insert into mi.version_market_year (subject_id, version_id, market_code, model_year, prod_from, prod_from_kind, prod_to, prod_to_kind)
      values (v_vmy, v_ver, 'US', y, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');
      insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values (v_vmy, 'engine', v_var, 'standard');
    end loop;
  end if;
end $$;

create or replace function mi_test.id_tucson_nu20(p_year int default 2019) returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('TL_NU20_FIXTURE', p_year, 'US'),
                              'mileage_km', to_jsonb(110000)),
           'age_years', to_jsonb(2026 - p_year));
$$;
