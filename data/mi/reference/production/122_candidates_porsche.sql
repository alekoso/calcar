-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 122_candidates_porsche.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- Phase 3 back-loading: кандидати з картки Porsche Cayenne GTS 958.1 MY2013.
-- Правила розщеплення ті самі, що у файлі BMW.

\o /dev/null

-- ---------- B1. Ідентичність ----------

select mi_load.stage('P-001', 'porsche', 'var:m48_02', 'official_fact', 'high',
  'The GTS of this generation was built for model years 2013 and 2014 with the M48.02 4.8 litre V8 rated 420 hp at 6,500 rpm and 515 Nm at 3,500 rpm, a compression ratio of 12.5 to one, a cut out at 6,700 rpm, direct injection, variable valve timing and lift, and an integrated dry sump.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"power_hp":420,"power_rpm":6500,"torque_nm":515,"torque_rpm":3500,"compression_ratio":12.5,"redline_rpm":6700,"unit":"hp"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-01'))));

select mi_load.stage('P-002', 'porsche', 'ver:cayenne_gts_958_1', 'official_fact', 'high',
  'The GTS uses a 3.70 final drive with a 3.27 front ratio against 3.09 and 2.73 on the S, and this shorter gearing rather than the body kit is what gives the version its character.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"gts_final":3.70,"gts_front":3.27,"s_final":3.09,"s_front":2.73,"unit":"ratio"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-01'))));

select mi_load.stage('P-003#a', 'porsche', 'ver:cayenne_gts_958_1', 'official_fact', 'high',
  'The transmission is the eight speed torque converter automatic with automatic stop start.',
  jsonb_build_object(
    'value_kind', 'enum',
    'value', '{"gears":8,"type":"torque converter automatic"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-01'))));

select mi_load.stage('P-003#b', 'porsche', 'var:tr80sd_0c8', 'specialist_practice', 'high',
  'The unit is the Aisin TR-80SD, carried in the group parts system as 0C8.',
  jsonb_build_object(
    'causal', 'unknown',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-01'))));

select mi_load.stage('P-004', 'porsche', 'ver:cayenne_gts_958_1', 'official_fact', 'high',
  'The all wheel drive system is active, using an electronically controlled multi plate clutch driven by a map, and there is no low range.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-01'))));

select mi_load.stage('P-005', 'porsche', 'ver:cayenne_gts_958_1', 'official_fact', 'high',
  'The brakes are 360 and 330 millimetres with six and four piston calipers finished in red, the car weighs 2,085 kg, reaches sixty miles per hour in 5.4 seconds and 261 km/h, and the front track is wider than on the S.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"front_disc_mm":360,"rear_disc_mm":330,"front_pistons":6,"rear_pistons":4,"mass_kg":2085,"zero_to_sixty_s":5.4,"top_speed_kmh":261,"unit":"mm"}'::jsonb,
    'note', 'The press describes these as Turbo brakes; the technical specification gives the same dimensions as the S.',
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-01'))));

select mi_load.stage('P-006', 'porsche', 'vmy:cayenne_gts_us_2013', 'official_fact', 'high',
  'Standard equipment on the GTS is steel springs with adaptive damping and a ride height lowered by about twenty to twenty four millimetres, twenty inch RS Spyder wheels, a sport exhaust, the intake sound pipe and sport seats trimmed in suede; the sport chronograph package and the air suspension are options.',
  jsonb_build_object(
    'value_kind', 'quantity',
    'value', '{"lowered_mm_from":20,"lowered_mm_to":24,"wheel_inch":20,"unit":"mm"}'::jsonb,
    'note', 'One catalogue claims air suspension as standard on this version; that either belongs to the facelift or is an error. A steel sprung car is simpler as it ages.',
    'ev', jsonb_build_array(mi_load.ev('S-P-PRESS-01'), mi_load.ev('S-P-SPEC-02'))));

select mi_load.stage('P-007', 'porsche', 'vmy:cayenne_gts_us_2013', 'official_fact', 'high',
  'The recalls recorded for the model year 2013 Cayenne are fuel gauge software on cars built between 27 May and 10 July 2013, a retaining ring on the pedal shaft covering all cars from 2011 to 2016, and headlight adjustment caps.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"campaign":"AD03","fuel_gauge_from":"2013-05-27","fuel_gauge_to":"2013-07-10"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-02'))));

select mi_load.stage('P-008', 'porsche', 'vmy:cayenne_gts_us_2013', 'official_fact', 'high',
  'The list price was 82,050 dollars plus 975 dollars delivery, and the official economy rating was 15 miles per gallon in town, 21 on the highway and 17 combined.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2013","price":82050,"delivery":975,"city_mpg":15,"highway_mpg":21,"combined_mpg":17}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-03'))));

select mi_load.stage('P-009', 'porsche', 'fam:porsche_m48', 'specialist_practice', 'high',
  'The 4.8 litre V8 built between 2008 and 2014 and the facelift V8 use aluminium silicon bores, which are subject to scoring; the bores cannot be rebored, so repair means sleeving or a new block.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'propagation', 'family_context',
    'note', 'Family context propagation: the bore technology is a property of the engine family documented by an engine builder, so it describes every member built that way.',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-03'))));

-- ---------- B2. Мотор ----------

select mi_load.stage('P-020', 'porsche', 'issue:m48_bore_scoring', 'known_issue', 'medium',
  'Repair shops have seen bore scoring on this generation of V8, while the owner consensus is that it is noticeably rarer than on the previous generation and especially than on the 2008 cars; there are no design features making it more prone, and owners of the GTS and of the related saloon report 160,000 to 240,000 kilometres without it. The frequency is low and the severity is catastrophic.',
  jsonb_build_object(
    'note', 'A clean inspection does not protect against future cold short trip use.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-03'),
      mi_load.ev('S-P-OWN-01', 'thread:rennlist-1274839', '{"mileage_km":240000}'::jsonb),
      mi_load.ev('S-P-PRESS-02'))));

select mi_load.stage('P-021', 'porsche', 'issue:958_coolant_pipes', 'known_issue', 'high',
  'The coolant pipes of this V8 are glued into the thermostat housing and into the distributor under the intake; the adhesive degrades, the joint lets go suddenly, all the coolant is lost and the engine overheats. Failures are documented between 80,000 and 150,000 kilometres, a class action filed in 2018 was dismissed in 2019, aluminium replacement pipes and bolted housings exist, and the work costs 3,500 to 5,500 Canadian dollars at a dealer and 2,000 to 3,500 at an independent workshop.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"CAD","market":"CA","as_of":"2026-09","dealer_from":3500,"dealer_to":5500,"independent_from":2000,"independent_to":3500}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_date('production_date', date '2011-01-01', date '2018-12-31')),
    'note', 'Ask for proof that the pipes were replaced, and do the job preventively when the water pump comes out.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-05'), mi_load.ev('S-P-SPEC-04'),
      mi_load.ev('S-P-LEG-01'), mi_load.ev('S-P-PRESS-02'))));

select mi_load.stage('P-022', 'porsche', 'issue:958_pump_thermostat', 'specialist_practice', 'medium',
  'The water pump and thermostat fail with age between 130,000 and 160,000 kilometres; the thermostat sits behind the pump and both are changed together with the coolant pipes.',
  jsonb_build_object(
    'causal', 'observed_association',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-04'))));

select mi_load.stage('P-023', 'porsche', 'issue:958_aos', 'known_issue', 'medium',
  'When the diaphragm of the air oil separator tears, the crankcase goes under vacuum and the result is white smoke, oil consumption, a whistle, oiled plugs and damaged catalysts; the part sits under the intake, dealer estimates run to several thousand and diaphragm repair kits exist.',
  jsonb_build_object(
    'note', 'Part of the source material concerns other generations, but the design on this V8 is the same. A vacuum test at the oil filler is the practical check.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-06'),
      mi_load.ev('S-P-OWN-02', 'thread:planet9-aos', '{"age_years":10}'::jsonb))));

select mi_load.stage('P-024', 'porsche', 'issue:958_hpfp', 'known_issue', 'medium',
  'The high pressure fuel pump is a weak point of this V8: long cranking, hesitation, the P0087 fault and limp mode, costing a thousand to two and a half thousand dollars.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","from":1000,"to":2500,"fault_code":"P0087"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-07'),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb))));

select mi_load.stage('P-025#a', 'porsche', 'maint:m48_plugs', 'official_fact', 'high',
  'Spark plugs on the naturally aspirated V8 are scheduled every four years or 40,000 miles, against 30,000 miles on the turbocharged engine.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"years":4,"distance":40000,"distance_unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-04'))));

select mi_load.stage('P-025#b', 'porsche', 'maint:m48_plugs', 'owner_practice', 'medium',
  'Coils are replaced on condition, they fail between 100,000 and 130,000 kilometres, and owners change plugs and coils together.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'observed_association',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-02'))));

select mi_load.stage('P-026#a', 'porsche', 'issue:958_cam_bolts', 'official_fact', 'high',
  'The camshaft adjuster bolt recall of June 2017 covers the Cayenne S and Turbo of model year 2011 and the related saloon from 2010 to 2012, and a class action names the same years; the 2013 GTS is not included, an earlier campaign of 2013 covered a subset, and a steel bolt is the updated part.',
  jsonb_build_object(
    'value_kind', 'document_ref',
    'value', '{"recall_id":"17V-368","campaign":"AH08","cayenne_years":[2011,2011],"panamera_years":[2010,2012]}'::jsonb,
    'note', 'Recorded with its boundaries so that the campaign is not transferred to the 2013 GTS.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OFF-05'), mi_load.ev('S-P-LEG-02'), mi_load.ev('S-P-SPEC-08'))));

select mi_load.stage('P-026#b', 'porsche', 'issue:958_cam_bolts', 'known_issue', 'low',
  'Failure of the camshaft adjuster bolts costs brake servo vacuum and damages the valve train; for the 2013 GTS this is not a pattern and is checked only when the area is open anyway, through the P0016 and P0017 faults and the paperwork.',
  jsonb_build_object(
    'note', 'Individual sources write 2011 to 2013 for this V8 without documents behind it.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OFF-05'), mi_load.ev('S-P-SPEC-08'))));

select mi_load.stage('P-027', 'porsche', 'gen:958_1', 'official_fact', 'medium',
  'A campaign of 2015 covering the fuel rail and injectors applies to petrol Cayennes built between March 2011 and May 2012, so a 2013 car built later is not affected.',
  jsonb_build_object(
    'value_kind', 'date_window',
    'value', '{"production_from":"2011-03","production_to":"2012-05"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-PRESS-02'))));

select mi_load.stage('P-028#a', 'porsche', 'var:m48_02', 'calcar_synthesis', 'medium',
  'A healthy example of this engine uses little oil, so noticeable consumption is a symptom of the air oil separator, the valve stem seals or scoring rather than a characteristic of the engine.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-06'), mi_load.ev('S-P-OWN-01'))));

select mi_load.stage('P-028#b', 'porsche', 'maint:m48_oil', 'specialist_practice', 'medium',
  'The oil level is read by the factory procedure with the engine warm, because any other reading produces a figure that cannot be compared with anything.',
  jsonb_build_object(
    'layer', 'specialist',
    'causal', 'plausible_mechanism',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-06'))));

select mi_load.stage('P-029', 'porsche', 'issue:958_oil_leaks', 'owner_pattern', 'medium',
  'Oil leaks at the covers and seals, coil failures between 60,000 and 80,000 miles and corrosion or leaks at the coolant connectors are age related items on this engine.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-02'))));

select mi_load.stage('P-030#a', 'porsche', 'maint:m48_oil', 'official_fact', 'high',
  'The official oil interval is 10,000 miles or one year on a 0W-40 to the manufacturer approval, or a 5W-40 in a hot climate.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"distance":10000,"distance_unit":"mi","months":12,"spec":"A40"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-04'))));

select mi_load.stage('P-030#b', 'porsche', 'maint:m48_oil', 'owner_practice', 'medium',
  'Owners and specialists work to 5,000 to 7,500 miles rather than the factory figure, and documented short intervals are a positive signal on this car.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-04', 'thread:cayenneforums-intervals', '{"age_years":11}'::jsonb))));

-- ---------- B3. Коробка ----------

select mi_load.stage('P-040', 'porsche', 'maint:0c8_atf', 'specialist_practice', 'medium',
  'The manufacturer publishes no interval for the transmission fluid, while specialists change fluid and filter every 50,000 miles and report metal in the fluid by 60,000 miles; the valve body bolts also loosen as the gasket sets.',
  jsonb_build_object(
    'layer', 'specialist',
    'causal', 'observed_association',
    'value_kind', 'interval',
    'value', '{"distance":50000,"distance_unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-01'), mi_load.ev('S-P-SPEC-09'))));

select mi_load.stage('P-041', 'porsche', 'issue:958_valve_body', 'known_issue', 'medium',
  'The known weaknesses are worn valve body spools and lock-up shudder on old fluid, while jerking on the second to third change is more often the transfer case.',
  jsonb_build_object(
    'note', 'Transmission and transfer case must be separated during diagnosis.',
    'ev', jsonb_build_array(mi_load.ev('S-P-PRESS-02'), mi_load.ev('S-P-SPEC-09'))));

select mi_load.stage('P-042', 'porsche', 'var:tr80sd_0c8', 'calcar_synthesis', 'medium',
  'There is no pattern of heavy transmission failure on this car, and the torque of this version is far from the limit of a transmission that also serves the turbocharged car at 700 Nm.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-01'), mi_load.ev('S-P-SPEC-02'))));

-- ---------- B4. Трансмісія ----------

select mi_load.stage('P-050#a', 'porsche', 'issue:958_transfer_case', 'official_fact', 'high',
  'In 2020 the manufacturer extended the transfer case warranty to ten years with no mileage limit for Cayennes of 2011 to 2014 and to seven years for 2015 to 2018 cars and the smaller model, using the wording that long term reliability fell below its standards, and reimbursed earlier repairs; a 2024 lawsuit calls the extension a sham.',
  jsonb_build_object(
    'value_kind', 'interval',
    'value', '{"years_2011_2014":10,"years_2015_2018":7,"mileage_limit":null}'::jsonb,
    'note', 'For a model year 2013 car the extension ran out in 2023.',
    'ev', jsonb_build_array(mi_load.ev('S-P-LEG-03'), mi_load.ev('S-P-PRESS-03'))));

select mi_load.stage('P-050#b', 'porsche', 'issue:958_transfer_case', 'known_issue', 'high',
  'The transfer case of this generation degrades badly enough that the manufacturer extended its warranty across the whole 2011 to 2018 range.',
  jsonb_build_object(
    'applic', jsonb_build_array(
      mi_load.p_date('production_date', date '2011-01-01', date '2018-12-31')),
    'ev', jsonb_build_array(mi_load.ev('S-P-LEG-03'), mi_load.ev('S-P-PRESS-03'))));

select mi_load.stage('P-051#a', 'porsche', 'issue:958_transfer_case', 'known_issue', 'high',
  'The symptoms are judder and snatch under acceleration at low speed, on the second to third change, a grinding feel and clicking; the cause is degradation of the friction additives. Early on, fluid and a calibration cure it, and later the replacement costs five to five and a half thousand dollars, with the actuator available separately.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","from":5000,"to":5500}'::jsonb,
    'note', 'The problem belongs to this phase of the generation and not only to the facelift. Fresh fluid removes the symptom without restoring a worn pack.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-10'), mi_load.ev('S-P-SPEC-11'),
      mi_load.ev('S-P-OWN-05', 'thread:rennlist-1290994', '{"mileage_km":150000}'::jsonb),
      mi_load.ev('S-P-OWN-05', 'thread:6speed-tc-replaced', '{"mileage_km":140000}'::jsonb))));

select mi_load.stage('P-051#b', 'porsche', 'maint:958_tc_fluid', 'specialist_practice', 'high',
  'At an early stage the approved transfer case fluid with a calibration removes the judder, and specialists treat this as the first step before any talk of replacement.',
  jsonb_build_object(
    'layer', 'specialist',
    'causal', 'supported_cause',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-10'), mi_load.ev('S-P-SPEC-11'))));

select mi_load.stage('P-052#a', 'porsche', 'maint:958_tc_fluid', 'official_fact', 'high',
  'The official transfer case fluid interval is sixteen years or 160,000 miles.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"years":16,"distance":160000,"distance_unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-OFF-04'))));

select mi_load.stage('P-052#b', 'porsche', 'maint:958_tc_fluid', 'specialist_practice', 'medium',
  'Specialists and owners change the transfer case fluid every 30,000 to 40,000 miles rather than at the factory interval, and invoices for it are a strong positive signal on this car.',
  jsonb_build_object(
    'layer', 'specialist',
    'causal', 'plausible_mechanism',
    'value_kind', 'range',
    'value', '{"from":30000,"to":40000,"unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-11'))));

select mi_load.stage('P-053#a', 'porsche', 'maint:958_diff_fluid', 'owner_practice', 'medium',
  'Owners say the torque vectoring rear differential likes frequent fluid changes and clatters otherwise; the capacity is one litre for the open differential and two with the lock.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-gts-or-turbo', '{"age_years":11}'::jsonb))));

select mi_load.stage('P-053#b', 'porsche', 'maint:958_diff_fluid', 'official_fact', 'medium',
  'The official rear differential fluid interval is sixteen years or 160,000 miles.',
  jsonb_build_object(
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"years":16,"distance":160000,"distance_unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-12'))));

select mi_load.stage('P-054', 'porsche', 'var:tc_958', 'specialist_practice', 'medium',
  'The clutch of the all wheel drive system is sensitive to different tyres on the two axles.',
  jsonb_build_object(
    'causal', 'supported_cause',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-10'))));

-- ---------- B5. Шасі ----------

select mi_load.stage('P-060#a', 'porsche', 'issue:958_air_strut', 'known_issue', 'medium',
  'Air struts on this generation leak at any corner, typically closer to 200,000 kilometres but sometimes earlier, and the compressor burns out once there is a leak; the original compressor is reported unavailable, remanufactured units are unreliable, and an aftermarket set costs about 3,800 dollars plus about eight hours.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","strut_set":3800,"labour_hours":8}'::jsonb,
    'note', 'On this version the air suspension is an option, so a steel sprung car is the simpler proposition.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-06', 'thread:planet9-249893', '{"mileage_km":200000}'::jsonb),
      mi_load.ev('S-P-SPEC-13'))));

select mi_load.stage('P-060#b', 'porsche', 'issue:958_air_strut', 'owner_practice', 'medium',
  'Owners run an overnight settling test before buying rather than judging the air suspension on a short drive.',
  jsonb_build_object(
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-06', 'thread:planet9-249893', '{"mileage_km":200000}'::jsonb))));

select mi_load.stage('P-061', 'porsche', 'issue:958_pdcc_lines', 'known_issue', 'medium',
  'The active anti roll system corrodes and bursts its braided lines, which cost eighty dollars as a part with weeks of waiting, loses its accumulators, and shares its pump with the power steering at about 1,400 dollars in an awkward location, so replacing only the leaking part invites a repeat; it shows as a chassis system fault with sport mode disabled, and deleting the system is the usual answer once the estimate passes four thousand dollars.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","line":80,"pump":1400,"delete_threshold":4000}'::jsonb,
    'note', 'This option is an open ended risk on an old car without history.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-07', 'thread:planet9-249318', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-SPEC-14'))));

select mi_load.stage('P-062', 'porsche', 'issue:958_pasm_failure', 'owner_pattern', 'low',
  'Damper control failures and damper leaks appear with age and produce a chassis system fault.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-02'))));

select mi_load.stage('P-063#a', 'porsche', 'equip:pccb', 'official_fact', 'medium',
  'A replacement set of ceramic composite brakes costs about twenty thousand dollars, the discs chip, and a retrofit kit exists for the Turbo, the S and the GTS of this phase.',
  jsonb_build_object(
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","replacement_set":20000}'::jsonb,
    'note', 'A positive feature and a risk at the same time.',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-15'))));

select mi_load.stage('P-063#b', 'porsche', 'equip:pccb', 'specialist_practice', 'medium',
  'Ceramic discs are inspected at their edges for chipping, because that is where the damage that condemns them appears first.',
  jsonb_build_object(
    'causal', 'observed_association',
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-15'))));

select mi_load.stage('P-064', 'porsche', 'issue:958_parking_brake', 'owner_pattern', 'medium',
  'The electromechanical parking brake fails at its motors, the anti roll bar bushes and links wear with age, and the 275/45 R20 tyres wear quickly.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-SPEC-16'))));

-- ---------- B6. Електроніка і кузов ----------

select mi_load.stage('P-070', 'porsche', 'issue:958_pcm_faults', 'owner_pattern', 'medium',
  'The infotainment head unit of this phase is slow, freezes and reports a missing amplifier, compact disc changer or telephone, and the seat memory and its end positions have to be relearned.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-08', 'thread:planet9-pcm'),
      mi_load.ev('S-P-OWN-08', 'thread:rennlist-seat-memory'))));

select mi_load.stage('P-071', 'porsche', 'issue:958_weak_battery', 'owner_pattern', 'medium',
  'This car does not tolerate a weak battery: a sagging 92 amp hour absorbent glass mat battery produces phantom faults, so the battery is the first thing to test.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-PRESS-02'))));

select mi_load.stage('P-072', 'porsche', 'maint:958_drains', 'owner_practice', 'medium',
  'The air conditioning and scuttle drains block and put water into the footwells and the modules, so owners clean and shorten them as a matter of course.',
  jsonb_build_object(
    'layer', 'owner',
    'causal', 'supported_cause',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-gts-or-turbo', '{"age_years":11}'::jsonb))));

select mi_load.stage('P-073', 'porsche', 'issue:958_brittle_plastic', 'owner_pattern', 'high',
  'The interior plastics are brittle at the vent sliders, the buttons and the covers, and the cup holders rattle; this is cosmetic.',
  jsonb_build_object(
    'ev', jsonb_build_array(mi_load.ev('S-P-PRESS-02'))));

-- ---------- B7. Володіння і порівняння ----------

select mi_load.stage('P-080', 'porsche', 'ver:cayenne_gts_958_1', 'owner_pattern', 'medium',
  'Real consumption is 12 to 14 miles per gallon in town, about 18 on average and above 20 at best on the motorway, that is 17 to 20, about 13 and 11 to 12 litres per hundred kilometres, on premium fuel.',
  jsonb_build_object(
    'value_kind', 'range',
    'value', '{"city_from":12,"city_to":14,"average":18,"best":20,"unit":"mpg"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-09', 'thread:fuelly-gts'),
      mi_load.ev('S-P-OWN-09', 'thread:pistonheads-mpg'),
      mi_load.ev('S-P-OWN-09', 'thread:rennlist-mileage'))));

select mi_load.stage('P-081', 'porsche', 'ver:cayenne_gts_958_1', 'calcar_synthesis', 'high',
  'CalCar gives no annual running cost figure for this car, because the spread created by the optional air suspension, active anti roll system and ceramic brakes is too wide for one number to mean anything.',
  jsonb_build_object(
    'note', 'The reference card records this atom as a deliberate refusal to state a number, and it carries no sources for that reason.',
    'ev', '[]'::jsonb));

select mi_load.stage('P-082', 'porsche', 'ver:cayenne_gts_958_1', 'owner_practice', 'high',
  'The owner consensus is that service history matters more than mileage on this car, that a pre-purchase inspection by a specialist pays for itself ten times over, and that cars without records are best avoided.',
  jsonb_build_object(
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-02'),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-gts-or-turbo', '{"age_years":11}'::jsonb))));

select mi_load.stage('P-083', 'porsche', 'ver:cayenne_gts_958_1', 'owner_pattern', 'medium',
  'Owners say this version looks, sounds and feels sportier than the turbocharged car and sits lower, that the turbocharged car has lag, that the feel is close to the brand sports car, and that on the sport suspension the handling is close to the turbocharged car.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-10', 'thread:rennlist-turbo-vs-gts'),
      mi_load.ev('S-P-OWN-10', 'thread:6speed-gts-turbo'))));

select mi_load.stage('P-084#a', 'porsche', 'ver:cayenne_gts_958_1', 'official_fact', 'high',
  'The 2013 and 2014 cars of this version are mechanically identical; the real dividing line is between the 2014 car and the 2015 one, which moved to a turbocharged six.',
  jsonb_build_object(
    'value_kind', 'enum',
    'value', '{"identical_years":[2013,2014],"changed_from":2015,"new_engine":"twin turbo V6"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-P-PRESS-04'))));

select mi_load.stage('P-084#b', 'porsche', 'ver:cayenne_gts_958_1', 'owner_pattern', 'high',
  'Owners who have driven both the 2013 and the 2014 car report no difference in power delivery between them.',
  jsonb_build_object(
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-11', 'thread:rennlist-2013-vs-2014'),
      mi_load.ev('S-P-OWN-11', 'thread:rennlist-958-1-or-958-2'))));

\o
