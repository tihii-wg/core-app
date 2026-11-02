-- Verify vehicles.mileage_unit (run after PRODUCTION script; read-only).

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'vehicles'
  and column_name = 'mileage_unit';

select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.vehicles'::regclass
  and conname = 'vehicles_mileage_unit_check';

-- Existing vehicles should remain NULL until a user sets the unit explicitly.
select
  count(*) filter (where mileage_unit is null) as unknown_unit,
  count(*) filter (where mileage_unit = 'km') as km_unit,
  count(*) filter (where mileage_unit = 'mi') as mi_unit,
  count(*) as total
from public.vehicles
where deleted_at is null;
