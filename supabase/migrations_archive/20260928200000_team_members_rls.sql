-- Settings → Team Members: role-based access to public.workspace_members.
--
--   owner   manages admin / manager / member
--   admin   manages manager / member
--   manager, member: read only
--
-- No app user can create, promote to, demote, change, soft-delete, or delete an owner
-- membership. The only exception is the creator's first membership of a brand-new
-- workspace (signup / create workspace), which must be the owner row.
-- Workspace deletion goes through public.soft_delete_workspace(uuid).
-- Removing a team member is a soft delete (deleted_at); app users cannot DELETE rows.
--
-- public.is_workspace_member(uuid) and policies on other tables are not touched.
-- Supersedes 20260927144500_workspace_member_rls.sql; do not apply that file.
--
-- Run as one script (Supabase SQL editor or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies on workspace_members can read
-- workspace_members without recursing into their own RLS. Empty search_path;
-- every object is schema-qualified (pg_catalog built-ins are always resolved).
-- ---------------------------------------------------------------------------

-- Caller's role in an active workspace where the caller is an active member, or null.
create or replace function public.workspace_member_role(target_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.role::text
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.workspace_id = target_workspace
    and wm.user_id = auth.uid()
    and wm.deleted_at is null
    and w.deleted_at is null
  order by case wm.role::text when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end
  limit 1;
$$;

create or replace function public.workspace_member_is_owner(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.workspace_member_role(target_workspace) = 'owner', false);
$$;

create or replace function public.workspace_member_is_admin(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.workspace_member_role(target_workspace) = 'admin', false);
$$;

-- True when the caller may add, change, restore, or remove a membership whose role is
-- target_role. Never true for 'owner'.
create or replace function public.workspace_member_can_manage(target_workspace uuid, target_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.workspace_member_role(target_workspace)
      when 'owner' then target_role in ('admin', 'manager', 'member')
      when 'admin' then target_role in ('manager', 'member')
      else false
    end,
    false
  );
$$;

-- Signup and "create workspace" insert the workspace row first (owner_id = auth.uid()),
-- then the creator's membership. True only between those two steps.
create or replace function public.workspace_member_can_bootstrap(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.workspaces w
      where w.id = target_workspace
        and w.owner_id = auth.uid()
        and w.deleted_at is null
    )
    and not exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = target_workspace
    );
$$;

-- Name and email of the active members of an active workspace the caller belongs to.
create or replace function public.workspace_member_profiles(target_workspace uuid)
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id::uuid, p.full_name::text, p.email::text
  from public.workspace_members wm
  join public.profiles p on p.id = wm.user_id
  where wm.workspace_id = target_workspace
    and wm.deleted_at is null
    and public.workspace_member_role(target_workspace) is not null;
$$;

-- Resolves an existing account's email to a user id, only for owners and admins.
-- Does not create, invite, or authenticate accounts.
create or replace function public.workspace_member_find_user(target_workspace uuid, member_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_user uuid;
begin
  if coalesce(public.workspace_member_role(target_workspace), '') not in ('owner', 'admin') then
    raise exception 'You do not have permission to add team members' using errcode = '42501';
  end if;

  select u.id
  into found_user
  from auth.users u
  where lower(u.email) = lower(trim(member_email))
  limit 1;

  return found_user;
end;
$$;

-- Owner-only workspace deletion: soft-deletes the workspace and every membership,
-- including the owner's, in one transaction. Runs as the function owner, so the
-- guard trigger below lets it through and RLS does not apply.
create or replace function public.soft_delete_workspace(target_workspace uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.workspace_member_is_owner(target_workspace) then
    raise exception 'Only the workspace owner can delete this workspace' using errcode = '42501';
  end if;

  update public.workspaces
  set deleted_at = now()
  where id = target_workspace
    and deleted_at is null;

  update public.workspace_members
  set deleted_at = now()
  where workspace_id = target_workspace
    and deleted_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guard trigger: database-level checks for direct requests by app users
-- (current_user authenticated/anon). SECURITY INVOKER on purpose, so inside
-- soft_delete_workspace current_user is the function owner and the guard is skipped.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.role::text = 'owner'
       and not (new.user_id = auth.uid() and public.workspace_member_can_bootstrap(new.workspace_id)) then
      raise exception 'Owner memberships cannot be created through team management' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id
       or new.user_id is distinct from old.user_id then
      raise exception 'workspace_id and user_id cannot be changed' using errcode = '42501';
    end if;
    if old.role::text = 'owner' or new.role::text = 'owner' then
      raise exception 'The workspace owner cannot be changed through team management' using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE
  if old.role::text = 'owner' then
    raise exception 'The workspace owner cannot be removed through team management' using errcode = '42501';
  end if;
  return old;
end;
$$;

-- Report other triggers on the table; only this migration's own trigger is replaced.
do $$
declare
  trg record;
begin
  for trg in
    select t.tgname
    from pg_trigger t
    where t.tgrelid = 'public.workspace_members'::regclass
      and not t.tgisinternal
      and t.tgname <> 'workspace_members_guard'
  loop
    raise notice 'Keeping existing trigger on public.workspace_members: %', trg.tgname;
  end loop;
end $$;

drop trigger if exists workspace_members_guard on public.workspace_members;
create trigger workspace_members_guard
  before insert or update or delete on public.workspace_members
  for each row
  execute function public.workspace_members_guard();

-- ---------------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE on new public functions to anon and
-- authenticated by default, so revoke explicitly and re-grant only what is needed.
-- Policy helpers must be executable by authenticated because policies run as the caller.
-- ---------------------------------------------------------------------------

revoke all on function public.workspace_member_role(uuid) from public, anon, authenticated;
revoke all on function public.workspace_member_is_owner(uuid) from public, anon, authenticated;
revoke all on function public.workspace_member_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.workspace_member_can_manage(uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_member_can_bootstrap(uuid) from public, anon, authenticated;
revoke all on function public.workspace_member_profiles(uuid) from public, anon, authenticated;
revoke all on function public.workspace_member_find_user(uuid, text) from public, anon, authenticated;
revoke all on function public.soft_delete_workspace(uuid) from public, anon, authenticated;
revoke all on function public.workspace_members_guard() from public, anon, authenticated;

grant execute on function public.workspace_member_role(uuid) to authenticated;
grant execute on function public.workspace_member_is_owner(uuid) to authenticated;
grant execute on function public.workspace_member_is_admin(uuid) to authenticated;
grant execute on function public.workspace_member_can_manage(uuid, text) to authenticated;
grant execute on function public.workspace_member_can_bootstrap(uuid) to authenticated;
grant execute on function public.workspace_member_profiles(uuid) to authenticated;
grant execute on function public.workspace_member_find_user(uuid, text) to authenticated;
grant execute on function public.soft_delete_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies. Permissive policies are OR-ed together, so every existing policy on
-- workspace_members is replaced (listed as notices). Other tables are not touched.
-- ---------------------------------------------------------------------------

alter table public.workspace_members enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_members'
  loop
    raise notice 'Replacing policy on public.workspace_members: %', pol.policyname;
    execute format('drop policy if exists %I on public.workspace_members', pol.policyname);
  end loop;
end $$;

-- Active rows: your own, and every member of an active workspace you actively belong to.
-- Removed rows: only to owners/admins allowed to manage that role (needed to restore them).
create policy "Team members can view their workspace members"
  on public.workspace_members
  for select
  to authenticated
  using (
    (
      deleted_at is null
      and (
        user_id = auth.uid()
        or public.workspace_member_role(workspace_id) is not null
      )
    )
    or (
      deleted_at is not null
      and user_id <> auth.uid()
      and public.workspace_member_can_manage(workspace_id, role::text)
    )
  );

create policy "Owners and admins can add team members"
  on public.workspace_members
  for insert
  to authenticated
  with check (
    deleted_at is null
    and (
      (
        user_id <> auth.uid()
        and public.workspace_member_can_manage(workspace_id, role::text)
      )
      or (
        user_id = auth.uid()
        and role::text = 'owner'
        and public.workspace_member_can_bootstrap(workspace_id)
      )
    )
  );

-- USING validates the existing row (its current role), WITH CHECK the resulting row
-- (its new role). Nobody can update their own membership.
create policy "Owners and admins can update team members"
  on public.workspace_members
  for update
  to authenticated
  using (
    user_id <> auth.uid()
    and public.workspace_member_can_manage(workspace_id, role::text)
  )
  with check (
    user_id <> auth.uid()
    and public.workspace_member_can_manage(workspace_id, role::text)
  );

-- No DELETE policy: removal is a soft delete through UPDATE.

-- ---------------------------------------------------------------------------
-- Table privileges: only what the app uses.
--   insert: signup, create workspace, add team member -> (workspace_id, user_id, role)
--   update: change role, remove/restore member        -> (role, deleted_at)
--   select: all reads (RLS filters rows)
-- ---------------------------------------------------------------------------

revoke all on public.workspace_members from anon;
revoke insert, update, delete, truncate, references, trigger on public.workspace_members from authenticated;
grant select on public.workspace_members to authenticated;
grant insert (workspace_id, user_id, role) on public.workspace_members to authenticated;
grant update (role, deleted_at) on public.workspace_members to authenticated;

notify pgrst, 'reload schema';
