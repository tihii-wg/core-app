-- =====================================================================================
-- Change of vehicle owner with its orders (crm_transfer_vehicle)
-- Script: 20261125160000_transfer_vehicle.PRODUCTION.sql
-- MAIN only. Manual apply after review.
-- Prerequisites: 20261110090000_merge_clients (orders_closed_content_guard@v3 with the
--   crm.client_merge bypass), 20261111190000_change_order_client (crm_order_event_insert).
-- =====================================================================================
-- Moves a vehicle to another client of the same workspace (car sold / new owner) and, in the
-- same transaction:
--   * every order of the PREVIOUS owner with this vehicle → new owner (open and closed; closed
--     orders change only client_id / payer_client_id through the narrow merge bypass);
--   * payer that was the previous owner moves too; a different payer stays;
--   * warranty records of those orders follow;
--   * optional new licence plate: written to the vehicle and to its OPEN orders (closed
--     orders keep the plate they were done with);
--   * one "client_changed" event per moved order.
-- Invoices, payments and client balance entries are NOT rewritten (issued documents stay with
-- whom they were issued to).
-- =====================================================================================

begin;

do $preflight$
declare
  v_problems text := '';
  v_def text;
begin
  if to_regprocedure('public.orders_closed_content_guard()') is null then
    v_problems := v_problems || 'orders_closed_content_guard missing; ';
  else
    select pg_get_functiondef('public.orders_closed_content_guard()'::regprocedure) into v_def;
    if position('crm.client_merge' in v_def) = 0 then
      v_problems := v_problems || 'orders_closed_content_guard has no crm.client_merge bypass (apply merge_clients first); ';
    end if;
  end if;
  if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is null then
    v_problems := v_problems || 'crm_order_event_insert missing; ';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_permission missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'transfer_vehicle preflight failed: %', v_problems;
  end if;
end;
$preflight$;

create or replace function public.crm_transfer_vehicle(
  p_vehicle_id uuid,
  p_client_id uuid,
  p_license_plate text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_vehicle public.vehicles%rowtype;
  v_old_client uuid;
  v_new_client public.clients%rowtype;
  v_old_name text;
  v_new_name text;
  v_plate text := nullif(upper(btrim(coalesce(p_license_plate, ''))), '');
  v_actor_name text;
  v_jwt jsonb;
  v_order record;
  v_moved integer := 0;
  v_warranties integer := 0;
begin
  if v_uid is null then
    raise exception 'transfer_vehicle:not_authenticated' using errcode = '42501';
  end if;

  select * into v_vehicle from public.vehicles v
  where v.id = p_vehicle_id and v.deleted_at is null
  for update;
  if not found then
    raise exception 'transfer_vehicle:vehicle_not_found' using errcode = 'P0002';
  end if;

  if not coalesce(public.is_workspace_member(v_vehicle.workspace_id), false)
     or not coalesce(public.crm_has_permission(v_vehicle.workspace_id, 'orders.edit'), false) then
    raise exception 'transfer_vehicle:forbidden' using errcode = '42501';
  end if;

  select * into v_new_client from public.clients c
  where c.id = p_client_id and c.workspace_id = v_vehicle.workspace_id and c.deleted_at is null;
  if not found then
    raise exception 'transfer_vehicle:client_not_found' using errcode = 'P0002';
  end if;

  v_old_client := v_vehicle.client_id;
  select coalesce(nullif(btrim(c.name), ''), '—') into v_old_name from public.clients c where c.id = v_old_client;
  v_old_name := coalesce(v_old_name, '—');
  v_new_name := coalesce(nullif(btrim(v_new_client.name), ''), '—');

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

  update public.vehicles v
  set client_id = p_client_id,
      license_plate = coalesce(v_plate, v.license_plate),
      updated_at = now()
  where v.id = p_vehicle_id
  returning * into v_vehicle;

  if v_old_client is distinct from p_client_id then
    -- Closed orders: only client_id / payer_client_id may change (transaction-local bypass).
    perform set_config('crm.client_merge', 'on', true);

    for v_order in
      select o.id, o.closed_at, o.payer_client_id
      from public.orders o
      where o.workspace_id = v_vehicle.workspace_id
        and o.vehicle_id = p_vehicle_id
        and o.client_id = v_old_client
      for update
    loop
      update public.orders o
      set client_id = p_client_id,
          payer_client_id = case when o.payer_client_id = v_old_client then p_client_id else o.payer_client_id end,
          updated_at = now()
      where o.id = v_order.id;

      perform public.crm_order_event_insert(
        v_vehicle.workspace_id, v_order.id, 'client_changed', 'client_id', v_old_name, v_new_name,
        jsonb_build_object('old_client_id', v_old_client, 'new_client_id', p_client_id, 'reason', 'vehicle_transfer',
                           'vehicle_id', p_vehicle_id),
        v_uid, v_actor_name
      );
      v_moved := v_moved + 1;
    end loop;

    perform set_config('crm.client_merge', 'off', true);

    update public.warranty_records w
    set client_id = p_client_id, updated_at = now()
    where w.workspace_id = v_vehicle.workspace_id
      and w.vehicle_id = p_vehicle_id
      and w.client_id = v_old_client;
    get diagnostics v_warranties = row_count;
  end if;

  -- New plate on the orders still in work; closed orders keep the plate they were done with.
  if v_plate is not null then
    update public.orders o
    set car_number = v_plate, updated_at = now()
    where o.workspace_id = v_vehicle.workspace_id
      and o.vehicle_id = p_vehicle_id
      and o.closed_at is null
      and o.status not in ('closed', 'cancelled')
      and o.car_number is distinct from v_plate;
  end if;

  return jsonb_build_object(
    'vehicle', to_jsonb(v_vehicle),
    'old_client_id', v_old_client,
    'moved_orders', v_moved,
    'moved_warranties', v_warranties
  );
end;
$fn$;

revoke all on function public.crm_transfer_vehicle(uuid, uuid, text) from public, anon;
grant execute on function public.crm_transfer_vehicle(uuid, uuid, text) to authenticated, service_role;

comment on function public.crm_transfer_vehicle(uuid, uuid, text) is
  'managed-object: core-app/crm_transfer_vehicle@v1 — vehicle owner change with its orders (incl. closed, client fields only), payer, warranties, optional new plate, order_events.';

notify pgrst, 'reload schema';

do $postflight$
begin
  if to_regprocedure('public.crm_transfer_vehicle(uuid,uuid,text)') is null then
    raise exception 'transfer_vehicle postflight: function missing';
  end if;
end;
$postflight$;

commit;
