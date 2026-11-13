-- =============================================================================
-- Shared Google Calendar for the workspace (owner connects once; team uses it in-app)
-- Script: 20261113100000_google_calendar.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- 1) workspace_google_calendar — connection metadata (no secrets); member SELECT
-- 2) workspace_google_calendar_secrets — Vault secret id (service_role only)
-- 3) crm_gcal_set_credential / get / clear (service_role execute only)
-- One DO block. Ends with notify pgrst.
-- =============================================================================

do $google_calendar$
begin
  -- -------------------------------------------------------------------------
  -- Preflight
  -- -------------------------------------------------------------------------
  if to_regclass('public.workspaces') is null then
    raise exception 'google_calendar preflight: public.workspaces missing';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'google_calendar preflight: is_workspace_member(uuid) missing';
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'google_calendar preflight: supabase_vault extension missing';
  end if;

  -- -------------------------------------------------------------------------
  -- Connection metadata (members may read; writes via service_role / Edge Functions)
  -- -------------------------------------------------------------------------
  create table if not exists public.workspace_google_calendar (
    workspace_id uuid primary key references public.workspaces(id) on delete cascade,
    google_email text,
    calendar_id text,
    calendar_summary text,
    calendar_time_zone text,
    connected_by uuid,
    connected_at timestamptz,
    updated_at timestamptz not null default now(),
    last_error text
  );

  alter table public.workspace_google_calendar enable row level security;

  drop policy if exists workspace_google_calendar_member_select on public.workspace_google_calendar;
  create policy workspace_google_calendar_member_select on public.workspace_google_calendar
    for select to authenticated using (public.is_workspace_member(workspace_id));

  revoke all on table public.workspace_google_calendar from public, anon, authenticated;
  grant select on table public.workspace_google_calendar to authenticated;
  grant all on table public.workspace_google_calendar to service_role;

  -- -------------------------------------------------------------------------
  -- Secrets table (Vault id only — never exposed to authenticated)
  -- -------------------------------------------------------------------------
  create table if not exists public.workspace_google_calendar_secrets (
    workspace_id uuid primary key references public.workspaces(id) on delete cascade,
    credential_secret_id uuid not null,
    updated_at timestamptz not null default now()
  );
  alter table public.workspace_google_calendar_secrets enable row level security;
  revoke all on table public.workspace_google_calendar_secrets from public, anon, authenticated;
  grant all on table public.workspace_google_calendar_secrets to service_role;

  -- -------------------------------------------------------------------------
  -- Vault RPCs (service_role only)
  -- -------------------------------------------------------------------------
  create or replace function public.crm_gcal_set_credential(p_workspace_id uuid, p_secret text)
  returns uuid
  language plpgsql
  security definer
  set search_path = pg_catalog, public, vault
  as $fn$
  declare
    v_existing uuid;
    v_id uuid;
  begin
    if p_workspace_id is null or p_secret is null or length(p_secret) = 0 then
      raise exception 'gcal:invalid_args' using errcode = '22023';
    end if;
    select credential_secret_id into v_existing
      from public.workspace_google_calendar_secrets
     where workspace_id = p_workspace_id
     for update;
    if v_existing is not null then
      perform vault.update_secret(v_existing, p_secret);
      v_id := v_existing;
      update public.workspace_google_calendar_secrets
         set updated_at = now()
       where workspace_id = p_workspace_id;
    else
      v_id := vault.create_secret(
        p_secret,
        'workspace_gcal_' || p_workspace_id::text,
        'Google Calendar credential for shared workspace calendar'
      );
      insert into public.workspace_google_calendar_secrets (workspace_id, credential_secret_id)
      values (p_workspace_id, v_id);
    end if;
    return v_id;
  end;
  $fn$;

  create or replace function public.crm_gcal_get_credential(p_workspace_id uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = pg_catalog, public, vault
  as $fn$
    select d.decrypted_secret
      from public.workspace_google_calendar_secrets s
      join vault.decrypted_secrets d on d.id = s.credential_secret_id
     where s.workspace_id = p_workspace_id;
  $fn$;

  create or replace function public.crm_gcal_clear_credential(p_workspace_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, public, vault
  as $fn$
  declare
    v_id uuid;
  begin
    select credential_secret_id into v_id
      from public.workspace_google_calendar_secrets
     where workspace_id = p_workspace_id
     for update;
    if v_id is not null then
      delete from vault.secrets where id = v_id;
    end if;
    delete from public.workspace_google_calendar_secrets where workspace_id = p_workspace_id;
    update public.workspace_google_calendar
       set google_email = null,
           calendar_id = null,
           calendar_summary = null,
           calendar_time_zone = null,
           connected_by = null,
           connected_at = null,
           last_error = null,
           updated_at = now()
     where workspace_id = p_workspace_id;
  end;
  $fn$;

  revoke all on function public.crm_gcal_set_credential(uuid, text) from public, anon, authenticated;
  revoke all on function public.crm_gcal_get_credential(uuid) from public, anon, authenticated;
  revoke all on function public.crm_gcal_clear_credential(uuid) from public, anon, authenticated;
  grant execute on function public.crm_gcal_set_credential(uuid, text) to service_role;
  grant execute on function public.crm_gcal_get_credential(uuid) to service_role;
  grant execute on function public.crm_gcal_clear_credential(uuid) to service_role;

  -- -------------------------------------------------------------------------
  -- Postflight
  -- -------------------------------------------------------------------------
  if to_regclass('public.workspace_google_calendar') is null then
    raise exception 'google_calendar postflight: workspace_google_calendar missing';
  end if;
  if to_regclass('public.workspace_google_calendar_secrets') is null then
    raise exception 'google_calendar postflight: workspace_google_calendar_secrets missing';
  end if;
  if to_regprocedure('public.crm_gcal_set_credential(uuid, text)') is null then
    raise exception 'google_calendar postflight: crm_gcal_set_credential missing';
  end if;
  if to_regprocedure('public.crm_gcal_get_credential(uuid)') is null then
    raise exception 'google_calendar postflight: crm_gcal_get_credential missing';
  end if;
  if to_regprocedure('public.crm_gcal_clear_credential(uuid)') is null then
    raise exception 'google_calendar postflight: crm_gcal_clear_credential missing';
  end if;

  notify pgrst, 'reload schema';
end;
$google_calendar$;
