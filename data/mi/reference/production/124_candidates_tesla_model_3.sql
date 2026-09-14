-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 124_candidates_tesla_model_3.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- MI Catalog, картка 2: кандидати Tesla Model 3 Long Range AWD, US MY2018-2023.
--
-- Джерело: docs/model-intelligence/reference/tesla-model-3-lr-awd-my2018-2023.md.
-- Правила ті самі, що у картці 1: один атом дає кандидатів по типу знання
-- і по subject, офіційний факт і практика власників це різні клейми,
-- розщеплення видно у task_ref: 'M-049#a', 'M-049#b'.
--
-- Правило R1 у дії: знання про пак стоїть на родині паку або її ревізії,
-- про тепло на варіанті теплової системи (PTC або тепловий насос), про
-- 12 В батарею на її варіанті, про апаратуру Autopilot і медіаблок на
-- варіантах спільних родин бренду, про кузов, підвіску, відклики і софт
-- на поколінні. Клейм прямо на родині компонента досягає встановленого
-- варіанта лише з propagation = descendants (компілятор, claim_reaches),
-- тому родинні факти картки несуть саме його. Рік обмежує застосовність
-- лише там, де він і є межею:
-- відклик, розслідування, кампанія, рейтинг EPA. Клейми на правах бренду
-- несуть предикат model_line, бо компілятор бере всі права бренду у кожен
-- фрагмент бренду.
--
-- Важливість і buyer-текст задаються прямо тут. Жодне джерело не вигадане
-- і жодне правило gate не послаблене: кандидат, якому доказів бракує,
-- лишається у staging. Сторінки tesla.com, що віддають 403, цитуються зі
-- статусом search_summary і лише там, де сам факт відомий з інших джерел
-- дослівно.

\o /dev/null

-- ---------- M1. Ідентичність і офіційні рейтинги ----------

select mi_load.stage('M-001', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'high',
  'The Model 3 Long Range AWD of model years 2018 and 2019 is rated by the EPA at 310 miles of range and 116 MPGe combined (120 city, 112 highway), 28.9 kWh per 100 miles, with two AC three phase motors listed at 147 and 188 kW and all wheel drive.',
  jsonb_build_object(
    'subject_text', 'Model 3 Long Range AWD MY2018-2019 US',
    'importance', 3,
    'implication', 'The baseline range of the first two model years; a healthy car should still show a rated range close to this figure, and a much lower figure points at degradation or a battery management limit.',
    'value_kind', 'quantity',
    'value', '{"range_mi":310,"mpge_combined":116,"kwh_per_100mi":28.9,"motors_kw":[147,188],"unit":"mi"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2018, 2019, 1),
      mi_load.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-01', null, null, 'supports', 'Model 3 Long Range AWD 2018: range 310, 120/112/116 MPGe, 28.9462 kWh/100 mi, 147 and 188 kW AC 3-Phase, All-Wheel Drive.'),
      mi_load.ev('S-M-OFF-02', null, null, 'supports', 'Model 3 Long Range AWD 2019: the same rating, vehicle 41190.'))));

select mi_load.stage('M-002', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'high',
  'For model year 2020 the EPA rating of the Long Range AWD rose to 322 miles and 121 MPGe combined with the same 147 and 188 kW motors.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A 2020 car is rated 12 miles higher than a 2018 or 2019 car with the same hardware; the difference is a rating, not a different pack.',
    'value_kind', 'quantity',
    'value', '{"range_mi":322,"mpge_combined":121,"unit":"mi"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2020, 2020, 1), mi_load.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-03', null, null, 'supports', 'Model 3 Long Range AWD 2020: range 322, 124/116/121 MPGe, 27.96 kWh/100 mi.'))));

select mi_load.stage('M-003', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'high',
  'From model year 2021 the refreshed Long Range AWD is rated at 353 miles and 134 MPGe combined; the EPA lists its motors at 98 and 195 kW and an 11.2 kW on-board charger, against 10.0 kW before.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Model year 2021 is the refresh boundary: more range, a new pack revision, a heat pump and a stronger on-board charger; knowledge about the 2018 to 2020 thermal system and pack stops here.',
    'value_kind', 'quantity',
    'value', '{"range_mi":353,"mpge_combined":134,"motors_kw":[98,195],"charger_kw":11.2,"unit":"mi"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2021, 2021, 1), mi_load.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-04', null, null, 'supports', 'Model 3 Long Range AWD 2021: range 353, 141/127/134 MPGe, 25.1 kWh/100 mi, 98 and 195 kW AC 3-Phase, charge240 11.2 kW.'),
      mi_load.ev('S-M-OFF-03', null, null, 'context', 'The 2020 entry lists 10.0 kW for the standard charger.'))));

select mi_load.stage('M-004', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'high',
  'Model years 2022 and 2023 of the Long Range AWD are rated at 358 miles and 131 MPGe combined with an 11.5 kW on-board charger.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'The last two pre-Highland years share one rating; a 2022 or 2023 car showing far less than 358 miles at full charge has lost capacity or carries a limit.',
    'value_kind', 'quantity',
    'value', '{"range_mi":358,"mpge_combined":131,"charger_kw":11.5,"unit":"mi"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2022, 2023, 1), mi_load.p_tag('market_sold', 'US', 2)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-05', null, null, 'supports', 'Model 3 Long Range AWD 2022: range 358, 134/126/131 MPGe, charge240 11.5 kW.'),
      mi_load.ev('S-M-OFF-06', null, null, 'supports', 'Model 3 Long Range AWD 2023: the same rating, vehicle 46204.'))));

select mi_load.stage('M-005', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'high',
  'The NHTSA decoder returns only Model 3 with the note Dual Motor - Standard for the eighth VIN character B, and no trim or series, so the Long Range AWD version is identified from the listing text, not from the VIN alone.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A Model 3 without the words Long Range in the listing cannot be told from a Performance or a Standard Range car by VIN decode; the version must be confirmed on the screen or by the range rating.',
    'value_kind', 'enum',
    'value', '{"vin_position_8":"B","decoder_note":"Dual Motor - Standard"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-28', null, null, 'supports', 'OtherEngineInfo: Dual Motor - Standard; Series and Trim empty; BatteryKWh 79.50 for the 2022 pattern.'))));

select mi_load.stage('M-006', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'high',
  'The Battery and Drive Unit Limited Warranty of the Model 3 Long Range is 8 years or 120,000 miles (192,000 km), whichever comes first, with a minimum 70 percent retention of battery capacity; the Standard Range cars get 8 years or 100,000 miles.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A 2018 car leaves the battery warranty in 2026 by age even at low mileage; after that a pack failure is the owner cost, and the warranty covers only a fall below 70 percent, not ordinary loss.',
    'value_kind', 'interval',
    'value', '{"years":8,"miles":120000,"km":192000,"min_capacity_pct":70}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-07', 'doc:nvlw-2026', null, 'supports', 'Model 3 and Model Y Long Range or Performance - 8 years or 120,000 miles (192,000 km), whichever comes first, with minimum 70% retention of Battery capacity over the warranty period.'))));

select mi_load.stage('M-007', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'high',
  'The Basic Vehicle Limited Warranty is 4 years or 50,000 miles; the warranty transfers at no cost to a subsequent owner, but only inside the warranty region where the car was first sold, so a car sold in the United States must return to the United States or Canada for warranty service.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A car imported to another country carries no usable manufacturer warranty even while it is inside the 8 year battery term; every repair is at the cost of the buyer or of an independent shop.',
    'value_kind', 'interval',
    'value', '{"basic_years":4,"basic_miles":50000,"warranty_region":"US and Canada"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-07', 'doc:nvlw-2026', null, 'supports', 'This New Vehicle Limited Warranty is transferable at no cost to any person(s) who subsequently and lawfully assume(s) ownership of the vehicle after the first retail purchaser. Any subsequent private retail purchasers or transferees must return to your specific Warranty Region in order to obtain warranty service regardless of the country in which such purchaser or transferee may have purchased the vehicle.'))));

select mi_load.stage('M-008', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Model year 2017 to 2020 Model 3 cars were built between 15 July 2017 and 30 September 2020 according to the recall population of 21V-00D; the refreshed model year 2021 cars followed from October 2020.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Sets the calendar boundary between the pre-refresh and refreshed cars: a build date after September 2020 means model year 2021 hardware.',
    'value_kind', 'date_window',
    'value', '{"from":"2017-07-15","to":"2020-09-30"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-15', null, null, 'supports', 'Production Dates: JUL 15, 2017 - SEP 30, 2020. The recall population includes all Model Year 2017 to 2020 Model 3 vehicles.'),
      mi_load.ev('S-M-REV-03', null, null, 'context', 'Photographs of a refreshed Model 3 in Fremont with a production date of October 8, 2020.'))));

select mi_load.stage('M-009', 'm3_lr_awd', 'fam:m3_thermal', 'official_fact', 'high',
  'Model 3 cars built between approximately July 2017 and October 2020 have no heat pump and use the resistive cabin heater; cars built afterwards have the heat pump.',
  jsonb_build_object(
    'propagation', 'descendants',
    'note', 'Family level fact from the manufacturer that names the build window of both variants; it must reach every fitted thermal variant.',
    'importance', 4,
    'implication', 'Decides which thermal knowledge applies: the resistive heater failures of the 2018 to 2020 cars or the heat pump sensor faults of the 2021 and later cars; the two systems share nothing.',
    'value_kind', 'date_window',
    'value', '{"ptc_until":"2020-10","heat_pump_from":"2020-10","approximate":true}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-08', null, null, 'supports', 'Vehicles manufactured between approximately July 2017 and October 2020 do not have a heat pump ... Vehicles manufactured afterward have a heat pump.'))));

select mi_load.stage('M-010', 'm3_lr_awd', 'fam:m3_lv', 'official_fact', 'high',
  'Model 3 cars built in Fremont before approximately December 2021 have a lead acid low voltage battery, AtlasBX / Hankook 85B24LS 12 V 45 Ah on North American cars; cars built afterwards have a lithium ion low voltage battery, and the manufacturer makes the owner responsible for monitoring the low voltage battery and excludes damage from running out of range from the warranty.',
  jsonb_build_object(
    'propagation', 'descendants',
    'note', 'Family level fact from the manufacturer that names the build window of both variants; it must reach every fitted low voltage battery variant.',
    'importance', 3,
    'implication', 'A 2018 to 2021 car carries a lead acid battery with a life of a few years; a car that sat at auction for months is a candidate for a new one before it strands its owner.',
    'value_kind', 'part_number',
    'value', '{"lead_acid_until":"2021-12","part":"AtlasBX / Hankook 85B24LS 12V 45Ah","approximate":true}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-08', null, null, 'supports', 'Vehicles manufactured in Gigafactory Shanghai before approximately October 2021, and in the Fremont Factory before approximately December 2021, are equipped with a Lead-Acid low voltage battery. Vehicles manufactured after these dates are equipped with a Lithium-Ion low voltage battery. The low voltage lead-acid battery for North American vehicles is AtlasBX / Hankook 85B24LS 12V 45Ah. It is your responsibility to monitor the low voltage battery health. Damage to the low voltage battery due to running out of range is not covered by the warranty.'))));

select mi_load.stage('M-011', 'm3_lr_awd', 'var:m3_pack_2021', 'official_fact', 'medium',
  'The refreshed Long Range pack of the 2021 and later cars is listed by the NHTSA decoder at 79.5 kWh for the 2022 dual motor car; the press reported about 82 kWh gross from higher density Panasonic 2170 cells, against roughly 75 to 78 kWh before.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'The 2021 and later pack is a different revision with more energy; capacity readings of a 2018 to 2020 car must be judged against the smaller pack, not against 82 kWh.',
    'value_kind', 'quantity',
    'value', '{"decoder_kwh":79.5,"reported_gross_kwh":82,"unit":"kWh"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-28', null, null, 'supports', 'BatteryKWh 79.50 for the model year 2022 pattern 5YJ3E1EB1NF.'),
      mi_load.ev('S-M-REV-02', null, null, 'context', 'Registration information shared by buyers confirms that the new battery packs have a capacity of 82 kWh in the Model 3 Long Range AWD; roughly a 5% increase in energy density enabled by the new cells.'))));

-- Дата переходу з апаратури 2.5 на FSD-комп'ютер відома лише з
-- енциклопедії і огляду: офіційного документа немає, кандидат чесно
-- лишається у staging.
select mi_load.stage('M-012', 'm3_lr_awd', 'fam:tesla_ap', 'official_fact', 'medium',
  'The Model 3 launched with Autopilot computer 2.5, announced in August 2017, and the Full Self-Driving computer, hardware 3, became available in April 2019; the two boards have the same size, which is what makes the retrofit possible.',
  jsonb_build_object(
    'propagation', 'descendants',
    'note', 'Family level timeline of the Autopilot computers; it must reach the fitted 2.5 or Full Self-Driving computer.',
    'importance', 4,
    'implication', 'A 2018 car has the 2.5 computer unless retrofitted; a 2019 car can have either; a 2020 or later car has the FSD computer. Full Self-Driving needs hardware 3, Enhanced Autopilot does not.',
    'value_kind', 'date_window',
    'value', '{"hw25_from":"2017-08","hw3_from":"2019-04"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-AGG-02', null, null, 'supports', 'In August 2017, Tesla announced that HW2.5 included a secondary processor node ... The first availability of HW3 was April 2019. The HW3 system board is the same physical size as the HW2.5 board.'),
      mi_load.ev('S-M-REV-06', null, null, 'supports', 'HW3 was introduced in April 2019, while HW2.5 appeared on Teslas built between August 2017 and March 2019.'))));

select mi_load.stage('M-013', 'm3_lr_awd', 'var:ap25', 'official_fact', 'high',
  'Recall 22V-169 covers 2017 to 2020 Model 3 cars equipped with Autopilot computer 2.5 on certain firmware, where the rearview image may not display immediately in reverse; the remedy is an over the air update, SB-22-00-004.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Only a car that still has the 2.5 computer is in this campaign; a car that has been offline may not have received the software remedy.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"22V169000","tesla_ref":"SB-22-00-004","units":947}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-24', null, null, 'supports', 'Tesla is recalling certain 2018-2019 Model S, Model X, and 2017-2020 Model 3 vehicles equipped with Autopilot Computer 2.5 and operating certain firmware releases. The rearview image may not immediately display when the vehicle begins to reverse. Tesla will perform an over-the-air software update.'))));

-- Перехід медіаблока з Intel на AMD відомий лише з оглядів: чесний блок.
select mi_load.stage('M-014', 'm3_lr_awd', 'fam:tesla_mcu', 'official_fact', 'medium',
  'The Model 3 infotainment computer ran on the Intel Atom processor from launch, and North American cars switched to the AMD Ryzen computer in December 2021; there is no retrofit from the Intel to the AMD computer.',
  jsonb_build_object(
    'propagation', 'descendants',
    'note', 'Family level timeline of the infotainment computers; it must reach the fitted Intel or AMD computer.',
    'importance', 3,
    'implication', 'A 2018 to 2021 car has the Intel computer, which is slower and loses some new features; the type is read on the screen under Additional vehicle information, not from the year alone for 2022 cars.',
    'value_kind', 'date_window',
    'value', '{"amd_from":"2021-12","market":"North America"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-REV-04', null, null, 'supports', 'The first Model 3 and Y vehicles with MCU3 (Infotainment Computer with AMD Ryzen) are now being produced and delivered in North America, December 28, 2021.'),
      mi_load.ev('S-M-REV-05', null, null, 'supports', 'MCU 2 was offered in 2017 (Model 3) through 2022; Tesla has not offered an upgrade path or retrofit to transition from MCU 2 to MCU 3.'))));

-- ---------- M2. Права ----------

select mi_load.stage('M-015', 'm3_lr_awd', 'ent:m3_autopilot', 'official_fact', 'high',
  'From 11 April 2019 Autopilot, that is traffic aware cruise control and Autosteer, is included in every new Tesla; before that date it was a 3,000 dollar option on the Model 3, so a car delivered earlier may carry the hardware without the software right.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'On a 2018 or early 2019 car the presence of cameras proves nothing: Autopilot may never have been bought, and the manufacturer sells it as an upgrade to the current owner.',
    'value_kind', 'date_window',
    'value', '{"standard_from":"2019-04-11","option_price_usd_before":3000}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_ref('model_line', 'line:model_3', 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-29', null, null, 'supports', 'All Tesla vehicles now come with Autopilot bundled as a standard feature; Model 3 Standard Plus previously cost 37,500 dollars plus 3,000 dollars for the Autopilot option.'),
      mi_load.ev('S-M-OWN-15', 'thread:tmc-295372', null, 'context', 'Autopilot being standard with all Teslas did not start until after April 2019; if you see a price for an upgrade for 3k, you do not have autopilot at all.'))));

select mi_load.stage('M-016', 'm3_lr_awd', 'issue:m3_no_basic_ap', 'owner_pattern', 'high',
  'Used Model 3 cars turn up without any Autopilot software: a 2019 car bought used in 2023 showed only Autopilot safety features and a 3,000 dollar upgrade offer, and a 2023 former fleet car had no Autopilot with a 1,000 dollar upgrade offer; the only hint on the car is the wording Autopilot safety features included.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Check the Autopilot page of the account before paying for Autopilot; the words Autopilot safety features included mean the right is absent.',
    'applic', jsonb_build_array(mi_load.p_ref('model_line', 'line:model_3', 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-15', 'thread:tmc-295372', '{"age_years":4}'::jsonb, 'supports', 'I just purchased my first 2019 Tesla Model 3 Standard Range ... I do see an upgrade option that has Autosteer included but it is 3000.00.'),
      mi_load.ev('S-M-OWN-14', 'thread:tmc-349214', '{"age_years":2}'::jsonb, 'supports', 'A 2023 Model 3 did not have basic Autopilot, which required 1000 dollars as an upgrade. The only hint is if you see Autopilot Safety Features included, this is confirmation that in fact Autopilot is NOT included.'))));

select mi_load.stage('M-017', 'm3_lr_awd', 'ent:fsd', 'official_fact', 'high',
  'Under the Full Self-Driving transfer offers the manufacturer has repeated since July 2023, an owner who bought Full Self-Driving or Enhanced Autopilot can move it to a new Tesla, after which the original car keeps only basic Autopilot; the transfer is only to a new car and not from a leased car.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A used car advertised with Full Self-Driving may have had it transferred away by the previous owner; the right exists only if the account of the car shows it after the transfer of ownership.',
    'value_kind', 'date_window',
    'value', '{"first_offer":"2023-07","repeated":true}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_ref('model_line', 'line:model_3', 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-30', null, null, 'supports', 'When you transfer Enhanced Autopilot or Full Self-Driving (Supervised) from your current vehicle to your new vehicle, your current vehicle will only have access to basic Autopilot features.'),
      mi_load.ev('S-M-OWN-18', 'thread:tmc-344013', null, 'supports', 'The transfer is only to a new vehicle from Tesla. You cannot transfer FSD from a lease vehicle.'))));

select mi_load.stage('M-018', 'm3_lr_awd', 'issue:m3_fsd_gone', 'owner_pattern', 'medium',
  'Owners report that the manufacturer will not carry Acceleration Boost or Full Self-Driving to a new car on a trade in and removes them before reselling a car it has taken in, so only a private sale keeps the paid software with the car.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'On a car that passed through the manufacturer or an auction after a trade in, assume paid software is gone unless the account shows it.',
    'applic', jsonb_build_array(mi_load.p_ref('model_line', 'line:model_3', 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-20', 'thread:tmc-210298', '{"age_years":1}'::jsonb, 'supports', 'He checked with his management team and was advised that they will not transfer the acceleration boost. He also advised if you sell the car to Tesla they will remove the acceleration boost before reselling it ... FSD purchase is the same policy, and always has been. The only way to sell with that feature is privately.'),
      mi_load.ev('S-M-OWN-18', 'thread:tmc-344013', '{"age_years":2}'::jsonb, 'supports', 'The transfer is only to a new vehicle from Tesla. So, no transfer to a used vehicle purchased from Tesla.'))));

-- Acceleration Boost відомий лише з огляду: чесний блок.
select mi_load.stage('M-019', 'm3_lr_awd', 'ent:accel_boost', 'official_fact', 'medium',
  'Acceleration Boost is a 2,000 dollar software purchase offered from December 2019 to Long Range dual motor Model 3 cars on software 2019.40.2 or later, advertised to cut the 0 to 60 mph time from 4.4 to 3.9 seconds.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A Long Range AWD that accelerates like a Performance may carry the boost; it is a right on the car, visible in the account, and it leaves on a resale through the manufacturer.',
    'value_kind', 'cost',
    'value', '{"amount":2000,"currency":"USD","market":"US","as_of":"2019-12-18","zero_to_sixty_s":[4.4,3.9]}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_ref('model_line', 'line:model_3', 1)),
    'ev', jsonb_build_array(mi_load.ev('S-M-REV-11', null, null, 'supports', 'Tesla offered Long Range dual-motor Model 3 owners who had software version 2019.40.2 the option to purchase a 2,000 dollar Acceleration Boost software upgrade, advertised to reduce 0-60 mph time from 4.4 s to 3.9 s.'))));

select mi_load.stage('M-020', 'm3_lr_awd', 'ent:m3_pc_life', 'owner_pattern', 'medium',
  'Cars ordered before 1 July 2018 were grandfathered with free Premium Connectivity for the life of the car; owners report it passing to a private buyer, but being stripped on cars the manufacturer resold and on most private resales after January 2020, and a used 2018 car delivered in 2021 got only a one month trial.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Lifetime connectivity on an early 2018 car is a bonus to verify in the account, not something to pay for.',
    'applic', jsonb_build_array(mi_load.p_ref('model_line', 'line:model_3', 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-16', 'thread:tmc-357443', '{"age_years":8}'::jsonb, 'supports', 'They grandfathered all cars ordered up to June 30, 2018 with free premium connectivity for the life of the vehicle. It transfers to subsequent owners when the car is sold private party; the app now says it is not transferable to another owner.'),
      mi_load.ev('S-M-OWN-17', 'thread:tmc-220846', '{"age_years":3}'::jsonb, 'supports', 'Right after my used 2018 M3 LR RWD was delivered on 1/2/21 ... I was informed I had a 1-month free trial of premium connectivity. A Tesla support rep told me that this did not apply to resales after a certain date.'))));

select mi_load.stage('M-021', 'm3_lr_awd', 'issue:m3_salvage_fast_charging', 'owner_pattern', 'high',
  'Salvage titled Model 3 cars lose Supercharging under the unsupported vehicle policy of 2020, some had it restored in August 2021 and lost it again after the 2020.48 update, and by 2022 the manufacturer offers two paid inspections that can re-enable it; owners of blocked cars use a CCS1 adapter with the updated charge port controller to charge at third party direct current chargers.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'For an auction car with a salvage title, assume Supercharging is off until the manufacturer inspections are paid for and passed; third party fast charging needs the CCS1 controller and an adapter, and both must be tested before purchase.',
    'applic', jsonb_build_array(mi_load.p_ref('model_line', 'line:model_3', 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-27', 'thread:tmc-217848', '{"age_years":2}'::jsonb, 'supports', 'Anyone with a salvage title model 3 should expect this to happen at some point ... Supercharging is permanently disabled. A Salvage-Titled Vehicle HV Safety Inspection may be performed at the customer expense.'),
      mi_load.ev('S-M-OWN-29', 'thread:tmc-338751', '{"age_years":5}'::jsonb, 'supports', 'I have a 2019 salvage title Model 3. I have had it for 2.5 years. I lost SC capability about 2 years ago, so I have been using the CCS1 adapter to DC fast charge.'),
      mi_load.ev('S-M-OWN-28', 'thread:tmc-189858', null, 'supports', 'Salvage titles get fast charging disabled, per Teslas unsupported vehicle policy.'),
      mi_load.ev('S-M-REV-07', null, null, 'context', 'Supercharging and/or fast charging through 3rd party chargers of the Salvage-Titled vehicle is permanently disabled, memo of February 2020.'),
      mi_load.ev('S-M-REV-08', null, null, 'context', 'The salvaged vehicles would need to pass two inspections: the Salvage-Titled Vehicle High Voltage Safety Inspection and the Salvage-Titled Vehicle Fast-Charging Safety Inspection. Fast charging will not be enabled if the customer declines to authorize the required repairs.'),
      mi_load.ev('S-M-REV-10', null, null, 'context', 'Several salvaged Model 3 owners chimed in to say they also gained access to the Supercharger network, August 2021.'))));

-- ---------- M3. Autopilot і софт покоління ----------

select mi_load.stage('M-022', 'm3_lr_awd', 'gen:m3', 'official_fact', 'medium',
  'Model 3 cars built for North America from May 2021 have no forward radar and rely on the camera only Tesla Vision system; the ultrasonic parking sensors were dropped in October 2022.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A car built after May 2021 drives on cameras alone; an early 2021 or older car still carries the radar, which matters for the driver assistance complaints below.',
    'value_kind', 'date_window',
    'value', '{"radar_removed_from":"2021-05","ultrasonic_removed_from":"2022-10"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-32', null, null, 'supports', 'Tesla Vision eliminates the forward-facing radar starting in May 2021 from the Autopilot hardware package on Model 3 and Model Y vehicles built for the North American market.'),
      mi_load.ev('S-M-AGG-01', null, null, 'context', 'The adaptive cruise control radar sensor was eliminated in April 2021 and the ultrasonic sensors used for park assist were eliminated in October 2022 and replaced with Tesla Vision.'))));

select mi_load.stage('M-023', 'm3_lr_awd', 'issue:m3_phantom_braking', 'known_issue', 'high',
  'NHTSA opened investigation PE22-002 in February 2022 after 354 complaints of unexpected braking under cruise control or Autopilot on 2021 and 2022 Model 3 and Model Y cars, and closed it in June 2026 without a manufacturer action after reports fell sharply following firmware changes of 2022.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'On a 2021 or 2022 car expect the driver assistance to brake unexpectedly on older firmware; a car that has been offline since 2022 still runs that firmware.',
    'value_kind', 'document_ref',
    'value', '{"investigation":"PE22-002","opened":"2022-02-16","closed":"2026-06-29","complaints_at_opening":354}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2021, 2022, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-25', null, null, 'supports', 'The Office of Defects Investigation has received 354 complaints alleging unexpected brake activation in 2021-2022 Tesla Model 3 and Model Y vehicles ... the vehicle unexpectedly applies its brakes while driving at highway speeds.'),
      mi_load.ev('S-M-OFF-26', null, null, 'supports', 'This Preliminary Evaluation is closed without a manufacturer action. Date Closed: 06/29/2026.'))));

-- ---------- M4. Відклики з фізичним ремонтом ----------

select mi_load.stage('M-024', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Recall 21V-00D covers all 2017 to 2020 Model 3 cars, 356,309 built between 15 July 2017 and 30 September 2020: the solid core coaxial cable of the trunk lid harness wears with trunk cycles and the rearview camera feed disappears; service inspects the harness and fits a guide protector or a new harness, SB-21-17-008.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Every 2018 to 2020 car is in this campaign; a car without the guide protector or with a dead rear camera has not had it done.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"21V00D000","tesla_ref":"SB-21-17-008","units":356309,"production_from":"2017-07-15","production_to":"2020-09-30"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2017, 2020, 1),
      mi_load.p_date('production_date', date '2017-07-15', date '2020-09-30', 2)),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-15', null, null, 'supports', 'The Model 3 trunk harness is equipped with a solid core coaxial cable that provides the rearview camera feed ... repeated opening and closing of the trunk lid may cause excessive wear to the coaxial cable. Number of potentially involved: 356,309. Production Dates: JUL 15, 2017 - SEP 30, 2020.'))));

select mi_load.stage('M-025', 'm3_lr_awd', 'issue:m3_trunk_harness', 'known_issue', 'medium',
  'Owners of 2018 cars report the rear camera failing again after the harness recall or the recall never being completed on their car, and the manufacturer charging for the repair when the campaign is marked done.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Test the rear camera; if it drops out, the harness needs the campaign repair or a second one.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-15', null, null, 'context', 'Tesla Service will inspect the trunk harness on affected vehicles for wear.'),
      mi_load.ev('S-M-OWN-31', 'odi:11676225', '{"age_years":7}'::jsonb, 'supports', 'Backup camera recall was not fixed properly or the new parts have same issue. As a result the backup camera was not functioning.'),
      mi_load.ev('S-M-OWN-31', 'odi:11690203', '{"age_years":7}'::jsonb, 'supports', 'I believe my car should be included in the recall for trunk harness recall. My alert and issue is the rear camera being off due to rear trunk ruining the wiring harness.'),
      mi_load.ev('S-M-OWN-31', 'odi:11619569', '{"age_years":6}'::jsonb, 'supports', 'The rear camera routine fails to activate. I wonder if this related to the trunk harness issue. I tried contact Tesla, but they want to charge for a repair.'))));

select mi_load.stage('M-026', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Two recalls cover front lateral link fasteners that may loosen and let the link separate from the subframe: 21V-835 on 2,791 select 2019 to 2021 Model 3 cars built 3 January 2019 to 20 April 2021 (about 2 percent affected, SB-21-31-003) and 23V-235 on 422 select 2018 to 2019 cars built 5 January 2018 to 30 March 2019 (SB-23-31-001); service inspects and re-torques or replaces the fasteners.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A car built between January 2018 and April 2021 may be in one of the two campaigns; the inspection is quick and the failure mode is a loss of steering control.',
    'value_kind', 'document_ref',
    'value', '{"campaigns":["21V835000","23V235000"],"tesla_refs":["SB-21-31-003","SB-23-31-001"],"units":[2791,422]}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2018, 2021, 1),
      mi_load.p_date('production_date', date '2018-01-05', date '2021-04-20', 2)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-16', null, null, 'supports', 'Number of potentially involved: 2,791. Estimated percentage with defect: 2%. Production Dates: JAN 03, 2019 - APR 20, 2021. The front suspension lateral link is attached to the sub-frame using two fasteners. If a fastener is not secured to the correct specification, the fastener may loosen over time or separate from the sub-frame.'),
      mi_load.ev('S-M-OFF-17', null, null, 'supports', 'Number of potentially involved: 422. Production Dates: JAN 05, 2018 - MAR 30, 2019. From service data covering January 2018 through March 2023, Tesla identified 25 warranty claims.'))));

select mi_load.stage('M-027', 'm3_lr_awd', 'issue:m3_lateral_link', 'known_issue', 'high',
  'On 29 July 2026 NHTSA opened investigation PE26006 into 156 complaints of the front lower lateral link detaching on 2018 to 2020 Model 3 and 2021 to 2023 Model Y cars, about 1.2 million vehicles, beyond the population and the production cause of the two earlier recalls; most cases had no warning, some a noise, and the car usually had to be towed.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'On a 2018 to 2020 car the lateral link joints and fasteners deserve a physical inspection whatever the recall status says; a front end clunk is a stop sign until it is found.',
    'value_kind', 'document_ref',
    'value', '{"investigation":"PE26006","opened":"2026-07-29","complaints":156,"population":1198300}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2018, 2020, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-27', null, null, 'supports', 'The Office of Defects Investigation has received 156 complaints alleging a suspension failure in model year 2018-2020 Model 3 and MY 2021-2023 Model Y vehicles. The suspension failure involves the detachment of the front lower lateral link ... The subject failures for this investigation exceed the scope of these recalls and do not appear to be related to the production issue that prompted those recalls.'),
      mi_load.ev('S-M-OWN-31', 'odi:11754256', '{"mileage_km":163700}'::jsonb, 'supports', 'I am the owner of a 2018 Tesla Model 3. At approximately 101,728 miles, my vehicle experienced a severe front suspension failure, in direct relation to NHTSA Preliminary Evaluation PE26006.'),
      mi_load.ev('S-M-OWN-31', 'odi:11757214', '{"age_years":8}'::jsonb, 'supports', 'I am reporting a front suspension failure on my 2018 Tesla Model 3 Dual Motor ... While driving slowly in a parking lot, I heard a clunk and felt the front wheel.'))));

select mi_load.stage('M-028', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Recall 21V-387 covers 5,974 select 2019 to 2021 Model 3 cars built 16 December 2018 to 16 March 2021 and 2020 to 2021 Model Y cars: brake caliper fasteners may loosen and let the caliper contact the wheel; service inspects all eight fasteners and re-torques or replaces them, SB-21-33-002.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A car built between December 2018 and March 2021 may be in the campaign; abnormal noise from a wheel is the warning.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"21V387000","tesla_ref":"SB-21-33-002","units":5974}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2019, 2021, 1),
      mi_load.p_date('production_date', date '2018-12-16', date '2021-03-16', 2)),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-18', null, null, 'supports', 'Number of potentially involved: 5,974. Select MY 2019-21 Model 3 vehicles with similar manufacturing records, DEC 16, 2018 - MAR 16, 2021. The brake calipers are attached to the wheel knuckle using two fasteners ... the caliper makes contact with the inner surface of the wheel rim.'))));

select mi_load.stage('M-029', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Recall 21V-389 covers 5,530 select 2018 to 2020 Model 3 cars built 6 July 2018 to 21 March 2020 and 2019 to 2021 Model Y cars where one or both fasteners of the front shoulder belt top loop at the B pillar may not be secured; service inspects and repairs both fasteners, SB-21-20-001.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A physical recall on the front seat belts of the 2018 to 2020 cars; check completion by VIN.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"21V389000","tesla_ref":"SB-21-20-001","units":5530}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2018, 2020, 1),
      mi_load.p_date('production_date', date '2018-07-06', date '2020-03-21', 2)),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-19', null, null, 'supports', 'Number of potentially involved: 5,530. Select MY 2018-20 Model 3 vehicles with similar manufacturing records, JUL 06, 2018 - MAR 21, 2020. During assembly, one or both fasteners may not have been properly secured.'))));

select mi_load.stage('M-030', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Recall 22V-798 covers 24,064 Model 3 cars of 2017 to 2022 identified by service records where the second row left seat belt buckle and centre anchor, fastened by one bolt, may have been reassembled incorrectly during a service action; 105 such cases were confirmed in the United States between May 2019 and August 2022.',
  jsonb_build_object(
    'importance', 1,
    'implication', 'A recall caused by service work, not by production; relevant only if the car was in the identified population.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"22V798000","tesla_ref":"SB-22-20-004","units":24064}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-20', null, null, 'supports', 'Both components may have been incorrectly reassembled after disassembly during a service action. 105 occurrences of incorrect reassembly in the United States were confirmed to have occurred between May 24, 2019 and August 15, 2022. Number of potentially involved: 24,064.'))));

select mi_load.stage('M-031', 'm3_lr_awd', 'var:m3_heatpump', 'official_fact', 'high',
  'Recall 22V-050 covers heat pump cars built from February 2021 to January 2022 on firmware 2021.44 through 2021.44.30.6: after controller communication interruptions the software did not close the electronic expansion valve, refrigerant could get trapped in the evaporator and the compressor stopped, with a loss of cabin heating and defrost in temperatures of minus 10 C or colder; firmware 2021.44.30.7 or later is the remedy.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A software remedy on the heat pump cars; a car offline since early 2022 may still run the affected firmware.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"22V050000","tesla_ref":"SB-22-18-002","units":26681,"remedy_firmware":"2021.44.30.7"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2021, 2022, 1)),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-21', null, null, 'supports', 'In vehicles built with heat pump, the Electronic Expansion Valve may experience controller communication interruptions ... may result in fail-safe compressor stoppage, and cause loss of cabin heating, particularly in temperatures -10 C or colder. Firmware release 2021.44.30.7 and later releases remedy the condition.'))));

select mi_load.stage('M-032', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Recall 25V-092 covers 376,241 model year 2023 Model 3 and Model Y cars built for the United States between 28 February and 11 October 2023 on software before 2023.38.4: an overvoltage can overstress the power steering circuit board and assist is lost when the car stops and moves again, after the alert Steering assist reduced; the over the air remedy shipped from 19 October 2023.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'On a 2023 car the software fix is the remedy, but a board that already suffered the overstress needs a new steering rack; the alert Steering assist reduced in the history is the sign.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"25V092000","tesla_ref":"SB-25-00-004","units":376241,"remedy_software":"2023.38.4"}'::jsonb,
    'applic', jsonb_build_array(
      mi_load.p_num('model_year', 2023, 2023, 1),
      mi_load.p_date('production_date', date '2023-02-28', date '2023-10-11', 2)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-22', null, null, 'supports', 'On certain vehicles equipped with electronic power-assisted steering and operating with a software release prior to 2023.38.4, an overvoltage breakdown may overstress motor drive components on the printed circuit board. Production Dates: FEB 28, 2023 - OCT 11, 2023. Number of potentially involved: 376,241.'),
      mi_load.ev('S-M-OWN-36', 'odi:11554611', '{"mileage_km":3700}'::jsonb, 'context', 'Vehicle started displaying warning messages: steering assist reduced and lane departure avoidance features unavailable, at 2,300 miles.'))));

select mi_load.stage('M-033', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Recall 23V-434 covers about 26 model year 2023 Model 3 and Model Y cars, the Model 3 cars built on 21 May 2023, whose pyrotechnic battery disconnect may be defective and not isolate the high voltage battery in a crash; service replaces the disconnect, SB-23-16-005.',
  jsonb_build_object(
    'importance', 1,
    'implication', 'A tiny population; only a car built on that day is concerned.',
    'value_kind', 'document_ref',
    'value', '{"campaign":"23V434000","tesla_ref":"SB-23-16-005","units":26}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2023, 2023, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-23', null, null, 'supports', 'NHTSA acknowledgement of recall 23V-434, pyrotechnic battery disconnect, 2023 Model 3 and Model Y.'),
      mi_load.ev('S-M-OFF-24', null, null, 'supports', 'Tesla is recalling certain 2023 Model 3 and Model Y vehicles. The pyrotechnic battery disconnect may be defective. Tesla Service will replace the pyrotechnic battery disconnect, free of charge.'))));

select mi_load.stage('M-034', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Most other Model 3 recalls are software delivered over the air and only reach a connected car: rolling stop 22V-037, chime 22V-045, Boombox 22V-063 and 22V-235, window reversal 22V-702, tail lights 22V-844 on 2023 cars, Full Self-Driving Beta 23V-085, Autosteer controls 23V-838, warning light font 24V-051, pedestrian warning sound 24V-153, seat belt chime 24V-376, hood latch 24V-554 on 2021 and later cars, tyre pressure warning 24V-935 and rear view 26V-283; the headlight low beam recall 26V-507 on 2017 to 2023 cars had its remedy still under development in August 2026 with letters expected on 3 October 2026.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A car that has been offline, or that lost connectivity abroad, may carry several open software recalls at once; one recall of 2026 has no remedy yet.',
    'value_kind', 'document_ref',
    'value', '{"ota_campaigns":["22V037000","22V045000","22V063000","22V235000","22V702000","22V844000","23V085000","23V838000","24V051000","24V153000","24V376000","24V554000","24V935000","26V283000"],"pending":"26V507000"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-24', null, null, 'supports', 'Tesla will perform an over-the-air software update, free of charge (22V037, 22V045, 22V063, 22V235, 22V702, 22V844, 23V085, 23V838, 24V051, 24V153, 24V376, 24V554, 24V935, 26V283). 26V507000: The headlight low beams may be too bright and exceed the maximum light output. The remedy is currently under development. Owner notification letters are expected to be mailed October 3, 2026.'))));

-- ---------- M5. Тепло ----------

select mi_load.stage('M-035', 'm3_lr_awd', 'issue:m3_heatpump_sensor', 'known_issue', 'high',
  'The manufacturer acknowledged in bulletin SB-21-18-001 of March 2021 that refrigerant pressure and temperature sensors on the heat pump of 2020 and 2021 Model 3 and Model Y cars can fault over time and prescribed replacing all three, and in August 2022 turned it into campaign bulletin SB-21-18-002 applied to the affected VIN list without waiting for a complaint; owners reported the compressor stopping and no heat in the cold.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'On a 2021 or 2022 car ask whether the three sensors were replaced under the campaign; a car that never went to service since 2022 probably still has the original sensors.',
    'value_kind', 'document_ref',
    'value', '{"bulletins":["SB-21-18-001","SB-21-18-002"],"parts":["1510047","1510048"],"time_h":1.0}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-11', null, null, 'supports', 'Some Model 3 and Model Y vehicles may be equipped with refrigerant pressure/temperature (P/T) sensors in the heat pump that can fault over time. If symptoms are present, replace all 3 refrigerant P/T sensors.'),
      mi_load.ev('S-M-OFF-12', null, null, 'supports', 'Campaign Bulletin SB-21-18-002 R6, August 17, 2022, 2020-2021 Model 3, Model Y heat pump: Replace all 3 refrigerant P/T sensors. Correction time 1.00.'),
      mi_load.ev('S-M-OWN-01', 'thread:tmc-217576', '{"mileage_km":2000}'::jsonb, 'supports', 'My 2021 LR AWD with 2000 km failed yesterday in -5 degree weather here in Ontario. Tesla service diagnosed problem as hardware related.'),
      mi_load.ev('S-M-OWN-34', 'odi:11509108', '{"mileage_km":29500}'::jsonb, 'supports', 'AC/Heat pump total failure at 18,317 miles. Due to cold weather in Michigan and simply running the car, the heat pump went out entirely ... the windows could not be defrosted.'),
      mi_load.ev('S-M-REV-13', null, null, 'context', 'In March of this year Tesla issued an internal service bulletin SB-21-18-002 to replace refrigerant pressure/temperature sensors in the heat pumps of 2020 and 2021 Model 3 and Model Y cars.'))));

select mi_load.stage('M-036', 'm3_lr_awd', 'issue:m3_heatpump_sensor', 'owner_pattern', 'medium',
  'Owners of 2021 heat pump cars report the loss of heat and defrost returning after a repair or a software fix, at 7,500 and then 84,000 miles on one car and at 56,000 miles as a failed super manifold on another, always in freezing weather.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A heat pump car needs a heat and defrost test in the cold and a look at the service history for repeat visits; out of warranty the manifold repair costs thousands.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-34', 'odi:11711146', '{"mileage_km":135200}'::jsonb, 'supports', 'HVAC system went out at 7500ish miles. It was repaired under warranty, and a fix was administered through software by tesla. My HVAC has gone out again at 84k miles for the same reason.'),
      mi_load.ev('S-M-OWN-34', 'odi:11499129', '{"mileage_km":90100}'::jsonb, 'supports', 'The supermanifold failed, causing the front defroster to not work properly, resulting in loss of visibility in freezing temperatures. This is a common problem with 2021/2022 model 3/model y with the new heat pump.'),
      mi_load.ev('S-M-OWN-02', 'thread:too-20148', '{"age_years":1}'::jsonb, 'supports', 'When the compressor cuts off because of low suction pressure it probably does not come back on, because the pressure sensor is a safety device; you get an error in the cabin that the HVAC system needs service.'))));

select mi_load.stage('M-037', 'm3_lr_awd', 'issue:m3_ptc_failure', 'owner_pattern', 'high',
  'On the 2018 to 2020 cars with the resistive heater, owners report the heater stopping in winter and paying 850 dollars at 54,000 miles, 1,200 dollars at 175,000 miles, 1,104 dollars quoted at 63,617 miles and six years, and 2,158 Canadian dollars at 81,847 km for a heater and superbottle; one 2020 car recovered after a software update instead.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'A pre-refresh car out of warranty carries a heater repair of roughly one to two thousand dollars as a plausible near term cost; test the heat before buying, especially in a cold country.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-24', 'thread:tmc-255178', '{"mileage_km":86900}'::jsonb, 'supports', 'Eventually I had to pay 850 dollars for a new PTC heater as my car is out of warranty. 54k, my car spent about 52k miles in northern Michigan. Another poster: Tesla service is quoting 1200 dollars for PTC replacement, out of warranty, 175k miles.'),
      mi_load.ev('S-M-OWN-31', 'odi:11625537', '{"mileage_km":102400}'::jsonb, 'supports', 'PTC Heater failed at 63,617 miles after 6 years of use. Warning message: Vehicle may not restart. Repair quoted 1,104.18 dollars.'),
      mi_load.ev('S-M-OWN-26', 'thread:too-29888', '{"mileage_km":81847}'::jsonb, 'supports', 'On February 14th 2023, 3 years and 2 months into ownership, the PTC heater and Superbottle failed. Mileage was 81,847 km. I paid the 2,158.09 dollars to have it repaired.'),
      mi_load.ev('S-M-OWN-25', 'thread:tmc-325149', '{"age_years":4}'::jsonb, 'context', 'My heater stopped blowing warm air two weeks ago on my 2020 model 3+; told the cost of PTC heater replacement is about 800 euro but an OTA update 2024.8.9 has solved the issue.'))));

-- ---------- M6. 12 В батарея ----------

select mi_load.stage('M-038', 'm3_lr_awd', 'issue:m3_lv_lead_acid', 'owner_pattern', 'high',
  'Owners of the lead acid cars report the 12 V battery dying at about two years, often without the warning message, with the car immobile the next morning and towed; heat shortens the life, and the manufacturer sells the replacement for under 100 dollars.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'On a 2018 to 2021 car older than two years, budget a 12 V battery before the first long trip; a car that sat at auction is the typical candidate.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-03', 'thread:tmc-205672', '{"age_years":2}'::jsonb, 'supports', 'I am in the really hot Palm Desert area. I just had both M3 require batteries at the same time. Common denominator: 2 years old. 12v warning occurs and the following morning the vehicle will not start.'),
      mi_load.ev('S-M-OWN-04', 'thread:tmc-248855', '{"age_years":2}'::jsonb, 'supports', 'I also got the message. Right around the 24 month mark. You run the real risk of walking out there one morning and the car not starting, and needing to be towed to the service center, lots of reports of that with model 3 12V battery failure.'),
      mi_load.ev('S-M-OWN-05', 'thread:tmc-302725', '{"age_years":2}'::jsonb, 'supports', 'My 2021 Tesla model 3 12 volt battery just died without any warning. Only two years old as well as my neighbours 2021 Y. Lead-acid batteries are generally good for four to five years; a very warm climate can significantly shorten that.'),
      mi_load.ev('S-M-OWN-31', 'odi:11503755', '{"age_years":5}'::jsonb, 'supports', 'I received many system malfunction errors on the screen, stating such that the 12v battery needed replacing, while the car had been charging overnight.'))));

-- ---------- M7. Підвіска і кузов ----------

select mi_load.stage('M-039', 'm3_lr_awd', 'issue:m3_uca_creak', 'known_issue', 'high',
  'Campaign bulletin SB-20-31-006 of the manufacturer covers 2018 to 2020 Model 3, Model Y and Model X cars where water reaches both front upper control arm ball joints, corrodes their surface and causes a creak when steering at low speed under load; the fix reseals the joints with urethane, and the manufacturer calls it a noise condition that does not lead to premature failure.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A creak on the steering at parking speed on a 2018 to 2020 car is this known condition; the campaign fix is cheap, and owners who replace the arms are paying for silence, not safety.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SB-20-31-006","revision":"R2","date":"2021-07-01"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2018, 2020, 1)),
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-13', null, null, 'supports', 'On certain Model 3, Model Y, and Model X vehicles, there may be a water ingress path to both front upper control arm ball joints that, over time, could possibly lead to surface corrosion ... a creaking sound coming from the front suspension when steering at low speeds and under high loads. This is exclusively an NVH condition only and does not result in premature failure of the ball joints. Reseal the area around the ball joints using urethane.'),
      mi_load.ev('S-M-OWN-09', 'thread:too-18675', '{"age_years":1}'::jsonb, 'supports', 'There is some sort of creaking/ticking noise coming from the front right side of my 2021 model 3 long-range. It only happens at low speeds.'),
      mi_load.ev('S-M-OWN-31', 'odi:11756085', '{"age_years":8}'::jsonb, 'supports', 'Lots of creaking and grinding noises coming from both front upper control arm bushings.'),
      mi_load.ev('S-M-REV-12', null, null, 'context', 'Tesla has begun contacting some Model 3 owners in an effort to proactively address a common upper control arm issue; the fix involves resealing the upper control arms with a urethane paste.'))));

select mi_load.stage('M-040', 'm3_lr_awd', 'issue:m3_trunk_leak', 'known_issue', 'high',
  'Bulletin SB-23-10-002 of the manufacturer, revised in October 2023, covers 2017 to 2023 Fremont built Model 3 cars where water leaked into the trunk through the trunk lid; the repair reseals the lamp can panels inside the lid with sealant, 2.45 hours, replacing the trunk seal only if needed; owners report repeated leaks into the lower trunk on 2020 and 2022 cars even after seal replacements.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Look for water, staining and a damp lower trunk on any of these cars; the manufacturer fix is a reseal of the lid, not a new seal, and a car that was only given new seals will leak again.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SB-23-10-002","revision":"R3","date":"2023-10-17","time_h":2.45}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-10', null, null, 'supports', 'On some Model 3 vehicles, water may have leaked inside the trunk area through the trunk lid. Inspect inside the trunk area for signs of water leaks that came through the trunk lid. If this symptom is present, reseal the trunk lid. Model Year 2017 - 2023, Model 3, Build Location Fremont.'),
      mi_load.ev('S-M-OWN-10', 'thread:tmc-337277', '{"age_years":4}'::jsonb, 'supports', 'So I have a 2020 model 3 long range and when it rains water will drip into the trunk around the seal which has been replaced multiple times by Tesla and yearly when it rains it still leaks. The car is now out of warranty.'),
      mi_load.ev('S-M-OWN-11', 'thread:too-31421', '{"age_years":1}'::jsonb, 'supports', 'I have a 2022 Model 3 and I am experiencing a trunk leak. After it rains and I open the trunk lid, I notice water leaking in, dripping, into the trunk on the passenger side. I have taken the car to Tesla twice already.'),
      mi_load.ev('S-M-OWN-33', 'odi:11574947', '{"age_years":4}'::jsonb, 'supports', 'The back trunk seal fails at the rear of the vehicle allowing water to spill into the trunk and deep trunk and cause flooding. I have had it repaired multiple times and the technician says that is a known issue.'))));

select mi_load.stage('M-041', 'm3_lr_awd', 'issue:m3_charge_port_door', 'owner_pattern', 'medium',
  'Owners of 2018 cars report the charge port door failing to open or close because the position magnet falls off or the actuator clutch wears; the door assembly replacement costs about 300 to 350 dollars out of warranty, and one 2018 Long Range with a persistent charging fault got a 1,500 dollar estimate for the front body controller after the door and the charge port controller were replaced.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Open and close the charge port door several times and start a charge; a sticking door is cheap, a charging fault that survives a new door is not.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-23', 'thread:too-30216', '{"age_years":5}'::jsonb, 'supports', 'The magnet corner piece fell off and the door does not open or close. Very common issue for the 2018 Model 3. Being out of warranty, you are going to have to pay to have your charge port mechanism replaced. The cost was around 300-350 dollars.'),
      mi_load.ev('S-M-OWN-21', 'thread:tmc-171685', '{"age_years":2}'::jsonb, 'supports', 'Starting this evening, my charging door will not open on my Model 3 ... service center replaced the door.'),
      mi_load.ev('S-M-OWN-22', 'thread:tmc-355606', '{"age_years":8}'::jsonb, 'supports', 'I have a 2018 Model 3 LR and the charge port door is giving me a lot of issue. I replaced the charge port with one from Tesla and the issue is still the same ... they came back with a 1,500 dollar estimate to replace the front body controller.'))));

-- ---------- M8. Пак і зарядка ----------

select mi_load.stage('M-042', 'm3_lr_awd', 'issue:m3_bms_a079', 'owner_pattern', 'high',
  'Owners report the alert BMS_a079 maximum charge level reached, after which the pack no longer charges fully and the manufacturer prescribes a pack replacement: a 2021 car at 138,000 miles, a 2021 car whose pack failed twice under warranty at 15,100 and 57,222 miles, a 2021 Performance at 27,000 miles that only charged on alternating current, and 2021 cars in 2026; a Korean press report counted about 4,500 complaints on Model 3 and Model Y.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'This is the pack failure that costs a pack: read the battery alerts and the true capacity before buying, and price a 2018 to 2021 car outside the battery warranty with a pack replacement in mind.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-34', 'odi:11736600', '{"mileage_km":222100}'::jsonb, 'supports', '2021 M3 138,000 miles. Alerted error code BMS_a074 and BMS_a079. After reading forums, this seems to be a known issue with 2021 in particular.'),
      mi_load.ev('S-M-OWN-34', 'odi:11711847', '{"mileage_km":92100}'::jsonb, 'supports', 'The high-voltage traction battery pack has failed twice on my 2021 Tesla Model 3, both times while the vehicle was under the original battery warranty: at approximately 15,100 miles and at approximately 57,222 miles.'),
      mi_load.ev('S-M-OWN-34', 'odi:11657017', '{"mileage_km":43500}'::jsonb, 'supports', 'My 21 M3P 27K miles threw BMS_a079. I have never used a supercharger and rarely charge over 80%. Vehicle will no longer charge.'),
      mi_load.ev('S-M-OWN-34', 'odi:11741063', '{"age_years":5}'::jsonb, 'supports', 'BMS_a079 error. Battery is no longer able to charge. High voltage battery will need to be replaced.'),
      mi_load.ev('S-M-OWN-12', 'thread:tmc-356233', null, 'supports', 'Getting these errors. Cell 28 showing under 4 V. Can anyone replace it or replace the entire HV battery.'),
      mi_load.ev('S-M-REV-16', null, null, 'context', 'Nearly 4,500 Tesla Model 3 and Model Y owners in South Korea have complained about battery management errors.'))));

-- Вартість заміни паку відома з одного треду власників і спеціаліста:
-- для owner_pattern бракує другої групи власників, чесний блок.
select mi_load.stage('M-043', 'm3_lr_awd', 'fam:m3_pack', 'owner_pattern', 'medium',
  'Out of warranty pack replacement quotes for the Model 3 and Model Y run about 13,000 to 15,000 dollars from the manufacturer, and a customer paid replacement pack carries a 4 year or 50,000 mile parts warranty; a specialist repairs single modules for a fraction of that.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'The worst case on a pack failure is a five figure bill; a module level repair by an independent shop is the cheaper route where one exists.',
    'value_kind', 'cost',
    'value', '{"amount_from":13000,"amount_to":15000,"currency":"USD","market":"US","as_of":"2024-06-01","parts_warranty_years":4,"parts_warranty_miles":50000}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-30', 'thread:tmc-327730', '{"age_years":6}'::jsonb, 'supports', 'Such replacements for Model 3/Y can be around 13K-15K dollars. If you pay for it out of warranty, it has a 4yr 50K mile warranty. Vehicle High Voltage Battery: 4 years or 50,000 miles, whichever comes first.'),
      mi_load.ev('S-M-SPEC-02', null, null, 'context', 'A Tesla Model 3 battery failure does not always mean every cell inside the pack is dead. Often, the entire battery becomes limited by one weak section, one bad module, one failed component, or one group of cells.'))));

select mi_load.stage('M-044', 'm3_lr_awd', 'fam:m3_pack', 'official_fact', 'medium',
  'In its 2023 Impact Report the manufacturer states that Model 3 and Model Y Long Range packs lose 15 percent of capacity on average after 200,000 miles, against 12 percent for Model S and Model X.',
  jsonb_build_object(
    'propagation', 'descendants',
    'note', 'Manufacturer statement about the Long Range pack family as a whole; it applies to both pack revisions of this car.',
    'importance', 3,
    'implication', 'Ordinary loss of 10 to 15 percent at 100,000 to 200,000 miles is normal and outside any warranty; a much larger loss or a limited charge level is a fault, not ageing.',
    'value_kind', 'quantity',
    'value', '{"loss_pct_at_200k_mi":15,"unit":"%"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OFF-31', null, null, 'supports', 'Even after 200,000 miles of usage, our batteries in Model 3 and Model Y lose just 15% of their capacity on average, while batteries in Model S and Model X lose just 12% of their capacity on average.'),
      mi_load.ev('S-M-REV-14', null, null, 'context', 'According to the 2023 Impact Report, the average battery capacity loss of the Model 3 and Model Y Long Range versions after 200,000 miles is 15%; the chart concerns only the Long Range batteries.'),
      mi_load.ev('S-M-REV-15', null, null, 'context', 'A 2021 Model 3 Long Range All-Wheel Drive with 216,000 miles on the odometer.'))));

select mi_load.stage('M-045', 'm3_lr_awd', 'issue:m3_pcs', 'owner_pattern', 'medium',
  'Owners of 2018 cars report stages of the power conversion system in the pack failing so that alternating current charging drops to 16 or 32 A of the 48 A maximum, at 34,000 miles on one car, and the manufacturer refusing to cover the part under the battery and drive unit warranty.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Check the charging current on a wall connector: a car that will not take more than 32 A on alternating current has a failed charger stage, and the repair is disputed under warranty.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-31', 'odi:11482849', '{"mileage_km":54700}'::jsonb, 'supports', 'A portion of the Power Conversion System has failed in my 2018 Tesla Model 3 extended range with 34,000 miles, resulting in the inability to charge the vehicle but at 32 of 48 capable amps.'),
      mi_load.ev('S-M-OWN-31', 'odi:11652488', '{"age_years":6}'::jsonb, 'supports', '2 of the 3 controllers have failed, resulting in limited AC charging, 16A out of 48A max. The PCS helps regulate AC and DC electricity and connects the 12V battery.'),
      mi_load.ev('S-M-OWN-31', 'odi:11464156', '{"age_years":4}'::jsonb, 'supports', 'For a growing number of Model 3 owners, components in the HV Battery Service Panel are breaking down, yet Tesla refuses to cover the repair under its Battery and Drive Unit Warranty. Specifically, the power conversion system in that panel is failing.'))));

-- ---------- M9. Приводи ----------

select mi_load.stage('M-046', 'm3_lr_awd', 'issue:m3_du_failure', 'owner_pattern', 'low',
  'Rear drive unit failures are reported as single cases rather than a pattern: an internal failure at 12,000 miles on a Long Range built in June 2018, replaced under warranty, a car whose rear unit failed twice within a year, and an input shaft bearing failure at 141,000 miles on a 2021 car repaired by the owner; the manufacturer called the failure extremely rare and the rear unit is the same 3D series family across the Long Range cars.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A whine that grows with speed from the rear is a bearing on its way out; out of warranty the manufacturer replaces the whole unit, an independent shop replaces the bearing.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-OWN-07', 'thread:too-14739', '{"mileage_km":19300}'::jsonb, 'supports', 'LR RWD built June 2018, delivered October 2018, with just over 12,000 miles. We found there to be an internal failure of the rear drive unit. We have ordered the new drive unit.'),
      mi_load.ev('S-M-OWN-08', 'thread:tmc-349486', '{"mileage_km":226900}'::jsonb, 'supports', 'So my rear drive unit failed at 141,000 miles. It made whirring noises for about a month and then failed. The gear also machined and rotated the input shaft bearing.'),
      mi_load.ev('S-M-OWN-06', 'thread:tmc-219672', '{"age_years":1}'::jsonb, 'supports', 'We received our Tesla 3 last Dec/Jan, and just had the rear drive unit fail for the second time. First time, Tesla said, oh, extremely rare, will not happen again.'),
      mi_load.ev('S-M-REV-17', null, null, 'context', 'The dual-motor versions of the Model 3, Long Range and Performance, each use the same 3D3 front motor; the Long Range gets the 3D7 rear motor from the RWD variants, whereas the Performance gets the more powerful 3D6 motor.'))));

select mi_load.stage('M-047', 'm3_lr_awd', 'fam:m3_rdu', 'specialist_practice', 'medium',
  'An independent electric vehicle shop repairs Model 3 drive units instead of replacing them: bearing replacement on noise, rotor seal replacement and a coolant flush to prevent corrosion from coolant exposure, and a reduction gear oil change every 50,000 miles, with a 6 month or 20,000 mile warranty on the repair.',
  jsonb_build_object(
    'propagation', 'descendants',
    'note', 'Shop practice for the 3D series rear drive unit family; the Long Range variant is one of its members.',
    'importance', 2,
    'implication', 'A drive unit noise is a repair, not a car write off; the manufacturer itself prescribes no drive unit service, so the oil change is shop practice, not a requirement.',
    'causal', 'plausible_mechanism',
    'contested', true,
    'contested_note', 'The manufacturer service intervals list no drive unit or reduction gear service at all; the 50,000 mile oil change is the practice of one shop.',
    'ev', jsonb_build_array(
      mi_load.ev('S-M-SPEC-01', null, null, 'supports', 'Drive Unit Bearing Replacement: If you hear strange sounds from the motor, it may be a sign that the drive unit bearing needs replacement. Reduction Gear Oil Flush: We advise changing the oil every 50,000 miles. Drive Unit Preventative Care: rotor seal replacement, bearing replacement, and fluid flush, backed by a 2-year or 20,000-mile warranty.'),
      mi_load.ev('S-M-OFF-09', null, null, 'contradicts', 'Your vehicle should generally be serviced on an as-needed basis; the listed intervals are brake fluid, desiccant, cabin filter, wipers, caliper cleaning and tyre rotation.'))));

-- Коди моторів відомі лише з огляду, що читав заводські таблички: чесний
-- блок, але саме він обґрунтовує, чому знання про задній привід ділиться
-- з версією RWD.
select mi_load.stage('M-048', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'medium',
  'The Long Range dual motor car carries the 3D3 induction front motor rated 137 kW and 219 Nm and the 3D7 rear motor rated 194 kW and 340 Nm, the same rear motor as the rear wheel drive car; the Performance uses the 3D6 rear motor rated 220 kW and 440 Nm.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'Rear drive unit knowledge transfers between the Long Range AWD and the rear drive Long Range, but not from the Performance; the front unit is shared by both dual motor cars.',
    'value_kind', 'quantity',
    'value', '{"front":"3D3","front_kw":137,"rear":"3D7","rear_kw":194,"performance_rear":"3D6","unit":"kW"}'::jsonb,
    'ev', jsonb_build_array(
      mi_load.ev('S-M-REV-17', null, null, 'supports', 'The Long Range 3D7 rear motor makes 194kW/340Nm whereas the Performance 3D6 rear motor makes 220kW/440Nm. Again, each has the same 137kW/219Nm front motor. Those codes are stamped on the casing of the motor.'),
      mi_load.ev('S-M-MKT-01', null, null, 'context', 'Drive unit part listings 1120980 and 1120990-00-J low current rear drive unit assembly.'))));

-- ---------- M10. Обслуговування ----------

select mi_load.stage('M-049#a', 'm3_lr_awd', 'maint:m3_brake_fluid', 'official_fact', 'high',
  'The manufacturer prescribes a brake fluid health check every 4 years, replacing only if necessary, with more frequent checks after heavy brake use in hot and humid climates.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 2,
    'implication', 'A car past four years without a brake fluid test is due one; nothing else on the schedule is age driven except the desiccant.',
    'value_kind', 'interval',
    'value', '{"years":4,"action":"check"}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-09', null, null, 'supports', 'Brake fluid health check every 4 years (replace if necessary). Heavy brake usage due to towing, mountain descents, or performance driving, especially for vehicles in hot and humid environments, may necessitate more frequent brake fluid checks and replacements.'))));

select mi_load.stage('M-049#b', 'm3_lr_awd', 'maint:m3_desiccant', 'official_fact', 'high',
  'On cars built before approximately 2021 the air conditioning desiccant bag is to be replaced every 6 years.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 2,
    'implication', 'A 2018 to 2020 car reaches its first desiccant change in 2024 to 2026; skipping it costs cooling and drying performance, not safety.',
    'value_kind', 'interval',
    'value', '{"years":6,"built_before":"2021"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', null, 2020, 1)),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-09', null, null, 'supports', 'Vehicles manufactured prior to approximately 2021: A/C desiccant bag replacement every 6 years.'))));

select mi_load.stage('M-049#c', 'm3_lr_awd', 'maint:m3_cabin_filter', 'official_fact', 'high',
  'The cabin air filter is to be replaced every 2 years and the wiper blades every year; the manufacturer otherwise services the car as needed and lists the low voltage lead acid battery as a consumable outside the schedule.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 1,
    'implication', 'Cheap items that show whether the car was looked after; the maintenance summary on the screen records when they were last reset.',
    'value_kind', 'interval',
    'value', '{"cabin_filter_years":2,"wipers_years":1}'::jsonb,
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-09', null, null, 'supports', 'Cabin air filter replacement every 2 years. Wiper blade replacements every year. The above list does not include consumable parts such as windshield wipers, brake pads, low voltage lead-acid battery.'))));

select mi_load.stage('M-049#d', 'm3_lr_awd', 'maint:m3_brake_cleaning', 'official_fact', 'high',
  'In an area where roads are salted in winter the manufacturer prescribes cleaning and lubricating the brake calipers every year or 12,500 miles (20,000 km), and rotating the tyres every 6,250 miles (10,000 km) or at a 2/32 inch tread difference.',
  jsonb_build_object(
    'layer', 'official',
    'importance', 2,
    'implication', 'On a car from a salt state, seized caliper slides and uneven pads are the expected finding when this was skipped; regenerative braking hides it until the pads rust in place.',
    'value_kind', 'interval',
    'value', '{"caliper_clean_km":20000,"caliper_clean_years":1,"tire_rotation_km":10000}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_tag('condition_tag', 'salt_climate', 1, 'tag_has')),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-09', null, null, 'supports', 'Clean and lubricate brake calipers every year or 12,500 miles (20,000 km) if in an area where roads are salted during winter. Rotate tires every 6,250 miles (10,000 km) or if tread depth difference is 2/32 in (1.5 mm) or greater.'))));

select mi_load.stage('M-050', 'm3_lr_awd', 'gen:m3', 'official_fact', 'high',
  'Bulletin SB-22-33-004 of April 2022 covers 2021 and 2022 heat pump Model 3 cars with the lithium ion low voltage battery built without a hydraulic control unit wake up wire, which in rare cases shows braking and stability control alerts at power on that clear after a power cycle; the fix is a retrofit wire.',
  jsonb_build_object(
    'importance', 1,
    'implication', 'Brake and stability alerts at start up on a late 2021 or 2022 car that vanish after a restart are this wiring omission, not a brake fault.',
    'value_kind', 'document_ref',
    'value', '{"bulletin":"SB-22-33-004","date":"2022-04-30"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2021, 2022, 1)),
    'ev', jsonb_build_array(mi_load.ev('S-M-OFF-14', null, null, 'supports', 'Some Heat Pump Model 3 vehicles were built without a hydraulic control unit wake-up wire, and in rare circumstances, braking and stability control related alerts may appear on the instrument cluster and touchscreen during the vehicle power-on process. Such faults can typically be corrected with a vehicle power cycle.'))));

-- Початок поставок повнопривідної версії відомий лише з новини: чесний блок.
select mi_load.stage('M-051', 'm3_lr_awd', 'ver:m3_lr_awd', 'official_fact', 'medium',
  'The dual motor all wheel drive Model 3 was announced on 20 May 2018 with deliveries from July 2018, so the earliest Long Range AWD cars are model year 2018 cars built from mid 2018.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'A model year 2018 Long Range AWD is a second half of 2018 car; the earliest Model 3 cars of 2017 and early 2018 are rear drive.',
    'value_kind', 'date_window',
    'value', '{"announced":"2018-05-20","deliveries_from":"2018-07"}'::jsonb,
    'applic', jsonb_build_array(mi_load.p_num('model_year', 2018, 2018, 1)),
    'ev', jsonb_build_array(mi_load.ev('S-M-REV-18', null, null, 'supports', 'Tesla starts deliveries of dual-motor Model 3 in July, Musk says, 20 May 2018.'))));

-- ---------- M11. Синтези CalCar ----------
-- Опори підставляються після 130_publish.sql у 132_synthesis_tesla_model_3.sql.

select mi_load.stage('M-052', 'm3_lr_awd', 'ver:m3_lr_awd', 'calcar_synthesis', 'high',
  'Knowledge about this car splits at the October 2020 refresh and again inside model years 2019 and 2022: a 2018 to 2020 car carries the resistive heater, the smaller pack, the Intel computer and the lead acid battery, and a 2021 or later car the heat pump with its sensor campaign and the larger pack; the Autopilot computer of a 2019 car and the infotainment computer and 12 V battery of a 2022 car are read on the screen, not inferred from the year.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Before applying any component knowledge, fix the build side of the refresh and read the two computers on the screen; the year alone misleads on 2019 and 2022 cars.',
    'note', 'Supports: M-009 (official fact), M-035 (known issue).'));

select mi_load.stage('M-053', 'm3_lr_awd', 'ver:m3_lr_awd', 'calcar_synthesis', 'high',
  'For a Model 3 bought at a United States auction and taken abroad assume the worst until the account proves otherwise: no manufacturer warranty service outside the United States and Canada even inside the 8 year battery term, Supercharging and possibly all fast charging disabled on a salvage title until two paid inspections, and Full Self-Driving, Enhanced Autopilot, Acceleration Boost and lifetime connectivity gone unless the car came by private sale.',
  jsonb_build_object(
    'importance', 5,
    'implication', 'These four facts move the price of an imported Model 3 more than any mechanical issue; verify the charging session, the account rights and the title before paying for anything the listing promises.',
    'note', 'Supports: M-007 (official fact), M-021 (owner pattern). First use of importance 5 in the catalogue: the synthesis decides the purchase for the main import scenario.'));

\o
