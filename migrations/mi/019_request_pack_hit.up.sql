-- Міграція 19: гаряча дорога повертає скомпільований пакет.
--
-- Що було зламано. `mi.compile_pack` при УСПІХУ кладе прапорець
-- `fragment_available` всередину обʼєкта `pack`, а при ПРОМАХУ повертає
-- його на верхньому рівні. `mi.request_pack` перевіряла лише верхній
-- рівень, тому успішна компіляція читалась як промах: функція ніколи не
-- віддавала пакет, завжди відповідала `fragment_missing` і ставила у
-- чергу зайву заявку на збірку вже наявного фрагмента.
--
-- Golden test 50 перевіряв тільки промах, тому помилка дожила досі.
-- Та сама помилка вже була виправлена у `mi.persist_pack` (міграція 15,
-- уточнена у 17); тут застосовано рівно той самий coalesce по двох місцях.
--
-- Семантика промаху не змінюється: синхронної компіляції у гарячій
-- дорозі як не було, так і немає.

create or replace function mi.request_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare v_vmy bigint; res jsonb; v_reason mi.build_reason;
begin
  v_vmy := (p_identity->>'vmy')::bigint;
  res := mi.compile_pack(p_identity, p_purpose, p_locale, p_budget);

  -- Прапорець успіху лежить у `pack`, прапорець промаху на верхньому рівні.
  if coalesce((res->'pack'->>'fragment_available')::boolean,
              (res->>'fragment_available')::boolean, false) then
    return res;
  end if;

  -- Синхронної компіляції у гарячій дорозі немає СВІДОМО: Check не чекає.
  v_reason := case
    when res->>'reason' = 'invalidated' then 'invalidated'
    when exists (select 1 from mi.claim c
                  where c.status = 'published' and mi.claim_in_scope(c.id, v_vmy))
      then 'fragment_missing'
    else 'knowledge_missing' end;

  insert into mi.build_request (reason, vmy_id, identity_descriptor, purpose, status)
  values (v_reason, v_vmy, p_identity, p_purpose, 'queued')
  on conflict on constraint build_request_key do update
    set requested_count = mi.build_request.requested_count + 1,
        last_requested_at = now(),
        status = case when mi.build_request.status = 'done' then 'queued'::mi.request_status
                      else mi.build_request.status end;

  return jsonb_build_object('fragment_available', false, 'reason', v_reason,
    'coverage_statement', '[]'::jsonb,
    'pack_meta', jsonb_build_object('compiler_version', mi.compiler_version(),
      'purpose', p_purpose, 'included_count', 0, 'truncated_count', 0));
end $$;
