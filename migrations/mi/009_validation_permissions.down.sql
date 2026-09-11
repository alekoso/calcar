-- Відкат міграції 09.

drop trigger if exists claim_applicability_tag_guard on mi.claim_applicability;
drop trigger if exists claim_support_guard on mi.claim_support;
drop trigger if exists package_content_guard on mi.package_content;
drop trigger if exists claim_layer_guard on mi.claim;

drop function if exists mi.validate_applicability_tag();
drop function if exists mi.validate_claim_support();
drop function if exists mi.validate_package_content();
drop function if exists mi.validate_claim_layer();

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'mi_ingest') then
    execute 'revoke all on all tables in schema mi from mi_ingest';
    execute 'revoke all on all tables in schema mi_vm from mi_ingest';
    execute 'revoke all on schema mi from mi_ingest';
    execute 'revoke all on schema mi_vm from mi_ingest';
    -- Сама роль не видаляється: вона може належати іншим обʼєктам стенду.
  end if;
end $$;
