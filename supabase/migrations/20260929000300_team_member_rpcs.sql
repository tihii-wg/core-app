-- Team Members (Settings): the two functions src/services/apiWorkspaces.ts calls.
--
--   workspace_member_profiles(target_workspace) -> (user_id, full_name, email) of every active member
--     of the workspace, for any active member of that active workspace.
--   workspace_member_find_user(target_workspace, member_email) -> the user id of the account with
--     exactly that email, or null, for an active owner or admin of that active workspace.
--
-- profiles RLS only exposes a user's own row, so names and emails of teammates need a definer
-- function. Authorization is the caller's own active membership in the requested workspace;
-- profiles.active_workspace_id is never consulted. Emails come from auth.users, never from
-- profiles.email: users can rewrite their own profiles.email, so trusting it would let a member
-- impersonate another address in the team list or be returned for someone else's email.
--
-- Depends only on 20260929000000_production_baseline.sql. Adds two functions and their EXECUTE
-- grants; no table, policy, trigger, index, grant or function that already exists is changed.
-- Neither function exists in production; plain CREATE (and the guard below, which also rejects
-- overloads under the same names) makes the migration fail instead of replacing an unknown version.

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('workspace_member_profiles', 'workspace_member_find_user')
  ) then
    raise exception 'public.workspace_member_profiles or public.workspace_member_find_user already exists; inspect it before applying this migration';
  end if;
end $$;

create function public.workspace_member_profiles(target_workspace uuid)
returns table (user_id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.workspace_members caller
    join public.workspaces w on w.id = caller.workspace_id
    where caller.workspace_id = target_workspace
      and caller.user_id = (select auth.uid())
      and caller.deleted_at is null
      and w.deleted_at is null
  ) then
    raise exception 'You do not have access to this workspace' using errcode = '42501';
  end if;

  return query
  select wm.user_id, p.full_name, u.email::text
  from public.workspace_members wm
  join auth.users u on u.id = wm.user_id
  left join public.profiles p on p.id = wm.user_id
  where wm.workspace_id = target_workspace
    and wm.deleted_at is null
  order by wm.created_at, wm.user_id;
end;
$$;

-- Exact, case-insensitive match only (no patterns, no partial matches); returns the id alone.
-- Existing and removed members are returned like any account: the app turns them into
-- "already a team member" or restores the removed membership.
create function public.workspace_member_find_user(target_workspace uuid, member_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized text := lower(btrim(member_email));
  matches uuid[];
begin
  if not exists (
    select 1
    from public.workspace_members caller
    join public.workspaces w on w.id = caller.workspace_id
    where caller.workspace_id = target_workspace
      and caller.user_id = (select auth.uid())
      and caller.role::text in ('owner', 'admin')
      and caller.deleted_at is null
      and w.deleted_at is null
  ) then
    raise exception 'You do not have permission to add team members' using errcode = '42501';
  end if;

  if normalized is null or normalized = '' then
    return null;
  end if;

  select array_agg(u.id)
  into matches
  from auth.users u
  where lower(u.email) = normalized
    and u.deleted_at is null;

  -- More than one account per email is only possible with SSO identities; refuse to guess.
  if pg_catalog.cardinality(matches) = 1 then
    return matches[1];
  end if;
  return null;
end;
$$;

revoke all on function public.workspace_member_profiles(target_workspace uuid) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_profiles(target_workspace uuid) to authenticated, service_role;

revoke all on function public.workspace_member_find_user(target_workspace uuid, member_email text) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_find_user(target_workspace uuid, member_email text) to authenticated, service_role;
