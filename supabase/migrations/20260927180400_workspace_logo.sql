-- Company logos are files in the private "workspace" bucket.
-- workspaces.avatar_path stores the path only, for example workspace/{workspace_id}/logo.webp.

alter table public.workspaces
  add column if not exists avatar_path text;

alter table public.workspaces
  drop constraint if exists workspaces_avatar_path_check;

alter table public.workspaces
  add constraint workspaces_avatar_path_check
  check (
    avatar_path is null
    or avatar_path = 'workspace/' || id::text || '/logo.webp'
  );

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

revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;

create or replace function public.workspace_logo_id(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when object_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

revoke all on function public.workspace_logo_id(text) from public;
grant execute on function public.workspace_logo_id(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace', 'workspace', false, 5242880, array['image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can read workspace logos" on storage.objects;
drop policy if exists "Members can upload workspace logos" on storage.objects;
drop policy if exists "Members can update workspace logos" on storage.objects;
drop policy if exists "Members can delete workspace logos" on storage.objects;

create policy "Members can read workspace logos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'workspace'
    and public.is_workspace_member(public.workspace_logo_id(name))
  );

create policy "Members can upload workspace logos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'workspace'
    and public.is_workspace_member(public.workspace_logo_id(name))
  );

create policy "Members can update workspace logos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'workspace'
    and public.is_workspace_member(public.workspace_logo_id(name))
  )
  with check (
    bucket_id = 'workspace'
    and public.is_workspace_member(public.workspace_logo_id(name))
  );

create policy "Members can delete workspace logos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'workspace'
    and public.is_workspace_member(public.workspace_logo_id(name))
  );

drop policy if exists "Members can update workspaces they belong to" on public.workspaces;

create policy "Members can update workspaces they belong to"
  on public.workspaces
  for update
  to authenticated
  using (public.is_workspace_member(id) and deleted_at is null)
  with check (public.is_workspace_member(id));
