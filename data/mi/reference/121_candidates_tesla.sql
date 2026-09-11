-- Phase 3 back-loading: кандидати з картки Tesla Model S P85D MY2015.
-- Правила розщеплення ті самі, що у файлі BMW.

\o /dev/null

-- ---------- B1. Ідентичність і виробництво ----------

select pg_temp.stage('T-001', 'tesla', 'ver:p85d', 'official_fact', 'high',
  'This version was presented in October 2014, went into production in November 2014, began deliveries in December 2014 and was built until February 2016; the model year sits in the tenth character of the vehicle identification number, and the earliest cars carry a 2014 model year.',
  jsonb_build_object(
    'value_kind', 'date_window',
    'value', '{"presented":"2014-10","production_from":"2014-11","deliveries_from":"2014-12","production_to":"2016-02"}'::jsonb,
    'note', 'The build date matters more than the model year on this car.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-01'), pg_temp.ev('S-T-SPEC-01'))));

select pg_temp.stage('T-002#a', 'tesla', 'ver:p85d', 'official_fact', 'high',
  'The rear motor is rated at 375 kW and 600 Nm and the front motor at 193 kW and 330 Nm.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"rear_kw":375,"rear_nm":600,"front_kw":193,"front_nm":330,"unit":"kW"}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-01'), pg_temp.ev('S-T-LEG-01'))));

select pg_temp.stage('T-002#b', 'tesla', 'ver:p85d', 'known_issue', 'high',
  'The advertised 691 hp is the sum of the two motor ratings; the real peak is about 463 hp because the battery limits it, and this was litigated in Norway and Australia.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"advertised_hp":691,"real_peak_hp":463,"unit":"hp"}'::jsonb,
    'note', 'The badge is not a measurement. The acceleration figures themselves are confirmed.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-LEG-01'), pg_temp.ev('S-T-SPEC-01'))));

select pg_temp.stage('T-003#a', 'tesla', 'ver:p85d', 'official_fact', 'high',
  'Nought to sixty miles per hour moved from 3.2 to 3.1 seconds through software in the highest drive mode, and the later upgrade, which fits a new fuse and contactors, brings it to 2.8 or 2.9 seconds for five to six and a half thousand dollars while leaving the badge unchanged.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","upgrade_from":5000,"upgrade_to":6600,"zero_to_sixty_after_s":2.8}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OWN-01', 'thread:tmc-50187'))));

select pg_temp.stage('T-003#b', 'tesla', 'ent:ludicrous', 'owner_pattern', 'high',
  'The performance upgrade is invisible from outside the car, so it has to be confirmed in the menu and in the paperwork rather than by looking at the badge.',
  jsonb_build_object(
    'ev', jsonb_build_array(pg_temp.ev('S-T-OWN-01', 'thread:tmc-50187'))));

select pg_temp.stage('T-004', 'tesla', 'ver:p85d', 'official_fact', 'high',
  'Every car of this version built after September 2014 carries the first generation driver assistance hardware; the driver assistance software itself was a separate paid option.',
  jsonb_build_object(
    'value_kind', 'date_window',
    'value', '{"hardware":"AP1","hardware_from":"2014-09"}'::jsonb,
    'note', 'The word Autopilot in an advertisement does not mean the option was bought.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-02'))));

select pg_temp.stage('T-005', 'tesla', 'var:modem_3g', 'official_fact', 'high',
  'Cars built before June 2015 carry a third generation modem; that network was switched off in the United States in 2022, the upgrade to the newer modem costs about two hundred dollars, and cars with the older modem carry lifetime premium connectivity.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","upgrade":200,"network_retired":2022}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', null, date '2015-05-31')),
    'note', 'Without the upgrade the phone application does not reach the car away from a wireless network.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-03'))));

select pg_temp.stage('T-006', 'tesla', 'vmy:p85d_us_2015', 'official_fact', 'high',
  'The standard on-board charger is rated 10 kW at 40 A with a 20 kW 80 A option, and on cars for the United States it is single phase.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"standard_kw":10,"standard_a":40,"optional_kw":20,"optional_a":80,"phases":1,"unit":"kW"}'::jsonb,
    'note', 'European cars of the same era used three phase chargers, so a car built for the United States is limited to about 7 kW from one phase in Europe.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-04'), pg_temp.ev('S-T-OWN-02'))));

select pg_temp.stage('T-007', 'tesla', 'ver:p85d', 'official_fact', 'high',
  'The official rated range is 253 miles, that is 407 kilometres, against 270 miles for the 85D and 288 to 294 miles for the 90D.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"p85d_mi":253,"85d_mi":270,"90d_mi_from":288,"90d_mi_to":294,"unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-05'))));

select pg_temp.stage('T-008', 'tesla', 'ver:p85d', 'official_fact', 'high',
  'The battery and drive unit warranty ran for eight years with no mileage limit and no capacity threshold, and it had expired for every car of this version by 2022 or 2023.',
  jsonb_build_object(
    'value_kind', 'interval',
    'value', '{"years":8,"mileage_limit":null,"capacity_threshold":null}'::jsonb,
    'note', 'Every failure is now at the owner expense.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-06'))));

-- ---------- B2. Приводи ----------

select pg_temp.stage('T-010', 'tesla', 'issue:ldu_coolant_leak', 'known_issue', 'high',
  'Coolant leaks past the rotor seal of the rear drive unit into the stator and the speed sensor; this applies to every rear drive unit built before the repair revision of autumn 2023, which deletes the coolant manifold, and the front unit is not affected. This is the main rear drivetrain risk on the car.',
  jsonb_build_object(
    'applic', jsonb_build_array(
      pg_temp.p_attr('has_rotor_coolant_seal', 'true')),
    'note', 'A dry sensor today does not guarantee the seal tomorrow.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-03', 'thread:tmc-327284', '{"mileage_km":120000}'::jsonb),
      pg_temp.ev('S-T-OWN-04', 'thread:tmc-316883', '{"mileage_km":135000}'::jsonb),
      pg_temp.ev('S-T-SPEC-02'), pg_temp.ev('S-T-SPEC-03'))));

select pg_temp.stage('T-011#a', 'tesla', 'issue:ldu_coolant_leak', 'specialist_practice', 'medium',
  'Outside warranty a factory remanufactured rear drive unit costs about 5,200 dollars and a new one about 6,000 dollars with no core exchange, while an independent coolant delete costs about 600 dollars in parts without removing the unit.',
  jsonb_build_object(
    'causal', 'observed_association',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","reman":5200,"new":6000,"coolant_delete_parts":600}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-SPEC-03'),
      pg_temp.ev('S-T-OWN-04', 'thread:tmc-316883', '{"mileage_km":135000}'::jsonb))));

select pg_temp.stage('T-011#b', 'tesla', 'issue:ldu_coolant_leak', 'owner_pattern', 'medium',
  'Owners treat the cost of a rear drive unit replacement as a known and budgeted figure rather than as an unexpected event.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-04', 'thread:tmc-316883', '{"mileage_km":135000}'::jsonb))));

select pg_temp.stage('T-012', 'tesla', 'issue:ldu_coolant_leak', 'owner_pattern', 'medium',
  'There are documented cases of three to five warranty replacements of the rear drive unit on one car, and some owners describe the repaired units as down on power.',
  jsonb_build_object(
    'note', 'Repeated replacements are a bad sign only together with current symptoms.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-04', 'thread:tmc-316883', '{"mileage_km":135000}'::jsonb))));

select pg_temp.stage('T-013', 'tesla', 'issue:ldu_milling', 'owner_pattern', 'medium',
  'A bearing milling noise from the rear drive unit led to warranty replacements between 55,000 and 90,000 miles.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-05', 'thread:tmc-158252', '{"mileage_km":88000}'::jsonb),
      pg_temp.ev('S-T-OWN-06', 'thread:tmc-322489', '{"mileage_km":145000}'::jsonb))));

select pg_temp.stage('T-014', 'tesla', 'issue:sdu_gear_whine', 'owner_pattern', 'medium',
  'The front drive unit whines at the reduction gear with isolated replacements, and there is no pattern of leaks from it.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-07', 'thread:tmc-sdu-whine', '{"mileage_km":100000}'::jsonb))));

select pg_temp.stage('T-015', 'tesla', 'issue:half_shaft', 'owner_pattern', 'medium',
  'The front half shafts vibrate on hard launches and the drive shaft seals leak with age.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-05', 'thread:tmc-158252', '{"mileage_km":88000}'::jsonb),
      pg_temp.ev('S-T-OWN-06', 'thread:tmc-322489', '{"mileage_km":145000}'::jsonb))));

-- ---------- B3. Батарея ----------

select pg_temp.stage('T-020#a', 'tesla', 'var:pack_85_gen1', 'official_fact', 'high',
  'The pack is built from sixteen modules of 444 cylindrical cells, 7,104 cells in total.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"modules":16,"cells_per_module":444,"cells_total":7104,"unit":"cells"}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-04'))));

select pg_temp.stage('T-020#b', 'tesla', 'var:pack_85_gen1', 'specialist_practice', 'high',
  'An independent teardown measured about 81 kWh of real capacity with about 77 kWh usable and a buffer of about 4 kWh, so the number in the name is marketing rather than capacity.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'value_kind', 'quantity',
    'value', '{"actual_kwh":81,"usable_kwh":77,"buffer_kwh":4,"unit":"kWh"}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-04'))));

select pg_temp.stage('T-021#a', 'tesla', 'var:pack_85_gen1', 'owner_pattern', 'medium',
  'Typical degradation of this pack is six to eight percent over eight to nine years with careful charging and about thirteen percent with intensive use; for a 2015 car the normal nominal full pack reading is 65 to 72 kWh. Capacity does not predict an electronic failure.',
  jsonb_build_object(
    'value_kind', 'range',
    'value', '{"from":65,"to":72,"unit":"kWh"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-08', 'thread:tmc-285721', '{"age_years":9,"mileage_km":164000}'::jsonb))));

select pg_temp.stage('T-021#b', 'tesla', 'var:pack_85_gen1', 'specialist_practice', 'medium',
  'Aggregated fleet data shows the 85 kWh pack ageing better than the 90 kWh pack, with isolated packs showing heavy degradation or outright failure.',
  jsonb_build_object(
    'causal', 'observed_association',
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-05'))));

select pg_temp.stage('T-022#a', 'tesla', 'issue:batterygate', 'known_issue', 'high',
  'Software release 2019.16 lowered the maximum cell voltage from about 4.20 V to about 4.07 V on the 60, 70, 75 and 85 packs of pre-facelift cars, costing ten to sixteen percent of capacity and part of the direct current power, with partial restoration through 2019 and 2020. Two otherwise identical cars can differ by this limit.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"vmax_before":4.20,"vmax_after":4.07,"capacity_loss_pct_from":10,"capacity_loss_pct_to":16,"unit":"V"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_ref('generation', 'gen:ms_pre_facelift')),
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-09', 'thread:tmc-154976', '{"age_years":7}'::jsonb),
      pg_temp.ev('S-T-LEG-02'))));

select pg_temp.stage('T-022#b', 'tesla', 'issue:batterygate', 'official_fact', 'high',
  'The manufacturer put the number of affected cars in the United States at 1,743, the settlement at 1.5 million dollars with 625 dollars per owner, and a Norwegian court ordered a larger payment.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2021","affected_cars":1743,"settlement_total":1500000,"per_owner":625}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-LEG-02'), pg_temp.ev('S-T-OWN-09'))));

select pg_temp.stage('T-023', 'tesla', 'issue:chargegate', 'known_issue', 'medium',
  'Older 85 kWh packs with a high count of direct current sessions receive a reduced charging peak, often ninety to a hundred kilowatts or less, and it is not lifted; owners in Norway won a case over throttled charging.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"reduced_peak_kw_from":90,"reduced_peak_kw_to":100,"unit":"kW"}'::jsonb,
    'note', 'The only way to check is a real charging session.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-10', 'thread:tmc-286839', '{"age_years":8}'::jsonb),
      pg_temp.ev('S-T-LEG-02'))));

select pg_temp.stage('T-024', 'tesla', 'issue:bms_u029', 'known_issue', 'medium',
  'The maximum charge level reduced fault marks the end of life of an early pack; the manufacturer does not repair it and replaces the pack, specialists attribute it to the electronics and wiring rather than the cells, and it is triggered by calendar age, with one documented case at 39,000 miles.',
  jsonb_build_object(
    'note', 'A clean fault memory today does not rule this out.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-11', 'thread:tmc-300568', '{"mileage_km":63000,"age_years":8}'::jsonb),
      pg_temp.ev('S-T-SPEC-06'))));

select pg_temp.stage('T-025', 'tesla', 'issue:pack_condensation', 'known_issue', 'medium',
  'Moisture and condensation get inside the pack through the breathers as the pack breathes and from air conditioning condensate, and corrode the module boards; a documented 2014 car at 67,000 miles lost five of its eight affected modules, and opening the pack takes ten to twenty hours of labour.',
  jsonb_build_object(
    'applic', jsonb_build_array(
      pg_temp.p_tag('condition_tag', 'humid_climate')),
    'note', 'The frozen architecture keeps this claim on the pack variant with exact propagation, because the source is about that pack.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-12', 'thread:tmc-313395', '{"mileage_km":108000}'::jsonb))));

select pg_temp.stage('T-026#a', 'tesla', 'issue:isolation_fault', 'owner_pattern', 'medium',
  'Isolation faults come from the battery heater, from coolant, from the high voltage cabling and from moisture in a drive unit, and in one documented case the service centre reached the wrong conclusion first.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-13', 'thread:tmc-292083', '{"age_years":8}'::jsonb))));

select pg_temp.stage('T-026#b', 'tesla', 'issue:isolation_fault', 'specialist_practice', 'medium',
  'An isolation fault is diagnosed by elimination and is not always about the pack.',
  jsonb_build_object(
    'causal', 'plausible_mechanism',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-13', 'thread:tmc-292083', '{"age_years":8}'::jsonb))));

select pg_temp.stage('T-027', 'tesla', 'issue:contactor_weld', 'specialist_practice', 'medium',
  'Pack contactors weld shut and cost 800 to 1,500 euro plus labour to replace; packs built for the highest drive mode carry reinforced contactors and a reinforced fuse.',
  jsonb_build_object(
    'causal', 'observed_association',
    'value_kind', 'cost',
    'value', '{"currency":"EUR","market":"EU","as_of":"2026-09","from":800,"to":1500}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-07'))));

select pg_temp.stage('T-028#a', 'tesla', 'var:pack_85_gen1', 'official_fact', 'medium',
  'In 2023 a remanufactured 85 pack, part number 1088815-01-B, cost about 14,000 dollars and came with existing degradation and the charging limit, while a new 90 pack limited to 85, part numbers 1014116-00-C and 1918190-85-A, cost 17,742 dollars with fourteen 350 V modules and no charging limit, with unlocking at 700 to 1,000 dollars and a warranty of four years or 50,000 miles. The manufacturer does not say in advance which one will be fitted.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2023","reman_85":14000,"new_90_limited":17742,"unlock_from":700,"unlock_to":1000}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-14', 'thread:tmc-300568'))));

select pg_temp.stage('T-028#b', 'tesla', 'var:pack_85_gen1', 'owner_pattern', 'medium',
  'A new 90 pack fitted as a replacement is a positive finding for a buyer and a remanufactured 85 pack is neutral, so the part number on the pack and the paperwork matter.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-14', 'thread:tmc-300568'))));

select pg_temp.stage('T-029', 'tesla', 'maint:pack_charging_habit', 'owner_practice', 'medium',
  'Careful owners keep the state of charge between fifty and eighty or ninety percent day to day, charge to full only before a trip, avoid leaving the car below ten to twenty percent for long, charge slowly overnight and use rapid charging only when they need it.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'supported_cause',
    'note', 'The causal link at the level of cell chemistry is generally accepted; the charging history itself is visible in the vehicle data.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-10', 'thread:tmc-286839', '{"age_years":8}'::jsonb),
      pg_temp.ev('S-T-OWN-08', 'thread:tmc-285721', '{"age_years":9}'::jsonb))));

select pg_temp.stage('T-030#a', 'tesla', 'chk:pack_can_health', 'specialist_practice', 'high',
  'Pack health is read over the vehicle bus through the diagnostic port, giving nominal full pack capacity, minimum and maximum group voltages, imbalance and cycle counts; the built in service mode health test takes twelve to twenty four hours or more and is not always available on the older media unit.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-08'))));

select pg_temp.stage('T-030#b', 'tesla', 'chk:pack_can_health', 'owner_practice', 'high',
  'Owners read the pack over the vehicle bus themselves before buying rather than relying on the rated range shown on the screen.',
  jsonb_build_object(
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-15', 'thread:tmc-battery-health'))));

select pg_temp.stage('T-031#a', 'tesla', 'maint:pack_coolant', 'official_fact', 'high',
  'The 2015 schedule set the battery coolant at four years or 50,000 miles, and it was later declared a lifetime fill.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"years":4,"distance":50000,"distance_unit":"mi","later":"lifetime"}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-07'))));

select pg_temp.stage('T-031#b', 'tesla', 'maint:ms_brake_fluid', 'official_fact', 'high',
  'Brake fluid is scheduled every two to four years.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"years_from":2,"years_to":4}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-07'))));

select pg_temp.stage('T-031#c', 'tesla', 'maint:ms_desiccant', 'official_fact', 'high',
  'The air conditioning desiccant is scheduled every two years.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"years":2}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-07'))));

-- ---------- B4. Зарядка і права ----------

select pg_temp.stage('T-040#a', 'tesla', 'gen:ms_pre_facelift', 'official_fact', 'high',
  'Cars for North America use the North American charge connector, the manufacturer adapter for the Japanese rapid standard works on cars of this era, and the European rapid standard needs a charge port retrofit, part 1489302-00-B for cars built before June 2016, without which cars built before 2020 do not support it.',
  jsonb_build_object(
    'value_kind', 'part_number',
    'value', '{"retrofit_kit":"1489302-00-B","applies_before":"2016-06"}'::jsonb,
    'applic', jsonb_build_array(pg_temp.p_tag('market_sold', 'US')),
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-08'), pg_temp.ev('S-T-SPEC-09'))));

select pg_temp.stage('T-040#b', 'tesla', 'state:ccs_retrofit', 'specialist_practice', 'high',
  'The rapid charge retrofit is a hardware change to the charge port block and has to be verified on the car rather than assumed from the model year.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-09'))));

select pg_temp.stage('T-041#a', 'tesla', 'gen:ms_pre_facelift', 'specialist_practice', 'medium',
  'A car built for the United States charges in Europe through an adapter on alternating current at about 7 kW from one phase at 32 A, and on direct current only through third party adapters and only if the rapid charge retrofit is present, with the newest chargers not working at all; the manufacturer offers no official solution.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'applic', jsonb_build_array(
      pg_temp.p_tag('market_operated', 'EU', 1),
      pg_temp.p_tag('market_operated', 'UA', 1)),
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-09'))));

select pg_temp.stage('T-041#b', 'tesla', 'gen:ms_pre_facelift', 'owner_pattern', 'medium',
  'Owners who moved a North American car to Europe report that charging becomes a project of its own.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-16', 'thread:tmc-ccs2-europe', '{"age_years":8}'::jsonb))));

select pg_temp.stage('T-042#a', 'tesla', 'ent:sc01', 'official_fact', 'high',
  'Free unlimited rapid charging under code SC01 is attached to the car for orders placed before 15 January 2017 and passes to a private buyer, but it is removed automatically on a salvage title and on cars the manufacturer resold through auction, and for a salvage car the manufacturer may also block third party rapid charging until a paid inspection.',
  jsonb_build_object(
    'value_kind', 'date_window',
    'value', '{"orders_before":"2017-01-15","code":"SC01"}'::jsonb,
    'note', 'For auction cars imported from the United States this is the norm rather than the exception.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-17', 'thread:tmc-sc-transfer'),
      pg_temp.ev('S-T-PRESS-01'))));

select pg_temp.stage('T-042#b', 'tesla', 'ent:sc01', 'owner_pattern', 'high',
  'Owners who imported salvage cars report the rapid charging right gone by the time they take the car over, so it has to be checked in the account after the transfer of ownership.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-17', 'thread:tmc-sc-transfer', '{"age_years":8}'::jsonb))));

select pg_temp.stage('T-043', 'tesla', 'issue:entitlement_removal', 'known_issue', 'high',
  'In a documented case of 2020 the manufacturer removed paid driver assistance software from cars sold through dealers after auditing the configuration, so software rights have to be checked after every change of owner.',
  jsonb_build_object(
    'ev', jsonb_build_array(pg_temp.ev('S-T-PRESS-02'))));

select pg_temp.stage('T-044', 'tesla', 'gen:ms_pre_facelift', 'calcar_synthesis', 'medium',
  'There is effectively no manufacturer rapid charging network in Ukraine, so a car taken there depends on third party rapid chargers of the European and Japanese standards.',
  jsonb_build_object(
    'applic', jsonb_build_array(pg_temp.p_tag('market_operated', 'UA')),
    'ev', jsonb_build_array(pg_temp.ev('S-T-PRESS-03'))));

-- ---------- B5. Медіаблок, екрани, асистенти ----------

select pg_temp.stage('T-050#a', 'tesla', 'issue:mcu1_emmc', 'known_issue', 'high',
  'The 8 GB flash memory of the older media unit wears out; recall 21V-035 covers Model S cars of model years 2012 to 2018 and replaces it with 64 GB free of charge in the United States, while outside the recall the daughter board costs about 500 dollars and a complete media unit about 1,500.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","daughterboard":500,"full_unit":1500,"recall_id":"21V-035"}'::jsonb,
    'note', 'For a car outside the United States this work is paid.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-09'), pg_temp.ev('S-T-SPEC-10'))));

select pg_temp.stage('T-050#b', 'tesla', 'issue:mcu1_emmc', 'official_fact', 'high',
  'Recall 21V-035 covers Model S cars of model years 2012 to 2018 and Model X cars of 2016 to 2018.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"recall_id":"21V-035","model_s_years":[2012,2018],"model_x_years":[2016,2018]}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-09'))));

select pg_temp.stage('T-051', 'tesla', 'issue:cluster_flicker', 'owner_pattern', 'medium',
  'The instrument cluster uses the same kind of memory and flickers or goes black, and it is not covered by the recall.',
  jsonb_build_object(
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-10'))));

select pg_temp.stage('T-052', 'tesla', 'issue:yellow_border', 'known_issue', 'high',
  'The yellow border around the central screen is the adhesive discolouring under ultraviolet light and heat and is cured with an ultraviolet treatment, while bubbling and delamination need a new digitizer.',
  jsonb_build_object(
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', null, date '2017-12-31')),
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-10'))));

select pg_temp.stage('T-053#a', 'tesla', 'state:mcu2_retrofit', 'official_fact', 'high',
  'The retrofit to the newer media unit cost 1,500 dollars for cars with the first generation driver assistance hardware and later 2,000 to 2,500, with a further 500 dollars for radio reception; it brings speed, a browser, streaming and a new instrument cluster, and it does not change the driver assistance hardware.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","from":1500,"to":2500,"radio_option":500}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-11'))));

select pg_temp.stage('T-053#b', 'tesla', 'state:mcu2_retrofit', 'owner_pattern', 'high',
  'Owners who paid for the newer media unit describe the retrofit as worth the money.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-18', 'thread:tmc-mcu2-ap1', '{"age_years":7}'::jsonb))));

select pg_temp.stage('T-054', 'tesla', 'var:ap1', 'official_fact', 'high',
  'The first generation driver assistance hardware is built on the EyeQ3 vision processor with one camera, a radar and twelve ultrasonic sensors, and offers lane keeping, adaptive cruise control, automatic lane change, automatic parking and summon; it has no environment visualisation, no traffic light recognition, no navigation on autopilot and no full self driving, and there is no upgrade path to the later hardware.',
  jsonb_build_object(
    'value_kind', 'enum',
    'value', '{"processor":"EyeQ3","cameras":1,"radar":1,"ultrasonic":12}'::jsonb,
    'note', 'Full self driving must not be attributed to this car.',
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-02'))));

-- ---------- B6. Підвіска, шасі, кузов ----------

select pg_temp.stage('T-060', 'tesla', 'issue:air_strut_leak', 'known_issue', 'medium',
  'The front air struts leak, the compressor is overworked and fails, and the way to see it is an overnight settling test.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-SPEC-12'),
      pg_temp.ev('S-T-OWN-05', 'thread:tmc-158252', '{"mileage_km":88000}'::jsonb))));

select pg_temp.stage('T-061', 'tesla', 'issue:fore_aft_link', 'known_issue', 'high',
  'The front fore and aft links and ball joints crack and tear; a recall covers cars built between September 2013 and August 2017 in China, while in the United States the matter was handled through a bulletin and goodwill and the safety regulator closed it without a recall, alongside a class action. The manufacturer called it misuse.',
  jsonb_build_object(
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', date '2013-09-01', date '2017-08-31')),
    'ev', jsonb_build_array(pg_temp.ev('S-T-PRESS-04'))));

select pg_temp.stage('T-062#a', 'tesla', 'maint:ms_brake_cleaning', 'official_fact', 'high',
  'The manufacturer prescribes annual cleaning and lubrication of the caliper pad slides and the parking brake calipers.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"years":1}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-10'))));

select pg_temp.stage('T-062#b', 'tesla', 'issue:parking_brake_seize', 'owner_pattern', 'high',
  'The rear and parking brake calipers seize in a salt climate, and a seized parking brake caliper is replaced as a complete unit.',
  jsonb_build_object(
    'applic', jsonb_build_array(pg_temp.p_tag('condition_tag', 'salt_climate')),
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-19', 'thread:tmc-parking-brake', '{"age_years":8}'::jsonb))));

select pg_temp.stage('T-063', 'tesla', 'issue:camber_wear_21', 'owner_pattern', 'medium',
  'On the staggered twenty one inch setup the rear tyres wear on the inner shoulder because of camber, and adjustable arms are the usual fix.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-05', 'thread:tmc-158252', '{"mileage_km":88000}'::jsonb))));

select pg_temp.stage('T-064', 'tesla', 'issue:door_handle_gen2', 'known_issue', 'high',
  'The second generation door handles fail through microswitches on brittle wiring and a cast drive gear; a harness costs about 120 dollars, repair kits exist, the manufacturer charges 400 to 500 dollars and the later handle design costs over a thousand dollars per door.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","harness":120,"oem_repair_from":400,"oem_repair_to":500}'::jsonb,
    'note', 'All four handles are checked, not one.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-20', 'thread:tmc-handle-harness', '{"age_years":8}'::jsonb),
      pg_temp.ev('S-T-MKT-01'))));

select pg_temp.stage('T-065', 'tesla', 'issue:ptc_heater_gen1', 'known_issue', 'medium',
  'On cars built between 2012 and 2015 condensate collects on the cabin heater control board, the heating elements short and the fuse of the direct current converter blows; the failure comes with age and the access is expensive.',
  jsonb_build_object(
    'note', 'A mandatory check before a winter in a cold country.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-21', 'thread:tmc-353740', '{"age_years":6,"mileage_km":56000}'::jsonb),
      pg_temp.ev('S-T-SPEC-13'))));

select pg_temp.stage('T-066', 'tesla', 'issue:dcdc_12v', 'known_issue', 'medium',
  'The lead acid 12 V battery lasts two to four years, and a repeated low voltage warning right after replacement points at the direct current converter, whose failure immobilises the car.',
  jsonb_build_object(
    'ev', jsonb_build_array(pg_temp.ev('S-T-SPEC-14'))));

select pg_temp.stage('T-067', 'tesla', 'issue:pano_roof_leak', 'owner_pattern', 'medium',
  'The panoramic roof leaks and makes wind noise, and the first generation parts, used until early 2015, are no longer supplied.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-22', 'thread:tmc-162011', '{"age_years":9}'::jsonb),
      pg_temp.ev('S-T-OWN-22', 'thread:tmc-131989', '{"age_years":10}'::jsonb),
      pg_temp.ev('S-T-OWN-22', 'thread:tmc-95201'))));

-- ---------- B7. Володіння і порівняння ----------

select pg_temp.stage('T-070', 'tesla', 'ver:p85d', 'owner_pattern', 'medium',
  'Real consumption is 190 to 200 watt hours per kilometre in summer driven calmly and about 250 in winter at 110 km/h, giving a winter motorway range of about 290 kilometres on a healthy car and 200 to 240 on a tired one; twenty one inch wheels add five to eight percent.',
  jsonb_build_object(
    'value_kind', 'range',
    'value', '{"summer_from":190,"summer_to":200,"winter":250,"unit":"Wh/km"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-23', 'thread:tmc-efficiency-2015'),
      pg_temp.ev('S-T-OWN-23', 'thread:tmc-winter-consumption'),
      pg_temp.ev('S-T-OWN-23', 'thread:tmc-winter-range'))));

select pg_temp.stage('T-071', 'tesla', 'ver:p85d', 'owner_pattern', 'medium',
  'Out of warranty the running cost of this car is not an even annual figure but isolated large bills of five thousand dollars and more for a drive unit, a pack or the media unit.',
  jsonb_build_object(
    'note', 'The reference card explicitly declines to give an annual cost figure.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-24', 'thread:tmc-158252', '{"mileage_km":88000}'::jsonb),
      pg_temp.ev('S-T-OWN-24', 'thread:tmc-278390', '{"mileage_km":135000}'::jsonb))));

select pg_temp.stage('T-072', 'tesla', 'ver:p85d', 'owner_pattern', 'medium',
  'Against the 85D this car is heavier, noisier and shorter on range and carries the rear drive unit coolant leak, while it is faster on an overtake by almost a second between fifty and seventy miles per hour.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-24', 'thread:tmc-158252', '{"mileage_km":88000}'::jsonb),
      pg_temp.ev('S-T-OWN-24', 'thread:tmc-278390', '{"mileage_km":135000}'::jsonb))));

select pg_temp.stage('T-073#a', 'tesla', 'var:pack_90_gen1', 'owner_pattern', 'medium',
  'Early 90 kWh packs with silicon added to the anode degraded faster than the 85, while the 90D and the 85D are identical in acceleration and the performance 90 is always slightly quicker.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-25', 'thread:tmc-90-degradation'),
      pg_temp.ev('S-T-OWN-25', 'thread:tmc-90-alike'),
      pg_temp.ev('S-T-OWN-25', 'thread:tmc-range-compared'))));

select pg_temp.stage('T-073#b', 'tesla', 'var:pack_90_gen1', 'specialist_practice', 'medium',
  'The faster degradation of the early 90 kWh packs is attributed to the silicon added to the anode.',
  jsonb_build_object(
    'causal', 'plausible_mechanism',
    'ev', jsonb_build_array(
      pg_temp.ev('S-T-OWN-25', 'thread:tmc-90-degradation'))));

select pg_temp.stage('T-074', 'tesla', 'line:model_s', 'official_fact', 'high',
  'The steps that remove the weaknesses of this version are the facelift of April 2016, the second generation driver assistance hardware of October 2016, the 100D of 2017, the newer media unit of March 2018 and the Raven update of April 2019 with a permanent magnet front motor, adaptive air suspension and rapid charging hardware.',
  jsonb_build_object(
    'value_kind', 'date_window',
    'value', '{"facelift":"2016-04","ap2":"2016-10","100d":"2017","mcu2":"2018-03","raven":"2019-04"}'::jsonb,
    'ev', jsonb_build_array(pg_temp.ev('S-T-OFF-11'))));

\o
