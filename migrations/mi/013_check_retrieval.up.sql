-- CalCar Model Intelligence, міграція 13: канонічні перевірки потрапляють
-- у пакет напряму, і уточнене віднесення знання до системи.
--
-- Phase 4 знайшла дві прогалини вибірки. Ця міграція закриває їх БЕЗ
-- зміни фізичної схеми: жодної таблиці, жодної колонки, жодного типу.
-- Architecture v1.1 і Physical Schema v1 лишаються FROZEN.
--
-- Причина першої прогалини: `mi.build_fragment` збирав лише рядки
-- `mi.claim`. Сутність `mi.check_item` потрапляла у замикання версії
-- (`mi.vmy_scope` повертає її з relation = 'check'), але у payload
-- фрагмента не перетворювалась ні на що, тому у пакет могла зайти лише
-- через окремий клейм ПРО перевірку. Для Tesla таких клеймів немає
-- жодного, тому у каталозі сім перевірок, а у пакеті нуль.
--
-- Схема для цього вже все має:
--   check_item.scope_subject_id      про що перевірка (детермінований якір);
--   check_item.default_priority      must / good;
--   check_item.conditions            умови виконання;
--   check_item.materially_resolves   і resolves_dimension;
--   check_covers                     що саме перевірка виявляє;
--   claim_applicability.owner_subject_id  предикати, привʼязані до СУТНОСТІ,
--                                    а не до клейма (CHECK у міграції 05
--                                    явно дозволяє рівно один із двох).
-- Остання колонка існує саме для цього випадку і досі не була використана.

-- ---------- 1. Якір довільного subject ----------

create or replace function mi.subject_anchor_variant(p_subject_id bigint)
returns bigint language plpgsql stable as $$
declare k mi.subject_kind; anchor bigint;
begin
  if p_subject_id is null then return null; end if;
  select kind into k from mi.knowledge_subject where id = p_subject_id;
  if k = 'component_variant' then return p_subject_id; end if;

  if k = 'issue' then
    select about_subject_id into anchor from mi.issue where subject_id = p_subject_id;
  elsif k = 'maintenance_item' then
    select about_subject_id into anchor from mi.maintenance_item where subject_id = p_subject_id;
  elsif k = 'check_item' then
    select scope_subject_id into anchor from mi.check_item where subject_id = p_subject_id;
  elsif k = 'component_state_type' then
    select applies_to_subject_id into anchor from mi.component_state_type where subject_id = p_subject_id;
  elsif k = 'equipment_item' then
    -- Обладнання, що реалізується конкретним варіантом, успадковує його.
    select implements_variant_id into anchor from mi.equipment_item where subject_id = p_subject_id;
  end if;

  if anchor is null or anchor = p_subject_id then return null; end if;
  if (select kind from mi.knowledge_subject where id = anchor) = 'component_variant' then
    return anchor;
  end if;
  -- Один крок углиб: проблема про обладнання, яке реалізується варіантом.
  return mi.subject_anchor_variant(anchor);
end $$;

create or replace function mi.claim_anchor_variant(p_claim_id bigint)
returns bigint language sql stable as $$
  select mi.subject_anchor_variant((select subject_id from mi.claim where id = p_claim_id));
$$;

-- ---------- 2. Область знання: уточнення без зміни схеми ----------

-- Єдина зміна: обладнання, що реалізується варіантом компонента, тепер
-- отримує область цього варіанта. Керамічні гальма перестають бути
-- абстрактним «обладнанням» і стають шасі.
create or replace function mi.subject_area(p_subject_id bigint)
returns text language plpgsql stable as $$
declare
  k mi.subject_kind; anchor bigint; kindcode text; area text;
begin
  select kind into k from mi.knowledge_subject where id = p_subject_id;
  if k is null then return 'other'; end if;

  if k = 'issue' then
    select about_subject_id into anchor from mi.issue where subject_id = p_subject_id;
  elsif k = 'maintenance_item' then
    select about_subject_id into anchor from mi.maintenance_item where subject_id = p_subject_id;
  elsif k = 'check_item' then
    select scope_subject_id into anchor from mi.check_item where subject_id = p_subject_id;
  elsif k = 'component_state_type' then
    select applies_to_subject_id into anchor from mi.component_state_type where subject_id = p_subject_id;
  elsif k = 'equipment_item' then
    select implements_variant_id into anchor from mi.equipment_item where subject_id = p_subject_id;
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
    -- Обладнання без реалізуючого варіанта: система з наявних даних
    -- НЕ виводиться, і це чесно видно у назві області.
    return 'equipment';
  elsif k in ('brand', 'model_line', 'generation', 'vehicle_version', 'version_market_year') then
    -- Знання, привʼязане до покоління або версії цілком. Схема не має
    -- поля системи у mi.issue, тому точнішої відповіді тут не існує.
    return 'vehicle_wide';
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

-- ---------- 3. Оцінка канонічної перевірки ----------

-- Перевірка це сутність каталогу, а не текст. Її застосовність рахується
-- рівно тими самими правилами, що і застосовність клейма: предикати,
-- привʼязані до самої сутності через owner_subject_id, плюс якір.
create or replace function mi.eval_check(p_check_id bigint, p_identity jsonb)
returns jsonb language plpgsql stable as $$
declare
  ci mi.check_item%rowtype;
  gr record; ev jsonb; log jsonb := '[]'::jsonb;
  group_results text[] := '{}'; preds text[]; bases text[];
  status text; basis text := 'confirmed';
  anchor bigint; fam bigint; role_row jsonb; role_status text;
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

  status := mi.claim_status_from_groups(group_results);
  return jsonb_build_object('check_id', p_check_id, 'status', status,
                            'basis', basis, 'predicates', log);
end $$;

-- Важливість перевірки для покупця. Виводиться детерміновано з того, що
-- у схемі вже є: пріоритет самої перевірки і тяжкість того, що вона
-- виявляє через mi.check_covers. Перевірка НЕ є дефектом і не стає ним.
create or replace function mi.check_importance(p_check_id bigint)
returns smallint language sql stable as $$
  select case
    when pr = 'must' and worst in ('catastrophic') then 5
    when pr = 'must' then 4
    when worst in ('catastrophic', 'major') then 3
    else 2 end::smallint
  from (
    select (select default_priority::text from mi.check_item where subject_id = p_check_id) as pr,
           (select min(case i.severity when 'catastrophic' then 1 when 'major' then 2
                                       when 'moderate' then 3 else 4 end)
              from mi.check_covers cc join mi.issue i on i.subject_id = cc.target_subject_id
             where cc.check_id = p_check_id) as sev
  ) t, lateral (select case sev when 1 then 'catastrophic' when 2 then 'major'
                                when 3 then 'moderate' when 4 then 'minor' else 'none' end) w(worst);
$$;

-- Кошики пакета читають лише tmp_pick: канонічна перевірка не має
-- claim_id, тому приєднання до tmp_eval по claim_id її губило.
create or replace function mi.pack_bucket(p_area text, p_kind text)
returns jsonb language plpgsql stable as $$
declare res jsonb; cond text;
begin
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
             'check_subject_id', (p.entry->>'check_subject_id')::bigint,
             'entry_source', coalesce(p.entry->>'entry_source', 'claim'),
             'text', p.entry->>'text_en',
             'knowledge_type', p.entry->>'knowledge_type',
             'confidence', p.entry->>'confidence',
             'buyer_importance', (p.entry->>'buyer_importance')::int,
             'buyer_implication', p.entry->>'buyer_implication_en',
             'status', p.status,
             'basis', p.basis,
             'condition_text', case when p.status = 'CONDITIONAL'
                                    then mi.condition_text(p.preds) else null end,
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
      from tmp_pick p
     where (%s) and (%L is null or p.area = %L)
  $q$, cond, p_area, p_area) into res;
  return res;
end $$;

-- ---------- 4. Фрагмент і пакет несуть канонічні перевірки ----------
--
-- Змінено рівно дві функції. У фрагменті зʼявився масив `checks` із
-- сутностями каталогу; у компіляторі вони оцінюються `mi.eval_check` і
-- потрапляють у той самий відбір, що і клейми. Перевірка лишається
-- перевіркою: вона не стає ні проблемою, ні ризиком, і на Score не
-- впливає ніяк.

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
    -- Канонічні перевірки версії. Вони потрапляють у фрагмент як
    -- СУТНОСТІ каталогу і більше не потребують окремого клейма про себе.
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'check_id', ci.subject_id,
               'area', mi.subject_area(ci.subject_id),
               'label', ks.label,
               'method', ci.test_method_code,
               'scope_subject_id', ci.scope_subject_id,
               'why_en', ci.why_en,
               'proves_en', ci.proves_en,
               'cannot_prove_en', ci.cannot_prove_en,
               'conditions', to_jsonb(ci.conditions),
               'priority', ci.default_priority,
               'materially_resolves', ci.materially_resolves,
               'resolves_dimension', ci.resolves_dimension,
               'buyer_importance', mi.check_importance(ci.subject_id),
               'covers', (select jsonb_agg(jsonb_build_object(
                            'subject_id', cc.target_subject_id, 'role', cc.role,
                            'issue_key', i.issue_key, 'severity', i.severity)
                            order by cc.target_subject_id)
                            from mi.check_covers cc
                            left join mi.issue i on i.subject_id = cc.target_subject_id
                           where cc.check_id = ci.subject_id),
               -- Походження перевірки живе у клеймах про неї. Якщо
               -- клейма немає, тут чесний null, а не вигаданий доказ.
               'claims', (select jsonb_agg(t2.claim_id order by t2.claim_id)
                            from tmp_claims t2 join mi.claim c2 on c2.id = t2.claim_id
                           where c2.subject_id = ci.subject_id)
             ) order by ci.subject_id)
        from mi.check_item ci
        join mi.knowledge_subject ks on ks.id = ci.subject_id
       where ci.subject_id in (select subject_id from tmp_scope)
    ), '[]'::jsonb),
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

  -- Канонічні перевірки оцінюються тими самими правилами і входять у
  -- ту саму таблицю відбору. Клейм про перевірку для цього не потрібен.
  insert into tmp_eval
  select null::bigint,
         cv->>'status', cv->>'basis', e->>'area',
         (e->>'buyer_importance')::smallint,
         'check_item',
         null,
         e->>'priority',
         jsonb_build_object(
           'subject_kind', 'check_item',
           'check_subject_id', (e->>'check_id')::bigint,
           'text_en', e->>'why_en',
           'buyer_importance', (e->>'buyer_importance')::int,
           'entry_source', 'catalogue',
           'check', jsonb_build_object(
             'method', e->>'method', 'why_en', e->>'why_en',
             'proves_en', e->>'proves_en', 'cannot_prove_en', e->>'cannot_prove_en',
             'conditions', e->'conditions', 'priority', e->>'priority',
             'materially_resolves', (e->>'materially_resolves')::boolean,
             'resolves_dimension', e->>'resolves_dimension',
             'covers', e->'covers', 'claims', e->'claims')),
         cv->'predicates'
    from jsonb_array_elements(frag.payload->'checks') e,
         lateral mi.eval_check((e->>'check_id')::bigint, p_identity) cv;

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
    status text, basis text, preds jsonb
  ) on commit drop;
  delete from tmp_pick;

  insert into tmp_pick
  select coalesce(t.claim_id, -(t.entry->>'check_subject_id')::bigint),
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
   where t.status in ('APPLICABLE', 'APPLICABLE_ASSUMED', 'APPLICABLE_CONTEXT')
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
