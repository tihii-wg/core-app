-- Order material lines with atomic inventory deduction/restoration.
--
-- Depends on 20260929000000_production_baseline.sql (public.orders, public.order_services,
-- public.inventory_items, public.is_workspace_member(uuid)).
--
-- Stock policy:
--   - Creating/editing material lines deducts or restores stock via sync_order_materials.
--   - Deleting an order restores that order's material quantities (BEFORE DELETE trigger).
--   - Changing status (cancelled, reopened, paid, etc.) does NOT deduct or restore stock.
--
-- Clients may SELECT order_materials for orders in their workspace. All writes go through
-- public.sync_order_materials (SECURITY DEFINER). Authenticated has no INSERT/UPDATE/DELETE.

create table public.order_materials (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  inventory_item_id uuid not null,
  item_name text not null,
  price numeric(10,2) not null,
  quantity integer not null,
  created_at timestamp with time zone default now() not null,
  constraint order_materials_pkey primary key (id),
  constraint order_materials_order_id_fkey foreign key (order_id) references public.orders(id) on delete cascade,
  constraint order_materials_inventory_item_id_fkey foreign key (inventory_item_id) references public.inventory_items(id) on delete no action,
  constraint order_materials_quantity_check check (quantity > 0),
  constraint order_materials_price_check check (price >= 0::numeric),
  constraint order_materials_order_item_unique unique (order_id, inventory_item_id)
);

create index order_materials_order_id_idx on public.order_materials using btree (order_id);
create index order_materials_inventory_item_id_idx on public.order_materials using btree (inventory_item_id);

alter table public.order_materials enable row level security;

create policy "Members can view order materials"
  on public.order_materials
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_materials.order_id
        and public.is_workspace_member(o.workspace_id)
    )
  );

revoke all on table public.order_materials from public, anon, authenticated, service_role;
grant select on table public.order_materials to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.order_materials to service_role;

-- ---------------------------------------------------------------------------
-- Restore stock when an order is deleted (before CASCADE removes material rows).
-- Idempotent for a given delete: materials are read once, stock restored, rows
-- remain until CASCADE; a second delete of the same order cannot run.
-- ---------------------------------------------------------------------------
create or replace function public.restore_order_materials_stock_on_order_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  material record;
begin
  for material in
    select inventory_item_id, quantity
    from public.order_materials
    where order_id = old.id
    order by inventory_item_id
  loop
    update public.inventory_items
    set
      quantity = quantity + material.quantity,
      updated_at = now()
    where id = material.inventory_item_id;
  end loop;

  return old;
end;
$function$;

create trigger orders_restore_materials_stock
  before delete on public.orders
  for each row
  execute function public.restore_order_materials_stock_on_order_delete();

revoke all on function public.restore_order_materials_stock_on_order_delete() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atomic material sync + stock adjustment.
-- p_materials: JSON array of { "inventory_item_id": uuid, "quantity": int > 0,
--   optional "item_name", optional "price" }. Duplicate item ids are consolidated
-- by summing quantities. Existing lines keep their item_name/price snapshots;
-- new lines snapshot inventory name and selling_price (NULL -> 0). Markup is unused.
-- ---------------------------------------------------------------------------
create or replace function public.sync_order_materials(p_order_id uuid, p_materials jsonb)
returns setof public.order_materials
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_workspace_id uuid;
  v_desired jsonb;
  v_item_id uuid;
  v_qty integer;
  v_elem jsonb;
  v_current record;
  v_desired_qty integer;
  v_delta integer;
  v_available numeric;
  v_item_name text;
  v_price numeric(10,2);
  v_service_total numeric(12,2);
  v_material_total numeric(12,2);
begin
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

  -- Consolidate duplicates by inventory_item_id (sum quantities).
  v_desired := '{}'::jsonb;
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
      v_qty := (v_elem ->> 'quantity')::integer;
    exception
      when others then
        raise exception 'Invalid material quantity' using errcode = '22P02';
    end;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Material quantity must be at least 1' using errcode = '22023';
    end if;

    if v_desired ? v_item_id::text then
      v_desired := jsonb_set(
        v_desired,
        array[v_item_id::text],
        to_jsonb(((v_desired ->> v_item_id::text)::integer) + v_qty)
      );
    else
      v_desired := v_desired || jsonb_build_object(v_item_id::text, v_qty);
    end if;
  end loop;

  -- Lock inventory rows for desired + currently linked items (deterministic order).
  perform 1
  from public.inventory_items i
  where i.workspace_id = v_workspace_id
    and (
      i.id::text in (select jsonb_object_keys(v_desired))
      or i.id in (select om.inventory_item_id from public.order_materials om where om.order_id = p_order_id)
    )
  order by i.id
  for update of i;

  -- Reject items missing or outside this workspace.
  for v_item_id in select key::uuid from jsonb_each(v_desired)
  loop
    if not exists (
      select 1
      from public.inventory_items i
      where i.id = v_item_id
        and i.workspace_id = v_workspace_id
    ) then
      raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
    end if;
  end loop;

  -- Apply stock deltas (desired - current).
  for v_current in
    select inventory_item_id, quantity
    from public.order_materials
    where order_id = p_order_id
  loop
    v_desired_qty := coalesce((v_desired ->> v_current.inventory_item_id::text)::integer, 0);
    v_delta := v_desired_qty - v_current.quantity;

    if v_delta <> 0 then
      select quantity into v_available
      from public.inventory_items
      where id = v_current.inventory_item_id
      for update;

      if v_delta > 0 and coalesce(v_available, 0) < v_delta then
        raise exception 'insufficient_stock' using errcode = 'P0001';
      end if;

      update public.inventory_items
      set
        quantity = quantity - v_delta,
        updated_at = now()
      where id = v_current.inventory_item_id;
    end if;

    v_desired := v_desired - v_current.inventory_item_id::text;
  end loop;

  -- Remaining keys in v_desired are new lines — deduct full quantity.
  for v_item_id, v_qty in
    select key::uuid, value::text::integer from jsonb_each(v_desired)
  loop
    select quantity into v_available
    from public.inventory_items
    where id = v_item_id
    for update;

    if coalesce(v_available, 0) < v_qty then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;

    update public.inventory_items
    set
      quantity = quantity - v_qty,
      updated_at = now()
    where id = v_item_id;
  end loop;

  -- Rebuild desired map for row upsert (re-parse from original after mutations above).
  v_desired := '{}'::jsonb;
  for v_elem in select value from jsonb_array_elements(p_materials)
  loop
    v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
    v_qty := (v_elem ->> 'quantity')::integer;
    if v_desired ? v_item_id::text then
      v_desired := jsonb_set(
        v_desired,
        array[v_item_id::text],
        to_jsonb(((v_desired ->> v_item_id::text)::integer) + v_qty)
      );
    else
      v_desired := v_desired || jsonb_build_object(v_item_id::text, v_qty);
    end if;
  end loop;

  -- Remove lines no longer desired (stock already restored above).
  delete from public.order_materials om
  where om.order_id = p_order_id
    and not (v_desired ? om.inventory_item_id::text);

  -- Upsert remaining / new lines.
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

      insert into public.order_materials (order_id, inventory_item_id, item_name, price, quantity)
      values (p_order_id, v_item_id, v_item_name, v_price, v_qty);
    end if;
  end loop;

  select coalesce(sum(os.price * os.quantity), 0)
  into v_service_total
  from public.order_services os
  where os.order_id = p_order_id;

  select coalesce(sum(om.price * om.quantity), 0)
  into v_material_total
  from public.order_materials om
  where om.order_id = p_order_id;

  update public.orders
  set
    total_price = v_service_total + v_material_total,
    updated_at = now()
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
