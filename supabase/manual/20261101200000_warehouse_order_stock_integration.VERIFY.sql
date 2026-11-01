-- =====================================================================
-- Core App — READ-ONLY verification for warehouse ↔ order stock integration
--
-- Run in the Supabase SQL Editor AFTER applying (manually, when authorized):
--   1. crm_ro_v1.PRODUCTION.sql                         (warehouses, warehouse_stock, …)
--   2. 20261018210000_issue_return_rpc_repair.sql       (global issue/return prerequisites)
--   3. 20261101030000_warehouse_ops_rpcs.PRODUCTION.sql (receipt / transfer / write-off)
--   4. 20261101080000_issue_order_materials_warehouse.PRODUCTION.sql
--   5. 20261101100000_return_order_materials_warehouse.PRODUCTION.sql
--
-- Does NOT modify data. Safe to re-run. Not applied by the app or CI.
-- =====================================================================

-- 1) Required tables
select
  to_regclass('public.warehouses') is not null as has_warehouses,
  to_regclass('public.warehouse_stock') is not null as has_warehouse_stock,
  to_regclass('public.stock_batches') is not null as has_stock_batches,
  to_regclass('public.inventory_movements') is not null as has_inventory_movements,
  to_regclass('public.goods_receipts') is not null as has_goods_receipts,
  to_regclass('public.stock_transfers') is not null as has_stock_transfers,
  to_regclass('public.write_offs') is not null as has_write_offs;

-- 2) inventory_movements.warehouse_id (crm_ro_v1)
select exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'inventory_movements'
    and column_name = 'warehouse_id'
) as has_movements_warehouse_id;

-- 3) RPC presence + security definer + grants
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'issue_order_materials',
    'issue_order_materials_from_warehouse',
    'return_order_materials',
    'return_order_materials_to_warehouse',
    'crm_post_goods_receipt',
    'crm_post_stock_transfer',
    'crm_post_write_off'
  )
order by p.proname, args;
-- Expected: all seven present, prosecdef = true, authenticated_execute = true, anon_execute = false
-- (except any function still missing because its PRODUCTION.sql was not applied yet).

-- 4) Stock invariant: inventory_items.quantity must equal SUM(warehouse_stock.quantity)
--    for every item that has at least one warehouse_stock row.
--    Expected: 0 rows.
select
  i.workspace_id,
  i.id as inventory_item_id,
  i.name,
  i.quantity as item_quantity,
  coalesce(ws.sum_qty, 0) as warehouse_sum,
  i.quantity - coalesce(ws.sum_qty, 0) as delta
from public.inventory_items i
left join (
  select workspace_id, inventory_item_id, sum(quantity) as sum_qty
  from public.warehouse_stock
  group by workspace_id, inventory_item_id
) ws
  on ws.workspace_id = i.workspace_id
 and ws.inventory_item_id = i.id
where ws.inventory_item_id is not null
  and i.quantity is distinct from coalesce(ws.sum_qty, 0)
order by i.workspace_id, i.name;

-- 5) Items with company quantity > 0 but no warehouse_stock rows (often pre-warehouse legacy stock).
--    Informational — not always an error until stock is received into a warehouse.
select
  i.workspace_id,
  i.id as inventory_item_id,
  i.name,
  i.quantity
from public.inventory_items i
where i.quantity > 0
  and not exists (
    select 1
    from public.warehouse_stock ws
    where ws.workspace_id = i.workspace_id
      and ws.inventory_item_id = i.id
  )
order by i.workspace_id, i.name
limit 100;
