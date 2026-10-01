-- Stop an authenticated user from joining a workspace they do not own.
-- Signup still works: the workspace row is created with owner_id = auth.uid()
-- before the owner inserts their membership.

create or replace function public.is_workspace_owner(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces
    where id = target_workspace
      and owner_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and deleted_at is null
  );
$$;

revoke all on function public.is_workspace_owner(uuid) from public;
revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;

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
    execute format('drop policy if exists %I on public.workspace_members', pol.policyname);
  end loop;
end $$;

create policy "Members can read their workspace memberships"
  on public.workspace_members
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workspace_member(workspace_id)
  );

create policy "Owners can add workspace members"
  on public.workspace_members
  for insert
  to authenticated
  with check (public.is_workspace_owner(workspace_id));

create policy "Owners can update workspace members"
  on public.workspace_members
  for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create policy "Owners can delete workspace members"
  on public.workspace_members
  for delete
  to authenticated
  using (public.is_workspace_owner(workspace_id));
