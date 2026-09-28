-- Міграція 29: MI Research v1.1. Холодний старт, памʼять кандидатів,
-- життєвий цикл проблеми.
--
-- Що змінюється відносно 028 (усе аддитивно, дані не переписуються):
--
-- 1. mi.research_context(vin, identity). Дослідження більше не вимагає
--    розвʼязаної версії каталогу: придатність до дослідження і
--    застосовність публікації це різні питання. Check передає свою
--    канонічну ідентичність (бренд, ряд, покоління, версія і мотор лише з
--    декодера, модельний рік). Якщо бренд є в каталозі, працює той самий
--    міст і резолвер; субʼєкт покоління шукається за кодом платформи навіть
--    без версії. Відповідь несе mi_scope (version, generation, none),
--    ідентифікатори субʼєктів, наявне знання і ПАМʼЯТЬ ДОСЛІДЖЕННЯ:
--    відкриті кандидати цієї ідентичності з їхніми доказами і причинами
--    непроходження gate. Наступний Check не відкриває той самий факт ще
--    раз, а шукає сильніші докази і додає їх до наявного кандидата.
--
-- 2. mi.research_persist(vin, run). Область субʼєкта не розширюється і не
--    вигадується: знахідка версії без субʼєкта версії НЕ падає на
--    покоління, а лишається холодним кандидатом без розвʼязаного субʼєкта
--    (proposed_subject_text = мітка ідентичності, застосовності немає).
--    Такий кандидат не пройде gate (subject_resolved), поки каталог не
--    отримає субʼєкт, і це правильно: докази збережені, публікації немає.
--    Знахідка з candidate_id додає докази до наявного кандидата. Метадані
--    життєвого циклу (lifecycle, remedy, verify_on_vehicle, affected_scope,
--    evidence_period, source_date, current_relevance) живуть у
--    candidate_evidence.context, який публікація копіює в evidence.context:
--    окремої таксономії у схемі не заводиться.
--
-- Gate, publish_candidate і компілятор не змінюються.

-- ---------- 1. Контекст дослідження ----------

-- Однопараметрові версії з 028 прибираються, а нові сигнатури свідомо без
-- типових значень: тоді 1-аргументний і 2-аргументний виклики ніколи не
-- стають неоднозначними, навіть якщо 028 колись застосують повторно.
drop function if exists public.mi_research_context(text);
drop function if exists mi.research_context(text);
drop function if exists public.mi_research_context(text, jsonb);
drop function if exists mi.research_context(text, jsonb);

create or replace function mi.research_context(p_vin text, p_identity jsonb)
returns jsonb language plpgsql as $$
declare
  v_vin text; v_make text; v_line text; v_gen text; v_label text;
  b_id bigint; l_id bigint; g_id bigint; ing jsonb := null; v_id bigint; ident jsonb := null; rep jsonb := null;
  knowledge jsonb := '[]'::jsonb; scope bigint[]; last_at timestamptz; cands jsonb; mi_scope text := 'none';
  version_id bigint; summary jsonb := null; precision text := null;
begin
  v_vin := upper(btrim(coalesce(p_vin, '')));
  v_label := left(btrim(coalesce(p_identity->>'label', '')), 120);
  v_make := coalesce(nullif(btrim(coalesce(p_identity->>'brand', '')), ''),
                     (select coalesce(nullif(btrim(v.make), ''), v.nhtsa->>'Make') from public.vehicles v where v.vin = v_vin));
  v_line := nullif(btrim(coalesce(p_identity->>'model_line', '')), '');
  v_gen := nullif(btrim(coalesce(p_identity->>'generation', '')), '');
  if v_make is null then
    return jsonb_build_object('available', false, 'reason', 'no_identity', 'mi_scope', 'none');
  end if;

  select subject_id into b_id from mi.brand where lower(name) = lower(v_make);
  if b_id is not null then
    -- Бренд у каталозі: той самий міст і резолвер, що і раніше.
    if length(v_vin) >= 11 and exists (select 1 from public.vehicles v where v.vin = v_vin) then
      ing := mi.ingest_identity_from_check(v_vin);
      v_id := mi.resolve_from_memory(v_vin);
      ident := mi.identity_json(v_id);
      version_id := (ident->>'version')::bigint;
      g_id := (ident->>'generation')::bigint;
      l_id := (ident->>'model_line')::bigint;
      summary := mi.identity_summary(ident);
      if version_id is not null and mi.version_year_exclusion(ident) is not null then
        version_id := null;
        summary := summary || jsonb_build_object('version_note', 'known model year lies outside the catalogue years of the matched version');
      end if;
    end if;
    -- Покоління за кодом платформи з канонічної ідентичності Check, коли
    -- резолвер його не дав. Код мусить збігатися з каталогом: "958.1" до
    -- "958", "G30" до "G30"; нічого не вгадується.
    if l_id is null and v_line is not null then
      select subject_id into l_id from mi.model_line where brand_id = b_id and lower(name) = lower(v_line);
    end if;
    if g_id is null and l_id is not null and v_gen is not null then
      select subject_id into g_id from mi.generation g
       where g.model_line_id = l_id and g.phase = 'base'
         and (upper(g.platform_code) = upper(v_gen) or upper(v_gen) like upper(g.platform_code) || '.%')
       order by subject_id limit 1;
    end if;
    mi_scope := case when version_id is not null then 'version' when g_id is not null then 'generation' else 'none' end;

    if version_id is not null then
      rep := mi.request_pack(ident, 'report');
      knowledge := coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'claim_id', e->'claim_id', 'area', x.area, 'kind', x.kind, 'text', e->>'text',
                 'knowledge_type', e->>'knowledge_type', 'confidence', e->>'confidence', 'status', e->>'status',
                 'importance', e->'buyer_importance', 'severity', e->'issue'->>'severity', 'condition', e->>'condition_text')))
          from (
            select s->>'area' as area, k.kind, s->k.kind as items
              from jsonb_array_elements(coalesce(rep->'pack'->'systems', '[]'::jsonb)) s
              cross join (values ('issues'), ('claims'), ('check_items'), ('maintenance')) k(kind)
            union all select 'version', 'comparisons', rep->'pack'->'comparisons'
            union all select 'entitlements', 'entitlements', rep->'pack'->'entitlements'
          ) x cross join lateral jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) e), '[]'::jsonb);
    elsif g_id is not null then
      -- Без версії пакета немає; відоме на самому поколінні береться прямо.
      knowledge := coalesce((
        select jsonb_agg(jsonb_build_object('claim_id', c.id, 'area', 'generation', 'kind', 'generation_claims',
                 'text', c.text_en, 'knowledge_type', c.knowledge_type, 'confidence', c.confidence,
                 'status', 'APPLICABLE', 'importance', c.buyer_importance) order by c.buyer_importance desc, c.id)
          from mi.claim c where c.status = 'published' and c.subject_id = g_id), '[]'::jsonb);
    end if;
  end if;

  scope := array_remove(array[version_id, g_id]
           || coalesce((select array_agg((c->>'variant')::bigint)
                          from jsonb_array_elements(coalesce(ident->'components', '[]'::jsonb)) c
                         where c->>'variant' is not null), '{}'::bigint[]), null);

  -- Памʼять дослідження: відкриті кандидати цієї ідентичності (за субʼєктом
  -- або, для холодних, за міткою) з доказами і причинами непроходження gate.
  cands := coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'text', c.text_en, 'knowledge_type', c.knowledge_type_txt, 'status', c.review_status,
             'subject_id', c.resolved_subject_id, 'cold', c.resolved_subject_id is null,
             'created_at', c.created_at, 'note', left(c.review_note, 240),
             'gate_failed', (select coalesce(jsonb_agg(r->>'code'), '[]'::jsonb) from jsonb_array_elements(coalesce(c.gate_result->'rules', '[]'::jsonb)) r where not coalesce((r->>'ok')::boolean, true)),
             'evidence_count', (select count(*) from mi.candidate_evidence ce where ce.candidate_id = c.id),
             'hosts', (select coalesce(jsonb_agg(distinct s.platform), '[]'::jsonb) from mi.candidate_evidence ce join mi.source s on s.id = ce.source_id where ce.candidate_id = c.id),
             'lifecycle', (select ce.context->>'lifecycle' from mi.candidate_evidence ce where ce.candidate_id = c.id and ce.context ? 'lifecycle' order by ce.id desc limit 1))
             order by c.id)
      from (select cc.*, cc.proposed_knowledge_type::text as knowledge_type_txt from mi.candidate_claim cc
             where cc.extractor = 'check_research' and cc.review_status not in ('approved', 'rejected', 'merged')
               and ((cardinality(scope) > 0 and cc.resolved_subject_id = any (scope))
                    or (cc.resolved_subject_id is null and v_label <> '' and lower(cc.proposed_subject_text) = lower(v_label)))) c), '[]'::jsonb);

  select max(created_at) into last_at from mi.candidate_claim
   where extractor = 'check_research'
     and ((cardinality(scope) > 0 and resolved_subject_id = any (scope))
          or (resolved_subject_id is null and v_label <> '' and lower(proposed_subject_text) = lower(v_label)));

  return jsonb_strip_nulls(jsonb_build_object(
    'available', true,
    'mi_scope', mi_scope,
    'catalog_brand', b_id is not null,
    'subjects', jsonb_strip_nulls(jsonb_build_object('brand', b_id, 'model_line', l_id, 'generation', g_id, 'version', version_id,
                  'vmy', (ident->>'vmy')::bigint)),
    'identity_id', v_id,
    'identity_precision', case when ident->>'vmy' is not null then 'exact' when version_id is not null then 'partial' else null end,
    'identity', case when ident is null then null else ident - 'vin' end,
    'identity_summary', summary,
    'pack_available', case when rep is null then null else coalesce((rep->'pack'->>'fragment_available')::boolean, (rep->>'fragment_available')::boolean, false) end,
    'knowledge', knowledge,
    'knowledge_count', jsonb_array_length(knowledge),
    'open_candidates', cands,
    'open_candidates_count', jsonb_array_length(cands),
    'last_research_at', last_at,
    'ingest', ing));
end $$;

-- ---------- 2. Збереження знахідок ----------

create or replace function mi.research_persist(p_vin text, p_run jsonb)
returns jsonb language plpgsql as $$
declare
  v_vin text; v_make text; v_line text; v_gen text; v_label text; b_id bigint; l_id bigint; g_id bigint;
  v_id bigint; ident jsonb := null; f jsonb; e jsonb; idx int := 0;
  results jsonb := '[]'::jsonb; scope text; sid bigint; pred jsonb; ktype mi.knowledge_type;
  txt text; norm text; cid bigint; is_new boolean; src_id bigint; n_ev int; n_ev_total int;
  gate jsonb; claim_id bigint; st text; failed jsonb; host text; token text; attach_id bigint; cold boolean;
  n_pub int := 0; n_merged int := 0; n_cand int := 0; n_skip int := 0; n_rebuilt int := 0; n_cold int := 0;
  fr record; conf mi.confidence; causal mi.causal_status; lc jsonb;
begin
  v_vin := upper(btrim(coalesce(p_vin, '')));
  token := left(coalesce(p_run->>'check_token', ''), 40);
  v_label := left(btrim(coalesce(p_run->'identity'->>'label', '')), 120);
  v_make := coalesce(nullif(btrim(coalesce(p_run->'identity'->>'brand', '')), ''),
                     (select coalesce(nullif(btrim(v.make), ''), v.nhtsa->>'Make') from public.vehicles v where v.vin = v_vin));
  v_line := nullif(btrim(coalesce(p_run->'identity'->>'model_line', '')), '');
  v_gen := nullif(btrim(coalesce(p_run->'identity'->>'generation', '')), '');

  if v_make is not null then
    select subject_id into b_id from mi.brand where lower(name) = lower(v_make);
  end if;
  if b_id is not null and length(v_vin) >= 11 and exists (select 1 from public.vehicles v where v.vin = v_vin) then
    perform mi.ingest_identity_from_check(v_vin);
    v_id := mi.resolve_from_memory(v_vin);
    ident := mi.identity_json(v_id);
    if ident->>'version' is not null and mi.version_year_exclusion(ident) is not null then
      ident := ident - 'version' - 'vmy';
    end if;
    g_id := (ident->>'generation')::bigint;
    l_id := (ident->>'model_line')::bigint;
  end if;
  if b_id is not null and l_id is null and v_line is not null then
    select subject_id into l_id from mi.model_line where brand_id = b_id and lower(name) = lower(v_line);
  end if;
  if b_id is not null and g_id is null and l_id is not null and v_gen is not null then
    select subject_id into g_id from mi.generation g
     where g.model_line_id = l_id and g.phase = 'base'
       and (upper(g.platform_code) = upper(v_gen) or upper(v_gen) like upper(g.platform_code) || '.%')
     order by subject_id limit 1;
  end if;
  if v_label = '' and (ident->>'version') is null and g_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_identity');
  end if;

  for f in select x from jsonb_array_elements(
             case when jsonb_typeof(p_run->'findings') = 'array' then p_run->'findings' else '[]'::jsonb end) x loop
    idx := idx + 1;
    scope := f->>'scope';
    sid := null; pred := null; st := null; cold := false;

    if scope = 'vehicle' then
      results := results || jsonb_build_object('index', idx, 'status', 'skipped', 'reason', 'vehicle_scope_not_mi');
      n_skip := n_skip + 1; continue;
    end if;

    -- Субʼєкт не ширший і не точніший за підтверджену ідентичність. Версія
    -- без субʼєкта версії НЕ падає на покоління: це розширило б
    -- застосовність. Вона стає холодним кандидатом без субʼєкта.
    if scope = 'version' and (ident->>'version') is not null then
      sid := (ident->>'version')::bigint;
      pred := jsonb_build_object('dimension', 'version', 'operator', 'eq', 'ref_subject_id', sid,
                'group_no', 1, 'config_scope', 'na', 'include_revisions', false);
    elsif scope = 'generation' and g_id is not null then
      sid := g_id;
      pred := jsonb_build_object('dimension', 'generation', 'operator', 'eq', 'ref_subject_id', sid,
                'group_no', 1, 'config_scope', 'na', 'include_revisions', false);
    elsif scope = 'component' then
      select (c->>'variant')::bigint into sid
        from jsonb_array_elements(coalesce(ident->'components', '[]'::jsonb)) c
       where c->>'role' = f->>'component_role' and c->>'slot' = 'current'
         and c->>'status' in ('confirmed', 'assumed_factory') and c->>'variant' is not null
       limit 1;
      if sid is null then
        results := results || jsonb_build_object('index', idx, 'status', 'skipped', 'reason', 'scope_not_resolved', 'scope', scope);
        n_skip := n_skip + 1; continue;
      end if;
      pred := jsonb_build_object('dimension', 'component_variant', 'operator', 'eq', 'ref_subject_id', sid,
                'group_no', 1, 'config_scope', 'current', 'include_revisions', false);
    elsif scope in ('version', 'generation') then
      if v_label = '' then
        results := results || jsonb_build_object('index', idx, 'status', 'skipped', 'reason', 'scope_not_resolved', 'scope', scope);
        n_skip := n_skip + 1; continue;
      end if;
      cold := true;
    else
      results := results || jsonb_build_object('index', idx, 'status', 'skipped', 'reason', 'bad_scope');
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
    causal := case when f->>'causal_status' in ('observed_association', 'plausible_mechanism', 'supported_cause', 'unknown')
                   then (f->>'causal_status')::mi.causal_status else null end;
    norm := mi.normalize_assertion(txt);
    lc := jsonb_strip_nulls(jsonb_build_object(
            'lifecycle', nullif(f->>'lifecycle', ''), 'current_relevance', nullif(f->>'current_relevance', ''),
            'remedy', left(nullif(f->>'remedy', ''), 300), 'verify_on_vehicle', left(nullif(f->>'verify_on_vehicle', ''), 300),
            'affected_scope', left(nullif(f->>'affected_scope', ''), 300), 'evidence_period', left(nullif(f->>'evidence_period', ''), 60)));

    -- Явне посилення наявного кандидата з памʼяті дослідження.
    cid := null;
    attach_id := case when (f->>'candidate_id') ~ '^[0-9]+$' then (f->>'candidate_id')::bigint end;
    if attach_id is not null then
      select id into cid from mi.candidate_claim
       where id = attach_id and extractor = 'check_research'
         and review_status not in ('approved', 'rejected', 'merged')
         and (resolved_subject_id is not distinct from sid);
    end if;
    -- Той самий зміст на тому самому субʼєкті (або та сама мітка для
    -- холодного): другого кандидата немає.
    if cid is null then
      select id into cid from mi.candidate_claim
       where proposed_knowledge_type = ktype and mi.normalize_assertion(text_en) = norm
         and review_status not in ('approved', 'rejected', 'merged')
         and ((sid is not null and resolved_subject_id = sid)
              or (sid is null and resolved_subject_id is null and lower(proposed_subject_text) = lower(v_label)))
       order by id limit 1;
    end if;
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
        case when sid is null then v_label else (select label from mi.knowledge_subject where id = sid) end, sid, ktype,
        txt, conf, null, causal,
        'exact', case when pred is null then null else jsonb_build_array(pred) end,
        case when (f->>'buyer_importance') ~ '^[1-5]$' then (f->>'buyer_importance')::smallint else null end,
        nullif(btrim(coalesce(f->>'buyer_implication_en', '')), ''),
        'check_research', 'normalized',
        nullif(concat_ws(' | ',
          nullif('check research: ' || coalesce(f->>'applicability_note', ''), 'check research: '),
          case when cold then 'cold identity, subject not in catalogue: ' || scope || ' scope of ' || v_label end,
          case when lc ? 'lifecycle' then 'lifecycle: ' || (lc->>'lifecycle') end,
          case when lc ? 'remedy' then 'remedy: ' || (lc->>'remedy') end,
          case when lc ? 'verify_on_vehicle' then 'verify: ' || (lc->>'verify_on_vehicle') end), ''))
      returning id into cid;
    end if;

    n_ev := 0;
    for e in select x from jsonb_array_elements(
               case when jsonb_typeof(f->'evidence') = 'array' then f->'evidence' else '[]'::jsonb end) x loop
      if coalesce(e->>'url', '') !~ '^https?://' then continue; end if;
      if e->>'source_type' not in ('official', 'legal', 'specialist', 'owner', 'review', 'market', 'vendor', 'aggregator')
         or e->>'quality' not in ('primary', 'secondary', 'low') then continue; end if;
      host := lower(regexp_replace(regexp_replace(e->>'url', '^https?://', ''), '[/?#].*$', ''));
      host := regexp_replace(host, '^www\.', '');
      insert into mi.source (source_type, quality, url, title, platform, lang, published_at, retrieved_at, notes)
      values ((e->>'source_type')::mi.source_type, (e->>'quality')::mi.source_quality, e->>'url',
              left(nullif(btrim(coalesce(e->>'title', '')), ''), 300), host, nullif(left(coalesce(e->>'lang', ''), 2), ''),
              case when (e->>'source_date') ~ '^\d{4}-\d{2}-\d{2}$' then (e->>'source_date')::date end,
              now(), 'check_research')
      on conflict on constraint source_natural_key do update
        set retrieved_at = now(), title = coalesce(mi.source.title, excluded.title),
            published_at = coalesce(mi.source.published_at, excluded.published_at)
      returning id into src_id;
      insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt, excerpt_lang, independence_group, context)
      values (cid, src_id,
              case when e->>'stance' in ('supports', 'contradicts', 'context') then (e->>'stance')::mi.stance else 'supports' end,
              left(nullif(btrim(coalesce(e->>'excerpt', '')), ''), 2000), coalesce(nullif(left(coalesce(e->>'lang', ''), 2), ''), 'en'),
              coalesce(nullif(e->>'independence_group', ''), host),
              lc || jsonb_strip_nulls(jsonb_build_object('check_token', nullif(token, ''),
                      'source_date', nullif(e->>'source_date', ''), 'evidence_date', nullif(e->>'evidence_date', ''),
                      'mileage_km', e->'mileage_km', 'age_years', e->'age_years')))
      on conflict on constraint candidate_evidence_key do nothing;
      if found then n_ev := n_ev + 1; end if;
    end loop;
    select count(*) into n_ev_total from mi.candidate_evidence where candidate_id = cid;
    if n_ev_total > 0 then
      update mi.candidate_claim set review_status = 'evidence_linked'
       where id = cid and review_status in ('new', 'normalized');
    end if;

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
      if cold then n_cold := n_cold + 1; else n_cand := n_cand + 1; end if;
      results := results || jsonb_build_object('index', idx, 'status', case when cold then 'staged_cold' else 'candidate' end,
                   'candidate_id', cid, 'subject_id', sid, 'scope', scope, 'evidence_added', n_ev, 'evidence_total', n_ev_total,
                   'new_candidate', is_new, 'strengthened', (not is_new) and n_ev > 0, 'gate_failed', failed);
    end if;
  end loop;

  if n_pub > 0 then
    for fr in select vmy_id, purpose from mi.pack_fragment where not valid loop
      perform mi.build_fragment(fr.vmy_id, fr.purpose);
      n_rebuilt := n_rebuilt + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'identity_id', v_id, 'findings', idx,
    'published', n_pub, 'merged', n_merged, 'candidates', n_cand, 'staged_cold', n_cold, 'skipped', n_skip,
    'fragments_rebuilt', n_rebuilt, 'results', results);
end $$;

-- ---------- 3. Входи для продукту ----------

create or replace function public.mi_research_context(p_vin text, p_identity jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, mi, mi_vm, public as $$
  select mi.research_context(p_vin, p_identity);
$$;

create or replace function public.mi_research_persist(p_vin text, p_run jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, mi, mi_vm, public as $$
  select mi.research_persist(p_vin, p_run);
$$;

do $$
declare r text; f text;
begin
  foreach f in array array['public.mi_research_context(text, jsonb)',
                           'public.mi_research_persist(text, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
end $$;
