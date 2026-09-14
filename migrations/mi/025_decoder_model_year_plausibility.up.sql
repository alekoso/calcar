-- Міграція 25: правдоподібність модельного року з декодера VIN.
--
-- Проблема з продакшну. Міст писав рік декоду NHTSA як vin_decoder з
-- довірою high і рангом 100 без жодної перевірки. Декод детермінований,
-- але не безпомилковий:
--   KMHS281HGMU335923  Hyundai Santa Fe, оголошення 2020, декод 1991;
--   WDC2923241A051752  Mercedes C292, оголошення 2016, декод 2001;
--   WDC1668241B066322  Mercedes, оголошення 2017, декод 2001;
--   VF1JZ03BH55430159  Renault, оголошення 2016, декод 2005;
--   VF1RFD00465022722  Renault Talisman, оголошення 2021, декод 2006;
--   VF3LBYHZRJS241569  Peugeot 308, оголошення 2018, декод 1988.
-- Жоден із них не має моделі в декоді. Код року на 10-й позиції циклічний
-- (30 років), а правило вибору циклу через 7-му позицію обовʼязкове лише для
-- VIN північноамериканського ринку; частина європейських виробників (ECE
-- VIN Mercedes, Renault) року на 10-й позиції не кодує взагалі.
--
-- Правило (мінімальне, без загального фреймворку декодерів):
--   * повний декод (є і марка, і модель): NHTSA знайшла шаблон VIN цього
--     виробника; перевіряється лише діапазон року;
--   * частковий декод: рік має збігатися з кодом 10-ї позиції; для не
--     північноамериканського VIN вибір старішого циклу при допустимому
--     новішому неправдоподібний; рік оголошення, що відстоїть на 5+ років,
--     знімає повноважність саме з неперевіреного часткового декоду.
-- Рік оголошення тут лише слабкий сигнал: модельним роком він не стає ніколи
-- і повний декод не перебиває.
--
-- Неправдоподібний рік пишеться тим самим джерелом vin_decoder, з довірою low
-- і одразу знятий з розвʼязання через invalidated_at з причиною. Це вже
-- наявний механізм: адаптер памʼяті недійсне не читає, рядок лишається для
-- аудиту, сирий декод лишається у vehicles.nhtsa. Нових видів джерела і
-- статусу conflicted немає: одиничний абсурдний рік без другого джерела це
-- відхилений доказ, а не конфлікт.
--
-- Решта mi.ingest_identity_from_check побайтово з міграції 023, крім двох
-- місць: запис року декоду і звуження версії роком (лише правдоподібним).

-- ---------- 1. Коди року на 10-й позиції VIN ----------

-- Кожен код відповідає двом рокам із різницею 30: A = 1980 або 2010, ...,
-- Y = 2000 або 2030, 1 = 2001 або 2031, ..., 9 = 2009 або 2039.
-- I, O, Q, U, Z і 0 кодами року не є: результат null.
create or replace function mi.vin_year_code_years(p_code text)
returns int[] language sql immutable as $$
  select case
    when p_code is null or length(p_code) <> 1 then null
    when position(upper(p_code) in 'ABCDEFGHJKLMNPRSTVWXY123456789') = 0 then null
    else array[1979 + position(upper(p_code) in 'ABCDEFGHJKLMNPRSTVWXY123456789'),
               2009 + position(upper(p_code) in 'ABCDEFGHJKLMNPRSTVWXY123456789')] end;
$$;

-- ---------- 2. Правдоподібність року декоду ----------

create or replace function mi.decoder_model_year_plausibility(
  p_vin text, p_nhtsa jsonb, p_year int, p_listing_year int default null)
returns jsonb language plpgsql stable as $$
declare
  reasons text[] := '{}';
  v text := upper(btrim(coalesce(p_vin, '')));
  full_decode boolean := coalesce(btrim(p_nhtsa->>'Make'), '') <> ''
                     and coalesce(btrim(p_nhtsa->>'Model'), '') <> '';
  na boolean := substr(v, 1, 1) ~ '^[1-5]$';
  cyc int[] := mi.vin_year_code_years(substr(v, 10, 1));
  max_year int := extract(year from now())::int + 1;
begin
  if p_year is null then
    return jsonb_build_object('plausible', false, 'reasons', jsonb_build_array('no_decoded_year'));
  end if;
  if p_year < 1981 or p_year > max_year then
    reasons := array_append(reasons, 'year_out_of_range');
  end if;
  -- Без сирого декоду перевіряти нічого: у продакшні такого рядка немає
  -- (model_year пише лише Check з ModelYear декоду).
  if p_nhtsa is not null and not full_decode then
    if cyc is null then
      reasons := array_append(reasons, 'year_code_not_applicable_at_position_10');
    elsif p_year <> all (cyc) then
      reasons := array_append(reasons, 'year_not_encoded_at_position_10');
    elsif not na and p_year = cyc[1] and cyc[2] <= max_year then
      reasons := array_append(reasons, 'older_year_code_cycle_chosen');
    end if;
    if p_listing_year is not null and abs(p_listing_year - p_year) >= 5 then
      reasons := array_append(reasons, 'listing_year_far_from_partial_decode');
    end if;
  end if;
  return jsonb_build_object('plausible', cardinality(reasons) = 0, 'reasons', to_jsonb(reasons),
    'full_decode', full_decode, 'north_american_vin', na, 'year_code_years', to_jsonb(cyc));
end $$;

-- ---------- 3. Міст ----------

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
  m := mi.match_version(coalesce(v.make, v.nhtsa->>'Make'), cands, case when year_ok then v_year end);

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
