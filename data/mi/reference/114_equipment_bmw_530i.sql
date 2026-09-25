-- Equipment v1: калібрувальний зріз обладнання BMW 530i xDrive G30, US MY2018.
--
-- Джерело кожного рядка: S-G-OFF-02, BMW of North America pricing guide,
-- 5 Series Sedan (G30) model year 2018, effective 1 July 2017 (колонка
-- 530i xDrive Sedan). Ціни в USD на дату цього прайсу.
--
-- Що це. Каталог обладнання бренду (mi.equipment_item, ключ бренду і
-- OEM-код SA) плюс доступність на ОДНОМУ VMY (vmy:530ix_us_2018). Це
-- ДОСТУПНІСТЬ: що можна було замовити. Наявність на конкретному VIN цей
-- файл не стверджує ніколи; її доводить лише доказ про саме це авто.
--
-- Відбір. Лише позиції, які помітно змінюють цінність авто для покупця
-- (value_tier notable або high_value), і лише ті, що прайс прямо дає для
-- 530i xDrive. Не заводяться: базове оснащення, дрібні опції (кольори,
-- підсклянники, SiriusXM), Premium Package ZPP (масовий пакет базового
-- комфорту), позиції лише для 540i (2VA, ZX5, ZX6, 5DV, окремий 2VH).
--
-- Умови замовлення. requires_item_id несе лише однозначну вимогу (ZDB
-- вимагає ZDA, ZPX вимагає ZDA, 6F1, 6FH і 6UK вимагають ZPX). Вимоги
-- «ZMP або ZPP» (для ZDA, ZLP, ZLS, ZPK, ZPX, 610, 688) одним посиланням
-- не виражаються і у зріз не входять: на пошук у Check вони не впливають.
--
-- Аліаси. Лише фрази, які однозначно називають саме цю позицію. Самі
-- OEM-коди (610, 688) аліасами для пошуку НЕ є: у тексті оголошення вони
-- збігаються з числами. Загальні «M Sport» і «B&W» свідомо не заведені:
-- перше збігається з M Sport brakes і кермом, друге неоднозначне.
--
-- Візуальні ознаки. cue_key збігається з поняттям Current Vision
-- (api/current-visual.js, EQUIPMENT_CONCEPTS). definitive дозволяє кадру
-- підтвердити позицію; ambiguous не підтверджує ніколи (звичайний
-- круїз-контроль, базові LED-фари і частково цифрова панель виглядають
-- схоже); not_visually_resolvable означає, що кадр тут нічого не доводить.

-- ---------- Наявні сутності ----------

-- Бренд, VMY і прайс уже є в каталозі (100, 103, 111). Файл бере їх за
-- природними ключами, тому заливається і в складі теки, і окремо поверх
-- заповненого каталогу (продакшн, окремий сеанс з 000_loader.sql).
select pg_temp.adopt('brand:bmw', (select subject_id from mi.brand where name = 'BMW'));
select pg_temp.adopt('vmy:530ix_us_2018', (
  select y.subject_id from mi.version_market_year y
    join mi.vehicle_version v on v.subject_id = y.version_id
   where v.version_code = '530I_XDRIVE' and y.market_code = 'US' and y.model_year = 2018));
select pg_temp.adopt_src('S-G-OFF-02', (
  select id from mi.source
   where title = 'BMW of North America pricing guide, 5 Series Sedan (G30) model year 2018, effective 1 July 2017, released 8 June 2017'));

-- ---------- Предмети ----------

insert into mi.equipment_item (subject_id, brand_id, equipment_key, oem_code, item_kind, name_en, value_tier) values
  (pg_temp.mk('equip:bmw_zda', 'equipment_item', 'BMW Driving Assistance Package'),
   pg_temp.sid('brand:bmw'), 'driving_assistance_package', 'ZDA', 'package', 'Driving Assistance Package', 'notable'),
  (pg_temp.mk('equip:bmw_zdb', 'equipment_item', 'BMW Driving Assistance Plus Package'),
   pg_temp.sid('brand:bmw'), 'driving_assistance_plus_package', 'ZDB', 'package', 'Driving Assistance Plus Package', 'high_value'),
  (pg_temp.mk('equip:bmw_zdh', 'equipment_item', 'BMW Dynamic Handling Package'),
   pg_temp.sid('brand:bmw'), 'dynamic_handling_package', 'ZDH', 'package', 'Dynamic Handling Package', 'high_value'),
  (pg_temp.mk('equip:bmw_zls', 'equipment_item', 'BMW Luxury Seating Package'),
   pg_temp.sid('brand:bmw'), 'luxury_seating_package', 'ZLS', 'package', 'Luxury Seating Package', 'high_value'),
  (pg_temp.mk('equip:bmw_zpx', 'equipment_item', 'BMW Executive Package'),
   pg_temp.sid('brand:bmw'), 'executive_package', 'ZPX', 'package', 'Executive Package', 'high_value'),
  (pg_temp.mk('equip:bmw_zpk', 'equipment_item', 'BMW Parking Assistance Package'),
   pg_temp.sid('brand:bmw'), 'parking_assistance_package', 'ZPK', 'package', 'Parking Assistance Package', 'notable'),
  (pg_temp.mk('equip:bmw_zlp', 'equipment_item', 'BMW Lighting Package'),
   pg_temp.sid('brand:bmw'), 'lighting_package', 'ZLP', 'package', 'Lighting Package', 'notable'),
  (pg_temp.mk('equip:bmw_zmp', 'equipment_item', 'BMW M Sport Package'),
   pg_temp.sid('brand:bmw'), 'm_sport_package', 'ZMP', 'package', 'M Sport Package', 'notable'),
  (pg_temp.mk('equip:bmw_610', 'equipment_item', 'BMW Head-up Display'),
   pg_temp.sid('brand:bmw'), 'head_up_display', '610', 'option', 'Head-up Display', 'high_value'),
  (pg_temp.mk('equip:bmw_5at', 'equipment_item', 'BMW Active Driving Assistant Plus'),
   pg_temp.sid('brand:bmw'), 'active_driving_assistant_plus', '5AT', 'option',
   'Active Driving Assistant Plus with Active Cruise Control with Stop & Go', 'high_value'),
  (pg_temp.mk('equip:bmw_688', 'equipment_item', 'BMW Harman Kardon surround sound system'),
   pg_temp.sid('brand:bmw'), 'harman_kardon_surround_sound', '688', 'option', 'Harman Kardon surround sound system', 'notable'),
  (pg_temp.mk('equip:bmw_6f1', 'equipment_item', 'BMW Bowers & Wilkins Diamond Surround Sound System'),
   pg_temp.sid('brand:bmw'), 'bowers_wilkins_diamond_surround_sound', '6F1', 'option',
   'Bowers & Wilkins Diamond Surround Sound System', 'high_value'),
  (pg_temp.mk('equip:bmw_6uk', 'equipment_item', 'BMW Night Vision with Pedestrian Detection'),
   pg_temp.sid('brand:bmw'), 'night_vision_pedestrian_detection', '6UK', 'option',
   'Night Vision with Pedestrian Detection', 'high_value'),
  (pg_temp.mk('equip:bmw_2vh', 'equipment_item', 'BMW Integral Active Steering'),
   pg_temp.sid('brand:bmw'), 'integral_active_steering', '2VH', 'option', 'Integral Active Steering', 'high_value'),
  (pg_temp.mk('equip:bmw_223', 'equipment_item', 'BMW Dynamic Damper Control'),
   pg_temp.sid('brand:bmw'), 'dynamic_damper_control', '223', 'option', 'Dynamic Damper Control', 'notable'),
  (pg_temp.mk('equip:bmw_453', 'equipment_item', 'BMW Front ventilated seats'),
   pg_temp.sid('brand:bmw'), 'front_ventilated_seats', '453', 'option', 'Front ventilated seats', 'high_value'),
  (pg_temp.mk('equip:bmw_4t7', 'equipment_item', 'BMW Front massaging seats'),
   pg_temp.sid('brand:bmw'), 'front_massaging_seats', '4T7', 'option', 'Front massaging seats', 'high_value'),
  (pg_temp.mk('equip:bmw_zx3', 'equipment_item', 'BMW Surround View with 3D View'),
   pg_temp.sid('brand:bmw'), 'surround_view_3d', 'ZX3', 'option', 'Surround View with 3D View', 'high_value'),
  (pg_temp.mk('equip:bmw_552', 'equipment_item', 'BMW Icon Adaptive Full LED Headlights'),
   pg_temp.sid('brand:bmw'), 'icon_adaptive_led_headlights', '552', 'option', 'Icon Adaptive Full LED Headlights', 'notable'),
  (pg_temp.mk('equip:bmw_6wb', 'equipment_item', 'BMW Dynamic Digital Instrument Cluster'),
   pg_temp.sid('brand:bmw'), 'dynamic_digital_instrument_cluster', '6WB', 'option', 'Dynamic Digital Instrument Cluster', 'notable'),
  (pg_temp.mk('equip:bmw_6fh', 'equipment_item', 'BMW Rear-seat entertainment Professional'),
   pg_temp.sid('brand:bmw'), 'rear_seat_entertainment_professional', '6FH', 'option',
   'Rear-seat entertainment Professional', 'high_value');

-- ---------- Доступність на US MY2018 ----------

insert into mi.equipment_availability (vmy_id, item_id, availability, price, currency, requires_item_id, source_id)
select pg_temp.sid('vmy:530ix_us_2018'), pg_temp.sid(v.item), v.availability::mi.availability,
       v.price, case when v.price is null then null else 'USD' end,
       case when v.requires is null then null else pg_temp.sid(v.requires) end,
       pg_temp.src('S-G-OFF-02')
  from (values
    -- Пакети: кожен замовляється окремою позицією прайсу.
    ('equip:bmw_zda', 'optional',   1700.00, null),
    ('equip:bmw_zdb', 'optional',   1700.00, 'equip:bmw_zda'),
    ('equip:bmw_zdh', 'optional',   1950.00, null),
    ('equip:bmw_zls', 'optional',   4050.00, null),
    ('equip:bmw_zpx', 'optional',   2100.00, 'equip:bmw_zda'),
    ('equip:bmw_zpk', 'optional',    700.00, null),
    ('equip:bmw_zlp', 'optional',   1050.00, null),
    ('equip:bmw_zmp', 'optional',   4900.00, null),
    -- Окремі опції з власною ціною.
    ('equip:bmw_610', 'optional',   1100.00, null),
    ('equip:bmw_688', 'optional',    875.00, null),
    ('equip:bmw_6f1', 'optional',   4200.00, 'equip:bmw_zpx'),
    ('equip:bmw_6uk', 'optional',   2300.00, 'equip:bmw_zpx'),
    ('equip:bmw_223', 'optional',   1000.00, null),
    ('equip:bmw_6fh', 'optional',   2200.00, 'equip:bmw_zpx'),
    -- Лише у складі пакета.
    ('equip:bmw_5at', 'in_package', null, null),
    ('equip:bmw_2vh', 'in_package', null, null),
    ('equip:bmw_453', 'in_package', null, null),
    ('equip:bmw_4t7', 'in_package', null, null),
    ('equip:bmw_zx3', 'in_package', null, null),
    ('equip:bmw_552', 'in_package', null, null),
    ('equip:bmw_6wb', 'in_package', null, null)
  ) as v(item, availability, price, requires);

-- ---------- Пакети на цьому VMY ----------

update mi.equipment_availability a
   set package_ids = v.pkgs
  from (select pg_temp.sid(item) as item_id, array_agg(pg_temp.sid(pkg) order by pkg) as pkgs
          from (values
            ('equip:bmw_610', 'equip:bmw_zda'),   -- ZDA: 5AS, 610, ZN1, ZN4
            ('equip:bmw_5at', 'equip:bmw_zdb'),   -- ZDB: 5AT
            ('equip:bmw_223', 'equip:bmw_zdh'),   -- ZDH (530i xDrive): 223, 2NH, 2VH
            ('equip:bmw_2vh', 'equip:bmw_zdh'),
            ('equip:bmw_453', 'equip:bmw_zls'),   -- ZLS: 453, 456, 4T7, Nappa
            ('equip:bmw_4t7', 'equip:bmw_zls'),
            ('equip:bmw_zx3', 'equip:bmw_zpk'),   -- ZPK: 5DN, ZX1, ZX3
            ('equip:bmw_zx3', 'equip:bmw_zpx'),   -- ZPX: 323, 552, 5AC, 5DN, 6WB, ZX1, ZX3
            ('equip:bmw_552', 'equip:bmw_zlp'),   -- ZLP: 552, 5AC
            ('equip:bmw_552', 'equip:bmw_zpx'),
            ('equip:bmw_6wb', 'equip:bmw_zpx')
          ) as r(item, pkg)
         group by item) v
 where a.vmy_id = pg_temp.sid('vmy:530ix_us_2018') and a.item_id = v.item_id;

-- ---------- Аліаси (у межах бренду BMW) ----------

insert into mi.subject_alias (target_subject_id, alias, alias_norm, lang, alias_kind, scope_kind, scope_subject_id, source_id)
select pg_temp.sid(v.item), v.alias, lower(v.alias), v.lang, v.kind::mi.alias_kind, 'brand',
       pg_temp.sid('brand:bmw'), case when v.kind = 'official' then pg_temp.src('S-G-OFF-02') end
  from (values
    ('equip:bmw_zda', 'Driving Assistance Package', 'en', 'official'),
    ('equip:bmw_zdb', 'Driving Assistance Plus Package', 'en', 'official'),
    ('equip:bmw_zdb', 'Driving Assistance Plus', 'en', 'community'),
    ('equip:bmw_zdh', 'Dynamic Handling Package', 'en', 'official'),
    ('equip:bmw_zls', 'Luxury Seating Package', 'en', 'official'),
    ('equip:bmw_zpx', 'Executive Package', 'en', 'official'),
    ('equip:bmw_zpk', 'Parking Assistance Package', 'en', 'official'),
    ('equip:bmw_zlp', 'Lighting Package', 'en', 'official'),
    ('equip:bmw_zmp', 'M Sport Package', 'en', 'official'),
    ('equip:bmw_zmp', 'пакет M Sport', 'uk', 'community'),
    ('equip:bmw_zmp', 'M-пакет', 'uk', 'community'),
    ('equip:bmw_610', 'Head-up Display', 'en', 'official'),
    ('equip:bmw_610', 'HUD', 'en', 'community'),
    ('equip:bmw_610', 'проекційний дисплей', 'uk', 'community'),
    ('equip:bmw_610', 'проекционный дисплей', 'ru', 'community'),
    ('equip:bmw_5at', 'Active Driving Assistant Plus', 'en', 'official'),
    ('equip:bmw_5at', 'Active Cruise Control', 'en', 'official'),
    ('equip:bmw_5at', 'адаптивний круїз-контроль', 'uk', 'community'),
    ('equip:bmw_5at', 'адаптивный круиз-контроль', 'ru', 'community'),
    ('equip:bmw_5at', 'adaptive cruise control', 'en', 'community'),
    ('equip:bmw_688', 'Harman Kardon', 'en', 'official'),
    ('equip:bmw_6f1', 'Bowers & Wilkins', 'en', 'official'),
    ('equip:bmw_6f1', 'Bowers and Wilkins', 'en', 'community'),
    ('equip:bmw_6uk', 'Night Vision', 'en', 'official'),
    ('equip:bmw_6uk', 'нічного бачення', 'uk', 'community'),
    ('equip:bmw_6uk', 'ночного видения', 'ru', 'community'),
    ('equip:bmw_2vh', 'Integral Active Steering', 'en', 'official'),
    ('equip:bmw_2vh', 'повнокероване шасі', 'uk', 'community'),
    ('equip:bmw_2vh', 'полноуправляемое шасси', 'ru', 'community'),
    ('equip:bmw_223', 'Dynamic Damper Control', 'en', 'official'),
    ('equip:bmw_453', 'Front ventilated seats', 'en', 'official'),
    ('equip:bmw_453', 'ventilated seats', 'en', 'community'),
    ('equip:bmw_453', 'вентиляція сидінь', 'uk', 'community'),
    ('equip:bmw_453', 'вентиляция сидений', 'ru', 'community'),
    ('equip:bmw_4t7', 'Front massaging seats', 'en', 'official'),
    ('equip:bmw_4t7', 'massage seats', 'en', 'community'),
    ('equip:bmw_4t7', 'масаж сидінь', 'uk', 'community'),
    ('equip:bmw_4t7', 'массаж сидений', 'ru', 'community'),
    ('equip:bmw_zx3', 'Surround View', 'en', 'official'),
    ('equip:bmw_zx3', 'камери кругового огляду', 'uk', 'community'),
    ('equip:bmw_zx3', 'камеры кругового обзора', 'ru', 'community'),
    ('equip:bmw_552', 'Icon Adaptive', 'en', 'official'),
    ('equip:bmw_552', 'адаптивні світлодіодні фари', 'uk', 'community'),
    ('equip:bmw_552', 'адаптивные светодиодные фары', 'ru', 'community'),
    ('equip:bmw_6wb', 'Dynamic Digital Instrument Cluster', 'en', 'official'),
    ('equip:bmw_6fh', 'Rear-seat entertainment', 'en', 'official'),
    ('equip:bmw_6fh', 'Rear Seat Entertainment', 'en', 'community')
  ) as v(item, alias, lang, kind)
 where not exists (select 1 from mi.subject_alias s
                    where s.scope_key = pg_temp.sid('brand:bmw') and s.alias_norm = lower(v.alias));

-- ---------- Візуальні ознаки ----------

insert into mi.equipment_visual_hint (equipment_id, cue_key, specificity, description_en, negative_note_en)
select pg_temp.sid(v.item), v.cue, v.spec::mi.visual_specificity, v.descr, v.neg
  from (values
    ('equip:bmw_610', 'hud', 'definitive',
     'Head-up display projector aperture on top of the dashboard in front of the driver, or the projected image on the windscreen.', null),
    ('equip:bmw_688', 'harman_kardon', 'definitive',
     'Harman Kardon logo on a door or dashboard speaker grille.', null),
    ('equip:bmw_6f1', 'bowers_wilkins', 'definitive',
     'Bowers & Wilkins logo or illuminated stainless speaker covers with the B&W mark.', null),
    ('equip:bmw_453', 'seat_ventilation', 'definitive',
     'Seat ventilation buttons (fan symbol) on the centre console or perforated ventilated seat centres with ventilation controls.',
     'Perforated leather alone does not prove ventilation.'),
    ('equip:bmw_4t7', 'seat_massage', 'definitive',
     'Massage control button or massage menu for the front seats.', null),
    ('equip:bmw_zx3', 'surround_camera', 'definitive',
     'Surround View or 3D View image on the central display, or camera lenses in both exterior mirror housings.',
     'A single rear camera view does not prove Surround View.'),
    ('equip:bmw_6fh', 'rear_seat_screens', 'definitive',
     'Two screens mounted on the backs of the front seats.', null),
    ('equip:bmw_6wb', 'digital_cluster', 'ambiguous',
     'Fully digital instrument cluster.', 'The standard cluster already has a display; the difference needs a clear frame.'),
    ('equip:bmw_5at', 'adaptive_cruise', 'ambiguous',
     'Distance setting button on the steering wheel.', 'Ordinary cruise control buttons look similar.'),
    ('equip:bmw_552', 'led_lights', 'ambiguous',
     'Icon Adaptive headlight graphics.', 'LED headlights are standard; the adaptive unit is hard to tell from photos.'),
    ('equip:bmw_2vh', 'integral_active_steering', 'not_visually_resolvable', null, 'Rear-axle steering is not visible from listing photos.'),
    ('equip:bmw_223', 'dynamic_damper_control', 'not_visually_resolvable', null, 'Adaptive dampers are not visible from listing photos.')
  ) as v(item, cue, spec, descr, neg);
