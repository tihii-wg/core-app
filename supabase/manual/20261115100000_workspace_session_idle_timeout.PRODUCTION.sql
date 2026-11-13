-- =============================================================================
-- Workspace session idle timeout (client-enforced auto logout)
-- Script: 20261115100000_workspace_session_idle_timeout.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- Depends on: public.workspaces, public.workspace_members,
--   public.crm_is_workspace_owner_id(uuid), public.is_workspace_member(uuid)
-- =============================================================================
-- Adds:
--   1) workspaces.session_idle_timeout_minutes (nullable int) — null = off
--      Allowed: 30, 60, 120, 240, 480, 720, 1440
--   2) crm_set_workspace_session_idle_timeout(workspace_id, minutes)
--      Owner or admin may set; members may only read via normal SELECT policies.
-- Workspaces UPDATE RLS stays owner-only for other columns; admins use the RPC.
-- Idempotent. Single DO block. Ends with notify pgrst.
-- =============================================================================

do $workspace_session_idle_timeout$
begin
  if to_regclass('public.workspaces') is null then
    raise exception 'workspace_session_idle_timeout preflight: public.workspaces missing';
  end if;
  if to_regclass('public.workspace_members') is null then
    raise exception 'workspace_session_idle_timeout preflight: public.workspace_members missing';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    raise exception 'workspace_session_idle_timeout preflight: crm_is_workspace_owner_id(uuid) missing';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'workspace_session_idle_timeout preflight: is_workspace_member(uuid) missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'workspaces'
       and column_name = 'session_idle_timeout_minutes'
  ) then
    alter table public.workspaces
      add column session_idle_timeout_minutes integer null;
  end if;

  alter table public.workspaces
    alter column session_idle_timeout_minutes drop not null;

  alter table public.workspaces
    alter column session_idle_timeout_minutes set default null;

  -- Normalize illegal values left by a partial run, then (re)apply CHECK.
  if exists (
    select 1 from public.workspaces
     where session_idle_timeout_minutes is not null
       and session_idle_timeout_minutes not in (30, 60, 120, 240, 480, 720, 1440)
  ) then
    update public.workspaces
       set session_idle_timeout_minutes = null
     where session_idle_timeout_minutes is not null
       and session_idle_timeout_minutes not in (30, 60, 120, 240, 480, 720, 1440);
  end if;

  if exists (
    select 1 from pg_constraint
     where conname = 'workspaces_session_idle_timeout_minutes_check'
       and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      drop constraint workspaces_session_idle_timeout_minutes_check;
  end if;

  alter table public.workspaces
    add constraint workspaces_session_idle_timeout_minutes_check
    check (
      session_idle_timeout_minutes is null
      or session_idle_timeout_minutes in (30, 60, 120, 240, 480, 720, 1440)
    );

  comment on column public.workspaces.session_idle_timeout_minutes is
    'Client-enforced idle logout (minutes). null = off. Allowed: 30,60,120,240,480,720,1440. Effective timeout for a user = MIN across memberships.';

  create or replace function public.crm_set_workspace_session_idle_timeout(
    p_workspace_id uuid,
    p_minutes integer
  )
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $fn$
  declare
    v_role text;
  begin
    if p_workspace_id is null then
      raise exception 'workspace_session_idle_timeout: workspace_id required'
        using errcode = '22023';
    end if;

    if p_minutes is not null and p_minutes not in (30, 60, 120, 240, 480, 720, 1440) then
      raise exception 'workspace_session_idle_timeout: invalid minutes %', p_minutes
        using errcode = '22023';
    end if;

    if coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
      null;
    else
      select wm.role into v_role
        from public.workspace_members wm
        join public.workspaces w on w.id = wm.workspace_id
       where wm.workspace_id = p_workspace_id
         and wm.user_id = auth.uid()
         and wm.deleted_at is null
         and w.deleted_at is null
       limit 1;
      if v_role is distinct from 'admin' then
        raise exception 'workspace_session_idle_timeout: owner or admin only'
          using errcode = '42501';
      end if;
    end if;

    update public.workspaces
       set session_idle_timeout_minutes = p_minutes,
           updated_at = timezone('utc', now())
     where id = p_workspace_id
       and deleted_at is null;

    if not found then
      raise exception 'workspace_session_idle_timeout: workspace not found'
        using errcode = 'P0002';
    end if;

    return p_minutes;
  end;
  $fn$;

  revoke all on function public.crm_set_workspace_session_idle_timeout(uuid, integer)
    from public, anon;
  grant execute on function public.crm_set_workspace_session_idle_timeout(uuid, integer)
    to authenticated, service_role;

  comment on function public.crm_set_workspace_session_idle_timeout(uuid, integer) is
    'managed-object: core-app/crm_set_workspace_session_idle_timeout@v1 — owner or admin sets workspaces.session_idle_timeout_minutes (null = off).';

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'workspaces'
       and column_name = 'session_idle_timeout_minutes'
  ) then
    raise exception 'workspace_session_idle_timeout postflight: column missing';
  end if;

  if to_regprocedure('public.crm_set_workspace_session_idle_timeout(uuid,integer)') is null then
    raise exception 'workspace_session_idle_timeout postflight: RPC missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'workspaces_session_idle_timeout_minutes_check'
       and conrelid = 'public.workspaces'::regclass
  ) then
    raise exception 'workspace_session_idle_timeout postflight: CHECK missing';
  end if;

  notify pgrst, 'reload schema';
end;
$workspace_session_idle_timeout$;
