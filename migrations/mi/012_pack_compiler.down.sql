-- Відкат міграції 12.
--
-- Компілятор це лише функції над уже наявними таблицями: фрагменти,
-- залежності, пакети і черга побудови створені міграцією 08 і тут не
-- чіпаються. Тому відкат прибирає функції і очищає те, що компілятор
-- встиг побудувати.

delete from mi.fragment_dependency
 where fragment_id in (select id from mi.pack_fragment
                        where compiler_version like 'pc-%');
delete from mi.knowledge_pack where compiler_version like 'pc-%';
delete from mi.pack_fragment where compiler_version like 'pc-%';

drop function if exists mi.request_pack(jsonb, mi.pack_purpose, char, text);
drop function if exists mi.coverage_statement(bigint, jsonb);
drop function if exists mi.identity_summary(jsonb);
drop function if exists mi.pack_bucket(text, text);
drop function if exists mi.condition_text(jsonb);
drop function if exists mi.compile_pack(jsonb, mi.pack_purpose, char, text);
drop function if exists mi.purpose_budget(mi.pack_purpose);
drop function if exists mi.build_fragment(bigint, mi.pack_purpose, char, text);
drop function if exists mi.fragment_fingerprint(jsonb);
drop function if exists mi.eval_claim(bigint, jsonb);
drop function if exists mi.claim_status_from_groups(text[]);
drop function if exists mi.group_result(text[]);
drop function if exists mi.claim_anchor_variant(bigint);
drop function if exists mi.eval_predicate(mi.claim_applicability, jsonb);
drop function if exists mi.status_to_basis(text, text);
drop function if exists mi.status_to_result(text, text, boolean);
drop function if exists mi.is_revision_of(bigint, bigint);
drop function if exists mi.claim_in_scope(bigint, bigint);
drop function if exists mi.vmy_scope(bigint);
drop function if exists mi.subject_area(bigint);
drop function if exists mi.compiler_version();
