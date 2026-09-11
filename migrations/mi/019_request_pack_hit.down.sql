-- Відкат міграції 19: повернення до версії з міграції 12.
-- Увага: ця версія містить помилку, через яку гаряча дорога ніколи не
-- віддає скомпільований пакет. Відкат має сенс лише разом з відкатом 18.

create or replace function mi.request_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare v_vmy bigint; res jsonb; v_reason mi.build_reason;
begin
  v_vmy := (p_identity->>'vmy')::bigint;
  res := mi.compile_pack(p_identity, p_purpose, p_locale, p_budget);

  if (res->>'fragment_available')::boolean then
    return res;
  end if;

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
