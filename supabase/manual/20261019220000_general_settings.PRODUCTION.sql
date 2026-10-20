-- =====================================================================
-- Core App — General Settings (manual Production script) — AUDIT-FIXED
-- File: 20261019220000_general_settings.PRODUCTION.sql
-- Companion (run FIRST, read-only):
--   20261019220000_general_settings.PREFLIGHT.sql
-- Companion (run AFTER, read-only):
--   20261019220000_general_settings.VERIFY.sql
--
-- *** EXECUTION INSTRUCTIONS (M2/L4) ***
-- 1. Confirm the Supabase project ref in the dashboard is Production.
-- 2. Run PREFLIGHT first; resolve every BLOCKER row/notice.
-- 3. Run THIS FILE ONCE, AS ONE COMPLETE FILE, in one session.
--    Do NOT run selected sections. Stop on the first error; the
--    transaction must roll back. Transactional DDL protection only
--    holds for whole-file execution.
-- 4. DEPLOYMENT ORDER (H8): apply this SQL BEFORE deploying any app
--    build that writes the new columns (clients middle_name/consents,
--    workspace company/order/contact/invoice columns). Workspace
--    READS have a missing-column fallback in the app, but client
--    create/update and settings saves write new columns
--    unconditionally and will fail with missing-column errors if the
--    app is deployed first. No compatible write fallback is verified.
-- 5. After COMMIT, run the VERIFY file.
--
-- WHAT THIS SCRIPT DOES (not purely additive — L4/M1):
--   * Adds workspace general-settings columns + CHECK constraints.
--   * Creates public.legal_entities (or verifies a pre-existing one),
--     RLS, owner-write/member-read policies. ALL pre-existing policies
--     on legal_entities are dropped and replaced with the 4 intended
--     policies (H6); table privileges are revoked from public/anon/
--     authenticated and re-granted to authenticated only.
--   * Canonical default legal entity (H4):
--     workspaces.default_legal_entity_id is the SOURCE OF TRUTH.
--     legal_entities.is_default is a synchronized representation,
--     maintained by triggers (see section B4). Unambiguous legacy
--     data is reconciled (workspace pointer wins; a single legacy
--     is_default flag is adopted). Ambiguous legacy data (workspace
--     pointer NULL + >1 flagged entity) ABORTS for manual resolution.
--   * Adds invoices.legal_entity_id with SAME-WORKSPACE, non-deleted
--     validation inside protect_invoice_identity (B2).
--   * Replaces protect_invoice_identity() preserving INV-PENDING-* ->
--     INV-NEXT, DB-stamped immutable created_at, workspace-local year
--     with Europe/Chisinau fallback on invalid time zone (B3), and
--     adds the default legal entity, due-date default, legal-entity
--     validation, and a per-(workspace,year) advisory lock shared
--     with the next-number RPC (H5).
--   * Hardens workspace_set/get_invoice_next_number: the year is
--     derived server-side from the workspace time zone; the counter
--     can never be rewound below already-issued numbers (H5).
--   * Adds client middle_name / consent flags / deleted_at and
--     generated normalized columns. Duplicate enforcement is
--     SETTING-GATED by trigger and recomputes normalization from
--     NEW.phone / NEW.email (never from generated columns — B1).
--   * INTENTIONAL REMOVAL (M1): drops the unconditional unique
--     indexes clients_workspace_phone_unique /
--     clients_workspace_email_unique IF PRESENT (from an earlier
--     draft). Uniqueness is setting-gated, so hard unique indexes
--     would be wrong; they are replaced by the gated trigger (B1).
--   * Adds a NON-UNIQUE partial expression index supporting the
--     open-order VIN check (M7). Device protection uses VIN (the
--     app-normalized vehicle identifier), never free-text `device`.
--   * Replaces trigger functions / triggers listed in sections B–E.
--
-- BEHAVIOUR NOTES:
--   * invoice_due_days becomes functional for invoices inserted with
--     no explicit due_date (was previously left NULL).
--   * prevent_backdated_invoices, warranty_start,
--     default_comments/files_visibility, invoice_order_details_mode,
--     document_language and online_payments_enabled are STORED ONLY
--     today (M5); the UI copy says so. Issue-date backdating stays
--     impossible because created_at is DB-stamped/immutable; there is
--     no separate issue-date field.
--   * Soft vs hard delete (M4): this script adds clients.deleted_at
--     and app lists exclude soft-deleted rows, and legal entities are
--     soft-deleted by the app. It does NOT change any DELETE policy:
--     baseline client hard-delete and legal-entity owner hard-delete
--     policies remain, by design, pending a separate compatibility
--     review.
--   * Phone duplicates (M6): normalization is digits-only, matching
--     the preflight and the +373 form rule. Numbers that are only
--     equivalent after national trunk-prefix conversion (e.g. 0…
--     vs +373…) are NOT considered duplicates; only digit-equal
--     numbers are.
--   * Repository inspection does NOT prove the live schema matches;
--     that is what PREFLIGHT is for.
-- =====================================================================

begin;

-- =====================================================================
-- 0. HARD PREFLIGHT (in-transaction) — aborts on blockers (H1/H2/H3)
-- =====================================================================
do $$
declare
  v_def text;
  v_count integer;
  v_bad text;
begin
  -- Required tables.
  if to_regclass('public.workspaces') is null
     or to_regclass('public.workspace_members') is null
     or to_regclass('public.clients') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.invoice_number_counters') is null then
    raise exception 'General settings preflight: a required table (workspaces, workspace_members, clients, orders, invoices, invoice_number_counters) is missing. Stop.';
  end if;

  -- legal_entities starting state. Confirmed live (2026-10-20): the
  -- table does NOT exist in any schema; it is a NEW table created by
  -- section B. Absence is the expected state, not an error. But if a
  -- non-table object (view/sequence/...) owns the name, stop: CREATE
  -- TABLE IF NOT EXISTS would skip and later ALTERs would fail oddly.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'legal_entities'
      and c.relkind not in ('r', 'p')
  ) then
    raise exception 'General settings preflight: public.legal_entities exists but is not a table. Resolve manually. Stop.';
  end if;
  if to_regclass('public.legal_entities') is null then
    raise notice 'General settings: public.legal_entities is absent (expected). It will be created as a new, empty table in section B.';
  else
    raise notice 'General settings: public.legal_entities already exists. Its columns are verified below; section B aborts on any unexpected RLS policy instead of removing it.';
  end if;

  -- Membership helpers with expected security properties (H1).
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='is_workspace_member'
      and pg_get_function_identity_arguments(p.oid)='target_workspace_id uuid'
      and p.prorettype='boolean'::regtype and p.prosecdef
      and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='workspace_member_is_owner'
      and pg_get_function_identity_arguments(p.oid)='p_workspace_id uuid'
      and p.prorettype='boolean'::regtype and p.prosecdef
      and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%'
  ) then
    raise exception 'General settings preflight: is_workspace_member / workspace_member_is_owner missing or not SECURITY DEFINER with a pinned search_path. Stop.';
  end if;

  -- Exact invoice number CHECK (H1). Repository definition:
  -- CHECK (number ~ '^INV-(PENDING-.+|[0-9]{4}-[0-9]{3,})$')
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid='public.invoices'::regclass and c.conname='invoices_number_check' and c.contype='c';
  if v_def is null then
    raise exception 'General settings preflight: invoices_number_check is missing on public.invoices. Stop.';
  end if;
  if v_def not like '%^INV-(PENDING-.+|[0-9]{4}-[0-9]{3,})$%' then
    raise exception 'General settings preflight: invoices_number_check has an unexpected definition: %. Expected CHECK (number ~ ''^INV-(PENDING-.+|[0-9]{4}-[0-9]{3,})$''). Stop.', v_def;
  end if;

  -- Unique (workspace_id, number) (H1).
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid='public.invoices'::regclass and c.contype='u'
    and pg_get_constraintdef(c.oid)='UNIQUE (workspace_id, number)'
  limit 1;
  if v_def is null and not exists (
    select 1 from pg_index i
    where i.indrelid='public.invoices'::regclass and i.indisunique and i.indpred is null and i.indexprs is null
      and pg_get_indexdef(i.indexrelid) like 'CREATE UNIQUE INDEX%ON public.invoices USING btree (workspace_id, number)%'
  ) then
    raise exception 'General settings preflight: no UNIQUE (workspace_id, number) guarantee on invoices. Stop.';
  end if;

  -- Counter PK / FK / positive check (H1).
  if not exists (select 1 from pg_constraint c where c.conrelid='public.invoice_number_counters'::regclass and c.contype='p' and pg_get_constraintdef(c.oid)='PRIMARY KEY (workspace_id, year)')
     or not exists (select 1 from pg_constraint c where c.conrelid='public.invoice_number_counters'::regclass and c.contype='f' and pg_get_constraintdef(c.oid) like 'FOREIGN KEY (workspace_id) REFERENCES workspaces(id)%')
     or not exists (select 1 from pg_constraint c where c.conrelid='public.invoice_number_counters'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%last_number > 0%') then
    raise exception 'General settings preflight: invoice_number_counters must have PRIMARY KEY (workspace_id, year), FK (workspace_id) REFERENCES workspaces(id), and CHECK (last_number > 0). Stop.';
  end if;

  -- protect_invoice_identity: binding, security, body markers (H1).
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='protect_invoice_identity'
      and pg_get_function_identity_arguments(p.oid)=''
      and p.prorettype='trigger'::regtype and p.prosecdef
      and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%'
      and pg_get_functiondef(p.oid) like '%INV-PENDING-%'
      and pg_get_functiondef(p.oid) like '%INV-NEXT%'
  ) then
    raise exception 'General settings preflight: protect_invoice_identity() missing, not SECURITY DEFINER with pinned search_path, or body lacks INV-PENDING/INV-NEXT markers. Stop.';
  end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.invoices'::regclass and t.tgname='invoices_protect_identity'
      and t.tgfoid='public.protect_invoice_identity()'::regprocedure
      and t.tgenabled='O' and (t.tgtype & 2)<>0 and (t.tgtype & 4)<>0 and (t.tgtype & 16)<>0
  ) then
    raise exception 'General settings preflight: trigger invoices_protect_identity is not a BEFORE INSERT OR UPDATE trigger bound to protect_invoice_identity(). Stop.';
  end if;

  -- RLS enabled on relevant tables (H1). (Not forced; matches repo.)
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('workspaces','workspace_members','clients','orders','invoices','invoice_number_counters')
      and not c.relrowsecurity
  ) then
    raise exception 'General settings preflight: RLS is not enabled on one of workspaces/workspace_members/clients/orders/invoices/invoice_number_counters. Stop.';
  end if;

  -- Unexpected triggers that could interfere (H2). Known baseline set:
  if exists (
    select 1 from pg_trigger t
    where not t.tgisinternal
      and ((t.tgrelid='public.clients'::regclass and t.tgname not in ('clients_prevent_workspace_change','clients_enforce_workspace_setting_duplicates'))
        or (t.tgrelid='public.orders'::regclass and t.tgname not in ('orders_prevent_workspace_change','orders_enforce_unique_open_device','orders_enforce_unique_open_vin'))
        or (t.tgrelid='public.invoices'::regclass and t.tgname not in ('invoices_protect_identity')))
  ) then
    select string_agg(tgrelid::regclass::text||'.'||tgname, ', ') into v_bad
    from pg_trigger t
    where not t.tgisinternal
      and ((t.tgrelid='public.clients'::regclass and t.tgname not in ('clients_prevent_workspace_change','clients_enforce_workspace_setting_duplicates'))
        or (t.tgrelid='public.orders'::regclass and t.tgname not in ('orders_prevent_workspace_change','orders_enforce_unique_open_device','orders_enforce_unique_open_vin'))
        or (t.tgrelid='public.invoices'::regclass and t.tgname not in ('invoices_protect_identity')));
    raise exception 'General settings preflight: unexpected trigger(s) on clients/orders/invoices: %. Review manually; script will not guess their behaviour. Stop.', v_bad;
  end if;

  -- Invalid workspace time zones are NOT blockers (B3 fallback), warn.
  select string_agg(distinct timezone, ', ') into v_bad
  from public.workspaces w
  where w.timezone is not null and btrim(w.timezone)<>''
    and not exists (select 1 from pg_timezone_names z where z.name=w.timezone);
  if v_bad is not null then
    raise notice 'General settings: invalid workspace timezone value(s) [%]. Invoice creation falls back to Europe/Chisinau for these; fix the values in Settings when convenient.', v_bad;
  end if;
end $$;

-- Existing-column type verification (H2). Aborts on type drift.
do $$
declare r record; v_type text; v_gen text;
begin
  for r in
    select * from (values
      ('workspaces','company_address','text'),('workspaces','billing_email','text'),
      ('workspaces','registration_number','text'),('workspaces','tax_vat_number','text'),
      ('workspaces','iban','text'),('workspaces','bank_name','text'),('workspaces','bank_code','text'),
      ('workspaces','company_description','text'),('workspaces','print_extra_info','text'),
      ('workspaces','country_code','text'),('workspaces','document_language','text'),
      ('workspaces','warranty_start','text'),('workspaces','default_comments_visibility','text'),
      ('workspaces','default_files_visibility','text'),('workspaces','prevent_duplicate_device_orders','boolean'),
      ('workspaces','show_client_middle_name','boolean'),('workspaces','default_phone_consent','boolean'),
      ('workspaces','prevent_duplicate_phones','boolean'),('workspaces','default_email_consent','boolean'),
      ('workspaces','prevent_duplicate_emails','boolean'),('workspaces','invoice_number_template','text'),
      ('workspaces','invoice_due_days','integer'),('workspaces','invoice_order_details_mode','text'),
      ('workspaces','prevent_backdated_invoices','boolean'),('workspaces','default_legal_entity_id','uuid'),
      ('workspaces','online_payments_enabled','boolean'),
      ('clients','middle_name','text'),('clients','phone_notifications_consent','boolean'),
      ('clients','email_notifications_consent','boolean'),('clients','deleted_at','timestamp with time zone'),
      ('clients','phone_normalized','text'),('clients','email_normalized','text'),
      ('invoices','legal_entity_id','uuid'),
      ('legal_entities','id','uuid'),('legal_entities','workspace_id','uuid'),
      ('legal_entities','legal_name','text'),('legal_entities','address','text'),
      ('legal_entities','registration_number','text'),('legal_entities','tax_number','text'),
      ('legal_entities','billing_email','text'),('legal_entities','iban','text'),
      ('legal_entities','bank_name','text'),('legal_entities','bank_code','text'),
      ('legal_entities','additional_info','text'),('legal_entities','is_default','boolean'),
      ('legal_entities','created_at','timestamp with time zone'),
      ('legal_entities','updated_at','timestamp with time zone'),
      ('legal_entities','deleted_at','timestamp with time zone')
    ) as e(tbl, col, typ)
  loop
    if r.tbl='legal_entities' and to_regclass('public.legal_entities') is null then
      continue;
    end if;
    select data_type, is_generated into v_type, v_gen
    from information_schema.columns
    where table_schema='public' and table_name=r.tbl and column_name=r.col;
    if v_type is not null and v_type <> r.typ then
      raise exception 'General settings preflight: column public.%.% already exists with type % (expected %). Resolve manually. Stop.', r.tbl, r.col, v_type, r.typ;
    end if;
    if r.tbl='clients' and r.col in ('phone_normalized','email_normalized') and v_type is not null and v_gen <> 'ALWAYS' then
      raise exception 'General settings preflight: clients.% exists but is not a GENERATED ALWAYS column. Resolve manually. Stop.', r.col;
    end if;
  end loop;
end $$;

-- =====================================================================
-- Helper: invoice template validator (created early for CHECK + RPCs)
-- =====================================================================
create or replace function public.invoice_number_template_is_valid(p_template text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_template, '') ~ '^INV-\{YYYY\}-\{#{3,}\}$';
$$;

-- =====================================================================
-- A. WORKSPACES — additive columns
-- =====================================================================
alter table public.workspaces
  add column if not exists company_address text,
  add column if not exists billing_email text,
  add column if not exists registration_number text,
  add column if not exists tax_vat_number text,
  add column if not exists iban text,
  add column if not exists bank_name text,
  add column if not exists bank_code text,
  add column if not exists company_description text,
  add column if not exists print_extra_info text,
  add column if not exists country_code text,
  add column if not exists document_language text,
  add column if not exists warranty_start text,
  add column if not exists default_comments_visibility text,
  add column if not exists default_files_visibility text,
  add column if not exists prevent_duplicate_device_orders boolean,
  add column if not exists show_client_middle_name boolean,
  add column if not exists default_phone_consent boolean,
  add column if not exists prevent_duplicate_phones boolean,
  add column if not exists default_email_consent boolean,
  add column if not exists prevent_duplicate_emails boolean,
  add column if not exists invoice_number_template text,
  add column if not exists invoice_due_days integer,
  add column if not exists invoice_order_details_mode text,
  add column if not exists prevent_backdated_invoices boolean,
  add column if not exists default_legal_entity_id uuid,
  add column if not exists online_payments_enabled boolean;

-- Defaults for NULLs only (no other data is rewritten).
update public.workspaces set
  document_language = case
    when document_language is null or btrim(document_language)='' then
      case when language in ('en','ro','ru') then language else 'en' end
    else document_language end,
  warranty_start = coalesce(nullif(btrim(warranty_start),''), 'created_at'),
  default_comments_visibility = coalesce(nullif(btrim(default_comments_visibility),''), 'private'),
  default_files_visibility = coalesce(nullif(btrim(default_files_visibility),''), 'private'),
  prevent_duplicate_device_orders = coalesce(prevent_duplicate_device_orders, false),
  show_client_middle_name = coalesce(show_client_middle_name, false),
  default_phone_consent = coalesce(default_phone_consent, false),
  prevent_duplicate_phones = coalesce(prevent_duplicate_phones, false),
  default_email_consent = coalesce(default_email_consent, false),
  prevent_duplicate_emails = coalesce(prevent_duplicate_emails, false),
  invoice_number_template = coalesce(nullif(btrim(invoice_number_template),''), 'INV-{YYYY}-{###}'),
  invoice_due_days = coalesce(invoice_due_days, 14),
  invoice_order_details_mode = coalesce(nullif(btrim(invoice_order_details_mode),''), 'detailed'),
  prevent_backdated_invoices = coalesce(prevent_backdated_invoices, true),
  online_payments_enabled = coalesce(online_payments_enabled, false);

-- Existing values must already satisfy the new CHECK domains (H3).
-- Invalid values ABORT with the offending workspace ids — user data
-- is never silently rewritten to fit a constraint.
do $$
declare v_bad text;
begin
  select string_agg(id::text||' (document_language='||coalesce(document_language,'NULL')||')', ', ') into v_bad
  from public.workspaces where document_language not in ('en','ro','ru');
  if v_bad is not null then raise exception 'General settings: invalid workspaces.document_language for: %. Fix manually, then re-run.', v_bad; end if;

  select string_agg(id::text||' (warranty_start='||coalesce(warranty_start,'NULL')||')', ', ') into v_bad
  from public.workspaces where warranty_start not in ('created_at','closed_at');
  if v_bad is not null then raise exception 'General settings: invalid workspaces.warranty_start for: %. Fix manually, then re-run.', v_bad; end if;

  select string_agg(id::text||' (default_comments_visibility='||coalesce(default_comments_visibility,'NULL')||')', ', ') into v_bad
  from public.workspaces where default_comments_visibility not in ('public','private');
  if v_bad is not null then raise exception 'General settings: invalid workspaces.default_comments_visibility for: %. Fix manually, then re-run.', v_bad; end if;

  select string_agg(id::text||' (default_files_visibility='||coalesce(default_files_visibility,'NULL')||')', ', ') into v_bad
  from public.workspaces where default_files_visibility not in ('public','private');
  if v_bad is not null then raise exception 'General settings: invalid workspaces.default_files_visibility for: %. Fix manually, then re-run.', v_bad; end if;

  select string_agg(id::text||' (invoice_order_details_mode='||coalesce(invoice_order_details_mode,'NULL')||')', ', ') into v_bad
  from public.workspaces where invoice_order_details_mode not in ('detailed','simplified','one_line');
  if v_bad is not null then raise exception 'General settings: invalid workspaces.invoice_order_details_mode for: %. Fix manually, then re-run.', v_bad; end if;

  select string_agg(id::text||' (invoice_due_days='||coalesce(invoice_due_days::text,'NULL')||')', ', ') into v_bad
  from public.workspaces where invoice_due_days < 0 or invoice_due_days > 3650;
  if v_bad is not null then raise exception 'General settings: workspaces.invoice_due_days out of range 0..3650 for: %. Fix manually, then re-run.', v_bad; end if;

  select string_agg(id::text||' (invoice_number_template='||coalesce(invoice_number_template,'NULL')||')', ', ') into v_bad
  from public.workspaces where not public.invoice_number_template_is_valid(invoice_number_template);
  if v_bad is not null then raise exception 'General settings: invalid workspaces.invoice_number_template (must be INV-{YYYY}-{###} with 3+ #) for: %. Fix manually, then re-run.', v_bad; end if;
end $$;

-- CHECK constraints: scoped to public.workspaces (H2). A pre-existing
-- same-named constraint with a different definition aborts.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_document_language_check';
  if v_def is not null and v_def not like '%document_language%' then
    raise exception 'General settings: workspaces_document_language_check exists with unexpected definition: %', v_def; end if;
  if v_def is null then
    alter table public.workspaces add constraint workspaces_document_language_check
      check (document_language in ('en','ro','ru')); end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_warranty_start_check';
  if v_def is not null and v_def not like '%warranty_start%' then
    raise exception 'General settings: workspaces_warranty_start_check exists with unexpected definition: %', v_def; end if;
  if v_def is null then
    alter table public.workspaces add constraint workspaces_warranty_start_check
      check (warranty_start in ('created_at','closed_at')); end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_default_comments_visibility_check';
  if v_def is not null and v_def not like '%default_comments_visibility%' then
    raise exception 'General settings: workspaces_default_comments_visibility_check exists with unexpected definition: %', v_def; end if;
  if v_def is null then
    alter table public.workspaces add constraint workspaces_default_comments_visibility_check
      check (default_comments_visibility in ('public','private')); end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_default_files_visibility_check';
  if v_def is not null and v_def not like '%default_files_visibility%' then
    raise exception 'General settings: workspaces_default_files_visibility_check exists with unexpected definition: %', v_def; end if;
  if v_def is null then
    alter table public.workspaces add constraint workspaces_default_files_visibility_check
      check (default_files_visibility in ('public','private')); end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_invoice_order_details_mode_check';
  if v_def is not null and v_def not like '%invoice_order_details_mode%' then
    raise exception 'General settings: workspaces_invoice_order_details_mode_check exists with unexpected definition: %', v_def; end if;
  if v_def is null then
    alter table public.workspaces add constraint workspaces_invoice_order_details_mode_check
      check (invoice_order_details_mode in ('detailed','simplified','one_line')); end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_invoice_due_days_check';
  if v_def is not null and v_def not like '%invoice_due_days%' then
    raise exception 'General settings: workspaces_invoice_due_days_check exists with unexpected definition: %', v_def; end if;
  if v_def is null then
    alter table public.workspaces add constraint workspaces_invoice_due_days_check
      check (invoice_due_days between 0 and 3650); end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_invoice_number_template_check';
  if v_def is not null and v_def not like '%invoice_number_template%' then
    raise exception 'General settings: workspaces_invoice_number_template_check exists with unexpected definition: %', v_def; end if;
  if v_def is null then
    alter table public.workspaces add constraint workspaces_invoice_number_template_check
      check (public.invoice_number_template_is_valid(invoice_number_template)); end if;
end $$;

alter table public.workspaces
  alter column document_language set default 'en',
  alter column warranty_start set default 'created_at',
  alter column default_comments_visibility set default 'private',
  alter column default_files_visibility set default 'private',
  alter column prevent_duplicate_device_orders set default false,
  alter column show_client_middle_name set default false,
  alter column default_phone_consent set default false,
  alter column prevent_duplicate_phones set default false,
  alter column default_email_consent set default false,
  alter column prevent_duplicate_emails set default false,
  alter column invoice_number_template set default 'INV-{YYYY}-{###}',
  alter column invoice_due_days set default 14,
  alter column invoice_order_details_mode set default 'detailed',
  alter column prevent_backdated_invoices set default true,
  alter column online_payments_enabled set default false;

-- =====================================================================
-- B. LEGAL ENTITIES
-- =====================================================================
create table if not exists public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legal_name text not null,
  address text,
  registration_number text,
  tax_number text,
  billing_email text,
  iban text,
  bank_name text,
  bank_code text,
  additional_info text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.legal_entities
  add column if not exists address text,
  add column if not exists registration_number text,
  add column if not exists tax_number text,
  add column if not exists billing_email text,
  add column if not exists iban text,
  add column if not exists bank_name text,
  add column if not exists bank_code text,
  add column if not exists additional_info text,
  add column if not exists is_default boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

-- Pre-existing table sanity (H2): PK on id, FK workspace_id -> workspaces.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.legal_entities'::regclass and contype='p'
                 and pg_get_constraintdef(oid)='PRIMARY KEY (id)') then
    raise exception 'General settings: legal_entities must have PRIMARY KEY (id). Resolve manually. Stop.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.legal_entities'::regclass and contype='f'
                 and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id) REFERENCES workspaces(id)%') then
    alter table public.legal_entities
      add constraint legal_entities_workspace_fk
      foreign key (workspace_id) references public.workspaces(id) on delete cascade;
  end if;
end $$;

create index if not exists legal_entities_workspace_idx
  on public.legal_entities (workspace_id) where deleted_at is null;

-- B1. Canonical-default reconciliation BEFORE the unique index (H3/H4).
-- Canonical: workspaces.default_legal_entity_id. Rules:
--   * workspace pointer set + valid -> it wins; flags are re-synced.
--   * workspace pointer set but cross-workspace/deleted -> ABORT.
--   * pointer NULL + exactly one flagged entity -> adopt it.
--   * pointer NULL + more than one flagged entity -> ABORT (ambiguous).
do $$
declare v_bad text;
begin
  select string_agg(w.id::text||' -> '||w.default_legal_entity_id::text, ', ') into v_bad
  from public.workspaces w
  where w.default_legal_entity_id is not null
    and not exists (select 1 from public.legal_entities le
                    where le.id=w.default_legal_entity_id and le.workspace_id=w.id and le.deleted_at is null);
  if v_bad is not null then
    raise exception 'General settings: workspaces.default_legal_entity_id points to a deleted or other-workspace legal entity for: %. Fix manually, then re-run.', v_bad;
  end if;

  select string_agg(workspace_id::text||' ('||cnt::text||' flagged)', ', ') into v_bad
  from (
    select le.workspace_id, count(*) as cnt
    from public.legal_entities le
    join public.workspaces w on w.id=le.workspace_id and w.default_legal_entity_id is null
    where le.is_default and le.deleted_at is null
    group by le.workspace_id having count(*) > 1
  ) s;
  if v_bad is not null then
    raise exception 'General settings: ambiguous legacy legal-entity defaults (workspace pointer unset, multiple is_default) for: %. Pick the canonical default per workspace manually, then re-run.', v_bad;
  end if;

  -- Adopt a single legacy flag where the pointer is unset.
  update public.workspaces w
  set default_legal_entity_id = (
    select le.id from public.legal_entities le
    where le.workspace_id=w.id and le.is_default and le.deleted_at is null
  )
  where w.default_legal_entity_id is null
    and (select count(*) from public.legal_entities le
         where le.workspace_id=w.id and le.is_default and le.deleted_at is null) = 1;

  -- Canonical pointer wins: re-sync flags (two-step, index-safe).
  update public.legal_entities le
  set is_default=false, updated_at=now()
  from public.workspaces w
  where le.workspace_id=w.id and le.deleted_at is null and le.is_default
    and (w.default_legal_entity_id is null or le.id <> w.default_legal_entity_id);
  update public.legal_entities le
  set is_default=true, updated_at=now()
  from public.workspaces w
  where le.workspace_id=w.id and le.deleted_at is null and not le.is_default
    and le.id = w.default_legal_entity_id;
end $$;

-- One flagged default per workspace (representation guard; canonical
-- truth remains workspaces.default_legal_entity_id).
create unique index if not exists legal_entities_one_default_per_workspace
  on public.legal_entities (workspace_id) where is_default and deleted_at is null;

-- Workspace default FK (scoped definition check, H2).
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.workspaces'::regclass and conname='workspaces_default_legal_entity_fk';
  if v_def is not null and (v_def not like 'FOREIGN KEY (default_legal_entity_id) REFERENCES legal_entities(id)%'
                            or v_def not like '%ON DELETE SET NULL%') then
    raise exception 'General settings: workspaces_default_legal_entity_fk exists with unexpected definition: %', v_def;
  end if;
  if v_def is null then
    alter table public.workspaces
      add constraint workspaces_default_legal_entity_fk
      foreign key (default_legal_entity_id) references public.legal_entities(id) on delete set null;
  end if;
end $$;

-- B2. RLS + policies + grants (H6). Permissive policies OR together,
-- so the table must end with exactly the intended set. The four
-- intended policies are dropped/recreated; any OTHER pre-existing
-- policy aborts the script (see below) rather than being removed.
-- Privileges are revoked first and re-granted to authenticated.
alter table public.legal_entities enable row level security;

-- Never silently remove an unrelated policy: if a pre-existing
-- legal_entities table carries any policy other than the four
-- intended ones (e.g. an earlier draft's names), abort and let a
-- human decide. On the confirmed live schema the table is absent,
-- so this is a no-op.
do $$
declare v_bad text;
begin
  select string_agg(policyname, ', ') into v_bad
  from pg_policies
  where schemaname='public' and tablename='legal_entities'
    and policyname not in (
      'Legal entities are viewable by workspace members',
      'Legal entities are insertable by workspace owners',
      'Legal entities are updatable by workspace owners',
      'Legal entities are deletable by workspace owners'
    );
  if v_bad is not null then
    raise exception 'General settings: public.legal_entities has unexpected RLS policies (%). They will NOT be removed automatically. Review pg_policies for legal_entities, decide manually, then re-run.', v_bad;
  end if;
end $$;

drop policy if exists "Legal entities are viewable by workspace members" on public.legal_entities;
drop policy if exists "Legal entities are insertable by workspace owners" on public.legal_entities;
drop policy if exists "Legal entities are updatable by workspace owners" on public.legal_entities;
drop policy if exists "Legal entities are deletable by workspace owners" on public.legal_entities;

create policy "Legal entities are viewable by workspace members"
  on public.legal_entities for select to authenticated
  using (deleted_at is null and public.is_workspace_member(workspace_id));
create policy "Legal entities are insertable by workspace owners"
  on public.legal_entities for insert to authenticated
  with check (public.workspace_member_is_owner(workspace_id));
create policy "Legal entities are updatable by workspace owners"
  on public.legal_entities for update to authenticated
  using (public.workspace_member_is_owner(workspace_id))
  with check (public.workspace_member_is_owner(workspace_id));
create policy "Legal entities are deletable by workspace owners"
  on public.legal_entities for delete to authenticated
  using (public.workspace_member_is_owner(workspace_id));

revoke all on table public.legal_entities from public, anon, authenticated;
grant select, insert, update, delete on table public.legal_entities to authenticated;

do $$
begin
  if (select count(*) from pg_policies where schemaname='public' and tablename='legal_entities') <> 4
     or exists (select 1 from pg_policies where schemaname='public' and tablename='legal_entities'
                and cmd not in ('SELECT','INSERT','UPDATE','DELETE'))
     or has_table_privilege('anon','public.legal_entities','SELECT')
     or not has_table_privilege('authenticated','public.legal_entities','SELECT') then
    raise exception 'General settings: legal_entities policies/grants do not match the intended member-read / owner-write set. Stop.';
  end if;
end $$;

-- B3. Trigger functions (H4 sync, M3 definer existence helper).
create or replace function public.legal_entity_belongs_to_workspace(p_entity uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Existence-only check; returns no entity data (M3). Lets the
  -- workspace-default guard work even when caller RLS would hide rows.
  select exists (
    select 1 from public.legal_entities le
    where le.id = p_entity and le.workspace_id = p_workspace and le.deleted_at is null
  );
$$;

create or replace function public.legal_entities_protect_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'legal_entities.workspace_id cannot be changed' using errcode = '23514';
  end if;
  if new.deleted_at is not null then
    new.is_default := false;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.legal_entities_prepare_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Clear other flags BEFORE the partial unique index is checked.
  if new.is_default and new.deleted_at is null then
    perform pg_advisory_xact_lock(hashtextextended('legal-default:' || new.workspace_id::text, 0));
    update public.legal_entities le
    set is_default = false
    where le.workspace_id = new.workspace_id and le.id <> new.id
      and le.is_default and le.deleted_at is null;
  end if;
  return new;
end;
$$;

create or replace function public.legal_entities_sync_workspace_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('legal-default:' || new.workspace_id::text, 0));
  if new.deleted_at is not null then
    update public.workspaces w set default_legal_entity_id = null
    where w.id = new.workspace_id and w.default_legal_entity_id = new.id;
  elsif new.is_default then
    update public.workspaces w set default_legal_entity_id = new.id
    where w.id = new.workspace_id and w.default_legal_entity_id is distinct from new.id;
  elsif tg_op = 'UPDATE' and old.is_default and not new.is_default then
    update public.workspaces w set default_legal_entity_id = null
    where w.id = new.workspace_id and w.default_legal_entity_id = new.id;
  end if;
  return null;
end;
$$;

create or replace function public.workspaces_default_legal_entity_same_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.default_legal_entity_id is not null
     and not public.legal_entity_belongs_to_workspace(new.default_legal_entity_id, new.id) then
    raise exception 'default_legal_entity_id % does not reference an active legal entity of workspace %', new.default_legal_entity_id, new.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.workspaces_sync_legal_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('legal-default:' || new.id::text, 0));
  -- Two-step update so the partial unique index never sees two
  -- flagged rows mid-statement. Only differing rows are touched,
  -- which (with the IS DISTINCT guards in the entity-side sync)
  -- prevents trigger recursion from looping.
  update public.legal_entities le set is_default = false
  where le.workspace_id = new.id and le.deleted_at is null and le.is_default
    and (new.default_legal_entity_id is null or le.id <> new.default_legal_entity_id);
  if new.default_legal_entity_id is not null then
    update public.legal_entities le set is_default = true
    where le.workspace_id = new.id and le.deleted_at is null and not le.is_default
      and le.id = new.default_legal_entity_id;
  end if;
  return null;
end;
$$;

drop trigger if exists legal_entities_protect_workspace on public.legal_entities;
create trigger legal_entities_protect_workspace
  before insert or update on public.legal_entities
  for each row execute function public.legal_entities_protect_workspace();

drop trigger if exists legal_entities_single_default on public.legal_entities;
drop trigger if exists legal_entities_prepare_default on public.legal_entities;
create trigger legal_entities_prepare_default
  before insert or update of is_default, deleted_at on public.legal_entities
  for each row execute function public.legal_entities_prepare_default();

drop trigger if exists legal_entities_clear_workspace_default on public.legal_entities;
drop trigger if exists legal_entities_sync_workspace_default on public.legal_entities;
create trigger legal_entities_sync_workspace_default
  after insert or update of is_default, deleted_at on public.legal_entities
  for each row execute function public.legal_entities_sync_workspace_default();

drop trigger if exists workspaces_default_legal_entity_guard on public.workspaces;
create trigger workspaces_default_legal_entity_guard
  before insert or update of default_legal_entity_id on public.workspaces
  for each row execute function public.workspaces_default_legal_entity_same_workspace();

drop trigger if exists workspaces_sync_legal_defaults on public.workspaces;
create trigger workspaces_sync_legal_defaults
  after insert or update of default_legal_entity_id on public.workspaces
  for each row execute function public.workspaces_sync_legal_defaults();

-- =====================================================================
-- C. INVOICES — legal entity, numbering, due date (B2/B3/H5)
-- =====================================================================
alter table public.invoices
  add column if not exists legal_entity_id uuid;

do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid='public.invoices'::regclass and conname='invoices_legal_entity_fk';
  if v_def is not null and v_def not like 'FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id)%' then
    raise exception 'General settings: invoices_legal_entity_fk exists with unexpected definition: %', v_def;
  end if;
  if v_def is null then
    alter table public.invoices
      add constraint invoices_legal_entity_fk
      foreign key (legal_entity_id) references public.legal_entities(id) on delete set null;
  end if;
end $$;

create index if not exists invoices_legal_entity_idx
  on public.invoices (legal_entity_id) where legal_entity_id is not null;

-- STABLE, not IMMUTABLE (L2): time-zone conversion is involved.
create or replace function public.format_invoice_number(
  p_template text, p_created_at timestamptz, p_timezone text, p_sequence integer
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_template text := coalesce(nullif(btrim(p_template), ''), 'INV-{YYYY}-{###}');
  v_pad integer;
  v_year integer;
begin
  if not public.invoice_number_template_is_valid(v_template) then
    v_template := 'INV-{YYYY}-{###}';
  end if;
  v_pad := length(substring(v_template from '\{(#+)\}'));
  begin
    v_year := extract(year from (p_created_at at time zone coalesce(nullif(btrim(p_timezone), ''), 'Europe/Chisinau')))::integer;
  exception when invalid_parameter_value then
    v_year := extract(year from (p_created_at at time zone 'Europe/Chisinau'))::integer;
  end;
  return replace(replace(v_template, '{YYYY}', v_year::text), '{' || repeat('#', v_pad) || '}',
                 lpad(p_sequence::text, v_pad, '0'));
end;
$$;

create or replace function public.protect_invoice_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_year integer;
  v_next integer;
  v_template text;
  v_due_days integer;
  v_default_entity uuid;
  v_due_date date;
begin
  if tg_op = 'INSERT' then
    if new.number is null or new.number not like 'INV-PENDING-%' then
      raise exception 'Invoice number must start as INV-PENDING-*; the final number is assigned by the database'
        using errcode = '23514';
    end if;
    new.created_at := now();

    select w.timezone, w.invoice_number_template, w.invoice_due_days, w.default_legal_entity_id
      into v_zone, v_template, v_due_days, v_default_entity
    from public.workspaces w where w.id = new.workspace_id;

    -- B2: an explicitly supplied legal entity must be an active
    -- entity of THIS workspace (FK alone does not prove that).
    if new.legal_entity_id is null then
      new.legal_entity_id := v_default_entity;
    end if;
    if new.legal_entity_id is not null and not exists (
      select 1 from public.legal_entities le
      where le.id = new.legal_entity_id and le.workspace_id = new.workspace_id and le.deleted_at is null
    ) then
      raise exception 'legal_entity_id % is not an active legal entity of workspace %. Choose the workspace default legal entity or an entity belonging to this workspace.', new.legal_entity_id, new.workspace_id
        using errcode = '23514';
    end if;

    -- B3: workspace-local created date + due days, with the
    -- established Europe/Chisinau fallback on invalid time zone.
    if new.due_date is null and v_due_days is not null then
      begin
        v_due_date := ((new.created_at at time zone coalesce(nullif(btrim(v_zone), ''), 'Europe/Chisinau'))::date + v_due_days);
      exception when invalid_parameter_value then
        v_due_date := ((new.created_at at time zone 'Europe/Chisinau')::date + v_due_days);
      end;
      new.due_date := v_due_date;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'invoices.workspace_id cannot be changed' using errcode = '23514';
  end if;
  if new.order_id is distinct from old.order_id and old.order_id is not null then
    raise exception 'invoices.order_id cannot be changed once set' using errcode = '23514';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'invoices.created_at cannot be changed' using errcode = '23514';
  end if;

  -- B2 on UPDATE: validate whenever legal_entity_id changes.
  if new.legal_entity_id is distinct from old.legal_entity_id
     and new.legal_entity_id is not null
     and not exists (
       select 1 from public.legal_entities le
       where le.id = new.legal_entity_id and le.workspace_id = new.workspace_id and le.deleted_at is null
     ) then
    raise exception 'legal_entity_id % is not an active legal entity of workspace %. Choose an entity belonging to this workspace.', new.legal_entity_id, new.workspace_id
      using errcode = '23514';
  end if;

  if new.number is distinct from old.number then
    if old.number not like 'INV-PENDING-%' or new.number <> 'INV-NEXT' then
      raise exception 'Invoice number can only change from INV-PENDING-* to INV-NEXT' using errcode = '23514';
    end if;

    select w.timezone, w.invoice_number_template
      into v_zone, v_template
    from public.workspaces w where w.id = new.workspace_id;

    begin
      v_year := extract(year from (new.created_at at time zone coalesce(nullif(btrim(v_zone), ''), 'Europe/Chisinau')))::integer;
    exception when invalid_parameter_value then
      v_year := extract(year from (new.created_at at time zone 'Europe/Chisinau'))::integer;
    end;

    -- Serialize against workspace_set_invoice_next_number (H5).
    perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':invoice-counter:' || v_year::text, 0));

    loop
      update public.invoice_number_counters c
      set last_number = c.last_number + 1
      where c.workspace_id = new.workspace_id and c.year = v_year
      returning c.last_number into v_next;
      if found then exit; end if;
      begin
        insert into public.invoice_number_counters (workspace_id, year, last_number)
        values (new.workspace_id, v_year, 1)
        returning last_number into v_next;
        exit;
      exception when unique_violation then
        -- Concurrent issuer inserted the counter row; retry update.
      end;
    end loop;

    new.number := public.format_invoice_number(v_template, new.created_at, v_zone, v_next);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Server-side invoice year from the workspace time zone (H5/B3).
create or replace function public.workspace_invoice_year(target_workspace uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_zone text; v_year integer;
begin
  select w.timezone into v_zone from public.workspaces w where w.id = target_workspace;
  begin
    v_year := extract(year from (now() at time zone coalesce(nullif(btrim(v_zone), ''), 'Europe/Chisinau')))::integer;
  exception when invalid_parameter_value then
    v_year := extract(year from (now() at time zone 'Europe/Chisinau'))::integer;
  end;
  return v_year;
end;
$$;

-- Next-number RPCs (H5). The 3-arg/2-arg forms are kept for
-- compatibility; new callers use the year-less overloads.
create or replace function public.workspace_get_invoice_next_number(target_workspace uuid, target_year integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_last integer; v_issued integer;
begin
  if auth.uid() is null or not public.is_workspace_member(target_workspace) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  select c.last_number into v_last from public.invoice_number_counters c
  where c.workspace_id = target_workspace and c.year = target_year;
  select max(substring(i.number from 10)::integer) into v_issued
  from public.invoices i
  where i.workspace_id = target_workspace
    and i.number ~ '^INV-[0-9]{4}-[0-9]{3,}$'
    and substring(i.number from 5 for 4)::integer = target_year;
  return greatest(coalesce(v_last, 0), coalesce(v_issued, 0)) + 1;
end;
$$;

create or replace function public.workspace_get_invoice_next_number(target_workspace uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.workspace_get_invoice_next_number(target_workspace, public.workspace_invoice_year(target_workspace));
end;
$$;

create or replace function public.workspace_set_invoice_next_number(target_workspace uuid, target_year integer, next_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_last integer; v_issued integer; v_floor integer;
begin
  if auth.uid() is null or not public.workspace_member_is_owner(target_workspace) then
    raise exception 'Only the workspace owner can set the invoice next number' using errcode = '42501';
  end if;
  if next_number is null or next_number < 1 then
    raise exception 'next_number must be a positive integer' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_workspace::text || ':invoice-counter:' || target_year::text, 0));

  select c.last_number into v_last from public.invoice_number_counters c
  where c.workspace_id = target_workspace and c.year = target_year;
  select max(substring(i.number from 10)::integer) into v_issued
  from public.invoices i
  where i.workspace_id = target_workspace
    and i.number ~ '^INV-[0-9]{4}-[0-9]{3,}$'
    and substring(i.number from 5 for 4)::integer = target_year;
  v_floor := greatest(coalesce(v_last, 0), coalesce(v_issued, 0)) + 1;

  if next_number < v_floor then
    raise exception 'Invoice next number % would rewind numbering for workspace % year %: numbers up to % are already issued. The minimum allowed next number is %.', next_number, target_workspace, target_year, v_floor - 1, v_floor
      using errcode = '22023';
  end if;

  if next_number = 1 then
    delete from public.invoice_number_counters c
    where c.workspace_id = target_workspace and c.year = target_year;
  else
    insert into public.invoice_number_counters (workspace_id, year, last_number)
    values (target_workspace, target_year, next_number - 1)
    on conflict (workspace_id, year) do update set last_number = excluded.last_number;
  end if;
end;
$$;

create or replace function public.workspace_set_invoice_next_number(target_workspace uuid, next_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.workspace_set_invoice_next_number(target_workspace, public.workspace_invoice_year(target_workspace), next_number);
end;
$$;

revoke all on function public.workspace_get_invoice_next_number(uuid, integer) from public;
revoke all on function public.workspace_get_invoice_next_number(uuid) from public;
revoke all on function public.workspace_set_invoice_next_number(uuid, integer, integer) from public;
revoke all on function public.workspace_set_invoice_next_number(uuid, integer) from public;
revoke all on function public.workspace_invoice_year(uuid) from public;
grant execute on function public.workspace_get_invoice_next_number(uuid, integer) to authenticated;
grant execute on function public.workspace_get_invoice_next_number(uuid) to authenticated;
grant execute on function public.workspace_set_invoice_next_number(uuid, integer, integer) to authenticated;
grant execute on function public.workspace_set_invoice_next_number(uuid, integer) to authenticated;
grant execute on function public.workspace_invoice_year(uuid) to authenticated;

-- =====================================================================
-- D. CLIENTS — new columns + setting-gated duplicate prevention (B1)
-- =====================================================================
alter table public.clients
  add column if not exists middle_name text,
  add column if not exists phone_notifications_consent boolean not null default false,
  add column if not exists email_notifications_consent boolean not null default false,
  add column if not exists deleted_at timestamptz;

-- Generated normalized columns (verified as GENERATED ALWAYS above).
-- NOTE (B1): these columns are computed AFTER BEFORE triggers run, so
-- the trigger below NEVER reads NEW.phone_normalized /
-- NEW.email_normalized; it recomputes from NEW.phone / NEW.email.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='phone_normalized') then
    alter table public.clients
      add column phone_normalized text
      generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='email_normalized') then
    alter table public.clients
      add column email_normalized text
      generated always as (nullif(lower(btrim(coalesce(email, ''))), '')) stored;
  end if;
end $$;

create index if not exists clients_workspace_phone_normalized_idx
  on public.clients (workspace_id, phone_normalized) where deleted_at is null;
create index if not exists clients_workspace_email_normalized_idx
  on public.clients (workspace_id, email_normalized) where deleted_at is null;

-- INTENTIONAL (M1): remove unconditional unique indexes from any
-- earlier draft; enforcement is setting-gated by trigger instead.
drop index if exists public.clients_workspace_phone_unique;
drop index if exists public.clients_workspace_email_unique;

create or replace function public.clients_enforce_workspace_setting_duplicates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prevent_phone boolean;
  v_prevent_email boolean;
  -- B1: recompute from the raw NEW values. Generated columns are not
  -- yet computed in a BEFORE trigger (NULL on INSERT, stale on UPDATE).
  v_phone_norm text := nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  v_email_norm text := nullif(lower(btrim(coalesce(new.email, ''))), '');
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select w.prevent_duplicate_phones, w.prevent_duplicate_emails
    into v_prevent_phone, v_prevent_email
  from public.workspaces w where w.id = new.workspace_id;

  if coalesce(v_prevent_phone, false) and v_phone_norm is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':phone:' || v_phone_norm, 0));
    if exists (
      select 1 from public.clients c
      where c.workspace_id = new.workspace_id and c.deleted_at is null
        and c.id <> new.id and c.phone_normalized = v_phone_norm
    ) then
      raise exception 'A client with phone % already exists in this workspace (duplicate phones are prevented by workspace settings)', new.phone
        using errcode = '23505';
    end if;
  end if;

  if coalesce(v_prevent_email, false) and v_email_norm is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':email:' || v_email_norm, 0));
    if exists (
      select 1 from public.clients c
      where c.workspace_id = new.workspace_id and c.deleted_at is null
        and c.id <> new.id and c.email_normalized = v_email_norm
    ) then
      raise exception 'A client with email % already exists in this workspace (duplicate emails are prevented by workspace settings)', new.email
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clients_enforce_workspace_setting_duplicates on public.clients;
create trigger clients_enforce_workspace_setting_duplicates
  before insert or update on public.clients
  for each row execute function public.clients_enforce_workspace_setting_duplicates();

-- =====================================================================
-- E. ORDERS — open-order VIN protection (setting-gated, M7)
-- =====================================================================
-- Non-unique partial expression index matching the trigger predicate.
create index if not exists orders_workspace_open_vin_idx
  on public.orders (workspace_id, (upper(btrim(vin))))
  where status in ('new', 'in-progress', 'waiting-parts')
    and nullif(btrim(vin), '') is not null;

do $$
declare v_def text;
begin
  select pg_get_indexdef(i.indexrelid) into v_def
  from pg_index i where i.indexrelid='public.orders_workspace_open_vin_idx'::regclass;
  if v_def is null or exists (select 1 from pg_index i where i.indexrelid='public.orders_workspace_open_vin_idx'::regclass and i.indisunique) then
    raise exception 'General settings: orders_workspace_open_vin_idx must exist and be NON-unique (enforcement is setting-gated). Definition: %', v_def;
  end if;
end $$;

create or replace function public.orders_enforce_unique_open_vin()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prevent boolean;
  v_vin text := nullif(upper(btrim(coalesce(new.vin, ''))), '');
begin
  if v_vin is null or new.status not in ('new', 'in-progress', 'waiting-parts') then
    return new;
  end if;

  select w.prevent_duplicate_device_orders into v_prevent
  from public.workspaces w where w.id = new.workspace_id;
  if not coalesce(v_prevent, false) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':vin:' || v_vin, 0));
  if exists (
    select 1 from public.orders o
    where o.workspace_id = new.workspace_id and o.id <> new.id
      and o.status in ('new', 'in-progress', 'waiting-parts')
      and nullif(upper(btrim(coalesce(o.vin, ''))), '') = v_vin
  ) then
    raise exception 'An open order already exists in this workspace for VIN % (duplicate open orders are prevented by workspace settings)', v_vin
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_enforce_unique_open_device on public.orders;
drop trigger if exists orders_enforce_unique_open_vin on public.orders;
create trigger orders_enforce_unique_open_vin
  before insert or update on public.orders
  for each row execute function public.orders_enforce_unique_open_vin();

-- =====================================================================
-- F. Function privileges (L1): trigger-only functions are not
--    directly callable; RPCs keep authenticated EXECUTE (granted in C).
-- =====================================================================
revoke all on function public.protect_invoice_identity() from public, anon, authenticated, service_role;
grant execute on function public.protect_invoice_identity() to service_role;
revoke all on function public.format_invoice_number(text, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.format_invoice_number(text, timestamptz, text, integer) to service_role;
revoke all on function public.invoice_number_template_is_valid(text) from public, anon;
-- CHECK constraints evaluate functions as the WRITING role (authenticated
-- via PostgREST), unlike trigger functions. The workspaces template CHECK
-- therefore requires authenticated EXECUTE; without it every workspace
-- update fails with "permission denied for function
-- invoice_number_template_is_valid". The function is a pure immutable
-- validator (no data access), so this grant is safe. anon stays revoked.
grant execute on function public.invoice_number_template_is_valid(text) to authenticated, service_role;
revoke all on function public.legal_entity_belongs_to_workspace(uuid, uuid) from public, anon;
grant execute on function public.legal_entity_belongs_to_workspace(uuid, uuid) to authenticated, service_role;
revoke all on function public.legal_entities_protect_workspace() from public, anon, authenticated, service_role;
grant execute on function public.legal_entities_protect_workspace() to service_role;
revoke all on function public.legal_entities_prepare_default() from public, anon, authenticated, service_role;
grant execute on function public.legal_entities_prepare_default() to service_role;
revoke all on function public.legal_entities_sync_workspace_default() from public, anon, authenticated, service_role;
grant execute on function public.legal_entities_sync_workspace_default() to service_role;
revoke all on function public.workspaces_default_legal_entity_same_workspace() from public, anon, authenticated, service_role;
grant execute on function public.workspaces_default_legal_entity_same_workspace() to service_role;
revoke all on function public.workspaces_sync_legal_defaults() from public, anon, authenticated, service_role;
grant execute on function public.workspaces_sync_legal_defaults() to service_role;
revoke all on function public.clients_enforce_workspace_setting_duplicates() from public, anon, authenticated, service_role;
grant execute on function public.clients_enforce_workspace_setting_duplicates() to service_role;
revoke all on function public.orders_enforce_unique_open_vin() from public, anon, authenticated, service_role;
grant execute on function public.orders_enforce_unique_open_vin() to service_role;

-- =====================================================================
-- G. In-transaction post-checks before COMMIT
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='legal_entities' and c.relkind in ('r','p')
  ) then
    raise exception 'General settings post-check: public.legal_entities was not created as a table.';
  end if;
  -- Intentional duplicate clients must stay valid: enforcement is
  -- setting-gated only, never a unique index over normalized contacts.
  if exists (
    select 1 from pg_index i
    where i.indrelid='public.clients'::regclass and i.indisunique
      and (pg_get_indexdef(i.indexrelid) like '%phone_normalized%'
        or pg_get_indexdef(i.indexrelid) like '%email_normalized%')
  ) then
    raise exception 'General settings post-check: a UNIQUE index over clients phone/email normalized columns exists. Duplicate enforcement must remain setting-gated; intentional duplicates would break.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='invoices_protect_identity' and tgfoid='public.protect_invoice_identity()'::regprocedure) then
    raise exception 'General settings post-check: invoices_protect_identity trigger missing/wrong function.';
  end if;
  if exists (select 1 from pg_index where indexrelid='public.orders_workspace_open_vin_idx'::regclass and indisunique) then
    raise exception 'General settings post-check: orders_workspace_open_vin_idx must be non-unique.';
  end if;
  if exists (
    select 1 from public.legal_entities le
    join public.workspaces w on w.id = le.workspace_id
    where le.deleted_at is null
      and le.is_default is distinct from (w.default_legal_entity_id = le.id)
  ) then
    raise exception 'General settings post-check: legal_entities.is_default is out of sync with workspaces.default_legal_entity_id.';
  end if;
  raise notice 'General settings script checks passed inside the transaction. Run the VERIFY file after commit.';
end $$;

commit;
