-- =============================================================================
-- Order photo storage: in the app (Supabase Storage, limited) or the owner's Google Drive
-- Script: 20261109090000_order_photos_google_drive.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: order_attachments (with RLS), crm_is_workspace_owner_id, supabase_vault.
-- =============================================================================
-- 1) workspaces.attachment_storage: 'app' (default) | 'google_drive'.
--    Changed only through crm_set_attachment_storage (workspace owner_id only);
--    'google_drive' requires an active Google Drive connection.
-- 2) workspace_google_drive — one Google Drive connection per workspace (owner's account):
--    google_account_email, root_folder_id, status, connected_by / connected_at, last_error.
--    Members may read it (no secrets). Writes: service_role (Edge Functions) only.
--    The OAuth refresh token is stored in Vault; its id lives in a separate
--    service_role-only table workspace_google_drive_secrets (no column-level grants,
--    so `select *` from the app never hits "permission denied").
-- 3) order_attachments: storage_provider 'app' | 'google_drive', drive_file_id,
--    drive_folder_id. Drive rows are created/deleted only by Edge Functions
--    (service_role); the app reads them like any attachment of the order, so photos
--    stay linked to their order and load when the order is opened.
-- 4) crm_workspace_attachment_usage(ws) — bytes/count stored in the app (for the
--    «объём ограничен» note) and on Google Drive.
-- 5) order_google_drive_folders — Drive folder id per order (one folder per order).
-- No data changes for existing attachments (they stay 'app'). Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.order_attachments') is null then v_problems := v_problems || 'order_attachments missing; '; end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then v_problems := v_problems || 'crm_is_workspace_owner_id missing; '; end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then v_problems := v_problems || 'is_workspace_member missing; '; end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then v_problems := v_problems || 'supabase_vault extension missing; '; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'order_attachments' and column_name = 'storage_path') then
    v_problems := v_problems || 'order_attachments.storage_path missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'order_photos_google_drive preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- 1) Workspace setting -----------------------------------------------------------
alter table public.workspaces add column if not exists attachment_storage text not null default 'app';

do $ws$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_attachment_storage_check'
                 and conrelid = 'public.workspaces'::regclass) then
    alter table public.workspaces
      add constraint workspaces_attachment_storage_check check (attachment_storage in ('app', 'google_drive'));
  end if;
end;
$ws$;

-- 2) Google Drive connection --------------------------------------------------------
create table if not exists public.workspace_google_drive (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  google_account_email text,
  root_folder_id text,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  connected_by uuid,
  connected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.workspace_google_drive enable row level security;
drop policy if exists workspace_google_drive_member_select on public.workspace_google_drive;
create policy workspace_google_drive_member_select on public.workspace_google_drive
  for select to authenticated using (public.is_workspace_member(workspace_id));
revoke all on table public.workspace_google_drive from public, anon, authenticated;
grant select on table public.workspace_google_drive to authenticated;
grant all on table public.workspace_google_drive to service_role;

create table if not exists public.workspace_google_drive_secrets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  credential_secret_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_google_drive_secrets enable row level security;
revoke all on table public.workspace_google_drive_secrets from public, anon, authenticated;
grant all on table public.workspace_google_drive_secrets to service_role;

-- Vault helpers (service_role only)
create or replace function public.crm_gdrive_set_credential(p_workspace_id uuid, p_secret text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, vault as $fn$
declare
  v_existing uuid;
  v_id uuid;
begin
  if p_workspace_id is null or p_secret is null or length(p_secret) = 0 then
    raise exception 'gdrive:invalid_args' using errcode = '22023';
  end if;
  select credential_secret_id into v_existing
  from public.workspace_google_drive_secrets where workspace_id = p_workspace_id for update;
  if v_existing is not null then
    perform vault.update_secret(v_existing, p_secret);
    v_id := v_existing;
    update public.workspace_google_drive_secrets set updated_at = now() where workspace_id = p_workspace_id;
  else
    v_id := vault.create_secret(p_secret, 'workspace_gdrive_' || p_workspace_id::text, 'Google Drive credential for order photos');
    insert into public.workspace_google_drive_secrets (workspace_id, credential_secret_id) values (p_workspace_id, v_id);
  end if;
  return v_id;
end;
$fn$;

create or replace function public.crm_gdrive_get_credential(p_workspace_id uuid)
returns text
language sql stable security definer set search_path = pg_catalog, public, vault as $fn$
  select d.decrypted_secret
  from public.workspace_google_drive_secrets s
  join vault.decrypted_secrets d on d.id = s.credential_secret_id
  where s.workspace_id = p_workspace_id;
$fn$;

create or replace function public.crm_gdrive_clear_credential(p_workspace_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, vault as $fn$
declare
  v_id uuid;
begin
  select credential_secret_id into v_id from public.workspace_google_drive_secrets where workspace_id = p_workspace_id for update;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  delete from public.workspace_google_drive_secrets where workspace_id = p_workspace_id;
  update public.workspace_google_drive
     set status = 'disconnected', google_account_email = null, updated_at = now()
   where workspace_id = p_workspace_id;
  -- Fall back to app storage for new photos.
  update public.workspaces set attachment_storage = 'app' where id = p_workspace_id and attachment_storage = 'google_drive';
end;
$fn$;

revoke all on function public.crm_gdrive_set_credential(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_gdrive_get_credential(uuid) from public, anon, authenticated;
revoke all on function public.crm_gdrive_clear_credential(uuid) from public, anon, authenticated;
grant execute on function public.crm_gdrive_set_credential(uuid, text) to service_role;
grant execute on function public.crm_gdrive_get_credential(uuid) to service_role;
grant execute on function public.crm_gdrive_clear_credential(uuid) to service_role;

-- Owner switches storage mode
create or replace function public.crm_set_attachment_storage(p_workspace_id uuid, p_mode text)
returns text
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if p_mode not in ('app', 'google_drive') then
    raise exception 'attachment_storage:invalid_mode' using errcode = '22023';
  end if;
  if not coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
    raise exception 'attachment_storage:owner_only' using errcode = '42501';
  end if;
  if p_mode = 'google_drive' and not exists (
    select 1 from public.workspace_google_drive g
    join public.workspace_google_drive_secrets s on s.workspace_id = g.workspace_id
    where g.workspace_id = p_workspace_id and g.status = 'connected' and g.root_folder_id is not null
  ) then
    raise exception 'attachment_storage:google_drive_not_connected' using errcode = 'P0001';
  end if;
  update public.workspaces set attachment_storage = p_mode where id = p_workspace_id;
  return p_mode;
end;
$fn$;

revoke all on function public.crm_set_attachment_storage(uuid, text) from public, anon;
grant execute on function public.crm_set_attachment_storage(uuid, text) to authenticated, service_role;

-- Direct updates of workspaces.attachment_storage go through the same rule.
create or replace function public.workspaces_attachment_storage_guard()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if new.attachment_storage is distinct from old.attachment_storage
     and new.attachment_storage = 'google_drive'
     and not exists (
       select 1 from public.workspace_google_drive g
       join public.workspace_google_drive_secrets s on s.workspace_id = g.workspace_id
       where g.workspace_id = new.id and g.status = 'connected' and g.root_folder_id is not null
     ) then
    raise exception 'attachment_storage:google_drive_not_connected' using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;
revoke all on function public.workspaces_attachment_storage_guard() from public, anon, authenticated;

drop trigger if exists workspaces_attachment_storage_guard_bu on public.workspaces;
create trigger workspaces_attachment_storage_guard_bu
  before update of attachment_storage on public.workspaces
  for each row execute function public.workspaces_attachment_storage_guard();

-- 3) Attachments on Google Drive ------------------------------------------------------
alter table public.order_attachments add column if not exists storage_provider text not null default 'app';
alter table public.order_attachments add column if not exists drive_file_id text;
alter table public.order_attachments add column if not exists drive_folder_id text;
alter table public.order_attachments alter column storage_path drop not null;

do $att$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_attachments_storage_provider_check'
                 and conrelid = 'public.order_attachments'::regclass) then
    alter table public.order_attachments
      add constraint order_attachments_storage_provider_check check (
           (storage_provider = 'app' and storage_path is not null)
        or (storage_provider = 'google_drive' and drive_file_id is not null)
      );
  end if;
end;
$att$;

create index if not exists order_attachments_drive_file_idx
  on public.order_attachments (drive_file_id) where drive_file_id is not null;

-- Only Edge Functions (service_role) may create / change Drive-backed rows.
create or replace function public.order_attachments_drive_rows_guard()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true),
                          (current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
begin
  if v_role = 'service_role' or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.storage_provider = 'google_drive' or new.drive_file_id is not null) then
    raise exception 'order_attachments:drive_rows_server_only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
       new.storage_provider is distinct from old.storage_provider
    or new.drive_file_id is distinct from old.drive_file_id
    or new.drive_folder_id is distinct from old.drive_folder_id) then
    raise exception 'order_attachments:drive_rows_server_only' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function public.order_attachments_drive_rows_guard() from public, anon, authenticated;

drop trigger if exists order_attachments_drive_rows_guard_biu on public.order_attachments;
create trigger order_attachments_drive_rows_guard_biu
  before insert or update on public.order_attachments
  for each row execute function public.order_attachments_drive_rows_guard();

-- 5) Drive folder per order
create table if not exists public.order_google_drive_folders (
  order_id uuid primary key references public.orders(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  drive_folder_id text not null,
  created_at timestamptz not null default now()
);
alter table public.order_google_drive_folders enable row level security;
drop policy if exists order_google_drive_folders_member_select on public.order_google_drive_folders;
create policy order_google_drive_folders_member_select on public.order_google_drive_folders
  for select to authenticated using (public.is_workspace_member(workspace_id));
revoke all on table public.order_google_drive_folders from public, anon, authenticated;
grant select on table public.order_google_drive_folders to authenticated;
grant all on table public.order_google_drive_folders to service_role;

-- 4) Usage ------------------------------------------------------------------------------
create or replace function public.crm_workspace_attachment_usage(p_workspace_id uuid)
returns table (app_bytes bigint, app_files bigint, drive_bytes bigint, drive_files bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $fn$
declare
  v_has_deleted boolean;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'attachment_storage:forbidden' using errcode = '42501';
  end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'order_attachments' and column_name = 'deleted_at') into v_has_deleted;
  if v_has_deleted then
    return query execute
      'select coalesce(sum(file_size) filter (where storage_provider = ''app''), 0)::bigint,
              count(*) filter (where storage_provider = ''app'')::bigint,
              coalesce(sum(file_size) filter (where storage_provider = ''google_drive''), 0)::bigint,
              count(*) filter (where storage_provider = ''google_drive'')::bigint
         from public.order_attachments where workspace_id = $1 and deleted_at is null'
      using p_workspace_id;
  else
    return query execute
      'select coalesce(sum(file_size) filter (where storage_provider = ''app''), 0)::bigint,
              count(*) filter (where storage_provider = ''app'')::bigint,
              coalesce(sum(file_size) filter (where storage_provider = ''google_drive''), 0)::bigint,
              count(*) filter (where storage_provider = ''google_drive'')::bigint
         from public.order_attachments where workspace_id = $1'
      using p_workspace_id;
  end if;
end;
$fn$;

revoke all on function public.crm_workspace_attachment_usage(uuid) from public, anon;
grant execute on function public.crm_workspace_attachment_usage(uuid) to authenticated, service_role;

do $postflight$
begin
  if to_regclass('public.workspace_google_drive') is null
     or to_regclass('public.workspace_google_drive_secrets') is null
     or to_regclass('public.order_google_drive_folders') is null then
    raise exception 'order_photos_google_drive postflight: tables missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'order_attachments' and column_name = 'drive_file_id') then
    raise exception 'order_photos_google_drive postflight: order_attachments.drive_file_id missing';
  end if;
  if has_table_privilege('authenticated', 'public.workspace_google_drive_secrets', 'select') then
    raise exception 'order_photos_google_drive postflight: secrets table readable by authenticated';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
