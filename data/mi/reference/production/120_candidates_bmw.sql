-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 120_candidates_bmw.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- Phase 3 back-loading: кандидати з картки BMW M550i xDrive G30 MY2018 (US).
--
-- Правило розщеплення (однакове для трьох карток):
--   1. Атом, що несе кілька типів знання, дає по кандидату на тип.
--   2. Атом про різні subject дає по кандидату на subject.
--   3. Офіційний інтервал і власницька практика це РІЗНІ клейми з різним
--      layer: вони ніколи не зливаються один в одного.
--   4. Числа однієї специфікації з одного документа лишаються одним
--      клеймом: вони не можуть розійтись поодинці.
-- Розщеплення видно у task_ref: 'C-049#a', 'C-049#b'.
--
-- Жодне джерело тут не вигадане і жодне правило gate не послаблене.

-- Результати викликів не потрібні у виводі завантаження.
\o /dev/null

-- ---------- B1. Ідентичність ----------

select mi_load.stage('C-001', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'high',
  'The M550i xDrive G30 for model year 2018 in the United States is built with the N63B44O2 engine, which BMW designates internally as N63R and which is the second technical update of the N63 family.',
  jsonb_build_object(
    'subject_text', 'M550i xDrive G30 MY2018 US',
    'value_kind', 'enum',
    'value', '{"engine_code":"N63B44O2","internal_designation":"N63R","revision":"N63TU2"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-01'), mi_load.ev('S-OFF-08'),
      mi_load.ev('S-OFF-16'), mi_load.ev('S-SPEC-01'))));

select mi_load.stage('C-002', 'bmw', 'ver:m550i_g30', 'official_fact', 'high',
  'In the United States the M550i xDrive is rated at 456 hp, that is 340 kW, between 5,500 and 6,000 rpm and at 651 Nm between 1,800 and 4,750 rpm.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"power_hp":456,"power_kw":340,"torque_nm":651,"unit":"hp"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2018, 2019, 1),
      mi_load.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-01'), mi_load.ev('S-SPEC-03'),
      mi_load.ev('S-SEARCH', null, null, 'context',
        'The European rating of 462 PS and 650 Nm describes the same engine measured by a different method.'))));

select mi_load.stage('C-003', 'bmw', 'vmy:m550i_us_2020', 'official_fact', 'high',
  'The N63B44T3 engine rated at 523 hp and 750 Nm reached the M550i only with model year 2020, produced from July 2019, in an otherwise unchanged pre-facelift body.',
  jsonb_build_object(
    'value_kind', 'date_window',
    'value', '{"from":"2019-07","engine_code":"N63B44T3","power_hp":523,"torque_nm":750}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-02'), mi_load.ev('S-OWN-10'))));

select mi_load.stage('C-004', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'high',
  'The M550i xDrive G30 is built with the ZF 8HP75 automatic transmission, which BMW designates GA8HP75Z.',
  jsonb_build_object(
    'value_kind', 'enum',
    'value', '{"transmission":"ZF 8HP75","bmw_code":"GA8HP75Z","option_code":"2TB"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-01'), mi_load.ev('S-SPEC-08'), mi_load.ev('S-MKT-01'))));

-- Картка позначила це official_fact, але у реєстрі за ним стоять лише
-- оголошення розбирань і стаття продавця запчастин. Gate не послаблюється.
select mi_load.stage('C-005', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'high',
  'The M550i xDrive G30 is built with the ATC13-1 transfer case.',
  jsonb_build_object(
    'value_kind', 'enum',
    'value', '{"transfer_case":"ATC13-1"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-MKT-01'), mi_load.ev('S-SPEC-09'))));

select mi_load.stage('C-006', 'bmw', 'ver:m550i_g30', 'official_fact', 'high',
  'The M Sport differential is absent from the M550i for model years 2018 and 2019 and becomes standard equipment only with model year 2020 under option code 2T4.',
  jsonb_build_object(
    'value_kind', 'option_code',
    'value', '{"option_code":"2T4","standard_from_model_year":2020}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2018, 2019)),
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-01'), mi_load.ev('S-OFF-02'),
      mi_load.ev('S-SEARCH', null, null, 'contradicts',
        'Forum posts claim that the dynamic handling package includes an active M differential on pre-2020 cars, which the pricing guide contradicts.'))));

select mi_load.stage('C-007', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'high',
  'Standard equipment for model year 2018 in the United States includes adaptive M suspension, M Sport brakes, nineteen inch 664M wheels with 245/40 front and 275/35 rear run flat tyres, adaptive LED headlights, the Harman Kardon audio system, navigation and multi contour seats.',
  jsonb_build_object(
    'value_kind', 'option_code',
    'value', '{"codes":["2VF","2NH","664M","Icon Adaptive LED","HK audio"],"tyres":{"front":"245/40 R19","rear":"275/35 R19"}}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-01'))));

select mi_load.stage('C-008', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'high',
  'The model year 2018 United States price list sets the option packages at 800 for ZCW, 1,700 for ZDA with the head-up display, a further 1,700 for ZDB, 3,600 for ZDH combining 2VW, Z1A and ZX5, 1,200 for ZEC, 1,200 for ZLS, 700 for ZPK, 3,400 for 6F1, 300 for 6CP, 2,300 for 6UK, 2,200 for 6FH, 190 for 6U8, 350 for 6WB, 1,100 for 22E and 950 for 29X with 2QR.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2017-06","items":{"ZCW":800,"ZDA":1700,"ZDB":1700,"ZDH":3600,"ZEC":1200,"ZLS":1200,"ZPK":700,"6F1":3400,"6CP":300,"6UK":2300,"6FH":2200,"6U8":190,"6WB":350,"22E":1100,"29X_2QR":950}}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-01'))));

select mi_load.stage('C-009', 'bmw', 'ver:m550i_g30', 'official_fact', 'high',
  'The M Sport brake system uses 374 by 36 millimetre four piston fixed calipers at the front and 345 by 24 millimetre discs at the rear.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"front_disc_mm":374,"front_thickness_mm":36,"rear_disc_mm":345,"rear_thickness_mm":24,"unit":"mm"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-01'), mi_load.ev('S-OWN-11'),
      mi_load.ev('S-SEARCH', null, null, 'contradicts',
        'Unofficial sources quote a 370 millimetre rear disc, which the official specification does not support.'))));

-- Картка типізувала масу як official_fact, але за нею стоять тест і каталог.
select mi_load.stage('C-010', 'bmw', 'ver:m550i_g30', 'official_fact', 'medium',
  'Kerb weight in the United States is about 1,980 kg, quoted as 4,364 to 4,372 pounds.',
  jsonb_build_object(
    'value_kind', 'range',
    'value', '{"from":4364,"to":4372,"unit":"lb"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_tag('market_sold', 'US')),
    'ev', jsonb_build_array(
      mi_load.ev('S-REV-01'), mi_load.ev('S-SPEC-04'),
      mi_load.ev('S-SEARCH', null, null, 'context',
        'European catalogues quote 1,885 to 1,990 kg by the DIN method.'))));

select mi_load.stage('C-011', 'bmw', 'ver:m550i_g30', 'official_fact', 'high',
  'The factory figure for nought to sixty miles per hour is 3.9 seconds; an instrumented test recorded 3.8 seconds, a quarter mile in 12.3 seconds at 185 km/h, braking from 113 km/h in 46 metres and 0.94 g of lateral grip.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"zero_to_sixty_s":3.9,"tested_zero_to_sixty_s":3.8,"quarter_mile_s":12.3,"braking_m":46,"lateral_g":0.94,"unit":"s"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_tag('market_sold', 'US')),
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-01'), mi_load.ev('S-REV-01'), mi_load.ev('S-REV-02'))));

select mi_load.stage('C-012', 'bmw', 'ver:m550i_g30', 'official_fact', 'high',
  'The official United States fuel economy rating is 16 miles per gallon in town, 25 on the highway and 19 combined, that is 14.7, 9.4 and 12.4 litres per hundred kilometres.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"city_mpg":16,"highway_mpg":25,"combined_mpg":19,"unit":"mpg"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_tag('market_sold', 'US')),
    'ev', jsonb_build_array(mi_load.ev('S-OFF-09'))));

select mi_load.stage('C-013', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'high',
  'Recall 19V684 of 2019, covering reversing camera software, is the only recall recorded for the model year 2018 M550i, alongside twenty three owner complaints and no open investigations.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"recall_id":"19V684","year":2019,"complaints":23,"investigations":0}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-10'))));

-- Знову official_fact без офіційного джерела: лише переказ продавця запчастин.
select mi_load.stage('C-014', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'medium',
  'Service action SI B16 08 18 covers an incorrect factory fuel module for the model and market on G30, G32 and G12 cars produced between August 2015 and March 2018.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SI B16 08 18","production_from":"2015-08","production_to":"2018-03"}'::jsonb,
    'note', 'The reference card records that it is not confirmed whether the M550i itself is on the affected list.',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-10'), mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-015', 'bmw', 'ver:m550i_g30', 'calcar_synthesis', 'medium',
  'An M550i dressed as an M5 can be told apart by hardware rather than by bodywork: the F90 M5 has wider front wings, its own mirrors and diffuser, 395 millimetre brakes with M calipers, the M xDrive and M Mode menus in the infotainment system and its own model code in the vehicle identification number, while body kit and brakes can simply be swapped over.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-14'), mi_load.ev('S-OWN-24'),
      mi_load.ev('DOC2', null, null, 'context',
        'The owner document raised the question of visual disguise; the delta audit confirmed the hypothesis.'))));

-- ---------- B2. Мотор: еволюція і конструкція ----------

select mi_load.stage('C-020', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'Against the first technical update the second update introduced twin scroll turbochargers, electric wastegate and flap actuators, pistons with eight drain holes instead of four and an extra ring groove, iron coated bearing shells, a compression ratio of 10.5 instead of 10.0, a heat exchanger in the vee, split cooling, a map controlled oil pump, chromed valve stems, variable valve timing moved into the cylinder head cover, an improved head gasket and guides, and an electric pump that keeps cooling the turbochargers for up to thirty minutes after shutdown.',
  jsonb_build_object(
    'value_kind', 'enum',
    'value', '{"compression_ratio":10.5,"previous_compression_ratio":10.0,"after_run_minutes":30}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-16'), mi_load.ev('S-SPEC-01'), mi_load.ev('S-SPEC-02'))));

select mi_load.stage('C-021', 'bmw', 'var:n63b44t3', 'official_fact', 'high',
  'Against the second update the third update raises injection pressure to 350 bar with new injectors and high pressure pump, replaces the Alusil running surface with a sprayed coating on the T3 variant while the M3 variant keeps Alusil, adds a graphite skirt coating, rebalances the crankshaft with new main bearing shells, takes the connecting rods from the S63B44T4, uses electric blow-off valves, adds an intercooler bypass, moves to 42 kV ignition coils instead of 31 kV and adds a crankcase pressure sensor.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"injection_pressure_bar":350,"coil_kv":42,"previous_coil_kv":31,"unit":"bar"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-17'), mi_load.ev('S-SPEC-01'))));

select mi_load.stage('C-022', 'bmw', 'var:n63b44t3', 'official_fact', 'high',
  'On the third update BMW changed the valve stem seal material, describing the change as increased resilience to prevent hardening.',
  jsonb_build_object('ev', jsonb_build_array(mi_load.ev('S-OFF-17'))));

select mi_load.stage('C-023', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'The second update uses solenoid multi hole injectors at 200 bar rather than piezo injectors.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"injection_pressure_bar":200,"injector_type":"solenoid","unit":"bar"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-16'), mi_load.ev('S-SPEC-01'),
      mi_load.ev('S-SPEC-06', null, null, 'contradicts',
        'A tuning shop article called the injectors piezo without separating the revisions.'))));

select mi_load.stage('C-024', 'bmw', 'fam:n63', 'calcar_synthesis', 'high',
  'The hot vee layout, with the turbochargers inside the vee, is carried by every revision of this engine family, so the thermal load on the lines, actuators and wiring inside the vee never goes away.',
  jsonb_build_object(
    'propagation', 'family_context',
    'note', 'Family context propagation: the layout is a property of the family architecture documented by the manufacturer training material, so it describes every member of the family rather than one variant.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-16'), mi_load.ev('S-OWN-01', null, '{"mileage_km":64000}'::jsonb),
      mi_load.ev('S-OWN-05', null, '{"mileage_km":161000}'::jsonb))));

select mi_load.stage('C-025', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'The block of the second update is low pressure cast AlSi17Cu4Mg with a closed deck, and the cylinder running surfaces are Alusil: there are no liners, no Nikasil and no sprayed coating.',
  jsonb_build_object(
    'value_kind', 'enum',
    'value', '{"alloy":"AlSi17Cu4Mg","deck":"closed","bore_technology":"alusil"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-16'), mi_load.ev('S-OFF-17'),
      mi_load.ev('S-OWN-27', null, null, 'contradicts',
        'A forum contributor asserted that this revision already had a sprayed coating, which the training material contradicts.'))));

select mi_load.stage('C-026', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'The electrically controlled map thermostat begins to open at 105 degrees Celsius and is fully open at 120 degrees, so 105 degrees in traffic is the designed behaviour rather than a fault.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"open_start_c":105,"open_full_c":120,"unit":"C"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-16'), mi_load.ev('S-OWN-25', null, '{"mileage_km":90000}'::jsonb))));

-- ---------- B3. Мотор: надійність ----------

select mi_load.stage('C-030', 'bmw', 'var:n63b44o2', 'owner_pattern', 'medium',
  'Many healthy examples of the second update use no oil at all between services, with owners reporting nothing added over 75,000 km, over 90,000 km and over 160,000 km, while some cars ask for half a litre to a litre per interval; a noticeable and steady consumption is not normal for a healthy engine of this revision.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-01', 'thread:bp-1618778', '{"mileage_km":64000}'::jsonb),
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-26', 'thread:bf-1380533', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OWN-28', 'thread:bf-1360819', '{"age_years":2}'::jsonb),
      mi_load.ev('S-OWN-29', 'thread:bp-1974364', '{"mileage_km":75000}'::jsonb),
      mi_load.ev('S-LEG-01', null, null, 'contradicts',
        'The 2019 class action named the 2017 to 2019 M550i among the affected models.'))));

select mi_load.stage('C-031', 'bmw', 'brand:bmw', 'official_fact', 'high',
  'The manufacturer allowance for oil consumption on non-M engines is up to one quart per 750 miles, about one litre per 1,200 kilometres.',
  jsonb_build_object(
    'value_kind', 'range',
    'value', '{"from":0,"to":1,"per_distance_mi":750,"unit":"qt"}'::jsonb,
    'propagation', 'descendants',
    'note', 'Brand level policy published by the manufacturer for all non-M engines, so it applies to every model line and generation beneath the brand rather than to one variant.',
    'ev', jsonb_build_array(mi_load.ev('S-OFF-11'))));

select mi_load.stage('C-032', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'The service campaign that implements the oil consumption settlement covers only the first technical update built between 2013 and 2019, and neither the M550i nor the N63R appears on its model list.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SIB 01 01 22","covers":"N63TU1 2013-2019","excludes":["M550i","N63R"]}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-12'),
      mi_load.ev('S-LEG-01', null, null, 'contradicts',
        'The original complaint did name the 2017 to 2019 M550i.'))));

select mi_load.stage('C-033', 'bmw', 'issue:n63r_map_thermostat', 'known_issue', 'high',
  'Coolant escapes through the map thermostat connector into the cylinder one to four sensor harness and onward into the engine and power module connectors, setting the 1D2009, 1D2008, 10921B, 10921A, 1D2401, 1D2402, 1D2404, 1FB201 and 1FB301 faults; the documented repair replaces thermostat 11 53 8 685 978 and sensor harness 12 51 8 654 414 and inspects the control unit connectors.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SI B12 13 16","parts":["11538685978","12518654414"],"fault_codes":["1D2009","1D2008","10921B","10921A","1D2401","1D2402","1D2404","1FB201","1FB301"]}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_ref('generation', 'gen:g30', 1),
      mi_load.p_ref('generation', 'gen:g12', 1)),
    'ev', jsonb_build_array(mi_load.ev('S-OFF-04'))));

select mi_load.stage('C-034', 'bmw', 'issue:n63r_map_thermostat', 'official_fact', 'high',
  'The warranty on the thermostat of this engine was extended to fifteen years or 150,000 miles, and the 2018 M550i xDrive for the United States appears on the covered list.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SIB 01 01 21","years":15,"miles":150000,"market":"US"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2018, 2018, 1),
      mi_load.p_tag('market_sold', 'US', 2)),
    'note', 'Model year 2019 is not on the list and the reference card records no reason for that.',
    'ev', jsonb_build_array(mi_load.ev('S-OFF-05'))));

select mi_load.stage('C-035', 'bmw', 'issue:n63_turbo_coolant_lines', 'official_fact', 'high',
  'A service action replaces the turbocharger coolant line set 11 53 7 934 643 on G12 cars with this engine built between June 2015 and January 2017, because the hose material is not sufficiently resistant to turbocharger temperature.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SI B11 04 17","part":"11537934643","production_from":"2015-06","production_to":"2017-01"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_ref('generation', 'gen:g12', 1),
      mi_load.p_date('production_date', date '2015-06-01', date '2017-01-31', 2)),
    'note', 'Recorded explicitly so that the campaign is not transferred to the M550i, which started production in March 2017 and is not covered, even though the design is the same.',
    'ev', jsonb_build_array(mi_load.ev('S-OFF-03'))));

select mi_load.stage('C-036#a', 'bmw', 'issue:n63_cooling_age', 'owner_pattern', 'medium',
  'On this car the turbocharger coolant lines, the expansion tank, the radiator and both the mechanical and the electric turbocharger pump fail one after another past 100,000 kilometres rather than all at once.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-05', 'thread:bp-2244036', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb))));

select mi_load.stage('C-036#b', 'bmw', 'issue:n63_cooling_age', 'owner_pattern', 'medium',
  'Owners put the cost of the cooling work at over a thousand dollars in parts plus two days of their own labour, about five thousand dollars at a franchised dealer and about two thousand dollars plus parts at an independent workshop.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","diy_parts_from":1000,"dealer":5000,"independent_labour":2000}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-05', 'thread:bp-2244036', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb))));

select mi_load.stage('C-037', 'bmw', 'issue:n63_wastegate_actuator', 'known_issue', 'medium',
  'The electric wastegate actuator is the single most frequent engine repair reported on the 2018 and 2019 M550i, setting fault 123704 and the surrounding 1234xx and 1235xx family; the part costs about 650 dollars and a dealer charges between 1,100 and 2,000 dollars, aftermarket parts bring the fault back, and the third update shares the same category of failure.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","part":650,"dealer_from":1100,"dealer_to":2000,"fault_code":"123704"}'::jsonb,
    'note', 'Share of the fleet is unknown and the reference card says so.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-02', 'thread:bp-2074062', '{"mileage_km":100000}'::jsonb),
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":167000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('S-OWN-07', 'thread:bp-2017789', '{"mileage_km":93000}'::jsonb),
      mi_load.ev('S-OWN-30', 'thread:bp-1905102', '{"mileage_km":51000}'::jsonb),
      mi_load.ev('S-MKT-02'))));

select mi_load.stage('C-038', 'bmw', 'issue:n63_wastegate_actuator', 'official_fact', 'high',
  'Two service actions replace the wastegate actuators on G12 cars with this engine, one for cars built between July and November 2015 and one for cars built between September 2015 and June 2016, and the manufacturer describes the cause as an internal manufacturing defect.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_ids":["SI B11 04 16","SI B11 09 17"],"windows":[["2015-07","2015-11"],["2015-09","2016-06"]]}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_ref('generation', 'gen:g12')),
    'note', 'Recorded to show that the manufacturer knows this defect on this engine, without transferring the campaign to the G30.',
    'ev', jsonb_build_array(mi_load.ev('S-OFF-06'), mi_load.ev('S-OFF-07'))));

select mi_load.stage('C-039', 'bmw', 'ver:530e_g30', 'official_fact', 'high',
  'The wastegate actuator warranty extension to fifteen years or 150,000 miles applies only to the G30 530e and 530e xDrive under option XB1H, and not to the M550i.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SIB 01 07 21","years":15,"miles":150000,"covers":["530e","530e xDrive"]}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-13'),
      mi_load.ev('S-SEARCH', null, null, 'contradicts',
        'Search summaries wrongly attribute this extension to the N63 engine.'))));

select mi_load.stage('C-040', 'bmw', 'issue:n63_valve_stem_seals', 'owner_pattern', 'low',
  'On the second update the valve stem seal design is unchanged, the recorded replacements do not form a pattern, estimates of after 120,000 to 150,000 kilometres or never come from aggregators, and the repair costs between 2,500 and 5,000 euro because of the access required.',
  jsonb_build_object(
    'note', 'The reference card states that there are no direct owner reports of this repair on the M550i with this revision. Appendix P of the frozen architecture downgrades this atom from known_issue to owner_pattern with low confidence.',
    'ev', jsonb_build_array(
      mi_load.ev('S-SEARCH'), mi_load.ev('S-SPEC-06'), mi_load.ev('S-OFF-17'))));

select mi_load.stage('C-041', 'bmw', 'issue:n63_upper_oil_pan', 'owner_pattern', 'medium',
  'The upper oil pan gasket was replaced under warranty on a 2019 M550i at 65,000 kilometres, and the gasket 11138601057 is catalogued for this engine across the G30, G12, G15 and G05.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-09', 'thread:bp-1801258', '{"mileage_km":65000}'::jsonb),
      mi_load.ev('S-MKT-03'))));

select mi_load.stage('C-042', 'bmw', 'var:n63b44o2', 'specialist_practice', 'medium',
  'There is no confirmed timing chain problem on the second update: the documented chain stretch belongs to the 2008 to 2014 engines of this family.',
  jsonb_build_object(
    'causal', 'unknown',
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-05'), mi_load.ev('S-SPEC-06'),
      mi_load.ev('S-AGG-01', null, null, 'contradicts',
        'Aggregators carry timing chain stretch over to the M550i without evidence.'))));

select mi_load.stage('C-043#a', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'The injector warranty extension to ten years or 120,000 miles covers only the 2013 to 2015 first update engines in the F01, F02, F06, F07, F10, F12, F15 and F16, and does not include the M550i or the N63R.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SI B01 05 18","years":10,"miles":120000,"excludes":["M550i","N63R"]}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-18'))));

select mi_load.stage('C-043#b', 'bmw', 'var:n63b44o2', 'calcar_synthesis', 'medium',
  'Injectors are not a systemic problem on the second update, so they should not be described to a buyer as a typical weakness of this revision.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-18'), mi_load.ev('S-SPEC-06'), mi_load.ev('S-OWN-09'))));

select mi_load.stage('C-044', 'bmw', 'issue:n63_intake_carbon', 'specialist_practice', 'medium',
  'Carbon build-up on the intake valves applies to every direct injection engine in this family and becomes noticeable from about 100,000 kilometres, so cleaning is a planned job rather than a failure.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-07'))));

select mi_load.stage('C-045', 'bmw', 'var:n63b44o2', 'owner_pattern', 'low',
  'One owner reported failure of the accessory belt and its tensioner at 177,000 kilometres, accompanied by overheating.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":177000}'::jsonb))));

select mi_load.stage('C-046', 'bmw', 'var:n63b44o2', 'owner_pattern', 'low',
  'One owner reported alternator failure at 128,000 kilometres costing 1,768 dollars.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","amount":1768}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":128000}'::jsonb))));

select mi_load.stage('C-047', 'bmw', 'var:n63b44o2', 'owner_pattern', 'low',
  'One owner had the engine mounts replaced at forty months of age.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"age_years":3.3}'::jsonb))));

select mi_load.stage('C-048#a', 'bmw', 'var:n63b44o2', 'owner_pattern', 'medium',
  'Owners between 160,000 and 285,000 kilometres describe the engine itself as trouble free when it is serviced regularly, and summarise it as a strong engine that makes you pay for everything around it.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":177000}'::jsonb),
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-05', 'thread:bp-2244036', '{"mileage_km":285000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('S-OWN-31', 'thread:bf-1442690', '{"mileage_km":158000}'::jsonb))));

select mi_load.stage('C-048#b', 'bmw', 'var:n63b44o2', 'owner_pattern', 'low',
  'A franchised dealer technician stated that this V8 comes in for repair sixteen times as often as the inline six, mostly because of cooling.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-31', 'thread:bf-1442690', null),
      mi_load.ev('S-OWN-31', 'thread:bp-1695372', '{"mileage_km":158000}'::jsonb))));

select mi_load.stage('C-049#a', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'The electric turbocharger coolant pump runs for up to thirty minutes after the engine is switched off.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"after_run_max_min":30,"unit":"min"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-16'))));

select mi_load.stage('C-049#b', 'bmw', 'var:n63b44o2', 'specialist_practice', 'medium',
  'Shutting the engine down abruptly after a hard run is a thermal shock to the turbochargers, so one to two minutes of gentle driving before parking is the recommended practice.',
  jsonb_build_object(
    'causal', 'plausible_mechanism',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-11'), mi_load.ev('S-OFF-16'))));

select mi_load.stage('C-050', 'bmw', 'var:n63b44o2', 'owner_pattern', 'low',
  'Tuning does not change the pressure in the cooling lines, so coolant leaks are not directly linked to a reflash.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-01', 'thread:bp-1618778', '{"mileage_km":64000}'::jsonb))));

select mi_load.stage('C-051', 'bmw', 'issue:n63_bore_scoring', 'known_issue', 'medium',
  'Bore scoring on this engine is confirmed by independent cases across three markets: a standard 2018 M550i in Canada with two scored cylinders at 87,000 kilometres and an engine replacement costing about 30,000 Canadian dollars, a 2016 750i xDrive in the United States with cylinder eight scored at 151,000 kilometres, and a 2015 750Li in Moscow scored twice, at 30,000 and at 68,000 kilometres, both replaced under warranty. The share of the fleet is unknown, and against hundreds of trouble free histories this is rare.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-32', 'thread:bp-2013791', '{"mileage_km":87000,"market":"CA"}'::jsonb),
      mi_load.ev('S-OWN-27', 'thread:bf-1434091', '{"mileage_km":151000,"market":"US"}'::jsonb),
      mi_load.ev('S-OWN-33', 'thread:d2-750li', '{"mileage_km":68000,"market":"RU"}'::jsonb),
      mi_load.ev('S-SPEC-19'),
      mi_load.ev('S-SPEC-20', null, null, 'contradicts',
        'A specialist blog claims scoring appears between 5,000 and 15,000 kilometres without presenting data.'))));

select mi_load.stage('C-052', 'bmw', 'fam:n63', 'specialist_practice', 'medium',
  'The mechanism of scoring on aluminium silicon bores is the tearing out of silicon grains and plastic deformation of the aluminium matrix; it is provoked by fuel dilution of the oil during cold short trips, running below forty degrees Celsius, high sulfur fuel which triples wear at 1,000 parts per million, loss of the oil film through overheating or a low level, and failure of the piston skirt coating. The damage is irreversible.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'propagation', 'family_context',
    'note', 'Family context propagation: the mechanism is a property of the aluminium silicon bore technology documented by an engine builder, so it describes every family member built that way rather than a single variant.',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-19'))));

select mi_load.stage('C-053#a', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'Crankcase ventilation on the second update is integrated into the cylinder head covers, one labyrinth separator per bank with valves controlled by intake pressure, and there is no separate positive crankcase ventilation valve.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-OFF-16'), mi_load.ev('S-MKT-06'))));

select mi_load.stage('C-053#b', 'bmw', 'var:n63b44o2', 'owner_pattern', 'medium',
  'Crankcase ventilation failures do not form a pattern on the second update: the reference research found a single mention across 160,000 kilometres, so the valve set is not a preventive service item.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":160000}'::jsonb),
      mi_load.ev('S-SEARCH', null, null, 'contradicts',
        'Parts selling sites call crankcase ventilation a primary failure point of this engine family without data for this revision.'))));

select mi_load.stage('C-054', 'bmw', 'var:n63b44o2', 'owner_pattern', 'medium',
  'Coils and plugs wear normally but under a higher thermal load: stumbling at full throttle on a 2018 M550i was cured by plugs and coils, the original equipment coils are Bosch, and the coils used on the previous generation do not work on this one.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-34', 'thread:bp-1786725', '{"mileage_km":80000}'::jsonb),
      mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-055', 'bmw', 'fam:n63', 'specialist_practice', 'medium',
  'When injectors are replaced on this engine family they must carry the same index within a bank, and at index ten or lower the whole bank is replaced.',
  jsonb_build_object(
    'causal', 'plausible_mechanism',
    'ev', jsonb_build_array(mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-056', 'bmw', 'var:n63b44o2', 'calcar_synthesis', 'medium',
  'There is no confirmed service life limit for the turbochargers of the second update: owners run factory turbochargers at 158,000, 177,000 and 285,000 kilometres, cartridge failures do not form a pattern, and the claim that they last 100,000 to 150,000 kilometres has no denominator behind it. What hurts them is oil, cooling and actuators rather than distance.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":177000}'::jsonb),
      mi_load.ev('S-OWN-05', 'thread:bp-2244036', '{"mileage_km":285000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('S-OWN-31', 'thread:bf-1442690', '{"mileage_km":158000}'::jsonb),
      mi_load.ev('DOC2', null, null, 'contradicts',
        'The owner document proposed a 100,000 to 150,000 kilometre turbocharger life, which the delta audit rejected.'))));

select mi_load.stage('C-057', 'bmw', 'issue:n63_spun_bearing', 'specialist_practice', 'medium',
  'The documented spun bearing cases on this engine family follow rare oil changes and overheating: aluminium silicon bores and the bearing shells lose the oil film earlier than cast iron would.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-21'), mi_load.ev('S-SPEC-19'))));

-- ---------- B4. Мотор: обслуговування ----------
-- Офіційний інтервал і практика власників це різні клейми з різним layer:
-- жоден із них не поглинає інший.

select mi_load.stage('C-060', 'bmw', 'maint:n63tu2_oil', 'official_fact', 'high',
  'The official oil service interval is 10,000 miles or twelve months, carried as condition based service code 8KL.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"distance":10000,"distance_unit":"mi","months":12,"cbs_code":"8KL"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-01'))));

select mi_load.stage('C-061', 'bmw', 'maint:n63tu2_oil', 'official_fact', 'high',
  'The oil fill quantity with filter is 10.5 litres on all wheel drive cars, with the G30 M550i named on the list, and 10.0 litres without all wheel drive.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'quantity',
    'value', '{"awd_litres":10.5,"rwd_litres":10.0,"unit":"l"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-OFF-08'))));

select mi_load.stage('C-062', 'bmw', 'maint:n63tu2_oil', 'official_fact', 'medium',
  'The oil specification is Longlife-01 FE 0W-30 under the Longlife-01 approval rather than the newer Longlife-17 FE plus.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'enum',
    'value', '{"spec":"BMW Longlife-01 FE 0W-30","approval":"LL-01"}'::jsonb,
    'note', 'The reference card records that the primary manufacturer document was not read.',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-12'), mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-063#a', 'bmw', 'maint:n63tu2_oil', 'owner_practice', 'medium',
  'Owners shorten the oil interval well below the factory figure: most long term owners in North America change between 8,000 and 12,000 kilometres, that is 5,000 to 7,500 miles, with occasional 15,000 kilometre intervals, while owners and specialist workshops in the former Soviet states work to 5,000 to 8,000 kilometres and describe five to seven thousand as ideal and eight to ten thousand as the maximum. There is no direct evidence that the factory interval harms this revision: one owner running nine to ten thousand miles covered 160,000 kilometres without trouble.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":177000}'::jsonb),
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('S-OWN-25', 'thread:d2-m550', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OWN-33', 'thread:d2-750li', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OWN-35', 'thread:bf-1458547', '{"mileage_km":160000}'::jsonb),
      mi_load.ev('S-OWN-31', 'thread:bf-1442690', '{"mileage_km":158000}'::jsonb))));

select mi_load.stage('C-063#b', 'bmw', 'maint:n63tu2_oil', 'specialist_practice', 'medium',
  'Specialist workshops set a shorter oil interval than the factory for this engine family, quoting 5,000 miles, five to seven thousand kilometres as ideal, and seven to eight thousand kilometres alongside sleeving work.',
  jsonb_build_object(
    'layer', 'specialist',
    'causal', 'plausible_mechanism',
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-22'), mi_load.ev('S-SPEC-20'), mi_load.ev('S-SPEC-23'))));

select mi_load.stage('C-064', 'bmw', 'maint:n63tu2_plugs', 'official_fact', 'medium',
  'Spark plugs are changed at every third oil service, about 48,000 kilometres, using NGK SILZKBR8D8S part 97506 with a gap of 0.8 millimetres.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"distance":48000,"distance_unit":"km","part":"NGK 97506","gap_mm":0.8}'::jsonb,
    'note', 'Some sources name 60,000 miles instead.',
    'ev', jsonb_build_array(mi_load.ev('S-OWN-13'), mi_load.ev('S-MKT-04'))));

select mi_load.stage('C-065', 'bmw', 'maint:n63tu2_coolant', 'official_fact', 'high',
  'Coolant is officially described as a lifetime fill, replaced only during repairs.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'enum',
    'value', '{"interval":"lifetime"}'::jsonb,
    'note', 'Practice is five to six years.',
    'ev', jsonb_build_array(mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-066', 'bmw', 'maint:n63tu2_radiators', 'owner_practice', 'medium',
  'Owners and specialist workshops in hot and dusty climates wash the radiator pack once a year with the pack removed, run only 98 to 100 octane fuel, keep idling to a minimum and watch the coolant level; the same practice recurs among independent owners of the G12 and the G30.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'plausible_mechanism',
    'applic', jsonb_build_array(
      mi_load.p_tag('condition_tag', 'hot_climate', 1),
      mi_load.p_tag('condition_tag', 'city_dominant', 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-33', 'thread:d2-750li', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OWN-35', 'thread:bf-1458547', '{"mileage_km":160000}'::jsonb),
      mi_load.ev('S-SPEC-20'))));

select mi_load.stage('C-067', 'bmw', 'state:n63_thermostat_defeat', 'owner_practice', 'medium',
  'A cold thermostat, a resistor placed between the temperature sensor and the engine control unit, is widespread in the former Soviet states and is disputed by owners themselves, who call it a nail in the coffin under load.',
  jsonb_build_object(
    'causal', 'observed_association',
    'applic', jsonb_build_array(
      mi_load.p_tag('market_operated', 'RU', 1),
      mi_load.p_tag('market_operated', 'UA', 1)),
    'note', 'Contested practice. CalCar does not recommend it and treats it as an intervention to be found during inspection.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-33', 'thread:d2-750li', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OWN-25', 'thread:d2-m550', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OFF-16', null, null, 'contradicts',
        'The official temperature map of 105 to 120 degrees Celsius shows that the high reading is designed behaviour.'))));

select mi_load.stage('C-068', 'bmw', 'var:n63b44o2', 'calcar_synthesis', 'medium',
  'A good service history on this engine means documented oil intervals no longer than 10,000 kilometres, transmission, transfer case and differential fluids changed at least once by 100,000 kilometres, plugs to schedule, invoices for cooling and actuator repairs, radiator cleaning, 98 octane or better fuel and the absence of reflashes and defeat devices. Each item is a signal rather than a guarantee.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-35', 'thread:bf-1458547', '{"mileage_km":160000}'::jsonb),
      mi_load.ev('S-OFF-01'))));

-- ---------- B5. Мотор: тюнінг ----------

select mi_load.stage('C-070', 'bmw', 'var:n63b44o2', 'specialist_practice', 'high',
  'A tuning vendor quotes stage one on 93 octane at plus nineteen percent power and plus twenty seven percent torque, and stage two at plus twenty four and plus thirty percent.',
  jsonb_build_object(
    'causal', 'observed_association',
    'value_kind', 'quantity',
    'value', '{"stage1_power_pct":19,"stage1_torque_pct":27,"stage2_power_pct":24,"stage2_torque_pct":30,"unit":"percent"}'::jsonb,
    'note', 'The owner document claimed 590 to 620 hp at stage two, which the delta audit rejected as overstated.',
    'ev', jsonb_build_array(mi_load.ev('S-TUN-01'))));

select mi_load.stage('C-071', 'bmw', 'var:n63b44o2', 'specialist_practice', 'high',
  'A measured 2018 M550i produced 419 wheel horsepower and 614 Nm standard, and 494 wheel horsepower with 731 Nm at stage two with downpipes, intake and charge pipes on 93 octane, moving nought to sixty miles per hour from 4.21 to 3.37 seconds and the quarter mile from 12.42 to 11.28 seconds.',
  jsonb_build_object(
    'causal', 'observed_association',
    'value_kind', 'quantity',
    'value', '{"stock_whp":419,"stage2_whp":494,"stock_wtq_nm":614,"stage2_wtq_nm":731,"unit":"whp"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-TUN-02'))));

select mi_load.stage('C-072', 'bmw', 'var:zf8hp75', 'specialist_practice', 'medium',
  'The 8HP75 is rated at 750 Nm, which the factory third update reaches through the same transmission, and stage two exceeds it; vendors name clutch pack E and the C and E hubs as the weak points under load, and the ATC13-1 transfer case as a weak point at high power.',
  jsonb_build_object(
    'causal', 'plausible_mechanism',
    'value_kind', 'quantity',
    'value', '{"rated_torque_nm":750,"unit":"Nm"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-TUN-03'), mi_load.ev('S-SEARCH'))));

-- ---------- B6. Коробка ----------

select mi_load.stage('C-080', 'bmw', 'maint:zf8hp75_atf', 'specialist_practice', 'high',
  'The transmission manufacturer treats the fluid as a service item and sets the first change at roughly 80,000 to 150,000 kilometres, shortened under load, in heat or with an unknown history, against the vehicle manufacturer calling it a lifetime fill. Only the manufacturer approved fluid is used, the pan carries an integrated filter and the level is set at 40 to 50 degrees Celsius.',
  jsonb_build_object(
    'layer', 'specialist',
    'causal', 'plausible_mechanism',
    'propagation', 'descendants',
    'note', 'The interval is published by the transmission manufacturer for the whole 8HP family, so it applies to the variants beneath it rather than only to the 8HP75.',
    'value_kind', 'range',
    'value', '{"from":80000,"to":150000,"unit":"km"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-13'), mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-081', 'bmw', 'maint:zf8hp75_atf', 'owner_practice', 'medium',
  'Owners of this car change the transmission, transfer case and differential fluids between 80,000 and 160,000 kilometres; one owner did so at 80,000 and again at 160,000 kilometres with no trouble by 160,000.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-14', 'thread:bp-1971470', '{"mileage_km":130000}'::jsonb))));

select mi_load.stage('C-082', 'bmw', 'fam:zf8hp', 'specialist_practice', 'medium',
  'Old fluid in this transmission family shows itself as a delay when cold, as hanging between ratios and as a hard two to one downshift.',
  jsonb_build_object(
    'causal', 'plausible_mechanism',
    'propagation', 'descendants',
    'note', 'The symptom description comes from a specialist workshop writing about the family as a whole, so it applies to the variants beneath it.',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-13'))));

select mi_load.stage('C-083', 'bmw', 'var:zf8hp75', 'owner_pattern', 'medium',
  'No pattern of transmission failure was found on standard examples of this car; the absence of reports is not proof of reliability.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":177000}'::jsonb),
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-05', 'thread:bp-2244036', '{"mileage_km":285000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb))));

-- ---------- B7. Трансмісія ----------

select mi_load.stage('C-090', 'bmw', 'issue:g30_xdrive_shudder', 'known_issue', 'medium',
  'A service bulletin describes low speed shudder from the all wheel drive system, attributes it either to factory transfer case fluid that is off specification or to incorrect and unevenly worn tyres, and prescribes the approved fluid 83 22 2 409 710 with a calibration and up to 200 kilometres of bedding in; the G30 is on the list.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"doc_id":"SIB 27 02 20","part":"83222409710","bed_in_km":200}'::jsonb,
    'note', 'The reference card records that the primary document was not read.',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-09'), mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-091', 'bmw', 'maint:atc13_fluid', 'specialist_practice', 'medium',
  'The transfer case takes less than a litre of the approved fluid and has no drain plug.',
  jsonb_build_object(
    'layer', 'specialist',
    'causal', 'unknown',
    'value_kind', 'quantity',
    'value', '{"capacity_max":1,"unit":"l"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-09'))));

select mi_load.stage('C-092', 'bmw', 'issue:g30_flex_disc', 'owner_pattern', 'medium',
  'The flexible propshaft coupling is replaced between 80,000 and 170,000 kilometres.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":77000}'::jsonb))));

select mi_load.stage('C-093', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'The all wheel drive system is rear biased, feels confident in winter on winter tyres and is noticeably worse on all season run flats.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-14'),
      mi_load.ev('S-OWN-15', 'thread:bp-snow'),
      mi_load.ev('S-OWN-15', 'thread:bf-winter-tyres'))));

-- ---------- B8. Шасі ----------

select mi_load.stage('C-100', 'bmw', 'issue:g30_tension_strut', 'known_issue', 'medium',
  'The hydraulic bushings of the front tension struts knock and shudder under braking from 50,000 to 80,000 kilometres, and this is common to the generation rather than specific to this version.',
  jsonb_build_object(
    'applic', jsonb_build_array(mi_load.p_ref('generation', 'gen:g30')),
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-14'),
      mi_load.ev('S-OWN-16', 'thread:bp-1876339', '{"mileage_km":65000}'::jsonb))));

select mi_load.stage('C-101', 'bmw', 'issue:m550i_damper_leak', 'known_issue', 'low',
  'Adaptive dampers leak after 80,000 to 120,000 kilometres, usually at one or two corners.',
  jsonb_build_object(
    'note', 'The reference card records that direct owner reports are scarce and that this rests on aggregators plus reasoning.',
    'ev', jsonb_build_array(mi_load.ev('S-AGG-02'))));

select mi_load.stage('C-102', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'Integral active steering feels artificial to some owners and takes getting used to when parking, the actuator costs more than four thousand dollars, and owners do not always say they would order it again.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-17', 'thread:bp-1646815'),
      mi_load.ev('S-OWN-17', 'thread:bf-ias'),
      mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-103', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'The factory run flat tyres wear and get damaged quickly, with one owner going through ten tyres in three years, and nineteen inch wheels are the minimum size because of the calipers.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"age_years":3}'::jsonb),
      mi_load.ev('S-OWN-15', 'thread:bf-runflat', '{"age_years":3}'::jsonb))));

select mi_load.stage('C-104', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'low',
  'The original brakes can last to 160,000 kilometres with calm driving.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb))));

-- ---------- B9. Електроніка і комфорт ----------

select mi_load.stage('C-110', 'bmw', 'issue:g30_ac_evaporator', 'known_issue', 'high',
  'The air conditioning evaporator of this generation fails early, between 65,000 and 100,000 kilometres or four to seven years, on the newer refrigerant; the fault is logged as 80120B, a dealer charges five to seven thousand dollars and the dashboard has to come out. This is the most expensive repair on the car that has nothing to do with the engine.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","dealer_from":5000,"dealer_to":7000,"fault_code":"80120B"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_ref('generation', 'gen:g30')),
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-15'),
      mi_load.ev('S-OWN-18', 'thread:bp-2173396', '{"mileage_km":85000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb))));

select mi_load.stage('C-111', 'bmw', 'issue:g30_led_drl', 'known_issue', 'medium',
  'The daytime running light module yellows or fails; part 63117214934 is replaceable on its own, although a dealer sometimes proposes a complete headlight.',
  jsonb_build_object(
    'value_kind', 'part_number',
    'value', '{"part":"63117214934"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-19', 'thread:bp-drl-failed'),
      mi_load.ev('S-OWN-19', 'thread:bp-drl-yellow'),
      mi_load.ev('S-MKT-05'))));

select mi_load.stage('C-112', 'bmw', 'issue:g30_adaptive_headlight', 'specialist_practice', 'medium',
  'Moisture inside an adaptive headlight kills the module and produces the adaptive headlight malfunction message.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-16'))));

select mi_load.stage('C-113', 'bmw', 'issue:g30_battery_drain', 'owner_pattern', 'medium',
  'The electronics do not go to sleep unless the car is locked with the key, and a failed comfort access door handle adds a parasitic draw.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-20', 'thread:bp-1914014', '{"age_years":4}'::jsonb),
      mi_load.ev('S-SPEC-17'))));

select mi_load.stage('C-114', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'low',
  'One owner paid about 850 dollars to replace the display key.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","amount":853}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb))));

select mi_load.stage('C-115', 'bmw', 'vmy:m550i_us_2018', 'official_fact', 'high',
  'On model year 2018 the infotainment system is the sixth generation, Apple CarPlay is a 300 dollar option and Android Auto is not offered; CarPlay became standard for model year 2019 and the seventh generation system arrived for model year 2020.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2017-06","carplay_option":300}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-01'), mi_load.ev('S-OFF-02'), mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-116', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'The exhaust note is widely considered muted, the active sound design is synthetic, and switching it off requires coding.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-21', 'thread:bp-exhaust-sounds'),
      mi_load.ev('S-OWN-21', 'thread:bf-exhaust-great'),
      mi_load.ev('S-REV-01'),
      mi_load.ev('DOC2', null, null, 'contradicts',
        'The owner document called the sound thick and pedigreed; the consensus of owners is the opposite.'))));

-- ---------- B10. Володіння і порівняння ----------

select mi_load.stage('C-120', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'high',
  'Real consumption reported by owners is 27 to 31 miles per gallon on the highway, 12 to 18 in town and 18 to 23 mixed, that is 7.6 to 8.7, 13 to 20 and 10 to 13 litres per hundred kilometres.',
  jsonb_build_object(
    'value_kind', 'range',
    'value', '{"highway_from":27,"highway_to":31,"city_from":12,"city_to":18,"mixed_from":18,"mixed_to":23,"unit":"mpg"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-22', 'thread:bp-1826385', '{"mileage_km":50000}'::jsonb),
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":177000}'::jsonb),
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb))));

select mi_load.stage('C-121', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'This version costs ten to twenty percent more to run than the six cylinder car in normal circumstances, and labour in the engine bay can be twice as long.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-23', 'thread:bp-2116863', '{"mileage_km":100000}'::jsonb))));

select mi_load.stage('C-122', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'Past 100,000 kilometres and out of warranty, owners in the United States advise budgeting two to four thousand dollars a year, and two to three thousand before that.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","annual_from":2000,"annual_to":4000}'::jsonb,
    'note', 'Depends heavily on the country.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('S-OWN-35', 'thread:bf-1458547', '{"mileage_km":160000}'::jsonb))));

select mi_load.stage('C-123#a', 'bmw', 'issue:b58_oil_filter_housing', 'known_issue', 'medium',
  'On the six cylinder car the plastic oil filter housing and the coolant vent hose leak between 100,000 and 130,000 kilometres, and the job takes six to eleven hours.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-18'), mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-123#b', 'bmw', 'var:b58b30', 'official_fact', 'medium',
  'The six cylinder block is closed deck with sprayed running surfaces and has neither cast iron liners nor Alusil.',
  jsonb_build_object(
    'note', 'The owner document asserted cast iron liners for this engine, which the delta audit rejected.',
    'ev', jsonb_build_array(
      mi_load.ev('S-SEARCH'),
      mi_load.ev('DOC2', null, null, 'contradicts',
        'The owner document claimed cast iron liners.'))));

select mi_load.stage('C-124', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'A tuned six cylinder car does not become this car and the reverse is equally untrue: the character is different.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-23', 'thread:bp-2116863', '{"mileage_km":100000}'::jsonb))));

select mi_load.stage('C-125#a', 'bmw', 'ver:m550i_g30', 'owner_pattern', 'medium',
  'Against the M5 of the same year and mileage this car is at least thirty percent cheaper and delivers eighty five to ninety percent of the road performance; owners of both cars call the difference on the road marginal and describe the M5 as another animal only on track and noticeably harsher every day.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-24', 'thread:bp-lci-m550-v-m5'),
      mi_load.ev('S-OWN-24', 'thread:bp-f90-m5-vs-m550'),
      mi_load.ev('S-OWN-36', 'thread:bp-1936787'),
      mi_load.ev('S-REV-03'))));

select mi_load.stage('C-125#b', 'bmw', 'ver:m550i_g30', 'calcar_synthesis', 'medium',
  'For road use the gap to the M division car is a question of price and everyday comfort rather than of capability, and the case for the M5 rests on track use.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-REV-03'), mi_load.ev('S-OWN-36'), mi_load.ev('S-OFF-14'))));

select mi_load.stage('C-126', 'bmw', 'var:n63b44o2', 'owner_pattern', 'low',
  'A reflashed second update matches or beats a standard third update in acceleration, and the real standard to standard gap measured on a dynamometer is about half of the 67 hp claimed on paper.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-12', 'thread:bp-1776989'))));

select mi_load.stage('C-127#a', 'bmw', 'var:s63b44t4', 'official_fact', 'medium',
  'Against the series V8, the M division V8 has sixteen oil jets instead of eight, an additional oil pickup and an electronically controlled pressure valve for lateral acceleration above one g, a larger sump, an air to oil cooler instead of a heat exchanger in the vee, a four into two cross bank exhaust manifold, larger turbochargers at higher boost, 350 bar instead of 200, different pistons at 10.0 to one compression, all wheel drive with a two wheel drive mode, an active differential and the M division chassis with 395 and 380 millimetre brakes.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"oil_jets":16,"series_oil_jets":8,"injection_pressure_bar":350,"compression_ratio":10.0,"front_disc_mm":395,"rear_disc_mm":380,"unit":"bar"}'::jsonb,
    'note', 'Part of the comparison in the source contrasts the earlier revisions; the lubrication and manifold differences hold for the revisions fitted to these two cars.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-14'), mi_load.ev('S-SPEC-24'), mi_load.ev('S-OWN-36'))));

select mi_load.stage('C-127#b', 'bmw', 'var:n63b44o2', 'specialist_practice', 'medium',
  'This car is not a detuned M5: a reflash adds none of the M division lubrication, cooling or exhaust manifold hardware.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-24'), mi_load.ev('S-OFF-14'))));

-- ---------- B11. Стан перебраного мотора ----------

select mi_load.stage('C-130#a', 'bmw', 'var:n63b44o2', 'official_fact', 'high',
  'The Alusil cylinders of this engine cannot be bored to an oversize.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-OFF-16'))));

select mi_load.stage('C-130#b', 'bmw', 'var:n63b44o2', 'specialist_practice', 'medium',
  'After scoring or wear beyond tolerance the options are a used engine, a new block or sleeving with cast iron liners; one documented case in Canada used a 2019 donor engine at 14,500 Canadian dollars plus 16,000 in labour. Restoring the Alusil surface itself exists in Germany and is not available in the former Soviet states.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'value_kind', 'cost',
    'value', '{"currency":"CAD","market":"CA","as_of":"2026-09","used_engine":14500,"labour":16000}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-19'),
      mi_load.ev('S-OWN-32', 'thread:bp-2013791', '{"mileage_km":87000}'::jsonb),
      mi_load.ev('S-OWN-37', 'thread:bmwclub-926858'),
      mi_load.ev('S-SPEC-25'))));

select mi_load.stage('C-131', 'bmw', 'var:n63b44o2', 'specialist_practice', 'medium',
  'Sleeving this engine is done for several reasons: scoring above all, cylinder wear beyond tolerance at high mileage as in a documented case of 0.08 millimetres at 180,000 kilometres, destruction of the block after a rod failure, and reinforcement for a thousand horsepower and beyond, where centrifugally cast flanged iron liners cost about four thousand dollars in labour plus 1,550 for the liners.',
  jsonb_build_object(
    'causal', 'observed_association',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","labour":3995,"liners":1550}'::jsonb,
    'note', 'The owner document claimed that sleeving is done for exactly one reason, which the delta audit judged too narrow.',
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-26'), mi_load.ev('S-SPEC-25'),
      mi_load.ev('S-OWN-37', 'thread:bmwclub-926858'))));

select mi_load.stage('C-132', 'bmw', 'issue:sleeve_liner_risk', 'specialist_practice', 'medium',
  'Sleeving an aluminium block badly introduces its own failures: too little interference, where 0.003 to 0.004 of an inch is required, and poor heat transfer, a warped deck, the wrong piston to liner clearance because aluminium expands about twice as much as iron, a liner that walks as it did in a known ceramic reinforced precedent, poor honing and debris. These show up in the first 10,000 to 30,000 kilometres.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-27'), mi_load.ev('S-SPEC-19'),
      mi_load.ev('S-OWN-37', 'thread:bmwclub-1501368'))));

select mi_load.stage('C-133', 'bmw', 'state:n63_sleeved', 'owner_pattern', 'low',
  'Evidence on how long sleeved examples of this engine last is thin: isolated positive reports of 50,000 kilometres at stage two without oil use or smoke and of 140,000 kilometres after the work, alongside workshop claims of no returns, of hundreds of thousands of kilometres and of half the factory service life. There is no denominator.',
  jsonb_build_object(
    'note', 'The owner document claimed that sleeving solves scoring forever, which is not demonstrated: the causes of scoring remain.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-37', 'thread:bmwclub-926858', '{"mileage_km":50000}'::jsonb),
      mi_load.ev('S-OWN-37', 'thread:bmwclub-1501368', '{"mileage_km":140000}'::jsonb),
      mi_load.ev('S-SPEC-26'), mi_load.ev('S-SPEC-28'))));

select mi_load.stage('C-134', 'bmw', 'state:n63_sleeved', 'calcar_synthesis', 'medium',
  'What reduces the uncertainty around a rebuilt engine is a shop with a record on this engine family, paperwork naming the date, mileage, liners, pistons, rings, bearings, valve stem seals, lines, actuators and warranty, a borescope showing the honing, even compression and leak down figures, no coolant loss, stable oil use over two to three thousand kilometres, normal temperature under load, twenty to thirty thousand kilometres covered since the work, the absence of an undocumented reflash, and a discount for the remaining uncertainty.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-27'), mi_load.ev('S-SPEC-19'),
      mi_load.ev('S-OWN-37', 'thread:bmwclub-926858'))));

select mi_load.stage('C-135', 'bmw', 'state:n63_sleeved', 'calcar_synthesis', 'medium',
  'A sleeved engine combined with an undocumented reflash is a red flag on the market: liners protect against scoring but not against the load placed on the turbochargers, the transmission and the cooling system.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-37', 'thread:bmwclub-926858'),
      mi_load.ev('DOC2', null, null, 'context',
        'The owner document raised this combination as a hypothesis and the delta audit confirmed it.'))));

-- ---------- B12. Передпродажна діагностика ----------

select mi_load.stage('C-140#a', 'bmw', 'chk:n63_borescope', 'specialist_practice', 'high',
  'Borescoping all eight cylinders is the only way to see scoring on these bores without dismantling the engine: it shows the walls, the honing, the piston crowns, valve carbon and traces of coolant, and it does not show the rings, valve stem seals, bearings, turbochargers or the chain. Inspecting only the front cylinders sharply reduces the value of the check.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(
      mi_load.ev('S-SPEC-19'),
      mi_load.ev('S-OWN-32', 'thread:bp-2013791', '{"mileage_km":87000}'::jsonb),
      mi_load.ev('S-OWN-27', 'thread:bf-1434091', '{"mileage_km":151000}'::jsonb),
      mi_load.ev('S-OWN-38', 'thread:bp-2067402'))));

select mi_load.stage('C-140#b', 'bmw', 'chk:n63_borescope', 'calcar_synthesis', 'high',
  'This inspection is mandatory at any mileage, because the damage it looks for is irreversible, costs about a third of the car and is not tied to distance covered.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-SPEC-19'), mi_load.ev('S-OWN-32'))));

select mi_load.stage('C-141', 'bmw', 'chk:n63_compression', 'specialist_practice', 'medium',
  'There are no published factory compression figures for this engine; in practice a spread of up to ten percent between cylinders is accepted, as in a documented case of 195 down to 175 pounds per square inch at 93,000 kilometres, measured with the engine warm and the injectors disabled through the factory diagnostic system. The test does not reveal early scoring or valve stem seals.',
  jsonb_build_object(
    'causal', 'observed_association',
    'value_kind', 'range',
    'value', '{"from":175,"to":195,"unit":"psi"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-39', 'thread:bf-1324037', '{"mileage_km":93000}'::jsonb))));

select mi_load.stage('C-142', 'bmw', 'chk:n63_leak_down', 'specialist_practice', 'medium',
  'A leak down test narrows down where the pressure escapes, whether past the rings, the valves or the head gasket, with up to eight to ten percent taken as the guide figure for a healthy engine; it does not replace the borescope.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'value_kind', 'range',
    'value', '{"from":8,"to":10,"unit":"percent"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-SEARCH'))));

select mi_load.stage('C-143', 'bmw', 'chk:g30_ista_scan', 'specialist_practice', 'high',
  'A full diagnostic scan before purchase reads the fault memory with its history and shadow entries, the wastegate and thermostat adaptations, the misfire counters, the engine control unit reflash counter, the software versions and the history of service counter resets. A memory cleared shortly before the viewing proves nothing.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-02', 'thread:bp-2074062'),
      mi_load.ev('S-OWN-32', 'thread:bp-2013791', '{"mileage_km":87000}'::jsonb))));

select mi_load.stage('C-144#a', 'bmw', 'chk:n63_oil_analysis', 'owner_pattern', 'medium',
  'Oil analysis and cutting the filter open reveal bearing metal and coolant emulsion, and they do not rule out scoring: in a documented Canadian case both were clean while two cylinders were scored.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-32', 'thread:bp-2013791', '{"mileage_km":87000}'::jsonb))));

select mi_load.stage('C-144#b', 'bmw', 'chk:n63_oil_analysis', 'specialist_practice', 'medium',
  'Oil analysis and a cut open filter are used as a supporting check rather than as a substitute for looking inside the cylinders.',
  jsonb_build_object(
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-32', 'thread:bp-2013791', '{"mileage_km":87000}'::jsonb))));

select mi_load.stage('C-145', 'bmw', 'chk:n63_turbo_check', 'specialist_practice', 'medium',
  'Shaft play cannot be felt by hand on this layout without removing the intake, so the practical signs are wastegate fault codes and adaptations, a whistle under part load, smoke on a throttle blip and oil in the charge pipes, with the caveat that an oil film also comes from normal crankcase ventilation.',
  jsonb_build_object(
    'causal', 'plausible_mechanism',
    'note', 'The owner document claimed that oil in the intercooler means a failed turbocharger, which the delta audit judged too categorical.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-02', 'thread:bp-2074062'),
      mi_load.ev('S-OWN-07', 'thread:bp-2017789', '{"mileage_km":93000}'::jsonb),
      mi_load.ev('S-OFF-16'))));

select mi_load.stage('C-146', 'bmw', 'var:n63b44o2', 'calcar_synthesis', 'high',
  'Current health is not remaining life: diagnostics confirm the condition today and say nothing about how long the actuators, cooling lines, pumps, valve stem seals, dampers and evaporator will last. A buyer of this engine is buying a running cost rather than a single risk.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-16'),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('DOC2', null, null, 'context',
        'The owner document raised this as a hypothesis and the delta audit confirmed it.'))));

\o
