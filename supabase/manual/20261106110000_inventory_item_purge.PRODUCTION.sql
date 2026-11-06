-- =============================================================================
-- Inventory item full delete (purge) with order-usage check
-- Script: 20261106110000_inventory_item_purge.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: 20261102200000_warehouse_integrity_inventory_safety,
--                20261104080000_warehouse_inventory_ledger_complete,
--                20261105210000_cancelled_order_owner_warranty_edit
-- =============================================================================
-- Problem:
--   Deleting an inventory item fails with inventory_item_delete:has_movements
--   ("has stock movement history — mark it inactive") as soon as the item ever
--   moved in the warehouse. The owner wants to fully delete such items.
--
-- New RPCs:
--   1) crm_inventory_item_delete_preview(p_item_id) -> jsonb   (read-only)
--        can_delete, is_owner, blocking_orders[] (non-cancelled orders that use
--        the item), cancelled_orders_count, counts of movements / stock rows /
--        batches / serials / draft and posted document lines, stock quantity.
--   2) crm_purge_inventory_item(p_item_id) -> jsonb            (owner_id only)
--        Re-checks everything server-side, then in ONE transaction:
--        - refuses when any NON-cancelled order uses the item
--          (inventory_item_purge:used_in_orders + order numbers in DETAIL);
--        - cancelled orders: order_materials lines are detached
--          (inventory_item_id = NULL, supply_source = 'one_time'); name, price,
--          quantity and order history stay intact;
--        - deletes warehouse traces: inventory_movements, warehouse_stock,
--          stock_batches, stock_serials, stock_reservations, product_barcodes,
--          item_prices, item_commission_rules;
--        - DRAFT goods receipt / transfer / write-off lines of this item are
--          deleted; POSTED document lines are kept but detached
--          (inventory_item_id -> NULL via FK) so posted documents and any
--          linked finance stay consistent;
--        - other references (estimates, invoices, sales, returns, stock takes,
--          purchase orders, bundles, conversions) are detached by their
--          existing ON DELETE SET NULL FKs;
--        - deletes the inventory item.
--
-- Does NOT:
--   - touch orders that are not cancelled
--   - delete posted documents, finance transactions, invoices or payments
--   - change RLS or grant DELETE on stock tables to authenticated
--   - remove the existing BEFORE DELETE guard (plain deletes keep the old rule)
-- Idempotent (create or replace). Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'inventory_items','inventory_movements','warehouse_stock','stock_batches',
    'stock_serials','order_materials','orders','workspaces'
  ]) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'inventory_item_purge preflight: missing tables: %', v_missing;
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    raise exception 'inventory_item_purge preflight: crm_is_workspace_owner_id(uuid) missing';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'inventory_item_purge preflight: is_workspace_member(uuid) missing';
  end if;
  if to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then
    raise exception 'inventory_item_purge preflight: delete guard missing (apply 20261102200000 first)';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- Helper: count rows of an optional table by inventory_item_id
-- ---------------------------------------------------------------------------
create or replace function public.crm_inventory_item_ref_count(p_table text, p_item_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_n bigint := 0;
begin
  if to_regclass('public.' || p_table) is null then
    return 0;
  end if;
  execute format('select count(*) from public.%I where inventory_item_id = $1', p_table)
    into v_n using p_item_id;
  return coalesce(v_n, 0);
end;
$fn$;

revoke all on function public.crm_inventory_item_ref_count(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Preview (read-only; any workspace member)
-- ---------------------------------------------------------------------------
create or replace function public.crm_inventory_item_delete_preview(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_item public.inventory_items%rowtype;
  v_blocking jsonb;
  v_cancelled_count bigint;
  v_is_owner boolean;
  v_stock numeric;
  v_receipt_draft bigint := 0;
  v_receipt_posted bigint := 0;
  v_transfer_draft bigint := 0;
  v_transfer_posted bigint := 0;
  v_writeoff_draft bigint := 0;
  v_writeoff_posted bigint := 0;
begin
  if auth.uid() is null then
    raise exception 'inventory_item_purge:not_authenticated' using errcode = '42501';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'inventory_item_purge:not_found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(v_item.workspace_id) then
    raise exception 'inventory_item_purge:not_member' using errcode = '42501';
  end if;

  v_is_owner := coalesce(public.crm_is_workspace_owner_id(v_item.workspace_id), false);

  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', x.id, 'number', x.number, 'status', x.status
         ) order by x.number), '[]'::jsonb)
    into v_blocking
  from (
    select distinct o.id, o.number, o.status
    from public.order_materials om
    join public.orders o on o.id = om.order_id
    where om.inventory_item_id = p_item_id
      and o.status is distinct from 'cancelled'
  ) x;

  select count(distinct o.id) into v_cancelled_count
  from public.order_materials om
  join public.orders o on o.id = om.order_id
  where om.inventory_item_id = p_item_id
    and o.status = 'cancelled';

  select coalesce(sum(ws.quantity), 0) into v_stock
  from public.warehouse_stock ws
  where ws.inventory_item_id = p_item_id;

  if to_regclass('public.goods_receipt_lines') is not null then
    select count(*) filter (where gr.status is distinct from 'posted'),
           count(*) filter (where gr.status = 'posted')
      into v_receipt_draft, v_receipt_posted
    from public.goods_receipt_lines l
    join public.goods_receipts gr on gr.id = l.goods_receipt_id
    where l.inventory_item_id = p_item_id;
  end if;
  if to_regclass('public.stock_transfer_lines') is not null then
    select count(*) filter (where t.posted_at is null),
           count(*) filter (where t.posted_at is not null)
      into v_transfer_draft, v_transfer_posted
    from public.stock_transfer_lines l
    join public.stock_transfers t on t.id = l.stock_transfer_id
    where l.inventory_item_id = p_item_id;
  end if;
  if to_regclass('public.write_off_lines') is not null then
    select count(*) filter (where w.posted_at is null),
           count(*) filter (where w.posted_at is not null)
      into v_writeoff_draft, v_writeoff_posted
    from public.write_off_lines l
    join public.write_offs w on w.id = l.write_off_id
    where l.inventory_item_id = p_item_id;
  end if;

  return jsonb_build_object(
    'item_id', v_item.id,
    'item_name', v_item.name,
    'is_owner', v_is_owner,
    'can_delete', v_is_owner and jsonb_array_length(v_blocking) = 0,
    'blocking_orders', v_blocking,
    'cancelled_orders_count', v_cancelled_count,
    'stock_quantity', v_stock,
    'movements_count', public.crm_inventory_item_ref_count('inventory_movements', p_item_id),
    'stock_rows_count', public.crm_inventory_item_ref_count('warehouse_stock', p_item_id),
    'batches_count', public.crm_inventory_item_ref_count('stock_batches', p_item_id),
    'serials_count', public.crm_inventory_item_ref_count('stock_serials', p_item_id),
    'reservations_count', public.crm_inventory_item_ref_count('stock_reservations', p_item_id),
    'draft_document_lines_count', v_receipt_draft + v_transfer_draft + v_writeoff_draft,
    'posted_document_lines_count', v_receipt_posted + v_transfer_posted + v_writeoff_posted
  );
end;
$fn$;

revoke all on function public.crm_inventory_item_delete_preview(uuid) from public, anon;
grant execute on function public.crm_inventory_item_delete_preview(uuid) to authenticated, service_role;

comment on function public.crm_inventory_item_delete_preview(uuid) is
  'managed-object: core-app/crm_inventory_item_delete_preview@v1 — read-only impact summary for deleting an inventory item; blocking_orders = non-cancelled orders using it.';

-- ---------------------------------------------------------------------------
-- 2) Purge (workspace owner_id only)
-- ---------------------------------------------------------------------------
create or replace function public.crm_purge_inventory_item(p_item_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_item public.inventory_items%rowtype;
  v_blocking text;
  v_n bigint;
  v_detached_order_lines bigint := 0;
  v_movements bigint := 0;
  v_stock_rows bigint := 0;
  v_draft_lines bigint := 0;
  v_tbl text;
begin
  if auth.uid() is null then
    raise exception 'inventory_item_purge:not_authenticated' using errcode = '42501';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'inventory_item_purge:not_found' using errcode = 'P0002';
  end if;

  -- Actual workspaces.owner_id only — never membership role, admin, manager, member.
  if not coalesce(public.crm_is_workspace_owner_id(v_item.workspace_id), false) then
    raise exception 'inventory_item_purge:owner_only' using errcode = '42501';
  end if;

  -- Lock referencing order lines, then refuse when any non-cancelled order uses the item.
  perform 1 from public.order_materials om
   where om.inventory_item_id = p_item_id
   for update;

  select string_agg(distinct o.number, ', ' order by o.number) into v_blocking
  from public.order_materials om
  join public.orders o on o.id = om.order_id
  where om.inventory_item_id = p_item_id
    and o.status is distinct from 'cancelled';

  if v_blocking is not null then
    raise exception 'inventory_item_purge:used_in_orders'
      using errcode = 'P0001',
            detail = v_blocking,
            hint = 'Cancel these orders first, then delete the item.';
  end if;

  -- Transaction-local bypass of posted-document line guards (same flag the
  -- warehouse posting RPCs use). Reset automatically at transaction end.
  perform set_config('crm.warehouse_posting', 'on', true);

  -- Cancelled orders: detach catalog link, keep the line as a one-time part.
  update public.order_materials om
     set inventory_item_id = null,
         supply_source = 'one_time'
   where om.inventory_item_id = p_item_id
     and exists (
       select 1 from public.orders o
       where o.id = om.order_id and o.status = 'cancelled'
     );
  get diagnostics v_detached_order_lines = row_count;

  -- Warehouse ledger and stock traces.
  delete from public.inventory_movements where inventory_item_id = p_item_id;
  get diagnostics v_movements = row_count;

  delete from public.stock_serials where inventory_item_id = p_item_id;
  delete from public.stock_batches where inventory_item_id = p_item_id;
  delete from public.warehouse_stock where inventory_item_id = p_item_id;
  get diagnostics v_stock_rows = row_count;

  foreach v_tbl in array array['stock_reservations', 'product_barcodes', 'item_prices', 'item_commission_rules']
  loop
    if to_regclass('public.' || v_tbl) is not null then
      execute format('delete from public.%I where inventory_item_id = $1', v_tbl) using p_item_id;
    end if;
  end loop;

  -- Draft document lines are removed; posted lines are detached by FK SET NULL below.
  if to_regclass('public.goods_receipt_lines') is not null then
    delete from public.goods_receipt_lines l
     using public.goods_receipts gr
     where gr.id = l.goods_receipt_id
       and l.inventory_item_id = p_item_id
       and gr.status is distinct from 'posted';
    get diagnostics v_n = row_count;
    v_draft_lines := v_draft_lines + v_n;
  end if;
  if to_regclass('public.stock_transfer_lines') is not null then
    delete from public.stock_transfer_lines l
     using public.stock_transfers t
     where t.id = l.stock_transfer_id
       and l.inventory_item_id = p_item_id
       and t.posted_at is null;
    get diagnostics v_n = row_count;
    v_draft_lines := v_draft_lines + v_n;
  end if;
  if to_regclass('public.write_off_lines') is not null then
    delete from public.write_off_lines l
     using public.write_offs w
     where w.id = l.write_off_id
       and l.inventory_item_id = p_item_id
       and w.posted_at is null;
    get diagnostics v_n = row_count;
    v_draft_lines := v_draft_lines + v_n;
  end if;

  -- Finally the item. The existing BEFORE DELETE guard now finds no movements,
  -- no order_materials and no serial history, so it passes.
  delete from public.inventory_items where id = p_item_id;

  return jsonb_build_object(
    'item_id', p_item_id,
    'deleted', true,
    'detached_cancelled_order_lines', v_detached_order_lines,
    'deleted_movements', v_movements,
    'deleted_stock_rows', v_stock_rows,
    'deleted_draft_document_lines', v_draft_lines
  );
end;
$fn$;

revoke all on function public.crm_purge_inventory_item(uuid) from public, anon;
grant execute on function public.crm_purge_inventory_item(uuid) to authenticated, service_role;

comment on function public.crm_purge_inventory_item(uuid) is
  'managed-object: core-app/crm_purge_inventory_item@v1 — owner_id only; refuses when non-cancelled orders use the item; detaches cancelled-order lines; deletes stock ledger traces and draft document lines; posted documents keep detached lines.';

-- ---------------------------------------------------------------------------
-- Postflight
-- ---------------------------------------------------------------------------
do $postflight$
declare
  v_problems text := '';
begin
  if to_regprocedure('public.crm_inventory_item_delete_preview(uuid)') is null then
    v_problems := v_problems || 'preview RPC missing; ';
  end if;
  if to_regprocedure('public.crm_purge_inventory_item(uuid)') is null then
    v_problems := v_problems || 'purge RPC missing; ';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'inventory_items_clear_denied_stock_children'
                 and tgrelid = 'public.inventory_items'::regclass and not tgisinternal) then
    v_problems := v_problems || 'inventory delete guard trigger must remain; ';
  end if;
  if v_problems <> '' then
    raise exception 'inventory_item_purge postflight failed: %', v_problems;
  end if;
end;
$postflight$;

commit;

-- Manual verification (as workspace owner):
-- select public.crm_inventory_item_delete_preview('<item uuid>');
--   -> blocking_orders lists open/closed orders; can_delete=false while non-empty.
-- Cancel those orders, then in the app delete the item:
-- select public.crm_purge_inventory_item('<item uuid>');
