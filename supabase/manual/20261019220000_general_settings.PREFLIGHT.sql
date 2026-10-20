-- =====================================================================
-- Core App — General Settings PREFLIGHT (READ-ONLY) — v2, editor-safe
-- Run this BEFORE 20261019220000_general_settings.PRODUCTION.sql.
-- Companion after the run: 20261019220000_general_settings.VERIFY.sql
--
-- WHY v2 EXISTS:
--   The Supabase SQL Editor shows only ONE result grid per run — the
--   result of the last row-returning statement. RAISE NOTICE output
--   (used by the old sections E and H) is NOT shown in that grid.
--   In v1, a whole-file run therefore displayed only section G
--   (invoice counter state) and silently hid every other section,
--   including whether the hard checks passed. A displayed counter
--   row is NOT evidence that the preflight passed.
--
-- HOW TO USE THIS FILE:
--   STEP 1 (the gate): Run the ENTIRE file (click in the editor,
--     select nothing, Run). You will get exactly one of:
--       a) an ERROR beginning "PREFLIGHT FAILED:" -> BLOCKER present.
--          Do NOT run the Production script. Fix and re-run.
--       b) the SUMMARY table (last statement) whose first row is
--          "overall" with status PASS -> hard checks passed.
--          INFO rows never block; review them before enabling the
--          related workspace settings.
--   STEP 2 (details, optional): each diagnostic D1..D9 below is a
--     single SELECT. To see its rows, select ONLY that statement's
--     text in the editor and Run. Running the whole file executes
--     them too, but only the summary stays visible (by design).
--
-- CONFIRMED LIVE STARTING STATE (2026-10-20, from Production):
--   public.workspaces / clients / invoices exist; public.legal_entities
--   does NOT exist in any schema (the only name match was
--   auth.identities). legal_entities is a NEW table that the
--   Production script creates; its absence is EXPECTED and reported
--   as INFO in the summary, never as a blocker. If it ever does
--   exist beforehand, D4 lists its policies and the Production
--   script aborts on any unexpected policy instead of removing it.
--
-- DEPLOYMENT ORDER (H8): apply the PRODUCTION SQL before deploying
-- any app build that writes the new columns (client middle_name /
-- consents, workspace settings columns). Workspace reads have a
-- missing-column fallback; client/settings writes do not.
--
-- Duplicates / shared VINs / invalid time zones are INFORMATIONAL:
-- they never block the Production script, because enforcement is
-- setting-gated per workspace. NEVER automatically merge or delete
-- clients based on this output.
-- This file creates only a session TEMP table for the summary; it
-- contains no DDL/DML against application tables.
-- =====================================================================

-- =====================================================================
-- DIAGNOSTICS — run ONE statement at a time (select it, then Run)
-- =====================================================================

-- D1. Invoice constraints: expect invoices_number_check =
-- CHECK (number ~ '^INV-(PENDING-.+|[0-9]{4}-[0-9]{3,})$'),
-- UNIQUE (workspace_id, number); counters PK (workspace_id, year),
-- FK -> workspaces(id), CHECK (last_number > 0).
select 'D1' as section, conrelid::regclass::text as table_name, conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where (conrelid = 'public.invoices'::regclass
       or conrelid = 'public.invoice_number_counters'::regclass)
order by table_name, contype, conname;

-- D2. RLS flags: every listed table must show rls_enabled = true.
select 'D2' as section, c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('workspaces','workspace_members','clients','orders','invoices','invoice_number_counters','legal_entities')
order by c.relname;

-- D3. Invoice trigger + membership helpers: expect
-- invoices_protect_identity BEFORE INSERT OR UPDATE ->
-- protect_invoice_identity(), security_definer = true, search_path pinned.
select 'D3' as section, t.tgname, pg_get_triggerdef(t.oid) as definition,
       p.proname as function_name, p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig,','),'(no search_path pin)') as config
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.invoices'::regclass and not t.tgisinternal;

select 'D3' as section, p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig,','),'(no search_path pin)') as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_workspace_member','workspace_member_is_owner','workspace_member_is_admin','protect_invoice_identity');

-- D4. Existing general-settings objects. Empty = not created yet
-- (expected on first run). A row with an unexpected type/definition
-- is a BLOCKER (the Production script also aborts on these).
select 'D4' as section, table_name, column_name, data_type, is_generated, generation_expression
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'workspaces' and column_name in ('company_address','billing_email','registration_number','tax_vat_number','iban','bank_name','bank_code','company_description','print_extra_info','country_code','document_language','warranty_start','default_comments_visibility','default_files_visibility','prevent_duplicate_device_orders','show_client_middle_name','default_phone_consent','prevent_duplicate_phones','default_email_consent','prevent_duplicate_emails','invoice_number_template','invoice_due_days','invoice_order_details_mode','prevent_backdated_invoices','default_legal_entity_id','online_payments_enabled'))
    or (table_name = 'clients' and column_name in ('middle_name','phone_notifications_consent','email_notifications_consent','deleted_at','phone_normalized','email_normalized'))
    or (table_name = 'invoices' and column_name = 'legal_entity_id')
    or (table_name = 'legal_entities'))
order by table_name, column_name;

select 'D4' as section, schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'legal_entities'
order by policyname;
-- ^ H6: the Production script drops ALL of these and recreates
--   exactly 4 (member SELECT / owner INSERT / owner UPDATE / owner
--   DELETE). Review anything unexpected here before running it.

select 'D4' as section, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'legal_entities'
order by grantee, privilege_type;

-- D4-legal. Every object named legal_entities in ANY schema.
-- Confirmed live result: zero rows (only auth.identities matched a
-- name search). Zero rows here = the table will be created fresh.
select 'D4-legal' as section, n.nspname as schema_name, c.relname as object_name,
       c.relkind, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relname = 'legal_entities' and c.relkind in ('r','p','v','m','f','S')
order by n.nspname;

select 'D4' as section, event_object_table as table_name, trigger_name,
       action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('clients','orders','invoices','workspaces','legal_entities')
order by event_object_table, trigger_name;

-- D5. Invalid workspace time zones — INFORMATIONAL. Invoice creation
-- falls back to Europe/Chisinau for these; fix when convenient.
select 'D5' as section, id, name, timezone
from public.workspaces w
where w.timezone is not null and btrim(w.timezone) <> ''
  and not exists (select 1 from pg_timezone_names z where z.name = w.timezone)
order by w.timezone, w.id;

-- D6. Workspace values that would violate the new CHECK constraints
-- — BLOCKER if any row. Safe before the columns exist: values are
-- read via to_jsonb, so a missing column reads as NULL and passes.
select 'D6' as section, w.id as workspace_id,
       to_jsonb(w)->>'document_language' as document_language,
       to_jsonb(w)->>'warranty_start' as warranty_start,
       to_jsonb(w)->>'default_comments_visibility' as default_comments_visibility,
       to_jsonb(w)->>'default_files_visibility' as default_files_visibility,
       to_jsonb(w)->>'invoice_order_details_mode' as invoice_order_details_mode,
       to_jsonb(w)->>'invoice_due_days' as invoice_due_days,
       to_jsonb(w)->>'invoice_number_template' as invoice_number_template
from public.workspaces w
where (to_jsonb(w)->>'document_language' is not null and to_jsonb(w)->>'document_language' not in ('en','ro','ru'))
   or (to_jsonb(w)->>'warranty_start' is not null and to_jsonb(w)->>'warranty_start' not in ('created_at','closed_at'))
   or (to_jsonb(w)->>'default_comments_visibility' is not null and to_jsonb(w)->>'default_comments_visibility' not in ('public','private'))
   or (to_jsonb(w)->>'default_files_visibility' is not null and to_jsonb(w)->>'default_files_visibility' not in ('public','private'))
   or (to_jsonb(w)->>'invoice_order_details_mode' is not null and to_jsonb(w)->>'invoice_order_details_mode' not in ('detailed','simplified','one_line'))
   or ((to_jsonb(w)->>'invoice_due_days') ~ '^-?[0-9]+$' and (to_jsonb(w)->>'invoice_due_days')::integer not between 0 and 3650)
   or (to_jsonb(w)->>'invoice_number_template' is not null and to_jsonb(w)->>'invoice_number_template' !~ '^INV-\{YYYY\}-\{#{3,}\}$')
order by w.id;

-- D7. Duplicate clients — INFORMATIONAL ONLY. Does NOT block the
-- Production script; matters only before enabling
-- prevent_duplicate_phones / prevent_duplicate_emails. Soft-deleted
-- clients are excluded whether or not deleted_at exists yet
-- (read via to_jsonb). Never auto-merge/delete; resolve manually.
select 'D7-phone' as section, c.workspace_id,
       nullif(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), '') as phone_normalized,
       count(*) as clients, string_agg(c.id::text, ', ' order by c.created_at) as client_ids
from public.clients c
where (to_jsonb(c)->>'deleted_at') is null
  and nullif(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), '') is not null
group by c.workspace_id, 3
having count(*) > 1
order by c.workspace_id, 3;

select 'D7-email' as section, c.workspace_id,
       nullif(lower(btrim(coalesce(c.email,''))), '') as email_normalized,
       count(*) as clients, string_agg(c.id::text, ', ' order by c.created_at) as client_ids
from public.clients c
where (to_jsonb(c)->>'deleted_at') is null
  and nullif(lower(btrim(coalesce(c.email,''))), '') is not null
group by c.workspace_id, 3
having count(*) > 1
order by c.workspace_id, 3;

-- D8. Open orders sharing a VIN — INFORMATIONAL. Matters only before
-- enabling prevent_duplicate_device_orders for a workspace.
select 'D8' as section, workspace_id, upper(btrim(vin)) as vin_normalized,
       count(*) as open_orders, string_agg(id::text, ', ' order by created_at) as order_ids
from public.orders
where status in ('new','in-progress','waiting-parts')
  and nullif(btrim(vin), '') is not null
group by workspace_id, upper(btrim(vin))
having count(*) > 1
order by workspace_id, vin_normalized;

-- D9. Invoice counter state vs issued numbers — INFORMATIONAL.
-- This is the query whose single row (workspace cdbf8d72…, 2026,
-- last_number 1, max_issued 1) was the only visible output of the
-- v1 file. last_number = max_issued means the counter is consistent
-- with issued invoices for that year; it says nothing about whether
-- the hard preflight checks passed.
select 'D9' as section, c.workspace_id, c.year, c.last_number,
       coalesce(max(substring(i.number from 10)::integer), 0) as max_issued
from public.invoice_number_counters c
left join public.invoices i
  on i.workspace_id = c.workspace_id
 and i.number ~ '^INV-[0-9]{4}-[0-9]{3,}$'
 and substring(i.number from 5 for 4)::integer = c.year
group by c.workspace_id, c.year, c.last_number
order by c.workspace_id, c.year;

-- =====================================================================
-- SUMMARY — run the ENTIRE file and read THIS result (or the error).
-- Collects every check into a temp table, raises on any BLOCKER
-- failure, and otherwise returns one labelled PASS/FAIL/INFO table.
-- Do not run these statements piecemeal; if the final SELECT says
-- the temp table is missing, re-run the whole file in one Run.
-- =====================================================================
create temp table if not exists gs_preflight_results (
  check_name text, category text, status text, detail text
);
delete from gs_preflight_results;

do $$
declare
  v_def text;
  v_bad text;
  v_count integer;
  r record;
  v_type text;
  v_gen text;
begin
  -- Required tables (BLOCKER)
  insert into gs_preflight_results
  select 'required_tables', 'BLOCKER',
         case when to_regclass('public.workspaces') is not null
               and to_regclass('public.workspace_members') is not null
               and to_regclass('public.clients') is not null
               and to_regclass('public.orders') is not null
               and to_regclass('public.invoices') is not null
               and to_regclass('public.invoice_number_counters') is not null
              then 'PASS' else 'FAIL' end,
         'workspaces, workspace_members, clients, orders, invoices, invoice_number_counters must exist';

  -- Exact invoice number CHECK (BLOCKER)
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conrelid='public.invoices'::regclass and conname='invoices_number_check' and contype='c';
  insert into gs_preflight_results values (
    'invoices_number_check', 'BLOCKER',
    case when v_def like '%^INV-(PENDING-.+|[0-9]{4}-[0-9]{3,})$%' then 'PASS' else 'FAIL' end,
    coalesce(v_def, '(missing)'));

  -- Unique (workspace_id, number) (BLOCKER)
  insert into gs_preflight_results
  select 'invoices_unique_workspace_number', 'BLOCKER',
         case when exists (select 1 from pg_constraint where conrelid='public.invoices'::regclass and contype='u'
                           and pg_get_constraintdef(oid)='UNIQUE (workspace_id, number)')
              then 'PASS' else 'FAIL' end,
         'expect UNIQUE (workspace_id, number) — see D1';

  -- Counter PK/FK/check (BLOCKER)
  insert into gs_preflight_results
  select 'invoice_number_counters_shape', 'BLOCKER',
         case when exists (select 1 from pg_constraint where conrelid='public.invoice_number_counters'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, year)')
               and exists (select 1 from pg_constraint where conrelid='public.invoice_number_counters'::regclass and contype='f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id) REFERENCES workspaces(id)%')
               and exists (select 1 from pg_constraint where conrelid='public.invoice_number_counters'::regclass and contype='c' and pg_get_constraintdef(oid) like '%last_number > 0%')
              then 'PASS' else 'FAIL' end,
         'expect PK (workspace_id, year), FK -> workspaces(id), CHECK (last_number > 0) — see D1';

  -- Invoice trigger binding + function security (BLOCKER)
  insert into gs_preflight_results
  select 'invoices_protect_identity_trigger', 'BLOCKER',
         case when exists (
           select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
           where t.tgrelid='public.invoices'::regclass and t.tgname='invoices_protect_identity'
             and p.proname='protect_invoice_identity' and p.prosecdef
             and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%'
             and pg_get_functiondef(p.oid) like '%INV-PENDING-%'
             and pg_get_functiondef(p.oid) like '%INV-NEXT%'
             and (t.tgtype & 2)<>0 and (t.tgtype & 4)<>0 and (t.tgtype & 16)<>0)
              then 'PASS' else 'FAIL' end,
         'BEFORE INSERT OR UPDATE, SECURITY DEFINER, search_path pinned — see D3';

  -- Membership helpers (BLOCKER)
  insert into gs_preflight_results
  select 'membership_helpers', 'BLOCKER',
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                           where n.nspname='public' and p.proname='is_workspace_member' and p.prosecdef)
               and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                           where n.nspname='public' and p.proname='workspace_member_is_owner' and p.prosecdef)
              then 'PASS' else 'FAIL' end,
         'is_workspace_member / workspace_member_is_owner must be SECURITY DEFINER — see D3';

  -- RLS enabled (BLOCKER)
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('workspaces','workspace_members','clients','orders','invoices','invoice_number_counters')
    and not c.relrowsecurity;
  insert into gs_preflight_results values (
    'rls_enabled', 'BLOCKER', case when v_bad is null then 'PASS' else 'FAIL' end,
    coalesce('RLS disabled on: '||v_bad, 'RLS enabled on all required tables — see D2'));

  -- Unexpected triggers on clients/orders/invoices (BLOCKER)
  select string_agg(t.tgrelid::regclass::text||'.'||t.tgname, ', ') into v_bad
  from pg_trigger t
  where not t.tgisinternal
    and ((t.tgrelid='public.clients'::regclass and t.tgname not in ('clients_prevent_workspace_change','clients_enforce_workspace_setting_duplicates'))
      or (t.tgrelid='public.orders'::regclass and t.tgname not in ('orders_prevent_workspace_change','orders_enforce_unique_open_device','orders_enforce_unique_open_vin'))
      or (t.tgrelid='public.invoices'::regclass and t.tgname not in ('invoices_protect_identity')));
  insert into gs_preflight_results values (
    'no_unexpected_triggers', 'BLOCKER', case when v_bad is null then 'PASS' else 'FAIL' end,
    coalesce('unexpected: '||v_bad, 'only known baseline triggers present — see D4'));

  -- Existing-column type drift (BLOCKER)
  v_bad := null;
  for r in
    select * from (values
      ('workspaces','invoice_due_days','integer'),('workspaces','default_legal_entity_id','uuid'),
      ('workspaces','invoice_number_template','text'),('workspaces','document_language','text'),
      ('clients','deleted_at','timestamp with time zone'),('clients','phone_normalized','text'),
      ('clients','email_normalized','text'),('invoices','legal_entity_id','uuid'),
      ('legal_entities','id','uuid'),('legal_entities','workspace_id','uuid'),
      ('legal_entities','is_default','boolean'),('legal_entities','deleted_at','timestamp with time zone')
    ) as e(tbl, col, typ)
  loop
    if r.tbl='legal_entities' and to_regclass('public.legal_entities') is null then continue; end if;
    select data_type, is_generated into v_type, v_gen from information_schema.columns
    where table_schema='public' and table_name=r.tbl and column_name=r.col;
    if v_type is not null and v_type <> r.typ then
      v_bad := coalesce(v_bad||', ', '') || r.tbl||'.'||r.col||' is '||v_type||' (expected '||r.typ||')';
    end if;
    if r.tbl='clients' and r.col in ('phone_normalized','email_normalized') and v_type is not null and v_gen <> 'ALWAYS' then
      v_bad := coalesce(v_bad||', ', '') || 'clients.'||r.col||' is not GENERATED ALWAYS';
    end if;
  end loop;
  insert into gs_preflight_results values (
    'existing_column_types', 'BLOCKER', case when v_bad is null then 'PASS' else 'FAIL' end,
    coalesce(v_bad, 'no type drift on pre-existing general-settings columns — see D4'));

  -- Workspace values vs new CHECKs (BLOCKER, column-guarded)
  v_bad := null;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspaces' and column_name='invoice_number_template') then
    execute 'select string_agg(id::text, '', '') from public.workspaces where '
      || 'document_language not in (''en'',''ro'',''ru'') or warranty_start not in (''created_at'',''closed_at'') '
      || 'or default_comments_visibility not in (''public'',''private'') or default_files_visibility not in (''public'',''private'') '
      || 'or invoice_order_details_mode not in (''detailed'',''simplified'',''one_line'') '
      || 'or invoice_due_days < 0 or invoice_due_days > 3650 '
      || 'or invoice_number_template !~ ''^INV-\{YYYY\}-\{#{3,}\}$'''
      into v_bad;
  end if;
  insert into gs_preflight_results values (
    'workspace_values_valid', 'BLOCKER', case when v_bad is null then 'PASS' else 'FAIL' end,
    coalesce('offending workspace ids: '||v_bad, 'no workspace value violates the new CHECK domains — see D6'));

  -- Ambiguous legal-entity defaults (BLOCKER, object-guarded)
  v_bad := null;
  if to_regclass('public.legal_entities') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspaces' and column_name='default_legal_entity_id') then
    execute 'select string_agg(workspace_id::text, '', '') from (select workspace_id from public.legal_entities le join public.workspaces w on w.id=le.workspace_id and w.default_legal_entity_id is null where le.is_default and le.deleted_at is null group by workspace_id having count(*) > 1) s'
      into v_bad;
  end if;
  insert into gs_preflight_results values (
    'legal_defaults_unambiguous', 'BLOCKER', case when v_bad is null then 'PASS' else 'FAIL' end,
    coalesce('ambiguous workspace ids: '||v_bad, 'no workspace has multiple flagged defaults without a canonical pointer'));

  -- legal_entities starting state (INFO unless a non-table object
  -- owns the public name, which is a BLOCKER for CREATE TABLE).
  insert into gs_preflight_results
  select 'legal_entities_starting_state',
         case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='public' and c.relname='legal_entities' and c.relkind not in ('r','p'))
              then 'BLOCKER' else 'INFO' end,
         case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='public' and c.relname='legal_entities' and c.relkind not in ('r','p'))
              then 'FAIL'
              when to_regclass('public.legal_entities') is null then 'INFO'
              else 'INFO' end,
         case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='public' and c.relname='legal_entities' and c.relkind not in ('r','p'))
              then 'public.legal_entities exists but is not a table — resolve manually'
              when to_regclass('public.legal_entities') is null
              then 'ABSENT (confirmed expected state) — Production creates it as a new empty table; nothing to migrate or preserve'
              else 'PRE-EXISTING table — review its policies in D4 before running Production; unexpected policies abort the script'
         end;

  -- Workspaces that already have duplicate prevention enabled (INFO).
  -- With intentional duplicate clients, enabling these flags makes
  -- unrelated updates to the duplicated records fail; the Production
  -- script itself never turns them on (NULL -> false).
  select count(*) into v_count from public.workspaces w
  where (to_jsonb(w)->>'prevent_duplicate_phones') = 'true'
     or (to_jsonb(w)->>'prevent_duplicate_emails') = 'true';
  insert into gs_preflight_results values (
    'duplicate_prevention_already_enabled', 'INFO', 'INFO',
    v_count||' workspace(s) already have prevent_duplicate_phones/emails = true (columns may not exist yet, then 0). Do not enable these for workspaces with intentional duplicates — see D7');

  -- Informational counts (INFO — never block)
  select count(*) into v_count from public.workspaces w
  where w.timezone is not null and btrim(w.timezone)<>''
    and not exists (select 1 from pg_timezone_names z where z.name=w.timezone);
  insert into gs_preflight_results values (
    'invalid_timezones', 'INFO', 'INFO',
    v_count||' workspace(s) with invalid timezone (invoice fallback Europe/Chisinau applies) — see D5');

  select count(*) into v_count from (
    select 1 from public.clients c
    where (to_jsonb(c)->>'deleted_at') is null
      and nullif(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), '') is not null
    group by c.workspace_id, nullif(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), '')
    having count(*) > 1
  ) s;
  insert into gs_preflight_results values (
    'duplicate_phones', 'INFO', 'INFO',
    v_count||' duplicate phone group(s) among active clients — see D7-phone');

  select count(*) into v_count from (
    select 1 from public.clients c
    where (to_jsonb(c)->>'deleted_at') is null
      and nullif(lower(btrim(coalesce(c.email,''))), '') is not null
    group by c.workspace_id, nullif(lower(btrim(coalesce(c.email,''))), '')
    having count(*) > 1
  ) s;
  insert into gs_preflight_results values (
    'duplicate_emails', 'INFO', 'INFO',
    v_count||' duplicate email group(s) among active clients — see D7-email');

  select count(*) into v_count from (
    select 1 from public.orders
    where status in ('new','in-progress','waiting-parts') and nullif(btrim(vin), '') is not null
    group by workspace_id, upper(btrim(vin)) having count(*) > 1
  ) s;
  insert into gs_preflight_results values (
    'open_orders_shared_vin', 'INFO', 'INFO',
    v_count||' VIN(s) shared by multiple open orders — see D8');

  select count(*) into v_count
  from public.invoice_number_counters c
  where c.last_number < coalesce((
    select max(substring(i.number from 10)::integer) from public.invoices i
    where i.workspace_id=c.workspace_id and i.number ~ '^INV-[0-9]{4}-[0-9]{3,}$'
      and substring(i.number from 5 for 4)::integer = c.year), 0);
  insert into gs_preflight_results values (
    'counter_behind_issued', 'INFO', 'INFO',
    v_count||' counter row(s) behind already-issued numbers (Production RPC refuses to rewind) — see D9');
end $$;

-- Hard gate: any BLOCKER failure aborts visibly right here, so a
-- whole-file run can never look successful when a blocker exists.
do $$
declare v_bad text;
begin
  select string_agg(check_name||': '||detail, ' | ') into v_bad
  from gs_preflight_results where category='BLOCKER' and status='FAIL';
  if v_bad is not null then
    raise exception 'PREFLIGHT FAILED — do not run the Production script. Blockers: %', v_bad;
  end if;
end $$;

-- THE summary result (the one grid a whole-file run displays).
select overall, check_name, category, detail
from (
  select
    case when exists (select 1 from gs_preflight_results where category='BLOCKER' and status='FAIL')
         then 'FAIL' else 'PASS' end as overall,
    'overall' as check_name, 'GATE' as category,
    case when exists (select 1 from gs_preflight_results where category='BLOCKER' and status='FAIL')
         then 'At least one BLOCKER failed (unreachable in a whole-file run: the gate above raises first).'
         else 'All BLOCKER checks passed. INFO rows below are advisory only. Production script may be considered — after reviewing D1..D9 details you care about.'
    end as detail
  union all
  select status, check_name, category, detail from gs_preflight_results
) s
order by case s.category when 'GATE' then 0 when 'BLOCKER' then 1 else 2 end, s.check_name;
