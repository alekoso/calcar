-- MI Catalog, картка 1: кандидати BMW 530i xDrive G30 B48 (B46B20O0), US MY2017-2020.
--
-- Джерело: docs/model-intelligence/reference/bmw-530i-xdrive-g30-b48-my2017-2020.md.
-- Правила ті самі, що у трьох еталонних картках: один атом дає кандидатів
-- по типу знання і по subject, офіційний інтервал і практика власників це
-- різні клейми, числа однієї специфікації з одного документа лишаються
-- одним клеймом. Розщеплення видно у task_ref: 'G-022#a', 'G-022#b'.
--
-- Правило R1 контракту у дії: знання про мотор стоїть на родині B48 або
-- варіанті B46B20O0, про роздатку на проблемі роздатки ATC13-1, яку ця
-- версія ділить з M550i, про кузов і електрику на поколінні G30. Рік
-- обмежує застосовність лише там, де він і є межею: відклик, кампанія,
-- зміна головного пристрою, зміна ревізії мотора.
--
-- Важливість і buyer-текст задаються прямо тут (importance, implication),
-- як у 140_reclassified.sql. Жодне джерело не вигадане і жодне правило
-- gate не послаблене: кандидат, якому доказів бракує, лишається у staging.

\o /dev/null

-- ---------- G1. Ідентичність ----------

select pg_temp.stage('G-001', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'The 530i xDrive G30 sold in the United States for model years 2017 to 2020 is built with the B46B20O0 engine, the North American version of the 2.0 litre twin-scroll turbocharged four, rated at 248 hp between 5,200 and 6,500 rpm and 258 lb-ft, about 350 Nm, between 1,450 and 4,800 rpm.',
  jsonb_build_object(
    'subject_text', '530i xDrive G30 MY2017-2020 US',
    'importance', 4,
    'implication', 'Decides which engine knowledge applies: the B48 family, not the N63 of the M550i; the 2021 facelift engine is a different revision.',
    'value_kind', 'quantity',
    'value', '{"engine_code":"B46B20O0","power_hp":248,"torque_lbft":258,"torque_nm":350,"unit":"hp"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_num('model_year', 2017, 2020, 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-01', null, null, 'supports', 'Engine code B46B20O0, 248 hp at 5,200 to 6,500 rpm, 258 lb-ft at 1,450 to 4,800 rpm.'),
      pg_temp.ev('S-G-OFF-04', null, null, 'context', 'The 2021 car is described with the B48B20O1 at the same 248 hp and 258 lb-ft.'))));

select pg_temp.stage('G-002', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'From the model year 2021 facelift, with first deliveries in July 2020, the 530i uses the B48B20O1 revision at the same 248 hp and 258 lb-ft; the 48 volt mild hybrid of that update went only to the 540i.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A 2021 or later car carries a different engine revision; the engine knowledge of this card stops at model year 2020.',
    'value_kind', 'enum',
    'value', '{"engine_code":"B48B20O1","power_hp":248,"deliveries_from":"2020-07"}'::jsonb,
    'applic', jsonb_build_array(pg_temp.p_num('model_year', 2021, null, 1)),
    'ev', jsonb_build_array(pg_temp.ev('S-G-OFF-04'))));

select pg_temp.stage('G-003', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'The 530i xDrive G30 is built with the ZF 8HP50 eight speed automatic, BMW designation GA8HP50Z, with sport mode and shift paddles as standard equipment.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'The ZF family service knowledge applies through the 8HP50; what is known about the 8HP75 of the M550i does not.',
    'value_kind', 'enum',
    'value', '{"transmission":"ZF 8HP50","bmw_code":"GA8HP50Z","option_code":"2TB"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-01', null, null, 'supports', '8-speed automatic (8HP50) with sport mode and shift paddles standard.'),
      pg_temp.ev('S-G-OFF-02', 'doc:pricing-guide-my2018', null, 'supports', '2TB Sport Automatic Transmission, STD on the 530i xDrive Sedan.'))));

-- Офіційний бюлетень називає родину роздатки (ATX13-x) і відносить до неї
-- G30; номер із дефісом дає лише каталог запчастин.
select pg_temp.stage('G-004', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'medium',
  'The all wheel drive of the G30 uses the ATC13 family transfer case, which BMW bulletins call ATX13-x; parts catalogues list the ATC13-1 for the 530i xDrive.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Drives the transfer case fluid specification and the shudder knowledge shared with the M550i; the exact dash number is a catalogue statement, not a manufacturer one.',
    'value_kind', 'enum',
    'value', '{"transfer_case_family":"ATC13","catalogue_variant":"ATC13-1"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-12', null, null, 'supports', 'Jerking or shuddering from the driveline (xDrive transfer case ATX13-x), models include G30 (5 Series Sedan).'),
      pg_temp.ev('S-G-MKT-01', null, null, 'supports', 'Transfer box ATC13 part numbers for the 2018 BMW 530i xDrive Sedan (G30), DTF 1 fluid.'))));

select pg_temp.stage('G-005', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'The factory figure for nought to sixty is 5.8 seconds with xDrive against 6.0 seconds for the rear drive 530i, the top speed is 130 mph or 155 with the M Sport package, and the xDrive sedan weighs 3,878 lb, 132 lb more than the rear drive car.',
  jsonb_build_object(
    'importance', 2,
    'value_kind', 'quantity',
    'value', '{"zero_to_sixty_s":5.8,"rwd_zero_to_sixty_s":6.0,"top_speed_mph":130,"curb_weight_lb":3878,"rwd_curb_weight_lb":3746,"unit":"lb"}'::jsonb,
    'applic', jsonb_build_array(pg_temp.p_tag('market_sold', 'US')),
    'ev', jsonb_build_array(pg_temp.ev('S-G-OFF-01'))));

select pg_temp.stage('G-006', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'The official United States fuel economy rating of the 2018 530i xDrive is 23 mpg in town, 33 on the highway and 27 combined, that is 10.2, 7.1 and 8.7 litres per hundred kilometres.',
  jsonb_build_object(
    'importance', 2,
    'value_kind', 'quantity',
    'value', '{"city_mpg":23,"highway_mpg":33,"combined_mpg":27,"unit":"mpg"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_num('model_year', 2018, 2018, 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(pg_temp.ev('S-G-OFF-05'))));

select pg_temp.stage('G-007', 'g30_530ix', 'vmy:530ix_us_2018', 'official_fact', 'high',
  'Standard equipment for model year 2018 in the United States includes 18 inch style 634 wheels with 245/45 R18 all-season run-flat tyres, the sport automatic transmission, LED headlights with adaptive light control, navigation, a rear view camera, a moonroof, sport seats, the sixth generation iDrive with a 10.25 inch screen and an oil change interval of 10,000 miles or 12 months.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Adaptive dampers, integral active steering, M Sport brakes and the driver assistance packages are options: check the build sheet before applying option-dependent knowledge.',
    'value_kind', 'option_code',
    'value', '{"codes":["24X","258","2TB","5A2","524","609","3AG","403","481","8KL"],"tyres":"245/45 R18","wheel_style":634}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-02', 'doc:pricing-guide-my2018', null, 'supports', '24X 18 inch double-spoke wheels style 634 with all-season run-flat tires 245/45 R18, 2TB, 5A2, 524, 609, 3AG, 403, 481, 8KL Oil Chg 10,000 mls/12 months: STD on the 530i xDrive Sedan.'),
      pg_temp.ev('S-G-OFF-01', null, null, 'supports', 'Sport design with 18-inch wheels, sport seats, iDrive 6.0 with 10.25-inch screen, LED headlights.'))));

select pg_temp.stage('G-008', 'g30_530ix', 'vmy:530ix_us_2018', 'official_fact', 'high',
  'The model year 2018 United States price list sets the 530i xDrive at 54,700 dollars, 2,300 above the rear drive car, with the Dynamic Handling package ZDH at 1,950 combining Dynamic Damper Control 223, M Sport brakes 2NH, Adaptive Drive 2VA and Integral Active Steering 2VH, the Driving Assistance Plus package ZDB with Active Driving Assistant Plus 5AT, the Luxury Seating package ZLS, the M Sport package ZMP and the Executive package ZPX with the digital instrument cluster 6WB.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Shapes what the options are worth on the used market and which optional hardware can be on the car.',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2017-07","base":54700,"rwd_base":52400,"items":{"ZDH":1950}}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-02', 'doc:pricing-guide-my2018', null, 'supports', '530i xDrive Sedan, start of production 07/2017, base price 54,700; ZDH Dynamic Handling Package 1,950: 223, 2NH, 2VA, 2VH.'))));

select pg_temp.stage('G-009', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'Model year 2020 cars, produced from July 2019, carry the seventh generation iDrive with Live Cockpit Plus as standard and Live Cockpit Professional with the 12.3 inch digital cluster in the Premium package, and Comfort Access became standard on the 530i.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A 2020 car has different head unit hardware and software from the 2017 to 2019 cars; infotainment knowledge does not cross this line.',
    'value_kind', 'option_code',
    'value', '{"codes":["6U2","6U3","322"],"production_from":"2019-07"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_num('model_year', 2020, 2020, 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-03', null, null, 'supports', 'The 2020 5 Series Sedans began production in July 2019; Live Cockpit Plus (6U2) standard, Premium Package with Live Cockpit Professional (6U3), Comfort Access (322) on 530i.'),
      pg_temp.ev('S-G-OWN-10', 'thread:bp-1626021', null, 'context', 'Owners confirm the iDrive 7 head unit and digital cluster from late July 2019 production.'))));

select pg_temp.stage('G-010', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'Model years 2017 to 2019 carry the sixth generation iDrive on the NBT Evo head unit with a 10.25 inch screen.',
  jsonb_build_object(
    'importance', 2,
    'value_kind', 'quantity',
    'value', '{"idrive_generation":6,"head_unit":"NBT Evo","screen_in":10.25,"unit":"in"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_num('model_year', 2017, 2019, 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-01', null, null, 'supports', 'iDrive 6.0 with 10.25-inch screen.'),
      pg_temp.ev('S-G-OFF-03', null, null, 'context', 'The seventh generation arrived with model year 2020.'))));

-- ---------- G2. Відклики і кампанії ----------

select pg_temp.stage('G-011', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'medium',
  'Recall 18V-465 covers 2018 and 2019 530i and 530i xDrive sedans built between 16 May and 13 June 2018: an error in the crankshaft sensor firmware can stop the sensor processing the reluctor ring signal and stall the engine, and dealers replace the sensor.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'On a car built in late spring 2018 check that the sensor recall is closed; a stall is the failure mode.',
    'value_kind', 'document_ref',
    'value', '{"recall_id":"18V465","production_from":"2018-05-16","production_to":"2018-06-13"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', date '2018-05-16', date '2018-06-13', 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-06', null, null, 'supports', 'An updated firmware level of the crankshaft sensor semiconductor contained an error which could lead to a processing failure of the input from the crankshaft reluctor ring; on September 5, 2018 BMW upgraded the emissions recall to a safety recall for gasoline engine vehicles.'),
      pg_temp.ev('S-G-OFF-17', null, null, 'supports', 'Recall 18V465000 is listed for the 2018 BMW 530i.'),
      pg_temp.ev('S-SEARCH', null, null, 'context', 'Third party summaries give the affected production range as May 16 to June 13, 2018; the primary report read here carries the chronology and the model list but not the dates.'),
      pg_temp.ev('S-G-OWN-06', 'thread:bp-1851182', null, 'context', 'A California 530i owner mentions the fuel pump sensor recall being done.'))));

select pg_temp.stage('G-012', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'Three software recalls concern the rear view camera: 19V-684 for 2018 to 2020 cars whose display settings could hide the image, 20V-598 for 2020 cars with a partly obscured image and 21V-096 for 2019 to 2021 cars whose screen might not show the image; all three are dealer software updates.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Check that the campaigns are closed; they cost nothing and say nothing about the hardware.',
    'value_kind', 'document_ref',
    'value', '{"recall_ids":["19V684","20V598","21V096"]}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_num('model_year', 2018, 2020, 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-07'), pg_temp.ev('S-G-OFF-08'), pg_temp.ev('S-G-OFF-17'))));

select pg_temp.stage('G-013', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'Recall 20V-243 covers 2017 cars whose driver and passenger head airbag inflators were exposed to excessive humidity before assembly and may not deploy properly; dealers replace the affected head airbag.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Confirm completion by VIN on a 2017 car.',
    'value_kind', 'document_ref',
    'value', '{"recall_id":"20V243"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_num('model_year', 2017, 2017, 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(pg_temp.ev('S-G-OFF-09'), pg_temp.ev('S-G-OFF-17'))));

-- xDrive-специфічний відклик: subject це версія xDrive, тому на 530i з
-- заднім приводом він не потрапляє.
select pg_temp.stage('G-014', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'Recall 21V-046 covers about four 2020 and 2021 530i xDrive and 540i xDrive sedans built between 29 May and 26 June 2020 whose left rear output shaft, GKN part 8664049, may have missed its heat treatment time and could break with a loss of drive; the shaft is replaced.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Applies to xDrive cars only and to a handful of build dates; a VIN lookup settles it.',
    'value_kind', 'document_ref',
    'value', '{"recall_id":"21V046","production_from":"2020-05-29","production_to":"2020-06-26","part":"8664049","vehicles":4}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', date '2020-05-29', date '2020-06-26', 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-10', null, null, 'supports', 'Approximately 4 vehicles have been assembled with a left output shaft that may not have been produced to specifications; production dates May 29, 2020 to June 26, 2020; component part number 5 Series left 8664049; supplier GKN Driveline.'))));

select pg_temp.stage('G-015', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'Recall 25V-636 of September 2025 covers 2020 to 2022 530i and 530i xDrive sedans built between 12 June 2019 and 23 June 2021, about 22,800 cars: water can corrode the relay of the Valeo engine starter 8671503, which can then fail to start the engine or overheat and catch fire even with the car parked and switched off; BMW asks owners to park outside until a starter of a different design is fitted, with owner letters from 14 November 2025.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'On a model year 2020 car check by VIN whether the starter has been replaced; an open recall with no parts means a fire risk that BMW itself calls a reason to park outside.',
    'value_kind', 'document_ref',
    'value', '{"recall_id":"25V636","production_from":"2019-06-12","production_to":"2021-06-23","part":"8671503","vehicles":22804}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', date '2019-06-12', date '2021-06-23', 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-11', null, null, 'supports', '2020-2022 BMW 5 Series, 530i and 530i xDrive, production dates Jun 12, 2019 to Jun 23, 2021, 22,804 vehicles; water could contact the starter electrical relay and lead to corrosion; in an extreme case this could cause a thermal event when the vehicle is parked and the ignition is off; consumer advisories: do not drive, park outside; engine starter part 8671503, Valeo.'),
      pg_temp.ev('S-G-OFF-17', null, null, 'supports', 'Recall 25V636000 is listed for the 2020 BMW 530i.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11724573', '{"age_years":6}'::jsonb, 'context', 'A 2020 530i owner reports the car catching fire while driving in March 2026 with no warning smoke.'))));

-- ---------- G3. Роздатка і трансмісія ----------

-- Знання про роздатку стоїть на наявній проблемі роздатки ATC13-1
-- (еталонна картка M550i): бюлетень відносить до неї усі xDrive G30.
select pg_temp.stage('G-016', 'g30_530ix', 'issue:g30_xdrive_shudder', 'known_issue', 'high',
  'BMW bulletin 27 02 20 of May 2020 acknowledges jerking or shuddering from the driveline of the ATX13 transfer case on the G30 and other xDrive models when cornering or pulling away at low speed under light load, without any warning lamp or check control message. The named causes are unevenly worn or wrongly sized tyres, or factory-filled transfer case oil that does not meet specification; the remedy is a DTF-1 oil change with recalibration of the transfer case module, after which the clutch plates need up to 125 miles to saturate before the shudder fades.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A shudder in tight turns is first a fluid and tyre question, not a transfer case replacement; the procedure is a warranty item on cars still covered.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SIB 27 02 20","run_in_miles":125,"fluid":"DTF-1"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-12', null, null, 'supports', 'Situation: jerking or shuddering during cornering or accelerating from low speeds, driving with low to medium loads, no warning lights. Cause: unevenly worn or incorrect fitment tires, or the factory-filled transfer case oil does not meet BMW specifications. Procedure: oil change with DTF-1 and recalibration of the VTG; up to 125 miles for the new oil to saturate the clutch plates.'),
      pg_temp.ev('S-G-SPEC-06', null, null, 'supports', 'A fluid change with BMW DTF-1 and a software recalibration is the first and most common fix; if this fails, a replacement is necessary.'))));

select pg_temp.stage('G-017', 'g30_530ix', 'maint:atc13_fluid', 'official_fact', 'high',
  'The transfer case takes DTF-1, part 83 22 2 409 710, about 0.7 litre filled to the lower edge of the filler opening, with a new filler plug 33 11 7 525 064 tightened to 60 Nm and a recalibration of the transfer case module through the diagnostic system.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Any fluid other than DTF-1, or a change without the recalibration, is not the manufacturer procedure.',
    'layer', 'official',
    'value_kind', 'quantity',
    'value', '{"fluid":"DTF-1","part":"83222409710","capacity_l":0.7,"plug_part":"33117525064","plug_torque_nm":60,"unit":"l"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-12', null, null, 'supports', 'Use DTF-1 P/N 83 22 2 409 710 (0.7 liter); replace the oil filler plug P/N 33 11 7 525 064, tighten to 60 Nm; re-calibrate the VTG using ISTA.'),
      pg_temp.ev('S-G-OWN-13', 'thread:bp-1700544', null, 'supports', 'Transfer box: DTF 1 75W GL-4, BMW part 83222409710, capacity 0.7 L.'),
      pg_temp.ev('S-G-MKT-01', null, null, 'supports', 'DTF 1 transmission fluid 83222409710, 1000 ml, listed for the 2018 530i xDrive transfer box.'))));

select pg_temp.stage('G-018', 'g30_530ix', 'maint:atc13_fluid', 'owner_pattern', 'medium',
  'Two independent owner reports on G30 xDrive cars describe changing the transfer case, front and rear differential fluids themselves at about 60,000 miles and again around 75,000 miles, with 0.7 litre of DTF-1 in the transfer case, 0.8 litre of 75W-85 GL-4 in the rear differential and 0.6 litre of 75W-85 GL-5 in the front, and found the fluids and plugs in acceptable condition.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Owners treat the driveline fluids as 60,000 mile items despite the lifetime label; records of these changes are worth asking for.',
    'layer', 'owner',
    'value_kind', 'quantity',
    'value', '{"transfer_case_l":0.7,"rear_diff_l":0.8,"front_diff_l":0.6,"unit":"l"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-13', 'user:frozen-fractals', '{"mileage_km":120000}'::jsonb, 'supports', 'Capacities quoted: transfer box DTF 1 0.7 L, rear differential G1 75W85 GL-4 0.8 L, front differential G2 75W85 GL-5 0.6 L.'),
      pg_temp.ev('S-G-OWN-08', 'user:frozen-fractals', '{"mileage_km":120000}'::jsonb, 'supports', '2018 540i xDrive at 75,000 miles: oil changes, transmission fluid, transfer box fluid, front and rear differential fluid changes done by the owner.'),
      pg_temp.ev('S-G-OWN-14', 'thread:bp-2095206', '{"mileage_km":97000}'::jsonb, 'supports', '2021 540i xDrive at about 60,000 miles: spark plugs, front and rear differential fluid, transfer case fluid and transmission fluid with pan; fluids and plugs looked fine.'))));

-- Знання ZF про масло стоїть у корпусі на позиції обслуговування 8HP75
-- (C-080) з поширенням на ревізії 8HP75, тому 8HP50 воно не дістає. Для
-- 8HP50 та сама практика виробника коробки і майстерень стає окремим
-- клеймом на власній позиції обслуговування; джерела ті самі плюс нова
-- майстерня.
select pg_temp.stage('G-045', 'g30_530ix', 'maint:zf8hp50_atf', 'specialist_practice', 'medium',
  'The transmission manufacturer treats the fluid of the 8HP50 as a service item and sets the first change at roughly 150,000 km, sooner under heat and load, against the vehicle manufacturer calling it a lifetime fill; workshops in hot climates change it between 50,000 and 70,000 miles with the pan and its integrated filter, using only the approved fluid and setting the level at 40 to 50 degrees Celsius, and describe shudder on acceleration, harsh low gear upshifts and delayed engagement as the signs of old fluid.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A car past 100,000 km with no transmission service in the records is asking for a fluid and filter change before anything else is judged.',
    'layer', 'specialist',
    'causal', 'plausible_mechanism',
    'value_kind', 'interval',
    'value', '{"km_first_change_manufacturer":150000,"miles_workshop_from":50000,"miles_workshop_to":70000,"level_temp_c_from":40,"level_temp_c_to":50}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-03', null, null, 'supports', 'ZF designates the fill maintenance-free but still recommends changing it at about 150,000 km, sooner under heat and load; our practical first service window is roughly 50,000 to 70,000 miles; shudder on acceleration, harsh 1-2 or 2-3 upshifts, delayed engagement and clunking into first gear appear before warning lights.'),
      pg_temp.ev('S-SPEC-13', null, null, 'supports', 'Workshop article contrasting the BMW lifetime fluid claim with the ZF service interval.'))));

-- ---------- G4. Обслуговування мотора ----------

select pg_temp.stage('G-019', 'g30_530ix', 'maint:b46_oil', 'official_fact', 'high',
  'The factory maintenance schedule for the United States sets the engine oil and filter change at 10,000 miles or 12 months, whichever comes first, coded 8KL on the price list.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'This is the warranty interval, not a specialist recommendation.',
    'layer', 'official',
    'value_kind', 'interval',
    'value', '{"miles":10000,"months":12}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-02', 'doc:pricing-guide-my2018', null, 'supports', '8KL Oil Chg 10,000 mls/12 months, STD.'))));

select pg_temp.stage('G-020', 'g30_530ix', 'maint:b46_oil', 'specialist_practice', 'medium',
  'Workshops specify 0W-20 oil to BMW Longlife-14 FE+ or Longlife-17 FE+ for the B46 and recommend changing it every 5,000 miles, or at most every 10,000 to 15,000 km, because the thin oil and the long factory interval are what wear the chain guides and the turbocharger.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Service records with intervals near 10,000 miles on short-trip use are a reason to inspect, not a reassurance.',
    'layer', 'specialist',
    'causal', 'plausible_mechanism',
    'value_kind', 'interval',
    'value', '{"miles":5000,"km_max":15000,"specification":"BMW Longlife-17 FE+ 0W-20"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-13', null, null, 'supports', 'The B46 uses a very thin oil, a 0W20 with either LL14 or LL17 formulas; our oil change recommendation is 5,000 miles.'),
      pg_temp.ev('S-G-SPEC-05', null, null, 'supports', 'Long oil intervals of 30,000 km wear the guides prematurely; change oil every 10,000 to 15,000 km maximum.'),
      pg_temp.ev('S-G-SPEC-04', null, null, 'supports', 'Timing chain wear on the B48 can occur if oil changes are extended excessively.'))));

select pg_temp.stage('G-021', 'g30_530ix', 'maint:b46_plugs', 'owner_pattern', 'medium',
  'Owners change the spark plugs at about 60,000 miles with the factory NGK plug SILZKGR8E8S at its factory gap of 0.7 mm without re-gapping; one owner chasing a rough idle changed plugs and coils at 39,000 miles and the idle cleared.',
  jsonb_build_object(
    'importance', 2,
    'layer', 'owner',
    'value_kind', 'part_number',
    'value', '{"part":"SILZKGR8E8S","gap_mm":0.7,"interval_miles":60000}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-17', 'thread:bp-2024681', '{"mileage_km":96000}'::jsonb, 'supports', 'OEM spark plugs come with a 0.7 mm gap; at 60k it is time to renew the plugs with the stock gap; do not gap iridium plugs.'),
      pg_temp.ev('S-G-OWN-17', 'thread:bp-2116229', '{"mileage_km":63000}'::jsonb, 'supports', 'Changed plugs at 39K while chasing a rough idle; new plugs and coils fixed it. The OEM NGK plug SILZKGR8E8S is listed for B46, B48, B58TU and S58.'))));

-- ---------- G5. Система охолодження: корпус масляного фільтра ----------

select pg_temp.stage('G-022#a', 'g30_530ix', 'issue:b48_oil_filter_housing', 'known_issue', 'medium',
  'The plastic oil filter housing of the B46 and B48 family cracks or its coolant insert deforms with age: workshops describe coolant leaking down the block onto the left engine mount, sometimes only as a slow loss that needs topping up, and in the worst case coolant in the oil. Independent specialists replace the housing routinely, one describing dozens of aluminium conversions, a class action filed in February 2026 names the B46, B48 and B58 housings of 2014 to 2021 cars, and BMW bulletin 11 10 25 of December 2025 acknowledges the coolant insert deforming under the housing seal on the later B46D and B48P engines and introduces a redesigned insert.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Budget the housing as a likely repair past 60,000 miles and inspect the area under the intake before buying; an aluminium replacement in the records removes the risk.',
    'value_kind', 'document_ref',
    'value', '{"bulletin_later_engines":"SIB 11 10 25","lawsuit":"Eiger v. BMW of North America, D.N.J., 2026-02-16"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-01', null, null, 'supports', 'The plastic oil filter housing serves as a junction point for coolant passages; coolant can either leak externally or seep internally into the engine oil; the housing typically fails around 55,000 miles; we have installed this upgrade on dozens of B48 engines.'),
      pg_temp.ev('S-G-SPEC-02', null, null, 'supports', 'Oil filter housing: when gaskets fail you may see both coolant and oil leaks; everything under the intake gets cooked by heat; one of the most common issues we see on newer BMWs with B46, B48 and B58 engines.'),
      pg_temp.ev('S-G-LEG-01', null, null, 'supports', 'The polycarbonate oil filter housings allegedly become embrittled due to repeated heating and cooling cycles, causing internal wall structures to fail or warp and sealing gaskets to fail, resulting in loss of engine coolant; 2014-2021 BMW 1 to 5 Series, X1 to X4 and MINI with the B46, B48 and B58.'),
      pg_temp.ev('S-G-OFF-13', null, null, 'context', 'Only listed vehicles with the B46D, B48P or XB1G four-cylinder engines: the seal for the oil filter housing could exert excessive pressure to the bushing/insert, deform it and create an external coolant leak; replace the gaskets and the redesigned bushing.'),
      pg_temp.ev('S-G-OWN-01', 'thread:bp-2051536', '{"mileage_km":193000}'::jsonb, 'supports', '2017 530i at 120,000 miles: coolant dripping rapidly while parked, plastic oil filter housing with a cracked coolant passage missing a piece of the lip; intake manifold removal required; saved about 3,000 dollars against the dealer.'),
      pg_temp.ev('S-G-OWN-03', 'thread:bf-1466668', '{"mileage_km":180000}'::jsonb, 'supports', '2019 530i xDrive at 112,000 miles: coolant appearing beside the oil drain plug after ten minutes of running, traced to the oil filter housing gasket; housing and gaskets replaced.'),
      pg_temp.ev('S-G-OWN-02', 'thread:bp-2144791', '{"mileage_km":137000}'::jsonb, 'supports', '2018 530i bought at 36,000 miles: oil filter housing replaced in December 2023 after turbo coolant lines and reservoir, then upper radiator hose, radiator and water pump housing gasket by 85,000 miles.'),
      pg_temp.ev('S-G-OWN-05', 'thread:bf-1403683', '{"mileage_km":97000}'::jsonb, 'supports', 'B48 at 60,000 miles: coolant leak, cracked housing with a broken o-ring lip, about 3,000 dollars at the dealer; 2017 330i owners between 54,000 and 94,000 miles at 2,000 to 3,000 dollars, one housing failed twice.'))));

select pg_temp.stage('G-022#b', 'g30_530ix', 'issue:b48_oil_filter_housing', 'owner_pattern', 'medium',
  'Four independent reports on G30 530i and 330i cars with this engine put the housing failure between 54,000 and 120,000 miles: a 2017 530i at 120,000, a 2019 530i xDrive at 112,000, a 2018 530i at about 85,000 and 2017 330i owners between 54,000 and 94,000; dealers quoted 2,000 to 3,000 dollars, the labour needs the intake manifold off, and one owner had the housing fail twice.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Budget the housing as a likely repair past 60,000 miles and inspect the area under the intake before buying; an aluminium replacement in the records removes the risk.',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2024-05","from":2000,"to":3000,"scope":"dealer replacement of the oil filter housing"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-01', 'thread:bp-2051536', '{"mileage_km":193000}'::jsonb, 'supports', '2017 530i at 120,000 miles, housing cracked; dealer repair on a B58 quoted at 2,400 dollars.'),
      pg_temp.ev('S-G-OWN-03', 'thread:bf-1466668', '{"mileage_km":180000}'::jsonb, 'supports', '2019 530i xDrive at 112,000 miles, housing gasket, owner repair.'),
      pg_temp.ev('S-G-OWN-02', 'thread:bp-2144791', '{"mileage_km":137000}'::jsonb, 'supports', '2018 530i, housing replaced in December 2023 on the way to 85,000 miles.'),
      pg_temp.ev('S-G-OWN-05', 'thread:bf-1403683', '{"mileage_km":97000}'::jsonb, 'supports', 'B48 at 60,000 miles about 3,000 dollars at the dealer; 2017 330i owners at 54,000 to 94,000 miles, 2,000 to 3,000 dollars, one repeat failure.'),
      pg_temp.ev('S-G-SPEC-15', null, null, 'context', 'Failures commonly reported between 60,000 and 100,000 miles; replacement is a 6 to 9 hour job requiring removal of the intake manifold.'))));

-- ---------- G6. Система охолодження: лінії турбіни, бачок, помпа, вентиляційна трубка ----------

select pg_temp.stage('G-023', 'g30_530ix', 'issue:b46_turbo_coolant_lines', 'owner_pattern', 'medium',
  'Two independent reports on 2018 530i cars describe leaking turbocharger coolant lines, one at 58,000 miles and one on a four year old car that afterwards lost the reservoir, its hoses, the oil filter housing, the upper radiator hose, the radiator and the water pump gasket one after another by 85,000 miles.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Coolant residue on the underbody shield behind the engine is worth a look; the lines are cheap next to the housing.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-04', 'thread:bf-1472082', '{"mileage_km":93000}'::jsonb, 'supports', 'Thread title: 2018 BMW 530i, 58K miles, turbo coolant lines leaking.'),
      pg_temp.ev('S-G-OWN-02', 'thread:bp-2144791', '{"age_years":4}'::jsonb, 'supports', '2018 530i: turbo coolant lines in September 2022, then the coolant reservoir, the return hose, the reservoir cap, the Y hose, the oil filter housing, the upper radiator hose, the radiator and the water pump housing gasket.'))));

select pg_temp.stage('G-024', 'g30_530ix', 'issue:g30_expansion_tank', 'owner_pattern', 'medium',
  'Owners of G30 cars with the four and six cylinder engines, which share one expansion tank part, report the tank cracking at 45,000 miles and at 80,000 km and the vent hose between tank and engine breaking at 28,500 miles on a 2019 530i xDrive, with the low coolant warning as the first sign; that hose repair cost 1,140 dollars at a dealer, which BMW later reimbursed under what the owner was told is an extension of the hose warranty to 10 years or 120,000 miles, a document this card could not find.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Ask the dealer to check for vent hose coverage by VIN before paying for the repair.',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2024-08","hose_repair_dealer":1140}'::jsonb,
    'note', 'The issue is anchored on the B48 engine family rather than the generation: the four and six cylinder G30 share the expansion tank part 17139846642 and the N63 uses another, and a family predicate would read as unknown on the V8 instead of excluding it.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-26', 'user:540iSUP', '{"mileage_km":72000}'::jsonb, 'supports', 'G30 540i at 45,000 miles: expansion tank crack and turbo lines, low coolant warning every three days, covered by the dealer.'),
      pg_temp.ev('S-G-OWN-26', 'user:MustafaNajmiKhan', '{"mileage_km":80000}'::jsonb, 'supports', 'G30 540i at 80,000 km: crack in the expansion tank, 285 Canadian dollars plus tax.'),
      pg_temp.ev('S-G-OWN-22', 'thread:bf-1471499', '{"mileage_km":46000}'::jsonb, 'supports', '2019 530xi at 28,500 miles: critical coolant leak warning, the vent hose from the auxiliary coolant reservoir to the engine had broken; 140 dollars parts plus 1,000 labour at the dealer, later reimbursed by BMW; the owner was told the warranty on the 5 Series expansion tank breathing hose had been extended to 10 years or 120,000 miles.'),
      pg_temp.ev('S-G-OWN-02', 'thread:bp-2144791', '{"mileage_km":137000}'::jsonb, 'supports', '2018 530i: coolant reservoir leaking, return hose, reservoir cap and Y hose under the reservoir replaced.'),
      pg_temp.ev('S-G-MKT-04', null, null, 'context', 'One expansion tank part, 17139846642, is listed for the G30 530i and 540i; the N63 M550i uses a different tank.'))));

select pg_temp.stage('G-025', 'g30_530ix', 'issue:b48_water_pump', 'owner_pattern', 'low',
  'One owner report on a 2018 530i places a leaking water pump housing gasket at about 85,000 miles, after the turbocharger lines, the reservoir and the oil filter housing had already been replaced; parts suppliers place pump failures between 20,000 and 80,000 miles with a leak at the weep hole as the first sign, and no recall exists.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Include the pump weep hole and housing joint in the cooling inspection.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-02', 'thread:bp-2144791', '{"mileage_km":137000}'::jsonb, 'supports', '2018 530i: water pump housing gasket replaced in November 2024 at about 85,000 miles.'),
      pg_temp.ev('S-G-SPEC-16', null, null, 'supports', 'Failures reported from 20,000 to over 80,000 miles, a common point around 50,000; leaks from the weep hole; no active recall.'),
      pg_temp.ev('S-G-SPEC-18', null, null, 'context', 'Average water pump replacement on the 330i between 938 and 1,154 dollars.'))));

select pg_temp.stage('G-026#a', 'g30_530ix', 'issue:b48_head_vent_line', 'official_fact', 'high',
  'BMW service action 17 01 21 replaces the cylinder head coolant vent line, whose quick disconnect coupling breaks at the head because the plastic cannot handle the temperature over the life of the part, on F22, F23 and F30 to F36 cars with the B46 and B48 built between 24 April 2015 and 24 September 2019; the G30 is not in the action, and dealer catalogues list a different hose part for it.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Do not expect the free vent line replacement on a G30; the failure mode of the same engine family is still worth an inspection.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SIB 17 01 21","part_f_chassis":"17129845173","part_g30_catalogue":"17129844478","production_from":"2015-04-24","production_to":"2019-09-24"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-14', null, null, 'supports', 'This Service Action involves F22, F23, F30, F31, F32, F33, F34 and F36 vehicles produced from April 24, 2015 to September 24, 2019; the quick disconnect coupling on the cylinder head coolant vent line could break at the cylinder head; the coolant line cannot handle excessive high temperatures over the lifetime of the part; part 17 12 9 845 173.'),
      pg_temp.ev('S-G-MKT-02', null, null, 'supports', 'BMW 530iX hose, cylinder head to expansion tank, part 17129844478 (supersedes 17128602600).'),
      pg_temp.ev('S-G-OWN-20', 'thread:bp-1889354', null, 'context', 'F30 and F32 owners describe the coupling snapping on the highway and rapid overheating, replaced free under the action.'))));

select pg_temp.stage('G-026#b', 'g30_530ix', 'issue:b48_head_vent_line', 'owner_pattern', 'low',
  'One G30 owner remark says the coolant bypass line from the block fails often on the B46; no independent G30 report with mileage was found, while F30 owners of the same engine describe the coupling breaking with sudden coolant loss.',
  jsonb_build_object(
    'importance', 2,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-09', 'thread:bf-1416639', null, 'supports', 'B46 engine coolant leaks and heat management concerns; the coolant bypass line from the block fails a lot.'),
      pg_temp.ev('S-G-OWN-18', 'thread:bf-1431511', '{"mileage_km":48000}'::jsonb, 'context', '2018 330i: the hard coolant line broke and was replaced with a revised part under a recall; another B46 owner at 30,000 miles topped up coolant twice before the line was swapped.'),
      pg_temp.ev('S-G-SPEC-08', null, null, 'context', 'The coolant vent line between head and tank cracks and leaks coolant rapidly.'))));

-- ---------- G7. Мотор: вентиляція картера, патрубок наддуву, натягувач, нагар, ланцюг, ТНВД ----------

select pg_temp.stage('G-027', 'g30_530ix', 'issue:b48_pcv_diaphragm', 'owner_pattern', 'low',
  'Parts supplier articles describe the crankcase ventilation diaphragm in the B46 and B48 valve cover tearing around 100,000 km, with a whistle at idle and rising oil consumption, and the whole valve cover replaced; no independent 530i owner report was found.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A whistle at idle on the test drive is a valve cover, not a turbocharger.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-07', null, null, 'supports', 'The PCV valve integrated into the valve cover can tear, creating a whistling noise at idle and high oil consumption; the entire cover assembly must usually be replaced.'),
      pg_temp.ev('S-G-SPEC-05', null, null, 'supports', 'Valve cover gasket and PCV valve: whistling noise at idle and high oil consumption around 100,000 km.'),
      pg_temp.ev('S-G-SPEC-04', null, null, 'supports', 'Valve cover gasket leaks at 70,000 to 100,000 miles.'))));

select pg_temp.stage('G-028', 'g30_530ix', 'issue:b48_charge_pipe', 'owner_pattern', 'low',
  'Aftermarket suppliers sell aluminium charge pipes for the B46 and B48 on the argument that the plastic factory pipe or its coupler cracks with age and boost, giving a loud pop, a sudden loss of power and a drivetrain malfunction message; no independent 530i owner report with mileage was found.',
  jsonb_build_object(
    'importance', 2,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-05', null, null, 'supports', 'Charge pipe: loud pop while driving, total loss of power, check engine light; aluminium replacement kits exist.'),
      pg_temp.ev('S-G-SPEC-04', null, null, 'context', 'Plastic charge pipes are prone to failure as the plastic ages or if boost increases.'))));

select pg_temp.stage('G-029', 'g30_530ix', 'issue:b48_belt_tensioner', 'owner_pattern', 'low',
  'A parts supplier describes a rattle at idle from the accessory belt tensioner on B46 and B58 engines that quietens when the plastic housing is pressed and that carries the alternator, the coolant pump and the compressor on one belt; no bulletin and no independent 530i report was found.',
  jsonb_build_object(
    'importance', 2,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-11', null, null, 'supports', 'A rattling or chirping noise from the front of the engine at idle, most noticeable on a cold start, that goes away with slight pressure on the tensioner housing; no recalls or bulletins as of mid 2024.'))));

select pg_temp.stage('G-030', 'g30_530ix', 'issue:b48_intake_carbon', 'specialist_practice', 'low',
  'Tuning shops recommend walnut blasting the intake valves of this direct injection engine every 80,000 to 100,000 km against carbon build-up that shows as cold start misfires, rough idle and a dulled throttle; no primary workshop source with its own cases was found.',
  jsonb_build_object(
    'importance', 2,
    'causal', 'plausible_mechanism',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-04', null, null, 'supports', 'The B48 is prone to carbon build-up on the intake valves; walnut blasting every 50,000 to 60,000 miles.'),
      pg_temp.ev('S-G-SPEC-05', null, null, 'supports', 'Carbon build-up on the intake valves around 80,000 km.'),
      pg_temp.ev('S-G-OWN-14', 'thread:bp-2095206', null, 'context', 'One owner recommends intake valve cleaning at four to five years.'))));

select pg_temp.stage('G-031', 'g30_530ix', 'issue:b48_timing_chain', 'owner_pattern', 'low',
  'No pattern of timing chain failure was found on 2017 to 2020 G30 530i cars: the reliability threads carry no such report, tuning guides say the chain is not the structural risk of the N20 and that builds before 2017 were improved, and a chain kit vendor describes the symptoms without failure figures; the absence of reports is not proof of reliability.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A cold start rattle is still worth a listen, but it is not the reason to walk away that it is on the N20.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-07', 'thread:bp-2072367', null, 'supports', 'No horror stories when researching G30 reliability threads; the B48 is considered a better engine than the N20.'),
      pg_temp.ev('S-G-OWN-06', 'thread:bp-1851182', null, 'supports', 'No timing chain report among 2018 530i owners.'),
      pg_temp.ev('S-G-SPEC-04', null, null, 'context', 'Timing chain wear is not the structural failure risk that the N20 chain represented.'),
      pg_temp.ev('S-G-SPEC-14', null, null, 'context', 'Symptoms listed as startup rattle and rough idle, no build years and no failure figures.'),
      pg_temp.ev('S-G-AGG-02', null, null, 'context', 'The technical update introduced a one-part timing chain instead of the earlier two-part chain.'))));

select pg_temp.stage('G-032', 'g30_530ix', 'issue:b46_hpfp', 'known_issue', 'low',
  'An aggregator lists high pressure fuel pump failure with misfires, hesitation and stalling among the problems of the G30 530i; no owner report, bulletin or recall for the petrol pump of this engine was found.',
  jsonb_build_object(
    'importance', 2,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-AGG-01', null, null, 'supports', 'High-pressure fuel pumps can fail, leading to engine misfires, rough idling, hesitation during acceleration and even stalling.'))));

select pg_temp.stage('G-033', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'The NHTSA recall record for the 2017 to 2020 530i contains no fuel system, cooling system or engine mechanical campaign: the campaigns are 20V-243 for 2017, 18V-465 and 19V-684 for 2018, 19V-684 for 2019, and 19V-684, 20V-598, 21V-096, 21V-046 and 25V-636 for 2020.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Lists of common problems that imply pump or injector campaigns are not backed by the official record.',
    'value_kind', 'document_ref',
    'value', '{"recalls":{"2017":["20V243"],"2018":["18V465","19V684"],"2019":["19V684"],"2020":["19V684","20V598","21V096","21V046","25V636"]},"as_of":"2026-09-14"}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_num('model_year', 2017, 2020, 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-17', null, null, 'supports', 'Recalls by model year for make bmw model 530i: 2017 one, 2018 two, 2019 one, 2020 five, none of them fuel or cooling related.'),
      pg_temp.ev('S-G-AGG-01', null, null, 'contradicts', 'The aggregator lists high pressure fuel pump and injector failures as common problems of the 530i.'))));

-- ---------- G8. Продовження гарантії ----------

-- Джерело S-OFF-13 з еталонної картки M550i: той самий бюлетень.
select pg_temp.stage('G-034', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'The wastegate actuator warranty extension to fifteen years or 150,000 miles in bulletin 01 07 21 covers the G30 530e and 530e xDrive with the XB1H engine built from February 2017 to June 2020 and does not cover the 530i xDrive with the B46.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Do not promise the buyer this cover; a wastegate actuator fault on the 530i is a paid repair out of warranty.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SIB 01 07 21","covered":"G30 530e and 530e xDrive, XB1H, 2017-02 to 2020-06"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-OFF-13', null, null, 'supports', 'Limited warranty extension for the turbocharger wastegate valve actuator to 15 years or 150,000 miles: G30 2018 to 2020 530e Sedan and 530e xDrive Sedan (XB1H), February 2017 to June 2020.'))));

select pg_temp.stage('G-035', 'g30_530ix', 'issue:g30_air_flaps', 'official_fact', 'high',
  'BMW extended the warranty on the front grille upper and lower active air flaps to fifteen years or 150,000 miles from the original in-service date, bulletin 01 12 19, for G30 cars including the 530i xDrive sedans built between 3 November 2016 and 18 June 2019, the 530i sedans built to 11 June 2019 and the 2018 to 2019 M550i xDrive: a faulty upper flap actuator or lower flap assembly sets an air flap control fault and the check engine lamp; damage from road debris is excluded, and for 2017 cars registered in the California emission states the same coverage applies as emission-related.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'An air flap control fault on a United States car built before mid 2019 is a free repair until 2031 to 2034; a debris-damaged flap is not.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SIB 01 12 19","production_from":"2016-11-03","production_to":"2019-06-18","years":15,"miles":150000}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', date '2016-11-03', date '2019-06-18', 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-15', null, null, 'supports', 'G30 2017 to 2019 530i xDrive Sedan, November 3, 2016 to June 18, 2019, B46O; the radiator grille upper and lower active air flaps limited warranty is extended to 15 years/150,000 miles as determined from the original in-service date; air flap issues caused by debris or blockage from outside influences are not a defect.'),
      pg_temp.ev('S-G-OWN-25', 'thread:bp-2004635', null, 'supports', 'G30 owners with the lower grille stuck open and clicking had the repair covered under the 15 year, 150,000 mile extension; a 2019 540xi at 23,000 miles logged grille shutter and cruise control codes.'),
      pg_temp.ev('S-G-OWN-16', 'thread:bf-1411186', null, 'context', 'A 2017 530i xDrive owner names the front intake vent flaps as the one known weakness, with the warranty extended to 15 years or 150,000 miles.'))));

select pg_temp.stage('G-036', 'g30_530ix', 'ver:530ix_g30', 'official_fact', 'high',
  'BMW extended the warranty of the evaporative leak diagnosis module, the NVLD with its hose, to fifteen years or 150,000 miles from the original in-service date for 530i and 530i xDrive sedans built between 11 October 2016 and 26 June 2020, bulletin 01 09 21, because the module material can fail over time and set an evaporative system fault.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'An evaporative system fault with the check engine lamp is a free repair on a United States car until 2031 to 2035.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SIB 01 09 21","production_from":"2016-10-11","production_to":"2020-06-26","years":15,"miles":150000}'::jsonb,
    'applic', jsonb_build_array(
      pg_temp.p_date('production_date', date '2016-10-11', date '2020-06-26', 1),
      pg_temp.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-16', null, null, 'supports', 'G30 2017 to 2020 530i xDrive Sedan, October 11, 2016 to June 26, 2020, B46O/D: the NVLD limited warranty is extended to 15 years/150,000 miles as determined from the original in-service date; over time the leak diagnosis module component material may fail.'))));

-- ---------- G9. Кузов, електрика, шасі покоління ----------

select pg_temp.stage('G-037', 'g30_530ix', 'issue:g30_seat_mat', 'owner_pattern', 'medium',
  'Eleven owner complaints filed with NHTSA on 2018 5 Series cars between 2023 and 2025 and three forum owners describe the passenger restraint system malfunction warning with the passenger airbag switched off, traced to the seat occupancy mat; dealers quoted 1,800 to 3,200 dollars, and some replaced the mat under the certified pre-owned warranty after escalation.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A restraint warning on the test drive is a two thousand dollar item and a disabled airbag, not a sensor glitch.',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2025-01","from":1800,"to":3200,"scope":"dealer replacement of the passenger seat occupancy mat"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-12', 'odi:11697612', '{"age_years":7}'::jsonb, 'supports', 'Passenger seat occupancy sensor faulty causing restraint system malfunction and seat belt warning.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11669239', '{"age_years":6}'::jsonb, 'supports', 'It keeps coming up with the error message passenger restraint system malfunction.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11654120', '{"age_years":7}'::jsonb, 'supports', 'The seatbelt and passenger seat fail to recognize a passenger is occupying the seat and turn off the airbag.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11652985', '{"age_years":6}'::jsonb, 'supports', 'Passenger restraint system light stays on.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11648020', '{"age_years":7}'::jsonb, 'supports', 'An airbag light and a malfunction error read that the passenger restraint system has malfunctioned.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11641549', '{"age_years":5}'::jsonb, 'supports', 'Constantly pops up a message for passenger restraint system malfunction.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11634477', '{"age_years":7}'::jsonb, 'supports', 'Passenger restraint system malfunction, described on forums as a common problem on these vehicles.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11634005', '{"age_years":7}'::jsonb, 'supports', 'The passenger restraint system malfunction warning comes on randomly; the seat belt light comes on with a wallet on the seat.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11605584', '{"age_years":6}'::jsonb, 'supports', 'Passenger restraint system malfunction.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11604742', '{"age_years":6}'::jsonb, 'supports', 'Four wheel drive and passenger restraint warnings appeared after parking.'),
      pg_temp.ev('S-G-OWN-12', 'odi:11603633', '{"age_years":6}'::jsonb, 'supports', 'With a passenger in the front seat the airbag is disabled.'),
      pg_temp.ev('S-G-OWN-11', 'user:steve090619', null, 'supports', 'Passenger restraint system malfunction warning and airbag off light, sensor mat failure, 2,700 dollars out of warranty.'),
      pg_temp.ev('S-G-OWN-11', 'user:dscabra', null, 'supports', 'Pressure pad in the seat bottom, 2,700 dollars, covered by the certified pre-owned warranty.'),
      pg_temp.ev('S-G-OWN-11', 'user:grubssin', null, 'supports', 'Seat occupancy mat defect, more than 2,000 dollars, covered after escalation.'),
      pg_temp.ev('S-G-SPEC-10', null, null, 'context', 'A frequent complaint on G30 forums is an intermittent passenger restraint system malfunction warning; quotes of 2,130 to 3,500 dollars.'))));

select pg_temp.stage('G-038', 'g30_530ix', 'issue:g30_ac_evaporator', 'owner_pattern', 'medium',
  'On the four and six cylinder G30 the same evaporator failure is reported as on the V8: a 2018 540i xDrive had the evaporator replaced under warranty at 38,500 miles, and a 2017 530i owner at 60,000 miles had the air conditioning repaired under a manufacturer campaign and otherwise called the car the most trouble-free he had owned.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Check the service history for an evaporator or air conditioning campaign entry: it is the most expensive non-engine repair on this generation.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-15', 'user:NGT2', '{"mileage_km":62000}'::jsonb, 'supports', '2018 540i xDrive at 38,500 miles: steering column sticking, rear window shade switch, ambient light failure, air conditioning evaporator replacement, all under warranty.'),
      pg_temp.ev('S-G-OWN-16', 'thread:bf-1411186-19', '{"mileage_km":97000}'::jsonb, 'supports', '2017 530i at 60,000 miles: the air conditioning issue was resolved by a campaign, otherwise the most bullet-proof vehicle owned.'),
      pg_temp.ev('S-G-REV-01', null, null, 'context', 'A 2018 530i owner reported climate control blowing hot air from an evaporator leak.'))));

select pg_temp.stage('G-039', 'g30_530ix', 'issue:g30_tension_strut', 'owner_pattern', 'medium',
  'Two independent G30 540i owners had the front tension strut hydraulic bushings replaced at 25,000 and 30,000 miles for noises under braking and a loose feel over bumps, with cracks visible only under load; the bushing is a generation part shared by the 530i xDrive, although the arm itself differs between rear and all wheel drive cars.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Knocks under braking on the test drive point here first; budget the pair of arms.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-23', 'user:CarlosM4', '{"mileage_km":48000}'::jsonb, 'supports', '2018 540i at 30,000 miles: random noises during braking and after steering; tension strut bushing deterioration; noise gone after replacement.'),
      pg_temp.ev('S-G-OWN-23', 'user:eric_gm', '{"mileage_km":40000}'::jsonb, 'supports', 'G30 540i at 25,000 miles: slight loose feeling over bumps; thrust arm bushings with cracks visible only under stress; both arms replaced.'),
      pg_temp.ev('S-G-SPEC-09', null, null, 'context', 'The large fluid-filled bushings are the weak point; the part differs between rear wheel drive and xDrive models.'),
      pg_temp.ev('S-G-OWN-08', 'thread:bp-1834317', null, 'context', 'At 80,000 to 100,000 miles you start replacing control arms and bushings.'))));

select pg_temp.stage('G-040', 'g30_530ix', 'issue:g30_nbt_evo_hdd', 'owner_pattern', 'low',
  'Two G30 owners, a 2017 530i and a 2018 car, describe navigation stuck loading and Bluetooth media dead with fault B7F853 after an aerosol was sprayed into the vents, cured by fitting a new drive to the head unit and initialising it remotely for about 100 dollars, against a dealer quote of 3,000 dollars for a complete unit.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A dead navigation on a 2017 to 2019 car is not always a 3,000 dollar unit.',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2023-11","remote_initialisation":100,"dealer_unit":3000}'::jsonb,
    'applic', jsonb_build_array(pg_temp.p_num('model_year', 2017, 2019, 1)),
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-24', 'user:mhrxn', '{"age_years":6}'::jsonb, 'supports', '2017 530i: fault B7F853, navigation stuck loading, Bluetooth audio and CarPlay dead after a disinfectant spray in the vents.'),
      pg_temp.ev('S-G-OWN-24', 'user:jfirko', '{"age_years":5}'::jsonb, 'supports', '2018 G30: same symptoms after a vent deodoriser; residue on the board; drive replaced with a 240 GB SSD and initialised remotely for 100 dollars.'),
      pg_temp.ev('S-G-SPEC-12', null, null, 'context', 'The mechanical drives in NBT and NBT EVO head units are a known failure point; heat and vibration cause reboot loops and freezing.'))));

-- ---------- G10. Ревізії мотора, які документ виробника не підтверджує ----------

select pg_temp.stage('G-041', 'g30_530ix', 'var:b46b20o0', 'official_fact', 'medium',
  'The B46B20O0 is the B48B20O0 built to the North American SULEV emission standard, with the same block, head, turbocharger and output; the differences named by technicians are the catalytic converter, the exhaust connection and evaporative emission parts, and an authoritative list of them was not found.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Engine knowledge gathered on B48 cars applies to this engine unless it concerns the exhaust or evaporative hardware.',
    'value_kind', 'enum',
    'value', '{"engine_code":"B46B20O0","base_variant":"B48B20O0","standard":"SULEV"}'::jsonb,
    'note', 'The press release that names the engine code is deliberately not cited here: it names the code and does not establish the equivalence, so citing it would let a context citation satisfy the official source rule.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OWN-21', 'thread:bp-1702754', null, 'supports', 'B46 is the B48 engine but with SULEV parts for emissions regulations; most US cars are B46, the rest of the world is B48.'),
      pg_temp.ev('S-G-SPEC-17', null, null, 'supports', 'The stock B46 and B48 have the same power and torque output; the differences are speculated to be the catalytic converter, fuel lines and emission parts.'))));

select pg_temp.stage('G-042', 'g30_530ix', 'var:b48b20o1', 'official_fact', 'medium',
  'The technical update B48B20O1 of 2018 to 2019 raised injection pressure from 200 to 350 bar with a new pump and injectors, replaced the two-part timing chain with a one-piece chain, separated the cooling circuits of the head and the block and lightened the crankshaft.',
  jsonb_build_object(
    'importance', 2,
    'value_kind', 'quantity',
    'value', '{"injection_pressure_bar":350,"previous_injection_pressure_bar":200,"unit":"bar"}'::jsonb,
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-AGG-02', null, null, 'supports', 'Non-TU: Bosch HDEV5 200 bar; TU: Bosch HDEV6 350 bar; new one-part timing chain instead of the earlier two-part; separate cooling circuits for the cylinder head and crankcase; crankshaft 1 kg lighter.'),
      pg_temp.ev('S-G-SPEC-04', null, null, 'supports', 'The technical update improved the crankshaft, raised injection pressure to 350 bar and revised the piston rings.'))));

-- ---------- G11. Синтез CalCar ----------

-- Опори підставляються після публікації звичайних клеймів у
-- 131_synthesis_bmw_530i.sql; тут синтез лише стає у staging.
select pg_temp.stage('G-043', 'g30_530ix', 'fam:b48', 'calcar_synthesis', 'high',
  'The cooling system of this engine family ages by components rather than failing once: the vent line, the turbocharger lines, the expansion tank and its hose, the plastic oil filter housing and the belt-driven pump, roughly in that order of cost, and most of them sit under the intake or behind the engine where a look from above shows nothing. A pre-purchase inspection of this car is therefore a cooling inspection under the intake with the covers off, and a history of replaced cooling parts is a good sign, not a bad one.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Treat coolant top-ups in the history as a symptom and replaced cooling parts as a benefit.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-SPEC-02', null, null, 'supports', 'Everything under the intake gets cooked by heat; replace the hoses, fittings and gaskets around the heater management module together.'),
      pg_temp.ev('S-G-OWN-02', 'thread:bp-2144791', '{"mileage_km":137000}'::jsonb, 'supports', 'A 2018 530i lost nine cooling components one after another between 60,000 and 85,000 miles.'))));

select pg_temp.stage('G-044', 'g30_530ix', 'ver:530ix_g30', 'calcar_synthesis', 'high',
  'What the market knows about the M550i of the same body does not transfer to this car: the N63 knowledge about bore scoring, wastegate actuators, valve stem seals and oil consumption belongs to another engine family, while the transfer case shudder, the tension strut bushings, the evaporator, the seat occupancy mat and the parasitic battery drain are shared G30 knowledge. The risks of the 530i xDrive itself are the plastic cooling components of the B46 and the recalls on the starter and the crankshaft sensor.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Do not price this car with V8 fears or V8 confidence.',
    'ev', jsonb_build_array(
      pg_temp.ev('S-G-OFF-01', null, null, 'supports', 'The 530i is the B46B20O0 four cylinder; the M550i is a different engine.'),
      pg_temp.ev('S-G-OFF-12', null, null, 'supports', 'The transfer case bulletin covers every xDrive G30 regardless of engine.'))));

\o
