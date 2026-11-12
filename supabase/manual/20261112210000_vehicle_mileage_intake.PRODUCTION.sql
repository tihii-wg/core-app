-- =============================================================================
-- Vehicle mileage intake: confirmed flag + bump vehicle current_mileage on close
-- Script: 20261112210000_vehicle_mileage_intake.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- 1) orders.vehicle_mileage_confirmed — true when the user typed/confirmed intake mileage
--    on this visit (form or order card). Soft close warning uses it.
-- 2) Backfill vehicles.current_mileage from initial_mileage where current is null.
-- 3) close_order_if_settled: right after the REAL close (the activate_order_warranties call that uses
--    v_closed_at — not the «already closed» idempotent branch), if the order has a mileage
--    snapshot, set vehicles.current_mileage = greatest(current, snapshot converted to the
--    vehicle's unit). Never decreases. Marker-guarded pg_get_functiondef replace.
-- One DO block for the function patch (SQL editor may split statements).
-- =============================================================================

-- Runs as ONE DO block (one statement = one transaction): the SQL editor may run statements separately.
-- Closed orders are protected by orders_closed_content_guard_bu, so the new column is added WITH its
-- default (Postgres fills existing rows without firing row triggers). If an earlier partial run left the
-- column nullable with NULLs, those rows are filled with the guard bypassed for that statement only.

do $intake$
declare
  v_def text;
  v_old text := 'v_warranty_count := public.activate_order_warranties(p_workspace_id, p_order_id, v_closed_at);';
  v_new text := $new$v_warranty_count := public.activate_order_warranties(p_workspace_id, p_order_id, v_closed_at);
    -- 20261112210000: intake snapshot → vehicles.current_mileage (never decrease).
    if v_order.vehicle_id is not null and v_order.vehicle_mileage_snapshot is not null then
      update public.vehicles v
         set current_mileage = greatest(
               coalesce(v.current_mileage, 0),
               case
                 when v.mileage_unit is not null
                  and v_order.vehicle_mileage_unit_snapshot is not null
                  and lower(btrim(v.mileage_unit)) is distinct from lower(btrim(v_order.vehicle_mileage_unit_snapshot::text))
                 then case
                   when lower(btrim(v_order.vehicle_mileage_unit_snapshot::text)) = 'km'
                        and lower(btrim(v.mileage_unit)) = 'mi'
                     then round(v_order.vehicle_mileage_snapshot::numeric / 1.609344)::integer
                   when lower(btrim(v_order.vehicle_mileage_unit_snapshot::text)) = 'mi'
                        and lower(btrim(v.mileage_unit)) = 'km'
                     then round(v_order.vehicle_mileage_snapshot::numeric * 1.609344)::integer
                   else v_order.vehicle_mileage_snapshot
                 end
                 else v_order.vehicle_mileage_snapshot
               end
             ),
             updated_at = now()
       where v.id = v_order.vehicle_id
         and v.workspace_id = p_workspace_id;
    end if;$new$;
begin
  if to_regprocedure('public.close_order_if_settled(uuid,uuid)') is null then
    raise exception 'vehicle_mileage_intake preflight: close_order_if_settled missing';
  end if;
  if to_regclass('public.orders') is null then
    raise exception 'vehicle_mileage_intake preflight: public.orders missing';
  end if;

  -- Safety: an earlier partial run must not leave the guard disabled.
  execute 'alter table public.orders enable trigger orders_closed_content_guard_bu';

  -- 1) orders.vehicle_mileage_confirmed
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'vehicle_mileage_confirmed'
  ) then
    execute 'alter table public.orders add column vehicle_mileage_confirmed boolean not null default false';
  else
    if exists (select 1 from public.orders where vehicle_mileage_confirmed is null) then
      execute 'alter table public.orders disable trigger orders_closed_content_guard_bu';
      update public.orders set vehicle_mileage_confirmed = false where vehicle_mileage_confirmed is null;
      execute 'alter table public.orders enable trigger orders_closed_content_guard_bu';
    end if;
    execute 'alter table public.orders alter column vehicle_mileage_confirmed set default false';
    execute 'alter table public.orders alter column vehicle_mileage_confirmed set not null';
  end if;
  execute $c$comment on column public.orders.vehicle_mileage_confirmed is
    'True when the user confirmed/edited intake mileage for this visit (form or order card).'$c$;

  -- 2) Prefer an explicit current reading; copy initial when current was never set.
  update public.vehicles
     set current_mileage = initial_mileage,
         updated_at = coalesce(updated_at, now())
   where deleted_at is null
     and current_mileage is null
     and initial_mileage is not null;

  -- 3) close_order_if_settled patch
  v_def := pg_get_functiondef('public.close_order_if_settled(uuid,uuid)'::regprocedure);
  if position('20261112210000' in v_def) > 0 then
    raise notice 'vehicle_mileage_intake: close_order_if_settled already patched';
  elsif position(v_old in v_def) = 0 then
    raise exception 'vehicle_mileage_intake: activate_order_warranties call not found in close_order_if_settled';
  else
    execute replace(v_def, v_old, v_new);
  end if;

  -- postflight
  if to_regprocedure('public.close_order_if_settled(uuid,uuid)') is null then
    raise exception 'vehicle_mileage_intake postflight: close_order_if_settled missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'vehicle_mileage_confirmed'
  ) then
    raise exception 'vehicle_mileage_intake postflight: vehicle_mileage_confirmed missing';
  end if;
end;
$intake$;

notify pgrst, 'reload schema';
