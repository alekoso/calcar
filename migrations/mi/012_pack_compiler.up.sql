-- CalCar Model Intelligence, міграція 12: детермінований компілятор
-- пакетів знань.
--
-- Компілятор отримує ВЖЕ розвʼязану ідентичність і повертає пакет під
-- задачу. Резолвер ідентичності тут НЕ пишеться.
--
-- Три залізні правила цієї міграції:
--   1. У пакет потрапляє лише опубліковане знання. Текст заблокованого
--      кандидата не виходить звідси НІКОЛИ, у жодному полі.
--   2. Застосовність рахує код за замороженими правилами. LLM не бере
--      участі у жодному рішенні про застосовність.
--   3. Відсутність опублікованої проблеми НЕ є доказом її відсутності,
--      тому пакет завжди несе заяву про повноту покриття.

-- ---------- 0. Версія компілятора ----------

create or replace function mi.compiler_version() returns text
language sql immutable as $$ select 'pc-1.0.0'::text $$;

-- ---------- 1. Область знання ----------

-- Детерміноване віднесення subject до системи автомобіля. Використовується
-- і для групування пакета, і для заяви про покриття, тому має бути чистою
-- функцією від каталогу, а не від тексту клейма.
create or replace function mi.subject_area(p_subject_id bigint)
returns text language plpgsql stable as $$
declare
  k mi.subject_kind; anchor bigint; kindcode text; area text;
begin
  select kind into k from mi.knowledge_subject where id = p_subject_id;
  if k is null then return 'other'; end if;

  -- Сутності знання вказують на те, про що вони: беремо їхній якір.
  if k = 'issue' then
    select about_subject_id into anchor from mi.issue where subject_id = p_subject_id;
  elsif k = 'maintenance_item' then
    select about_subject_id into anchor from mi.maintenance_item where subject_id = p_subject_id;
  elsif k = 'check_item' then
    select scope_subject_id into anchor from mi.check_item where subject_id = p_subject_id;
  elsif k = 'component_state_type' then
    select applies_to_subject_id into anchor from mi.component_state_type where subject_id = p_subject_id;
  end if;

  if anchor is not null and anchor <> p_subject_id then
    return mi.subject_area(anchor);
  end if;

  if k = 'component_variant' then
    select f.family_kind_code into kindcode
      from mi.component_variant v join mi.component_family f on f.subject_id = v.family_id
     where v.subject_id = p_subject_id;
  elsif k = 'component_family' then
    select family_kind_code into kindcode from mi.component_family where subject_id = p_subject_id;
  elsif k = 'entitlement' then
    return 'entitlement';
  elsif k = 'equipment_item' then
    return 'equipment';
  elsif k in ('brand', 'model_line', 'generation', 'vehicle_version', 'version_market_year') then
    return 'vehicle';
  end if;

  area := case kindcode
    when 'engine'            then 'engine'
    when 'transmission'      then 'transmission'
    when 'transfer_case'     then 'drivetrain'
    when 'differential'      then 'drivetrain'
    when 'drive_unit'        then 'drivetrain'
    when 'battery_pack'      then 'battery'
    when 'charger'           then 'charging'
    when 'modem'             then 'electronics'
    when 'infotainment'      then 'electronics'
    when 'adas_hw'           then 'driver_assistance'
    when 'electrical'        then 'electronics'
    when 'suspension_system' then 'chassis'
    when 'brake_system'      then 'chassis'
    when 'body_module'       then 'body'
    when 'hvac'              then 'body'
    else null end;

  return coalesce(area, 'other');
end $$;

-- ---------- 2. Замикання версії ----------

-- Які subjects взагалі здатні нести знання про цю версію x ринок x рік.
-- relation пояснює, ЯК subject потрапив у замикання, і це визначає, які
-- правила поширення до нього застосовні.
--
-- Ієрархія автомобіля (бренд -> ряд -> покоління -> версія -> VMY) тече
-- вниз завжди: це вкладеність, а не поширення. Поширення (exact,
-- descendants, family_context) керує рухом знання по дереву РЕВІЗІЙ
-- компонентів і від родини до варіанта, а також політиками бренду.
create or replace function mi.vmy_scope(p_vmy_id bigint)
returns table (subject_id bigint, relation text, role_code text)
language sql stable as $$
  with vmy as (
    select y.subject_id as vmy_id, y.version_id, v.generation_id, g.phase_of_id,
           g.model_line_id, m.brand_id
      from mi.version_market_year y
      join mi.vehicle_version v on v.subject_id = y.version_id
      join mi.generation g on g.subject_id = v.generation_id
      join mi.model_line m on m.subject_id = g.model_line_id
     where y.subject_id = p_vmy_id
  ),
  hierarchy as (
    select vmy_id as sid, 'self'::text as rel from vmy
    union all select version_id, 'ancestor' from vmy
    union all select generation_id, 'ancestor' from vmy
    union all select phase_of_id, 'ancestor' from vmy where phase_of_id is not null
    union all select model_line_id, 'ancestor' from vmy
    union all select brand_id, 'ancestor' from vmy
  ),
  -- Варіанти, встановлені у цій версії. Рядок комплектації з НЕВІДОМОЮ
  -- межею вікна не розвʼязує роль і у замикання не входить.
  fitted as (
    select f.variant_id as sid, 'fitted'::text as rel, f.role_code
      from mi.version_fitment f
     where f.vmy_id = p_vmy_id
       and f.prod_from_kind <> 'unknown' and f.prod_to_kind <> 'unknown'
  ),
  -- Предки ревізій встановленого варіанта: знання про попередню ревізію
  -- дістає нащадка лише з propagation=descendants, і це перевіряється
  -- пізніше, але сам subject має бути видимим.
  rev_ancestors as (
    with recursive up as (
      select v.subject_id, v.revision_of_id, 1 as depth
        from mi.component_variant v
       where v.subject_id in (select sid from fitted)
      union all
      select p.subject_id, p.revision_of_id, up.depth + 1
        from mi.component_variant p join up on p.subject_id = up.revision_of_id
    )
    select subject_id, 'revision_ancestor'::text, null::text from up where depth > 1
  ),
  families as (
    select distinct v.family_id, 'family'::text, null::text
      from mi.component_variant v where v.subject_id in (select sid from fitted)
  ),
  equipment as (
    select a.item_id, 'equipment'::text, null::text
      from mi.equipment_availability a where a.vmy_id = p_vmy_id
  ),
  entitlements as (
    select e.subject_id, 'entitlement'::text, null::text
      from mi.entitlement e where e.brand_id in (select brand_id from vmy)
  ),
  base as (
    select sid, rel, null::text as role_code from hierarchy where sid is not null
    union all select sid, rel, role_code from fitted
    union all select * from rev_ancestors
    union all select * from families
    union all select * from equipment
    union all select * from entitlements
  ),
  -- Сутності знання про будь-що з наведеного вище.
  knowledge as (
    select i.subject_id, 'issue'::text, null::text from mi.issue i
      where i.about_subject_id in (select sid from base) and i.status = 'active'
    union all
    select m.subject_id, 'maintenance'::text, null::text from mi.maintenance_item m
      where m.about_subject_id in (select sid from base)
    union all
    select c.subject_id, 'check'::text, null::text from mi.check_item c
      where c.scope_subject_id in (select sid from base)
    union all
    select s.subject_id, 'state'::text, null::text from mi.component_state_type s
      where s.applies_to_subject_id in (select sid from base)
  )
  select sid, rel, role_code from base
  union all
  select * from knowledge;
$$;

-- ---------- 3. Чи дістає клейм цієї версії ----------

-- Правило поширення застосовується до subject клейма, а не до тексту.
create or replace function mi.claim_in_scope(
  p_claim_id bigint, p_vmy_id bigint) returns boolean
language plpgsql stable as $$
declare
  c record; rel text; k mi.subject_kind;
begin
  select cl.subject_id, cl.propagation into c from mi.claim cl where cl.id = p_claim_id;
  if not found then return false; end if;

  select relation into rel from mi.vmy_scope(p_vmy_id)
   where subject_id = c.subject_id order by relation limit 1;
  if rel is null then return false; end if;

  select kind into k from mi.knowledge_subject where id = c.subject_id;

  -- Родина досягає встановленого варіанта лише явно.
  if rel = 'family' then
    return c.propagation in ('descendants', 'family_context');
  end if;

  -- Попередня ревізія досягає наступної лише через descendants.
  if rel = 'revision_ancestor' then
    return c.propagation = 'descendants';
  end if;

  -- Бренд і модельний ряд це політика: вона тече вниз лише з descendants.
  if rel = 'ancestor' and k in ('brand', 'model_line') then
    return c.propagation = 'descendants';
  end if;

  -- Покоління, фаза, версія і сам VMY це вкладеність, а не поширення.
  return true;
end $$;

-- ---------- 4. Оцінювач застосовності ----------
--
-- Контракт ідентичності (JSON), який компілятор отримує ВЖЕ розвʼязаним:
--   brand, model_line, generation, version, vmy : subject_id
--   market_sold, market_operated                : код ринку
--   production_date, first_sale_date            : дата або null
--   model_year, mileage_km, age_years           : число або null
--   condition_tags                              : масив кодів або null
--   salvage_status                              : boolean або null
--   components  : [{role, slot, variant, status}]
--   equipment   : [{item, present, status}]
--   entitlements: [{entitlement, state}]
--   states      : [{state_type, present}]
-- Відсутнє вимірювання це UNKNOWN, а не "ні".

create or replace function mi.is_revision_of(p_child bigint, p_ancestor bigint)
returns boolean language sql stable as $$
  with recursive up as (
    select subject_id, revision_of_id from mi.component_variant where subject_id = p_child
    union all
    select v.subject_id, v.revision_of_id
      from mi.component_variant v join up on v.subject_id = up.revision_of_id
  )
  select exists (select 1 from up where subject_id = p_ancestor);
$$;

-- Заводське припущення сильної ролі це не те саме, що припущення слабкої.
-- engine, transmission і transfer_case міняють рідко і майже завжди з
-- документом, тому припущення по них дає звичайний MATCH з підставою
-- assumed_strong. Решта замінних ролей дає ASSUMED_MATCH.
create or replace function mi.status_to_result(
  p_status text, p_role text, p_positive boolean)
returns text language sql stable as $$
  select case
    when p_status = 'confirmed' then
      case when p_positive then 'MATCH' else 'NO_MATCH' end
    when p_status = 'assumed_factory' then
      case
        when (select assumption_strength from mi.component_role where code = p_role) = 'strong'
          then case when p_positive then 'MATCH' else 'NO_MATCH' end
        else case when p_positive then 'ASSUMED_MATCH' else 'ASSUMED_NO_MATCH' end
      end
    else 'UNKNOWN'
  end;
$$;

create or replace function mi.status_to_basis(p_status text, p_role text)
returns text language sql stable as $$
  select case
    when p_status = 'confirmed' then 'confirmed'
    when p_status = 'assumed_factory' then
      case when (select assumption_strength from mi.component_role where code = p_role) = 'strong'
        then 'assumed_strong' else 'assumed_factory' end
    when p_status = 'conflicted' then 'conflicted'
    else 'unresolved'
  end;
$$;

-- Оцінка одного предиката. Повертає {result, basis, observed}.
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


-- Якір клейма: варіант компонента, про який клейм насправді говорить.
-- Проблема про конкретний пак це знання про пак, навіть якщо її subject
-- це сутність проблеми. Саме через якір заводське припущення про роль
-- переходить на знання про неї.
create or replace function mi.claim_anchor_variant(p_claim_id bigint)
returns bigint language plpgsql stable as $$
declare sid bigint; k mi.subject_kind; anchor bigint;
begin
  select subject_id into sid from mi.claim where id = p_claim_id;
  if sid is null then return null; end if;
  select kind into k from mi.knowledge_subject where id = sid;
  if k = 'component_variant' then return sid; end if;

  if k = 'issue' then
    select about_subject_id into anchor from mi.issue where subject_id = sid;
  elsif k = 'maintenance_item' then
    select about_subject_id into anchor from mi.maintenance_item where subject_id = sid;
  elsif k = 'check_item' then
    select scope_subject_id into anchor from mi.check_item where subject_id = sid;
  elsif k = 'component_state_type' then
    select applies_to_subject_id into anchor from mi.component_state_type where subject_id = sid;
  end if;

  if anchor is null then return null; end if;
  if (select kind from mi.knowledge_subject where id = anchor) = 'component_variant' then
    return anchor;
  end if;
  return null;
end $$;

-- ---------- 5. Оцінка клейма ----------
--
-- Клейм це all_of груп; група це any_of предикатів.
-- Пʼять результатів предиката і пʼять статусів клейма заморожені.

create or replace function mi.group_result(p_results text[])
returns text language sql immutable as $$
  select case
    when 'MATCH' = any (p_results) then 'MATCH'
    when 'ASSUMED_MATCH' = any (p_results) then 'ASSUMED_MATCH'
    when 'UNKNOWN' = any (p_results) then 'UNKNOWN'
    when 'ASSUMED_NO_MATCH' = any (p_results) then 'ASSUMED_NO_MATCH'
    else 'NO_MATCH' end;
$$;

create or replace function mi.claim_status_from_groups(p_group_results text[])
returns text language sql immutable as $$
  select case
    when array_length(p_group_results, 1) is null then 'APPLICABLE'
    when 'NO_MATCH' = any (p_group_results) then 'EXCLUDED'
    when 'ASSUMED_NO_MATCH' = any (p_group_results) then 'EXCLUDED_ASSUMED'
    when 'UNKNOWN' = any (p_group_results) then 'CONDITIONAL'
    when 'ASSUMED_MATCH' = any (p_group_results) then 'APPLICABLE_ASSUMED'
    else 'APPLICABLE' end;
$$;

-- Оцінка клейма для конкретної ідентичності.
-- Повертає {status, basis, predicates:[...]}. Журнал предикатів
-- зберігається у пакеті, але LLM його НЕ бачить: він потрібен, щоб
-- відповісти, чому сусідній клейм було виключено.
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

-- ---------- 6. Будівник фрагмента ----------
--
-- Фрагмент це замикання опублікованого знання по версії x ринок x рік:
-- усе, що ПОТЕНЦІЙНО стосується цієї версії, ще без конкретної машини.
-- Разом із ним фіксується набір залежностей і відбиток.
--
-- Відбиток рахується лише з тих subjects, які реально взяли участь. Тому
-- публікація знання про медіаблок Tesla не змінює відбиток фрагмента BMW.

create or replace function mi.fragment_fingerprint(p_deps jsonb)
returns text language sql immutable as $$
  select md5(mi.compiler_version() || '|' || coalesce(string_agg(x, ','), ''))
    from (select (e->>'subject_id') || ':' || (e->>'knowledge_rev') as x
            from jsonb_array_elements(p_deps) e
           order by (e->>'subject_id')::bigint) t;
$$;

create or replace function mi.build_fragment(
  p_vmy_id bigint, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns bigint language plpgsql as $$
declare
  v_frag bigint; v_deps jsonb; v_fp text; v_payload jsonb; v_snap bigint;
begin
  if not exists (select 1 from mi.version_market_year where subject_id = p_vmy_id) then
    raise exception 'unknown version_market_year %', p_vmy_id;
  end if;

  create temporary table if not exists tmp_scope (
    subject_id bigint, relation text, role_code text) on commit drop;
  delete from tmp_scope;
  insert into tmp_scope select * from mi.vmy_scope(p_vmy_id);

  create temporary table if not exists tmp_claims (claim_id bigint) on commit drop;
  delete from tmp_claims;
  insert into tmp_claims
  select c.id from mi.claim c
   where c.status = 'published'
     and c.subject_id in (select subject_id from tmp_scope)
     and mi.claim_in_scope(c.id, p_vmy_id);

  -- Залежності: усі subjects замикання плюс subjects узятих клеймів.
  -- Виключені клейми теж лишаються залежністю: зміна предиката здатна
  -- повернути їх назад, і фрагмент має про це дізнатись.
  select jsonb_agg(jsonb_build_object('subject_id', s.id, 'knowledge_rev', s.knowledge_rev)
                   order by s.id)
    into v_deps
    from mi.knowledge_subject s
   where s.id in (select subject_id from tmp_scope)
      or s.id in (select c.subject_id from mi.claim c join tmp_claims t on t.claim_id = c.id);

  v_fp := mi.fragment_fingerprint(coalesce(v_deps, '[]'::jsonb));
  select max(id) into v_snap from mi.knowledge_snapshot;

  -- Статичний зміст фрагмента: усе, що не залежить від конкретної машини.
  select jsonb_build_object(
    'vmy_id', p_vmy_id,
    'built_for_purpose', p_purpose,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
               'claim_id', c.id,
               'subject_id', c.subject_id,
               'subject_kind', ks.kind,
               'area', mi.subject_area(c.subject_id),
               'knowledge_type', c.knowledge_type,
               'confidence', c.confidence,
               'buyer_importance', c.buyer_importance,
               'buyer_implication_en', c.buyer_implication_en,
               'text_en', c.text_en,
               'layer', c.layer,
               'value_kind', c.value_kind,
               'structured_value', c.structured_value,
               'contested', c.contested,
               'contested_note_en', c.contested_note_en,
               'propagation', c.propagation,
               'recurrence_class', rs.recurrence_class,
               'evidence_summary', c.evidence_summary,
               'supports', (select jsonb_agg(cs.supporting_claim_id order by cs.supporting_claim_id)
                              from mi.claim_support cs where cs.synthesis_claim_id = c.id),
               'issue', (select jsonb_build_object('issue_key', i.issue_key, 'name_en', i.name_en,
                                  'severity', i.severity, 'sensitivity', i.sensitivity,
                                  'mechanism_en', i.mechanism_en)
                           from mi.issue i where i.subject_id = c.subject_id),
               'check', (select jsonb_build_object('method', ci.test_method_code,
                                  'why_en', ci.why_en, 'proves_en', ci.proves_en,
                                  'cannot_prove_en', ci.cannot_prove_en,
                                  'priority', ci.default_priority,
                                  'materially_resolves', ci.materially_resolves,
                                  'resolves_dimension', ci.resolves_dimension)
                           from mi.check_item ci where ci.subject_id = c.subject_id),
               'maintenance', (select jsonb_build_object('service_kind', mm.service_kind_code,
                                  'fluid_spec', mm.fluid_spec_code, 'capacity_note_en', mm.capacity_note_en)
                           from mi.maintenance_item mm where mm.subject_id = c.subject_id),
               'state', (select jsonb_build_object('state_key', st.state_key, 'state_kind', st.state_kind,
                                  'sanctioned_by_oem', st.sanctioned_by_oem)
                           from mi.component_state_type st where st.subject_id = c.subject_id),
               'entitlement', (select jsonb_build_object('entitlement_key', en.entitlement_key,
                                  'name_en', en.name_en, 'binding', en.binding,
                                  'revocable', en.revocable, 'revoke_reasons', en.revoke_reasons)
                           from mi.entitlement en where en.subject_id = c.subject_id)
             ) order by c.id)
        from mi.claim c
        join tmp_claims t on t.claim_id = c.id
        join mi.knowledge_subject ks on ks.id = c.subject_id
        left join mi.recurrence_summary rs on rs.claim_id = c.id
    ), '[]'::jsonb),
    -- Агрегована метадані про прогалини. ТІЛЬКИ лічильники і класи
    -- причин: текст заблокованого кандидата сюди не потрапляє ніколи.
    'gaps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'area', area,
               'blocked_high_importance', hi,
               'blocked_total', tot,
               'gap_classes', classes) order by area)
        from (
          select area,
                 count(distinct cand) as tot,
                 count(distinct cand) filter (where imp >= 4) as hi,
                 jsonb_agg(distinct gap_class) as classes
            from (
              select mi.subject_area(k.resolved_subject_id) as area,
                     k.id as cand,
                     coalesce(k.proposed_buyer_importance, 0) as imp,
                     case r->>'code'
                       when 'owner_pattern_groups' then 'insufficient_owner_independence'
                       when 'owner_pattern_context' then 'insufficient_owner_independence'
                       when 'owner_practice_recurrence' then 'insufficient_owner_independence'
                       when 'specialist_source' then 'missing_specialist'
                       when 'official_source' then 'missing_official'
                       when 'known_issue_evidence' then 'missing_official'
                       when 'vendor_not_alone' then 'vendor_only_evidence'
                       when 'synthesis_support' then 'missing_supporting_claims'
                       else 'other' end as gap_class
                from mi.candidate_claim k,
                     lateral jsonb_array_elements(k.gate_result->'rules') r
               where k.review_status not in ('approved', 'merged', 'rejected')
                 and k.resolved_subject_id in (select subject_id from tmp_scope)
                 and k.gate_result is not null
                 and (r->>'ok')::boolean is false
            ) x group by area
        ) y
    ), '[]'::jsonb)
  ) into v_payload;

  insert into mi.pack_fragment (vmy_id, purpose, locale, budget_profile, compiler_version,
                                fingerprint, payload, payload_bytes, snapshot_id, valid, built_at)
  values (p_vmy_id, p_purpose, p_locale, p_budget, mi.compiler_version(),
          v_fp, v_payload, octet_length(v_payload::text), v_snap, true, now())
  on conflict on constraint pack_fragment_key do update
    set fingerprint = excluded.fingerprint, payload = excluded.payload,
        payload_bytes = excluded.payload_bytes, snapshot_id = excluded.snapshot_id,
        valid = true, built_at = now()
  returning id into v_frag;

  delete from mi.fragment_dependency where fragment_id = v_frag;
  insert into mi.fragment_dependency (fragment_id, subject_id, knowledge_rev)
  select v_frag, (e->>'subject_id')::bigint, (e->>'knowledge_rev')::bigint
    from jsonb_array_elements(coalesce(v_deps, '[]'::jsonb)) e;

  update mi.build_request set status = 'done', finished_at = now()
   where vmy_id = p_vmy_id and purpose = p_purpose and status in ('queued', 'running');

  return v_frag;
end $$;

-- ---------- 7. Бюджети і пороги за призначенням ----------

create or replace function mi.purpose_budget(p_purpose mi.pack_purpose)
returns jsonb language sql immutable as $$
  select case p_purpose
    when 'decision'  then '{"max_claims":40,"conditional_min_importance":4,"conditional_per_area":2}'
    when 'report'    then '{"max_claims":120,"conditional_min_importance":3,"conditional_per_area":4}'
    when 'component' then '{"max_claims":60,"conditional_min_importance":2,"conditional_per_area":6}'
    else                  '{"max_claims":30,"conditional_min_importance":3,"conditional_per_area":2}'
  end::jsonb;
$$;

-- ---------- 8. Компілятор пакета ----------

create or replace function mi.compile_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare
  v_vmy bigint; frag mi.pack_fragment%rowtype; cfg jsonb;
  v_log jsonb := '[]'::jsonb; v_pack jsonb;
  n_total int; n_kept int; n_elig int; n_cap int; n_status_out int;
begin
  v_vmy := (p_identity->>'vmy')::bigint;
  cfg := mi.purpose_budget(p_purpose);

  select * into frag from mi.pack_fragment
   where vmy_id = v_vmy and purpose = p_purpose and locale = p_locale
     and budget_profile = p_budget and compiler_version = mi.compiler_version();

  if not found or not frag.valid then
    return jsonb_build_object('fragment_available', false,
      'reason', case when not found then 'fragment_missing' else 'invalidated' end);
  end if;

  -- 8.1. Оцінка кожного клейма фрагмента.
  create temporary table if not exists tmp_eval (
    claim_id bigint, status text, basis text, area text, importance smallint,
    knowledge_type text, severity text, priority text, entry jsonb, preds jsonb
  ) on commit drop;
  delete from tmp_eval;

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
    claim_id bigint, tier int, rank_key text, area text, entry jsonb,
    status text, basis text
  ) on commit drop;
  delete from tmp_pick;

  insert into tmp_pick
  select t.claim_id,
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
         lpad(t.claim_id::text, 12, '0'),
         t.area, t.entry, t.status, t.basis
    from tmp_eval t
   where t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
      or (t.status = 'CONDITIONAL'
          and t.importance >= (cfg->>'conditional_min_importance')::int
          and (
            t.basis = 'conflicted'
            or exists (
              select 1 from tmp_eval c
               where c.entry->'check'->>'materially_resolves' = 'true'
                 and c.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'CONDITIONAL')
                 and (
                   exists (select 1 from jsonb_array_elements(t.preds) pr
                            where pr->>'result' = 'UNKNOWN'
                              and pr->>'dimension' = c.entry->'check'->>'resolves_dimension')
                   or (c.entry->'check'->>'resolves_dimension' is null and c.area = t.area)
                 ))
          ));

  select count(*) into n_elig from tmp_pick;
  select count(*) into n_status_out from tmp_eval
   where status in ('EXCLUDED', 'EXCLUDED_ASSUMED');

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
      'filtered_by_policy', n_total - n_status_out - n_cap,
      'truncated_count', n_cap - n_kept,
      'counts', (select jsonb_object_agg(status, n)
                   from (select status, count(*) n from tmp_eval group by status) s)),
    'identity_summary', mi.identity_summary(p_identity),
    'coverage_statement', mi.coverage_statement(frag.id, p_identity),
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

-- ---------- 9. Складові пакета ----------
--
-- Усі три помічники читають тимчасові таблиці поточної компіляції через
-- динамічний SQL: план не кешується, тому тимчасові таблиці не заважають.

-- Текст умови будується за детермінованим шаблоном із журналу предикатів.
-- Це структурне речення, а не згенерований текст: LLM тут не бере участі.
create or replace function mi.condition_text(p_preds jsonb)
returns text language sql stable as $$
  select case when d is null then null
    else 'Applies only once ' || replace(d, '_', ' ') || ' is established for this car.' end
    from (select (select pr->>'dimension' from jsonb_array_elements(p_preds) pr
                   where pr->>'result' = 'UNKNOWN' order by pr->>'dimension' limit 1) as d) t;
$$;

create or replace function mi.pack_bucket(p_area text, p_kind text)
returns jsonb language plpgsql stable as $$
declare res jsonb; cond text;
begin
  -- Ключі, яких у клейма немає, присутні у payload зі значенням JSON null,
  -- тому перевіряється саме тип, а не SQL NULL.
  cond := case p_kind
    when 'issue'       then $c$jsonb_typeof(p.entry->'issue') = 'object'$c$
    when 'check'       then $c$jsonb_typeof(p.entry->'check') = 'object'$c$
    when 'maintenance' then $c$jsonb_typeof(p.entry->'maintenance') = 'object'$c$
    when 'state'       then $c$jsonb_typeof(p.entry->'state') = 'object'$c$
    when 'entitlement' then $c$jsonb_typeof(p.entry->'entitlement') = 'object'$c$
    when 'comparison'  then $c$p.entry->>'subject_kind' = 'vehicle_version'$c$
    else $c$jsonb_typeof(p.entry->'issue') is distinct from 'object'
          and jsonb_typeof(p.entry->'check') is distinct from 'object'
          and jsonb_typeof(p.entry->'maintenance') is distinct from 'object'
          and jsonb_typeof(p.entry->'state') is distinct from 'object'
          and jsonb_typeof(p.entry->'entitlement') is distinct from 'object'
          and p.entry->>'subject_kind' is distinct from 'vehicle_version'$c$ end;

  execute format($q$
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'claim_id', p.claim_id,
             'text', p.entry->>'text_en',
             'knowledge_type', p.entry->>'knowledge_type',
             'confidence', p.entry->>'confidence',
             'buyer_importance', (p.entry->>'buyer_importance')::int,
             'buyer_implication', p.entry->>'buyer_implication_en',
             'status', p.status,
             'basis', p.basis,
             'condition_text', case when p.status = 'CONDITIONAL'
                                    then mi.condition_text(e.preds) else null end,
             'layer', p.entry->>'layer',
             'recurrence', p.entry->>'recurrence_class',
             'value', p.entry->'structured_value',
             'contested', case when (p.entry->>'contested')::boolean then
                            jsonb_build_object('is_contested', true,
                              'note', p.entry->>'contested_note_en') else null end,
             'supports', p.entry->'supports',
             'issue', p.entry->'issue',
             'check', p.entry->'check',
             'maintenance', p.entry->'maintenance',
             'state', p.entry->'state',
             'entitlement', p.entry->'entitlement'
           )) order by p.rank_key), '[]'::jsonb)
      from tmp_pick p join tmp_eval e on e.claim_id = p.claim_id
     where (%s) and (%L is null or p.area = %L)
  $q$, cond, p_area, p_area) into res;
  return res;
end $$;

create or replace function mi.identity_summary(p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare lines jsonb := '[]'::jsonb; c jsonb; vname text; nm text;
begin
  select label into vname from mi.knowledge_subject where id = (p_identity->>'vmy')::bigint;

  for c in select e from jsonb_array_elements(coalesce(p_identity->'components','[]'::jsonb)) e
           where e->>'slot' = 'current' order by e->>'role' loop
    select label into nm from mi.knowledge_subject where id = (c->>'variant')::bigint;
    lines := lines || jsonb_build_object(
      'role', c->>'role',
      'slot', 'current',
      'variant', nm,
      'resolution_status', c->>'status',
      'assumption_strength', (select assumption_strength from mi.component_role where code = c->>'role'),
      'line', case c->>'status'
        when 'assumed_factory' then 'ASSUMED FACTORY: ' || coalesce(nm, 'unknown')
                                    || ', no sign of replacement was observed.'
        when 'conflicted' then 'CONFLICTED: ' || (c->>'role') || ' has two sources that disagree.'
        when 'unresolved' then 'UNRESOLVED: ' || (c->>'role') || ' could not be established.'
        else 'CONFIRMED: ' || coalesce(nm, 'unknown') end);
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'vmy', vname,
    'market_sold', p_identity->>'market_sold',
    'market_operated', p_identity->>'market_operated',
    'production_date', p_identity->>'production_date',
    'model_year', p_identity->>'model_year',
    'mileage_km', p_identity->>'mileage_km',
    'age_years', p_identity->>'age_years',
    'salvage_status', p_identity->'salvage_status',
    'condition_tags', p_identity->'condition_tags',
    'components', lines));
end $$;

-- Заява про повноту покриття. Рахує ОПУБЛІКОВАНЕ знання по шарах і додає
-- агреговану метадані про прогалини. Текст заблокованого кандидата сюди
-- не потрапляє: лише лічильники і класи причин.
create or replace function mi.coverage_statement(p_fragment_id bigint, p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare res jsonb;
begin
  execute $q$
    with applicable as (
      select area, knowledge_type from tmp_eval
       where status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
    ),
    lvl as (
      select area,
             count(*) filter (where knowledge_type = 'official_fact') as official,
             count(*) filter (where knowledge_type = 'specialist_practice') as specialist,
             count(*) filter (where knowledge_type in ('owner_pattern','owner_practice')) as owner,
             count(*) filter (where knowledge_type = 'known_issue') as known_issue,
             count(*) filter (where knowledge_type = 'calcar_synthesis') as synthesis
        from applicable group by area
    ),
    gaps as (
      select g->>'area' as area,
             (g->>'blocked_high_importance')::int as hi,
             (g->>'blocked_total')::int as tot,
             g->'gap_classes' as classes
        from mi.pack_fragment f, lateral jsonb_array_elements(f.payload->'gaps') g
       where f.id = $1
    ),
    merged as (
      select coalesce(l.area, gp.area) as area,
             coalesce(l.official,0) o, coalesce(l.specialist,0) s, coalesce(l.owner,0) w,
             coalesce(l.known_issue,0) ki, coalesce(l.synthesis,0) sy,
             coalesce(gp.hi,0) hi, coalesce(gp.tot,0) tot, coalesce(gp.classes,'[]'::jsonb) cls
        from lvl l full join gaps gp on gp.area = l.area
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'area', area,
        'official', case when o >= 3 then 'strong' when o >= 1 then 'medium' else 'none' end,
        'specialist', case when s >= 3 then 'strong' when s >= 1 then 'medium' else 'none' end,
        'owner', case when w >= 3 then 'strong' when w >= 1 then 'medium' else 'none' end,
        'known_issues', ki,
        'synthesis', sy,
        'blocked_high_importance', hi,
        'blocked_total', tot,
        'gap_classes', cls,
        'confidence_note',
          case
            when o = 0 and s = 0 and w = 0 then
              'No published knowledge of this area reaches this car. This is absence of coverage, not evidence that the area is trouble free.'
            when hi > 0 then
              'Independent owner or specialist coverage of this area is incomplete: '
                || hi || ' high importance findings are held back for lack of evidence.'
            when s = 0 and w = 0 then
              'Only manufacturer documents cover this area; independent confirmation is missing.'
            when o = 0 then
              'No manufacturer document covers this area; the knowledge here is independent only.'
            else 'Coverage of this area draws on more than one kind of source.'
          end) order by area), '[]'::jsonb)
      from merged
  $q$ into res using p_fragment_id;
  return res;
end $$;

-- ---------- 10. Гаряча дорога: промах фрагмента не компілює ----------

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
