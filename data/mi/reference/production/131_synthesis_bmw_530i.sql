-- СГЕНЕРОВАНО: data/mi/reference/make-production-bundle.py. Руками не правити.
-- Джерело: 131_synthesis_bmw_530i.sql
--
-- Відмінність від оригіналу рівно одна: помічники завантаження живуть не
-- у pg_temp, а у звичайній схемі mi_load. Це потрібно тому, що продакшн
-- заливається не одним psql-сеансом, а окремими викликами, між якими
-- pg_temp не виживає. Схема mi_load прибирається файлом 999.

-- MI Catalog, картка 1: опори і публікація синтезу CalCar.
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
    ('G-043', array['G-022#a', 'G-023']),
    ('G-044', array['G-001', 'G-016'])
  ) as t(synth, supports) loop
    select array_agg(c.published_claim_id) into ids
      from mi.candidate_claim c
     where c.task_ref = any (r.supports) and c.published_claim_id is not null;
    update mi.candidate_claim
       set proposed_links = jsonb_build_object('supports',
             to_jsonb(coalesce(ids, '{}'::bigint[])::text[])),
           reviewer = 'mi-catalog-card-1-bmw-530i-xdrive'
     where task_ref = r.synth;
  end loop;

  for r in select id from mi.candidate_claim
            where task_ref in ('G-043', 'G-044') order by id loop
    perform mi.run_gate(r.id);
  end loop;
  for r in select id from mi.candidate_claim
            where task_ref in ('G-043', 'G-044')
              and (gate_result->>'passed')::boolean
            order by id loop
    v_id := mi.publish_candidate(r.id, 'mi-catalog-card-1-bmw-530i-xdrive');
  end loop;
end $$;

\o
