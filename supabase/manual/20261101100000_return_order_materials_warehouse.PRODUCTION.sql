-- =====================================================================
-- Core App: return order materials TO a SELECTED warehouse
--
--   return_order_materials_to_warehouse(
--     p_order_id uuid, p_lines jsonb, p_warehouse_id uuid,
--     p_reason text default null, p_idempotency_key text default null
--   ) returns setof public.inventory_movements
--
-- WHY: after issue_order_materials_from_warehouse decreases warehouse_stock,
-- the 4-arg return_order_materials only restores inventory_items.quantity.
-- This NEW function restores BOTH the company total and the chosen warehouse.
-- The existing return_order_materials is NOT touched (kept for global-only returns when no
-- warehouse is selected). The Core App UI does NOT fall back to global return when a
-- warehouse is selected — apply this file before warehouse-aware returns work.
--
-- Contract (mirrors return_order_materials + warehouse):
--   p_lines: [{ "inventory_item_id": "<uuid>", "quantity": <positive int> }, ...]
--   Permission: workspace member with role owner / admin / manager.
--   Warehouse: active, same workspace, not deleted.
--   Per line: inventory_items.quantity += qty;
--             warehouse_stock.quantity += qty (UPSERT on warehouse_id+inventory_item_id);
--             order_materials.quantity_returned += qty (never above quantity_issued);
--             inventory_movements 'return' with warehouse_id when the column exists.
--
-- REQUIRES: return_order_materials prerequisites (issue/return repair) and
-- crm_ro_v1.PRODUCTION.sql (warehouses / warehouse_stock). Without crm_ro_v1 the
-- function installs but raises a clear error when called.
-- Apply by hand: TEST first, then PROD. Idempotent. One transaction.
-- NOT applied automatically by the app or CI.
-- =====================================================================

begin;

do $preflight$
declare
  missing_cols text;
begin
  if to_regclass('public.inventory_movements') is null
     or to_regclass('public.order_materials') is null
     or to_regclass('public.inventory_items') is null
     or to_regclass('public.orders') is null then
    raise exception 'Preflight failed: orders / order_materials / inventory_items / inventory_movements missing. Apply the warehouse issue/return files first.';
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null
     or to_regprocedure('public.workspace_member_role(uuid)') is null then
    raise exception 'Preflight failed: workspace helper functions missing. Aborting.';
  end if;

  select string_agg(req.table_name || '.' || req.column_name, ', ' order by req.table_name, req.column_name)
    into missing_cols
  from (
    values
      ('orders', 'id'), ('orders', 'workspace_id'),
      ('order_materials', 'id'), ('order_materials', 'order_id'), ('order_materials', 'inventory_item_id'),
      ('order_materials', 'quantity_issued'), ('order_materials', 'quantity_returned'),
      ('inventory_items', 'id'), ('inventory_items', 'workspace_id'), ('inventory_items', 'quantity'),
      ('inventory_items', 'updated_at'),
      ('inventory_movements', 'id'), ('inventory_movements', 'workspace_id'),
      ('inventory_movements', 'inventory_item_id'), ('inventory_movements', 'order_id'),
      ('inventory_movements', 'order_material_id'), ('inventory_movements', 'movement_type'),
      ('inventory_movements', 'quantity'), ('inventory_movements', 'reason'),
      ('inventory_movements', 'idempotency_key'), ('inventory_movements', 'created_by'),
      ('inventory_movements', 'created_at')
  ) as req(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = req.table_name and c.column_name = req.column_name
  );
  if missing_cols is not null then
    raise exception 'Preflight failed: missing required columns: %. Aborting.', missing_cols;
  end if;

  if to_regclass('public.warehouse_stock') is null or to_regclass('public.warehouses') is null then
    raise notice 'public.warehouse_stock / public.warehouses are missing (crm_ro_v1 not applied): the function will be installed but raises a clear error when called.';
  end if;
end
$preflight$;

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

  if to_regclass('public.warehouse_stock') is null or to_regclass('public.warehouses') is null then
    raise exception 'warehouse_stock table is missing. Apply crm_ro_v1.PRODUCTION.sql, or return without a warehouse.'
      using errcode = '42P01';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'warehouse_id'
  ) into v_mov_has_wh;

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

    -- Upsert so concurrent returns into an empty warehouse cannot race on the unique key.
    insert into public.warehouse_stock (
      workspace_id, warehouse_id, inventory_item_id, quantity, updated_at
    ) values (
      v_workspace_id, p_warehouse_id, v_item_id, v_qty::numeric, now()
    )
    on conflict (warehouse_id, inventory_item_id)
    do update set
      quantity = public.warehouse_stock.quantity + excluded.quantity,
      updated_at = now();

    -- Return-batch strategy (when helper from 20261101210000_… is installed):
    -- 1) Prefer inventory_movements.batch_id from the latest matching ISSUE for this
    --    order_material + warehouse (restore original batch when recorded).
    -- 2) Otherwise create a NEW return batch at this warehouse (never invent a
    --    fake reference to a missing batch id).
    -- batch_id is read via to_jsonb so CREATE OR REPLACE still works if the column
    -- is not present yet (crm_ro_v1 not applied).
    if to_regprocedure('public.crm_restore_or_create_batch(uuid, uuid, uuid, numeric, uuid, numeric, date, uuid, uuid)') is not null then
      declare
        v_src_batch uuid;
      begin
        select (to_jsonb(m) ->> 'batch_id')::uuid into v_src_batch
        from public.inventory_movements m
        where m.workspace_id = v_workspace_id
          and m.order_material_id = v_line.id
          and m.movement_type = 'issue'
          and (
            not v_mov_has_wh
            or (to_jsonb(m) ->> 'warehouse_id') is not distinct from p_warehouse_id::text
          )
          and (to_jsonb(m) ->> 'batch_id') is not null
        order by m.created_at desc, m.id desc
        limit 1;

        perform public.crm_restore_or_create_batch(
          v_workspace_id, p_warehouse_id, v_item_id, v_qty::numeric,
          v_src_batch, 0, null, null, null
        );
      end;
    end if;

    if v_mov_has_wh then
      insert into public.inventory_movements (
        workspace_id, inventory_item_id, order_id, order_material_id,
        movement_type, quantity, reason, idempotency_key, created_by, warehouse_id
      ) values (
        v_workspace_id, v_item_id, p_order_id, v_line.id,
        'return', v_qty, v_reason, v_key, (select auth.uid()), p_warehouse_id
      )
      returning id into v_movement_id;
    else
      insert into public.inventory_movements (
        workspace_id, inventory_item_id, order_id, order_material_id,
        movement_type, quantity, reason, idempotency_key, created_by
      ) values (
        v_workspace_id, v_item_id, p_order_id, v_line.id,
        'return', v_qty, v_reason, v_key, (select auth.uid())
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

revoke all on function public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)
  to authenticated;

-- PostgREST picks up new functions after a schema reload.
notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Post-install verification (read-only; run separately after apply)
--
--   select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('return_order_materials', 'return_order_materials_to_warehouse')
--   order by 1;
--   -- expected: both present, prosecdef = true
--
--   select has_function_privilege('authenticated',
--            'public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)', 'execute'),
--          has_function_privilege('anon',
--            'public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)', 'execute');
--   -- expected: true, false
-- =====================================================================
