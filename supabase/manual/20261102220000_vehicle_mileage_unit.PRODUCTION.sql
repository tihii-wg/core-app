-- =====================================================================
-- Core App — vehicle mileage unit + order historical mileage snapshots
-- MANUAL / ADDITIVE / TRANSACTIONAL / IDEMPOTENT
-- File: 20261102220000_vehicle_mileage_unit.PRODUCTION.sql
-- Companion VERIFY (read-only, after this script):
--   20261102220000_vehicle_mileage_unit.VERIFY.sql
--
-- WHY:
--   1) vehicles.mileage_unit — current per-vehicle odometer unit (km|mi|NULL).
--   2) orders.vehicle_mileage_snapshot + vehicle_mileage_unit_snapshot —
--      immutable visit reading + unit captured on the order (historical).
--
-- App mapping (when columns exist):
--   src/services/apiVehicles.ts  → vehicles.mileage_unit
--   src/services/apiOrders.ts    → orders.vehicle_mileage_*_snapshot
--
-- Repo schema references (do not assume live MAIN matches):
--   supabase/manual/20261101000000_vehicles.PRODUCTION.sql
--     — vehicles may include deleted_at; THIS script does not require it
--   baseline / crm_ro_v1 — public.orders exists; no prior snapshot columns
--
-- WHEN TO RUN: only after explicit owner authorization. Prefer TEST first
-- if/when the testing phase is opened. Do NOT run from CI or agents.
--
-- HOW TO RUN: paste the WHOLE file into the Supabase SQL Editor once, in
-- one session. Stop on the first error so the transaction rolls back.
--
-- DATA POLICY (unchanged):
--   * No backfill of vehicle units or order snapshots.
--   * No conversion of mileage values.
--   * No inference of units from brand / country / VIN / plate.
--   * No UPDATE / DELETE of existing row data.
--
-- IDEMPOTENCY:
--   * Missing compatible columns/constraints are added.
--   * Existing compatible + VALIDATED objects are left untouched.
--   * Incompatible objects abort with a clear exception (never dropped).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Session-local helpers (pg_temp; gone on ROLLBACK or session end)
-- ---------------------------------------------------------------------
create or replace function pg_temp.mileage_norm_def(p_def text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_def, ''), '\s+', '', 'g'));
$$;

-- True when normalized CHECK text matches one of the accepted equivalent forms.
-- PostgreSQL rewrites IN (...) to = ANY (ARRAY[...]) and may add ::text casts /
-- extra parentheses; the accepted list covers those normalizations.
create or replace function pg_temp.mileage_def_matches(p_actual text, p_accepted text[])
returns boolean
language plpgsql
immutable
as $$
declare
  v_actual text := pg_temp.mileage_norm_def(p_actual);
  v_one text;
begin
  foreach v_one in array p_accepted loop
    if v_actual = pg_temp.mileage_norm_def(v_one) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function pg_temp.mileage_assert_table_ok(p_table text)
returns void
language plpgsql
as $$
declare
  v_relkind "char";
begin
  select c.relkind
    into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = p_table;

  if not found then
    raise exception
      'vehicle_mileage_unit preflight: public.% is missing',
      p_table;
  end if;

  -- Ordinary table or partitioned table (both support ADD COLUMN / ADD CONSTRAINT).
  if v_relkind not in ('r', 'p') then
    raise exception
      'vehicle_mileage_unit preflight: public.% exists but relkind=% (expected r or p). Aborting.',
      p_table, v_relkind;
  end if;
end;
$$;

-- If the column is absent → OK (will be added).
-- If present → must be ordinary writable, exact udt, nullable.
create or replace function pg_temp.mileage_assert_column_ok(
  p_table text,
  p_column text,
  p_expected_udt text
)
returns void
language plpgsql
as $$
declare
  v_udt text;
  v_nullable text;
  v_attgenerated "char";
  v_attidentity "char";
  v_attnotnull boolean;
begin
  select c.udt_name, c.is_nullable
    into v_udt, v_nullable
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and c.column_name = p_column;

  if not found then
    return;
  end if;

  select a.attgenerated, a.attidentity, a.attnotnull
    into v_attgenerated, v_attidentity, v_attnotnull
  from pg_attribute a
  join pg_class rel on rel.oid = a.attrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
    and rel.relname = p_table
    and a.attname = p_column
    and a.attnum > 0
    and not a.attisdropped;

  if not found then
    raise exception
      'vehicle_mileage_unit preflight: public.%.% visible in information_schema but missing in pg_attribute. Aborting.',
      p_table, p_column;
  end if;

  if v_attgenerated is distinct from '' then
    raise exception
      'vehicle_mileage_unit preflight: public.%.% is a generated column (attgenerated=%). Aborting.',
      p_table, p_column, v_attgenerated;
  end if;

  if v_attidentity is distinct from '' then
    raise exception
      'vehicle_mileage_unit preflight: public.%.% is an identity column (attidentity=%). Aborting.',
      p_table, p_column, v_attidentity;
  end if;

  if v_udt is distinct from p_expected_udt then
    raise exception
      'vehicle_mileage_unit preflight: public.%.% has udt=%; expected %. Aborting.',
      p_table, p_column, v_udt, p_expected_udt;
  end if;

  if v_nullable is distinct from 'YES' or v_attnotnull then
    raise exception
      'vehicle_mileage_unit preflight: public.%.% must be nullable (is_nullable=% attnotnull=%). Aborting.',
      p_table, p_column, v_nullable, v_attnotnull;
  end if;
end;
$$;

-- Named constraint on the target table:
--   missing → OK (added later)
--   wrong type (not CHECK) → abort
--   CHECK but NOT VALID → abort
--   CHECK with incompatible definition → abort
--   CHECK matching an accepted form and validated → OK (left untouched)
create or replace function pg_temp.mileage_assert_check_ok(
  p_table text,
  p_conname text,
  p_accepted text[]
)
returns void
language plpgsql
as $$
declare
  v_oid oid;
  v_contype "char";
  v_validated boolean;
  v_def text;
begin
  select c.oid, c.contype, c.convalidated, pg_get_constraintdef(c.oid)
    into v_oid, v_contype, v_validated, v_def
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
    and rel.relname = p_table
    and c.conname = p_conname;

  if not found then
    return;
  end if;

  if v_contype is distinct from 'c' then
    raise exception
      'vehicle_mileage_unit preflight: public.%.% exists as constraint type "%" (expected CHECK). Aborting (not dropped).',
      p_table, p_conname, v_contype;
  end if;

  if not v_validated then
    raise exception
      'vehicle_mileage_unit preflight: CHECK public.%.% exists but is NOT VALID (convalidated=false). Validate it manually or resolve, then re-run. Aborting (not dropped).',
      p_table, p_conname;
  end if;

  if not pg_temp.mileage_def_matches(v_def, p_accepted) then
    raise exception
      'vehicle_mileage_unit preflight: CHECK public.%.% has incompatible definition:%Aborting (constraint not dropped).',
      p_table, p_conname, E'\n' || v_def || E'\n';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Preflight (any failure aborts the transaction; no partial apply)
-- ---------------------------------------------------------------------
do $preflight$
declare
  -- Accepted CHECK forms after Postgres normalization.
  -- Equivalences intentionally accepted:
  --   * IN ('km','mi')  ↔  = ANY (ARRAY['km'::text,'mi'::text])
  --   * optional ::text casts on literals
  --   * optional extra parentheses
  --   * optional whitespace (stripped by mileage_norm_def)
  v_unit_forms text[] := array[
    $$CHECK ((mileage_unit IS NULL) OR (mileage_unit = ANY (ARRAY['km'::text, 'mi'::text])))$$,
    $$CHECK ((mileage_unit IS NULL) OR ((mileage_unit = 'km'::text) OR (mileage_unit = 'mi'::text)))$$,
    $$CHECK ((mileage_unit IS NULL) OR (mileage_unit IN ('km'::text, 'mi'::text)))$$,
    $$CHECK ((mileage_unit IS NULL) OR (mileage_unit IN ('km', 'mi')))$$,
    $$CHECK (mileage_unit IS NULL OR mileage_unit IN ('km', 'mi'))$$,
    $$CHECK (mileage_unit IS NULL OR mileage_unit = ANY (ARRAY['km'::text, 'mi'::text]))$$
  ];
  v_reading_forms text[] := array[
    $$CHECK ((vehicle_mileage_snapshot IS NULL) OR (vehicle_mileage_snapshot >= 0))$$,
    $$CHECK (vehicle_mileage_snapshot IS NULL OR vehicle_mileage_snapshot >= 0)$$
  ];
  v_order_unit_forms text[] := array[
    $$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR (vehicle_mileage_unit_snapshot = ANY (ARRAY['km'::text, 'mi'::text])))$$,
    $$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR ((vehicle_mileage_unit_snapshot = 'km'::text) OR (vehicle_mileage_unit_snapshot = 'mi'::text)))$$,
    $$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR (vehicle_mileage_unit_snapshot IN ('km'::text, 'mi'::text)))$$,
    $$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR (vehicle_mileage_unit_snapshot IN ('km', 'mi')))$$,
    $$CHECK (vehicle_mileage_unit_snapshot IS NULL OR vehicle_mileage_unit_snapshot IN ('km', 'mi'))$$,
    $$CHECK (vehicle_mileage_unit_snapshot IS NULL OR vehicle_mileage_unit_snapshot = ANY (ARRAY['km'::text, 'mi'::text]))$$
  ];
begin
  perform pg_temp.mileage_assert_table_ok('vehicles');
  perform pg_temp.mileage_assert_table_ok('orders');

  perform pg_temp.mileage_assert_column_ok('vehicles', 'mileage_unit', 'text');
  perform pg_temp.mileage_assert_column_ok('orders', 'vehicle_mileage_snapshot', 'int4');
  perform pg_temp.mileage_assert_column_ok('orders', 'vehicle_mileage_unit_snapshot', 'text');

  perform pg_temp.mileage_assert_check_ok('vehicles', 'vehicles_mileage_unit_check', v_unit_forms);
  perform pg_temp.mileage_assert_check_ok('orders', 'orders_vehicle_mileage_snapshot_check', v_reading_forms);
  perform pg_temp.mileage_assert_check_ok('orders', 'orders_vehicle_mileage_unit_snapshot_check', v_order_unit_forms);
end
$preflight$;

-- ---------------------------------------------------------------------
-- 2. Add missing columns (exact types, nullable, no defaults, no backfill)
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column if not exists mileage_unit text;

alter table public.orders
  add column if not exists vehicle_mileage_snapshot integer;

alter table public.orders
  add column if not exists vehicle_mileage_unit_snapshot text;

-- ---------------------------------------------------------------------
-- 3. Add missing CHECK constraints only (never drop / replace)
-- ---------------------------------------------------------------------
do $add_checks$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'vehicles'
      and c.conname = 'vehicles_mileage_unit_check'
  ) then
    alter table public.vehicles
      add constraint vehicles_mileage_unit_check
      check (mileage_unit is null or mileage_unit in ('km', 'mi'));
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'orders'
      and c.conname = 'orders_vehicle_mileage_snapshot_check'
  ) then
    alter table public.orders
      add constraint orders_vehicle_mileage_snapshot_check
      check (vehicle_mileage_snapshot is null or vehicle_mileage_snapshot >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'orders'
      and c.conname = 'orders_vehicle_mileage_unit_snapshot_check'
  ) then
    alter table public.orders
      add constraint orders_vehicle_mileage_unit_snapshot_check
      check (
        vehicle_mileage_unit_snapshot is null
        or vehicle_mileage_unit_snapshot in ('km', 'mi')
      );
  end if;
end
$add_checks$;

-- ---------------------------------------------------------------------
-- 4. Column comments (target columns only)
-- ---------------------------------------------------------------------
comment on column public.vehicles.mileage_unit is
  'Current per-vehicle odometer unit: km, mi, or null when unknown. Not auto-converted; independent of order snapshots.';

comment on column public.orders.vehicle_mileage_snapshot is
  'Historical visit odometer reading captured on this order. Immutable snapshot; never converted.';

comment on column public.orders.vehicle_mileage_unit_snapshot is
  'Historical unit for vehicle_mileage_snapshot at save time (km, mi, or null). Independent of vehicles.mileage_unit.';

commit;
