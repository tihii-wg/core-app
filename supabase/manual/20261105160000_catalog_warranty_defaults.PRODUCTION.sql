-- =============================================================================
-- Core App — Catalog default warranty on services + inventory items (MAIN)
-- Script: 20261105160000_catalog_warranty_defaults.PRODUCTION.sql
-- =============================================================================
-- Purpose:
--   Store per-catalog-item default warranty conditions so order lines can
--   snapshot them when a service/material is added. Activation remains on
--   order close only (existing activate_order_warranties / closed_at flow).
--
-- Adds (nullable; existing rows stay unconfigured → workspace defaults apply):
--   services.warranty_type, services.warranty_months
--   inventory_items.warranty_type, inventory_months, warranty_km
--   Recreates inventory_items_with_status to expose the new columns
--
-- Reuses existing:
--   services.warranty_km (already on MAIN)
--   order_services / order_materials warranty_* snapshots
--   warranty_records activation on close
--
-- Does NOT execute remotely. Review, then run on MAIN only.
-- Idempotent. Does not rewrite order lines or warranty_records.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.services') is null then
    v_problems := v_problems || 'services missing; ';
  end if;
  if to_regclass('public.inventory_items') is null then
    v_problems := v_problems || 'inventory_items missing; ';
  end if;
  if to_regclass('public.order_services') is null then
    v_problems := v_problems || 'order_services missing; ';
  end if;
  if to_regclass('public.order_materials') is null then
    v_problems := v_problems || 'order_materials missing; ';
  end if;
  if to_regclass('public.warranty_records') is null then
    v_problems := v_problems || 'warranty_records missing (apply order warranty workflow first); ';
  end if;
  if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is null then
    v_problems := v_problems || 'activate_order_warranties missing; ';
  end if;

  -- services.warranty_km expected from crm_ro_v1 / prior RO schema
  if to_regclass('public.services') is not null
     and not exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.services'::regclass
         and a.attname = 'warranty_km' and a.attnum > 0 and not a.attisdropped
     ) then
    v_problems := v_problems || 'services.warranty_km missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'catalog_warranty_defaults preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) services: warranty_type + warranty_months (km already exists)
-- ---------------------------------------------------------------------------
alter table public.services
  add column if not exists warranty_type text,
  add column if not exists warranty_months integer;

do $svc$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_warranty_type_check'
  ) then
    alter table public.services
      add constraint services_warranty_type_check
      check (warranty_type is null or warranty_type in ('none', 'duration', 'mileage', 'both'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_warranty_months_check'
  ) then
    alter table public.services
      add constraint services_warranty_months_check
      check (warranty_months is null or warranty_months > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_warranty_km_positive_check'
  ) then
    alter table public.services
      add constraint services_warranty_km_positive_check
      check (warranty_km is null or warranty_km > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_warranty_defaults_shape_check'
  ) then
    alter table public.services
      add constraint services_warranty_defaults_shape_check
      check (
        (warranty_type is null and warranty_months is null and warranty_km is null)
        or (warranty_type = 'none' and warranty_months is null and warranty_km is null)
        or (warranty_type = 'duration' and warranty_months is not null and warranty_km is null)
        or (warranty_type = 'mileage' and warranty_months is null and warranty_km is not null)
        or (warranty_type = 'both' and warranty_months is not null and warranty_km is not null)
      );
  end if;
end;
$svc$;

comment on column public.services.warranty_type is
  'Catalog default warranty mode: null=unconfigured (inherit workspace defaults on add), none|duration|mileage|both. Snapshotted onto order_services when added; does not activate warranty.';
comment on column public.services.warranty_months is
  'Catalog default warranty duration in months. Null when disabled. Copied into order_services.warranty_months on add.';

-- ---------------------------------------------------------------------------
-- 2) inventory_items: warranty_type + warranty_months + warranty_km
-- ---------------------------------------------------------------------------
alter table public.inventory_items
  add column if not exists warranty_type text,
  add column if not exists warranty_months integer,
  add column if not exists warranty_km integer;

do $inv$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inventory_items'::regclass
      and conname = 'inventory_items_warranty_type_check'
  ) then
    alter table public.inventory_items
      add constraint inventory_items_warranty_type_check
      check (warranty_type is null or warranty_type in ('none', 'duration', 'mileage', 'both'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inventory_items'::regclass
      and conname = 'inventory_items_warranty_months_check'
  ) then
    alter table public.inventory_items
      add constraint inventory_items_warranty_months_check
      check (warranty_months is null or warranty_months > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inventory_items'::regclass
      and conname = 'inventory_items_warranty_km_check'
  ) then
    alter table public.inventory_items
      add constraint inventory_items_warranty_km_check
      check (warranty_km is null or warranty_km > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inventory_items'::regclass
      and conname = 'inventory_items_warranty_defaults_shape_check'
  ) then
    alter table public.inventory_items
      add constraint inventory_items_warranty_defaults_shape_check
      check (
        (warranty_type is null and warranty_months is null and warranty_km is null)
        or (warranty_type = 'none' and warranty_months is null and warranty_km is null)
        or (warranty_type = 'duration' and warranty_months is not null and warranty_km is null)
        or (warranty_type = 'mileage' and warranty_months is null and warranty_km is not null)
        or (warranty_type = 'both' and warranty_months is not null and warranty_km is not null)
      );
  end if;
end;
$inv$;

comment on column public.inventory_items.warranty_type is
  'Catalog default warranty mode: null=unconfigured (inherit workspace defaults on add), none|duration|mileage|both. Snapshotted onto order_materials when added; does not activate warranty.';
comment on column public.inventory_items.warranty_months is
  'Catalog default warranty duration in months. Null when disabled. Copied into order_materials.warranty_months on add.';
comment on column public.inventory_items.warranty_km is
  'Catalog default warranty mileage limit (km). Null when disabled. Copied into order_materials.warranty_km on add.';

-- ---------------------------------------------------------------------------
-- 3) Recreate inventory_items_with_status so list queries see warranty columns
--     (DROP + CREATE: CREATE OR REPLACE cannot reshape existing view columns)
-- ---------------------------------------------------------------------------
drop view if exists public.inventory_items_with_status;

create view public.inventory_items_with_status
  with (security_invoker = true)
as
select
  i.id,
  i.workspace_id,
  i.name,
  i.sku,
  i.description,
  i.category,
  i.quantity,
  i.min_quantity,
  i.unit,
  i.purchase_price,
  i.selling_price,
  i.supplier,
  i.location,
  i.is_active,
  i.created_at,
  i.updated_at,
  i.warranty_type,
  i.warranty_months,
  i.warranty_km,
  case
    when i.quantity <= 0::numeric then 'out_of_stock'::text
    when i.quantity <= i.min_quantity then 'low_stock'::text
    else 'in_stock'::text
  end as stock_status
from public.inventory_items i;

revoke all on table public.inventory_items_with_status from public, anon, authenticated, service_role;
grant select, maintain on table public.inventory_items_with_status to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.inventory_items_with_status to service_role;

-- ---------------------------------------------------------------------------
-- 4) Postflight
-- ---------------------------------------------------------------------------
do $post$
declare
  v_problems text := '';
  v_col text;
begin
  foreach v_col in array array['warranty_type', 'warranty_months', 'warranty_km']
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.services'::regclass
        and a.attname = v_col and a.attnum > 0 and not a.attisdropped
    ) then
      v_problems := v_problems || format('services.%s missing; ', v_col);
    end if;
  end loop;

  foreach v_col in array array['warranty_type', 'warranty_months', 'warranty_km']
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.inventory_items'::regclass
        and a.attname = v_col and a.attnum > 0 and not a.attisdropped
    ) then
      v_problems := v_problems || format('inventory_items.%s missing; ', v_col);
    end if;
  end loop;

  if to_regclass('public.inventory_items_with_status') is null then
    v_problems := v_problems || 'inventory_items_with_status missing; ';
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_items_with_status'
      and column_name = 'warranty_type'
  ) then
    v_problems := v_problems || 'inventory_items_with_status.warranty_type missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'catalog_warranty_defaults postflight failed: %', v_problems;
  end if;
end;
$post$;

commit;
