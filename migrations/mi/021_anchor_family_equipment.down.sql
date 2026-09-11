-- Відкат міграції 21: оцінювачі з міграцій 012 і 013, помічники прибираються.

create or replace function mi.eval_claim(p_claim_id bigint, p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare
  cl mi.claim%rowtype;
  gr record; ev jsonb; log jsonb := '[]'::jsonb;
  group_results text[] := '{}';
  preds text[]; bases text[];
  status text; basis text := 'confirmed';
  role_status text; role_row jsonb; fam bigint; anchor bigint;
begin
  select * into cl from mi.claim where id = p_claim_id;
  if not found then return null; end if;

  for gr in select group_no from mi.claim_applicability
             where claim_id = p_claim_id group by group_no order by group_no loop
    preds := '{}'; bases := '{}';
    for ev in select mi.eval_predicate(a, p_identity) || jsonb_build_object(
                       'group', a.group_no, 'dimension', a.dimension::text,
                       'slot', a.config_scope::text, 'operator', a.operator::text,
                       'expected', coalesce(a.ref_subject_id::text, a.tag, a.attr_value))
                from mi.claim_applicability a
               where a.claim_id = p_claim_id and a.group_no = gr.group_no
               order by a.id loop
      preds := preds || (ev->>'result');
      bases := bases || (ev->>'basis');
      log := log || ev;
    end loop;
    group_results := group_results || mi.group_result(preds)::text;
    if 'conflicted' = any (bases) then basis := 'conflicted';
    elsif 'unresolved' = any (bases) and basis <> 'conflicted' then basis := 'unresolved';
    elsif 'assumed_factory' = any (bases) and basis not in ('conflicted', 'unresolved') then
      basis := 'assumed_factory';
    elsif 'assumed_strong' = any (bases) and basis = 'confirmed' then basis := 'assumed_strong';
    end if;
  end loop;

  -- Якір: якщо клейм говорить про конкретний варіант компонента (сам або
  -- через проблему, обслуговування, перевірку чи стан про нього), то до
  -- груп додається неявна група про те, чи цей варіант справді стоїть.
  -- Саме тут працює різниця між сильним і слабким заводським припущенням:
  -- мотор під припущенням дає звичайний MATCH, батарея дає ASSUMED_MATCH.
  anchor := mi.claim_anchor_variant(p_claim_id);
  if anchor is not null then
    select family_id into fam from mi.component_variant where subject_id = anchor;
    select e into role_row from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
     where e->>'slot' = 'current'
       and (select v.family_id from mi.component_variant v where v.subject_id = (e->>'variant')::bigint) = fam
     limit 1;
    if role_row is null then
      role_status := 'UNKNOWN';
      group_results := group_results || 'UNKNOWN'::text;
      if basis = 'confirmed' then basis := 'unresolved'; end if;
      log := log || jsonb_build_object('group', 0, 'dimension', 'component_variant',
               'slot', 'current', 'operator', 'eq', 'expected', anchor::text,
               'observed', null, 'result', 'UNKNOWN', 'basis', 'unresolved');
    else
      role_status := case
        when (role_row->>'variant')::bigint = anchor
          or (cl.propagation = 'descendants'
              and mi.is_revision_of((role_row->>'variant')::bigint, anchor))
        then mi.status_to_result(role_row->>'status', role_row->>'role', true)
        else mi.status_to_result(role_row->>'status', role_row->>'role', false) end;
      group_results := group_results || role_status::text;
      if basis = 'confirmed' then
        basis := mi.status_to_basis(role_row->>'status', role_row->>'role');
      end if;
      log := log || jsonb_build_object('group', 0, 'dimension', 'component_variant',
               'slot', 'current', 'operator', 'eq', 'expected', anchor::text,
               'observed', role_row->>'variant', 'result', role_status,
               'basis', mi.status_to_basis(role_row->>'status', role_row->>'role'));
    end if;
  end if;

  status := mi.claim_status_from_groups(group_results);

  -- Знання про родину з family_context це архітектурний контекст, а не
  -- проблема конкретної машини: окремий статус, щоб рендер ніколи не
  -- показав його як issue.
  if cl.propagation = 'family_context' and status in ('APPLICABLE', 'APPLICABLE_ASSUMED') then
    status := 'APPLICABLE_CONTEXT';
    basis := 'context';
  end if;

  return jsonb_build_object('claim_id', p_claim_id, 'status', status,
                            'basis', basis, 'predicates', log);
end $$;

create or replace function mi.eval_check(p_check_id bigint, p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare
  ci mi.check_item%rowtype;
  gr record; ev jsonb; log jsonb := '[]'::jsonb;
  group_results text[] := '{}'; preds text[]; bases text[];
  status text; basis text := 'confirmed';
  anchor bigint; fam bigint; role_row jsonb; role_status text;
begin
  select * into ci from mi.check_item where subject_id = p_check_id;
  if not found then return null; end if;

  for gr in select group_no from mi.claim_applicability
             where owner_subject_id = p_check_id group by group_no order by group_no loop
    preds := '{}'; bases := '{}';
    for ev in select mi.eval_predicate(a, p_identity) || jsonb_build_object(
                       'group', a.group_no, 'dimension', a.dimension::text,
                       'slot', a.config_scope::text, 'operator', a.operator::text,
                       'expected', coalesce(a.ref_subject_id::text, a.tag, a.attr_value))
                from mi.claim_applicability a
               where a.owner_subject_id = p_check_id and a.group_no = gr.group_no
               order by a.id loop
      preds := preds || (ev->>'result');
      bases := bases || (ev->>'basis');
      log := log || ev;
    end loop;
    group_results := group_results || mi.group_result(preds)::text;
    if 'conflicted' = any (bases) then basis := 'conflicted';
    elsif 'unresolved' = any (bases) and basis <> 'conflicted' then basis := 'unresolved';
    end if;
  end loop;

  -- Якір: перевірка про конкретний варіант компонента застосовна лише
  -- тоді, коли цей варіант справді стоїть. Ендоскопія мотора Alusil не
  -- має зʼявлятись на машині з напиленими циліндрами.
  anchor := mi.subject_anchor_variant(p_check_id);
  if anchor is not null then
    select family_id into fam from mi.component_variant where subject_id = anchor;
    select e into role_row from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
     where e->>'slot' = 'current'
       and (select v.family_id from mi.component_variant v where v.subject_id = (e->>'variant')::bigint) = fam
     limit 1;
    if role_row is null then
      group_results := group_results || 'UNKNOWN'::text;
      if basis = 'confirmed' then basis := 'unresolved'; end if;
      log := log || jsonb_build_object('group', 0, 'dimension', 'component_variant',
               'slot', 'current', 'operator', 'eq', 'expected', anchor::text,
               'observed', null, 'result', 'UNKNOWN', 'basis', 'unresolved');
    else
      role_status := case when (role_row->>'variant')::bigint = anchor
        then mi.status_to_result(role_row->>'status', role_row->>'role', true)
        else mi.status_to_result(role_row->>'status', role_row->>'role', false) end;
      group_results := group_results || role_status::text;
      if basis = 'confirmed' then
        basis := mi.status_to_basis(role_row->>'status', role_row->>'role');
      end if;
      log := log || jsonb_build_object('group', 0, 'dimension', 'component_variant',
               'slot', 'current', 'operator', 'eq', 'expected', anchor::text,
               'observed', role_row->>'variant', 'result', role_status,
               'basis', mi.status_to_basis(role_row->>'status', role_row->>'role'));
    end if;
  end if;

  status := mi.claim_status_from_groups(group_results);
  return jsonb_build_object('check_id', p_check_id, 'status', status,
                            'basis', basis, 'predicates', log);
end $$;

drop function if exists mi.anchor_other_result(jsonb, jsonb, mi.propagation);
drop function if exists mi.subject_anchor_other(bigint);
