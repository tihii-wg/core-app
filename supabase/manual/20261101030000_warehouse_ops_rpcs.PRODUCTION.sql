-- =====================================================================
-- Core App: warehouse operations posting RPCs
--
--   crm_post_goods_receipt(p_receipt_id uuid)
--   crm_post_stock_transfer(p_transfer_id uuid)
--   crm_post_write_off(p_write_off_id uuid)
--
-- WHY: `warehouse_stock` / `stock_batches` are read-only for the browser
-- (crm_ro_v1 RLS: view '*', write '-'). Documents (goods_receipts,
-- stock_transfers, write_offs + lines) are created from the browser as drafts;
-- everything that changes stock goes through these SECURITY DEFINER functions.
--
-- REQUIRES: crm_ro_v1.PRODUCTION.sql (step 2.1 of MIGRATION_CUTOVER.md).
-- Apply by hand in the Supabase SQL Editor: TEST first, then PROD.
-- IDEMPOTENT: safe to re-run (create or replace / add column if not exists /
-- drop trigger if exists). One transaction; nothing is changed on failure.
-- NOT applied automatically by the app or CI.
--
-- Posting rules
--   * receipt   : status draft -> posted. warehouse_stock += qty, inventory_items.quantity += qty,
--                 one stock_batches row per line. Permission inventory.receipts.create|edit.
--   * transfer  : new column posted_at (null = draft). warehouse_stock -= qty (from), += qty (to).
--                 inventory_items.quantity is NOT changed (company-wide total is unchanged).
--                 Permission inventory.transfers.create|edit.
--   * write-off : new column posted_at (null = draft). warehouse_stock -= qty and
--                 inventory_items.quantity -= qty. Permission inventory.write_offs.create|edit.
--   * Quantities may have at most 2 decimals (inventory_items.quantity is numeric(12,2)).
--   * Posting is single-shot: the document row is locked and re-posting raises an error.
--   * Guard triggers stop the browser from flipping status / posted_at or editing lines of a
--     posted document directly (service_role / SQL editor, where auth.uid() is null, is not blocked).
-- =====================================================================

begin;

do $preflight$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'inventory_items', 'warehouses', 'warehouse_stock', 'stock_batches',
    'goods_receipts', 'goods_receipt_lines',
    'stock_transfers', 'stock_transfer_lines',
    'write_offs', 'write_off_lines'
  ]) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'Preflight failed: missing tables (%). Apply crm_ro_v1.PRODUCTION.sql first.', v_missing;
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    raise exception 'Preflight failed: public.crm_has_permission(uuid, text) is missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
end
$preflight$;

-- Transfers and write-offs have no status column: posted_at marks a posted document.
alter table public.stock_transfers add column if not exists posted_at timestamptz;
alter table public.write_offs add column if not exists posted_at timestamptz;

-- ---------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------

-- Receipt status may only become 'posted' (or leave it) inside crm_post_goods_receipt.
create or replace function public.crm_guard_receipt_status()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(current_setting('crm.warehouse_posting', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'posted' then
      raise exception 'Goods receipts must be created as draft and posted with crm_post_goods_receipt()' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    raise exception 'Goods receipt status can only change through crm_post_goods_receipt()' using errcode = '42501';
  end if;
  return new;
end $$;

-- posted_at may only be set inside the posting RPCs.
create or replace function public.crm_guard_posted_at()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(current_setting('crm.warehouse_posting', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.posted_at is not null then
      raise exception 'posted_at can only be set by the posting RPCs' using errcode = '42501';
    end if;
  elsif new.posted_at is distinct from old.posted_at then
    raise exception 'posted_at can only be changed by the posting RPCs' using errcode = '42501';
  end if;
  return new;
end $$;

-- Lines of a posted document are frozen.
-- Trigger args: parent table, parent FK column, SQL predicate on the parent that means "posted".
create or replace function public.crm_guard_posted_document_lines()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_parent_id uuid;
  v_posted boolean;
begin
  if (select auth.uid()) is null or coalesce(current_setting('crm.warehouse_posting', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_parent_id := (v_row ->> tg_argv[1])::uuid;
  execute format('select coalesce((%s), false) from public.%I where id = $1', tg_argv[2], tg_argv[0])
    into v_posted using v_parent_id;
  if coalesce(v_posted, false) then
    raise exception 'Lines of a posted document cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

revoke all on function public.crm_guard_receipt_status() from public, anon, authenticated;
revoke all on function public.crm_guard_posted_at() from public, anon, authenticated;
revoke all on function public.crm_guard_posted_document_lines() from public, anon, authenticated;

drop trigger if exists crm_guard_receipt_status on public.goods_receipts;
create trigger crm_guard_receipt_status
  before insert or update on public.goods_receipts
  for each row execute function public.crm_guard_receipt_status();

drop trigger if exists crm_guard_posted_at on public.stock_transfers;
create trigger crm_guard_posted_at
  before insert or update on public.stock_transfers
  for each row execute function public.crm_guard_posted_at();

drop trigger if exists crm_guard_posted_at on public.write_offs;
create trigger crm_guard_posted_at
  before insert or update on public.write_offs
  for each row execute function public.crm_guard_posted_at();

drop trigger if exists crm_guard_posted_lines on public.goods_receipt_lines;
create trigger crm_guard_posted_lines
  before insert or update or delete on public.goods_receipt_lines
  for each row execute function public.crm_guard_posted_document_lines('goods_receipts', 'goods_receipt_id', 'status = ''posted''');

drop trigger if exists crm_guard_posted_lines on public.stock_transfer_lines;
create trigger crm_guard_posted_lines
  before insert or update or delete on public.stock_transfer_lines
  for each row execute function public.crm_guard_posted_document_lines('stock_transfers', 'stock_transfer_id', 'posted_at is not null');

drop trigger if exists crm_guard_posted_lines on public.write_off_lines;
create trigger crm_guard_posted_lines
  before insert or update or delete on public.write_off_lines
  for each row execute function public.crm_guard_posted_document_lines('write_offs', 'write_off_id', 'posted_at is not null');

-- ---------------------------------------------------------------------
-- 1. crm_post_goods_receipt
-- ---------------------------------------------------------------------
create or replace function public.crm_post_goods_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_receipt public.goods_receipts%rowtype;
  v_line record;
  v_wh_ok boolean;
  v_lines integer := 0;
  v_total numeric(16,2) := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'crm_post_goods_receipt: not authenticated' using errcode = '42501';
  end if;
  if p_receipt_id is null then
    raise exception 'crm_post_goods_receipt: receipt id is required' using errcode = '22023';
  end if;

  select * into v_receipt from public.goods_receipts where id = p_receipt_id for update;
  if not found or v_receipt.deleted_at is not null then
    raise exception 'crm_post_goods_receipt: receipt not found' using errcode = 'P0002';
  end if;

  if not (public.crm_has_permission(v_receipt.workspace_id, 'inventory.receipts.create')
       or public.crm_has_permission(v_receipt.workspace_id, 'inventory.receipts.edit')) then
    raise exception 'crm_post_goods_receipt: permission denied (inventory.receipts.create or inventory.receipts.edit required)'
      using errcode = '42501';
  end if;

  if v_receipt.status <> 'draft' then
    raise exception 'crm_post_goods_receipt: receipt is already % (only draft receipts can be posted)', v_receipt.status
      using errcode = '55000';
  end if;

  if v_receipt.warehouse_id is null then
    raise exception 'crm_post_goods_receipt: receipt has no warehouse' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.warehouses w
    where w.id = v_receipt.warehouse_id and w.workspace_id = v_receipt.workspace_id
      and w.deleted_at is null and w.is_active
  ) into v_wh_ok;
  if not v_wh_ok then
    raise exception 'crm_post_goods_receipt: warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  if not exists (select 1 from public.goods_receipt_lines where goods_receipt_id = p_receipt_id) then
    raise exception 'crm_post_goods_receipt: receipt has no lines' using errcode = '22023';
  end if;

  -- Validate every line before touching stock.
  for v_line in
    select l.id, l.inventory_item_id, l.quantity, l.unit_cost, i.id as found_item
    from public.goods_receipt_lines l
    left join public.inventory_items i on i.id = l.inventory_item_id and i.workspace_id = v_receipt.workspace_id
    where l.goods_receipt_id = p_receipt_id
  loop
    if v_line.inventory_item_id is null or v_line.found_item is null then
      raise exception 'crm_post_goods_receipt: every line needs an inventory item of this workspace' using errcode = '22023';
    end if;
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'crm_post_goods_receipt: line quantity must be greater than 0' using errcode = '22023';
    end if;
    if v_line.quantity <> round(v_line.quantity, 2) then
      raise exception 'crm_post_goods_receipt: line quantity allows at most 2 decimals' using errcode = '22023';
    end if;
    if v_line.unit_cost is null or v_line.unit_cost < 0 then
      raise exception 'crm_post_goods_receipt: line unit cost cannot be negative' using errcode = '22023';
    end if;
  end loop;

  perform set_config('crm.warehouse_posting', 'on', true);

  -- Deterministic order avoids deadlocks between concurrent postings.
  for v_line in
    select l.inventory_item_id, l.quantity, l.unit_cost, l.expires_on
    from public.goods_receipt_lines l
    where l.goods_receipt_id = p_receipt_id
    order by l.inventory_item_id, l.position, l.id
  loop
    insert into public.warehouse_stock (workspace_id, warehouse_id, inventory_item_id, quantity)
    values (v_receipt.workspace_id, v_receipt.warehouse_id, v_line.inventory_item_id, v_line.quantity)
    on conflict (warehouse_id, inventory_item_id)
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now();

    update public.inventory_items
       set quantity = quantity + v_line.quantity, updated_at = now()
     where id = v_line.inventory_item_id and workspace_id = v_receipt.workspace_id;

    insert into public.stock_batches (
      workspace_id, inventory_item_id, warehouse_id, goods_receipt_id, supplier_client_id,
      unit_cost, quantity_received, quantity_left, expires_on, received_at
    ) values (
      v_receipt.workspace_id, v_line.inventory_item_id, v_receipt.warehouse_id, v_receipt.id,
      v_receipt.supplier_client_id, v_line.unit_cost, v_line.quantity, v_line.quantity,
      v_line.expires_on, v_receipt.received_at
    );

    v_lines := v_lines + 1;
    v_total := v_total + round(v_line.quantity * v_line.unit_cost, 2);
  end loop;

  update public.goods_receipts set status = 'posted', total = v_total where id = p_receipt_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('receipt_id', p_receipt_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end $$;

-- ---------------------------------------------------------------------
-- 2. crm_post_stock_transfer
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

  -- Lines of the same item are summed so the stock check sees the full amount.
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

    update public.warehouse_stock
       set quantity = quantity - v_line.quantity, updated_at = now()
     where warehouse_id = v_transfer.from_warehouse_id and inventory_item_id = v_line.inventory_item_id;

    insert into public.warehouse_stock (workspace_id, warehouse_id, inventory_item_id, quantity)
    values (v_transfer.workspace_id, v_transfer.to_warehouse_id, v_line.inventory_item_id, v_line.quantity)
    on conflict (warehouse_id, inventory_item_id)
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now();

    -- inventory_items.quantity is the workspace-wide total: a transfer between warehouses leaves it unchanged.
    v_lines := v_lines + 1;
    v_total := v_total + v_line.amount;
  end loop;

  update public.stock_transfers set posted_at = now(), total = v_total where id = p_transfer_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('transfer_id', p_transfer_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end $$;

-- ---------------------------------------------------------------------
-- 3. crm_post_write_off
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

    update public.warehouse_stock
       set quantity = quantity - v_line.quantity, updated_at = now()
     where warehouse_id = v_write_off.warehouse_id and inventory_item_id = v_line.inventory_item_id;

    update public.inventory_items
       set quantity = quantity - v_line.quantity, updated_at = now()
     where id = v_line.inventory_item_id and workspace_id = v_write_off.workspace_id;

    v_lines := v_lines + 1;
    v_total := v_total + v_line.amount;
  end loop;

  update public.write_offs set posted_at = now(), total = v_total where id = p_write_off_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('write_off_id', p_write_off_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end $$;

revoke all on function public.crm_post_goods_receipt(uuid) from public, anon;
revoke all on function public.crm_post_stock_transfer(uuid) from public, anon;
revoke all on function public.crm_post_write_off(uuid) from public, anon;
grant execute on function public.crm_post_goods_receipt(uuid) to authenticated;
grant execute on function public.crm_post_stock_transfer(uuid) to authenticated;
grant execute on function public.crm_post_write_off(uuid) to authenticated;

-- PostgREST picks up new functions after a schema reload.
notify pgrst, 'reload schema';

commit;
