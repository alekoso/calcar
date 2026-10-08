-- Міграція 32: версія лише в межах свого модельного ряду.
--
-- Аудит блоку "Типові слабкі місця версії" (2026-10-08): Porsche Macan S 2021
-- (Check MF9sY) розвʼязався у Porsche Cayenne S 958.1. mi.match_version шукав
-- код чи назву версії по ВСЬОМУ бренду, а "S" не є унікальним у межах марки;
-- звуження за модельним роком не рятувало, бо у каталожної Cayenne S немає
-- рядків року. Один клейм про Cayenne дійшов до промпту Macan.
--
-- Інваріант: збіг версії ніколи не перетинає модельний ряд. Ієрархія
-- бренд -> ряд -> покоління -> версія: кандидат версії придатний лише коли
-- його ряд сумісний із рядом цієї машини. Без відомого ряду версія не
-- шукається взагалі: невідоме краще за хибне. Рік лишається додатковим
-- фільтром, а не заміною сумісності ряду. Часткова ідентичність у межах
-- того самого ряду (ряд відомий, версія ні) працює як і раніше.
--
-- Сумісність ряду (mi.version_model_compatible_line): токени назви ряду або
-- його аліаса рівні токенам тексту моделі ("5 Series" і "5-Series", "Model 3"),
-- або текст моделі називає саму версію ("530i" входить у "530i xDrive"): так
-- площадки, що пишуть модель як "530i", не втрачають свою версію. "Macan" не
-- входить у "Cayenne S", тому чужа версія відпадає.
--
-- Змінюються лише mi.match_version (новий необовʼязковий аргумент ряду) і
-- міст, що передає ряд. mi.match_version_text не чіпається: там кожен токен
-- тексту мусить бути пояснений мітками рівно однієї версії, тому текст сам
-- називає ряд, а два ряди з однаковою міткою дають неоднозначність, а не
-- збіг. Резолвер, схема, компілятор і gate не змінюються.

-- ---------- 1. Сумісність ряду ----------

create or replace function mi.version_model_compatible_line(p_line_id bigint, p_model text)
returns boolean language sql stable as $$
  with mt as (select mi.text_tokens(p_model) as t)
  select coalesce(array_length((select t from mt), 1), 0) > 0
     and (
       exists (select 1 from mi.model_line ml, mt where ml.subject_id = p_line_id and mi.text_tokens(ml.name) = mt.t)
       or exists (select 1 from mi.subject_alias a, mt where a.target_subject_id = p_line_id and mi.text_tokens(a.alias) = mt.t)
       -- текст моделі площадки це сама версія ряду ("530i", "M550i xDrive")
       or exists (select 1 from mi.vehicle_version vv join mi.generation g on g.subject_id = vv.generation_id, mt
                   where g.model_line_id = p_line_id and mi.research_version_usable(p_model)
                     and (mi.tokens_contain(mi.text_tokens(vv.version_code), mt.t) or mi.tokens_contain(mi.text_tokens(vv.name_en), mt.t)))
       or exists (select 1 from mi.subject_alias a join mi.vehicle_version vv on vv.subject_id = a.target_subject_id
                   join mi.generation g on g.subject_id = vv.generation_id, mt
                   where g.model_line_id = p_line_id and mi.research_version_usable(p_model) and mi.tokens_contain(mi.text_tokens(a.alias), mt.t))
     );
$$;

create or replace function mi.version_model_compatible(p_version_id bigint, p_model text)
returns boolean language sql stable as $$
  select exists (select 1 from mi.vehicle_version vv join mi.generation g on g.subject_id = vv.generation_id
                  where vv.subject_id = p_version_id and mi.version_model_compatible_line(g.model_line_id, p_model));
$$;

-- ---------- 2. Збіг декоду з каталогом: лише свій ряд ----------

drop function if exists mi.match_version(text, text[], int);

create or replace function mi.match_version(
  p_brand text, p_candidates text[], p_model_year int default null, p_model text default null)
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
  -- Міграція 32: лише версії ряду цієї машини; без ряду збігу немає.
  if coalesce(btrim(p_model), '') = '' then
    return jsonb_build_object('version_id', null, 'ambiguous', false,
      'matched_by', null, 'tried', to_jsonb(p_candidates), 'note', 'model line is required');
  end if;
  hits := nullif(array(select h from unnest(hits) h where mi.version_model_compatible(h, p_model)), '{}'::bigint[]);
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
    hits := nullif(array(select h from unnest(hits) h where mi.version_model_compatible(h, p_model)), '{}'::bigint[]);
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
      'matched_by', null, 'tried', to_jsonb(p_candidates), 'note', 'no version of this model line in the catalogue matches');
  end if;
  if array_length(hits, 1) > 1 then
    return jsonb_build_object('version_id', null, 'ambiguous', true,
      'matched_by', null, 'tried', to_jsonb(p_candidates),
      'note', format('%s versions match, context is required', array_length(hits, 1)));
  end if;
  return jsonb_build_object('version_id', hits[1], 'ambiguous', false,
    'matched_by', matched_by, 'tried', to_jsonb(p_candidates));
end $$;

-- ---------- 3. Міст (текст 025, ряд передається у збіг) ----------

create or replace function mi.ingest_identity_from_check(p_vin text)
returns jsonb language plpgsql as $$
declare
  v record; snap record; auc record; m jsonb;
  n_written int := 0; v_year int; cands text[]; v_market text;
  decoded_at timestamptz;
  rep record; rm jsonb; rep_log jsonb := '[]'::jsonb;
  plaus jsonb; year_ok boolean;
begin
  select * into v from public.vehicles where vin = p_vin;
  if not found then
    return jsonb_build_object('vin', p_vin, 'written', 0, 'note', 'no vehicle row');
  end if;
  decoded_at := coalesce(v.first_seen_at, now());

  -- 2.1. Модельний рік ЛИШЕ з декодера. `vehicles.year` пише оголошення
  -- (рік першої реєстрації або рік із заголовка), і модельним роком він
  -- не є: хибний рік прибирає кандидатні VMY і разом із ними знання.
  -- `vehicles.model_year` пише Check з ModelYear декоду NHTSA.
  v_year := coalesce(v.model_year,
    case when coalesce(v.nhtsa->>'ModelYear', '') ~ '^[0-9]{4}$'
         then (v.nhtsa->>'ModelYear')::int end);
  -- Phase 7.8: детермінований декод ще не означає безпомилковий. Рік декоду
  -- отримує силу vin_decoder лише після перевірки правдоподібності; інакше
  -- сирий доказ зберігається (джерело те саме), але одразу знятий з
  -- розвʼязання з причиною і низькою довірою. Рік оголошення модельним
  -- роком як і раніше НЕ пишеться.
  plaus := case when v_year is null then null
                else mi.decoder_model_year_plausibility(p_vin, v.nhtsa, v_year, v.year) end;
  year_ok := coalesce((plaus->>'plausible')::boolean, false);
  if v_year is not null and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'model_year'
         and o.source_kind = 'vin_decoder' and o.value_num = v_year) then
    if year_ok then
      perform mi.vm_record_identity(p_vin, 'model_year', 'vin_decoder', null, v_year, null, null,
        decoded_at, 'high', 'vin:' || p_vin, 'nhtsa', v.decoder_version, null, decoded_at);
    else
      insert into public.vehicle_identity_observation (vin, dimension, value_num, source_kind,
          source_ref, decoder_version, confidence, provenance_root, observed_at, ingested_at,
          invalidated_at, invalidated_reason)
      values (p_vin, 'model_year', v_year, 'vin_decoder', 'nhtsa', v.decoder_version, 'low',
          'vin:' || p_vin, decoded_at, decoded_at, now(),
          'rejected_for_resolution: decoder model_year implausible ('
            || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(plaus->'reasons') x), 'unknown')
            || ')');
    end if;
    n_written := n_written + 1;
  end if;

  -- 2.2. Версія. Кандидати беруться з нормалізованих колонок і з декоду;
  -- жоден із них не є здогадкою, це рядки, які вже лежать у базі.
  cands := array_remove(array[
    v.trim, v.model, nullif(btrim(coalesce(v.model, '') || ' ' || coalesce(v.trim, '')), ''),
    v.nhtsa->>'Series', v.nhtsa->>'Trim', v.nhtsa->>'Model',
    nullif(btrim(coalesce(v.nhtsa->>'Model', '') || ' ' || coalesce(v.nhtsa->>'Trim', '')), '')
  ], null);
  -- Міграція 32: версія шукається лише в межах модельного ряду цієї машини
  -- (ряд з оголошення або декодера); без ряду версії немає.
  m := mi.match_version(coalesce(v.make, v.nhtsa->>'Make'), cands, case when year_ok then v_year end,
                        coalesce(v.model, v.nhtsa->>'Model'));

  if (m->>'version_id') is not null and not exists (
      select 1 from public.vehicle_identity_observation o
       where o.vin = p_vin and o.dimension = 'version' and o.source_kind = 'vin_decoder') then
    perform mi.vm_record_identity(p_vin, 'version', 'vin_decoder',
      (select version_code from mi.vehicle_version where subject_id = (m->>'version_id')::bigint),
      null, null, null, decoded_at, 'high', 'vin:' || p_vin,
      'nhtsa:' || coalesce(m->>'matched_by', 'unknown'), v.decoder_version, null, decoded_at);
    n_written := n_written + 1;
  end if;

  -- 2.2b. Версія з розбору Check: `reports.data->vehicle->trim`. Це
  -- висновок LLM, а не декод, тому джерело окреме (`check_inference`),
  -- довіра низька, а корінь походження це конкретний звіт. Версія пишеться
  -- лише тоді, коли текст називає рівно одну версію каталогу у межах
  -- бренду і модельного ряду. Різні формулювання однієї версії дають той
  -- самий version_code і тому не конфліктують. Резолвер нічого з LLM не
  -- вирішує: він бачить лише спостереження і їхню силу.
  for rep in
    select r.id, r.created_at, r.data->'vehicle'->>'trim' as trim_text
      from public.reports r
     where r.kind = 'check' and r.data->'_meta'->>'vin' = p_vin
       and coalesce(btrim(r.data->'vehicle'->>'trim'), '') <> ''
     order by r.created_at, r.id
  loop
    rm := mi.match_version_text(coalesce(v.make, v.nhtsa->>'Make'), v.model, rep.trim_text);
    rep_log := rep_log || jsonb_build_object('report_id', rep.id, 'text', rep.trim_text, 'match', rm);
    if (rm->>'version_id') is not null and not exists (
        select 1 from public.vehicle_identity_observation o
         where o.vin = p_vin and o.dimension = 'version' and o.source_kind = 'check_inference'
           and o.provenance_root = 'report:' || rep.id::text and o.invalidated_at is null) then
      perform mi.vm_record_identity(p_vin, 'version', 'check_inference',
        (select version_code from mi.vehicle_version where subject_id = (rm->>'version_id')::bigint),
        null, null, null, rep.created_at, 'low', 'report:' || rep.id::text,
        'report:' || rep.id::text, null, null, rep.created_at);
      n_written := n_written + 1;
    end if;
  end loop;

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

  return jsonb_build_object('vin', p_vin, 'written', n_written, 'version_match', m,
    'model_year', case when year_ok then v_year end,
    'model_year_source', case when v_year is null then null else 'vin_decoder' end,
    'model_year_plausibility', plaus,
    -- Рік оголошення видно, але у памʼять як модельний рік він не йде.
    'listing_year_not_used', v.year,
    'report_versions', rep_log);
end $$;
