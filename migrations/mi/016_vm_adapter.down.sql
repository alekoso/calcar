-- Відкат міграції 16. Схема не чіпалась: лише функції.
-- Таблиці спостережень із supabase-vehicle-memory-v2.sql не видаляються:
-- вони живуть поза набором міграцій Model Intelligence.

drop function if exists mi.resolve_from_memory(text, timestamptz, timestamptz);
drop function if exists mi.vm_observations(text, timestamptz, timestamptz);
drop function if exists mi.vm_invalidate(text, uuid, text);
drop function if exists mi.vm_record_component(text, text, text, text, text, timestamptz, text, text, text, text, text, integer, jsonb, uuid, timestamptz);
drop function if exists mi.vm_record_identity(text, text, text, text, numeric, date, boolean, timestamptz, text, text, text, text, uuid, timestamptz);
drop function if exists mi.vm_record_measurement(text, text, jsonb, timestamptz, timestamptz, bigint, text);
drop function if exists mi.vm_record_entitlement(text, text, mi.entitlement_status, timestamptz, text, text);
drop function if exists mi.vm_record_component_state(text, text, text, date, integer, mi.performer, jsonb, jsonb, mi.confidence, text, uuid);
