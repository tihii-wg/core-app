-- =============================================================================
-- Remote order folders (Google Drive / NAS) survive order deletion for cleanup
-- Script: 20261109110000_remote_order_folders_survive_delete.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: 20261109090000_order_photos_google_drive, 20261109100000_order_photos_nas.
-- =============================================================================
-- After an order is deleted, the app asks the remote function to move the order's
-- Drive / NAS folder to the trash. That needs the folder reference, but
-- order_google_drive_folders was ON DELETE CASCADE from orders, so the row vanished
-- together with the order.
--   1) order_google_drive_folders: drop the FK to orders (workspace FK stays). The
--      Edge Function only trashes folders of orders that no longer exist and then
--      deletes the row.
--   2) order_nas_folders: same idea for NAS (WebDAV folder path / S3 prefix).
-- No data changes. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.order_google_drive_folders') is null or to_regclass('public.workspace_nas_storage') is null then
    raise exception 'remote_order_folders preflight: apply 20261109090000 and 20261109100000 first';
  end if;
end;
$preflight$;

do $fk$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.order_google_drive_folders'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.orders'::regclass
  loop
    execute format('alter table public.order_google_drive_folders drop constraint %I', r.conname);
  end loop;
end;
$fk$;

create table if not exists public.order_nas_folders (
  order_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  protocol text not null check (protocol in ('webdav', 's3')),
  folder_path text not null check (char_length(folder_path) between 1 and 600),
  created_at timestamptz not null default now()
);

alter table public.order_nas_folders enable row level security;
drop policy if exists order_nas_folders_member_select on public.order_nas_folders;
create policy order_nas_folders_member_select on public.order_nas_folders
  for select to authenticated using (public.is_workspace_member(workspace_id));
revoke all on table public.order_nas_folders from public, anon, authenticated;
grant select on table public.order_nas_folders to authenticated;
grant all on table public.order_nas_folders to service_role;

do $postflight$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.order_google_drive_folders'::regclass
             and contype = 'f' and confrelid = 'public.orders'::regclass) then
    raise exception 'remote_order_folders postflight: FK to orders still present';
  end if;
  if to_regclass('public.order_nas_folders') is null then
    raise exception 'remote_order_folders postflight: order_nas_folders missing';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
