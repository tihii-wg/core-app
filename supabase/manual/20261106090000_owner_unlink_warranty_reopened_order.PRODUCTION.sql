-- =============================================================================
-- Owner may remove warranty-covered lines from REOPENED / owner-managed orders
-- Script: 20261106090000_owner_unlink_warranty_reopened_order.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: 20261105210000_cancelled_order_owner_warranty_edit,
--                20261105220000_reopen_cancelled_order
-- =============================================================================
-- Problem:
--   close -> cancel -> reopen_cancelled_order sets an open status and clears
--   closed_at. The warranty_records created on the first close stay
--   activated_on_close = true and still point at the order lines.
--   Deleting such a service/material line fires ON DELETE SET NULL on
--   warranty_records.order_service_id / order_material_id, and
--   warranty_records_reject_snapshot_mutation@v2 allows that unlink ONLY while
--   status = 'cancelled'. After reopen the status is open, so the owner gets
--     warranty_records:snapshot_immutable
--   The same happens on a closed order edited via owner_can_manage_closed_orders.
--
-- Fix (narrow):
--   1) crm_owner_may_unlink_order_warranty(order_id) — true only when
--      auth.uid() = workspaces.owner_id AND one of:
--        a) order.status = 'cancelled'            (existing v2 behaviour)
--        b) order.closed_at IS NULL               (reopened / open again)
--        c) crm_owner_may_manage_closed_orders(ws) (owner manage-closed setting)
--   2) warranty_records_reject_snapshot_mutation@v3 uses that helper for the
--      SET NULL unlink path. Terms (dates, mileage, duration, order_id,
--      workspace_id) and re-linking to another line stay immutable.
--
-- Does NOT:
--   - drop or disable trg_warranty_records_snapshot_immutable
--   - delete warranty_records (removed line keeps its historical snapshot,
--     order_*_id becomes NULL)
--   - grant anything to admins/managers/members (owner_id only)
--   - change order_lifecycle_guard, closed guards or close_order_if_settled
-- New lines get their own warranty_records on the next close
-- (activate_order_warranties: on conflict per line id do nothing).
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
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id(uuid) missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders(uuid) missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_edit_cancelled_order(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_edit_cancelled_order(uuid) missing (apply 20261105210000 first); ';
  end if;
  if v_problems <> '' then
    raise exception 'owner_unlink_warranty_reopened_order preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) Authorization helper — workspace owner_id only
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
-- 2) Snapshot immutability @v3 — unlink allowed via the helper above
-- ---------------------------------------------------------------------------
create or replace function public.warranty_records_reject_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_terms_changed boolean;
  v_service_relink boolean;
  v_material_relink boolean;
  v_service_unlink boolean;
  v_material_unlink boolean;
begin
  if tg_op <> 'UPDATE' or not coalesce(old.activated_on_close, false) then
    return new;
  end if;

  v_terms_changed :=
       old.starts_at is distinct from new.starts_at
    or old.starts_on is distinct from new.starts_on
    or old.ends_on is distinct from new.ends_on
    or old.start_mileage is distinct from new.start_mileage
    or old.expires_at_mileage is distinct from new.expires_at_mileage
    or old.duration_months is distinct from new.duration_months
    or old.duration_days is distinct from new.duration_days
    or old.mileage_limit is distinct from new.mileage_limit
    or old.order_id is distinct from new.order_id
    or old.workspace_id is distinct from new.workspace_id;

  v_service_relink :=
    old.order_service_id is distinct from new.order_service_id
    and new.order_service_id is not null;
  v_material_relink :=
    old.order_material_id is distinct from new.order_material_id
    and new.order_material_id is not null;

  if v_terms_changed or v_service_relink or v_material_relink then
    raise exception 'warranty_records:snapshot_immutable'
      using errcode = 'P0001',
            hint = 'Activated warranty snapshots cannot be rewritten.';
  end if;

  v_service_unlink :=
    old.order_service_id is not null and new.order_service_id is null;
  v_material_unlink :=
    old.order_material_id is not null and new.order_material_id is null;

  if v_service_unlink or v_material_unlink then
    -- Parent line DELETE -> ON DELETE SET NULL. Preserve the historical row.
    if coalesce(public.crm_owner_may_unlink_order_warranty(old.order_id), false) then
      return new;
    end if;
    raise exception 'warranty_records:snapshot_immutable'
      using errcode = 'P0001',
            hint = 'Only the workspace owner may remove a warranty-covered line (cancelled, reopened or owner-managed closed order).';
  end if;

  return new;
end;
$fn$;

comment on function public.warranty_records_reject_snapshot_mutation() is
  'managed-object: core-app/warranty_records_reject_snapshot_mutation@v3 — freeze activated snapshot terms; allow line FK SET NULL only via crm_owner_may_unlink_order_warranty (owner_id; cancelled / reopened / manage-closed).';

drop trigger if exists trg_warranty_records_snapshot_immutable on public.warranty_records;
create trigger trg_warranty_records_snapshot_immutable
  before update on public.warranty_records
  for each row
  execute function public.warranty_records_reject_snapshot_mutation();

-- ---------------------------------------------------------------------------
-- Postflight
-- ---------------------------------------------------------------------------
do $postflight$
declare
  v_problems text := '';
  v_def text;
begin
  select pg_get_functiondef('public.warranty_records_reject_snapshot_mutation()'::regprocedure) into v_def;
  if position('crm_owner_may_unlink_order_warranty' in v_def) = 0 then
    v_problems := v_problems || 'snapshot trigger missing owner unlink helper; ';
  end if;
  if position('snapshot_immutable' in v_def) = 0 then
    v_problems := v_problems || 'snapshot_immutable raise missing; ';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_warranty_records_snapshot_immutable'
      and tgrelid = 'public.warranty_records'::regclass
      and not tgisinternal
  ) then
    v_problems := v_problems || 'trg_warranty_records_snapshot_immutable missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'owner_unlink_warranty_reopened_order postflight failed: %', v_problems;
  end if;
end;
$postflight$;

commit;

-- Manual verification (as workspace owner, in the app):
--   1. Close an order with a warranty service/material (warranty activates).
--   2. Cancel it, then "Reopen" (status in progress, closed_at NULL).
--   3. Remove the warranty line, save; add another line, save.
--   4. Old warranty_records row remains with order_*_id IS NULL and unchanged terms:
-- select id, item_name, order_service_id, order_material_id, starts_on, ends_on
--   from public.warranty_records where order_id = '<order uuid>';
--   5. Close again -> new warranty_records row for the new line.
