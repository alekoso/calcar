-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 140_reclassified.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- Phase 3.1: перекласифікація заблокованого еталонного знання.
--
-- Тут ЛИШЕ ті атоми, де докази з реєстру картки достатні, але заморожений
-- knowledge_type або формулювання сильніші, ніж джерела дозволяють.
-- Жодне правило gate не змінене і жодного нового дослідження не робилось:
-- набір джерел у кожного кандидата той самий, що був у Phase 3.
--
-- Старий заблокований кандидат НЕ видаляється: він лишається у staging із
-- збереженим gate_result і запискою, який кандидат його замінив. Новий
-- кандидат несе task_ref з суфіксом '-r1', тому атом простежується так
-- само (split_part по '#' дає той самий атом).
--
-- Два правила переписування тексту:
--   1. Перекласифікація не посилює клейм відносно доказів.
--   2. Якщо старий текст містив слова про поширеність у парку
--      («найчастіший», «типовий», «поширений», «слабке місце»), текст
--      переписаний на мову повторюваності доказів: скільки незалежних
--      звітів і що саме в них написано.

\o /dev/null

-- ---------- A1. known_issue -> owner_pattern ----------

-- C-037. Старий текст називав актуатор «найчастішим одиничним ремонтом
-- мотора»: це твердження про частку парку, якого дані не дають.
select mi_load.stage('C-037#r1', 'bmw', 'issue:n63_wastegate_actuator', 'owner_pattern', 'medium',
  'Five independent owner reports on the 2018 and 2019 M550i describe replacing the electric wastegate actuator at mileages between 51,000 and 169,000 kilometres, setting fault 123704 and the surrounding 1234xx and 1235xx family. The part is quoted at about 650 dollars and a dealer at between 1,100 and 2,000 dollars, and two of the reports say aftermarket parts brought the fault back.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'Replaced separately from the turbocharger; use the original part.',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","part":650,"dealer_from":1100,"dealer_to":2000,"fault_code":"123704"}'::jsonb,
    'note', 'Reclassified from known_issue in Phase 3.1: the registry carries no official source and no primary specialist for this failure on the G30, so the evidence supports an owner pattern and not an established defect. Prevalence wording removed: the share of the fleet is unknown and the claim no longer ranks this repair against others.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-02', 'thread:bp-2074062', '{"mileage_km":100000}'::jsonb),
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":167000}'::jsonb),
      mi_load.ev('S-OWN-06', 'thread:bp-2193771', '{"mileage_km":169000}'::jsonb),
      mi_load.ev('S-OWN-07', 'thread:bp-2017789', '{"mileage_km":93000}'::jsonb),
      mi_load.ev('S-OWN-30', 'thread:bp-1905102', '{"mileage_km":51000}'::jsonb),
      mi_load.ev('S-MKT-02'))));

-- P-024. Старий текст називав ТНВД «слабким місцем» цього мотора.
select mi_load.stage('P-024#r1', 'porsche', 'issue:958_hpfp', 'owner_pattern', 'medium',
  'Two independent buyer threads for this car advise checking the high pressure fuel pump and describe long cranking, hesitation, the P0087 fault and limp mode, with the repair quoted between one thousand and two and a half thousand dollars.',
  jsonb_build_object(
    'importance', 4,
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","from":1000,"to":2500,"fault_code":"P0087"}'::jsonb,
    'note', 'Reclassified from known_issue in Phase 3.1: the registry carries no official source and no primary specialist for this pump, only a secondary workshop article and two buyer threads. Prevalence wording removed: the pump is no longer called a weak point of the engine.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-07'),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb))));

-- P-051#a. Старий текст стверджував причину як факт і подавав симптоми як
-- властивість моделі.
select mi_load.stage('P-051#a-r1', 'porsche', 'issue:958_transfer_case', 'owner_pattern', 'medium',
  'Two independent owner reports, at 140,000 and 150,000 kilometres, describe judder and snatch under acceleration at low speed, on the second to third change, with a grinding feel and clicking. Workshop articles attribute it to degradation of the friction additives in the fluid. Fresh fluid with a calibration removed the symptom at an early stage in these reports, and a later replacement was quoted between five and five and a half thousand dollars, with the actuator available separately.',
  jsonb_build_object(
    'importance', 5,
    'implication', 'The problem belongs to this phase of the generation, not only to the facelift.',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","from":5000,"to":5500}'::jsonb,
    'note', 'Reclassified from known_issue in Phase 3.1: the registry carries only secondary workshop articles plus two owner reports. The existence of the defect itself stays established by P-050, which rests on the manufacturer warranty extension. Fresh fluid removes the symptom without restoring a worn pack.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-10'), mi_load.ev('S-P-SPEC-11'),
      mi_load.ev('S-P-OWN-05', 'thread:rennlist-1290994', '{"mileage_km":150000}'::jsonb),
      mi_load.ev('S-P-OWN-05', 'thread:6speed-tc-replaced', '{"mileage_km":140000}'::jsonb))));

-- ---------- A2. known_issue -> specialist_practice ----------

-- P-023. Первинне спеціалістське джерело є, двох груп власників немає.
select mi_load.stage('P-023#r1', 'porsche', 'issue:958_aos', 'specialist_practice', 'medium',
  'A workshop repair procedure for this engine describes the failure of the air oil separator: when the diaphragm tears the crankcase goes under intake vacuum, which produces white smoke, oil consumption, a whistle, oiled plugs and damaged catalysts. The part sits under the intake, dealer estimates run to several thousand, and diaphragm repair kits exist.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'A vacuum test at the oil filler is the practical check.',
    'causal', 'supported_cause',
    'note', 'Reclassified from known_issue in Phase 3.1: one primary specialist source and one owner thread. Part of the source material concerns other generations of the same design. A vacuum test at the oil filler is the practical check.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-06'),
      mi_load.ev('S-P-OWN-02', 'thread:planet9-aos', '{"age_years":10}'::jsonb))));

-- P-060#a. Старий текст казав «typically ближче до 200,000 км»: це
-- твердження про розподіл у парку з одного звіту.
select mi_load.stage('P-060#a-r1', 'porsche', 'issue:958_air_strut', 'specialist_practice', 'medium',
  'An in-depth repair guide for this air suspension describes struts leaking at any corner and the compressor burning out once a leak is present; one owner report places a leak near 200,000 kilometres. The original compressor is reported unavailable, remanufactured units are described as unreliable, and an aftermarket set was quoted at about 3,800 dollars plus about eight hours of labour.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'On this version the air suspension is an option, so a steel sprung car is simpler.',
    'causal', 'supported_cause',
    'value_kind', 'cost',
    'value', '{"currency":"USD","market":"US","as_of":"2026-09","strut_set":3800,"labour_hours":8}'::jsonb,
    'note', 'Reclassified from known_issue in Phase 3.1: one primary specialist source and one owner thread, which is short of the two owner groups a known issue needs. Prevalence wording removed: the mileage at which struts leak is no longer described as typical. On this version the air suspension is an option, so a steel sprung car does not carry this risk at all.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-13'),
      mi_load.ev('S-P-OWN-06', 'thread:planet9-249893', '{"mileage_km":200000}'::jsonb))));

-- T-052. Первинний спеціаліст є, власницьких груп немає зовсім.
select mi_load.stage('T-052#r1', 'tesla', 'issue:yellow_border', 'specialist_practice', 'high',
  'Independent screen repair specialists describe the yellow border around the central screen as the adhesive discolouring under ultraviolet light and heat, curable with an ultraviolet treatment, while bubbling and delamination need a new digitizer.',
  jsonb_build_object(
    'importance', 2,
    'causal', 'supported_cause',
    'applic', jsonb_build_array(
      mi_load.p_date('production_date', null, date '2017-12-31')),
    'note', 'Reclassified from known_issue in Phase 3.1: the registry carries one primary specialist source and no owner group at all.',
    'ev', jsonb_build_array(mi_load.ev('S-T-SPEC-10'))));

-- ---------- A3. owner_pattern -> specialist_practice ----------

-- T-051. Єдине джерело атома це первинний спеціаліст, а не власник.
select mi_load.stage('T-051#r1', 'tesla', 'issue:cluster_flicker', 'specialist_practice', 'medium',
  'Independent media unit repair specialists report that the instrument cluster uses the same kind of flash memory as the media unit and flickers or goes black for the same reason, and that it is not covered by the recall.',
  jsonb_build_object(
    'importance', 3,
    'causal', 'plausible_mechanism',
    'note', 'Reclassified from owner_pattern in Phase 3.1: the single source is a primary specialist, not an owner community, so the owner pattern type never matched the evidence.',
    'ev', jsonb_build_array(mi_load.ev('S-T-SPEC-10'))));

-- ---------- A4. official_fact -> specialist_practice ----------

-- T-020#a. Розбирання з вимірюванням це спеціалістське знання, а не
-- офіційний документ виробника.
select mi_load.stage('T-020#a-r1', 'tesla', 'var:pack_85_gen1', 'specialist_practice', 'high',
  'An independent teardown of this pack counted sixteen modules of 444 cylindrical cells, 7,104 cells in total.',
  jsonb_build_object(
    'importance', 2,
    'implication', 'The number in the name is marketing.',
    'causal', 'supported_cause',
    'value_kind', 'quantity',
    'value', '{"modules":16,"cells_per_module":444,"cells_total":7104,"unit":"cells"}'::jsonb,
    'note', 'Reclassified from official_fact in Phase 3.1: the manufacturer never published this breakdown; the figure comes from an independent teardown, which is primary specialist evidence.',
    'ev', jsonb_build_array(mi_load.ev('S-T-SPEC-04'))));

-- ---------- A5. owner_pattern -> official_fact, звужений ----------

-- C-093. Офіційне джерело підтверджує лише задній пріоритет приводу.
-- Зимова частина твердження лишається заблокованою у старому кандидаті.
select mi_load.stage('C-093#r1', 'bmw', 'ver:m550i_g30', 'official_fact', 'high',
  'The all wheel drive system of this version is rear biased.',
  jsonb_build_object(
    'importance', 2,
    'note', 'Narrowed from owner_pattern in Phase 3.1: the official source supports only the rear bias. The winter behaviour half of the atom rests on owner threads without mileage or age context and stays blocked in candidate C-093.',
    'ev', jsonb_build_array(mi_load.ev('S-OFF-14'))));

-- ---------- A6. owner_practice -> owner_pattern ----------
-- owner_practice у замороженій архітектурі це сильніше твердження: воно
-- каже, що практика повторюється у спільнотах, і вимагає трьох груп на
-- двох платформах або двох ринках. Там, де цього немає, чесний тип це
-- owner_pattern: що саме описали конкретні власники.

select mi_load.stage('C-066#r1', 'bmw', 'maint:n63tu2_radiators', 'owner_pattern', 'medium',
  'Two independent owner reports from hot and dusty conditions, at 90,000 and at 160,000 kilometres, describe the same routine: washing the radiator pack once a year with the pack removed, running only 98 to 100 octane fuel, keeping idling to a minimum and watching the coolant level. A specialist blog describes the same routine.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Traces of radiator cleaning and high octane fuel in the history are a plus; a dirty radiator pack at the viewing is a minus.',
    'layer', 'owner',
    'applic', jsonb_build_array(
      mi_load.p_tag('condition_tag', 'hot_climate', 1),
      mi_load.p_tag('condition_tag', 'city_dominant', 1)),
    'note', 'Reclassified from owner_practice in Phase 3.1: two owner groups on two platforms, which is short of the three groups an owner practice needs.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-33', 'thread:d2-750li', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OWN-35', 'thread:bf-1458547', '{"mileage_km":160000}'::jsonb),
      mi_load.ev('S-SPEC-20'))));

-- C-067. Старий текст казав «поширений у СНД»: це поширеність.
select mi_load.stage('C-067#r1', 'bmw', 'state:n63_thermostat_defeat', 'owner_pattern', 'medium',
  'Two independent owner reports from the former Soviet states, both around 90,000 kilometres, describe a cold thermostat, a resistor placed between the temperature sensor and the engine control unit, and owners in the same threads dispute it, calling it a nail in the coffin under load.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'CalCar does not recommend it and treats it as an intervention to find during inspection.',
    'contested', true,
    'contested_note', 'Owners in the same threads argue that the device kills the engine under load, and the official temperature map shows the high reading is designed behaviour.',
    'applic', jsonb_build_array(
      mi_load.p_tag('market_operated', 'RU', 1),
      mi_load.p_tag('market_operated', 'UA', 1)),
    'note', 'Reclassified from owner_practice in Phase 3.1: two owner groups on one platform. Prevalence wording removed: the device is no longer described as widespread. CalCar does not recommend it and treats it as an intervention to find during inspection.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-33', 'thread:d2-750li', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OWN-25', 'thread:d2-m550', '{"mileage_km":90000}'::jsonb),
      mi_load.ev('S-OFF-16', null, null, 'contradicts',
        'The official temperature map of 105 to 120 degrees Celsius shows that the high reading is designed behaviour.'))));

select mi_load.stage('C-081#r1', 'bmw', 'maint:zf8hp75_atf', 'owner_pattern', 'medium',
  'Two independent owner reports describe changing the transmission, transfer case and differential fluids between 80,000 and 160,000 kilometres, one of them at 80,000 and again at 160,000 kilometres with no trouble by that point.',
  jsonb_build_object(
    'importance', 3,
    'layer', 'owner',
    'note', 'Reclassified from owner_practice in Phase 3.1: two owner groups on one platform.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OWN-04', 'thread:bp-1950718', '{"mileage_km":161000}'::jsonb),
      mi_load.ev('S-OWN-14', 'thread:bp-1971470', '{"mileage_km":130000}'::jsonb))));

select mi_load.stage('P-053#a-r1', 'porsche', 'maint:958_diff_fluid', 'owner_pattern', 'medium',
  'Three independent buyer threads describe the torque vectoring rear differential as wanting frequent fluid changes and clattering otherwise, and give the capacity as one litre for the open differential and two litres with the lock.',
  jsonb_build_object(
    'importance', 2,
    'layer', 'owner',
    'note', 'Reclassified from owner_practice in Phase 3.1: three owner groups, but all on one platform and one market, which is short of what an owner practice needs.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-gts-or-turbo', '{"age_years":11}'::jsonb))));

-- P-072. Старий текст казав «власники чистять як само собою зрозуміле».
select mi_load.stage('P-072#r1', 'porsche', 'maint:958_drains', 'owner_pattern', 'medium',
  'Three independent buyer threads describe the air conditioning and scuttle drains blocking and putting water into the footwells and the modules, and describe cleaning and shortening them as one of the first jobs on the car.',
  jsonb_build_object(
    'importance', 3,
    'layer', 'owner',
    'note', 'Reclassified from owner_practice in Phase 3.1: three owner groups, all on one platform and one market.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-gts-or-turbo', '{"age_years":11}'::jsonb))));

-- P-082. Старий текст казав «owner consensus»: це твердження про весь
-- загал власників, а не про три треди.
select mi_load.stage('P-082#r1', 'porsche', 'ver:cayenne_gts_958_1', 'owner_pattern', 'medium',
  'Three independent buyer threads for this car advise the same thing: service records matter more than the odometer, a pre-purchase inspection by a marque specialist is worth its cost, and cars without records are best avoided.',
  jsonb_build_object(
    'importance', 4,
    'note', 'Reclassified from owner_practice in Phase 3.1: three owner groups, all on one platform and one market. Prevalence wording removed: the advice is no longer attributed to the owner population as a consensus.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-02'),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-no-records', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-2013-advice', '{"age_years":11}'::jsonb),
      mi_load.ev('S-P-OWN-03', 'thread:rennlist-gts-or-turbo', '{"age_years":11}'::jsonb))));

-- T-029. Старий текст казав «дбайливі власники роблять так»: це опис
-- практики спільноти, якої дві групи на одній платформі не доводять.
select mi_load.stage('T-029#r1', 'tesla', 'maint:pack_charging_habit', 'owner_pattern', 'medium',
  'Two long term owner reports on this pack, at eight and nine years of age, describe the same charging routine: fifty to eighty or ninety percent day to day, a full charge only before a trip, not leaving the car below ten to twenty percent for long, slow overnight charging and rapid charging only when needed.',
  jsonb_build_object(
    'importance', 4,
    'implication', 'The charging history is visible in the vehicle data as direct current energy taken.',
    'layer', 'owner',
    'note', 'Reclassified from owner_practice in Phase 3.1: two owner groups on one platform and one market. The causal link at the level of cell chemistry is generally accepted but is not established by these two reports, so it is no longer asserted by this claim.',
    'ev', jsonb_build_array(
      mi_load.ev('S-T-OWN-10', 'thread:tmc-286839', '{"age_years":8}'::jsonb),
      mi_load.ev('S-T-OWN-08', 'thread:tmc-285721', '{"age_years":9}'::jsonb))));

-- ---------- Публікація перекласифікованих (крім синтезу) ----------

do $$
declare r record; v_id bigint;
begin
  for r in select id from mi.candidate_claim
            where task_ref ~ 'r1$' and proposed_knowledge_type <> 'calcar_synthesis'
            order by id loop
    perform mi.run_gate(r.id);
  end loop;
  for r in select id from mi.candidate_claim
            where task_ref ~ 'r1$' and proposed_knowledge_type <> 'calcar_synthesis'
              and (gate_result->>'passed')::boolean
            order by id loop
    v_id := mi.publish_candidate(r.id, 'phase3.1-reclassification');
  end loop;
end $$;

-- ---------- A7. Синтез ----------

-- C-072. Твердження про запас коробки це висновок із двох опублікованих
-- клеймів, а не спеціалістська практика. Конкретні слабкі вузли, названі
-- тюнінг-вендорами, з тексту прибрані: незалежного джерела під ними немає.
select mi_load.stage('C-072#r1', 'bmw', 'var:zf8hp75', 'calcar_synthesis', 'medium',
  'The factory itself asks this transmission for 750 Nm only on the later engine of the same family, so a reflashed car of this model year is asking more of it than the factory ever did. The absence of observed transmission failures on standard cars does not carry over to reflashed ones, and the specific failure points named by tuning vendors are not established by any independent source.',
  jsonb_build_object(
    'importance', 3,
    'implication', 'Anything beyond a first stage reflash means accelerated wear.',
    'note', 'Reclassified from specialist_practice in Phase 3.1: the registry carries only tuning vendors and a search summary, which cannot establish knowledge on their own. What survives is a conclusion drawn from two already published claims.',
    'ev', jsonb_build_array(
      mi_load.ev('S-OFF-02'),
      mi_load.ev('S-OWN-03', 'thread:bp-2152583', '{"mileage_km":177000}'::jsonb),
      mi_load.ev('S-TUN-03', null, null, 'context',
        'Tuning vendors name clutch pack E, the C and E hubs and the transfer case as weak points under high power; no independent source confirms it.'))));

-- P-081. Тип не змінюється: картка справді відмовляється давати число.
-- Змінюється те, що відмова тепер спирається на опубліковані клейми, а не
-- висить без опор. Це виправлення завантаження Phase 3, а не картки.
select mi_load.stage('P-081#r1', 'porsche', 'ver:cayenne_gts_958_1', 'calcar_synthesis', 'high',
  'CalCar gives no annual running cost figure for this car. What drives the spread is optional hardware: the air suspension, the active anti roll system and the ceramic brakes each carry a liability that a car without them does not have, and the transfer case behind them was covered by an extended warranty that has now expired. A single annual number would describe no actual car.',
  jsonb_build_object(
    'importance', 3,
    'note', 'The knowledge type is unchanged. Phase 3 staged this atom with no supports and no evidence, so the quality gate could not see what the refusal rests on; Phase 3.1 links the published claims that drive the spread.',
    'ev', jsonb_build_array(
      mi_load.ev('S-P-SPEC-13'), mi_load.ev('S-P-LEG-03'))));

do $$
declare r record; ids bigint[]; v_id bigint;
begin
  for r in select * from (values
    ('C-072#r1', array['C-003','C-083']),
    ('P-081#r1', array['P-060#a-r1','P-050#a'])
  ) as t(synth, supports) loop
    select array_agg(c.published_claim_id) into ids
      from mi.candidate_claim c
     where c.task_ref = any (r.supports) and c.published_claim_id is not null;
    update mi.candidate_claim
       set proposed_links = jsonb_build_object('supports',
             to_jsonb(coalesce(ids, '{}'::bigint[])::text[])),
           reviewer = 'phase3.1-reclassification'
     where task_ref = r.synth;
  end loop;

  for r in select id from mi.candidate_claim
            where task_ref ~ 'r1$' and proposed_knowledge_type = 'calcar_synthesis'
            order by id loop
    perform mi.run_gate(r.id);
  end loop;
  for r in select id from mi.candidate_claim
            where task_ref ~ 'r1$' and proposed_knowledge_type = 'calcar_synthesis'
              and (gate_result->>'passed')::boolean
            order by id loop
    v_id := mi.publish_candidate(r.id, 'phase3.1-reclassification');
  end loop;
end $$;

-- ---------- Аудит: старий кандидат зберігається і знає свою заміну ----------

update mi.candidate_claim old
   set review_note = concat_ws(' | ', old.review_note,
         'Phase 3.1: superseded for publication by candidate ' || new_ref.task_ref
         || '; this candidate is kept blocked for audit.')
  from (select task_ref, regexp_replace(task_ref, '(#|-)r1$', '') as base
          from mi.candidate_claim where task_ref ~ 'r1$') new_ref
 where old.task_ref = new_ref.base;

\o
