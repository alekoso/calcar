-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- СИРІ спостереження про три еталонні машини. Phase 4 подавала
-- компілятору готову ідентичність; тут резолвер має отримати її сам із
-- фактів. VIN синтетичні і жодної реальної машини не описують.
--
-- Жодного зовнішнього API не викликається: це адаптери-фікстури, які
-- імітують уже нормалізований вихід декодера VIN, оголошення, Vehicle
-- Memory, аукціону і Vision.

create schema if not exists mi_test;

create or replace function mi_test.obs(
  p_source text, p_source_type text, p_dimension text,
  p_role text default null, p_slot text default null,
  p_subject bigint default null, p_alias text default null,
  p_text text default null, p_num numeric default null,
  p_date date default null, p_bool boolean default null,
  p_confidence text default 'high', p_root text default null,
  p_observed_at date default null)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'source', p_source, 'source_type', p_source_type, 'dimension', p_dimension,
    'role', p_role, 'slot', p_slot,
    'value_subject', p_subject, 'value_alias', p_alias, 'value_text', p_text,
    'value_num', p_num, 'value_date', p_date, 'value_bool', p_bool,
    'confidence', p_confidence, 'provenance_root', p_root, 'observed_at', p_observed_at));
$$;

-- ---------- BMW M550i xDrive G30 MY2018 US ----------
--
-- Повна заводська ідентичність із декодера VIN. Жодного свідчення про
-- заміну, тому мотор, коробка і раздатка мають зійтись у сильне
-- заводське припущення.
create or replace function mi_test.raw_bmw() returns jsonb language sql stable as $$
  select jsonb_build_array(
    mi_test.obs('vin:WBAJB9C50JB000001', 'vin_decoder', 'version', null, 'na',
                mi_test.sid_of('version','M550I_XDRIVE'), null, null, null, null, null,
                'high', 'vin'),
    mi_test.obs('vin:WBAJB9C50JB000001', 'vin_decoder', 'market_sold', null, 'na',
                null, null, 'US', null, null, null, 'high', 'vin'),
    mi_test.obs('vin:WBAJB9C50JB000001', 'vin_decoder', 'model_year', null, 'na',
                null, null, null, 2018, null, null, 'high', 'vin'),
    mi_test.obs('vin:WBAJB9C50JB000001', 'vin_decoder', 'production_date', null, 'na',
                null, null, null, null, date '2018-03-14', null, 'high', 'vin'),
    -- Мотор названий заводським кодом, а не аліасом: декодер дає код.
    mi_test.obs('vin:WBAJB9C50JB000001', 'vin_decoder', 'component_variant', 'engine', 'factory',
                mi_test.sid_of('variant','N63B44O2'), null, null, null, null, null, 'high', 'vin'),
    mi_test.obs('build-sheet', 'build_sheet', 'component_variant', 'transmission', 'factory',
                mi_test.sid_of('variant','ZF_8HP75'), null, null, null, null, null, 'high', 'bs'),
    -- Раздатка приходить АЛІАСОМ у контексті бренду: перевірка того, що
    -- scoped alias розвʼязується, а не вгадується.
    mi_test.obs('build-sheet', 'build_sheet', 'component_variant', 'transfer_case', 'factory',
                null, 'ATC13-1', null, null, null, null, 'high', 'bs'),
    mi_test.obs('listing:autoscout', 'listing', 'mileage_km', null, 'na',
                null, null, null, 120000, null, null, 'medium', 'listing'),
    mi_test.obs('listing:autoscout', 'listing', 'age_years', null, 'na',
                null, null, null, 8, null, null, 'medium', 'listing'),
    mi_test.obs('listing:autoscout', 'listing', 'market_operated', null, 'na',
                null, null, 'US', null, null, null, 'medium', 'listing')
  );
$$;

-- ---------- Tesla Model S P85D MY2015 ----------
--
-- Заводська ідентичність із VIN. Слабкі замінні ролі лишаються
-- припущенням. Медіаблок має задокументовану заміну, тому його ПОТОЧНИЙ
-- слот перекривається, а заводський зберігається. Право на швидку
-- зарядку приходить окремо від заліза.
create or replace function mi_test.raw_tesla() returns jsonb language sql stable as $$
  select jsonb_build_array(
    mi_test.obs('vin:5YJSA1E28FF000002', 'vin_decoder', 'version', null, 'na',
                mi_test.sid_of('version','P85D'), null, null, null, null, null, 'high', 'vin'),
    mi_test.obs('vin:5YJSA1E28FF000002', 'vin_decoder', 'market_sold', null, 'na',
                null, null, 'US', null, null, null, 'high', 'vin'),
    mi_test.obs('vin:5YJSA1E28FF000002', 'vin_decoder', 'model_year', null, 'na',
                null, null, null, 2015, null, null, 'high', 'vin'),
    -- Дата складання НЕ відома: жодне спостереження її не дає. Це має
    -- лишити залежні від дати клейми умовними, а не підібрати найближче.
    mi_test.obs('vehicle-memory', 'vehicle_memory', 'mileage_km', null, 'na',
                null, null, null, 150000, null, null, 'high', 'vm'),
    mi_test.obs('vehicle-memory', 'vehicle_memory', 'age_years', null, 'na',
                null, null, null, 10, null, null, 'high', 'vm'),
    mi_test.obs('listing:cars', 'listing', 'market_operated', null, 'na',
                null, null, 'UA', null, null, null, 'medium', 'listing'),
    -- Задокументована заміна медіаблока: поточний слот підтверджений.
    mi_test.obs('vehicle-memory', 'vehicle_memory', 'component_variant', 'mcu', 'current',
                mi_test.sid_of('variant','MCU2'), null, null, null, null, null, 'high', 'vm-mcu'),
    mi_test.obs('vehicle-memory', 'vehicle_memory', 'component_state_present', null, 'na',
                mi_test.sid_of('state','tesla_mcu2_retrofit'), null, null, null, null, true,
                'high', 'vm-mcu'),
    -- Право приходить із системи виробника, а не з наявності заліза.
    mi_test.obs('tesla-account', 'manufacturer', 'entitlement_state', null, 'na',
                mi_test.sid_of('entitlement','free_unlimited_supercharging'), null, 'absent',
                null, null, null, 'high', 'account'),
    mi_test.obs('auction:copart', 'auction', 'salvage_status', null, 'na',
                null, null, null, null, null, true, 'high', 'auction'),
    -- Оголошення переписане з аукціону: той самий корінь походження,
    -- тому це ОДИН доказ, а не два.
    mi_test.obs('listing:cars', 'listing', 'salvage_status', null, 'na',
                null, null, null, null, null, true, 'medium', 'auction')
  );
$$;

-- ---------- Porsche Cayenne GTS 958.1 MY2013 US ----------
--
-- Дата складання невідома, і це навмисно: від неї залежить клейм про
-- клеєні трубки охолодження. Пневмопідвіска опційна і не спостерігалась.
create or replace function mi_test.raw_porsche() returns jsonb language sql stable as $$
  select jsonb_build_array(
    mi_test.obs('vin:WP1AD2A2XDLA00003', 'vin_decoder', 'version', null, 'na',
                mi_test.sid_of('version','GTS'), null, null, null, null, null, 'high', 'vin'),
    mi_test.obs('vin:WP1AD2A2XDLA00003', 'vin_decoder', 'market_sold', null, 'na',
                null, null, 'US', null, null, null, 'high', 'vin'),
    mi_test.obs('vin:WP1AD2A2XDLA00003', 'vin_decoder', 'model_year', null, 'na',
                null, null, null, 2013, null, null, 'high', 'vin'),
    mi_test.obs('vin:WP1AD2A2XDLA00003', 'vin_decoder', 'component_variant', 'engine', 'factory',
                mi_test.sid_of('variant','M48_02'), null, null, null, null, null, 'high', 'vin'),
    mi_test.obs('build-sheet', 'build_sheet', 'component_variant', 'transmission', 'factory',
                mi_test.sid_of('variant','TR80SD_0C8'), null, null, null, null, null, 'high', 'bs'),
    mi_test.obs('listing:mobile', 'listing', 'mileage_km', null, 'na',
                null, null, null, 140000, null, null, 'medium', 'listing'),
    mi_test.obs('listing:mobile', 'listing', 'age_years', null, 'na',
                null, null, null, 12, null, null, 'medium', 'listing'),
    mi_test.obs('listing:mobile', 'listing', 'market_operated', null, 'na',
                null, null, 'US', null, null, null, 'medium', 'listing'),
    -- Vision бачить керамічні гальма. Це доводить ПОТОЧНЕ обладнання, а
    -- не заводську опцію: заводський слот лишається окремим.
    mi_test.obs('vision:current', 'current_vision', 'equipment_present', null, 'current',
                mi_test.sid_of('equipment','pccb'), null, null, null, null, true,
                'high', 'vision')
  );
$$;
