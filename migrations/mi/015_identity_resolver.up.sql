-- CalCar Model Intelligence, міграція 15: детермінований резолвер
-- ідентичності і накладка по VIN.
--
-- Резолвер це НЕ дослідницький рушій і НЕ шар міркувань LLM. Його робота
-- вузька: зібрати спостереження про конкретну машину, розвʼязати
-- суперечності за наперед оголошеними правилами старшинства і записати
-- результат у mi_vm.resolved_identity разом із вимірами.
--
-- Схема не змінюється: ні таблиці, ні колонки, ні типу. Сирі
-- спостереження зберігаються у mi_vm.resolved_identity.inputs, яка
-- існує у замороженій схемі саме для цього.
--
-- Формат одного спостереження:
--   {"source": текст, "source_type": текст, "observed_at": дата,
--    "confidence": high|medium|low,
--    "dimension": значення mi.identity_dimension,
--    "role": код ролі, "slot": factory|current,
--    "value_subject": id, "value_alias": текст, "alias_scope": id,
--    "value_text": текст, "value_num": число, "value_date": дата,
--    "value_bool": boolean,
--    "provenance_root": текст}
--
-- provenance_root це корінь походження. Два спостереження з однаковим
-- коренем це ОДИН доказ, а не два: оголошення, переписане з аукціону, не
-- подвоює впевненість.

create or replace function mi.resolver_version() returns text
language sql immutable as $$ select 'ir-1.0.0'::text $$;

-- ---------- 1. Старшинство джерел ----------

-- Старшинство оголошується ПО КАТЕГОРІЇ виміру, а не одним списком на
-- все. VIN найсильніший для заводської ідентичності і найслабший для
-- поточного стану: він за визначенням не може знати про заміну.
-- Візуальне спостереження навпаки: воно нічого не каже про завод, але
-- багато каже про те, що стоїть у машині зараз.
create or replace function mi.source_rank(p_category text, p_source_type text)
returns int language sql immutable as $$
  select coalesce(case p_category

    when 'factory_identity' then case p_source_type
      when 'vin_decoder'      then 100
      when 'build_sheet'      then 95
      when 'manufacturer'     then 95
      when 'auction'          then 70
      when 'user'             then 60
      when 'vehicle_memory'   then 55
      when 'listing'          then 40
      when 'catalog'          then 20
      when 'historical_vision' then 0
      when 'current_vision'   then 0
      else 0 end

    when 'current_hardware' then case p_source_type
      when 'vehicle_memory'   then 100
      when 'diagnostics'      then 95
      when 'user'             then 85
      when 'current_vision'   then 80
      when 'build_sheet'      then 55
      when 'historical_vision' then 50
      when 'auction'          then 40
      when 'listing'          then 30
      when 'manufacturer'     then 30
      when 'vin_decoder'      then 10
      else 0 end

    -- Право це запис у системах виробника, а не залізо. Жодне
    -- спостереження заліза не має тут ваги взагалі.
    when 'entitlement' then case p_source_type
      when 'manufacturer'     then 100
      when 'vehicle_memory'   then 90
      when 'user'             then 70
      when 'auction'          then 50
      when 'listing'          then 25
      else 0 end

    when 'scalar' then case p_source_type
      when 'vehicle_memory'   then 90
      when 'diagnostics'      then 85
      when 'auction'          then 70
      when 'user'             then 65
      when 'listing'          then 50
      when 'vin_decoder'      then 40
      when 'current_vision'   then 30
      else 0 end

    else 0 end, 0);
$$;

-- Категорія виміру. Заводський слот і поточний слот того самого
-- компонента належать РІЗНИМ категоріям, і у цьому вся суть.
create or replace function mi.dimension_category(p_dimension text, p_slot text)
returns text language sql immutable as $$
  select case
    when p_dimension = 'entitlement_state' then 'entitlement'
    when p_dimension in ('mileage_km', 'age_years', 'condition_tag', 'salvage_status')
      then 'scalar'
    when p_dimension in ('component_variant', 'component_family', 'variant_attribute',
                         'equipment_present', 'equipment_absent', 'component_state_present')
      then case when coalesce(p_slot, 'factory') = 'current' then 'current_hardware'
                else 'factory_identity' end
    else 'factory_identity' end;
$$;

-- Поріг, з якого джерело вважається достатнім, щоб оголосити значення
-- підтвердженим, і поріг, з якого розбіжність двох джерел стає
-- конфліктом, а не перемогою сильнішого.
create or replace function mi.confirm_threshold(p_category text)
returns int language sql immutable as $$
  select case p_category
    when 'factory_identity' then 40
    when 'current_hardware' then 40
    when 'entitlement'      then 50
    else 40 end;
$$;

create or replace function mi.strong_threshold(p_category text)
returns int language sql immutable as $$
  select case p_category
    when 'factory_identity' then 70
    when 'current_hardware' then 80
    when 'entitlement'      then 70
    else 65 end;
$$;

-- ---------- 2. Розвʼязання аліаса ----------

-- Аліас без контексту, що вказує на два різні subject, НЕ вгадується.
-- Повертається null, а вимір стає unresolved із поясненням.
create or replace function mi.resolve_alias(p_alias text, p_scope_subject bigint default null)
returns jsonb language plpgsql stable as $$
declare n int; sid bigint;
begin
  if p_alias is null then return jsonb_build_object('subject_id', null, 'ambiguous', false); end if;

  select count(*), min(target_subject_id) into n, sid
    from mi.subject_alias
   where alias_norm = lower(btrim(p_alias))
     and (p_scope_subject is null or scope_subject_id = p_scope_subject or scope_kind = 'global');

  if n = 1 then
    return jsonb_build_object('subject_id', sid, 'ambiguous', false);
  elsif n = 0 then
    return jsonb_build_object('subject_id', null, 'ambiguous', false, 'note', 'alias not found');
  else
    return jsonb_build_object('subject_id', null, 'ambiguous', true,
      'note', format('alias resolves to %s subjects, context is required', n));
  end if;
end $$;

-- ---------- 3. Розвʼязання одного виміру ----------

-- Повертає {value_subject, value_text, value_num, value_date, value_bool,
--           status, basis, supporting, conflicting, candidates, note}.
--
-- Правило конфлікту: якщо два РІЗНІ значення підтримані джерелами, які
-- обидва дотягують до порогу сили, це conflicted, і переможця немає.
-- Сильне проти слабкого дає перемогу сильного, а слабке лишається у
-- провенансі як розбіжність, а не зникає.
create or replace function mi.resolve_dimension(p_obs jsonb, p_category text)
returns jsonb language plpgsql stable as $$
declare
  best jsonb; second jsonb; n_values int;
  conf_thr int := mi.confirm_threshold(p_category);
  strong_thr int := mi.strong_threshold(p_category);
  status text; note text := null;
begin
  -- Дедуплікація за коренем походження: з кожного кореня лишається лише
  -- найсильніше спостереження. Переписане оголошення не подвоює доказ.
  with deduped as (
    select distinct on (coalesce(o->>'provenance_root', o->>'source'))
           o, mi.source_rank(p_category, o->>'source_type') as rank
      from jsonb_array_elements(p_obs) o
     order by coalesce(o->>'provenance_root', o->>'source'),
              mi.source_rank(p_category, o->>'source_type') desc,
              o->>'source'
  ),
  grouped as (
    select coalesce(o->>'value_subject', o->>'value_text', o->>'value_num',
                    o->>'value_date', o->>'value_bool', 'null') as vkey,
           max(rank) as rank,
           jsonb_agg(jsonb_build_object('source', o->>'source',
                       'source_type', o->>'source_type',
                       'observed_at', o->>'observed_at',
                       'confidence', o->>'confidence',
                       'provenance_root', o->>'provenance_root',
                       'rank', rank) order by rank desc) as obs,
           (array_agg(o order by rank desc))[1] as sample
      from deduped group by 1
  )
  select (select to_jsonb(g) from grouped g order by g.rank desc, g.vkey limit 1),
         (select to_jsonb(g) from grouped g order by g.rank desc, g.vkey offset 1 limit 1),
         (select count(*) from grouped)
    into best, second, n_values;

  if best is null then
    return jsonb_build_object('status', 'unresolved', 'basis', 'no observation',
      'supporting', '[]'::jsonb, 'conflicting', '[]'::jsonb, 'candidates', '[]'::jsonb);
  end if;

  if n_values > 1
     and (best->>'rank')::int >= strong_thr
     and (second->>'rank')::int >= strong_thr then
    status := 'conflicted';
    note := format('two sources of comparable strength disagree: rank %s against rank %s',
                   best->>'rank', second->>'rank');
  elsif (best->>'rank')::int >= conf_thr then
    status := 'confirmed';
  else
    status := 'unresolved';
    note := format('strongest observation has rank %s, below the threshold of %s',
                   best->>'rank', conf_thr);
  end if;

  return jsonb_build_object(
    'status', status,
    'basis', coalesce(best->'sample'->>'source_type', 'unknown'),
    'value_subject', case when status = 'conflicted' then null
                          else (best->'sample'->>'value_subject')::bigint end,
    'value_text', case when status = 'conflicted' then null else best->'sample'->>'value_text' end,
    'value_num', case when status = 'conflicted' then null
                      else (best->'sample'->>'value_num')::numeric end,
    'value_date', case when status = 'conflicted' then null
                       else (best->'sample'->>'value_date')::date end,
    'value_bool', case when status = 'conflicted' then null
                       else (best->'sample'->>'value_bool')::boolean end,
    'confidence', coalesce(best->'sample'->>'confidence', 'low'),
    'supporting', best->'obs',
    'conflicting', coalesce(second->'obs', '[]'::jsonb),
    -- Обидві сторони конфлікту зберігаються: резолвер не обирає сам.
    'candidates', case when n_values > 1 then jsonb_build_array(
                         jsonb_build_object('value', best->>'vkey', 'rank', best->>'rank'),
                         jsonb_build_object('value', second->>'vkey', 'rank', second->>'rank'))
                       else '[]'::jsonb end,
    'note', note);
end $$;

-- ---------- 4. Головна функція резолвера ----------

-- Ідемпотентність: версія ідентичності це відбиток самих спостережень і
-- версії резолвера. Ті самі спостереження дають ту саму версію і той
-- самий рядок. Інші спостереження дають НОВУ версію, а попередня
-- лишається у базі: unique (vin, identity_version) це дозволяє.
create or replace function mi.identity_version(p_obs jsonb) returns text
language sql immutable as $$
  select 'iv-' || substr(md5(mi.resolver_version() || '|' ||
    coalesce((select string_agg(o::text, '|' order by o::text)
                from jsonb_array_elements(p_obs) o), '')), 1, 16);
$$;

create or replace function mi.resolve_identity(p_vin text, p_obs jsonb)
returns bigint language plpgsql as $$
declare
  v_id bigint; v_ver text; r record; res jsonb; obs jsonb;
  v_vmy bigint; v_version bigint; v_market text; v_year int;
  v_gen bigint; v_line bigint; v_brand bigint;
  fitted record; cur_present boolean; cat text;
  alias_res jsonb; sid bigint; note text;
begin
  if coalesce(btrim(p_vin), '') = '' then raise exception 'vin is required'; end if;
  v_ver := mi.identity_version(p_obs);

  -- Той самий набір спостережень не породжує нового рядка.
  select id into v_id from mi_vm.resolved_identity
   where vin = p_vin and identity_version = v_ver;
  if found then return v_id; end if;

  insert into mi_vm.resolved_identity (vin, identity_version, resolver_version, inputs)
  values (p_vin, v_ver, mi.resolver_version(), p_obs)
  returning id into v_id;

  -- 4.1. Аліаси розвʼязуються до всього іншого. Неоднозначний аліас не
  -- вгадується: спостереження втрачає значення і лишається у провенансі.
  create temporary table if not exists tmp_obs (o jsonb, amb boolean default false) on commit drop;
  delete from tmp_obs;
  for obs in select o from jsonb_array_elements(p_obs) o loop
    if obs ? 'value_alias' and not (obs ? 'value_subject') then
      alias_res := mi.resolve_alias(obs->>'value_alias', (obs->>'alias_scope')::bigint);
      if (alias_res->>'ambiguous')::boolean then
        insert into tmp_obs values (obs || jsonb_build_object('alias_note', alias_res->>'note'), true);
        continue;
      end if;
      obs := obs || jsonb_build_object('value_subject', alias_res->>'subject_id');
    end if;
    insert into tmp_obs values (obs, false);
  end loop;

  -- 4.2. Кожен ключ виміру розвʼязується окремо.
  for r in
    select o->>'dimension' as dim,
           o->>'role' as role,
           coalesce(o->>'slot', 'na') as slot,
           jsonb_agg(o) as obs
      from tmp_obs where not amb and o->>'dimension' is not null
     group by 1, 2, 3
  loop
    cat := mi.dimension_category(r.dim, r.slot);
    res := mi.resolve_dimension(r.obs, cat);

    insert into mi_vm.resolved_identity_dimension (
      identity_id, dimension, role_code, slot, value_subject_id, value_text,
      value_num, value_date, value_bool, confidence, resolution_status,
      provenance, conflict_note)
    values (v_id, r.dim::mi.identity_dimension, r.role, r.slot::mi.config_slot,
      (res->>'value_subject')::bigint, res->>'value_text',
      (res->>'value_num')::numeric, (res->>'value_date')::date,
      (res->>'value_bool')::boolean,
      (res->>'confidence')::mi.confidence,
      (res->>'status')::mi.resolution_status,
      jsonb_build_object('category', cat, 'basis', res->>'basis',
        'supporting', res->'supporting', 'conflicting', res->'conflicting',
        'candidates', res->'candidates', 'note', res->>'note',
        'resolver_version', mi.resolver_version(), 'resolved_at', now()),
      case when res->>'status' = 'conflicted'
           then coalesce(res->>'note', 'sources disagree') else null end)
    on conflict do nothing;
  end loop;

  -- 4.3. Неоднозначні аліаси лишають слід: вимір існує зі статусом
  -- unresolved, щоб мовчазного зникнення не сталось.
  for r in
    select o->>'dimension' as dim, o->>'role' as role,
           coalesce(o->>'slot', 'na') as slot, jsonb_agg(o) as obs
      from tmp_obs where amb and o->>'dimension' is not null
     group by 1, 2, 3
  loop
    if exists (select 1 from mi_vm.resolved_identity_dimension d
                where d.identity_id = v_id and d.dimension = r.dim::mi.identity_dimension
                  and coalesce(d.role_code, '') = coalesce(r.role, '')
                  and d.slot = r.slot::mi.config_slot) then
      continue;
    end if;
    insert into mi_vm.resolved_identity_dimension (
      identity_id, dimension, role_code, slot, confidence, resolution_status, provenance)
    values (v_id, r.dim::mi.identity_dimension, r.role, r.slot::mi.config_slot,
      'low', 'unresolved',
      jsonb_build_object('category', 'alias', 'note', 'alias is ambiguous without context',
        'supporting', r.obs, 'resolver_version', mi.resolver_version()))
    on conflict do nothing;
  end loop;

  perform mi.resolve_hierarchy(v_id);
  perform mi.resolve_fitment(v_id);
  return v_id;
end $$;

-- ---------- 5. Ієрархія: версія, ринок, рік, VMY ----------

-- Рік сам по собі версії не дає, і версія сама по собі VMY не дає.
-- VMY зʼявляється лише тоді, коли розвʼязані ВСІ три складові:
-- версія, ринок продажу і модельний рік. Інакше unresolved, і жодного
-- підбору найближчого.
create or replace function mi.resolve_hierarchy(p_identity bigint)
returns void language plpgsql as $$
declare
  v_version bigint; v_market text; v_year int; v_vmy bigint;
  v_gen bigint; v_line bigint; v_brand bigint; n int; st text;
begin
  select value_subject_id into v_version from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = 'version' and resolution_status = 'confirmed';
  select coalesce(value_text, tag) into v_market from (
    select value_text, null::text as tag from mi_vm.resolved_identity_dimension
     where identity_id = p_identity and dimension = 'market_sold'
       and resolution_status = 'confirmed') t;
  select value_num::int into v_year from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = 'model_year' and resolution_status = 'confirmed';

  if v_version is not null and v_market is not null and v_year is not null then
    select subject_id into v_vmy from mi.version_market_year
     where version_id = v_version and market_code = v_market and model_year = v_year;
  end if;

  if v_vmy is not null then
    insert into mi_vm.resolved_identity_dimension (identity_id, dimension, slot,
        value_subject_id, confidence, resolution_status, provenance)
    values (p_identity, 'vmy', 'na', v_vmy, 'high', 'confirmed',
      jsonb_build_object('category', 'derived', 'basis', 'catalog',
        'note', 'derived from a confirmed version, market and model year'))
    on conflict do nothing;

    select v.generation_id, g.model_line_id, m.brand_id into v_gen, v_line, v_brand
      from mi.version_market_year y
      join mi.vehicle_version v on v.subject_id = y.version_id
      join mi.generation g on g.subject_id = v.generation_id
      join mi.model_line m on m.subject_id = g.model_line_id
     where y.subject_id = v_vmy;

    insert into mi_vm.resolved_identity_dimension (identity_id, dimension, slot,
        value_subject_id, confidence, resolution_status, provenance)
    select p_identity, d, 'na', s, 'high', 'confirmed',
           jsonb_build_object('category', 'derived', 'basis', 'catalog',
             'note', 'contained by the resolved version and market year')
      from (values ('generation'::mi.identity_dimension, v_gen),
                   ('model_line', v_line), ('brand', v_brand)) t(d, s)
     where s is not null
    on conflict do nothing;
  else
    -- Явно фіксуємо, що VMY не розвʼязано, і чому саме.
    insert into mi_vm.resolved_identity_dimension (identity_id, dimension, slot,
        confidence, resolution_status, provenance)
    values (p_identity, 'vmy', 'na', 'low', 'unresolved',
      jsonb_build_object('category', 'derived', 'note',
        format('version %s, market %s, model year %s: all three are required',
               coalesce(v_version::text, 'unresolved'),
               coalesce(v_market, 'unresolved'),
               coalesce(v_year::text, 'unresolved'))))
    on conflict do nothing;
  end if;
end $$;

-- ---------- 6. Заводська комплектація і поточний слот ----------

-- Для кожної замінної ролі версії:
--   якщо заводський слот не спостерігався, він береться з каталогу
--   комплектації зі статусом assumed_factory; рядок із НЕВІДОМОЮ межею
--   вікна роль не розвʼязує ніколи;
--   якщо поточний слот не спостерігався і немає жодного свідчення про
--   заміну, він отримує ТОЙ САМИЙ варіант зі статусом assumed_factory,
--   і ніколи confirmed. Для сильних ролей це дає компілятору підставу
--   assumed_strong, для слабких лишає APPLICABLE_ASSUMED.
create or replace function mi.resolve_fitment(p_identity bigint)
returns void language plpgsql as $$
declare v_vmy bigint; r record; has_factory boolean; has_current boolean; n_fit int;
begin
  select value_subject_id into v_vmy from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = 'vmy' and resolution_status = 'confirmed';
  if v_vmy is null then return; end if;

  for r in
    select f.role_code, f.variant_id, cr.is_replaceable, cr.assumption_strength,
           count(*) over (partition by f.role_code) as n_variants
      from mi.version_fitment f
      join mi.component_role cr on cr.code = f.role_code
     where f.vmy_id = v_vmy and f.fitment = 'standard'
       and f.prod_from_kind <> 'unknown' and f.prod_to_kind <> 'unknown'
  loop
    -- Роль, для якої каталог дає кілька стандартних варіантів, не
    -- розвʼязується припущенням: це не наша справа вгадувати.
    if r.n_variants > 1 then continue; end if;

    select exists (select 1 from mi_vm.resolved_identity_dimension d
                    where d.identity_id = p_identity and d.dimension = 'component_variant'
                      and d.role_code = r.role_code and d.slot = 'factory')
      into has_factory;
    select exists (select 1 from mi_vm.resolved_identity_dimension d
                    where d.identity_id = p_identity and d.dimension = 'component_variant'
                      and d.role_code = r.role_code and d.slot = 'current')
      into has_current;

    if not has_factory then
      insert into mi_vm.resolved_identity_dimension (identity_id, dimension, role_code,
          slot, value_subject_id, confidence, resolution_status, provenance)
      values (p_identity, 'component_variant', r.role_code, 'factory', r.variant_id,
        'medium', 'assumed_factory',
        jsonb_build_object('category', 'factory_identity', 'basis', 'catalog fitment',
          'note', 'no direct observation of the factory slot; taken from the version fitment'))
      on conflict do nothing;
    end if;

    if not has_current then
      insert into mi_vm.resolved_identity_dimension (identity_id, dimension, role_code,
          slot, value_subject_id, confidence, resolution_status, provenance)
      select p_identity, 'component_variant', r.role_code, 'current',
             coalesce((select d.value_subject_id from mi_vm.resolved_identity_dimension d
                        where d.identity_id = p_identity and d.dimension = 'component_variant'
                          and d.role_code = r.role_code and d.slot = 'factory'
                          and d.resolution_status in ('confirmed', 'assumed_factory')),
                      r.variant_id),
             'medium', 'assumed_factory',
        jsonb_build_object('category', 'current_hardware', 'basis', 'factory assumption',
          'assumption_strength', r.assumption_strength,
          'note', case when r.assumption_strength = 'strong'
            then 'replacement of this role is rare and almost always documented'
            else 'replacement of this role is common and invisible from outside' end)
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- ---------- 7. Контракт із компілятором ----------

-- Серіалізація розвʼязаної ідентичності у той самий JSON, який приймає
-- mi.compile_pack. Це єдина точка стику: компілятор не змінювався.
create or replace function mi.identity_json(p_identity bigint)
returns jsonb language plpgsql stable as $$
declare res jsonb;
begin
  select jsonb_strip_nulls(jsonb_build_object(
    'identity_id', p_identity,
    'vin', (select vin from mi_vm.resolved_identity where id = p_identity),
    'identity_version', (select identity_version from mi_vm.resolved_identity where id = p_identity),
    'brand',       mi.identity_subject(p_identity, 'brand'),
    'model_line',  mi.identity_subject(p_identity, 'model_line'),
    'generation',  mi.identity_subject(p_identity, 'generation'),
    'version',     mi.identity_subject(p_identity, 'version'),
    'vmy',         mi.identity_subject(p_identity, 'vmy'),
    'market_sold',     mi.identity_text(p_identity, 'market_sold'),
    'market_operated', mi.identity_text(p_identity, 'market_operated'),
    'production_date', mi.identity_date(p_identity, 'production_date'),
    'first_sale_date', mi.identity_date(p_identity, 'first_sale_date'),
    'model_year',  mi.identity_num(p_identity, 'model_year'),
    'mileage_km',  mi.identity_num(p_identity, 'mileage_km'),
    'age_years',   mi.identity_num(p_identity, 'age_years'),
    'salvage_status', (select value_bool from mi_vm.resolved_identity_dimension
                        where identity_id = p_identity and dimension = 'salvage_status'
                          and resolution_status = 'confirmed' limit 1),
    'condition_tags', (select jsonb_agg(value_text order by value_text)
                         from mi_vm.resolved_identity_dimension
                        where identity_id = p_identity and dimension = 'condition_tag'
                          and resolution_status = 'confirmed'
                          and coalesce(value_bool, true)),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('role', role_code, 'slot', slot,
               'variant', value_subject_id, 'status', resolution_status)
               order by role_code, slot)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension = 'component_variant'
         and role_code is not null), '[]'::jsonb),
    'equipment', coalesce((
      select jsonb_agg(jsonb_build_object('item', value_subject_id,
               'present', case when dimension = 'equipment_absent'
                               then not coalesce(value_bool, true)
                               else coalesce(value_bool, true) end,
               'slot', slot, 'status', resolution_status) order by value_subject_id, slot)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension in ('equipment_present', 'equipment_absent')
         and slot = 'current'), '[]'::jsonb),
    'entitlements', coalesce((
      select jsonb_agg(jsonb_build_object('entitlement', value_subject_id,
               'state', coalesce(value_text, 'unknown')) order by value_subject_id)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension = 'entitlement_state'
         and resolution_status = 'confirmed'), '[]'::jsonb),
    'states', coalesce((
      select jsonb_agg(jsonb_build_object('state_type', value_subject_id,
               'present', coalesce(value_bool, true)) order by value_subject_id)
        from mi_vm.resolved_identity_dimension
       where identity_id = p_identity and dimension = 'component_state_present'
         and resolution_status = 'confirmed'), '[]'::jsonb)
  )) into res;
  return res;
end $$;

create or replace function mi.identity_subject(p_identity bigint, p_dim text)
returns bigint language sql stable as $$
  select value_subject_id from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = p_dim::mi.identity_dimension
     and resolution_status = 'confirmed' and value_subject_id is not null limit 1;
$$;
create or replace function mi.identity_text(p_identity bigint, p_dim text)
returns text language sql stable as $$
  select value_text from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = p_dim::mi.identity_dimension
     and resolution_status = 'confirmed' and value_text is not null limit 1;
$$;
create or replace function mi.identity_num(p_identity bigint, p_dim text)
returns numeric language sql stable as $$
  select value_num from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = p_dim::mi.identity_dimension
     and resolution_status = 'confirmed' and value_num is not null limit 1;
$$;
create or replace function mi.identity_date(p_identity bigint, p_dim text)
returns date language sql stable as $$
  select value_date from mi_vm.resolved_identity_dimension
   where identity_id = p_identity and dimension = p_dim::mi.identity_dimension
     and resolution_status = 'confirmed' and value_date is not null limit 1;
$$;

-- ---------- 8. Накладка по VIN ----------

-- Накладка несе ТІЛЬКИ факти конкретної машини. Загальне знання про
-- модель лишається у Model Intelligence і сюди не копіюється: інакше
-- один і той самий факт жив би у двох місцях і розходився б.
create or replace function mi.vin_overlay(p_identity bigint)
returns jsonb language plpgsql stable as $$
declare v_vin text;
begin
  select vin into v_vin from mi_vm.resolved_identity where id = p_identity;
  if v_vin is null then return null; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'vin', v_vin,
    'identity_id', p_identity,
    'identity_version', (select identity_version from mi_vm.resolved_identity where id = p_identity),
    'resolver_version', (select resolver_version from mi_vm.resolved_identity where id = p_identity),
    'resolved_at', (select resolved_at from mi_vm.resolved_identity where id = p_identity),

    -- Поточний стан компонентів цієї машини і те, як він встановлений.
    'components', (select jsonb_agg(jsonb_build_object(
          'role', d.role_code, 'slot', d.slot,
          'variant', ks.label, 'variant_subject_id', d.value_subject_id,
          'status', d.resolution_status, 'confidence', d.confidence,
          'basis', d.provenance->>'basis',
          'conflict_note', d.conflict_note,
          'candidates', nullif(d.provenance->'candidates', '[]'::jsonb))
          order by d.role_code, d.slot)
        from mi_vm.resolved_identity_dimension d
        left join mi.knowledge_subject ks on ks.id = d.value_subject_id
       where d.identity_id = p_identity and d.dimension = 'component_variant'),

    'equipment', (select jsonb_agg(jsonb_build_object(
          'item', ks.label, 'item_subject_id', d.value_subject_id, 'slot', d.slot,
          'present', d.value_bool, 'status', d.resolution_status,
          'basis', d.provenance->>'basis') order by d.value_subject_id, d.slot)
        from mi_vm.resolved_identity_dimension d
        left join mi.knowledge_subject ks on ks.id = d.value_subject_id
       where d.identity_id = p_identity
         and d.dimension in ('equipment_present', 'equipment_absent')),

    'entitlements', (select jsonb_agg(jsonb_build_object(
          'entitlement', ks.label, 'entitlement_subject_id', d.value_subject_id,
          'state', d.value_text, 'status', d.resolution_status,
          'basis', d.provenance->>'basis') order by d.value_subject_id)
        from mi_vm.resolved_identity_dimension d
        left join mi.knowledge_subject ks on ks.id = d.value_subject_id
       where d.identity_id = p_identity and d.dimension = 'entitlement_state'),

    'known_replacements', (select jsonb_agg(jsonb_build_object(
          'state_type', ks.label, 'state_subject_id', d.value_subject_id,
          'present', d.value_bool, 'status', d.resolution_status,
          'basis', d.provenance->>'basis') order by d.value_subject_id)
        from mi_vm.resolved_identity_dimension d
        left join mi.knowledge_subject ks on ks.id = d.value_subject_id
       where d.identity_id = p_identity and d.dimension = 'component_state_present'),

    'mileage_km', mi.identity_num(p_identity, 'mileage_km'),
    'age_years', mi.identity_num(p_identity, 'age_years'),
    'production_date', mi.identity_date(p_identity, 'production_date'),
    'first_sale_date', mi.identity_date(p_identity, 'first_sale_date'),
    'market_sold', mi.identity_text(p_identity, 'market_sold'),
    'market_operated', mi.identity_text(p_identity, 'market_operated'),
    'salvage_status', (select value_bool from mi_vm.resolved_identity_dimension
                        where identity_id = p_identity and dimension = 'salvage_status' limit 1),
    'condition_tags', (select jsonb_agg(value_text order by value_text)
                         from mi_vm.resolved_identity_dimension
                        where identity_id = p_identity and dimension = 'condition_tag'),

    -- Вимірювання і стани цієї машини з Vehicle Memory, якщо вони є.
    'measurements', (select jsonb_agg(jsonb_build_object(
          'method', m.method_code, 'measured_at', m.measured_at,
          'expires_at', m.expires_at, 'value', m.value) order by m.measured_at desc)
        from mi_vm.measurement m where m.vin = v_vin),

    -- Те, що резолвер НЕ зміг розвʼязати, і чому. Це частина накладки:
    -- невідоме має бути видимим.
    -- Поле присутнє завжди, навіть порожнє: невідоме має бути видимим,
    -- а відсутність ключа легко сплутати з відсутністю проблем.
    'unresolved', coalesce((select jsonb_agg(jsonb_build_object(
          'dimension', d.dimension, 'role', d.role_code, 'slot', d.slot,
          'status', d.resolution_status, 'note',
          coalesce(d.conflict_note, d.provenance->>'note')) order by d.dimension, d.role_code)
        from mi_vm.resolved_identity_dimension d
       where d.identity_id = p_identity
         and d.resolution_status in ('unresolved', 'conflicted')), '[]'::jsonb)
  ));
end $$;

-- ---------- 9. Збереження пакета ----------

-- Тепер уперше пакет можна зберегти: FK на mi_vm.resolved_identity має
-- на що вказувати.
create or replace function mi.persist_pack(
  p_identity bigint, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns bigint language plpgsql as $$
declare
  ident jsonb; compiled jsonb; v_pack bigint; v_frag bigint; v_snap bigint; v_iv text;
begin
  ident := mi.identity_json(p_identity);
  if ident->>'vmy' is null then
    raise exception 'identity % has no resolved version, market and year', p_identity;
  end if;

  compiled := mi.compile_pack(ident, p_purpose, p_locale, p_budget);
  -- Успішна компіляція повертає {pack, applicability_log}; прапорець
  -- доступності фрагмента лежить усередині пакета, а при промаху на
  -- верхньому рівні. Перевіряються обидва місця.
  if not coalesce((compiled->'pack'->>'fragment_available')::boolean,
                  (compiled->>'fragment_available')::boolean, false) then
    return null;
  end if;

  v_frag := (compiled->'pack'->'pack_meta'->>'fragment_id')::bigint;
  v_snap := (compiled->'pack'->'pack_meta'->>'snapshot_id')::bigint;
  if v_snap is null then select max(id) into v_snap from mi.knowledge_snapshot; end if;
  select identity_version into v_iv from mi_vm.resolved_identity where id = p_identity;

  -- ТЕРТЯ ЗІ СХЕМОЮ, зафіксоване тут навмисно.
  -- knowledge_pack_key це unique (identity_version, fingerprint) БЕЗ
  -- purpose, locale і budget_profile. Відбиток фрагмента однаковий для
  -- всіх призначень однієї версії, тому пакет рішення і пакет звіту тієї
  -- самої машини стикаються в одному рядку. Схема заморожена, тому
  -- замість тихого перезапису чужого рядка функція відмовляється
  -- працювати і називає причину.
  if exists (select 1 from mi.knowledge_pack kp
              where kp.identity_version = v_iv
                and kp.fingerprint = compiled->'pack'->'pack_meta'->>'fragment_fingerprint'
                and (kp.purpose <> p_purpose or kp.locale <> p_locale
                     or kp.budget_profile <> p_budget)) then
    raise exception using
      errcode = 'unique_violation',
      message = format('knowledge_pack cannot hold purpose %s for identity version %s: '
                       'the unique key is (identity_version, fingerprint) and does not '
                       'include purpose, locale or budget_profile', p_purpose, v_iv);
  end if;

  insert into mi.knowledge_pack (identity_id, identity_version, fragment_id, purpose,
      locale, budget_profile, compiler_version, fingerprint, payload, applicability_log,
      snapshot_id, stale)
  values (p_identity, v_iv, v_frag, p_purpose, p_locale, p_budget,
      mi.compiler_version(),
      compiled->'pack'->'pack_meta'->>'fragment_fingerprint',
      compiled->'pack', compiled->'applicability_log', v_snap, false)
  on conflict on constraint knowledge_pack_key do update
    set payload = excluded.payload, applicability_log = excluded.applicability_log,
        fragment_id = excluded.fragment_id, snapshot_id = excluded.snapshot_id,
        stale = false, created_at = now()
  returning id into v_pack;

  return v_pack;
end $$;
