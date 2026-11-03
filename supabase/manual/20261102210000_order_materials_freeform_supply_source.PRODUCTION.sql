-- =====================================================================
-- Core App — Order materials: one-time / customer-supplied persistence
-- MANUAL ADDITIVE SCRIPT — APPLY only after explicit owner authorization.
--
-- Fixes ONLY order-line persistence for non-catalog materials.
-- Does NOT touch inventory catalog create/edit, goods receipts, batches,
-- warehouse stock tables, issue/return RPC bodies, invoices, or finance.
--
-- Why (current MAIN defect):
--   - order_materials.inventory_item_id is NOT NULL
--   - unique (order_id, inventory_item_id) forbids the freeform model
--   - sync_order_materials rejects null inventory_item_id (22023)
--   App already sends { inventory_item_id: null, item_name, price, quantity,
--   supply_source: 'one_time'|'customer' } and expects order-only lines.
--
-- Based on:
--   - Live app payload: src/services/apiOrders.ts syncOrderMaterialsRpc
--   - Live integer quantity semantics: supabase/manual/sync_order_materials_repair.sql
--   - Constraint names observed on MAIN: order_materials_order_inventory_unique
--     (and historical order_materials_order_item_unique from 20261018170000)
--   - Freeform sync design reviewed against PART E in
--     20261102200000_warehouse_integrity_inventory_safety.PRODUCTION.sql
--     (reused only the necessary freeform pieces; quantity kept INTEGER-safe)
--
-- Does NOT execute from the app. One transaction; any failure rolls back.
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
    'orders', 'order_services', 'order_materials', 'inventory_items'
  ]) as t
  where to_regclass('public.' || t) is null;

  if v_missing is not null then
    raise exception 'Preflight: missing tables: %', v_missing;
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight: is_workspace_member(uuid) missing';
  end if;

  if to_regprocedure('public.sync_order_materials(uuid, jsonb)') is null then
    raise exception 'Preflight: sync_order_materials(uuid, jsonb) missing — restore it before applying freeform support';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_materials'
      and column_name = 'inventory_item_id'
  ) then
    raise exception 'Preflight: order_materials.inventory_item_id missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_materials'
      and column_name = 'item_name'
  ) then
    raise exception 'Preflight: order_materials.item_name missing';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- 1. Allow null catalog id on non-catalog lines
-- ---------------------------------------------------------------------
alter table public.order_materials
  alter column inventory_item_id drop not null;

-- Historical unique names (migration vs live rename). Drop whichever exists.
alter table public.order_materials
  drop constraint if exists order_materials_order_item_unique;

alter table public.order_materials
  drop constraint if exists order_materials_order_inventory_unique;

-- Catalog uniqueness only when an inventory item is linked (NULLs allowed for freeform).
drop index if exists public.order_materials_order_catalog_item_uidx;

create unique index order_materials_order_catalog_item_uidx
  on public.order_materials (order_id, inventory_item_id)
  where inventory_item_id is not null;

-- ---------------------------------------------------------------------
-- 2. supply_source discriminator
-- ---------------------------------------------------------------------
alter table public.order_materials
  add column if not exists supply_source text;

do $supply_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_materials_supply_source_check'
      and conrelid = 'public.order_materials'::regclass
  ) then
    alter table public.order_materials
      add constraint order_materials_supply_source_check
      check (supply_source is null or supply_source in ('catalog', 'one_time', 'customer'));
  end if;
end
$supply_check$;

-- Existing rows are catalog lines (inventory_item_id was previously NOT NULL).
update public.order_materials
   set supply_source = 'catalog'
 where supply_source is null
   and inventory_item_id is not null;

-- Defensive: any unexpected null-id rows become one_time until edited.
update public.order_materials
   set supply_source = 'one_time'
 where supply_source is null
   and inventory_item_id is null;

alter table public.order_materials
  alter column supply_source set default 'catalog';

alter table public.order_materials
  alter column supply_source set not null;

-- Source must match whether a catalog id is present.
do $source_consistency$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_materials_supply_source_id_consistency'
      and conrelid = 'public.order_materials'::regclass
  ) then
    alter table public.order_materials
      add constraint order_materials_supply_source_id_consistency
      check (
        (supply_source = 'catalog' and inventory_item_id is not null)
        or (supply_source in ('one_time', 'customer') and inventory_item_id is null)
      );
  end if;
end
$source_consistency$;

-- ---------------------------------------------------------------------
-- 3. sync_order_materials — catalog + one_time + customer
--    Requested lines only. Never mutates inventory_items, warehouse_stock,
--    stock_batches, or inventory_movements.
--    Quantities: positive whole numbers (matches app + INTEGER columns on MAIN).
--
--    SECURITY NOTE: Prefer the dedicated secure replacement script
--    supabase/manual/20261103200000_sync_order_materials_secure.PRODUCTION.sql
--    after this schema script (eliminates TEMP-table spoofing + pg-safeupdate).
--    The body below is retained for one-shot freeform schema apply, with
--    DELETE FROM pg_temp.sync_mat WHERE true for pg-safeupdate compatibility.
-- ---------------------------------------------------------------------
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
  v_raw numeric;
  v_qty integer;
  v_name text;
  v_price numeric(10,2);
  v_source text;
  v_existing record;
  v_outstanding integer;
  v_service_total numeric(12,2);
  v_material_total numeric(12,2);
  v_new_id uuid;
  v_desired_qty integer;
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

  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  perform 1 from public.orders where id = p_order_id for update;

  create temporary table if not exists pg_temp.sync_mat (
    line_id uuid,
    inventory_item_id uuid,
    item_name text,
    price numeric(10,2),
    quantity integer not null,
    supply_source text not null
  ) on commit drop;

  -- pg-safeupdate rejects DELETE without a WHERE clause (error: DELETE requires a WHERE clause).
  delete from pg_temp.sync_mat where true;

  for v_elem in select value from jsonb_array_elements(p_materials)
  loop
    begin
      v_raw := (v_elem ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Invalid material quantity' using errcode = '22P02';
    end;

    if v_raw is null or v_raw <= 0 then
      raise exception 'Material quantity must be greater than 0' using errcode = '22023';
    end if;
    if v_raw <> trunc(v_raw) then
      raise exception 'Material quantity must be a whole number' using errcode = '22023';
    end if;
    if v_raw > 2147483647::numeric then
      raise exception 'Material quantity is too large' using errcode = '22023';
    end if;
    v_qty := trunc(v_raw)::integer;

    v_source := coalesce(nullif(trim(coalesce(v_elem ->> 'supply_source', '')), ''), 'catalog');
    if v_source not in ('catalog', 'one_time', 'customer') then
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
        select 1
        from public.inventory_items i
        where i.id = v_item_id
          and i.workspace_id = v_workspace_id
      ) then
        raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
      end if;

      if exists (
        select 1
        from pg_temp.sync_mat s
        where s.inventory_item_id = v_item_id
          and s.supply_source = 'catalog'
      ) then
        select s.quantity into v_desired_qty
        from pg_temp.sync_mat s
        where s.inventory_item_id = v_item_id
          and s.supply_source = 'catalog';
        if (v_desired_qty::numeric + v_qty::numeric) > 2147483647::numeric then
          raise exception 'Material quantity is too large' using errcode = '22023';
        end if;
        update pg_temp.sync_mat
           set quantity = quantity + v_qty
         where inventory_item_id = v_item_id
           and supply_source = 'catalog';
      else
        insert into pg_temp.sync_mat (line_id, inventory_item_id, item_name, price, quantity, supply_source)
        values (null, v_item_id, null, null, v_qty, 'catalog');
      end if;
    else
      -- one_time / customer: order-only line. Never creates inventory / stock / movements.
      if v_item_id is not null then
        raise exception 'Non-catalog materials must not include inventory_item_id' using errcode = '22023';
      end if;

      v_name := nullif(trim(coalesce(v_elem ->> 'item_name', '')), '');
      if v_name is null then
        raise exception 'item_name is required for non-catalog materials' using errcode = '22023';
      end if;

      begin
        -- Missing / null price → 0 so the line does not invent revenue.
        v_price := coalesce((v_elem ->> 'price')::numeric, 0);
      exception when others then
        raise exception 'Invalid material price' using errcode = '22P02';
      end;
      if v_price < 0 then
        raise exception 'Material price cannot be negative' using errcode = '22023';
      end if;

      insert into pg_temp.sync_mat (line_id, inventory_item_id, item_name, price, quantity, supply_source)
      values (v_line_id, null, v_name, v_price::numeric(10,2), v_qty, v_source);
    end if;
  end loop;

  -- Outstanding issued guards (catalog keyed by item; freeform keyed by line id).
  for v_existing in
    select id, inventory_item_id, quantity, quantity_issued, quantity_returned, supply_source
    from public.order_materials
    where order_id = p_order_id
  loop
    v_outstanding := coalesce(v_existing.quantity_issued, 0) - coalesce(v_existing.quantity_returned, 0);

    if v_existing.inventory_item_id is not null then
      select coalesce(sum(s.quantity), 0)::integer into v_desired_qty
      from pg_temp.sync_mat s
      where s.inventory_item_id = v_existing.inventory_item_id
        and s.supply_source = 'catalog';

      if v_desired_qty = 0 and v_outstanding > 0 then
        raise exception 'Cannot remove a material with outstanding issued quantity' using errcode = 'P0001';
      end if;
      if v_desired_qty > 0 and v_desired_qty < coalesce(v_existing.quantity_issued, 0) then
        raise exception 'Requested quantity cannot be less than already issued quantity' using errcode = 'P0001';
      end if;
    else
      if not exists (select 1 from pg_temp.sync_mat s where s.line_id = v_existing.id) then
        if v_outstanding > 0 then
          raise exception 'Cannot remove a material with outstanding issued quantity' using errcode = 'P0001';
        end if;
      else
        select s.quantity into v_desired_qty
        from pg_temp.sync_mat s
        where s.line_id = v_existing.id;
        if v_desired_qty < coalesce(v_existing.quantity_issued, 0) then
          raise exception 'Requested quantity cannot be less than already issued quantity' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end loop;

  -- Remove lines that are no longer requested and have no issue/return history.
  delete from public.order_materials om
  where om.order_id = p_order_id
    and coalesce(om.quantity_issued, 0) = 0
    and coalesce(om.quantity_returned, 0) = 0
    and (
      (
        om.inventory_item_id is not null
        and not exists (
          select 1
          from pg_temp.sync_mat s
          where s.inventory_item_id = om.inventory_item_id
            and s.supply_source = 'catalog'
        )
      )
      or (
        om.inventory_item_id is null
        and not exists (
          select 1 from pg_temp.sync_mat s where s.line_id = om.id
        )
      )
    );

  -- Upsert catalog lines (name/price snapshotted from inventory on insert only).
  for v_existing in
    select * from pg_temp.sync_mat where supply_source = 'catalog'
  loop
    if exists (
      select 1
      from public.order_materials om
      where om.order_id = p_order_id
        and om.inventory_item_id = v_existing.inventory_item_id
    ) then
      update public.order_materials
         set quantity = v_existing.quantity,
             supply_source = 'catalog'
       where order_id = p_order_id
         and inventory_item_id = v_existing.inventory_item_id
       returning id into v_new_id;
    else
      select i.name, coalesce(i.selling_price, 0)::numeric(10,2)
        into v_name, v_price
      from public.inventory_items i
      where i.id = v_existing.inventory_item_id;

      insert into public.order_materials (
        order_id, inventory_item_id, item_name, price, quantity,
        quantity_issued, quantity_returned, supply_source
      ) values (
        p_order_id, v_existing.inventory_item_id, v_name, v_price, v_existing.quantity,
        0, 0, 'catalog'
      )
      returning id into v_new_id;
    end if;
  end loop;

  -- Upsert freeform lines (order-only; inventory_item_id stays null).
  for v_existing in
    select * from pg_temp.sync_mat where supply_source in ('one_time', 'customer')
  loop
    if v_existing.line_id is not null and exists (
      select 1
      from public.order_materials om
      where om.id = v_existing.line_id
        and om.order_id = p_order_id
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
        order_id, inventory_item_id, item_name, price, quantity,
        quantity_issued, quantity_returned, supply_source
      ) values (
        p_order_id, null, v_existing.item_name, v_existing.price, v_existing.quantity,
        0, 0, v_existing.supply_source
      )
      returning id into v_new_id;
    end if;
  end loop;

  -- Order total = services + all material lines (catalog + freeform), price * quantity.
  select coalesce(sum(os.price * os.quantity), 0) into v_service_total
  from public.order_services os
  where os.order_id = p_order_id;

  select coalesce(sum(om.price * om.quantity), 0) into v_material_total
  from public.order_materials om
  where om.order_id = p_order_id;

  update public.orders
     set total_price = v_service_total + v_material_total,
         updated_at = now()
   where id = p_order_id;

  return query
  select om.*
  from public.order_materials om
  where om.order_id = p_order_id
  order by om.created_at asc, om.id asc;
end;
$function$;

revoke all on function public.sync_order_materials(uuid, jsonb) from public, anon;
grant execute on function public.sync_order_materials(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Post-conditions (abort → full rollback)
-- ---------------------------------------------------------------------
do $post$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_materials'
      and column_name = 'inventory_item_id'
      and is_nullable = 'NO'
  ) then
    raise exception 'Post: order_materials.inventory_item_id still NOT NULL';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_materials'
      and column_name = 'supply_source'
  ) then
    raise exception 'Post: order_materials.supply_source missing';
  end if;

  if position('one_time' in pg_get_functiondef('public.sync_order_materials(uuid, jsonb)'::regprocedure)) = 0
     or position('customer' in pg_get_functiondef('public.sync_order_materials(uuid, jsonb)'::regprocedure)) = 0 then
    raise exception 'Post: sync_order_materials does not handle one_time/customer';
  end if;

  -- Issue/return must remain catalog-only (require inventory_item_id in payload).
  if to_regprocedure('public.issue_order_materials(uuid, jsonb, text)') is not null then
    if position('inventory_item_id is required' in pg_get_functiondef('public.issue_order_materials(uuid, jsonb, text)'::regprocedure)) = 0
       and position('Each issue line requires inventory_item_id' in pg_get_functiondef('public.issue_order_materials(uuid, jsonb, text)'::regprocedure)) = 0 then
      raise warning 'Post: issue_order_materials body does not obviously require inventory_item_id — verify manually';
    end if;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'order_materials_order_catalog_item_uidx'
  ) then
    raise exception 'Post: partial unique index order_materials_order_catalog_item_uidx missing';
  end if;
end
$post$;

commit;
