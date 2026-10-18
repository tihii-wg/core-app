-- =============================================================================
-- MANUAL repair — install missing warehouse issue / return RPCs only
--
-- DO NOT auto-apply. Paste into the Supabase SQL Editor when ready.
-- This file does NOT alter tables, indexes, RLS policies, or column types.
-- It has NOT been executed against any live database by the authoring process.
--
-- Context (reported live schema):
--   - public.inventory_movements already exists (integer quantity; issue|return only)
--   - unique partial index on (workspace_id, idempotency_key, inventory_item_id)
--     where idempotency_key is not null
--   - RLS: SELECT for workspace members; no INSERT policy for authenticated
--   - inventory_items.quantity is numeric(12,2)
--   - order_materials.quantity / quantity_issued / quantity_returned are integers
--   - public.issue_order_materials / public.return_order_materials are missing
--
-- Frontend / PostgREST contracts (src/services/apiWarehouse.ts):
--   issue_order_materials(p_order_id uuid, p_lines jsonb, p_idempotency_key text)
--     → setof inventory_movements
--   return_order_materials(p_order_id uuid, p_lines jsonb, p_reason text,
--                          p_idempotency_key text)
--     → setof inventory_movements
--   p_lines: [{ "inventory_item_id": "<uuid>", "quantity": <positive int> }, ...]
--   Frontend does not aggregate duplicate inventory_item_id values; duplicates are rejected.
--
-- Intended lock order inside these RPCs:
--   1) pg_advisory_xact_lock(workspace, idempotency_key) when key present
--   2) orders row FOR UPDATE
--   3) order_materials for the order, ordered by inventory_item_id
--   4) inventory_items for requested ids in this workspace, ordered by id
-- Note: public.sync_order_materials does not take the same locks (no order
-- FOR UPDATE / no inventory locks). Concurrent sync + issue/return can still
-- contend on order_materials / orders rows; do not treat this as proven
-- deadlock-free across all warehouse writers.
--
-- Idempotency:
--   After the advisory lock, every movement for (workspace_id, key) is inspected.
--   Exact replay requires: movement_type, order_id, reason (NULL for issue),
--   order_material_id matching order_materials(order_id, inventory_item_id),
--   no duplicate/malformed rows, and the full normalized item/qty set.
--   Missing, extra, mismatched, or mixed-operation rows are rejected.
--
-- Quantity semantics (unchanged; matches migration + warehouseMaterialStatus.ts):
--   remaining_to_issue  = quantity - quantity_issued
--   remaining_to_return = quantity_issued - quantity_returned
--   Returning stock does NOT reduce quantity_issued, so it does not free budget
--   to issue the same requested line again.
--
-- Why SECURITY DEFINER:
--   inventory_movements grants SELECT only to authenticated; issue/return must
--   INSERT movements and UPDATE inventory_items / order_materials.
--
-- Grants: EXECUTE to authenticated only (not service_role / anon / PUBLIC).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preflight (abort on mismatch; no DDL)
-- ---------------------------------------------------------------------------
do $$
declare
  missing_cols text;
  mov_qty_udt text;
  item_qty_udt text;
  om_qty_udt text;
  om_issued_udt text;
  om_returned_udt text;
  idem_index_ok boolean;
  idem_index_def text;
begin
  if to_regclass('public.inventory_movements') is null then
    raise exception 'Preflight failed: public.inventory_movements is missing. Aborting.';
  end if;

  if to_regclass('public.order_materials') is null
     or to_regclass('public.inventory_items') is null
     or to_regclass('public.orders') is null then
    raise exception 'Preflight failed: orders / order_materials / inventory_items missing. Aborting.';
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null
     or to_regprocedure('public.workspace_member_role(uuid)') is null then
    raise exception 'Preflight failed: workspace helper functions missing. Aborting.';
  end if;

  -- Every column referenced by either RPC body.
  select string_agg(req.table_name || '.' || req.column_name, ', ' order by req.table_name, req.column_name)
  into missing_cols
  from (
    values
      ('orders', 'id'),
      ('orders', 'workspace_id'),
      ('order_materials', 'id'),
      ('order_materials', 'order_id'),
      ('order_materials', 'inventory_item_id'),
      ('order_materials', 'quantity'),
      ('order_materials', 'quantity_issued'),
      ('order_materials', 'quantity_returned'),
      ('inventory_items', 'id'),
      ('inventory_items', 'workspace_id'),
      ('inventory_items', 'quantity'),
      ('inventory_items', 'updated_at'),
      ('inventory_movements', 'id'),
      ('inventory_movements', 'workspace_id'),
      ('inventory_movements', 'inventory_item_id'),
      ('inventory_movements', 'order_id'),
      ('inventory_movements', 'order_material_id'),
      ('inventory_movements', 'movement_type'),
      ('inventory_movements', 'quantity'),
      ('inventory_movements', 'reason'),
      ('inventory_movements', 'idempotency_key'),
      ('inventory_movements', 'created_by'),
      ('inventory_movements', 'created_at')
  ) as req(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = req.table_name
      and c.column_name = req.column_name
  );

  if missing_cols is not null then
    raise exception 'Preflight failed: missing required columns: %. Aborting.', missing_cols;
  end if;

  select c.udt_name into mov_qty_udt
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'inventory_movements' and c.column_name = 'quantity';

  select c.udt_name into item_qty_udt
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'inventory_items' and c.column_name = 'quantity';

  select c.udt_name into om_qty_udt
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'order_materials' and c.column_name = 'quantity';

  select c.udt_name into om_issued_udt
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'order_materials' and c.column_name = 'quantity_issued';

  select c.udt_name into om_returned_udt
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'order_materials' and c.column_name = 'quantity_returned';

  if mov_qty_udt is distinct from 'int4' then
    raise exception
      'Preflight failed: inventory_movements.quantity expected int4, found %. Aborting.',
      coalesce(mov_qty_udt, '<missing>');
  end if;

  if item_qty_udt is distinct from 'numeric' then
    raise exception
      'Preflight failed: inventory_items.quantity expected numeric, found %. Aborting.',
      coalesce(item_qty_udt, '<missing>');
  end if;

  if om_qty_udt is distinct from 'int4'
     or om_issued_udt is distinct from 'int4'
     or om_returned_udt is distinct from 'int4' then
    raise exception
      'Preflight failed: order_materials quantity columns expected int4 (quantity=%, issued=%, returned=%). Aborting.',
      coalesce(om_qty_udt, '<missing>'),
      coalesce(om_issued_udt, '<missing>'),
      coalesce(om_returned_udt, '<missing>');
  end if;

  -- Catalog check: unique partial index on exact key columns + non-null predicate.
  -- Also require indisvalid and indisready so a broken/invalid index cannot pass.
  select
    true,
    pg_get_indexdef(idx.indexrelid)
  into idem_index_ok, idem_index_def
  from pg_index idx
  join pg_class tc on tc.oid = idx.indrelid
  join pg_namespace n on n.oid = tc.relnamespace
  where n.nspname = 'public'
    and tc.relname = 'inventory_movements'
    and idx.indisunique
    and not idx.indisprimary
    and idx.indisvalid
    and idx.indisready
    and idx.indnkeyatts = 3
    and idx.indpred is not null
    and pg_get_expr(idx.indpred, idx.indrelid) in (
      'idempotency_key IS NOT NULL',
      '(idempotency_key IS NOT NULL)'
    )
    and (
      select a.attname
      from pg_attribute a
      where a.attrelid = idx.indrelid and a.attnum = idx.indkey[0]
    ) = 'workspace_id'
    and (
      select a.attname
      from pg_attribute a
      where a.attrelid = idx.indrelid and a.attnum = idx.indkey[1]
    ) = 'idempotency_key'
    and (
      select a.attname
      from pg_attribute a
      where a.attrelid = idx.indrelid and a.attnum = idx.indkey[2]
    ) = 'inventory_item_id'
  limit 1;

  if not coalesce(idem_index_ok, false) then
    raise exception
      'Preflight failed: required unique partial index on inventory_movements (workspace_id, idempotency_key, inventory_item_id) WHERE idempotency_key IS NOT NULL was not found. Aborting.';
  end if;

  raise notice 'Preflight OK: idempotency index = %', idem_index_def;

  if to_regprocedure('public.issue_order_materials(uuid, jsonb, text)') is not null then
    raise notice 'issue_order_materials(uuid, jsonb, text) already exists; body will be replaced.';
  end if;
  if to_regprocedure('public.return_order_materials(uuid, jsonb, text, text)') is not null then
    raise notice 'return_order_materials(uuid, jsonb, text, text) already exists; body will be replaced.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- issue_order_materials
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
  v_raw numeric;
  v_qty integer;
  v_line record;
  v_available numeric;
  v_movement_ids uuid[] := array[]::uuid[];
  v_movement_id uuid;
  v_key text;
  v_seen jsonb := '{}'::jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_existing_count integer;
  v_existing_norm jsonb;
  v_bad boolean;
  v_rowcount integer;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
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
      -- Malformed / mixed / wrong reason / bad order_material_id linkage.
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
          )
      ) into v_bad;

      if v_bad then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;

      -- Duplicate inventory_item_id under the same key is not an exact replay.
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

      -- Fingerprint every movement under the key (no silent partial subset).
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

    update public.order_materials
    set quantity_issued = quantity_issued + v_qty
    where id = v_line.id
      and quantity_issued + v_qty <= quantity;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'Cannot issue more than the remaining requested quantity' using errcode = 'P0001';
    end if;

    insert into public.inventory_movements (
      workspace_id,
      inventory_item_id,
      order_id,
      order_material_id,
      movement_type,
      quantity,
      reason,
      idempotency_key,
      created_by
    ) values (
      v_workspace_id,
      v_item_id,
      p_order_id,
      v_line.id,
      'issue',
      v_qty,
      null,
      v_key,
      (select auth.uid())
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
            or m.reason is distinct from v_reason
            or m.inventory_item_id is null
            or m.quantity is null
            or m.quantity <= 0
            or m.order_material_id is null
            or om.id is null
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

    if not exists (
      select 1
      from public.inventory_items i
      where i.id = v_item_id
        and i.workspace_id = v_workspace_id
    ) then
      raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
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

    update public.order_materials
    set quantity_returned = quantity_returned + v_qty
    where id = v_line.id
      and quantity_returned + v_qty <= quantity_issued;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'Cannot return more than the outstanding issued quantity' using errcode = 'P0001';
    end if;

    insert into public.inventory_movements (
      workspace_id,
      inventory_item_id,
      order_id,
      order_material_id,
      movement_type,
      quantity,
      reason,
      idempotency_key,
      created_by
    ) values (
      v_workspace_id,
      v_item_id,
      p_order_id,
      v_line.id,
      'return',
      v_qty,
      v_reason,
      v_key,
      (select auth.uid())
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

revoke all on function public.issue_order_materials(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_order_materials(uuid, jsonb, text)
  to authenticated;

revoke all on function public.return_order_materials(uuid, jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.return_order_materials(uuid, jsonb, text, text)
  to authenticated;

commit;

-- =============================================================================
-- Post-install verification (read-only; run separately after apply)
-- See: supabase/manual/20261018210000_issue_return_rpc_repair.VERIFY.sql
-- =============================================================================
