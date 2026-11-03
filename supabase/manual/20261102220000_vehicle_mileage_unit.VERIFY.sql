-- =====================================================================
-- VERIFY (STRICTLY READ-ONLY)
-- File: 20261102220000_vehicle_mileage_unit.VERIFY.sql
-- Run AFTER: 20261102220000_vehicle_mileage_unit.PRODUCTION.sql
--
-- Does NOT modify database state. No CREATE / DROP / ALTER / INSERT /
-- UPDATE / DELETE / TRUNCATE / COMMENT / temp objects / functions.
-- Catalog queries + SELECT only. Dynamic SQL (via query_to_xml) is used
-- solely to SELECT count aggregations when target columns exist, so a
-- partially applied schema does not crash parse/analysis.
--
-- Result sets:
--   1) Table + column verification
--   2) Constraint verification
--   3) Informational data counts
--
-- Expect check_ok = true for every non-info_* row in sets 1–2.
-- info_* rows are always check_ok = true (diagnostic only).
--
-- Assumption: PostgreSQL built with XML support (query_to_xml) — standard
-- on Supabase. Counts fall back to a skip message if columns/tables are
-- missing (CASE short-circuit never invokes query_to_xml then).
-- =====================================================================

-- =====================================================================
-- Result set 1 — tables + columns
-- =====================================================================
with
expected as (
  select *
  from (
    values
      ('vehicles'::text, 'mileage_unit'::text, 'text'::text, 'text'::text),
      ('orders', 'vehicle_mileage_snapshot', 'integer', 'int4'),
      ('orders', 'vehicle_mileage_unit_snapshot', 'text', 'text')
  ) as v(table_name, column_name, data_type, udt_name)
),
table_facts as (
  select
    t.table_name,
    to_regclass(format('public.%I', t.table_name)) is not null as table_exists,
    (
      select c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.table_name
    ) as relkind
  from (select distinct table_name from expected) t
),
column_facts as (
  select
    e.table_name,
    e.column_name,
    e.data_type as expected_data_type,
    e.udt_name as expected_udt_name,
    c.data_type as actual_data_type,
    c.udt_name as actual_udt_name,
    c.is_nullable as actual_is_nullable,
    a.attgenerated,
    a.attidentity,
    a.attnotnull,
    (a.attnum is not null and a.attnum > 0 and not a.attisdropped) as attr_present
  from expected e
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = e.table_name
   and c.column_name = e.column_name
  left join pg_namespace n
    on n.nspname = 'public'
  left join pg_class rel
    on rel.relname = e.table_name
   and rel.relnamespace = n.oid
   and rel.relkind in ('r', 'p')
  left join pg_attribute a
    on a.attrelid = rel.oid
   and a.attname = e.column_name
   and a.attnum > 0
   and not a.attisdropped
)
select
  check_name,
  check_ok,
  detail
from (
  select
    'table_' || table_name || '_exists' as check_name,
    table_exists as check_ok,
    case
      when not table_exists then 'missing'
      else format('exists relkind=%s', coalesce(relkind::text, '?'))
    end as detail
  from table_facts

  union all
  select
    'table_' || table_name || '_relkind_ok',
    table_exists and relkind in ('r', 'p'),
    case
      when not table_exists then 'skipped: table missing'
      when relkind in ('r', 'p') then format('ok relkind=%s', relkind)
      else format('unexpected relkind=%s', coalesce(relkind::text, '<null>'))
    end
  from table_facts

  union all
  select
    format('column_%s_%s_exists', table_name, column_name),
    actual_udt_name is not null and attr_present,
    case
      when actual_udt_name is null then 'missing'
      else 'present'
    end
  from column_facts

  union all
  select
    format('column_%s_%s_data_type', table_name, column_name),
    actual_data_type is not distinct from expected_data_type,
    format('actual=%s expected=%s', coalesce(actual_data_type, '<missing>'), expected_data_type)
  from column_facts

  union all
  select
    format('column_%s_%s_udt_name', table_name, column_name),
    actual_udt_name is not distinct from expected_udt_name,
    format('actual=%s expected=%s', coalesce(actual_udt_name, '<missing>'), expected_udt_name)
  from column_facts

  union all
  select
    format('column_%s_%s_nullable', table_name, column_name),
    actual_is_nullable = 'YES' and coalesce(attnotnull, false) = false,
    format('is_nullable=%s attnotnull=%s', coalesce(actual_is_nullable, '<missing>'), coalesce(attnotnull::text, '<missing>'))
  from column_facts

  union all
  select
    format('column_%s_%s_not_generated', table_name, column_name),
    actual_udt_name is not null and coalesce(attgenerated, '') = '',
    format('attgenerated=%s', coalesce(attgenerated::text, '<missing>'))
  from column_facts

  union all
  select
    format('column_%s_%s_not_identity', table_name, column_name),
    actual_udt_name is not null and coalesce(attidentity, '') = '',
    format('attidentity=%s', coalesce(attidentity::text, '<missing>'))
  from column_facts

  union all
  select
    format('column_%s_%s_ordinary_writable', table_name, column_name),
    actual_udt_name is not null
      and attr_present
      and coalesce(attgenerated, '') = ''
      and coalesce(attidentity, '') = ''
      and actual_is_nullable = 'YES'
      and coalesce(attnotnull, false) = false
      and actual_udt_name is not distinct from expected_udt_name,
    case
      when actual_udt_name is null then 'missing'
      else 'ordinary nullable column with expected udt'
    end
  from column_facts

  union all
  select
    'info_vehicles_deleted_at_present',
    true,
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'vehicles'
          and column_name = 'deleted_at'
      ) then 'vehicles.deleted_at exists (counts do not filter on it)'
      else 'vehicles.deleted_at absent (counts include all rows)'
    end
) q
order by check_name;

-- =====================================================================
-- Result set 2 — constraints
-- =====================================================================
with
expected_constraints as (
  select *
  from (
    values
      (
        'vehicles'::text,
        'vehicles_mileage_unit_check'::text,
        array[
          lower(regexp_replace($$CHECK ((mileage_unit IS NULL) OR (mileage_unit = ANY (ARRAY['km'::text, 'mi'::text])))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK ((mileage_unit IS NULL) OR ((mileage_unit = 'km'::text) OR (mileage_unit = 'mi'::text)))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK ((mileage_unit IS NULL) OR (mileage_unit IN ('km'::text, 'mi'::text)))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK ((mileage_unit IS NULL) OR (mileage_unit IN ('km', 'mi')))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK (mileage_unit IS NULL OR mileage_unit IN ('km', 'mi'))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK (mileage_unit IS NULL OR mileage_unit = ANY (ARRAY['km'::text, 'mi'::text]))$$, '\s+', '', 'g'))
        ]::text[]
      ),
      (
        'orders',
        'orders_vehicle_mileage_snapshot_check',
        array[
          lower(regexp_replace($$CHECK ((vehicle_mileage_snapshot IS NULL) OR (vehicle_mileage_snapshot >= 0))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK (vehicle_mileage_snapshot IS NULL OR vehicle_mileage_snapshot >= 0)$$, '\s+', '', 'g'))
        ]::text[]
      ),
      (
        'orders',
        'orders_vehicle_mileage_unit_snapshot_check',
        array[
          lower(regexp_replace($$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR (vehicle_mileage_unit_snapshot = ANY (ARRAY['km'::text, 'mi'::text])))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR ((vehicle_mileage_unit_snapshot = 'km'::text) OR (vehicle_mileage_unit_snapshot = 'mi'::text)))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR (vehicle_mileage_unit_snapshot IN ('km'::text, 'mi'::text)))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK ((vehicle_mileage_unit_snapshot IS NULL) OR (vehicle_mileage_unit_snapshot IN ('km', 'mi')))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK (vehicle_mileage_unit_snapshot IS NULL OR vehicle_mileage_unit_snapshot IN ('km', 'mi'))$$, '\s+', '', 'g')),
          lower(regexp_replace($$CHECK (vehicle_mileage_unit_snapshot IS NULL OR vehicle_mileage_unit_snapshot = ANY (ARRAY['km'::text, 'mi'::text]))$$, '\s+', '', 'g'))
        ]::text[]
      )
  ) as v(table_name, conname, accepted_norms)
),
constraint_facts as (
  select
    e.table_name,
    e.conname,
    e.accepted_norms,
    c.oid as con_oid,
    c.contype,
    c.convalidated,
    case when c.oid is null then null else pg_get_constraintdef(c.oid) end as definition,
    case
      when c.oid is null then null
      else lower(regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g'))
    end as def_norm,
    (n.nspname || '.' || rel.relname) as actual_table
  from expected_constraints e
  left join pg_constraint c
    on c.conname = e.conname
   and c.conrelid = to_regclass(format('public.%I', e.table_name))
  left join pg_class rel on rel.oid = c.conrelid
  left join pg_namespace n on n.oid = rel.relnamespace
)
select
  check_name,
  check_ok,
  detail
from (
  select
    format('constraint_%s_exists', conname) as check_name,
    con_oid is not null as check_ok,
    case when con_oid is null then 'missing' else 'present' end as detail
  from constraint_facts

  union all
  select
    format('constraint_%s_correct_table', conname),
    con_oid is not null and actual_table = 'public.' || table_name,
    format('actual_table=%s', coalesce(actual_table, '<missing>'))
  from constraint_facts

  union all
  select
    format('constraint_%s_is_check', conname),
    con_oid is not null and contype = 'c',
    format('contype=%s', coalesce(contype::text, '<missing>'))
  from constraint_facts

  union all
  select
    format('constraint_%s_definition_matches', conname),
    con_oid is not null
      and contype = 'c'
      and def_norm = any (accepted_norms),
    coalesce(definition, '<missing>')
  from constraint_facts

  union all
  select
    format('constraint_%s_validated', conname),
    con_oid is not null and contype = 'c' and coalesce(convalidated, false),
    format('convalidated=%s', coalesce(convalidated::text, '<missing>'))
  from constraint_facts

  union all
  select
    format('constraint_%s_overall', conname),
    con_oid is not null
      and actual_table = 'public.' || table_name
      and contype = 'c'
      and coalesce(convalidated, false)
      and def_norm = any (accepted_norms),
    case
      when con_oid is null then 'FAIL: missing'
      when contype is distinct from 'c' then 'FAIL: not a CHECK'
      when not coalesce(convalidated, false) then 'FAIL: NOT VALID'
      when not (def_norm = any (accepted_norms)) then 'FAIL: definition mismatch'
      when actual_table is distinct from ('public.' || table_name) then 'FAIL: wrong table'
      else 'OK'
    end
  from constraint_facts
) q
order by check_name;

-- =====================================================================
-- Result set 3 — informational counts (ALL rows; no deleted_at filter)
-- Uses query_to_xml so missing columns do not break parse/analysis.
-- CASE short-circuit: query_to_xml runs only when the column exists.
-- =====================================================================
select
  check_name,
  check_ok,
  detail
from (
  select
    'info_vehicle_mileage_unit_counts'::text as check_name,
    true as check_ok,
    case
      when to_regclass('public.vehicles') is null then
        'skipped: public.vehicles missing'
      when not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'vehicles'
          and column_name = 'mileage_unit'
      ) then
        'skipped: vehicles.mileage_unit missing'
      else
        coalesce(
          (
            xpath(
              '//*[local-name()="detail"]/text()',
              query_to_xml(
                $q$
                  select format(
                    'total=%s unknown_null=%s km=%s mi=%s other=%s',
                    count(*),
                    count(*) filter (where mileage_unit is null),
                    count(*) filter (where mileage_unit = 'km'),
                    count(*) filter (where mileage_unit = 'mi'),
                    count(*) filter (
                      where mileage_unit is not null
                        and mileage_unit not in ('km', 'mi')
                    )
                  ) as detail
                  from public.vehicles
                $q$,
                false,
                true,
                ''
              )
            )
          )[1]::text,
          'query_to_xml returned no detail'
        )
    end as detail

  union all
  select
    'info_order_mileage_snapshot_counts',
    true,
    case
      when to_regclass('public.orders') is null then
        'skipped: public.orders missing'
      when not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'orders'
          and column_name = 'vehicle_mileage_snapshot'
      )
      or not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'orders'
          and column_name = 'vehicle_mileage_unit_snapshot'
      ) then
        'skipped: one or both order snapshot columns missing'
      else
        coalesce(
          (
            xpath(
              '//*[local-name()="detail"]/text()',
              query_to_xml(
                $q$
                  select format(
                    'total=%s missing_reading=%s unknown_unit=%s km=%s mi=%s other_unit=%s reading_without_unit=%s unit_without_reading=%s',
                    count(*),
                    count(*) filter (where vehicle_mileage_snapshot is null),
                    count(*) filter (where vehicle_mileage_unit_snapshot is null),
                    count(*) filter (where vehicle_mileage_unit_snapshot = 'km'),
                    count(*) filter (where vehicle_mileage_unit_snapshot = 'mi'),
                    count(*) filter (
                      where vehicle_mileage_unit_snapshot is not null
                        and vehicle_mileage_unit_snapshot not in ('km', 'mi')
                    ),
                    count(*) filter (
                      where vehicle_mileage_snapshot is not null
                        and vehicle_mileage_unit_snapshot is null
                    ),
                    count(*) filter (
                      where vehicle_mileage_unit_snapshot is not null
                        and vehicle_mileage_snapshot is null
                    )
                  ) as detail
                  from public.orders
                $q$,
                false,
                true,
                ''
              )
            )
          )[1]::text,
          'query_to_xml returned no detail'
        )
    end
) q
order by check_name;
