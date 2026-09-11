-- Phase 3.2: buyer-метадані еталонного корпусу.
--
-- Переносить у staging два поля, які Phase 3 втрачала:
--   importance   наскільки знання здатне змінити рішення покупця, 1..5;
--   implication  дослівний buyer-текст атома з поля buyer_implication
--                самої замороженої картки, перекладений англійською.
--
-- Нового дослідження тут немає. Там, де картка у полі buyer_implication
-- нічого не написала, лишається NULL: вигадувати buyer-текст не можна,
-- і 90 атомів із 194 справді його не мають.
--
-- Важливість присвоєна за шкалою, однаковою для трьох карток:
--   5  змінює рішення купувати або ні, або несе неповоротну втрату;
--   4  змінює ціну або план передпродажної перевірки;
--   3  формує очікування власника;
--   2  фоновий факт;
--   1  дрібниця.
-- Для 108 атомів вона вже була присвоєна у Phase 3.1 і перенесена сюди
-- без змін.
--
-- Значення застосовуються по АТОМУ: обидві половини розщепленого атома
-- успадковують той самий buyer-текст, бо у картці він один на атом.
-- Перекласифіковані кандидати Phase 3.1 задають свої значення самі,
-- у файлі 140.
--
-- contested ставиться лише там, де оспорюється сама теза і суперечка НЕ
-- закрита. Там, де картка вже розвʼязала конфлікт на користь документа,
-- і там, де у полі стоїть лише зауваження про невизначеність, прапорець
-- не ставиться.

\o /dev/null

create temporary table buyer_meta (
  atom        text primary key,
  importance  smallint not null,
  implication text,
  contested   boolean not null default false,
  note        text
);

insert into buyer_meta (atom, importance, implication, contested, note) values
  ('C-001', 4, 'Decides which engine claims apply to the car at all.', false, null),
  ('C-002', 3, null, false, null),
  ('C-003', 4, 'Model years 2018 and 2019 are mechanically identical; 2020 is a different engine and a different differential.', false, null),
  ('C-004', 3, 'Leaves headroom up to the 750 Nm the transmission is rated for.', false, null),
  ('C-005', 4, 'Drives the transfer case fluid specification and the sensitivity to mismatched tyres.', false, null),
  ('C-006', 3, 'A pre-2020 car is less of an M car on the way out of a corner.', false, null),
  ('C-007', 3, null, false, null),
  ('C-008', 2, 'Shapes what the options are worth on the used market.', false, null),
  ('C-009', 2, 'Expensive discs.', false, null),
  ('C-010', 1, 'A heavy nose.', false, null),
  ('C-011', 2, null, false, null),
  ('C-012', 2, null, false, null),
  ('C-013', 3, 'Check that the recall was closed.', false, null),
  ('C-014', 3, 'Check the status against the vehicle identification number.', false, null),
  ('C-015', 4, 'Do not pay for the look: the vehicle identification number and the engine decide.', false, null),
  ('C-020', 3, 'Part of the reputation of this engine family does not belong to this revision.', false, null),
  ('C-021', 3, 'The third update is stronger and more modern, but the actuators and the cooling inside the vee remain a subject.', false, null),
  ('C-022', 2, 'One of the two real arguments for the third update alongside the bore coating; it does not mean that engine never smokes.', false, null),
  ('C-023', 3, 'The injectors of this revision are not part of the piezo trouble of the 2008 to 2013 engines.', false, null),
  ('C-024', 4, 'The key to what this car costs as it ages.', false, null),
  ('C-025', 5, 'Reboring to an oversize is impossible, scoring is irreversible, and repair means a used engine, a new block or sleeving.', false, null),
  ('C-026', 3, 'A high reading on the dashboard is designed behaviour; a cold thermostat is an intervention, not a repair.', false, null),
  ('C-030', 4, 'One litre per 2,500 to 4,000 kilometres is formally within the allowance but is a reason to look for a cause; one litre per 1,500 kilometres or less is a diagnosis; no top-up at 130,000 kilometres is plausible.', true, 'A 2019 class action named this model among the affected cars, while the owner reports here describe no consumption at all.'),
  ('C-031', 3, 'A warranty threshold, not a description of a healthy engine.', false, null),
  ('C-032', 3, 'Indirect evidence that this revision has no systemic oil consumption.', false, null),
  ('C-033', 4, 'Any thermostat fault means inspecting the harness.', false, null),
  ('C-034', 4, 'In the United States the cover runs to 2033; outside it there is no cover, but the defect is acknowledged.', false, null),
  ('C-035', 3, 'This model started production in March 2017 and is not in the campaign, although the design is the same.', false, null),
  ('C-036', 5, 'Between 100,000 and 150,000 kilometres expect to replace one or two cooling components; town driving brings it forward.', false, null),
  ('C-037', 4, 'Replaced separately from the turbocharger; use the original part.', false, null),
  ('C-038', 3, 'Shows that the manufacturer knows this actuator defect on this engine.', false, null),
  ('C-039', 3, 'Do not promise the buyer this cover.', false, null),
  ('C-040', 2, 'Watch for smoke on a throttle blip after the engine has idled.', false, null),
  ('C-041', 2, 'A leak that is expensive in labour.', false, null),
  ('C-042', 2, 'Do not carry this over.', false, null),
  ('C-043', 3, 'Do not call injectors a typical weakness of this revision.', false, null),
  ('C-044', 2, 'A planned cleaning job.', false, null),
  ('C-045', 1, 'An age related item.', false, null),
  ('C-046', 1, null, false, null),
  ('C-047', 1, null, false, null),
  ('C-048', 1, 'The engine itself is capable of high mileage; everything around it needs a budget.', false, null),
  ('C-049', 3, 'One to two minutes of gentle driving before parking.', false, null),
  ('C-050', 1, null, false, null),
  ('C-051', 5, 'Not every car of this revision is prone to it, but the damage is irreversible, costs about a third of the car, is not tied to mileage and is invisible in compression and oil.', false, null),
  ('C-052', 4, 'How the car was used matters more than the odometer, and the risk in Ukraine is no lower than in the United States.', false, null),
  ('C-053', 2, 'Not a preventive service item; look for symptoms instead, meaning smoke after idling, a whistle and lean fault codes.', false, null),
  ('C-054', 2, 'A service item rather than a risk, but eight of them make the job expensive.', false, null),
  ('C-055', 2, 'When replacing a single injector, check the indices.', false, null),
  ('C-056', 3, 'The turbochargers suffer from oil, cooling and actuators rather than from distance covered.', false, null),
  ('C-057', 4, 'Watching the oil level and keeping the radiators clean protects the most expensive part of the engine.', false, null),
  ('C-060', 3, 'An upper limit, not a CalCar recommendation.', false, null),
  ('C-061', 2, null, false, null),
  ('C-062', 4, null, false, null),
  ('C-063', 4, 'Documented changes roughly every 5,000 to 8,000 kilometres are a positive signal in the history; there is no threshold beyond which the engine dies.', false, null),
  ('C-064', 3, null, true, 'Some sources give the interval as 60,000 miles instead.'),
  ('C-065', 2, 'Practice is five to six years.', false, null),
  ('C-066', 3, 'Traces of radiator cleaning and high octane fuel in the history are a plus; a dirty radiator pack at the viewing is a minus.', false, null),
  ('C-067', 3, 'CalCar does not recommend it and treats it as an intervention to find during inspection.', true, 'Owners in the same threads argue that the device kills the engine under load, and the official temperature map shows the high reading is designed behaviour.'),
  ('C-068', 5, 'Every item is a signal, not a guarantee.', false, null),
  ('C-070', 2, null, false, null),
  ('C-071', 2, null, false, null),
  ('C-072', 3, 'Anything beyond a first stage reflash means accelerated wear.', false, null),
  ('C-080', 4, null, true, 'The transmission manufacturer own documents give different figures for the first fluid change.'),
  ('C-081', 3, null, false, null),
  ('C-082', 3, null, false, null),
  ('C-083', 3, null, false, null),
  ('C-090', 4, null, false, null),
  ('C-091', 2, null, false, null),
  ('C-092', 3, null, false, null),
  ('C-093', 2, null, false, null),
  ('C-100', 3, null, false, null),
  ('C-101', 2, null, false, null),
  ('C-102', 3, 'The package is not a must have.', false, null),
  ('C-103', 2, null, false, null),
  ('C-104', 1, null, false, null),
  ('C-110', 5, 'The most expensive repair on this car that has nothing to do with the engine.', false, null),
  ('C-111', 2, null, false, null),
  ('C-112', 2, null, false, null),
  ('C-113', 2, null, false, null),
  ('C-114', 1, null, false, null),
  ('C-115', 2, null, false, null),
  ('C-116', 2, null, true, 'An owner supplied document describes the exhaust note as thick and pedigreed, which is the opposite of what the owner threads say.'),
  ('C-120', 3, null, false, null),
  ('C-121', 3, null, false, null),
  ('C-122', 4, null, false, null),
  ('C-123', 2, null, false, null),
  ('C-124', 1, null, false, null),
  ('C-125', 2, null, false, null),
  ('C-126', 1, null, false, null),
  ('C-127', 3, 'This is not a detuned M car: a reflash adds none of the M lubrication, cooling or manifold.', false, null),
  ('C-130', 5, 'The cost of repairing scoring is comparable to a third of the car.', false, null),
  ('C-131', 2, null, false, null),
  ('C-132', 4, 'Twenty to thirty thousand kilometres covered after the work without complaint lowers the risk.', false, null),
  ('C-133', 4, 'A good rebuild can be technically sound; the word permanently must not be used.', true, 'Workshops claim durability after the work while no denominator exists, and the claim that sleeving cures scoring permanently is not demonstrated.'),
  ('C-134', 5, null, false, null),
  ('C-135', 4, null, false, null),
  ('C-140', 5, 'A mandatory check at any mileage.', false, null),
  ('C-141', 3, 'Worth doing, but not a substitute for looking inside the cylinders.', false, null),
  ('C-142', 2, null, false, null),
  ('C-143', 5, null, false, null),
  ('C-144', 2, null, false, null),
  ('C-145', 3, null, false, null),
  ('C-146', 5, null, false, null),
  ('P-001', 4, null, false, null),
  ('P-002', 3, 'The key to the character of this version; a body kit does not reproduce it.', false, null),
  ('P-003', 2, null, false, null),
  ('P-004', 2, null, false, null),
  ('P-005', 2, null, false, null),
  ('P-006', 5, 'A steel sprung car of this version ages more simply.', true, 'One catalogue lists the air suspension as standard on this version, which either belongs to the facelift or is an error.'),
  ('P-007', 3, null, false, null),
  ('P-008', 2, null, false, null),
  ('P-009', 5, 'Reboring is impossible; repair means sleeving or a new block.', false, null),
  ('P-020', 5, 'Low frequency, catastrophic severity: the borescope inspection is mandatory.', false, null),
  ('P-021', 5, 'Ask for proof that the pipes were replaced, and do the job preventively when the water pump comes out.', false, null),
  ('P-022', 3, null, false, null),
  ('P-023', 4, 'A vacuum test at the oil filler is the practical check.', false, null),
  ('P-024', 4, null, false, null),
  ('P-025', 2, null, false, null),
  ('P-026', 3, 'For the 2013 car of this version this is not a pattern; check it when the area is open anyway.', true, 'Individual sources extend the affected range to 2013 without documents behind it.'),
  ('P-027', 2, 'Not applicable to model year 2013.', false, null),
  ('P-028', 3, null, false, null),
  ('P-029', 3, null, false, null),
  ('P-030', 3, 'Short intervals are a positive signal.', false, null),
  ('P-040', 3, null, false, null),
  ('P-041', 3, 'Separate the transmission from the transfer case during diagnosis.', false, null),
  ('P-042', 3, null, false, null),
  ('P-050', 5, 'For a model year 2013 car the extension ran out in 2023.', false, null),
  ('P-051', 5, 'The problem belongs to this phase of the generation, not only to the facelift.', false, null),
  ('P-052', 4, 'Invoices for transfer case fluid are a strong plus.', false, null),
  ('P-053', 2, null, false, null),
  ('P-054', 2, null, false, null),
  ('P-060', 4, 'On this version the air suspension is an option, so a steel sprung car is simpler.', false, null),
  ('P-061', 4, 'This option is a risk on an old car without history.', false, null),
  ('P-062', 2, null, false, null),
  ('P-063', 4, 'A positive feature and a risk at the same time.', false, null),
  ('P-064', 2, null, false, null),
  ('P-070', 2, null, false, null),
  ('P-071', 3, 'Test the battery first.', false, null),
  ('P-072', 3, null, false, null),
  ('P-073', 1, 'Cosmetic.', false, null),
  ('P-080', 3, null, false, null),
  ('P-081', 3, null, false, null),
  ('P-082', 4, null, false, null),
  ('P-083', 2, null, false, null),
  ('P-084', 3, null, false, null),
  ('T-001', 4, 'The build date matters more than the model year.', false, null),
  ('T-002', 3, 'The badge is not a measurement; the acceleration itself is confirmed.', false, null),
  ('T-003', 4, 'The upgrade is not visible from outside the car.', false, null),
  ('T-004', 4, 'The word Autopilot in an advertisement does not mean the option was bought.', false, null),
  ('T-005', 4, 'Without the upgrade the phone application does not reach the car away from a wireless network.', false, null),
  ('T-006', 4, 'In Europe a car built for the United States is limited to about 7 kW from one phase.', false, null),
  ('T-007', 3, null, false, null),
  ('T-008', 5, 'Every failure is now at the owner expense.', false, null),
  ('T-010', 5, 'The main rear drivetrain risk on this car.', false, null),
  ('T-011', 5, 'Budget it as a known price.', false, null),
  ('T-012', 3, 'Several replacements without curing the cause are a bad sign only together with current symptoms.', false, null),
  ('T-013', 4, null, false, null),
  ('T-014', 2, null, false, null),
  ('T-015', 3, null, false, null),
  ('T-020', 2, 'The number in the name is marketing.', false, null),
  ('T-021', 5, 'For a 2015 car of this version the normal nominal full pack reading is 65 to 72 kWh.', false, null),
  ('T-022', 5, 'Two otherwise identical cars can differ by this limit.', false, null),
  ('T-023', 4, 'Check it with a real peak on a rapid charger.', false, null),
  ('T-024', 5, 'A calendar risk, not a mileage one.', false, null),
  ('T-025', 4, 'A humid climate in the history is a risk.', false, null),
  ('T-026', 3, 'An isolation fault is not always about the pack.', false, null),
  ('T-027', 3, null, false, null),
  ('T-028', 5, 'A new 90 pack is a plus and a remanufactured 85 is neutral.', false, null),
  ('T-029', 4, 'The charging history is visible in the vehicle data as direct current energy taken.', false, null),
  ('T-030', 5, null, false, null),
  ('T-031', 2, null, false, null),
  ('T-040', 2, null, false, null),
  ('T-041', 5, 'Charging such a car in Ukraine is a project of its own.', false, null),
  ('T-042', 5, 'For auction cars imported from the United States this is the norm, not the exception.', false, null),
  ('T-043', 4, 'Check the rights after every change of owner.', false, null),
  ('T-044', 4, null, false, null),
  ('T-050', 4, 'For a car outside the United States this work is paid.', false, null),
  ('T-051', 3, null, false, null),
  ('T-052', 2, null, false, null),
  ('T-053', 3, 'Owners who paid for it say it was worth the money.', false, null),
  ('T-054', 4, 'Do not attribute full self driving to this car.', false, null),
  ('T-060', 3, null, false, null),
  ('T-061', 4, 'Check the bushes and the play.', true, 'The manufacturer called the failures misuse rather than a defect.'),
  ('T-062', 3, null, false, null),
  ('T-063', 2, null, false, null),
  ('T-064', 3, null, false, null),
  ('T-065', 4, 'A mandatory check before winter.', false, null),
  ('T-066', 3, null, false, null),
  ('T-067', 3, null, false, null),
  ('T-070', 3, null, false, null),
  ('T-071', 4, 'Do not give an annual cost figure.', false, null),
  ('T-072', 3, null, false, null),
  ('T-073', 2, null, false, null),
  ('T-074', 3, null, false, null);

update mi.candidate_claim c
   set proposed_buyer_importance    = m.importance,
       proposed_buyer_implication_en = m.implication,
       proposed_contested           = m.contested,
       proposed_contested_note_en   = m.note
  from buyer_meta m
 where m.atom = split_part(c.task_ref, '#', 1)
   and c.task_ref !~ 'r1$';

-- Жоден кандидат не має лишитись без важливості: правило gate її вимагає,
-- і мовчазного замовчування немає ніде.
do $$
declare n int;
begin
  select count(*) into n from mi.candidate_claim where proposed_buyer_importance is null;
  if n > 0 then
    raise exception 'buyer importance missing for % candidates', n;
  end if;
end $$;

\o
