-- CalCar Model Intelligence, міграція 16: запис у памʼять і адаптер
-- памʼяті для резолвера ідентичності.
--
-- Аудит Phase 6 показав, що три таблиці памʼяті, створені міграцією 07,
-- не отримують жодного запису у продакшні: mi_vm.component_state_instance,
-- mi_vm.entitlement_state і mi_vm.measurement. Ця міграція не змінює їх
-- НІЯК: вона дає нормалізовані помічники запису і читання.
--
-- Разом із двома новими таблицями спостережень із
-- `supabase-vehicle-memory-v2.sql` це закриває всі три блокери аудиту.
--
-- Адаптер перетворює історію памʼяті на нормалізовані спостереження у
-- тому самому форматі, який приймає mi.resolve_identity. Семантика
-- резолвера не змінюється: він так само нічого не знає про те, звідки
-- прийшли факти.

-- ---------- 1. Запис у наявні таблиці памʼяті ----------

-- Стан компонента конкретної машини: задокументована подія (ретрофіт,
-- заміна, ремонт), яку каталог уміє назвати типом стану.
create or replace function mi.vm_record_component_state(
  p_vin text, p_state_key text, p_role text default null,
  p_occurred_on date default null, p_mileage_km integer default null,
  p_performer mi.performer default 'unknown',
  p_documents jsonb default null, p_measurements jsonb default null,
  p_confidence mi.confidence default 'medium',
  p_source_kind text default null, p_snapshot_id uuid default null)
returns bigint language plpgsql as $$
declare v_type bigint; v_id bigint;
begin
  select subject_id into v_type from mi.component_state_type where state_key = p_state_key;
  if v_type is null then raise exception 'unknown component state type %', p_state_key; end if;

  insert into mi_vm.component_state_instance (vin, state_type_id, role_code, occurred_on,
      mileage_km, performer_kind, documents, measurements, confidence, source_kind, snapshot_id)
  values (p_vin, v_type, p_role, p_occurred_on, p_mileage_km, p_performer,
          p_documents, p_measurements, p_confidence, p_source_kind, p_snapshot_id)
  returning id into v_id;
  return v_id;
end $$;

-- Стан права у часі. Ключ (vin, entitlement, checked_at) робить таблицю
-- дописувальною за конструкцією: нова перевірка це новий рядок.
create or replace function mi.vm_record_entitlement(
  p_vin text, p_entitlement_key text, p_state mi.entitlement_status,
  p_checked_at timestamptz default now(),
  p_source_kind text default null, p_note text default null)
returns bigint language plpgsql as $$
declare v_ent bigint; v_id bigint;
begin
  select subject_id into v_ent from mi.entitlement where entitlement_key = p_entitlement_key;
  if v_ent is null then raise exception 'unknown entitlement %', p_entitlement_key; end if;

  insert into mi_vm.entitlement_state (vin, entitlement_id, state, checked_at, source_kind, note)
  values (p_vin, v_ent, p_state, p_checked_at, p_source_kind, p_note)
  on conflict on constraint entitlement_state_key do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Вимірювання з методом, значенням і терміном придатності. Термін несе
-- інваріант: поточне здоровʼя не дорівнює залишковому ресурсу.
create or replace function mi.vm_record_measurement(
  p_vin text, p_method_code text, p_value jsonb, p_measured_at timestamptz,
  p_expires_at timestamptz default null, p_check_item_id bigint default null,
  p_source_kind text default null)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if not exists (select 1 from mi.test_method where code = p_method_code) then
    raise exception 'unknown test method %', p_method_code;
  end if;
  insert into mi_vm.measurement (vin, method_code, check_item_id, value,
      measured_at, expires_at, source_kind)
  values (p_vin, p_method_code, p_check_item_id, p_value, p_measured_at, p_expires_at, p_source_kind)
  returning id into v_id;
  return v_id;
end $$;

-- ---------- 2. Запис у нові таблиці спостережень ----------

create or replace function mi.vm_record_identity(
  p_vin text, p_dimension text, p_source_kind text,
  p_text text default null, p_num numeric default null,
  p_date date default null, p_bool boolean default null,
  p_observed_at timestamptz default now(),
  p_confidence text default 'high', p_provenance_root text default null,
  p_source_ref text default null, p_decoder_version text default null,
  p_snapshot_id uuid default null, p_ingested_at timestamptz default now())
returns uuid language sql as $$
  insert into public.vehicle_identity_observation (vin, dimension, value_text, value_num,
      value_date, value_bool, source_kind, source_ref, decoder_version, confidence,
      provenance_root, observed_at, ingested_at, snapshot_id)
  values (p_vin, p_dimension, p_text, p_num, p_date, p_bool, p_source_kind, p_source_ref,
      p_decoder_version, p_confidence, p_provenance_root, p_observed_at, p_ingested_at, p_snapshot_id)
  returning id;
$$;

create or replace function mi.vm_record_component(
  p_vin text, p_role text, p_kind text, p_variant_code text,
  p_source_kind text, p_observed_at timestamptz default now(),
  p_previous_variant_code text default null, p_state text default 'PRESENT',
  p_confidence text default 'high', p_provenance_root text default null,
  p_source_ref text default null, p_mileage_km integer default null,
  p_documents jsonb default null, p_snapshot_id uuid default null,
  p_ingested_at timestamptz default now())
returns uuid language sql as $$
  insert into public.component_observation (vin, role_code, observation_kind, variant_code,
      previous_variant_code, state, source_kind, source_ref, confidence, provenance_root,
      observed_at, ingested_at, snapshot_id, mileage_km, documents)
  values (p_vin, p_role, p_kind, p_variant_code, p_previous_variant_code, p_state,
      p_source_kind, p_source_ref, p_confidence, p_provenance_root,
      p_observed_at, p_ingested_at, p_snapshot_id, p_mileage_km, p_documents)
  returning id;
$$;

-- Виправлення без видалення. Рядок лишається у базі назавжди і лише
-- позначається недійсним разом із причиною.
create or replace function mi.vm_invalidate(
  p_table text, p_id uuid, p_reason text)
returns boolean language plpgsql as $$
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an invalidation must say why';
  end if;
  if p_table = 'vehicle_identity_observation' then
    update public.vehicle_identity_observation
       set invalidated_at = now(), invalidated_reason = p_reason
     where id = p_id and invalidated_at is null;
  elsif p_table = 'component_observation' then
    update public.component_observation
       set invalidated_at = now(), invalidated_reason = p_reason
     where id = p_id and invalidated_at is null;
  else
    raise exception 'unknown observation table %', p_table;
  end if;
  return found;
end $$;

-- ---------- 3. Адаптер памʼяті для резолвера ----------
--
-- Перетворює історію памʼяті на нормалізовані спостереження у форматі,
-- який приймає mi.resolve_identity. Семантика резолвера не змінюється.
--
-- Два зрізи часу, і в цьому вся суть адаптера:
--   p_as_of_event      що було істинним про машину на цей момент;
--   p_as_of_knowledge  що CalCar на цей момент уже отримав.
-- Аукціон 2021 року, знайдений у 2026, входить у зріз події 2022 року і
-- НЕ входить у зріз знання 2022 року. Обидва питання ставляться окремо.
--
-- Недійсні спостереження не читаються ніколи, але з бази не зникають.

create or replace function mi.vm_observations(
  p_vin text,
  p_as_of_event timestamptz default null,
  p_as_of_knowledge timestamptz default null)
returns jsonb language plpgsql stable as $$
declare res jsonb := '[]'::jsonb;
  ev timestamptz := coalesce(p_as_of_event, 'infinity'::timestamptz);
  kn timestamptz := coalesce(p_as_of_knowledge, 'infinity'::timestamptz);
begin
  -- 3.1. Ідентичність: дата виробництва, ринки, рік, ієрархія.
  -- Значення, що йде у резолвер як subject, шукається у каталозі за
  -- кодом; те, чого каталог не знає, лишається текстом і резолвер
  -- чесно не розвʼяже його у subject.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(o.source_ref, o.source_kind),
             'source_type', o.source_kind,
             'dimension', o.dimension,
             'slot', 'na',
             'observed_at', o.observed_at::date,
             'confidence', coalesce(o.confidence, 'medium'),
             'provenance_root', o.provenance_root,
             'value_subject', case o.dimension
               when 'version' then (select subject_id from mi.vehicle_version where version_code = o.value_text)
               when 'generation' then (select subject_id from mi.generation where platform_code = o.value_text and phase = 'base')
               else null end,
             'value_text', case when o.dimension in ('version', 'generation') then null else o.value_text end,
             'value_num', o.value_num,
             'value_date', o.value_date,
             'value_bool', o.value_bool))
             order by o.observed_at, o.id)
      from public.vehicle_identity_observation o
     where o.vin = p_vin and o.invalidated_at is null
       and o.observed_at <= ev and o.ingested_at <= kn), '[]'::jsonb);

  -- 3.2. Компоненти. Заводське спостереження лягає у слот factory,
  -- поточне і заміна у слот current. Заводський рядок при заміні НЕ
  -- зникає: це два різні спостереження, і обидва доходять до резолвера.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(c.source_ref, c.source_kind),
             'source_type', c.source_kind,
             'dimension', 'component_variant',
             'role', c.role_code,
             'slot', case when c.observation_kind = 'factory' then 'factory' else 'current' end,
             'observed_at', c.observed_at::date,
             'confidence', coalesce(c.confidence, 'medium'),
             'provenance_root', c.provenance_root,
             'value_subject', (select subject_id from mi.component_variant where variant_code = c.variant_code)))
             order by c.observed_at, c.id)
      from public.component_observation c
     where c.vin = p_vin and c.invalidated_at is null
       and c.state = 'PRESENT' and c.variant_code is not null
       and c.observed_at <= ev and c.ingested_at <= kn), '[]'::jsonb);

  -- 3.3. Задокументовані події заміни з mi_vm: тип стану знає, який
  -- варіант лишається після нього, і саме він іде у поточний слот.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(s.source_kind, 'vehicle_memory'),
             'source_type', 'vehicle_memory',
             'dimension', 'component_variant',
             'role', coalesce(s.role_code, cr.code),
             'slot', 'current',
             'observed_at', s.occurred_on,
             'confidence', s.confidence::text,
             'provenance_root', 'vm_state:' || s.id::text,
             'value_subject', st.resulting_variant_id))
             order by s.occurred_on nulls last, s.id)
      from mi_vm.component_state_instance s
      join mi.component_state_type st on st.subject_id = s.state_type_id
      left join mi.component_role cr on cr.code = s.role_code
     where s.vin = p_vin and st.resulting_variant_id is not null
       and coalesce(s.occurred_on::timestamptz, s.created_at) <= ev
       and s.created_at <= kn), '[]'::jsonb);

  -- 3.4. Сам факт стану як стан: резолвер уміє його прийняти окремо.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(s.source_kind, 'vehicle_memory'),
             'source_type', 'vehicle_memory',
             'dimension', 'component_state_present',
             'slot', 'na',
             'observed_at', s.occurred_on,
             'confidence', s.confidence::text,
             'provenance_root', 'vm_state:' || s.id::text,
             'value_subject', s.state_type_id,
             'value_bool', true))
             order by s.id)
      from mi_vm.component_state_instance s
     where s.vin = p_vin
       and coalesce(s.occurred_on::timestamptz, s.created_at) <= ev
       and s.created_at <= kn), '[]'::jsonb);

  -- 3.5. Права. Береться найсвіжіша перевірка кожного права у межах
  -- обраних зрізів: право це стан, а не подія, і історія лежить поруч.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', coalesce(e.source_kind, 'manufacturer'),
             'source_type', coalesce(e.source_kind, 'manufacturer'),
             'dimension', 'entitlement_state',
             'slot', 'na',
             'observed_at', e.checked_at::date,
             'confidence', 'high',
             'provenance_root', 'vm_entitlement:' || e.entitlement_id::text,
             'value_subject', e.entitlement_id,
             'value_text', e.state::text))
             order by e.entitlement_id)
      from (select distinct on (entitlement_id) * from mi_vm.entitlement_state
             where vin = p_vin and checked_at <= ev and checked_at <= kn
             order by entitlement_id, checked_at desc) e), '[]'::jsonb);

  -- 3.6. Пробіг і ринок експлуатації з історії оголошень і аукціонів.
  -- Знімок несе час знання у captured_at; дати публікації оголошення у
  -- памʼяті немає, тому для нього обидва зрізи це captured_at.
  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', 'snapshot:' || v.id::text,
             'source_type', 'listing',
             'dimension', 'mileage_km',
             'slot', 'na',
             'observed_at', v.captured_at::date,
             'confidence', 'medium',
             'provenance_root', 'listing:' || coalesce(v.listing_id::text, v.source_url),
             'value_num', v.odometer_km))
             order by v.captured_at desc)
      from (select * from public.vehicle_snapshots
             where vin = p_vin and odometer_km is not null
               and captured_at <= ev and captured_at <= kn
             order by captured_at desc limit 1) v), '[]'::jsonb);

  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', 'auction:' || a.auction_house || ':' || a.lot_id,
             'source_type', 'auction',
             'dimension', 'mileage_km',
             'slot', 'na',
             'observed_at', a.sale_date,
             'confidence', case a.odometer_status when 'actual' then 'high' else 'low' end,
             'provenance_root', 'auction:' || a.auction_house || ':' || a.lot_id,
             'value_num', case when a.odometer_unit = 'mi'
                               then round(a.odometer_value * 1.609344)
                               else a.odometer_value end))
             order by a.sale_date desc)
      from public.auction_events a
     where a.vin = p_vin and a.odometer_value is not null
       and coalesce(a.sale_date::timestamptz, a.first_seen_at) <= ev
       and a.first_seen_at <= kn), '[]'::jsonb);

  res := res || coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'source', 'auction:' || a.auction_house || ':' || a.lot_id,
             'source_type', 'auction',
             'dimension', 'salvage_status',
             'slot', 'na',
             'observed_at', a.sale_date,
             'confidence', 'high',
             'provenance_root', 'auction:' || a.auction_house || ':' || a.lot_id,
             'value_bool', true))
             order by a.sale_date desc)
      from public.auction_events a
     where a.vin = p_vin and a.title_status is not null
       and a.title_status ~* 'salvage|junk|rebuilt'
       and coalesce(a.sale_date::timestamptz, a.first_seen_at) <= ev
       and a.first_seen_at <= kn), '[]'::jsonb);

  return res;
end $$;

-- Зручний вхід: памʼять -> резолвер -> розвʼязана ідентичність.
create or replace function mi.resolve_from_memory(
  p_vin text,
  p_as_of_event timestamptz default null,
  p_as_of_knowledge timestamptz default null)
returns bigint language sql as $$
  select mi.resolve_identity(p_vin, mi.vm_observations(p_vin, p_as_of_event, p_as_of_knowledge));
$$;
