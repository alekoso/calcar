-- MI Catalog, картка 3: граф сутностей Hyundai Tucson TL 2.4 GDI Theta II, US MY2018-2021.
--
-- Джерело: docs/model-intelligence/reference/hyundai-tucson-tl-24-gdi-my2018-2021.md.
-- Сутності створюються прямо, бо це каталог, а не знання. Кожне ТВЕРДЖЕННЯ
-- про ці сутності йде через staging і gate (126_candidates_hyundai_tucson.sql).
--
-- Правило R1 контракту: знання про підшипники шатунів, KSDS, заміну мотора
-- і витрату оливи живе на варіанті мотора Theta II 2.4 GDI (компонентне
-- знання, однакове для всіх років, де цей мотор стоїть); знання про
-- гарантійні продовження TXXC і TXXI живе на окремому праві, бо вони
-- привʼязані до конкретних VIN 2018..2019, а не до мотора; знання про
-- коробку на варіанті шестиступеневого автомата; про повний привід на
-- обладнанні AWD; про відклик ABS-модуля, кампанію 993 і місце збирання на
-- поколінні TL, бо вони не залежать від мотора.
--
-- Межа, яку граф свідомо тримає: Tucson TL з мотором Nu 2.0 GDI не входить
-- у каталог. Його продовження TXXM/T6G (15 років або 150 тис. миль) і
-- кампанія 966 належать Nu 2.0 і не переносяться на 2.4. Для негативного
-- тесту версія з Nu 2.0 живе лише у фікстурі стенду з синтетичною міткою.

-- ---------- Бренд, ряд, покоління ----------

insert into mi.brand (subject_id, name, country)
values (pg_temp.mk('brand:hyundai', 'brand', 'Hyundai'), 'Hyundai', 'KR');

insert into mi.model_line (subject_id, brand_id, name)
values (pg_temp.mk('line:tucson', 'model_line', 'Hyundai Tucson'), pg_temp.sid('brand:hyundai'), 'Tucson');

-- Покоління TL. Бюлетень відклику 195 (TSB 21-01-010H) називає «2016-2021MY
-- Tucson (TL)»; дати початку і кінця виробництва документами картки не
-- задані, тому обидві межі unknown. Рестайлінг MY2019 окремою фазою не
-- заводиться: 2.4 GDI був уже у MY2018, і дата рестайлінгу не
-- задокументована.
insert into mi.generation (subject_id, model_line_id, platform_code, phase,
    powertrain_types, default_system_profile, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('gen:tl', 'generation', 'Hyundai Tucson TL'),
   pg_temp.sid('line:tucson'), 'TL', 'base', array['ice']::mi.powertrain[], 'ice_default',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- ---------- Версія ----------

-- Одна версія: Tucson TL з мотором 2.4 GDI, передній або повний привід.
-- Привід не ділить версію: EPA дає обидва приводи для кожного року з тим
-- самим мотором і коробкою, і привід розвʼязується обладнанням AWD.
-- Комплектації (SEL, Sport, Limited, Ultimate, Night, Value) аліасами НЕ
-- заводяться: документа, що звʼязує комплектацію з мотором по роках, у
-- картці немає.
insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain) values
  (pg_temp.mk('ver:tucson24', 'vehicle_version', 'Hyundai Tucson TL 2.4 GDI'),
   pg_temp.sid('gen:tl'), 'TL_THETA2_24', '2.4 GDI', 'ice');

-- ---------- Версія x ринок x рік ----------

-- Межі виробництва по модельних роках документами картки не задані, тому
-- всі межі unknown. Модельний рік дає десятий знак VIN.
insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('vmy:tucson24_us_2018', 'version_market_year', 'Hyundai Tucson TL 2.4 GDI US MY2018'),
   pg_temp.sid('ver:tucson24'), 'US', 2018, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('vmy:tucson24_us_2019', 'version_market_year', 'Hyundai Tucson TL 2.4 GDI US MY2019'),
   pg_temp.sid('ver:tucson24'), 'US', 2019, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('vmy:tucson24_us_2020', 'version_market_year', 'Hyundai Tucson TL 2.4 GDI US MY2020'),
   pg_temp.sid('ver:tucson24'), 'US', 2020, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('vmy:tucson24_us_2021', 'version_market_year', 'Hyundai Tucson TL 2.4 GDI US MY2021'),
   pg_temp.sid('ver:tucson24'), 'US', 2021, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- ---------- Родини і варіанти ----------

-- Родина Theta II: спільна для Sonata, Santa Fe Sport, Santa Fe, Tucson і
-- Veloster N (бюлетені T3G, TXXC, TXXI). Варіант 2.4 GDI один: документа
-- про ревізію підшипників чи блоку між 2018 і 2021 немає, тому ревізій не
-- заводиться. Код G4KJ джерелами картки не названий і не пишеться.
insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en) values
  (pg_temp.mk('fam:theta2', 'component_family', 'Hyundai Theta II inline four'), pg_temp.sid('brand:hyundai'),
   'HYUNDAI_THETA_II', 'engine',
   'Inline four cylinder petrol engine family with aluminium block and head and dual continuously variable valve timing, built as 2.0 turbo and 2.4 direct injection versions'),
  (pg_temp.mk('fam:hyundai_6at', 'component_family', 'Hyundai six-speed automatic transaxle'), pg_temp.sid('brand:hyundai'),
   'HYUNDAI_6AT', 'transmission',
   'Front wheel drive based six-speed automatic transaxle filled with ATF SP-IV');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (pg_temp.mk('var:theta2_24_gdi', 'component_variant', 'Hyundai Theta II 2.4 GDI'), pg_temp.sid('fam:theta2'),
   'THETA2_24_GDI', 'Theta II 2.4 litre gasoline direct injection, 2,359 cc, bore 88 mm, stroke 97 mm',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (pg_temp.mk('var:tucson24_6at', 'component_variant', 'Hyundai six-speed automatic, Tucson TL 2.4'), pg_temp.sid('fam:hyundai_6at'),
   'TL24_6AT', 'Six-speed automatic of the Tucson TL 2.4, 6.7 litre ATF fill',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- ---------- Комплектація ----------

-- Мотор і коробка standard для всіх чотирьох років за EPA (S6, 2.4 L,
-- SIDI) і специфікацією MY2019.
insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values
  (pg_temp.sid('vmy:tucson24_us_2018'), 'engine',       pg_temp.sid('var:theta2_24_gdi'), 'standard'),
  (pg_temp.sid('vmy:tucson24_us_2018'), 'transmission', pg_temp.sid('var:tucson24_6at'),  'standard'),
  (pg_temp.sid('vmy:tucson24_us_2019'), 'engine',       pg_temp.sid('var:theta2_24_gdi'), 'standard'),
  (pg_temp.sid('vmy:tucson24_us_2019'), 'transmission', pg_temp.sid('var:tucson24_6at'),  'standard'),
  (pg_temp.sid('vmy:tucson24_us_2020'), 'engine',       pg_temp.sid('var:theta2_24_gdi'), 'standard'),
  (pg_temp.sid('vmy:tucson24_us_2020'), 'transmission', pg_temp.sid('var:tucson24_6at'),  'standard'),
  (pg_temp.sid('vmy:tucson24_us_2021'), 'engine',       pg_temp.sid('var:theta2_24_gdi'), 'standard'),
  (pg_temp.sid('vmy:tucson24_us_2021'), 'transmission', pg_temp.sid('var:tucson24_6at'),  'standard');

-- ---------- Обладнання ----------

-- Повний привід і кнопковий запуск опційні у кожному році: EPA дає окремі
-- записи FWD і AWD, посібник власника MY2020 показує і замок запалювання,
-- і кнопку Engine Start/Stop. Доступність опції не доводить наявність,
-- тому знання про ці пункти умовне, доки ідентичність не скаже.
insert into mi.equipment_item (subject_id, brand_id, equipment_key, item_kind, name_en) values
  (pg_temp.mk('eq:tucson_awd', 'equipment_item', 'Hyundai Tucson TL all-wheel drive'), pg_temp.sid('brand:hyundai'),
   'tucson_tl_awd', 'system_config', 'All-wheel drive with AWD LOCK mode'),
  (pg_temp.mk('eq:tucson_push_start', 'equipment_item', 'Hyundai Tucson TL smart key with push button start'), pg_temp.sid('brand:hyundai'),
   'tucson_tl_push_button_start', 'option', 'Smart key with Engine Start/Stop button');

insert into mi.equipment_availability (vmy_id, item_id, availability)
select pg_temp.sid(v), pg_temp.sid(i), 'optional'
  from unnest(array['vmy:tucson24_us_2018','vmy:tucson24_us_2019','vmy:tucson24_us_2020','vmy:tucson24_us_2021']) v,
       unnest(array['eq:tucson_awd','eq:tucson_push_start']) i;

-- ---------- Аліаси ----------

-- «2.4» окремо заведено свідомо: у межах Tucson TL US 2018..2021 інших
-- моторів 2.4 немає, а текст без інших слів («Tucson 2.4 AWD») інакше не
-- резолвиться. Матчер шукає мітку як суцільну послідовність токенів, тому
-- «2.0 4 AWD» чи «4 2» мітку «2.4» не дають (перевірено тестом). «2.0»,
-- «GDI» і назви комплектацій не аліаси.
insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id) values
  (pg_temp.sid('ver:tucson24'), '2.4L',         '2.4l',         'en', 'official',  'model_line', pg_temp.sid('line:tucson')),
  (pg_temp.sid('ver:tucson24'), 'Theta II 2.4', 'theta ii 2.4', 'en', 'legal',     'model_line', pg_temp.sid('line:tucson')),
  (pg_temp.sid('ver:tucson24'), '2.4',          '2.4',          'en', 'community', 'model_line', pg_temp.sid('line:tucson'));

-- ---------- Право ----------

-- Продовження гарантії на лонгблок через знос шатунних підшипників: TXXC
-- (10 років або 120 тис. миль) і TXXI (limited lifetime, умови мирової
-- угоди). Обидва бюлетені кажуть «Certain 2018-2019 MY Tucson (TL) vehicles
-- with Theta II 2.4L GDI engines», тому стан права на конкретному VIN
-- розвʼязує лише перевірка у дилера. Клейми про право несуть предикат
-- версії: права бренду компілятор бере у кожен фрагмент бренду.
insert into mi.entitlement (subject_id, brand_id, entitlement_key, name_en, binding,
    transferable_private, transferable_dealer, revocable, revoke_reasons,
    network_dependency, requires_variant_id) values
  (pg_temp.mk('ent:tucson_theta_ext', 'entitlement', 'Theta II rod bearing warranty extensions TXXC and TXXI (Tucson TL 2.4)'),
   pg_temp.sid('brand:hyundai'), 'theta2_rod_bearing_extension_tucson_tl', 'Engine long block warranty extensions TXXC and TXXI', 'vin',
   true, true, true,
   array['vehicle previously deemed a total loss (salvage or branded title), lifetime extension',
         'exceptional neglect',
         'knock sensor detection software update not completed, lifetime extension'],
   false, pg_temp.sid('var:theta2_24_gdi'));

-- ---------- Проблеми ----------

insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity) values
  (pg_temp.mk('issue:theta24_rod_bearing', 'issue', 'Theta II 2.4 GDI connecting rod bearing wear'),
   'theta2_24_rod_bearing_wear', pg_temp.sid('var:theta2_24_gdi'),
   'Connecting rod bearing wear leads to knocking, a P1326 limp mode, seizure or a broken connecting rod',
   'A worn connecting rod bearing knocks with a cyclic metallic noise that rises with engine speed; driven on, the engine can seize or stall at speed, and a broken rod can puncture the block and let oil reach hot surfaces. The only published root cause, machining debris in crankshaft oil passages, belongs to engines built in Alabama for 2011 to 2014 cars; no root cause is published for the Tucson TL engines.',
   'catastrophic', 'mixed'),
  (pg_temp.mk('issue:theta24_oil_consumption', 'issue', 'Theta II 2.4 GDI excessive oil consumption'),
   'theta2_24_oil_consumption', pg_temp.sid('var:theta2_24_gdi'),
   'The engine burns oil between changes until the level is dangerously low',
   null, 'major', 'mileage'),
  (pg_temp.mk('issue:tl_hecu_fire', 'issue', 'Hyundai Tucson TL ABS module short and engine compartment fire'),
   'tucson_tl_hecu_short', pg_temp.sid('gen:tl'),
   'The ABS hydraulic electronic control unit shorts internally and can start an engine compartment fire, parked or driving',
   'Flux residue from soldering at the supplier accumulates on the main circuit board of the ABS module; with heat and humidity it forms a corrosive path and an electrical resistance short.',
   'catastrophic', 'calendar');

-- ---------- Обслуговування ----------

insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code, fluid_spec_code, capacity_note_en) values
  (pg_temp.mk('maint:theta24_oil', 'maintenance_item', 'Tucson TL 2.4 GDI engine oil and filter'),
   pg_temp.sid('var:theta2_24_gdi'), 'engine_oil', null, '4.8 litres (5.07 US quarts), SAE 5W-20 API and ILSAC latest'),
  (pg_temp.mk('maint:theta24_plugs', 'maintenance_item', 'Tucson TL 2.4 GDI spark plugs'),
   pg_temp.sid('var:theta2_24_gdi'), 'spark_plugs', null, null),
  (pg_temp.mk('maint:theta24_coolant', 'maintenance_item', 'Tucson TL 2.4 GDI engine coolant'),
   pg_temp.sid('var:theta2_24_gdi'), 'coolant', null, '7.7 litres (8.14 US quarts), phosphate based ethylene glycol'),
  (pg_temp.mk('maint:tl24_atf', 'maintenance_item', 'Tucson TL 2.4 automatic transmission fluid'),
   pg_temp.sid('var:tucson24_6at'), 'atf', null, '6.7 litres (7.08 US quarts) of ATF SP-IV'),
  (pg_temp.mk('maint:tl_awd_transfer', 'maintenance_item', 'Tucson TL AWD transfer case oil'),
   pg_temp.sid('eq:tucson_awd'), 'transfer_case_fluid', null, null),
  (pg_temp.mk('maint:tl_awd_diff', 'maintenance_item', 'Tucson TL AWD rear differential oil'),
   pg_temp.sid('eq:tucson_awd'), 'differential_fluid', null, null);

-- ---------- Перевірки ----------

-- Мітки унікальні в межах каталогу (мапа ключів продакшн-бандла іде по
-- мітках), тому перевірки дати і відкликів названі з моделлю.
insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
    cannot_prove_en, conditions, default_priority, materially_resolves, resolves_dimension) values
  (pg_temp.mk('chk:theta24_knock', 'check_item', 'Cold start and rev test for connecting rod knock'),
   'cold_start', pg_temp.sid('var:theta2_24_gdi'),
   'A worn connecting rod bearing announces itself as a metallic knock that rises with engine speed before the engine fails.',
   'Whether the engine knocks now from a cold start and under light revving.',
   'A quiet engine does not prove healthy bearings; early wear is inaudible and the manufacturer measures bearing clearance with a special tool.',
   array['engine cold, after an overnight stand'], 'must', false, null),
  (pg_temp.mk('chk:theta24_p1326', 'check_item', 'Read stored engine codes for P1326 on the Tucson 2.4'),
   'diagnostic_scan', pg_temp.sid('var:theta2_24_gdi'),
   'P1326 is the code the knock sensor detection logic stores when it senses bearing wear and puts the engine into limp mode.',
   'Whether the engine computer holds a P1326 now or in its stored history.',
   'No stored code does not prove the bearings are healthy, and cleared codes leave no trace on a generic scanner.',
   null, 'must', false, null),
  (pg_temp.mk('chk:theta24_oil_level', 'check_item', 'Check the oil level on the dipstick of the Tucson 2.4'),
   'visual', pg_temp.sid('var:theta2_24_gdi'),
   'These engines are reported to burn oil without a low level warning, and bearings starved of oil knock and fail.',
   'Whether the oil is at the correct level and how dark it is now.',
   'One reading does not show the consumption rate; that needs a measured interval or the dealer consumption test.',
   null, 'must', false, null),
  (pg_temp.mk('chk:tucson24_records', 'check_item', 'Ask for oil change records and the Hyundai campaign history'),
   'documentation', pg_temp.sid('ver:tucson24'),
   'Coverage decisions on engine failures ask for maintenance records, and owners report denials when records are missing.',
   'Whether the oil was changed on schedule and which engine campaigns and replacements the car has had.',
   'Records do not prove the oil level between changes or the condition of the bearings.',
   null, 'must', false, null),
  (pg_temp.mk('chk:tucson24_extension_lookup', 'check_item', 'Ask a Hyundai dealer to look up T3G, campaign 953, TXXC and TXXI on the VIN'),
   'entitlement_verification', pg_temp.sid('ver:tucson24'),
   'The extensions cover only certain 2018 and 2019 cars, and the lifetime extension has conditions that only the dealer warranty screen shows.',
   'Whether this VIN is inside the extension population and which campaigns are open or completed.',
   'Does not guarantee approval of a future claim: prior approval still reviews neglect, title and maintenance.',
   null, 'must', true, 'entitlement_state'),
  (pg_temp.mk('chk:tl_vin_engine', 'check_item', 'Read the eighth VIN character for the Tucson engine code'),
   'documentation', pg_temp.sid('ver:tucson24'),
   'Listings mix up the 2.0 and 2.4 Tucson, and every Theta II fact depends on the engine; the NHTSA decoder reads L as the 2.4 GDI Theta II and 4 as the 2.0 GDI Nu.',
   'Which engine the car was built with.',
   'Does not show whether the engine was later replaced, or with what.',
   null, 'must', true, 'component_variant'),
  (pg_temp.mk('chk:tl_build_date', 'check_item', 'Read the manufacture month on the door jamb label of the Tucson'),
   'vin_build_sheet', pg_temp.sid('gen:tl'),
   'The ABS module recall populations are bounded by build dates that the model year does not give.',
   'The month and year the car was built, which places it inside or outside each recall window.',
   'Does not show whether the recall was performed; that needs the VIN lookup.',
   null, 'must', true, 'production_date'),
  (pg_temp.mk('chk:tl_recall_lookup', 'check_item', 'Look up open recalls on the Tucson VIN'),
   'documentation', pg_temp.sid('gen:tl'),
   'The ABS module fire recall needs a dealer fuse kit, and theft campaign 993 applies to key ignition cars.',
   'Which recalls and campaigns are open on this VIN.',
   'Does not show whether the ABS module is already corroding.',
   null, 'must', false, null),
  (pg_temp.mk('chk:tl_awd_identify', 'check_item', 'Confirm all-wheel drive on the Tucson: AWD LOCK button and rear drive shaft'),
   'visual', pg_temp.sid('ver:tucson24'),
   'Front and all-wheel drive cars share the version; the listing text often omits the drive.',
   'Whether the car has all-wheel drive.',
   'Does not show the condition of the coupling or the rear differential.',
   null, 'good', true, 'equipment_present'),
  (pg_temp.mk('chk:tl_ignition', 'check_item', 'Look for a key ignition barrel or an Engine Start/Stop button'),
   'visual', pg_temp.sid('gen:tl'),
   'Theft campaign 993 and the steering wheel lock campaign apply only to cars without push button start.',
   'Whether the car starts with a key in a barrel or with a button.',
   'Does not show whether the anti-theft software was installed.',
   null, 'good', true, 'equipment_absent'),
  (pg_temp.mk('chk:tl24_transmission', 'check_item', 'Road test for transmission slip and read incorrect ratio codes'),
   'road_test', pg_temp.sid('var:tucson24_6at'),
   'The manufacturer answers in-gear clutch slip on this transmission with a stall test and, when it fails, a new transmission.',
   'Whether the transmission slips or flares between gears now and whether gear ratio codes are stored.',
   'A short drive does not prove the clutches will hold under load when hot.',
   null, 'good', false, null);

insert into mi.check_covers (check_id, target_subject_id, role) values
  (pg_temp.sid('chk:theta24_knock'),            pg_temp.sid('issue:theta24_rod_bearing'),     'detects'),
  (pg_temp.sid('chk:theta24_p1326'),            pg_temp.sid('issue:theta24_rod_bearing'),     'detects'),
  (pg_temp.sid('chk:theta24_oil_level'),        pg_temp.sid('issue:theta24_oil_consumption'), 'detects'),
  (pg_temp.sid('chk:tucson24_extension_lookup'),pg_temp.sid('ent:tucson_theta_ext'),         'verifies_state'),
  (pg_temp.sid('chk:tl_vin_engine'),            pg_temp.sid('var:theta2_24_gdi'),             'resolves_identity'),
  (pg_temp.sid('chk:tl_awd_identify'),          pg_temp.sid('eq:tucson_awd'),                 'resolves_identity'),
  (pg_temp.sid('chk:tl_ignition'),              pg_temp.sid('eq:tucson_push_start'),          'resolves_identity');

-- ---------- Стани компонента ----------

insert into mi.component_state_type (subject_id, state_key, state_kind, applies_to_subject_id,
    resulting_variant_id, sanctioned_by_oem) values
  (pg_temp.mk('state:theta24_ksds', 'component_state_type', 'Knock sensor detection software installed (campaign 953)'),
   'theta2_24_ksds_installed', 'retrofit', pg_temp.sid('var:theta2_24_gdi'), null, true),
  (pg_temp.mk('state:theta24_long_block', 'component_state_type', 'Theta II 2.4 long block replaced by a Hyundai dealer'),
   'theta2_24_long_block_replaced', 'replacement_reman', pg_temp.sid('var:theta2_24_gdi'), null, true),
  (pg_temp.mk('state:tl_hecu_fuse', 'component_state_type', 'ABS module fuse kit installed under recall 195'),
   'tucson_tl_hecu_fuse_kit', 'repair', pg_temp.sid('gen:tl'), null, true);
