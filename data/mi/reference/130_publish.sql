-- Phase 3 back-loading: перевірка якості і публікація.
--
-- Порядок обовʼязковий: спершу публікуються звичайні клейми, потім
-- синтезу проставляються опори (вони існують лише як опубліковані
-- клейми), потім публікується сам синтез.
--
-- Жоден кандидат не публікується через override. Якщо gate не пропускає
-- кандидата, він лишається у staging зі збереженим gate_result, і саме це
-- видно у таблиці покриття як статус blocked.

\o /dev/null

-- ---------- 1. Перевірка якості для КОЖНОГО кандидата ----------

do $$
declare r record;
begin
  for r in select id from mi.candidate_claim order by id loop
    perform mi.run_gate(r.id);
  end loop;
end $$;

-- ---------- 2. Публікація всього, крім синтезу ----------

do $$
declare r record; v_id bigint;
begin
  for r in select id from mi.candidate_claim
            where proposed_knowledge_type <> 'calcar_synthesis'
              and (gate_result->>'passed')::boolean
            order by id loop
    v_id := mi.publish_candidate(r.id, 'phase3-reference-backload');
  end loop;
end $$;

-- ---------- 3. Опори синтезу ----------

-- Опора це ОПУБЛІКОВАНИЙ клейм, тому мапа задана у термінах атомів, а
-- id підставляються після публікації звичайних клеймів.
do $$
declare r record; ids bigint[];
begin
  for r in select * from (values
    ('C-015',    array['C-001','C-127#b']),
    ('C-024',    array['C-020','C-036#a']),
    ('C-043#b',  array['C-043#a','C-030']),
    ('C-056',    array['C-049#a','C-048#a']),
    ('C-068',    array['C-060','C-063#a']),
    ('C-125#b',  array['C-127#a','C-048#a']),
    ('C-134',    array['C-130#a','C-132']),
    ('C-135',    array['C-132','C-051']),
    ('C-140#b',  array['C-140#a','C-051']),
    ('C-146',    array['C-110','C-036#a']),
    ('T-044',    array['T-040#a','T-041#b']),
    ('P-028#a',  array['P-001','P-009']),
    ('P-042',    array['P-003#a','P-028#b'])
  ) as t(synth, supports) loop
    select array_agg(c.published_claim_id) into ids
      from mi.candidate_claim c
     where c.task_ref = any (r.supports) and c.published_claim_id is not null;

    update mi.candidate_claim
       set proposed_links = jsonb_build_object('supports',
             to_jsonb(coalesce(ids, '{}'::bigint[])::text[]))
     where task_ref = r.synth;
  end loop;
end $$;

-- Крок ревʼю: синтез CalCar у v1 вимагає названого рецензента, і саме
-- рецензент, а не автоматика, вирішує, що опори підібрані правильно.
-- Для back-loading рецензентом названа сама операція завантаження: вона
-- відтворювана і зафіксована у репозиторії.
update mi.candidate_claim
   set reviewer = 'phase3-reference-backload'
 where proposed_knowledge_type = 'calcar_synthesis';

-- Перевірка якості для синтезу прогоняється ще раз: опори зʼявились.
do $$
declare r record;
begin
  for r in select id from mi.candidate_claim
            where proposed_knowledge_type = 'calcar_synthesis' order by id loop
    perform mi.run_gate(r.id);
  end loop;
end $$;

-- ---------- 4. Публікація синтезу ----------

do $$
declare r record; v_id bigint;
begin
  for r in select id from mi.candidate_claim
            where proposed_knowledge_type = 'calcar_synthesis'
              and (gate_result->>'passed')::boolean
            order by id loop
    v_id := mi.publish_candidate(r.id, 'phase3-reference-backload');
  end loop;
end $$;

\o
