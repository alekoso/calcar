-- Відкат міграції 26: дослівні тексти з 012, 021 і 024, потім прибрати помічники.

create or replace function mi.eval_predicate(p_pred mi.claim_applicability, p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare
  res text := 'UNKNOWN'; basis text := 'unresolved'; observed text := null;
  want_slot text; comp jsonb; fam bigint; hit jsonb; other jsonb;
  v_num numeric; v_date date; v_tag text; v_bool boolean; tags jsonb;
  ident_sid bigint; ok boolean;
begin
  -- 4.1. Ієрархія автомобіля.
  if p_pred.dimension in ('brand', 'model_line', 'generation', 'version', 'vmy') then
    ident_sid := (p_identity->>(p_pred.dimension::text))::bigint;
    if ident_sid is null then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    ok := ident_sid = p_pred.ref_subject_id;
    -- Фаза покоління успадковує знання батьківського покоління.
    if not ok and p_pred.dimension = 'generation' then
      ok := exists (select 1 from mi.generation g
                     where g.subject_id = ident_sid and g.phase_of_id = p_pred.ref_subject_id);
    end if;
    if p_pred.operator = 'ne' then ok := not ok; end if;
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', ident_sid::text);
  end if;

  -- 4.2. Варіант компонента у слоті.
  if p_pred.dimension = 'component_variant' then
    select family_id into fam from mi.component_variant where subject_id = p_pred.ref_subject_id;
    want_slot := case p_pred.config_scope when 'factory' then 'factory' else 'current' end;

    -- Шукаємо запис ідентичності про ТУ САМУ родину: питання «чи стоїть
    -- саме цей варіант» має сенс лише там, де роль взагалі відома.
    select e into hit from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
     where e->>'slot' = want_slot
       and (select v.family_id from mi.component_variant v where v.subject_id = (e->>'variant')::bigint) = fam
       and ((e->>'variant')::bigint = p_pred.ref_subject_id
            or (p_pred.include_revisions
                and mi.is_revision_of((e->>'variant')::bigint, p_pred.ref_subject_id)))
     limit 1;

    if hit is not null then
      res := mi.status_to_result(hit->>'status', hit->>'role', true);
      basis := mi.status_to_basis(hit->>'status', hit->>'role');
      return jsonb_build_object('result', res, 'basis', basis, 'observed', hit->>'variant');
    end if;

    select e into other from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
     where e->>'slot' = want_slot
       and (select v.family_id from mi.component_variant v where v.subject_id = (e->>'variant')::bigint) = fam
     limit 1;

    if other is not null then
      res := mi.status_to_result(other->>'status', other->>'role', false);
      basis := mi.status_to_basis(other->>'status', other->>'role');
      return jsonb_build_object('result', res, 'basis', basis, 'observed', other->>'variant');
    end if;

    -- Роль цієї родини у слоті не розвʼязана взагалі.
    select e into other from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
     where e->>'slot' = want_slot
       and (select v.family_id from mi.component_variant v where v.subject_id = (e->>'variant')::bigint) is null
     limit 1;
    return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
  end if;

  -- 4.3. Родина компонента.
  if p_pred.dimension = 'component_family' then
    want_slot := case p_pred.config_scope when 'factory' then 'factory' else 'current' end;
    select e into hit from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
     where e->>'slot' = want_slot
       and (select v.family_id from mi.component_variant v where v.subject_id = (e->>'variant')::bigint)
           = p_pred.ref_subject_id
     limit 1;
    if hit is null then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    return jsonb_build_object('result', mi.status_to_result(hit->>'status', hit->>'role', true),
                              'basis', mi.status_to_basis(hit->>'status', hit->>'role'),
                              'observed', hit->>'variant');
  end if;

  -- 4.4. Структурний атрибут варіанта. Саме так перевірка ендоскопії
  -- дістає і Alusil-мотор BMW, і Alusil-мотор Porsche, і не дістає
  -- мотор із напиленням.
  if p_pred.dimension = 'variant_attribute' then
    want_slot := case p_pred.config_scope when 'factory' then 'factory' else 'current' end;
    select e into hit from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
     where e->>'slot' = want_slot
       and exists (select 1 from mi.variant_attribute a
                    where a.variant_id = (e->>'variant')::bigint
                      and a.attr_key = p_pred.attr_key and a.attr_value = p_pred.attr_value)
     limit 1;
    if hit is not null then
      return jsonb_build_object('result', mi.status_to_result(hit->>'status', hit->>'role', true),
                                'basis', mi.status_to_basis(hit->>'status', hit->>'role'),
                                'observed', p_pred.attr_value);
    end if;
    -- Жоден відомий варіант не несе цього значення, але чи всі ролі
    -- розвʼязані? Якщо ні, відповідь UNKNOWN, а не "ні".
    if exists (select 1 from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
                where e->>'slot' = want_slot and e->>'status' not in ('confirmed', 'assumed_factory')) then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    return jsonb_build_object('result', 'NO_MATCH', 'basis', 'confirmed', 'observed', null);
  end if;

  -- 4.5. Обладнання.
  if p_pred.dimension in ('equipment_present', 'equipment_absent') then
    select e into hit from jsonb_array_elements(coalesce(p_identity->'equipment','[]'::jsonb)) e
     where (e->>'item')::bigint = p_pred.ref_subject_id limit 1;
    if hit is null or hit->>'present' is null then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    ok := (hit->>'present')::boolean;
    if p_pred.dimension = 'equipment_absent' then ok := not ok; end if;
    if coalesce(hit->>'status', 'confirmed') = 'conflicted' then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'conflicted', 'observed', hit->>'present');
    end if;
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', coalesce(hit->>'status', 'confirmed'), 'observed', hit->>'present');
  end if;

  -- 4.6. Право.
  if p_pred.dimension = 'entitlement_state' then
    select e into hit from jsonb_array_elements(coalesce(p_identity->'entitlements','[]'::jsonb)) e
     where (e->>'entitlement')::bigint = p_pred.ref_subject_id limit 1;
    if hit is null or hit->>'state' = 'unknown' then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    ok := hit->>'state' = 'present';
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', hit->>'state');
  end if;

  -- 4.7. Стан компонента. Відсутність запису про стан НЕ є доказом, що
  -- стану не було, тому NO_MATCH дає лише явне "ні".
  if p_pred.dimension = 'component_state_present' then
    select e into hit from jsonb_array_elements(coalesce(p_identity->'states','[]'::jsonb)) e
     where (e->>'state_type')::bigint = p_pred.ref_subject_id limit 1;
    if hit is null or hit->>'present' is null then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    return jsonb_build_object('result', case when (hit->>'present')::boolean then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', hit->>'present');
  end if;

  -- 4.8. Ринок, теги умов, salvage.
  if p_pred.dimension in ('market_sold', 'market_operated') then
    v_tag := p_identity->>(p_pred.dimension::text);
    if v_tag is null then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    ok := v_tag = p_pred.tag;
    if p_pred.operator = 'ne' then ok := not ok; end if;
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', v_tag);
  end if;

  if p_pred.dimension = 'condition_tag' then
    tags := p_identity->'condition_tags';
    if tags is null or jsonb_typeof(tags) <> 'array' then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    ok := tags ? p_pred.tag;
    if p_pred.operator = 'tag_not' then ok := not ok; end if;
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', p_pred.tag);
  end if;

  if p_pred.dimension = 'salvage_status' then
    if p_identity->'salvage_status' is null or jsonb_typeof(p_identity->'salvage_status') = 'null' then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    v_bool := (p_identity->>'salvage_status')::boolean;
    ok := v_bool = (p_pred.tag = 'true');
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', v_bool::text);
  end if;

  -- 4.9. Діапазони. Невідоме значення ідентичності дає UNKNOWN, а не "ні".
  if p_pred.dimension in ('production_date', 'first_sale_date') then
    v_date := (p_identity->>(p_pred.dimension::text))::date;
    if v_date is null then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    ok := v_date >= p_pred.value_date_from and v_date <= p_pred.value_date_to;
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', v_date::text);
  end if;

  if p_pred.dimension in ('mileage_km', 'age_years', 'model_year') then
    v_num := (p_identity->>(p_pred.dimension::text))::numeric;
    if v_num is null then
      return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
    end if;
    ok := v_num >= p_pred.value_num_from and v_num <= p_pred.value_num_to;
    return jsonb_build_object('result', case when ok then 'MATCH' else 'NO_MATCH' end,
                              'basis', 'confirmed', 'observed', v_num::text);
  end if;

  return jsonb_build_object('result', 'UNKNOWN', 'basis', 'unresolved', 'observed', null);
end $$;

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

create or replace function mi.compile_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare
  v_vmy bigint; frag mi.pack_fragment%rowtype; cfg jsonb;
  v_log jsonb := '[]'::jsonb; v_pack jsonb;
  n_total int; n_kept int; n_elig int; n_cap int; n_status_out int; n_merged int;
  v_partial jsonb;
begin
  v_vmy := (p_identity->>'vmy')::bigint;
  cfg := mi.purpose_budget(p_purpose);

  -- Phase 7.3: частковий шлях. Без точного VMY, але з підтвердженою
  -- версією зміст збирається синхронно в межах версії і її кандидатних
  -- VMY. Точний шлях нижче не змінений: фрагмент VMY як і раніше лише
  -- читається, синхронної збірки фрагмента немає.
  if v_vmy is null then
    if p_identity->>'version' is null then
      return jsonb_build_object('fragment_available', false, 'reason', 'version_not_identified');
    end if;
    v_partial := mi.build_partial_payload(p_identity, p_purpose);
    frag.payload := v_partial;
    frag.fingerprint := v_partial->>'fingerprint';
    frag.snapshot_id := (v_partial->>'snapshot_id')::bigint;
    frag.valid := true;
  else
  select * into frag from mi.pack_fragment
   where vmy_id = v_vmy and purpose = p_purpose and locale = p_locale
     and budget_profile = p_budget and compiler_version = mi.compiler_version();

  if not found or not frag.valid then
    return jsonb_build_object('fragment_available', false,
      'reason', case when not found then 'fragment_missing' else 'invalidated' end);
  end if;
  end if;

  -- 8.1. Оцінка кожного клейма фрагмента.
  create temporary table if not exists tmp_eval (
    claim_id bigint, status text, basis text, area text, importance smallint,
    knowledge_type text, severity text, priority text, entry jsonb, preds jsonb
  ) on commit drop;
  delete from tmp_eval where true;

  insert into tmp_eval
  select (e->>'claim_id')::bigint,
         ev->>'status', ev->>'basis', e->>'area',
         (e->>'buyer_importance')::smallint,
         e->>'knowledge_type',
         e->'issue'->>'severity',
         e->'check'->>'priority',
         e,
         ev->'predicates'
    from jsonb_array_elements(frag.payload->'claims') e,
         lateral mi.eval_claim((e->>'claim_id')::bigint, p_identity) ev;

  -- Канонічні перевірки оцінюються тими самими правилами і входять у
  -- ту саму таблицю відбору. Клейм про перевірку для цього не потрібен.
  -- Канонічна перевірка це ІДЕНТИЧНІСТЬ обʼєкта перевірки. Ключ
  -- дедуплікації це check_item.id, а не текст. Опубліковані клейми про ту
  -- саму перевірку доповнюють її метаданими і доказом, але другого
  -- екземпляра не створюють.
  insert into tmp_eval
  select null::bigint,
         cv->>'status', cv->>'basis', e->>'area',
         greatest((e->>'buyer_importance')::smallint,
                  coalesce(enr.max_importance, 0)::smallint),
         'check_item',
         null,
         e->>'priority',
         jsonb_build_object(
           'subject_kind', 'check_item',
           'check_subject_id', (e->>'check_id')::bigint,
           'text_en', e->>'why_en',
           'buyer_importance', greatest((e->>'buyer_importance')::int,
                                        coalesce(enr.max_importance, 0)),
           'entry_source', 'canonical_entity',
           'enriched_by_claims', coalesce(enr.notes, '[]'::jsonb),
           'check', jsonb_build_object(
             'method', e->>'method', 'why_en', e->>'why_en',
             'proves_en', e->>'proves_en', 'cannot_prove_en', e->>'cannot_prove_en',
             'conditions', e->'conditions', 'priority', e->>'priority',
             'materially_resolves', (e->>'materially_resolves')::boolean,
             'resolves_dimension', e->>'resolves_dimension',
             'covers', e->'covers')),
         cv->'predicates'
    from jsonb_array_elements(frag.payload->'checks') e
    cross join lateral mi.eval_check((e->>'check_id')::bigint, p_identity) cv
    left join lateral (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'claim_id', t.claim_id,
               'text', t.entry->>'text_en',
               'knowledge_type', t.entry->>'knowledge_type',
               'confidence', t.entry->>'confidence',
               'buyer_importance', (t.entry->>'buyer_importance')::int,
               'buyer_implication', t.entry->>'buyer_implication_en',
               'status', t.status,
               'basis', t.basis,
               'recurrence', t.entry->>'recurrence_class',
               'supports', t.entry->'supports',
               'contested', case when (t.entry->>'contested')::boolean then
                              jsonb_build_object('is_contested', true,
                                'note', t.entry->>'contested_note_en') else null end))
               order by t.claim_id) as notes,
             max((t.entry->>'buyer_importance')::int) as max_importance
        from tmp_eval t
       where t.claim_id is not null
         and t.entry->>'subject_kind' = 'check_item'
         and (t.entry->>'subject_id')::bigint = (e->>'check_id')::bigint
    ) enr on true;

  select count(*) into n_total from tmp_eval;

  v_log := coalesce((select jsonb_agg(jsonb_build_object(
                       'claim_id', claim_id, 'status', status, 'basis', basis,
                       'predicates', preds) order by claim_id) from tmp_eval), '[]'::jsonb);

  -- 8.2. Що взагалі має право потрапити у пакет.
  -- Виключене знання не потрапляє ніколи. Умовне знання потрапляє лише
  -- тоді, коли воно справді здатне змінити рішення І невизначеність
  -- знімається конкретною перевіркою, або коли сама ідентичність
  -- суперечлива.
  create temporary table if not exists tmp_pick (
    pick_key text, claim_id bigint, tier int, rank_key text, area text, entry jsonb,
    status text, basis text, preds jsonb
  ) on commit drop;
  delete from tmp_pick where true;

  insert into tmp_pick
  select coalesce('claim:' || t.claim_id::text,
                  'check:' || (t.entry->>'check_subject_id')),
         t.claim_id,
         case
           when t.importance = 5 then 1
           when t.severity in ('catastrophic', 'major') and t.status = 'APPLICABLE' then 1
           when t.priority = 'must' and t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED') then 1
           when t.importance = 4 then 2
           when t.importance = 3 then 3
           else 4 end,
         -- Ключ сортування детермінований і не залежить від LLM.
         lpad((10 - coalesce(t.importance, 0))::text, 2, '0') || '|' ||
         case t.status when 'APPLICABLE' then '1' when 'APPLICABLE_ASSUMED' then '2'
                       when 'APPLICABLE_CONTEXT' then '3' else '4' end || '|' ||
         case coalesce(t.severity, 'zz') when 'catastrophic' then '1' when 'major' then '2'
                       when 'moderate' then '3' when 'minor' then '4' else '9' end || '|' ||
         lpad(coalesce(t.claim_id, 900000000 + (t.entry->>'check_subject_id')::bigint)::text, 12, '0'),
         t.area, t.entry, t.status, t.basis, t.preds
    from tmp_eval t
   where
     -- Клейм ПРО перевірку не створює другого екземпляра перевірки:
     -- він приєднується до канонічного запису як доповнення.
     not (t.claim_id is not null and t.entry->>'subject_kind' = 'check_item')
     and (t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
      or (t.status = 'CONDITIONAL'
          and t.importance >= (cfg->>'conditional_min_importance')::int
          and (
            t.basis = 'conflicted'
            or exists (
              select 1 from tmp_eval c
               where c.entry->'check'->>'materially_resolves' = 'true'
                 and c.claim_id is distinct from t.claim_id
                 and c.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'CONDITIONAL')
                 and (
                   exists (select 1 from jsonb_array_elements(t.preds) pr
                            where pr->>'result' = 'UNKNOWN'
                              and pr->>'dimension' = c.entry->'check'->>'resolves_dimension')
                   or (c.entry->'check'->>'resolves_dimension' is null and c.area = t.area)
                 ))
          )));

  select count(*) into n_elig from tmp_pick;
  select count(*) into n_status_out from tmp_eval
   where status in ('EXCLUDED', 'EXCLUDED_ASSUMED');
  select count(*) into n_merged from tmp_eval
   where claim_id is not null and entry->>'subject_kind' = 'check_item'
     and status not in ('EXCLUDED', 'EXCLUDED_ASSUMED');

  -- 8.3. Стеля умовного знання на область: список проблем усіх можливих
  -- ревізій користувачу не показується.
  delete from tmp_pick p
   where p.status = 'CONDITIONAL'
     and (select count(*) from tmp_pick q
           where q.area = p.area and q.status = 'CONDITIONAL' and q.rank_key < p.rank_key)
         >= (cfg->>'conditional_per_area')::int;

  select count(*) into n_cap from tmp_pick;

  -- 8.4. Бюджет. Обрізання детерміноване: за рангом, а не випадково.
  delete from tmp_pick p
   where (select count(*) from tmp_pick q where q.rank_key < p.rank_key)
         >= (cfg->>'max_claims')::int;

  select count(*) into n_kept from tmp_pick;

  -- 8.5. Складання пакета.
  select jsonb_build_object(
    'fragment_available', true,
    'pack_meta', jsonb_build_object(
      'compiler_version', mi.compiler_version(),
      'purpose', p_purpose, 'locale', p_locale, 'budget_profile', p_budget,
      'fragment_id', frag.id, 'fragment_fingerprint', frag.fingerprint,
      'snapshot_id', frag.snapshot_id,
      'evaluated_count', n_total,
      'included_count', n_kept,
      -- Три різні причини не потрапити у пакет рахуються окремо, бо
      -- означають різне: знання не про цю машину, знання надто умовне
      -- для цього призначення, знання не вмістилось у бюджет.
      'excluded_by_status', n_status_out,
      'merged_into_checks', n_merged,
      'filtered_by_policy', n_total - n_status_out - n_merged - n_cap,
      'truncated_count', n_cap - n_kept,
      'counts', (select jsonb_object_agg(status, n)
                   from (select status, count(*) n from tmp_eval group by status) s))
      -- Лише частковий пакет несе ці ключі; точний пакет байт у байт той самий.
      || case when v_partial is null then '{}'::jsonb else jsonb_build_object(
           'identity_precision', 'partial',
           'version_id', (p_identity->>'version')::bigint,
           'unresolved_dimensions', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                                       from unnest(array['vmy', 'market_sold', 'model_year']) d
                                      where p_identity->>d is null),
           'candidate_vmy_count', jsonb_array_length(v_partial->'candidate_vmy_ids'),
           'candidate_vmy_ids', v_partial->'candidate_vmy_ids',
           'inaccessible_vmy_only_count', (v_partial->>'vmy_only_count')::int) end,
    'identity_summary', mi.identity_summary(p_identity),
    'coverage_statement', case when v_partial is null then mi.coverage_statement(frag.id, p_identity)
                               else mi.coverage_statement_from_gaps(v_partial->'gaps', p_identity) end,
    'systems', coalesce((
      select jsonb_agg(sys order by sys->>'area') from (
        select jsonb_build_object(
          'area', area,
          'issues', mi.pack_bucket(area, 'issue'),
          'claims', mi.pack_bucket(area, 'claim'),
          'maintenance', mi.pack_bucket(area, 'maintenance'),
          'check_items', mi.pack_bucket(area, 'check'),
          'states', mi.pack_bucket(area, 'state')) as sys
          from (select distinct area from tmp_pick) a
      ) z), '[]'::jsonb),
    'entitlements', mi.pack_bucket(null, 'entitlement'),
    'comparisons', mi.pack_bucket(null, 'comparison')
  ) into v_pack;

  return jsonb_build_object('pack', v_pack, 'applicability_log', v_log);
end $$;

drop function if exists mi.version_year_exclusion(jsonb);
drop function if exists mi.component_role_conflict(bigint, jsonb, text);
