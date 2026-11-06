-- =============================================================================
-- Remove a line's warranty when the owner deletes that line from a
-- cancelled / reopened / owner-managed order
-- Script: 20261106100000_remove_warranty_with_deleted_line.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Self-contained: creates/refreshes crm_owner_may_unlink_order_warranty
-- (same definition as 20261106090000), so it can run with or without it.
-- =============================================================================
-- Problem:
--   After close -> cancel -> reopen, deleting a warranty-covered service or
--   material only unlinked warranty_records (order_*_id SET NULL). The UI loads
--   warranties by order_id, so the removed item's warranty kept showing on the
--   order.
--
-- Desired behaviour (owner):
--   Delete a warranty line -> its warranty disappears from this order.
--   Add a new line and close the order -> activate_order_warranties creates a
--   fresh warranty for the new line (kept lines keep their existing warranty,
--   on conflict per line id do nothing).
--
-- Fix:
--   1) BEFORE DELETE triggers on order_services / order_materials:
--      when crm_owner_may_unlink_order_warranty(order_id) is true, delete the
--      warranty_records of THAT line (same workspace + order + line id).
--      If a warranty claim order already references the record, the line
--      delete is refused with warranty_records:has_claims (history of the
--      claim must not be broken).
--      Non-owners: trigger does nothing -> existing snapshot_immutable rule.
--   2) One-time cleanup: remove already-orphaned activated warranty rows
--      (both line ids NULL) on cancelled or reopened (closed_at NULL) orders
--      that have no claims.
--
-- Does NOT:
--   - touch warranties of lines that still exist
--   - touch warranties of ordinary closed orders (status=closed, not managed)
--   - delete warranty_records referenced by warranty_order_claims
--   - change warranty_records_order_id_fkey / snapshot trigger
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.warranty_records') is null then
    v_problems := v_problems || 'warranty_records missing; ';
  end if;
  if to_regclass('public.order_services') is null then
    v_problems := v_problems || 'order_services missing; ';
  end if;
  if to_regclass('public.order_materials') is null then
    v_problems := v_problems || 'order_materials missing; ';
  end if;
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id(uuid) missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders(uuid) missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'remove_warranty_with_deleted_line preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 0) Owner helper (identical to 20261106090000; create or replace = idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.crm_owner_may_unlink_order_warranty(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_status text;
  v_closed_at timestamptz;
begin
  if v_uid is null or p_order_id is null then
    return false;
  end if;

  select o.workspace_id, o.status, o.closed_at
    into v_ws, v_status, v_closed_at
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return false;
  end if;

  -- Actual workspaces.owner_id only — never membership role, admin, manager, member.
  if not coalesce(public.crm_is_workspace_owner_id(v_ws), false) then
    return false;
  end if;

  if v_status is not distinct from 'cancelled' then
    return true;                       -- closed -> cancelled
  end if;
  if v_closed_at is null then
    return true;                       -- reopened (or never closed) order
  end if;
  return coalesce(public.crm_owner_may_manage_closed_orders(v_ws), false);
end;
$fn$;

revoke all on function public.crm_owner_may_unlink_order_warranty(uuid) from public, anon;
grant execute on function public.crm_owner_may_unlink_order_warranty(uuid) to authenticated, service_role;

comment on function public.crm_owner_may_unlink_order_warranty(uuid) is
  'managed-object: core-app/crm_owner_may_unlink_order_warranty@v1 — workspace owner_id only; order cancelled, reopened (closed_at null) or owner manage-closed enabled.';

-- ---------------------------------------------------------------------------
-- 1) Shared trigger function
-- ---------------------------------------------------------------------------
create or replace function public.order_line_remove_warranty_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws uuid;
  v_claims_exist boolean := false;
begin
  if old.order_id is null then
    return old;
  end if;

  -- Owner_id only, and only for cancelled / reopened / owner-managed orders.
  if not coalesce(public.crm_owner_may_unlink_order_warranty(old.order_id), false) then
    return old;
  end if;

  select o.workspace_id into v_ws from public.orders o where o.id = old.order_id;
  if v_ws is null then
    return old;
  end if;

  if tg_table_name = 'order_services' then
    if to_regclass('public.warranty_order_claims') is not null then
      select exists (
        select 1
        from public.warranty_order_claims c
        join public.warranty_records wr on wr.id = c.warranty_record_id
        where wr.workspace_id = v_ws
          and wr.order_id = old.order_id
          and wr.order_service_id = old.id
      ) into v_claims_exist;
    end if;
    if v_claims_exist then
      raise exception 'warranty_records:has_claims'
        using errcode = 'P0001',
              hint = 'This warranty is already used by a warranty claim order and cannot be removed.';
    end if;
    delete from public.warranty_records wr
     where wr.workspace_id = v_ws
       and wr.order_id = old.order_id
       and wr.order_service_id = old.id;
  else
    if to_regclass('public.warranty_order_claims') is not null then
      select exists (
        select 1
        from public.warranty_order_claims c
        join public.warranty_records wr on wr.id = c.warranty_record_id
        where wr.workspace_id = v_ws
          and wr.order_id = old.order_id
          and wr.order_material_id = old.id
      ) into v_claims_exist;
    end if;
    if v_claims_exist then
      raise exception 'warranty_records:has_claims'
        using errcode = 'P0001',
              hint = 'This warranty is already used by a warranty claim order and cannot be removed.';
    end if;
    delete from public.warranty_records wr
     where wr.workspace_id = v_ws
       and wr.order_id = old.order_id
       and wr.order_material_id = old.id;
  end if;

  return old;
end;
$fn$;

revoke all on function public.order_line_remove_warranty_on_delete() from public, anon, authenticated;

comment on function public.order_line_remove_warranty_on_delete() is
  'managed-object: core-app/order_line_remove_warranty_on_delete@v1 — owner deletes a line on cancelled/reopened/managed order -> that line''s warranty_records removed; refuses when claims reference it.';

-- Names start with "trg_" so they fire AFTER *_closed_guard_biud (alphabetical order).
drop trigger if exists trg_order_services_remove_warranty_bd on public.order_services;
create trigger trg_order_services_remove_warranty_bd
  before delete on public.order_services
  for each row
  execute function public.order_line_remove_warranty_on_delete();

drop trigger if exists trg_order_materials_remove_warranty_bd on public.order_materials;
create trigger trg_order_materials_remove_warranty_bd
  before delete on public.order_materials
  for each row
  execute function public.order_line_remove_warranty_on_delete();

-- ---------------------------------------------------------------------------
-- 2) One-time cleanup of already-orphaned warranties (lines deleted earlier)
-- ---------------------------------------------------------------------------
do $cleanup$
declare
  v_deleted integer := 0;
begin
  delete from public.warranty_records wr
  using public.orders o
  where o.id = wr.order_id
    and o.workspace_id = wr.workspace_id
    and coalesce(wr.activated_on_close, false)
    and wr.order_service_id is null
    and wr.order_material_id is null
    and (o.status = 'cancelled' or o.closed_at is null)
    and (
      to_regclass('public.warranty_order_claims') is null
      or not exists (
        select 1 from public.warranty_order_claims c where c.warranty_record_id = wr.id
      )
    );
  get diagnostics v_deleted = row_count;
  raise notice 'remove_warranty_with_deleted_line: removed % orphaned warranty record(s)', v_deleted;
end;
$cleanup$;

-- ---------------------------------------------------------------------------
-- Postflight
-- ---------------------------------------------------------------------------
do $postflight$
declare
  v_problems text := '';
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_order_services_remove_warranty_bd'
                 and tgrelid = 'public.order_services'::regclass and not tgisinternal) then
    v_problems := v_problems || 'order_services trigger missing; ';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_order_materials_remove_warranty_bd'
                 and tgrelid = 'public.order_materials'::regclass and not tgisinternal) then
    v_problems := v_problems || 'order_materials trigger missing; ';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_warranty_records_snapshot_immutable'
                 and tgrelid = 'public.warranty_records'::regclass and not tgisinternal) then
    v_problems := v_problems || 'snapshot immutability trigger must remain; ';
  end if;
  if v_problems <> '' then
    raise exception 'remove_warranty_with_deleted_line postflight failed: %', v_problems;
  end if;
end;
$postflight$;

commit;

-- Manual verification (as workspace owner, in the app):
--   close (warranty) -> cancel -> reopen -> delete warranty line -> save
--   => warranty badge for that item is gone from the order.
--   add a new warranty line -> save -> close
--   => new warranty appears for the new line only.
-- select id, item_name, order_service_id, order_material_id
--   from public.warranty_records where order_id = '<order uuid>';
