-- CalCar Model Intelligence, міграція 01: схеми, закриті enum-словники,
-- розширювані lookup-таблиці з seed-значеннями v1.
--
-- Джерело правди: Model Intelligence Physical Schema v1 (FROZEN) разом із
-- Final Patch і поправкою про межі KNOWN / OPEN / UNKNOWN.
--
-- Файл ідемпотентний: повторний запуск нічого не ламає і не чистить дані.
-- До Supabase застосовує ВЛАСНИК вручну; код цієї міграції сам не виконує.
--
-- RLS: на всіх таблицях увімкнений, політик НЕМАЄ свідомо: anon і
-- authenticated не бачать нічого, читає і пише лише service_role.
--
-- Правило словників: enum там, де нове значення змінює логіку компілятора
-- або оцінювача; lookup-таблиця там, де нове значення це новий вид
-- автомобільного знання без зміни логіки рушія.

-- ---------- 1. Схеми ----------

create schema if not exists mi;
create schema if not exists mi_vm;

comment on schema mi is 'CalCar Model Intelligence: багаторазове знання про версії, компоненти, ревізії, опції, права, ремонти, практики і проблеми. VIN тут не зберігається.';
comment on schema mi_vm is 'Інтерфейс між Vehicle Memory і Model Intelligence: розвʼязана ідентичність конкретного VIN, стани компонентів, права, вимірювання.';

-- ---------- 2. Закриті поведінкові enum ----------

do $$ begin create type mi.subject_kind as enum (
  'brand','model_line','generation','vehicle_version','version_market_year',
  'component_family','component_variant','equipment_item','entitlement',
  'component_state_type','issue','maintenance_item','check_item');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.knowledge_type as enum (
  'official_fact','known_issue','specialist_practice','owner_practice',
  'owner_pattern','calcar_synthesis');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.confidence as enum ('high','medium','low');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.propagation as enum ('exact','descendants','family_context');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.claim_status as enum ('draft','review','published','superseded','retired');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.practice_layer as enum ('official','specialist','owner','calcar');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.causal_status as enum (
  'observed_association','plausible_mechanism','supported_cause','unknown');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.policy_status as enum ('stable','mutable_policy');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.value_kind as enum (
  'quantity','range','interval','date_window','part_number','option_code',
  'cost','document_ref','enum');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.refresh_class as enum ('immutable','slow','aging','volatile');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.pred_operator as enum (
  'eq','ne','in_range','present','absent','tag_has','tag_not','attr_eq');
exception when duplicate_object then null; end $$;

-- Кожна розмірність це окрема гілка оцінювача і резолвера ідентичності.
do $$ begin create type mi.identity_dimension as enum (
  'brand','model_line','generation','version','vmy',
  'market_sold','market_operated','production_date','first_sale_date','model_year',
  'component_family','component_variant','variant_attribute',
  'equipment_present','equipment_absent',
  'entitlement_state','component_state_present',
  'mileage_km','age_years','condition_tag','salvage_status');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.config_slot as enum ('factory','current','na');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.resolution_status as enum (
  'confirmed','assumed_factory','conflicted','unresolved');
exception when duplicate_object then null; end $$;

-- Межа діапазону: відома, відкрита по суті, або невідома. Невідома НІКОЛИ
-- не читається як відкрита.
do $$ begin create type mi.boundary_kind as enum ('known','open','unknown');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.visual_specificity as enum (
  'definitive','strong','ambiguous','not_visually_resolvable');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.fitment_kind as enum ('standard','optional','in_package');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.availability as enum (
  'standard','optional','in_package','not_available');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.state_kind as enum (
  'repair','rebuild','replacement_new','replacement_reman','replacement_used',
  'retrofit','modification_unsanctioned','service_beyond_schedule');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.severity as enum ('catastrophic','major','moderate','minor');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.sensitivity as enum ('calendar','mileage','cycles','usage','mixed');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.entity_status as enum ('active','retired');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.stance as enum ('supports','contradicts','context');
exception when duplicate_object then null; end $$;

-- Повторюваність доказів, НЕ поширеність у парку.
do $$ begin create type mi.recurrence as enum (
  'anecdote','repeated_pattern','strong_consensus');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.review_status as enum (
  'new','normalized','evidence_linked','gate_pending','approved','rejected','merged');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.build_reason as enum (
  'fragment_missing','knowledge_missing','invalidated');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.request_status as enum ('queued','running','done','failed');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.binding as enum ('vin','account','owner');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.entitlement_status as enum ('present','absent','revoked','unknown');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.equipment_change as enum ('adds','removes');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.equipment_kind as enum (
  'option','package','system_config','wheel_tire_setup');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.alias_kind as enum ('official','catalog','community','legal');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.alias_scope as enum (
  'global','brand','model_line','generation','component_family');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.powertrain as enum ('ice','bev','phev','hev');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.priority as enum ('must','good');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.cover_role as enum ('detects','verifies_state','resolves_identity');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.reason_kind as enum (
  'positive','observed_risk','verification_gap','identity_conflict','assumption');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.reason_affects as enum (
  'score','decision_confidence','checklist','context');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.performer as enum ('oem','independent','unknown');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.source_type as enum (
  'official','legal','specialist','owner','review','market','vendor','aggregator');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.source_quality as enum ('primary','secondary','low');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.access_status as enum (
  'ok','proxy','blocked','captcha','offline_copy','search_summary');
exception when duplicate_object then null; end $$;

do $$ begin create type mi.pack_purpose as enum ('decision','report','component','chat');
exception when duplicate_object then null; end $$;

-- Сила заводського припущення для ролі: strong дозволяє verification gap,
-- weak не дозволяє (клейм подається як APPLICABLE_ASSUMED).
do $$ begin create type mi.assumption_strength as enum ('strong','weak');
exception when duplicate_object then null; end $$;

-- ---------- 3. Lookup-таблиці (розширювані предметні словники) ----------

-- 3.1. Ролі компонентів. Несе дані політики заводського припущення:
-- engine, transmission, transfer_case = strong; решта замінних ролей = weak.
create table if not exists mi.component_role (
  code                text primary key,
  name_en             text not null,
  is_replaceable      boolean not null default false,
  assumption_strength mi.assumption_strength,
  rationale_en        text,
  constraint component_role_strength_ck
    check (is_replaceable = (assumption_strength is not null))
);
alter table mi.component_role enable row level security;

insert into mi.component_role (code, name_en, is_replaceable, assumption_strength, rationale_en) values
  ('engine',             'Engine',                 true,  'strong', 'Engine swap is rare and almost always leaves a documented trace; VIN encodes the engine code.'),
  ('transmission',       'Transmission',           true,  'strong', 'Replacement is rare and documented.'),
  ('transfer_case',      'Transfer case',          true,  'strong', 'Replacement under extended warranty is documented.'),
  ('battery_pack',       'High voltage battery',   true,  'weak',   'Pack replacements are common and invisible from outside.'),
  ('drive_unit_front',   'Front drive unit',       true,  'weak',   'Warranty replacements are common.'),
  ('drive_unit_rear',    'Rear drive unit',        true,  'weak',   'Warranty replacements are common.'),
  ('mcu',                'Media control unit',     true,  'weak',   'Retrofit to a newer unit is widespread.'),
  ('adas_hw',            'Driver assistance hardware', true, 'weak','Modules are replaced after collisions.'),
  ('charger',            'On-board charger',       true,  'weak',   'Second charger and fast charge retrofits exist.'),
  ('modem',              'Telematics modem',       true,  'weak',   'Network generation upgrades were performed en masse.'),
  ('suspension_system',  'Suspension system',      true,  'weak',   'Air to coil conversions are common on ageing cars.'),
  ('brake_system',       'Brake system',           true,  'weak',   'Ceramic brake retrofits and reverse swaps exist.'),
  ('rear_diff',          'Rear differential',      false, null,     null),
  ('instrument_cluster', 'Instrument cluster',     false, null,     null),
  ('door_handle',        'Door handle',            false, null,     null),
  ('cabin_heater',       'Cabin heater',           false, null,     null),
  ('other',              'Other',                  false, null,     null)
on conflict (code) do nothing;

-- 3.2. Види компонентних родин.
create table if not exists mi.component_kind (
  code    text primary key,
  name_en text not null
);
alter table mi.component_kind enable row level security;

insert into mi.component_kind (code, name_en) values
  ('engine','Engine'), ('transmission','Transmission'), ('transfer_case','Transfer case'),
  ('differential','Differential'), ('battery_pack','High voltage battery'),
  ('drive_unit','Electric drive unit'), ('infotainment','Infotainment'),
  ('adas_hw','Driver assistance hardware'), ('charger','Charger'), ('modem','Modem'),
  ('suspension_system','Suspension system'), ('brake_system','Brake system'),
  ('body_module','Body module'), ('hvac','Climate'), ('electrical','Electrical'),
  ('other','Other')
on conflict (code) do nothing;

-- 3.3. Методи перевірки. Той самий словник використовує вимірювання у VM.
create table if not exists mi.test_method (
  code    text primary key,
  name_en text not null
);
alter table mi.test_method enable row level security;

insert into mi.test_method (code, name_en) values
  ('visual','Visual inspection'),
  ('diagnostic_scan','Diagnostic scan'),
  ('borescope','Borescope inspection'),
  ('compression','Compression test'),
  ('leak_down','Leak down test'),
  ('battery_diagnostics','Battery diagnostics'),
  ('road_test','Road test'),
  ('cold_start','Cold start observation'),
  ('fluid_analysis','Fluid or filter analysis'),
  ('documentation','Documentation review'),
  ('vin_build_sheet','VIN or build sheet check'),
  ('hardware_identification','Hardware identification'),
  ('software_verification','Software verification'),
  ('overnight_test','Overnight settling test'),
  ('entitlement_verification','Entitlement verification'),
  ('dc_charge_session','DC charging session')
on conflict (code) do nothing;

-- 3.4. Види обслуговування.
create table if not exists mi.service_kind (
  code    text primary key,
  name_en text not null
);
alter table mi.service_kind enable row level security;

insert into mi.service_kind (code, name_en) values
  ('engine_oil','Engine oil and filter'), ('spark_plugs','Spark plugs'),
  ('ignition_coils','Ignition coils'), ('coolant','Engine coolant'),
  ('atf','Automatic transmission fluid'), ('transfer_case_fluid','Transfer case fluid'),
  ('differential_fluid','Differential fluid'), ('brake_fluid','Brake fluid'),
  ('battery_coolant','Battery coolant'), ('ac_desiccant','Air conditioning desiccant'),
  ('radiator_cleaning','Radiator pack cleaning'), ('charging_habit','Charging habit'),
  ('tire_rotation','Tire rotation'), ('other','Other')
on conflict (code) do nothing;

-- 3.5. Ролі звʼязку клейма з issue, maintenance, check. Компілятор спеціально
-- обробляє interval, contradicts і comparison_with; решта це групування.
create table if not exists mi.link_role (
  code          text primary key,
  name_en       text not null,
  is_behavioral boolean not null default false
);
alter table mi.link_role enable row level security;

insert into mi.link_role (code, name_en, is_behavioral) values
  ('symptom','Symptom', false), ('code','Diagnostic code', false),
  ('mechanism_detail','Mechanism detail', false), ('repair_option','Repair option', false),
  ('prevention','Prevention', false), ('cost','Cost', false),
  ('official_action','Official action', false), ('prerequisite','Prerequisite', false),
  ('interval','Service interval', true), ('related','Related knowledge', false),
  ('contradicts','Contradicting knowledge', true), ('comparison_with','Comparison', true)
on conflict (code) do nothing;

-- 3.6. Причини відмови у staging.
create table if not exists mi.rejection_reason (
  code    text primary key,
  name_en text not null
);
alter table mi.rejection_reason enable row level security;

insert into mi.rejection_reason (code, name_en) values
  ('no_source','No usable source'), ('vendor_only','Vendor content only'),
  ('insufficient_recurrence','Insufficient independent recurrence'),
  ('revision_transfer','Transfers knowledge across revisions'),
  ('duplicate','Duplicate of published knowledge'),
  ('contradiction_open','Unresolved contradiction'),
  ('missing_unit','Numeric value without unit'),
  ('out_of_scope','Out of scope'), ('other','Other')
on conflict (code) do nothing;

-- 3.7. Ринки.
create table if not exists mi.market (
  code    text primary key,
  name_en text not null
);
alter table mi.market enable row level security;

insert into mi.market (code, name_en) values
  ('US','United States'), ('CA','Canada'), ('EU','European Union'),
  ('UK','United Kingdom'), ('JP','Japan'), ('CN','China'),
  ('RU','Russia'), ('UA','Ukraine'), ('OTHER','Other market')
on conflict (code) do nothing;

-- 3.8. Ключі структурних атрибутів варіанта: використовуються предикатами,
-- тому під FK, але розширювані.
create table if not exists mi.attribute_key (
  code         text primary key,
  name_en      text not null,
  value_domain text
);
alter table mi.attribute_key enable row level security;

insert into mi.attribute_key (code, name_en, value_domain) values
  ('cylinder_bore_technology','Cylinder bore technology','alusil | nikasil | lds_coated | cast_iron_liner | closed_deck_lds'),
  ('cell_chemistry','Battery cell chemistry','nca | nmc | lfp'),
  ('has_rotor_coolant_seal','Rotor coolant seal present','true | false'),
  ('performance_division','Performance division build','series | m | amg | rs | gt'),
  ('injection_pressure_bar','Direct injection pressure, bar','numeric'),
  ('cooling_layout','Cooling layout','hot_v | conventional | liquid_rotor | air')
on conflict (code) do nothing;

-- 3.9. Теги умов експлуатації.
create table if not exists mi.condition_tag (
  code    text primary key,
  name_en text not null
);
alter table mi.condition_tag enable row level security;

insert into mi.condition_tag (code, name_en) values
  ('short_trips','Predominantly short trips'), ('salt_climate','Road salt climate'),
  ('humid_climate','Humid climate'), ('hot_climate','Hot climate'),
  ('taxi_use','Commercial or taxi use'), ('high_fuel_sulfur','High sulfur fuel'),
  ('towing','Regular towing'), ('track_use','Track use'),
  ('city_dominant','City dominant use'), ('highway_dominant','Highway dominant use')
on conflict (code) do nothing;

-- 3.10. Специфікації рідин. Колонка brand_scope отримує FK у міграції 02,
-- після появи mi.brand.
create table if not exists mi.fluid_spec (
  code        text primary key,
  brand_scope bigint,
  name_en     text not null,
  notes_en    text
);
alter table mi.fluid_spec enable row level security;

insert into mi.fluid_spec (code, name_en, notes_en) values
  ('BMW_LL01_FE_0W30','BMW Longlife-01 FE 0W-30', null),
  ('BMW_LL01','BMW Longlife-01', null),
  ('ZF_LIFEGUARD_8','ZF Lifeguard 8', null),
  ('BMW_DTF_1','BMW DTF-1 transfer case fluid', null),
  ('SHELL_TF_0870','Shell TF 0870 transfer case fluid', null),
  ('PORSCHE_A40_0W40','Porsche A40 0W-40', null),
  ('PORSCHE_A40_5W40','Porsche A40 5W-40', null),
  ('TESLA_G48_COOLANT','Tesla G48 compatible coolant', null),
  ('DOT4_BRAKE_FLUID','DOT 4 brake fluid', null)
on conflict (code) do nothing;
