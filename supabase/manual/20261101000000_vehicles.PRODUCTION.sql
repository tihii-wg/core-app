-- =====================================================================
-- Core App — public.vehicles + orders.vehicle_id (manual script, PREP ONLY).
--
-- WHY: the repo had no CREATE TABLE for public.vehicles or orders.vehicle_id
-- (docs/ro-app-migration-stage-0-report.md, item 5), yet the app reads/writes both
-- (src/services/apiVehicles.ts, src/services/apiOrders.ts, type Vehicle in src/lib/types.ts)
-- and crm_ro_v1.PRODUCTION.sql aborts when vehicles / vehicles.id / vehicles.workspace_id
-- are missing.
--
-- WHEN TO RUN: Phase 1, BEFORE crm_ro_v1.PRODUCTION.sql, and ONLY if the Phase 0.1
-- information_schema dump shows vehicles or orders.vehicle_id missing. If both exist
-- this file is a no-op (safe to run anyway). TEST first, then PROD, after a backup.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL Editor and run once.
--
-- IDEMPOTENT / ADDITIVE ONLY:
--   * create table if not exists — an existing vehicles table is never recreated, dropped
--     or altered except for adding missing columns (add column if not exists);
--   * RLS, grants and policies are created ONLY when this script creates the table; an
--     existing vehicles table keeps whatever policies/grants it already has;
--   * orders.vehicle_id is added only if missing; the FK is added only if no FK on that
--     column exists, and as NOT VALID so existing orders are never scanned or rejected
--     (run `alter table public.orders validate constraint orders_vehicle_id_fkey;`
--     later, after the vehicle_id backfill, if you want it validated);
--   * no data is updated or deleted. Backfilling old orders is a separate file
--     (20261031010000_vehicle_id_backfill.PRODUCTION.sql).
--
-- Columns match src/services/apiVehicles.ts (vehicleColumns) and the Vehicle type.
-- `notes` is NOT added here: crm_ro_v1.PRODUCTION.sql adds it.
-- Depends on 20260929000000_production_baseline.sql: public.workspaces, public.clients,
-- public.orders, public.is_workspace_member(uuid), public.workspace_member_is_admin(uuid).
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.workspaces') is null
     or to_regclass('public.clients') is null
     or to_regclass('public.orders') is null then
    raise exception 'vehicles: нужны public.workspaces, public.clients и public.orders (примените baseline)';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null
     or to_regprocedure('public.workspace_member_is_admin(uuid)') is null then
    raise exception 'vehicles: нужны функции is_workspace_member(uuid) и workspace_member_is_admin(uuid) из baseline';
  end if;
end $$;

-- Remember whether this script is the one creating the table (controls RLS/grants below).
create temp table _vehicles_was_missing on commit drop as
  select to_regclass('public.vehicles') is null as missing;

-- ---------------------------------------------------------------------
-- 1. public.vehicles
-- ---------------------------------------------------------------------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  make text,
  model text,
  year integer check (year is null or year between 1886 and 2200),
  vin text,
  license_plate text,
  initial_mileage integer check (initial_mileage is null or initial_mileage >= 0),
  current_mileage integer check (current_mileage is null or current_mileage >= 0),
  engine_displacement numeric(6,3) check (engine_displacement is null or engine_displacement > 0),
  fuel_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- If vehicles already existed, only make sure every column the app uses is present.
alter table public.vehicles
  add column if not exists make text,
  add column if not exists model text,
  add column if not exists year integer,
  add column if not exists vin text,
  add column if not exists license_plate text,
  add column if not exists initial_mileage integer,
  add column if not exists current_mileage integer,
  add column if not exists engine_displacement numeric(6,3),
  add column if not exists fuel_type text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

create index if not exists vehicles_workspace_client_idx
  on public.vehicles (workspace_id, client_id) where deleted_at is null;
create index if not exists vehicles_workspace_vin_idx
  on public.vehicles (workspace_id, upper(vin)) where vin is not null and deleted_at is null;
create index if not exists vehicles_workspace_plate_idx
  on public.vehicles (workspace_id, upper(license_plate)) where license_plate is not null and deleted_at is null;

-- ---------------------------------------------------------------------
-- 2. orders.vehicle_id (+ FK, + index)
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists vehicle_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.orders'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.vehicles'::regclass
      and a.attname = 'vehicle_id'
  ) then
    -- NOT VALID: existing rows are not checked, so this can never fail on old data.
    alter table public.orders
      add constraint orders_vehicle_id_fkey
      foreign key (vehicle_id) references public.vehicles(id) on delete set null not valid;
  end if;
end $$;

create index if not exists orders_vehicle_id_idx
  on public.orders (vehicle_id) where vehicle_id is not null;

-- ---------------------------------------------------------------------
-- 3. RLS + grants — ONLY when this script created the table
-- ---------------------------------------------------------------------
do $$
begin
  if not (select missing from _vehicles_was_missing) then
    raise notice 'vehicles already existed: RLS, grants and policies left untouched';
    return;
  end if;

  alter table public.vehicles enable row level security;

  -- Members read/create/update vehicles of their workspace; the client must belong to the same workspace.
  create policy "Members can view workspace vehicles"
    on public.vehicles as permissive for select to authenticated
    using (public.is_workspace_member(workspace_id));

  create policy "Members can create workspace vehicles"
    on public.vehicles as permissive for insert to authenticated
    with check (
      public.is_workspace_member(workspace_id)
      and exists (select 1 from public.clients c where c.id = vehicles.client_id and c.workspace_id = vehicles.workspace_id)
    );

  create policy "Members can update workspace vehicles"
    on public.vehicles as permissive for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (
      public.is_workspace_member(workspace_id)
      and exists (select 1 from public.clients c where c.id = vehicles.client_id and c.workspace_id = vehicles.workspace_id)
    );

  -- The app archives vehicles with UPDATE ... deleted_at; hard delete is for owners/admins only.
  create policy "Admins can delete workspace vehicles"
    on public.vehicles as permissive for delete to authenticated
    using (public.workspace_member_is_admin(workspace_id));

  revoke all on table public.vehicles from public, anon, authenticated, service_role;
  grant select, insert, update, delete on table public.vehicles to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.vehicles to service_role;
end $$;

-- ---------------------------------------------------------------------
-- 4. VERIFY (read-only result)
-- ---------------------------------------------------------------------
select
  to_regclass('public.vehicles') is not null as vehicles_exists,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'orders' and column_name = 'vehicle_id') as orders_vehicle_id_exists,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vehicles') as vehicles_policy_count;

commit;
