-- Warehouse issue / return workflow.
--
-- Depends on:
--   20260929000000_production_baseline.sql
--   20261018170000_order_materials_stock.sql (order_materials + sync_order_materials)
--
-- Business rules:
--   - sync_order_materials only syncs *requested* lines. It does NOT change inventory stock.
--   - Stock decreases only via issue_order_materials; increases only via return_order_materials.
--   - Order cancel / edit / delete never silently restore issued stock.
--   - Orders with outstanding issued (issued - returned > 0) cannot be deleted.
--   - inventory_items.quantity remains the live physical on-hand stock, kept consistent with the ledger.
--
-- Authorization for issue/return: workspace owner, admin, or manager.

-- ---------------------------------------------------------------------------
-- Movement ledger
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  inventory_item_id uuid not null,
  order_id uuid,
  order_material_id uuid,
  movement_type text not null,
  quantity numeric(12,2) not null,
  reason text,
  idempotency_key text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  constraint inventory_movements_pkey primary key (id),
  constraint inventory_movements_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint inventory_movements_inventory_item_id_fkey foreign key (inventory_item_id) references public.inventory_items(id) on delete restrict,
  -- SET NULL keeps the immutable ledger row after order deletion; outstanding issued stock still blocks delete via trigger.
  constraint inventory_movements_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null,
  constraint inventory_movements_order_material_id_fkey foreign key (order_material_id) references public.order_materials(id) on delete set null,
  constraint inventory_movements_type_check check (movement_type = any (array['issue'::text, 'return'::text, 'adjustment'::text])),
  constraint inventory_movements_quantity_check check (quantity > 0::numeric),
  constraint inventory_movements_reason_check check (reason is null or char_length(reason) <= 500)
);

-- One movement per (workspace, batch key, item) so multi-line issue/return batches are idempotent.
create unique index inventory_movements_workspace_idempotency_uidx
  on public.inventory_movements (workspace_id, idempotency_key, inventory_item_id)
  where idempotency_key is not null;

create index inventory_movements_workspace_created_idx
  on public.inventory_movements (workspace_id, created_at desc);

create index inventory_movements_order_id_idx
  on public.inventory_movements (order_id);

create index inventory_movements_item_id_idx
  on public.inventory_movements (inventory_item_id);

alter table public.inventory_movements enable row level security;

create policy "Members can view workspace inventory movements"
  on public.inventory_movements
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on table public.inventory_movements from public, anon, authenticated, service_role;
grant select on table public.inventory_movements to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.inventory_movements to service_role;

-- ---------------------------------------------------------------------------
-- order_materials: requested qty stays in quantity; track issued/returned
-- ---------------------------------------------------------------------------
alter table public.order_materials
  alter column quantity type numeric(12,2) using quantity::numeric(12,2);

alter table public.order_materials
  add column if not exists quantity_issued numeric(12,2) default 0 not null,
  add column if not exists quantity_returned numeric(12,2) default 0 not null;

alter table public.order_materials
  drop constraint if exists order_materials_quantity_check;

alter table public.order_materials
  add constraint order_materials_quantity_check check (quantity > 0::numeric);

alter table public.order_materials
  add constraint order_materials_quantity_issued_check check (quantity_issued >= 0::numeric);

alter table public.order_materials
  add constraint order_materials_quantity_returned_check check (quantity_returned >= 0::numeric);

alter table public.order_materials
  add constraint order_materials_issued_vs_returned_check check (quantity_returned <= quantity_issued);

alter table public.order_materials
  add constraint order_materials_issued_vs_requested_check check (quantity_issued <= quantity);

-- ---------------------------------------------------------------------------
-- Drop stock restore on order delete; block delete with outstanding issued stock
-- ---------------------------------------------------------------------------
drop trigger if exists orders_restore_materials_stock on public.orders;
drop function if exists public.restore_order_materials_stock_on_order_delete();

create or replace function public.prevent_order_delete_with_issued_materials()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if exists (
    select 1
    from public.order_materials om
    where om.order_id = old.id
      and (om.quantity_issued - om.quantity_returned) > 0::numeric
  ) then
    raise exception 'Cannot delete an order with outstanding issued materials. Return issued stock first.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$function$;

create trigger orders_prevent_delete_with_issued_materials
  before delete on public.orders
  for each row
  execute function public.prevent_order_delete_with_issued_materials();

revoke all on function public.prevent_order_delete_with_issued_materials() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sync_order_materials: requested lines only (no inventory quantity changes)
-- ---------------------------------------------------------------------------
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
  v_qty numeric(12,2);
  v_elem jsonb;
  v_existing record;
  v_item_name text;
  v_price numeric(10,2);
  v_service_total numeric(12,2);
  v_material_total numeric(12,2);
  v_outstanding numeric(12,2);
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
      v_qty := round((v_elem ->> 'quantity')::numeric, 2);
    exception
      when others then
        raise exception 'Invalid material quantity' using errcode = '22P02';
    end;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Material quantity must be greater than 0' using errcode = '22023';
    end if;

    if v_desired ? v_item_id::text then
      v_desired := jsonb_set(
        v_desired,
        array[v_item_id::text],
        to_jsonb(round(((v_desired ->> v_item_id::text)::numeric) + v_qty, 2))
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
    v_qty := coalesce((v_desired ->> v_existing.inventory_item_id::text)::numeric, 0);

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
    select key::uuid, value::text::numeric from jsonb_each(v_desired)
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

-- ---------------------------------------------------------------------------
-- issue_order_materials
-- p_lines: [{ "inventory_item_id": uuid, "quantity": number }]
-- remaining_to_issue = requested - quantity_issued
-- ---------------------------------------------------------------------------
create or replace function public.issue_order_materials(
  p_order_id uuid,
  p_lines jsonb,
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
  v_qty numeric(12,2);
  v_line record;
  v_available numeric;
  v_remaining numeric;
  v_movement_ids uuid[] := array[]::uuid[];
  v_movement_id uuid;
  v_existing_id uuid;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'issue lines must be a non-empty JSON array' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id from public.orders o where o.id = p_order_id;
  if v_workspace_id is null then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role is null or v_role not in ('owner', 'admin', 'manager') then
    raise exception 'You do not have permission to issue warehouse materials.' using errcode = '42501';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select id into v_existing_id
    from public.inventory_movements
    where workspace_id = v_workspace_id
      and idempotency_key = btrim(p_idempotency_key)
      and movement_type = 'issue'
      and order_id = p_order_id
    limit 1;
    if v_existing_id is not null then
      return query
      select m.* from public.inventory_movements m
      where m.workspace_id = v_workspace_id
        and m.idempotency_key = btrim(p_idempotency_key)
        and m.movement_type = 'issue'
        and m.order_id = p_order_id
      order by m.created_at, m.id;
      return;
    end if;
  end if;

  -- Lock materials then inventory in deterministic order.
  perform 1
  from public.order_materials om
  where om.order_id = p_order_id
  order by om.inventory_item_id
  for update of om;

  perform 1
  from public.inventory_items i
  where i.workspace_id = v_workspace_id
    and i.id in (
      select (value ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(p_lines)
    )
  order by i.id
  for update of i;

  for v_elem in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
      v_qty := round((v_elem ->> 'quantity')::numeric, 2);
    exception
      when others then
        raise exception 'Invalid issue line payload' using errcode = '22P02';
    end;

    if v_item_id is null or v_qty is null or v_qty <= 0 then
      raise exception 'Each issue line requires inventory_item_id and quantity > 0' using errcode = '22023';
    end if;

    select * into v_line
    from public.order_materials om
    where om.order_id = p_order_id and om.inventory_item_id = v_item_id
    for update;

    if not found then
      raise exception 'Material is not on this order' using errcode = 'P0001';
    end if;

    v_remaining := v_line.quantity - v_line.quantity_issued;
    if v_qty > v_remaining then
      raise exception 'Cannot issue more than the remaining requested quantity' using errcode = 'P0001';
    end if;

    select quantity into v_available
    from public.inventory_items
    where id = v_item_id
    for update;

    if coalesce(v_available, 0) < v_qty then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;

    update public.inventory_items
    set quantity = quantity - v_qty, updated_at = now()
    where id = v_item_id;

    update public.order_materials
    set quantity_issued = quantity_issued + v_qty
    where id = v_line.id;

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, order_id, order_material_id,
      movement_type, quantity, reason, idempotency_key, created_by
    ) values (
      v_workspace_id, v_item_id, p_order_id, v_line.id,
      'issue', v_qty, null,
      case when p_idempotency_key is null or btrim(p_idempotency_key) = '' then null else btrim(p_idempotency_key) end,
      auth.uid()
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

-- ---------------------------------------------------------------------------
-- return_order_materials
-- remaining_to_return = quantity_issued - quantity_returned
-- ---------------------------------------------------------------------------
create or replace function public.return_order_materials(
  p_order_id uuid,
  p_lines jsonb,
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
  v_qty numeric(12,2);
  v_line record;
  v_remaining numeric;
  v_movement_ids uuid[] := array[]::uuid[];
  v_movement_id uuid;
  v_existing_id uuid;
  v_reason text;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'return lines must be a non-empty JSON array' using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Return reason is too long' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id from public.orders o where o.id = p_order_id;
  if v_workspace_id is null then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role is null or v_role not in ('owner', 'admin', 'manager') then
    raise exception 'You do not have permission to return warehouse materials.' using errcode = '42501';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select id into v_existing_id
    from public.inventory_movements
    where workspace_id = v_workspace_id
      and idempotency_key = btrim(p_idempotency_key)
      and movement_type = 'return'
      and order_id = p_order_id
    limit 1;
    if v_existing_id is not null then
      return query
      select m.* from public.inventory_movements m
      where m.workspace_id = v_workspace_id
        and m.idempotency_key = btrim(p_idempotency_key)
        and m.movement_type = 'return'
        and m.order_id = p_order_id
      order by m.created_at, m.id;
      return;
    end if;
  end if;

  perform 1
  from public.order_materials om
  where om.order_id = p_order_id
  order by om.inventory_item_id
  for update of om;

  perform 1
  from public.inventory_items i
  where i.workspace_id = v_workspace_id
    and i.id in (
      select (value ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(p_lines)
    )
  order by i.id
  for update of i;

  for v_elem in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_item_id := (v_elem ->> 'inventory_item_id')::uuid;
      v_qty := round((v_elem ->> 'quantity')::numeric, 2);
    exception
      when others then
        raise exception 'Invalid return line payload' using errcode = '22P02';
    end;

    if v_item_id is null or v_qty is null or v_qty <= 0 then
      raise exception 'Each return line requires inventory_item_id and quantity > 0' using errcode = '22023';
    end if;

    select * into v_line
    from public.order_materials om
    where om.order_id = p_order_id and om.inventory_item_id = v_item_id
    for update;

    if not found then
      raise exception 'Material is not on this order' using errcode = 'P0001';
    end if;

    v_remaining := v_line.quantity_issued - v_line.quantity_returned;
    if v_qty > v_remaining then
      raise exception 'Cannot return more than the outstanding issued quantity' using errcode = 'P0001';
    end if;

    update public.inventory_items
    set quantity = quantity + v_qty, updated_at = now()
    where id = v_item_id;

    update public.order_materials
    set quantity_returned = quantity_returned + v_qty
    where id = v_line.id;

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, order_id, order_material_id,
      movement_type, quantity, reason, idempotency_key, created_by
    ) values (
      v_workspace_id, v_item_id, p_order_id, v_line.id,
      'return', v_qty, v_reason,
      case when p_idempotency_key is null or btrim(p_idempotency_key) = '' then null else btrim(p_idempotency_key) end,
      auth.uid()
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

revoke all on function public.issue_order_materials(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.issue_order_materials(uuid, jsonb, text) to authenticated, service_role;

revoke all on function public.return_order_materials(uuid, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.return_order_materials(uuid, jsonb, text, text) to authenticated, service_role;
