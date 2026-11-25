-- =====================================================================================
-- Order comments & files: private / public visibility (Settings → General → Orders)
-- Script: 20261125180000_order_comments_files_visibility.PRODUCTION.sql
-- MAIN only. Manual apply after review.
-- Prerequisites: order_comments (is_public, author_user_id), order_attachments (uploaded_by),
--   workspaces.default_comments_visibility / default_files_visibility, crm_is_workspace_owner_id(uuid).
-- =====================================================================================
-- Rule (same as line comments): PUBLIC = every member of the workspace sees it;
-- PRIVATE = only its author / uploader and the workspace owner.
-- * The workspace setting is the DEFAULT for new items; each item can be switched afterwards by its
--   author or the owner (crm_set_order_item_visibility).
-- * Existing comments and files stay visible to everyone (backfilled public) — nothing disappears.
-- * Enforced by RESTRICTIVE select policies (combined with the existing member policies).
-- * order_attachments.is_public is filled on insert from the workspace default when the writer does
--   not send it (remote Drive/NAS uploads included).
-- =====================================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.order_comments') is null then v_problems := v_problems || 'order_comments missing; '; end if;
  if to_regclass('public.order_attachments') is null then v_problems := v_problems || 'order_attachments missing; '; end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then v_problems := v_problems || 'crm_is_workspace_owner_id missing; '; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workspaces' and column_name = 'default_files_visibility') then
    v_problems := v_problems || 'workspaces.default_files_visibility missing; ';
  end if;
  if v_problems <> '' then raise exception 'comments_files_visibility preflight failed: %', v_problems; end if;
end;
$preflight$;

-- 1) Comments: everything written so far stays visible to the whole team.
update public.order_comments set is_public = true where is_public is distinct from true;

-- 2) Files: visibility column, existing files public, new ones from the workspace default.
alter table public.order_attachments add column if not exists is_public boolean;
update public.order_attachments set is_public = true where is_public is null;

create or replace function public.order_attachments_default_visibility()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if new.is_public is null then
    select lower(btrim(coalesce(w.default_files_visibility, 'private'))) = 'public'
      into new.is_public
    from public.workspaces w
    where w.id = new.workspace_id;
    new.is_public := coalesce(new.is_public, false);
  end if;
  return new;
end;
$fn$;

drop trigger if exists order_attachments_default_visibility_bi on public.order_attachments;
create trigger order_attachments_default_visibility_bi
  before insert on public.order_attachments
  for each row execute function public.order_attachments_default_visibility();

alter table public.order_attachments alter column is_public set not null;

revoke all on function public.order_attachments_default_visibility() from public, anon, authenticated;

-- 3) Who sees private items: the author / uploader and the workspace owner.
drop policy if exists order_comments_visibility on public.order_comments;
create policy order_comments_visibility on public.order_comments
  as restrictive
  for select
  to authenticated
  using (
    is_public
    or author_user_id = (select auth.uid())
    or coalesce(public.crm_is_workspace_owner_id(workspace_id), false)
  );

drop policy if exists order_attachments_visibility on public.order_attachments;
create policy order_attachments_visibility on public.order_attachments
  as restrictive
  for select
  to authenticated
  using (
    is_public
    or uploaded_by = (select auth.uid())
    or coalesce(public.crm_is_workspace_owner_id(workspace_id), false)
  );

-- 4) Switch one comment / file between private and public (author / uploader or owner).
create or replace function public.crm_set_order_item_visibility(p_kind text, p_id uuid, p_public boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_author uuid;
begin
  if v_uid is null then
    raise exception 'item_visibility:not_authenticated' using errcode = '42501';
  end if;
  if p_kind = 'comment' then
    select c.workspace_id, c.author_user_id into v_ws, v_author
    from public.order_comments c where c.id = p_id and c.deleted_at is null;
  elsif p_kind = 'file' then
    select a.workspace_id, a.uploaded_by into v_ws, v_author
    from public.order_attachments a where a.id = p_id;
  else
    raise exception 'item_visibility:invalid_kind' using errcode = '22023';
  end if;
  if v_ws is null then
    raise exception 'item_visibility:not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_workspace_member(v_ws), false)
     or not (v_author = v_uid or coalesce(public.crm_is_workspace_owner_id(v_ws), false)) then
    raise exception 'item_visibility:forbidden' using errcode = '42501';
  end if;
  if p_kind = 'comment' then
    update public.order_comments set is_public = coalesce(p_public, false), updated_at = now() where id = p_id;
  else
    update public.order_attachments set is_public = coalesce(p_public, false) where id = p_id;
  end if;
  return coalesce(p_public, false);
end;
$fn$;

revoke all on function public.crm_set_order_item_visibility(text, uuid, boolean) from public, anon;
grant execute on function public.crm_set_order_item_visibility(text, uuid, boolean) to authenticated, service_role;

comment on function public.crm_set_order_item_visibility(text, uuid, boolean) is
  'managed-object: core-app/crm_set_order_item_visibility@v1 — author/uploader or owner switches an order comment / file between private and public.';

notify pgrst, 'reload schema';

do $postflight$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_comments' and policyname = 'order_comments_visibility') then
    raise exception 'comments_files_visibility postflight: order_comments policy missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_attachments' and policyname = 'order_attachments_visibility') then
    raise exception 'comments_files_visibility postflight: order_attachments policy missing';
  end if;
  if to_regprocedure('public.crm_set_order_item_visibility(text,uuid,boolean)') is null then
    raise exception 'comments_files_visibility postflight: rpc missing';
  end if;
end;
$postflight$;

commit;
