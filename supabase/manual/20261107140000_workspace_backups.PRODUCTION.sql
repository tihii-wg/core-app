-- =============================================================================
-- Per-workspace backups to GitHub or Google Drive — schema, secrets, export helpers
-- Script: 20261107140000_workspace_backups.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Requires extensions: supabase_vault (Vault). The scheduler is a separate script
-- (20261107140100_workspace_backups_scheduler.PRODUCTION.sql) applied after the Edge Functions are deployed.
-- =============================================================================
-- Adds:
--   public.workspace_backup_settings (one row per workspace; owner-only via RLS):
--     provider 'github' | 'google_drive' | NULL, enabled, frequency 'daily' | 'weekly', hour_utc 0..23, weekday 0..6,
--     retention_count 1..90, include_files, github_repo ('owner/name'), github_branch, github_path, google_folder_id,
--     google_account_email, credential_secret_id (Vault id — never exposed), last_run_at, last_status, last_error.
--   public.workspace_backup_runs (history; owner can read): status queued|running|success|failed, trigger manual|schedule,
--     started_at, finished_at, size_bytes, file_name, location (url/path), error.
--   Vault-backed credential helpers (service_role only):
--     crm_backup_set_credential(p_workspace_id, p_secret text) / crm_backup_get_credential(p_workspace_id) / crm_backup_clear_credential.
--   Export helpers (service_role only):
--     crm_backup_table_plan() → which tables to export and how (direct workspace_id or via parent FK);
--     crm_backup_export_rows(p_workspace_id, p_table, p_offset, p_limit) → jsonb array of rows of that workspace.
--   crm_backup_due_workspaces(p_now) → workspaces whose schedule is due (service_role only).
--   Owner RPCs: crm_backup_request_run(p_workspace_id) inserts a queued manual run (the app then calls the Edge Function).
--
-- Credentials are stored ONLY in Vault; the settings table keeps the secret id. Browser never reads secrets.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'workspace_backups preflight: enable the Vault extension first (Database → Extensions → supabase_vault)';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    raise exception 'workspace_backups preflight: crm_is_workspace_owner_id(uuid) missing';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_backup_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  provider text check (provider in ('github', 'google_drive')),
  enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly')),
  hour_utc smallint not null default 1 check (hour_utc between 0 and 23),
  weekday smallint not null default 0 check (weekday between 0 and 6),
  retention_count smallint not null default 14 check (retention_count between 1 and 90),
  include_files boolean not null default true,
  github_repo text check (github_repo is null or github_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  github_branch text,
  github_path text,
  google_folder_id text,
  google_account_email text,
  credential_secret_id uuid,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.workspace_backup_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'failed')),
  trigger text not null default 'manual' check (trigger in ('manual', 'schedule')),
  provider text,
  started_at timestamptz,
  finished_at timestamptz,
  size_bytes bigint,
  file_name text,
  location text,
  error text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists workspace_backup_runs_ws_created_idx on public.workspace_backup_runs (workspace_id, created_at desc);

alter table public.workspace_backup_settings enable row level security;
alter table public.workspace_backup_runs enable row level security;

-- Owner-only. credential_secret_id is hidden by column privileges below.
drop policy if exists workspace_backup_settings_owner_select on public.workspace_backup_settings;
create policy workspace_backup_settings_owner_select on public.workspace_backup_settings
  for select to authenticated using (public.crm_is_workspace_owner_id(workspace_id));
drop policy if exists workspace_backup_settings_owner_insert on public.workspace_backup_settings;
create policy workspace_backup_settings_owner_insert on public.workspace_backup_settings
  for insert to authenticated with check (public.crm_is_workspace_owner_id(workspace_id));
drop policy if exists workspace_backup_settings_owner_update on public.workspace_backup_settings;
create policy workspace_backup_settings_owner_update on public.workspace_backup_settings
  for update to authenticated using (public.crm_is_workspace_owner_id(workspace_id))
  with check (public.crm_is_workspace_owner_id(workspace_id));

drop policy if exists workspace_backup_runs_owner_select on public.workspace_backup_runs;
create policy workspace_backup_runs_owner_select on public.workspace_backup_runs
  for select to authenticated using (public.crm_is_workspace_owner_id(workspace_id));

revoke all on table public.workspace_backup_settings from public, anon, authenticated;
grant select (workspace_id, provider, enabled, frequency, hour_utc, weekday, retention_count, include_files,
              github_repo, github_branch, github_path, google_folder_id, google_account_email,
              last_run_at, last_status, last_error, updated_at)
  on public.workspace_backup_settings to authenticated;
grant insert (workspace_id, provider, enabled, frequency, hour_utc, weekday, retention_count, include_files,
              github_repo, github_branch, github_path, google_folder_id)
  on public.workspace_backup_settings to authenticated;
grant update (provider, enabled, frequency, hour_utc, weekday, retention_count, include_files,
              github_repo, github_branch, github_path, google_folder_id, updated_at)
  on public.workspace_backup_settings to authenticated;
grant all on public.workspace_backup_settings to service_role;

revoke all on table public.workspace_backup_runs from public, anon, authenticated;
grant select on public.workspace_backup_runs to authenticated;
grant all on public.workspace_backup_runs to service_role;

-- Owner can see whether a credential is connected without seeing the secret id.
create or replace function public.crm_backup_credential_connected(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false)
     and exists (select 1 from public.workspace_backup_settings s
                 where s.workspace_id = p_workspace_id and s.credential_secret_id is not null);
$fn$;
revoke all on function public.crm_backup_credential_connected(uuid) from public, anon;
grant execute on function public.crm_backup_credential_connected(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vault credential helpers (service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.crm_backup_set_credential(p_workspace_id uuid, p_secret text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, vault as $fn$
declare
  v_existing uuid;
  v_id uuid;
begin
  if p_workspace_id is null or p_secret is null or length(p_secret) = 0 then
    raise exception 'workspace_backup:invalid_args' using errcode = '22023';
  end if;
  insert into public.workspace_backup_settings (workspace_id) values (p_workspace_id) on conflict (workspace_id) do nothing;
  select credential_secret_id into v_existing from public.workspace_backup_settings where workspace_id = p_workspace_id for update;
  if v_existing is not null then
    perform vault.update_secret(v_existing, p_secret);
    v_id := v_existing;
  else
    v_id := vault.create_secret(p_secret, 'workspace_backup_' || p_workspace_id::text, 'Backup credential for workspace');
    update public.workspace_backup_settings set credential_secret_id = v_id, updated_at = now() where workspace_id = p_workspace_id;
  end if;
  return v_id;
end;
$fn$;

create or replace function public.crm_backup_get_credential(p_workspace_id uuid)
returns text
language sql stable security definer set search_path = pg_catalog, public, vault as $fn$
  select d.decrypted_secret
  from public.workspace_backup_settings s
  join vault.decrypted_secrets d on d.id = s.credential_secret_id
  where s.workspace_id = p_workspace_id;
$fn$;

create or replace function public.crm_backup_clear_credential(p_workspace_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, vault as $fn$
declare
  v_id uuid;
begin
  select credential_secret_id into v_id from public.workspace_backup_settings where workspace_id = p_workspace_id for update;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  update public.workspace_backup_settings
     set credential_secret_id = null, google_account_email = null, enabled = false, updated_at = now()
   where workspace_id = p_workspace_id;
end;
$fn$;

revoke all on function public.crm_backup_set_credential(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_backup_get_credential(uuid) from public, anon, authenticated;
revoke all on function public.crm_backup_clear_credential(uuid) from public, anon, authenticated;
grant execute on function public.crm_backup_set_credential(uuid, text) to service_role;
grant execute on function public.crm_backup_get_credential(uuid) to service_role;
grant execute on function public.crm_backup_clear_credential(uuid) to service_role;

-- Owner disconnects (no secret exposure).
create or replace function public.crm_backup_disconnect(p_workspace_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if not coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
    raise exception 'workspace_backup:owner_only' using errcode = '42501';
  end if;
  perform public.crm_backup_clear_credential(p_workspace_id);
end;
$fn$;
revoke all on function public.crm_backup_disconnect(uuid) from public, anon;
grant execute on function public.crm_backup_disconnect(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Export helpers (service_role only)
-- ---------------------------------------------------------------------------
-- Plan: every public table with a workspace_id column (direct), plus tables without workspace_id that reference a
-- direct table through a single-column FK (via_parent). Backup bookkeeping tables are excluded.
create or replace function public.crm_backup_table_plan()
returns table (table_name text, mode text, fk_column text, parent_table text)
language sql stable security definer set search_path = pg_catalog, public as $fn$
  with direct as (
    select c.relname::text as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
    where c.relkind = 'r'
      -- Never export backup bookkeeping or secret-bearing tables (tokens, API keys, integration credentials).
      and c.relname not in ('workspace_backup_settings', 'workspace_backup_runs', 'api_keys', 'webhook_endpoints',
                            'integration_connections', 'public_links', 'order_lifecycle_tokens', 'warehouse_rpc_idempotency',
                            'payment_links')
  ),
  via as (
    select distinct on (child.relname)
           child.relname::text as t, att.attname::text as fk_col, parent.relname::text as parent_t
    from pg_constraint con
    join pg_class child on child.oid = con.conrelid
    join pg_namespace n on n.oid = child.relnamespace and n.nspname = 'public'
    join pg_class parent on parent.oid = con.confrelid
    join pg_attribute att on att.attrelid = child.oid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and array_length(con.conkey, 1) = 1
      and child.relkind = 'r'
      and parent.relname in (select t from direct)
      and child.relname not in (select t from direct)
      and child.relname not in ('workspace_backup_settings', 'workspace_backup_runs', 'api_keys', 'webhook_endpoints',
                                'integration_connections', 'public_links', 'order_lifecycle_tokens', 'warehouse_rpc_idempotency',
                                'payment_links')
    order by child.relname, (parent.relname = 'orders') desc, parent.relname
  )
  select t, 'direct', 'workspace_id', null::text from direct
  union all
  select t, 'via_parent', fk_col, parent_t from via
  order by 1;
$fn$;

create or replace function public.crm_backup_export_rows(p_workspace_id uuid, p_table text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $fn$
declare
  v_plan record;
  v_rows jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  select * into v_plan from public.crm_backup_table_plan() p where p.table_name = p_table;
  if not found then
    raise exception 'workspace_backup:unknown_table %', p_table using errcode = '22023';
  end if;
  if v_plan.mode = 'direct' then
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I where workspace_id = $1 order by 1 offset $2 limit $3) t',
      p_table) into v_rows using p_workspace_id, v_offset, v_limit;
  else
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (
         select c.* from public.%I c join public.%I p on p.id = c.%I
         where p.workspace_id = $1 order by 1 offset $2 limit $3) t',
      p_table, v_plan.parent_table, v_plan.fk_column) into v_rows using p_workspace_id, v_offset, v_limit;
  end if;
  return v_rows;
end;
$fn$;

revoke all on function public.crm_backup_table_plan() from public, anon, authenticated;
revoke all on function public.crm_backup_export_rows(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.crm_backup_table_plan() to service_role;
grant execute on function public.crm_backup_export_rows(uuid, text, integer, integer) to service_role;

-- Workspaces whose schedule is due now (no successful/running run in the current slot).
create or replace function public.crm_backup_due_workspaces(p_now timestamptz default now())
returns setof uuid
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select s.workspace_id
  from public.workspace_backup_settings s
  join public.workspaces w on w.id = s.workspace_id and w.deleted_at is null
  where s.enabled and s.provider is not null and s.credential_secret_id is not null
    and extract(hour from p_now at time zone 'utc') >= s.hour_utc
    and (s.frequency = 'daily' or extract(dow from p_now at time zone 'utc') = s.weekday)
    and not exists (
      select 1 from public.workspace_backup_runs r
      where r.workspace_id = s.workspace_id
        and r.trigger = 'schedule'
        and r.status in ('running', 'success')
        and r.created_at >= date_trunc('day', p_now at time zone 'utc') at time zone 'utc'
    );
$fn$;
revoke all on function public.crm_backup_due_workspaces(timestamptz) from public, anon, authenticated;
grant execute on function public.crm_backup_due_workspaces(timestamptz) to service_role;

-- Owner requests a manual run (the app then calls the Edge Function with the returned run id).
create or replace function public.crm_backup_request_run(p_workspace_id uuid)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare
  v_id uuid;
  v_provider text;
begin
  if not coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
    raise exception 'workspace_backup:owner_only' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspace_backup_runs where workspace_id = p_workspace_id
             and status in ('queued', 'running') and created_at > now() - interval '30 minutes') then
    raise exception 'workspace_backup:already_running' using errcode = '55000';
  end if;
  select provider into v_provider from public.workspace_backup_settings where workspace_id = p_workspace_id;
  insert into public.workspace_backup_runs (workspace_id, status, trigger, provider)
  values (p_workspace_id, 'queued', 'manual', v_provider)
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.crm_backup_request_run(uuid) from public, anon;
grant execute on function public.crm_backup_request_run(uuid) to authenticated, service_role;

do $postflight$
begin
  if to_regclass('public.workspace_backup_settings') is null or to_regclass('public.workspace_backup_runs') is null then
    raise exception 'workspace_backups postflight: tables missing';
  end if;
  if to_regprocedure('public.crm_backup_export_rows(uuid,text,integer,integer)') is null then
    raise exception 'workspace_backups postflight: export helper missing';
  end if;
end;
$postflight$;

commit;
