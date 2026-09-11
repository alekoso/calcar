-- CalCar Model Intelligence, міграція 18: міст від того, що Check уже
-- знає, до спостережень Vehicle Memory, і тіньова компіляція пакетів.
--
-- Phase 6.1 дала памʼяті таблиці спостережень і адаптер до резолвера,
-- але наповнювати їх не було кому: продакшн жодного разу не викликає
-- помічників запису. Ця міграція будує міст із ТОГО, ЩО ВЖЕ Є у
-- продакшн-даних: декод NHTSA у `vehicles`, знімки оголошень і
-- аукціонні події.
--
-- Три правила мосту:
--   1. Нічого не вигадувати. Те, чого у даних немає, не зʼявляється.
--      Дати виробництва vPIC не дає, тому її тут і не буде.
--   2. Не вгадувати версію. Якщо каталог не дає РІВНО одного збігу,
--      версія не пишеться, і весь ланцюг чесно закінчується на
--      `knowledge_missing`.
--   3. Ідемпотентність. Повторний прохід по тому самому VIN не плодить
--      спостережень.
--
-- Тінь означає тінь: жодна функція звідси не змінює звіт, Score, рішення
-- і взагалі нічого у продукті. Вона лише рахує, що Model Intelligence
-- сказала б про цю машину.

-- ---------- 1. Зіставлення декоду з каталогом версій ----------

-- Повертає {version_id, matched_by, ambiguous, tried}.
-- Здогадок немає: рівно один збіг це збіг, два це неоднозначність,
-- нуль це відсутність версії у каталозі.
create or replace function mi.match_version(
  p_brand text, p_candidates text[], p_model_year int default null)
returns jsonb language plpgsql stable as $$
declare v_brand bigint; hits bigint[]; matched_by text; cand text;
begin
  select subject_id into v_brand from mi.brand where lower(name) = lower(btrim(coalesce(p_brand, '')));
  if v_brand is null then
    return jsonb_build_object('version_id', null, 'ambiguous', false,
      'matched_by', null, 'tried', to_jsonb(p_candidates), 'note', 'brand is not in the catalogue');
  end if;

  -- 1.1. Аліас у межах бренду, ряду або покоління цього бренду.
  select array_agg(distinct a.target_subject_id) into hits
    from mi.subject_alias a
    join mi.knowledge_subject ks on ks.id = a.target_subject_id
    left join mi.vehicle_version vv on vv.subject_id = a.target_subject_id
    left join mi.generation g on g.subject_id = vv.generation_id
    left join mi.model_line ml on ml.subject_id = g.model_line_id
   where ks.kind = 'vehicle_version'
     and ml.brand_id = v_brand
     and a.alias_norm = any (select lower(btrim(c)) from unnest(p_candidates) c where btrim(c) <> '');
  if hits is not null and array_length(hits, 1) = 1 then
    matched_by := 'alias';
  end if;

  -- 1.2. Код або назва версії у межах бренду.
  if hits is null or array_length(hits, 1) is null then
    select array_agg(distinct vv.subject_id) into hits
      from mi.vehicle_version vv
      join mi.generation g on g.subject_id = vv.generation_id
      join mi.model_line ml on ml.subject_id = g.model_line_id
     where ml.brand_id = v_brand
       and (lower(vv.version_code) = any (select lower(btrim(c)) from unnest(p_candidates) c)
            or lower(vv.name_en) = any (select lower(btrim(c)) from unnest(p_candidates) c));
    if hits is not null and array_length(hits, 1) = 1 then matched_by := 'version_code_or_name'; end if;
  end if;

  -- 1.3. Модельний рік звужує неоднозначність, але НЕ створює збігу:
  -- якщо кандидатів кілька, лишаються ті, у яких є такий рік у каталозі.
  if hits is not null and array_length(hits, 1) > 1 and p_model_year is not null then
    select array_agg(distinct h) into hits from unnest(hits) h
     where exists (select 1 from mi.version_market_year y
                    where y.version_id = h and y.model_year = p_model_year);
    if hits is not null and array_length(hits, 1) = 1 then matched_by := 'alias_and_model_year'; end if;
  end if;

  if hits is null or array_length(hits, 1) is null then
    return jsonb_build_object('version_id', null, 'ambiguous', false,
      'matched_by', null, 'tried', to_jsonb(p_candidates), 'note', 'no version in the catalogue matches');
  end if;
  if array_length(hits, 1) > 1 then
    return jsonb_build_object('version_id', null, 'ambiguous', true,
      'matched_by', null, 'tried', to_jsonb(p_candidates),
      'note', format('%s versions match, context is required', array_length(hits, 1)));
  end if;
  return jsonb_build_object('version_id', hits[1], 'ambiguous', false,
    'matched_by', matched_by, 'tried', to_jsonb(p_candidates));
end $$;

-- ---------- 2. Міст: продакшн-дані у спостереження памʼяті ----------

-- Читає лише те, що Check уже зберіг, і пише лише те, що з цього
-- випливає. Ідемпотентно: той самий факт із того самого джерела не
-- дублюється.
create or replace function mi.ingest_identity_from_check(p_vin text)
returns jsonb language plpgsql as $$
declare
  v record; snap record; auc record; m jsonb;
  n_written int := 0; v_year int; cands text[]; v_market text;
  decoded_at timestamptz;
begin
  select * into v from public.vehicles where vin = p_vin;
  if not found then
    return jsonb_build_object('vin', p_vin, 'written', 0, 'note', 'no vehicle row');
  end if;
  decoded_at := coalesce(v.first_seen_at, now());

  -- 2.1. Модельний рік із декодера.
  v_year := coalesce(v.model_year, v.year);
  if v_year is not null and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'model_year'
         and o.source_kind = 'vin_decoder' and o.value_num = v_year) then
    perform mi.vm_record_identity(p_vin, 'model_year', 'vin_decoder', null, v_year, null, null,
      decoded_at, 'high', 'vin:' || p_vin, 'nhtsa', v.decoder_version, null, decoded_at);
    n_written := n_written + 1;
  end if;

  -- 2.2. Версія. Кандидати беруться з нормалізованих колонок і з декоду;
  -- жоден із них не є здогадкою, це рядки, які вже лежать у базі.
  cands := array_remove(array[
    v.trim, v.model, nullif(btrim(coalesce(v.model, '') || ' ' || coalesce(v.trim, '')), ''),
    v.nhtsa->>'Series', v.nhtsa->>'Trim', v.nhtsa->>'Model',
    nullif(btrim(coalesce(v.nhtsa->>'Model', '') || ' ' || coalesce(v.nhtsa->>'Trim', '')), '')
  ], null);
  m := mi.match_version(coalesce(v.make, v.nhtsa->>'Make'), cands, v_year);

  if (m->>'version_id') is not null and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'version' and o.source_kind = 'vin_decoder') then
    perform mi.vm_record_identity(p_vin, 'version', 'vin_decoder',
      (select version_code from mi.vehicle_version where subject_id = (m->>'version_id')::bigint),
      null, null, null, decoded_at, 'high', 'vin:' || p_vin,
      'nhtsa:' || coalesce(m->>'matched_by', 'unknown'), v.decoder_version, null, decoded_at);
    n_written := n_written + 1;
  end if;

  -- 2.3. Ринок продажу. Декодер його НЕ дає: країна складання це не
  -- ринок продажу. Єдине чесне джерело у наявних даних це аукціон:
  -- лот у США означає, що машина продавалась на ринку США.
  select * into auc from public.auction_events
   where vin = p_vin order by coalesce(sale_date, first_seen_at::date) asc limit 1;
  if found then
    v_market := case when lower(auc.auction_house) in ('copart', 'iaai', 'iaa') then 'US' else null end;
    if v_market is not null and not exists (
        select 1 from public.vehicle_identity_observation o
         where o.vin = p_vin and o.dimension = 'market_sold' and o.source_kind = 'auction') then
      perform mi.vm_record_identity(p_vin, 'market_sold', 'auction', v_market, null, null, null,
        coalesce(auc.sale_date::timestamptz, auc.first_seen_at), 'medium',
        'auction:' || auc.auction_house || ':' || auc.lot_id,
        auc.auction_house, null, null, auc.first_seen_at);
      n_written := n_written + 1;
    end if;
  end if;

  -- 2.4. Ринок експлуатації з найсвіжішого знімка оголошення.
  select * into snap from public.vehicle_snapshots
   where vin = p_vin and country is not null order by captured_at desc limit 1;
  if found and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'market_operated'
         and o.source_kind = 'listing' and o.value_text = snap.country) then
    perform mi.vm_record_identity(p_vin, 'market_operated', 'listing', snap.country, null, null, null,
      snap.captured_at, 'medium',
      'listing:' || coalesce(snap.listing_id::text, snap.source_url),
      snap.source_domain, null, snap.id, snap.captured_at);
    n_written := n_written + 1;
  end if;

  return jsonb_build_object('vin', p_vin, 'written', n_written, 'version_match', m);
end $$;

-- ---------- 3. Тіньова компіляція ----------

-- Повний прохід: міст, резолвер, компілятор. Нічого у продукті не
-- змінює і нічого у продукт не повертає: це окремий обʼєкт для
-- порівняння з тим, що показує звичайний Check.
create or replace function mi.shadow_pack(p_vin text)
returns jsonb language plpgsql as $$
declare ing jsonb; v_id bigint; ident jsonb; dec jsonb; rep jsonb;
begin
  ing := mi.ingest_identity_from_check(p_vin);
  v_id := mi.resolve_from_memory(p_vin);
  ident := mi.identity_json(v_id);

  if ident->>'vmy' is null then
    return jsonb_build_object(
      'vin', p_vin, 'mi_available', false, 'reason', 'identity_unresolved',
      'ingest', ing, 'identity_id', v_id,
      'unresolved', (select jsonb_agg(jsonb_build_object('dimension', d.dimension,
                        'status', d.resolution_status, 'note',
                        coalesce(d.conflict_note, d.provenance->>'note')))
                       from mi_vm.resolved_identity_dimension d
                      where d.identity_id = v_id
                        and d.resolution_status in ('unresolved', 'conflicted')));
  end if;

  dec := mi.request_pack(ident, 'decision');
  rep := mi.request_pack(ident, 'report');

  if not coalesce((dec->'pack'->>'fragment_available')::boolean,
                  (dec->>'fragment_available')::boolean, false) then
    return jsonb_build_object('vin', p_vin, 'mi_available', false,
      'reason', coalesce(dec->>'reason', 'fragment_unavailable'),
      'ingest', ing, 'identity_id', v_id, 'identity_summary', mi.identity_summary(ident));
  end if;

  return jsonb_build_object(
    'vin', p_vin, 'mi_available', true, 'identity_id', v_id,
    'ingest', ing,
    'identity_summary', dec->'pack'->'identity_summary',
    'coverage_statement', dec->'pack'->'coverage_statement',
    'decision', jsonb_build_object('meta', dec->'pack'->'pack_meta',
                                   'systems', dec->'pack'->'systems'),
    'report', jsonb_build_object('meta', rep->'pack'->'pack_meta',
                                 'systems', rep->'pack'->'systems'));
end $$;

-- ---------- 4. Вхід для продукту ----------

-- PostgREST віддає назовні лише схему public, тому тінь має рівно одну
-- публічну точку входу. Функція нічого не змінює у продукті і не має
-- права цього робити.
create or replace function public.mi_shadow_pack(p_vin text)
returns jsonb language sql security definer set search_path = pg_catalog, mi, mi_vm, public as $$
  select mi.shadow_pack(p_vin);
$$;
-- Клієнтські ролі Supabase функцію не бачать. Локальний стенд цих ролей
-- не має, тому відкликання робиться по наявних.
do $$
declare r text;
begin
  execute 'revoke all on function public.mi_shadow_pack(text) from public';
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.mi_shadow_pack(text) from %I', r);
    end if;
  end loop;
end $$;
