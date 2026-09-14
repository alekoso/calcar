-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 103_entities_bmw_530i.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- MI Catalog, картка 1: граф сутностей BMW 530i xDrive G30 B48 (B46B20O0), US MY2017-2020.
--
-- Джерело: docs/model-intelligence/reference/bmw-530i-xdrive-g30-b48-my2017-2020.md.
-- Сутності створюються прямо, бо це каталог, а не знання. Кожне ТВЕРДЖЕННЯ
-- про ці сутності йде через staging і gate (123_candidates_bmw_530i.sql).
--
-- Спирається на сутності BMW з 100_entities_bmw.sql (бренд, ряд, покоління
-- G30, родина ZF 8HP, роздатка ATC13-1, проблеми і перевірки G30). Нічого з
-- еталонної картки M550i тут не змінюється.
--
-- Правило R1 контракту: знання про мотор живе на родині B48 і її варіантах,
-- знання про роздатку на ATC13-1, знання про коробку на ZF 8HP50 у родині
-- ZF 8HP, знання про кузов і електрику на поколінні G30. Комплектація
-- (version_fitment) звʼязує версію з цими компонентами; джерело кожного
-- рядка комплектації названо у коментарі і у клеймі official_fact картки.

-- ---------- Версії ----------

-- Лише досліджена версія. Задньопривідний 530i у продакшн-каталог НЕ
-- заводиться: його мітка «530i» міститься у тексті «530i xDrive», і матчер
-- тексту (міграція 023) тоді бачить дві версії і не пише жодної. Для
-- негативного тесту застосовності RWD-версія живе у тестовій фікстурі
-- tests/mi/fixtures/022_catalog_identities.sql із синтетичною міткою.
insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain) values
  (mi_load.mk('ver:530ix_g30', 'vehicle_version', 'BMW 530i xDrive G30'),
   mi_load.sid('gen:g30'), '530I_XDRIVE', '530i xDrive', 'ice');

-- ---------- Версія x ринок x рік ----------

-- Вікна: виробництво 530i xDrive для США 11.10.2016 .. 26.06.2020 за
-- бюлетенем 01 09 21 (S-G-OFF-16), MY2018 з 07/2017 (прайс-гайд MY2018,
-- S-G-OFF-02), MY2020 з 07/2019 (прес-реліз MY2020, S-G-OFF-03). Початок
-- MY2019 і кінці MY2017..2019 джерелами картки не задокументовані, тому
-- ці межі unknown, не open.
insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
    prod_from, prod_from_kind, prod_to, prod_to_kind, base_price, currency) values
  (mi_load.mk('vmy:530ix_us_2017', 'version_market_year', 'BMW 530i xDrive US MY2017'),
   mi_load.sid('ver:530ix_g30'), 'US', 2017,
   date '2016-10-11', 'known', date '9999-12-31', 'unknown', null, null),
  (mi_load.mk('vmy:530ix_us_2018', 'version_market_year', 'BMW 530i xDrive US MY2018'),
   mi_load.sid('ver:530ix_g30'), 'US', 2018,
   date '2017-07-01', 'known', date '9999-12-31', 'unknown', 54700.00, 'USD'),
  (mi_load.mk('vmy:530ix_us_2019', 'version_market_year', 'BMW 530i xDrive US MY2019'),
   mi_load.sid('ver:530ix_g30'), 'US', 2019,
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown', null, null),
  (mi_load.mk('vmy:530ix_us_2020', 'version_market_year', 'BMW 530i xDrive US MY2020'),
   mi_load.sid('ver:530ix_g30'), 'US', 2020,
   date '2019-07-01', 'known', date '2020-06-26', 'known', null, null);

-- ---------- Родина B48 і варіанти ----------

-- Родина мотора. Прес-реліз BMW USA називає мотор 530i «B46B20O0» (S-G-OFF-01);
-- B46 це північноамериканське SULEV-виконання B48 з тим самим блоком і
-- головкою. Документального опису різниці B46/B48 у доступних джерелах
-- немає, тому B46B20O0 заведено як окремий варіант родини B48, а не як
-- ревізія B48B20O0.
insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en) values
  (mi_load.mk('fam:b48', 'component_family', 'BMW B48 inline four'), mi_load.sid('brand:bmw'),
   'BMW_B48', 'engine',
   'Modular 2.0 litre inline four with a single twin-scroll turbocharger, direct injection, Valvetronic, a belt-driven coolant pump and a plastic oil filter housing with integrated oil cooler in front of the block');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:b48b20o0', 'component_variant', 'BMW B48B20O0'), mi_load.sid('fam:b48'),
   'B48B20O0', 'B48 high output, first revision', null,
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:b46b20o0', 'component_variant', 'BMW B46B20O0 (SULEV B48)'), mi_load.sid('fam:b48'),
   'B46B20O0', 'B46 SULEV variant of the B48B20O0 for North America', null,
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:b48b20o1', 'component_variant', 'BMW B48B20O1 (B48TU)'), mi_load.sid('fam:b48'),
   'B48B20O1', 'B48 technical update: 350 bar injection, one-piece timing chain, split cooling circuits',
   mi_load.sid('var:b48b20o0'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- Структурний атрибут межі ревізії: тиск упорскування. Джерело: огляд
-- варіантів B48 (S-G-AGG-02, Wikipedia), не документ виробника, тому
-- predicate по цьому атрибуту у картці не пишеться; атрибут потрібен
-- компілятору для майбутнього розщеплення знання TU / не-TU.
insert into mi.variant_attribute (variant_id, attr_key, attr_value) values
  (mi_load.sid('var:b48b20o0'), 'injection_pressure_bar', '200'),
  (mi_load.sid('var:b46b20o0'), 'injection_pressure_bar', '200'),
  (mi_load.sid('var:b48b20o1'), 'injection_pressure_bar', '350'),
  (mi_load.sid('var:b48b20o0'), 'performance_division', 'series'),
  (mi_load.sid('var:b46b20o0'), 'performance_division', 'series'),
  (mi_load.sid('var:b48b20o1'), 'performance_division', 'series');

-- ---------- ZF 8HP50 у наявній родині ZF 8HP ----------

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:zf8hp50', 'component_variant', 'ZF 8HP50 (GA8HP50Z)'), mi_load.sid('fam:zf8hp'),
   'ZF_8HP50', 'ZF 8HP50, BMW designation GA8HP50Z',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- ---------- Комплектація ----------

-- engine і transmission: прес-реліз BMW USA 2017 (S-G-OFF-01, «B46B20O0»,
-- «8-speed automatic (8HP50)»). transfer_case: каталог запчастин 530i xDrive
-- G30 (S-G-MKT-01, ATC13) і SIB 27 02 20, який відносить G30 до роздаток
-- ATX13-x (S-G-OFF-12). Для MY2020 мотор той самий: прес-реліз MY2021 називає
-- B48B20O1 лише для LCI з поставок 07/2020 (S-G-OFF-04).
insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values
  (mi_load.sid('vmy:530ix_us_2017'), 'engine',        mi_load.sid('var:b46b20o0'), 'standard'),
  (mi_load.sid('vmy:530ix_us_2017'), 'transmission',  mi_load.sid('var:zf8hp50'),  'standard'),
  (mi_load.sid('vmy:530ix_us_2017'), 'transfer_case', mi_load.sid('var:atc13_1'),  'standard'),
  (mi_load.sid('vmy:530ix_us_2018'), 'engine',        mi_load.sid('var:b46b20o0'), 'standard'),
  (mi_load.sid('vmy:530ix_us_2018'), 'transmission',  mi_load.sid('var:zf8hp50'),  'standard'),
  (mi_load.sid('vmy:530ix_us_2018'), 'transfer_case', mi_load.sid('var:atc13_1'),  'standard'),
  (mi_load.sid('vmy:530ix_us_2019'), 'engine',        mi_load.sid('var:b46b20o0'), 'standard'),
  (mi_load.sid('vmy:530ix_us_2019'), 'transmission',  mi_load.sid('var:zf8hp50'),  'standard'),
  (mi_load.sid('vmy:530ix_us_2019'), 'transfer_case', mi_load.sid('var:atc13_1'),  'standard'),
  (mi_load.sid('vmy:530ix_us_2020'), 'engine',        mi_load.sid('var:b46b20o0'), 'standard'),
  (mi_load.sid('vmy:530ix_us_2020'), 'transmission',  mi_load.sid('var:zf8hp50'),  'standard'),
  (mi_load.sid('vmy:530ix_us_2020'), 'transfer_case', mi_load.sid('var:atc13_1'),  'standard');

-- ---------- Аліаси ----------

-- Під реальні написи продакшну: декод NHTSA дає Model «530i» + Trim
-- «xDrive», розбір Check дає «530i xDrive». Текст «530i Steptronic»
-- (задній привід) не резолвиться у жодну версію, і це правильно: картки
-- про RWD немає, а хибне ототожнення з xDrive гірше за відмову.
insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id) values
  (mi_load.sid('ver:530ix_g30'), '530i xDrive', '530i xdrive', 'en', 'official',  'generation', mi_load.sid('gen:g30')),
  (mi_load.sid('ver:530ix_g30'), '530iX',       '530ix',       'en', 'catalog',   'generation', mi_load.sid('gen:g30')),
  (mi_load.sid('ver:530ix_g30'), '530xi',       '530xi',       'en', 'community', 'generation', mi_load.sid('gen:g30')),
  (mi_load.sid('var:b46b20o0'),  'B46',         'b46',         'en', 'community', 'brand', mi_load.sid('brand:bmw')),
  (mi_load.sid('var:b48b20o1'),  'B48TU',       'b48tu',       'en', 'community', 'brand', mi_load.sid('brand:bmw')),
  (mi_load.sid('var:zf8hp50'),   'GA8HP50Z',    'ga8hp50z',    'en', 'official',  'global', null);

-- ---------- Проблеми ----------

insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity) values
  (mi_load.mk('issue:b48_oil_filter_housing', 'issue', 'B46/B48 oil filter housing coolant leak'),
   'bmw_b48_oil_filter_housing_leak', mi_load.sid('fam:b48'),
   'Plastic oil filter housing with integrated oil cooler cracks or its coolant bushing deforms',
   'The polycarbonate housing carries both oil and coolant passages and sits above the exhaust side under the intake manifold; heat cycling embrittles the plastic and the coolant insert, so coolant leaks externally onto the engine mount and, less often, mixes with the oil. BMW describes the later engines variant of the failure as the housing seal pressing on the coolant bushing until it deforms.',
   'major', 'calendar'),
  (mi_load.mk('issue:b46_turbo_coolant_lines', 'issue', 'B46 G30 turbocharger coolant lines leak'),
   'bmw_b46_g30_turbo_coolant_lines', mi_load.sid('var:b46b20o0'),
   'Turbocharger coolant lines leak',
   'The coolant feed and return lines of the turbocharger and their couplings age in the heat behind the engine; the leak shows as coolant loss and residue on the underbody shield.',
   'moderate', 'calendar'),
  -- Бачок і його шланг це деталь кузова, спільна для 4- і 6-циліндрових G30
  -- (17139846642), у V8 інша. Родини «кузов G30 без V8» у каталозі немає, а
  -- предикат по родині мотора компілятор на чужому моторі читає як UNKNOWN,
  -- не як «ні». Тому проблема привʼязана до родини B48: на 530i вона
  -- застосовна через якір мотора, на M550i виключена, а 540i (B58) поза
  -- цією карткою і знання про нього не втрачається, бо його тут і не було.
  (mi_load.mk('issue:g30_expansion_tank', 'issue', 'G30 B46/B48 coolant expansion tank and vent hose'),
   'bmw_g30_b48_expansion_tank_vent', mi_load.sid('fam:b48'),
   'Coolant expansion tank cracks or its vent hose to the engine breaks',
   'The plastic expansion tank and the thin vent hose between tank and engine become brittle with heat; the four and six cylinder G30 share one tank part, the V8 uses another.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:b48_water_pump', 'issue', 'B48 mechanical coolant pump leak'),
   'bmw_b48_coolant_pump_leak', mi_load.sid('fam:b48'),
   'Belt-driven coolant pump seal or housing gasket leaks',
   'The mechanical pump seal and the pump housing gasket wear; the leak appears at the weep hole or at the housing joint before the bearing gets noisy.',
   'major', 'mileage'),
  (mi_load.mk('issue:b48_head_vent_line', 'issue', 'B46/B48 cylinder head coolant vent line'),
   'bmw_b48_cylinder_head_vent_line', mi_load.sid('fam:b48'),
   'Quick-disconnect coupling of the cylinder head vent line breaks',
   'BMW states the plastic line cannot handle the temperature over the lifetime of the part; the coupling at the cylinder head snaps and the engine loses coolant quickly.',
   'major', 'calendar'),
  (mi_load.mk('issue:b48_pcv_diaphragm', 'issue', 'B46/B48 valve cover PCV diaphragm'),
   'bmw_b48_pcv_diaphragm', mi_load.sid('fam:b48'),
   'Crankcase ventilation diaphragm integrated in the valve cover tears',
   'A torn diaphragm lets intake vacuum into the crankcase: whistle at idle, oil consumption, oil pushed past seals; the valve cover is replaced as a unit.',
   'moderate', 'mileage'),
  (mi_load.mk('issue:b48_charge_pipe', 'issue', 'B46/B48 plastic charge pipe'),
   'bmw_b48_charge_pipe', mi_load.sid('fam:b48'),
   'Plastic charge pipe or coupler cracks under boost', null,
   'moderate', 'mixed'),
  (mi_load.mk('issue:b48_belt_tensioner', 'issue', 'B46/B48 belt tensioner rattle'),
   'bmw_b48_belt_tensioner', mi_load.sid('fam:b48'),
   'Accessory belt tensioner rattles at idle', null,
   'minor', 'mileage'),
  (mi_load.mk('issue:b48_intake_carbon', 'issue', 'B48 intake valve carbon build-up'),
   'bmw_b48_intake_valve_carbon', mi_load.sid('fam:b48'),
   'Carbon build-up on the intake valves',
   'Direct injection leaves the intake valves unwashed by fuel, so crankcase vapour deposits accumulate on them.',
   'minor', 'mileage'),
  (mi_load.mk('issue:b48_timing_chain', 'issue', 'B48 timing chain wear'),
   'bmw_b48_timing_chain', mi_load.sid('fam:b48'),
   'Timing chain, guides or tensioner wear', null,
   'major', 'usage'),
  (mi_load.mk('issue:b46_hpfp', 'issue', 'B46 high pressure fuel pump'),
   'bmw_b46_high_pressure_fuel_pump', mi_load.sid('var:b46b20o0'),
   'High pressure fuel pump failure', null,
   'major', 'mileage'),
  (mi_load.mk('issue:g30_seat_mat', 'issue', 'G30 passenger seat occupancy sensor'),
   'bmw_g30_passenger_seat_occupancy_mat', mi_load.sid('gen:g30'),
   'Passenger seat occupancy mat fails and disables the passenger airbag',
   'The pressure mat under the front passenger seat cushion loses its reading, the restraint system reports a malfunction and the passenger airbag is switched off.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:g30_nbt_evo_hdd', 'issue', 'G30 iDrive 6 head unit storage'),
   'bmw_g30_nbt_evo_head_unit', mi_load.sid('gen:g30'),
   'iDrive 6 head unit navigation and media fail with a storage fault', null,
   'moderate', 'calendar'),
  (mi_load.mk('issue:g30_air_flaps', 'issue', 'G30 active radiator air flaps'),
   'bmw_g30_active_air_flaps', mi_load.sid('gen:g30'),
   'Upper or lower active radiator air flap actuator fails',
   'The flap actuator or the lower flap assembly fails; the car logs an air flap control fault and lights the check engine lamp.',
   'minor', 'calendar');

-- ---------- Обслуговування ----------

-- fluid_spec для BMW Longlife-17 FE+ 0W-20 у словнику немає (є лише LL-01 FE
-- 0W-30 і LL-01). Код не вигадується: специфікація названа у примітці і
-- у клеймі, а прогалина словника задокументована у звіті картки.
insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code, fluid_spec_code, capacity_note_en) values
  (mi_load.mk('maint:b46_oil', 'maintenance_item', 'B46B20O0 engine oil and filter'),
   mi_load.sid('var:b46b20o0'), 'engine_oil', null,
   'BMW Longlife-17 FE+ (earlier Longlife-14 FE+) 0W-20; about 5.25 litres with filter, later ISTA revisions quote 5.75'),
  (mi_load.mk('maint:b46_plugs', 'maintenance_item', 'B46B20O0 spark plugs'),
   mi_load.sid('var:b46b20o0'), 'spark_plugs', null, null),
  (mi_load.mk('maint:zf8hp50_atf', 'maintenance_item', 'ZF 8HP50 transmission fluid'),
   mi_load.sid('var:zf8hp50'), 'atf', 'ZF_LIFEGUARD_8',
   'Pan with integrated filter; level is set at 40 to 50 C');

-- ---------- Перевірки ----------

-- Методу «тест тиску системи охолодження» у словнику test_method немає;
-- візуальний огляд описаний чесно як огляд, а не як тест тиску, і
-- прогалина словника задокументована у звіті картки.
insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
    cannot_prove_en, conditions, default_priority, materially_resolves, resolves_dimension) values
  (mi_load.mk('chk:b48_cooling_inspection', 'check_item', 'B46/B48 cooling system inspection under the intake'),
   'visual', mi_load.sid('fam:b48'),
   'The plastic cooling components of this engine family age one after another and the most expensive of them, the oil filter housing, sits hidden under the intake manifold.',
   'Fresh or dried coolant residue on the oil filter housing, the coolant flange under the intake, the turbocharger lines, the expansion tank, the vent hose couplings and the coolant pump weep hole; coolant level against the marks; coolant in the oil filler cap.',
   'Does not show a hairline crack that has not started to weep yet, does not replace a pressure test of the cooling system and confirms the state today rather than remaining life.',
   array['engine cover removed', 'underbody shield removed', 'inspected cold and again after ten minutes at operating temperature'],
   'must', false, null),
  (mi_load.mk('chk:g30_xdrive_road_test', 'check_item', 'xDrive low speed turning road test'),
   'road_test', mi_load.sid('var:atc13_1'),
   'Transfer case shudder does not set a fault code or a warning and shows only in tight low speed turns under light load.',
   'Jerking or shuddering in full-lock turns and when pulling away at low speed on a warm car, and whether the four tyres are of one size, brand and wear state.',
   'Does not tell fluid from clutch pack wear: a fluid change with recalibration is the first step, and only its failure points at the transfer case itself.',
   array['warm drivetrain', 'full lock both directions on dry tarmac', 'tyre sizes and wear compared first'],
   'good', false, null),
  (mi_load.mk('chk:530i_recall_lookup', 'check_item', 'Recall completion check by VIN'),
   'documentation', mi_load.sid('ver:530ix_g30'),
   'Several recalls of this version are only visible by VIN: the crankshaft sensor firmware, the starter relay that BMW asks owners to park outside for, the output shaft of a few 2020 cars and the camera software.',
   'Which open and completed campaigns the VIN carries in the manufacturer or NHTSA lookup.',
   'A completed camera software campaign says nothing about the hardware, and an open starter recall may have no parts available yet.',
   array['VIN entered in the manufacturer recall lookup and in the NHTSA lookup'],
   'must', false, null);

insert into mi.check_covers (check_id, target_subject_id, role) values
  (mi_load.sid('chk:b48_cooling_inspection'),  mi_load.sid('issue:b48_oil_filter_housing'), 'detects'),
  (mi_load.sid('chk:b48_cooling_inspection'),  mi_load.sid('issue:b46_turbo_coolant_lines'), 'detects'),
  (mi_load.sid('chk:b48_cooling_inspection'),  mi_load.sid('issue:g30_expansion_tank'), 'detects'),
  (mi_load.sid('chk:b48_cooling_inspection'),  mi_load.sid('issue:b48_water_pump'), 'detects'),
  (mi_load.sid('chk:b48_cooling_inspection'),  mi_load.sid('issue:b48_head_vent_line'), 'detects'),
  (mi_load.sid('chk:g30_xdrive_road_test'),    mi_load.sid('issue:g30_xdrive_shudder'), 'detects'),
  -- Наявна перевірка діагностичним сканером G30 бачить і PCV. Мат сидіння і
  -- жалюзі радіатора вона теж бачить, але ці проблеми привʼязані до
  -- ПОКОЛІННЯ, а golden test 62 вимагає, щоб проблема про покоління не мала
  -- жодного звʼязування з перевіркою (інакше вона претендувала б на систему,
  -- якої не може довести). Тому ці два рядки свідомо не пишуться; тертя
  -- задокументоване у звіті картки.
  (mi_load.sid('chk:g30_ista_scan'),           mi_load.sid('issue:b48_pcv_diaphragm'), 'detects');

-- ---------- Стан компонента як знання ----------

insert into mi.component_state_type (subject_id, state_key, state_kind, applies_to_subject_id,
    resulting_variant_id, sanctioned_by_oem) values
  (mi_load.mk('state:b48_ofh_aluminium', 'component_state_type', 'B46/B48 oil filter housing replaced with an aluminium unit'),
   'bmw_b48_ofh_aluminium_replacement', 'retrofit', mi_load.sid('fam:b48'), null, false);
