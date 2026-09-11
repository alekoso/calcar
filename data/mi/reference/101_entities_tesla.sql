-- Phase 3 back-loading: граф сутностей Tesla Model S P85D MY2015.
--
-- Джерело: docs/model-intelligence/reference/tesla-model-s-p85d-my2015.md (FROZEN).
-- Ролей engine і transmission у BEV немає: вони не створюються.

insert into mi.brand (subject_id, name, country)
values (pg_temp.mk('brand:tesla', 'brand', 'Tesla'), 'Tesla', 'US');

insert into mi.model_line (subject_id, brand_id, name)
values (pg_temp.mk('line:model_s', 'model_line', 'Tesla Model S'), pg_temp.sid('brand:tesla'), 'Model S');

insert into mi.generation (subject_id, model_line_id, platform_code, phase,
    powertrain_types, default_system_profile, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('gen:ms_pre_facelift', 'generation', 'Tesla Model S pre-facelift'),
   pg_temp.sid('line:model_s'), 'MS_PRE_FACELIFT', 'base', array['bev']::mi.powertrain[], 'bev_default',
   date '2012-06-01', 'known', date '2016-04-01', 'known'),
  (pg_temp.mk('gen:ms_facelift', 'generation', 'Tesla Model S facelift'),
   pg_temp.sid('line:model_s'), 'MS_FACELIFT', 'base', array['bev']::mi.powertrain[], 'bev_default',
   date '2016-04-01', 'known', date '9999-12-31', 'unknown');

insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain) values
  (pg_temp.mk('ver:p85d', 'vehicle_version', 'Tesla Model S P85D'),
   pg_temp.sid('gen:ms_pre_facelift'), 'P85D', 'Model S P85D', 'bev'),
  (pg_temp.mk('ver:85d', 'vehicle_version', 'Tesla Model S 85D'),
   pg_temp.sid('gen:ms_pre_facelift'), '85D', 'Model S 85D', 'bev'),
  (pg_temp.mk('ver:90d', 'vehicle_version', 'Tesla Model S 90D'),
   pg_temp.sid('gen:ms_pre_facelift'), '90D', 'Model S 90D', 'bev');

insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('vmy:p85d_us_2015', 'version_market_year', 'Tesla Model S P85D US MY2015'),
   pg_temp.sid('ver:p85d'), 'US', 2015,
   date '2014-11-01', 'known', date '2016-02-29', 'known');

-- ---------- Компонентні родини і варіанти ----------

insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en) values
  (pg_temp.mk('fam:tesla_ldu', 'component_family', 'Tesla large drive unit'), pg_temp.sid('brand:tesla'),
   'TESLA_LDU', 'drive_unit', 'Rear induction motor with integrated single speed reduction gear, liquid cooled rotor'),
  (pg_temp.mk('fam:tesla_sdu', 'component_family', 'Tesla small drive unit'), pg_temp.sid('brand:tesla'),
   'TESLA_SDU', 'drive_unit', 'Front induction motor with integrated single speed reduction gear'),
  (pg_temp.mk('fam:tesla_s_pack', 'component_family', 'Tesla Model S high voltage pack'), pg_temp.sid('brand:tesla'),
   'TESLA_S_PACK', 'battery_pack', 'Sixteen module pack of cylindrical 18650 cells, liquid cooled, vented through breathers'),
  (pg_temp.mk('fam:tesla_mcu', 'component_family', 'Tesla media control unit'), pg_temp.sid('brand:tesla'),
   'TESLA_MCU', 'infotainment', 'Central touchscreen computer with on board flash storage'),
  (pg_temp.mk('fam:tesla_ap', 'component_family', 'Tesla Autopilot hardware'), pg_temp.sid('brand:tesla'),
   'TESLA_AP_HW', 'adas_hw', 'Forward camera, radar and ultrasonic sensors with a vision processing unit'),
  (pg_temp.mk('fam:tesla_modem', 'component_family', 'Tesla telematics modem'), pg_temp.sid('brand:tesla'),
   'TESLA_MODEM', 'modem', 'Cellular modem for connectivity and remote access'),
  (pg_temp.mk('fam:tesla_charger', 'component_family', 'Tesla on-board charger'), pg_temp.sid('brand:tesla'),
   'TESLA_CHARGER', 'charger', 'On-board alternating current charger, single phase on North American cars'),
  (pg_temp.mk('fam:tesla_air_susp', 'component_family', 'Tesla Model S air suspension'), pg_temp.sid('brand:tesla'),
   'TESLA_S_AIR_SUSP', 'suspension_system', 'Air struts with a single compressor'),
  (pg_temp.mk('fam:tesla_handle', 'component_family', 'Tesla Model S door handle'), pg_temp.sid('brand:tesla'),
   'TESLA_S_DOOR_HANDLE', 'body_module', 'Retracting door handle with microswitches and a geared actuator'),
  (pg_temp.mk('fam:tesla_ptc', 'component_family', 'Tesla Model S cabin heater'), pg_temp.sid('brand:tesla'),
   'TESLA_S_CABIN_HEATER', 'hvac', 'Resistive positive temperature coefficient cabin heater');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:ldu_gen1', 'component_variant', 'Tesla LDU pre-revision U'), pg_temp.sid('fam:tesla_ldu'),
   'LDU_PRE_REV_U', 'Large drive unit before the revision U repair design',
   date '2012-06-01', 'known', date '2023-09-01', 'known');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:ldu_rev_u', 'component_variant', 'Tesla LDU revision U'), pg_temp.sid('fam:tesla_ldu'),
   'LDU_REV_U', 'Large drive unit revision U with the coolant manifold deleted', pg_temp.sid('var:ldu_gen1'),
   date '2023-09-01', 'known', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:sdu_gen1', 'component_variant', 'Tesla SDU induction front unit'), pg_temp.sid('fam:tesla_sdu'),
   'SDU_INDUCTION', 'Front small drive unit, induction motor',
   date '2014-10-01', 'known', date '2019-04-01', 'known'),
  (pg_temp.mk('var:pack_85_gen1', 'component_variant', 'Tesla 85 kWh pack, first generation'), pg_temp.sid('fam:tesla_s_pack'),
   'PACK_85_GEN1', '85 kWh pack, sixteen modules of 444 cells',
   date '2012-06-01', 'known', date '2016-04-01', 'known'),
  (pg_temp.mk('var:pack_90_gen1', 'component_variant', 'Tesla 90 kWh pack'), pg_temp.sid('fam:tesla_s_pack'),
   'PACK_90_GEN1', '90 kWh pack with silicon added to the anode',
   date '2015-07-01', 'known', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:pack_reman_85', 'component_variant', 'Tesla remanufactured 85 pack'), pg_temp.sid('fam:tesla_s_pack'),
   'PACK_85_REMAN', 'Remanufactured 85 pack, part number 1088815-01-B',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:pack_new_90_limited', 'component_variant', 'Tesla new 90 pack limited to 85'), pg_temp.sid('fam:tesla_s_pack'),
   'PACK_90_LIMITED', 'New 90 pack of fourteen 350 V modules, software limited to 85, part numbers 1014116-00-C and 1918190-85-A',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:mcu1', 'component_variant', 'Tesla MCU1'), pg_temp.sid('fam:tesla_mcu'),
   'MCU1', 'Media control unit 1 with 8 GB embedded flash',
   date '2012-06-01', 'known', date '2018-03-01', 'known');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    supersedes_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:mcu2', 'component_variant', 'Tesla MCU2'), pg_temp.sid('fam:tesla_mcu'),
   'MCU2', 'Media control unit 2', pg_temp.sid('var:mcu1'),
   date '2018-03-01', 'known', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:ap1', 'component_variant', 'Tesla Autopilot hardware 1'), pg_temp.sid('fam:tesla_ap'),
   'AP1', 'Autopilot hardware 1 built around the Mobileye EyeQ3 vision processor',
   date '2014-09-01', 'known', date '2016-10-01', 'known'),
  (pg_temp.mk('var:ap2', 'component_variant', 'Tesla Autopilot hardware 2'), pg_temp.sid('fam:tesla_ap'),
   'AP2', 'Autopilot hardware 2',
   date '2016-10-01', 'known', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:modem_3g', 'component_variant', 'Tesla 3G modem'), pg_temp.sid('fam:tesla_modem'),
   'MODEM_3G', 'Third generation cellular modem',
   date '2012-06-01', 'known', date '2015-06-01', 'known'),
  (pg_temp.mk('var:modem_lte', 'component_variant', 'Tesla LTE modem'), pg_temp.sid('fam:tesla_modem'),
   'MODEM_LTE', 'Long term evolution cellular modem',
   date '2015-06-01', 'known', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:charger_10kw', 'component_variant', 'Tesla 10 kW single charger'), pg_temp.sid('fam:tesla_charger'),
   'CHARGER_10KW', 'Single on-board charger rated 40 A on a single phase',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:charger_20kw', 'component_variant', 'Tesla 20 kW dual charger'), pg_temp.sid('fam:tesla_charger'),
   'CHARGER_20KW', 'Dual on-board charger rated 80 A on a single phase',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:smart_air_gen1', 'component_variant', 'Tesla Smart Air Suspension, first generation'), pg_temp.sid('fam:tesla_air_susp'),
   'SMART_AIR_GEN1', 'Smart Air Suspension as fitted before the Raven revision',
   date '2012-06-01', 'known', date '2019-04-01', 'known'),
  (pg_temp.mk('var:handle_gen2', 'component_variant', 'Tesla door handle, second generation'), pg_temp.sid('fam:tesla_handle'),
   'HANDLE_GEN2', 'Second generation door handle',
   date '2014-01-01', 'known', date '2016-01-01', 'known'),
  (pg_temp.mk('var:ptc_gen1', 'component_variant', 'Tesla cabin PTC heater, first generation'), pg_temp.sid('fam:tesla_ptc'),
   'PTC_GEN1', 'First generation cabin heater',
   date '2012-06-01', 'known', date '2015-12-31', 'known');

insert into mi.variant_attribute (variant_id, attr_key, attr_value) values
  (pg_temp.sid('var:ldu_gen1'),     'has_rotor_coolant_seal', 'true'),
  (pg_temp.sid('var:ldu_rev_u'),    'has_rotor_coolant_seal', 'false'),
  (pg_temp.sid('var:ldu_gen1'),     'cooling_layout', 'liquid_rotor'),
  (pg_temp.sid('var:sdu_gen1'),     'has_rotor_coolant_seal', 'false'),
  (pg_temp.sid('var:pack_85_gen1'), 'cell_chemistry', 'nca'),
  (pg_temp.sid('var:pack_90_gen1'), 'cell_chemistry', 'nca');

insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values
  (pg_temp.sid('vmy:p85d_us_2015'), 'drive_unit_rear',  pg_temp.sid('var:ldu_gen1'),     'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'drive_unit_front', pg_temp.sid('var:sdu_gen1'),     'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'battery_pack',     pg_temp.sid('var:pack_85_gen1'), 'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'mcu',              pg_temp.sid('var:mcu1'),         'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'adas_hw',          pg_temp.sid('var:ap1'),          'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'charger',          pg_temp.sid('var:charger_10kw'), 'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'charger',          pg_temp.sid('var:charger_20kw'), 'optional'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'door_handle',      pg_temp.sid('var:handle_gen2'),  'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'cabin_heater',     pg_temp.sid('var:ptc_gen1'),     'standard'),
  (pg_temp.sid('vmy:p85d_us_2015'), 'suspension_system',pg_temp.sid('var:smart_air_gen1'),'standard');

insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id) values
  (pg_temp.sid('var:ldu_gen1'), 'LDU',  'ldu',  'en', 'community', 'brand', pg_temp.sid('brand:tesla')),
  (pg_temp.sid('var:sdu_gen1'), 'SDU',  'sdu',  'en', 'community', 'brand', pg_temp.sid('brand:tesla')),
  (pg_temp.sid('var:mcu1'),     'MCU1', 'mcu1', 'en', 'community', 'brand', pg_temp.sid('brand:tesla')),
  (pg_temp.sid('var:mcu2'),     'MCU2', 'mcu2', 'en', 'community', 'brand', pg_temp.sid('brand:tesla')),
  (pg_temp.sid('var:ap1'),      'AP1',  'ap1',  'en', 'community', 'brand', pg_temp.sid('brand:tesla')),
  (pg_temp.sid('ver:p85d'),     'P85D', 'p85d', 'en', 'official',  'model_line', pg_temp.sid('line:model_s'));

-- ---------- Права ----------

insert into mi.entitlement (subject_id, brand_id, entitlement_key, name_en, binding,
    transferable_private, transferable_dealer, revocable, revoke_reasons,
    network_dependency, requires_variant_id) values
  (pg_temp.mk('ent:sc01', 'entitlement', 'Free unlimited Supercharging'),
   pg_temp.sid('brand:tesla'), 'free_unlimited_supercharging', 'Free unlimited Supercharging', 'vin',
   true, true, true, array['salvage title', 'resold by Tesla through auction'], true, null),
  (pg_temp.mk('ent:ap1_option', 'entitlement', 'Autopilot software option'),
   pg_temp.sid('brand:tesla'), 'autopilot_software_option', 'Autopilot software option', 'vin',
   true, false, true, array['configuration audit after a dealer sale'], false, pg_temp.sid('var:ap1')),
  (pg_temp.mk('ent:ludicrous', 'entitlement', 'Ludicrous mode'),
   pg_temp.sid('brand:tesla'), 'ludicrous_mode', 'Ludicrous mode', 'vin',
   true, true, false, null, false, null),
  (pg_temp.mk('ent:premium_conn', 'entitlement', 'Lifetime Premium Connectivity'),
   pg_temp.sid('brand:tesla'), 'premium_connectivity_lifetime', 'Lifetime Premium Connectivity', 'vin',
   true, true, false, null, true, pg_temp.sid('var:modem_3g'));

-- ---------- Проблеми ----------

insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity) values
  (pg_temp.mk('issue:ldu_coolant_leak', 'issue', 'Tesla LDU rotor coolant leak'),
   'tesla_ldu_rotor_coolant_leak', pg_temp.sid('var:ldu_gen1'),
   'Coolant leaks past the rotor seal into the stator',
   'Coolant passes the rotor shaft seal and reaches the stator and the speed sensor; the repair revision deletes the coolant manifold entirely.',
   'catastrophic', 'mixed'),
  (pg_temp.mk('issue:ldu_milling', 'issue', 'Tesla LDU bearing milling noise'),
   'tesla_ldu_milling', pg_temp.sid('var:ldu_gen1'),
   'Bearing milling noise from the large drive unit', null, 'major', 'mileage'),
  (pg_temp.mk('issue:sdu_gear_whine', 'issue', 'Tesla SDU gear whine'),
   'tesla_sdu_gear_whine', pg_temp.sid('var:sdu_gen1'),
   'Reduction gear whine from the front drive unit', null, 'minor', 'mileage'),
  (pg_temp.mk('issue:half_shaft', 'issue', 'Tesla half shaft vibration and seal leak'),
   'tesla_s_half_shaft', pg_temp.sid('gen:ms_pre_facelift'),
   'Half shaft vibration on hard launches and drive shaft seal leaks with age', null, 'moderate', 'mixed'),
  (pg_temp.mk('issue:batterygate', 'issue', 'Tesla charge voltage limit after a software update'),
   'tesla_batterygate_voltage_limit', pg_temp.sid('var:pack_85_gen1'),
   'Maximum cell voltage reduced by a software update',
   'Software release 2019.16 lowered the maximum cell voltage from about 4.20 V to about 4.07 V on pre-facelift packs, removing capacity and part of the direct current power.',
   'major', 'calendar'),
  (pg_temp.mk('issue:chargegate', 'issue', 'Tesla reduced Supercharging peak'),
   'tesla_chargegate_dc_taper', pg_temp.sid('var:pack_85_gen1'),
   'Permanently reduced direct current charging peak',
   'Packs with a high count of direct current sessions receive a lowered charging peak that is not reversed.',
   'moderate', 'cycles'),
  (pg_temp.mk('issue:bms_u029', 'issue', 'Tesla BMS_u029 maximum charge level reduced'),
   'tesla_bms_u029', pg_temp.sid('var:pack_85_gen1'),
   'BMS_u029, maximum charge level reduced',
   'End of life of an early pack; specialists attribute it to the pack electronics and wiring rather than the cells, and it is triggered by calendar age rather than mileage.',
   'catastrophic', 'calendar'),
  (pg_temp.mk('issue:pack_condensation', 'issue', 'Tesla pack condensation and module board corrosion'),
   'tesla_pack_condensation', pg_temp.sid('var:pack_85_gen1'),
   'Moisture and condensation inside the pack corrode the module boards',
   'The pack breathes through its breathers; air conditioning condensate and humid air reach the module boards and corrode them.',
   'catastrophic', 'calendar'),
  (pg_temp.mk('issue:isolation_fault', 'issue', 'Tesla high voltage isolation fault'),
   'tesla_isolation_fault', pg_temp.sid('gen:ms_pre_facelift'),
   'High voltage isolation fault',
   'Sources include the battery heater, coolant, high voltage cabling and moisture in a drive unit; diagnosis proceeds by elimination.',
   'major', 'mixed'),
  (pg_temp.mk('issue:contactor_weld', 'issue', 'Tesla pack contactor welding'),
   'tesla_contactor_weld', pg_temp.sid('var:pack_85_gen1'),
   'Pack contactors weld shut', null, 'major', 'cycles'),
  (pg_temp.mk('issue:mcu1_emmc', 'issue', 'Tesla MCU1 flash memory wear'),
   'tesla_mcu1_emmc_wear', pg_temp.sid('var:mcu1'),
   'Embedded flash memory wears out',
   'The 8 GB embedded flash chip is written to continuously and reaches its write endurance limit.',
   'major', 'calendar'),
  (pg_temp.mk('issue:cluster_flicker', 'issue', 'Tesla instrument cluster flicker'),
   'tesla_cluster_memory_flicker', pg_temp.sid('var:mcu1'),
   'Instrument cluster flicker or black screen from the same memory wear',
   'The instrument cluster uses the same kind of flash memory as the media control unit but is not covered by the recall.',
   'moderate', 'calendar'),
  (pg_temp.mk('issue:yellow_border', 'issue', 'Tesla touchscreen yellow border and delamination'),
   'tesla_screen_yellow_border', pg_temp.sid('var:mcu1'),
   'Yellow border and delamination of the central touchscreen',
   'The adhesive under the glass discolours under ultraviolet light and heat; bubbling and delamination need a new digitizer.',
   'minor', 'calendar'),
  (pg_temp.mk('issue:air_strut_leak', 'issue', 'Tesla air strut leak and compressor overload'),
   'tesla_air_strut_leak', pg_temp.sid('var:smart_air_gen1'),
   'Front air struts leak and overload the compressor',
   'A leaking strut makes the compressor run continuously until it fails.',
   'major', 'calendar'),
  (pg_temp.mk('issue:fore_aft_link', 'issue', 'Tesla front fore and aft link cracking'),
   'tesla_s_fore_aft_link', pg_temp.sid('gen:ms_pre_facelift'),
   'Front fore and aft links and ball joints crack or tear', null, 'major', 'mixed'),
  (pg_temp.mk('issue:parking_brake_seize', 'issue', 'Tesla rear and parking brake caliper seizing'),
   'tesla_parking_brake_seize', pg_temp.sid('gen:ms_pre_facelift'),
   'Rear and parking brake calipers seize in a salt climate',
   'Road salt corrodes the caliper slides; a seized parking brake caliper is replaced as a whole unit.',
   'moderate', 'usage'),
  (pg_temp.mk('issue:camber_wear_21', 'issue', 'Tesla 21 inch rear inner edge wear'),
   'tesla_s_21_camber_wear', pg_temp.sid('gen:ms_pre_facelift'),
   'Inner edge wear on the rear tyres of the staggered 21 inch setup',
   'Rear camber wears the inner shoulder; adjustable arms are the usual fix.',
   'minor', 'mileage'),
  (pg_temp.mk('issue:door_handle_gen2', 'issue', 'Tesla second generation door handle failure'),
   'tesla_door_handle_gen2', pg_temp.sid('var:handle_gen2'),
   'Second generation door handle failure',
   'The microswitches sit on brittle wiring and the drive gear is a cast part.',
   'moderate', 'calendar'),
  (pg_temp.mk('issue:ptc_heater_gen1', 'issue', 'Tesla first generation cabin heater failure'),
   'tesla_ptc_heater_gen1', pg_temp.sid('var:ptc_gen1'),
   'First generation cabin heater failure',
   'Condensate collects on the control board, the heating elements short and the direct current converter fuse blows; access is expensive.',
   'major', 'calendar'),
  (pg_temp.mk('issue:dcdc_12v', 'issue', 'Tesla 12 V supply and direct current converter'),
   'tesla_dcdc_12v', pg_temp.sid('gen:ms_pre_facelift'),
   'Repeated 12 V low warnings point at the direct current converter',
   'A lead acid 12 V battery lasts two to four years; a repeat warning right after replacement indicates the converter, whose failure immobilises the car.',
   'major', 'calendar'),
  (pg_temp.mk('issue:pano_roof_leak', 'issue', 'Tesla panoramic roof leaks and noise'),
   'tesla_pano_roof_gen1', pg_temp.sid('gen:ms_pre_facelift'),
   'Panoramic roof leaks and wind noise',
   'First generation roof parts, used until early 2015, are no longer supplied.',
   'moderate', 'calendar'),
  (pg_temp.mk('issue:entitlement_removal', 'issue', 'Tesla software feature removal after resale'),
   'tesla_entitlement_removal', pg_temp.sid('ent:ap1_option'),
   'Tesla removed a paid software feature after a change of owner',
   'A configuration audit after a car was sold through a dealer removed features the car had shipped with.',
   'major', 'mixed');

-- ---------- Обслуговування ----------

insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code, fluid_spec_code, capacity_note_en) values
  (pg_temp.mk('maint:pack_coolant', 'maintenance_item', 'Model S battery coolant'),
   pg_temp.sid('var:pack_85_gen1'), 'battery_coolant', 'TESLA_G48_COOLANT', null),
  (pg_temp.mk('maint:ms_brake_fluid', 'maintenance_item', 'Model S brake fluid'),
   pg_temp.sid('gen:ms_pre_facelift'), 'brake_fluid', 'DOT4_BRAKE_FLUID', null),
  (pg_temp.mk('maint:ms_desiccant', 'maintenance_item', 'Model S air conditioning desiccant'),
   pg_temp.sid('gen:ms_pre_facelift'), 'ac_desiccant', null, null),
  (pg_temp.mk('maint:pack_charging_habit', 'maintenance_item', 'Model S charging habit'),
   pg_temp.sid('var:pack_85_gen1'), 'charging_habit', null, null),
  (pg_temp.mk('maint:ms_brake_cleaning', 'maintenance_item', 'Model S brake caliper cleaning'),
   pg_temp.sid('gen:ms_pre_facelift'), 'other', null,
   'Annual cleaning and lubrication of the caliper pad slides and the parking brake calipers');

-- ---------- Перевірки ----------

insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
    cannot_prove_en, conditions, default_priority, materially_resolves, resolves_dimension) values
  (pg_temp.mk('chk:ldu_speed_sensor', 'check_item', 'Inspect the LDU speed sensor for coolant'),
   'visual', pg_temp.sid('var:ldu_gen1'),
   'The rotor coolant leak is the main rear drivetrain risk on this car and shows itself at the speed sensor first.',
   'Whether coolant has already reached the speed sensor area today.',
   'A dry sensor today does not guarantee the seal tomorrow, because the seal design is unchanged.',
   null, 'must', false, null),
  (pg_temp.mk('chk:pack_can_health', 'check_item', 'Read pack health over the vehicle bus'),
   'battery_diagnostics', pg_temp.sid('var:pack_85_gen1'),
   'Rated range on the screen hides both the true nominal capacity and any imposed limit.',
   'Nominal full pack capacity, minimum and maximum group voltages, imbalance and cycle counts.',
   'Shows the pack today; it does not predict an electronic failure such as the maximum charge level fault.',
   null, 'must', true, 'component_variant'),
  (pg_temp.mk('chk:pack_group_voltage', 'check_item', 'Check group voltage at full charge'),
   'battery_diagnostics', pg_temp.sid('var:pack_85_gen1'),
   'Two otherwise identical cars can differ by an imposed voltage limit.',
   'Whether the pack still charges to about 4.19 to 4.20 V per group or is capped at or below 4.18 V.',
   'Does not say when or why the limit was applied.',
   array['charge to one hundred percent first'], 'must', true, 'component_variant'),
  (pg_temp.mk('chk:dc_session', 'check_item', 'Run a direct current charging session'),
   'dc_charge_session', pg_temp.sid('var:pack_85_gen1'),
   'A reduced charging peak is only visible while charging.',
   'The real peak power the pack accepts.',
   'Ambient temperature and state of charge also shape the curve, so one session is a lower bound rather than a verdict.',
   array['from roughly ten to sixty percent state of charge'], 'good', false, null),
  (pg_temp.mk('chk:entitlement_check', 'check_item', 'Verify software entitlements after transfer'),
   'entitlement_verification', pg_temp.sid('ver:p85d'),
   'Hardware presence is not a right: rights are attached to the car in Tesla systems and can be removed.',
   'Which rights the car actually carries in the account after the transfer of ownership.',
   'Does not prevent a later configuration audit from removing a right.',
   null, 'must', true, 'entitlement_state'),
  (pg_temp.mk('chk:air_overnight', 'check_item', 'Overnight settling test of the air suspension'),
   'overnight_test', pg_temp.sid('var:smart_air_gen1'),
   'A slow strut leak is invisible during a short test drive.',
   'Whether a corner settles overnight.',
   'Does not identify which strut or the compressor condition on its own.',
   null, 'good', false, null),
  (pg_temp.mk('chk:cabin_heat_test', 'check_item', 'Cabin heat test'),
   'road_test', pg_temp.sid('var:ptc_gen1'),
   'A failed cabin heater makes the car unusable in winter and is expensive to reach.',
   'Whether the cabin heater actually produces heat.',
   'Does not show how close the control board is to failing.',
   null, 'must', false, null);

insert into mi.check_covers (check_id, target_subject_id, role) values
  (pg_temp.sid('chk:ldu_speed_sensor'),  pg_temp.sid('issue:ldu_coolant_leak'),  'detects'),
  (pg_temp.sid('chk:pack_can_health'),   pg_temp.sid('var:pack_85_gen1'),        'resolves_identity'),
  (pg_temp.sid('chk:pack_group_voltage'),pg_temp.sid('issue:batterygate'),       'detects'),
  (pg_temp.sid('chk:dc_session'),        pg_temp.sid('issue:chargegate'),        'detects'),
  (pg_temp.sid('chk:entitlement_check'), pg_temp.sid('ent:sc01'),                'verifies_state'),
  (pg_temp.sid('chk:air_overnight'),     pg_temp.sid('issue:air_strut_leak'),    'detects'),
  (pg_temp.sid('chk:cabin_heat_test'),   pg_temp.sid('issue:ptc_heater_gen1'),   'detects');

-- ---------- Стани компонента ----------

insert into mi.component_state_type (subject_id, state_key, state_kind, applies_to_subject_id,
    resulting_variant_id, sanctioned_by_oem) values
  (pg_temp.mk('state:ludicrous_retrofit', 'component_state_type', 'Ludicrous upgrade fitted'),
   'tesla_ludicrous_upgrade', 'retrofit', pg_temp.sid('var:pack_85_gen1'), null, true),
  (pg_temp.mk('state:mcu2_retrofit', 'component_state_type', 'MCU2 retrofit'),
   'tesla_mcu2_retrofit', 'retrofit', pg_temp.sid('var:mcu1'), pg_temp.sid('var:mcu2'), true),
  (pg_temp.mk('state:lte_upgrade', 'component_state_type', 'LTE modem upgrade'),
   'tesla_lte_modem_upgrade', 'retrofit', pg_temp.sid('var:modem_3g'), pg_temp.sid('var:modem_lte'), true),
  (pg_temp.mk('state:ccs_retrofit', 'component_state_type', 'CCS charge port retrofit'),
   'tesla_ccs_retrofit', 'retrofit', pg_temp.sid('gen:ms_pre_facelift'), null, true),
  (pg_temp.mk('state:ldu_coolant_delete', 'component_state_type', 'LDU coolant delete'),
   'tesla_ldu_coolant_delete', 'modification_unsanctioned', pg_temp.sid('var:ldu_gen1'), null, false),
  (pg_temp.mk('state:pack_reman85', 'component_state_type', 'Pack replaced with a remanufactured 85'),
   'tesla_pack_replaced_reman85', 'replacement_reman', pg_temp.sid('var:pack_85_gen1'),
   pg_temp.sid('var:pack_reman_85'), true),
  (pg_temp.mk('state:pack_new90', 'component_state_type', 'Pack replaced with a new limited 90'),
   'tesla_pack_replaced_new90', 'replacement_new', pg_temp.sid('var:pack_85_gen1'),
   pg_temp.sid('var:pack_new_90_limited'), true),
  (pg_temp.mk('state:emmc_recall_fix', 'component_state_type', 'MCU1 flash memory replaced under recall'),
   'tesla_emmc_recall_fix', 'repair', pg_temp.sid('var:mcu1'), null, true);
