-- CalCar Model Intelligence, міграція 09: міжтабличні сторожі, права
-- і фінальна перевірка складу схеми.
--
-- Тут ЛИШЕ ті сторожі, які є частиною обмежень схеми і не виражаються
-- звичайним CHECK (бо дивляться в іншу таблицю). Механізм ревізій знання,
-- перерахунок повторюваності і функція публікації це Phase 2.

-- ---------- 1. Міжтабличні сторожі ----------

-- 1.1. Шар практики має сенс лише у клейма про обслуговування.
create or replace function mi.validate_claim_layer() returns trigger
language plpgsql as $$
declare subj_kind mi.subject_kind;
begin
  select kind into subj_kind from mi.knowledge_subject where id = new.subject_id;
  if new.layer is not null and subj_kind <> 'maintenance_item' then
    raise exception 'claim.layer is allowed only for maintenance_item subjects (claim %, subject kind %)', new.id, subj_kind;
  end if;
  if new.layer is null and subj_kind = 'maintenance_item' then
    raise exception 'claim about maintenance_item must carry a layer (claim %)', new.id;
  end if;
  return new;
end $$;

drop trigger if exists claim_layer_guard on mi.claim;
create trigger claim_layer_guard
  before insert or update of subject_id, layer on mi.claim
  for each row execute function mi.validate_claim_layer();

-- 1.2. Вміст пакета можна класти лише у справжній пакет.
create or replace function mi.validate_package_content() returns trigger
language plpgsql as $$
declare pkg_kind mi.equipment_kind;
begin
  select item_kind into pkg_kind from mi.equipment_item where subject_id = new.package_id;
  if pkg_kind <> 'package' then
    raise exception 'package_content.package_id must reference an equipment item of kind package (got %)', pkg_kind;
  end if;
  return new;
end $$;

drop trigger if exists package_content_guard on mi.package_content;
create trigger package_content_guard
  before insert or update on mi.package_content
  for each row execute function mi.validate_package_content();

-- 1.3. Опори бувають лише у синтезу CalCar.
create or replace function mi.validate_claim_support() returns trigger
language plpgsql as $$
declare kt mi.knowledge_type;
begin
  select knowledge_type into kt from mi.claim where id = new.synthesis_claim_id;
  if kt <> 'calcar_synthesis' then
    raise exception 'claim_support.synthesis_claim_id must reference a calcar_synthesis claim (got %)', kt;
  end if;
  return new;
end $$;

drop trigger if exists claim_support_guard on mi.claim_support;
create trigger claim_support_guard
  before insert or update on mi.claim_support
  for each row execute function mi.validate_claim_support();

-- 1.4. Умовний зовнішній ключ для тегів предиката: значення tag має
-- існувати у відповідному словнику. Звичайним FK це не виражається, бо
-- цільовий словник залежить від dimension.
create or replace function mi.validate_applicability_tag() returns trigger
language plpgsql as $$
begin
  if new.dimension = 'condition_tag' then
    if not exists (select 1 from mi.condition_tag where code = new.tag) then
      raise exception 'unknown condition tag %', new.tag;
    end if;
  elsif new.dimension in ('market_sold', 'market_operated') then
    if not exists (select 1 from mi.market where code = new.tag) then
      raise exception 'unknown market code %', new.tag;
    end if;
  elsif new.dimension = 'salvage_status' then
    if new.tag not in ('true', 'false') then
      raise exception 'salvage_status tag must be true or false, got %', new.tag;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists claim_applicability_tag_guard on mi.claim_applicability;
create trigger claim_applicability_tag_guard
  before insert or update of dimension, tag on mi.claim_applicability
  for each row execute function mi.validate_applicability_tag();

-- ---------- 2. Права ----------

-- Роль дослідження і витягу. Вона НЕ отримує прямих прав на канонічні
-- клейми: публікація у Phase 2 піде лише через функцію публікації.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mi_ingest') then
    create role mi_ingest nologin;
  end if;
end $$;

grant usage on schema mi to mi_ingest;
grant usage on schema mi_vm to mi_ingest;
grant select on all tables in schema mi to mi_ingest;
grant select on all tables in schema mi_vm to mi_ingest;
grant insert, update on mi.candidate_claim to mi_ingest;
grant insert, update on mi.candidate_evidence to mi_ingest;
grant insert, update on mi.source to mi_ingest;

-- Клієнтські ролі Supabase не бачать Model Intelligence взагалі.
-- RLS увімкнений на всіх таблицях без політик; права знімаються явно.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema mi from %I', r);
      execute format('revoke all on all tables in schema mi_vm from %I', r);
      execute format('revoke all on schema mi from %I', r);
      execute format('revoke all on schema mi_vm from %I', r);
    end if;
  end loop;
end $$;

-- ---------- 3. Фінальна перевірка складу ----------

do $$
declare
  n_tables integer;
  n_types  integer;
  n_roles  integer;
  n_strong integer;
begin
  select count(*) into n_tables
    from pg_tables where schemaname in ('mi', 'mi_vm');
  if n_tables <> 52 then
    raise exception 'Model Intelligence schema expects 52 tables, found %', n_tables;
  end if;

  select count(*) into n_types
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'mi' and t.typtype = 'e';
  if n_types <> 44 then
    raise exception 'Model Intelligence schema expects 44 enum types, found %', n_types;
  end if;

  select count(*) into n_roles from mi.component_role where is_replaceable;
  if n_roles <> 12 then
    raise exception 'expected 12 replaceable component roles, found %', n_roles;
  end if;

  select count(*) into n_strong
    from mi.component_role where assumption_strength = 'strong';
  if n_strong <> 3 then
    raise exception 'expected exactly 3 roles with strong factory assumption, found %', n_strong;
  end if;

  if not exists (select 1 from mi.component_role
                 where code = 'engine' and assumption_strength = 'strong') then
    raise exception 'engine role must carry strong factory assumption';
  end if;
  if not exists (select 1 from mi.component_role
                 where code = 'battery_pack' and assumption_strength = 'weak') then
    raise exception 'battery_pack role must carry weak factory assumption';
  end if;
end $$;
