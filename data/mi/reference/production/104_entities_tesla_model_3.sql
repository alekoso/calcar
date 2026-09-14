-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 104_entities_tesla_model_3.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- MI Catalog, картка 2: граф сутностей Tesla Model 3 Long Range AWD (pre-Highland), US MY2018-2023.
--
-- Джерело: docs/model-intelligence/reference/tesla-model-3-lr-awd-my2018-2023.md.
-- Сутності створюються прямо, бо це каталог, а не знання. Кожне ТВЕРДЖЕННЯ
-- про ці сутності йде через staging і gate (124_candidates_tesla_model_3.sql).
--
-- Спирається на сутності Tesla з 101_entities_tesla.sql (бренд, родини
-- медіаблока і апаратури Autopilot). Нічого з еталонної картки Model S
-- P85D тут не змінюється: варіанти Model S (MCU1, MCU2 Model S, AP1, AP2)
-- не переоголошуються, Model 3 отримує власні варіанти у тих самих
-- родинах.
--
-- Правило R1 контракту: знання про пак живе на родині паку Model 3 і її
-- ревізіях (2018..2020 і 2021+), про приводи на родинах переднього і
-- заднього приводу, про тепло на родині теплової системи з двома
-- варіантами (PTC до ~10/2020, тепловий насос після), про 12 В батарею на
-- її родині (свинцева до ~12/2021, літієва після), про медіаблок і
-- Autopilot на варіантах спільних родин бренду, про кузов, підвіску,
-- відклики і софт на поколінні. Права (Autopilot, FSD, Acceleration Boost,
-- Premium Connectivity, Supercharging) це окремі сутності бренду: клейми
-- на них ОБОВʼЯЗКОВО несуть предикат model_line, бо компілятор бере всі
-- права бренду у кожен фрагмент бренду (див. звіт картки, прогалина 1).

-- ---------- Ряд і покоління ----------

insert into mi.model_line (subject_id, brand_id, name)
values (mi_load.mk('line:model_3', 'model_line', 'Tesla Model 3'), mi_load.sid('brand:tesla'), 'Model 3');

-- Виробництво MY2017..2020 за звітом відклику 21V-00D: 15.07.2017 ..
-- 30.09.2020 (S-M-OFF-15). Кінець покоління (Highland) джерелами картки
-- не задокументований, тому unknown.
insert into mi.generation (subject_id, model_line_id, platform_code, phase,
    powertrain_types, default_system_profile, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('gen:m3', 'generation', 'Tesla Model 3 pre-Highland'),
   mi_load.sid('line:model_3'), 'M3_PRE_HIGHLAND', 'base', array['bev']::mi.powertrain[], 'bev_default',
   date '2017-07-15', 'known', date '9999-12-31', 'unknown');

-- ---------- Версія ----------

-- Лише досліджена версія. Long Range із заднім приводом (2017..2019) і
-- Performance у продакшн-каталог НЕ заводяться: мітка «Long Range»
-- міститься у «Long Range AWD», а «Dual Motor» у «Dual Motor Performance»,
-- і матчер тексту тоді бачить дві версії. Для негативного тесту суміжна
-- RWD-версія живе у фікстурі стенду з синтетичною міткою.
insert into mi.vehicle_version (subject_id, generation_id, version_code, name_en, powertrain) values
  (mi_load.mk('ver:m3_lr_awd', 'vehicle_version', 'Tesla Model 3 Long Range AWD'),
   mi_load.sid('gen:m3'), 'M3_LR_AWD', 'Long Range AWD', 'bev');

-- ---------- Версія x ринок x рік ----------

-- Межі виробництва по модельних роках офіційними документами картки не
-- задані (Tesla не публікує їх; відклики дають лише вибіркові вікна),
-- тому всі межі unknown, не open. Модельний рік визначає декодер VIN.
insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('vmy:m3_us_2018', 'version_market_year', 'Tesla Model 3 Long Range AWD US MY2018'),
   mi_load.sid('ver:m3_lr_awd'), 'US', 2018, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('vmy:m3_us_2019', 'version_market_year', 'Tesla Model 3 Long Range AWD US MY2019'),
   mi_load.sid('ver:m3_lr_awd'), 'US', 2019, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('vmy:m3_us_2020', 'version_market_year', 'Tesla Model 3 Long Range AWD US MY2020'),
   mi_load.sid('ver:m3_lr_awd'), 'US', 2020, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('vmy:m3_us_2021', 'version_market_year', 'Tesla Model 3 Long Range AWD US MY2021'),
   mi_load.sid('ver:m3_lr_awd'), 'US', 2021, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('vmy:m3_us_2022', 'version_market_year', 'Tesla Model 3 Long Range AWD US MY2022'),
   mi_load.sid('ver:m3_lr_awd'), 'US', 2022, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('vmy:m3_us_2023', 'version_market_year', 'Tesla Model 3 Long Range AWD US MY2023'),
   mi_load.sid('ver:m3_lr_awd'), 'US', 2023, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- ---------- Родини компонентів Model 3 ----------

insert into mi.component_family (subject_id, brand_id, family_key, family_kind_code, architecture_en) values
  (mi_load.mk('fam:m3_pack', 'component_family', 'Tesla Model 3 high voltage pack'), mi_load.sid('brand:tesla'),
   'TESLA_3_PACK', 'battery_pack',
   'Four module pack of cylindrical 2170 nickel cobalt aluminium cells from Gigafactory Nevada, liquid cooled, with the power conversion system and pyrotechnic disconnect in the penthouse under the rear seat'),
  (mi_load.mk('fam:m3_rdu', 'component_family', 'Tesla Model 3 rear drive unit'), mi_load.sid('brand:tesla'),
   'TESLA_3_RDU', 'drive_unit',
   'Permanent magnet synchronous reluctance motor with integrated inverter and single speed reduction gear, the 3D series unit shared by the rear drive and dual motor cars'),
  (mi_load.mk('fam:m3_fdu', 'component_family', 'Tesla Model 3 front drive unit'), mi_load.sid('brand:tesla'),
   'TESLA_3_FDU', 'drive_unit',
   'Induction motor front drive unit of the dual motor cars with its own inverter and reduction gear'),
  (mi_load.mk('fam:m3_thermal', 'component_family', 'Tesla Model 3 thermal system'), mi_load.sid('brand:tesla'),
   'TESLA_3_THERMAL', 'hvac',
   'Cabin and battery thermal management: a resistive heater with the superbottle on early cars, a heat pump with the octovalve and the super manifold on later cars'),
  (mi_load.mk('fam:m3_lv', 'component_family', 'Tesla Model 3 low voltage battery'), mi_load.sid('brand:tesla'),
   'TESLA_3_LV_BATTERY', 'electrical',
   'Low voltage battery that keeps the computers, contactors and door electronics alive; lead acid on early cars, lithium ion on later cars');

-- ---------- Варіанти ----------

-- Пак: перша ревізія 2018..2020 і ревізія 2021+ (нові комірки Panasonic).
-- Межа приблизна (жовтень 2020 за документом Tesla про тепловий насос),
-- тому дати варіантів unknown, а розподіл по роках задає комплектація VMY.
insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:m3_pack_2018', 'component_variant', 'Tesla Model 3 Long Range pack, 2018 to 2020'), mi_load.sid('fam:m3_pack'),
   'M3_PACK_LR_2018', 'Long Range 2170 pack of the 2018 to 2020 cars',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:m3_pack_2021', 'component_variant', 'Tesla Model 3 Long Range pack, 2021 on'), mi_load.sid('fam:m3_pack'),
   'M3_PACK_LR_2021', 'Long Range 2170 pack of the refreshed cars with higher energy density cells',
   mi_load.sid('var:m3_pack_2018'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:m3_rdu_lr', 'component_variant', 'Tesla Model 3 rear drive unit, Long Range'), mi_load.sid('fam:m3_rdu'),
   'M3_RDU_LR', 'Rear drive unit of the Long Range cars',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:m3_fdu_ind', 'component_variant', 'Tesla Model 3 front induction drive unit'), mi_load.sid('fam:m3_fdu'),
   'M3_FDU_INDUCTION', 'Front induction drive unit of the dual motor cars',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:m3_ptc', 'component_variant', 'Tesla Model 3 resistive heater thermal system'), mi_load.sid('fam:m3_thermal'),
   'M3_PTC', 'Resistive positive temperature coefficient cabin heater with the superbottle coolant layout',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:m3_lv_pb', 'component_variant', 'Tesla Model 3 lead-acid 12 V battery'), mi_load.sid('fam:m3_lv'),
   'M3_LV_LEAD_ACID', 'Lead acid 12 V battery, AtlasBX / Hankook 85B24LS 45 Ah on North American cars',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    supersedes_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:m3_heatpump', 'component_variant', 'Tesla Model 3 heat pump thermal system'), mi_load.sid('fam:m3_thermal'),
   'M3_HEAT_PUMP', 'Heat pump with the octovalve and the super manifold, refrigerant pressure and temperature sensors on the manifold',
   mi_load.sid('var:m3_ptc'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown'),
  (mi_load.mk('var:m3_lv_li', 'component_variant', 'Tesla Model 3 lithium-ion low voltage battery'), mi_load.sid('fam:m3_lv'),
   'M3_LV_LITHIUM', 'Lithium ion low voltage battery of about 15 to 16 V',
   mi_load.sid('var:m3_lv_pb'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

-- Медіаблок і Autopilot: власні варіанти Model 3 у спільних родинах
-- бренду. Варіанти Model S (MCU1, MCU2, AP1, AP2) не чіпаються.
insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:m3_mcu_intel', 'component_variant', 'Tesla Model 3 infotainment computer, Intel Atom'), mi_load.sid('fam:tesla_mcu'),
   'M3_ICE_INTEL', 'Infotainment computer on the Intel Atom processor, which the community calls MCU2',
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    supersedes_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:m3_mcu_amd', 'component_variant', 'Tesla Model 3 infotainment computer, AMD Ryzen'), mi_load.sid('fam:tesla_mcu'),
   'M3_ICE_AMD', 'Infotainment computer on the AMD Ryzen processor, which the community calls MCU3',
   mi_load.sid('var:m3_mcu_intel'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    revision_of_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:ap25', 'component_variant', 'Tesla Autopilot hardware 2.5'), mi_load.sid('fam:tesla_ap'),
   'AP2_5', 'Autopilot computer 2.5 with a secondary processor node, the first computer of the Model 3',
   mi_load.sid('var:ap2'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.component_variant (subject_id, family_id, variant_code, name_en,
    supersedes_id, prod_from, prod_from_kind, prod_to, prod_to_kind) values
  (mi_load.mk('var:ap3', 'component_variant', 'Tesla Full Self-Driving computer (hardware 3)'), mi_load.sid('fam:tesla_ap'),
   'AP3', 'Full Self-Driving computer on the Tesla designed chip, the same board size as the 2.5 computer',
   mi_load.sid('var:ap25'),
   date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

insert into mi.variant_attribute (variant_id, attr_key, attr_value) values
  (mi_load.sid('var:m3_pack_2018'), 'cell_chemistry', 'nca'),
  (mi_load.sid('var:m3_pack_2021'), 'cell_chemistry', 'nca');

-- ---------- Комплектація ----------

-- Роль adas_hw у MY2019 і ролі mcu та 12 В батареї у MY2022 задані як два
-- варіанти optional, без standard: у ці роки лінія перейшла на нову
-- апаратуру посеред року (квітень 2019, грудень 2021), і заводське
-- припущення було б хибним для частини машин. Обидва варіанти лишаються
-- у полі зору фрагмента, знання про них у такі роки стає CONDITIONAL, а
-- перевірка на екрані (hardware_identification) знімає невизначеність.
insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment) values
  (mi_load.sid('vmy:m3_us_2018'), 'battery_pack',     mi_load.sid('var:m3_pack_2018'), 'standard'),
  (mi_load.sid('vmy:m3_us_2018'), 'drive_unit_rear',  mi_load.sid('var:m3_rdu_lr'),    'standard'),
  (mi_load.sid('vmy:m3_us_2018'), 'drive_unit_front', mi_load.sid('var:m3_fdu_ind'),   'standard'),
  (mi_load.sid('vmy:m3_us_2018'), 'cabin_heater',     mi_load.sid('var:m3_ptc'),       'standard'),
  (mi_load.sid('vmy:m3_us_2018'), 'other',            mi_load.sid('var:m3_lv_pb'),     'standard'),
  (mi_load.sid('vmy:m3_us_2018'), 'mcu',              mi_load.sid('var:m3_mcu_intel'), 'standard'),
  (mi_load.sid('vmy:m3_us_2018'), 'adas_hw',          mi_load.sid('var:ap25'),         'standard'),

  (mi_load.sid('vmy:m3_us_2019'), 'battery_pack',     mi_load.sid('var:m3_pack_2018'), 'standard'),
  (mi_load.sid('vmy:m3_us_2019'), 'drive_unit_rear',  mi_load.sid('var:m3_rdu_lr'),    'standard'),
  (mi_load.sid('vmy:m3_us_2019'), 'drive_unit_front', mi_load.sid('var:m3_fdu_ind'),   'standard'),
  (mi_load.sid('vmy:m3_us_2019'), 'cabin_heater',     mi_load.sid('var:m3_ptc'),       'standard'),
  (mi_load.sid('vmy:m3_us_2019'), 'other',            mi_load.sid('var:m3_lv_pb'),     'standard'),
  (mi_load.sid('vmy:m3_us_2019'), 'mcu',              mi_load.sid('var:m3_mcu_intel'), 'standard'),
  (mi_load.sid('vmy:m3_us_2019'), 'adas_hw',          mi_load.sid('var:ap25'),         'optional'),
  (mi_load.sid('vmy:m3_us_2019'), 'adas_hw',          mi_load.sid('var:ap3'),          'optional'),

  (mi_load.sid('vmy:m3_us_2020'), 'battery_pack',     mi_load.sid('var:m3_pack_2018'), 'standard'),
  (mi_load.sid('vmy:m3_us_2020'), 'drive_unit_rear',  mi_load.sid('var:m3_rdu_lr'),    'standard'),
  (mi_load.sid('vmy:m3_us_2020'), 'drive_unit_front', mi_load.sid('var:m3_fdu_ind'),   'standard'),
  (mi_load.sid('vmy:m3_us_2020'), 'cabin_heater',     mi_load.sid('var:m3_ptc'),       'standard'),
  (mi_load.sid('vmy:m3_us_2020'), 'other',            mi_load.sid('var:m3_lv_pb'),     'standard'),
  (mi_load.sid('vmy:m3_us_2020'), 'mcu',              mi_load.sid('var:m3_mcu_intel'), 'standard'),
  (mi_load.sid('vmy:m3_us_2020'), 'adas_hw',          mi_load.sid('var:ap3'),          'standard'),

  (mi_load.sid('vmy:m3_us_2021'), 'battery_pack',     mi_load.sid('var:m3_pack_2021'), 'standard'),
  (mi_load.sid('vmy:m3_us_2021'), 'drive_unit_rear',  mi_load.sid('var:m3_rdu_lr'),    'standard'),
  (mi_load.sid('vmy:m3_us_2021'), 'drive_unit_front', mi_load.sid('var:m3_fdu_ind'),   'standard'),
  (mi_load.sid('vmy:m3_us_2021'), 'cabin_heater',     mi_load.sid('var:m3_heatpump'),  'standard'),
  (mi_load.sid('vmy:m3_us_2021'), 'other',            mi_load.sid('var:m3_lv_pb'),     'standard'),
  (mi_load.sid('vmy:m3_us_2021'), 'mcu',              mi_load.sid('var:m3_mcu_intel'), 'standard'),
  (mi_load.sid('vmy:m3_us_2021'), 'adas_hw',          mi_load.sid('var:ap3'),          'standard'),

  (mi_load.sid('vmy:m3_us_2022'), 'battery_pack',     mi_load.sid('var:m3_pack_2021'), 'standard'),
  (mi_load.sid('vmy:m3_us_2022'), 'drive_unit_rear',  mi_load.sid('var:m3_rdu_lr'),    'standard'),
  (mi_load.sid('vmy:m3_us_2022'), 'drive_unit_front', mi_load.sid('var:m3_fdu_ind'),   'standard'),
  (mi_load.sid('vmy:m3_us_2022'), 'cabin_heater',     mi_load.sid('var:m3_heatpump'),  'standard'),
  (mi_load.sid('vmy:m3_us_2022'), 'adas_hw',          mi_load.sid('var:ap3'),          'standard'),
  (mi_load.sid('vmy:m3_us_2022'), 'mcu',              mi_load.sid('var:m3_mcu_intel'), 'optional'),
  (mi_load.sid('vmy:m3_us_2022'), 'mcu',              mi_load.sid('var:m3_mcu_amd'),   'optional'),
  (mi_load.sid('vmy:m3_us_2022'), 'other',            mi_load.sid('var:m3_lv_pb'),     'optional'),
  (mi_load.sid('vmy:m3_us_2022'), 'other',            mi_load.sid('var:m3_lv_li'),     'optional'),

  (mi_load.sid('vmy:m3_us_2023'), 'battery_pack',     mi_load.sid('var:m3_pack_2021'), 'standard'),
  (mi_load.sid('vmy:m3_us_2023'), 'drive_unit_rear',  mi_load.sid('var:m3_rdu_lr'),    'standard'),
  (mi_load.sid('vmy:m3_us_2023'), 'drive_unit_front', mi_load.sid('var:m3_fdu_ind'),   'standard'),
  (mi_load.sid('vmy:m3_us_2023'), 'cabin_heater',     mi_load.sid('var:m3_heatpump'),  'standard'),
  (mi_load.sid('vmy:m3_us_2023'), 'other',            mi_load.sid('var:m3_lv_li'),     'standard'),
  (mi_load.sid('vmy:m3_us_2023'), 'mcu',              mi_load.sid('var:m3_mcu_amd'),   'standard'),
  (mi_load.sid('vmy:m3_us_2023'), 'adas_hw',          mi_load.sid('var:ap3'),          'standard');

-- ---------- Аліаси ----------

-- Мітки під написи оголошень. «Dual Motor» окремо свідомо НЕ аліас: він
-- міститься у «Dual Motor Performance» і зробив би текст двозначним, коли
-- Performance зайде у каталог. «Long Range» окремо теж не аліас: це
-- задньопривідна версія 2017..2019.
insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id) values
  (mi_load.sid('ver:m3_lr_awd'), 'Long Range Dual Motor',     'long range dual motor',     'en', 'official',  'model_line', mi_load.sid('line:model_3')),
  (mi_load.sid('ver:m3_lr_awd'), 'Long Range Dual Motor AWD', 'long range dual motor awd', 'en', 'official',  'model_line', mi_load.sid('line:model_3')),
  (mi_load.sid('ver:m3_lr_awd'), 'Long Range All-Wheel Drive','long range all-wheel drive','en', 'official',  'model_line', mi_load.sid('line:model_3')),
  (mi_load.sid('ver:m3_lr_awd'), 'Dual Motor Long Range',     'dual motor long range',     'en', 'community', 'model_line', mi_load.sid('line:model_3')),
  (mi_load.sid('ver:m3_lr_awd'), 'AWD Long Range',            'awd long range',            'en', 'community', 'model_line', mi_load.sid('line:model_3')),
  (mi_load.sid('ver:m3_lr_awd'), 'LR AWD',                    'lr awd',                    'en', 'community', 'model_line', mi_load.sid('line:model_3')),
  (mi_load.sid('var:ap25'),      'HW2.5',                     'hw2.5',                     'en', 'community', 'brand',      mi_load.sid('brand:tesla')),
  (mi_load.sid('var:ap3'),       'HW3',                       'hw3',                       'en', 'community', 'brand',      mi_load.sid('brand:tesla')),
  (mi_load.sid('var:ap3'),       'FSD computer',              'fsd computer',              'en', 'official',  'brand',      mi_load.sid('brand:tesla')),
  (mi_load.sid('var:m3_mcu_amd'),'MCU3',                      'mcu3',                      'en', 'community', 'brand',      mi_load.sid('brand:tesla'));

-- ---------- Права ----------

-- Ключі прав унікальні в межах бренду; «premium_connectivity_lifetime»
-- уже зайнятий правом Model S із вимогою 3G-модема, тому право Model 3
-- має власний ключ.
insert into mi.entitlement (subject_id, brand_id, entitlement_key, name_en, binding,
    transferable_private, transferable_dealer, revocable, revoke_reasons,
    network_dependency, requires_variant_id) values
  (mi_load.mk('ent:m3_autopilot', 'entitlement', 'Autopilot software (Model 3)'),
   mi_load.sid('brand:tesla'), 'autopilot_basic_model_3', 'Autopilot software', 'vin',
   true, true, false, null, false, null),
  (mi_load.mk('ent:fsd', 'entitlement', 'Full Self-Driving capability purchase'),
   mi_load.sid('brand:tesla'), 'fsd_capability', 'Full Self-Driving capability', 'vin',
   true, false, true, array['transferred to a new Tesla by the previous owner', 'resale through Tesla'], false, null),
  (mi_load.mk('ent:accel_boost', 'entitlement', 'Acceleration Boost'),
   mi_load.sid('brand:tesla'), 'acceleration_boost', 'Acceleration Boost', 'vin',
   true, false, true, array['resale through Tesla'], false, null),
  (mi_load.mk('ent:m3_pc_life', 'entitlement', 'Premium Connectivity for life, orders before July 2018'),
   mi_load.sid('brand:tesla'), 'premium_connectivity_lifetime_2018_orders', 'Premium Connectivity for the life of the vehicle', 'vin',
   true, false, true, array['resale through Tesla', 'resale after January 2020 on most cars'], true, null),
  (mi_load.mk('ent:supercharging', 'entitlement', 'Supercharger network access'),
   mi_load.sid('brand:tesla'), 'supercharger_access', 'Supercharger network access', 'vin',
   true, true, true, array['salvage title'], true, null);

-- ---------- Проблеми ----------

insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity) values
  (mi_load.mk('issue:m3_heatpump_sensor', 'issue', 'Tesla Model 3 heat pump sensor fault and loss of heat'),
   'tesla_3_heat_pump_pt_sensor', mi_load.sid('var:m3_heatpump'),
   'Refrigerant pressure and temperature sensors on the heat pump fault, the compressor stops and the cabin loses heat and defrost',
   'The sensors on the super manifold fault over time, most often in cold weather; the system shuts down as a protection and does not resume until service.',
   'major', 'calendar'),
  (mi_load.mk('issue:m3_ptc_failure', 'issue', 'Tesla Model 3 resistive heater failure'),
   'tesla_3_ptc_heater_failure', mi_load.sid('var:m3_ptc'),
   'The resistive cabin heater stops heating', null, 'major', 'mixed'),
  (mi_load.mk('issue:m3_lv_lead_acid', 'issue', 'Tesla Model 3 lead-acid 12 V battery end of life'),
   'tesla_3_lv_lead_acid_eol', mi_load.sid('var:m3_lv_pb'),
   'The lead acid 12 V battery dies after a few years, often without the warning message',
   'A lead acid battery in a car that is always awake ages in two to four years; heat shortens the life. A dead 12 V battery immobilises the car although the pack is charged.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:m3_bms_a079', 'issue', 'Tesla Model 3 pack cell imbalance and charge limit'),
   'tesla_3_bms_a079', mi_load.sid('fam:m3_pack'),
   'BMS_a079 maximum charge level reached: the pack no longer charges fully because of a weak cell group',
   'One cell group drifts away from the others; the battery management system limits charging and the fix is a pack or module replacement.',
   'catastrophic', 'mixed'),
  (mi_load.mk('issue:m3_pcs', 'issue', 'Tesla Model 3 power conversion system partial failure'),
   'tesla_3_pcs_partial', mi_load.sid('gen:m3'),
   'Charger controllers inside the power conversion system fail and alternating current charging is limited to a fraction of 48 A',
   'The power conversion system in the pack penthouse has several charger stages; when stages fail the car still charges but slowly.',
   'major', 'calendar'),
  (mi_load.mk('issue:m3_du_failure', 'issue', 'Tesla Model 3 rear drive unit failure'),
   'tesla_3_rear_drive_unit_failure', mi_load.sid('fam:m3_rdu'),
   'Rear drive unit fails internally or develops bearing noise', null, 'major', 'mixed'),
  (mi_load.mk('issue:m3_uca_creak', 'issue', 'Tesla Model 3 front upper control arm creak'),
   'tesla_3_upper_control_arm_creak', mi_load.sid('gen:m3'),
   'Creaking from the front suspension when steering at low speed',
   'Water reaches the upper control arm ball joints and corrodes their surface; the manufacturer calls it a noise condition only.',
   'minor', 'calendar'),
  (mi_load.mk('issue:m3_lateral_link', 'issue', 'Tesla Model 3 front lower lateral link detachment'),
   'tesla_3_lateral_link_detachment', mi_load.sid('gen:m3'),
   'The front lower lateral link fasteners loosen and the link separates from the subframe',
   null, 'major', 'mixed'),
  (mi_load.mk('issue:m3_trunk_harness', 'issue', 'Tesla Model 3 trunk harness wear and rear camera loss'),
   'tesla_3_trunk_harness_wear', mi_load.sid('gen:m3'),
   'The coaxial cable in the trunk lid harness wears with trunk cycles and the rear camera image disappears',
   null, 'moderate', 'cycles'),
  (mi_load.mk('issue:m3_trunk_leak', 'issue', 'Tesla Model 3 trunk lid water ingress'),
   'tesla_3_trunk_lid_water_ingress', mi_load.sid('gen:m3'),
   'Water leaks into the trunk through the trunk lid',
   'Gaps in the sealant under the lamp panels inside the trunk lid let water in; the repair reseals the lid.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:m3_charge_port_door', 'issue', 'Tesla Model 3 charge port door failure'),
   'tesla_3_charge_port_door', mi_load.sid('gen:m3'),
   'The charge port door stops opening or closing',
   'The position magnet falls off the door or the actuator clutch wears; early doors had a weaker mechanism.',
   'minor', 'calendar'),
  (mi_load.mk('issue:m3_phantom_braking', 'issue', 'Tesla Model 3 unexpected braking under driver assistance'),
   'tesla_3_phantom_braking', mi_load.sid('gen:m3'),
   'Unexpected deceleration while cruise control or Autopilot is engaged', null, 'moderate', 'usage'),
  (mi_load.mk('issue:m3_no_basic_ap', 'issue', 'Tesla Model 3 delivered without Autopilot software'),
   'tesla_3_no_basic_autopilot', mi_load.sid('ent:m3_autopilot'),
   'A used car turns out to have no Autopilot software although the hardware is fitted',
   'Autopilot was a paid option until April 2019 and fleet cars could be ordered without it later; the hardware is the same.',
   'moderate', 'calendar'),
  (mi_load.mk('issue:m3_fsd_gone', 'issue', 'Tesla paid software removed before resale'),
   'tesla_3_paid_software_removed', mi_load.sid('ent:fsd'),
   'Full Self-Driving, Enhanced Autopilot or Acceleration Boost is gone from the car by the time the next owner gets it',
   'The manufacturer removes paid software when it resells a car itself and lets an owner move Full Self-Driving to a new car; only a private sale keeps them.',
   'major', 'mixed'),
  (mi_load.mk('issue:m3_salvage_fast_charging', 'issue', 'Tesla Supercharging disabled on a salvage title'),
   'tesla_3_salvage_supercharging', mi_load.sid('ent:supercharging'),
   'Supercharging is disabled on a salvage titled car until the manufacturer inspections',
   'The unsupported vehicle policy of 2020 disables Supercharging on salvage titled cars; since late 2022 two paid inspections can restore it.',
   'major', 'mixed');

-- ---------- Обслуговування ----------

insert into mi.maintenance_item (subject_id, about_subject_id, service_kind_code, fluid_spec_code, capacity_note_en) values
  (mi_load.mk('maint:m3_brake_fluid', 'maintenance_item', 'Model 3 brake fluid'),
   mi_load.sid('gen:m3'), 'brake_fluid', null, null),
  (mi_load.mk('maint:m3_desiccant', 'maintenance_item', 'Model 3 air conditioning desiccant'),
   mi_load.sid('gen:m3'), 'ac_desiccant', null, null),
  -- Ключ обслуговування унікальний на (субʼєкт, вид): фільтр салону стоїть
  -- на версії, бо вид «other» на поколінні зайнятий чищенням супортів
  -- (прогалина словника: немає видів cabin_air_filter і brake_service).
  (mi_load.mk('maint:m3_cabin_filter', 'maintenance_item', 'Model 3 cabin air filter'),
   mi_load.sid('ver:m3_lr_awd'), 'other', null, 'Cabin air filter'),
  (mi_load.mk('maint:m3_brake_cleaning', 'maintenance_item', 'Model 3 brake caliper cleaning'),
   mi_load.sid('gen:m3'), 'other', null, 'Cleaning and lubrication of the brake calipers in a road salt climate'),
  (mi_load.mk('maint:m3_lv_battery', 'maintenance_item', 'Model 3 lead-acid 12 V battery replacement'),
   mi_load.sid('var:m3_lv_pb'), 'other', null, 'Lead acid 12 V battery, a consumable the manufacturer does not schedule');

-- ---------- Перевірки ----------

-- Перевірки привʼязані лише до субʼєктів Model 3, не до прав бренду: у
-- фрагмент бренду інакше потрапила б перевірка Model 3 у Model S. Мітки
-- субʼєктів унікальні в межах каталогу (мапа ключів продакшн-бандла іде
-- по мітках), тому DC-сесія названа з версією: Model S має свою.
insert into mi.check_item (subject_id, test_method_code, scope_subject_id, why_en, proves_en,
    cannot_prove_en, conditions, default_priority, materially_resolves, resolves_dimension) values
  (mi_load.mk('chk:m3_ap_computer', 'check_item', 'Read the Autopilot computer version on the screen'),
   'hardware_identification', mi_load.sid('gen:m3'),
   'The Autopilot computer changed from 2.5 to the Full Self-Driving computer during 2019 and the year alone does not tell which one the car has.',
   'Which Autopilot computer the car has today, from Software, Additional vehicle information.',
   'Does not show which software rights the car carries.',
   null, 'must', true, 'component_variant'),
  (mi_load.mk('chk:m3_infotainment', 'check_item', 'Read the infotainment processor and low voltage battery type'),
   'hardware_identification', mi_load.sid('gen:m3'),
   'The Intel to AMD computer change and the lead acid to lithium 12 V change happened inside model year 2022 production.',
   'Whether the car has the Intel or the AMD computer and which low voltage battery it carries.',
   'Does not show the condition of either part.',
   null, 'good', true, 'component_variant'),
  (mi_load.mk('chk:m3_rights', 'check_item', 'Verify Autopilot, Full Self-Driving and connectivity in the account after transfer'),
   'entitlement_verification', mi_load.sid('ver:m3_lr_awd'),
   'Hardware presence is not a right: Autopilot was optional until April 2019, and paid software leaves the car on a transfer or a resale through the manufacturer.',
   'Which software rights the car actually carries after the change of owner.',
   'Does not prevent a later removal on a configuration audit.',
   null, 'must', true, 'entitlement_state'),
  (mi_load.mk('chk:m3_dc_session', 'check_item', 'Run a direct current charging session on the Model 3'),
   'dc_charge_session', mi_load.sid('ver:m3_lr_awd'),
   'On a salvage titled car Supercharging is disabled by policy and fast charging depends on the charge port controller and the manufacturer inspections.',
   'Whether the car accepts direct current charging today and at what peak.',
   'A session at a third party charger does not prove Supercharger access, and one session is a lower bound for the peak.',
   array['from roughly ten to sixty percent state of charge'], 'must', true, 'entitlement_state'),
  (mi_load.mk('chk:m3_pack_health', 'check_item', 'Read pack capacity and battery alerts'),
   'battery_diagnostics', mi_load.sid('fam:m3_pack'),
   'The rated range on the screen hides both the true capacity and a battery management limit.',
   'Nominal full pack energy, cell group imbalance and any stored BMS alerts.',
   'Shows the pack today; it does not predict a future cell group failure.',
   null, 'must', false, null),
  (mi_load.mk('chk:m3_heat_test', 'check_item', 'Cabin heat and defrost test'),
   'road_test', mi_load.sid('fam:m3_thermal'),
   'Both thermal systems of this car fail in a way that removes cabin heat and defrost, and the failure is expensive on a heat pump car.',
   'Whether the cabin heater or heat pump produces heat and the windscreen defrosts now.',
   'A working system in mild weather does not rule out a sensor fault that shows in the cold.',
   null, 'must', false, null),
  (mi_load.mk('chk:m3_build_date', 'check_item', 'Read the manufacture month on the door jamb label'),
   'vin_build_sheet', mi_load.sid('gen:m3'),
   'The physical recalls and the refresh are bounded by build dates that the model year does not give; the certification label in the driver door jamb carries the month and year of manufacture.',
   'The month and year the car was built, which places it inside or outside each recall population and on one side of the October 2020 refresh.',
   'Does not show whether a recall was actually performed; that needs the VIN lookup.',
   null, 'must', true, 'production_date'),
  (mi_load.mk('chk:m3_recall_lookup', 'check_item', 'Look up open recalls by VIN'),
   'documentation', mi_load.sid('gen:m3'),
   'Several recalls need a physical repair (lateral link fasteners, caliper bolts, seat belts, trunk harness, curtain air bags, pyrotechnic disconnect) and most of the rest are software the car only gets while connected.',
   'Which campaigns are open on this VIN.',
   'Does not show whether a software remedy was actually installed on a car that has been offline.',
   null, 'must', false, null),
  (mi_load.mk('chk:m3_trunk_water', 'check_item', 'Inspect the trunk and the trunk lid for water'),
   'visual', mi_load.sid('gen:m3'),
   'Water enters through the trunk lid on many of these cars and floods the lower trunk.',
   'Whether there is water, staining or corrosion in the trunk and around the lamp panels of the lid now.',
   'A dry trunk in dry weather does not prove the lid is sealed.',
   null, 'good', false, null),
  (mi_load.mk('chk:m3_suspension_noise', 'check_item', 'Low speed steering and suspension noise test'),
   'road_test', mi_load.sid('gen:m3'),
   'A creak on the steering at low speed points at the upper control arm ball joints, and a clunk from the front may precede a lateral link separation.',
   'Whether the front suspension is quiet under low speed steering and over bumps.',
   'Silence does not prove the lateral link fasteners are torqued; that needs the recall inspection.',
   null, 'must', false, null);

-- Покриття лише на субʼєктах компонентів і прав: golden test 62 забороняє
-- check_covers на проблеми покоління.
insert into mi.check_covers (check_id, target_subject_id, role) values
  (mi_load.sid('chk:m3_ap_computer'),  mi_load.sid('var:ap3'),                     'resolves_identity'),
  (mi_load.sid('chk:m3_infotainment'), mi_load.sid('var:m3_mcu_amd'),              'resolves_identity'),
  (mi_load.sid('chk:m3_infotainment'), mi_load.sid('var:m3_lv_li'),                'resolves_identity'),
  (mi_load.sid('chk:m3_rights'),       mi_load.sid('ent:fsd'),                     'verifies_state'),
  (mi_load.sid('chk:m3_rights'),       mi_load.sid('ent:m3_autopilot'),            'verifies_state'),
  (mi_load.sid('chk:m3_dc_session'),   mi_load.sid('ent:supercharging'),           'verifies_state'),
  (mi_load.sid('chk:m3_pack_health'),  mi_load.sid('issue:m3_bms_a079'),           'detects'),
  (mi_load.sid('chk:m3_heat_test'),    mi_load.sid('issue:m3_heatpump_sensor'),    'detects'),
  (mi_load.sid('chk:m3_heat_test'),    mi_load.sid('issue:m3_ptc_failure'),        'detects');

-- ---------- Стани компонента ----------

insert into mi.component_state_type (subject_id, state_key, state_kind, applies_to_subject_id,
    resulting_variant_id, sanctioned_by_oem) values
  (mi_load.mk('state:m3_fsd_computer_retrofit', 'component_state_type', 'Full Self-Driving computer retrofit'),
   'tesla_3_fsd_computer_retrofit', 'retrofit', mi_load.sid('var:ap25'), mi_load.sid('var:ap3'), true),
  (mi_load.mk('state:m3_pt_sensors_replaced', 'component_state_type', 'Heat pump sensors replaced under the campaign'),
   'tesla_3_pt_sensors_replaced', 'repair', mi_load.sid('var:m3_heatpump'), null, true),
  (mi_load.mk('state:m3_pack_replaced', 'component_state_type', 'High voltage pack replaced'),
   'tesla_3_pack_replaced', 'replacement_reman', mi_load.sid('fam:m3_pack'), null, true),
  (mi_load.mk('state:m3_ccs_controller', 'component_state_type', 'Charge port controller retrofit for CCS'),
   'tesla_3_ccs_controller_retrofit', 'retrofit', mi_load.sid('gen:m3'), null, true),
  (mi_load.mk('state:m3_uca_resealed', 'component_state_type', 'Upper control arm ball joints resealed'),
   'tesla_3_uca_resealed', 'repair', mi_load.sid('gen:m3'), null, true);
