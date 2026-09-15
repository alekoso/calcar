-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 126_candidates_hyundai_tucson.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- MI Catalog, картка 3: кандидати Hyundai Tucson TL 2.4 GDI Theta II, US MY2018-2021.
--
-- Джерело: docs/model-intelligence/reference/hyundai-tucson-tl-24-gdi-my2018-2021.md.
-- Правила ті самі, що у картках 1 і 2: один атом дає кандидатів по типу
-- знання і по subject, розщеплення видно у task_ref ('H-064#a').
--
-- Компонентне правило картки: сфера ПРЯМОГО доказу і сфера ТЕХНІЧНОЇ
-- застосовності розділені. Знос шатунних підшипників, KSDS, заміна мотора
-- і витрата оливи стоять на варіанті мотора Theta II 2.4 GDI і доходять до
-- кожного року, де цей мотор стоїть, а текст клейма каже, де саме знання
-- спостережене. Гарантійні продовження TXXC і TXXI стоять на праві з
-- предикатами версії, року (2018..2019) і стану права: бюлетені кажуть
-- «certain 2018-2019», тому на конкретному VIN це CONDITIONAL, доки дилер
-- не подивиться VIN. Корінна причина відклику 17V-226 (стружка після
-- механообробки на заводі в Алабамі) НЕ переноситься на мотори Tucson TL.
--
-- Прямої вставки опублікованого знання немає; override не використовується.

\o /dev/null

-- ---------- H1. Ідентичність ----------

select mi_load.stage('H-001', 'tucson_tl_24', 'ver:tucson24', 'official_fact', 'high',
  'The EPA lists the United States Tucson of model years 2018 to 2021 with a 2.4 litre four cylinder direct injection engine and a six-speed automatic, as separate front-wheel drive and all-wheel drive entries in every year; for model year 2022 the Tucson FWD is listed only with a 2.5 litre engine and an eight-speed automatic.',
  jsonb_build_object(
    'subject_text', 'Tucson TL 2.4 GDI US MY2018-2021',
    'importance', 2,
    'implication', 'A US Tucson with the 2.4 engine exists only from 2018 to 2021, in front or all-wheel drive; a 2022 or later Tucson is a different car and none of this card applies to it.',
    'value_kind', 'quantity',
    'value', '{"displacement_l":2.4,"transmission":"S6","drives":["FWD","AWD"],"model_years":[2018,2019,2020,2021],"next_generation_2022":"2.5 L S8","unit":"L"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-01', null, null, 'supports', '2018 Tucson FWD: displ 2.4, Automatic (S6), Front-Wheel Drive, SIDI.'),
      mi_load.ev('S-H-OFF-02', null, null, 'supports', '2018 Tucson AWD: Auto (S6), 4 cyl, 2.4 L.'),
      mi_load.ev('S-H-OFF-03', null, null, 'supports', '2019 Tucson FWD: Auto (S6), 4 cyl, 2.4 L.'),
      mi_load.ev('S-H-OFF-04', null, null, 'supports', '2019 Tucson AWD: displ 2.4, Automatic (S6), All-Wheel Drive, SIDI.'),
      mi_load.ev('S-H-OFF-05', null, null, 'supports', '2020 Tucson FWD: Auto (S6), 4 cyl, 2.4 L.'),
      mi_load.ev('S-H-OFF-06', null, null, 'supports', '2020 Tucson AWD: Auto (S6), 4 cyl, 2.4 L.'),
      mi_load.ev('S-H-OFF-07', null, null, 'supports', '2021 Tucson FWD: Auto (S6), 4 cyl, 2.4 L.'),
      mi_load.ev('S-H-OFF-08', null, null, 'supports', '2021 Tucson AWD: Auto (S6), 4 cyl, 2.4 L.'),
      mi_load.ev('S-H-OFF-09', null, null, 'context', '2022 Tucson FWD: Auto (S8), 4 cyl, 2.5 L as the only entry.'))));

select mi_load.stage('H-002', 'tucson_tl_24', 'ver:tucson24', 'official_fact', 'medium',
  'The launch specification of the 2018 Tucson lists only the 2.0 litre and the 1.6 litre turbo engines, while the EPA entry for the 2018 Tucson 2.4 was created in November 2017, and NHTSA complaint VINs of model year 2018 carry the 2.4 engine code; the 2.4 engine was therefore added during model year 2018.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A 2018 Tucson 2.4 is a late 2018 car and rarer than a 2019 to 2021 one; a 2018 listing that says 2.4 should be confirmed by the eighth VIN character.',
    'value_kind', 'document_ref',
    'value', '{"epa_created":"2017-11-10","epa_vehicle":39728,"launch_spec_engines":["2.0 GDI","1.6 T-GDI"]}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2018, 2018, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-12', null, null, 'supports', '2018 TUCSON Specifications. ENGINE SE/SEL/SEL Plus Type 2.0L DOHC ... Value/Limited Type 1.6L Turbo-GDI.'),
      mi_load.ev('S-H-OFF-01', null, null, 'supports', 'year 2018, model Tucson FWD, displ 2.4, createdOn 2017-11-10.'),
      mi_load.ev('S-H-OWN-01', 'odi:11695832', '{"age_years":7}'::jsonb, 'context', 'VIN KM8J33AL9JU: eighth character L, tenth character J for model year 2018.'))));

select mi_load.stage('H-003', 'tucson_tl_24', 'var:theta2_24_gdi', 'official_fact', 'high',
  'The Tucson 2.4 engine is the Theta 2.4 GDI: four cylinders, DOHC with dual continuously variable valve timing, aluminium block and head, bore 88 mm and stroke 97 mm, 2,359 cc, compression 11.3 to 1, 181 hp at 6,000 rpm and 175 lb-ft at 4,000 rpm, with a six-speed automatic and front-wheel drive standard or all-wheel drive optional on every 2019 trim.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'The same 2.4 GDI block family as the Sonata and Santa Fe Sport engines of the Theta II campaigns; component knowledge about it applies across those cars, coverage decisions do not.',
    'value_kind', 'quantity',
    'value', '{"cc":2359,"bore_mm":88,"stroke_mm":97,"compression":11.3,"hp":181,"hp_rpm":6000,"torque_lbft":175,"torque_rpm":4000,"unit":"cc"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-11', null, null, 'supports', '2.4L Type Theta 2.4 GDI 4-cylinder, DOHC Dual Continuously Variable Valve Timing (D-CVVT) Materials Aluminum block and head Bore & stroke 88 X 97 Compression ratio 11.3:1 Displacement 2.4 liters / 2359 cc Horsepower 181 @ 6,000 rpm Torque (lb-ft) 175 @ 4,000 rpm. Drive Type FWD S, AWD O.'))));

select mi_load.stage('H-004', 'tucson_tl_24', 'ver:tucson24', 'official_fact', 'high',
  'The NHTSA decoder reads the eighth VIN character of the Tucson TL as the engine: L decodes as 2.4 GDI Theta II, 4 as 2.0 GDI Nu and 2 as 1.6 T-GDI Gamma; in the patterns decoded the sixth character C returns four-wheel drive and 3 returns 4x2.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'The VIN settles whether the car is a 2.4 or a 2.0 before any Theta II knowledge is applied; a listing that says 2.4 on a VIN with a 4 in eighth place is a 2.0 Nu car with different warranty programs.',
    'value_kind', 'enum',
    'value', '{"vin_position_8":{"L":"2.4 GDI Theta II","4":"2.0 GDI Nu","2":"1.6 T-GDI Gamma"},"vin_position_6":{"C":"4WD","3":"4x2"}}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-10', null, null, 'supports', 'KM8J33AL: 2.4, GDI Theta II, 4x2. KM8J3CAL: 2.4, GDI Theta II, 4WD/4-Wheel Drive/4x4. KM8J33A4: 2, GDI Nu, 4x2. KM8J3CA4: 2, GDI Nu, 4WD. KM8J33A2: 1.6, T-GDI GAMMA, 4x2. Plant country SOUTH KOREA.'))));

-- ---------- H2. Гарантія і покриття ----------

select mi_load.stage('H-010', 'tucson_tl_24', 'ver:tucson24', 'official_fact', 'high',
  'The Hyundai Powertrain Limited Warranty of 10 years or 100,000 miles applies to the original owner only for model year 2004 and newer cars; second and subsequent owners have powertrain components covered only under the 5 year or 60,000 mile New Vehicle Limited Warranty, and vehicles in commercial use are excluded.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A used Tucson 2.4 bought from anyone but the first owner has no 10 year engine warranty; outside the Theta II extensions the engine is covered only inside 5 years and 60,000 miles, which a 2018 to 2021 car has mostly left behind by 2026.',
    'value_kind', 'interval',
    'value', '{"powertrain_years":10,"powertrain_miles":100000,"powertrain_holder":"original owner","subsequent_owner_years":5,"subsequent_owner_miles":60000}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-14', null, null, 'supports', 'Coverage applies to original owner only, effective with 2004 model year and newer model-year vehicles. Second and/or subsequent owners have powertrain components coverage under the 5-Year/60,000-Mile New Vehicle Limited Warranty. Excludes coverage for vehicles in commercial use.'))));

select mi_load.stage('H-011', 'tucson_tl_24', 'ver:tucson24', 'official_fact', 'high',
  'The Theta II engine class settlement (case 8:17-cv-00838) covers 2018 and certain 2019 Tucson cars originally equipped with or replaced with a genuine Theta II 2.0 or 2.4 GDI engine; a 2019 car is in the class only if it was built before the knock sensor detection system was incorporated in production. The class is owners and lessees who bought or leased the car in the United States, excluding purchases in US territories or abroad, and excludes buyers of cars previously deemed a total loss; the lifetime warranty is not available to commercial entities such as used car dealers or auction houses.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Only 2018 and early 2019 Tucson 2.4 cars bought in the United States by a consumer belong to the settlement; a salvage car or a car bought abroad is outside it, whatever the engine history.',
    'value_kind', 'document_ref',
    'value', '{"case":"8:17-cv-00838-JLS-JDE","court":"C.D. Cal.","tucson_model_years":["2018","certain 2019"],"my2019_boundary":"built before KSDS incorporated in production"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2018, 2019, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-LEG-01', 'doc:theta-settlement', null, 'supports', 'Class Vehicles ... 2014-2015, 2018, and certain 2019 Hyundai Tucson vehicles equipped with or replaced with a genuine Theta II 2.0 liter or 2.4 liter gasoline direct injection engine within OEM specifications. For 2019 model year vehicles, the Class shall include those vehicles that were manufactured before the Knock Sensor Detection System technology was incorporated into their production. All owners and lessees of a Class Vehicle who purchased or leased the Class Vehicle in the United States ... excluding those purchased in the U.S. territories and/or abroad. Excluded: consumers or businesses that have purchased Class Vehicles previously deemed a total loss (i.e., salvage).'),
      mi_load.ev('S-H-LEG-02', 'doc:theta-settlement', null, 'supports', 'The Lifetime Warranty shall not apply or be available to commercial entities such as used car dealers, franchisees, or automobile auction houses.'))));

select mi_load.stage('H-012', 'tucson_tl_24', 'ent:tucson_theta_ext', 'official_fact', 'high',
  'Warranty extension TXXC covers engine long block repair or replacement for damage from connecting rod bearing wear for 10 years or 120,000 miles from original retail delivery or first use, for original and subsequent owners, on certain 2018 and 2019 Tucson TL cars with the Theta II 2.4 GDI; every claim needs a Hyundai prior approval, and since April 2022 the campaign T3G procedure no longer requires the knock sensor software campaign 953 first and accepts P1326, abnormal noise or a no crank condition.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'On a qualifying 2018 or 2019 car a bearing failure inside 10 years and 120,000 miles is repaired by Hyundai even for a second owner; which VIN qualifies only the dealer lookup shows.',
    'value_kind', 'interval',
    'value', '{"code":"TXXC","tsb":"22-EM-002H-1","years":10,"miles":120000,"owners":"original and subsequent","prior_approval":true}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_ref('version', 'ver:tucson24', 1),
      mi_load.p_num('model_year', 2018, 2019, 2),
      mi_load.p_ref('entitlement_state', 'ent:tucson_theta_ext', 3)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-18', null, null, 'supports', 'The warranty coverage for engine long block repair or replacement regarding engine damage or malfunction from connecting rod bearing wear has been extended to 10 years or 120,000 miles from the date of original retail delivery or date of first use, whichever occurs first. Warranty coverage is valid for original and subsequent owners. Certain 2018-2019 MY Tucson (TL) vehicles with Theta II 2.4L GDI engines.'),
      mi_load.ev('S-H-OFF-17', null, null, 'supports', 'The T3G Service Procedure TSB (# 22-01-033H or latest) Flowchart has been revised to remove KSDS prerequisite (Service Campaign 953) and includes conditions of Check Engine warning lamp illuminated with DTC P1326 and/or abnormal noise or no crank/no start condition related to connecting rod bearing wear or damage.'),
      mi_load.ev('S-H-OFF-20', null, null, 'context', 'TSB 21-01-002H, 2.4L / 2.0L Turbo engine warranty extension (TXXC): Certain 2018-2019 MY Tucson (TL) vehicles with 2.4L engines.'))));

select mi_load.stage('H-013', 'tucson_tl_24', 'ver:tucson24', 'official_fact', 'high',
  'No Theta II program lists the 2020 or 2021 Tucson 2.4: campaign T3G, extensions TXXC and TXXI and the settlement stop at certain 2019 Tucson TL cars, while the 15 year or 150,000 mile extension TXXM with campaigns T6G and 966 lists 2016 to 2021 Tucson TL cars with the Nu 2.0 GDI engine only.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A 2020 or 2021 Tucson 2.4 has only the standard Hyundai warranty for its engine; the 15 year extension quoted for 2020 and 2021 Tucsons belongs to the 2.0 engine and does not transfer to the 2.4.',
    'value_kind', 'document_ref',
    'value', '{"theta_programs":["T3G","TXXC","TXXI","953"],"nu_programs":["TXXM","T6G","966"],"nu_scope":"2016-2021 Tucson TL Nu 2.0L GDI"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2020, 2021, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-17', null, null, 'supports', 'Applicable vehicles T3G, TXXC and TXXI: Certain 2014-2015 MY Tucson (LM) vehicles with Theta II 2.4L GDI engines; Certain 2018-2019 MY Tucson (TL) vehicles with Theta II 2.4L GDI engines.'),
      mi_load.ev('S-H-OFF-23', null, null, 'supports', 'TXXM/T6G Applicable Vehicles: Certain 2016-2021 MY Tucson (TL) vehicles with Nu 2.0L GDI engines.'),
      mi_load.ev('S-H-OFF-22', null, null, 'supports', 'TSB 22-01-023H-1: Adding 2019-21MY Tucson (TL) ... Special Exception Cases: 2019-21MY Tucson (TL) 2.0L.'),
      mi_load.ev('S-H-OFF-24', null, null, 'context', 'After installation of the KSDS update (Service Campaign 966), the Powertrain Limited Warranty coverage ... will be extended by Hyundai to 15 years or 150,000 miles ... salvaged vehicles are ineligible.'))));

select mi_load.stage('H-014', 'tucson_tl_24', 'ent:tucson_theta_ext', 'official_fact', 'high',
  'Warranty extension TXXI is the limited lifetime warranty of the Theta II settlement for the same certain 2018 and 2019 Tucson TL 2.4 cars: it covers the short block (block, crankshaft and bearings, connecting rods and bearings, pistons) for bearing wear or damage irrespective of mileage, duration of ownership or prior warranty engine repairs and replacements, but it requires the knock sensor detection software campaign 953, excludes exceptional neglect, cars previously deemed a total loss and commercial owners, and from 150,000 miles and 8 years in service lets Hyundai buy the car back at Bluebook value or pay 2,000 dollars instead of replacing the engine.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'The lifetime coverage raises the value of a clean title qualifying 2018 or 2019 car bought in the United States; it is void for a salvage or rebuilt car and for a car without the 953 software, and an old high mileage engine may be settled with 2,000 dollars instead of a new one.',
    'value_kind', 'document_ref',
    'value', '{"code":"TXXI","tsb":"22-EM-001H-1","term":"limited lifetime","requires":"campaign 953","excludes":["exceptional neglect","total loss","commercial entities"],"buyout_from_miles":150000,"buyout_from_years":8,"cash_alternative_usd":2000}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_ref('version', 'ver:tucson24', 1),
      mi_load.p_num('model_year', 2018, 2019, 2),
      mi_load.p_ref('entitlement_state', 'ent:tucson_theta_ext', 3)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-19', null, null, 'supports', 'Extended to a Limited Lifetime Warranty and is valid for original and subsequent owners. This warranty extension is provided as part of a related court-approved class action settlement and involves certain requirements relating to completion of the knock sensor detection software update (service campaign 953), certain vehicle neglect, vehicles previously deemed a total loss (i.e., branded or salvage), and ownership by certain commercial entities. Certain 2018-2019 MY Tucson (TL) vehicles with Theta II 2.4L GDI engines.'),
      mi_load.ev('S-H-LEG-01', 'doc:theta-settlement', null, 'supports', 'The extension of the warranty will cover the short block assembly, consisting of the engine block, crankshaft and bearings, connecting rods and bearings, and pistons ... the Limited Warranty shall otherwise endure for bearing wear or damage irrespective of the Class Vehicle mileage, duration of ownership, or prior warranty engine repairs and/or warranty replacements.'),
      mi_load.ev('S-H-LEG-02', 'doc:theta-settlement', null, 'supports', 'For Class Vehicles that may otherwise need a new engine pursuant to this warranty at or above 150,000 miles and more than eight (8) years from the original in-service date, Defendants shall have the option ... to either (i) repurchase the vehicle at Bluebook value or (ii) pay the owner $2,000.00 in lieu of an engine replacement, provided that the owner has installed the KSDS.'))));

-- ---------- H3. Шатунні підшипники ----------

select mi_load.stage('H-020', 'tucson_tl_24', 'issue:theta24_rod_bearing', 'known_issue', 'high',
  'Connecting rod bearing wear in the Theta II 2.4 GDI is a manufacturer acknowledged engine failure: under campaign T3G Hyundai dealers inspect engines with DTC P1326, abnormal engine noise or a no crank condition, test connecting rod bearing clearance and replace the long block, and Hyundai extended long block coverage for bearing wear on certain 2018 and 2019 Tucson TL 2.4 cars together with other Theta II models. The same engine continues unchanged in the 2020 and 2021 Tucson, where owners report the same P1326 bearing failures outside those programs.',
  jsonb_build_object(
    'importance', 5,
    'implication', 'Every Tucson 2.4 carries the risk of a sudden engine failure that ends in a long block replacement; on a car without a live extension the engine is the buyer cost, so the knock test, the code scan and the oil history decide whether to buy.',
    'causal', 'supported_cause',
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-17', null, null, 'supports', 'Certain vehicles with 2.0L T-GDI and 2.4L GDI engines may experience the Check Engine warning lamp illuminated with DTC P1326 and/or engine may exhibit abnormal noise or no crank/no start condition related to connecting rod bearing wear or damage. Warranty Extension: coverage for engine long block repair or replacement regarding engine damage or malfunction from connecting rod bearing wear has been extended under TXXC & TXXI.'),
      mi_load.ev('S-H-OFF-15', null, null, 'supports', 'Dealers must perform Service Campaign T3G on all vehicles that return with DTC P132600 ... Certain 2018-2019 MY Tucson (TL) vehicles with 2.4L engines.'),
      mi_load.ev('S-H-OFF-18', null, null, 'supports', 'Certain 2018-2019 MY Tucson (TL) vehicles with Theta II 2.4L GDI engines: engine long block ... connecting rod bearing wear.'),
      mi_load.ev('S-H-OWN-03', 'odi:11710997', '{"age_years":5}'::jsonb, 'supports', '2020 Tucson, VIN KM8J3CAL8LU: the engine suddenly lost power and the vehicle entered limp mode ... diagnostic code P1326 was later confirmed, indicating engine bearing failure ... pending a full engine replacement.'),
      mi_load.ev('S-H-OWN-04', 'odi:11608558', '{"age_years":3}'::jsonb, 'supports', '2021 Tucson, VIN KM8J33AL8MU: the code 1326 came up. I was told it is a rod bearing engine failure and I need a new engine ... my vehicle does not qualify for the recall already made for this damage and code number.'))));

select mi_load.stage('H-021', 'tucson_tl_24', 'issue:theta24_rod_bearing', 'owner_pattern', 'high',
  'Owners of 2020 and 2021 Tucson 2.4 cars report P1326 limp mode, a loud knock and seized or failed engines between about 24,000 and 83,500 miles and three to six years in service; dealers diagnose rod bearing failure and a new engine, and owners are told the car does not qualify for the recall or are denied coverage.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'The 2020 and 2021 cars are not safer because they are outside the programs; they fail the same way and the engine is paid by the owner.',
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2020, 2021, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OWN-04', 'odi:11608558', '{"age_years":3}'::jsonb, 'supports', '2021 Tucson 2.4: code 1326, rod bearing engine failure, needs a new engine, does not qualify for the recall.'),
      mi_load.ev('S-H-OWN-03', 'odi:11710997', '{"age_years":5}'::jsonb, 'supports', '2020 Tucson 2.4: limp mode, P1326 confirmed, engine bearing failure, pending full engine replacement.'),
      mi_load.ev('S-H-OWN-03', 'odi:11741423', '{"age_years":6}'::jsonb, 'supports', '2020 Tucson 2.4: loud knocking/rattling noise and the check engine light began flashing ... The engine requires replacement. Hyundai denied coverage, claiming excessive oil consumption and/or maintenance concerns.'),
      mi_load.ev('S-H-OWN-03', 'odi:11680074', '{"mileage_km":134380}'::jsonb, 'supports', '2020 Tucson 2.4: abnormally loud knocking sound coming from the vehicle before the engine seized. The failure mileage was approximately 83,500.'),
      mi_load.ev('S-H-OWN-03', 'odi:11519312', '{"mileage_km":127756}'::jsonb, 'supports', '2020 Tucson 2.4: engine decelerated, oil pressure light, not able to accelerate past 50 mph, engine starting knocking. Car has 79,384 miles. Dealership states engine failure and that engine needs to be replaced.'),
      mi_load.ev('S-H-OWN-04', 'odi:11531301', '{"mileage_km":38624}'::jsonb, 'supports', '2021 Tucson 2.4: suddenly stuttered and decelerated ... only has 24K miles ... they told me it needed a new engine, but the service department needed approval from corporate Hyundai.'),
      mi_load.ev('S-H-OWN-04', 'odi:11760640', '{"age_years":5}'::jsonb, 'supports', '2021 Tucson 2.4: Engine knock sensor went off and now the engine needs replacement due to faulty cylinder rod.'))));

select mi_load.stage('H-022', 'tucson_tl_24', 'issue:theta24_rod_bearing', 'owner_pattern', 'medium',
  'Owners of 2019 Tucson 2.4 cars report sudden engine knocking and an engine that seized and stalled on the highway six to seven years in service; one car under the extended warranty had its repair held until the owner produced maintenance records.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Even on a 2019 car inside the extension the repair waits on the paperwork; a knocking 2019 car without records is a car with a doubtful claim.',
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2019, 2019, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OWN-02', 'odi:11760673', '{"age_years":7}'::jsonb, 'supports', '2019 Tucson 2.4: my car experienced sudden knocking in the engine ... Problem is the theta 2 engine and though the car is under extended warranty Hyundai is requesting maintenance records before repairing this.'),
      mi_load.ev('S-H-OWN-02', 'odi:11666175', '{"age_years":6}'::jsonb, 'supports', '2019 Tucson 2.4: The engine seized while on the highway unexpectedly ... the car stalled.'),
      mi_load.ev('S-H-OWN-02', 'odi:11719540', '{"age_years":7}'::jsonb, 'supports', '2019 Tucson 2.4: Low oil, burnt oil on dip stick, engine running dangerous hot, lights on on dash, engine knocking.'))));

select mi_load.stage('H-023', 'tucson_tl_24', 'issue:theta24_rod_bearing', 'official_fact', 'high',
  'The manufacturer inspection for bearing wear on these engines is a connecting rod bearing clearance test with a special bearing tool (TSB 21-EM-004H) inside the T3G procedure, and every engine approval or denial goes through a Hyundai prior approval; an engine concern unrelated to T3G, such as oil consumption, is diagnosed separately under the standard warranty policy.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A quiet engine and a clean scan are not the manufacturer test; only a dealer bearing clearance test measures the wear, and an oil consumption complaint does not open the bearing extension.',
    'value_kind', 'document_ref',
    'value', '{"tsb_bearing_test":"21-EM-004H","procedure":"22-01-033H","prior_approval":true}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-17', null, null, 'supports', 'Please refer to TSB #21-EM-004H-1 (or latest version) for the service procedure for engine connecting rod bearing clearance testing ... Bearing Tool SST Power Check ... If a vehicle is brought in for an engine condition unrelated to T3G (e.g. oil consumption), please follow the proper engine diagnosis procedures, and refer to standard warranty policies and procedures.'),
      mi_load.ev('S-H-OFF-16', null, null, 'context', 'For replacements or questions on the bearing tool, please contact GIT.'))));

select mi_load.stage('H-024', 'tucson_tl_24', 'issue:theta24_rod_bearing', 'official_fact', 'high',
  'The only root cause the manufacturer has published for Theta II bearing wear belongs to recall 17V-226: machining debris left in crankshaft oil passages of engines built from 2012 to 2014 for Sonata cars assembled in Alabama and Santa Fe Sport cars assembled in Georgia restricts oil flow to the bearings, raises their temperature and wears them early, producing a knock that rises with engine speed. The US Tucson TL cars of the recall reports are built by Hyundai Motor Company in South Korea, and no Tucson TL document names a root cause.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Do not read the Alabama debris story as the explanation for a Tucson 2.4 failure; the failure mode is the same, the documented cause is not.',
    'value_kind', 'document_ref',
    'value', '{"recall":"17V-226","production":"2012-2014","plants":["Hyundai Motor Manufacturing Alabama","Kia Motor Manufacturing Georgia"],"tucson_tl_build":"Hyundai Motor Company, South Korea"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-30', null, null, 'supports', 'Model Year 2013 through 2014 Hyundai Sonata sedans produced at Hyundai Motor Manufacturing Alabama ... 2013 through 2014 Hyundai Santa Fe Sport vehicles produced at Kia Motor Manufacturing Georgia ... The subject engines may contain residual debris from factory machining operations, potentially restricting oil flow to the main bearings and leading to premature bearing wear.'),
      mi_load.ev('S-H-OFF-31', null, null, 'supports', 'If the debris is not completely removed from the crankshaft oil passages, it can be forced into the connecting rod oiling passages restricting oil flow to the bearings ... A worn connecting rod bearing will produce a metallic, cyclic knocking noise from the engine which increases in frequency as the engine rpm increases.'),
      mi_load.ev('S-H-OFF-27', null, null, 'supports', 'Certain Model Year 2019 Hyundai Tucson vehicles produced ... by Hyundai Motor Company (HMC) in South Korea for sale in the U.S. market.'))));

select mi_load.stage('H-025', 'tucson_tl_24', 'issue:theta24_rod_bearing', 'owner_pattern', 'low',
  'A dealer told the owner of a 2019 Tucson 2.4 that a batch of engines was not vacuumed out properly in production and that the shrapnel wears the cylinders and lets oil past the rings.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Hearsay about a production batch; it would move the debris root cause onto the Tucson if it were confirmed, and it is not.',
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OWN-02', 'odi:11634976', '{"age_years":6}'::jsonb, 'supports', 'Engine failure will be caused by shrapnel in the engine (Dealer told me Hyundai is aware it was not vacuumed out properly in this particular batch of engines) leading to ruts being warn in the cylinder causing oil to leak past piston rings.'))));

-- ---------- H4. KSDS ----------

select mi_load.stage('H-030', 'tucson_tl_24', 'state:theta24_ksds', 'official_fact', 'high',
  'The knock sensor detection software of campaign 953, free for 2018 and 2019 Tucson cars, uses the knock sensor to detect potential early engine issues caused by excessive bearing wear and stores DTC P1326; the Kia bulletin for the same system on the 2020 Sportage 2.4 GDI says it blinks the check engine lamp and puts the engine into limp home mode to reduce further damage, the behaviour Tucson 2.4 owners report with P1326. The software detects and limits damage; the engine it flags goes to the T3G bearing inspection and long block replacement.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A blinking check engine lamp with a power cut on a Tucson 2.4 means stop driving and have the bearings tested; the software is a warning, not a repair, and a car with 953 done can still need an engine.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"953","code":"P1326","kia_equivalent":"PI1806"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-21', null, null, 'supports', 'Hyundai has developed new engine monitoring technology called a knock sensor detection system. The technology enables the detection of potential early engine issues caused by excessive bearing wear. The technology will be installed free of charge on ... 2014-15 and 18-19 Tucson.'),
      mi_load.ev('S-H-OFF-15', null, null, 'supports', 'Dealers must perform Service Campaign T3G on all vehicles that return with DTC P132600.'),
      mi_load.ev('S-H-OFF-26', null, null, 'supports', 'Kia has developed a Knock Sensor Detection System (KSDS) that detects vibrations indicating the onset of excessive connecting rod bearing wear ... the Malfunction Indicator Lamp (MIL) will blink continuously, and the vehicle will be placed in Limp Home Mode. This will reduce further damage.'),
      mi_load.ev('S-H-OWN-03', 'odi:11710997', '{"age_years":5}'::jsonb, 'context', '2020 Tucson 2.4: entered limp mode, P1326 confirmed, engine bearing failure.'))));

select mi_load.stage('H-031', 'tucson_tl_24', 'ver:tucson24', 'official_fact', 'low',
  'The 2020 and 2021 Tucson 2.4 cars left the factory with the knock sensor detection logic already in the engine computer, so they never needed campaign 953.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Would tell a buyer that a 2020 or 2021 car has the warning logic without a campaign record; no manufacturer document says so.',
    'value_kind', 'document_ref',
    'value', '{"model_years":[2020,2021],"logic":"KSDS in production","campaign":"953"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2020, 2021, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OWN-04', 'odi:11735611', '{"mileage_km":144841}'::jsonb, 'supports', '2021 Tucson 2.4: repeated knock sensor (P1326) fault that causes the vehicle to enter limp mode ... at approximately 15,000, 17,000, 41,000, and 90,000 miles ... an ECM update and three knock sensor replacements.'),
      mi_load.ev('S-H-OWN-03', 'odi:11710997', '{"age_years":5}'::jsonb, 'supports', '2020 Tucson 2.4: limp mode and P1326.'),
      mi_load.ev('S-H-AGG-01', null, null, 'contradicts', 'Aggregator summary: the Knock Sensor Detection System was added via a software update (Service Campaign 966) and is not a standard factory feature in the 2020 Tucson.'))));

-- ---------- H5. Заміна мотора ----------

select mi_load.stage('H-040', 'tucson_tl_24', 'state:theta24_long_block', 'official_fact', 'high',
  'A campaign T3G replacement is a Theta II long block chosen by parts availability, not a new design: for 2019 model year cars a remanufactured engine must be used, and a screenshot is required when none is available; later instructions tell dealers to check the warranty policy before ordering a reman engine because a standard service engine or a QQH engine is required in certain cases. No campaign or extension document describes a revised connecting rod bearing or crankshaft in the replacement engines.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A replaced engine is a newer engine of the same design, often remanufactured; ask which one it was and when, and do not treat the replacement as a cure.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"T3G","my2019_rule":"reman engine required","alternatives":["standard service engine","QQH engine"]}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-15', null, null, 'supports', 'For 2019MY vehicles that require an engine replacement, a reman must be used. If a reman is not available, make sure to print out a screenshot of parts availability screen showing reman not available and attach when submitting the claim.'),
      mi_load.ev('S-H-OFF-16', null, null, 'supports', 'Make sure to reference HMA Warranty Policy prior to ordering a reman engine. A standard service engine or QQH engine is required in certain cases.'),
      mi_load.ev('S-H-OFF-17', null, null, 'context', 'Please refer to TSB 22-01-034H (or latest version) for applicable part numbers and labor ops.'))));

select mi_load.stage('H-041', 'tucson_tl_24', 'ent:tucson_theta_ext', 'official_fact', 'high',
  'An engine replacement does not end the Theta II coverage of a qualifying 2018 or 2019 Tucson: the class includes cars replaced with a genuine Theta II engine within OEM specifications, the lifetime warranty endures irrespective of prior warranty engine repairs and replacements, and a subsequent purchaser can claim under it.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'On a qualifying car a dealer replaced engine keeps the lifetime coverage; an engine from a junkyard or an independent shop that is not a genuine Theta II within specification can take the car out of the class.',
    'value_kind', 'document_ref',
    'value', '{"case":"8:17-cv-00838-JLS-JDE","replacement_rule":"genuine Theta II engine within OEM specifications","survives_prior_replacement":true}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_ref('version', 'ver:tucson24', 1),
      mi_load.p_num('model_year', 2018, 2019, 2),
      mi_load.p_ref('entitlement_state', 'ent:tucson_theta_ext', 3)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-LEG-01', 'doc:theta-settlement', null, 'supports', 'equipped with or replaced with a genuine Theta II 2.0 liter or 2.4 liter gasoline direct injection engine within OEM specifications ... the Limited Warranty shall otherwise endure for bearing wear or damage irrespective of ... prior warranty engine repairs and/or warranty replacements.'),
      mi_load.ev('S-H-LEG-02', 'doc:theta-settlement', null, 'supports', 'Claimant is a Class member or other person or entity eligible to make a Claim pursuant to this Settlement Agreement (e.g., a subsequent purchaser of a Class Vehicle under the terms of the Lifetime Warranty).'))));

-- ---------- H6. Олива ----------

select mi_load.stage('H-050', 'tucson_tl_24', 'issue:theta24_oil_consumption', 'owner_pattern', 'high',
  'Owners of 2018 to 2021 Tucson 2.4 cars report oil consumption of about one quart per 1,000 miles and more, starting around 50,000 miles on several cars, found as a dry dipstick at the oil change because no low level warning comes on before the oil pressure light; dealers run consumption tests and combustion chamber cleaning and often call the loss not bad enough to repair.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Expect a Tucson 2.4 past 50,000 miles to burn oil; a low dipstick on inspection is both a consumption sign and a bearing risk, and the dealer program rarely replaces the engine for it.',
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OWN-03', 'odi:11747239', '{"mileage_km":80467}'::jsonb, 'supports', '2020 Tucson 2.4 Theta II GDI, purchased new and maintained properly. Excessive oil consumption began at about 50,000 miles ... An oil consumption test was done at the Hyundai dealer. Conclusion ... it is not bad enough to remedy.'),
      mi_load.ev('S-H-OWN-03', 'odi:11742588', '{"mileage_km":82077}'::jsonb, 'supports', '2020 Tucson: the car has about 51,000 miles ... they confirmed the engine was consuming oil ... the next step in the process is a combustion chamber cleaning.'),
      mi_load.ev('S-H-OWN-04', 'odi:11752252', '{"mileage_km":114263}'::jsonb, 'supports', '2021 Tucson 2.4: burns oil at an alarming rate ... when I take it in, the dipstick is dry. I receive no oil lights to tell me it is low ... I am at 71,000 miles.'),
      mi_load.ev('S-H-OWN-03', 'odi:11711727', '{"age_years":4}'::jsonb, 'supports', '2020 Tucson 2.4: burning oil for about two years ... I have had to add oil every 1000 miles.'),
      mi_load.ev('S-H-OWN-03', 'odi:11677069', '{"age_years":5}'::jsonb, 'supports', '2020 Tucson 2.4: Engine is consuming 3+ quarts per 1000 miles. There is no low oil warning light or notification, just a low oil pressure light.'),
      mi_load.ev('S-H-OWN-01', 'odi:11689224', '{"age_years":7}'::jsonb, 'supports', '2018 Tucson 2.4: after four consumption tests ... the engine is burning between 0.8 and 0.3 liters of oil for every 1,000.'))));

select mi_load.stage('H-051', 'tucson_tl_24', 'issue:theta24_oil_consumption', 'official_fact', 'high',
  'Hyundai handles oil consumption on its gasoline engines through the inspection and repair guidelines of TSB 23-EM-008H and the combustion chamber cleaning of TSB 23-EM-007H, released in December 2023, the cleaning then applicable to four cylinder engines; oil consumption is not part of campaign T3G or the bearing extensions and follows the standard warranty policy.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'An oil burning Tucson 2.4 gets a test and a carbon cleaning under ordinary warranty rules, which a second owner of a 2018 to 2021 car mostly no longer has.',
    'value_kind', 'document_ref',
    'value', '{"tsbs":["23-EM-008H","23-EM-007H"],"released":"2023-12-11"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-25', null, null, 'supports', 'Launch of Engine Oil Consumption Inspection and Repair Guidelines (TSB #23-EM-008H); Launch of Combustion Chamber Cleaning Procedure (TSB #23-EM-007H) 12/11/2023 ... The latest combustion chamber cleaning procedure is currently applicable to 4-cylinder engines ... for all Hyundai models and model year vehicles equipped with gasoline engines.'),
      mi_load.ev('S-H-OFF-17', null, null, 'supports', 'If a vehicle is brought in for an engine condition unrelated to T3G (e.g. oil consumption), please follow the proper engine diagnosis procedures, and refer to standard warranty policies and procedures.'))));

select mi_load.stage('H-052', 'tucson_tl_24', 'issue:theta24_rod_bearing', 'owner_pattern', 'medium',
  'On 2020 Tucson 2.4 cars owners describe the oil level falling between changes before the engine knocked, lost power or failed: one engine had burned almost all its oil two months after a change when it failed at 79,384 miles, another stalled after the oil light came on in bends, a third showed a knock sensor code with no oil on the dipstick.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'On these engines low oil and bearing failure travel together in owner reports; a car that has been driven low on oil is a bearing risk even if it runs quietly today.',
    'causal', 'observed_association',
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OWN-03', 'odi:11519312', '{"mileage_km":127756}'::jsonb, 'supports', 'Car has 79,384 miles on it. Dealership states engine failure and that engine needs to be replaced. Car had burned up almost all the oil that had been replaced two months prior.'),
      mi_load.ev('S-H-OWN-03', 'odi:11721101', '{"age_years":5}'::jsonb, 'supports', 'Complete engine failure. Car was burning oil ... the engine oil light keeps coming on when rounding bends or stopping on a hill ... oil is half gone in between oil changes. The car stalled.'),
      mi_load.ev('S-H-OWN-03', 'odi:11751269', '{"age_years":6}'::jsonb, 'supports', 'The check engine light started flashing and so did the oil light. Read the code as cylinder 3 misfire and a knock sensor ... checked the oil and saw there was no oil in the engine.'),
      mi_load.ev('S-H-OWN-03', 'odi:11644900', '{"age_years":5}'::jsonb, 'supports', '2020 Hyundai Tucson engine continually consumes an excess amount of oil on a weekly basis causing cylinder knocks.'))));

select mi_load.stage('H-053', 'tucson_tl_24', 'ver:tucson24', 'owner_pattern', 'high',
  'Tucson 2.4 owners report engine and oil consumption claims held or denied over maintenance: a failed 2020 engine denied for oil consumption or maintenance although the dealer found it clean inside, a 2020 car charged 1,400 dollars for the combustion chamber cleaning because five oil change records did not cover every change, a 2019 repair held until records were produced and a 2019 owner warned about missed air filter changes.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Without a complete oil change history expect Hyundai to refuse an engine claim; a car without records should be priced as if it had no extension at all.',
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OWN-03', 'odi:11741423', '{"age_years":6}'::jsonb, 'supports', 'Hyundai denied coverage, claiming excessive oil consumption and/or maintenance concerns. However, upon inspection, the dealership removed the valve cover and advised that the engine was internally clean.'),
      mi_load.ev('S-H-OWN-03', 'odi:11742588', '{"mileage_km":82077}'::jsonb, 'supports', 'We were able to find evidence of 5 oil changes ... the combustion chamber cleaning which costs $1400 which would normally be covered by warranty but since we did not have all records of oil changes they will not cover it.'),
      mi_load.ev('S-H-OWN-02', 'odi:11760673', '{"age_years":7}'::jsonb, 'supports', 'Though the car is under extended warranty Hyundai is requesting maintenance records before repairing this.'),
      mi_load.ev('S-H-OWN-02', 'odi:11634976', '{"age_years":6}'::jsonb, 'supports', 'Extended warranty may deny due to 3 missed air filter changes.'),
      mi_load.ev('S-H-LEG-01', 'doc:theta-settlement', null, 'context', 'Class members are suggested to retain all vehicle maintenance records. With the exception of cases of exceptional neglect.'),
      mi_load.ev('S-H-LEG-02', 'doc:theta-settlement', null, 'context', 'Exceptional Neglect means when the vehicle clearly evidences a lack of maintenance or care for a significant period of time of not less than one (1) year, such that the vehicle appears dilapidated, abandoned, and/or beyond repair.'))));

-- ---------- H7. Обслуговування і повний привід ----------

select mi_load.stage('H-060', 'tucson_tl_24', 'maint:theta24_oil', 'official_fact', 'medium',
  'The 2020 Tucson owners manual schedules engine oil and filter for the 2.4 GDI every 7,500 miles or 12 months, and every 3,750 miles or 6 months under severe usage such as repeated trips under 5 miles; the fill is 4.8 litres (5.07 US quarts) of SAE 5W-20 meeting the latest API and ILSAC grade.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 3,
    'implication', 'On an engine with known bearing and oil consumption failures the oil change history is the first document to ask for; gaps well beyond 7,500 miles are a reason to walk away or price in an engine.',
    'value_kind', 'interval',
    'value', '{"normal_miles":7500,"normal_months":12,"severe_miles":3750,"severe_months":6,"capacity_l":4.8,"viscosity":"SAE 5W-20","unit":"mi"}'::jsonb,
    'note', 'Read in the 2020 manual; the schedule table is titled Nu 2.0 GDI, Theta 2.4 GDI. Manuals of 2018, 2019 and 2021 were not read, hence medium confidence.',
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-13', null, null, 'supports', 'Normal Maintenance Schedule (Nu 2.0 GDI, Theta 2.4 GDI): Engine oil and engine oil filter R every 7.5 thousand miles or 12 months. Maintenance Under Severe Usage Conditions: Engine oil and filter R Every 3,750 miles or 6 months. Engine oil (drain and refill) 2.0 GDI 4.23 US qt. (4.0 l) SAE 5W-20/API Latest (ILSAC Latest) 2.4 GDI 5.07 US qt. (4.8 l).'))));

select mi_load.stage('H-061', 'tucson_tl_24', 'maint:theta24_plugs', 'official_fact', 'medium',
  'The 2020 Tucson owners manual schedules spark plug replacement on the 2.4 GDI every 97,500 miles, more often under severe usage.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 2,
    'implication', 'Routine; misfires with repeated plug changes on these engines are reported together with oil burning.',
    'value_kind', 'interval',
    'value', '{"miles":97500,"unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-13', null, null, 'supports', 'Spark plugs: Replace every 97,500 miles. Severe usage: Spark plugs R More frequently.'))));

select mi_load.stage('H-062', 'tucson_tl_24', 'maint:theta24_coolant', 'official_fact', 'medium',
  'The 2020 Tucson owners manual schedules the first engine coolant replacement at 120,000 miles or 10 years and then every 30,000 miles or 24 months, with 7.7 litres of phosphate based ethylene glycol coolant for the 2.4 GDI.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 2,
    'implication', 'A 2018 to 2021 car reaches the first coolant change by age between 2028 and 2031 unless the mileage comes first.',
    'value_kind', 'interval',
    'value', '{"first_miles":120000,"first_years":10,"then_miles":30000,"then_months":24,"capacity_l":7.7,"unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-13', null, null, 'supports', 'Engine coolant: At first, replace at 120,000 miles or 10 years; Thereafter, replace every 30,000 miles or 24 months. Engine Coolant 2.4 GDI 8.14 US qt. (7.7 l) Mixture of antifreeze and water (Phosphate-based Ethylene glycol coolant for aluminum radiator).'))));

select mi_load.stage('H-063', 'tucson_tl_24', 'maint:tl24_atf', 'official_fact', 'medium',
  'The 2020 Tucson owners manual gives the automatic transmission fluid no check and no service under normal use, and replacement every 60,000 miles under severe usage; the 2.4 transmission holds 6.7 litres of ATF SP-IV in front or all-wheel drive.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 3,
    'implication', 'A car used for short trips, towing, hills or dusty roads is due fluid at 60,000 miles; no fluid change on such a car is a plausible reason for slipping.',
    'value_kind', 'interval',
    'value', '{"normal":"no check, no service","severe_miles":60000,"capacity_l":6.7,"fluid":"ATF SP-IV","unit":"mi"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-13', null, null, 'supports', 'Automatic transmission fluid: No check, No service required. Severe usage: Automatic transmission fluid R Every 60,000 miles. Automatic transmission fluid 2.4 GDI 2WD 7.08 US qt. (6.7 l) AWD 7.08 US qt. (6.7 l) ATF SP-IV.'))));

select mi_load.stage('H-064#a', 'tucson_tl_24', 'maint:tl_awd_transfer', 'official_fact', 'medium',
  'The 2020 Tucson owners manual lists the transfer case oil of all-wheel drive cars as an inspection item and says it should be changed any time it has been submerged in water.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 3,
    'implication', 'An auction car with flood history needs its transfer case oil changed before use, even if it drives well.',
    'value_kind', 'document_ref',
    'value', '{"manual":"2020 Tucson Owners Manual","schedule":"inspect","change_when":"submerged in water"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-13', null, null, 'supports', 'Transfer case oil (AWD) I. Transfer case oil and rear differential oil should be changed anytime they have been submerged in water.'))));

select mi_load.stage('H-064#b', 'tucson_tl_24', 'maint:tl_awd_diff', 'official_fact', 'medium',
  'The 2020 Tucson owners manual lists the rear differential oil of all-wheel drive cars as an inspection item and says it should be changed any time it has been submerged in water.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 3,
    'implication', 'An auction car with flood history needs its rear differential oil changed before use, even if it drives well.',
    'value_kind', 'document_ref',
    'value', '{"manual":"2020 Tucson Owners Manual","schedule":"inspect","change_when":"submerged in water"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-13', null, null, 'supports', 'Rear differential oil (AWD) I. Transfer case oil and rear differential oil should be changed anytime they have been submerged in water.'))));

select mi_load.stage('H-065', 'tucson_tl_24', 'eq:tucson_awd', 'official_fact', 'high',
  'On the all-wheel drive Tucson the AWD LOCK mode works only up to 37 mph (60 km/h) and must not be used on dry pavement, where it causes noise, vibration and may damage the AWD system; the car must be towed with all wheels off the ground, tested only on a four wheel dynamometer, and run on four tires of the same size, type, tread, brand and load capacity.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'An auction car towed with the rear wheels on the road, or one wearing mismatched tires, may have a damaged AWD system; ask how it was transported and check that the four tires match.',
    'value_kind', 'quantity',
    'value', '{"lock_max_mph":37,"lock_max_kmh":60,"unit":"mph"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-13', null, null, 'supports', 'AWD Lock mode is in operation only when a vehicle travels at 37 mph (60 km/h) or less. Do not use the AWD lock mode on dry paved roads. Doing so can cause abnormal noise or vibration, and may damage the AWD system. AWD vehicles must be towed with a wheel lift and dollies or flatbed equipment with all the wheels off the ground. A full-time AWD vehicle must be tested on a special four wheel chassis dynamometer. Equip all four tires with the tire and wheel of the same size, type, tread, brand and load-carrying capacity.'))));

-- ---------- H8. Коробка ----------

select mi_load.stage('H-070', 'tucson_tl_24', 'var:tucson24_6at', 'official_fact', 'high',
  'Hyundai bulletins for the Tucson TL 2.4 six-speed automatic treat in-gear clutch slip with a transmission replacement: the stall test of TSB 19-AT-021H-1 (Tucson TL 2.4L listed) passes between 1,700 and 2,900 rpm and a failed test means replacing the transmission, and TSB 24-AT-002H for incorrect ratio codes P0729 to P0736, P076F and P0730 on Tucson TL 2.0L and 2.4L cars diagnoses and replaces the transmission if necessary under normal warranty; there is no campaign or extension for this transmission.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A slipping or flaring Tucson 2.4 needs a transmission, not an adjustment; scan for gear ratio codes and drive it hot before buying.',
    'value_kind', 'document_ref',
    'value', '{"tsbs":["19-AT-021H-1","24-AT-002H"],"stall_rpm_min":1700,"stall_rpm_max":2900,"dtcs":["P0729","P0730","P0731","P0732","P0733","P0734","P0735","P0736","P076F"]}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-33', null, null, 'supports', 'Automatic transmission stall test procedure ... PASS: Stall speed is between 1700~2900 rpm ... If the vehicle fails the stall test, replace the transmission. Tucson (TL) 2.4L. Warranty Information: Normal warranty applies.'),
      mi_load.ev('S-H-OFF-34', null, null, 'supports', 'Automatic transmission incorrect ratio DTC P0731, P0732, P0733, P0734, P0735, P0736, P0729, P076F & P0730 ... procedure to diagnose and replace, if necessary, an automatic transmission ... Tucson (TL) 2.0L/2.4L.'))));

-- ---------- H9. Відклики і кампанії покоління ----------

select mi_load.stage('H-080#a', 'tucson_tl_24', 'gen:tl', 'official_fact', 'high',
  'Recall 20V-543 (Hyundai 195) covers model year 2019 Tucson cars built from 1 September 2018 to 31 July 2019 whose ABS hydraulic electronic control unit may corrode internally and short, with a risk of an engine compartment fire.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A 2019 Tucson built in that window must show the recall 195 fuse kit as done; until then the manufacturer advises parking it outside.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"20V543000","hyundai":"195","prod_from":"2018-09-01","prod_to":"2019-07-31"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2019, 2019, 1),
      mi_load.p_date('production_date', date '2018-09-01', date '2019-07-31', 2)),
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-27', null, null, 'supports', '2019-2019 Hyundai Tucson Production Dates: SEP 01, 2018 - JUL 31, 2019. Certain Model Year 2019 Hyundai Tucson vehicles ... may contain a defective circuit board in the ABS brake hydraulic electronic control unit (HECU).'))));

select mi_load.stage('H-080#b', 'tucson_tl_24', 'gen:tl', 'official_fact', 'high',
  'Recall 20V-543 (Hyundai 195) covers model year 2020 Tucson cars built from 1 December 2019 to 31 March 2020 for the ABS module short and engine compartment fire risk.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A 2020 Tucson built in that window must show the recall 195 fuse kit as done.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"20V543000","hyundai":"195","prod_from":"2019-12-01","prod_to":"2020-03-31"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2020, 2020, 1),
      mi_load.p_date('production_date', date '2019-12-01', date '2020-03-31', 2)),
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-27', null, null, 'supports', '2020-2020 Hyundai Tucson Production Dates: DEC 01, 2019 - MAR 31, 2020.'))));

select mi_load.stage('H-080#c', 'tucson_tl_24', 'gen:tl', 'official_fact', 'high',
  'Recall 20V-543 (Hyundai 195) covers model year 2021 Tucson cars built on 23 June 2020 for the ABS module short and engine compartment fire risk.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Only 2021 cars built on that single day are in the recall; the build label settles it.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"20V543000","hyundai":"195","prod_from":"2020-06-23","prod_to":"2020-06-23"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2021, 2021, 1),
      mi_load.p_date('production_date', date '2020-06-23', date '2020-06-23', 2)),
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-27', null, null, 'supports', '2021-2021 Hyundai Tucson ... produced on 06/23/2020 ... Production Dates: JUN 23, 2020 - JUN 23, 2020.'))));

select mi_load.stage('H-080#d', 'tucson_tl_24', 'gen:tl', 'official_fact', 'medium',
  'On 30 December 2020 Hyundai expanded recall 20V-543 to certain 2016 to 2018 Tucson cars; the production window of the added 2018 cars is not in the documents read, so only a VIN lookup tells whether a 2018 car is included.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A 2018 Tucson may or may not be in the ABS module recall; look the VIN up rather than assuming either way.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"20V543000","expanded":"2020-12-30","added_model_years":[2016,2017,2018]}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2018, 2018, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-29', null, null, 'supports', 'Hyundai Motor America recalled certain 2019-2021 Tucson vehicles on September 4, 2020. On December 30, 2020, Hyundai expanded the recall population, and added certain 2016-2018 Tucson vehicles.'),
      mi_load.ev('S-H-OFF-28', null, null, 'context', 'This TSB supersedes TSB# 20-01-040H, expanding model year applicability and adding procedures / parts information for 2016-2018MY vehicles.'))));

select mi_load.stage('H-081', 'tucson_tl_24', 'issue:tl_hecu_fire', 'official_fact', 'high',
  'In recall 20V-543 flux residue from soldering at the supplier builds up on the ABS module circuit board and, with heat and humidity, forms a corrosive short that can start an engine compartment fire while parked or driving; the warnings are smoke from the engine compartment, a burning or melting odour and the check engine or ABS light. The September 2020 report covered 180,000 cars with a manufacturer estimate of 1 percent defective and advised parking outside away from structures; the remedy issued in February 2021 is a fuse kit in the ABS module circuit and, if needed, an ABS and ESC software update, not a new module.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'The fuse kit limits the fire risk but leaves the original module; an ABS light or a burning smell on a Tucson TL is a stop and inspect sign even with the recall done.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"20V543000","hyundai":"195","units_report_2020_09":180000,"estimated_defect_pct":1,"remedy_tsb":"21-01-010H","remedy":"fuse kit and ABS/ESC software"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-H-OFF-27', null, null, 'supports', 'Flux residue from the soldering process at the supplier could accumulate on the ABS module main controller board (PCB). With exposure to heat and humidity, the residue could result in a corrosive path and an electrical resistance short ... engine compartment fire while parked or driving. Warnings: Smoke from the engine compartment; Burning/melting odor; Illumination of the MIL and/or ABS light. Number of potentially involved: 180,000. Estimated percentage with defect: 1 %. Hyundai recommends parking these vehicles outside and away from structures.'),
      mi_load.ev('S-H-OFF-28', null, null, 'supports', 'This bulletin describes the procedure to install a fuse kit into the ABS module electrical circuit and if necessary, update the ABS/ESC software. Applicable Vehicles: Certain 2016-2021MY Tucson (TL) vehicles.'))));

select mi_load.stage('H-082', 'tucson_tl_24', 'gen:tl', 'official_fact', 'high',
  'Hyundai anti-theft campaign 993 (software and window decal, with steering wheel lock campaign P32) applies to Tucson cars of 2011 to 2022 that start with a key and have no engine immobilizer, in phase two from about June 2023; cars with push button start have an immobilizer and are not in the campaign, and immobilizers became standard on all Hyundai cars produced from November 2021.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A key ignition Tucson TL without the 993 software is the car thieves target in the United States; at auction such a car may carry ignition or steering column damage from a theft.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"993","lock_campaign":"P32","tucson_model_years":"2011-2022","phase":2,"immobilizer_standard_from":"2021-11"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_ref('equipment_absent', 'eq:tucson_push_start', 1)),
    'ev', jsonb_build_array(mi_load.ev('S-H-OFF-32', null, null, 'supports', 'In November 2021, engine immobilizers became standard on all Hyundai vehicles produced. Vehicles with a push button ignition are equipped with an immobilizer and therefore Campaign 993 does not apply to them. Phase 2: ... Tucson 2011-2022, June 2023 (estimated). Vehicles without immobilizers have key ignition steering columns (No push button Start/Stop Ignition).'))));

-- ---------- H10. Синтез ----------

select mi_load.stage('H-090', 'tucson_tl_24', 'ver:tucson24', 'calcar_synthesis', 'high',
  'For a Tucson 2.4 bought at a United States auction and taken abroad, price in a replacement engine: the connecting rod bearing failure of the Theta II 2.4 has no practical manufacturer recourse for such a car. The 2020 and 2021 cars were never in the extension programs, a second owner has only the 5 year or 60,000 mile coverage, and the lifetime extension of certain 2018 and 2019 cars excludes salvage titled cars and cars bought abroad. Before paying, listen to a cold start for knock, read the stored codes for P1326, check the oil level and ask for the oil change history.',
  jsonb_build_object(
    'importance', 5,
    'implication', 'The engine decides the deal on this car: a knock, a P1326 history or a low dipstick means walk away or buy at a price that pays for a long block.',
    'note', 'Supports: H-020 (known issue), H-021 (owner pattern), H-010 and H-011 (official facts). Importance 5 because an engine failure without recourse is an irreversible loss that changes the buy decision in the import scenario.'));

select mi_load.stage('H-032', 'tucson_tl_24', 'ver:tucson24', 'calcar_synthesis', 'high',
  'Completing the knock sensor detection software does not make a Tucson 2.4 engine less likely to wear its bearings: it turns a sudden seizure into an earlier warning with limp mode, and on certain 2018 and 2019 cars it is a condition of the lifetime extension. On 2020 and 2021 cars P1326 events still end in engine replacement.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Treat a completed campaign 953 as proof of paperwork and of an early warning, not of a healthy engine.',
    'note', 'Supports: H-030 (official fact), H-021 (owner pattern).'));

select mi_load.stage('H-042', 'tucson_tl_24', 'ver:tucson24', 'calcar_synthesis', 'high',
  'A Hyundai dealer replaced Theta II long block is neither a cure nor a bad sign: it is a newer, often remanufactured engine of the same design with fresh bearings, no document describes a changed bearing, and owners of later cars report the same failure, so the failure mode stays possible. On a qualifying 2018 or 2019 car the replacement keeps the extension coverage. Ask for the repair order with the date, mileage and engine type, and treat an engine replaced outside a Hyundai dealer as unknown.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A documented dealer engine replacement resets the engine age, not the risk; an undocumented replacement is worth nothing to the price.',
    'note', 'Supports: H-040 (official fact), H-041 (official fact), H-021 (owner pattern).'));
