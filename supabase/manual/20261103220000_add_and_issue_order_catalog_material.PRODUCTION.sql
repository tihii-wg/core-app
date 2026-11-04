-- =====================================================================
-- Core App — Atomic catalog order material create/update + warehouse issue
--
-- MANUAL APPLY ONLY (Supabase SQL Editor). Do NOT run from the app or CI.
-- Does NOT modify sync_order_materials.
--
-- NEW functions (frontend already calls these names):
--
--   add_and_issue_order_catalog_material(
--     p_order_id uuid,
--     p_warehouse_id uuid,
--     p_inventory_item_id uuid,
--     p_quantity integer,
--     p_price numeric default null,
--     p_idempotency_key text default null
--   ) returns jsonb
--     { "material": <order_materials row>, "movements": [<inventory_movements>...] }
--
--   set_order_catalog_material_quantity_with_issue(
--     p_order_id uuid,
--     p_order_material_id uuid,
--     p_warehouse_id uuid,
--     p_quantity integer,
--     p_idempotency_key text default null
--   ) returns jsonb
--     { "material": <order_materials row> }
--
-- WHY:
--   Creating an order_materials row and then calling issue_order_materials_from_warehouse
--   is two client round-trips and is not atomic. Catalog materials must be deducted from
--   an explicitly selected warehouse as soon as the line is saved.
--
-- CONTRACT (both functions):
--   * Auth: authenticated workspace member; role owner / admin / manager (same as
--     issue_order_materials_from_warehouse).
--   * Warehouse: active, deleted_at is null, same workspace as the order.
--   * Material: inventory_items row in the same workspace; supply_source = catalog.
--   * Quantity: positive whole number (matches live integer order_materials columns).
--   * Locks (recommended order): advisory idempotency → orders → order_materials
--     → inventory_items → warehouses FOR SHARE → warehouse_stock → stock_batches.
--   * Effects for add_and_issue:
--       - INSERT order_materials (or reuse existing catalog line for the same item)
--         with quantity = p_quantity, quantity_issued starts at 0 then increases
--       - Deduct warehouse_stock and inventory_items.quantity
--       - Set quantity_issued += issued amount (never above quantity)
--       - Prefer setting order_materials.warehouse_id when the column exists
--       - INSERT inventory_movements (issue) with warehouse_id + batch_id when columns exist
--       - Consume FIFO stock_batches where available; store consumed batch on the movement
--   * Effects for set_quantity_with_issue:
--       - Reject if p_quantity < (quantity_issued - quantity_returned)
--       - UPDATE quantity = p_quantity
--       - Issue only delta = p_quantity - quantity_issued (if delta > 0)
--       - Never re-issue already issued quantity; never touch stock on price-only edits
--         (this RPC is quantity-only)
--   * Idempotency: same key + same fingerprint → replay prior result; same key +
--     different params → error.
--   * Insufficient stock → raise and roll back entire transaction (no partial line).
--   * Multi-line atomicity: this file is per-line. For createOrder with multiple catalog
--     lines, a future batch wrapper is recommended (see BACKEND note below). Until then
--     the frontend compensates with best-effort returns on create failure.
--
-- ALSO DOCUMENT (do not implement in this file unless reviewing together):
--   1) crm_post_goods_receipt — insert inventory_movements for receipt posting
--   2) crm_post_stock_transfer — source + destination movement pair
--   3) issue movement batch_id persistence for return provenance
--   4) inventory_movements.quantity numeric if fractional units are required
--   5) REVOKE EXECUTE on legacy issue_order_materials / return_order_materials
--      from authenticated AFTER frontend cutover is verified
--   6) Optional BEFORE INSERT trigger/policy: reject inventory_items insert when
--      workspace has no active warehouse
--
-- REQUIRES: warehouses, warehouse_stock, order_materials, inventory_movements,
--   issue_order_materials_from_warehouse (or inline equivalent logic),
--   is_workspace_member, workspace_member_role.
--
-- This file is a SPECIFICATION STUB for manual review.
-- Replace the bodies below with the full plpgsql implementation before applying to MAIN.
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.order_materials') is null
     or to_regclass('public.inventory_items') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.warehouses') is null
     or to_regclass('public.warehouse_stock') is null then
    raise exception 'Preflight failed: required warehouse/order tables missing';
  end if;
  if to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null then
    raise exception 'Preflight failed: issue_order_materials_from_warehouse missing — apply 20261101080000 first';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- IMPLEMENTATION PLACEHOLDER
-- Reviewer: replace with production plpgsql that performs the contract above
-- in a single transaction. Do not leave these stubs on MAIN.
-- ---------------------------------------------------------------------------

create or replace function public.add_and_issue_order_catalog_material(
  p_order_id uuid,
  p_warehouse_id uuid,
  p_inventory_item_id uuid,
  p_quantity integer,
  p_price numeric default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  raise exception
    'add_and_issue_order_catalog_material is not implemented yet. Apply the reviewed production body from 20261103220000_add_and_issue_order_catalog_material.PRODUCTION.sql'
    using errcode = 'P0001';
end;
$function$;

create or replace function public.set_order_catalog_material_quantity_with_issue(
  p_order_id uuid,
  p_order_material_id uuid,
  p_warehouse_id uuid,
  p_quantity integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  raise exception
    'set_order_catalog_material_quantity_with_issue is not implemented yet. Apply the reviewed production body from 20261103220000_add_and_issue_order_catalog_material.PRODUCTION.sql'
    using errcode = 'P0001';
end;
$function$;

revoke all on function public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text) from public, anon;
revoke all on function public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text) to authenticated, service_role;
grant execute on function public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text) to authenticated, service_role;

commit;
