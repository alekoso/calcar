-- Phase 3 back-loading: граф сутностей BMW M550i xDrive G30 MY2018 (US).
--
-- Джерело: docs/model-intelligence/reference/bmw-m550i-g30-my2018.md (FROZEN).
-- Сутності створюються прямо, бо це каталог, а не знання. Кожне ТВЕРДЖЕННЯ
-- про ці сутності йде через staging і gate.

-- ---------- Бренд, ряд, покоління ----------

insert into mi.brand (subject_id, name, country)
values (pg_temp.mk('brand:bmw', 'brand', 'BMW'), 'BMW', 'DE');

insert into mi.model_line (subject_id, brand_id, name) values
  (pg_temp.mk('line:bmw_5', 'model_line', 'BMW 5 Series'), pg_temp.sid('brand:bmw'), '5 Series'),
  (pg_temp.mk('line:bmw_7', 'model_line', 'BMW 7 Series'), pg_temp.sid('brand:bmw'), '7 Series');

-- Вікно виробництва G30 відоме лише знизу: картка дає SOP 03/2017 для
-- M550i, дату завершення покоління не дає. Верхня межа = unknown, не open.
insert into mi.generation (subject_id, model_line_id, platform_code, phase,
    powertrain_types, default_system_profile, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('gen:g30', 'generation', 'BMW 5 Series G30'), pg_temp.sid('line:bmw_5'),
   'G30', 'base', array['ice','phev']::mi.powertrain[], 'ice_default',
   date '2016-10-01', 'known', date '9999-12-31', 'unknown'),
  (pg_temp.mk('gen:f90', 'generation', 'BMW M5 F90'), pg_temp.sid('line:bmw_5'),
   'F90', 'base', array['ice']::mi.powertrain[], 'ice_default',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('gen:g12', 'generation', 'BMW 7 Series G12'), pg_temp.sid('line:bmw_7'),
   'G12', 'base', array['ice','phev']::mi.powertrain[], 'ice_default',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- ---------- Версії ----------

insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain) values
  (pg_temp.mk('ver:m550i_g30', 'vehicle_version', 'BMW M550i xDrive G30'),
   pg_temp.sid('gen:g30'), 'M550I_XDRIVE', 'M550i xDrive', 'ice'),
  (pg_temp.mk('ver:540i_g30', 'vehicle_version', 'BMW 540i G30'),
   pg_temp.sid('gen:g30'), '540I', '540i', 'ice'),
  (pg_temp.mk('ver:530e_g30', 'vehicle_version', 'BMW 530e G30'),
   pg_temp.sid('gen:g30'), '530E', '530e', 'phev'),
  (pg_temp.mk('ver:m5_f90', 'vehicle_version', 'BMW M5 F90'),
   pg_temp.sid('gen:f90'), 'M5', 'M5', 'ice'),
  (pg_temp.mk('ver:750i_g12', 'vehicle_version', 'BMW 750i xDrive G12'),
   pg_temp.sid('gen:g12'), '750I_XDRIVE', '750i xDrive', 'ice');

-- ---------- Версія x ринок x рік ----------

insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
    prod_from, prod_from_kind, prod_to, prod_to_kind, base_price, currency) values
  (pg_temp.mk('vmy:m550i_us_2018', 'version_market_year', 'BMW M550i xDrive US MY2018'),
   pg_temp.sid('ver:m550i_g30'), 'US', 2018,
   date '2017-03-01', 'known', date '9999-12-31', 'unknown', null, null),
  (pg_temp.mk('vmy:m550i_us_2019', 'version_market_year', 'BMW M550i xDrive US MY2019'),
   pg_temp.sid('ver:m550i_g30'), 'US', 2019,
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown', null, null),
  -- MY2020 отримав інший мотор: виробництво з 07/2019 (C-003).
  (pg_temp.mk('vmy:m550i_us_2020', 'version_market_year', 'BMW M550i xDrive US MY2020'),
   pg_temp.sid('ver:m550i_g30'), 'US', 2020,
   date '2019-07-01', 'known', date '9999-12-31', 'unknown', 76650.00, 'USD');

-- ---------- Компонентні родини і варіанти ----------

insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en) values
  (pg_temp.mk('fam:n63', 'component_family', 'BMW N63 V8'), pg_temp.sid('brand:bmw'),
   'BMW_N63', 'engine', 'Twin-turbo 4.4 V8 with turbochargers inside the vee (hot-V layout)'),
  (pg_temp.mk('fam:s63', 'component_family', 'BMW S63 V8'), pg_temp.sid('brand:bmw'),
   'BMW_S63', 'engine', 'M division twin-turbo 4.4 V8, hot-V layout with cross-bank exhaust manifold'),
  (pg_temp.mk('fam:b58', 'component_family', 'BMW B58 inline six'), pg_temp.sid('brand:bmw'),
   'BMW_B58', 'engine', 'Single turbo 3.0 inline six, closed deck block with sprayed bore coating'),
  (pg_temp.mk('fam:zf8hp', 'component_family', 'ZF 8HP automatic transmission'), null,
   'ZF_8HP', 'transmission', 'ZF eight speed torque converter automatic, family shared across brands'),
  (pg_temp.mk('fam:bmw_atc', 'component_family', 'BMW ATC transfer case'), pg_temp.sid('brand:bmw'),
   'BMW_ATC', 'transfer_case', 'Electronically controlled multi plate clutch transfer case, rear biased');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:n63b44o0', 'component_variant', 'BMW N63B44O0'), pg_temp.sid('fam:n63'),
   'N63B44O0', 'N63 (first generation)', null,
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:n63b44o1', 'component_variant', 'BMW N63B44O1 (N63TU)'), pg_temp.sid('fam:n63'),
   'N63B44O1', 'N63TU', pg_temp.sid('var:n63b44o0'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:n63b44o2', 'component_variant', 'BMW N63B44O2 (N63TU2, N63R)'), pg_temp.sid('fam:n63'),
   'N63B44O2', 'N63TU2, BMW internal designation N63R', pg_temp.sid('var:n63b44o1'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:n63b44m3', 'component_variant', 'BMW N63B44M3'), pg_temp.sid('fam:n63'),
   'N63B44M3', 'N63 M3 revision, Alusil bores retained', pg_temp.sid('var:n63b44o2'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:n63b44t3', 'component_variant', 'BMW N63B44T3 (N63TU3)'), pg_temp.sid('fam:n63'),
   'N63B44T3', 'N63TU3', pg_temp.sid('var:n63b44o2'),
   date '2019-07-01', 'known', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:s63b44t4', 'component_variant', 'BMW S63B44T4'), pg_temp.sid('fam:s63'),
   'S63B44T4', 'S63TU4 as fitted to the F90 M5',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:b58b30', 'component_variant', 'BMW B58B30'), pg_temp.sid('fam:b58'),
   'B58B30', 'B58 3.0 inline six',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:zf8hp75', 'component_variant', 'ZF 8HP75 (GA8HP75Z)'), pg_temp.sid('fam:zf8hp'),
   'ZF_8HP75', 'ZF 8HP75, BMW designation GA8HP75Z',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:atc13_1', 'component_variant', 'BMW ATC13-1 transfer case'), pg_temp.sid('fam:bmw_atc'),
   'ATC13_1', 'ATC13-1',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- Структурні атрибути, за якими пишуться предикати застосовності.
insert into mi.variant_attribute (variant_id, attr_key, attr_value) values
  (pg_temp.sid('var:n63b44o0'), 'cylinder_bore_technology', 'alusil'),
  (pg_temp.sid('var:n63b44o1'), 'cylinder_bore_technology', 'alusil'),
  (pg_temp.sid('var:n63b44o2'), 'cylinder_bore_technology', 'alusil'),
  (pg_temp.sid('var:n63b44m3'), 'cylinder_bore_technology', 'alusil'),
  (pg_temp.sid('var:n63b44t3'), 'cylinder_bore_technology', 'lds_coated'),
  (pg_temp.sid('var:b58b30'),   'cylinder_bore_technology', 'closed_deck_lds'),
  (pg_temp.sid('var:n63b44o2'), 'cooling_layout', 'hot_v'),
  (pg_temp.sid('var:n63b44t3'), 'cooling_layout', 'hot_v'),
  (pg_temp.sid('var:s63b44t4'), 'cooling_layout', 'hot_v'),
  (pg_temp.sid('var:n63b44o2'), 'injection_pressure_bar', '200'),
  (pg_temp.sid('var:n63b44t3'), 'injection_pressure_bar', '350'),
  (pg_temp.sid('var:s63b44t4'), 'injection_pressure_bar', '350'),
  (pg_temp.sid('var:n63b44o2'), 'performance_division', 'series'),
  (pg_temp.sid('var:s63b44t4'), 'performance_division', 'm');

-- ---------- Комплектація версії ----------

insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values
  (pg_temp.sid('vmy:m550i_us_2018'), 'engine',       pg_temp.sid('var:n63b44o2'), 'standard'),
  (pg_temp.sid('vmy:m550i_us_2018'), 'transmission', pg_temp.sid('var:zf8hp75'),  'standard'),
  (pg_temp.sid('vmy:m550i_us_2018'), 'transfer_case',pg_temp.sid('var:atc13_1'),  'standard'),
  (pg_temp.sid('vmy:m550i_us_2019'), 'engine',       pg_temp.sid('var:n63b44o2'), 'standard'),
  (pg_temp.sid('vmy:m550i_us_2019'), 'transmission', pg_temp.sid('var:zf8hp75'),  'standard'),
  (pg_temp.sid('vmy:m550i_us_2020'), 'engine',       pg_temp.sid('var:n63b44t3'), 'standard'),
  (pg_temp.sid('vmy:m550i_us_2020'), 'transmission', pg_temp.sid('var:zf8hp75'),  'standard');

-- ---------- Аліаси ----------

-- Аліаси свідомо звужені scope: «N63R» і «TU2» поза контекстом BMW нічого
-- не означають, а глобальний аліас зробив би резолвер небезпечним.
insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id) values
  (pg_temp.sid('var:n63b44o2'), 'N63R',    'n63r',    'en', 'official',  'brand', pg_temp.sid('brand:bmw')),
  (pg_temp.sid('var:n63b44o2'), 'N63TU2',  'n63tu2',  'en', 'community', 'brand', pg_temp.sid('brand:bmw')),
  (pg_temp.sid('var:n63b44t3'), 'N63TU3',  'n63tu3',  'en', 'community', 'brand', pg_temp.sid('brand:bmw')),
  (pg_temp.sid('var:n63b44o1'), 'N63TU',   'n63tu',   'en', 'community', 'brand', pg_temp.sid('brand:bmw')),
  (pg_temp.sid('var:zf8hp75'),  'GA8HP75Z','ga8hp75z','en', 'official',  'global', null),
  (pg_temp.sid('var:atc13_1'),  'ATC13-1', 'atc13-1', 'en', 'official',  'brand', pg_temp.sid('brand:bmw')),
  (pg_temp.sid('ver:m550i_g30'),'M550i xDrive','m550i xdrive','en','official','generation', pg_temp.sid('gen:g30'));

-- ---------- Проблеми ----------

insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity) values
  (pg_temp.mk('issue:n63_bore_scoring', 'issue', 'N63 cylinder bore scoring'),
   'bmw_n63_bore_scoring', pg_temp.sid('var:n63b44o2'),
   'Cylinder bore scoring on Alusil bores',
   'Silicon grains are torn out of the aluminium silicon running surface and the aluminium matrix deforms plastically; fuel dilution during cold short trips, operation below 40 C, high sulfur fuel and loss of the oil film accelerate it. The damage is irreversible because Alusil bores cannot be rebored to an oversize.',
   'catastrophic', 'usage'),
  (pg_temp.mk('issue:n63r_map_thermostat', 'issue', 'N63R map thermostat coolant leak into harness'),
   'bmw_n63r_map_thermostat_harness', pg_temp.sid('var:n63b44o2'),
   'Coolant leak through the map thermostat connector into the sensor harness',
   'Coolant wicks along the map thermostat connector into the cylinder 1 to 4 sensor harness and onward into the engine and power module connectors.',
   'major', 'mixed'),
  (pg_temp.mk('issue:n63_wastegate_actuator', 'issue', 'N63 wastegate actuator failure'),
   'bmw_n63_wastegate_actuator', pg_temp.sid('var:n63b44o2'),
   'Electric wastegate actuator failure',
   'The electric wastegate actuator loses position control, setting the 123704 fault family; BMW describes an internal manufacturing defect on earlier N63R builds.',
   'moderate', 'mixed'),
  (pg_temp.mk('issue:n63_cooling_age', 'issue', 'N63 cooling circuit age failures'),
   'bmw_n63_cooling_circuit_age', pg_temp.sid('var:n63b44o2'),
   'Cooling circuit components fail one after another with age',
   'Turbocharger coolant lines, expansion tank, radiator and both pumps sit in or near the hot vee; heat cycling embrittles hoses and plastic housings.',
   'major', 'mixed'),
  (pg_temp.mk('issue:n63_turbo_coolant_lines', 'issue', 'N63R turbocharger coolant line material'),
   'bmw_n63r_turbo_coolant_lines', pg_temp.sid('var:n63b44o2'),
   'Turbocharger coolant line hose material not sufficiently heat resistant',
   'BMW states the hose material is not sufficiently resistant to turbocharger temperature.',
   'major', 'calendar'),
  (pg_temp.mk('issue:n63_valve_stem_seals', 'issue', 'N63 valve stem seal hardening'),
   'bmw_n63_valve_stem_seals', pg_temp.sid('var:n63b44o2'),
   'Valve stem seal hardening',
   'The seal material hardens with heat and age and lets oil past during idle; BMW changed the material only on the TU3 revision.',
   'major', 'calendar'),
  (pg_temp.mk('issue:n63_upper_oil_pan', 'issue', 'N63 upper oil pan gasket leak'),
   'bmw_n63_upper_oil_pan_gasket', pg_temp.sid('var:n63b44o2'),
   'Upper oil pan gasket leak', null, 'moderate', 'mixed'),
  (pg_temp.mk('issue:n63_intake_carbon', 'issue', 'N63 intake valve carbon build-up'),
   'bmw_n63_intake_valve_carbon', pg_temp.sid('fam:n63'),
   'Carbon build-up on the intake valves',
   'Direct injection leaves the intake valves unwashed by fuel, so blow-by deposits accumulate on them.',
   'minor', 'mileage'),
  (pg_temp.mk('issue:n63_spun_bearing', 'issue', 'N63 spun main bearing'),
   'bmw_n63_spun_bearing', pg_temp.sid('fam:n63'),
   'Spun bearing after oil starvation or overheating',
   'Alusil bores and the bearing shells lose the oil film earlier than a cast iron block when oil changes are rare or the engine overheats.',
   'catastrophic', 'usage'),
  (pg_temp.mk('issue:sleeve_liner_risk', 'issue', 'Aluminium block sleeving defects'),
   'aluminium_block_sleeve_defects', pg_temp.sid('fam:n63'),
   'Defects introduced by sleeving an aluminium block',
   'Insufficient interference fit (0.003 to 0.004 inch is required) and poor heat transfer, deck warping, wrong piston to liner clearance because aluminium expands about twice as much as iron, liner movement, poor honing and debris.',
   'catastrophic', 'mileage'),
  (pg_temp.mk('issue:g30_xdrive_shudder', 'issue', 'G30 xDrive low speed shudder'),
   'bmw_g30_xdrive_shudder', pg_temp.sid('var:atc13_1'),
   'Low speed shudder from the transfer case',
   'Factory transfer case fluid off specification, or incorrect and unevenly worn tyres, upset the clutch pack friction behaviour.',
   'moderate', 'mixed'),
  (pg_temp.mk('issue:g30_flex_disc', 'issue', 'G30 propshaft flex disc wear'),
   'bmw_g30_propshaft_flex_disc', pg_temp.sid('gen:g30'),
   'Propshaft flexible coupling wear', null, 'moderate', 'mileage'),
  (pg_temp.mk('issue:g30_tension_strut', 'issue', 'G30 front tension strut bushing'),
   'bmw_g30_front_tension_strut_bushing', pg_temp.sid('gen:g30'),
   'Hydraulic front tension strut bushing failure',
   'The hydraulic bushing loses its fluid and the strut knocks and shudders under braking.',
   'moderate', 'mileage'),
  (pg_temp.mk('issue:m550i_damper_leak', 'issue', 'M550i adaptive damper leak'),
   'bmw_m550i_adaptive_damper_leak', pg_temp.sid('ver:m550i_g30'),
   'Adaptive damper leak', null, 'moderate', 'mixed'),
  (pg_temp.mk('issue:g30_ac_evaporator', 'issue', 'G30 air conditioning evaporator failure'),
   'bmw_g30_ac_evaporator', pg_temp.sid('gen:g30'),
   'Early air conditioning evaporator failure',
   'The R1234yf evaporator leaks early; access requires removing the dashboard.',
   'major', 'calendar'),
  (pg_temp.mk('issue:g30_led_drl', 'issue', 'G30 LED daytime running light module'),
   'bmw_g30_led_drl_module', pg_temp.sid('gen:g30'),
   'LED daytime running light module yellowing or failure', null, 'minor', 'calendar'),
  (pg_temp.mk('issue:g30_adaptive_headlight', 'issue', 'G30 adaptive headlight moisture'),
   'bmw_g30_adaptive_headlight_moisture', pg_temp.sid('gen:g30'),
   'Moisture inside the adaptive headlight kills the module', null, 'moderate', 'calendar'),
  (pg_temp.mk('issue:g30_battery_drain', 'issue', 'G30 parasitic battery drain'),
   'bmw_g30_battery_drain', pg_temp.sid('gen:g30'),
   'Parasitic battery drain',
   'The electronics do not enter sleep unless the car is locked with the key; a failed Comfort Access door handle also draws current.',
   'moderate', 'usage'),
  (pg_temp.mk('issue:b58_oil_filter_housing', 'issue', 'B58 oil filter housing and coolant vent hose'),
   'bmw_b58_oil_filter_housing_leak', pg_temp.sid('var:b58b30'),
   'Plastic oil filter housing and coolant vent hose leak', null, 'major', 'mileage');

-- ---------- Обслуговування ----------

insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code, fluid_spec_code, capacity_note_en) values
  (pg_temp.mk('maint:n63tu2_oil', 'maintenance_item', 'N63TU2 engine oil and filter'),
   pg_temp.sid('var:n63b44o2'), 'engine_oil', 'BMW_LL01_FE_0W30',
   '10.5 litres with filter on xDrive applications, 10.0 litres without xDrive'),
  (pg_temp.mk('maint:n63tu2_plugs', 'maintenance_item', 'N63TU2 spark plugs'),
   pg_temp.sid('var:n63b44o2'), 'spark_plugs', null, null),
  (pg_temp.mk('maint:n63tu2_coolant', 'maintenance_item', 'N63TU2 engine coolant'),
   pg_temp.sid('var:n63b44o2'), 'coolant', null, null),
  (pg_temp.mk('maint:n63tu2_radiators', 'maintenance_item', 'N63TU2 radiator pack cleaning'),
   pg_temp.sid('var:n63b44o2'), 'radiator_cleaning', null, null),
  (pg_temp.mk('maint:zf8hp75_atf', 'maintenance_item', 'ZF 8HP75 transmission fluid'),
   pg_temp.sid('var:zf8hp75'), 'atf', 'ZF_LIFEGUARD_8',
   'Pan with integrated filter; level is set at 40 to 50 C'),
  (pg_temp.mk('maint:atc13_fluid', 'maintenance_item', 'ATC13-1 transfer case fluid'),
   pg_temp.sid('var:atc13_1'), 'transfer_case_fluid', 'BMW_DTF_1',
   'Under one litre of DTF-1; the case has no drain plug');

-- ---------- Перевірки ----------

insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
    cannot_prove_en, conditions, default_priority, materially_resolves, resolves_dimension) values
  (pg_temp.mk('chk:n63_borescope', 'check_item', 'Borescope all eight N63 cylinders'),
   'borescope', pg_temp.sid('var:n63b44o2'),
   'Bore scoring on Alusil bores is irreversible, costs about a third of the car to repair, is not tied to mileage and does not show up in compression or oil analysis.',
   'Shows the bore walls, the honing pattern, the piston crowns, valve carbon and traces of coolant across all eight cylinders.',
   'Does not show the rings, valve stem seals, bearing shells, turbochargers or the timing chain, and confirms the state today rather than remaining life.',
   array['all eight cylinders, not only the front ones'], 'must', true, 'component_variant'),
  (pg_temp.mk('chk:n63_compression', 'check_item', 'N63 compression test'),
   'compression', pg_temp.sid('var:n63b44o2'),
   'A spread between cylinders points at ring, valve or gasket problems.',
   'Relative health of the cylinders against each other; a spread up to about ten percent is accepted in practice.',
   'Does not reveal early bore scoring or valve stem seals, and BMW publishes no absolute factory figures for this engine.',
   array['engine at operating temperature', 'injectors disabled through the factory diagnostic system'],
   'good', false, null),
  (pg_temp.mk('chk:n63_leak_down', 'check_item', 'N63 leak down test'),
   'leak_down', pg_temp.sid('var:n63b44o2'),
   'Tells where the pressure escapes when compression is low.',
   'Separates rings, valves and head gasket as the escape path; up to eight to ten percent is the healthy guide figure.',
   'Does not replace a borescope and does not reveal early bore scoring.',
   null, 'good', false, null),
  (pg_temp.mk('chk:g30_ista_scan', 'check_item', 'Full diagnostic scan before purchase'),
   'diagnostic_scan', pg_temp.sid('gen:g30'),
   'Shadow faults, adaptation values and counters survive a dashboard that shows nothing.',
   'Fault memory with history and shadow entries, wastegate and thermostat adaptations, misfire counters, engine control unit reflash counter, software versions and the history of service counter resets.',
   'A memory cleared shortly before the viewing proves nothing at all.',
   null, 'must', false, null),
  (pg_temp.mk('chk:n63_oil_analysis', 'check_item', 'Oil analysis and filter cut open'),
   'fluid_analysis', pg_temp.sid('var:n63b44o2'),
   'Bearing metal and coolant emulsion are visible in the oil before they are visible anywhere else.',
   'Presence of bearing metal and of coolant in the oil.',
   'Does not rule out bore scoring: a documented case had clean oil and filter with two scored cylinders.',
   null, 'good', false, null),
  (pg_temp.mk('chk:n63_turbo_check', 'check_item', 'Turbocharger condition check on a hot-V engine'),
   'road_test', pg_temp.sid('var:n63b44o2'),
   'Shaft play cannot be felt by hand on a hot-V engine without removing the intake.',
   'Wastegate fault codes and adaptations, whistle under part load, smoke on a throttle blip and oil in the charge pipes.',
   'Oil film in the charge pipes also comes from normal crankcase ventilation, so it is not by itself proof of a failed turbocharger.',
   null, 'good', false, null);

insert into mi.check_covers (check_id, target_subject_id, role) values
  (pg_temp.sid('chk:n63_borescope'),    pg_temp.sid('issue:n63_bore_scoring'),      'detects'),
  (pg_temp.sid('chk:n63_compression'),  pg_temp.sid('issue:n63_bore_scoring'),      'detects'),
  (pg_temp.sid('chk:n63_leak_down'),    pg_temp.sid('issue:n63_bore_scoring'),      'detects'),
  (pg_temp.sid('chk:n63_oil_analysis'), pg_temp.sid('issue:n63_spun_bearing'),      'detects'),
  (pg_temp.sid('chk:g30_ista_scan'),    pg_temp.sid('issue:n63_wastegate_actuator'),'detects'),
  (pg_temp.sid('chk:g30_ista_scan'),    pg_temp.sid('issue:n63r_map_thermostat'),   'detects'),
  (pg_temp.sid('chk:n63_turbo_check'),  pg_temp.sid('issue:n63_wastegate_actuator'),'detects');

-- ---------- Стан компонента як знання ----------

insert into mi.component_state_type (subject_id, state_key, state_kind, applies_to_subject_id,
    resulting_variant_id, sanctioned_by_oem) values
  (pg_temp.mk('state:n63_sleeved', 'component_state_type', 'N63 block sleeved with iron liners'),
   'bmw_n63_sleeved_block', 'rebuild', pg_temp.sid('var:n63b44o2'), null, false),
  (pg_temp.mk('state:n63_used_engine', 'component_state_type', 'N63 replaced with a used engine'),
   'bmw_n63_used_engine_swap', 'replacement_used', pg_temp.sid('var:n63b44o2'), null, false),
  (pg_temp.mk('state:n63_ecu_flash', 'component_state_type', 'N63 engine control unit reflashed'),
   'bmw_n63_ecu_reflash', 'modification_unsanctioned', pg_temp.sid('var:n63b44o2'), null, false),
  (pg_temp.mk('state:n63_thermostat_defeat', 'component_state_type', 'N63 thermostat sensor defeat device'),
   'bmw_n63_thermostat_defeat', 'modification_unsanctioned', pg_temp.sid('var:n63b44o2'), null, false);
