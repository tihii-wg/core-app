-- =============================================================================
-- Core App — Secure replacement for public.sync_order_materials(uuid, jsonb)
-- MANUAL APPLY ONLY — paste into MAIN Supabase SQL Editor AFTER PREFLIGHT PASS
-- and owner authorization.
--
-- Replaces ONLY public.sync_order_materials(uuid, jsonb) via CREATE OR REPLACE.
-- Does NOT create/drop indexes, constraints, triggers, or other RPCs.
-- Does NOT repair or delete duplicate user data.
-- No TEMP tables. No dynamic SQL. JSONB staging only.
--
-- Lock order (aligned with warehouse issue/return):
--   1) orders row FOR UPDATE
--   2) order_materials for that order FOR UPDATE
--        ORDER BY inventory_item_id NULLS LAST, id
--
-- Catalog uniqueness prerequisite (enforced in Preflight, not created here):
--   unique (order_id, inventory_item_id) for every inventory_item_id IS NOT NULL
--   preferred: order_materials_order_catalog_item_uidx
--
-- Accounting (repository-established):
--   orders.total_price = sum(order_services.price*quantity)
--                     + sum(order_materials.price*quantity) for ALL remaining rows
--   Rows with issue/return history are retained when omitted from the payload
--   and remain included in the material total.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preflight (fail closed — abort before CREATE OR REPLACE)
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_ret text;
  v_missing text;
  v_idx_ok boolean := false;
  v_dup_count integer := 0;
  v_dup_report text;
begin
  if to_regprocedure('public.sync_order_materials(uuid, jsonb)') is null then
    raise exception
      'Preflight: public.sync_order_materials(uuid, jsonb) does not exist. Restore the prior RPC before applying this secure replacement.';
  end if;

  select pg_get_function_result('public.sync_order_materials(uuid, jsonb)'::regprocedure)
    into v_ret;
  if v_ret is distinct from 'SETOF order_materials'
     and v_ret is distinct from 'SETOF public.order_materials' then
    raise exception
      'Preflight: incompatible return type % — expected SETOF order_materials',
      coalesce(v_ret, '<null>');
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight: public.is_workspace_member(uuid) missing';
  end if;

  select string_agg(c, ', ' order by c) into v_missing
  from unnest(array[
    'id', 'order_id', 'inventory_item_id', 'item_name', 'price', 'quantity',
    'quantity_issued', 'quantity_returned', 'supply_source', 'created_at'
  ]) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_materials'
      and column_name = c
  );
  if v_missing is not null then
    raise exception 'Preflight: order_materials missing columns: %', v_missing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_materials'
      and column_name = 'inventory_item_id'
      and is_nullable = 'NO'
  ) then
    raise exception
      'Preflight: order_materials.inventory_item_id is still NOT NULL — freeform schema not applied';
  end if;

  select true into v_idx_ok
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'order_materials'
    and i.indisunique
    and i.indisvalid
    and i.indisready
    and not i.indisexclusion
    and i.indnkeyatts = 2
    and i.indexprs is null
    and i.indkey[0] > 0
    and i.indkey[1] > 0
    and (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = i.indkey[0]) = 'order_id'
    and (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = i.indkey[1]) = 'inventory_item_id'
    and (
      i.indpred is null
      or regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '\s+', ' ', 'g')
         in ('inventory_item_id is not null', '(inventory_item_id is not null)')
    )
  limit 1;

  if not coalesce(v_idx_ok, false) then
    raise exception
      'Preflight: catalog uniqueness for (order_id, inventory_item_id) covering every non-null inventory_item_id is not present (unique+valid+ready, exactly two key columns, no expressions; non-partial OR predicate inventory_item_id IS NOT NULL). Do not APPLY — restore uniqueness separately. This script does not create indexes.';
  end if;

  select count(*)::integer,
         string_agg(format('%s/%s×%s', order_id, inventory_item_id, cnt), '; ')
    into v_dup_count, v_dup_report
  from (
    select order_id, inventory_item_id, count(*)::integer as cnt
    from public.order_materials
    where inventory_item_id is not null
    group by order_id, inventory_item_id
    having count(*) > 1
    limit 50
  ) d;

  if coalesce(v_dup_count, 0) > 0 then
    raise exception
      'Preflight: % duplicate catalog pair group(s) exist. Resolve manually before APPLY. Samples: %',
      v_dup_count, coalesce(v_dup_report, '');
  end if;
end
$preflight$;

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
  v_qty integer;
  v_name text;
  v_price numeric(10,2);
  v_source text;
  v_existing record;
  v_outstanding integer;
  v_service_total numeric(12,2);
  v_material_total numeric(12,2);
  v_desired_qty integer;
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
    if v_raw <> trunc(v_raw) then
      raise exception 'Material quantity must be a whole number' using errcode = '22023';
    end if;
    if v_raw > 2147483647::numeric then
      raise exception 'Material quantity is too large' using errcode = '22023';
    end if;
    v_qty := trunc(v_raw)::integer;

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
      v_desired_qty := coalesce((v_catalog ->> v_existing.inventory_item_id::text)::integer, 0);

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
        select (elem ->> 'quantity')::integer
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
    select key::uuid, value::text::integer from jsonb_each(v_catalog)
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
    v_qty := (v_ff ->> 'quantity')::integer;
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

commit;
