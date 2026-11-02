-- READ-ONLY VERIFY for 20261102200000_warehouse_integrity_inventory_safety.
-- Expect check_ok = true for every row (diag_* may be informational).

select check_name, check_ok, detail
from (
  select 'fn_delete_cleanup_exists'::text as check_name,
    to_regprocedure('public.inventory_items_clear_denied_stock_children()') is not null as check_ok,
    'inventory_items_clear_denied_stock_children()'::text as detail
  union all select 'fn_delete_security_definer',
    coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.inventory_items_clear_denied_stock_children()')), false),
    'prosecdef'
  union all select 'fn_delete_empty_search_path',
    coalesce((select p.proconfig = array['search_path='] from pg_proc p where p.oid = to_regprocedure('public.inventory_items_clear_denied_stock_children()')), false),
    'search_path='
  union all select 'fn_delete_checks_member_and_history',
    case when to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then false
    else (
      with d as (select pg_get_functiondef('public.inventory_items_clear_denied_stock_children()'::regprocedure) as b)
      select position('is_workspace_member' in b) > 0
         and position('has_movements' in b) > 0
         and position('has_order_materials' in b) > 0
         and position('workspace_id = old.workspace_id' in b) > 0
      from d
    ) end,
    'member + history guards + workspace scope'
  union all select 'trigger_delete_cleanup',
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname='inventory_items'
        and t.tgname='inventory_items_clear_denied_stock_children' and not t.tgisinternal
        and pg_get_triggerdef(t.oid) ilike '%before delete%'
    ),
    'BEFORE DELETE trigger'
  union all select 'guard_lines_checks_old_parent',
    case when to_regprocedure('public.crm_guard_posted_document_lines()') is null then false
    else position('v_parent_old' in pg_get_functiondef('public.crm_guard_posted_document_lines()'::regprocedure)) > 0 end,
    'OLD parent checked on UPDATE/DELETE'
  union all select 'guard_receipt_header_exists',
    to_regprocedure('public.crm_guard_receipt_header_immutable()') is not null,
    'crm_guard_receipt_header_immutable()'
  union all select 'trigger_receipt_header',
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='goods_receipts'
        and t.tgname='crm_guard_receipt_header_immutable' and not t.tgisinternal
    ),
    'BEFORE UPDATE on goods_receipts'
  union all select 'post_receipt_writes_movements',
    case when to_regprocedure('public.crm_post_goods_receipt(uuid)') is null then false
    else position('inventory_movements' in pg_get_functiondef('public.crm_post_goods_receipt(uuid)'::regprocedure)) > 0
         and position('goods_receipt' in pg_get_functiondef('public.crm_post_goods_receipt(uuid)'::regprocedure)) > 0 end,
    'crm_post_goods_receipt inserts inventory_movements'
  union all select 'order_materials_item_nullable',
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='order_materials'
        and column_name='inventory_item_id' and is_nullable='YES'
    ),
    'inventory_item_id nullable'
  union all select 'order_materials_supply_source',
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='order_materials' and column_name='supply_source'
    ),
    'supply_source column'
  union all select 'sync_accepts_freeform',
    case when to_regprocedure('public.sync_order_materials(uuid, jsonb)') is null then false
    else position('one_time' in pg_get_functiondef('public.sync_order_materials(uuid, jsonb)'::regprocedure)) > 0 end,
    'sync_order_materials handles one_time/customer'
  union all select 'authenticated_no_stock_delete',
    not coalesce(has_table_privilege('authenticated','public.warehouse_stock','delete'), true)
    and not coalesce(has_table_privilege('authenticated','public.stock_batches','delete'), true)
    and not coalesce(has_table_privilege('authenticated','public.stock_serials','delete'), true),
    'no authenticated DELETE on stock tables'
  union all select 'movements_still_restrict_item',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      where c.contype='f' and c.convalidated and n.nspname='public' and rel.relname='inventory_movements'
        and a.attname='inventory_item_id' and rn.nspname='public' and ref.relname='inventory_items'
        and c.confdeltype='r'
    ),
    'inventory_movements ON DELETE RESTRICT'
  union all select 'order_materials_fk_no_cascade',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      where c.contype='f' and c.convalidated and n.nspname='public' and rel.relname='order_materials'
        and a.attname='inventory_item_id' and rn.nspname='public' and ref.relname='inventory_items'
        and c.confdeltype in ('a','r','n')
    ),
    'order_materials FK not CASCADE'
  union all select 'diag_issue_writes_batch_id',
    case when to_regprocedure('public.issue_order_materials_from_warehouse(uuid,jsonb,uuid,text)') is null then true
    else position('batch_id' in pg_get_functiondef('public.issue_order_materials_from_warehouse(uuid,jsonb,uuid,text)'::regprocedure)) > 0 end,
    'OPTIONAL remaining gap if false: issue RPC still omits batch_id (FIFO restore may create new batches)'
) s
order by check_name;
