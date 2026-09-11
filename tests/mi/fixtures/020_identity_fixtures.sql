-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Розвʼязані ідентичності для golden tests. Резолвер ідентичності у
-- Phase 4 НЕ пишеться: ці значення задані вручну і грають роль його
-- виходу. VIN тут синтетичний і жодної реальної машини не описує.
--
-- Функція повертає ідентичність у тому вигляді, у якому її приймає
-- компілятор. Варіанти адресуються природними ключами каталогу, щоб
-- фікстура не залежала від згенерованих id.

create schema if not exists mi_test;

create or replace function mi_test.sid_of(p_kind text, p_code text)
returns bigint language sql stable as $$
  select case p_kind
    when 'variant'   then (select subject_id from mi.component_variant where variant_code = p_code)
    when 'family'    then (select subject_id from mi.component_family where family_key = p_code)
    when 'version'   then (select subject_id from mi.vehicle_version where version_code = p_code)
    when 'generation'then (select subject_id from mi.generation where platform_code = p_code and phase = 'base')
    when 'equipment' then (select subject_id from mi.equipment_item where equipment_key = p_code)
    when 'entitlement' then (select subject_id from mi.entitlement where entitlement_key = p_code)
    when 'state'     then (select subject_id from mi.component_state_type where state_key = p_code)
    when 'issue'     then (select subject_id from mi.issue where issue_key = p_code)
    when 'check'     then (select subject_id from mi.check_item where subject_id in
                             (select subject_id from mi.knowledge_subject where label = p_code))
    else null end;
$$;

-- Базова ідентичність по версії x ринок x рік: ієрархія і комплектація
-- беруться з каталогу, усі ролі за замовчуванням assumed_factory.
create or replace function mi_test.identity_of(
  p_version_code text, p_model_year int, p_market text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'vmy', y.subject_id,
    'version', v.subject_id,
    'generation', g.subject_id,
    'model_line', m.subject_id,
    'brand', b.subject_id,
    'market_sold', y.market_code,
    'market_operated', y.market_code,
    'model_year', y.model_year,
    'production_date', case when y.prod_from_kind = 'known' then y.prod_from::text else null end,
    'components', coalesce((
      select jsonb_agg(x order by x->>'role', x->>'slot') from (
        select jsonb_build_object('role', f.role_code, 'slot', s.slot,
                                  'variant', f.variant_id, 'status', 'assumed_factory') as x
          from mi.version_fitment f, (values ('factory'), ('current')) s(slot)
         where f.vmy_id = y.subject_id and f.fitment = 'standard'
           and f.prod_from_kind <> 'unknown' and f.prod_to_kind <> 'unknown'
      ) t), '[]'::jsonb),
    'equipment', '[]'::jsonb,
    'entitlements', '[]'::jsonb,
    'states', '[]'::jsonb)
    from mi.version_market_year y
    join mi.vehicle_version v on v.subject_id = y.version_id
    join mi.generation g on g.subject_id = v.generation_id
    join mi.model_line m on m.subject_id = g.model_line_id
    join mi.brand b on b.subject_id = m.brand_id
   where v.version_code = p_version_code and y.model_year = p_model_year
     and y.market_code = p_market;
$$;

-- Точкова заміна одного виміру ідентичності.
create or replace function mi_test.with_component(
  p_identity jsonb, p_role text, p_slot text, p_variant bigint, p_status text)
returns jsonb language sql immutable as $$
  select jsonb_set(p_identity, '{components}',
    coalesce((select jsonb_agg(e) from jsonb_array_elements(p_identity->'components') e
               where not (e->>'role' = p_role and e->>'slot' = p_slot)), '[]'::jsonb)
    || case when p_variant is null and p_status is null then '[]'::jsonb
       else jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
              'role', p_role, 'slot', p_slot, 'variant', p_variant, 'status', p_status))) end);
$$;

create or replace function mi_test.with_field(p_identity jsonb, p_key text, p_value jsonb)
returns jsonb language sql immutable as $$
  select jsonb_set(p_identity, array[p_key], p_value);
$$;

create or replace function mi_test.with_equipment(
  p_identity jsonb, p_item bigint, p_present boolean, p_status text default 'confirmed')
returns jsonb language sql immutable as $$
  select jsonb_set(p_identity, '{equipment}',
    coalesce((select jsonb_agg(e) from jsonb_array_elements(p_identity->'equipment') e
               where (e->>'item')::bigint <> p_item), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('item', p_item, 'present', p_present, 'status', p_status)));
$$;

create or replace function mi_test.with_entitlement(
  p_identity jsonb, p_ent bigint, p_state text)
returns jsonb language sql immutable as $$
  select jsonb_set(p_identity, '{entitlements}',
    coalesce((select jsonb_agg(e) from jsonb_array_elements(p_identity->'entitlements') e
               where (e->>'entitlement')::bigint <> p_ent), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('entitlement', p_ent, 'state', p_state)));
$$;

create or replace function mi_test.with_state(
  p_identity jsonb, p_state bigint, p_present boolean)
returns jsonb language sql immutable as $$
  select jsonb_set(p_identity, '{states}',
    coalesce((select jsonb_agg(e) from jsonb_array_elements(p_identity->'states') e
               where (e->>'state_type')::bigint <> p_state), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('state_type', p_state, 'present', p_present)));
$$;

-- Три еталонні машини.
create or replace function mi_test.id_bmw() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('M550I_XDRIVE', 2018, 'US'),
                              'mileage_km', to_jsonb(120000)),
           'age_years', to_jsonb(8));
$$;

create or replace function mi_test.id_tesla() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('P85D', 2015, 'US'),
                              'mileage_km', to_jsonb(150000)),
           'age_years', to_jsonb(10));
$$;

create or replace function mi_test.id_porsche() returns jsonb language sql stable as $$
  select mi_test.with_field(
           mi_test.with_field(mi_test.identity_of('GTS', 2013, 'US'),
                              'mileage_km', to_jsonb(140000)),
           'age_years', to_jsonb(12));
$$;

-- ---------- Помічники перевірок ----------

create or replace function mi_test.claim(p_task_ref text)
returns bigint language sql stable as $$
  select published_claim_id from mi.candidate_claim where task_ref = p_task_ref;
$$;

create or replace function mi_test.status(p_task_ref text, p_identity jsonb)
returns text language sql stable as $$
  select mi.eval_claim(mi_test.claim(p_task_ref), p_identity)->>'status';
$$;

create or replace function mi_test.basis(p_task_ref text, p_identity jsonb)
returns text language sql stable as $$
  select mi.eval_claim(mi_test.claim(p_task_ref), p_identity)->>'basis';
$$;

-- Чи є клейм у зібраному пакеті. Дивиться у ВСІ кошики всіх систем.
create or replace function mi_test.in_pack(p_pack jsonb, p_claim_id bigint)
returns boolean language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_pack->'systems','[]'::jsonb)) s,
         lateral (values (s->'issues'), (s->'claims'), (s->'maintenance'),
                         (s->'check_items'), (s->'states')) b(arr),
         lateral jsonb_array_elements(coalesce(arr,'[]'::jsonb)) c
     where (c->>'claim_id')::bigint = p_claim_id
    union all
    select 1 from jsonb_array_elements(coalesce(p_pack->'entitlements','[]'::jsonb)) c
     where (c->>'claim_id')::bigint = p_claim_id
    union all
    select 1 from jsonb_array_elements(coalesce(p_pack->'comparisons','[]'::jsonb)) c
     where (c->>'claim_id')::bigint = p_claim_id);
$$;

-- Увесь текст, який пакет віддає далі. Використовується для доказу, що
-- текст заблокованого кандидата не витікає.
create or replace function mi_test.pack_text(p_pack jsonb)
returns text language sql stable as $$ select p_pack::text $$;

create or replace function mi_test.pack(p_identity jsonb, p_purpose text default 'decision')
returns jsonb language sql as $$
  select mi.compile_pack(p_identity, p_purpose::mi.pack_purpose)->'pack';
$$;

create or replace function mi_test.area_of(p_pack jsonb, p_area text)
returns jsonb language sql stable as $$
  select s from jsonb_array_elements(coalesce(p_pack->'systems','[]'::jsonb)) s
   where s->>'area' = p_area limit 1;
$$;
