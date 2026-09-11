-- Phase 7.2: симуляція часткової ідентичності. Звіт: partial-identity-audit.md
-- Лише читання: усе виконується в транзакції з відкатом.
-- База: міграції 001..019 і еталонний корпус, без тестових фікстур.

-- Симуляція часткової ідентичності на ЧИСТОМУ корпусі, без жодних змін
-- схеми і компілятора. Використовується лише наявний mi.eval_claim.
-- Транзакція відкочується.
begin;

-- Часткова ідентичність: лише те, що випливає з версії вкладеністю.
-- Компоненти НЕ припускаються: без VMY немає документованої заводської
-- конфігурації, з якої припущення взялося б.
create function pg_temp.ident_partial(p_version bigint, p_year int) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'brand', m.brand_id, 'model_line', g.model_line_id,
           'generation', v.generation_id, 'version', v.subject_id,
           'model_year', p_year)) || jsonb_build_object('components', '[]'::jsonb)
    from mi.vehicle_version v
    join mi.generation g on g.subject_id = v.generation_id
    join mi.model_line m on m.subject_id = g.model_line_id
   where v.subject_id = p_version $$;

-- Повна ідентичність VMY так, як її сьогодні будує резолвер.
create function pg_temp.ident_full(p_vmy bigint) returns jsonb
language sql stable as $$
  select pg_temp.ident_partial(y.version_id, y.model_year)
         || jsonb_build_object('vmy', y.subject_id, 'market_sold', y.market_code,
            'components', coalesce((
              select jsonb_agg(jsonb_build_object('role', f.role_code, 'slot', s.slot,
                       'variant', f.variant_id, 'status', 'assumed_factory'))
                from mi.version_fitment f cross join (values ('factory'), ('current')) s(slot)
               where f.vmy_id = y.subject_id and f.fitment = 'standard'
                 and f.prod_from_kind <> 'unknown' and f.prod_to_kind <> 'unknown'
                 and (select count(*) from mi.version_fitment f2
                       where f2.vmy_id = f.vmy_id and f2.role_code = f.role_code
                         and f2.fitment = 'standard') = 1), '[]'::jsonb))
    from mi.version_market_year y where y.subject_id = p_vmy $$;

-- H: знання, яке дістає машину лише через вкладеність у версію.
create function pg_temp.hier_claims(p_version bigint) returns setof bigint
language sql stable as $$
  with h as (
    select v.subject_id as version_id, v.generation_id, g.phase_of_id, g.model_line_id, m.brand_id
      from mi.vehicle_version v
      join mi.generation g on g.subject_id = v.generation_id
      join mi.model_line m on m.subject_id = g.model_line_id
     where v.subject_id = p_version),
  nodes as (
    select version_id as sid, false as policy from h
    union all select generation_id, false from h
    union all select phase_of_id, false from h where phase_of_id is not null
    union all select model_line_id, true from h
    union all select brand_id, true from h),
  about as (
    select i.subject_id from mi.issue i where i.status = 'active' and i.about_subject_id in (select sid from nodes)
    union all select mm.subject_id from mi.maintenance_item mm where mm.about_subject_id in (select sid from nodes)
    union all select ci.subject_id from mi.check_item ci where ci.scope_subject_id in (select sid from nodes)
    union all select st.subject_id from mi.component_state_type st where st.applies_to_subject_id in (select sid from nodes))
  select c.id from mi.claim c
   where c.status = 'published'
     and (c.subject_id in (select sid from nodes where not policy)
          or (c.subject_id in (select sid from nodes where policy) and c.propagation = 'descendants')
          or c.subject_id in (select subject_id from about)) $$;

create temporary table sim (
  scenario text, claim_id bigint, bucket text, status text, leak text);

create function pg_temp.run(p_label text, p_version_code text, p_year int) returns void
language plpgsql as $$
declare v_ver bigint; ident jsonb; c record; st text; k record; lk text; bucket text;
begin
  select subject_id into v_ver from mi.vehicle_version where version_code = p_version_code;
  ident := pg_temp.ident_partial(v_ver, p_year);

  create temporary table if not exists cand (vmy_id bigint) on commit drop;
  delete from cand;
  insert into cand select subject_id from mi.version_market_year
   where version_id = v_ver and (p_year is null or model_year = p_year);

  for c in
    select id, 'H' as b from mi.claim where id in (select pg_temp.hier_claims(v_ver))
    union
    -- F: знання, яке дістає машину через заводську конфігурацію
    -- кандидатних VMY (варіанти, родини, обладнання) і не є якорем на VMY.
    select cl.id, 'F' from mi.claim cl
     where cl.status = 'published'
       and cl.id not in (select pg_temp.hier_claims(v_ver))
       and (select kind from mi.knowledge_subject where id = cl.subject_id) <> 'version_market_year'
       and exists (select 1 from cand where mi.claim_in_scope(cl.id, cand.vmy_id))
    union
    -- V: знання про сам VMY. Без VMY воно не має субʼєкта.
    select cl.id, 'V' from mi.claim cl
     where cl.status = 'published'
       and cl.subject_id in (select vmy_id from cand)
  loop
    bucket := c.b;
    if bucket = 'V' then
      insert into sim values (p_label, c.id, bucket, 'OUT_OF_PARTIAL_SCOPE', null);
      continue;
    end if;
    st := mi.eval_claim(c.id, ident)->>'status';
    lk := null;
    -- Витік: часткова ідентичність каже «застосовно», а хоча б один
    -- кандидатний VMY з повною ідентичністю каже «ні» або не бачить клейма.
    if st like 'APPLICABLE%' then
      for k in select vmy_id from cand loop
        if not mi.claim_in_scope(c.id, k.vmy_id) then
          lk := coalesce(lk || ';', '') || 'not_in_scope:' || k.vmy_id;
        elsif (mi.eval_claim(c.id, pg_temp.ident_full(k.vmy_id))->>'status') like 'EXCLUDED%' then
          lk := coalesce(lk || ';', '') || 'excluded:' || k.vmy_id;
        end if;
      end loop;
    end if;
    insert into sim values (p_label, c.id, bucket, st, lk);
  end loop;
end $$;

-- Базова лінія: те, що бачить сьогоднішній VMY-шлях.
create function pg_temp.run_full(p_label text, p_version_code text, p_market text, p_year int) returns void
language plpgsql as $$
declare v_vmy bigint; ident jsonb;
begin
  select y.subject_id into v_vmy from mi.version_market_year y
    join mi.vehicle_version v on v.subject_id = y.version_id
   where v.version_code = p_version_code and y.market_code = p_market and y.model_year = p_year;
  ident := pg_temp.ident_full(v_vmy);
  insert into sim
  select p_label, c.id, 'FULL', mi.eval_claim(c.id, ident)->>'status', null
    from mi.claim c where c.status = 'published' and mi.claim_in_scope(c.id, v_vmy);
end $$;

select pg_temp.run_full('BMW  S0 VMY US/2018',        'M550I_XDRIVE', 'US', 2018);
select pg_temp.run     ('BMW  S1 версія',             'M550I_XDRIVE', null);
select pg_temp.run     ('BMW  S2 версія + MY2018',    'M550I_XDRIVE', 2018);
select pg_temp.run     ('BMW  S3 версія + рік 2017',  'M550I_XDRIVE', 2017);
select pg_temp.run_full('TSL  S0 VMY US/2015',        'P85D', 'US', 2015);
select pg_temp.run     ('TSL  S1 версія',             'P85D', null);
select pg_temp.run     ('TSL  S2 версія + MY2015',    'P85D', 2015);
select pg_temp.run_full('POR  S0 VMY US/2013',        'GTS', 'US', 2013);
select pg_temp.run     ('POR  S1 версія',             'GTS', null);
select pg_temp.run     ('POR  S2 версія + MY2013',    'GTS', 2013);

\echo '=== розподіл статусів по сценаріях ==='
select scenario,
       count(*) filter (where status = 'APPLICABLE')           as appl,
       count(*) filter (where status = 'APPLICABLE_ASSUMED')   as appl_assumed,
       count(*) filter (where status = 'CONDITIONAL')          as cond,
       count(*) filter (where status like 'EXCLUDED%')         as excl,
       count(*) filter (where status = 'OUT_OF_PARTIAL_SCOPE') as vmy_only,
       count(*) filter (where bucket = 'H')                    as via_hier,
       count(*) filter (where bucket = 'F')                    as via_fitment,
       count(*) filter (where leak is not null)                as leaks
  from sim group by scenario order by scenario;

\echo '=== витоки (мають бути нулем) ==='
select s.scenario, k.task_ref, ks.kind::text, s.status, s.leak, left(c.text_en, 90)
  from sim s join mi.claim c on c.id = s.claim_id
  join mi.knowledge_subject ks on ks.id = c.subject_id
  left join mi.candidate_claim k on k.published_claim_id = c.id
 where s.leak is not null order by 1, 2;

\echo '=== BMW S1: що лишається APPLICABLE без ринку, року і компонентів ==='
select k.task_ref, ks.kind::text, s.bucket, left(c.text_en, 100)
  from sim s join mi.claim c on c.id = s.claim_id
  join mi.knowledge_subject ks on ks.id = c.subject_id
  left join mi.candidate_claim k on k.published_claim_id = c.id
 where s.scenario = 'BMW  S1 версія' and s.status like 'APPLICABLE%'
 order by k.task_ref;

\echo '=== BMW S1: CONDITIONAL за якою причиною ==='
select case when mi.claim_anchor_variant(c.id) is not null then 'role_unresolved'
            when exists (select 1 from mi.claim_applicability a where a.claim_id = c.id and a.dimension::text = 'model_year') then 'model_year_unknown'
            when exists (select 1 from mi.claim_applicability a where a.claim_id = c.id and a.dimension::text = 'market_sold') then 'market_unknown'
            when exists (select 1 from mi.claim_applicability a where a.claim_id = c.id and a.dimension::text = 'production_date') then 'production_date_unknown'
            else 'other' end as why, count(*)
  from sim s join mi.claim c on c.id = s.claim_id
 where s.scenario = 'BMW  S1 версія' and s.status = 'CONDITIONAL'
 group by 1 order by 2 desc;
rollback;
