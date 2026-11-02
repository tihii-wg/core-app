-- SOURCE (repo APPLY script, NOT a live pg_get_functiondef dump):
--   supabase/manual/20261101080000_issue_order_materials_warehouse.PRODUCTION.sql
-- Extracted verbatim: create or replace … through grant execute.
-- Live MAIN definition was not queried (no SQL execution; no function body in supabase/snapshot).
--
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
  v_mov_has_wh boolean;
  v_wh_ok boolean;
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

  if to_regclass('public.warehouse_stock') is null or to_regclass('public.warehouses') is null then
    raise exception 'warehouse_stock table is missing. Apply crm_ro_v1.PRODUCTION.sql, or issue without a warehouse.'
      using errcode = '42P01';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'warehouse_id'
  ) into v_mov_has_wh;

  -- Warehouse must belong to the order's workspace, be active and not deleted.
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
            or (v_mov_has_wh and (to_jsonb(m) ->> 'warehouse_id') is distinct from p_warehouse_id::text)
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

  perform 1
  from public.orders o
  where o.id = p_order_id
  for update of o;

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

  -- Re-check the warehouse under a share lock so it cannot be soft-deleted mid-issue.
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

    -- No warehouse_stock row means nothing on hand in this warehouse.
    if not found or coalesce(v_wh_available, 0) < v_qty::numeric then
      raise exception 'insufficient_warehouse_stock' using errcode = 'P0001';
    end if;

    -- FIFO batch consume when stock_batches rows exist (helper from 20261101210000_…).
    -- Legacy stock with zero batches: helper returns no rows and is a no-op.
    if to_regprocedure('public.crm_consume_batches_fifo(uuid, uuid, uuid, numeric)') is not null then
      perform 1 from public.crm_consume_batches_fifo(
        v_workspace_id, p_warehouse_id, v_item_id, v_qty::numeric
      );
    end if;

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
    set quantity_issued = quantity_issued + v_qty
    where id = v_line.id
      and quantity_issued + v_qty <= quantity;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'Cannot issue more than the remaining requested quantity' using errcode = 'P0001';
    end if;

    if v_mov_has_wh then
      insert into public.inventory_movements (
        workspace_id, inventory_item_id, order_id, order_material_id,
        movement_type, quantity, reason, idempotency_key, created_by, warehouse_id
      ) values (
        v_workspace_id, v_item_id, p_order_id, v_line.id,
        'issue', v_qty, null, v_key, (select auth.uid()), p_warehouse_id
      )
      returning id into v_movement_id;
    else
      insert into public.inventory_movements (
        workspace_id, inventory_item_id, order_id, order_material_id,
        movement_type, quantity, reason, idempotency_key, created_by
      ) values (
        v_workspace_id, v_item_id, p_order_id, v_line.id,
        'issue', v_qty, null, v_key, (select auth.uid())
      )
      returning id into v_movement_id;
    end if;

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
