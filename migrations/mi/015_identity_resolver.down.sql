-- Відкат міграції 15.
--
-- Резолвер це лише функції над уже наявними таблицями інтерфейсу
-- Vehicle Memory з міграції 07 і сховищем пакетів з міграції 08. Схема
-- не чіпалась, тому відкат прибирає функції і те, що резолвер записав.

delete from mi.knowledge_pack;
delete from mi_vm.resolved_identity_dimension;
delete from mi_vm.resolved_identity;

drop function if exists mi.persist_pack(bigint, mi.pack_purpose, char, text);
drop function if exists mi.vin_overlay(bigint);
drop function if exists mi.identity_json(bigint);
drop function if exists mi.identity_subject(bigint, text);
drop function if exists mi.identity_text(bigint, text);
drop function if exists mi.identity_num(bigint, text);
drop function if exists mi.identity_date(bigint, text);
drop function if exists mi.resolve_fitment(bigint);
drop function if exists mi.resolve_hierarchy(bigint);
drop function if exists mi.resolve_identity(text, jsonb);
drop function if exists mi.identity_version(jsonb);
drop function if exists mi.resolve_dimension(jsonb, text);
drop function if exists mi.resolve_alias(text, bigint);
drop function if exists mi.strong_threshold(text);
drop function if exists mi.confirm_threshold(text);
drop function if exists mi.dimension_category(text, text);
drop function if exists mi.source_rank(text, text);
drop function if exists mi.resolver_version();
