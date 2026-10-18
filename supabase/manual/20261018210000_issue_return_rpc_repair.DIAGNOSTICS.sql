-- =============================================================================
-- READ-ONLY single-row diagnostics for
--   supabase/manual/20261018210000_issue_return_rpc_repair.sql
--
-- Run this alone in the SQL Editor. Returns ONE row with JSONB columns.
-- Makes no changes. Does not call issue/return RPCs.
-- Does not prove concurrency correctness.
--
-- Safe when objects are missing: reports null / empty arrays instead of failing.
-- =============================================================================

with
expected_columns(table_name, column_name) as (
  values
    ('orders', 'id'),
    ('orders', 'workspace_id'),
    ('order_materials', 'id'),
    ('order_materials', 'order_id'),
    ('order_materials', 'inventory_item_id'),
    ('order_materials', 'quantity'),
    ('order_materials', 'quantity_issued'),
    ('order_materials', 'quantity_returned'),
    ('inventory_items', 'id'),
    ('inventory_items', 'workspace_id'),
    ('inventory_items', 'quantity'),
    ('inventory_items', 'updated_at'),
    ('inventory_movements', 'id'),
    ('inventory_movements', 'workspace_id'),
    ('inventory_movements', 'inventory_item_id'),
    ('inventory_movements', 'order_id'),
    ('inventory_movements', 'order_material_id'),
    ('inventory_movements', 'movement_type'),
    ('inventory_movements', 'quantity'),
    ('inventory_movements', 'reason'),
    ('inventory_movements', 'idempotency_key'),
    ('inventory_movements', 'created_by'),
    ('inventory_movements', 'created_at')
),
objects as (
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'orders', to_regclass('public.orders') is not null,
      'order_materials', to_regclass('public.order_materials') is not null,
      'inventory_items', to_regclass('public.inventory_items') is not null,
      'inventory_movements', to_regclass('public.inventory_movements') is not null
    ),
    'helpers', jsonb_build_object(
      'is_workspace_member(uuid)', to_regprocedure('public.is_workspace_member(uuid)') is not null,
      'workspace_member_role(uuid)', to_regprocedure('public.workspace_member_role(uuid)') is not null
    ),
    'rpcs', jsonb_build_object(
      'issue_order_materials(uuid,jsonb,text)',
        to_regprocedure('public.issue_order_materials(uuid, jsonb, text)') is not null,
      'return_order_materials(uuid,jsonb,text,text)',
        to_regprocedure('public.return_order_materials(uuid, jsonb, text, text)') is not null,
      'return_order_materials(uuid,jsonb,text)_unexpected_3arg',
        to_regprocedure('public.return_order_materials(uuid, jsonb, text)') is not null
    )
  ) as data
),
columns as (
  select jsonb_build_object(
    'observed', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'table_name', c.table_name,
            'column_name', c.column_name,
            'udt_name', c.udt_name,
            'data_type', c.data_type,
            'numeric_precision', c.numeric_precision,
            'numeric_scale', c.numeric_scale,
            'is_nullable', c.is_nullable
          )
          order by c.table_name, c.column_name
        )
        from information_schema.columns c
        join expected_columns e
          on e.table_name = c.table_name
         and e.column_name = c.column_name
        where c.table_schema = 'public'
      ),
      '[]'::jsonb
    ),
    'missing', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'table_name', e.table_name,
            'column_name', e.column_name
          )
          order by e.table_name, e.column_name
        )
        from expected_columns e
        where not exists (
          select 1
          from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = e.table_name
            and c.column_name = e.column_name
        )
      ),
      '[]'::jsonb
    )
  ) as data
),
idempotency_indexes as (
  select coalesce(
    (
      select jsonb_agg(index_row order by index_row ->> 'index_name')
      from (
        select jsonb_build_object(
          'index_name', ic.relname,
          'is_unique', idx.indisunique,
          'is_primary', idx.indisprimary,
          'indisvalid', idx.indisvalid,
          'indisready', idx.indisready,
          'key_column_count', idx.indnkeyatts,
          'predicate', pg_get_expr(idx.indpred, idx.indrelid),
          'key_columns', coalesce(
            (
              select jsonb_agg(a.attname order by ord.ord)
              from generate_series(0, greatest(idx.indnkeyatts - 1, -1)) as ord(ord)
              join pg_attribute a
                on a.attrelid = idx.indrelid
               and a.attnum = idx.indkey[ord.ord]
            ),
            '[]'::jsonb
          ),
          'indexdef', pg_get_indexdef(idx.indexrelid)
        ) as index_row
        from pg_index idx
        join pg_class ic on ic.oid = idx.indexrelid
        join pg_class tc on tc.oid = idx.indrelid
        join pg_namespace ns on ns.oid = tc.relnamespace
        where ns.nspname = 'public'
          and tc.relname = 'inventory_movements'
          and idx.indisunique
          and not idx.indisprimary
      ) as indexed
    ),
    '[]'::jsonb
  ) as data
),
rpc_functions as (
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'proname', p.proname,
          'identity_args', pg_get_function_identity_arguments(p.oid),
          'full_args', pg_get_function_arguments(p.oid),
          'result_type', pg_get_function_result(p.oid),
          'security_definer', p.prosecdef,
          'config', to_jsonb(p.proconfig),
          'volatility', p.provolatile,
          'function_owner', owner_role.rolname,
          'owner_bypassrls', owner_role.rolbypassrls
        )
        order by p.proname, pg_get_function_identity_arguments(p.oid)
      )
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      join pg_roles owner_role on owner_role.oid = p.proowner
      where ns.nspname = 'public'
        and p.proname in ('issue_order_materials', 'return_order_materials')
    ),
    '[]'::jsonb
  ) as data
),
execute_privileges as (
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'proname', f.proname,
          'identity_args', f.identity_args,
          'grantee', t.grantee_label,
          'has_execute',
            case
              when t.grantee_label = 'PUBLIC' then exists (
                select 1
                from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner)))
                  as acl(grantor, grantee, privilege_type, is_grantable)
                where acl.grantee = 0
                  and acl.privilege_type = 'EXECUTE'
              )
              when exists (select 1 from pg_roles r where r.rolname = t.grantee_label) then
                has_function_privilege(t.grantee_label, f.oid, 'EXECUTE')
              else false
            end
        )
        order by f.proname, f.identity_args, t.grantee_label
      )
      from (
        select
          p.oid,
          p.proname,
          pg_get_function_identity_arguments(p.oid) as identity_args,
          p.proowner,
          p.proacl
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('issue_order_materials', 'return_order_materials')
      ) as f
      cross join (
        values
          ('PUBLIC'::text),
          ('anon'),
          ('authenticated'),
          ('service_role')
      ) as t(grantee_label)
    ),
    '[]'::jsonb
  ) as data
),
table_security as (
  select jsonb_build_object(
    'observed', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'table_name', c.relname,
            'rls_enabled', c.relrowsecurity,
            'force_rls', c.relforcerowsecurity,
            'table_owner', owner_role.rolname,
            'table_owner_bypassrls', owner_role.rolbypassrls
          )
          order by c.relname
        )
        from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
        join pg_roles owner_role on owner_role.oid = c.relowner
        where ns.nspname = 'public'
          and c.relkind = 'r'
          and c.relname in (
            'orders',
            'order_materials',
            'inventory_items',
            'inventory_movements'
          )
      ),
      '[]'::jsonb
    ),
    'missing_tables', coalesce(
      (
        select jsonb_agg(t.table_name order by t.table_name)
        from (
          values
            ('orders'::text),
            ('order_materials'),
            ('inventory_items'),
            ('inventory_movements')
        ) as t(table_name)
        where to_regclass('public.' || t.table_name) is null
      ),
      '[]'::jsonb
    )
  ) as data
)
select
  objects.data as objects,
  columns.data as columns,
  idempotency_indexes.data as idempotency_indexes,
  rpc_functions.data as rpc_functions,
  execute_privileges.data as execute_privileges,
  table_security.data as table_security
from objects
cross join columns
cross join idempotency_indexes
cross join rpc_functions
cross join execute_privileges
cross join table_security;
