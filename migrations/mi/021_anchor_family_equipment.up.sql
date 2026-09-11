-- Міграція 21: якір на родину компонента і на обладнання.
--
-- Аудит Phase 7.2 знайшов: обслуговування опційного Porsche Torque
-- Vectoring Plus (P-053#a-r1, предикатів немає) застосовне до КОЖНОЇ
-- Cayenne GTS US/2013, бо доступність опції у VMY працювала як доказ її
-- наявності. Неявна група існувала лише для якоря на ВАРІАНТ компонента;
-- для родини і для обладнання її не було.
--
-- Правило: знання, що дістає машину через опційне обладнання або через
-- нерозвʼязану родину компонента, отримує неявну UNKNOWN-групу, доки це
-- обладнання чи родину не розвʼязано для машини. Тобто CONDITIONAL, а не
-- APPLICABLE. Родина, розвʼязана заводським припущенням, дає той самий
-- результат, що і варіант: сильна роль MATCH, слабка ASSUMED_MATCH.
-- Знання про машину якою вона є зараз розвʼязує поточний слот; контекст
-- родини (family_context) розвʼязує також заводський слот, бо описує
-- архітектуру, з якою машину зібрано.
--
-- Правило діє глобально: і на точному шляху VMY, і на частковому.
-- Жодне правило застосовності не послаблюється: гілка лише ДОДАЄ групу.
--
-- Тексти eval_claim (міграція 012) і eval_check (міграція 013)
-- взято дослівно і доповнено однією гілкою перед обчисленням статусу.

-- ---------- 1. Якір, що не є варіантом ----------

-- Варіант компонента має пріоритет і обробляється як раніше, тому тут
-- повертається null, щойно знайдено варіант. Інакше якорем стає родина
-- компонента або обладнання, якщо знання про них саме або про них
-- говорить проблема, обслуговування, перевірка чи стан.
create or replace function mi.subject_anchor_other(p_subject_id bigint)
returns jsonb language plpgsql stable as $$
declare k mi.subject_kind; about bigint; ak mi.subject_kind;
begin
  if p_subject_id is null then return null; end if;
  if mi.subject_anchor_variant(p_subject_id) is not null then return null; end if;

  select kind into k from mi.knowledge_subject where id = p_subject_id;
  if k in ('component_family', 'equipment_item') then
    return jsonb_build_object('kind', k, 'subject_id', p_subject_id);
  elsif k = 'issue' then
    select about_subject_id into about from mi.issue where subject_id = p_subject_id;
  elsif k = 'maintenance_item' then
    select about_subject_id into about from mi.maintenance_item where subject_id = p_subject_id;
  elsif k = 'check_item' then
    select scope_subject_id into about from mi.check_item where subject_id = p_subject_id;
  elsif k = 'component_state_type' then
    select applies_to_subject_id into about from mi.component_state_type where subject_id = p_subject_id;
  end if;

  if about is null or about = p_subject_id then return null; end if;
  select kind into ak from mi.knowledge_subject where id = about;
  if ak in ('component_family', 'equipment_item') then
    return jsonb_build_object('kind', ak, 'subject_id', about);
  end if;
  return null;
end $$;

-- ---------- 2. Неявна група для такого якоря ----------

-- Родина розвʼязана, коли у поточному слоті ідентичності стоїть варіант
-- цієї родини; результат той самий, що для якоря на варіант. Контекст
-- родини (propagation = family_context) описує архітектуру, з якою машину
-- ЗІБРАНО, тому для нього родину розвʼязує і заводський слот. Так
-- контрактний мотор невідомої ревізії не прибирає архітектурний контекст
-- (golden test 32), а знання про машину такою, якою вона є зараз, і далі
-- вимагає поточного слота.
--
-- Обладнання розвʼязане, коли ідентичність прямо каже, стоїть воно чи ні.
-- Стандартне обладнання ТОЧНОГО VMY доводиться самим VMY, тому для нього
-- неявної групи немає, як і раніше. Опційне, пакетне або будь-яке
-- обладнання без точного VMY доказом наявності не є: група UNKNOWN.
-- null означає «групи немає».
create or replace function mi.anchor_other_result(
  p_anchor jsonb, p_identity jsonb, p_propagation mi.propagation default null)
returns jsonb language plpgsql stable as $$
declare sid bigint := (p_anchor->>'subject_id')::bigint; hit jsonb;
begin
  if p_anchor->>'kind' = 'component_family' then
    select e into hit from jsonb_array_elements(coalesce(p_identity->'components', '[]'::jsonb)) e
     where (e->>'slot' = 'current' or (p_propagation = 'family_context' and e->>'slot' = 'factory'))
       and e->>'variant' is not null
       and (select v.family_id from mi.component_variant v where v.subject_id = (e->>'variant')::bigint) = sid
     order by case e->>'slot' when 'current' then 0 else 1 end
     limit 1;
    if hit is null then
      return jsonb_build_object('group', 0, 'dimension', 'component_family', 'slot', 'current',
        'operator', 'eq', 'expected', sid::text, 'observed', null,
        'result', 'UNKNOWN', 'basis', 'unresolved');
    end if;
    return jsonb_build_object('group', 0, 'dimension', 'component_family', 'slot', hit->>'slot',
      'operator', 'eq', 'expected', sid::text, 'observed', hit->>'variant',
      'result', mi.status_to_result(hit->>'status', hit->>'role', true),
      'basis', mi.status_to_basis(hit->>'status', hit->>'role'));
  end if;

  select e into hit from jsonb_array_elements(coalesce(p_identity->'equipment', '[]'::jsonb)) e
   where (e->>'item')::bigint = sid limit 1;

  if hit is not null and coalesce(hit->>'status', 'confirmed') = 'conflicted' then
    return jsonb_build_object('group', 0, 'dimension', 'equipment_present', 'slot', 'current',
      'operator', 'eq', 'expected', sid::text, 'observed', hit->>'present',
      'result', 'UNKNOWN', 'basis', 'conflicted');
  end if;
  if hit is not null and hit->>'present' is not null then
    return jsonb_build_object('group', 0, 'dimension', 'equipment_present', 'slot', 'current',
      'operator', 'eq', 'expected', sid::text, 'observed', hit->>'present',
      'result', case when (hit->>'present')::boolean then 'MATCH' else 'NO_MATCH' end,
      'basis', coalesce(hit->>'status', 'confirmed'));
  end if;

  if p_identity->>'vmy' is not null and exists (
       select 1 from mi.equipment_availability a
        where a.vmy_id = (p_identity->>'vmy')::bigint and a.item_id = sid
          and a.availability = 'standard') then
    return null;
  end if;

  return jsonb_build_object('group', 0, 'dimension', 'equipment_present', 'slot', 'current',
    'operator', 'eq', 'expected', sid::text, 'observed', null,
    'result', 'UNKNOWN', 'basis', 'unresolved');
end $$;

-- ---------- 3. Оцінювачі ----------

create or replace function mi.eval_claim(p_claim_id bigint, p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare
  cl mi.claim%rowtype;
  gr record; ev jsonb; log jsonb := '[]'::jsonb;
  group_results text[] := '{}';
  preds text[]; bases text[];
  status text; basis text := 'confirmed';
  role_status text; role_row jsonb; fam bigint; anchor bigint;
  other_anchor jsonb; other_ev jsonb;
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

  -- Phase 7.3: якір на родину або обладнання. Знання, що дістає машину
  -- через родину компонента або через обладнання, отримує неявну групу
  -- так само, як знання про варіант: доки родину чи обладнання не
  -- розвʼязано для цієї машини, група UNKNOWN і клейм CONDITIONAL.
  if anchor is null then
    other_anchor := mi.subject_anchor_other(cl.subject_id);
    if other_anchor is not null then
      other_ev := mi.anchor_other_result(other_anchor, p_identity, cl.propagation);
      if other_ev is not null then
        group_results := group_results || (other_ev->>'result')::text;
        if basis = 'confirmed' then basis := other_ev->>'basis'; end if;
        log := log || other_ev;
      end if;
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
  other_anchor jsonb; other_ev jsonb;
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

  -- Phase 7.3: якір на родину або обладнання. Знання, що дістає машину
  -- через родину компонента або через обладнання, отримує неявну групу
  -- так само, як знання про варіант: доки родину чи обладнання не
  -- розвʼязано для цієї машини, група UNKNOWN і клейм CONDITIONAL.
  if anchor is null then
    other_anchor := mi.subject_anchor_other(p_check_id);
    if other_anchor is not null then
      other_ev := mi.anchor_other_result(other_anchor, p_identity, null);
      if other_ev is not null then
        group_results := group_results || (other_ev->>'result')::text;
        if basis = 'confirmed' then basis := other_ev->>'basis'; end if;
        log := log || other_ev;
      end if;
    end if;
  end if;

  status := mi.claim_status_from_groups(group_results);
  return jsonb_build_object('check_id', p_check_id, 'status', status,
                            'basis', basis, 'predicates', log);
end $$;
