-- =============================================================================
-- Change order material quantity with warehouse stock movement
-- Script: 20261111210000_change_order_material_quantity.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: public.orders, public.order_materials, public.warehouse_stock,
--   public.inventory_items, public.inventory_movements, public.is_workspace_member(uuid),
--   public.issue_order_materials_from_warehouse(...),
--   public.return_order_materials_to_warehouse(...),
--   public.crm_order_event_insert(...) (optional — events skipped if missing).
-- =============================================================================
-- Atomic single-line quantity change:
--   * catalog: +N issues via issue_order_materials_from_warehouse;
--              -N that would leave outstanding above the new qty returns via
--              return_order_materials_to_warehouse then collapses issued/returned
--              so a fully-issued line stays fully issued;
--   * freeform / customer: quantity only, no stock;
--   * recalculates orders.total_price (keeps discount_total);
--   * refuses closed/cancelled orders; insufficient stock fails closed.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then v_problems := v_problems || 'orders missing; '; end if;
  if to_regclass('public.order_materials') is null then v_problems := v_problems || 'order_materials missing; '; end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member missing; ';
  end if;
  if to_regprocedure('public.workspace_member_role(uuid)') is null then
    v_problems := v_problems || 'workspace_member_role missing; ';
  end if;
  if to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null then
    v_problems := v_problems || 'issue_order_materials_from_warehouse missing; ';
  end if;
  if to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)') is null then
    v_problems := v_problems || 'return_order_materials_to_warehouse missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'change_order_material_quantity preflight failed: %', v_problems;
  end if;
end;
$preflight$;

create or replace function public.crm_change_order_material_quantity(
  p_order_id uuid,
  p_order_material_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_line public.order_materials%rowtype;
  v_role text;
  v_allowed boolean := false;
  v_old_qty numeric(12,2);
  v_new_qty numeric(12,2);
  v_outstanding numeric(12,2);
  v_delta numeric(12,2);
  v_to_return numeric(12,2);
  v_wh_available numeric(12,2);
  v_supply text;
  v_services numeric := 0;
  v_discount numeric := 0;
  v_has_discount_total boolean;
  v_total numeric;
  v_key text;
  v_actor_name text;
  v_jwt jsonb;
begin
  if v_uid is null then
    raise exception 'change_order_material_quantity:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_order_material_id is null then
    raise exception 'change_order_material_quantity:invalid_args' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'change_order_material_quantity:invalid_quantity' using errcode = '22023';
  end if;
  if p_quantity <> round(p_quantity, 2) then
    raise exception 'change_order_material_quantity:invalid_quantity' using errcode = '22023';
  end if;
  v_new_qty := round(p_quantity, 2);

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'change_order_material_quantity:order_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_workspace_member(v_order.workspace_id), false) then
    raise exception 'change_order_material_quantity:forbidden' using errcode = '42501';
  end if;

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'change_order_material_quantity:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'change_order_material_quantity:cancelled_order_immutable' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_order.workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using v_order.workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'change_order_material_quantity:forbidden' using errcode = '42501';
  end if;

  select * into v_line
  from public.order_materials om
  where om.id = p_order_material_id
    and om.order_id = p_order_id
  for update;
  if not found then
    raise exception 'change_order_material_quantity:line_not_found' using errcode = 'P0002';
  end if;

  v_old_qty := round(coalesce(v_line.quantity, 0)::numeric, 2);
  v_supply := coalesce(nullif(btrim(v_line.supply_source), ''), case when v_line.inventory_item_id is null then 'one_time' else 'catalog' end);
  v_outstanding := round(
    (coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0))::numeric,
    2
  );
  if v_outstanding < 0 then
    raise exception 'change_order_material_quantity:counters_inconsistent' using errcode = 'P0001';
  end if;

  if v_new_qty = v_old_qty then
    return jsonb_build_object(
      'changed', false,
      'material', to_jsonb(v_line),
      'total_price', v_order.total_price
    );
  end if;

  if v_supply = 'catalog' and v_line.inventory_item_id is not null then
    if v_line.warehouse_id is null then
      raise exception 'change_order_material_quantity:warehouse_required' using errcode = '22023';
    end if;

    -- Catalog qty changes require warehouse role (same bar as immediate issue RPCs).
    if v_role is null or v_role not in ('owner', 'admin', 'manager') then
      raise exception 'change_order_material_quantity:warehouse_permission' using errcode = '42501';
    end if;

    v_key := 'chg_qty_' || replace(gen_random_uuid()::text, '-', '');

    if v_new_qty > v_old_qty then
      -- Hard stock cap: never write off more than on-hand (row lock prevents races).
      v_delta := round(v_new_qty - v_old_qty, 2);
      select round(coalesce(ws.quantity, 0)::numeric, 2)
        into v_wh_available
      from public.warehouse_stock ws
      where ws.workspace_id = v_order.workspace_id
        and ws.warehouse_id = v_line.warehouse_id
        and ws.inventory_item_id = v_line.inventory_item_id
      for update;
      if not found then
        v_wh_available := 0;
      end if;
      if coalesce(v_wh_available, 0) < v_delta then
        raise exception
          'order_material:insufficient_stock available=% requested=%',
          coalesce(v_wh_available, 0), v_delta
          using errcode = 'P0001';
      end if;

      -- Raise requested qty first so the issue RPC's outstanding ≤ quantity check passes.
      update public.order_materials
         set quantity = v_new_qty
       where id = v_line.id
      returning * into v_line;

      perform public.issue_order_materials_from_warehouse(
        p_order_id,
        jsonb_build_array(jsonb_build_object(
          'inventory_item_id', v_line.inventory_item_id,
          'quantity', v_delta
        )),
        v_line.warehouse_id,
        v_key
      );

      select * into v_line from public.order_materials where id = v_line.id;
    else
      -- Shrink: return any outstanding that would exceed the new qty, then collapse
      -- issued/returned by the same amount so badges stay coherent (fully issued stays
      -- fully issued when returned was previously 0).
      if v_new_qty < v_outstanding then
        v_to_return := round(v_outstanding - v_new_qty, 2);
        perform public.return_order_materials_to_warehouse(
          p_order_id,
          jsonb_build_array(jsonb_build_object(
            'inventory_item_id', v_line.inventory_item_id,
            'quantity', v_to_return
          )),
          v_line.warehouse_id,
          'quantity_change',
          v_key
        );

        update public.order_materials
           set quantity = v_new_qty,
               quantity_issued = greatest(0, coalesce(quantity_issued, 0) - v_to_return),
               quantity_returned = greatest(0, coalesce(quantity_returned, 0) - v_to_return)
         where id = v_line.id
        returning * into v_line;
      else
        update public.order_materials
           set quantity = v_new_qty
         where id = v_line.id
        returning * into v_line;
      end if;
    end if;
  else
    -- Freeform / customer-supplied: no stock movement. Still refuse going below outstanding.
    if v_new_qty < v_outstanding then
      raise exception 'change_order_material_quantity:below_outstanding' using errcode = '22023';
    end if;
    update public.order_materials
       set quantity = v_new_qty
     where id = v_line.id
    returning * into v_line;
  end if;

  -- Recalculate from ALL persisted lines with the same per-line discount formula as
  -- crm_set_order_line_discounts: a percent discount scales with the new quantity, so
  -- discount_total must be recomputed, not carried over.
  with lines as (
    select round(coalesce(s.price, 0)::numeric * coalesce(s.quantity, 0)::numeric, 2) as gross,
           to_jsonb(s) ->> 'discount_type' as dt,
           nullif(to_jsonb(s) ->> 'discount_value', '')::numeric as dv
    from public.order_services s
    where s.order_id = p_order_id
    union all
    select round(coalesce(m.price, 0)::numeric * coalesce(m.quantity, 0)::numeric, 2),
           to_jsonb(m) ->> 'discount_type',
           nullif(to_jsonb(m) ->> 'discount_value', '')::numeric
    from public.order_materials m
    where m.order_id = p_order_id
  ),
  priced as (
    select gross,
           case
             when dt = 'percent' and dv > 0 and gross > 0
               then least(gross, round(gross * least(dv, 100) / 100, 2))
             when dt = 'amount' and dv > 0 and gross > 0
               then least(gross, round(dv, 2))
             else 0
           end as disc
    from lines
  )
  select coalesce(sum(gross), 0), coalesce(sum(disc), 0)
    into v_services, v_discount
  from priced;
  v_total := greatest(0, round(v_services - v_discount, 2));

  select exists (
    select 1 from pg_attribute
    where attrelid = 'public.orders'::regclass and attname = 'discount_total' and not attisdropped
  ) into v_has_discount_total;

  update public.orders
     set total_price = v_total,
         updated_at = now()
   where id = p_order_id;
  if v_has_discount_total then
    execute 'update public.orders set discount_total = $2 where id = $1' using p_order_id, round(v_discount, 2);
  end if;

  if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is not null then
    begin
      v_jwt := coalesce((select auth.jwt()), '{}'::jsonb);
    exception when others then
      v_jwt := '{}'::jsonb;
    end;
    v_actor_name := coalesce(
      nullif(btrim(v_jwt -> 'user_metadata' ->> 'full_name'), ''),
      nullif(btrim(v_jwt -> 'user_metadata' ->> 'name'), ''),
      nullif(btrim(v_jwt ->> 'email'), '')
    );
    perform public.crm_order_event_insert(
      v_order.workspace_id,
      p_order_id,
      'material_updated',
      'quantity',
      v_old_qty::text,
      v_new_qty::text,
      jsonb_build_object(
        'item_name', v_line.item_name,
        'line_id', v_line.id,
        'changes', jsonb_build_object('quantity', jsonb_build_object('from', v_old_qty, 'to', v_new_qty))
      ),
      v_uid,
      v_actor_name
    );
  end if;

  return jsonb_build_object(
    'changed', true,
    'material', to_jsonb(v_line),
    'total_price', v_total,
    'old_quantity', v_old_qty,
    'new_quantity', v_new_qty
  );
end;
$fn$;

revoke all on function public.crm_change_order_material_quantity(uuid, uuid, numeric) from public, anon;
grant execute on function public.crm_change_order_material_quantity(uuid, uuid, numeric) to authenticated, service_role;

comment on function public.crm_change_order_material_quantity(uuid, uuid, numeric) is
  'managed-object: core-app/crm_change_order_material_quantity@v1 — atomic order material qty change with issue (+N) / return+collapse (−N) and totals.';

do $postflight$
begin
  if to_regprocedure('public.crm_change_order_material_quantity(uuid,uuid,numeric)') is null then
    raise exception 'change_order_material_quantity postflight failed: RPC missing';
  end if;
end;
$postflight$;

-- PostgREST picks up new functions after a schema reload.
notify pgrst, 'reload schema';

commit;
