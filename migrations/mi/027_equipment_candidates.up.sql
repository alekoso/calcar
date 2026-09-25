-- Міграція 27: кандидати обладнання для точного авто (Equipment v1).
--
-- Ланцюжок: розвʼязана ідентичність -> каталог обладнання бренду і його
-- доступність на версії x ринку x році -> equipment_candidates[] -> Check
-- шукає саме ці опції у даних VIN, полях і тексті оголошення та на кадрах
-- -> результат про конкретне авто -> наявний блок комплектації.
--
-- Інваріант: ДОСТУПНІСТЬ НЕ Є НАЯВНІСТЮ. Кандидат каже лише, що опцію
-- можна було замовити. Наявність на конкретному VIN стверджує тільки
-- доказ про саме це авто, і лише він потрапляє у Vehicle Memory.
--
-- Що додається (усе аддитивно, наявні дані не переписуються):
-- 1. mi.equipment_item.value_tier: детермінована позначка цінності опції
--    (standard, notable, high_value). Порожня означає, що опцію ще ніхто
--    не класифікував, і Check шукати її цілеспрямовано не буде.
-- 2. mi.equipment_availability.package_ids: у яких пакетах опція доступна
--    на ЦЬОМУ VMY. Глобальний mi.package_content для цього не годиться:
--    склад пакета з тим самим кодом різниться між роками і ринками. Окремої
--    таблиці немає свідомо: склад схеми зафіксовано міграцією 009 (52
--    таблиці), а цілісність посилань тримає тригер: лише пакети того
--    самого бренду.
-- 3. mi.equipment_item_by_ref, mi.equipment_candidates: кандидати за
--    ідентичністю. Точний VMY дає кандидатів цього VMY; без VMY, але з
--    версією, кандидати беруться по mi.partial_candidates і там, де опція
--    є не на всіх кандидатних VMY, мають applicability conditional
--    (UNKNOWN -> CONDITIONAL). Відомий рік поза роками версії
--    (mi.version_year_exclusion), відомий ринок чи дата виробництва поза
--    вікном і підтверджена відсутність опції дають порожньо або
--    виключення (KNOWN contradiction -> NO_MATCH). not_available не
--    повертається ніколи.
-- 4. mi.compile_pack: ключ equipment_candidates у пакеті. Текст функції
--    дослівно з 026, доповнений лише позначеним місцем.
-- 5. mi.vm_observations: спостереження обладнання з
--    public.vehicle_identity_observation (value_text = 'бренд:ключ')
--    ідуть у слот current із subject предмета. Текст дослівно з 016.
-- 6. mi.resolve_identity: ключ групування обладнання включає предмет.
--    Текст дослівно з 024.
-- 7. Входи для продукту (лише service_role, як mi_shadow_pack):
--    public.mi_equipment_candidates(vin) і public.mi_record_equipment(vin,
--    спостереження). Запис приймає лише equipment_present від джерел,
--    здатних бачити конкретне авто (build_sheet, current_vision), лише для
--    предмета з каталогу і ідемпотентно за коренем походження. Відсутність
--    через цей вхід не записується ніколи.

-- ---------- 1. Цінність опції ----------

alter table mi.equipment_item add column if not exists value_tier text;
do $$ begin
  alter table mi.equipment_item add constraint equipment_item_value_tier_ck
    check (value_tier is null or value_tier in ('standard', 'notable', 'high_value'));
exception when duplicate_object then null; end $$;

comment on column mi.equipment_item.value_tier is
  'Цінність опції для покупця: standard, notable, high_value. Порожньо: не класифіковано, цілеспрямовано не шукається.';

-- ---------- 2. Пакет на конкретному VMY ----------

alter table mi.equipment_availability add column if not exists package_ids bigint[] not null default '{}';

comment on column mi.equipment_availability.package_ids is
  'Пакети (equipment_item з item_kind package того самого бренду), у складі яких опція доступна на цьому рядку доступності. Доповнює requires_item_id: той означає обовʼязкове замовлення іншої позиції.';

create or replace function mi.equipment_availability_packages_ck()
returns trigger language plpgsql as $$
begin
  if cardinality(new.package_ids) > 0 and exists (
      select 1 from unnest(new.package_ids) p
       where not exists (
         select 1 from mi.equipment_item k
           join mi.equipment_item i on i.subject_id = new.item_id
          where k.subject_id = p and k.item_kind = 'package'
            and k.brand_id = i.brand_id and k.subject_id <> i.subject_id)) then
    raise exception 'equipment_availability %: package_ids must reference package items of the same brand', new.id;
  end if;
  return new;
end $$;

drop trigger if exists equipment_availability_packages_ck on mi.equipment_availability;
create trigger equipment_availability_packages_ck before insert or update of package_ids, item_id
  on mi.equipment_availability for each row execute function mi.equipment_availability_packages_ck();

-- ---------- 3. Кандидати ----------

-- Посилання на предмет у Vehicle Memory: 'бренд:ключ', бо ідентичність
-- предмета це (brand_id, equipment_key), а не OEM-код.
create or replace function mi.equipment_item_by_ref(p_ref text)
returns bigint language sql stable as $$
  select i.subject_id
    from mi.equipment_item i join mi.brand b on b.subject_id = i.brand_id
   where lower(b.name) || ':' || i.equipment_key = lower(btrim(coalesce(p_ref, '')));
$$;

create or replace function mi.equipment_candidates(p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare v_vmys bigint[]; v_scope text; v_prod date;
begin
  if p_identity->>'vmy' is not null then
    v_vmys := array[(p_identity->>'vmy')::bigint];
    v_scope := 'exact';
  elsif p_identity->>'version' is not null then
    -- Відомий рік, якого у версії немає, суперечить версії: кандидатів немає.
    if mi.version_year_exclusion(p_identity) is not null then
      return '[]'::jsonb;
    end if;
    v_vmys := mi.partial_candidates(p_identity);
    v_scope := 'candidate';
  else
    return '[]'::jsonb;
  end if;
  if coalesce(array_length(v_vmys, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;
  v_prod := (p_identity->>'production_date')::date;

  return coalesce((
    with av as (
      select a.*,
             -- Вікно виробництва, яке неможливо звірити: дата авто невідома
             -- при відомій межі, або сама межа невідома.
             ((v_prod is null and (a.sop_from_kind = 'known' or a.sop_to_kind = 'known'))
              or a.sop_from_kind = 'unknown' or a.sop_to_kind = 'unknown') as cond
        from mi.equipment_availability a
       where a.vmy_id = any (v_vmys)
         and a.availability <> 'not_available'
         -- Відома дата виробництва поза відомим вікном: NO_MATCH.
         and (v_prod is null
              or ((a.sop_from_kind <> 'known' or v_prod >= a.sop_from)
                  and (a.sop_to_kind <> 'known' or v_prod <= a.sop_to)))
    ),
    per_item as (
      select av.item_id,
             array_agg(distinct av.vmy_id order by av.vmy_id) as vmys,
             array_agg(distinct av.availability::text order by av.availability::text) as avails,
             bool_or(av.cond) as any_cond,
             array_agg(distinct av.requires_item_id) filter (where av.requires_item_id is not null) as req,
             array_agg(distinct av.source_id) filter (where av.source_id is not null) as srcs
        from av group by av.item_id
    ),
    ident as (
      select (e->>'item')::bigint as item,
             bool_or((e->>'present')::boolean) filter (where e->>'status' = 'confirmed') as present_confirmed,
             bool_or(not (e->>'present')::boolean) filter (where e->>'status' = 'confirmed') as absent_confirmed,
             bool_or(e->>'status' = 'conflicted') as conflicted
        from jsonb_array_elements(coalesce(p_identity->'equipment', '[]'::jsonb)) e
       where e->>'item' is not null
       group by 1
    )
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'item_id', i.subject_id,
             'equipment_key', i.equipment_key,
             'vm_ref', lower(b.name) || ':' || i.equipment_key,
             'brand', b.name,
             'name_en', i.name_en,
             'item_kind', i.item_kind,
             'oem_code', i.oem_code,
             'value_tier', i.value_tier,
             'availability', case when array_length(p.avails, 1) = 1 then p.avails[1] else 'varies' end,
             'applicability', case
               when p.any_cond then 'conditional'
               when v_scope = 'exact' then 'applicable'
               when array_length(p.vmys, 1) = array_length(v_vmys, 1) then 'applicable'
               else 'conditional' end,
             'scope', v_scope,
             'vmy_ids', to_jsonb(p.vmys),
             'packages', (select jsonb_agg(jsonb_build_object('equipment_key', k.equipment_key,
                                   'oem_code', k.oem_code, 'name_en', k.name_en) order by k.equipment_key)
                            from mi.equipment_item k
                           where k.subject_id in (select x from av a2, unnest(a2.package_ids) x
                                                   where a2.item_id = p.item_id)),
             'requires', (select jsonb_agg(jsonb_build_object('equipment_key', k.equipment_key,
                                   'oem_code', k.oem_code, 'name_en', k.name_en) order by k.equipment_key)
                            from mi.equipment_item k where k.subject_id = any (p.req)),
             'aliases', (select jsonb_agg(jsonb_build_object('alias', s.alias, 'lang', s.lang,
                                  'kind', s.alias_kind) order by s.alias_kind, s.alias)
                           from mi.subject_alias s where s.target_subject_id = i.subject_id),
             'visual_cues', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('cue_key', h.cue_key,
                                      'specificity', h.specificity, 'description_en', h.description_en,
                                      'negative_note_en', h.negative_note_en)) order by h.cue_key)
                               from mi.equipment_visual_hint h where h.equipment_id = i.subject_id),
             -- Стан предмета в ідентичності саме цього авто, якщо він є.
             'identity', case
               when idn.conflicted then jsonb_build_object('status', 'conflicted')
               when idn.present_confirmed then jsonb_build_object('present', true, 'status', 'confirmed')
               else null end,
             'sources', (select jsonb_agg(jsonb_build_object('source_id', s.id, 'title', s.title,
                                  'url', s.url) order by s.id)
                           from mi.source s where s.id = any (p.srcs))))
           order by case i.value_tier when 'high_value' then 1 when 'notable' then 2
                                      when 'standard' then 3 else 4 end,
                    i.equipment_key)
      from per_item p
      join mi.equipment_item i on i.subject_id = p.item_id
      join mi.brand b on b.subject_id = i.brand_id
      left join ident idn on idn.item = p.item_id
     -- Підтверджена відсутність саме на цьому авто: NO_MATCH.
     where not coalesce(idn.absent_confirmed and not idn.present_confirmed, false)
  ), '[]'::jsonb);
end $$;

-- ---------- 4. Компіляція (джерело: 026) ----------

create or replace function mi.compile_pack(
  p_identity jsonb, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns jsonb language plpgsql as $$
declare
  v_vmy bigint; frag mi.pack_fragment%rowtype; cfg jsonb;
  v_log jsonb := '[]'::jsonb; v_pack jsonb;
  n_total int; n_kept int; n_elig int; n_cap int; n_status_out int; n_merged int;
  v_partial jsonb; v_excl jsonb;
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
    -- Міграція 26: відомий модельний рік, якого немає серед років версії,
    -- суперечить самій версії. Застосовність версії NO_MATCH, частковий
    -- пакет цієї версії не будується. Невідомий рік нічого не виключає.
    v_excl := mi.version_year_exclusion(p_identity);
    if v_excl is not null then
      return v_excl;
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
    'comparisons', mi.pack_bucket(null, 'comparison'),
    -- Міграція 27: обладнання, яке ЦЯ ідентичність МОГЛА отримати з
    -- заводу. Це доступність, а не наявність: список лише каже Check, що
    -- шукати у даних конкретного авто. Рахується наживо з каталогу, тому
    -- фрагмент і версія компілятора не змінюються.
    'equipment_candidates', mi.equipment_candidates(p_identity)
  ) into v_pack;

  return jsonb_build_object('pack', v_pack, 'applicability_log', v_log);
end $$;

-- ---------- 5. Адаптер Vehicle Memory (джерело: 016) ----------

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
             -- Міграція 27: обладнання живе у поточному слоті, як і в
             -- резолвері (current_hardware).
             'slot', case when o.dimension in ('equipment_present', 'equipment_absent')
                          then 'current' else 'na' end,
             'observed_at', o.observed_at::date,
             'confidence', coalesce(o.confidence, 'medium'),
             'provenance_root', o.provenance_root,
             'value_subject', case o.dimension
               when 'version' then (select subject_id from mi.vehicle_version where version_code = o.value_text)
               when 'generation' then (select subject_id from mi.generation where platform_code = o.value_text and phase = 'base')
               when 'equipment_present' then mi.equipment_item_by_ref(o.value_text)
               when 'equipment_absent' then mi.equipment_item_by_ref(o.value_text)
               else null end,
             'value_text', case when o.dimension in ('version', 'generation', 'equipment_present', 'equipment_absent')
                                then null else o.value_text end,
             'value_num', o.value_num,
             'value_date', o.value_date,
             'value_bool', o.value_bool))
             order by o.observed_at, o.id)
      from public.vehicle_identity_observation o
     where o.vin = p_vin and o.invalidated_at is null
       and o.observed_at <= ev and o.ingested_at <= kn
       -- Міграція 27: обладнання, якого каталог не знає, не доходить до
       -- резолвера: без subject воно не має що розвʼязувати.
       and (o.dimension not in ('equipment_present', 'equipment_absent')
            or mi.equipment_item_by_ref(o.value_text) is not null)), '[]'::jsonb);

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

-- ---------- 6. Резолвер (джерело: 024) ----------

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
  delete from tmp_obs where true;
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
  -- Міграція 27: для обладнання ключ включає сам предмет. Інакше кілька
  -- різних опцій одного авто падали б в одну групу і резолвер бачив би
  -- розбіжність там, де її немає.
  for r in
    select o->>'dimension' as dim,
           o->>'role' as role,
           coalesce(o->>'slot', 'na') as slot,
           case when o->>'dimension' in ('equipment_present', 'equipment_absent')
                then o->>'value_subject' end as item,
           jsonb_agg(o) as obs
      from tmp_obs where not amb and o->>'dimension' is not null
     group by 1, 2, 3, 4
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

-- ---------- 7. Входи для продукту ----------

-- Кандидати для конкретного VIN. Спершу дешева перевірка, чи бренд авто
-- взагалі має класифіковане обладнання: якщо ні, міст у Vehicle Memory не
-- запускається і нічого не пишеться. Далі той самий шлях, що в
-- mi.shadow_pack: міст -> резолвер -> ідентичність -> кандидати.
create or replace function mi.equipment_candidates_for_vin(p_vin text)
returns jsonb language plpgsql as $$
declare v_vin text; v_make text; v_brand bigint; ing jsonb; v_id bigint; ident jsonb; c jsonb;
begin
  v_vin := upper(btrim(coalesce(p_vin, '')));
  if length(v_vin) < 11 then
    return jsonb_build_object('available', false, 'reason', 'no_vin', 'candidates', '[]'::jsonb);
  end if;
  select coalesce(nullif(btrim(v.make), ''), v.nhtsa->>'Make') into v_make
    from public.vehicles v where v.vin = v_vin;
  if v_make is null then
    return jsonb_build_object('available', false, 'reason', 'vehicle_not_decoded', 'candidates', '[]'::jsonb);
  end if;
  select b.subject_id into v_brand from mi.brand b where lower(b.name) = lower(btrim(v_make));
  if v_brand is null or not exists (
      select 1 from mi.equipment_item i
        join mi.equipment_availability a on a.item_id = i.subject_id
       where i.brand_id = v_brand and i.value_tier is not null) then
    return jsonb_build_object('available', false, 'reason', 'no_equipment_catalog', 'candidates', '[]'::jsonb);
  end if;

  ing := mi.ingest_identity_from_check(v_vin);
  v_id := mi.resolve_from_memory(v_vin);
  ident := mi.identity_json(v_id);

  if ident->>'version' is null then
    return jsonb_build_object('available', false, 'reason', 'version_not_identified',
      'identity_id', v_id, 'identity_summary', mi.identity_summary(ident), 'candidates', '[]'::jsonb);
  end if;
  if mi.version_year_exclusion(ident) is not null then
    return jsonb_build_object('available', false, 'reason', 'version_excluded_by_model_year',
      'identity_id', v_id, 'identity_summary', mi.identity_summary(ident), 'candidates', '[]'::jsonb);
  end if;

  c := mi.equipment_candidates(ident);
  return jsonb_strip_nulls(jsonb_build_object(
    'available', jsonb_array_length(c) > 0,
    'reason', case when jsonb_array_length(c) = 0 then 'no_candidates' end,
    'identity_id', v_id,
    'identity_precision', case when ident->>'vmy' is not null then 'exact' else 'partial' end,
    'identity_summary', mi.identity_summary(ident))) || jsonb_build_object('candidates', c);
end $$;

-- Запис підтвердженого обладнання конкретного авто. Лише equipment_present,
-- лише предмет каталогу, лише джерело, яке бачить саме це авто. Повторний
-- виклик з тим самим коренем походження нічого не пише.
create or replace function mi.record_equipment(p_vin text, p_observations jsonb)
returns jsonb language plpgsql as $$
declare v_vin text; o jsonb; v_ref text; v_conf text;
  n_written int := 0; n_skipped int := 0; n_rejected int := 0;
begin
  v_vin := upper(btrim(coalesce(p_vin, '')));
  if length(v_vin) < 11 then
    return jsonb_build_object('written', 0, 'skipped', 0, 'rejected', 0, 'reason', 'no_vin');
  end if;
  for o in select e from jsonb_array_elements(
             case when jsonb_typeof(p_observations) = 'array' then p_observations else '[]'::jsonb end) e loop
    v_ref := lower(btrim(coalesce(o->>'vm_ref', '')));
    if mi.equipment_item_by_ref(v_ref) is null
       or coalesce(o->>'source_kind', '') not in ('build_sheet', 'current_vision')
       or coalesce(btrim(o->>'provenance_root'), '') = '' then
      n_rejected := n_rejected + 1;
      continue;
    end if;
    if exists (select 1 from public.vehicle_identity_observation x
                where x.vin = v_vin and x.dimension = 'equipment_present'
                  and x.value_text = v_ref and x.source_kind = o->>'source_kind'
                  and x.provenance_root = o->>'provenance_root'
                  and x.invalidated_at is null) then
      n_skipped := n_skipped + 1;
      continue;
    end if;
    v_conf := case when o->>'confidence' in ('high', 'medium', 'low') then o->>'confidence' else 'medium' end;
    perform mi.vm_record_identity(v_vin, 'equipment_present', o->>'source_kind', v_ref,
      null, null, true, coalesce((o->>'observed_at')::timestamptz, now()), v_conf,
      o->>'provenance_root', left(o->>'source_ref', 200));
    n_written := n_written + 1;
  end loop;
  return jsonb_build_object('written', n_written, 'skipped', n_skipped, 'rejected', n_rejected);
end $$;

create or replace function public.mi_equipment_candidates(p_vin text)
returns jsonb language sql security definer set search_path = pg_catalog, mi, mi_vm, public as $$
  select mi.equipment_candidates_for_vin(p_vin);
$$;

create or replace function public.mi_record_equipment(p_vin text, p_observations jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, mi, mi_vm, public as $$
  select mi.record_equipment(p_vin, p_observations);
$$;

-- Клієнтські ролі Supabase функцій не бачать, як і mi_shadow_pack.
do $$
declare r text; f text;
begin
  foreach f in array array['public.mi_equipment_candidates(text)',
                           'public.mi_record_equipment(text, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
end $$;
