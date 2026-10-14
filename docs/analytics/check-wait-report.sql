-- Replace dates with the approved beta cohort; end is exclusive.
-- Keep as_of fixed for reproducible reports. Rates count attempts/jobs, not users.
with f as (select * from public.check_wait_facts('2026-10-15T00:00:00+03','2026-10-25T00:00:00+03',now()))
select count(*) as instrumented_attempts,
 count(*) filter(where started) as check_started,
 count(*) filter(where job_created) as job_created,
 count(*) filter(where server_completed) as server_completed,
 count(*) filter(where first_viewed_at is not null) as first_report_viewed,
 count(*) filter(where outcome='viewed_original_wait') as viewed_original_wait,
 round(100.0*count(*) filter(where outcome='viewed_original_wait')/nullif(count(*) filter(where job_created),0),2) as wait_completion_rate_pct,
 count(*) filter(where outcome in ('left_wait_no_view','left_wait_generation_pending')) as left_wait_no_view,
 count(*) filter(where outcome='lost_contact_unknown') as lost_contact_unknown,
 round(100.0*count(*) filter(where outcome in ('left_wait_no_view','left_wait_generation_pending'))/nullif(count(*) filter(where job_created),0),2) as observed_departure_rate_pct,
 round(100.0*count(*) filter(where outcome='lost_contact_unknown')/nullif(count(*) filter(where job_created),0),2) as lost_contact_rate_pct,
 count(*) filter(where outcome='viewed_after_return') as returned_later,
 round(100.0*count(*) filter(where outcome='viewed_after_return')/nullif(count(*) filter(where job_created),0),2) as returned_later_rate_pct,
 count(*) filter(where ready_unviewed_24h) as ready_not_viewed_within_24h,
 count(*) filter(where outcome='generation_error') as generation_errors,
 count(*) filter(where client_error_seen) as client_errors_observed,
 avg(generation_seconds) filter(where server_completed) as mean_generation_seconds
from f;

-- Duration vs outcome, departure bins and evidence quality. This is association,
-- not a causal estimate; immature jobs and errors are kept separate.
with f as (select * from public.check_wait_facts('2026-10-15T00:00:00+03','2026-10-25T00:00:00+03',now()))
select case when generation_seconds is null then 'pending_or_no_job'
 when generation_seconds<60 then '<60' when generation_seconds<90 then '60-<90'
 when generation_seconds<120 then '90-<120' else '120+' end as generation_bucket,
 outcome,departure_bucket,departure_evidence,count(*) as checks,
 avg(last_presence_seconds) as mean_last_presence_seconds
from f group by 1,2,3,4 order by 1,2,3,4;
-- Check instrumentation coverage separately against check_jobs.created_at.
-- Historical jobs without a binding are UNTRACKED, never labelled abandoned.
