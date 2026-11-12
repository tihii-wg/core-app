-- =============================================================================
-- crm_update_order_material_line — atomic per-order material line edit
-- (quantity with stock issue/return, price, warehouse, warranty, discount).
--
-- Clear semantics (same convention as crm_update_order_service_line edit):
--   p_set_warranty = true  → write p_warranty_months/days/km (NULL clears)
--   p_set_discount = true  → write p_discount_type + p_discount_value (NULL/NULL clears)
--   p_set_warehouse = true → write p_warehouse_id (only when nothing issued/returned)
-- Quantity/price: pass the new value; NULL means leave unchanged.
--
-- Quantity stock moves reuse crm_change_order_material_quantity (no duplicated stock code).
-- Apply on MAIN only when authorized. Do not run from the agent.
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.orders') is null then
    raise exception 'order_material_line_edit preflight failed: public.orders missing';
  end if;
  if to_regclass('public.order_materials') is null then
    raise exception 'order_material_line_edit preflight failed: public.order_materials missing';
  end if;
  if to_regprocedure('public.crm_get_order_full(uuid)') is null then
    raise exception 'order_material_line_edit preflight failed: crm_get_order_full missing';
  end if;
  if to_regprocedure('public.crm_change_order_material_quantity(uuid,uuid,numeric)') is null then
    raise exception 'order_material_line_edit preflight failed: crm_change_order_material_quantity missing';
  end if;
  if to_regprocedure('public.crm_recalc_order_line_totals(uuid)') is null then
    raise exception 'order_material_line_edit preflight failed: crm_recalc_order_line_totals missing';
  end if;
end
$pre$;

create or replace function public.crm_update_order_material_line(
  p_order_id uuid,
  p_line_id uuid,
  p_quantity numeric default null,
  p_price numeric default null,
  p_warehouse_id uuid default null,
  p_set_warehouse boolean default false,
  p_warranty_months integer default null,
  p_warranty_days integer default null,
  p_warranty_km integer default null,
  p_set_warranty boolean default false,
  p_discount_type text default null,
  p_discount_value numeric default null,
  p_set_discount boolean default false
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
  v_issued numeric(12,2);
  v_returned numeric(12,2);
  v_old_qty numeric(12,2);
  v_old_price numeric(12,2);
  v_old_wh uuid;
  v_has_warranty boolean;
  v_has_discount boolean;
  v_changes jsonb := '{}'::jsonb;
  v_actor_name text;
  v_jwt jsonb;
  v_qty_result jsonb;
begin
  if v_uid is null then
    raise exception 'update_order_material_line:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_line_id is null then
    raise exception 'update_order_material_line:invalid_args' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'update_order_material_line:order_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_workspace_member(v_order.workspace_id), false) then
    raise exception 'update_order_material_line:forbidden' using errcode = '42501';
  end if;

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'update_order_material_line:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'update_order_material_line:cancelled_order_immutable' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_order.workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using v_order.workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'update_order_material_line:forbidden' using errcode = '42501';
  end if;

  select * into v_line
  from public.order_materials om
  where om.id = p_line_id and om.order_id = p_order_id
  for update;
  if not found then
    raise exception 'update_order_material_line:line_not_found' using errcode = 'P0002';
  end if;

  v_old_qty := round(coalesce(v_line.quantity, 0)::numeric, 2);
  v_old_price := round(coalesce(v_line.price, 0)::numeric, 2);
  v_old_wh := v_line.warehouse_id;
  v_issued := round(coalesce(v_line.quantity_issued, 0)::numeric, 2);
  v_returned := round(coalesce(v_line.quantity_returned, 0)::numeric, 2);
  v_outstanding := round((v_issued - v_returned)::numeric, 2);

  -- Warehouse move: only when nothing has been issued or returned yet.
  if p_set_warehouse then
    if v_issued <> 0 or v_returned <> 0 then
      raise exception 'update_order_material_line:warehouse_locked_after_issue' using errcode = '42501';
    end if;
    if p_warehouse_id is null then
      raise exception 'update_order_material_line:warehouse_required' using errcode = '22023';
    end if;
    -- Catalog lines that move stock need warehouse rights (same bar as qty change).
    if v_line.inventory_item_id is not null and (v_role is null or v_role not in ('owner', 'admin', 'manager')) then
      raise exception 'update_order_material_line:warehouse_permission' using errcode = '42501';
    end if;
    if p_warehouse_id is distinct from v_old_wh then
      update public.order_materials set warehouse_id = p_warehouse_id where id = p_line_id
      returning * into v_line;
      v_changes := v_changes || jsonb_build_object(
        'warehouse_id', jsonb_build_object('from', v_old_wh, 'to', p_warehouse_id)
      );
    end if;
  end if;

  -- Quantity: reuse the existing stock-aware RPC (issue / return / freeform).
  if p_quantity is not null then
    if p_quantity <= 0 then
      raise exception 'update_order_material_line:invalid_quantity' using errcode = '22023';
    end if;
    if round(p_quantity, 2) is distinct from v_old_qty then
      v_qty_result := public.crm_change_order_material_quantity(p_order_id, p_line_id, round(p_quantity, 2));
      v_changes := v_changes || jsonb_build_object(
        'quantity', jsonb_build_object('from', v_old_qty, 'to', round(p_quantity, 2))
      );
      select * into v_line from public.order_materials where id = p_line_id;
    end if;
  end if;

  if p_price is not null then
    if p_price < 0 then
      raise exception 'update_order_material_line:invalid_price' using errcode = '22023';
    end if;
    if round(p_price, 2) is distinct from round(coalesce(v_line.price, 0)::numeric, 2) then
      update public.order_materials set price = round(p_price, 2) where id = p_line_id
      returning * into v_line;
      v_changes := v_changes || jsonb_build_object(
        'price', jsonb_build_object('from', v_old_price, 'to', round(p_price, 2))
      );
    end if;
  end if;

  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'warranty_months' and not attisdropped
  ) into v_has_warranty;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'discount_type' and not attisdropped
  ) into v_has_discount;

  if p_set_warranty and v_has_warranty then
    if p_warranty_months is not null and p_warranty_months < 0 then
      raise exception 'update_order_material_line:invalid_warranty_months' using errcode = '22023';
    end if;
    if p_warranty_days is not null and p_warranty_days < 0 then
      raise exception 'update_order_material_line:invalid_warranty_days' using errcode = '22023';
    end if;
    if p_warranty_km is not null and p_warranty_km < 0 then
      raise exception 'update_order_material_line:invalid_warranty_km' using errcode = '22023';
    end if;
    execute $sql$
      update public.order_materials
         set warranty_months = $2, warranty_days = $3, warranty_km = $4
       where id = $1
    $sql$ using p_line_id, p_warranty_months, p_warranty_days, p_warranty_km;
    select * into v_line from public.order_materials where id = p_line_id;
    v_changes := v_changes || jsonb_build_object(
      'warranty', jsonb_build_object(
        'months', p_warranty_months,
        'days', p_warranty_days,
        'km', p_warranty_km
      )
    );
  end if;

  if p_set_discount and v_has_discount then
    if p_discount_type is not null and p_discount_type not in ('percent', 'amount') then
      raise exception 'update_order_material_line:invalid_discount_type' using errcode = '22023';
    end if;
    if p_discount_value is not null and p_discount_value < 0 then
      raise exception 'update_order_material_line:invalid_discount_value' using errcode = '22023';
    end if;
    execute 'update public.order_materials set discount_type = $2, discount_value = $3 where id = $1'
      using p_line_id, p_discount_type, p_discount_value;
    select * into v_line from public.order_materials where id = p_line_id;
    v_changes := v_changes || jsonb_build_object(
      'discount', jsonb_build_object('type', p_discount_type, 'value', p_discount_value)
    );
  end if;

  perform public.crm_recalc_order_line_totals(p_order_id);

  -- One summary event for edits the order_materials activity trigger does not log
  -- (it already records quantity and price changes as material_updated).
  if v_changes ? 'warehouse_id' or v_changes ? 'warranty' or v_changes ? 'discount' then
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
        'edit',
        null,
        null,
        jsonb_build_object(
          'item_name', v_line.item_name,
          'line_id', v_line.id,
          'changes', v_changes - 'price' - 'quantity'
        ),
        v_uid,
        v_actor_name
      );
    end if;
  end if;

  return public.crm_get_order_full(p_order_id);
end;
$fn$;

revoke all on function public.crm_update_order_material_line(
  uuid, uuid, numeric, numeric, uuid, boolean,
  integer, integer, integer, boolean,
  text, numeric, boolean
) from public, anon;
grant execute on function public.crm_update_order_material_line(
  uuid, uuid, numeric, numeric, uuid, boolean,
  integer, integer, integer, boolean,
  text, numeric, boolean
) to authenticated;

do $post$
begin
  if to_regprocedure(
    'public.crm_update_order_material_line(uuid,uuid,numeric,numeric,uuid,boolean,integer,integer,integer,boolean,text,numeric,boolean)'
  ) is null then
    raise exception 'order_material_line_edit postflight failed: crm_update_order_material_line missing';
  end if;
end
$post$;

-- PostgREST picks up the new signature immediately.
notify pgrst, 'reload schema';

commit;
