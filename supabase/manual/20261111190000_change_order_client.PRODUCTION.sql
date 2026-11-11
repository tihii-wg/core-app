-- =============================================================================
-- Change order client / vehicle (crm_change_order_client)
-- Script: 20261111190000_change_order_client.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: public.orders, public.clients, public.vehicles, public.invoices,
--                public.order_events, public.is_workspace_member(uuid),
--                public.crm_order_event_insert(...), orders_closed_content_guard.
-- =============================================================================
-- Atomically reassigns orders.client_id (+ optional vehicle_id) and, when the
-- payer was the same as the old client (or null), moves payer_client_id too.
-- Validates the vehicle belongs to the NEW client. Refuses closed/cancelled
-- orders. Requires an explicit invoice confirmation when an invoice exists.
-- Does NOT rewrite invoices / payments / line discounts.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'public.orders missing; ';
  end if;
  if to_regclass('public.clients') is null then
    v_problems := v_problems || 'public.clients missing; ';
  end if;
  if to_regclass('public.vehicles') is null then
    v_problems := v_problems || 'public.vehicles missing; ';
  end if;
  if to_regclass('public.invoices') is null then
    v_problems := v_problems || 'public.invoices missing; ';
  end if;
  if to_regclass('public.warranty_records') is null then
    v_problems := v_problems || 'public.warranty_records missing; ';
  end if;
  if to_regclass('public.order_events') is null then
    v_problems := v_problems || 'public.order_events missing; ';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_permission(uuid,text) missing; ';
  end if;
  if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is null then
    v_problems := v_problems || 'crm_order_event_insert missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'change_order_client preflight failed: %', v_problems;
  end if;
end;
$preflight$;

create or replace function public.crm_change_order_client(
  p_order_id uuid,
  p_client_id uuid,
  p_vehicle_id uuid default null,
  p_confirm_invoice boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_new_client public.clients%rowtype;
  v_old_client_name text;
  v_new_client_name text;
  v_old_vehicle_label text;
  v_new_vehicle_label text;
  v_vehicle public.vehicles%rowtype;
  v_payer_id uuid;
  v_payer_moved boolean := false;
  v_invoice_count bigint := 0;
  v_actor_name text;
  v_jwt jsonb;
  v_device text;
  v_car_number text;
  v_vin text;
begin
  if v_uid is null then
    raise exception 'change_order_client:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null then
    raise exception 'change_order_client:order_required' using errcode = '22023';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'change_order_client:order_not_found' using errcode = 'P0002';
  end if;

  if not coalesce(public.is_workspace_member(v_order.workspace_id), false) then
    raise exception 'change_order_client:forbidden' using errcode = '42501';
  end if;
  -- Same permission as every other order edit (read-only roles must not reassign clients).
  if not coalesce(public.crm_has_permission(v_order.workspace_id, 'orders.edit'), false) then
    raise exception 'change_order_client:forbidden' using errcode = '42501';
  end if;

  -- Same bar as other content edits: formally closed (and non-cancelled) rows are immutable.
  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'change_order_client:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'change_order_client:cancelled_order_immutable' using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'change_order_client:client_required' using errcode = '22023';
  end if;

  select * into v_new_client
  from public.clients c
  where c.id = p_client_id
    and c.workspace_id = v_order.workspace_id
    and c.deleted_at is null;

  if not found then
    raise exception 'change_order_client:client_not_found' using errcode = 'P0002';
  end if;

  if p_vehicle_id is not null then
    select * into v_vehicle
    from public.vehicles v
    where v.id = p_vehicle_id
      and v.workspace_id = v_order.workspace_id
      and v.client_id = p_client_id
      and v.deleted_at is null;

    if not found then
      raise exception 'change_order_client:vehicle_not_assignable' using errcode = '22023';
    end if;

    v_device := nullif(btrim(concat_ws(' ', v_vehicle.make, v_vehicle.model,
      case when v_vehicle.year is not null then v_vehicle.year::text else null end)), '');
    v_car_number := nullif(upper(btrim(coalesce(v_vehicle.license_plate, ''))), '');
    v_vin := nullif(btrim(coalesce(v_vehicle.vin, '')), '');
    v_new_vehicle_label := coalesce(
      nullif(btrim(concat_ws(' · ',
        nullif(btrim(concat_ws(' ', v_vehicle.make, v_vehicle.model,
          case when v_vehicle.year is not null then v_vehicle.year::text else null end)), ''),
        nullif(btrim(coalesce(v_vehicle.license_plate, '')), '')
      )), ''),
      '—'
    );
  elsif v_order.vehicle_id is not null then
    -- The order was linked to a vehicle of the previous client and is now saved without one:
    -- the old car's label / plate / VIN must not stay on the order.
    select case when c.is_nullable = 'YES' then null else '' end into v_device
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'orders' and c.column_name = 'device';
    v_car_number := null;
    v_vin := null;
    v_new_vehicle_label := '—';
  else
    -- Free-text asset (non-vehicle industries, legacy orders): keep what was typed.
    v_device := v_order.device;
    v_car_number := v_order.car_number;
    v_vin := v_order.vin;
    v_new_vehicle_label := '—';
  end if;

  select count(*) into v_invoice_count
  from public.invoices i
  where i.order_id = p_order_id
    and i.workspace_id = v_order.workspace_id;

  if v_invoice_count > 0 and not coalesce(p_confirm_invoice, false) then
    raise exception 'change_order_client:invoice_confirm_required' using errcode = 'P0001';
  end if;

  -- No-op short circuit (still validates membership / lock).
  if v_order.client_id is not distinct from p_client_id
     and v_order.vehicle_id is not distinct from p_vehicle_id then
    return jsonb_build_object(
      'order_id', p_order_id,
      'client_id', p_client_id,
      'vehicle_id', p_vehicle_id,
      'payer_client_id', v_order.payer_client_id,
      'payer_moved', false,
      'changed', false
    );
  end if;

  select nullif(btrim(c.name), '') into v_old_client_name
  from public.clients c
  where c.id = v_order.client_id;

  v_old_client_name := coalesce(v_old_client_name, '—');
  v_new_client_name := coalesce(nullif(btrim(v_new_client.name), ''), '—');

  if v_order.vehicle_id is not null then
    select coalesce(
      nullif(btrim(concat_ws(' · ',
        nullif(btrim(concat_ws(' ', v.make, v.model,
          case when v.year is not null then v.year::text else null end)), ''),
        nullif(btrim(coalesce(v.license_plate, '')), '')
      )), ''),
      '—'
    )
    into v_old_vehicle_label
    from public.vehicles v
    where v.id = v_order.vehicle_id;
  end if;
  v_old_vehicle_label := coalesce(v_old_vehicle_label, '—');

  -- Payer rule: same-as-client (or null) moves with the order; a distinct payer stays.
  if v_order.payer_client_id is null then
    v_payer_id := null; -- NULL = "the order's client pays": follows the new client implicitly
    v_payer_moved := false;
  elsif v_order.payer_client_id is not distinct from v_order.client_id then
    v_payer_id := p_client_id;
    v_payer_moved := v_order.payer_client_id is distinct from v_payer_id;
  else
    v_payer_id := v_order.payer_client_id;
    v_payer_moved := false;
  end if;

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

  update public.orders o
  set
    client_id = p_client_id,
    vehicle_id = p_vehicle_id,
    payer_client_id = v_payer_id,
    device = v_device,
    car_number = v_car_number,
    vin = v_vin,
    -- The intake mileage belongs to the previous vehicle.
    vehicle_mileage_snapshot = case
      when v_order.vehicle_id is distinct from p_vehicle_id then null
      else o.vehicle_mileage_snapshot end,
    vehicle_mileage_unit_snapshot = case
      when v_order.vehicle_id is distinct from p_vehicle_id then
        case when p_vehicle_id is not null then v_vehicle.mileage_unit else null end
      else o.vehicle_mileage_unit_snapshot end,
    updated_at = now()
  where o.id = p_order_id
    and o.workspace_id = v_order.workspace_id;

  -- Warranty rows of this order (e.g. a reopened order) follow the order.
  update public.warranty_records w
  set client_id = p_client_id,
      vehicle_id = p_vehicle_id,
      updated_at = now()
  where w.order_id = p_order_id
    and w.workspace_id = v_order.workspace_id;

  if v_order.client_id is distinct from p_client_id then
    perform public.crm_order_event_insert(
      v_order.workspace_id,
      p_order_id,
      'client_changed',
      'client_id',
      v_old_client_name,
      v_new_client_name,
      jsonb_build_object(
        'old_client_id', v_order.client_id,
        'new_client_id', p_client_id,
        'payer_moved', v_payer_moved,
        'invoice_count', v_invoice_count
      ),
      v_uid,
      v_actor_name
    );
  end if;

  if v_order.vehicle_id is distinct from p_vehicle_id then
    perform public.crm_order_event_insert(
      v_order.workspace_id,
      p_order_id,
      'vehicle_changed',
      'vehicle_id',
      v_old_vehicle_label,
      v_new_vehicle_label,
      jsonb_build_object(
        'old_vehicle_id', v_order.vehicle_id,
        'new_vehicle_id', p_vehicle_id
      ),
      v_uid,
      v_actor_name
    );
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'client_id', p_client_id,
    'vehicle_id', p_vehicle_id,
    'payer_client_id', v_payer_id,
    'payer_moved', v_payer_moved,
    'changed', true,
    'old_client_id', v_order.client_id,
    'old_vehicle_id', v_order.vehicle_id,
    'invoice_count', v_invoice_count
  );
end;
$fn$;

revoke all on function public.crm_change_order_client(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.crm_change_order_client(uuid, uuid, uuid, boolean) to authenticated, service_role;

comment on function public.crm_change_order_client(uuid, uuid, uuid, boolean) is
  'managed-object: core-app/crm_change_order_client@v1 — atomic order client/vehicle reassignment with payer rule, invoice confirm, and order_events.';

do $postflight$
begin
  if to_regprocedure('public.crm_change_order_client(uuid,uuid,uuid,boolean)') is null then
    raise exception 'change_order_client postflight failed: crm_change_order_client missing';
  end if;
end;
$postflight$;

commit;
