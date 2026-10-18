-- =============================================================================
-- MANUAL repair — restore public.sync_order_materials only
-- Source body: supabase/migrations/20261018180000_warehouse_issue_return.sql
--   (request-only sync; NOT the stock-mutating 20261018170000 implementation)
--
-- Purpose:
--   Authenticated workspace members can save *requested* materials on an order
--   when the RPC is missing. This function does NOT deduct or restore warehouse
--   stock. Stock changes belong to issue_order_materials / return_order_materials
--   (not included here).
--
-- Does NOT:
--   - create/alter tables, columns, indexes, constraints, triggers, or RLS
--   - touch public.inventory_movements or public.inventory_items.quantity
--   - install issue/return RPCs
--
-- Live quantity columns are INTEGER. Non-integer payload quantities are rejected
-- (no silent Math.round / truncating into the column).
--
-- Prerequisites (operator must verify; this script does not check them):
--   - public.order_materials exists with quantity / quantity_issued / quantity_returned
--   - public.is_workspace_member(uuid) exists
--   - public.orders, public.order_services, public.inventory_items exist
--
-- Apply manually in the SQL Editor when ready. This file is not auto-migrated.
-- =============================================================================

create or replace function public.sync_order_materials(p_order_id uuid, p_materials jsonb)
returns setof public.order_materials
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_workspace_id uuid;
  v_desired jsonb := '{}'::jsonb;
  v_item_id uuid;
  v_qty integer;
  v_raw numeric;
  v_elem jsonb;
  v_existing record;
  v_item_name text;
  v_price numeric(10,2);
  v_service_total numeric(12,2);
  v_material_total numeric(12,2);
  v_outstanding integer;
begin
  -- Saves requested order_materials lines only; does not change inventory stock.
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;

  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    raise exception 'materials must be a JSON array' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id
  from public.orders o
  where o.id = p_order_id;

  if v_workspace_id is null then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  for v_elem in select value from jsonb_array_elements(p_materials)
  loop
    begin
      v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
    exception
      when others then
        raise exception 'Invalid inventory_item_id' using errcode = '22P02';
    end;

    if v_item_id is null then
      raise exception 'inventory_item_id is required' using errcode = '22023';
    end if;

    begin
      v_raw := (v_elem ->> 'quantity')::numeric;
    exception
      when others then
        raise exception 'Invalid material quantity' using errcode = '22P02';
    end;

    if v_raw is null or v_raw <= 0 then
      raise exception 'Material quantity must be greater than 0' using errcode = '22023';
    end if;

    -- Reject fractions; live order_materials.quantity is INTEGER.
    if v_raw <> trunc(v_raw) then
      raise exception 'Material quantity must be a whole number' using errcode = '22023';
    end if;

    if v_raw > 2147483647::numeric then
      raise exception 'Material quantity is too large' using errcode = '22023';
    end if;

    v_qty := trunc(v_raw)::integer;

    if v_desired ? v_item_id::text then
      -- Sum in numeric first so duplicate lines cannot overflow INTEGER silently.
      v_raw := (v_desired ->> v_item_id::text)::numeric + v_qty;
      if v_raw > 2147483647::numeric then
        raise exception 'Material quantity is too large' using errcode = '22023';
      end if;
      v_desired := jsonb_set(
        v_desired,
        array[v_item_id::text],
        to_jsonb(v_raw::integer)
      );
    else
      v_desired := v_desired || jsonb_build_object(v_item_id::text, v_qty);
    end if;
  end loop;

  for v_item_id in select key::uuid from jsonb_each(v_desired)
  loop
    if not exists (
      select 1 from public.inventory_items i
      where i.id = v_item_id and i.workspace_id = v_workspace_id
    ) then
      raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
    end if;
  end loop;

  -- Cannot remove or reduce requested below outstanding issued.
  for v_existing in
    select id, inventory_item_id, quantity, quantity_issued, quantity_returned
    from public.order_materials
    where order_id = p_order_id
  loop
    v_outstanding := v_existing.quantity_issued - v_existing.quantity_returned;
    v_qty := coalesce((v_desired ->> v_existing.inventory_item_id::text)::integer, 0);

    if v_qty = 0 and v_outstanding > 0 then
      raise exception 'Cannot remove a material with outstanding issued quantity' using errcode = 'P0001';
    end if;

    if v_qty > 0 and v_qty < v_existing.quantity_issued then
      raise exception 'Requested quantity cannot be less than already issued quantity' using errcode = 'P0001';
    end if;
  end loop;

  delete from public.order_materials om
  where om.order_id = p_order_id
    and not (v_desired ? om.inventory_item_id::text)
    and om.quantity_issued = 0
    and om.quantity_returned = 0;

  for v_item_id, v_qty in
    select key::uuid, value::text::integer from jsonb_each(v_desired)
  loop
    if exists (
      select 1 from public.order_materials om
      where om.order_id = p_order_id and om.inventory_item_id = v_item_id
    ) then
      update public.order_materials
      set quantity = v_qty
      where order_id = p_order_id
        and inventory_item_id = v_item_id;
    else
      select i.name, coalesce(i.selling_price, 0)::numeric(10,2)
      into v_item_name, v_price
      from public.inventory_items i
      where i.id = v_item_id;

      -- quantity_issued / quantity_returned start at 0; stock is unchanged.
      insert into public.order_materials (order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned)
      values (p_order_id, v_item_id, v_item_name, v_price, v_qty, 0, 0);
    end if;
  end loop;

  select coalesce(sum(os.price * os.quantity), 0) into v_service_total
  from public.order_services os where os.order_id = p_order_id;

  select coalesce(sum(om.price * om.quantity), 0) into v_material_total
  from public.order_materials om where om.order_id = p_order_id;

  update public.orders
  set total_price = v_service_total + v_material_total, updated_at = now()
  where id = p_order_id;

  return query
  select om.*
  from public.order_materials om
  where om.order_id = p_order_id
  order by om.created_at asc, om.id asc;
end;
$function$;

revoke all on function public.sync_order_materials(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sync_order_materials(uuid, jsonb) to authenticated, service_role;
