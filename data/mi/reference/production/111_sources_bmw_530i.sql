-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 111_sources_bmw_530i.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- MI Catalog, картка 1: джерела BMW 530i xDrive G30 B48 (B46B20O0), US MY2017-2020.
--
-- Один рядок mi.source на один ключ реєстру джерел картки. Жодне джерело
-- не вигадане: url веде на конкретний документ або тред, reference описує
-- його для випадку, коли адреса зміниться. Картка також посилається на
-- джерела еталонної картки M550i (S-OFF-13, S-SPEC-13), які вже є у
-- 110_sources.sql: їх не дублюємо, а беремо за тим самим ключем.
--
-- quality = primary лише там, де джерело саме встановлює факт: документ
-- виробника, звіт NHTSA, майстерня з власним описом ремонту. Стаття
-- продавця запчастин, тюнінг-огляд, енциклопедія і пошукова видача це
-- secondary або low.
--
-- access_status: proxy для форумів, які читались через проксі-читалку;
-- search_summary там, де тред або сторінка не відкрились і відомий лише
-- заголовок і пошуковий витяг.

do $$
declare r record;
begin
  for r in select * from (values
  -- ---------- Офіційні ----------
  ('S-G-OFF-01','official','primary','BMW USA press release, The all-new 2017 BMW 5 Series: performance redefined, 12 October 2016','press.bmwgroup.com T0264802EN_US','bmw','US','ok',
   'https://www.press.bmwgroup.com/usa/article/detail/T0264802EN_US/the-all-new-2017-bmw-5-series:-performance-redefined?language=en_US'),
  ('S-G-OFF-02','official','primary','BMW of North America pricing guide, 5 Series Sedan (G30) model year 2018, effective 1 July 2017, released 8 June 2017','press.bmwgroup.com attachment T0266788EN_US/391871','bmw','US','ok',
   'https://www.press.bmwgroup.com/usa/article/attachment/T0266788EN_US/391871'),
  ('S-G-OFF-03','official','primary','BMW USA press release, BMW model year 2020 update information, 8 August 2019','press.bmwgroup.com T0299940EN_US','bmw','US','ok',
   'https://www.press.bmwgroup.com/usa/article/detail/T0299940EN_US/bmw-model-year-2020-update-information?language=en_US'),
  ('S-G-OFF-04','official','primary','BMW USA press release, The new 2021 BMW 5 Series Sedan, 26 May 2020','press.bmwgroup.com T0308911EN_US','bmw','US','ok',
   'https://www.press.bmwgroup.com/usa/article/detail/T0308911EN_US/the-new-2021-bmw-5-series-sedan?language=en_US'),
  ('S-G-OFF-05','official','primary','United States fuel economy database entry for the 2018 BMW 530i xDrive, vehicle 39154','fueleconomy.gov vehicle 39154','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/39154'),
  ('S-G-OFF-06','official','primary','NHTSA recall 18V-465, crankshaft sensor firmware, BMW and MINI model year 2018 to 2019, chronology revision 1 of 12 September 2018','NHTSA RMISC-18V465-9292','nhtsa','US','ok',
   'https://static.nhtsa.gov/odi/rcl/2018/RMISC-18V465-9292.pdf'),
  ('S-G-OFF-07','official','primary','NHTSA recall 19V-684, rear view camera display settings, 2018 to 2020 BMW','NHTSA campaign 19V684000','nhtsa','US','ok',null),
  ('S-G-OFF-08','official','primary','NHTSA recalls 20V-598 and 21V-096, rear view camera image, 2019 to 2021 BMW','NHTSA campaigns 20V598000 and 21V096000','nhtsa','US','ok',null),
  ('S-G-OFF-09','official','primary','NHTSA recall 20V-243, head air bag inflators exposed to humidity, 2017 BMW','NHTSA campaign 20V243000','nhtsa','US','ok',null),
  ('S-G-OFF-10','official','primary','NHTSA Part 573 safety recall report 21V-046, rear output shaft heat treatment, 2020 to 2021 BMW 530i xDrive and 540i xDrive, 3 February 2021','NHTSA RCLRPT-21V046-6060','nhtsa','US','ok',
   'https://static.nhtsa.gov/odi/rcl/2021/RCLRPT-21V046-6060.PDF'),
  ('S-G-OFF-11','official','primary','NHTSA Part 573 safety recall report 25V-636, engine starter relay corrosion, 2019 to 2022 BMW and Toyota Supra, 23 September 2025','NHTSA RCLRPT-25V636-0319','nhtsa','US','ok',
   'https://static.nhtsa.gov/odi/rcl/2025/RCLRPT-25V636-0319.pdf'),
  ('S-G-OFF-12','official','primary','Service information bulletin 27 02 20, jerking or shuddering from the driveline, xDrive transfer case ATX13-x, 20 May 2020','BMW SIB 27 02 20, NHTSA MC-10176367','bmw','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2020/MC-10176367-9999.pdf'),
  ('S-G-OFF-13','official','primary','Service information bulletin 11 10 25, coolant leaking from oil filter housing, 12 December 2025','BMW SIB 11 10 25, NHTSA MC-11026946','bmw','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2026/MC-11026946-0001.pdf'),
  ('S-G-OFF-14','official','primary','Service information bulletin 17 01 21 revision 1, service action: replace the coolant vent line on the cylinder head, 5 April 2022','BMW SIB 17 01 21, NHTSA MC-10212788','bmw','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10212788-9999.pdf'),
  ('S-G-OFF-15','official','primary','Service information bulletin 01 12 19, front grille upper and lower active air flaps, limited warranty extension to 15 years or 150,000 miles, revision of August 2022','BMW SIB 01 12 19, NHTSA MC-10224186','bmw','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10224186-9999.pdf'),
  ('S-G-OFF-16','official','primary','Service information bulletin 01 09 21, G01 G02 G30 G32 evaporative leak diagnosis module NVLD limited warranty extension','BMW SIB 01 09 21, NHTSA MC-10224185','bmw','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10224185-9999.pdf'),
  ('S-G-OFF-17','official','primary','NHTSA recall listings by model year for the BMW 530i, 2017 to 2020, retrieved 14 September 2026','NHTSA recalls API, make bmw, model 530i, model years 2017 to 2020','nhtsa','US','ok',
   'https://api.nhtsa.gov/recalls/recallsByVehicle?make=bmw&model=530i&modelYear=2018'),
  -- ---------- Юридичні ----------
  ('S-G-LEG-01','legal','secondary','Reporting on Eiger v. BMW of North America, oil filter housing class action naming the B46, B48 and B58 engines, filed 16 February 2026','carcomplaints.com news 2026','carcomplaints','US','ok',
   'https://www.carcomplaints.com/news/2026/bmw-oil-filter-housing-lawsuit-b46-b48-b58-engines.shtml'),
  -- ---------- Спеціалісти ----------
  ('S-G-SPEC-01','specialist','primary','Independent BMW workshop article on the B48 oil filter housing failure and its aluminium replacement, Rockville, Maryland','mbautoinc.com','mbautoinc','US','ok',
   'https://mbautoinc.com/bmw-b48-engine-upgrade-prevent-damage-rockville-md/'),
  ('S-G-SPEC-02','specialist','primary','Independent BMW specialist article on coolant leaks of the B46, B48 and B58 engines from its own repairs, Richmond','cgmotorsports.com','cgmotorsports','US','ok',
   'https://www.cgmotorsports.com/bmw-coolant-leaks-what-you-need-to-know/'),
  ('S-G-SPEC-03','specialist','primary','Independent workshop guide to ZF 8HP transmission service, the manufacturer interval and the symptoms of old fluid','motronix.net','motronix','US','ok',
   'https://motronix.net/blog/bmw-transmission-shifting-hard-shuddering-zf-8hp-service/'),
  ('S-G-SPEC-04','specialist','secondary','Tuning shop guide to B48 engine problems, summarising owner reports and bulletins','bmwtuning.co','bmwtuning','US','ok',
   'https://bmwtuning.co/b48-engine-problems/'),
  ('S-G-SPEC-05','specialist','secondary','Performance shop reliability guide to the B48, coolant leaks and problems','strperformance.com','strperformance','CA','ok',
   'https://strperformance.com/en/blog/details-conseils-technique/bmw-b48-20t-engine-reliability-guide-coolant-leaks-problems'),
  ('S-G-SPEC-06','specialist','secondary','Parts supplier guide to BMW transfer case shudder 2017 to 2023, citing the bulletin','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/transfer-case-assy-bmw-330i-bmw-x3-bmw-530i-2017-2023'),
  ('S-G-SPEC-07','specialist','secondary','Parts supplier article on B46 and B48 crankcase ventilation diaphragm failure','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/engine-crankcase-breather-hose-bmw-x3-bmw-x4-bmw-550e-xdrive-2016-2021'),
  ('S-G-SPEC-08','specialist','secondary','Parts supplier article on B48 cooling system failures 2016 to 2024','go-parts.com','goparts','US','ok',
   'https://www.go-parts.com/garage/radiator-coolant-hose-mini-clubman-mini-countryman-bmw-x1-2016-2024'),
  ('S-G-SPEC-09','specialist','secondary','Parts supplier article on the G30 front control arm and tension strut bushing','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/suspension-control-arm-land-rover-discovery-sport-bmw-530i-bmw-540i-2017-2023'),
  ('S-G-SPEC-10','specialist','secondary','Parts supplier article on BMW seat occupancy sensor failure 2016 to 2024','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/rain-sensor-module-bmw-5-series-bmw-7-series-bmw-x3-2016-2025'),
  ('S-G-SPEC-11','specialist','secondary','Parts supplier article on B46 and B58 belt tensioner rattle','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/belt-tensioner-bmw-330i-bmw-x3-bmw-740i-2016-2024'),
  ('S-G-SPEC-12','specialist','secondary','Parts supplier article on NBT EVO head unit failure 2015 to 2020','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/gps-navigation-system-head-bmw-328i-bmw-m3-bmw-320i-2015-2020'),
  ('S-G-SPEC-13','specialist','primary','Workshop guidance on BMW engine oil for the B46 and its own service interval, BimmerWorld','bimmerworld.com BMW engine oil','bimmerworld','US','ok',
   'https://www.bimmerworld.com/BMW-Engine-Oil/'),
  ('S-G-SPEC-14','vendor','low','Timing chain kit vendor article on B48 timing chain symptoms','sneedspeed.net','sneedspeed','US','ok',
   'https://sneedspeed.net/b48-timing-chain-kit-for-mini-and-bmw-what-we-tell-customers-when-the-engine-starts-talking/'),
  ('S-G-SPEC-15','specialist','secondary','Parts supplier article on the B46 and B48 oil cooler and plastic housing 2016 to 2022','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/engine-oil-cooler-bmw-x3-bmw-x4-bmw-5-series-2016-2022'),
  ('S-G-SPEC-16','specialist','secondary','Parts supplier guide to the B48 mechanical water pump 2019 to 2025','go-parts.com','goparts','US','search_summary',
   'https://www.go-parts.com/garage/engine-water-pump-bmw-530i-bmw-x3-bmw-x4-2019-2025'),
  ('S-G-SPEC-17','specialist','low','Tuning shop comparison of the B46 and B48, described by its author as speculation','bmwtuning.co','bmwtuning','US','ok',
   'https://bmwtuning.co/bmw-b46-vs-b48-comparison/'),
  ('S-G-SPEC-18','market','low','Repair cost estimator for the BMW 330i water pump','repairpal.com','repairpal','US','search_summary',
   'https://repairpal.com/estimator/bmw/330i/water-pump-replacement-cost'),
  -- ---------- Каталоги і ринок ----------
  ('S-G-MKT-01','market','low','Parts catalogue, transfer box ATC for the 2018 BMW 530i xDrive Sedan G30','bmwpartsdeal.com','bmwpartsdeal','US','ok',
   'https://www.bmwpartsdeal.com/parts-list/2018-bmw-530i_xdrive-sedan_g30/twin_clutch_gearbox_electric_gearbox/transfer_box_atc.html'),
  ('S-G-MKT-02','market','low','Dealer parts catalogue listing the hose cylinder head to expansion tank for the G30 530iX, part 17129844478 superseding 17128602600','BMW dealer parts sites, 530iX hose cylinder head-expansion tank','bmw-dealer-parts','US','ok',
   'https://parts.bmwoforlandpark.com/p/Bmw__530iX/Hose--cylinder-head-expansion-tank/97144273/17129844478.html'),
  ('S-G-MKT-03','market','low','Parts listings for the G30 530i oil filter housing assembly 11428580414 and aluminium replacements','oembimmerparts.com','oembimmerparts','US','ok',
   'https://oembimmerparts.com/products/bmw-g30-530i-oil-filter-housing-assembly-11428580414-aluminum-upgrade'),
  ('S-G-MKT-04','market','low','Parts listing for the G30 530i and 540i coolant expansion tank 17139846642, with a separate tank for the N63','bimmerworld.com expansion tanks','bimmerworld','US','ok',
   'https://www.bimmerworld.com/Cooling/Expansion-Tanks/Coolant-Expansion-Tank-BMW-G30-530i-540i-G32-640i-G12-740i.html'),
  -- ---------- Тести, огляди, агрегатори ----------
  ('S-G-REV-01','review','secondary','Consumer Reports reliability pages for the 2018 and 2019 BMW 5 Series','consumerreports.org','consumerreports','US','search_summary',
   'https://www.consumerreports.org/cars/bmw/5-series/2018/reliability'),
  ('S-G-AGG-01','aggregator','low','Aggregated list of G30 530i problems without supporting evidence','euroautopro.com.au','euroautopro','OTHER','ok',
   'https://www.euroautopro.com.au/post/common-problems-of-bmw-5-series-g30-530i-a-comprehensive-guide'),
  ('S-G-AGG-02','aggregator','secondary','Encyclopaedia article on the BMW B48 with the variants table and the technical update description','en.wikipedia.org BMW B48','wikipedia','OTHER','ok',
   'https://en.wikipedia.org/wiki/BMW_B48'),
  -- ---------- Власники ----------
  ('S-G-OWN-01','owner','secondary','Owner thread, large coolant leak and oil filter housing replacement on a 2017 530i','bimmerpost G30 thread 2051536','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread.php?t=2051536'),
  ('S-G-OWN-02','owner','secondary','Owner thread, cooling system physically failing on a 2018 530i','bimmerpost G30 thread 2144791','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread/2144791/cooling-system-physically-failing'),
  ('S-G-OWN-03','owner','secondary','Owner thread, 2019 530i xDrive coolant drip at the oil drain plug','bimmerfest thread 1466668','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/2019-530i-x-drive-coolant-drip-at-oil-drain-plug.1466668/'),
  ('S-G-OWN-04','owner','secondary','Owner thread, 2018 530i at 58,000 miles with leaking turbo coolant lines','bimmerfest thread 1472082','bimmerfest','US','search_summary',
   'https://www.bimmerfest.com/threads/2018-bmw-530-i-58k-miles-turbo-coolant-lines-leaking.1472082/'),
  ('S-G-OWN-05','owner','secondary','Owner thread, cracked and leaking B48 oil filter housing at 60,000 miles, with 2017 330i owners','bimmerfest thread 1403683','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/cracked-and-leaking-b48-oil-filter-housing-ofh-at-60k.1403683/'),
  ('S-G-OWN-06','owner','secondary','Owner thread, 2018 530i reliability and problems','bimmerpost G30 thread 1851182','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread/1851182/2018-530i-reliability-and-problems'),
  ('S-G-OWN-07','owner','secondary','Owner thread, reliability of the G30 530i and 520i','bimmerpost G30 thread 2072367','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread.php?t=2072367'),
  ('S-G-OWN-08','owner','secondary','Owner thread, advice on a high mileage 5 Series','bimmerpost G30 thread 1834317','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread.php?t=1834317'),
  ('S-G-OWN-09','owner','secondary','Owner thread, 2018 530i reliability and problems, with the B46 coolant line remark','bimmerfest thread 1416639','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/2018-530i-reliability-and-problems.1416639/'),
  ('S-G-OWN-10','owner','secondary','Owner thread, iDrive 7 in the G30 from July 2019 production','bimmerpost G30 thread 1626021','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread/1626021/idrive-7-starting-in-g30-from-07-2019'),
  ('S-G-OWN-11','owner','secondary','Owner thread, passenger restraint failure on the G30','bimmerpost G30 thread 1955595','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread/1955595/passanger-restraint-failure'),
  ('S-G-OWN-12','owner','secondary','NHTSA owner complaints database, 2018 to 2020 BMW 5 Series, retrieved 14 September 2026','NHTSA complaints API, make bmw, model 5 series','nhtsa','US','ok',
   'https://api.nhtsa.gov/complaints/complaintsByVehicle?make=bmw&model=5%20series&modelYear=2018'),
  ('S-G-OWN-13','owner','secondary','Owner thread, 540i xDrive transfer box and differential fluids','bimmerpost G30 thread 1700544','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread.php?t=1700544'),
  ('S-G-OWN-14','owner','secondary','Owner thread, 50,000 mile service','bimmerpost G30 thread 2095206','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread/2095206/50k-service'),
  ('S-G-OWN-15','owner','secondary','Owner thread, year, model, miles and issues','bimmerpost G30 thread 1942405','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread.php?t=1942405'),
  ('S-G-OWN-16','owner','secondary','Owner thread, buying a 2017 530i xDrive, requesting feedback','bimmerfest thread 1411186','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/buying-2017-bmw-530i-xdrive-requesting-feedback.1411186/'),
  ('S-G-OWN-17','owner','secondary','Owner threads on spark plug replacement for the G30 530i','bimmerpost G30 threads 2024681 and 2116229','bimmerpost','US','search_summary',
   'https://g30.bimmerpost.com/forums/showthread.php?t=2024681'),
  ('S-G-OWN-18','owner','secondary','Owner thread, B46 coolant line recall question, F30 owners','bimmerfest thread 1431511','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/b46-coolant-line-recall.1431511/'),
  ('S-G-OWN-19','owner','secondary','Owner thread, B48 oil filter housing coolant leak solved on a 2017 430i','bimmerfest thread 1473214','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/b48-oil-filter-housing-coolant-leak-%E2%80%94-solved.1473214/'),
  ('S-G-OWN-20','owner','secondary','Owner thread, B48 service action on the cylinder head ventilation line, F30 owners','bimmerpost F30 thread 1889354','bimmerpost','US','proxy',
   'https://f30.bimmerpost.com/forums/showthread.php?t=1889354'),
  ('S-G-OWN-21','owner','secondary','Owner thread, B48 versus B46 engine, with a technician statement','bimmerpost G20 thread 1702754','bimmerpost','US','proxy',
   'https://g20.bimmerpost.com/forums/showthread.php?t=1702754'),
  ('S-G-OWN-22','owner','secondary','Owner thread, coolant leak on a 2019 530xi at 28,500 miles, vent hose and reimbursement','bimmerfest thread 1471499','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/coolant-leak.1471499/'),
  ('S-G-OWN-23','owner','secondary','Owner thread, tension strut and thrust arm replacement on a G30 540i','bimmerpost G30 thread 2231035','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread.php?t=2231035'),
  ('S-G-OWN-24','owner','secondary','Owner thread, G30 head unit hard disk fault after aerosol sprayed into the vents','bimmerfest thread 1454247','bimmerfest','US','proxy',
   'https://www.bimmerfest.com/threads/bmw-g30-headunit-hard-disk-fault.1454247/'),
  ('S-G-OWN-25','owner','secondary','Owner thread, active grille warranty on the G30','bimmerpost G30 thread 2004635','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread/2004635/active-grille-warranty'),
  ('S-G-OWN-26','owner','secondary','Owner thread, coolant leak sources on the G30 540i and M550i','bimmerpost G30 thread 1999435','bimmerpost','US','proxy',
   'https://g30.bimmerpost.com/forums/showthread.php?t=1999435')
  ) as t(key, stype, quality, title, ref, platform, market, access, url) loop
    perform mi_load.mksrc(r.key, r.stype::mi.source_type, r.quality::mi.source_quality,
                          r.title, r.ref, r.platform, r.market, r.access::mi.access_status, r.url);
  end loop;
end $$;
