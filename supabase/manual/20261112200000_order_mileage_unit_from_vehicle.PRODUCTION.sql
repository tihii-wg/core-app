-- =============================================================================
-- Orders without a mileage unit on a miles vehicle: km warranty limits must be converted to miles
-- Script: 20261112200000_order_mileage_unit_from_vehicle.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review. Apply AFTER 20261112190000.
-- =============================================================================
-- Order-line warranty limits (order_services/order_materials.warranty_km) are stored in the ORDER's unit
-- (orders.vehicle_mileage_unit_snapshot); catalog limits are km and are converted when a line is added.
-- Orders created without that unit (new vehicle, no mileage typed) defaulted to km, so a miles vehicle got
-- "10 000 km" on its lines, and activation stamped 10 000 as MILES on the warranty (vehicle unit).
--
-- 1) Orders with an empty unit and a vehicle: set the unit from the vehicle; for miles vehicles convert the
--    line limits km → mi (round(km / 1.609344)). Closed orders included (their guards are bypassed ONLY
--    for these statements, inside this transaction).
-- 2) activate_order_warranties: if the order still has no unit and the vehicle is in miles, convert the
--    line limit km → mi before stamping (defensive; the app now always records the unit).
-- 3) Repair activated warranty rows of such orders: limit km → mi, expires = start + limit.
-- Idempotent: steps 1 and 3 only touch orders whose unit is still empty; step 2 is marker-guarded.
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is null then
    raise exception 'order_mileage_unit_from_vehicle preflight: activate_order_warranties missing';
  end if;
end;
$pre$;

-- Orders to fix: no unit yet, vehicle known.
create temporary table tmp_unit_fix on commit drop as
select o.id as order_id, lower(btrim(v.mileage_unit)) as unit
from public.orders o
join public.vehicles v on v.id = o.vehicle_id
where o.vehicle_mileage_unit_snapshot is null
  and lower(btrim(coalesce(v.mileage_unit, ''))) in ('km', 'mi');

-- 3) Activated warranty rows of those orders on miles vehicles: limit was typed as km.
alter table public.warranty_records disable trigger trg_warranty_records_snapshot_immutable;
update public.warranty_records wr
   set mileage_limit = round(wr.mileage_limit / 1.609344)::integer,
       expires_at_mileage = case
         when wr.start_mileage is not null then wr.start_mileage + round(wr.mileage_limit / 1.609344)::integer
         else null
       end
  from tmp_unit_fix f
 where f.order_id = wr.order_id
   and f.unit = 'mi'
   and wr.mileage_limit is not null
   and wr.mileage_limit > 0;
alter table public.warranty_records enable trigger trg_warranty_records_snapshot_immutable;

-- 1) Line limits km → mi, then the order unit (closed-order guards bypassed for these statements only).
alter table public.order_services disable trigger order_services_closed_guard_biud;
alter table public.order_materials disable trigger order_materials_closed_guard_biud;
alter table public.orders disable trigger orders_closed_content_guard_bu;

update public.order_services s
   set warranty_km = round(s.warranty_km / 1.609344)::integer
  from tmp_unit_fix f
 where f.order_id = s.order_id and f.unit = 'mi' and s.warranty_km is not null and s.warranty_km > 0;

update public.order_materials m
   set warranty_km = round(m.warranty_km / 1.609344)::integer
  from tmp_unit_fix f
 where f.order_id = m.order_id and f.unit = 'mi' and m.warranty_km is not null and m.warranty_km > 0;

update public.orders o
   set vehicle_mileage_unit_snapshot = f.unit
  from tmp_unit_fix f
 where f.order_id = o.id;

alter table public.orders enable trigger orders_closed_content_guard_bu;
alter table public.order_materials enable trigger order_materials_closed_guard_biud;
alter table public.order_services enable trigger order_services_closed_guard_biud;

-- 2) Activation: convert km limits for unit-less orders on miles vehicles.
do $patch$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.activate_order_warranties(uuid,uuid,timestamptz)'::regprocedure);
  if position('20261112200000' in v_def) > 0 then
    raise notice 'order_mileage_unit_from_vehicle: activation already patched';
    return;
  end if;
  if position('v_km := r.km;' in v_def) = 0
     or position('v_expires_mileage integer;' in v_def) = 0
     or position('v_start_mileage := v_order.vehicle_mileage_snapshot;' in v_def) = 0 then
    raise exception 'order_mileage_unit_from_vehicle: expected statements not found in activate_order_warranties';
  end if;
  v_def := replace(v_def, 'v_expires_mileage integer;', E'v_expires_mileage integer;\n  v_vehicle_unit text; -- 20261112200000');
  v_def := replace(
    v_def,
    'v_start_mileage := v_order.vehicle_mileage_snapshot;',
    E'v_start_mileage := v_order.vehicle_mileage_snapshot;\n'
    || E'  select lower(btrim(v.mileage_unit)) into v_vehicle_unit from public.vehicles v where v.id = v_order.vehicle_id;'
  );
  v_def := replace(
    v_def,
    'v_km := r.km;',
    'v_km := case when r.km is not null and v_order.vehicle_mileage_unit_snapshot is null and v_vehicle_unit = ''mi'''
    || ' then round(r.km / 1.609344)::integer else r.km end;'
  );
  execute v_def;
end;
$patch$;

commit;
