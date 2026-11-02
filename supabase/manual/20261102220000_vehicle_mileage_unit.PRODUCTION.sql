-- =====================================================================
-- Core App — vehicles.mileage_unit (manual script, NOT APPLIED by agents).
--
-- WHY: Each vehicle needs a stored odometer unit (km | mi) so UI/reports can
-- show unambiguous readings. The app already maps mileage_unit when present
-- (src/services/apiVehicles.ts) and falls back safely when the column is absent.
--
-- WHEN TO RUN: Only after explicit owner authorization. Do NOT run from CI or
-- agent sessions. Prefer TEST first if/when the testing phase is opened.
--
-- HOW TO RUN: paste into the Supabase SQL Editor for the intended project and
-- run once. Additive / idempotent: add column if not exists + check constraint.
--
-- DATA POLICY:
--   * Existing rows keep mileage_unit NULL (unknown). Do NOT backfill km or mi.
--   * Historical odometer integers are NOT converted or reinterpreted.
--   * Application must not invent a unit from brand / country / VIN / plate.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.vehicles') is null then
    raise exception 'vehicle_mileage_unit: public.vehicles is missing';
  end if;
end $$;

alter table public.vehicles
  add column if not exists mileage_unit text;

-- Allow only km / mi / NULL (unknown). Drop+recreate check if an older variant exists.
alter table public.vehicles
  drop constraint if exists vehicles_mileage_unit_check;

alter table public.vehicles
  add constraint vehicles_mileage_unit_check
  check (mileage_unit is null or mileage_unit in ('km', 'mi'));

comment on column public.vehicles.mileage_unit is
  'Per-vehicle odometer unit: km, mi, or null when unknown. Never auto-converted.';

commit;
