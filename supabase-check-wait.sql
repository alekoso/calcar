-- Apply only after deployment approval. Existing jobs/reports are untouched.
create table if not exists public.check_wait_attempts (
  id uuid primary key,
  secret_hash text not null,
  initial_visit_id uuid not null,
  user_id uuid,
  job_token text unique references public.check_jobs(token) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.check_wait_events (
  check_id uuid not null references public.check_wait_attempts(id),
  visit_id uuid not null,
  seq integer not null check (seq between 0 and 10000),
  kind text not null check (kind in ('started','waiting','resume','heartbeat','hidden','visible','leave','handoff','viewed','client_error','accepted')),
  elapsed_ms bigint not null check (elapsed_ms between 0 and 2678400000),
  visible_ms bigint not null check (visible_ms between 0 and 2678400000),
  stage text not null,
  received_at timestamptz not null default now(),
  primary key(check_id,visit_id,seq)
);
create index if not exists check_wait_attempts_created on public.check_wait_attempts(created_at);
create index if not exists check_wait_events_kind on public.check_wait_events(check_id,kind,received_at);
alter table public.check_wait_attempts enable row level security;
alter table public.check_wait_events enable row level security;
revoke all on public.check_wait_attempts, public.check_wait_events from anon, authenticated;
grant select,insert,update on public.check_wait_attempts to service_role;
grant select,insert on public.check_wait_events to service_role;
-- the retention function below deletes as service_role
grant delete on public.check_wait_attempts, public.check_wait_events to service_role;

create or replace function public.record_check_wait(p_event jsonb,p_secret_hash text,p_initial_visit uuid,p_user_id uuid,p_job_token text default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare a check_wait_attempts; k text := p_event->>'kind'; cid uuid := nullif(p_event->>'check_id','')::uuid;
begin
  if k='started' and cid is not null and p_secret_hash is not null and p_initial_visit is not null then
    insert into check_wait_attempts(id,secret_hash,initial_visit_id,user_id)
    values(cid,p_secret_hash,p_initial_visit,p_user_id) on conflict(id) do nothing;
  end if;
  -- the attempt is addressed by its id (same browser) or, for a view, by the job token
  if cid is not null then select * into a from check_wait_attempts where id=cid for update;
  elsif p_job_token is not null and k='viewed' then select * into a from check_wait_attempts where job_token=p_job_token for update;
  else return false; end if;
  if not found or a.created_at < now()-interval '31 days' then return false; end if;
  if not (coalesce(a.secret_hash=p_secret_hash,false) or coalesce(p_user_id is not null and a.user_id=p_user_id,false)) then return false; end if;
  if p_user_id is not null and a.user_id is not null and p_user_id<>a.user_id then return false; end if;
  -- Bind a verified account only with the initiator's private write credential.
  if a.user_id is null and p_user_id is not null and a.secret_hash=p_secret_hash then
    update check_wait_attempts set user_id=p_user_id where id=a.id and user_id is null;
  end if;
  -- The job binds to the attempt through the private credential only: an
  -- existing job, one attempt per job, never rebound to another job.
  if k='accepted' then
    if p_job_token is null or a.secret_hash is distinct from p_secret_hash then return false; end if;
    if a.job_token is null then
      if not exists(select 1 from check_jobs where token=p_job_token) then return false; end if;
      if exists(select 1 from check_wait_attempts where job_token=p_job_token) then return false; end if;
      update check_wait_attempts set job_token=p_job_token where id=a.id and job_token is null;
      a.job_token := p_job_token;
    elsif a.job_token<>p_job_token then return false; end if;
  end if;
  if k='viewed' and (a.job_token is null or not exists(select 1 from check_jobs where token=a.job_token and status='done')) then return false; end if;
  insert into check_wait_events(check_id,visit_id,seq,kind,elapsed_ms,visible_ms,stage)
  values(a.id,(p_event->>'visit_id')::uuid,(p_event->>'seq')::integer,k,(p_event->>'elapsed_ms')::bigint,(p_event->>'visible_ms')::bigint,p_event->>'stage')
  on conflict(check_id,visit_id,seq) do nothing;
  return true;
end $$;
revoke all on function public.record_check_wait(jsonb,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_check_wait(jsonb,text,uuid,uuid,text) to service_role;

-- Cohort = attempt creation in [from,to); outcomes observed by as_of.
-- Server status is authoritative; no view is not proof of a closed tab.
create or replace function public.check_wait_facts(p_from timestamptz,p_to timestamptz,p_as_of timestamptz default now())
returns table(check_id uuid,started boolean,job_created boolean,server_completed boolean,
  first_viewed_at timestamptz,outcome text,generation_seconds numeric,last_presence_seconds numeric,
  departure_bucket text,departure_evidence text,ready_unviewed_24h boolean,client_error_seen boolean)
language sql stable security invoker set search_path=public as $$
with cohort as (
 select a.*,j.created_at as job_at,j.finished_at,
 case when j.finished_at>p_as_of then 'running' else j.status end as job_status
 from check_wait_attempts a left join check_jobs j on j.token=a.job_token
 where a.created_at>=p_from and a.created_at<p_to and a.created_at<=p_as_of
), events as (
 select e.* from check_wait_events e join cohort c on c.id=e.check_id where e.received_at<=p_as_of
), facts as (
 select c.*,v.received_at as view_at,v.visit_id as view_visit,
 exists(select 1 from events e where e.check_id=c.id and e.kind='started') as did_start,
 exists(select 1 from events e where e.check_id=c.id and e.kind='client_error') as client_error,
 exists(select 1 from events e where e.check_id=c.id and e.visit_id=c.initial_visit_id and e.kind='leave' and (v.received_at is null or e.received_at<=v.received_at)) as left_initial,
 (select max(e.received_at) from events e where e.check_id=c.id) as last_contact,
 (select max(e.elapsed_ms) from events e where e.check_id=c.id and e.visit_id=c.initial_visit_id and e.kind in ('started','waiting','heartbeat','hidden','visible','leave','handoff')) as last_ms,
 (select min(e.elapsed_ms) from events e where e.check_id=c.id and e.visit_id=c.initial_visit_id and e.kind='leave') as leave_ms
 from cohort c left join lateral (
   select e.received_at,e.visit_id from events e where e.check_id=c.id and e.kind='viewed' order by e.received_at,e.seq limit 1
 ) v on true
), classified as (
 select *,case
 when job_status='error' then 'generation_error'
 when view_at is not null and view_visit=initial_visit_id and not left_initial then 'viewed_original_wait'
 when view_at is not null then 'viewed_after_return'
 when job_at is null then 'attempt_without_job'
 when job_status='done' and left_initial then 'left_wait_no_view'
 when left_initial then 'left_wait_generation_pending'
 when coalesce(last_contact,created_at)<p_as_of-interval '45 seconds' then 'lost_contact_unknown'
 else 'still_observing' end as class,
 coalesce(leave_ms,last_ms)/1000.0 as observation_seconds
 from facts
)
select id,did_start,job_at is not null,coalesce(job_status='done',false),view_at,class,
 case when finished_at<=p_as_of then extract(epoch from finished_at-job_at) end,
 last_ms/1000.0,
 case when view_at is not null or observation_seconds is null then null
 when observation_seconds<15 then '0-<15' when observation_seconds<30 then '15-<30'
 when observation_seconds<60 then '30-<60' when observation_seconds<90 then '60-<90' else '90+' end,
 case when view_at is not null then null when leave_ms is not null then 'page_leave_observed'
 when last_ms is not null then 'last_presence_only' else 'no_client_observation' end,
 coalesce(job_status='done' and finished_at<=p_as_of-interval '24 hours' and (view_at is null or view_at>finished_at+interval '24 hours'),false),
 client_error from classified;
$$;
revoke all on function public.check_wait_facts(timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.check_wait_facts(timestamptz,timestamptz,timestamptz) to service_role;

-- Retention: telemetry older than the window goes; nothing else is touched.
-- Not scheduled here (pg_cron is the owner's call); run by the service role.
create or replace function public.check_wait_prune(p_keep interval default interval '180 days')
returns integer language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  delete from check_wait_events where check_id in (select id from check_wait_attempts where created_at < now()-p_keep);
  delete from check_wait_attempts where created_at < now()-p_keep;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.check_wait_prune(interval) from public,anon,authenticated;
grant execute on function public.check_wait_prune(interval) to service_role;
