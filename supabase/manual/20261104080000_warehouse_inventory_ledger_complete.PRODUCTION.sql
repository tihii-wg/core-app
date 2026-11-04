-- =====================================================================
-- Core App — Warehouse inventory ledger COMPLETE (MAIN APPLY)
-- File: 20261104080000_warehouse_inventory_ledger_complete.PRODUCTION.sql
--
-- MANUAL APPLY ONLY (Supabase SQL Editor on MAIN: pundggjzzaqzbvykbxvo).
-- Do NOT run from the app, CI, or against the TEST project.
-- One transaction; any exception rolls everything back.
--
-- DOES:
--   * Preflight (tables, helpers, precision drift, idempotency index, sync hash)
--   * Schema: batch_allocations, movement cols, qty type fix, non-neg checks
--   * Soft-delete gate on warehouses; material-create requires active warehouse
--   * Replace crm_post_goods_receipt / crm_post_stock_transfer / crm_post_write_off
--     with ledger + FIFO (no swallowed movement errors)
--   * Replace issue/return warehouse RPCs with batch_allocations provenance
--   * Revoke authenticated EXECUTE on legacy issue_order_materials / return_order_materials
--   * Implement add_and_issue_order_catalog_material +
--     set_order_catalog_material_quantity_with_issue
--
-- DOES NOT:
--   * CREATE OR REPLACE sync_order_materials (hard rule; hash verified)
--   * Fabricate historical batch_allocations backfill
--   * Touch TEST project / remote apply from this repo script
-- =====================================================================

begin;

-- Snapshot sync_order_materials definition hash (must be unchanged at post-check).
do $sync_snap$
declare
  v_oid oid;
  v_hash text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sync_order_materials'
    and pg_get_function_identity_arguments(p.oid) = 'uuid, jsonb';
  if v_oid is null then
    raise exception 'Preflight: sync_order_materials(uuid, jsonb) missing — refusing APPLY';
  end if;
  v_hash := md5(pg_get_functiondef(v_oid));
  perform set_config('crm.apply_sync_order_materials_md5', v_hash, true);
end
$sync_snap$;

-- ---------------------------------------------------------------------
-- 1. Preflight
-- ---------------------------------------------------------------------
do $preflight$
declare
  v_missing text;
  v_dtype text;
  v_drift bigint;
  v_has_idx boolean;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'inventory_items','warehouses','warehouse_stock','stock_batches','inventory_movements',
    'order_materials','orders','goods_receipts','goods_receipt_lines',
    'stock_transfers','stock_transfer_lines','write_offs','write_off_lines'
  ]) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'Preflight: missing tables: %', v_missing;
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight: is_workspace_member(uuid) missing';
  end if;
  if to_regprocedure('public.workspace_member_role(uuid)') is null then
    raise exception 'Preflight: workspace_member_role(uuid) missing';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    raise exception 'Preflight: crm_has_permission(uuid,text) missing';
  end if;

  if to_regprocedure('public.crm_post_goods_receipt(uuid)') is null
     or to_regprocedure('public.crm_post_stock_transfer(uuid)') is null
     or to_regprocedure('public.crm_post_write_off(uuid)') is null then
    raise exception 'Preflight: posting RPCs missing (crm_post_goods_receipt/transfer/write_off)';
  end if;
  if to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null then
    raise exception 'Preflight: issue_order_materials_from_warehouse missing';
  end if;
  if to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)') is null then
    raise exception 'Preflight: return_order_materials_to_warehouse missing';
  end if;

  -- Key columns
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='warehouse_stock' and column_name='quantity'
  ) then
    raise exception 'Preflight: warehouse_stock.quantity missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_items' and column_name='quantity'
  ) then
    raise exception 'Preflight: inventory_items.quantity missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_movements' and column_name='idempotency_key'
  ) then
    raise exception 'Preflight: inventory_movements.idempotency_key missing';
  end if;

  -- Idempotency unique partial index
  select exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%inventory_movements%'
      and pg_get_indexdef(i.indexrelid) ilike '%workspace_id%'
      and pg_get_indexdef(i.indexrelid) ilike '%idempotency_key%'
      and pg_get_indexdef(i.indexrelid) ilike '%inventory_item_id%'
      and pg_get_indexdef(i.indexrelid) ilike '%idempotency_key IS NOT NULL%'
  ) into v_has_idx;
  if not v_has_idx then
    raise exception
      'Preflight: required unique partial index on inventory_movements (workspace_id, idempotency_key, inventory_item_id) WHERE idempotency_key IS NOT NULL was not found';
  end if;

  -- inventory_movements.quantity type
  select format_type(a.atttypid, a.atttypmod) into v_dtype
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'inventory_movements'
    and a.attname = 'quantity' and a.attnum > 0 and not a.attisdropped;
  if v_dtype is null then
    raise exception 'Preflight: inventory_movements.quantity column missing';
  end if;
  if v_dtype not in ('integer', 'int4', 'numeric(12,2)', 'numeric')
     and v_dtype not like 'numeric(%' then
    raise exception 'Preflight: unexpected inventory_movements.quantity type: %', v_dtype;
  end if;
  perform set_config('crm.apply_mov_qty_dtype', v_dtype, true);

  -- 3-decimal drift abort (warehouse_stock / document lines / batches)
  select count(*) into v_drift from public.warehouse_stock
  where quantity is not null and quantity <> round(quantity, 2);
  if v_drift > 0 then
    raise exception 'Preflight: warehouse_stock has % row(s) with >2 decimal places', v_drift;
  end if;

  select count(*) into v_drift from public.inventory_items
  where quantity is not null and quantity <> round(quantity, 2);
  if v_drift > 0 then
    raise exception 'Preflight: inventory_items has % row(s) with >2 decimal places', v_drift;
  end if;

  select count(*) into v_drift from public.goods_receipt_lines
  where quantity is not null and quantity <> round(quantity, 2);
  if v_drift > 0 then
    raise exception 'Preflight: goods_receipt_lines has % row(s) with >2 decimal places', v_drift;
  end if;

  select count(*) into v_drift from public.stock_transfer_lines
  where quantity is not null and quantity <> round(quantity, 2);
  if v_drift > 0 then
    raise exception 'Preflight: stock_transfer_lines has % row(s) with >2 decimal places', v_drift;
  end if;

  select count(*) into v_drift from public.write_off_lines
  where quantity is not null and quantity <> round(quantity, 2);
  if v_drift > 0 then
    raise exception 'Preflight: write_off_lines has % row(s) with >2 decimal places', v_drift;
  end if;

  select count(*) into v_drift from public.stock_batches
  where (quantity_received is not null and quantity_received <> round(quantity_received, 2))
     or (quantity_left is not null and quantity_left <> round(quantity_left, 2));
  if v_drift > 0 then
    raise exception 'Preflight: stock_batches has % row(s) with >2 decimal places', v_drift;
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- 2. Schema adds / precision / constraints
-- ---------------------------------------------------------------------
do $mov_qty$
declare
  v_dtype text := current_setting('crm.apply_mov_qty_dtype', true);
begin
  if v_dtype in ('integer', 'int4') then
    alter table public.inventory_movements
      alter column quantity type numeric(12,2) using quantity::numeric(12,2);
  elsif v_dtype = 'numeric(12,2)' or v_dtype like 'numeric(%' then
    null;
  else
    raise exception 'Schema: refusing to convert inventory_movements.quantity from %', v_dtype;
  end if;
end
$mov_qty$;

alter table public.inventory_movements
  add column if not exists warehouse_id uuid;
alter table public.inventory_movements
  add column if not exists batch_id uuid;
alter table public.inventory_movements
  add column if not exists document_type text;
alter table public.inventory_movements
  add column if not exists document_id uuid;
alter table public.inventory_movements
  add column if not exists unit_cost numeric(14,4);
alter table public.inventory_movements
  add column if not exists batch_allocations jsonb;

comment on column public.inventory_movements.batch_allocations is
  'FIFO slices: [{"batch_id":uuid,"quantity":numeric,"unit_cost":numeric,"expires_on":date|null,"supplier_client_id":uuid|null}]. Nullable; not backfilled historically.';

alter table public.order_materials
  add column if not exists warehouse_id uuid;

alter table public.stock_transfers
  add column if not exists posted_at timestamptz;
alter table public.write_offs
  add column if not exists posted_at timestamptz;

do $nn$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'warehouse_stock_quantity_nonnegative'
  ) then
    alter table public.warehouse_stock
      add constraint warehouse_stock_quantity_nonnegative check (quantity >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_items_quantity_nonnegative'
  ) then
    alter table public.inventory_items
      add constraint inventory_items_quantity_nonnegative check (quantity >= 0);
  end if;
end
$nn$;

create index if not exists inventory_movements_document_idx
  on public.inventory_movements (document_type, document_id)
  where document_type is not null and document_id is not null;
-- ---------------------------------------------------------------------
-- 3. FIFO helpers (create-or-replace)
-- ---------------------------------------------------------------------
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

-- Peel return slices from prior issue movements (prior returns FIFO from front; new return LIFO from end).
create or replace function public.crm_peel_return_batch_slices(
  p_workspace_id uuid,
  p_order_material_id uuid,
  p_warehouse_id uuid,
  p_return_qty numeric
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_flat jsonb := '[]'::jsonb;
  v_avail jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_returns_done numeric := 0;
  v_qty numeric;
  v_take numeric;
  v_remaining numeric;
  v_elem jsonb;
  v_mov record;
begin
  if p_return_qty is null or p_return_qty <= 0 then
    raise exception 'crm_peel_return_batch_slices: quantity must be > 0' using errcode = '22023';
  end if;

  for v_mov in
    select m.id, m.created_at, m.quantity, m.batch_id, m.batch_allocations
    from public.inventory_movements m
    where m.workspace_id = p_workspace_id
      and m.order_material_id = p_order_material_id
      and m.movement_type = 'issue'
      and m.warehouse_id is not distinct from p_warehouse_id
    order by m.created_at asc, m.id asc
  loop
    if v_mov.batch_allocations is not null
       and jsonb_typeof(v_mov.batch_allocations) = 'array'
       and jsonb_array_length(v_mov.batch_allocations) > 0 then
      for v_elem in select value from jsonb_array_elements(v_mov.batch_allocations)
      loop
        v_flat := v_flat || jsonb_build_array(v_elem);
      end loop;
    elsif v_mov.batch_id is not null then
      v_flat := v_flat || jsonb_build_array(jsonb_build_object(
        'batch_id', v_mov.batch_id,
        'quantity', v_mov.quantity,
        'unit_cost', 0,
        'expires_on', null,
        'supplier_client_id', null
      ));
    end if;
  end loop;

  select coalesce(sum(m.quantity), 0) into v_returns_done
  from public.inventory_movements m
  where m.workspace_id = p_workspace_id
    and m.order_material_id = p_order_material_id
    and m.movement_type = 'return'
    and m.warehouse_id is not distinct from p_warehouse_id;

  v_remaining := v_returns_done;
  for v_elem in select value from jsonb_array_elements(v_flat)
  loop
    v_qty := coalesce((v_elem ->> 'quantity')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;
    if v_remaining >= v_qty then
      v_remaining := v_remaining - v_qty;
    elsif v_remaining > 0 then
      v_avail := v_avail || jsonb_build_array(
        v_elem || jsonb_build_object('quantity', v_qty - v_remaining)
      );
      v_remaining := 0;
    else
      v_avail := v_avail || jsonb_build_array(v_elem);
    end if;
  end loop;

  if jsonb_array_length(v_avail) = 0 then
    return '[]'::jsonb;
  end if;

  v_remaining := p_return_qty;
  for v_elem in
    select value
    from jsonb_array_elements(v_avail) with ordinality as t(value, ord)
    order by ord desc
  loop
    exit when v_remaining <= 0;
    v_qty := coalesce((v_elem ->> 'quantity')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;
    v_take := least(v_qty, v_remaining);
    v_out := jsonb_build_array(v_elem || jsonb_build_object('quantity', v_take)) || v_out;
    v_remaining := v_remaining - v_take;
  end loop;

  return v_out;
end;
$fn$;

revoke all on function public.crm_peel_return_batch_slices(uuid, uuid, uuid, numeric)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Warehouse lifecycle — block hard delete
-- ---------------------------------------------------------------------
create or replace function public.crm_prevent_hard_delete_warehouse()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  raise exception
    'Hard-delete of warehouses is blocked to protect warehouse_stock. Soft-delete with is_active=false and deleted_at=now().'
    using errcode = '42501';
end;
$$;

revoke all on function public.crm_prevent_hard_delete_warehouse() from public, anon, authenticated;
drop trigger if exists crm_prevent_hard_delete_warehouse on public.warehouses;
create trigger crm_prevent_hard_delete_warehouse
  before delete on public.warehouses
  for each row execute function public.crm_prevent_hard_delete_warehouse();

-- ---------------------------------------------------------------------
-- 5. Material create gate — require active warehouse; force qty 0
-- ---------------------------------------------------------------------
create or replace function public.crm_inventory_item_create_warehouse_gate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.workspace_id is null then
    raise exception 'inventory_items insert requires workspace_id' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.workspace_id = new.workspace_id
      and w.deleted_at is null
      and w.is_active
  ) then
    raise exception
      'Cannot create inventory items until the workspace has at least one active warehouse'
      using errcode = 'P0001';
  end if;
  new.quantity := 0;
  return new;
end;
$$;

revoke all on function public.crm_inventory_item_create_warehouse_gate() from public, anon, authenticated;
drop trigger if exists crm_inventory_item_create_warehouse_gate on public.inventory_items;
create trigger crm_inventory_item_create_warehouse_gate
  before insert on public.inventory_items
  for each row execute function public.crm_inventory_item_create_warehouse_gate();

-- ---------------------------------------------------------------------
-- 6. Posted-document guards (refresh)
-- ---------------------------------------------------------------------
create or replace function public.crm_guard_posted_document_lines()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parent_new uuid;
  v_parent_old uuid;
  v_posted boolean;
begin
  if (select auth.uid()) is null or coalesce(current_setting('crm.warehouse_posting', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_parent_old := (to_jsonb(old) ->> tg_argv[1])::uuid;
    execute format('select coalesce((%s), false) from public.%I where id = $1', tg_argv[2], tg_argv[0])
      into v_posted using v_parent_old;
    if coalesce(v_posted, false) then
      raise exception 'Lines of a posted document cannot be changed' using errcode = '42501';
    end if;
    return old;
  end if;

  v_parent_new := (to_jsonb(new) ->> tg_argv[1])::uuid;
  execute format('select coalesce((%s), false) from public.%I where id = $1', tg_argv[2], tg_argv[0])
    into v_posted using v_parent_new;
  if coalesce(v_posted, false) then
    raise exception 'Lines of a posted document cannot be changed' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    v_parent_old := (to_jsonb(old) ->> tg_argv[1])::uuid;
    if v_parent_old is distinct from v_parent_new then
      execute format('select coalesce((%s), false) from public.%I where id = $1', tg_argv[2], tg_argv[0])
        into v_posted using v_parent_old;
      if coalesce(v_posted, false) then
        raise exception 'Lines of a posted document cannot be moved' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.crm_guard_receipt_header_immutable()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(current_setting('crm.warehouse_posting', true), '') = 'on' then
    return new;
  end if;
  if old.status is distinct from 'posted' then
    return new;
  end if;
  if new.workspace_id is distinct from old.workspace_id
     or new.warehouse_id is distinct from old.warehouse_id
     or new.supplier_client_id is distinct from old.supplier_client_id
     or new.received_at is distinct from old.received_at
     or new.total is distinct from old.total
     or new.status is distinct from old.status
     or (to_jsonb(new) ? 'finance_transaction_id' and (to_jsonb(new)->>'finance_transaction_id') is distinct from (to_jsonb(old)->>'finance_transaction_id'))
     or (to_jsonb(new) ? 'paid_from_account_id' and (to_jsonb(new)->>'paid_from_account_id') is distinct from (to_jsonb(old)->>'paid_from_account_id'))
  then
    raise exception 'Posted goods receipt header fields are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_guard_posted_document_lines() from public, anon, authenticated;
revoke all on function public.crm_guard_receipt_header_immutable() from public, anon, authenticated;

drop trigger if exists crm_guard_posted_lines on public.goods_receipt_lines;
create trigger crm_guard_posted_lines
  before insert or update or delete on public.goods_receipt_lines
  for each row execute function public.crm_guard_posted_document_lines(
    'goods_receipts', 'goods_receipt_id', 'status = ''posted'''
  );

drop trigger if exists crm_guard_receipt_header_immutable on public.goods_receipts;
create trigger crm_guard_receipt_header_immutable
  before update on public.goods_receipts
  for each row execute function public.crm_guard_receipt_header_immutable();

drop trigger if exists crm_guard_posted_transfer_lines on public.stock_transfer_lines;
create trigger crm_guard_posted_transfer_lines
  before insert or update or delete on public.stock_transfer_lines
  for each row execute function public.crm_guard_posted_document_lines(
    'stock_transfers', 'stock_transfer_id', 'posted_at is not null'
  );

drop trigger if exists crm_guard_posted_write_off_lines on public.write_off_lines;
create trigger crm_guard_posted_write_off_lines
  before insert or update or delete on public.write_off_lines
  for each row execute function public.crm_guard_posted_document_lines(
    'write_offs', 'write_off_id', 'posted_at is not null'
  );
-- ---------------------------------------------------------------------
-- 7. Replace posting RPCs (ledger + FIFO; no swallowed errors)
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
  v_batch_id uuid;
  v_alloc jsonb;
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
    raise exception 'crm_post_goods_receipt: permission denied' using errcode = '42501';
  end if;
  if v_receipt.status <> 'draft' then
    raise exception 'crm_post_goods_receipt: receipt is already %', v_receipt.status using errcode = '55000';
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

  perform 1 from public.goods_receipt_lines
  where goods_receipt_id = p_receipt_id
  order by inventory_item_id nulls last, position, id
  for update;

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
    ) returning id into v_batch_id;

    v_alloc := jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch_id,
      'quantity', v_line.quantity,
      'unit_cost', v_line.unit_cost,
      'expires_on', v_line.expires_on,
      'supplier_client_id', v_receipt.supplier_client_id
    ));

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, movement_type, quantity, reason, created_by,
      warehouse_id, batch_id, document_type, document_id, unit_cost,
      batch_allocations, idempotency_key
    ) values (
      v_receipt.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
      'goods_receipt', (select auth.uid()),
      v_receipt.warehouse_id, v_batch_id, 'goods_receipt', v_receipt.id, v_line.unit_cost,
      v_alloc,
      'goods_receipt:' || v_receipt.id::text || ':' || v_line.inventory_item_id::text
    );

    v_lines := v_lines + 1;
    v_total := v_total + round(v_line.quantity * v_line.unit_cost, 2);
  end loop;

  update public.goods_receipts
     set status = 'posted', total = v_total, updated_at = now()
   where id = p_receipt_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('receipt_id', p_receipt_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end;
$$;

revoke all on function public.crm_post_goods_receipt(uuid) from public, anon;
grant execute on function public.crm_post_goods_receipt(uuid) to authenticated;

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
  v_src_alloc jsonb;
  v_dst_alloc jsonb;
  v_dst_batch uuid;
  v_first_src uuid;
  v_first_dst uuid;
  v_avg_cost numeric;
  v_rowcount integer;
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

    v_src_alloc := '[]'::jsonb;
    v_dst_alloc := '[]'::jsonb;
    v_first_src := null;
    v_first_dst := null;

    for v_slice in
      select * from public.crm_consume_batches_fifo(
        v_transfer.workspace_id, v_transfer.from_warehouse_id, v_line.inventory_item_id, v_line.quantity
      )
    loop
      if v_first_src is null then
        v_first_src := v_slice.batch_id;
      end if;
      v_src_alloc := v_src_alloc || jsonb_build_array(jsonb_build_object(
        'batch_id', v_slice.batch_id,
        'quantity', v_slice.quantity,
        'unit_cost', v_slice.unit_cost,
        'expires_on', v_slice.expires_on,
        'supplier_client_id', v_slice.supplier_client_id
      ));

      v_dst_batch := public.crm_restore_or_create_batch(
        v_transfer.workspace_id,
        v_transfer.to_warehouse_id,
        v_line.inventory_item_id,
        v_slice.quantity,
        null,
        v_slice.unit_cost,
        v_slice.expires_on,
        v_slice.supplier_client_id,
        null
      );
      if v_first_dst is null then
        v_first_dst := v_dst_batch;
      end if;
      v_dst_alloc := v_dst_alloc || jsonb_build_array(jsonb_build_object(
        'batch_id', v_dst_batch,
        'quantity', v_slice.quantity,
        'unit_cost', v_slice.unit_cost,
        'expires_on', v_slice.expires_on,
        'supplier_client_id', v_slice.supplier_client_id
      ));
    end loop;

    update public.warehouse_stock
       set quantity = quantity - v_line.quantity, updated_at = now()
     where warehouse_id = v_transfer.from_warehouse_id and inventory_item_id = v_line.inventory_item_id
       and quantity >= v_line.quantity;
    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'crm_post_stock_transfer: insufficient stock for "%" in source warehouse',
        v_line.item_name using errcode = '23514';
    end if;

    insert into public.warehouse_stock (workspace_id, warehouse_id, inventory_item_id, quantity)
    values (v_transfer.workspace_id, v_transfer.to_warehouse_id, v_line.inventory_item_id, v_line.quantity)
    on conflict (warehouse_id, inventory_item_id)
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now();

    -- inventory_items.quantity unchanged for transfers.
    select case when v_line.quantity > 0 then round(v_line.amount / v_line.quantity, 4) else 0 end
      into v_avg_cost;

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, movement_type, quantity, reason, created_by,
      warehouse_id, batch_id, document_type, document_id, unit_cost,
      batch_allocations, idempotency_key
    ) values (
      v_transfer.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
      'stock_transfer_out', (select auth.uid()),
      v_transfer.from_warehouse_id, v_first_src, 'stock_transfer', v_transfer.id, v_avg_cost,
      nullif(v_src_alloc, '[]'::jsonb),
      'stock_transfer:' || v_transfer.id::text || ':from:' || v_line.inventory_item_id::text
    );

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, movement_type, quantity, reason, created_by,
      warehouse_id, batch_id, document_type, document_id, unit_cost,
      batch_allocations, idempotency_key
    ) values (
      v_transfer.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
      'stock_transfer_in', (select auth.uid()),
      v_transfer.to_warehouse_id, v_first_dst, 'stock_transfer', v_transfer.id, v_avg_cost,
      nullif(v_dst_alloc, '[]'::jsonb),
      'stock_transfer:' || v_transfer.id::text || ':to:' || v_line.inventory_item_id::text
    );

    v_lines := v_lines + 1;
    v_total := v_total + v_line.amount;
  end loop;

  update public.stock_transfers set posted_at = now(), total = v_total where id = p_transfer_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('transfer_id', p_transfer_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end;
$$;

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
  v_slice record;
  v_alloc jsonb;
  v_first_batch uuid;
  v_avg_cost numeric;
  v_cost_sum numeric;
  v_rowcount integer;
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

    v_alloc := '[]'::jsonb;
    v_first_batch := null;
    v_cost_sum := 0;

    for v_slice in
      select * from public.crm_consume_batches_fifo(
        v_write_off.workspace_id, v_write_off.warehouse_id, v_line.inventory_item_id, v_line.quantity
      )
    loop
      if v_first_batch is null then
        v_first_batch := v_slice.batch_id;
      end if;
      v_cost_sum := v_cost_sum + coalesce(v_slice.unit_cost, 0) * v_slice.quantity;
      v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
        'batch_id', v_slice.batch_id,
        'quantity', v_slice.quantity,
        'unit_cost', v_slice.unit_cost,
        'expires_on', v_slice.expires_on,
        'supplier_client_id', v_slice.supplier_client_id
      ));
    end loop;

    update public.warehouse_stock
       set quantity = quantity - v_line.quantity, updated_at = now()
     where warehouse_id = v_write_off.warehouse_id and inventory_item_id = v_line.inventory_item_id
       and quantity >= v_line.quantity;
    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'crm_post_write_off: insufficient stock for "%" in warehouse',
        v_line.item_name using errcode = '23514';
    end if;

    update public.inventory_items
       set quantity = quantity - v_line.quantity, updated_at = now()
     where id = v_line.inventory_item_id and workspace_id = v_write_off.workspace_id
       and quantity >= v_line.quantity;
    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'crm_post_write_off: insufficient total stock for "%"',
        v_line.item_name using errcode = '23514';
    end if;

    v_avg_cost := case
      when jsonb_array_length(v_alloc) > 0 and v_line.quantity > 0
        then round(v_cost_sum / v_line.quantity, 4)
      else case when v_line.quantity > 0 then round(v_line.amount / v_line.quantity, 4) else 0 end
    end;

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, movement_type, quantity, reason, created_by,
      warehouse_id, batch_id, document_type, document_id, unit_cost,
      batch_allocations, idempotency_key
    ) values (
      v_write_off.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
      coalesce(nullif(btrim(v_write_off.reason), ''), 'write_off'), (select auth.uid()),
      v_write_off.warehouse_id, v_first_batch, 'write_off', v_write_off.id, v_avg_cost,
      nullif(v_alloc, '[]'::jsonb),
      'write_off:' || v_write_off.id::text || ':' || v_line.inventory_item_id::text
    );

    v_lines := v_lines + 1;
    v_total := v_total + v_line.amount;
  end loop;

  update public.write_offs set posted_at = now(), total = v_total where id = p_write_off_id;

  perform set_config('crm.warehouse_posting', '', true);

  return jsonb_build_object('write_off_id', p_write_off_id, 'status', 'posted', 'lines', v_lines, 'total', v_total);
end;
$$;

revoke all on function public.crm_post_stock_transfer(uuid) from public, anon;
revoke all on function public.crm_post_write_off(uuid) from public, anon;
grant execute on function public.crm_post_stock_transfer(uuid) to authenticated;
grant execute on function public.crm_post_write_off(uuid) to authenticated;
-- ---------------------------------------------------------------------
-- 8. Replace warehouse issue / return (batch_allocations provenance)
-- ---------------------------------------------------------------------
create or replace function public.issue_order_materials_from_warehouse(
  p_order_id uuid,
  p_lines jsonb,
  p_warehouse_id uuid,
  p_idempotency_key text default null
)
returns setof public.inventory_movements
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_workspace_id uuid;
  v_role text;
  v_elem jsonb;
  v_item_id uuid;
  v_raw numeric;
  v_qty integer;
  v_line record;
  v_available numeric;
  v_wh_available numeric;
  v_movement_ids uuid[] := array[]::uuid[];
  v_movement_id uuid;
  v_key text;
  v_seen jsonb := '{}'::jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_existing_count integer;
  v_existing_norm jsonb;
  v_bad boolean;
  v_rowcount integer;
  v_wh_ok boolean;
  v_slice record;
  v_alloc jsonb;
  v_first_batch uuid;
  v_unit_cost numeric;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'issue lines must be a non-empty JSON array' using errcode = '22023';
  end if;

  for v_elem in
    select line.value
    from jsonb_array_elements(p_lines) as line(value)
  loop
    begin
      v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
    exception
      when others then
        raise exception 'Invalid issue line payload' using errcode = '22P02';
    end;

    begin
      v_raw := (v_elem ->> 'quantity')::numeric;
    exception
      when others then
        raise exception 'Invalid issue line payload' using errcode = '22P02';
    end;

    if v_item_id is null or v_raw is null or v_raw <= 0 then
      raise exception 'Each issue line requires inventory_item_id and quantity > 0' using errcode = '22023';
    end if;
    if v_raw <> trunc(v_raw) then
      raise exception 'Issue quantity must be a whole number' using errcode = '22023';
    end if;
    if v_raw > 2147483647::numeric then
      raise exception 'Issue quantity is too large' using errcode = '22023';
    end if;

    v_qty := trunc(v_raw)::integer;

    if v_seen ? v_item_id::text then
      raise exception 'Duplicate inventory_item_id in issue lines' using errcode = '22023';
    end if;
    v_seen := v_seen || jsonb_build_object(v_item_id::text, v_qty);
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'inventory_item_id', kv.key,
        'quantity', (kv.value #>> '{}')::integer
      )
      order by kv.key
    ),
    '[]'::jsonb
  )
  into v_normalized
  from jsonb_each(v_seen) as kv(key, value);

  select o.workspace_id into v_workspace_id
  from public.orders o
  where o.id = p_order_id;

  if v_workspace_id is null then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;
  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role is null or v_role not in ('owner', 'admin', 'manager') then
    raise exception 'You do not have permission to issue warehouse materials.' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.warehouses w
    where w.id = p_warehouse_id
      and w.workspace_id = v_workspace_id
      and w.deleted_at is null
      and w.is_active
  ) into v_wh_ok;
  if not v_wh_ok then
    raise exception 'Warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if v_key is not null then
    perform pg_advisory_xact_lock(
      hashtext('warehouse_idempotency'),
      hashtext(v_workspace_id::text || chr(31) || v_key)
    );

    select count(*)::integer into v_existing_count
    from public.inventory_movements m
    where m.workspace_id = v_workspace_id
      and m.idempotency_key = v_key;

    if v_existing_count > 0 then
      select exists (
        select 1
        from public.inventory_movements m
        left join public.order_materials om
          on om.id = m.order_material_id
         and om.order_id = p_order_id
         and om.inventory_item_id = m.inventory_item_id
        where m.workspace_id = v_workspace_id
          and m.idempotency_key = v_key
          and (
            m.movement_type is distinct from 'issue'
            or m.order_id is distinct from p_order_id
            or m.reason is not null
            or m.inventory_item_id is null
            or m.quantity is null
            or m.quantity <= 0
            or m.order_material_id is null
            or om.id is null
            or m.warehouse_id is distinct from p_warehouse_id
          )
      ) into v_bad;

      if v_bad then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      select exists (
        select 1
        from public.inventory_movements m
        where m.workspace_id = v_workspace_id
          and m.idempotency_key = v_key
        group by m.inventory_item_id
        having count(*) > 1
      ) into v_bad;

      if v_bad then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      if v_existing_count <> jsonb_array_length(v_normalized) then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'inventory_item_id', m.inventory_item_id::text,
            'quantity', m.quantity
          )
          order by m.inventory_item_id::text
        ),
        '[]'::jsonb
      )
      into v_existing_norm
      from public.inventory_movements m
      where m.workspace_id = v_workspace_id
        and m.idempotency_key = v_key;

      if v_existing_norm is distinct from v_normalized then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      return query
      select m.*
      from public.inventory_movements m
      where m.workspace_id = v_workspace_id
        and m.idempotency_key = v_key
      order by m.created_at, m.id;
      return;
    end if;
  end if;

  perform 1 from public.orders o where o.id = p_order_id for update of o;

  perform 1
  from public.order_materials om
  where om.order_id = p_order_id
  order by om.inventory_item_id
  for update of om;

  perform 1
  from public.inventory_items i
  where i.workspace_id = v_workspace_id
    and i.id in (
      select (line.value ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(v_normalized) as line(value)
    )
  order by i.id
  for update of i;

  perform 1
  from public.warehouses w
  where w.id = p_warehouse_id
    and w.workspace_id = v_workspace_id
    and w.deleted_at is null
    and w.is_active
  for share of w;
  if not found then
    raise exception 'Warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  perform 1
  from public.warehouse_stock ws
  where ws.warehouse_id = p_warehouse_id
    and ws.workspace_id = v_workspace_id
    and ws.inventory_item_id in (
      select (line.value ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(v_normalized) as line(value)
    )
  order by ws.inventory_item_id
  for update of ws;

  for v_elem in
    select line.value
    from jsonb_array_elements(v_normalized) as line(value)
  loop
    v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
    v_qty := (v_elem ->> 'quantity')::integer;

    select * into v_line
    from public.order_materials om
    where om.order_id = p_order_id
      and om.inventory_item_id = v_item_id
    for update;

    if not found then
      raise exception 'Material is not on this order' using errcode = 'P0001';
    end if;

    select i.quantity into v_available
    from public.inventory_items i
    where i.id = v_item_id
      and i.workspace_id = v_workspace_id
    for update;

    if not found then
      raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
    end if;

    if coalesce(v_available, 0) < v_qty::numeric then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;

    select ws.quantity into v_wh_available
    from public.warehouse_stock ws
    where ws.warehouse_id = p_warehouse_id
      and ws.workspace_id = v_workspace_id
      and ws.inventory_item_id = v_item_id
    for update;

    if not found or coalesce(v_wh_available, 0) < v_qty::numeric then
      raise exception 'insufficient_warehouse_stock' using errcode = 'P0001';
    end if;

    v_alloc := '[]'::jsonb;
    v_first_batch := null;
    v_unit_cost := null;

    for v_slice in
      select * from public.crm_consume_batches_fifo(
        v_workspace_id, p_warehouse_id, v_item_id, v_qty::numeric
      )
    loop
      if v_first_batch is null then
        v_first_batch := v_slice.batch_id;
        v_unit_cost := v_slice.unit_cost;
      end if;
      v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
        'batch_id', v_slice.batch_id,
        'quantity', v_slice.quantity,
        'unit_cost', v_slice.unit_cost,
        'expires_on', v_slice.expires_on,
        'supplier_client_id', v_slice.supplier_client_id
      ));
    end loop;

    update public.inventory_items
    set quantity = quantity - v_qty::numeric,
        updated_at = now()
    where id = v_item_id
      and workspace_id = v_workspace_id
      and quantity >= v_qty::numeric;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;

    update public.warehouse_stock
    set quantity = quantity - v_qty::numeric,
        updated_at = now()
    where warehouse_id = p_warehouse_id
      and workspace_id = v_workspace_id
      and inventory_item_id = v_item_id
      and quantity >= v_qty::numeric;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'insufficient_warehouse_stock' using errcode = 'P0001';
    end if;

    update public.order_materials
    set quantity_issued = quantity_issued + v_qty,
        warehouse_id = coalesce(warehouse_id, p_warehouse_id)
    where id = v_line.id
      and quantity_issued + v_qty <= quantity;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'Cannot issue more than the remaining requested quantity' using errcode = 'P0001';
    end if;

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, order_id, order_material_id,
      movement_type, quantity, reason, idempotency_key, created_by,
      warehouse_id, batch_id, unit_cost, batch_allocations
    ) values (
      v_workspace_id, v_item_id, p_order_id, v_line.id,
      'issue', v_qty, null, v_key, (select auth.uid()),
      p_warehouse_id, v_first_batch, v_unit_cost, nullif(v_alloc, '[]'::jsonb)
    )
    returning id into v_movement_id;

    v_movement_ids := array_append(v_movement_ids, v_movement_id);
  end loop;

  return query
  select m.*
  from public.inventory_movements m
  where m.id = any (v_movement_ids)
  order by m.created_at, m.id;
end;
$function$;

revoke all on function public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)
  to authenticated;

create or replace function public.return_order_materials_to_warehouse(
  p_order_id uuid,
  p_lines jsonb,
  p_warehouse_id uuid,
  p_reason text default null,
  p_idempotency_key text default null
)
returns setof public.inventory_movements
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_workspace_id uuid;
  v_role text;
  v_elem jsonb;
  v_item_id uuid;
  v_raw numeric;
  v_qty integer;
  v_line record;
  v_movement_ids uuid[] := array[]::uuid[];
  v_movement_id uuid;
  v_key text;
  v_reason text;
  v_seen jsonb := '{}'::jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_existing_count integer;
  v_existing_norm jsonb;
  v_bad boolean;
  v_rowcount integer;
  v_wh_ok boolean;
  v_peel jsonb;
  v_alloc jsonb;
  v_slice jsonb;
  v_need numeric;
  v_got numeric;
  v_restore_qty numeric;
  v_batch_id uuid;
  v_first_batch uuid;
  v_new_batch uuid;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if p_warehouse_id is null then
    raise exception 'warehouse_id is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'return lines must be a non-empty JSON array' using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  for v_elem in
    select line.value
    from jsonb_array_elements(p_lines) as line(value)
  loop
    begin
      v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
    exception
      when others then
        raise exception 'Invalid return line payload' using errcode = '22P02';
    end;

    begin
      v_raw := (v_elem ->> 'quantity')::numeric;
    exception
      when others then
        raise exception 'Invalid return line payload' using errcode = '22P02';
    end;

    if v_item_id is null or v_raw is null or v_raw <= 0 then
      raise exception 'Each return line requires inventory_item_id and quantity > 0' using errcode = '22023';
    end if;
    if v_raw <> trunc(v_raw) then
      raise exception 'Return quantity must be a whole number' using errcode = '22023';
    end if;
    if v_raw > 2147483647::numeric then
      raise exception 'Return quantity is too large' using errcode = '22023';
    end if;

    v_qty := trunc(v_raw)::integer;

    if v_seen ? v_item_id::text then
      raise exception 'Duplicate inventory_item_id in return lines' using errcode = '22023';
    end if;
    v_seen := v_seen || jsonb_build_object(v_item_id::text, v_qty);
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'inventory_item_id', kv.key,
        'quantity', (kv.value #>> '{}')::integer
      )
      order by kv.key
    ),
    '[]'::jsonb
  )
  into v_normalized
  from jsonb_each(v_seen) as kv(key, value);

  select o.workspace_id into v_workspace_id
  from public.orders o
  where o.id = p_order_id;

  if v_workspace_id is null then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;
  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role is null or v_role not in ('owner', 'admin', 'manager') then
    raise exception 'You do not have permission to return warehouse materials.' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.warehouses w
    where w.id = p_warehouse_id
      and w.workspace_id = v_workspace_id
      and w.deleted_at is null
      and w.is_active
  ) into v_wh_ok;
  if not v_wh_ok then
    raise exception 'Warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if v_key is not null then
    perform pg_advisory_xact_lock(
      hashtext('warehouse_idempotency'),
      hashtext(v_workspace_id::text || chr(31) || v_key)
    );

    select count(*)::integer into v_existing_count
    from public.inventory_movements m
    where m.workspace_id = v_workspace_id
      and m.idempotency_key = v_key;

    if v_existing_count > 0 then
      select exists (
        select 1
        from public.inventory_movements m
        left join public.order_materials om
          on om.id = m.order_material_id
         and om.order_id = p_order_id
         and om.inventory_item_id = m.inventory_item_id
        where m.workspace_id = v_workspace_id
          and m.idempotency_key = v_key
          and (
            m.movement_type is distinct from 'return'
            or m.order_id is distinct from p_order_id
            or coalesce(m.reason, '') is distinct from coalesce(v_reason, '')
            or m.inventory_item_id is null
            or m.quantity is null
            or m.quantity <= 0
            or m.order_material_id is null
            or om.id is null
            or m.warehouse_id is distinct from p_warehouse_id
          )
      ) into v_bad;

      if v_bad then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      select exists (
        select 1
        from public.inventory_movements m
        where m.workspace_id = v_workspace_id
          and m.idempotency_key = v_key
        group by m.inventory_item_id
        having count(*) > 1
      ) into v_bad;

      if v_bad or v_existing_count <> jsonb_array_length(v_normalized) then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'inventory_item_id', m.inventory_item_id::text,
            'quantity', m.quantity
          )
          order by m.inventory_item_id::text
        ),
        '[]'::jsonb
      )
      into v_existing_norm
      from public.inventory_movements m
      where m.workspace_id = v_workspace_id
        and m.idempotency_key = v_key;

      if v_existing_norm is distinct from v_normalized then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      return query
      select m.*
      from public.inventory_movements m
      where m.workspace_id = v_workspace_id
        and m.idempotency_key = v_key
      order by m.created_at, m.id;
      return;
    end if;
  end if;

  perform 1 from public.orders o where o.id = p_order_id for update of o;

  perform 1
  from public.order_materials om
  where om.order_id = p_order_id
  order by om.inventory_item_id
  for update of om;

  perform 1
  from public.inventory_items i
  where i.workspace_id = v_workspace_id
    and i.id in (
      select (line.value ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(v_normalized) as line(value)
    )
  order by i.id
  for update of i;

  perform 1
  from public.warehouses w
  where w.id = p_warehouse_id
    and w.workspace_id = v_workspace_id
    and w.deleted_at is null
    and w.is_active
  for share of w;
  if not found then
    raise exception 'Warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  perform 1
  from public.warehouse_stock ws
  where ws.warehouse_id = p_warehouse_id
    and ws.workspace_id = v_workspace_id
    and ws.inventory_item_id in (
      select (line.value ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(v_normalized) as line(value)
    )
  order by ws.inventory_item_id
  for update of ws;

  for v_elem in
    select line.value
    from jsonb_array_elements(v_normalized) as line(value)
  loop
    v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
    v_qty := (v_elem ->> 'quantity')::integer;

    select * into v_line
    from public.order_materials om
    where om.order_id = p_order_id
      and om.inventory_item_id = v_item_id
    for update;

    if not found then
      raise exception 'Material is not on this order' using errcode = 'P0001';
    end if;

    perform 1
    from public.inventory_items i
    where i.id = v_item_id
      and i.workspace_id = v_workspace_id
    for update;

    if not found then
      raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
    end if;

    update public.order_materials
    set quantity_returned = quantity_returned + v_qty
    where id = v_line.id
      and quantity_returned + v_qty <= quantity_issued;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'Cannot return more than the outstanding issued quantity' using errcode = 'P0001';
    end if;

    update public.inventory_items
    set quantity = quantity + v_qty::numeric,
        updated_at = now()
    where id = v_item_id
      and workspace_id = v_workspace_id;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
    end if;

    insert into public.warehouse_stock (
      workspace_id, warehouse_id, inventory_item_id, quantity, updated_at
    ) values (
      v_workspace_id, p_warehouse_id, v_item_id, v_qty::numeric, now()
    )
    on conflict (warehouse_id, inventory_item_id)
    do update set
      quantity = public.warehouse_stock.quantity + excluded.quantity,
      updated_at = now();

    v_peel := public.crm_peel_return_batch_slices(
      v_workspace_id, v_line.id, p_warehouse_id, v_qty::numeric
    );
    v_alloc := '[]'::jsonb;
    v_first_batch := null;
    v_got := 0;

    if v_peel is not null and jsonb_typeof(v_peel) = 'array' then
      for v_slice in select value from jsonb_array_elements(v_peel)
      loop
        v_restore_qty := coalesce((v_slice ->> 'quantity')::numeric, 0);
        if v_restore_qty <= 0 then
          continue;
        end if;
        begin
          v_batch_id := (v_slice ->> 'batch_id')::uuid;
        exception
          when others then
            v_batch_id := null;
        end;

        v_new_batch := public.crm_restore_or_create_batch(
          v_workspace_id, p_warehouse_id, v_item_id, v_restore_qty,
          v_batch_id,
          coalesce((v_slice ->> 'unit_cost')::numeric, 0),
          nullif(v_slice ->> 'expires_on', '')::date,
          nullif(v_slice ->> 'supplier_client_id', '')::uuid,
          null
        );
        if v_first_batch is null then
          v_first_batch := v_new_batch;
        end if;
        v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
          'batch_id', v_new_batch,
          'quantity', v_restore_qty,
          'unit_cost', coalesce((v_slice ->> 'unit_cost')::numeric, 0),
          'expires_on', nullif(v_slice ->> 'expires_on', '')::date,
          'supplier_client_id', nullif(v_slice ->> 'supplier_client_id', '')::uuid
        ));
        v_got := v_got + v_restore_qty;
      end loop;
    end if;

    v_need := v_qty::numeric - v_got;
    if v_need > 0 then
      -- Fallback: new zero-cost batch for remainder / legacy issues without provenance.
      v_new_batch := public.crm_restore_or_create_batch(
        v_workspace_id, p_warehouse_id, v_item_id, v_need,
        null, 0, null, null, null
      );
      if v_first_batch is null then
        v_first_batch := v_new_batch;
      end if;
      v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
        'batch_id', v_new_batch,
        'quantity', v_need,
        'unit_cost', 0,
        'expires_on', null,
        'supplier_client_id', null
      ));
    end if;

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, order_id, order_material_id,
      movement_type, quantity, reason, idempotency_key, created_by,
      warehouse_id, batch_id, batch_allocations
    ) values (
      v_workspace_id, v_item_id, p_order_id, v_line.id,
      'return', v_qty, v_reason, v_key, (select auth.uid()),
      p_warehouse_id, v_first_batch, nullif(v_alloc, '[]'::jsonb)
    )
    returning id into v_movement_id;

    v_movement_ids := array_append(v_movement_ids, v_movement_id);
  end loop;

  return query
  select m.*
  from public.inventory_movements m
  where m.id = any (v_movement_ids)
  order by m.created_at, m.id;
end;
$function$;

revoke all on function public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)
  to authenticated;

-- Revoke legacy global issue/return from authenticated (bodies unchanged).
do $revoke_legacy$
begin
  if to_regprocedure('public.issue_order_materials(uuid, jsonb, text)') is not null then
    revoke all on function public.issue_order_materials(uuid, jsonb, text)
      from public, anon, authenticated;
  end if;
  if to_regprocedure('public.return_order_materials(uuid, jsonb, text, text)') is not null then
    revoke all on function public.return_order_materials(uuid, jsonb, text, text)
      from public, anon, authenticated;
  end if;
end
$revoke_legacy$;
-- ---------------------------------------------------------------------
-- 9. Atomic catalog add/set + issue RPCs (frontend signatures)
-- ---------------------------------------------------------------------
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
declare
  v_workspace_id uuid;
  v_role text;
  v_key text;
  v_item record;
  v_line public.order_materials%rowtype;
  v_price numeric(10,2);
  v_delta integer;
  v_movements jsonb := '[]'::jsonb;
  v_existing_mov_count integer;
  v_wh_ok boolean;
begin
  if p_order_id is null or p_warehouse_id is null or p_inventory_item_id is null then
    raise exception 'order_id, warehouse_id and inventory_item_id are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be a positive whole number' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id
  from public.orders o where o.id = p_order_id;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role is null or v_role not in ('owner', 'admin', 'manager') then
    raise exception 'You do not have permission to issue warehouse materials.' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.workspace_id = v_workspace_id
      and w.deleted_at is null and w.is_active
  ) into v_wh_ok;
  if not v_wh_ok then
    raise exception 'Warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  select i.* into v_item
  from public.inventory_items i
  where i.id = p_inventory_item_id and i.workspace_id = v_workspace_id;
  if not found then
    raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
  end if;

  v_price := coalesce(p_price, v_item.selling_price, 0);
  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if v_key is not null then
    perform pg_advisory_xact_lock(
      hashtext('warehouse_idempotency'),
      hashtext(v_workspace_id::text || chr(31) || v_key)
    );

    select count(*)::integer into v_existing_mov_count
    from public.inventory_movements m
    where m.workspace_id = v_workspace_id and m.idempotency_key = v_key;

    if v_existing_mov_count > 0 then
      -- Replay: require matching issue fingerprint for this order/item/warehouse.
      if exists (
        select 1 from public.inventory_movements m
        where m.workspace_id = v_workspace_id
          and m.idempotency_key = v_key
          and (
            m.movement_type is distinct from 'issue'
            or m.order_id is distinct from p_order_id
            or m.inventory_item_id is distinct from p_inventory_item_id
            or m.warehouse_id is distinct from p_warehouse_id
          )
      ) then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      select om.* into v_line
      from public.order_materials om
      where om.order_id = p_order_id
        and om.inventory_item_id = p_inventory_item_id
      limit 1;

      if not found then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
        into v_movements
      from public.inventory_movements m
      where m.workspace_id = v_workspace_id and m.idempotency_key = v_key;

      return jsonb_build_object('material', to_jsonb(v_line), 'movements', v_movements);
    end if;
  end if;

  perform 1 from public.orders o where o.id = p_order_id for update of o;

  select * into v_line
  from public.order_materials om
  where om.order_id = p_order_id
    and om.inventory_item_id = p_inventory_item_id
  for update;

  if found then
    if coalesce(v_line.supply_source, 'catalog') is distinct from 'catalog' then
      raise exception 'Existing order material is not a catalog line' using errcode = 'P0001';
    end if;
    if p_quantity < (coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0)) then
      raise exception 'quantity cannot be less than outstanding issued quantity' using errcode = '22023';
    end if;

    update public.order_materials
    set quantity = p_quantity,
        price = coalesce(v_price, price),
        warehouse_id = coalesce(warehouse_id, p_warehouse_id),
        item_name = coalesce(nullif(btrim(item_name), ''), v_item.name),
        supply_source = 'catalog'
    where id = v_line.id
    returning * into v_line;

    v_delta := p_quantity - coalesce(v_line.quantity_issued, 0);
  else
    insert into public.order_materials (
      order_id, inventory_item_id, item_name, price, quantity,
      quantity_issued, quantity_returned, supply_source, warehouse_id
    ) values (
      p_order_id, p_inventory_item_id, v_item.name, v_price, p_quantity,
      0, 0, 'catalog', p_warehouse_id
    )
    returning * into v_line;

    v_delta := p_quantity;
  end if;

  if v_delta > 0 then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
      into v_movements
    from public.issue_order_materials_from_warehouse(
      p_order_id,
      jsonb_build_array(jsonb_build_object(
        'inventory_item_id', p_inventory_item_id,
        'quantity', v_delta
      )),
      p_warehouse_id,
      v_key
    ) as m;

    select * into v_line
    from public.order_materials om
    where om.id = v_line.id;
  end if;

  return jsonb_build_object('material', to_jsonb(v_line), 'movements', coalesce(v_movements, '[]'::jsonb));
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
declare
  v_workspace_id uuid;
  v_role text;
  v_key text;
  v_line public.order_materials%rowtype;
  v_delta integer;
  v_wh_ok boolean;
  v_existing_mov_count integer;
begin
  if p_order_id is null or p_order_material_id is null or p_warehouse_id is null then
    raise exception 'order_id, order_material_id and warehouse_id are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be a positive whole number' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id
  from public.orders o where o.id = p_order_id;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role is null or v_role not in ('owner', 'admin', 'manager') then
    raise exception 'You do not have permission to issue warehouse materials.' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.workspace_id = v_workspace_id
      and w.deleted_at is null and w.is_active
  ) into v_wh_ok;
  if not v_wh_ok then
    raise exception 'Warehouse not found, inactive or in another workspace' using errcode = '22023';
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if v_key is not null then
    perform pg_advisory_xact_lock(
      hashtext('warehouse_idempotency'),
      hashtext(v_workspace_id::text || chr(31) || v_key)
    );

    select count(*)::integer into v_existing_mov_count
    from public.inventory_movements m
    where m.workspace_id = v_workspace_id and m.idempotency_key = v_key;

    if v_existing_mov_count > 0 then
      if exists (
        select 1 from public.inventory_movements m
        where m.workspace_id = v_workspace_id
          and m.idempotency_key = v_key
          and (
            m.movement_type is distinct from 'issue'
            or m.order_id is distinct from p_order_id
            or m.order_material_id is distinct from p_order_material_id
            or m.warehouse_id is distinct from p_warehouse_id
          )
      ) then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      select om.* into v_line
      from public.order_materials om
      where om.id = p_order_material_id and om.order_id = p_order_id;

      if not found then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      return jsonb_build_object('material', to_jsonb(v_line));
    end if;
  end if;

  perform 1 from public.orders o where o.id = p_order_id for update of o;

  select * into v_line
  from public.order_materials om
  where om.id = p_order_material_id
    and om.order_id = p_order_id
  for update;

  if not found then
    raise exception 'Order material was not found on this order' using errcode = 'P0002';
  end if;
  if coalesce(v_line.supply_source, 'catalog') is distinct from 'catalog' then
    raise exception 'Order material is not a catalog line' using errcode = 'P0001';
  end if;
  if v_line.inventory_item_id is null then
    raise exception 'Catalog order material requires inventory_item_id' using errcode = '22023';
  end if;

  if p_quantity < (coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0)) then
    raise exception 'quantity cannot be less than outstanding issued quantity' using errcode = '22023';
  end if;

  update public.order_materials
  set quantity = p_quantity,
      warehouse_id = coalesce(warehouse_id, p_warehouse_id)
  where id = v_line.id
  returning * into v_line;

  v_delta := p_quantity - coalesce(v_line.quantity_issued, 0);

  if v_delta > 0 then
    perform 1 from public.issue_order_materials_from_warehouse(
      p_order_id,
      jsonb_build_array(jsonb_build_object(
        'inventory_item_id', v_line.inventory_item_id,
        'quantity', v_delta
      )),
      p_warehouse_id,
      v_key
    );

    select * into v_line
    from public.order_materials om
    where om.id = v_line.id;
  end if;

  return jsonb_build_object('material', to_jsonb(v_line));
end;
$function$;

revoke all on function public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text)
  from public, anon;
revoke all on function public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text)
  to authenticated, service_role;
grant execute on function public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. Post-checks + PostgREST notify
-- ---------------------------------------------------------------------
do $postcheck$
declare
  v_hash_before text := current_setting('crm.apply_sync_order_materials_md5', true);
  v_hash_after text;
  v_oid oid;
  v_missing text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sync_order_materials'
    and pg_get_function_identity_arguments(p.oid) = 'uuid, jsonb';
  if v_oid is null then
    raise exception 'Post-check: sync_order_materials(uuid, jsonb) missing';
  end if;
  v_hash_after := md5(pg_get_functiondef(v_oid));
  if v_hash_before is distinct from v_hash_after then
    raise exception 'Post-check FAILED: sync_order_materials definition changed (forbidden)';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_movements' and column_name='batch_allocations'
  ) then
    raise exception 'Post-check: inventory_movements.batch_allocations missing';
  end if;

  if to_regprocedure('public.crm_post_goods_receipt(uuid)') is null
     or to_regprocedure('public.crm_post_stock_transfer(uuid)') is null
     or to_regprocedure('public.crm_post_write_off(uuid)') is null
     or to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null
     or to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)') is null
     or to_regprocedure('public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text)') is null
     or to_regprocedure('public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text)') is null
  then
    raise exception 'Post-check: one or more required function signatures missing';
  end if;

  if not (
    select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='crm_post_goods_receipt'
      and pg_get_function_identity_arguments(p.oid)='uuid'
  ) then
    raise exception 'Post-check: crm_post_goods_receipt must be SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='warehouses'
      and t.tgname='crm_prevent_hard_delete_warehouse' and not t.tgisinternal
  ) then
    raise exception 'Post-check: warehouse hard-delete trigger missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='inventory_items'
      and t.tgname='crm_inventory_item_create_warehouse_gate' and not t.tgisinternal
  ) then
    raise exception 'Post-check: inventory item create warehouse gate missing';
  end if;

  -- Legacy EXECUTE revoked from authenticated when functions exist
  if to_regprocedure('public.issue_order_materials(uuid, jsonb, text)') is not null then
    if has_function_privilege('authenticated', 'public.issue_order_materials(uuid, jsonb, text)', 'execute') then
      raise exception 'Post-check: authenticated still has EXECUTE on legacy issue_order_materials';
    end if;
  end if;
  if to_regprocedure('public.return_order_materials(uuid, jsonb, text, text)') is not null then
    if has_function_privilege('authenticated', 'public.return_order_materials(uuid, jsonb, text, text)', 'execute') then
      raise exception 'Post-check: authenticated still has EXECUTE on legacy return_order_materials';
    end if;
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text)',
    'execute'
  ) then
    raise exception 'Post-check: authenticated missing EXECUTE on add_and_issue_order_catalog_material';
  end if;
end
$postcheck$;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Manual APPLY checklist (owner):
--   1) Open Supabase SQL Editor on MAIN (pundggjzzaqzbvykbxvo)
--   2) Paste this entire file and run once
--   3) Confirm COMMIT succeeded (no Preflight/Post-check exception)
--   4) Smoke: post receipt → transfer → write-off; issue/return; add_and_issue
-- =====================================================================
