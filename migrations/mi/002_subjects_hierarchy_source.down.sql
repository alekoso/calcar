-- Відкат міграції 02.

alter table if exists mi.fluid_spec drop constraint if exists fluid_spec_brand_fk;

drop table if exists mi.version_market_year;
drop table if exists mi.vehicle_version;
drop table if exists mi.generation;
drop table if exists mi.model_line;
drop table if exists mi.brand;
drop table if exists mi.source;
drop table if exists mi.knowledge_subject;
