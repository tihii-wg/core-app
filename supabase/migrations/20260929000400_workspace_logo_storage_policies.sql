-- Company logo Storage policies: workspace members read the logo, owners and admins write it.
--
-- Depends only on 20260929000000_production_baseline.sql (the private "workspace" bucket,
-- public.is_workspace_member(uuid) and public.workspace_member_is_admin(uuid): SECURITY DEFINER,
-- search_path '', an EXISTS over an active membership in an active workspace, never NULL).
--
-- The only object the app uses is {workspace_id}/logo.webp (workspaces.avatar_path). The shape is
-- matched on the whole name because storage.foldername(name) excludes the file name. The workspace
-- id is taken from the name only when it has that shape; the CASE guarantees the uuid cast never
-- runs on any other name, so other names are denied instead of raising 22P02.
--
-- Replaces the member-wide logo policies from the baseline and the owner/admin logo policies
-- created manually outside migrations (those compare (storage.foldername(name))[2] with
-- 'logo.webp', which is always NULL for {workspace_id}/logo.webp, so they match no object).
-- The drops use IF EXISTS because the two sets differ between projects; the guards below make
-- the migration fail if any other policy still refers to the bucket, any restrictive policy
-- exists on storage.objects, or the final set is not exactly the four policies created here.
-- No bucket, object, function, grant or table change.

drop policy if exists "Workspace members can view workspace logos" on storage.objects;
drop policy if exists "Workspace members can upload workspace logos" on storage.objects;
drop policy if exists "Workspace members can update workspace logos" on storage.objects;
drop policy if exists "Workspace members can delete workspace logos" on storage.objects;
drop policy if exists "Workspace admins can upload workspace logos" on storage.objects;
drop policy if exists "Workspace admins can update workspace logos" on storage.objects;
drop policy if exists "Workspace admins can delete workspace logos" on storage.objects;

do $$
declare
  leftover text;
begin
  select string_agg(policyname, ', ' order by policyname) into leftover
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and (coalesce(qual, '') ~ '''workspace''' or coalesce(with_check, '') ~ '''workspace''');
  if leftover is not null then
    raise exception 'Unexpected storage.objects policies refer to the workspace bucket: %', leftover;
  end if;

  select string_agg(policyname, ', ' order by policyname) into leftover
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE';
  if leftover is not null then
    raise exception 'Unexpected restrictive storage.objects policies: %', leftover;
  end if;
end;
$$;

create policy "Workspace members can view workspace logos"
  on storage.objects
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'workspace'
    and public.is_workspace_member(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

create policy "Workspace admins can upload workspace logos"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'workspace'
    and public.workspace_member_is_admin(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

create policy "Workspace admins can update workspace logos"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'workspace'
    and public.workspace_member_is_admin(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
        then split_part(name, '/', 1)::uuid
      end
    )
  )
  with check (
    bucket_id = 'workspace'
    and public.workspace_member_is_admin(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

create policy "Workspace admins can delete workspace logos"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'workspace'
    and public.workspace_member_is_admin(
      case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo\.webp$'
        then split_part(name, '/', 1)::uuid
      end
    )
  );

do $$
declare
  found text;
begin
  select string_agg(policyname || ':' || cmd || ':' || permissive, ', ' order by policyname) into found
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and (coalesce(qual, '') ~ '''workspace''' or coalesce(with_check, '') ~ '''workspace''');
  if found is distinct from
    'Workspace admins can delete workspace logos:DELETE:PERMISSIVE, Workspace admins can update workspace logos:UPDATE:PERMISSIVE, Workspace admins can upload workspace logos:INSERT:PERMISSIVE, Workspace members can view workspace logos:SELECT:PERMISSIVE'
  then
    raise exception 'Unexpected workspace logo policies after migration: %', found;
  end if;
end;
$$;
