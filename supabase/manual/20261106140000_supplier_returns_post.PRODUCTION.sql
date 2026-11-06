-- =============================================================================
-- Supplier returns: post RPC (stock goes back to the supplier, not written off)
-- Script: 20261106140000_supplier_returns_post.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: crm_ro_v1 (supplier_returns, supplier_return_lines, stock_batches),
--                20261104080000_warehouse_inventory_ledger_complete (FIFO helpers, guards),
--                20261106130000_goods_receipt_supplier_name
-- =============================================================================
-- Adds:
--   1) supplier_returns.posted_at, supplier_name, reason (nullable).
--   2) Posted-line guard on supplier_return_lines (same guard as write-offs).
--   3) crm_post_supplier_return(p_return_id) -> jsonb
--      - permission: inventory.supplier_returns.create OR .edit
--      - every line must reference a catalog item of the workspace, qty > 0, <= 2 decimals
--      - when goods_receipt_id is set: the receipt must be POSTED, same workspace and
--        warehouse; per item the returned qty must not exceed
--        (received in that receipt) - (already returned by other posted returns of it);
--        stock is taken ONLY from batches of that receipt (stock_batches.goods_receipt_id)
--        at their unit cost
--      - without goods_receipt_id: FIFO from the warehouse (crm_consume_batches_fifo)
--      - decreases warehouse_stock and inventory_items.quantity, writes
--        inventory_movements (movement_type 'adjustment', document_type 'supplier_return',
--        batch_allocations), sets line unit_cost/amount from batch cost, sets total and posted_at
--      - supplier_name defaults to the receipt's supplier_name
--
-- Does NOT: create finance transactions (money back from the supplier is recorded
-- separately in Finance), touch orders, change existing posting RPCs.
-- Idempotent (create or replace / if not exists). Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'supplier_returns','supplier_return_lines','stock_batches','warehouse_stock',
    'inventory_items','inventory_movements','goods_receipts','goods_receipt_lines','warehouses'
  ]) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'supplier_returns_post preflight: missing tables: %', v_missing;
  end if;
  if to_regprocedure('public.crm_consume_batches_fifo(uuid,uuid,uuid,numeric)') is null then
    raise exception 'supplier_returns_post preflight: crm_consume_batches_fifo missing (apply 20261104080000 first)';
  end if;
  if to_regprocedure('public.crm_guard_posted_document_lines()') is null then
    raise exception 'supplier_returns_post preflight: crm_guard_posted_document_lines missing';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    raise exception 'supplier_returns_post preflight: crm_has_permission missing';
  end if;
end;
$preflight$;

alter table public.supplier_returns add column if not exists posted_at timestamptz;
alter table public.supplier_returns add column if not exists supplier_name text;
alter table public.supplier_returns add column if not exists reason text;

create index if not exists supplier_returns_goods_receipt_idx
  on public.supplier_returns (goods_receipt_id) where goods_receipt_id is not null;
create index if not exists supplier_returns_workspace_supplier_name_idx
  on public.supplier_returns (workspace_id, lower(supplier_name)) where supplier_name is not null;

drop trigger if exists crm_guard_posted_supplier_return_lines on public.supplier_return_lines;
create trigger crm_guard_posted_supplier_return_lines
  before insert or update or delete on public.supplier_return_lines
  for each row execute function public.crm_guard_posted_document_lines(
    'supplier_returns', 'supplier_return_id', 'posted_at is not null'
  );

create or replace function public.crm_post_supplier_return(p_return_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ret public.supplier_returns%rowtype;
  v_receipt public.goods_receipts%rowtype;
  v_line record;
  v_batch record;
  v_slice record;
  v_available numeric;
  v_item_qty numeric;
  v_received numeric;
  v_already numeric;
  v_remaining numeric;
  v_take numeric;
  v_alloc jsonb;
  v_first_batch uuid;
  v_cost_sum numeric;
  v_taken numeric;
  v_avg_cost numeric;
  v_rowcount integer;
  v_lines integer := 0;
  v_total numeric(16,2) := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'crm_post_supplier_return: not authenticated' using errcode = '42501';
  end if;
  if p_return_id is null then
    raise exception 'crm_post_supplier_return: return id is required' using errcode = '22023';
  end if;

  select * into v_ret from public.supplier_returns where id = p_return_id for update;
  if not found or v_ret.deleted_at is not null then
    raise exception 'crm_post_supplier_return: return not found' using errcode = 'P0002';
  end if;

  if not (public.crm_has_permission(v_ret.workspace_id, 'inventory.supplier_returns.create')
       or public.crm_has_permission(v_ret.workspace_id, 'inventory.supplier_returns.edit')) then
    raise exception 'crm_post_supplier_return: permission denied' using errcode = '42501';
  end if;

  if v_ret.posted_at is not null then
    raise exception 'crm_post_supplier_return: already posted' using errcode = '55000';
  end if;

  if v_ret.warehouse_id is null then
    raise exception 'crm_post_supplier_return: return has no warehouse' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = v_ret.warehouse_id and w.workspace_id = v_ret.workspace_id
      and w.deleted_at is null and w.is_active
  ) then
    raise exception 'crm_post_supplier_return: warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  if v_ret.goods_receipt_id is not null then
    select * into v_receipt from public.goods_receipts
     where id = v_ret.goods_receipt_id and workspace_id = v_ret.workspace_id
     for share;
    if not found or v_receipt.deleted_at is not null then
      raise exception 'crm_post_supplier_return: goods receipt not found' using errcode = 'P0002';
    end if;
    if v_receipt.status is distinct from 'posted' then
      raise exception 'crm_post_supplier_return: goods receipt is not posted' using errcode = '22023';
    end if;
    if v_receipt.warehouse_id is distinct from v_ret.warehouse_id then
      raise exception 'crm_post_supplier_return: return warehouse must match the receipt warehouse' using errcode = '22023';
    end if;
  end if;

  if not exists (select 1 from public.supplier_return_lines where supplier_return_id = p_return_id) then
    raise exception 'crm_post_supplier_return: return has no lines' using errcode = '22023';
  end if;

  for v_line in
    select l.inventory_item_id, l.quantity, i.id as found_item
    from public.supplier_return_lines l
    left join public.inventory_items i on i.id = l.inventory_item_id and i.workspace_id = v_ret.workspace_id
    where l.supplier_return_id = p_return_id
  loop
    if v_line.inventory_item_id is null or v_line.found_item is null then
      raise exception 'crm_post_supplier_return: every line needs an inventory item of this workspace' using errcode = '22023';
    end if;
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'crm_post_supplier_return: line quantity must be greater than 0' using errcode = '22023';
    end if;
    if v_line.quantity <> round(v_line.quantity, 2) then
      raise exception 'crm_post_supplier_return: line quantity allows at most 2 decimals' using errcode = '22023';
    end if;
  end loop;

  perform set_config('crm.warehouse_posting', 'on', true);

  for v_line in
    select l.inventory_item_id, sum(l.quantity) as quantity, max(i.name) as item_name
    from public.supplier_return_lines l
    join public.inventory_items i on i.id = l.inventory_item_id and i.workspace_id = v_ret.workspace_id
    where l.supplier_return_id = p_return_id
    group by l.inventory_item_id
    order by l.inventory_item_id
  loop
    -- Receipt-bound limit: cannot return more than this receipt delivered minus prior posted returns.
    if v_ret.goods_receipt_id is not null then
      select coalesce(sum(gl.quantity), 0) into v_received
      from public.goods_receipt_lines gl
      where gl.goods_receipt_id = v_ret.goods_receipt_id
        and gl.inventory_item_id = v_line.inventory_item_id;

      select coalesce(sum(rl.quantity), 0) into v_already
      from public.supplier_return_lines rl
      join public.supplier_returns r on r.id = rl.supplier_return_id
      where r.goods_receipt_id = v_ret.goods_receipt_id
        and r.id <> v_ret.id
        and r.posted_at is not null
        and r.deleted_at is null
        and rl.inventory_item_id = v_line.inventory_item_id;

      if v_line.quantity > v_received - v_already + 0.0001 then
        raise exception 'crm_post_supplier_return: "%" — can return at most % from this receipt (received %, already returned %)',
          v_line.item_name, greatest(v_received - v_already, 0), v_received, v_already using errcode = '23514';
      end if;
    end if;

    select ws.quantity into v_available
    from public.warehouse_stock ws
    where ws.warehouse_id = v_ret.warehouse_id
      and ws.workspace_id = v_ret.workspace_id
      and ws.inventory_item_id = v_line.inventory_item_id
    for update;
    if v_available is null or v_available < v_line.quantity then
      raise exception 'crm_post_supplier_return: insufficient stock for "%" in warehouse (available %, requested %)',
        v_line.item_name, coalesce(v_available, 0), v_line.quantity using errcode = '23514';
    end if;

    select i.quantity into v_item_qty
    from public.inventory_items i
    where i.id = v_line.inventory_item_id and i.workspace_id = v_ret.workspace_id
    for update;
    if v_item_qty < v_line.quantity then
      raise exception 'crm_post_supplier_return: insufficient total stock for "%"', v_line.item_name using errcode = '23514';
    end if;

    v_alloc := '[]'::jsonb;
    v_first_batch := null;
    v_cost_sum := 0;
    v_taken := 0;

    if v_ret.goods_receipt_id is not null then
      -- Take only from batches created by this receipt (oldest first).
      v_remaining := v_line.quantity;
      for v_batch in
        select b.id, b.quantity_left, b.unit_cost, b.expires_on, b.supplier_client_id
        from public.stock_batches b
        where b.workspace_id = v_ret.workspace_id
          and b.warehouse_id = v_ret.warehouse_id
          and b.inventory_item_id = v_line.inventory_item_id
          and b.goods_receipt_id = v_ret.goods_receipt_id
          and b.quantity_left > 0
        order by b.received_at asc nulls last, b.created_at asc nulls last, b.id asc
        for update of b
      loop
        exit when v_remaining <= 0;
        v_take := least(v_batch.quantity_left, v_remaining);
        update public.stock_batches
           set quantity_left = quantity_left - v_take
         where id = v_batch.id and quantity_left >= v_take;
        get diagnostics v_rowcount = row_count;
        if v_rowcount <> 1 then
          raise exception 'crm_post_supplier_return: batch changed concurrently for "%"', v_line.item_name using errcode = '40001';
        end if;
        if v_first_batch is null then v_first_batch := v_batch.id; end if;
        v_taken := v_taken + v_take;
        v_cost_sum := v_cost_sum + v_batch.unit_cost * v_take;
        v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
          'batch_id', v_batch.id, 'quantity', v_take, 'unit_cost', v_batch.unit_cost,
          'expires_on', v_batch.expires_on, 'supplier_client_id', v_batch.supplier_client_id
        ));
        v_remaining := v_remaining - v_take;
      end loop;

      if round(v_taken, 3) is distinct from round(v_line.quantity, 3) then
        raise exception 'crm_post_supplier_return: "%" — only % left in stock from this receipt (the rest was already used or issued)',
          v_line.item_name, v_taken using errcode = '23514';
      end if;
    else
      for v_slice in
        select * from public.crm_consume_batches_fifo(
          v_ret.workspace_id, v_ret.warehouse_id, v_line.inventory_item_id, v_line.quantity
        )
      loop
        if v_first_batch is null then v_first_batch := v_slice.batch_id; end if;
        v_taken := v_taken + v_slice.quantity;
        v_cost_sum := v_cost_sum + v_slice.unit_cost * v_slice.quantity;
        v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
          'batch_id', v_slice.batch_id, 'quantity', v_slice.quantity, 'unit_cost', v_slice.unit_cost,
          'expires_on', v_slice.expires_on, 'supplier_client_id', v_slice.supplier_client_id
        ));
      end loop;
      if round(coalesce(v_taken, 0), 3) is distinct from round(v_line.quantity, 3)
         or jsonb_array_length(v_alloc) = 0 then
        raise exception 'crm_post_supplier_return: FIFO batch coverage (%) does not equal requested quantity (%) for "%"',
          coalesce(v_taken, 0), v_line.quantity, v_line.item_name using errcode = 'P0001';
      end if;
    end if;

    update public.warehouse_stock
       set quantity = quantity - v_line.quantity, updated_at = now()
     where warehouse_id = v_ret.warehouse_id
       and workspace_id = v_ret.workspace_id
       and inventory_item_id = v_line.inventory_item_id
       and quantity >= v_line.quantity;
    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'crm_post_supplier_return: insufficient stock for "%" in warehouse', v_line.item_name using errcode = '23514';
    end if;

    update public.inventory_items
       set quantity = quantity - v_line.quantity, updated_at = now()
     where id = v_line.inventory_item_id and workspace_id = v_ret.workspace_id
       and quantity >= v_line.quantity;
    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'crm_post_supplier_return: insufficient total stock for "%"', v_line.item_name using errcode = '23514';
    end if;

    v_avg_cost := round(v_cost_sum / v_line.quantity, 4);

    -- Line cost = actual batch cost (lines are editable here: posting flag is on).
    update public.supplier_return_lines
       set unit_cost = v_avg_cost,
           amount = round(quantity * v_avg_cost, 2)
     where supplier_return_id = p_return_id
       and inventory_item_id = v_line.inventory_item_id;

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, movement_type, quantity, reason, created_by,
      warehouse_id, batch_id, document_type, document_id, unit_cost,
      batch_allocations, idempotency_key
    ) values (
      v_ret.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
      coalesce(nullif(btrim(v_ret.reason), ''), 'supplier_return'), (select auth.uid()),
      v_ret.warehouse_id, v_first_batch, 'supplier_return', v_ret.id, v_avg_cost,
      v_alloc,
      'supplier_return:' || v_ret.id::text || ':' || v_line.inventory_item_id::text
    );

    v_lines := v_lines + 1;
    v_total := v_total + round(v_line.quantity * v_avg_cost, 2);
  end loop;

  update public.supplier_returns
     set posted_at = now(),
         total = v_total,
         supplier_name = coalesce(nullif(btrim(supplier_name), ''), v_receipt.supplier_name),
         updated_at = now()
   where id = p_return_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('supplier_return_id', p_return_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end;
$$;

revoke all on function public.crm_post_supplier_return(uuid) from public, anon;
grant execute on function public.crm_post_supplier_return(uuid) to authenticated;

comment on function public.crm_post_supplier_return(uuid) is
  'managed-object: core-app/crm_post_supplier_return@v1 — posts a supplier return: receipt-bound batch consumption (or FIFO), stock down, ledger movement document_type=supplier_return.';

do $postflight$
begin
  if to_regprocedure('public.crm_post_supplier_return(uuid)') is null then
    raise exception 'supplier_returns_post postflight: RPC missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_guard_posted_supplier_return_lines'
                 and tgrelid = 'public.supplier_return_lines'::regclass and not tgisinternal) then
    raise exception 'supplier_returns_post postflight: line guard missing';
  end if;
end;
$postflight$;

commit;

-- Verify after a test return:
-- select * from public.inventory_movements where document_type = 'supplier_return' order by created_at desc limit 5;
