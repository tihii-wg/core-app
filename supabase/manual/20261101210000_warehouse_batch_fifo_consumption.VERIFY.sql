-- =====================================================================
-- READ-ONLY verification for FIFO batch consumption (20261101210000)
-- Safe to re-run. Does not modify data.
-- =====================================================================

-- 1) Helpers present, not executable by anon/authenticated (internal)
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
    'crm_consume_batches_fifo',
    'crm_restore_or_create_batch',
    'crm_post_stock_transfer',
    'crm_post_write_off',
    'issue_order_materials_from_warehouse',
    'return_order_materials_to_warehouse'
  )
order by 1, 2;
-- Expected: helpers prosecdef=true, authenticated_execute=false for helpers;
-- post/issue/return authenticated_execute=true, anon_execute=false.

-- 2) Batch vs warehouse_stock drift (items that have batches).
-- Expected: 0 rows for a healthy workspace after warehouse-only stock ops.
select
  ws.workspace_id,
  ws.warehouse_id,
  ws.inventory_item_id,
  ws.quantity as warehouse_qty,
  coalesce(b.sum_left, 0) as batch_qty_left,
  ws.quantity - coalesce(b.sum_left, 0) as delta
from public.warehouse_stock ws
left join (
  select workspace_id, warehouse_id, inventory_item_id, sum(quantity_left) as sum_left
  from public.stock_batches
  group by 1, 2, 3
) b
  on b.workspace_id = ws.workspace_id
 and b.warehouse_id = ws.warehouse_id
 and b.inventory_item_id = ws.inventory_item_id
where b.inventory_item_id is not null
  and ws.quantity is distinct from coalesce(b.sum_left, 0)
order by 1, 2, 3;

-- 3) Negative batch leftovers (must be empty)
select id, workspace_id, warehouse_id, inventory_item_id, quantity_left
from public.stock_batches
where quantity_left < 0;
