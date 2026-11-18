-- =============================================================================
-- Add ONE one-time item / customer part to an order in a single call
-- Script: 20261118140000_add_order_freeform_material.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- Depends on: 20261112140000_order_line_rpcs (crm_assert_order_line_edit, crm_recalc_order_line_totals,
--   crm_get_order_full), 20261102210000_order_materials_freeform_supply_source (supply_source).
-- =============================================================================
-- Before: the app rebuilt the whole order for one freeform line (≈21 sequential requests, ~4 s):
-- read order → write order row → discounts → all lines → sync_order_materials → warranties ×2 → totals →
-- team → read order. Now: one RPC = insert the line (+ client product discount, + warranty snapshot),
-- recalc totals, return the full order (same payload as crm_add_order_service_line).
-- Same rules as the existing line RPCs: orders.edit permission, closed / cancelled orders immutable.
-- Freeform lines never touch stock (inventory_item_id null, nothing issued).
-- Idempotent (create or replace). Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regprocedure('public.crm_assert_order_line_edit(uuid)') is null then
    v_problems := v_problems || 'crm_assert_order_line_edit missing; ';
  end if;
  if to_regprocedure('public.crm_recalc_order_line_totals(uuid)') is null then
    v_problems := v_problems || 'crm_recalc_order_line_totals missing; ';
  end if;
  if to_regprocedure('public.crm_get_order_full(uuid)') is null then
    v_problems := v_problems || 'crm_get_order_full missing; ';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass
                 and attname = 'supply_source' and not attisdropped) then
    v_problems := v_problems || 'order_materials.supply_source missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'add_order_freeform_material preflight failed: %', v_problems;
  end if;
end;
$preflight$;

create or replace function public.crm_add_order_freeform_material(
  p_order_id uuid,
  p_item_name text,
  p_quantity numeric,
  p_price numeric,
  p_supply_source text,
  p_warranty_months integer default null,
  p_warranty_days integer default null,
  p_warranty_km integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_name text := btrim(coalesce(p_item_name, ''));
  v_source text := lower(btrim(coalesce(p_supply_source, '')));
  v_qty numeric(12,2);
  v_price numeric(12,2);
  v_line_id uuid;
  v_percent numeric;
  v_has_discount boolean;
  v_has_warranty boolean;
begin
  if v_uid is null then
    raise exception 'add_order_freeform_material:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or v_name = '' then
    raise exception 'add_order_freeform_material:invalid_args' using errcode = '22023';
  end if;
  if v_source not in ('one_time', 'customer') then
    raise exception 'add_order_freeform_material:invalid_supply_source' using errcode = '22023';
  end if;

  v_qty := round(coalesce(nullif(p_quantity, 0), 1), 2);
  if v_qty <= 0 then
    raise exception 'add_order_freeform_material:invalid_quantity' using errcode = '22023';
  end if;
  v_price := round(coalesce(p_price, 0), 2);
  if v_price < 0 then
    raise exception 'add_order_freeform_material:invalid_price' using errcode = '22023';
  end if;
  if (p_warranty_months is not null and p_warranty_months < 0)
     or (p_warranty_days is not null and p_warranty_days < 0)
     or (p_warranty_km is not null and p_warranty_km < 0) then
    raise exception 'add_order_freeform_material:invalid_warranty' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'add_order_freeform_material:order_not_found' using errcode = 'P0002';
  end if;
  perform public.crm_assert_order_line_edit(v_order.workspace_id);

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'add_order_freeform_material:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'add_order_freeform_material:cancelled_order_immutable' using errcode = '42501';
  end if;

  insert into public.order_materials (
    order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned, supply_source
  ) values (
    p_order_id, null, v_name, v_price, v_qty, 0, 0, v_source
  ) returning id into v_line_id;

  -- Client product discount (same as every other new material line).
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'discount_type' and not attisdropped
  ) into v_has_discount;
  if v_has_discount and v_order.client_id is not null and to_regclass('public.client_discounts') is not null then
    begin
      select cd.percent into v_percent
      from public.client_discounts cd
      where cd.workspace_id = v_order.workspace_id
        and cd.client_id = v_order.client_id
        and cd.target = 'product_order'
      limit 1;
      if coalesce(v_percent, 0) > 0 then
        execute 'update public.order_materials set discount_type = $2, discount_value = $3 where id = $1'
          using v_line_id, 'percent', v_percent;
      end if;
    exception when undefined_table or undefined_column then
      null;
    end;
  end if;

  -- Warranty snapshot for the line (0 / null = no limit).
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'warranty_months' and not attisdropped
  ) into v_has_warranty;
  if v_has_warranty then
    execute $sql$
      update public.order_materials
         set warranty_months = nullif($2, 0), warranty_days = nullif($3, 0), warranty_km = nullif($4, 0)
       where id = $1
    $sql$ using v_line_id, p_warranty_months, p_warranty_days, p_warranty_km;
  end if;

  perform public.crm_recalc_order_line_totals(p_order_id);
  return public.crm_get_order_full(p_order_id);
end;
$fn$;

revoke all on function public.crm_add_order_freeform_material(uuid, text, numeric, numeric, text, integer, integer, integer)
  from public, anon;
grant execute on function public.crm_add_order_freeform_material(uuid, text, numeric, numeric, text, integer, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';

do $postflight$
begin
  if to_regprocedure('public.crm_add_order_freeform_material(uuid,text,numeric,numeric,text,integer,integer,integer)') is null then
    raise exception 'add_order_freeform_material postflight: function missing';
  end if;
end;
$postflight$;

commit;
