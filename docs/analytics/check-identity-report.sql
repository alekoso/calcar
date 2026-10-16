-- CalCar: хто що перевіряв (лише для job, створених після supabase-check-analytics.sql).
-- Усе за check_jobs.anon_id (calcar_aid автора) і analytics_ref (check_ref у PostHog).
-- Старі job без anon_id у ці зрізи не потрапляють: зворотно їх не привʼязують.

-- 1. Унікальні анонімні автори, Checks і різні авто на автора; повтори того самого VIN
select anon_id,
  count(*) as checks,
  count(*) filter (where status = 'done') as done,
  count(distinct vin) filter (where vin is not null) as distinct_vins,
  count(*) filter (where vin is not null) - count(distinct vin) filter (where vin is not null) as same_vin_rechecks,
  min(created_at) as first_check, max(created_at) as last_check,
  count(distinct date_trunc('day', created_at at time zone 'Europe/Kyiv')) as active_days
from check_jobs
where anon_id is not null and created_at >= :'from'
group by anon_id order by first_check;

-- 2. Повторна перевірка того самого VIN і перевірка другого іншого авто тим самим відвідувачем
select j.anon_id, left(j.vin, 6) || '***' as vin_masked, j.created_at,
  exists (select 1 from check_jobs p where p.anon_id = j.anon_id and p.vin = j.vin and p.created_at < j.created_at) as same_vin_again,
  exists (select 1 from check_jobs p where p.anon_id = j.anon_id and p.vin <> j.vin and p.created_at < j.created_at) as another_car_before
from check_jobs j
where j.anon_id is not null and j.vin is not null and j.created_at >= :'from'
order by j.anon_id, j.created_at;

-- 3. Анонімний автор -> акаунт: там, де той самий Check підтверджений існуючими механізмами
--    (check_wait_attempts.user_id при вході під час Check, opt-in листа, відгук).
select j.anon_id, u.user_id, min(j.created_at) as first_seen, count(*) as checks
from check_jobs j
join lateral (
  select a.user_id from check_wait_attempts a where a.job_token = j.token and a.user_id is not null
  union select j.user_id where j.user_id is not null
  union select f.user_id from report_feedback f where f.anon_id = j.anon_id and f.user_id is not null
) u on true
where j.anon_id is not null
group by j.anon_id, u.user_id;

-- 4. check_ref для звірки з PostHog: подія report_viewed з viewer_role = visitor і тим самим
--    check_ref це перегляд за публічним посиланням, не автор.
select analytics_ref as check_ref, anon_id, status, left(vin, 6) || '***' as vin_masked, created_at
from check_jobs where analytics_ref is not null and created_at >= :'from' order by created_at;
