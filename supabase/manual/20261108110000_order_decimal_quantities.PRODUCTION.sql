-- =============================================================================
-- Decimal quantities for order works and materials (e.g. 2.5 m², 1.5 h)
-- Script: 20261108110000_order_decimal_quantities.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites (must already be applied, verified in preflight):
--   20261103200000_sync_order_materials_secure
--   20261104080000_warehouse_inventory_ledger_complete
-- =============================================================================
-- What changes:
--   1) order_services.quantity: integer -> numeric(12,2) (existing values kept as-is).
--   2) sync_order_materials, issue_order_materials_from_warehouse,
--      return_order_materials_to_warehouse: accept quantities with up to 2 decimals
--      (previously rejected anything that was not a whole number).
--   3) add_and_issue_order_catalog_material / set_order_catalog_material_quantity_with_issue:
--      p_quantity integer -> numeric (old integer overloads are dropped and replaced).
-- Function bodies are copied from the prerequisite scripts; ONLY the quantity types,
-- the whole-number checks and the int casts of quantities are changed.
-- order_materials.quantity, inventory quantities, batches and movements are already numeric.
-- No data is modified. Idempotency: re-running after success fails preflight on purpose
-- (functions no longer contain the whole-number checks) — that means it is already applied.
-- Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_type text;
  v_src text;
  v_deps text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.order_services'::regclass and a.attname = 'quantity' and not a.attisdropped;
  if v_type is distinct from 'integer' then
    raise exception 'decimal_quantities preflight: order_services.quantity is % (expected integer) — already applied?', v_type;
  end if;

  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.order_materials'::regclass and a.attname = 'quantity' and not a.attisdropped;
  if v_type not like 'numeric%' then
    raise exception 'decimal_quantities preflight: order_materials.quantity is % (expected numeric)', v_type;
  end if;

  -- Views / rules depending on order_services.quantity would block ALTER TYPE.
  select string_agg(distinct c.relname, ', ') into v_deps
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class c on c.oid = r.ev_class
  join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
  where d.refobjid = 'public.order_services'::regclass and a.attname = 'quantity';
  if v_deps is not null then
    raise exception 'decimal_quantities preflight: views depend on order_services.quantity: %', v_deps;
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.sync_order_materials(uuid, jsonb)');
  if v_src is null or position('Material quantity must be a whole number' in v_src) = 0 then
    raise exception 'decimal_quantities preflight: sync_order_materials is not the expected version (20261103200000)';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)');
  if v_src is null or position('Issue quantity must be a whole number' in v_src) = 0 then
    raise exception 'decimal_quantities preflight: issue_order_materials_from_warehouse is not the expected version (20261104080000)';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)');
  if v_src is null or position('Return quantity must be a whole number' in v_src) = 0 then
    raise exception 'decimal_quantities preflight: return_order_materials_to_warehouse is not the expected version (20261104080000)';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text)');
  if v_src is null or position('positive whole number' in v_src) = 0 or position('not implemented yet' in v_src) > 0 then
    raise exception 'decimal_quantities preflight: add_and_issue_order_catalog_material(integer) is not the expected version (20261104080000)';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text)');
  if v_src is null or position('positive whole number' in v_src) = 0 or position('not implemented yet' in v_src) > 0 then
    raise exception 'decimal_quantities preflight: set_order_catalog_material_quantity_with_issue(integer) is not the expected version (20261104080000)';
  end if;

  if exists (select 1 from pg_proc where oid = to_regprocedure('public.add_and_issue_order_catalog_material(uuid, uuid, uuid, numeric, numeric, text)'))
     or exists (select 1 from pg_proc where oid = to_regprocedure('public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, numeric, text)')) then
    raise exception 'decimal_quantities preflight: numeric overloads already exist';
  end if;
end;
$preflight$;

-- 1) order_services.quantity -> numeric(12,2)
alter table public.order_services
  alter column quantity type numeric(12,2) using quantity::numeric(12,2);

do $svc_chk$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'order_services_quantity_positive'
                   and conrelid = 'public.order_services'::regclass) then
    -- NOT VALID: enforced for new/changed rows; existing rows are not re-checked.
    alter table public.order_services
      add constraint order_services_quantity_positive check (quantity > 0) not valid;
  end if;
end;
$svc_chk$;

-- 2) sync_order_materials: decimal quantities (body otherwise unchanged from 20261103200000)
create or replace function public.sync_order_materials(p_order_id uuid, p_materials jsonb)
returns setof public.order_materials
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_workspace_id uuid;
  v_elem jsonb;
  v_elem_type text;
  v_item_id uuid;
  v_line_id uuid;
  v_raw numeric;
  v_qty numeric(12,2);
  v_name text;
  v_price numeric(10,2);
  v_source text;
  v_existing record;
  v_outstanding numeric(12,2);
  v_service_total numeric(12,2);
  v_material_total numeric(12,2);
  v_desired_qty numeric(12,2);
  v_catalog jsonb := '{}'::jsonb;
  v_freeform jsonb := '[]'::jsonb;
  v_seen_freeform_ids jsonb := '{}'::jsonb;
  v_freeform_keep jsonb := '{}'::jsonb;
  v_idx integer;
  v_ff jsonb;
  v_existing_source text;
  v_existing_item uuid;
  v_existing_name text;
  v_existing_price numeric(10,2);
  v_existing_issued numeric;
  v_existing_returned numeric;
  v_has_history boolean;
  v_catalog_count integer;
  v_id_raw text;
  v_id_type text;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    raise exception 'materials must be a JSON array' using errcode = '22023';
  end if;

  -- Lock order first (same first step as warehouse issue/return), then re-check auth.
  select o.workspace_id into v_workspace_id
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  -- Lock materials in inventory_item_id order (matches issue/return) to reduce deadlock risk.
  perform 1
  from public.order_materials om
  where om.order_id = p_order_id
  order by om.inventory_item_id nulls last, om.id
  for update;

  for v_elem in select value from jsonb_array_elements(p_materials)
  loop
    v_elem_type := jsonb_typeof(v_elem);
    if v_elem_type is distinct from 'object' then
      raise exception 'Each material entry must be a JSON object' using errcode = '22023';
    end if;

    if not (v_elem ? 'quantity') or jsonb_typeof(v_elem -> 'quantity') is distinct from 'number' then
      raise exception 'Invalid material quantity' using errcode = '22P02';
    end if;
    begin
      v_raw := (v_elem ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Invalid material quantity' using errcode = '22P02';
    end;
    if v_raw is null or v_raw <= 0 then
      raise exception 'Material quantity must be greater than 0' using errcode = '22023';
    end if;
    if v_raw <> round(v_raw, 2) then
      raise exception 'Material quantity may have at most 2 decimal places' using errcode = '22023';
    end if;
    if v_raw > 9999999999::numeric then
      raise exception 'Material quantity is too large' using errcode = '22023';
    end if;
    v_qty := v_raw;

    if (v_elem ? 'supply_source')
       and jsonb_typeof(v_elem -> 'supply_source') is distinct from 'null'
       and jsonb_typeof(v_elem -> 'supply_source') is distinct from 'string' then
      raise exception 'Invalid supply_source' using errcode = '22023';
    end if;
    v_source := coalesce(nullif(trim(coalesce(v_elem ->> 'supply_source', '')), ''), 'catalog');
    if v_source not in ('catalog', 'one_time', 'customer') then
      raise exception 'Invalid supply_source' using errcode = '22023';
    end if;

    -- inventory_item_id: omit / JSON null → null; empty / non-string / invalid uuid → reject
    v_item_id := null;
    if (v_elem ? 'inventory_item_id') and jsonb_typeof(v_elem -> 'inventory_item_id') is distinct from 'null' then
      v_id_type := jsonb_typeof(v_elem -> 'inventory_item_id');
      if v_id_type is distinct from 'string' then
        raise exception 'Invalid inventory_item_id' using errcode = '22P02';
      end if;
      v_id_raw := v_elem ->> 'inventory_item_id';
      if v_id_raw is null or length(trim(v_id_raw)) = 0 then
        raise exception 'Invalid inventory_item_id' using errcode = '22P02';
      end if;
      begin
        v_item_id := trim(v_id_raw)::uuid;
      exception when others then
        raise exception 'Invalid inventory_item_id' using errcode = '22P02';
      end;
    end if;

    -- line_id: omit / JSON null → null; empty / non-string / invalid uuid → reject
    v_line_id := null;
    if (v_elem ? 'line_id') and jsonb_typeof(v_elem -> 'line_id') is distinct from 'null' then
      v_id_type := jsonb_typeof(v_elem -> 'line_id');
      if v_id_type is distinct from 'string' then
        raise exception 'Invalid line_id' using errcode = '22P02';
      end if;
      v_id_raw := v_elem ->> 'line_id';
      if v_id_raw is null or length(trim(v_id_raw)) = 0 then
        raise exception 'Invalid line_id' using errcode = '22P02';
      end if;
      begin
        v_line_id := trim(v_id_raw)::uuid;
      exception when others then
        raise exception 'Invalid line_id' using errcode = '22P02';
      end;
    end if;

    if v_source = 'catalog' then
      if v_item_id is null then
        raise exception 'inventory_item_id is required' using errcode = '22023';
      end if;
      if v_line_id is not null then
        raise exception 'Catalog materials must not include line_id' using errcode = '22023';
      end if;
      if not exists (
        select 1
        from public.inventory_items i
        where i.id = v_item_id
          and i.workspace_id = v_workspace_id
      ) then
        raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
      end if;

      -- Reject duplicate catalog ids in the payload (do not silently aggregate).
      if v_catalog ? v_item_id::text then
        raise exception 'Duplicate catalog inventory_item_id in materials payload' using errcode = '22023';
      end if;
      v_catalog := v_catalog || jsonb_build_object(v_item_id::text, v_qty);
    else
      if v_item_id is not null then
        raise exception 'Non-catalog materials must not include inventory_item_id' using errcode = '22023';
      end if;

      if not (v_elem ? 'item_name') or jsonb_typeof(v_elem -> 'item_name') is distinct from 'string' then
        raise exception 'item_name is required for non-catalog materials' using errcode = '22023';
      end if;
      v_name := nullif(trim(v_elem ->> 'item_name'), '');
      if v_name is null then
        raise exception 'item_name is required for non-catalog materials' using errcode = '22023';
      end if;

      if (v_elem ? 'price')
         and jsonb_typeof(v_elem -> 'price') is distinct from 'null'
         and jsonb_typeof(v_elem -> 'price') is distinct from 'number' then
        raise exception 'Invalid material price' using errcode = '22P02';
      end if;
      begin
        v_price := coalesce((v_elem ->> 'price')::numeric, 0);
      exception when others then
        raise exception 'Invalid material price' using errcode = '22P02';
      end;
      if v_price < 0 then
        raise exception 'Material price cannot be negative' using errcode = '22023';
      end if;

      if v_line_id is not null then
        if v_seen_freeform_ids ? v_line_id::text then
          raise exception 'Duplicate freeform line_id in materials payload' using errcode = '22023';
        end if;
        v_seen_freeform_ids := v_seen_freeform_ids || jsonb_build_object(v_line_id::text, true);

        select
          om.supply_source,
          om.inventory_item_id,
          om.item_name,
          om.price,
          om.quantity_issued,
          om.quantity_returned
        into
          v_existing_source,
          v_existing_item,
          v_existing_name,
          v_existing_price,
          v_existing_issued,
          v_existing_returned
        from public.order_materials om
        where om.id = v_line_id
          and om.order_id = p_order_id;

        if not found then
          raise exception 'Invalid line_id for this order' using errcode = 'P0001';
        end if;
        if v_existing_item is not null or coalesce(v_existing_source, '') = 'catalog' then
          raise exception 'Cannot convert a catalog material into a freeform material' using errcode = 'P0001';
        end if;
        if coalesce(v_existing_source, '') not in ('one_time', 'customer') then
          raise exception 'Invalid line_id for this order' using errcode = 'P0001';
        end if;

        v_has_history := coalesce(v_existing_issued, 0) <> 0 or coalesce(v_existing_returned, 0) <> 0;
        if v_has_history then
          if v_name is distinct from v_existing_name then
            raise exception 'Cannot change material name after issue or return activity' using errcode = 'P0001';
          end if;
          if v_price is distinct from v_existing_price::numeric(10,2) then
            raise exception 'Cannot change material price after issue or return activity' using errcode = 'P0001';
          end if;
          if v_source is distinct from v_existing_source then
            raise exception 'Cannot change material supply source after issue or return activity' using errcode = 'P0001';
          end if;
        end if;

        v_freeform_keep := v_freeform_keep || jsonb_build_object(v_line_id::text, true);
      end if;

      v_freeform := v_freeform || jsonb_build_array(
        jsonb_build_object(
          'line_id', to_jsonb(v_line_id),
          'item_name', to_jsonb(v_name),
          'price', to_jsonb(v_price::numeric(10,2)),
          'quantity', to_jsonb(v_qty),
          'supply_source', to_jsonb(v_source)
        )
      );
    end if;
  end loop;

  for v_existing in
    select id, inventory_item_id, quantity, quantity_issued, quantity_returned, supply_source
    from public.order_materials
    where order_id = p_order_id
    order by inventory_item_id nulls last, id
  loop
    v_outstanding := coalesce(v_existing.quantity_issued, 0) - coalesce(v_existing.quantity_returned, 0);

    if v_existing.inventory_item_id is not null then
      v_desired_qty := coalesce((v_catalog ->> v_existing.inventory_item_id::text)::numeric, 0);

      if v_desired_qty = 0 and v_outstanding > 0 then
        raise exception 'Cannot remove a material with outstanding issued quantity' using errcode = 'P0001';
      end if;
      if v_desired_qty > 0 and v_desired_qty < coalesce(v_existing.quantity_issued, 0) then
        raise exception 'Requested quantity cannot be less than already issued quantity' using errcode = 'P0001';
      end if;
    else
      if not (v_freeform_keep ? v_existing.id::text) then
        if v_outstanding > 0 then
          raise exception 'Cannot remove a material with outstanding issued quantity' using errcode = 'P0001';
        end if;
      else
        select (elem ->> 'quantity')::numeric
          into v_desired_qty
        from jsonb_array_elements(v_freeform) as elem
        where (elem ->> 'line_id') = v_existing.id::text
        limit 1;

        if v_desired_qty is not null and v_desired_qty < coalesce(v_existing.quantity_issued, 0) then
          raise exception 'Requested quantity cannot be less than already issued quantity' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end loop;

  delete from public.order_materials om
  where om.order_id = p_order_id
    and coalesce(om.quantity_issued, 0) = 0
    and coalesce(om.quantity_returned, 0) = 0
    and (
      (
        om.inventory_item_id is not null
        and not (v_catalog ? om.inventory_item_id::text)
      )
      or (
        om.inventory_item_id is null
        and not (v_freeform_keep ? om.id::text)
      )
    );

  for v_item_id, v_qty in
    select key::uuid, value::text::numeric from jsonb_each(v_catalog)
  loop
    select count(*)::integer into v_catalog_count
    from public.order_materials om
    where om.order_id = p_order_id
      and om.inventory_item_id = v_item_id;

    if v_catalog_count > 1 then
      raise exception
        'Duplicate catalog material rows exist for this order and inventory item; resolve duplicates before syncing'
        using errcode = 'P0001';
    elsif v_catalog_count = 1 then
      update public.order_materials
         set quantity = v_qty,
             supply_source = 'catalog'
       where order_id = p_order_id
         and inventory_item_id = v_item_id;
    else
      select i.name, coalesce(i.selling_price, 0)::numeric(10,2)
        into v_name, v_price
      from public.inventory_items i
      where i.id = v_item_id
        and i.workspace_id = v_workspace_id;

      if v_name is null then
        raise exception 'Inventory item is unavailable in this workspace' using errcode = 'P0001';
      end if;

      insert into public.order_materials (
        order_id, inventory_item_id, item_name, price, quantity,
        quantity_issued, quantity_returned, supply_source
      ) values (
        p_order_id, v_item_id, v_name, v_price, v_qty,
        0, 0, 'catalog'
      );
    end if;
  end loop;

  for v_idx in 0 .. greatest(jsonb_array_length(v_freeform) - 1, -1)
  loop
    v_ff := v_freeform -> v_idx;
    v_line_id := case
      when jsonb_typeof(v_ff -> 'line_id') = 'null' then null
      else nullif(v_ff ->> 'line_id', '')::uuid
    end;
    v_name := v_ff ->> 'item_name';
    v_price := (v_ff ->> 'price')::numeric(10,2);
    v_qty := (v_ff ->> 'quantity')::numeric;
    v_source := v_ff ->> 'supply_source';

    if v_line_id is not null then
      update public.order_materials
         set item_name = v_name,
             price = v_price,
             quantity = v_qty,
             inventory_item_id = null,
             supply_source = v_source
       where id = v_line_id
         and order_id = p_order_id
         and inventory_item_id is null
         and supply_source in ('one_time', 'customer')
         and (
           (coalesce(quantity_issued, 0) = 0 and coalesce(quantity_returned, 0) = 0)
           or (
             item_name is not distinct from v_name
             and price is not distinct from v_price
             and supply_source is not distinct from v_source
           )
         );

      if not found then
        raise exception 'Invalid line_id for this order' using errcode = 'P0001';
      end if;
    else
      insert into public.order_materials (
        order_id, inventory_item_id, item_name, price, quantity,
        quantity_issued, quantity_returned, supply_source
      ) values (
        p_order_id, null, v_name, v_price, v_qty,
        0, 0, v_source
      );
    end if;
  end loop;

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

-- 3) issue_order_materials_from_warehouse (body otherwise unchanged from 20261104080000)
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
  v_qty numeric(12,2);
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
  v_fifo_qty numeric;
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
    if v_raw <> round(v_raw, 2) then
      raise exception 'Issue quantity may have at most 2 decimal places' using errcode = '22023';
    end if;
    if v_raw > 9999999999::numeric then
      raise exception 'Issue quantity is too large' using errcode = '22023';
    end if;

    v_qty := v_raw;

    if v_seen ? v_item_id::text then
      raise exception 'Duplicate inventory_item_id in issue lines' using errcode = '22023';
    end if;
    v_seen := v_seen || jsonb_build_object(v_item_id::text, v_qty);
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'inventory_item_id', kv.key,
        'quantity', (kv.value #>> '{}')::numeric
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

    -- Key owned by atomic catalog RPCs (warehouse_rpc_idempotency) cannot be
    -- reused by standalone issue. Nested add_and_issue → issue inserts the
    -- ledger row only AFTER this call returns, so nested same-txn use is OK.
    if to_regclass('public.warehouse_rpc_idempotency') is not null
       and exists (
         select 1 from public.warehouse_rpc_idempotency r
         where r.workspace_id = v_workspace_id and r.idempotency_key = v_key
       ) then
      raise exception 'Idempotency key was already used with a different warehouse operation'
        using errcode = '22023';
    end if;

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
    v_qty := (v_elem ->> 'quantity')::numeric;

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

    -- Reset FIFO accumulators per order material (never carry over).
    v_alloc := '[]'::jsonb;
    v_first_batch := null;
    v_unit_cost := null;
    v_fifo_qty := 0;

    for v_slice in
      select * from public.crm_consume_batches_fifo(
        v_workspace_id, p_warehouse_id, v_item_id, v_qty::numeric
      )
    loop
      if v_slice.batch_id is null
         or v_slice.quantity is null
         or v_slice.quantity <= 0
         or v_slice.unit_cost is null
         or v_slice.unit_cost < 0 then
        raise exception
          'issue_order_materials_from_warehouse: invalid FIFO allocation slice for inventory_item_id=%'
          , v_item_id
          using errcode = 'P0001';
      end if;
      if v_first_batch is null then
        v_first_batch := v_slice.batch_id;
        v_unit_cost := v_slice.unit_cost;
      end if;
      v_fifo_qty := v_fifo_qty + v_slice.quantity;
      v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
        'batch_id', v_slice.batch_id,
        'quantity', v_slice.quantity,
        'unit_cost', v_slice.unit_cost,
        'expires_on', v_slice.expires_on,
        'supplier_client_id', v_slice.supplier_client_id
      ));
    end loop;

    -- Fail closed BEFORE any balance / OM / movement mutation: allocated FIFO qty
    -- must equal the requested issue qty. Never post an issue with NULL/partial
    -- batch_allocations while reducing stock.
    if round(coalesce(v_fifo_qty, 0), 3) is distinct from round(v_qty::numeric, 3) then
      raise exception
        'issue_order_materials_from_warehouse: FIFO batch coverage (%) does not equal requested quantity (%) for inventory_item_id=%'
        , coalesce(v_fifo_qty, 0), v_qty, v_item_id
        using errcode = 'P0001';
    end if;
    if v_alloc is null
       or jsonb_typeof(v_alloc) <> 'array'
       or jsonb_array_length(v_alloc) = 0
       or v_first_batch is null then
      raise exception
        'issue_order_materials_from_warehouse: FIFO returned no allocation slices for inventory_item_id=%'
        , v_item_id
        using errcode = 'P0001';
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

    -- Outstanding issued = quantity_issued - quantity_returned.
    -- Allow re-issue after partial returns: (outstanding + v_qty) <= quantity
    -- i.e. quantity_issued + v_qty <= quantity + quantity_returned.
    -- quantity_issued / quantity_returned are cumulative counters (return never
    -- decreases quantity_issued); return RPC enforces returned <= issued.
    update public.order_materials
    set quantity_issued = quantity_issued + v_qty,
        warehouse_id = coalesce(warehouse_id, p_warehouse_id)
    where id = v_line.id
      and (quantity_issued - quantity_returned) + v_qty <= quantity
      and quantity_issued >= quantity_returned
      and quantity_returned >= 0;

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
      p_warehouse_id, v_first_batch, v_unit_cost, v_alloc
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

revoke all on function public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text) to authenticated, service_role;

-- 4) return_order_materials_to_warehouse (body otherwise unchanged from 20261104080000)
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
  v_qty numeric(12,2);
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
  v_slice_unit_cost numeric;
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
    if v_raw <> round(v_raw, 2) then
      raise exception 'Return quantity may have at most 2 decimal places' using errcode = '22023';
    end if;
    if v_raw > 9999999999::numeric then
      raise exception 'Return quantity is too large' using errcode = '22023';
    end if;

    v_qty := v_raw;

    if v_seen ? v_item_id::text then
      raise exception 'Duplicate inventory_item_id in return lines' using errcode = '22023';
    end if;
    v_seen := v_seen || jsonb_build_object(v_item_id::text, v_qty);
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'inventory_item_id', kv.key,
        'quantity', (kv.value #>> '{}')::numeric
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

    if to_regclass('public.warehouse_rpc_idempotency') is not null
       and exists (
         select 1 from public.warehouse_rpc_idempotency r
         where r.workspace_id = v_workspace_id and r.idempotency_key = v_key
       ) then
      raise exception 'Idempotency key was already used with a different warehouse operation'
        using errcode = '22023';
    end if;

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
    v_qty := (v_elem ->> 'quantity')::numeric;

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

    -- Outstanding check against the locked OM row before mutating batches/stock.
    if v_line.quantity_returned + v_qty > v_line.quantity_issued
       or v_line.quantity_issued < v_line.quantity_returned
       or v_line.quantity_returned < 0 then
      raise exception 'Cannot return more than the outstanding issued quantity' using errcode = 'P0001';
    end if;

    -- Provenance policy (fail-closed):
    --   * Only validated non-empty batch_allocations on source ISSUE movements
    --     are peelable (crm_peel_return_batch_slices raises on batch_id-only /
    --     empty / malformed issue provenance — no synthetic zero-cost).
    --   * Pass 1 validates peel coverage with no mutations; Pass 2 restores.
    v_peel := public.crm_peel_return_batch_slices(
      v_workspace_id, v_line.id, p_warehouse_id, v_qty::numeric
    );
    v_alloc := '[]'::jsonb;
    v_first_batch := null;
    v_got := 0;

    if v_peel is null or jsonb_typeof(v_peel) <> 'array' then
      raise exception
        'return_batch_provenance_unproven: peel did not return a JSON array for order_material_id=%; refusing zero-cost invent'
        , v_line.id
        using errcode = 'P0001';
    end if;

    -- Pass 1: validate peel JSON structure and exact qty coverage with NO mutations.
    for v_slice in select value from jsonb_array_elements(v_peel)
    loop
      begin
        v_batch_id := nullif(btrim(coalesce(v_slice ->> 'batch_id', '')), '')::uuid;
      exception
        when others then
          raise exception
            'return_batch_provenance_invalid: peel slice has non-UUID batch_id for order_material_id=%'
            , v_line.id
            using errcode = 'P0001';
      end;

      begin
        v_restore_qty := (v_slice ->> 'quantity')::numeric;
      exception
        when others then
          raise exception
            'return_batch_provenance_invalid: peel slice has non-numeric quantity for order_material_id=%'
            , v_line.id
            using errcode = 'P0001';
      end;

      if v_batch_id is null or v_restore_qty is null or v_restore_qty <= 0 then
        raise exception
          'return_batch_provenance_invalid: peel slice requires batch_id and quantity > 0 for order_material_id=%'
          , v_line.id
          using errcode = 'P0001';
      end if;

      if not (v_slice ? 'unit_cost') then
        raise exception
          'return_batch_provenance_invalid: peel slice missing unit_cost for order_material_id=%'
          , v_line.id
          using errcode = 'P0001';
      end if;
      begin
        v_slice_unit_cost := (v_slice ->> 'unit_cost')::numeric;
      exception
        when others then
          raise exception
            'return_batch_provenance_invalid: peel slice non-numeric unit_cost for order_material_id=%'
            , v_line.id
            using errcode = 'P0001';
      end;
      if v_slice_unit_cost is null or v_slice_unit_cost < 0 then
        raise exception
          'return_batch_provenance_invalid: peel slice unit_cost must be >= 0 for order_material_id=%'
          , v_line.id
          using errcode = 'P0001';
      end if;

      v_got := v_got + v_restore_qty;
      v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch_id,
        'quantity', v_restore_qty,
        'unit_cost', v_slice_unit_cost,
        'expires_on', nullif(v_slice ->> 'expires_on', '')::date,
        'supplier_client_id', nullif(v_slice ->> 'supplier_client_id', '')::uuid
      ));
    end loop;

    v_need := v_qty::numeric - coalesce(v_got, 0);
    -- Exact equality (return qty has at most 2 decimals); do not round away a shortfall/overshoot.
    if coalesce(v_got, 0) is distinct from v_qty::numeric
       or v_alloc is null
       or jsonb_typeof(v_alloc) <> 'array'
       or jsonb_array_length(v_alloc) = 0 then
      raise exception
        'return_batch_provenance_incomplete: allocated (%) does not equal return qty (%); refusing return without complete explicit issue batch_allocations (order_material_id=%)'
        , coalesce(v_got, 0), v_qty, v_line.id
        using errcode = 'P0001';
    end if;

    -- Pass 2: only after full coverage is proven, restore/create batches and record movement alloc.
    v_first_batch := null;
    for v_slice in select value from jsonb_array_elements(v_alloc)
    loop
      v_batch_id := (v_slice ->> 'batch_id')::uuid;
      v_restore_qty := (v_slice ->> 'quantity')::numeric;
      v_new_batch := public.crm_restore_or_create_batch(
        v_workspace_id, p_warehouse_id, v_item_id, v_restore_qty,
        v_batch_id,
        (v_slice ->> 'unit_cost')::numeric,
        nullif(v_slice ->> 'expires_on', '')::date,
        nullif(v_slice ->> 'supplier_client_id', '')::uuid,
        null
      );
      if v_first_batch is null then
        v_first_batch := v_new_batch;
      end if;
    end loop;

    if v_first_batch is null then
      raise exception
        'return_batch_provenance_incomplete: batch restore produced no batch_id for order_material_id=%'
        , v_line.id
        using errcode = 'P0001';
    end if;

    -- Outstanding = quantity_issued - quantity_returned (same model as issue RPC).
    -- Return never decreases quantity_issued; it only increases quantity_returned.
    update public.order_materials
    set quantity_returned = quantity_returned + v_qty
    where id = v_line.id
      and quantity_returned + v_qty <= quantity_issued
      and quantity_issued >= quantity_returned
      and quantity_returned >= 0;

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

    insert into public.inventory_movements (
      workspace_id, inventory_item_id, order_id, order_material_id,
      movement_type, quantity, reason, idempotency_key, created_by,
      warehouse_id, batch_id, batch_allocations
    ) values (
      v_workspace_id, v_item_id, p_order_id, v_line.id,
      'return', v_qty, v_reason, v_key, (select auth.uid()),
      p_warehouse_id, v_first_batch, v_alloc
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

revoke all on function public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text) from public, anon;
grant execute on function public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text) to authenticated, service_role;

-- 5) add_and_issue / set_quantity: p_quantity integer -> numeric (signature change)
drop function if exists public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text);
drop function if exists public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text);

create or replace function public.add_and_issue_order_catalog_material(
  p_order_id uuid,
  p_warehouse_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
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
  v_delta numeric(12,2);
  v_outstanding numeric(12,2);
  v_movements jsonb := '[]'::jsonb;
  v_wh_ok boolean;
  v_fingerprint text;
  v_prior public.warehouse_rpc_idempotency%rowtype;
  v_result jsonb;
begin
  if p_order_id is null or p_warehouse_id is null or p_inventory_item_id is null then
    raise exception 'order_id, warehouse_id and inventory_item_id are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0' using errcode = '22023';
  end if;
  if p_quantity <> round(p_quantity, 2) then
    raise exception 'quantity may have at most 2 decimal places' using errcode = '22023';
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

  -- Effective price: NULL / omitted p_price both resolve via selling_price then 0.
  -- Assigned into numeric(10,2) so fingerprint formatting is deterministic.
  v_price := coalesce(p_price, v_item.selling_price, 0);
  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  -- Fingerprint includes effective normalized price (same key + different price = conflict).
  v_fingerprint := 'add_and_issue'
    || '|order=' || p_order_id::text
    || '|wh=' || p_warehouse_id::text
    || '|item=' || p_inventory_item_id::text
    || '|qty=' || p_quantity::text
    || '|price=' || v_price::text;

  if v_key is not null then
    perform pg_advisory_xact_lock(
      hashtext('warehouse_idempotency'),
      hashtext(v_workspace_id::text || chr(31) || v_key)
    );

    select * into v_prior
    from public.warehouse_rpc_idempotency r
    where r.workspace_id = v_workspace_id
      and r.idempotency_key = v_key
    for update;

    if found then
      if v_prior.rpc_name is distinct from 'add_and_issue_order_catalog_material'
         or v_prior.request_fingerprint is distinct from v_fingerprint then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;
      return v_prior.result;
    end if;

    -- Reject keys already used by standalone issue/return movements, or by the
    -- other atomic RPC. Nested issue called below inserts movements with this
    -- same key only after this check passes (first execution).
    if exists (
      select 1 from public.inventory_movements m
      where m.workspace_id = v_workspace_id and m.idempotency_key = v_key
    ) then
      raise exception 'Idempotency key was already used with a different warehouse operation'
        using errcode = '22023';
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
    -- Fail closed on warehouse mismatch (NULL warehouse may still be assigned).
    if v_line.warehouse_id is not null
       and v_line.warehouse_id is distinct from p_warehouse_id then
      raise exception
        'Existing order material belongs to another warehouse (material_warehouse=%, requested=%)'
        , v_line.warehouse_id, p_warehouse_id
        using errcode = '22023';
    end if;
    v_outstanding := coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0);
    if v_outstanding < 0 then
      raise exception 'order material issued/returned counters are inconsistent' using errcode = 'P0001';
    end if;
    if p_quantity < v_outstanding then
      raise exception 'quantity cannot be less than outstanding issued quantity' using errcode = '22023';
    end if;

    -- After mismatch check: only fill NULL warehouse_id; never overwrite a different one.
    update public.order_materials
    set quantity = p_quantity,
        price = v_price,
        warehouse_id = coalesce(warehouse_id, p_warehouse_id),
        item_name = coalesce(nullif(btrim(item_name), ''), v_item.name),
        supply_source = 'catalog'
    where id = v_line.id
    returning * into v_line;

    -- Issue only the gap to bring outstanding up to requested quantity.
    v_delta := p_quantity - v_outstanding;
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

  v_result := jsonb_build_object(
    'material', to_jsonb(v_line),
    'movements', coalesce(v_movements, '[]'::jsonb)
  );

  if v_key is not null then
    insert into public.warehouse_rpc_idempotency (
      workspace_id, idempotency_key, rpc_name, request_fingerprint, result
    ) values (
      v_workspace_id, v_key, 'add_and_issue_order_catalog_material', v_fingerprint, v_result
    );
  end if;

  return v_result;
end;
$function$;

create or replace function public.set_order_catalog_material_quantity_with_issue(
  p_order_id uuid,
  p_order_material_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
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
  v_delta numeric(12,2);
  v_outstanding numeric(12,2);
  v_wh_ok boolean;
  v_fingerprint text;
  v_prior public.warehouse_rpc_idempotency%rowtype;
  v_result jsonb;
begin
  if p_order_id is null or p_order_material_id is null or p_warehouse_id is null then
    raise exception 'order_id, order_material_id and warehouse_id are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0' using errcode = '22023';
  end if;
  if p_quantity <> round(p_quantity, 2) then
    raise exception 'quantity may have at most 2 decimal places' using errcode = '22023';
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
  -- Fingerprint covers all request fields for this RPC (no price arg).
  v_fingerprint := 'set_qty_issue'
    || '|order=' || p_order_id::text
    || '|om=' || p_order_material_id::text
    || '|wh=' || p_warehouse_id::text
    || '|qty=' || p_quantity::text;

  if v_key is not null then
    perform pg_advisory_xact_lock(
      hashtext('warehouse_idempotency'),
      hashtext(v_workspace_id::text || chr(31) || v_key)
    );

    select * into v_prior
    from public.warehouse_rpc_idempotency r
    where r.workspace_id = v_workspace_id
      and r.idempotency_key = v_key
    for update;

    if found then
      if v_prior.rpc_name is distinct from 'set_order_catalog_material_quantity_with_issue'
         or v_prior.request_fingerprint is distinct from v_fingerprint then
        raise exception 'Idempotency key was already used with a different warehouse operation'
          using errcode = '22023';
      end if;
      return v_prior.result;
    end if;

    if exists (
      select 1 from public.inventory_movements m
      where m.workspace_id = v_workspace_id and m.idempotency_key = v_key
    ) then
      raise exception 'Idempotency key was already used with a different warehouse operation'
        using errcode = '22023';
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
  -- Fail closed on warehouse mismatch (NULL warehouse may still be assigned).
  if v_line.warehouse_id is not null
     and v_line.warehouse_id is distinct from p_warehouse_id then
    raise exception
      'Existing order material belongs to another warehouse (material_warehouse=%, requested=%)'
      , v_line.warehouse_id, p_warehouse_id
      using errcode = '22023';
  end if;

  v_outstanding := coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0);
  if v_outstanding < 0 then
    raise exception 'order material issued/returned counters are inconsistent' using errcode = 'P0001';
  end if;
  if p_quantity < v_outstanding then
    raise exception 'quantity cannot be less than outstanding issued quantity' using errcode = '22023';
  end if;

  -- After mismatch check: only fill NULL warehouse_id; never overwrite a different one.
  update public.order_materials
  set quantity = p_quantity,
      warehouse_id = coalesce(warehouse_id, p_warehouse_id)
  where id = v_line.id
  returning * into v_line;

  -- Issue gap so outstanding reaches requested quantity (supports re-issue after returns).
  v_delta := p_quantity - v_outstanding;

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

  v_result := jsonb_build_object('material', to_jsonb(v_line));

  if v_key is not null then
    insert into public.warehouse_rpc_idempotency (
      workspace_id, idempotency_key, rpc_name, request_fingerprint, result
    ) values (
      v_workspace_id, v_key, 'set_order_catalog_material_quantity_with_issue', v_fingerprint, v_result
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function public.add_and_issue_order_catalog_material(uuid, uuid, uuid, numeric, numeric, text) from public, anon;
revoke all on function public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.add_and_issue_order_catalog_material(uuid, uuid, uuid, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, numeric, text) to authenticated, service_role;

do $postflight$
declare
  v_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.order_services'::regclass and a.attname = 'quantity' and not a.attisdropped;
  if v_type is distinct from 'numeric(12,2)' then
    raise exception 'decimal_quantities postflight: order_services.quantity is %', v_type;
  end if;

  if to_regprocedure('public.add_and_issue_order_catalog_material(uuid, uuid, uuid, numeric, numeric, text)') is null
     or to_regprocedure('public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, numeric, text)') is null then
    raise exception 'decimal_quantities postflight: numeric overloads missing';
  end if;
  if to_regprocedure('public.add_and_issue_order_catalog_material(uuid, uuid, uuid, integer, numeric, text)') is not null
     or to_regprocedure('public.set_order_catalog_material_quantity_with_issue(uuid, uuid, uuid, integer, text)') is not null then
    raise exception 'decimal_quantities postflight: old integer overloads still present';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('sync_order_materials', 'issue_order_materials_from_warehouse',
                        'return_order_materials_to_warehouse', 'add_and_issue_order_catalog_material',
                        'set_order_catalog_material_quantity_with_issue')
      and p.prosrc like '%whole number%'
  ) then
    raise exception 'decimal_quantities postflight: a whole-number check is still present';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
