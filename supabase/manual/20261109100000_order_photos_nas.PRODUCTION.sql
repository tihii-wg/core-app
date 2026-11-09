-- =============================================================================
-- Order photo storage: third option — the owner's NAS (WebDAV or S3-compatible)
-- Script: 20261109100000_order_photos_nas.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisite: 20261109090000_order_photos_google_drive (apply it first).
-- =============================================================================
-- Storage modes become: 'app' (default) | 'google_drive' | 'nas'.
-- NAS = a server the owner controls, reachable from the internet over HTTPS:
--   * 'webdav' — Synology / QNAP / TrueNAS / Nextcloud WebDAV (base URL + user + password);
--   * 's3'     — S3-compatible storage on the NAS (MinIO, Synology/QNAP object storage):
--                endpoint + bucket + region + access key + secret key.
-- 1) workspace_nas_storage — connection settings (no secrets), members can read;
--    writes service_role only (Edge Function tests the connection before saving).
-- 2) workspace_nas_storage_secrets — Vault secret id (password / secret key), service_role only.
-- 3) order_attachments: storage_provider gains 'nas', nas_path column; NAS rows are
--    server-only like Drive rows.
-- 4) crm_set_attachment_storage / guard accept 'nas' only when the NAS connection is 'connected'.
-- 5) crm_workspace_attachment_usage also returns nas_bytes / nas_files.
-- No data changes. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.workspace_google_drive') is null then
    v_problems := v_problems || 'apply 20261109090000_order_photos_google_drive first; ';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'order_attachments' and column_name = 'storage_provider') then
    v_problems := v_problems || 'order_attachments.storage_provider missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'order_photos_nas preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- 1) Connection settings ---------------------------------------------------------
create table if not exists public.workspace_nas_storage (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  protocol text not null check (protocol in ('webdav', 's3')),
  base_url text not null check (base_url ~* '^https://'),
  root_path text not null default '/CoreApp',
  username text,
  bucket text,
  region text,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  last_error text,
  last_checked_at timestamptz,
  connected_by uuid,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint workspace_nas_storage_s3_fields check (protocol <> 's3' or (bucket is not null and length(btrim(bucket)) > 0)),
  constraint workspace_nas_storage_lengths check (
    char_length(base_url) <= 500 and char_length(root_path) <= 300
    and (username is null or char_length(username) <= 200)
    and (bucket is null or char_length(bucket) <= 100)
    and (region is null or char_length(region) <= 50)
  )
);

alter table public.workspace_nas_storage enable row level security;
drop policy if exists workspace_nas_storage_member_select on public.workspace_nas_storage;
create policy workspace_nas_storage_member_select on public.workspace_nas_storage
  for select to authenticated using (public.is_workspace_member(workspace_id));
revoke all on table public.workspace_nas_storage from public, anon, authenticated;
grant select on table public.workspace_nas_storage to authenticated;
grant all on table public.workspace_nas_storage to service_role;

-- 2) Secret (password / S3 secret key) -----------------------------------------------
create table if not exists public.workspace_nas_storage_secrets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  credential_secret_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_nas_storage_secrets enable row level security;
revoke all on table public.workspace_nas_storage_secrets from public, anon, authenticated;
grant all on table public.workspace_nas_storage_secrets to service_role;

create or replace function public.crm_nas_set_credential(p_workspace_id uuid, p_secret text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, vault as $fn$
declare
  v_existing uuid;
  v_id uuid;
begin
  if p_workspace_id is null or p_secret is null or length(p_secret) = 0 then
    raise exception 'nas:invalid_args' using errcode = '22023';
  end if;
  select credential_secret_id into v_existing
  from public.workspace_nas_storage_secrets where workspace_id = p_workspace_id for update;
  if v_existing is not null then
    perform vault.update_secret(v_existing, p_secret);
    v_id := v_existing;
    update public.workspace_nas_storage_secrets set updated_at = now() where workspace_id = p_workspace_id;
  else
    v_id := vault.create_secret(p_secret, 'workspace_nas_' || p_workspace_id::text, 'NAS credential for order photos');
    insert into public.workspace_nas_storage_secrets (workspace_id, credential_secret_id) values (p_workspace_id, v_id);
  end if;
  return v_id;
end;
$fn$;

create or replace function public.crm_nas_get_credential(p_workspace_id uuid)
returns text
language sql stable security definer set search_path = pg_catalog, public, vault as $fn$
  select d.decrypted_secret
  from public.workspace_nas_storage_secrets s
  join vault.decrypted_secrets d on d.id = s.credential_secret_id
  where s.workspace_id = p_workspace_id;
$fn$;

create or replace function public.crm_nas_clear_credential(p_workspace_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, vault as $fn$
declare
  v_id uuid;
begin
  select credential_secret_id into v_id from public.workspace_nas_storage_secrets where workspace_id = p_workspace_id for update;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  delete from public.workspace_nas_storage_secrets where workspace_id = p_workspace_id;
  update public.workspace_nas_storage set status = 'disconnected', updated_at = now() where workspace_id = p_workspace_id;
  update public.workspaces set attachment_storage = 'app' where id = p_workspace_id and attachment_storage = 'nas';
end;
$fn$;

revoke all on function public.crm_nas_set_credential(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_nas_get_credential(uuid) from public, anon, authenticated;
revoke all on function public.crm_nas_clear_credential(uuid) from public, anon, authenticated;
grant execute on function public.crm_nas_set_credential(uuid, text) to service_role;
grant execute on function public.crm_nas_get_credential(uuid) to service_role;
grant execute on function public.crm_nas_clear_credential(uuid) to service_role;

-- 3) Storage mode 'nas' ------------------------------------------------------------------
alter table public.workspaces drop constraint if exists workspaces_attachment_storage_check;
alter table public.workspaces
  add constraint workspaces_attachment_storage_check check (attachment_storage in ('app', 'google_drive', 'nas'));

create or replace function public.crm_attachment_storage_ready(p_workspace_id uuid, p_mode text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select case p_mode
    when 'app' then true
    when 'google_drive' then exists (
      select 1 from public.workspace_google_drive g
      join public.workspace_google_drive_secrets s on s.workspace_id = g.workspace_id
      where g.workspace_id = p_workspace_id and g.status = 'connected' and g.root_folder_id is not null)
    when 'nas' then exists (
      select 1 from public.workspace_nas_storage n
      join public.workspace_nas_storage_secrets s on s.workspace_id = n.workspace_id
      where n.workspace_id = p_workspace_id and n.status = 'connected')
    else false
  end;
$fn$;
revoke all on function public.crm_attachment_storage_ready(uuid, text) from public, anon;
grant execute on function public.crm_attachment_storage_ready(uuid, text) to authenticated, service_role;

create or replace function public.crm_set_attachment_storage(p_workspace_id uuid, p_mode text)
returns text
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if p_mode not in ('app', 'google_drive', 'nas') then
    raise exception 'attachment_storage:invalid_mode' using errcode = '22023';
  end if;
  if not coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
    raise exception 'attachment_storage:owner_only' using errcode = '42501';
  end if;
  if not public.crm_attachment_storage_ready(p_workspace_id, p_mode) then
    raise exception 'attachment_storage:%_not_connected', p_mode using errcode = 'P0001';
  end if;
  update public.workspaces set attachment_storage = p_mode where id = p_workspace_id;
  return p_mode;
end;
$fn$;
revoke all on function public.crm_set_attachment_storage(uuid, text) from public, anon;
grant execute on function public.crm_set_attachment_storage(uuid, text) to authenticated, service_role;

create or replace function public.workspaces_attachment_storage_guard()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if new.attachment_storage is distinct from old.attachment_storage
     and new.attachment_storage <> 'app'
     and not public.crm_attachment_storage_ready(new.id, new.attachment_storage) then
    raise exception 'attachment_storage:%_not_connected', new.attachment_storage using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;
revoke all on function public.workspaces_attachment_storage_guard() from public, anon, authenticated;

-- 4) Attachments on the NAS -----------------------------------------------------------------
alter table public.order_attachments add column if not exists nas_path text;

alter table public.order_attachments drop constraint if exists order_attachments_storage_provider_check;
alter table public.order_attachments
  add constraint order_attachments_storage_provider_check check (
       (storage_provider = 'app' and storage_path is not null)
    or (storage_provider = 'google_drive' and drive_file_id is not null)
    or (storage_provider = 'nas' and nas_path is not null)
  );

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
  if tg_op = 'INSERT' and (new.storage_provider <> 'app' or new.drive_file_id is not null or new.nas_path is not null) then
    raise exception 'order_attachments:remote_rows_server_only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
       new.storage_provider is distinct from old.storage_provider
    or new.drive_file_id is distinct from old.drive_file_id
    or new.drive_folder_id is distinct from old.drive_folder_id
    or new.nas_path is distinct from old.nas_path) then
    raise exception 'order_attachments:remote_rows_server_only' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function public.order_attachments_drive_rows_guard() from public, anon, authenticated;

-- 5) Usage incl. NAS ---------------------------------------------------------------------------
drop function if exists public.crm_workspace_attachment_usage(uuid);
create or replace function public.crm_workspace_attachment_usage(p_workspace_id uuid)
returns table (app_bytes bigint, app_files bigint, drive_bytes bigint, drive_files bigint, nas_bytes bigint, nas_files bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $fn$
declare
  v_filter text := '';
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'attachment_storage:forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'order_attachments' and column_name = 'deleted_at') then
    v_filter := ' and deleted_at is null';
  end if;
  return query execute
    'select coalesce(sum(file_size) filter (where storage_provider = ''app''), 0)::bigint,
            count(*) filter (where storage_provider = ''app'')::bigint,
            coalesce(sum(file_size) filter (where storage_provider = ''google_drive''), 0)::bigint,
            count(*) filter (where storage_provider = ''google_drive'')::bigint,
            coalesce(sum(file_size) filter (where storage_provider = ''nas''), 0)::bigint,
            count(*) filter (where storage_provider = ''nas'')::bigint
       from public.order_attachments where workspace_id = $1' || v_filter
    using p_workspace_id;
end;
$fn$;
revoke all on function public.crm_workspace_attachment_usage(uuid) from public, anon;
grant execute on function public.crm_workspace_attachment_usage(uuid) to authenticated, service_role;

do $postflight$
begin
  if to_regclass('public.workspace_nas_storage') is null or to_regclass('public.workspace_nas_storage_secrets') is null then
    raise exception 'order_photos_nas postflight: tables missing';
  end if;
  if has_table_privilege('authenticated', 'public.workspace_nas_storage_secrets', 'select') then
    raise exception 'order_photos_nas postflight: secrets readable by authenticated';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workspaces_attachment_storage_check'
                 and pg_get_constraintdef(oid) like '%nas%') then
    raise exception 'order_photos_nas postflight: storage mode nas missing';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
