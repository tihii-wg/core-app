-- =============================================================================
-- Manual price per order material line (catalog parts too)
-- Script: 20261107120000_order_material_line_prices.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- Problem: catalog material lines always take inventory_items.selling_price inside
-- sync_order_materials (which must not be modified), and the browser cannot UPDATE
-- order_materials, so the price of a catalog part cannot be changed for one order.
--
-- New RPC crm_set_order_material_prices(p_order_id uuid, p_lines jsonb) -> jsonb
--   p_lines: [{ "line_id": uuid, "price": number >= 0 }, ...]
--   - permission: same rule as crm_set_order_line_discounts (owner/admin/manager or orders.edit)
--   - lines must belong to the order; price rounded to 2 decimals; 0 <= price <= 100 000 000
--   - updates ONLY order_materials.price; closed-order rules are enforced by the existing
--     order_materials_closed_guard trigger; catalog item prices are never changed
--   - recalculates orders.total_price = sum(lines) - discount_total (keeps existing discounts)
--   Returns { updated, total_price }.
--
-- Does NOT: change sync_order_materials, stock, inventory_items, discounts. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.order_materials') is null or to_regclass('public.orders') is null then
    raise exception 'order_material_line_prices preflight: order tables missing';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'order_material_line_prices preflight: is_workspace_member missing';
  end if;
  if to_regprocedure('public.workspace_member_role(uuid)') is null then
    raise exception 'order_material_line_prices preflight: workspace_member_role missing';
  end if;
end;
$preflight$;

create or replace function public.crm_set_order_material_prices(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_workspace_id uuid;
  v_role text;
  v_allowed boolean := false;
  v_elem jsonb;
  v_line_id uuid;
  v_price numeric;
  v_updated integer := 0;
  v_n integer;
  v_services numeric := 0;
  v_materials numeric := 0;
  v_discount numeric := 0;
  v_has_discount_total boolean;
  v_total numeric;
begin
  if auth.uid() is null then
    raise exception 'order_material_price:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null then
    raise exception 'order_material_price:invalid_args' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('updated', 0);
  end if;

  select o.workspace_id into v_workspace_id from public.orders o where o.id = p_order_id for update;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'order_material_price:forbidden' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using v_workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'order_material_price:forbidden' using errcode = '42501';
  end if;

  for v_elem in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_line_id := nullif(btrim(v_elem ->> 'line_id'), '')::uuid;
      v_price := round((v_elem ->> 'price')::numeric, 2);
    exception when others then
      raise exception 'order_material_price:invalid_line' using errcode = '22023';
    end;
    if v_line_id is null or v_price is null or v_price < 0 or v_price > 100000000 then
      raise exception 'order_material_price:invalid_price' using errcode = '22023';
    end if;

    update public.order_materials m
       set price = v_price
     where m.id = v_line_id
       and m.order_id = p_order_id
       and m.price is distinct from v_price;
    get diagnostics v_n = row_count;

    if v_n = 0 and not exists (select 1 from public.order_materials m where m.id = v_line_id and m.order_id = p_order_id) then
      raise exception 'order_material_price:line_not_found' using errcode = 'P0002';
    end if;
    v_updated := v_updated + v_n;
  end loop;

  -- Recalculate the order total, keeping the stored discount.
  select coalesce(sum(round(coalesce(s.price, 0)::numeric * coalesce(s.quantity, 0)::numeric, 2)), 0)
    into v_services from public.order_services s where s.order_id = p_order_id;
  select coalesce(sum(round(coalesce(m.price, 0)::numeric * coalesce(m.quantity, 0)::numeric, 2)), 0)
    into v_materials from public.order_materials m where m.order_id = p_order_id;

  select exists (select 1 from pg_attribute where attrelid = 'public.orders'::regclass
                 and attname = 'discount_total' and not attisdropped) into v_has_discount_total;
  if v_has_discount_total then
    execute 'select coalesce(discount_total, 0) from public.orders where id = $1' into v_discount using p_order_id;
  end if;

  v_total := greatest(round(v_services + v_materials - coalesce(v_discount, 0), 2), 0);
  update public.orders set total_price = v_total where id = p_order_id;

  return jsonb_build_object('updated', v_updated, 'total_price', v_total);
end;
$fn$;

revoke all on function public.crm_set_order_material_prices(uuid, jsonb) from public, anon;
grant execute on function public.crm_set_order_material_prices(uuid, jsonb) to authenticated, service_role;

comment on function public.crm_set_order_material_prices(uuid, jsonb) is
  'managed-object: core-app/crm_set_order_material_prices@v1 — manual per-order price of material lines (catalog parts too); never changes catalog prices or stock.';

do $postflight$
begin
  if to_regprocedure('public.crm_set_order_material_prices(uuid,jsonb)') is null then
    raise exception 'order_material_line_prices postflight: RPC missing';
  end if;
end;
$postflight$;

commit;
