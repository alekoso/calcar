-- Phase 3 back-loading: граф сутностей Porsche Cayenne GTS 958.1 MY2013.
--
-- Джерело: docs/model-intelligence/reference/porsche-cayenne-gts-958-1-my2013.md (FROZEN).

insert into mi.brand (subject_id, name, country)
values (pg_temp.mk('brand:porsche', 'brand', 'Porsche'), 'Porsche', 'DE');

insert into mi.model_line (subject_id, brand_id, name)
values (pg_temp.mk('line:cayenne', 'model_line', 'Porsche Cayenne'), pg_temp.sid('brand:porsche'), 'Cayenne');

insert into mi.generation (subject_id, model_line_id, platform_code, phase,
    powertrain_types, default_system_profile, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('gen:958_1', 'generation', 'Porsche Cayenne 958.1'),
   pg_temp.sid('line:cayenne'), '958', 'base', array['ice','hev']::mi.powertrain[], 'ice_default',
   date '2010-06-01', 'known', date '2014-12-31', 'known');

insert into mi.generation (subject_id, model_line_id, platform_code, phase, phase_of_id,
    powertrain_types, default_system_profile, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('gen:958_2', 'generation', 'Porsche Cayenne 958.2'),
   pg_temp.sid('line:cayenne'), '958', 'facelift', pg_temp.sid('gen:958_1'),
   array['ice','phev']::mi.powertrain[], 'ice_default',
   date '2014-10-01', 'known', date '2018-12-31', 'known');

insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain) values
  (pg_temp.mk('ver:cayenne_gts_958_1', 'vehicle_version', 'Porsche Cayenne GTS 958.1'),
   pg_temp.sid('gen:958_1'), 'GTS', 'Cayenne GTS', 'ice'),
  (pg_temp.mk('ver:cayenne_s_958_1', 'vehicle_version', 'Porsche Cayenne S 958.1'),
   pg_temp.sid('gen:958_1'), 'S', 'Cayenne S', 'ice'),
  (pg_temp.mk('ver:cayenne_turbo_958_1', 'vehicle_version', 'Porsche Cayenne Turbo 958.1'),
   pg_temp.sid('gen:958_1'), 'TURBO', 'Cayenne Turbo', 'ice');

insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
    prod_from, prod_from_kind, prod_to, prod_to_kind, base_price, currency) values
  (pg_temp.mk('vmy:cayenne_gts_us_2013', 'version_market_year', 'Porsche Cayenne GTS US MY2013'),
   pg_temp.sid('ver:cayenne_gts_958_1'), 'US', 2013,
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown', 82050.00, 'USD'),
  (pg_temp.mk('vmy:cayenne_gts_us_2014', 'version_market_year', 'Porsche Cayenne GTS US MY2014'),
   pg_temp.sid('ver:cayenne_gts_958_1'), 'US', 2014,
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown', null, null);

-- ---------- Компонентні родини і варіанти ----------

insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en) values
  (pg_temp.mk('fam:porsche_m48', 'component_family', 'Porsche M48 4.8 V8'), pg_temp.sid('brand:porsche'),
   'PORSCHE_M48', 'engine', 'Naturally aspirated and turbocharged 4.8 V8 with direct injection, variable valve timing and lift, and an integrated dry sump'),
  (pg_temp.mk('fam:aisin_tr80sd', 'component_family', 'Aisin TR-80SD eight speed automatic'), null,
   'AISIN_TR80SD', 'transmission', 'Aisin eight speed torque converter automatic, Volkswagen group code 0C8'),
  (pg_temp.mk('fam:porsche_958_tc', 'component_family', 'Porsche 958 transfer case'), pg_temp.sid('brand:porsche'),
   'PORSCHE_958_TC', 'transfer_case', 'Electronically controlled multi plate clutch transfer case without a low range'),
  (pg_temp.mk('fam:porsche_958_air', 'component_family', 'Porsche 958 air suspension'), pg_temp.sid('brand:porsche'),
   'PORSCHE_958_AIR_SUSP', 'suspension_system', 'Air struts with a Continental compressor'),
  (pg_temp.mk('fam:porsche_pdcc', 'component_family', 'Porsche Dynamic Chassis Control'), pg_temp.sid('brand:porsche'),
   'PORSCHE_PDCC', 'suspension_system', 'Hydraulic active anti roll system sharing its pump with the power steering'),
  (pg_temp.mk('fam:porsche_brakes', 'component_family', 'Porsche Cayenne brake system'), pg_temp.sid('brand:porsche'),
   'PORSCHE_958_BRAKES', 'brake_system', 'Fixed caliper brake system, steel or ceramic composite discs'),
  (pg_temp.mk('fam:porsche_pcm', 'component_family', 'Porsche Communication Management'), pg_temp.sid('brand:porsche'),
   'PORSCHE_PCM', 'infotainment', 'Central infotainment and navigation head unit');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:m48_02', 'component_variant', 'Porsche M48.02'), pg_temp.sid('fam:porsche_m48'),
   'M48_02', 'M48.02, 4.8 V8 rated 420 hp in the GTS',
   date '2012-06-01', 'known', date '2014-12-31', 'known'),
  (pg_temp.mk('var:m48_01', 'component_variant', 'Porsche M48.01'), pg_temp.sid('fam:porsche_m48'),
   'M48_01', 'M48.01, 4.8 V8 as fitted to the Cayenne S',
   date '2010-06-01', 'known', date '2014-12-31', 'known'),
  (pg_temp.mk('var:tr80sd_0c8', 'component_variant', 'Aisin TR-80SD (0C8)'), pg_temp.sid('fam:aisin_tr80sd'),
   'TR80SD_0C8', 'Tiptronic S eight speed, Aisin TR-80SD, code 0C8',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:tc_958', 'component_variant', 'Porsche 958 transfer case'), pg_temp.sid('fam:porsche_958_tc'),
   'TC_958', 'Transfer case as fitted to the 958.1 and 958.2',
   date '2010-06-01', 'known', date '2018-12-31', 'known'),
  (pg_temp.mk('var:air_958', 'component_variant', 'Porsche 958 air suspension'), pg_temp.sid('fam:porsche_958_air'),
   'AIR_958', 'Air suspension with self levelling and ride height adjustment',
   date '2010-06-01', 'known', date '2018-12-31', 'known'),
  (pg_temp.mk('var:pdcc_958', 'component_variant', 'Porsche Dynamic Chassis Control 958'), pg_temp.sid('fam:porsche_pdcc'),
   'PDCC_958', 'Dynamic Chassis Control as fitted to the 958',
   date '2010-06-01', 'known', date '2018-12-31', 'known'),
  (pg_temp.mk('var:pccb_958', 'component_variant', 'Porsche Ceramic Composite Brake 958'), pg_temp.sid('fam:porsche_brakes'),
   'PCCB_958', 'Ceramic composite brake system',
   date '2010-06-01', 'known', date '2018-12-31', 'known'),
  (pg_temp.mk('var:steel_brakes_gts', 'component_variant', 'Cayenne GTS steel brake system'), pg_temp.sid('fam:porsche_brakes'),
   'STEEL_GTS', 'Steel brakes, 360 mm six piston front and 330 mm four piston rear with red calipers',
   date '2012-06-01', 'known', date '2014-12-31', 'known'),
  (pg_temp.mk('var:pcm_3_1', 'component_variant', 'Porsche Communication Management 3.1'), pg_temp.sid('fam:porsche_pcm'),
   'PCM_3_1', 'PCM 3.1',
   date '2010-06-01', 'known', date '2014-12-31', 'known');

insert into mi.variant_attribute (variant_id, attr_key, attr_value) values
  (pg_temp.sid('var:m48_02'), 'cylinder_bore_technology', 'alusil'),
  (pg_temp.sid('var:m48_01'), 'cylinder_bore_technology', 'alusil'),
  (pg_temp.sid('var:m48_02'), 'cooling_layout', 'conventional');

insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), 'engine',           pg_temp.sid('var:m48_02'),        'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), 'transmission',     pg_temp.sid('var:tr80sd_0c8'),    'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), 'transfer_case',    pg_temp.sid('var:tc_958'),        'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), 'brake_system',     pg_temp.sid('var:steel_brakes_gts'),'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), 'brake_system',     pg_temp.sid('var:pccb_958'),      'optional'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), 'suspension_system',pg_temp.sid('var:air_958'),       'optional'),
  (pg_temp.sid('vmy:cayenne_gts_us_2014'), 'engine',           pg_temp.sid('var:m48_02'),        'standard');

-- ---------- Обладнання ----------

insert into mi.equipment_item (subject_id, brand_id, equipment_key, item_kind, name_en, implements_variant_id) values
  (pg_temp.mk('equip:pasm_steel', 'equipment_item', 'PASM with steel springs'),
   pg_temp.sid('brand:porsche'), 'pasm_steel_springs', 'system_config',
   'Porsche Active Suspension Management with steel springs and a lowered ride height', null),
  (pg_temp.mk('equip:air_susp', 'equipment_item', 'Air suspension'),
   pg_temp.sid('brand:porsche'), 'air_suspension', 'option', 'Air suspension with Porsche Active Suspension Management',
   pg_temp.sid('var:air_958')),
  (pg_temp.mk('equip:pdcc', 'equipment_item', 'Porsche Dynamic Chassis Control'),
   pg_temp.sid('brand:porsche'), 'pdcc', 'option', 'Porsche Dynamic Chassis Control', pg_temp.sid('var:pdcc_958')),
  (pg_temp.mk('equip:pccb', 'equipment_item', 'Porsche Ceramic Composite Brakes'),
   pg_temp.sid('brand:porsche'), 'pccb', 'option', 'Porsche Ceramic Composite Brakes', pg_temp.sid('var:pccb_958')),
  (pg_temp.mk('equip:sport_chrono', 'equipment_item', 'Sport Chrono package'),
   pg_temp.sid('brand:porsche'), 'sport_chrono', 'package', 'Sport Chrono package', null),
  (pg_temp.mk('equip:rs_spyder_20', 'equipment_item', 'RS Spyder 20 inch wheels'),
   pg_temp.sid('brand:porsche'), 'rs_spyder_20', 'wheel_tire_setup', 'Twenty inch RS Spyder wheels', null),
  (pg_temp.mk('equip:sport_exhaust', 'equipment_item', 'Sport exhaust'),
   pg_temp.sid('brand:porsche'), 'sport_exhaust', 'option', 'Sport exhaust system', null),
  (pg_temp.mk('equip:sound_symposer', 'equipment_item', 'Sound Symposer'),
   pg_temp.sid('brand:porsche'), 'sound_symposer', 'option', 'Sound Symposer intake sound pipe', null),
  (pg_temp.mk('equip:ptv_plus', 'equipment_item', 'Porsche Torque Vectoring Plus'),
   pg_temp.sid('brand:porsche'), 'ptv_plus', 'option',
   'Porsche Torque Vectoring Plus with a locking rear differential', null);

insert into mi.equipment_availability (vmy_id, item_id, availability) values
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:pasm_steel'),    'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:rs_spyder_20'),  'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:sport_exhaust'), 'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:sound_symposer'),'standard'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:sport_chrono'),  'optional'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:air_susp'),      'optional'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:pdcc'),          'optional'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:pccb'),          'optional'),
  (pg_temp.sid('vmy:cayenne_gts_us_2013'), pg_temp.sid('equip:ptv_plus'),      'optional');

insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id) values
  (pg_temp.sid('var:m48_02'),  'M48.02', 'm48.02', 'en', 'official',  'brand', pg_temp.sid('brand:porsche')),
  (pg_temp.sid('var:tr80sd_0c8'), '0C8',  '0c8',    'en', 'catalog',   'global', null),
  (pg_temp.sid('equip:pdcc'),  'PDCC',   'pdcc',   'en', 'official',  'brand', pg_temp.sid('brand:porsche')),
  (pg_temp.sid('equip:pccb'),  'PCCB',   'pccb',   'en', 'official',  'brand', pg_temp.sid('brand:porsche')),
  (pg_temp.sid('equip:pasm_steel'), 'PASM', 'pasm', 'en', 'official', 'brand', pg_temp.sid('brand:porsche')),
  (pg_temp.sid('gen:958_1'),   '958.1',  '958.1',  'en', 'community', 'model_line', pg_temp.sid('line:cayenne'));

-- ---------- Проблеми ----------

insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity) values
  (pg_temp.mk('issue:m48_bore_scoring', 'issue', 'Porsche 4.8 V8 bore scoring'),
   'porsche_m48_bore_scoring', pg_temp.sid('var:m48_02'),
   'Cylinder bore scoring on Alusil bores',
   'The same aluminium silicon mechanism as on any Alusil bore: silicon grains are torn out and the matrix deforms. Reboring is impossible, so repair means sleeving or a new block.',
   'catastrophic', 'usage'),
  (pg_temp.mk('issue:958_coolant_pipes', 'issue', 'Porsche 958 V8 glued coolant pipes'),
   'porsche_958_glued_coolant_pipes', pg_temp.sid('fam:porsche_m48'),
   'Glued coolant pipes let go and dump the coolant',
   'The adhesive holding the coolant pipes into the thermostat housing and the distributor under the intake degrades with heat and age, and the joint lets go without warning.',
   'catastrophic', 'mixed'),
  (pg_temp.mk('issue:958_pump_thermostat', 'issue', 'Porsche 958 V8 water pump and thermostat age'),
   'porsche_958_pump_thermostat_age', pg_temp.sid('fam:porsche_m48'),
   'Water pump and thermostat fail with age',
   'The thermostat sits behind the pump, so both are replaced together with the coolant pipes.',
   'major', 'mixed'),
  (pg_temp.mk('issue:958_aos', 'issue', 'Porsche V8 air oil separator diaphragm'),
   'porsche_v8_aos_diaphragm', pg_temp.sid('fam:porsche_m48'),
   'Air oil separator diaphragm tears',
   'A torn diaphragm puts the crankcase under intake vacuum, which draws oil through and produces white smoke, oil consumption, a whistle, oiled plugs and damaged catalysts.',
   'major', 'calendar'),
  (pg_temp.mk('issue:958_hpfp', 'issue', 'Porsche 958 V8 high pressure fuel pump'),
   'porsche_958_hpfp', pg_temp.sid('fam:porsche_m48'),
   'High pressure fuel pump failure',
   'A failing pump gives long cranking, hesitation, the P0087 fault and limp mode.',
   'major', 'mixed'),
  (pg_temp.mk('issue:958_cam_bolts', 'issue', 'Porsche 4.8 V8 camshaft adjuster bolts'),
   'porsche_v8_camshaft_adjuster_bolts', pg_temp.sid('fam:porsche_m48'),
   'Camshaft adjuster bolts fail',
   'Bolt failure costs brake servo vacuum and damages the valve train; a steel bolt is the updated part.',
   'catastrophic', 'mixed'),
  (pg_temp.mk('issue:958_oil_leaks', 'issue', 'Porsche 958 V8 age related oil leaks'),
   'porsche_958_age_oil_leaks', pg_temp.sid('fam:porsche_m48'),
   'Oil leaks at the covers and seals, coil failures and corroded coolant connectors', null, 'moderate', 'calendar'),
  (pg_temp.mk('issue:958_valve_body', 'issue', 'Porsche 958 Tiptronic valve body wear'),
   'porsche_958_valve_body_spools', pg_temp.sid('var:tr80sd_0c8'),
   'Worn valve body spools and lock-up shudder on old fluid',
   'Valve body spools wear, and the valve body bolts loosen as the gasket sets.',
   'major', 'mileage'),
  (pg_temp.mk('issue:958_transfer_case', 'issue', 'Porsche 958 transfer case degradation'),
   'porsche_958_transfer_case', pg_temp.sid('var:tc_958'),
   'Transfer case clutch pack degrades',
   'The friction additives in the fluid degrade, so the clutch pack judders; fresh fluid removes the symptom early but does not restore a worn pack.',
   'catastrophic', 'mileage'),
  (pg_temp.mk('issue:958_air_strut', 'issue', 'Porsche 958 air strut leaks'),
   'porsche_958_air_strut_leak', pg_temp.sid('var:air_958'),
   'Air struts leak at any corner and burn out the compressor',
   'A leaking strut makes the Continental compressor run until it fails.',
   'major', 'calendar'),
  (pg_temp.mk('issue:958_pdcc_lines', 'issue', 'Porsche PDCC line and pump failures'),
   'porsche_958_pdcc_failure', pg_temp.sid('var:pdcc_958'),
   'Corroded braided lines, accumulators and the shared pump',
   'The steel braiding corrodes and the line bursts; the pump is shared with the power steering and sits in an awkward place, so replacing only the leaking part invites a repeat.',
   'major', 'calendar'),
  (pg_temp.mk('issue:958_pasm_failure', 'issue', 'Porsche 958 PASM damper failure'),
   'porsche_958_pasm_failure', pg_temp.sid('equip:pasm_steel'),
   'Damper control failures and damper leaks with age', null, 'moderate', 'calendar'),
  (pg_temp.mk('issue:958_parking_brake', 'issue', 'Porsche 958 electric parking brake motors'),
   'porsche_958_parking_brake_motor', pg_temp.sid('gen:958_1'),
   'Electromechanical parking brake motor failures', null, 'moderate', 'calendar'),
  (pg_temp.mk('issue:958_pcm_faults', 'issue', 'Porsche PCM 3.1 faults'),
   'porsche_pcm_3_1_faults', pg_temp.sid('var:pcm_3_1'),
   'Slow response, freezes and missing component messages', null, 'minor', 'calendar'),
  (pg_temp.mk('issue:958_weak_battery', 'issue', 'Porsche 958 phantom faults on a weak battery'),
   'porsche_958_weak_battery_faults', pg_temp.sid('gen:958_1'),
   'Phantom fault messages when the battery sags', null, 'minor', 'calendar'),
  (pg_temp.mk('issue:958_drains', 'issue', 'Porsche 958 blocked air conditioning and cowl drains'),
   'porsche_958_blocked_drains', pg_temp.sid('gen:958_1'),
   'Blocked drains put water in the footwells and into modules', null, 'major', 'calendar'),
  (pg_temp.mk('issue:958_brittle_plastic', 'issue', 'Porsche 958 brittle interior plastics'),
   'porsche_958_brittle_plastics', pg_temp.sid('gen:958_1'),
   'Brittle vent sliders, buttons and covers, and rattling cup holders', null, 'minor', 'calendar');

-- ---------- Обслуговування ----------

insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code, fluid_spec_code, capacity_note_en) values
  (pg_temp.mk('maint:m48_oil', 'maintenance_item', 'M48.02 engine oil'),
   pg_temp.sid('var:m48_02'), 'engine_oil', 'PORSCHE_A40_0W40', null),
  (pg_temp.mk('maint:m48_plugs', 'maintenance_item', 'M48 spark plugs'),
   pg_temp.sid('fam:porsche_m48'), 'spark_plugs', null, null),
  (pg_temp.mk('maint:0c8_atf', 'maintenance_item', 'Tiptronic S transmission fluid'),
   pg_temp.sid('var:tr80sd_0c8'), 'atf', null, null),
  (pg_temp.mk('maint:958_tc_fluid', 'maintenance_item', '958 transfer case fluid'),
   pg_temp.sid('var:tc_958'), 'transfer_case_fluid', 'SHELL_TF_0870', null),
  (pg_temp.mk('maint:958_diff_fluid', 'maintenance_item', '958 rear differential fluid'),
   pg_temp.sid('equip:ptv_plus'), 'differential_fluid', null,
   'One litre for the open differential, two litres with the locking differential'),
  (pg_temp.mk('maint:958_drains', 'maintenance_item', '958 drain cleaning'),
   pg_temp.sid('gen:958_1'), 'other', null, null);

-- ---------- Перевірки ----------

insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
    cannot_prove_en, conditions, default_priority, materially_resolves, resolves_dimension) values
  (pg_temp.mk('chk:m48_borescope', 'check_item', 'Borescope all eight M48 cylinders'),
   'borescope', pg_temp.sid('var:m48_02'),
   'Bore scoring is rare on this engine but catastrophic when it happens, and nothing else reveals it without dismantling.',
   'The state of all eight bore walls today.',
   'Does not protect against future cold short trip use, which is what causes the damage in the first place.',
   array['all eight cylinders'], 'must', true, 'component_variant'),
  (pg_temp.mk('chk:958_coolant_evidence', 'check_item', 'Coolant pipe repair evidence'),
   'documentation', pg_temp.sid('fam:porsche_m48'),
   'The glued pipes fail without warning and dump the coolant, so whether they were already replaced changes the risk completely.',
   'Whether aluminium replacement pipes and a bolted housing are documented as fitted.',
   'Absence of paperwork does not prove the original pipes are still in the car.',
   null, 'must', true, 'component_state_present'),
  (pg_temp.mk('chk:958_tc_road_test', 'check_item', 'Transfer case acceleration test'),
   'road_test', pg_temp.sid('var:tc_958'),
   'A degraded clutch pack judders before it fails, and the replacement is one of the largest single bills on this car.',
   'Judder or snatch under gentle acceleration at low speed.',
   'Fresh fluid masks the symptom, so a clean test on recently serviced fluid does not prove a healthy pack.',
   null, 'must', false, null),
  (pg_temp.mk('chk:958_air_overnight', 'check_item', 'Overnight settling test of the 958 air suspension'),
   'overnight_test', pg_temp.sid('var:air_958'),
   'Strut leaks are slow and the compressor fails as a consequence.',
   'Whether a corner settles overnight.',
   'Does not show how much compressor life is left.',
   null, 'good', false, null),
  (pg_temp.mk('chk:958_pdcc_lines', 'check_item', 'Inspect the PDCC lines and fault memory'),
   'visual', pg_temp.sid('var:pdcc_958'),
   'PDCC is the option that turns an ageing Cayenne into an open ended bill.',
   'Corrosion on the braided lines and stored chassis system faults.',
   'Does not reveal the condition of the accumulators or the shared pump.',
   null, 'good', false, null),
  (pg_temp.mk('chk:958_service_records', 'check_item', 'Service record review'),
   'documentation', pg_temp.sid('ver:cayenne_gts_958_1'),
   'On this car the owner consensus is that service history matters more than mileage.',
   'Which of the known age related jobs have already been paid for.',
   'Does not establish the current mechanical condition on its own.',
   null, 'must', false, null),
  (pg_temp.mk('chk:958_aos_vacuum', 'check_item', 'Crankcase vacuum test at the oil filler'),
   'visual', pg_temp.sid('fam:porsche_m48'),
   'A torn air oil separator diaphragm shows up as excessive crankcase vacuum before the smoke does.',
   'Whether the crankcase is under abnormal vacuum.',
   'Does not quantify how much oil has already reached the catalysts.',
   null, 'good', false, null);

insert into mi.check_covers (check_id, target_subject_id, role) values
  (pg_temp.sid('chk:m48_borescope'),        pg_temp.sid('issue:m48_bore_scoring'),   'detects'),
  (pg_temp.sid('chk:958_coolant_evidence'), pg_temp.sid('issue:958_coolant_pipes'),  'verifies_state'),
  (pg_temp.sid('chk:958_tc_road_test'),     pg_temp.sid('issue:958_transfer_case'),  'detects'),
  (pg_temp.sid('chk:958_air_overnight'),    pg_temp.sid('issue:958_air_strut'),      'detects'),
  (pg_temp.sid('chk:958_pdcc_lines'),       pg_temp.sid('issue:958_pdcc_lines'),     'detects'),
  (pg_temp.sid('chk:958_aos_vacuum'),       pg_temp.sid('issue:958_aos'),            'detects'),
  (pg_temp.sid('chk:958_service_records'),  pg_temp.sid('issue:958_coolant_pipes'),  'verifies_state');

-- ---------- Стани компонента ----------

insert into mi.component_state_type (subject_id, state_key, state_kind, applies_to_subject_id,
    sanctioned_by_oem) values
  (pg_temp.mk('state:958_alu_pipes', 'component_state_type', '958 coolant pipes replaced with aluminium'),
   'porsche_958_alu_coolant_pipes', 'repair', pg_temp.sid('fam:porsche_m48'), false),
  (pg_temp.mk('state:958_tc_replaced', 'component_state_type', '958 transfer case replaced'),
   'porsche_958_transfer_case_replaced', 'replacement_new', pg_temp.sid('var:tc_958'), true),
  (pg_temp.mk('state:958_pdcc_delete', 'component_state_type', 'PDCC deleted'),
   'porsche_958_pdcc_delete', 'modification_unsanctioned', pg_temp.sid('var:pdcc_958'), false),
  (pg_temp.mk('state:958_cam_bolts_done', 'component_state_type', 'Camshaft adjuster bolts updated'),
   'porsche_958_cam_bolts_updated', 'repair', pg_temp.sid('fam:porsche_m48'), true),
  (pg_temp.mk('state:958_pccb_retrofit', 'component_state_type', 'PCCB retrofitted'),
   'porsche_958_pccb_retrofit', 'retrofit', pg_temp.sid('fam:porsche_brakes'), true);
