-- =============================================================================
-- Warranty records remember their mileage unit (km | mi)
-- Script: 20261107090000_warranty_mileage_unit.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: 20261102220000_vehicle_mileage_unit (vehicles.mileage_unit,
--                orders.vehicle_mileage_unit_snapshot), warranty_records (20261104250000+)
-- =============================================================================
-- Problem: start_mileage / mileage_limit / expires_at_mileage on warranty_records have no
-- unit. Vehicles can be in miles; catalog defaults are in km.
--
-- Fix:
--   1) warranty_records.mileage_unit text NULL check (km|mi).
--   2) BEFORE INSERT trigger: when mileage_unit is NULL, take it from
--      orders.vehicle_mileage_unit_snapshot, else vehicles.mileage_unit (of the order's
--      vehicle, else of the record's vehicle), else 'km'.
--      (activate_order_warranties is not modified — the trigger fills the unit.)
--   3) One-time backfill for existing rows with the same rule.
--   The snapshot immutability trigger does not need changes: mileage_unit is set once on
--   insert/backfill; the app never updates it.
--
-- Does NOT convert any stored numbers (values are interpreted in the recorded unit).
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.warranty_records') is null then
    raise exception 'warranty_mileage_unit preflight: warranty_records missing';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.vehicles'::regclass
                 and attname = 'mileage_unit' and not attisdropped) then
    raise exception 'warranty_mileage_unit preflight: vehicles.mileage_unit missing (apply 20261102220000 first)';
  end if;
end;
$preflight$;

alter table public.warranty_records add column if not exists mileage_unit text;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'warranty_records_mileage_unit_check'
                 and conrelid = 'public.warranty_records'::regclass) then
    alter table public.warranty_records
      add constraint warranty_records_mileage_unit_check
      check (mileage_unit is null or mileage_unit in ('km', 'mi'));
  end if;
end;
$chk$;

create or replace function public.crm_warranty_records_resolve_mileage_unit(p_order_id uuid, p_vehicle_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_unit text;
  v_order_vehicle uuid;
  v_has_snapshot boolean;
begin
  select exists (select 1 from pg_attribute where attrelid = 'public.orders'::regclass
                 and attname = 'vehicle_mileage_unit_snapshot' and not attisdropped)
    into v_has_snapshot;

  if p_order_id is not null then
    if v_has_snapshot then
      execute 'select nullif(lower(btrim(o.vehicle_mileage_unit_snapshot)), ''''), o.vehicle_id
                 from public.orders o where o.id = $1'
        into v_unit, v_order_vehicle using p_order_id;
    else
      select o.vehicle_id into v_order_vehicle from public.orders o where o.id = p_order_id;
    end if;
  end if;

  if v_unit is null then
    select nullif(lower(btrim(v.mileage_unit)), '') into v_unit
    from public.vehicles v
    where v.id = coalesce(v_order_vehicle, p_vehicle_id);
  end if;

  if v_unit not in ('km', 'mi') or v_unit is null then
    v_unit := 'km';
  end if;
  return v_unit;
end;
$fn$;

revoke all on function public.crm_warranty_records_resolve_mileage_unit(uuid, uuid) from public, anon, authenticated;

create or replace function public.crm_warranty_records_mileage_unit_bi()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if new.mileage_unit is null then
    new.mileage_unit := public.crm_warranty_records_resolve_mileage_unit(new.order_id, new.vehicle_id);
  end if;
  return new;
end;
$fn$;

revoke all on function public.crm_warranty_records_mileage_unit_bi() from public, anon, authenticated;

drop trigger if exists crm_warranty_records_mileage_unit on public.warranty_records;
create trigger crm_warranty_records_mileage_unit
  before insert on public.warranty_records
  for each row execute function public.crm_warranty_records_mileage_unit_bi();

-- Backfill: only mileage_unit changes, so the snapshot immutability trigger allows it.
do $backfill$
declare
  v_n integer;
begin
  update public.warranty_records wr
     set mileage_unit = public.crm_warranty_records_resolve_mileage_unit(wr.order_id, wr.vehicle_id)
   where wr.mileage_unit is null;
  get diagnostics v_n = row_count;
  raise notice 'warranty_mileage_unit: backfilled % record(s)', v_n;
end;
$backfill$;

do $postflight$
begin
  if not exists (select 1 from pg_trigger where tgname = 'crm_warranty_records_mileage_unit'
                 and tgrelid = 'public.warranty_records'::regclass and not tgisinternal) then
    raise exception 'warranty_mileage_unit postflight: trigger missing';
  end if;
end;
$postflight$;

commit;

-- Check: select mileage_unit, count(*) from public.warranty_records group by 1;
-- Records of mile vehicles created BEFORE this change may carry a km catalog limit as miles:
-- select wr.id, wr.item_name, wr.mileage_limit, wr.start_mileage, wr.expires_at_mileage
--   from public.warranty_records wr where wr.mileage_unit = 'mi' and wr.mileage_limit is not null;
