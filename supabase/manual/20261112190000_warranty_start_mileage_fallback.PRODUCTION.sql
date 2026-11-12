-- =============================================================================
-- Mileage warranty: fall back to the vehicle's mileage when the order has no intake mileage
-- Script: 20261112190000_warranty_start_mileage_fallback.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- Problem: activate_order_warranties() takes the starting mileage ONLY from orders.vehicle_mileage_snapshot.
-- When an order is created with a vehicle whose mileage was entered only as «initial mileage» (new vehicle),
-- the snapshot stayed empty, so warranty_records got mileage_limit but no start_mileage / expires_at_mileage
-- and the warranty showed months only.
--
-- 1) activate_order_warranties: start mileage = order snapshot, else the vehicle's current_mileage, else its
--    initial_mileage (both in the vehicle's unit; warranty_records.mileage_unit is resolved by the existing
--    crm_warranty_records_resolve_mileage_unit logic). Patched in place (pg_get_functiondef + one replace).
-- 2) One-time repair: activated warranty rows with a mileage limit but no start mileage get
--    start = order snapshot / vehicle current / vehicle initial mileage and expires = start + limit.
--    The snapshot-immutability trigger is disabled ONLY for this UPDATE, inside this transaction.
-- (The app now also stores the vehicle's mileage on the order when it is created.)
-- =============================================================================

begin;

do $patch$
declare
  v_def text;
  v_old text := 'v_start_mileage := v_order.vehicle_mileage_snapshot;';
  v_new text := $new$v_start_mileage := v_order.vehicle_mileage_snapshot;
  -- Fallback (20261112190000): no intake mileage on the order → the vehicle's mileage at close.
  if v_start_mileage is null and v_order.vehicle_id is not null then
    select coalesce(v.current_mileage, v.initial_mileage)::integer
      into v_start_mileage
    from public.vehicles v
    where v.id = v_order.vehicle_id;
  end if;$new$;
begin
  if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is null then
    raise exception 'warranty_start_mileage_fallback preflight: activate_order_warranties missing';
  end if;
  v_def := pg_get_functiondef('public.activate_order_warranties(uuid,uuid,timestamptz)'::regprocedure);
  if position('20261112190000' in v_def) > 0 then
    raise notice 'warranty_start_mileage_fallback: already patched';
  elsif position(v_old in v_def) = 0 then
    raise exception 'warranty_start_mileage_fallback: start-mileage assignment not found in activate_order_warranties';
  else
    execute replace(v_def, v_old, v_new);
  end if;
end;
$patch$;

-- One-time repair of already activated rows.
alter table public.warranty_records disable trigger trg_warranty_records_snapshot_immutable;

with fix as (
  select wr.id,
         coalesce(o.vehicle_mileage_snapshot, v.current_mileage, v.initial_mileage)::integer as start_km
  from public.warranty_records wr
  join public.orders o on o.id = wr.order_id
  left join public.vehicles v on v.id = coalesce(wr.vehicle_id, o.vehicle_id)
  where wr.mileage_limit is not null
    and wr.mileage_limit > 0
    and wr.start_mileage is null
)
update public.warranty_records wr
   set start_mileage = fix.start_km,
       expires_at_mileage = fix.start_km + wr.mileage_limit
  from fix
 where fix.id = wr.id
   and fix.start_km is not null;

alter table public.warranty_records enable trigger trg_warranty_records_snapshot_immutable;

commit;
