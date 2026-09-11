-- CalCar Model Intelligence, міграція 10: життєвий цикл знання.
--
-- Phase 2. Схема даних НЕ змінюється: нових таблиць, типів і колонок тут
-- немає. Додаються лише функції, сторожі і тригери.
--
-- Що реалізовано:
--   1) допоміжні функції нормалізації і підпису застосовності;
--   2) перерахунок повторюваності доказів і зведення по доказах;
--   3) централізований механізм ревізій знання: affected_subjects
--      і touch_subjects, плюс інвалідація фрагментів;
--   4) сторожі публікації: канонічні клейми не створюються в обхід
--      функції публікації;
--   5) перевірка якості mi.check_gate;
--   6) атомарна публікація mi.publish_candidate із дедуплікацією,
--      злиттям і успадкуванням (supersession).
--
-- Чого тут НЕМАЄ свідомо: компілятора пакетів, резолвера ідентичності,
-- перенесення старих каталогів, заливки еталонних даних.

-- ---------- 1. Нормалізація ----------

-- Канонічний текст твердження без значень: числа порівнюються структурно
-- через value_kind і structured_value, тому з тексту вони прибираються.
create or replace function mi.normalize_assertion(p_text text)
returns text language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alpha:]]+', ' ', 'g'));
$$;

-- Канонічний підпис застосовності: стабільний рядок із упорядкованих
-- предикатів. Той самий підпис обчислюється і з пропозиції кандидата,
-- і з рядків mi.claim_applicability.
create or replace function mi.applicability_signature(p_pred jsonb)
returns text language sql immutable as $$
  select coalesce(string_agg(sig, '|' order by sig), '')
  from (
    select concat_ws(':',
      coalesce(e->>'group_no', '1'),
      e->>'dimension',
      e->>'operator',
      coalesce(e->>'config_scope', 'current'),
      coalesce(e->>'ref_subject_id', ''),
      coalesce(e->>'include_revisions', 'false'),
      coalesce(e->>'attr_key', ''), coalesce(e->>'attr_value', ''),
      coalesce(e->>'tag', ''),
      coalesce(e->>'value_date_from', ''), coalesce(e->>'value_date_to', ''),
      coalesce(e->>'value_num_from', ''), coalesce(e->>'value_num_to', ''),
      coalesce(e->>'value_from_kind', ''), coalesce(e->>'value_to_kind', '')) as sig
    from jsonb_array_elements(coalesce(p_pred, '[]'::jsonb)) e
  ) t;
$$;

create or replace function mi.claim_applicability_signature(p_claim_id bigint)
returns text language sql stable as $$
  select coalesce(string_agg(sig, '|' order by sig), '')
  from (
    select concat_ws(':',
      a.group_no::text, a.dimension::text, a.operator::text, a.config_scope::text,
      coalesce(a.ref_subject_id::text, ''), a.include_revisions::text,
      coalesce(a.attr_key, ''), coalesce(a.attr_value, ''), coalesce(a.tag, ''),
      coalesce(a.value_date_from::text, ''), coalesce(a.value_date_to::text, ''),
      coalesce(a.value_num_from::text, ''), coalesce(a.value_num_to::text, ''),
      coalesce(a.value_from_kind::text, ''), coalesce(a.value_to_kind::text, '')) as sig
    from mi.claim_applicability a where a.claim_id = p_claim_id
  ) t;
$$;

-- Ключ дедуплікації. Тип знання і шар входять у ключ свідомо: official,
-- specialist і owner НЕ зливаються через схожий текст.
create or replace function mi.dedup_key(
  p_subject_id bigint, p_type mi.knowledge_type, p_layer mi.practice_layer,
  p_signature text, p_assertion text, p_value_kind mi.value_kind)
returns text language sql immutable as $$
  select md5(concat_ws('~', p_subject_id::text, p_type::text,
                       coalesce(p_layer::text, ''), coalesce(p_signature, ''),
                       mi.normalize_assertion(p_assertion),
                       coalesce(p_value_kind::text, '')));
$$;

-- ---------- 2. Цілі поширення знання ----------

-- exact дає лише сам subject. descendants і family_context додають
-- нащадків: варіанти родини або ревізії варіанта. Забуте виключення
-- нічого не поширює: поширення вмикається лише явно.
create or replace function mi.propagation_targets(p_subject_id bigint, p_prop mi.propagation)
returns bigint[] language plpgsql stable as $$
declare ids bigint[] := array[p_subject_id]; k mi.subject_kind; extra bigint[];
begin
  if p_subject_id is null then return '{}'; end if;
  if p_prop = 'exact' then return ids; end if;
  select kind into k from mi.knowledge_subject where id = p_subject_id;

  if k = 'component_family' then
    select coalesce(array_agg(subject_id), '{}') into extra
      from mi.component_variant where family_id = p_subject_id;
  elsif k = 'component_variant' then
    with recursive d as (
      select subject_id from mi.component_variant where revision_of_id = p_subject_id
      union all
      select v.subject_id from mi.component_variant v join d on v.revision_of_id = d.subject_id
    ) select coalesce(array_agg(subject_id), '{}') into extra from d;
  elsif k = 'brand' then
    select coalesce(array_agg(x), '{}') into extra from (
      select v.subject_id as x from mi.component_variant v
        join mi.component_family f on f.subject_id = v.family_id where f.brand_id = p_subject_id
      union
      select f.subject_id from mi.component_family f where f.brand_id = p_subject_id
      union
      select ver.subject_id from mi.vehicle_version ver
        join mi.generation g on g.subject_id = ver.generation_id
        join mi.model_line m on m.subject_id = g.model_line_id where m.brand_id = p_subject_id
    ) s;
  elsif k = 'model_line' then
    select coalesce(array_agg(ver.subject_id), '{}') into extra from mi.vehicle_version ver
      join mi.generation g on g.subject_id = ver.generation_id where g.model_line_id = p_subject_id;
  elsif k = 'generation' then
    select coalesce(array_agg(subject_id), '{}') into extra
      from mi.vehicle_version where generation_id = p_subject_id;
  else
    extra := '{}';
  end if;

  return ids || coalesce(extra, '{}');
end $$;

-- ---------- 3. Ревізії знання ----------

-- Єдине місце, де живе відповідність "таблиця -> зачеплені subjects".
-- Жоден write-path не має памʼятати про підняття ревізії.
create or replace function mi.affected_subjects(p_table text, p_row jsonb)
returns bigint[] language plpgsql stable as $$
declare ids bigint[] := '{}'; cid bigint; c record; v record;
begin
  if p_row is null then return '{}'; end if;

  if p_table = 'claim' then
    -- Чернетки нічого не міняють у пакетах.
    if (p_row->>'status') not in ('published', 'superseded', 'retired') then return '{}'; end if;
    return mi.propagation_targets((p_row->>'subject_id')::bigint,
                                  (p_row->>'propagation')::mi.propagation);

  elsif p_table = 'claim_applicability' then
    if (p_row->>'owner_subject_id') is not null then
      return array[(p_row->>'owner_subject_id')::bigint];
    end if;
    cid := (p_row->>'claim_id')::bigint;
    select subject_id, status, propagation into c from mi.claim where id = cid;
    if not found or c.status not in ('published', 'superseded', 'retired') then return '{}'; end if;
    return mi.propagation_targets(c.subject_id, c.propagation);

  elsif p_table in ('claim_link', 'claim_support') then
    cid := coalesce((p_row->>'claim_id')::bigint, (p_row->>'synthesis_claim_id')::bigint);
    select subject_id, status, propagation into c from mi.claim where id = cid;
    if not found or c.status not in ('published', 'superseded', 'retired') then return '{}'; end if;
    ids := mi.propagation_targets(c.subject_id, c.propagation);
    if (p_row->>'target_subject_id') is not null then
      ids := ids || (p_row->>'target_subject_id')::bigint;
    end if;
    return ids;

  elsif p_table = 'issue' then
    return array[(p_row->>'subject_id')::bigint, (p_row->>'about_subject_id')::bigint];
  elsif p_table = 'maintenance_item' then
    return array[(p_row->>'subject_id')::bigint, (p_row->>'about_subject_id')::bigint];
  elsif p_table = 'check_item' then
    return array[(p_row->>'subject_id')::bigint, (p_row->>'scope_subject_id')::bigint];
  elsif p_table = 'check_covers' then
    ids := array[(p_row->>'target_subject_id')::bigint];
    select scope_subject_id into cid from mi.check_item where subject_id = (p_row->>'check_id')::bigint;
    return ids || array[(p_row->>'check_id')::bigint, cid];

  elsif p_table = 'component_variant' then
    return array[(p_row->>'subject_id')::bigint, (p_row->>'family_id')::bigint];
  elsif p_table = 'variant_attribute' then
    select family_id into cid from mi.component_variant where subject_id = (p_row->>'variant_id')::bigint;
    return array[(p_row->>'variant_id')::bigint, cid];
  elsif p_table = 'version_fitment' then
    return array[(p_row->>'vmy_id')::bigint, (p_row->>'variant_id')::bigint];
  elsif p_table = 'equipment_availability' then
    return array[(p_row->>'vmy_id')::bigint, (p_row->>'item_id')::bigint];
  elsif p_table = 'package_content' then
    return array[(p_row->>'package_id')::bigint, (p_row->>'item_id')::bigint];
  elsif p_table = 'component_state_type' then
    return array[(p_row->>'subject_id')::bigint, (p_row->>'applies_to_subject_id')::bigint];
  elsif p_table = 'entitlement' then
    return array[(p_row->>'subject_id')::bigint];
  elsif p_table = 'equipment_visual_hint' then
    return array[(p_row->>'equipment_id')::bigint];
  end if;

  return '{}';
end $$;

-- Інвалідація фрагментів: логічна, без жодної синхронної перебудови.
create or replace function mi.invalidate_fragments(p_ids bigint[])
returns integer language plpgsql as $$
declare n integer := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  -- Усі три дії виконуються в одному операторі: змінні CTE виконуються
  -- завжди і повністю, незалежно від того, чи читає їх головний запит.
  with stale as (
    select distinct f.id as fragment_id, f.vmy_id, f.purpose
      from mi.fragment_dependency d
      join mi.pack_fragment f on f.id = d.fragment_id
      join mi.knowledge_subject s on s.id = d.subject_id
     where d.subject_id = any(p_ids)
       and d.knowledge_rev <> s.knowledge_rev
       and f.valid
  ), invalidated as (
    update mi.pack_fragment f set valid = false
      from stale where f.id = stale.fragment_id
    returning f.id
  ), queued as (
    insert into mi.build_request (reason, vmy_id, purpose, status)
    select distinct 'invalidated'::mi.build_reason, vmy_id, purpose, 'queued'::mi.request_status
      from stale
    on conflict on constraint build_request_key do update
       set requested_count = build_request.requested_count + 1,
           last_requested_at = now(),
           status = case when build_request.status = 'done' then 'queued'::mi.request_status
                         else build_request.status end
    returning 1
  )
  select count(*) into n from stale;

  return coalesce(n, 0);
end $$;

-- Єдина точка підняття ревізії. Дедуплікує список, пише у відкриту
-- партію публікації, якщо вона є, і інвалідує залежні фрагменти.
create or replace function mi.touch_subjects(p_ids bigint[])
returns integer language plpgsql as $$
declare uniq bigint[]; ctx text; n integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  select array_agg(distinct x) into uniq from unnest(p_ids) x where x is not null;
  if uniq is null then return 0; end if;

  update mi.knowledge_subject
     set knowledge_rev = knowledge_rev + 1, updated_at = now()
   where id = any(uniq);
  get diagnostics n = row_count;

  ctx := coalesce(current_setting('mi.publish_context', true), '');
  if ctx <> '' then
    update mi.publish_batch
       set touched_subject_ids =
             (select coalesce(array_agg(distinct e), '{}')
                from unnest(touched_subject_ids || uniq) e)
     where id = ctx::bigint;
  end if;

  perform mi.invalidate_fragments(uniq);
  return n;
end $$;

create or replace function mi.bump_trigger() returns trigger
language plpgsql as $$
declare ids bigint[] := '{}';
begin
  if tg_op in ('INSERT', 'UPDATE') then
    ids := ids || mi.affected_subjects(tg_table_name, to_jsonb(new));
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    ids := ids || mi.affected_subjects(tg_table_name, to_jsonb(old));
  end if;
  perform mi.touch_subjects(ids);
  return null;
end $$;

-- Клейм: похідні колонки (evidence_summary, applicability_signature,
-- dedup_key) у списку НЕ згадані, тому їх перерахунок ревізію не піднімає.
drop trigger if exists claim_rev_bump on mi.claim;
create trigger claim_rev_bump after insert or delete or update of
  subject_id, knowledge_type, text_en, structured_value, value_kind, confidence,
  buyer_implication_en, buyer_importance, layer, causal_status, contested,
  contested_note_en, policy_status, propagation, refresh_class, status,
  effective_from, effective_to, effective_from_kind, effective_to_kind,
  supersedes_id, superseded_by_id
  on mi.claim for each row execute function mi.bump_trigger();

drop trigger if exists claim_applicability_rev_bump on mi.claim_applicability;
create trigger claim_applicability_rev_bump after insert or delete or update
  on mi.claim_applicability for each row execute function mi.bump_trigger();

drop trigger if exists claim_link_rev_bump on mi.claim_link;
create trigger claim_link_rev_bump after insert or delete or update
  on mi.claim_link for each row execute function mi.bump_trigger();

drop trigger if exists claim_support_rev_bump on mi.claim_support;
create trigger claim_support_rev_bump after insert or delete or update
  on mi.claim_support for each row execute function mi.bump_trigger();

drop trigger if exists issue_rev_bump on mi.issue;
create trigger issue_rev_bump after insert or delete or update
  on mi.issue for each row execute function mi.bump_trigger();

drop trigger if exists maintenance_item_rev_bump on mi.maintenance_item;
create trigger maintenance_item_rev_bump after insert or delete or update
  on mi.maintenance_item for each row execute function mi.bump_trigger();

drop trigger if exists check_item_rev_bump on mi.check_item;
create trigger check_item_rev_bump after insert or delete or update
  on mi.check_item for each row execute function mi.bump_trigger();

drop trigger if exists check_covers_rev_bump on mi.check_covers;
create trigger check_covers_rev_bump after insert or delete or update
  on mi.check_covers for each row execute function mi.bump_trigger();

drop trigger if exists component_variant_rev_bump on mi.component_variant;
create trigger component_variant_rev_bump after insert or delete or update of
  family_id, variant_code, revision_of_id, supersedes_id, prod_from, prod_to,
  prod_from_kind, prod_to_kind, attributes
  on mi.component_variant for each row execute function mi.bump_trigger();

drop trigger if exists variant_attribute_rev_bump on mi.variant_attribute;
create trigger variant_attribute_rev_bump after insert or delete or update
  on mi.variant_attribute for each row execute function mi.bump_trigger();

drop trigger if exists version_fitment_rev_bump on mi.version_fitment;
create trigger version_fitment_rev_bump after insert or delete or update
  on mi.version_fitment for each row execute function mi.bump_trigger();

drop trigger if exists equipment_availability_rev_bump on mi.equipment_availability;
create trigger equipment_availability_rev_bump after insert or delete or update
  on mi.equipment_availability for each row execute function mi.bump_trigger();

drop trigger if exists package_content_rev_bump on mi.package_content;
create trigger package_content_rev_bump after insert or delete or update
  on mi.package_content for each row execute function mi.bump_trigger();

drop trigger if exists component_state_type_rev_bump on mi.component_state_type;
create trigger component_state_type_rev_bump after insert or delete or update
  on mi.component_state_type for each row execute function mi.bump_trigger();

drop trigger if exists entitlement_rev_bump on mi.entitlement;
create trigger entitlement_rev_bump after insert or delete or update
  on mi.entitlement for each row execute function mi.bump_trigger();

drop trigger if exists equipment_visual_hint_rev_bump on mi.equipment_visual_hint;
create trigger equipment_visual_hint_rev_bump after insert or delete or update
  on mi.equipment_visual_hint for each row execute function mi.bump_trigger();

-- ---------- 4. Повторюваність доказів ----------

-- Це властивість доказів, а не парку машин. Жодних відсотків і жодної
-- поширеності тут не зʼявляється.
create or replace function mi.recompute_recurrence(p_claim_id bigint)
returns boolean language plpgsql as $$
declare
  g int; cg int; mkts text[]; miles int[]; ages smallint[];
  sp boolean; has_off boolean; has_ps boolean;
  plats int; owner_mkts int; types text[]; ctx_groups int;
  cls mi.recurrence; h text; old_h text;
begin
  select
    count(distinct e.independence_group) filter (where s.source_type = 'owner' and e.stance = 'supports'),
    count(distinct e.independence_group) filter (where e.stance = 'contradicts'),
    coalesce(array_agg(distinct s.market_code) filter (where s.market_code is not null), '{}'),
    coalesce(array_agg(distinct (e.context->>'mileage_km')::int) filter (where e.context ? 'mileage_km'), '{}'),
    coalesce(array_agg(distinct (e.context->>'age_years')::smallint) filter (where e.context ? 'age_years'), '{}'),
    coalesce(bool_or(s.source_type = 'specialist' and s.quality = 'primary' and e.stance = 'supports'), false),
    coalesce(bool_or(s.source_type in ('official', 'legal')), false),
    coalesce(bool_or(s.source_type = 'specialist' and s.quality = 'primary'), false),
    count(distinct s.platform) filter (where s.source_type = 'owner'),
    count(distinct s.market_code) filter (where s.source_type = 'owner'),
    coalesce(array_agg(distinct s.source_type::text), '{}'),
    count(distinct e.independence_group) filter (where e.context ? 'mileage_km' or e.context ? 'age_years')
  into g, cg, mkts, miles, ages, sp, has_off, has_ps, plats, owner_mkts, types, ctx_groups
  from mi.evidence e join mi.source s on s.id = e.source_id
  where e.claim_id = p_claim_id;

  g := coalesce(g, 0); cg := coalesce(cg, 0);
  plats := coalesce(plats, 0); owner_mkts := coalesce(owner_mkts, 0);

  if g >= 5 and sp and cg <= 1 then
    cls := 'strong_consensus';
  elsif g >= 3 and (plats >= 2 or owner_mkts >= 2) then
    cls := 'repeated_pattern';
  else
    cls := 'anecdote';
  end if;

  -- Видимим у пакеті є лише клас, підтримка спеціаліста, наявність
  -- офіційного і первинного спеціалістського джерела і сам факт
  -- суперечності. Кількість груп у пакет не потрапляє.
  h := md5(concat_ws('~', cls::text, sp::text, has_off::text, has_ps::text, (cg > 0)::text));

  select pack_visible_hash into old_h from mi.recurrence_summary where claim_id = p_claim_id;

  insert into mi.recurrence_summary (claim_id, independent_groups, contradicting_groups,
      markets, mileage_km, age_years, specialist_support, recurrence_class,
      pack_visible_hash, computed_at)
  values (p_claim_id, g, cg, mkts, miles, ages, sp, cls, h, now())
  on conflict (claim_id) do update set
    independent_groups = excluded.independent_groups,
    contradicting_groups = excluded.contradicting_groups,
    markets = excluded.markets, mileage_km = excluded.mileage_km,
    age_years = excluded.age_years, specialist_support = excluded.specialist_support,
    recurrence_class = excluded.recurrence_class,
    pack_visible_hash = excluded.pack_visible_hash, computed_at = now();

  update mi.claim
     set evidence_summary = jsonb_build_object(
           'source_types', to_jsonb(types), 'independent_groups', g,
           'contradicting_groups', cg, 'has_official', has_off,
           'has_primary_specialist', has_ps, 'context_groups', coalesce(ctx_groups, 0))
   where id = p_claim_id;

  return old_h is distinct from h;
end $$;

-- Докази це єдина точка рішення про підняття ревізії від доказів:
-- ревізія росте лише тоді, коли змінилось видиме у пакеті.
create or replace function mi.on_evidence_change() returns trigger
language plpgsql as $$
declare cid bigint; changed boolean; rec jsonb;
begin
  cid := coalesce(new.claim_id, old.claim_id);
  if cid is null then return null; end if;
  changed := mi.recompute_recurrence(cid);
  if changed then
    select to_jsonb(c) into rec from mi.claim c where c.id = cid;
    perform mi.touch_subjects(mi.affected_subjects('claim', rec));
  end if;
  return null;
end $$;

drop trigger if exists evidence_recurrence on mi.evidence;
create trigger evidence_recurrence after insert or delete or update
  on mi.evidence for each row execute function mi.on_evidence_change();

-- ---------- 5. Сторожі публікації ----------

create or replace function mi.in_publish_context() returns boolean
language sql stable as $$
  select coalesce(current_setting('mi.publish_context', true), '') <> '';
$$;

create or replace function mi.guard_claim_publish() returns trigger
language plpgsql as $$
begin
  if mi.in_publish_context() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and new.status = 'published' then
    raise exception 'published claims are created only by mi.publish_candidate()';
  elsif tg_op = 'UPDATE' and (old.status = 'published' or new.status = 'published') then
    raise exception 'published claims are immutable outside mi.publish_candidate()';
  elsif tg_op = 'DELETE' and old.status in ('published', 'superseded') then
    raise exception 'published knowledge is never deleted, only superseded or retired';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists claim_publish_guard on mi.claim;
create trigger claim_publish_guard before insert or delete or update of
  subject_id, knowledge_type, text_en, structured_value, value_kind, confidence,
  buyer_implication_en, buyer_importance, layer, causal_status, contested,
  contested_note_en, policy_status, propagation, refresh_class, status,
  effective_from, effective_to, supersedes_id, superseded_by_id, dedup_key
  on mi.claim for each row execute function mi.guard_claim_publish();

-- Застосовність, звʼязки і опори опублікованого клейма змінюються лише
-- у контексті публікації.
create or replace function mi.guard_published_child() returns trigger
language plpgsql as $$
declare cid bigint; st mi.claim_status; r jsonb;
begin
  if mi.in_publish_context() then return coalesce(new, old); end if;
  r := coalesce(to_jsonb(new), to_jsonb(old));
  cid := coalesce((r->>'claim_id')::bigint, (r->>'synthesis_claim_id')::bigint);
  if cid is null then return coalesce(new, old); end if;
  select status into st from mi.claim where id = cid;
  if st in ('published', 'superseded') then
    raise exception 'knowledge of a published claim cannot be changed outside mi.publish_candidate() (%)', tg_table_name;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists claim_applicability_publish_guard on mi.claim_applicability;
create trigger claim_applicability_publish_guard before insert or delete or update
  on mi.claim_applicability for each row execute function mi.guard_published_child();

drop trigger if exists claim_link_publish_guard on mi.claim_link;
create trigger claim_link_publish_guard before insert or delete or update
  on mi.claim_link for each row execute function mi.guard_published_child();

drop trigger if exists claim_support_publish_guard on mi.claim_support;
create trigger claim_support_publish_guard before insert or delete or update
  on mi.claim_support for each row execute function mi.guard_published_child();

-- Докази опублікованого клейма доповнювати можна, переписувати і
-- видаляти не можна: provenance тільки дописується.
create or replace function mi.guard_published_evidence() returns trigger
language plpgsql as $$
declare st mi.claim_status;
begin
  if tg_op = 'INSERT' or mi.in_publish_context() then return coalesce(new, old); end if;
  select status into st from mi.claim where id = old.claim_id;
  if st in ('published', 'superseded') then
    raise exception 'evidence of a published claim is append only';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists evidence_publish_guard on mi.evidence;
create trigger evidence_publish_guard before update or delete
  on mi.evidence for each row execute function mi.guard_published_evidence();

-- ---------- 6. Перевірка якості ----------

create or replace function mi.check_gate(p_candidate_id bigint)
returns jsonb language plpgsql as $$
declare
  c mi.candidate_claim%rowtype;
  subj_kind mi.subject_kind;
  rules jsonb := '[]'::jsonb;
  passed boolean := true;
  n_official int; n_spec_primary int; n_owner_groups int; n_vendor int;
  n_total int; n_plat int; n_mkt int; n_ctx int;
  n_support int; n_support_types int; n_alias int;
  shape_ok boolean; ok boolean;
begin
  select * into c from mi.candidate_claim where id = p_candidate_id;
  if not found then raise exception 'candidate % not found', p_candidate_id; end if;

  select count(*) filter (where s.source_type in ('official', 'legal')),
         count(*) filter (where s.source_type = 'specialist' and s.quality = 'primary'),
         count(distinct ce.independence_group) filter (where s.source_type = 'owner' and ce.stance = 'supports'),
         count(*) filter (where s.source_type in ('vendor', 'aggregator')),
         count(*),
         count(distinct s.platform) filter (where s.source_type = 'owner'),
         count(distinct s.market_code) filter (where s.source_type = 'owner'),
         count(distinct ce.independence_group) filter (where ce.context ? 'mileage_km' or ce.context ? 'age_years')
    into n_official, n_spec_primary, n_owner_groups, n_vendor, n_total, n_plat, n_mkt, n_ctx
    from mi.candidate_evidence ce join mi.source s on s.id = ce.source_id
   where ce.candidate_id = p_candidate_id;

  select count(*), count(distinct cl.knowledge_type)
    into n_support, n_support_types
    from jsonb_array_elements_text(coalesce(c.proposed_links->'supports', '[]'::jsonb)) t(v)
    join mi.claim cl on cl.id = t.v::bigint and cl.status = 'published';

  select count(distinct target_subject_id) into n_alias
    from mi.subject_alias where alias_norm = lower(btrim(coalesce(c.proposed_subject_text, '')));

  if c.resolved_subject_id is not null then
    select kind into subj_kind from mi.knowledge_subject where id = c.resolved_subject_id;
  end if;

  -- 1. Subject розвʼязаний
  ok := c.resolved_subject_id is not null;
  rules := rules || jsonb_build_object('code', 'subject_resolved', 'ok', ok,
    'detail', 'candidate must be normalized to a knowledge subject');
  passed := passed and ok;

  -- 2. Аліас однозначний
  ok := n_alias <= 1;
  rules := rules || jsonb_build_object('code', 'alias_unambiguous', 'ok', ok,
    'detail', format('%s subjects share this alias', n_alias));
  passed := passed and ok;

  -- 3. Тип знання заданий
  ok := c.proposed_knowledge_type is not null;
  rules := rules || jsonb_build_object('code', 'knowledge_type_set', 'ok', ok, 'detail', null);
  passed := passed and ok;

  -- 4. Форма застосовності
  shape_ok := true;
  if c.proposed_applicability is not null then
    if jsonb_typeof(c.proposed_applicability) <> 'array' then
      shape_ok := false;
    else
      select bool_and(e ? 'dimension' and e ? 'operator') into shape_ok
        from jsonb_array_elements(c.proposed_applicability) e;
      shape_ok := coalesce(shape_ok, true);
    end if;
  end if;
  rules := rules || jsonb_build_object('code', 'applicability_shape', 'ok', shape_ok,
    'detail', 'each predicate needs dimension and operator');
  passed := passed and shape_ok;

  -- 5. Поширення знання вниз вимагає явного рішення рецензента
  ok := c.proposed_propagation = 'exact' or coalesce(btrim(c.review_note), '') <> '';
  rules := rules || jsonb_build_object('code', 'propagation_justified', 'ok', ok,
    'detail', 'propagation other than exact requires a review note');
  passed := passed and ok;

  -- 6. Широке знання потребує широкого джерела
  ok := not (subj_kind in ('component_family', 'brand', 'model_line')
             and c.proposed_propagation = 'descendants')
        or (n_official > 0 or n_spec_primary > 0);
  rules := rules || jsonb_build_object('code', 'broad_claim_broad_source', 'ok', ok,
    'detail', 'family or brand wide knowledge needs official or primary specialist source');
  passed := passed and ok;

  -- 7. Число без одиниці не публікується
  ok := c.value_kind is null or c.value_kind not in ('quantity', 'range')
        or (c.structured_value ? 'unit');
  rules := rules || jsonb_build_object('code', 'numeric_unit', 'ok', ok,
    'detail', 'quantity and range need a unit');
  passed := passed and ok;

  -- 8. Вартість без ринку і дати не публікується
  ok := c.value_kind is null or c.value_kind <> 'cost'
        or (c.structured_value ?& array['market', 'as_of']);
  rules := rules || jsonb_build_object('code', 'cost_market_asof', 'ok', ok,
    'detail', 'cost needs market and as_of');
  passed := passed and ok;

  -- 9. Постачальник послуг сам по собі нічого не встановлює
  ok := not (n_total > 0 and n_vendor = n_total);
  rules := rules || jsonb_build_object('code', 'vendor_not_alone', 'ok', ok,
    'detail', 'vendor or aggregator sources alone cannot establish knowledge');
  passed := passed and ok;

  -- 10. Правила за типом знання
  if c.proposed_knowledge_type = 'official_fact' then
    ok := n_official > 0;
    rules := rules || jsonb_build_object('code', 'official_source', 'ok', ok,
      'detail', 'official fact needs an official or legal source');
    passed := passed and ok;

    ok := c.text_en !~ '[0-9]' or c.value_kind is not null;
    rules := rules || jsonb_build_object('code', 'structured_when_numeric', 'ok', ok,
      'detail', 'official fact carrying numbers or document ids needs value_kind');
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'known_issue' then
    ok := n_official > 0 or (n_spec_primary >= 1 and n_owner_groups >= 2);
    rules := rules || jsonb_build_object('code', 'known_issue_evidence', 'ok', ok,
      'detail', 'needs official source, or primary specialist plus two independent owner groups');
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'specialist_practice' then
    ok := n_spec_primary >= 1;
    rules := rules || jsonb_build_object('code', 'specialist_source', 'ok', ok, 'detail', null);
    passed := passed and ok;
    ok := c.proposed_causal_status is not null;
    rules := rules || jsonb_build_object('code', 'causal_status_set', 'ok', ok, 'detail', null);
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'owner_practice' then
    ok := n_owner_groups >= 3 and (n_plat >= 2 or n_mkt >= 2);
    rules := rules || jsonb_build_object('code', 'owner_practice_recurrence', 'ok', ok,
      'detail', 'needs three independent groups across two platforms or two markets');
    passed := passed and ok;
    ok := c.proposed_causal_status is not null;
    rules := rules || jsonb_build_object('code', 'causal_status_set', 'ok', ok, 'detail', null);
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'owner_pattern' then
    ok := n_owner_groups >= 2;
    rules := rules || jsonb_build_object('code', 'owner_pattern_groups', 'ok', ok,
      'detail', 'needs at least two independent owner groups');
    passed := passed and ok;
    ok := n_ctx >= 2;
    rules := rules || jsonb_build_object('code', 'owner_pattern_context', 'ok', ok,
      'detail', 'at least two groups must carry mileage or age context');
    passed := passed and ok;

  elsif c.proposed_knowledge_type = 'calcar_synthesis' then
    ok := n_support >= 2 and n_support_types >= 2;
    rules := rules || jsonb_build_object('code', 'synthesis_support', 'ok', ok,
      'detail', 'needs at least two supporting published claims of two knowledge types');
    passed := passed and ok;
    ok := coalesce(btrim(c.reviewer), '') <> '';
    rules := rules || jsonb_build_object('code', 'human_review', 'ok', ok,
      'detail', 'synthesis requires a named reviewer in v1');
    passed := passed and ok;
  end if;

  return jsonb_build_object('passed', passed, 'checked_at', now(), 'rules', rules);
end $$;

-- Звичайний крок ревʼю: прогнати перевірку і зберегти її результат.
-- Публікація атомарна, тому невдала публікація відкочує і свій запис
-- результату; саме тому результат перевірки зберігається окремо.
create or replace function mi.run_gate(p_candidate_id bigint)
returns jsonb language plpgsql as $$
declare gate jsonb;
begin
  gate := mi.check_gate(p_candidate_id);
  update mi.candidate_claim
     set gate_result = gate, gate_checked_at = now(),
         review_status = case when review_status in ('approved', 'rejected', 'merged')
                              then review_status else 'gate_pending' end
   where id = p_candidate_id;
  return gate;
end $$;

-- ---------- 7. Публікація ----------

-- Атомарно: знімок, партія, клейм, застосовність, докази, звʼязки, опори,
-- успадкування, стан кандидата, ревізії знання. Будь-яка помилка означає
-- відкат усієї публікації.
create or replace function mi.publish_candidate(
  p_candidate_id bigint, p_reviewer text, p_override_reason text default null)
returns bigint
language plpgsql security definer set search_path = pg_catalog, mi, public as $$
declare
  c mi.candidate_claim%rowtype;
  gate jsonb; sig text; key text;
  existing_id bigint; snap_id bigint; batch_id bigint; new_id bigint;
  sup_id bigint; n_ev int := 0;
begin
  if coalesce(btrim(p_reviewer), '') = '' then
    raise exception 'reviewer is required';
  end if;

  select * into c from mi.candidate_claim where id = p_candidate_id for update;
  if not found then raise exception 'candidate % not found', p_candidate_id; end if;
  if c.review_status in ('approved', 'rejected', 'merged') then
    raise exception 'candidate % is already %', p_candidate_id, c.review_status;
  end if;

  update mi.candidate_claim set reviewer = p_reviewer where id = p_candidate_id;
  c.reviewer := p_reviewer;

  gate := mi.check_gate(p_candidate_id);
  update mi.candidate_claim
     set gate_result = gate, gate_checked_at = now(), review_status = 'gate_pending'
   where id = p_candidate_id;

  if not (gate->>'passed')::boolean then
    if coalesce(btrim(p_override_reason), '') = '' then
      raise exception 'quality gate failed for candidate %: %', p_candidate_id, gate->'rules';
    end if;
    update mi.candidate_claim
       set review_note = concat_ws(' | ', review_note, 'gate override: ' || p_override_reason)
     where id = p_candidate_id;
  end if;

  sig := mi.applicability_signature(c.proposed_applicability);
  key := mi.dedup_key(c.resolved_subject_id, c.proposed_knowledge_type, c.proposed_layer,
                      sig, c.text_en, c.value_kind);

  -- Дедуплікація: те саме твердження про той самий subject з тією самою
  -- застосовністю не створює другий опублікований клейм.
  select id into existing_id from mi.claim
   where dedup_key = key and status = 'published' limit 1;

  if existing_id is not null then
    insert into mi.evidence (claim_id, source_id, stance, excerpt, excerpt_lang,
                             independence_group, context, retrieved_at)
    select existing_id, ce.source_id, ce.stance, ce.excerpt, ce.excerpt_lang,
           ce.independence_group, ce.context, now()
      from mi.candidate_evidence ce
     where ce.candidate_id = p_candidate_id
    on conflict on constraint evidence_key do nothing;

    update mi.candidate_claim
       set review_status = 'merged', merge_into_claim_id = existing_id,
           published_claim_id = null, reviewed_at = now()
     where id = p_candidate_id;
    return existing_id;
  end if;

  insert into mi.knowledge_snapshot (note) values ('publish candidate ' || p_candidate_id)
    returning id into snap_id;
  insert into mi.publish_batch (snapshot_id, actor) values (snap_id, p_reviewer)
    returning id into batch_id;

  -- Контекст публікації: лише всередині нього сторожі пропускають запис
  -- канонічного знання. Він локальний для транзакції.
  perform set_config('mi.publish_context', batch_id::text, true);

  insert into mi.claim (subject_id, knowledge_type, text_en, normalized_assertion,
      value_kind, structured_value, confidence, buyer_implication_en, buyer_importance,
      layer, causal_status, propagation, propagation_note, status, dedup_key,
      applicability_signature, published_snapshot_id, reviewed_at, reviewed_by, review_note)
  values (c.resolved_subject_id, c.proposed_knowledge_type, c.text_en,
      mi.normalize_assertion(c.text_en), c.value_kind, c.structured_value,
      coalesce(c.proposed_confidence, 'low'), null, 3,
      c.proposed_layer, c.proposed_causal_status, c.proposed_propagation,
      case when c.proposed_propagation = 'exact' then null else c.review_note end,
      'published', key, sig, snap_id, now(), p_reviewer, c.review_note)
  returning id into new_id;

  if c.proposed_applicability is not null then
    insert into mi.claim_applicability (claim_id, group_no, dimension, operator, config_scope,
        ref_subject_id, include_revisions, attr_key, attr_value, tag,
        value_date_from, value_date_to, value_num_from, value_num_to,
        value_from_kind, value_to_kind)
    select new_id,
      coalesce((e->>'group_no')::smallint, 1),
      (e->>'dimension')::mi.identity_dimension,
      (e->>'operator')::mi.pred_operator,
      coalesce((e->>'config_scope')::mi.config_slot, 'current'),
      (e->>'ref_subject_id')::bigint,
      coalesce((e->>'include_revisions')::boolean, false),
      e->>'attr_key', e->>'attr_value', e->>'tag',
      (e->>'value_date_from')::date, (e->>'value_date_to')::date,
      (e->>'value_num_from')::numeric, (e->>'value_num_to')::numeric,
      (e->>'value_from_kind')::mi.boundary_kind, (e->>'value_to_kind')::mi.boundary_kind
    from jsonb_array_elements(c.proposed_applicability) e;
  end if;

  insert into mi.evidence (claim_id, source_id, stance, excerpt, excerpt_lang,
                           independence_group, context, retrieved_at)
  select new_id, ce.source_id, ce.stance, ce.excerpt, ce.excerpt_lang,
         ce.independence_group, ce.context, now()
    from mi.candidate_evidence ce where ce.candidate_id = p_candidate_id;
  get diagnostics n_ev = row_count;

  if c.proposed_links ? 'links' then
    insert into mi.claim_link (claim_id, target_subject_id, role_code)
    select new_id, (e->>'target_subject_id')::bigint, e->>'role_code'
      from jsonb_array_elements(c.proposed_links->'links') e
    on conflict on constraint claim_link_key do nothing;
  end if;

  if c.proposed_knowledge_type = 'calcar_synthesis' and c.proposed_links ? 'supports' then
    insert into mi.claim_support (synthesis_claim_id, supporting_claim_id)
    select new_id, t.v::bigint
      from jsonb_array_elements_text(c.proposed_links->'supports') t(v)
    on conflict do nothing;
  end if;

  -- Успадкування: старий клейм не переписується, а стає superseded.
  if c.proposed_links ? 'supersedes' then
    sup_id := (c.proposed_links->>'supersedes')::bigint;
    update mi.claim set supersedes_id = sup_id where id = new_id;
    update mi.claim
       set status = 'superseded', superseded_by_id = new_id,
           effective_to = current_date, effective_to_kind = 'known'
     where id = sup_id and status = 'published';
    if not found then
      raise exception 'claim % cannot be superseded: not published', sup_id;
    end if;
  end if;

  perform mi.recompute_recurrence(new_id);

  update mi.candidate_claim
     set review_status = 'approved', published_claim_id = new_id, reviewed_at = now()
   where id = p_candidate_id;

  perform set_config('mi.publish_context', '', true);
  return new_id;
end $$;

-- ---------- 8. Права ----------

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'mi_ingest') then
    execute 'grant execute on function mi.check_gate(bigint) to mi_ingest';
    execute 'grant execute on function mi.run_gate(bigint) to mi_ingest';
    execute 'grant execute on function mi.publish_candidate(bigint, text, text) to mi_ingest';
  end if;
end $$;

-- Публікувати і перераховувати знання напряму роль дослідження не може.
revoke all on function mi.touch_subjects(bigint[]) from public;
revoke all on function mi.invalidate_fragments(bigint[]) from public;
revoke all on function mi.recompute_recurrence(bigint) from public;
