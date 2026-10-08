-- Разова корекція даних до міграції 032 (застосована у продакшні
-- 2026-10-08 за дозволом власника). Не схема і не частина ланцюжка
-- up/down: файл лишається як слід того, що саме і чому було змінено.
--
-- До 032 mi.match_version шукав код версії по всьому бренду, і для Porsche
-- Macan S 2021 (Check MF9sY) міст записав у Vehicle Memory спостереження
-- версії "S" від декодера, яке резолвер підтверджував як Porsche Cayenne S
-- 958.1. Після 032 нові машини так не записуються, але старе спостереження
-- лишалось і далі давало Macan чуже знання. Рядок НЕ видаляється: він
-- отримує invalidated_at і причину, як це передбачено контрактом сховища.
-- Зачіпається рівно одне підтверджено несумісне спостереження; масової
-- чистки немає, блок падає, якщо під умову потрапляє не один рядок.

do $$
declare vm text; n int;
begin
  select report->'_meta'->>'vin' into vm from public.check_jobs where left(token, 5) = 'MF9sY' and status = 'done' limit 1;
  update public.vehicle_identity_observation o
     set invalidated_at = now(),
         invalidated_reason = 'rejected_for_resolution: version observation S was written before migration 032 (model-line constraint on mi.match_version) and wrongly resolved Porsche Macan to Porsche Cayenne S 958.1; the brand-wide match is no longer eligible'
   where o.vin = vm and o.dimension = 'version' and o.source_kind = 'vin_decoder' and o.value_text = 'S'
     and o.invalidated_at is null
     and exists (select 1 from public.vehicles v where v.vin = o.vin and lower(v.model) = 'macan');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected exactly one observation, matched %', n; end if;
end $$;

-- Перевірка після корекції (з відкотом, нічого не пише): для того самого VIN
-- збіг версії null, міст версію не пише, резолвер версії не має, контекст
-- дослідження mi_scope = none без знання Cayenne. Результат 2026-10-08:
-- match_version_id=null, bridge_version=null, identity version=null,
-- context scope=none, knowledge=[], cayenne_in_context=false.
