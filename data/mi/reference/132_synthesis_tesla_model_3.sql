-- MI Catalog, картка 2: опори і публікація синтезу CalCar (Tesla Model 3 Long Range AWD).
--
-- 130_publish.sql уже прогнав перевірку якості для всіх кандидатів і
-- опублікував звичайні клейми картки. Синтез існує лише поверх ОПУБЛІКОВАНИХ
-- клеймів двох типів знання, тому опори підставляються тут, після 130, а
-- потім gate проганяється ще раз і синтез публікується без override.
--
-- Рецензентом названо саму операцію картки: вона відтворювана і
-- зафіксована у репозиторії, як і у Phase 3.

\o /dev/null

do $$
declare r record; ids bigint[]; v_id bigint;
begin
  for r in select * from (values
    ('M-052', array['M-009', 'M-035']),
    ('M-053', array['M-007', 'M-021'])
  ) as t(synth, supports) loop
    select array_agg(c.published_claim_id) into ids
      from mi.candidate_claim c
     where c.task_ref = any (r.supports) and c.published_claim_id is not null;
    update mi.candidate_claim
       set proposed_links = jsonb_build_object('supports',
             to_jsonb(coalesce(ids, '{}'::bigint[])::text[])),
           reviewer = 'mi-catalog-card-2-tesla-model-3-lr-awd'
     where task_ref = r.synth;
  end loop;

  for r in select id from mi.candidate_claim
            where task_ref in ('M-052', 'M-053') order by id loop
    perform mi.run_gate(r.id);
  end loop;
  for r in select id from mi.candidate_claim
            where task_ref in ('M-052', 'M-053')
              and (gate_result->>'passed')::boolean
            order by id loop
    v_id := mi.publish_candidate(r.id, 'mi-catalog-card-2-tesla-model-3-lr-awd');
  end loop;
end $$;

\o
