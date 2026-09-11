-- Відкат міграції 18. Схема не чіпалась: лише функції.
drop function if exists public.mi_shadow_pack(text);
drop function if exists mi.shadow_pack(text);
drop function if exists mi.ingest_identity_from_check(text);
drop function if exists mi.match_version(text, text[], int);
