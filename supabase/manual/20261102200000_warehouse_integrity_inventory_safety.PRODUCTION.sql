-- =====================================================================
-- Core App — Warehouse integrity, inventory delete safety, receipt guards,
-- movement ledger on receipt post, FIFO batch_id on issue, one-time order parts
-- (manual ADDITIVE PACKAGE — APPLY only after explicit owner approval).
--
-- SUPERSEDES: 20261102180000_inventory_item_delete_clears_warehouse_stock.*
--
-- DOES NOT run from the app. One transaction; abort rolls everything back.
-- Does NOT grant DELETE on stock tables to authenticated.
-- Does NOT weaken unrelated RLS.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------
do $preflight$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'inventory_items','warehouse_stock','stock_batches','stock_serials',
    'inventory_movements','order_materials','goods_receipts','goods_receipt_lines',
    'workspaces','workspace_members'
  ]) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'Preflight: missing tables: %', v_missing;
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight: is_workspace_member(uuid) missing';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    raise exception 'Preflight: crm_has_permission(uuid,text) missing (crm_ro_v1)';
  end if;
end
$preflight$;

-- =====================================================================
-- PART A — Secure inventory item delete child cleanup
-- =====================================================================
create or replace function public.inventory_items_clear_denied_stock_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'inventory_item_delete:not_authenticated' using errcode = '42501';
  end if;
  if old.workspace_id is null then
    raise exception 'inventory_item_delete:missing_workspace' using errcode = '22023';
  end if;
  -- Same rule as inventory_items DELETE RLS (membership; not owner-only).
  if not public.is_workspace_member(old.workspace_id) then
    raise exception 'inventory_item_delete:not_member' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.inventory_movements m
    where m.inventory_item_id = old.id and m.workspace_id = old.workspace_id
  ) then
    raise exception 'inventory_item_delete:has_movements' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.order_materials om
    where om.inventory_item_id = old.id
  ) then
    raise exception 'inventory_item_delete:has_order_materials' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.stock_serials s
    where s.inventory_item_id = old.id
      and s.workspace_id = old.workspace_id
      and (s.status is distinct from 'in_stock' or s.order_material_id is not null)
  ) then
    raise exception 'inventory_item_delete:has_serial_history' using errcode = 'P0001';
  end if;

  delete from public.stock_serials
  where inventory_item_id = old.id and workspace_id = old.workspace_id;

  delete from public.stock_batches
  where inventory_item_id = old.id and workspace_id = old.workspace_id;

  delete from public.warehouse_stock
  where inventory_item_id = old.id and workspace_id = old.workspace_id;

  return old;
end;
$$;

revoke all on function public.inventory_items_clear_denied_stock_children() from public, anon;
grant execute on function public.inventory_items_clear_denied_stock_children() to authenticated, service_role;

do $owner_a$
declare v_owner name;
begin
  select pg_get_userbyid(c.relowner) into v_owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'warehouse_stock' and c.relkind = 'r';
  if v_owner is null then raise exception 'Part A: warehouse_stock owner unresolved'; end if;
  if (
    select count(distinct c.relowner) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('warehouse_stock','stock_batches','stock_serials')
  ) is distinct from 1 then
    raise exception 'Part A: stock table owners differ; refusing single DEFINER';
  end if;
  execute format('alter function public.inventory_items_clear_denied_stock_children() owner to %I', v_owner);
end
$owner_a$;

drop trigger if exists inventory_items_clear_denied_stock_children on public.inventory_items;
create trigger inventory_items_clear_denied_stock_children
  before delete on public.inventory_items
  for each row execute function public.inventory_items_clear_denied_stock_children();

-- =====================================================================
-- PART B — Posted document line + receipt header immutability
-- =====================================================================
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
  for each row execute function public.crm_guard_posted_document_lines('goods_receipts', 'goods_receipt_id', 'status = ''posted''');

drop trigger if exists crm_guard_receipt_header_immutable on public.goods_receipts;
create trigger crm_guard_receipt_header_immutable
  before update on public.goods_receipts
  for each row execute function public.crm_guard_receipt_header_immutable();

-- =====================================================================
-- PART C — Receipt posting also writes inventory_movements (adjustment)
-- Replaces crm_post_goods_receipt; requires document_* columns when present.
-- =====================================================================
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
  v_has_doc boolean;
  v_has_batch boolean;
  v_has_cost boolean;
  v_has_wh boolean;
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

  -- Lock lines in deterministic order (blocks concurrent edits during post).
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

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_movements' and column_name='document_type'
  ) into v_has_doc;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_movements' and column_name='batch_id'
  ) into v_has_batch;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_movements' and column_name='unit_cost'
  ) into v_has_cost;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inventory_movements' and column_name='warehouse_id'
  ) into v_has_wh;

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

    -- One inbound ledger row per line (movement_type=adjustment; reason=goods_receipt).
    if v_has_doc and v_has_batch and v_has_cost and v_has_wh then
      insert into public.inventory_movements (
        workspace_id, inventory_item_id, movement_type, quantity, reason, created_by,
        warehouse_id, batch_id, document_type, document_id, unit_cost,
        idempotency_key
      ) values (
        v_receipt.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
        'goods_receipt', (select auth.uid()),
        v_receipt.warehouse_id, v_batch_id, 'goods_receipt', v_receipt.id, v_line.unit_cost,
        'goods_receipt:' || v_receipt.id::text || ':' || v_line.inventory_item_id::text
      );
    elsif v_has_wh then
      insert into public.inventory_movements (
        workspace_id, inventory_item_id, movement_type, quantity, reason, created_by, warehouse_id,
        idempotency_key
      ) values (
        v_receipt.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
        'goods_receipt', (select auth.uid()), v_receipt.warehouse_id,
        'goods_receipt:' || v_receipt.id::text || ':' || v_line.inventory_item_id::text
      );
    else
      insert into public.inventory_movements (
        workspace_id, inventory_item_id, movement_type, quantity, reason, created_by,
        idempotency_key
      ) values (
        v_receipt.workspace_id, v_line.inventory_item_id, 'adjustment', v_line.quantity,
        'goods_receipt', (select auth.uid()),
        'goods_receipt:' || v_receipt.id::text || ':' || v_line.inventory_item_id::text
      );
    end if;

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

-- =====================================================================
-- PART E — One-time / customer-supplied order materials (nullable catalog id)
-- =====================================================================
alter table public.order_materials
  alter column inventory_item_id drop not null;

alter table public.order_materials
  drop constraint if exists order_materials_order_item_unique;

create unique index if not exists order_materials_order_catalog_item_uidx
  on public.order_materials (order_id, inventory_item_id)
  where inventory_item_id is not null;

alter table public.order_materials
  add column if not exists supply_source text;

do $e_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_materials_supply_source_check'
  ) then
    alter table public.order_materials
      add constraint order_materials_supply_source_check
      check (supply_source is null or supply_source in ('catalog','one_time','customer'));
  end if;
end
$e_check$;

update public.order_materials
set supply_source = case when inventory_item_id is null then 'one_time' else 'catalog' end
where supply_source is null;

alter table public.order_materials
  alter column supply_source set default 'catalog';

create or replace function public.sync_order_materials(p_order_id uuid, p_materials jsonb)
returns setof public.order_materials
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_workspace_id uuid;
  v_elem jsonb;
  v_item_id uuid;
  v_line_id uuid;
  v_qty numeric(12,2);
  v_name text;
  v_price numeric(10,2);
  v_source text;
  v_existing record;
  v_outstanding numeric(12,2);
  v_service_total numeric(12,2);
  v_material_total numeric(12,2);
  v_keep_ids uuid[] := array[]::uuid[];
  v_new_id uuid;
  v_catalog_keys text[] := array[]::text[];
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    raise exception 'materials must be a JSON array' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id from public.orders o where o.id = p_order_id;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  perform 1 from public.orders where id = p_order_id for update;

  -- Pass 1: validate + apply catalog consolidations into a temp table.
  create temporary table if not exists pg_temp.sync_mat (
    line_id uuid,
    inventory_item_id uuid,
    item_name text,
    price numeric(10,2),
    quantity numeric(12,2),
    supply_source text not null
  ) on commit drop;
  -- pg-safeupdate rejects DELETE without a WHERE clause (error: DELETE requires a WHERE clause).
  delete from pg_temp.sync_mat where true;

  for v_elem in select value from jsonb_array_elements(p_materials)
  loop
    begin
      v_qty := round((v_elem ->> 'quantity')::numeric, 2);
    exception when others then
      raise exception 'Invalid material quantity' using errcode = '22P02';
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Material quantity must be greater than 0' using errcode = '22023';
    end if;

    v_source := coalesce(nullif(v_elem ->> 'supply_source', ''), 'catalog');
    if v_source not in ('catalog','one_time','customer') then
      raise exception 'Invalid supply_source' using errcode = '22023';
    end if;

    v_item_id := null;
    if (v_elem ->> 'inventory_item_id') is not null and (v_elem ->> 'inventory_item_id') <> '' then
      begin
        v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
      exception when others then
        raise exception 'Invalid inventory_item_id' using errcode = '22P02';
      end;
    end if;

    v_line_id := null;
    if (v_elem ->> 'line_id') is not null and (v_elem ->> 'line_id') <> '' then
      begin
        v_line_id := (v_elem ->> 'line_id')::uuid;
      exception when others then
        raise exception 'Invalid line_id' using errcode = '22P02';
      end;
    end if;

    if v_source = 'catalog' then
      if v_item_id is null then
        raise exception 'inventory_item_id is required' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.inventory_items i
        where i.id = v_item_id and i.workspace_id = v_workspace_id
      ) then
        raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
      end if;
      -- consolidate catalog duplicates in temp
      if exists (select 1 from pg_temp.sync_mat s where s.inventory_item_id = v_item_id and s.supply_source = 'catalog') then
        update pg_temp.sync_mat
           set quantity = quantity + v_qty
         where inventory_item_id = v_item_id and supply_source = 'catalog';
      else
        insert into pg_temp.sync_mat(line_id, inventory_item_id, item_name, price, quantity, supply_source)
        values (null, v_item_id, null, null, v_qty, 'catalog');
      end if;
      v_catalog_keys := array_append(v_catalog_keys, v_item_id::text);
    else
      v_name := nullif(trim(coalesce(v_elem ->> 'item_name', '')), '');
      if v_name is null then
        raise exception 'item_name is required for non-catalog materials' using errcode = '22023';
      end if;
      begin
        v_price := coalesce((v_elem ->> 'price')::numeric, 0);
      exception when others then
        raise exception 'Invalid material price' using errcode = '22P02';
      end;
      if v_price < 0 then
        raise exception 'Material price cannot be negative' using errcode = '22023';
      end if;
      insert into pg_temp.sync_mat(line_id, inventory_item_id, item_name, price, quantity, supply_source)
      values (v_line_id, null, v_name, v_price::numeric(10,2), v_qty, v_source);
    end if;
  end loop;

  -- Outstanding issued guards for existing rows.
  for v_existing in
    select id, inventory_item_id, quantity, quantity_issued, quantity_returned, supply_source
    from public.order_materials where order_id = p_order_id
  loop
    v_outstanding := coalesce(v_existing.quantity_issued, 0) - coalesce(v_existing.quantity_returned, 0);
    if v_existing.inventory_item_id is not null then
      select coalesce(sum(s.quantity), 0) into v_qty
      from pg_temp.sync_mat s
      where s.inventory_item_id = v_existing.inventory_item_id and s.supply_source = 'catalog';
      if v_qty = 0 and v_outstanding > 0 then
        raise exception 'Cannot remove a material with outstanding issued quantity' using errcode = 'P0001';
      end if;
      if v_qty > 0 and v_qty < coalesce(v_existing.quantity_issued, 0) then
        raise exception 'Requested quantity cannot be less than already issued quantity' using errcode = 'P0001';
      end if;
    else
      if not exists (select 1 from pg_temp.sync_mat s where s.line_id = v_existing.id) then
        if v_outstanding > 0 then
          raise exception 'Cannot remove a material with outstanding issued quantity' using errcode = 'P0001';
        end if;
      else
        select s.quantity into v_qty from pg_temp.sync_mat s where s.line_id = v_existing.id;
        if v_qty < coalesce(v_existing.quantity_issued, 0) then
          raise exception 'Requested quantity cannot be less than already issued quantity' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end loop;

  -- Delete removed freeform / unused catalog lines (no outstanding).
  delete from public.order_materials om
  where om.order_id = p_order_id
    and coalesce(om.quantity_issued, 0) = 0
    and coalesce(om.quantity_returned, 0) = 0
    and (
      (om.inventory_item_id is not null and not exists (
         select 1 from pg_temp.sync_mat s where s.inventory_item_id = om.inventory_item_id and s.supply_source = 'catalog'
       ))
      or
      (om.inventory_item_id is null and not exists (
         select 1 from pg_temp.sync_mat s where s.line_id = om.id
       ))
    );

  -- Upsert catalog lines.
  for v_existing in select * from pg_temp.sync_mat where supply_source = 'catalog'
  loop
    if exists (
      select 1 from public.order_materials om
      where om.order_id = p_order_id and om.inventory_item_id = v_existing.inventory_item_id
    ) then
      update public.order_materials
         set quantity = v_existing.quantity,
             supply_source = 'catalog'
       where order_id = p_order_id and inventory_item_id = v_existing.inventory_item_id
       returning id into v_new_id;
    else
      select i.name, coalesce(i.selling_price, 0)::numeric(10,2)
        into v_name, v_price
      from public.inventory_items i where i.id = v_existing.inventory_item_id;
      insert into public.order_materials (
        order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned, supply_source
      ) values (
        p_order_id, v_existing.inventory_item_id, v_name, v_price, v_existing.quantity, 0, 0, 'catalog'
      ) returning id into v_new_id;
    end if;
    v_keep_ids := array_append(v_keep_ids, v_new_id);
  end loop;

  -- Upsert freeform lines.
  for v_existing in select * from pg_temp.sync_mat where supply_source in ('one_time','customer')
  loop
    if v_existing.line_id is not null and exists (
      select 1 from public.order_materials om where om.id = v_existing.line_id and om.order_id = p_order_id
    ) then
      update public.order_materials
         set item_name = v_existing.item_name,
             price = v_existing.price,
             quantity = v_existing.quantity,
             inventory_item_id = null,
             supply_source = v_existing.supply_source
       where id = v_existing.line_id
       returning id into v_new_id;
    else
      insert into public.order_materials (
        order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned, supply_source
      ) values (
        p_order_id, null, v_existing.item_name, v_existing.price, v_existing.quantity, 0, 0, v_existing.supply_source
      ) returning id into v_new_id;
    end if;
    v_keep_ids := array_append(v_keep_ids, v_new_id);
  end loop;

  select coalesce(sum(os.price * os.quantity), 0) into v_service_total
  from public.order_services os where os.order_id = p_order_id;
  select coalesce(sum(om.price * om.quantity), 0) into v_material_total
  from public.order_materials om where om.order_id = p_order_id;

  update public.orders
     set total_price = v_service_total + v_material_total, updated_at = now()
   where id = p_order_id;

  return query
  select om.* from public.order_materials om
  where om.order_id = p_order_id
  order by om.created_at asc, om.id asc;
end;
$function$;

revoke all on function public.sync_order_materials(uuid, jsonb) from public, anon;
grant execute on function public.sync_order_materials(uuid, jsonb) to authenticated, service_role;

-- =====================================================================
-- Post-conditions (abort → rollback)
-- =====================================================================
do $post$
begin
  if not exists (
    select 1 from pg_proc p where p.oid = to_regprocedure('public.inventory_items_clear_denied_stock_children()') and p.prosecdef
  ) then raise exception 'Post: delete cleanup not SECURITY DEFINER'; end if;

  if position('has_movements' in pg_get_functiondef('public.inventory_items_clear_denied_stock_children()'::regprocedure)) = 0 then
    raise exception 'Post: delete cleanup missing movement guard';
  end if;

  if position('v_parent_old' in pg_get_functiondef('public.crm_guard_posted_document_lines()'::regprocedure)) = 0 then
    raise exception 'Post: posted-line guard missing OLD parent check';
  end if;

  if to_regprocedure('public.crm_guard_receipt_header_immutable()') is null then
    raise exception 'Post: receipt header guard missing';
  end if;

  if position('goods_receipt' in pg_get_functiondef('public.crm_post_goods_receipt(uuid)'::regprocedure)) = 0 then
    raise exception 'Post: receipt post missing movement ledger reason';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='order_materials'
      and column_name='inventory_item_id' and is_nullable='NO'
  ) then
    raise exception 'Post: order_materials.inventory_item_id still NOT NULL';
  end if;

  if has_table_privilege('authenticated', 'public.warehouse_stock', 'delete') then
    raise exception 'Post: authenticated must not DELETE warehouse_stock';
  end if;
end
$post$;

commit;
