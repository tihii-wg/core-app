-- =============================================================================
-- Extend crm_update_order_service_line for full per-order line edits
-- (warranty / kind / discount) from the order-card «edit position» dialog.
--
-- Clear semantics:
--   p_set_warranty = true  → write p_warranty_months/days/km (NULL clears that column)
--   p_set_kind = true      → write p_kind (NULL clears kind)
--   p_set_discount = true  → write p_discount_type + p_discount_value (NULL/NULL clears)
-- Keys left with p_set_* = false are untouched.
--
-- Drops the previous 6-arg overload and replaces it with this extended signature
-- (new params default so existing price/qty/technician callers keep working).
-- Apply on MAIN only when authorized. Do not run from the agent.
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.orders') is null then
    raise exception 'order_service_line_edit preflight failed: public.orders missing';
  end if;
  if to_regclass('public.order_services') is null then
    raise exception 'order_service_line_edit preflight failed: public.order_services missing';
  end if;
  if to_regprocedure('public.crm_get_order_full(uuid)') is null then
    raise exception 'order_service_line_edit preflight failed: crm_get_order_full missing';
  end if;
  if to_regprocedure('public.crm_assert_order_line_edit(uuid)') is null then
    raise exception 'order_service_line_edit preflight failed: crm_assert_order_line_edit missing';
  end if;
  if to_regprocedure('public.crm_recalc_order_line_totals(uuid)') is null then
    raise exception 'order_service_line_edit preflight failed: crm_recalc_order_line_totals missing';
  end if;
end
$pre$;

-- Drop prior overload (price/qty/technician only) so the new signature replaces it cleanly.
drop function if exists public.crm_update_order_service_line(uuid, uuid, numeric, numeric, uuid, boolean);

create or replace function public.crm_update_order_service_line(
  p_order_id uuid,
  p_line_id uuid,
  p_price numeric default null,
  p_quantity numeric default null,
  p_technician_id uuid default null,
  p_set_technician boolean default false,
  p_warranty_months integer default null,
  p_warranty_days integer default null,
  p_warranty_km integer default null,
  p_set_warranty boolean default false,
  p_kind text default null,
  p_set_kind boolean default false,
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
  v_line public.order_services%rowtype;
  v_has_technician boolean;
  v_has_kind boolean;
  v_has_warranty boolean;
  v_has_discount boolean;
begin
  if v_uid is null then
    raise exception 'update_order_service_line:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_line_id is null then
    raise exception 'update_order_service_line:invalid_args' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'update_order_service_line:order_not_found' using errcode = 'P0002';
  end if;
  perform public.crm_assert_order_line_edit(v_order.workspace_id);

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'update_order_service_line:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'update_order_service_line:cancelled_order_immutable' using errcode = '42501';
  end if;

  select * into v_line
  from public.order_services os
  where os.id = p_line_id and os.order_id = p_order_id
  for update;
  if not found then
    raise exception 'update_order_service_line:line_not_found' using errcode = 'P0002';
  end if;

  if p_price is not null then
    if p_price < 0 then
      raise exception 'update_order_service_line:invalid_price' using errcode = '22023';
    end if;
    update public.order_services set price = round(p_price, 2) where id = p_line_id;
  end if;
  if p_quantity is not null then
    if p_quantity <= 0 then
      raise exception 'update_order_service_line:invalid_quantity' using errcode = '22023';
    end if;
    update public.order_services set quantity = round(p_quantity, 2) where id = p_line_id;
  end if;

  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'technician_id' and not attisdropped
  ) into v_has_technician;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'kind' and not attisdropped
  ) into v_has_kind;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'warranty_months' and not attisdropped
  ) into v_has_warranty;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'discount_type' and not attisdropped
  ) into v_has_discount;

  if p_set_technician and v_has_technician then
    execute 'update public.order_services set technician_id = $2 where id = $1'
      using p_line_id, p_technician_id;
    perform public.crm_sync_order_employees_from_lines(p_order_id, v_order.workspace_id);
  end if;

  if p_set_warranty and v_has_warranty then
    if p_warranty_months is not null and p_warranty_months < 0 then
      raise exception 'update_order_service_line:invalid_warranty_months' using errcode = '22023';
    end if;
    if p_warranty_days is not null and p_warranty_days < 0 then
      raise exception 'update_order_service_line:invalid_warranty_days' using errcode = '22023';
    end if;
    if p_warranty_km is not null and p_warranty_km < 0 then
      raise exception 'update_order_service_line:invalid_warranty_km' using errcode = '22023';
    end if;
    execute $sql$
      update public.order_services
         set warranty_months = $2, warranty_days = $3, warranty_km = $4
       where id = $1
    $sql$ using p_line_id, p_warranty_months, p_warranty_days, p_warranty_km;
  end if;

  if p_set_kind and v_has_kind then
    if p_kind is not null and p_kind not in ('labor', 'service') then
      raise exception 'update_order_service_line:invalid_kind' using errcode = '22023';
    end if;
    execute 'update public.order_services set kind = $2 where id = $1'
      using p_line_id, p_kind;
  end if;

  if p_set_discount and v_has_discount then
    if p_discount_type is not null and p_discount_type not in ('percent', 'amount') then
      raise exception 'update_order_service_line:invalid_discount_type' using errcode = '22023';
    end if;
    if p_discount_value is not null and p_discount_value < 0 then
      raise exception 'update_order_service_line:invalid_discount_value' using errcode = '22023';
    end if;
    execute 'update public.order_services set discount_type = $2, discount_value = $3 where id = $1'
      using p_line_id, p_discount_type, p_discount_value;
  end if;

  perform public.crm_recalc_order_line_totals(p_order_id);
  return public.crm_get_order_full(p_order_id);
end;
$fn$;

revoke all on function public.crm_update_order_service_line(
  uuid, uuid, numeric, numeric, uuid, boolean,
  integer, integer, integer, boolean,
  text, boolean,
  text, numeric, boolean
) from public, anon;
grant execute on function public.crm_update_order_service_line(
  uuid, uuid, numeric, numeric, uuid, boolean,
  integer, integer, integer, boolean,
  text, boolean,
  text, numeric, boolean
) to authenticated;

do $post$
begin
  if to_regprocedure(
    'public.crm_update_order_service_line(uuid,uuid,numeric,numeric,uuid,boolean,integer,integer,integer,boolean,text,boolean,text,numeric,boolean)'
  ) is null then
    raise exception 'order_service_line_edit postflight failed: crm_update_order_service_line missing';
  end if;
  -- Old 6-arg overload must be gone so PostgREST resolves a single function.
  if to_regprocedure('public.crm_update_order_service_line(uuid,uuid,numeric,numeric,uuid,boolean)') is not null then
    raise exception 'order_service_line_edit postflight failed: old 6-arg overload still present';
  end if;
end
$post$;

-- PostgREST picks up the new signature immediately.
notify pgrst, 'reload schema';

commit;
