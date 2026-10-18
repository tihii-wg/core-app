-- =============================================================================
-- READ-ONLY verification companion for
--   supabase/manual/20261018210000_issue_return_rpc_repair.sql
--
-- Safe to run anytime. Makes no changes.
-- Does not prove concurrency correctness or execute issue/return RPCs.
-- =============================================================================

-- 1) Required objects / helpers / expected RPC signatures
select
  to_regclass('public.inventory_movements') as inventory_movements,
  to_regclass('public.order_materials') as order_materials,
  to_regclass('public.inventory_items') as inventory_items,
  to_regclass('public.orders') as orders,
  to_regprocedure('public.is_workspace_member(uuid)') as is_workspace_member,
  to_regprocedure('public.workspace_member_role(uuid)') as workspace_member_role,
  to_regprocedure('public.issue_order_materials(uuid, jsonb, text)') as issue_rpc,
  to_regprocedure('public.return_order_materials(uuid, jsonb, text, text)') as return_rpc_4arg,
  to_regprocedure('public.return_order_materials(uuid, jsonb, text)') as return_rpc_3arg_unexpected;

-- 2) Required columns + types (every column referenced by the repair RPCs)
select table_name, column_name, udt_name, data_type, numeric_precision, numeric_scale, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'orders' and column_name in ('id', 'workspace_id'))
    or (table_name = 'order_materials' and column_name in (
      'id', 'order_id', 'inventory_item_id', 'quantity', 'quantity_issued', 'quantity_returned'
    ))
    or (table_name = 'inventory_items' and column_name in (
      'id', 'workspace_id', 'quantity', 'updated_at'
    ))
    or (table_name = 'inventory_movements' and column_name in (
      'id', 'workspace_id', 'inventory_item_id', 'order_id', 'order_material_id',
      'movement_type', 'quantity', 'reason', 'idempotency_key', 'created_by', 'created_at'
    ))
  )
order by table_name, column_name;

-- Expect:
--   inventory_movements.quantity → int4
--   inventory_items.quantity → numeric
--   order_materials.quantity / quantity_issued / quantity_returned → int4

-- 3) Exact idempotency unique partial index (catalog), including validity flags
select
  ic.relname as index_name,
  idx.indisunique as is_unique,
  idx.indisvalid as is_valid,
  idx.indisready as is_ready,
  idx.indnkeyatts as key_column_count,
  pg_get_expr(idx.indpred, idx.indrelid) as predicate,
  array[
    (select a.attname from pg_attribute a where a.attrelid = idx.indrelid and a.attnum = idx.indkey[0]),
    (select a.attname from pg_attribute a where a.attrelid = idx.indrelid and a.attnum = idx.indkey[1]),
    (select a.attname from pg_attribute a where a.attrelid = idx.indrelid and a.attnum = idx.indkey[2])
  ]::text[] as key_columns_first_three,
  pg_get_indexdef(idx.indexrelid) as indexdef
from pg_index idx
join pg_class ic on ic.oid = idx.indexrelid
join pg_class tc on tc.oid = idx.indrelid
join pg_namespace n on n.oid = tc.relnamespace
where n.nspname = 'public'
  and tc.relname = 'inventory_movements'
  and idx.indisunique
  and not idx.indisprimary
order by ic.relname;

-- Expect one row with:
--   is_unique/is_valid/is_ready = true
--   key_columns_first_three = {workspace_id,idempotency_key,inventory_item_id}
--   predicate = idempotency_key IS NOT NULL (optionally parenthesized)

-- 4) Function signatures, owner, SECURITY DEFINER, search_path, owner BYPASSRLS
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_arguments(p.oid) as full_args,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as config,
  p.provolatile as volatility,
  owner_role.rolname as function_owner,
  owner_role.rolbypassrls as owner_bypassrls
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles owner_role on owner_role.oid = p.proowner
where n.nspname = 'public'
  and p.proname in ('issue_order_materials', 'return_order_materials')
order by p.proname, identity_args;

-- Expect:
--   issue_order_materials(... uuid, jsonb, text DEFAULT NULL)
--     → SETOF inventory_movements, security_definer=true, search_path=''
--   return_order_materials(... uuid, jsonb, text, text DEFAULT NULL)
--     → SETOF inventory_movements, security_definer=true, search_path=''
--   function_owner typically a superuser/migration role; owner_bypassrls true
--   means table-owner RLS bypass applies when that role owns the tables too.
--   This query does not prove runtime INSERT success under FORCE RLS.

-- 5) Effective EXECUTE privileges for PUBLIC / anon / authenticated / service_role
--    PUBLIC is ACL grantee 0 — it is not a pg_roles row.
with funcs as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as identity_args, p.proowner, p.proacl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('issue_order_materials', 'return_order_materials')
),
acl_rows as (
  select
    f.proname,
    f.identity_args,
    acl.grantee,
    acl.privilege_type
  from funcs f
  cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner)))
    as acl(grantor, grantee, privilege_type, is_grantable)
),
targets as (
  select * from (
    values
      ('PUBLIC'::text),
      ('anon'),
      ('authenticated'),
      ('service_role')
  ) as t(grantee_label)
)
select
  f.proname,
  f.identity_args,
  t.grantee_label,
  case
    when t.grantee_label = 'PUBLIC' then exists (
      select 1
      from acl_rows a
      where a.proname = f.proname
        and a.identity_args = f.identity_args
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    )
    when exists (select 1 from pg_roles r where r.rolname = t.grantee_label) then
      has_function_privilege(t.grantee_label, f.oid, 'EXECUTE')
    else false
  end as has_execute
from funcs f
cross join targets t
order by f.proname, f.identity_args, t.grantee_label;

-- Expect has_execute = true only for authenticated; false for PUBLIC, anon, service_role.

-- 6) information_schema view (grantee 'PUBLIC' appears as text, not a role row)
select specific_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in ('issue_order_materials', 'return_order_materials')
  and privilege_type = 'EXECUTE'
order by routine_name, grantee;

-- 7) RLS + FORCE RLS on tables touched by the RPCs
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  owner_role.rolname as table_owner,
  owner_role.rolbypassrls as table_owner_bypassrls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_roles owner_role on owner_role.oid = c.relowner
where n.nspname = 'public'
  and c.relname in ('inventory_movements', 'inventory_items', 'order_materials', 'orders')
  and c.relkind = 'r'
order by c.relname;

-- Expect: review force_rls. If force_rls=true and the function owner does not
-- bypass RLS (and no INSERT/UPDATE policies exist for that owner), SECURITY
-- DEFINER writes can fail at runtime. This script does not execute those writes.

-- 8) Policies on inventory_movements
select
  c.relname as table_name,
  pol.polname,
  case pol.polcmd
    when 'r' then 'SELECT'
    when 'a' then 'INSERT'
    when 'w' then 'UPDATE'
    when 'd' then 'DELETE'
    when '*' then 'ALL'
    else pol.polcmd::text
  end as command,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy pol on pol.polrelid = c.oid
where n.nspname = 'public'
  and c.relname = 'inventory_movements'
order by pol.polname nulls last;

-- 9) Table grants on inventory_movements
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'inventory_movements'
order by grantee, privilege_type;
