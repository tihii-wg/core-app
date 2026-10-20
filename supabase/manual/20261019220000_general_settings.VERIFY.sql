-- =====================================================================
-- Core App — General Settings POST-RUN VERIFICATION (READ-ONLY)
-- Run AFTER 20261019220000_general_settings.PRODUCTION.sql commits.
-- No DDL/DML against application tables.
--
-- Run the ENTIRE file. The first DO block fails cleanly with
-- "VERIFY FAILED: ..." (instead of a raw relation/index cast error)
-- if the Production script has not been applied — e.g. while
-- public.legal_entities still does not exist. If all checks pass,
-- the LAST statement returns a visible one-row PASS result (success
-- is deliberately not reported via RAISE NOTICE, which the Supabase
-- SQL Editor does not show in its result grid).
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'legal_entities' and c.relkind in ('r', 'p')
  ) then
    raise exception 'VERIFY FAILED: public.legal_entities does not exist as a table. The Production script has not been applied (this matches the confirmed pre-run state).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='deleted_at') then
    raise exception 'VERIFY FAILED: clients.deleted_at missing. The Production script has not been fully applied.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname='legal_entities_one_default_per_workspace' and c.relkind='i') then
    raise exception 'VERIFY FAILED: index legal_entities_one_default_per_workspace missing.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname='orders_workspace_open_vin_idx' and c.relkind='i') then
    raise exception 'VERIFY FAILED: index orders_workspace_open_vin_idx missing.';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='legal_entities') <> 4 then
    raise exception 'VERIFY FAILED: legal_entities must have exactly 4 policies.';
  end if;
  if exists (select 1 from pg_index where indexrelid='public.orders_workspace_open_vin_idx'::regclass and indisunique) then
    raise exception 'VERIFY FAILED: orders_workspace_open_vin_idx must be non-unique.';
  end if;
  -- Intentional duplicate clients must remain valid: no unique index
  -- over normalized phone/email may exist.
  if exists (
    select 1 from pg_index i
    where i.indrelid='public.clients'::regclass and i.indisunique
      and (pg_get_indexdef(i.indexrelid) like '%phone_normalized%'
        or pg_get_indexdef(i.indexrelid) like '%email_normalized%')
  ) then
    raise exception 'VERIFY FAILED: a UNIQUE index over clients normalized phone/email exists; duplicate enforcement must stay setting-gated.';
  end if;
  if exists (
    select 1 from public.legal_entities le join public.workspaces w on w.id=le.workspace_id
    where le.deleted_at is null and le.is_default is distinct from (w.default_legal_entity_id = le.id)
  ) then
    raise exception 'VERIFY FAILED: legal_entities.is_default out of sync with workspaces.default_legal_entity_id.';
  end if;
  if exists (
    select 1 from public.invoices i join public.legal_entities le on le.id=i.legal_entity_id
    where le.workspace_id <> i.workspace_id or le.deleted_at is not null
  ) then
    raise exception 'VERIFY FAILED: an invoice references a cross-workspace or deleted legal entity.';
  end if;
end $$;

-- Diagnostics (visible when run one statement at a time).
select column_name, data_type, is_generated
from information_schema.columns
where table_schema='public' and table_name='clients'
  and column_name in ('middle_name','phone_notifications_consent','email_notifications_consent','deleted_at','phone_normalized','email_normalized')
order by column_name;

select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname='public' and tablename='legal_entities'
order by policyname;

select t.tgrelid::regclass::text as table_name, t.tgname, p.proname as function_name
from pg_trigger t join pg_proc p on p.oid=t.tgfoid
where not t.tgisinternal
  and t.tgname in ('invoices_protect_identity','clients_enforce_workspace_setting_duplicates',
                   'orders_enforce_unique_open_vin','legal_entities_protect_workspace',
                   'legal_entities_prepare_default','legal_entities_sync_workspace_default',
                   'workspaces_default_legal_entity_guard','workspaces_sync_legal_defaults')
order by 1, 2;

select i.indexrelid::regclass::text as index_name, i.indisunique, pg_get_indexdef(i.indexrelid) as definition
from pg_index i
where i.indexrelid in ('public.orders_workspace_open_vin_idx'::regclass,
                       'public.legal_entities_one_default_per_workspace'::regclass)
order by 1;

-- Canonical default must agree with the is_default representation.
select w.id as workspace_id, w.default_legal_entity_id,
       (select string_agg(le.id::text, ', ') from public.legal_entities le
        where le.workspace_id=w.id and le.is_default and le.deleted_at is null) as flagged_defaults
from public.workspaces w
where w.default_legal_entity_id is not null
   or exists (select 1 from public.legal_entities le
              where le.workspace_id=w.id and le.is_default and le.deleted_at is null)
order by w.id;

-- THE visible result of a whole-file run.
select 'PASS' as verify_status,
       'General Settings post-conditions hold: legal_entities created with 4 policies, defaults in sync, no cross-workspace/deleted invoice legal entities, no unique client phone/email index.' as detail;
