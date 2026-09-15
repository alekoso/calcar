-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 113_sources_hyundai_tucson.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- MI Catalog, картка 3: джерела Hyundai Tucson TL 2.4 GDI Theta II, US MY2018-2021.
--
-- Один рядок mi.source на один ключ реєстру джерел картки. Жодне джерело
-- не вигадане: url веде на конкретний документ, reference описує його для
-- випадку, коли адреса зміниться.
--
-- quality = primary лише там, де джерело саме встановлює факт: документ
-- виробника, звіт NHTSA, судовий документ, власник із власною історією у
-- реєстрі NHTSA. Агрегатор це low.
--
-- Незалежність: бюлетені HMA мають одного автора, але кожен документ
-- установлює свій факт; мирова угода, повідомлення класу і сайт угоди це
-- одна група доказів (doc:theta-settlement). Кожна скарга NHTSA це окрема
-- група власника (odi:номер), а джерелом виступає вибірка скарг за роком.
--
-- access_status: ok для NHTSA, EPA і PDF, прочитаних напряму; proxy для
-- сторінок hyundaiusa.com і hyundainews.com, прочитаних через проксі-читалку.

do $$
declare r record;
begin
  for r in select * from (values
  -- ---------- Офіційні: EPA і NHTSA vPIC ----------
  ('S-H-OFF-01','official','primary','United States fuel economy database entry for the 2018 Hyundai Tucson FWD 2.4 L, vehicle 39728','fueleconomy.gov vehicle 39728','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/39728'),
  ('S-H-OFF-02','official','primary','United States fuel economy database entry for the 2018 Hyundai Tucson AWD 2.4 L, vehicle 39732','fueleconomy.gov vehicle 39732','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/39732'),
  ('S-H-OFF-03','official','primary','United States fuel economy database entry for the 2019 Hyundai Tucson FWD 2.4 L, vehicle 40912','fueleconomy.gov vehicle 40912','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/40912'),
  ('S-H-OFF-04','official','primary','United States fuel economy database entry for the 2019 Hyundai Tucson AWD 2.4 L, vehicle 40918','fueleconomy.gov vehicle 40918','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/40918'),
  ('S-H-OFF-05','official','primary','United States fuel economy database entry for the 2020 Hyundai Tucson FWD 2.4 L, vehicle 41440','fueleconomy.gov vehicle 41440','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/41440'),
  ('S-H-OFF-06','official','primary','United States fuel economy database entry for the 2020 Hyundai Tucson AWD 2.4 L, vehicle 41444','fueleconomy.gov vehicle 41444','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/41444'),
  ('S-H-OFF-07','official','primary','United States fuel economy database entry for the 2021 Hyundai Tucson FWD 2.4 L, vehicle 43646','fueleconomy.gov vehicle 43646','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/43646'),
  ('S-H-OFF-08','official','primary','United States fuel economy database entry for the 2021 Hyundai Tucson AWD 2.4 L, vehicle 42667','fueleconomy.gov vehicle 42667','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/42667'),
  ('S-H-OFF-09','official','primary','United States fuel economy menu of engine options for the 2022 Hyundai Tucson FWD (2.5 L, eight-speed automatic only)','fueleconomy.gov menu options year 2022 Tucson FWD','epa','US','ok',
   'https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=2022&make=Hyundai&model=Tucson%20FWD'),
  ('S-H-OFF-10','official','primary','NHTSA vPIC decoding of Hyundai Tucson VIN patterns KM8J33AL, KM8J3CAL, KM8J33A4, KM8J3CA4 and KM8J33A2','vpic.nhtsa.dot.gov DecodeVinValues','nhtsa_vpic','US','ok',
   'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/KM8J3CAL?format=json'),
  -- ---------- Офіційні: Hyundai Motor America, продукт ----------
  ('S-H-OFF-11','official','primary','Hyundai Motor America, 2019 Tucson Specifications (updated 22 February 2019)','hyundainews.com document 35758-2019TucsonSpecifications','hma','US','proxy',
   'https://www.hyundainews.com/assets/documents/original/35758-2019TucsonSpecifications2222019Updateddocx.pdf'),
  ('S-H-OFF-12','official','primary','Hyundai Motor America, 2018 Tucson Specifications (launch document, 2.0 L and 1.6 L turbo only)','hyundainews.com document 30723-2018TUCSONSpecificationsTLAPPROVED','hma','US','proxy',
   'https://www.hyundainews.com/assets/documents/original/30723-2018TUCSONSpecificationsTLAPPROVED.pdf'),
  ('S-H-OFF-13','official','primary','Hyundai Motor America, 2020 Tucson Owner''s Manual (546 pages)','owners.hyundaiusa.com glovebox manual 2020 Tucson','hma','US','ok',
   'https://owners.hyundaiusa.com/content/dam/hyundai/us/myhyundai/manuals/glovebox-manual/2020/tucson/2020-Tucson-Owners-Manual.pdf'),
  ('S-H-OFF-14','official','primary','Hyundai Motor America, America''s Best Warranty (read 15 September 2026)','hyundaiusa.com assurance america-best-warranty','hma','US','proxy',
   'https://www.hyundaiusa.com/us/en/assurance/america-best-warranty'),
  -- ---------- Офіційні: Theta II, кампанії і продовження ----------
  ('S-H-OFF-15','official','primary','Hyundai Service Campaign T3G dealer best practice, TSB 19-01-006H-4, 28 October 2019 (adds 2019 Tucson)','NHTSA TSB MC-10167764','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2019/MC-10167764-9999.pdf'),
  ('S-H-OFF-16','official','primary','Hyundai Service Campaign T3G dealer best practice, TSB 20-01-004H-1, 3 June 2020','NHTSA TSB MC-10177127','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2020/MC-10177127-0001.pdf'),
  ('S-H-OFF-17','official','primary','Hyundai Service Campaign T3G and warranty extensions TXXC and TXXI dealer best practice, revised 15 April 2022','NHTSA TSB MC-10211665','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10211665-0001.pdf'),
  ('S-H-OFF-18','official','primary','Hyundai TSB 22-EM-002H-1, Engine warranty extension TXXC, April 2022','NHTSA TSB MC-10211674','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10211674-0001.pdf'),
  ('S-H-OFF-19','official','primary','Hyundai TSB 22-EM-001H-1, Engine warranty extension TXXI, April 2022','NHTSA TSB MC-10211673','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10211673-0001.pdf'),
  ('S-H-OFF-20','official','primary','Hyundai TSB 21-01-002H, 2.4L / 2.0L turbo engine warranty extension TXXC, January 2021','NHTSA TSB MC-10186818','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2021/MC-10186818-0001.pdf'),
  ('S-H-OFF-21','official','primary','Hyundai campaign 953 page, Knock Sensor Detection System','autoservice.hyundaiusa.com campaign953','hma','US','proxy',
   'https://autoservice.hyundaiusa.com/campaign953'),
  ('S-H-OFF-22','official','primary','Hyundai Service Campaign T6G dealer best practice, TSB 22-01-023H-1, 28 April 2022 (Nu 2.0 and MPI engines)','NHTSA TSB MC-10211662','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10211662-0001.pdf'),
  ('S-H-OFF-23','official','primary','Hyundai TXXM and T6G engine warranty extension dealer best practice, 3 November 2022','NHTSA TSB MC-10227320','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2022/MC-10227320-0001.pdf'),
  ('S-H-OFF-24','official','primary','Hyundai campaign 966 page, KSDS software update and 15 year / 150,000 mile extension','autoservice.hyundaiusa.com campaign966','hma','US','proxy',
   'https://autoservice.hyundaiusa.com/campaign966'),
  ('S-H-OFF-25','official','primary','Hyundai Engine Oil Consumption Inspection and Repair Guidelines dealer best practice (TSB 23-EM-008H and 23-EM-007H), 11 December 2023','NHTSA TSB MC-10247598','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2023/MC-10247598-0001.pdf'),
  ('S-H-OFF-26','official','primary','Kia Product Improvement Campaign PI1806, 2020 Sportage 2.4 GDI and 2.0 T-GDI KSDS software, 6 November 2019','NHTSA TSB MC-10168843','kma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2019/MC-10168843-0001.pdf'),
  -- ---------- Офіційні: відклики, розслідування, наказ ----------
  ('S-H-OFF-27','official','primary','NHTSA Part 573 Safety Recall Report 20V-543 (Hyundai 195), 10 September 2020','static.nhtsa.gov RCLRPT-20V543-8816','nhtsa','US','ok',
   'https://static.nhtsa.gov/odi/rcl/2020/RCLRPT-20V543-8816.PDF'),
  ('S-H-OFF-28','official','primary','Hyundai TSB 21-01-010H, 2016-2021MY Tucson (TL) ABS fuse kit installation and software update (recall 195), February 2021','static.nhtsa.gov RCRIT-20V543-5288','hma','US','ok',
   'https://static.nhtsa.gov/odi/rcl/2020/RCRIT-20V543-5288.pdf'),
  ('S-H-OFF-29','official','primary','NHTSA recalls API, campaign 20V543000 summary for 2018 to 2021 Tucson','api.nhtsa.gov recallsByVehicle hyundai tucson','nhtsa','US','ok',
   'https://api.nhtsa.gov/recalls/recallsByVehicle?make=hyundai&model=tucson&modelYear=2020'),
  ('S-H-OFF-30','official','primary','NHTSA Part 573 Safety Recall Report 17V-226, 31 March 2017 (Alabama and Georgia built Theta II engines)','static.nhtsa.gov RCLRPT-17V226-4558','nhtsa','US','ok',
   'https://static.nhtsa.gov/odi/rcl/2017/RCLRPT-17V226-4558.pdf'),
  ('S-H-OFF-31','legal','primary','NHTSA Consent Order RQ17-004, Hyundai Motor America, recalls 15V-568 and 17V-226 (November 2020)','nhtsa.gov node 102691','nhtsa','US','proxy',
   'https://www.nhtsa.gov/node/102691'),
  ('S-H-OFF-32','official','primary','Hyundai Immobilizer and Campaign 993 anti-theft software dealer best practices, 13 February 2023','NHTSA TSB MC-10232190','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2023/MC-10232190-0001.pdf'),
  ('S-H-OFF-33','official','primary','Hyundai TSB 19-AT-021H-1, Automatic transmission stall test procedure, December 2019','NHTSA TSB MC-10170511','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2019/MC-10170511-9999.pdf'),
  ('S-H-OFF-34','official','primary','Hyundai TSB 24-AT-002H, Automatic transmission incorrect ratio DTC, April 2024','NHTSA TSB MC-10253275','hma','US','ok',
   'https://static.nhtsa.gov/odi/tsbs/2024/MC-10253275-0001.pdf'),
  -- ---------- Судові: мирова угода Theta II ----------
  ('S-H-LEG-01','legal','primary','In re Hyundai and Kia Engine Litigation, 8:17-cv-00838 (C.D. Cal.): Notice of proposed class action settlement','hma-thetasettlement.com Settlement Notice','court','US','ok',
   'https://angeion-public.s3.amazonaws.com/www.hma-thetasettlement.com.com/docs/Settlement%20Notice.pdf'),
  ('S-H-LEG-02','legal','primary','In re Hyundai and Kia Engine Litigation, 8:17-cv-00838: Settlement Agreement, Document 194-1 filed 5 April 2021','hma-thetasettlement.com Settlement Agreement','court','US','ok',
   'https://angeion-public.s3.amazonaws.com/www.hma-thetasettlement.com.com/docs/Settlement%20Agreement.pdf'),
  -- ---------- Власники: реєстр скарг NHTSA ----------
  ('S-H-OWN-01','owner','primary','NHTSA consumer complaints, Hyundai Tucson model year 2018 (393 complaints on 15 September 2026, 12 with a 2.4 L VIN)','NHTSA complaints API complaintsByVehicle make hyundai model tucson year 2018','nhtsa_odi','US','ok',
   'https://api.nhtsa.gov/complaints/complaintsByVehicle?make=hyundai&model=tucson&modelYear=2018'),
  ('S-H-OWN-02','owner','primary','NHTSA consumer complaints, Hyundai Tucson model year 2019 (378 complaints on 15 September 2026, 111 with a 2.4 L VIN)','NHTSA complaints API year 2019','nhtsa_odi','US','ok',
   'https://api.nhtsa.gov/complaints/complaintsByVehicle?make=hyundai&model=tucson&modelYear=2019'),
  ('S-H-OWN-03','owner','primary','NHTSA consumer complaints, Hyundai Tucson model year 2020 (176 complaints on 15 September 2026, 95 with a 2.4 L VIN)','NHTSA complaints API year 2020','nhtsa_odi','US','ok',
   'https://api.nhtsa.gov/complaints/complaintsByVehicle?make=hyundai&model=tucson&modelYear=2020'),
  ('S-H-OWN-04','owner','primary','NHTSA consumer complaints, Hyundai Tucson model year 2021 (78 complaints on 15 September 2026, 30 with a 2.4 L VIN)','NHTSA complaints API year 2021','nhtsa_odi','US','ok',
   'https://api.nhtsa.gov/complaints/complaintsByVehicle?make=hyundai&model=tucson&modelYear=2021'),
  -- ---------- Агрегатор ----------
  ('S-H-AGG-01','aggregator','low','Go-Parts garage article, OBD-II code P1326 knock sensor detection system fault','go-parts.com garage obd-p1326','go-parts','US','search_summary',
   'https://www.go-parts.com/garage/obd-p1326')
  ) as t(key, stype, quality, title, reference, publisher, region, access, url) loop
    perform mi_load.mksrc(r.key, r.stype::mi.source_type, r.quality::mi.source_quality,
                          r.title, r.reference, r.publisher, r.region, r.access::mi.access_status, r.url);
  end loop;
end $$;
