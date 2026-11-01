-- =====================================================================
-- Core App: FIFO stock_batches consumption + restore (warehouse module)
--
-- Stage: apply AFTER
--   crm_ro_v1.PRODUCTION.sql
--   20261018210000_issue_return_rpc_repair.sql (or equivalent issue/return base)
--   20261101030000_warehouse_ops_rpcs.PRODUCTION.sql
--   20261101080000_issue_order_materials_warehouse.PRODUCTION.sql
--   20261101100000_return_order_materials_warehouse.PRODUCTION.sql
--
-- WHAT THIS DOES
--   1. Helper: crm_consume_batches_fifo — decreases stock_batches.quantity_left
--      oldest-first (received_at, created_at, id). Never negative.
--   2. Helper: crm_restore_or_create_batch — restores quantity_left on a known
--      batch, or inserts a new return/transfer batch when no original batch exists.
--   3. Replaces crm_post_stock_transfer / crm_post_write_off to consume batches
--      (and recreate destination batches on transfer).
--   4. Replaces issue_order_materials_from_warehouse /
--      return_order_materials_to_warehouse to consume/restore batches while
--      keeping the same public signatures and idempotency rules.
--
-- LEGACY STOCK (no stock_batches rows for item+warehouse):
--   Warehouse_stock / inventory_items updates still run. Batch helpers no-op
--   when zero batch rows exist. This does NOT invent opening-balance batches
--   and does NOT auto-reconcile historical quantities.
--
-- IDEMPOTENT: create or replace. One transaction. NOT applied by app/CI.
-- Do NOT execute remotely from the agent — owner applies manually in SQL Editor.
-- =====================================================================

begin;

do $preflight$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'inventory_items', 'warehouses', 'warehouse_stock', 'stock_batches',
    'inventory_movements', 'order_materials', 'orders',
    'stock_transfers', 'stock_transfer_lines',
    'write_offs', 'write_off_lines'
  ]) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'Preflight failed: missing tables (%). Apply crm_ro_v1 and warehouse ops SQL first.', v_missing;
  end if;

  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    raise exception 'Preflight failed: crm_has_permission(uuid, text) missing.';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null
     or to_regprocedure('public.workspace_member_role(uuid)') is null then
    raise exception 'Preflight failed: workspace helper functions missing.';
  end if;
  if to_regprocedure('public.crm_post_stock_transfer(uuid)') is null
     or to_regprocedure('public.crm_post_write_off(uuid)') is null then
    raise exception 'Preflight failed: apply 20261101030000_warehouse_ops_rpcs.PRODUCTION.sql first.';
  end if;
  if to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null
     or to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)') is null then
    raise exception 'Preflight failed: apply warehouse issue/return SQL (2.1h / 2.1j) first.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- 1. FIFO consume helper
-- ---------------------------------------------------------------------
-- Returns one row per consumed batch slice. Empty result set when no batches
-- exist for (workspace, warehouse, item) — legacy path.
-- Raises insufficient_batch_stock when some batches exist but quantity_left sum
-- is below p_quantity (detects batch vs warehouse_stock drift).
create or replace function public.crm_consume_batches_fifo(
  p_workspace_id uuid,
  p_warehouse_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric
)
returns table (
  batch_id uuid,
  quantity numeric,
  unit_cost numeric,
  expires_on date,
  supplier_client_id uuid
)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_remaining numeric;
  v_batch record;
  v_take numeric;
  v_batch_count integer;
  v_batch_sum numeric;
  v_rowcount integer;
begin
  if p_workspace_id is null or p_warehouse_id is null or p_inventory_item_id is null then
    raise exception 'crm_consume_batches_fifo: workspace, warehouse and item are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'crm_consume_batches_fifo: quantity must be > 0' using errcode = '22023';
  end if;

  select count(*)::integer, coalesce(sum(b.quantity_left), 0)
    into v_batch_count, v_batch_sum
  from public.stock_batches b
  where b.workspace_id = p_workspace_id
    and b.warehouse_id = p_warehouse_id
    and b.inventory_item_id = p_inventory_item_id
    and b.quantity_left > 0;

  if v_batch_count = 0 then
    -- Legacy stock with no batch rows: caller still updates warehouse_stock.
    return;
  end if;

  if v_batch_sum < p_quantity then
    raise exception 'insufficient_batch_stock' using errcode = 'P0001';
  end if;

  v_remaining := p_quantity;

  for v_batch in
    select b.id, b.quantity_left, b.unit_cost, b.expires_on, b.supplier_client_id
    from public.stock_batches b
    where b.workspace_id = p_workspace_id
      and b.warehouse_id = p_warehouse_id
      and b.inventory_item_id = p_inventory_item_id
      and b.quantity_left > 0
    order by b.received_at asc nulls last, b.created_at asc nulls last, b.id asc
    for update of b
  loop
    exit when v_remaining <= 0;
    v_take := least(v_batch.quantity_left, v_remaining);

    update public.stock_batches
       set quantity_left = quantity_left - v_take
     where id = v_batch.id
       and workspace_id = p_workspace_id
       and quantity_left >= v_take;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'insufficient_batch_stock' using errcode = 'P0001';
    end if;

    batch_id := v_batch.id;
    quantity := v_take;
    unit_cost := v_batch.unit_cost;
    expires_on := v_batch.expires_on;
    supplier_client_id := v_batch.supplier_client_id;
    return next;

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'insufficient_batch_stock' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.crm_consume_batches_fifo(uuid, uuid, uuid, numeric)
  from public, anon, authenticated, service_role;
-- Internal helper; only SECURITY DEFINER callers invoke it.

-- ---------------------------------------------------------------------
-- 2. Restore / create batch helper (returns / transfer destination)
-- ---------------------------------------------------------------------
create or replace function public.crm_restore_or_create_batch(
  p_workspace_id uuid,
  p_warehouse_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_batch_id uuid default null,
  p_unit_cost numeric default 0,
  p_expires_on date default null,
  p_supplier_client_id uuid default null,
  p_goods_receipt_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_id uuid;
  v_rowcount integer;
begin
  if p_workspace_id is null or p_warehouse_id is null or p_inventory_item_id is null then
    raise exception 'crm_restore_or_create_batch: workspace, warehouse and item are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'crm_restore_or_create_batch: quantity must be > 0' using errcode = '22023';
  end if;

  if p_batch_id is not null then
    update public.stock_batches
       set quantity_left = quantity_left + p_quantity
     where id = p_batch_id
       and workspace_id = p_workspace_id
       and warehouse_id = p_warehouse_id
       and inventory_item_id = p_inventory_item_id;

    get diagnostics v_rowcount = row_count;
    if v_rowcount = 1 then
      return p_batch_id;
    end if;
    -- Fall through: original batch missing or warehouse mismatch — do not invent a reference.
  end if;

  insert into public.stock_batches (
    workspace_id, inventory_item_id, warehouse_id, goods_receipt_id, supplier_client_id,
    unit_cost, quantity_received, quantity_left, expires_on, received_at
  ) values (
    p_workspace_id, p_inventory_item_id, p_warehouse_id, p_goods_receipt_id, p_supplier_client_id,
    coalesce(p_unit_cost, 0), p_quantity, p_quantity, p_expires_on, now()
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.crm_restore_or_create_batch(uuid, uuid, uuid, numeric, uuid, numeric, date, uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. crm_post_stock_transfer — with FIFO batch move
-- ---------------------------------------------------------------------
create or replace function public.crm_post_stock_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line record;
  v_available numeric;
  v_lines integer := 0;
  v_total numeric(16,2) := 0;
  v_slice record;
begin
  if (select auth.uid()) is null then
    raise exception 'crm_post_stock_transfer: not authenticated' using errcode = '42501';
  end if;
  if p_transfer_id is null then
    raise exception 'crm_post_stock_transfer: transfer id is required' using errcode = '22023';
  end if;

  select * into v_transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found or v_transfer.deleted_at is not null then
    raise exception 'crm_post_stock_transfer: transfer not found' using errcode = 'P0002';
  end if;

  if not (public.crm_has_permission(v_transfer.workspace_id, 'inventory.transfers.create')
       or public.crm_has_permission(v_transfer.workspace_id, 'inventory.transfers.edit')) then
    raise exception 'crm_post_stock_transfer: permission denied (inventory.transfers.create or inventory.transfers.edit required)'
      using errcode = '42501';
  end if;

  if v_transfer.posted_at is not null then
    raise exception 'crm_post_stock_transfer: transfer is already posted' using errcode = '55000';
  end if;

  if v_transfer.from_warehouse_id is null or v_transfer.to_warehouse_id is null then
    raise exception 'crm_post_stock_transfer: both warehouses are required' using errcode = '22023';
  end if;
  if v_transfer.from_warehouse_id = v_transfer.to_warehouse_id then
    raise exception 'crm_post_stock_transfer: source and destination warehouses must differ' using errcode = '22023';
  end if;
  if (select count(*) from public.warehouses w
       where w.id in (v_transfer.from_warehouse_id, v_transfer.to_warehouse_id)
         and w.workspace_id = v_transfer.workspace_id and w.deleted_at is null and w.is_active) <> 2 then
    raise exception 'crm_post_stock_transfer: warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  if not exists (select 1 from public.stock_transfer_lines where stock_transfer_id = p_transfer_id) then
    raise exception 'crm_post_stock_transfer: transfer has no lines' using errcode = '22023';
  end if;

  for v_line in
    select l.id, l.inventory_item_id, l.quantity, i.id as found_item
    from public.stock_transfer_lines l
    left join public.inventory_items i on i.id = l.inventory_item_id and i.workspace_id = v_transfer.workspace_id
    where l.stock_transfer_id = p_transfer_id
  loop
    if v_line.inventory_item_id is null or v_line.found_item is null then
      raise exception 'crm_post_stock_transfer: every line needs an inventory item of this workspace' using errcode = '22023';
    end if;
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'crm_post_stock_transfer: line quantity must be greater than 0' using errcode = '22023';
    end if;
    if v_line.quantity <> round(v_line.quantity, 2) then
      raise exception 'crm_post_stock_transfer: line quantity allows at most 2 decimals' using errcode = '22023';
    end if;
  end loop;

  perform set_config('crm.warehouse_posting', 'on', true);

  for v_line in
    select l.inventory_item_id, sum(l.quantity) as quantity, max(i.name) as item_name,
           sum(round(l.quantity * l.unit_cost, 2)) as amount
    from public.stock_transfer_lines l
    join public.inventory_items i on i.id = l.inventory_item_id
    where l.stock_transfer_id = p_transfer_id
    group by l.inventory_item_id
    order by l.inventory_item_id
  loop
    select ws.quantity into v_available
    from public.warehouse_stock ws
    where ws.warehouse_id = v_transfer.from_warehouse_id and ws.inventory_item_id = v_line.inventory_item_id
    for update;

    if v_available is null or v_available < v_line.quantity then
      raise exception 'crm_post_stock_transfer: insufficient stock for "%" in source warehouse (available %, requested %)',
        v_line.item_name, coalesce(v_available, 0), v_line.quantity using errcode = '23514';
    end if;

    -- FIFO consume at source; recreate equivalent slices at destination (new batch ids).
    for v_slice in
      select * from public.crm_consume_batches_fifo(
        v_transfer.workspace_id, v_transfer.from_warehouse_id, v_line.inventory_item_id, v_line.quantity
      )
    loop
      perform public.crm_restore_or_create_batch(
        v_transfer.workspace_id,
        v_transfer.to_warehouse_id,
        v_line.inventory_item_id,
        v_slice.quantity,
        null, -- never keep source batch_id on destination
        v_slice.unit_cost,
        v_slice.expires_on,
        v_slice.supplier_client_id,
        null
      );
    end loop;

    update public.warehouse_stock
       set quantity = quantity - v_line.quantity, updated_at = now()
     where warehouse_id = v_transfer.from_warehouse_id and inventory_item_id = v_line.inventory_item_id;

    insert into public.warehouse_stock (workspace_id, warehouse_id, inventory_item_id, quantity)
    values (v_transfer.workspace_id, v_transfer.to_warehouse_id, v_line.inventory_item_id, v_line.quantity)
    on conflict (warehouse_id, inventory_item_id)
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now();

    -- inventory_items.quantity unchanged for transfers.
    -- Optional ledger row (crm_ro_v1 columns). EXECUTE avoids CREATE failure when columns absent.
    if to_regclass('public.inventory_movements') is not null then
      begin
        execute $m$
          insert into public.inventory_movements (
            workspace_id, inventory_item_id, movement_type, quantity, reason, created_by, warehouse_id
          ) values ($1, $2, 'adjustment', $3, 'stock_transfer', $4, $5)
        $m$
        using v_transfer.workspace_id, v_line.inventory_item_id, v_line.quantity,
              (select auth.uid()), v_transfer.from_warehouse_id;
      exception
        when undefined_column then null;
        when others then
          if sqlerrm ilike '%document%' or sqlerrm ilike '%warehouse_id%' then null;
          else raise;
          end if;
      end;
    end if;

    v_lines := v_lines + 1;
    v_total := v_total + v_line.amount;
  end loop;

  update public.stock_transfers set posted_at = now(), total = v_total where id = p_transfer_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('transfer_id', p_transfer_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end $$;

-- ---------------------------------------------------------------------
-- 4. crm_post_write_off — with FIFO batch consume
-- ---------------------------------------------------------------------
create or replace function public.crm_post_write_off(p_write_off_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_write_off public.write_offs%rowtype;
  v_line record;
  v_available numeric;
  v_item_qty numeric;
  v_lines integer := 0;
  v_total numeric(16,2) := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'crm_post_write_off: not authenticated' using errcode = '42501';
  end if;
  if p_write_off_id is null then
    raise exception 'crm_post_write_off: write-off id is required' using errcode = '22023';
  end if;

  select * into v_write_off from public.write_offs where id = p_write_off_id for update;
  if not found or v_write_off.deleted_at is not null then
    raise exception 'crm_post_write_off: write-off not found' using errcode = 'P0002';
  end if;

  if not (public.crm_has_permission(v_write_off.workspace_id, 'inventory.write_offs.create')
       or public.crm_has_permission(v_write_off.workspace_id, 'inventory.write_offs.edit')) then
    raise exception 'crm_post_write_off: permission denied (inventory.write_offs.create or inventory.write_offs.edit required)'
      using errcode = '42501';
  end if;

  if v_write_off.posted_at is not null then
    raise exception 'crm_post_write_off: write-off is already posted' using errcode = '55000';
  end if;

  if v_write_off.warehouse_id is null then
    raise exception 'crm_post_write_off: write-off has no warehouse' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = v_write_off.warehouse_id and w.workspace_id = v_write_off.workspace_id
      and w.deleted_at is null and w.is_active
  ) then
    raise exception 'crm_post_write_off: warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  if not exists (select 1 from public.write_off_lines where write_off_id = p_write_off_id) then
    raise exception 'crm_post_write_off: write-off has no lines' using errcode = '22023';
  end if;

  for v_line in
    select l.id, l.inventory_item_id, l.quantity, i.id as found_item
    from public.write_off_lines l
    left join public.inventory_items i on i.id = l.inventory_item_id and i.workspace_id = v_write_off.workspace_id
    where l.write_off_id = p_write_off_id
  loop
    if v_line.inventory_item_id is null or v_line.found_item is null then
      raise exception 'crm_post_write_off: every line needs an inventory item of this workspace' using errcode = '22023';
    end if;
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'crm_post_write_off: line quantity must be greater than 0' using errcode = '22023';
    end if;
    if v_line.quantity <> round(v_line.quantity, 2) then
      raise exception 'crm_post_write_off: line quantity allows at most 2 decimals' using errcode = '22023';
    end if;
  end loop;

  perform set_config('crm.warehouse_posting', 'on', true);

  for v_line in
    select l.inventory_item_id, sum(l.quantity) as quantity, max(i.name) as item_name,
           sum(round(l.quantity * l.unit_cost, 2)) as amount
    from public.write_off_lines l
    join public.inventory_items i on i.id = l.inventory_item_id
    where l.write_off_id = p_write_off_id
    group by l.inventory_item_id
    order by l.inventory_item_id
  loop
    select ws.quantity into v_available
    from public.warehouse_stock ws
    where ws.warehouse_id = v_write_off.warehouse_id and ws.inventory_item_id = v_line.inventory_item_id
    for update;

    if v_available is null or v_available < v_line.quantity then
      raise exception 'crm_post_write_off: insufficient stock for "%" in warehouse (available %, requested %)',
        v_line.item_name, coalesce(v_available, 0), v_line.quantity using errcode = '23514';
    end if;

    select i.quantity into v_item_qty
    from public.inventory_items i
    where i.id = v_line.inventory_item_id and i.workspace_id = v_write_off.workspace_id
    for update;

    if v_item_qty < v_line.quantity then
      raise exception 'crm_post_write_off: insufficient total stock for "%" (available %, requested %)',
        v_line.item_name, v_item_qty, v_line.quantity using errcode = '23514';
    end if;

    perform * from public.crm_consume_batches_fifo(
      v_write_off.workspace_id, v_write_off.warehouse_id, v_line.inventory_item_id, v_line.quantity
    );

    update public.warehouse_stock
       set quantity = quantity - v_line.quantity, updated_at = now()
     where warehouse_id = v_write_off.warehouse_id and inventory_item_id = v_line.inventory_item_id;

    update public.inventory_items
       set quantity = quantity - v_line.quantity, updated_at = now()
     where id = v_line.inventory_item_id and workspace_id = v_write_off.workspace_id;

    if to_regclass('public.inventory_movements') is not null then
      begin
        execute $m$
          insert into public.inventory_movements (
            workspace_id, inventory_item_id, movement_type, quantity, reason, created_by, warehouse_id
          ) values ($1, $2, 'adjustment', $3, $4, $5, $6)
        $m$
        using v_write_off.workspace_id, v_line.inventory_item_id, v_line.quantity,
              coalesce(nullif(btrim(v_write_off.reason), ''), 'write_off'),
              (select auth.uid()), v_write_off.warehouse_id;
      exception
        when undefined_column then null;
        when others then
          if sqlerrm ilike '%warehouse_id%' then
            execute $m2$
              insert into public.inventory_movements (
                workspace_id, inventory_item_id, movement_type, quantity, reason, created_by
              ) values ($1, $2, 'adjustment', $3, $4, $5)
            $m2$
            using v_write_off.workspace_id, v_line.inventory_item_id, v_line.quantity,
                  coalesce(nullif(btrim(v_write_off.reason), ''), 'write_off'),
                  (select auth.uid());
          else
            raise;
          end if;
      end;
    end if;

    v_lines := v_lines + 1;
    v_total := v_total + v_line.amount;
  end loop;

  update public.write_offs set posted_at = now(), total = v_total where id = p_write_off_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('write_off_id', p_write_off_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end $$;

revoke all on function public.crm_post_stock_transfer(uuid) from public, anon;
revoke all on function public.crm_post_write_off(uuid) from public, anon;
grant execute on function public.crm_post_stock_transfer(uuid) to authenticated;
grant execute on function public.crm_post_write_off(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- NOTE: issue_order_materials_from_warehouse / return_order_materials_to_warehouse
-- batch wiring lives in the companion file
-- 20261101220000_warehouse_order_issue_return_batches.PRODUCTION.sql
-- so each APPLY script stays under a reviewable size and can be re-run independently.
