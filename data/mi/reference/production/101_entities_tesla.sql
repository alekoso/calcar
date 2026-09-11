-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 101_entities_tesla.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- Phase 3 back-loading: граф сутностей Tesla Model S P85D MY2015.
--
-- Джерело: docs/model-intelligence/reference/tesla-model-s-p85d-my2015.md (FROZEN).
-- Ролей engine і transmission у BEV немає: вони не створюються.

insert into mi.brand (subject_id, name, country)
values (mi_load.mk('brand:tesla', 'brand', 'Tesla'), 'Tesla', 'US');

insert into mi.model_line (subject_id, brand_id, name)
values (mi_load.mk('line:model_s', 'model_line', 'Tesla Model S'), mi_load.sid('brand:tesla'), 'Model S');

insert into mi.generation (subject_id, model_line_id, platform_code, phase,
    powertrain_types, default_system_profile, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('gen:ms_pre_facelift', 'generation', 'Tesla Model S pre-facelift'),
   mi_load.sid('line:model_s'), 'MS_PRE_FACELIFT', 'base', array['bev']::mi.powertrain[], 'bev_default',
   date '2012-06-01', 'known', date '2016-04-01', 'known'),
  (mi_load.mk('gen:ms_facelift', 'generation', 'Tesla Model S facelift'),
   mi_load.sid('line:model_s'), 'MS_FACELIFT', 'base', array['bev']::mi.powertrain[], 'bev_default',
   date '2016-04-01', 'known', date '9999-12-31', 'unknown');

insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain) values
  (mi_load.mk('ver:p85d', 'vehicle_version', 'Tesla Model S P85D'),
   mi_load.sid('gen:ms_pre_facelift'), 'P85D', 'Model S P85D', 'bev'),
  (mi_load.mk('ver:85d', 'vehicle_version', 'Tesla Model S 85D'),
   mi_load.sid('gen:ms_pre_facelift'), '85D', 'Model S 85D', 'bev'),
  (mi_load.mk('ver:90d', 'vehicle_version', 'Tesla Model S 90D'),
   mi_load.sid('gen:ms_pre_facelift'), '90D', 'Model S 90D', 'bev');

insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('vmy:p85d_us_2015', 'version_market_year', 'Tesla Model S P85D US MY2015'),
   mi_load.sid('ver:p85d'), 'US', 2015,
   date '2014-11-01', 'known', date '2016-02-29', 'known');

-- ---------- Компонентні родини і варіанти ----------

insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en) values
  (mi_load.mk('fam:tesla_ldu', 'component_family', 'Tesla large drive unit'), mi_load.sid('brand:tesla'),
   'TESLA_LDU', 'drive_unit', 'Rear induction motor with integrated single speed reduction gear, liquid cooled rotor'),
  (mi_load.mk('fam:tesla_sdu', 'component_family', 'Tesla small drive unit'), mi_load.sid('brand:tesla'),
   'TESLA_SDU', 'drive_unit', 'Front induction motor with integrated single speed reduction gear'),
  (mi_load.mk('fam:tesla_s_pack', 'component_family', 'Tesla Model S high voltage pack'), mi_load.sid('brand:tesla'),
   'TESLA_S_PACK', 'battery_pack', 'Sixteen module pack of cylindrical 18650 cells, liquid cooled, vented through breathers'),
  (mi_load.mk('fam:tesla_mcu', 'component_family', 'Tesla media control unit'), mi_load.sid('brand:tesla'),
   'TESLA_MCU', 'infotainment', 'Central touchscreen computer with on board flash storage'),
  (mi_load.mk('fam:tesla_ap', 'component_family', 'Tesla Autopilot hardware'), mi_load.sid('brand:tesla'),
   'TESLA_AP_HW', 'adas_hw', 'Forward camera, radar and ultrasonic sensors with a vision processing unit'),
  (mi_load.mk('fam:tesla_modem', 'component_family', 'Tesla telematics modem'), mi_load.sid('brand:tesla'),
   'TESLA_MODEM', 'modem', 'Cellular modem for connectivity and remote access'),
  (mi_load.mk('fam:tesla_charger', 'component_family', 'Tesla on-board charger'), mi_load.sid('brand:tesla'),
   'TESLA_CHARGER', 'charger', 'On-board alternating current charger, single phase on North American cars'),
  (mi_load.mk('fam:tesla_air_susp', 'component_family', 'Tesla Model S air suspension'), mi_load.sid('brand:tesla'),
   'TESLA_S_AIR_SUSP', 'suspension_system', 'Air struts with a single compressor'),
  (mi_load.mk('fam:tesla_handle', 'component_family', 'Tesla Model S door handle'), mi_load.sid('brand:tesla'),
   'TESLA_S_DOOR_HANDLE', 'body_module', 'Retracting door handle with microswitches and a geared actuator'),
  (mi_load.mk('fam:tesla_ptc', 'component_family', 'Tesla Model S cabin heater'), mi_load.sid('brand:tesla'),
   'TESLA_S_CABIN_HEATER', 'hvac', 'Resistive positive temperature coefficient cabin heater');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:ldu_gen1', 'component_variant', 'Tesla LDU pre-revision U'), mi_load.sid('fam:tesla_ldu'),
   'LDU_PRE_REV_U', 'Large drive unit before the revision U repair design',
   date '2012-06-01', 'known', date '2023-09-01', 'known');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:ldu_rev_u', 'component_variant', 'Tesla LDU revision U'), mi_load.sid('fam:tesla_ldu'),
   'LDU_REV_U', 'Large drive unit revision U with the coolant manifold deleted', mi_load.sid('var:ldu_gen1'),
   date '2023-09-01', 'known', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:sdu_gen1', 'component_variant', 'Tesla SDU induction front unit'), mi_load.sid('fam:tesla_sdu'),
   'SDU_INDUCTION', 'Front small drive unit, induction motor',
   date '2014-10-01', 'known', date '2019-04-01', 'known'),
  (mi_load.mk('var:pack_85_gen1', 'component_variant', 'Tesla 85 kWh pack, first generation'), mi_load.sid('fam:tesla_s_pack'),
   'PACK_85_GEN1', '85 kWh pack, sixteen modules of 444 cells',
   date '2012-06-01', 'known', date '2016-04-01', 'known'),
  (mi_load.mk('var:pack_90_gen1', 'component_variant', 'Tesla 90 kWh pack'), mi_load.sid('fam:tesla_s_pack'),
   'PACK_90_GEN1', '90 kWh pack with silicon added to the anode',
   date '2015-07-01', 'known', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:pack_reman_85', 'component_variant', 'Tesla remanufactured 85 pack'), mi_load.sid('fam:tesla_s_pack'),
   'PACK_85_REMAN', 'Remanufactured 85 pack, part number 1088815-01-B',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:pack_new_90_limited', 'component_variant', 'Tesla new 90 pack limited to 85'), mi_load.sid('fam:tesla_s_pack'),
   'PACK_90_LIMITED', 'New 90 pack of fourteen 350 V modules, software limited to 85, part numbers 1014116-00-C and 1918190-85-A',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:mcu1', 'component_variant', 'Tesla MCU1'), mi_load.sid('fam:tesla_mcu'),
   'MCU1', 'Media control unit 1 with 8 GB embedded flash',
   date '2012-06-01', 'known', date '2018-03-01', 'known');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    supersedes_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:mcu2', 'component_variant', 'Tesla MCU2'), mi_load.sid('fam:tesla_mcu'),
   'MCU2', 'Media control unit 2', mi_load.sid('var:mcu1'),
   date '2018-03-01', 'known', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:ap1', 'component_variant', 'Tesla Autopilot hardware 1'), mi_load.sid('fam:tesla_ap'),
   'AP1', 'Autopilot hardware 1 built around the Mobileye EyeQ3 vision processor',
   date '2014-09-01', 'known', date '2016-10-01', 'known'),
  (mi_load.mk('var:ap2', 'component_variant', 'Tesla Autopilot hardware 2'), mi_load.sid('fam:tesla_ap'),
   'AP2', 'Autopilot hardware 2',
   date '2016-10-01', 'known', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:modem_3g', 'component_variant', 'Tesla 3G modem'), mi_load.sid('fam:tesla_modem'),
   'MODEM_3G', 'Third generation cellular modem',
   date '2012-06-01', 'known', date '2015-06-01', 'known'),
  (mi_load.mk('var:modem_lte', 'component_variant', 'Tesla LTE modem'), mi_load.sid('fam:tesla_modem'),
   'MODEM_LTE', 'Long term evolution cellular modem',
   date '2015-06-01', 'known', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:charger_10kw', 'component_variant', 'Tesla 10 kW single charger'), mi_load.sid('fam:tesla_charger'),
   'CHARGER_10KW', 'Single on-board charger rated 40 A on a single phase',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:charger_20kw', 'component_variant', 'Tesla 20 kW dual charger'), mi_load.sid('fam:tesla_charger'),
   'CHARGER_20KW', 'Dual on-board charger rated 80 A on a single phase',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:smart_air_gen1', 'component_variant', 'Tesla Smart Air Suspension, first generation'), mi_load.sid('fam:tesla_air_susp'),
   'SMART_AIR_GEN1', 'Smart Air Suspension as fitted before the Raven revision',
   date '2012-06-01', 'known', date '2019-04-01', 'known'),
  (mi_load.mk('var:handle_gen2', 'component_variant', 'Tesla door handle, second generation'), mi_load.sid('fam:tesla_handle'),
   'HANDLE_GEN2', 'Second generation door handle',
   date '2014-01-01', 'known', date '2016-01-01', 'known'),
  (mi_load.mk('var:ptc_gen1', 'component_variant', 'Tesla cabin PTC heater, first generation'), mi_load.sid('fam:tesla_ptc'),
   'PTC_GEN1', 'First generation cabin heater',
   date '2012-06-01', 'known', date '2015-12-31', 'known');

insert into mi.variant_attribute (variant_id, attr_key, attr_value) values
  (mi_load.sid('var:ldu_gen1'),     'has_rotor_coolant_seal', 'true'),
  (mi_load.sid('var:ldu_rev_u'),    'has_rotor_coolant_seal', 'false'),
  (mi_load.sid('var:ldu_gen1'),     'cooling_layout', 'liquid_rotor'),
  (mi_load.sid('var:sdu_gen1'),     'has_rotor_coolant_seal', 'false'),
  (mi_load.sid('var:pack_85_gen1'), 'cell_chemistry', 'nca'),
  (mi_load.sid('var:pack_90_gen1'), 'cell_chemistry', 'nca');

insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values
  (mi_load.sid('vmy:p85d_us_2015'), 'drive_unit_rear',  mi_load.sid('var:ldu_gen1'),     'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'drive_unit_front', mi_load.sid('var:sdu_gen1'),     'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'battery_pack',     mi_load.sid('var:pack_85_gen1'), 'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'mcu',              mi_load.sid('var:mcu1'),         'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'adas_hw',          mi_load.sid('var:ap1'),          'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'charger',          mi_load.sid('var:charger_10kw'), 'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'charger',          mi_load.sid('var:charger_20kw'), 'optional'),
  (mi_load.sid('vmy:p85d_us_2015'), 'door_handle',      mi_load.sid('var:handle_gen2'),  'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'cabin_heater',     mi_load.sid('var:ptc_gen1'),     'standard'),
  (mi_load.sid('vmy:p85d_us_2015'), 'suspension_system',mi_load.sid('var:smart_air_gen1'),'standard');

insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id) values
  (mi_load.sid('var:ldu_gen1'), 'LDU',  'ldu',  'en', 'community', 'brand', mi_load.sid('brand:tesla')),
  (mi_load.sid('var:sdu_gen1'), 'SDU',  'sdu',  'en', 'community', 'brand', mi_load.sid('brand:tesla')),
  (mi_load.sid('var:mcu1'),     'MCU1', 'mcu1', 'en', 'community', 'brand', mi_load.sid('brand:tesla')),
  (mi_load.sid('var:mcu2'),     'MCU2', 'mcu2', 'en', 'community', 'brand', mi_load.sid('brand:tesla')),
  (mi_load.sid('var:ap1'),      'AP1',  'ap1',  'en', 'community', 'brand', mi_load.sid('brand:tesla')),
  (mi_load.sid('ver:p85d'),     'P85D', 'p85d', 'en', 'official',  'model_line', mi_load.sid('line:model_s'));

-- ---------- Права ----------

insert into mi.entitlement (subject_id, brand_id, entitlement_key, name_en, binding,
    transferable_private, transferable_dealer, revocable, revoke_reasons,
    network_dependency, requires_variant_id) values
  (mi_load.mk('ent:sc01', 'entitlement', 'Free unlimited Supercharging'),
   mi_load.sid('brand:tesla'), 'free_unlimited_supercharging', 'Free unlimited Supercharging', 'vin',
   true, true, true, array['salvage title', 'resold by Tesla through auction'], true, null),
  (mi_load.mk('ent:ap1_option', 'entitlement', 'Autopilot software option'),
   mi_load.sid('brand:tesla'), 'autopilot_software_option', 'Autopilot software option', 'vin',
   true, false, true, array['configuration audit after a dealer sale'], false, mi_load.sid('var:ap1')),
  (mi_load.mk('ent:ludicrous', 'entitlement', 'Ludicrous mode'),
   mi_load.sid('brand:tesla'), 'ludicrous_mode', 'Ludicrous mode', 'vin',
   true, true, false, null, false, null),
  (mi_load.mk('ent:premium_conn', 'entitlement', 'Lifetime Premium Connectivity'),
   mi_load.sid('brand:tesla'), 'premium_connectivity_lifetime', 'Lifetime Premium Connectivity', 'vin',
   true, true, false, null, true, mi_load.sid('var:modem_3g'));

-- ---------- Проблеми ----------

insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity) values
  (mi_load.mk('issue:ldu_coolant_leak', 'issue', 'Tesla LDU rotor coolant leak'),
   'tesla_ldu_rotor_coolant_leak', mi_load.sid('var:ldu_gen1'),
   'Coolant leaks past the rotor seal into the stator',
   'Coolant passes the rotor shaft seal and reaches the stator and the speed sensor; the repair revision deletes the coolant manifold entirely.',
   'catastrophic', 'mixed'),
  (mi_load.mk('issue:ldu_milling', 'issue', 'Tesla LDU bearing milling noise'),
   'tesla_ldu_milling', mi_load.sid('var:ldu_gen1'),
   'Bearing milling noise from the large drive unit', null, 'major', 'mileage'),
  (mi_load.mk('issue:sdu_gear_whine', 'issue', 'Tesla SDU gear whine'),
   'tesla_sdu_gear_whine', mi_load.sid('var:sdu_gen1'),
   'Reduction gear whine from the front drive unit', null, 'minor', 'mileage'),
  (mi_load.mk('issue:half_shaft', 'issue', 'Tesla half shaft vibration and seal leak'),
   'tesla_s_half_shaft', mi_load.sid('gen:ms_pre_facelift'),
   'Half shaft vibration on hard launches and drive shaft seal leaks with age', null, 'moderate', 'mixed'),
  (mi_load.mk('issue:batterygate', 'issue', 'Tesla charge voltage limit after a software update'),
   'tesla_batterygate_voltage_limit', mi_load.sid('var:pack_85_gen1'),
   'Maximum cell voltage reduced by a software update',
   'Software release 2019.16 lowered the maximum cell voltage from about 4.20 V to about 4.07 V on pre-facelift packs, removing capacity and part of the direct current power.',
   'major', 'calendar'),
  (mi_load.mk('issue:chargegate', 'issue', 'Tesla reduced Supercharging peak'),
   'tesla_chargegate_dc_taper', mi_load.sid('var:pack_85_gen1'),
   'Permanently reduced direct current charging peak',
   'Packs with a high count of direct current sessions receive a lowered charging peak that is not reversed.',
   'moderate', 'cycles'),
  (mi_load.mk('issue:bms_u029', 'issue', 'Tesla BMS_u029 maximum charge level reduced'),
   'tesla_bms_u029', mi_load.sid('var:pack_85_gen1'),
   'BMS_u029, maximum charge level reduced',
   'End of life of an early pack; specialists attribute it to the pack electronics and wiring rather than the cells, and it is triggered by calendar age rather than mileage.',
   'catastrophic', 'calendar'),
  (mi_load.mk('issue:pack_condensation', 'issue', 'Tesla pack condensation and module board corrosion'),
   'tesla_pack_condensation', mi_load.sid('var:pack_85_gen1'),
   'Moisture and condensation inside the pack corrode the module boards',
   'The pack breathes through its breathers; air conditioning condensate and humid air reach the module boards and corrode them.',
   'catastrophic', 'calendar'),
  (mi_load.mk('issue:isolation_fault', 'issue', 'Tesla high voltage isolation fault'),
   'tesla_isolation_fault', mi_load.sid('gen:ms_pre_facelift'),
   'High voltage isolation fault',
   'Sources include the battery heater, coolant, high voltage cabling and moisture in a drive unit; diagnosis proceeds by elimination.',
   'major', 'mixed'),
  (mi_load.mk('issue:contactor_weld', 'issue', 'Tesla pack contactor welding'),
   'tesla_contactor_weld', mi_load.sid('var:pack_85_gen1'),
   'Pack contactors weld shut', null, 'major', 'cycles'),
  (mi_load.mk('issue:mcu1_emmc', 'issue', 'Tesla MCU1 flash memory wear'),
   'tesla_mcu1_emmc_wear', mi_load.sid('var:mcu1'),
   'Embedded flash memory wears out',
   'The 8 GB embedded flash chip is written to continuously and reaches its write endurance limit.',
   'major', 'calendar'),
  (mi_load.mk('issue:cluster_flicker', 'issue', 'Tesla instrument cluster flicker'),
   'tesla_cluster_memory_flicker', mi_load.sid('var:mcu1'),
   'Instrument cluster flicker or black screen from the same memory wear',
   'The instrument cluster uses the same kind of flash memory as the media control unit but is not covered by the recall.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:yellow_border', 'issue', 'Tesla touchscreen yellow border and delamination'),
   'tesla_screen_yellow_border', mi_load.sid('var:mcu1'),
   'Yellow border and delamination of the central touchscreen',
   'The adhesive under the glass discolours under ultraviolet light and heat; bubbling and delamination need a new digitizer.',
   'minor', 'calendar'),
  (mi_load.mk('issue:air_strut_leak', 'issue', 'Tesla air strut leak and compressor overload'),
   'tesla_air_strut_leak', mi_load.sid('var:smart_air_gen1'),
   'Front air struts leak and overload the compressor',
   'A leaking strut makes the compressor run continuously until it fails.',
   'major', 'calendar'),
  (mi_load.mk('issue:fore_aft_link', 'issue', 'Tesla front fore and aft link cracking'),
   'tesla_s_fore_aft_link', mi_load.sid('gen:ms_pre_facelift'),
   'Front fore and aft links and ball joints crack or tear', null, 'major', 'mixed'),
  (mi_load.mk('issue:parking_brake_seize', 'issue', 'Tesla rear and parking brake caliper seizing'),
   'tesla_parking_brake_seize', mi_load.sid('gen:ms_pre_facelift'),
   'Rear and parking brake calipers seize in a salt climate',
   'Road salt corrodes the caliper slides; a seized parking brake caliper is replaced as a whole unit.',
   'moderate', 'usage'),
  (mi_load.mk('issue:camber_wear_21', 'issue', 'Tesla 21 inch rear inner edge wear'),
   'tesla_s_21_camber_wear', mi_load.sid('gen:ms_pre_facelift'),
   'Inner edge wear on the rear tyres of the staggered 21 inch setup',
   'Rear camber wears the inner shoulder; adjustable arms are the usual fix.',
   'minor', 'mileage'),
  (mi_load.mk('issue:door_handle_gen2', 'issue', 'Tesla second generation door handle failure'),
   'tesla_door_handle_gen2', mi_load.sid('var:handle_gen2'),
   'Second generation door handle failure',
   'The microswitches sit on brittle wiring and the drive gear is a cast part.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:ptc_heater_gen1', 'issue', 'Tesla first generation cabin heater failure'),
   'tesla_ptc_heater_gen1', mi_load.sid('var:ptc_gen1'),
   'First generation cabin heater failure',
   'Condensate collects on the control board, the heating elements short and the direct current converter fuse blows; access is expensive.',
   'major', 'calendar'),
  (mi_load.mk('issue:dcdc_12v', 'issue', 'Tesla 12 V supply and direct current converter'),
   'tesla_dcdc_12v', mi_load.sid('gen:ms_pre_facelift'),
   'Repeated 12 V low warnings point at the direct current converter',
   'A lead acid 12 V battery lasts two to four years; a repeat warning right after replacement indicates the converter, whose failure immobilises the car.',
   'major', 'calendar'),
  (mi_load.mk('issue:pano_roof_leak', 'issue', 'Tesla panoramic roof leaks and noise'),
   'tesla_pano_roof_gen1', mi_load.sid('gen:ms_pre_facelift'),
   'Panoramic roof leaks and wind noise',
   'First generation roof parts, used until early 2015, are no longer supplied.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:entitlement_removal', 'issue', 'Tesla software feature removal after resale'),
   'tesla_entitlement_removal', mi_load.sid('ent:ap1_option'),
   'Tesla removed a paid software feature after a change of owner',
   'A configuration audit after a car was sold through a dealer removed features the car had shipped with.',
   'major', 'mixed');

-- ---------- Обслуговування ----------

insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code, fluid_spec_code, capacity_note_en) values
  (mi_load.mk('maint:pack_coolant', 'maintenance_item', 'Model S battery coolant'),
   mi_load.sid('var:pack_85_gen1'), 'battery_coolant', 'TESLA_G48_COOLANT', null),
  (mi_load.mk('maint:ms_brake_fluid', 'maintenance_item', 'Model S brake fluid'),
   mi_load.sid('gen:ms_pre_facelift'), 'brake_fluid', 'DOT4_BRAKE_FLUID', null),
  (mi_load.mk('maint:ms_desiccant', 'maintenance_item', 'Model S air conditioning desiccant'),
   mi_load.sid('gen:ms_pre_facelift'), 'ac_desiccant', null, null),
  (mi_load.mk('maint:pack_charging_habit', 'maintenance_item', 'Model S charging habit'),
   mi_load.sid('var:pack_85_gen1'), 'charging_habit', null, null),
  (mi_load.mk('maint:ms_brake_cleaning', 'maintenance_item', 'Model S brake caliper cleaning'),
   mi_load.sid('gen:ms_pre_facelift'), 'other', null,
   'Annual cleaning and lubrication of the caliper pad slides and the parking brake calipers');

-- ---------- Перевірки ----------

insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
    cannot_prove_en, conditions, default_priority, materially_resolves, resolves_dimension) values
  (mi_load.mk('chk:ldu_speed_sensor', 'check_item', 'Inspect the LDU speed sensor for coolant'),
   'visual', mi_load.sid('var:ldu_gen1'),
   'The rotor coolant leak is the main rear drivetrain risk on this car and shows itself at the speed sensor first.',
   'Whether coolant has already reached the speed sensor area today.',
   'A dry sensor today does not guarantee the seal tomorrow, because the seal design is unchanged.',
   null, 'must', false, null),
  (mi_load.mk('chk:pack_can_health', 'check_item', 'Read pack health over the vehicle bus'),
   'battery_diagnostics', mi_load.sid('var:pack_85_gen1'),
   'Rated range on the screen hides both the true nominal capacity and any imposed limit.',
   'Nominal full pack capacity, minimum and maximum group voltages, imbalance and cycle counts.',
   'Shows the pack today; it does not predict an electronic failure such as the maximum charge level fault.',
   null, 'must', true, 'component_variant'),
  (mi_load.mk('chk:pack_group_voltage', 'check_item', 'Check group voltage at full charge'),
   'battery_diagnostics', mi_load.sid('var:pack_85_gen1'),
   'Two otherwise identical cars can differ by an imposed voltage limit.',
   'Whether the pack still charges to about 4.19 to 4.20 V per group or is capped at or below 4.18 V.',
   'Does not say when or why the limit was applied.',
   array['charge to one hundred percent first'], 'must', true, 'component_variant'),
  (mi_load.mk('chk:dc_session', 'check_item', 'Run a direct current charging session'),
   'dc_charge_session', mi_load.sid('var:pack_85_gen1'),
   'A reduced charging peak is only visible while charging.',
   'The real peak power the pack accepts.',
   'Ambient temperature and state of charge also shape the curve, so one session is a lower bound rather than a verdict.',
   array['from roughly ten to sixty percent state of charge'], 'good', false, null),
  (mi_load.mk('chk:entitlement_check', 'check_item', 'Verify software entitlements after transfer'),
   'entitlement_verification', mi_load.sid('ver:p85d'),
   'Hardware presence is not a right: rights are attached to the car in Tesla systems and can be removed.',
   'Which rights the car actually carries in the account after the transfer of ownership.',
   'Does not prevent a later configuration audit from removing a right.',
   null, 'must', true, 'entitlement_state'),
  (mi_load.mk('chk:air_overnight', 'check_item', 'Overnight settling test of the air suspension'),
   'overnight_test', mi_load.sid('var:smart_air_gen1'),
   'A slow strut leak is invisible during a short test drive.',
   'Whether a corner settles overnight.',
   'Does not identify which strut or the compressor condition on its own.',
   null, 'good', false, null),
  (mi_load.mk('chk:cabin_heat_test', 'check_item', 'Cabin heat test'),
   'road_test', mi_load.sid('var:ptc_gen1'),
   'A failed cabin heater makes the car unusable in winter and is expensive to reach.',
   'Whether the cabin heater actually produces heat.',
   'Does not show how close the control board is to failing.',
   null, 'must', false, null);

insert into mi.check_covers (check_id, target_subject_id, role) values
  (mi_load.sid('chk:ldu_speed_sensor'),  mi_load.sid('issue:ldu_coolant_leak'),  'detects'),
  (mi_load.sid('chk:pack_can_health'),   mi_load.sid('var:pack_85_gen1'),        'resolves_identity'),
  (mi_load.sid('chk:pack_group_voltage'),mi_load.sid('issue:batterygate'),       'detects'),
  (mi_load.sid('chk:dc_session'),        mi_load.sid('issue:chargegate'),        'detects'),
  (mi_load.sid('chk:entitlement_check'), mi_load.sid('ent:sc01'),                'verifies_state'),
  (mi_load.sid('chk:air_overnight'),     mi_load.sid('issue:air_strut_leak'),    'detects'),
  (mi_load.sid('chk:cabin_heat_test'),   mi_load.sid('issue:ptc_heater_gen1'),   'detects');

-- ---------- Стани компонента ----------

insert into mi.component_state_type (subject_id, state_key, state_kind, applies_to_subject_id,
    resulting_variant_id, sanctioned_by_oem) values
  (mi_load.mk('state:ludicrous_retrofit', 'component_state_type', 'Ludicrous upgrade fitted'),
   'tesla_ludicrous_upgrade', 'retrofit', mi_load.sid('var:pack_85_gen1'), null, true),
  (mi_load.mk('state:mcu2_retrofit', 'component_state_type', 'MCU2 retrofit'),
   'tesla_mcu2_retrofit', 'retrofit', mi_load.sid('var:mcu1'), mi_load.sid('var:mcu2'), true),
  (mi_load.mk('state:lte_upgrade', 'component_state_type', 'LTE modem upgrade'),
   'tesla_lte_modem_upgrade', 'retrofit', mi_load.sid('var:modem_3g'), mi_load.sid('var:modem_lte'), true),
  (mi_load.mk('state:ccs_retrofit', 'component_state_type', 'CCS charge port retrofit'),
   'tesla_ccs_retrofit', 'retrofit', mi_load.sid('gen:ms_pre_facelift'), null, true),
  (mi_load.mk('state:ldu_coolant_delete', 'component_state_type', 'LDU coolant delete'),
   'tesla_ldu_coolant_delete', 'modification_unsanctioned', mi_load.sid('var:ldu_gen1'), null, false),
  (mi_load.mk('state:pack_reman85', 'component_state_type', 'Pack replaced with a remanufactured 85'),
   'tesla_pack_replaced_reman85', 'replacement_reman', mi_load.sid('var:pack_85_gen1'),
   mi_load.sid('var:pack_reman_85'), true),
  (mi_load.mk('state:pack_new90', 'component_state_type', 'Pack replaced with a new limited 90'),
   'tesla_pack_replaced_new90', 'replacement_new', mi_load.sid('var:pack_85_gen1'),
   mi_load.sid('var:pack_new_90_limited'), true),
  (mi_load.mk('state:emmc_recall_fix', 'component_state_type', 'MCU1 flash memory replaced under recall'),
   'tesla_emmc_recall_fix', 'repair', mi_load.sid('var:mcu1'), null, true);
