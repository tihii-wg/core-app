-- =============================================================================
-- Delete order material line with warehouse stock return
-- Script: 20261111230000_delete_order_material.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: public.orders, public.order_materials, public.warehouse_stock,
--   public.is_workspace_member(uuid), public.workspace_member_role(uuid),
--   public.return_order_materials_to_warehouse(...),
--   public.crm_order_event_insert(...) (optional — events skipped if missing).
-- =============================================================================
-- Atomic single-line delete:
--   * catalog with outstanding (issued − returned) > 0: return stock via
--     return_order_materials_to_warehouse, then delete the line;
--   * freeform / customer / zero outstanding: delete only, no stock;
--   * unlink not-yet-activated warranty_records pointing at the line (when table exists);
--   * recalculates orders.total_price + discount_total with per-line discount formula;
--   * refuses closed/cancelled orders; writes material_removed order event.
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
  if to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)') is null then
    v_problems := v_problems || 'return_order_materials_to_warehouse missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'delete_order_material preflight failed: %', v_problems;
  end if;
end;
$preflight$;

create or replace function public.crm_delete_order_material(
  p_order_id uuid,
  p_order_material_id uuid
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
  v_outstanding numeric(12,2);
  v_supply text;
  v_services numeric := 0;
  v_discount numeric := 0;
  v_has_discount_total boolean;
  v_total numeric;
  v_key text;
  v_actor_name text;
  v_jwt jsonb;
  v_item_name text;
  v_qty numeric(12,2);
begin
  if v_uid is null then
    raise exception 'delete_order_material:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_order_material_id is null then
    raise exception 'delete_order_material:invalid_args' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'delete_order_material:order_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_workspace_member(v_order.workspace_id), false) then
    raise exception 'delete_order_material:forbidden' using errcode = '42501';
  end if;

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'delete_order_material:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'delete_order_material:cancelled_order_immutable' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_order.workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using v_order.workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'delete_order_material:forbidden' using errcode = '42501';
  end if;

  select * into v_line
  from public.order_materials om
  where om.id = p_order_material_id
    and om.order_id = p_order_id
  for update;
  if not found then
    raise exception 'delete_order_material:line_not_found' using errcode = 'P0002';
  end if;

  v_item_name := coalesce(v_line.item_name, '');
  v_qty := round(coalesce(v_line.quantity, 0)::numeric, 2);
  v_supply := coalesce(nullif(btrim(v_line.supply_source), ''), case when v_line.inventory_item_id is null then 'one_time' else 'catalog' end);
  v_outstanding := round(
    (coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0))::numeric,
    2
  );
  if v_outstanding < 0 then
    raise exception 'delete_order_material:counters_inconsistent' using errcode = 'P0001';
  end if;

  if v_supply = 'catalog' and v_line.inventory_item_id is not null then
    if v_role is null or v_role not in ('owner', 'admin', 'manager') then
      raise exception 'delete_order_material:warehouse_permission' using errcode = '42501';
    end if;

    if v_outstanding > 0 then
      if v_line.warehouse_id is null then
        raise exception 'delete_order_material:warehouse_required' using errcode = '22023';
      end if;
      v_key := 'del_mat_' || replace(gen_random_uuid()::text, '-', '');
      perform public.return_order_materials_to_warehouse(
        p_order_id,
        jsonb_build_array(jsonb_build_object(
          'inventory_item_id', v_line.inventory_item_id,
          'quantity', v_outstanding
        )),
        v_line.warehouse_id,
        'line_deleted',
        v_key
      );
    end if;
  end if;

  -- Not-yet-activated warranty snapshots may still point at this line; unlink or delete them.
  if to_regclass('public.warranty_records') is not null then
    begin
      execute $sql$
        delete from public.warranty_records wr
         where wr.order_id = $1
           and wr.order_material_id = $2
           and not exists (
             select 1 from public.warranty_order_claims c where c.warranty_record_id = wr.id
           )
      $sql$ using p_order_id, p_order_material_id;
    exception when undefined_table or undefined_column then
      begin
        execute $sql$
          update public.warranty_records
             set order_material_id = null
           where order_id = $1
             and order_material_id = $2
        $sql$ using p_order_id, p_order_material_id;
      exception when others then
        null;
      end;
    end;
  end if;

  delete from public.order_materials
   where id = p_order_material_id
     and order_id = p_order_id;
  if not found then
    raise exception 'delete_order_material:line_not_found' using errcode = 'P0002';
  end if;

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
      'material_removed',
      'order_materials',
      v_item_name,
      null,
      jsonb_build_object(
        'item_name', v_item_name,
        'line_id', p_order_material_id,
        'quantity', v_qty,
        'supply_source', v_supply
      ),
      v_uid,
      v_actor_name
    );
  end if;

  return jsonb_build_object(
    'deleted', true,
    'line_id', p_order_material_id,
    'total_price', v_total,
    'item_name', v_item_name
  );
end;
$fn$;

revoke all on function public.crm_delete_order_material(uuid, uuid) from public, anon;
grant execute on function public.crm_delete_order_material(uuid, uuid) to authenticated, service_role;

comment on function public.crm_delete_order_material(uuid, uuid) is
  'managed-object: core-app/crm_delete_order_material@v1 — delete order material with stock return + totals.';

do $postflight$
begin
  if to_regprocedure('public.crm_delete_order_material(uuid,uuid)') is null then
    raise exception 'delete_order_material postflight failed: RPC missing';
  end if;
end;
$postflight$;

commit;
