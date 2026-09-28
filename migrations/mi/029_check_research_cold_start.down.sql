-- Відкат міграції 29: дослівні тексти функцій з 028 і однопараметровий
-- вхід. Кандидати і докази, створені через 029, лишаються.

drop function if exists public.mi_research_context(text, jsonb);
drop function if exists mi.research_context(text, jsonb);

-- ---------- 1. Контекст дослідження ----------

create or replace function mi.research_context(p_vin text)
returns jsonb language plpgsql as $$
declare
  v_vin text; v_make text; ing jsonb; v_id bigint; ident jsonb; rep jsonb;
  knowledge jsonb; scope bigint[]; last_at timestamptz; n_open int;
begin
  v_vin := upper(btrim(coalesce(p_vin, '')));
  if length(v_vin) < 11 then
    return jsonb_build_object('available', false, 'reason', 'no_vin');
  end if;
  select coalesce(nullif(btrim(v.make), ''), v.nhtsa->>'Make') into v_make
    from public.vehicles v where v.vin = v_vin;
  if v_make is null then
    return jsonb_build_object('available', false, 'reason', 'vehicle_not_decoded');
  end if;
  if not exists (select 1 from mi.brand b where lower(b.name) = lower(btrim(v_make))) then
    return jsonb_build_object('available', false, 'reason', 'brand_not_in_catalog');
  end if;

  ing := mi.ingest_identity_from_check(v_vin);
  v_id := mi.resolve_from_memory(v_vin);
  ident := mi.identity_json(v_id);

  if ident->>'version' is null then
    return jsonb_build_object('available', false, 'reason', 'version_not_identified',
      'identity_id', v_id, 'identity_summary', mi.identity_summary(ident));
  end if;
  if mi.version_year_exclusion(ident) is not null then
    return jsonb_build_object('available', false, 'reason', 'version_excluded_by_model_year',
      'identity_id', v_id, 'identity_summary', mi.identity_summary(ident));
  end if;

  rep := mi.request_pack(ident, 'report');
  -- Плоский перелік того, що MI вже знає про цю машину: текст, тип,
  -- статус застосовності, область. Саме це дослідження отримує як
  -- «відоме», щоб не шукати очевидні дублікати.
  -- Знання про саму версію компілятор кладе у comparisons, права у
  -- entitlements: без них перелік відомого був би неповним.
  knowledge := coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'claim_id', e->'claim_id',
             'area', x.area,
             'kind', x.kind,
             'text', e->>'text',
             'knowledge_type', e->>'knowledge_type',
             'confidence', e->>'confidence',
             'status', e->>'status',
             'importance', e->'buyer_importance',
             'severity', e->'issue'->>'severity',
             'condition', e->>'condition_text')))
      from (
        select s->>'area' as area, k.kind, s->k.kind as items
          from jsonb_array_elements(coalesce(rep->'pack'->'systems', '[]'::jsonb)) s
          cross join (values ('issues'), ('claims'), ('check_items'), ('maintenance')) k(kind)
        union all select 'version', 'comparisons', rep->'pack'->'comparisons'
        union all select 'entitlements', 'entitlements', rep->'pack'->'entitlements'
      ) x
      cross join lateral jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) e), '[]'::jsonb);

  scope := array_remove(array[(ident->>'version')::bigint, (ident->>'generation')::bigint]
           || coalesce((select array_agg((c->>'variant')::bigint)
                          from jsonb_array_elements(coalesce(ident->'components', '[]'::jsonb)) c
                         where c->>'variant' is not null), '{}'::bigint[]), null);
  select max(created_at), count(*) filter (where review_status not in ('approved', 'rejected', 'merged'))
    into last_at, n_open
    from mi.candidate_claim
   where extractor = 'check_research' and resolved_subject_id = any (scope);

  return jsonb_strip_nulls(jsonb_build_object(
    'available', true,
    'identity_id', v_id,
    'identity_precision', case when ident->>'vmy' is not null then 'exact' else 'partial' end,
    'identity', ident - 'vin',
    'identity_summary', mi.identity_summary(ident),
    'pack_available', coalesce((rep->'pack'->>'fragment_available')::boolean,
                               (rep->>'fragment_available')::boolean, false),
    'pack_reason', rep->>'reason',
    'knowledge', knowledge,
    'knowledge_count', jsonb_array_length(knowledge),
    'last_research_at', last_at,
    'open_candidates', n_open,
    'ingest', ing));
end $$;

-- ---------- 2. Збереження знахідок ----------

create or replace function mi.research_persist(p_vin text, p_run jsonb)
returns jsonb language plpgsql as $$
declare
  v_vin text; v_id bigint; ident jsonb; f jsonb; e jsonb; idx int := 0;
  results jsonb := '[]'::jsonb; scope text; sid bigint; pred jsonb; ktype mi.knowledge_type;
  txt text; norm text; cid bigint; is_new boolean; src_id bigint; n_ev int; n_ev_total int;
  gate jsonb; claim_id bigint; st text; failed jsonb; host text; token text;
  n_pub int := 0; n_merged int := 0; n_cand int := 0; n_skip int := 0; n_rebuilt int := 0;
  fr record; conf mi.confidence; layer mi.practice_layer; causal mi.causal_status;
begin
  v_vin := upper(btrim(coalesce(p_vin, '')));
  if length(v_vin) < 11 then
    return jsonb_build_object('ok', false, 'reason', 'no_vin');
  end if;
  token := left(coalesce(p_run->>'check_token', ''), 40);

  -- Той самий міст і резолвер, що в контексті: ідемпотентно, і збереження
  -- не залежить від того, чи контекст читали у цьому ж процесі.
  perform mi.ingest_identity_from_check(v_vin);
  v_id := mi.resolve_from_memory(v_vin);
  ident := mi.identity_json(v_id);
  if ident->>'version' is null then
    return jsonb_build_object('ok', false, 'reason', 'version_not_identified', 'identity_id', v_id);
  end if;

  for f in select x from jsonb_array_elements(
             case when jsonb_typeof(p_run->'findings') = 'array' then p_run->'findings' else '[]'::jsonb end) x loop
    idx := idx + 1;
    scope := f->>'scope';
    sid := null; pred := null; st := null;

    -- Знання про конкретний екземпляр це Vehicle Memory, не MI.
    if scope = 'vehicle' then
      results := results || jsonb_build_object('index', idx, 'status', 'skipped', 'reason', 'vehicle_scope_not_mi');
      n_skip := n_skip + 1; continue;
    end if;

    -- Область субʼєкта не ширша і не точніша за підтверджену ідентичність.
    if scope = 'version' then
      sid := (ident->>'version')::bigint;
      pred := jsonb_build_object('dimension', 'version', 'operator', 'eq', 'ref_subject_id', sid,
                'group_no', 1, 'config_scope', 'na', 'include_revisions', false);
    elsif scope = 'generation' then
      sid := (ident->>'generation')::bigint;
      pred := jsonb_build_object('dimension', 'generation', 'operator', 'eq', 'ref_subject_id', sid,
                'group_no', 1, 'config_scope', 'na', 'include_revisions', false);
    elsif scope = 'component' then
      select (c->>'variant')::bigint into sid
        from jsonb_array_elements(coalesce(ident->'components', '[]'::jsonb)) c
       where c->>'role' = f->>'component_role' and c->>'slot' = 'current'
         and c->>'status' in ('confirmed', 'assumed_factory') and c->>'variant' is not null
       limit 1;
      if sid is not null then
        pred := jsonb_build_object('dimension', 'component_variant', 'operator', 'eq', 'ref_subject_id', sid,
                  'group_no', 1, 'config_scope', 'current', 'include_revisions', false);
      end if;
    end if;
    if sid is null then
      results := results || jsonb_build_object('index', idx, 'status', 'skipped', 'reason', 'scope_not_resolved', 'scope', scope);
      n_skip := n_skip + 1; continue;
    end if;

    begin
      ktype := (f->>'knowledge_type')::mi.knowledge_type;
    exception when others then ktype := null; end;
    txt := btrim(coalesce(f->>'text_en', ''));
    if ktype is null or ktype = 'calcar_synthesis' or length(txt) < 20 then
      results := results || jsonb_build_object('index', idx, 'status', 'skipped', 'reason', 'bad_finding');
      n_skip := n_skip + 1; continue;
    end if;
    conf := case when f->>'confidence' in ('high', 'medium', 'low') then (f->>'confidence')::mi.confidence else 'low' end;
    -- Шар практики дозволений лише субʼєктам-позиціям обслуговування;
    -- знахідки дослідження привʼязуються до версії, покоління чи варіанта.
    layer := null;
    causal := case when f->>'causal_status' in ('observed_association', 'plausible_mechanism', 'supported_cause', 'unknown')
                   then (f->>'causal_status')::mi.causal_status else null end;
    norm := mi.normalize_assertion(txt);

    -- Той самий зміст на тому самому субʼєкті: докази йдуть до наявного
    -- відкритого кандидата, другий не створюється.
    select id into cid from mi.candidate_claim
     where resolved_subject_id = sid and proposed_knowledge_type = ktype
       and mi.normalize_assertion(text_en) = norm
       and review_status not in ('approved', 'rejected', 'merged')
     order by id limit 1;
    is_new := cid is null;
    if is_new then
      insert into mi.candidate_claim (
        task_ref, proposed_subject_text, resolved_subject_id, proposed_knowledge_type,
        text_en, proposed_confidence, proposed_layer, proposed_causal_status,
        proposed_propagation, proposed_applicability,
        proposed_buyer_importance, proposed_buyer_implication_en,
        extractor, review_status, review_note)
      values (
        'R:' || token || ':' || idx,
        (select label from mi.knowledge_subject where id = sid), sid, ktype,
        txt, conf, layer, causal,
        'exact', jsonb_build_array(pred),
        case when (f->>'buyer_importance') ~ '^[1-5]$' then (f->>'buyer_importance')::smallint else null end,
        nullif(btrim(coalesce(f->>'buyer_implication_en', '')), ''),
        'check_research', 'normalized',
        nullif('check research: ' || coalesce(f->>'applicability_note', ''), 'check research: '))
      returning id into cid;
    end if;

    -- Джерела і докази. Джерело дедуплікується природним ключем (адресою),
    -- доказ унікальний на (кандидат, джерело, група незалежності).
    n_ev := 0;
    for e in select x from jsonb_array_elements(
               case when jsonb_typeof(f->'evidence') = 'array' then f->'evidence' else '[]'::jsonb end) x loop
      if coalesce(e->>'url', '') !~ '^https?://' then continue; end if;
      if e->>'source_type' not in ('official', 'legal', 'specialist', 'owner', 'review', 'market', 'vendor', 'aggregator')
         or e->>'quality' not in ('primary', 'secondary', 'low') then continue; end if;
      host := lower(regexp_replace(regexp_replace(e->>'url', '^https?://', ''), '[/?#].*$', ''));
      host := regexp_replace(host, '^www\.', '');
      insert into mi.source (source_type, quality, url, title, platform, lang, retrieved_at, notes)
      values ((e->>'source_type')::mi.source_type, (e->>'quality')::mi.source_quality, e->>'url',
              left(nullif(btrim(coalesce(e->>'title', '')), ''), 300), host, nullif(left(coalesce(e->>'lang', ''), 2), ''),
              now(), 'check_research')
      on conflict on constraint source_natural_key do update
        set retrieved_at = now(), title = coalesce(mi.source.title, excluded.title)
      returning id into src_id;
      insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, excerpt_lang, independence_group, context)
      values (cid, src_id,
              case when e->>'stance' in ('supports', 'contradicts', 'context') then (e->>'stance')::mi.stance else 'supports' end,
              left(nullif(btrim(coalesce(e->>'excerpt', '')), ''), 2000), coalesce(nullif(left(coalesce(e->>'lang', ''), 2), ''), 'en'),
              coalesce(nullif(e->>'independence_group', ''), host),
              jsonb_strip_nulls(jsonb_build_object('check_token', nullif(token, ''), 'mileage_km', e->'mileage_km', 'age_years', e->'age_years')))
      on conflict on constraint candidate_evidence_key do nothing;
      if found then n_ev := n_ev + 1; end if;
    end loop;
    select count(*) into n_ev_total from mi.candidate_evidence where candidate_id = cid;
    if n_ev_total > 0 then
      update mi.candidate_claim set review_status = 'evidence_linked'
       where id = cid and review_status in ('new', 'normalized');
    end if;

    -- Той самий gate, що і для ручних карток. Без override.
    gate := mi.run_gate(cid);
    if coalesce((gate->>'passed')::boolean, false) then
      begin
        claim_id := mi.publish_candidate(cid, 'check-research');
        select case when review_status = 'merged' then 'merged' else 'published' end into st
          from mi.candidate_claim where id = cid;
        if st = 'merged' then n_merged := n_merged + 1; else n_pub := n_pub + 1; end if;
        results := results || jsonb_build_object('index', idx, 'status', st, 'candidate_id', cid,
                     'claim_id', claim_id, 'subject_id', sid, 'scope', scope, 'evidence_added', n_ev, 'new_candidate', is_new);
      exception when others then
        st := 'publish_failed';
        n_cand := n_cand + 1;
        results := results || jsonb_build_object('index', idx, 'status', st, 'candidate_id', cid,
                     'subject_id', sid, 'scope', scope, 'error', left(sqlerrm, 200));
      end;
    else
      failed := coalesce((select jsonb_agg(r->>'code') from jsonb_array_elements(gate->'rules') r
                           where not coalesce((r->>'ok')::boolean, true)), '[]'::jsonb);
      n_cand := n_cand + 1;
      results := results || jsonb_build_object('index', idx, 'status', 'candidate', 'candidate_id', cid,
                   'subject_id', sid, 'scope', scope, 'evidence_added', n_ev, 'evidence_total', n_ev_total,
                   'new_candidate', is_new, 'gate_failed', failed);
    end if;
  end loop;

  -- Публікація інвалідує фрагменти через тригери; воркера черги немає,
  -- тому перезбірка тут, щоб наступний Check не лишився без знань.
  if n_pub > 0 then
    for fr in select vmy_id, purpose from mi.pack_fragment where not valid loop
      perform mi.build_fragment(fr.vmy_id, fr.purpose);
      n_rebuilt := n_rebuilt + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'identity_id', v_id, 'findings', idx,
    'published', n_pub, 'merged', n_merged, 'candidates', n_cand, 'skipped', n_skip,
    'fragments_rebuilt', n_rebuilt, 'results', results);
end $$;

-- ---------- 3. Входи для продукту ----------

create or replace function public.mi_research_context(p_vin text)
returns jsonb language sql security definer set search_path = pg_catalog, mi, mi_vm, public as $$
  select mi.research_context(p_vin);
$$;

create or replace function public.mi_research_persist(p_vin text, p_run jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, mi, mi_vm, public as $$
  select mi.research_persist(p_vin, p_run);
$$;

-- Клієнтські ролі Supabase функцій не бачать, як і mi_shadow_pack.
do $$
declare r text; f text;
begin
  foreach f in array array['public.mi_research_context(text)',
                           'public.mi_research_persist(text, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
end $$;
