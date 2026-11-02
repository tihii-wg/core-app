-- =====================================================================
-- Core App — Warehouse management bootstrap (MAIN, manual APPLY only)
--
-- PURPOSE
--   Create only MISSING warehouse-module tables (exact crm_ro_v1 shape),
--   add only MISSING additive columns, ensure warehouse RLS/grants, seed
--   settings.warehouses from settings.locations. Fail-closed on conflicts.
--
-- REQUIRES (already present — never invented here)
--   * public.crm_permitted_workspaces(text)  [never replaced]
--   * public.crm_has_permission(uuid, text)  [never replaced]
--   * public.locations, roles, role_permissions, member_roles
--     with table comment = 'crm_ro_v1'
--   * workspaces, workspace_members, inventory_items, inventory_movements,
--     orders, order_materials, clients
--   * public.status_definitions when creating stock_transfers
--
-- Soft-deleted workspace filter: apply separately via
--   20261101010000_crm_permitted_workspaces_deleted_at.PRODUCTION.sql
--
-- WILL NOT
--   replace permission helpers; touch foundation DDL/RLS/triggers;
--   mark unverified existing tables as crm_ro_v1; drop unrelated policies;
--   drop existing triggers; create warehouse rows; reconcile stock;
--   rewrite business data.
--
-- One transaction. Abort = full rollback.
-- =====================================================================

begin;

-- =====================================================================
-- Temp helpers
-- =====================================================================

create or replace function pg_temp.wh_norm(p text)
returns text
language sql immutable as $$
  select lower(regexp_replace(replace(coalesce(p, ''), 'public.', ''), '\s+', '', 'g'));
$$;

create or replace function pg_temp.wh_push(p_problems text[], p_msg text)
returns text[]
language sql as $$
  select case when p_msg is null or btrim(p_msg) = '' then p_problems else p_problems || p_msg end;
$$;

create or replace function pg_temp.wh_col(
  p_table text, p_column text, p_udt text, p_nullable text
) returns text
language plpgsql as $$
declare
  v_udt text;
  v_null text;
begin
  select c.udt_name, c.is_nullable into v_udt, v_null
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and c.column_name = p_column;
  if not found then
    return format('public.%s missing column %s', p_table, p_column);
  end if;
  if v_udt is distinct from p_udt then
    return format('public.%s.%s udt %s, expected %s', p_table, p_column, v_udt, p_udt);
  end if;
  if v_null is distinct from p_nullable then
    return format('public.%s.%s nullability %s, expected %s', p_table, p_column, v_null, p_nullable);
  end if;
  return null;
end $$;

create or replace function pg_temp.wh_numeric_col(
  p_table text, p_column text, p_precision int, p_scale int, p_nullable text
) returns text
language plpgsql as $$
declare
  v_udt text; v_null text; v_prec int; v_scale int;
begin
  select c.udt_name, c.is_nullable, c.numeric_precision, c.numeric_scale
    into v_udt, v_null, v_prec, v_scale
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and c.column_name = p_column;
  if not found then
    return format('public.%s missing column %s', p_table, p_column);
  end if;
  if v_udt is distinct from 'numeric' then
    return format('public.%s.%s udt %s, expected numeric', p_table, p_column, v_udt);
  end if;
  if v_null is distinct from p_nullable then
    return format('public.%s.%s nullability %s, expected %s', p_table, p_column, v_null, p_nullable);
  end if;
  if v_prec is distinct from p_precision or v_scale is distinct from p_scale then
    return format('public.%s.%s numeric(%s,%s), expected numeric(%s,%s)',
      p_table, p_column, v_prec, v_scale, p_precision, p_scale);
  end if;
  return null;
end $$;

-- FK: public.p_table.p_column → public.p_ref_table(p_ref_column), optional delete action
-- p_del: 'c' cascade, 'n' set null, 'a' no action, 'r' restrict, NULL = any
create or replace function pg_temp.wh_fk(
  p_table text, p_column text, p_ref_table text, p_ref_column text default 'id', p_del text default null
) returns text
language plpgsql as $$
declare
  v_del char;
begin
  select c.confdeltype into v_del
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  join pg_class ref on ref.oid = c.confrelid
  join pg_namespace rn on rn.oid = ref.relnamespace
  join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
  where n.nspname = 'public' and rel.relname = p_table
    and c.contype = 'f' and c.convalidated
    and cardinality(c.conkey) = 1 and cardinality(c.confkey) = 1
    and a.attname = p_column
    and rn.nspname = 'public' and ref.relname = p_ref_table and ra.attname = p_ref_column;

  if not found then
    return format('public.%s.%s missing validated FK to public.%s(%s)',
      p_table, p_column, p_ref_table, p_ref_column);
  end if;
  if p_del is not null and v_del is distinct from p_del then
    return format('public.%s.%s FK to public.%s(%s) delete action %s, expected %s',
      p_table, p_column, p_ref_table, p_ref_column, v_del, p_del);
  end if;
  return null;
end $$;

create or replace function pg_temp.wh_owned(p_table text) returns text
language plpgsql as $$
declare
  v_comment text;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    return null;
  end if;
  v_comment := coalesce(obj_description(to_regclass(format('public.%I', p_table)), 'pg_class'), '');
  if v_comment = 'crm_ro_v1' then
    return null;
  end if;
  if v_comment = '' then
    return format('public.%s exists but ownership cannot be established (empty comment); will not mark as crm_ro_v1', p_table);
  end if;
  return format('public.%s exists with comment %L (expected crm_ro_v1)', p_table, v_comment);
end $$;

-- Partial unique index: (workspace_id) WHERE is_default AND deleted_at IS NULL
create or replace function pg_temp.wh_one_default_idx(p_table text, p_index text) returns text
language plpgsql as $$
declare
  v_pred text;
  v_cols text[];
  v_unique boolean;
  v_valid boolean;
begin
  select i.indisunique, i.indisvalid and i.indislive,
         pg_get_expr(i.indpred, i.indrelid),
         (
           select array_agg(att.attname::text order by ord.ordinality)
           from unnest(i.indkey) with ordinality as ord(attnum, ordinality)
           join pg_attribute att on att.attrelid = i.indrelid and att.attnum = ord.attnum
         )
    into v_unique, v_valid, v_pred, v_cols
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_namespace n on n.oid = ic.relnamespace
  join pg_class tbl on tbl.oid = i.indrelid
  where n.nspname = 'public' and ic.relname = p_index and tbl.relname = p_table;

  if not found then
    return format('missing index public.%s on %s', p_index, p_table);
  end if;
  if not v_unique then
    return format('%s on %s is not UNIQUE', p_index, p_table);
  end if;
  if not v_valid then
    return format('%s on %s is not VALID/LIVE', p_index, p_table);
  end if;
  if v_cols is distinct from array['workspace_id']::text[] then
    return format('%s columns %s, expected [workspace_id]', p_index, coalesce(v_cols::text, 'null'));
  end if;
  if v_pred is null
     or position('is_default' in lower(v_pred)) = 0
     or position('deleted_at' in lower(v_pred)) = 0
     or position('is null' in lower(v_pred)) = 0 then
    return format('%s predicate incompatible: %s', p_index, coalesce(v_pred, 'NULL'));
  end if;
  return null;
end $$;

create or replace function pg_temp.wh_unique_cols(p_table text, p_cols text[]) returns text
language plpgsql as $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = p_table and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by u.ord)
        from unnest(c.conkey) with ordinality as u(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
      ) = p_cols
  ) then
    return null;
  end if;
  return format('public.%s missing UNIQUE %s', p_table, p_cols::text);
end $$;

create or replace function pg_temp.wh_perm_has_default() returns boolean
language sql stable as $$
  select coalesce(
    (select p.pronargdefaults > 0
     from pg_proc p
     where p.oid = to_regprocedure('public.crm_permitted_workspaces(text)')),
    false
  );
$$;

create or replace function pg_temp.wh_perm_expr(p_permission text) returns text
language plpgsql stable as $$
begin
  if p_permission = '*' then
    if pg_temp.wh_perm_has_default() then
      return 'workspace_id in (select public.crm_permitted_workspaces())';
    end if;
    return 'workspace_id in (select public.crm_permitted_workspaces(NULL))';
  end if;
  return format('workspace_id in (select public.crm_permitted_workspaces(%L))', p_permission);
end $$;

-- Returns NULL if missing, 'EXISTS_OK' if exact match, else error text.
create or replace function pg_temp.wh_policy_ok(
  p_table text, p_policy text, p_cmd text, p_permission text
) returns text
language plpgsql as $$
declare
  v_qual text;
  v_check text;
  v_cmd text;
  v_roles text[];
  v_expected text := pg_temp.wh_norm(pg_temp.wh_perm_expr(p_permission));
  v_alt text;
  v_using_ok boolean := false;
  v_check_ok boolean := false;
begin
  select qual, with_check, cmd, roles
    into v_qual, v_check, v_cmd, v_roles
  from pg_policies
  where schemaname = 'public' and tablename = p_table and policyname = p_policy;

  if not found then
    return null;
  end if;

  if upper(v_cmd) is distinct from upper(p_cmd) then
    return format('public.%s policy %s cmd=%s expected %s (ALL not accepted)',
      p_table, p_policy, v_cmd, p_cmd);
  end if;

  if not ('authenticated' = any (v_roles) or 'public' = any (v_roles)) then
    return format('public.%s policy %s roles %s do not include authenticated',
      p_table, p_policy, coalesce(v_roles::text, '{}'));
  end if;

  -- For '*', accept () and (null) only when the function has a default.
  if p_permission = '*' and pg_temp.wh_perm_has_default() then
    v_alt := pg_temp.wh_norm('workspace_id in (select public.crm_permitted_workspaces(NULL))');
  end if;

  if upper(p_cmd) in ('SELECT', 'DELETE') then
    v_using_ok := pg_temp.wh_norm(v_qual) = v_expected
               or (v_alt is not null and pg_temp.wh_norm(v_qual) = v_alt);
    v_check_ok := v_check is null or btrim(v_check) = '';
    if not v_using_ok then
      return format('public.%s policy %s USING not equivalent to expected permission expression', p_table, p_policy);
    end if;
    if not v_check_ok then
      return format('public.%s policy %s must not set WITH CHECK for %s', p_table, p_policy, p_cmd);
    end if;
  elsif upper(p_cmd) = 'INSERT' then
    v_check_ok := pg_temp.wh_norm(v_check) = v_expected
               or (v_alt is not null and pg_temp.wh_norm(v_check) = v_alt);
    v_using_ok := v_qual is null or btrim(v_qual) = '';
    if not v_check_ok then
      return format('public.%s policy %s WITH CHECK not equivalent to expected permission expression', p_table, p_policy);
    end if;
    if not v_using_ok then
      return format('public.%s policy %s must not set USING for INSERT', p_table, p_policy);
    end if;
  elsif upper(p_cmd) = 'UPDATE' then
    v_using_ok := pg_temp.wh_norm(v_qual) = v_expected
               or (v_alt is not null and pg_temp.wh_norm(v_qual) = v_alt);
    v_check_ok := pg_temp.wh_norm(v_check) = v_expected
               or (v_alt is not null and pg_temp.wh_norm(v_check) = v_alt);
    if not v_using_ok or not v_check_ok then
      return format('public.%s policy %s USING/WITH CHECK not equivalent to expected permission expression', p_table, p_policy);
    end if;
  else
    return format('public.%s policy %s unsupported cmd %s', p_table, p_policy, p_cmd);
  end if;

  return 'EXISTS_OK';
end $$;

create temporary table if not exists wh_created (
  table_name text primary key
) on commit drop;

-- =====================================================================
-- 0. Preflight
-- =====================================================================

do $preflight$
declare
  v_problems text[] := array[]::text[];
  v_table text;
  v_def text;
  v_foundation text[] := array['locations','roles','role_permissions','member_roles'];
  v_module text[] := array[
    'warehouses','bin_locations','warehouse_stock','stock_batches','stock_serials',
    'goods_receipts','goods_receipt_lines','stock_transfers','stock_transfer_lines',
    'write_offs','write_off_lines'
  ];
begin
  foreach v_table in array array[
    'workspaces','workspace_members','inventory_items','inventory_movements',
    'orders','order_materials','clients'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      v_problems := v_problems || format('missing required table public.%s', v_table);
    end if;
  end loop;

  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('workspaces', 'id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('workspaces', 'deleted_at', 'timestamptz', 'YES'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('workspace_members', 'workspace_id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('workspace_members', 'user_id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('workspace_members', 'deleted_at', 'timestamptz', 'YES'));
  if to_regclass('public.workspace_members') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'workspace_members' and column_name = 'role'
     ) then
    v_problems := v_problems || 'missing public.workspace_members.role';
  end if;

  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_items', 'id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_items', 'workspace_id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_movements', 'id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_movements', 'workspace_id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('orders', 'id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('order_materials', 'id', 'uuid', 'NO'));
  v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('clients', 'id', 'uuid', 'NO'));

  if to_regprocedure('auth.uid()') is null then
    v_problems := v_problems || 'missing auth.uid()';
  end if;

  if to_regprocedure('public.crm_permitted_workspaces(text)') is null then
    v_problems := v_problems || 'missing public.crm_permitted_workspaces(text); apply crm_ro_v1.PRODUCTION.sql (helpers are never created here)';
  else
    v_def := pg_get_functiondef('public.crm_permitted_workspaces(text)'::regprocedure);
    if position('security definer' in lower(v_def)) = 0 then
      v_problems := v_problems || 'crm_permitted_workspaces(text) is not SECURITY DEFINER';
    end if;
    if position('workspace_members' in lower(v_def)) = 0
       or position('member_roles' in lower(v_def)) = 0
       or position('role_permissions' in lower(v_def)) = 0
       or position('owner' in lower(v_def)) = 0
       or position('admin' in lower(v_def)) = 0 then
      v_problems := v_problems || 'crm_permitted_workspaces(text) body missing expected membership/role/owner/admin semantics';
    end if;
    if not has_function_privilege('authenticated', 'public.crm_permitted_workspaces(text)', 'execute') then
      v_problems := v_problems || 'authenticated lacks EXECUTE on crm_permitted_workspaces(text)';
    end if;
  end if;

  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    v_problems := v_problems || 'missing public.crm_has_permission(uuid, text); apply crm_ro_v1.PRODUCTION.sql';
  else
    v_def := pg_get_functiondef('public.crm_has_permission(uuid, text)'::regprocedure);
    if position('crm_permitted_workspaces' in lower(v_def)) = 0 then
      v_problems := v_problems || 'crm_has_permission does not call crm_permitted_workspaces';
    end if;
    if not has_function_privilege('authenticated', 'public.crm_has_permission(uuid, text)', 'execute') then
      v_problems := v_problems || 'authenticated lacks EXECUTE on crm_has_permission(uuid, text)';
    end if;
  end if;

  foreach v_table in array v_foundation loop
    if to_regclass(format('public.%I', v_table)) is null then
      v_problems := v_problems || format('missing foundation public.%s (apply crm_ro_v1; not created here)', v_table);
    else
      v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_owned(v_table));
    end if;
  end loop;

  if to_regclass('public.locations') is not null and pg_temp.wh_owned('locations') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('locations', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('locations', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('locations', 'name', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('locations', 'workspace_id', 'workspaces', 'id', 'c'));
  end if;

  if to_regclass('public.roles') is not null and pg_temp.wh_owned('roles') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('roles', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('roles', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('roles', 'workspace_id', 'workspaces', 'id', 'c'));
  end if;

  if to_regclass('public.role_permissions') is not null and pg_temp.wh_owned('role_permissions') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('role_permissions', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('role_permissions', 'role_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('role_permissions', 'permission', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('role_permissions', 'role_id', 'roles', 'id', 'c'));
  end if;

  if to_regclass('public.member_roles') is not null and pg_temp.wh_owned('member_roles') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('member_roles', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('member_roles', 'role_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('member_roles', 'role_id', 'roles', 'id', 'c'));
  end if;

  foreach v_table in array v_module loop
    if to_regclass(format('public.%I', v_table)) is not null then
      v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_owned(v_table));
    end if;
  end loop;

  -- Complete existing warehouses shape (crm_ro_v1)
  if to_regclass('public.warehouses') is not null and pg_temp.wh_owned('warehouses') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'location_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'name', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'warehouse_type', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'is_default', 'bool', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'is_active', 'bool', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'created_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'updated_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouses', 'deleted_at', 'timestamptz', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('warehouses', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('warehouses', 'location_id', 'locations', 'id', 'n'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_one_default_idx('warehouses', 'warehouses_one_default_idx'));
  end if;

  if to_regclass('public.bin_locations') is not null and pg_temp.wh_owned('bin_locations') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('bin_locations', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('bin_locations', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('bin_locations', 'warehouse_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('bin_locations', 'name', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('bin_locations', 'created_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('bin_locations', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('bin_locations', 'warehouse_id', 'warehouses', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_unique_cols('bin_locations', array['warehouse_id','name']));
  end if;

  if to_regclass('public.warehouse_stock') is not null and pg_temp.wh_owned('warehouse_stock') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouse_stock', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouse_stock', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouse_stock', 'warehouse_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouse_stock', 'inventory_item_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouse_stock', 'bin_location_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('warehouse_stock', 'quantity', 14, 3, 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('warehouse_stock', 'min_quantity', 14, 3, 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('warehouse_stock', 'max_quantity', 14, 3, 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('warehouse_stock', 'updated_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('warehouse_stock', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('warehouse_stock', 'warehouse_id', 'warehouses', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('warehouse_stock', 'inventory_item_id', 'inventory_items', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('warehouse_stock', 'bin_location_id', 'bin_locations', 'id', 'n'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_unique_cols('warehouse_stock', array['warehouse_id','inventory_item_id']));
  end if;

  if to_regclass('public.stock_batches') is not null and pg_temp.wh_owned('stock_batches') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'inventory_item_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'warehouse_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'goods_receipt_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'supplier_client_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('stock_batches', 'unit_cost', 16, 5, 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('stock_batches', 'quantity_received', 14, 3, 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('stock_batches', 'quantity_left', 14, 3, 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'expires_on', 'date', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'received_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_batches', 'created_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_batches', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_batches', 'inventory_item_id', 'inventory_items', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_batches', 'warehouse_id', 'warehouses', 'id', 'n'));
  end if;

  if to_regclass('public.stock_serials') is not null and pg_temp.wh_owned('stock_serials') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'inventory_item_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'warehouse_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'serial_number', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'status', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'created_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_serials', 'updated_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_serials', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_serials', 'inventory_item_id', 'inventory_items', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_unique_cols('stock_serials', array['workspace_id','inventory_item_id','serial_number']));
  end if;

  if to_regclass('public.goods_receipts') is not null and pg_temp.wh_owned('goods_receipts') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'warehouse_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'status', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'total', 'numeric', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'created_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'updated_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipts', 'deleted_at', 'timestamptz', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('goods_receipts', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('goods_receipts', 'warehouse_id', 'warehouses', 'id', 'n'));
  end if;

  if to_regclass('public.goods_receipt_lines') is not null and pg_temp.wh_owned('goods_receipt_lines') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipt_lines', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipt_lines', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipt_lines', 'goods_receipt_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('goods_receipt_lines', 'item_name', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('goods_receipt_lines', 'quantity', 14, 3, 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('goods_receipt_lines', 'goods_receipt_id', 'goods_receipts', 'id', 'c'));
  end if;

  if to_regclass('public.stock_transfers') is not null and pg_temp.wh_owned('stock_transfers') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'from_warehouse_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'to_warehouse_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'created_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'updated_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'deleted_at', 'timestamptz', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_transfers', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_transfers', 'from_warehouse_id', 'warehouses', 'id', 'n'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_transfers', 'to_warehouse_id', 'warehouses', 'id', 'n'));
    -- posted_at is additive (ops RPC); if present must be timestamptz nullable
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'stock_transfers' and column_name = 'posted_at'
    ) then
      v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfers', 'posted_at', 'timestamptz', 'YES'));
    end if;
  end if;

  if to_regclass('public.stock_transfer_lines') is not null and pg_temp.wh_owned('stock_transfer_lines') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfer_lines', 'stock_transfer_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('stock_transfer_lines', 'item_name', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('stock_transfer_lines', 'quantity', 14, 3, 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('stock_transfer_lines', 'stock_transfer_id', 'stock_transfers', 'id', 'c'));
  end if;

  if to_regclass('public.write_offs') is not null and pg_temp.wh_owned('write_offs') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_offs', 'id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_offs', 'workspace_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_offs', 'warehouse_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_offs', 'created_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_offs', 'updated_at', 'timestamptz', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_offs', 'deleted_at', 'timestamptz', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('write_offs', 'workspace_id', 'workspaces', 'id', 'c'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('write_offs', 'warehouse_id', 'warehouses', 'id', 'n'));
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'write_offs' and column_name = 'posted_at'
    ) then
      v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_offs', 'posted_at', 'timestamptz', 'YES'));
    end if;
  end if;

  if to_regclass('public.write_off_lines') is not null and pg_temp.wh_owned('write_off_lines') is null then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_off_lines', 'write_off_id', 'uuid', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('write_off_lines', 'item_name', 'text', 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('write_off_lines', 'quantity', 14, 3, 'NO'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('write_off_lines', 'write_off_id', 'write_offs', 'id', 'c'));
  end if;

  -- Additive columns already present must match crm_ro_v1 (never accept wrong shape)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'warehouse_id'
  ) then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_movements', 'warehouse_id', 'uuid', 'YES'));
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('inventory_movements', 'warehouse_id', 'warehouses', 'id', 'n'));
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'batch_id'
  ) then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_movements', 'batch_id', 'uuid', 'YES'));
    if to_regclass('public.stock_batches') is not null then
      v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('inventory_movements', 'batch_id', 'stock_batches', 'id', 'n'));
    end if;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'document_type'
  ) then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_movements', 'document_type', 'text', 'YES'));
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'document_id'
  ) then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('inventory_movements', 'document_id', 'uuid', 'YES'));
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'unit_cost'
  ) then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_numeric_col('inventory_movements', 'unit_cost', 16, 5, 'YES'));
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_materials' and column_name = 'warehouse_id'
  ) then
    v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_col('order_materials', 'warehouse_id', 'uuid', 'YES'));
    if to_regclass('public.warehouses') is not null then
      v_problems := pg_temp.wh_push(v_problems, pg_temp.wh_fk('order_materials', 'warehouse_id', 'warehouses', 'id', 'n'));
    end if;
  end if;

  if to_regclass('public.stock_transfers') is null and to_regclass('public.status_definitions') is null then
    v_problems := v_problems || 'stock_transfers missing and status_definitions missing (FK target for status_id)';
  end if;

  select coalesce(array_agg(p order by p), array[]::text[]) into v_problems
  from unnest(v_problems) p
  where p is not null and length(btrim(p)) > 0;

  if cardinality(v_problems) > 0 then
    raise exception E'Warehouse bootstrap preflight failed; no changes applied:\n%',
      array_to_string(v_problems, E'\n');
  end if;
end
$preflight$;

-- =====================================================================
-- 1. Create missing warehouse-module tables (exact crm_ro_v1 DDL)
-- =====================================================================

do $create$
begin
  if to_regclass('public.warehouses') is null then
    create table public.warehouses (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      location_id uuid references public.locations(id) on delete set null,
      name text not null,
      warehouse_type text not null default 'location' check (warehouse_type in ('location','company')),
      is_default boolean not null default false,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create unique index warehouses_one_default_idx
      on public.warehouses (workspace_id) where is_default and deleted_at is null;
    create index warehouses_workspace_id_idx on public.warehouses (workspace_id);
    create index warehouses_location_id_idx on public.warehouses (location_id);
    comment on table public.warehouses is 'crm_ro_v1';
    insert into wh_created(table_name) values ('warehouses');
  end if;

  if to_regclass('public.bin_locations') is null then
    create table public.bin_locations (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      warehouse_id uuid not null references public.warehouses(id) on delete cascade,
      name text not null,
      created_at timestamptz not null default now(),
      unique (warehouse_id, name)
    );
    create index bin_locations_workspace_id_idx on public.bin_locations (workspace_id);
    create index bin_locations_warehouse_id_idx on public.bin_locations (warehouse_id);
    comment on table public.bin_locations is 'crm_ro_v1';
    insert into wh_created(table_name) values ('bin_locations');
  end if;

  if to_regclass('public.warehouse_stock') is null then
    create table public.warehouse_stock (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      warehouse_id uuid not null references public.warehouses(id) on delete cascade,
      inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
      bin_location_id uuid references public.bin_locations(id) on delete set null,
      quantity numeric(14,3) not null default 0,
      min_quantity numeric(14,3),
      max_quantity numeric(14,3),
      updated_at timestamptz not null default now(),
      unique (warehouse_id, inventory_item_id)
    );
    create index warehouse_stock_workspace_id_idx on public.warehouse_stock (workspace_id);
    create index warehouse_stock_warehouse_id_idx on public.warehouse_stock (warehouse_id);
    create index warehouse_stock_inventory_item_id_idx on public.warehouse_stock (inventory_item_id);
    create index warehouse_stock_bin_location_id_idx on public.warehouse_stock (bin_location_id);
    comment on table public.warehouse_stock is 'crm_ro_v1';
    insert into wh_created(table_name) values ('warehouse_stock');
  end if;

  if to_regclass('public.goods_receipts') is null then
    create table public.goods_receipts (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      number text,
      legacy_number text,
      location_id uuid references public.locations(id) on delete set null,
      warehouse_id uuid references public.warehouses(id) on delete set null,
      supplier_client_id uuid references public.clients(id) on delete set null,
      supplier_invoice_number text,
      supplier_invoice_date date,
      status text not null default 'posted' check (status in ('draft','posted')),
      comment text,
      total numeric(16,2) not null default 0,
      received_at timestamptz not null default now(),
      created_by uuid default auth.uid() references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create index goods_receipts_workspace_id_idx on public.goods_receipts (workspace_id);
    create index goods_receipts_warehouse_id_idx on public.goods_receipts (warehouse_id);
    comment on table public.goods_receipts is 'crm_ro_v1';
    insert into wh_created(table_name) values ('goods_receipts');
  end if;

  if to_regclass('public.goods_receipt_lines') is null then
    create table public.goods_receipt_lines (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
      inventory_item_id uuid references public.inventory_items(id) on delete set null,
      item_name text not null,
      quantity numeric(14,3) not null,
      unit_cost numeric(16,5) not null default 0,
      amount numeric(16,2) not null default 0,
      expires_on date,
      position integer not null default 0
    );
    create index goods_receipt_lines_workspace_id_idx on public.goods_receipt_lines (workspace_id);
    create index goods_receipt_lines_goods_receipt_id_idx on public.goods_receipt_lines (goods_receipt_id);
    comment on table public.goods_receipt_lines is 'crm_ro_v1';
    insert into wh_created(table_name) values ('goods_receipt_lines');
  end if;

  if to_regclass('public.stock_batches') is null then
    create table public.stock_batches (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
      warehouse_id uuid references public.warehouses(id) on delete set null,
      goods_receipt_id uuid references public.goods_receipts(id) on delete set null,
      supplier_client_id uuid references public.clients(id) on delete set null,
      unit_cost numeric(16,5) not null default 0,
      quantity_received numeric(14,3) not null default 0,
      quantity_left numeric(14,3) not null default 0,
      expires_on date,
      received_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
    create index stock_batches_workspace_id_idx on public.stock_batches (workspace_id);
    create index stock_batches_warehouse_id_idx on public.stock_batches (warehouse_id);
    create index stock_batches_inventory_item_id_idx on public.stock_batches (inventory_item_id);
    comment on table public.stock_batches is 'crm_ro_v1';
    insert into wh_created(table_name) values ('stock_batches');
  end if;

  if to_regclass('public.stock_serials') is null then
    create table public.stock_serials (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
      warehouse_id uuid references public.warehouses(id) on delete set null,
      goods_receipt_id uuid references public.goods_receipts(id) on delete set null,
      order_material_id uuid references public.order_materials(id) on delete set null,
      serial_number text not null,
      status text not null default 'in_stock' check (status in ('in_stock','issued','returned','written_off')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, inventory_item_id, serial_number)
    );
    create index stock_serials_workspace_id_idx on public.stock_serials (workspace_id);
    create index stock_serials_warehouse_id_idx on public.stock_serials (warehouse_id);
    create index stock_serials_inventory_item_id_idx on public.stock_serials (inventory_item_id);
    comment on table public.stock_serials is 'crm_ro_v1';
    insert into wh_created(table_name) values ('stock_serials');
  end if;

  if to_regclass('public.stock_transfers') is null then
    create table public.stock_transfers (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      number text,
      status_id uuid references public.status_definitions(id) on delete set null,
      status_deadline timestamptz,
      from_warehouse_id uuid references public.warehouses(id) on delete set null,
      to_warehouse_id uuid references public.warehouses(id) on delete set null,
      comment text,
      total numeric(16,2) not null default 0,
      created_by uuid default auth.uid() references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create index stock_transfers_workspace_id_idx on public.stock_transfers (workspace_id);
    create index stock_transfers_from_warehouse_id_idx on public.stock_transfers (from_warehouse_id);
    create index stock_transfers_to_warehouse_id_idx on public.stock_transfers (to_warehouse_id);
    comment on table public.stock_transfers is 'crm_ro_v1';
    insert into wh_created(table_name) values ('stock_transfers');
  end if;

  if to_regclass('public.stock_transfer_lines') is null then
    create table public.stock_transfer_lines (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      stock_transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
      inventory_item_id uuid references public.inventory_items(id) on delete set null,
      item_name text not null,
      quantity numeric(14,3) not null,
      unit_cost numeric(16,5) not null default 0,
      amount numeric(16,2) not null default 0,
      position integer not null default 0
    );
    create index stock_transfer_lines_workspace_id_idx on public.stock_transfer_lines (workspace_id);
    create index stock_transfer_lines_stock_transfer_id_idx on public.stock_transfer_lines (stock_transfer_id);
    comment on table public.stock_transfer_lines is 'crm_ro_v1';
    insert into wh_created(table_name) values ('stock_transfer_lines');
  end if;

  if to_regclass('public.write_offs') is null then
    create table public.write_offs (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      number text,
      warehouse_id uuid references public.warehouses(id) on delete set null,
      reason text,
      comment text,
      total numeric(16,2) not null default 0,
      created_by uuid default auth.uid() references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create index write_offs_workspace_id_idx on public.write_offs (workspace_id);
    create index write_offs_warehouse_id_idx on public.write_offs (warehouse_id);
    comment on table public.write_offs is 'crm_ro_v1';
    insert into wh_created(table_name) values ('write_offs');
  end if;

  if to_regclass('public.write_off_lines') is null then
    create table public.write_off_lines (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      write_off_id uuid not null references public.write_offs(id) on delete cascade,
      inventory_item_id uuid references public.inventory_items(id) on delete set null,
      item_name text not null,
      quantity numeric(14,3) not null,
      unit_cost numeric(16,5) not null default 0,
      amount numeric(16,2) not null default 0,
      position integer not null default 0
    );
    create index write_off_lines_workspace_id_idx on public.write_off_lines (workspace_id);
    create index write_off_lines_write_off_id_idx on public.write_off_lines (write_off_id);
    comment on table public.write_off_lines is 'crm_ro_v1';
    insert into wh_created(table_name) values ('write_off_lines');
  end if;
end
$create$;

-- =====================================================================
-- 2. Additive columns — validate existing, else ADD
-- =====================================================================

do $additive$
declare
  v_msg text;
begin
  -- stock_transfers.posted_at / write_offs.posted_at (ops RPC)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_transfers' and column_name = 'posted_at'
  ) then
    alter table public.stock_transfers add column posted_at timestamptz;
  else
    v_msg := pg_temp.wh_col('stock_transfers', 'posted_at', 'timestamptz', 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'write_offs' and column_name = 'posted_at'
  ) then
    alter table public.write_offs add column posted_at timestamptz;
  else
    v_msg := pg_temp.wh_col('write_offs', 'posted_at', 'timestamptz', 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'warehouse_id'
  ) then
    alter table public.inventory_movements
      add column warehouse_id uuid references public.warehouses(id) on delete set null;
  else
    v_msg := pg_temp.wh_col('inventory_movements', 'warehouse_id', 'uuid', 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
    v_msg := pg_temp.wh_fk('inventory_movements', 'warehouse_id', 'warehouses', 'id', 'n');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'batch_id'
  ) then
    alter table public.inventory_movements
      add column batch_id uuid references public.stock_batches(id) on delete set null;
  else
    v_msg := pg_temp.wh_col('inventory_movements', 'batch_id', 'uuid', 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
    v_msg := pg_temp.wh_fk('inventory_movements', 'batch_id', 'stock_batches', 'id', 'n');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'document_type'
  ) then
    alter table public.inventory_movements add column document_type text;
  else
    v_msg := pg_temp.wh_col('inventory_movements', 'document_type', 'text', 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'document_id'
  ) then
    alter table public.inventory_movements add column document_id uuid;
  else
    v_msg := pg_temp.wh_col('inventory_movements', 'document_id', 'uuid', 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'unit_cost'
  ) then
    alter table public.inventory_movements add column unit_cost numeric(16,5);
  else
    v_msg := pg_temp.wh_numeric_col('inventory_movements', 'unit_cost', 16, 5, 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_materials' and column_name = 'warehouse_id'
  ) then
    alter table public.order_materials
      add column warehouse_id uuid references public.warehouses(id) on delete set null;
  else
    v_msg := pg_temp.wh_col('order_materials', 'warehouse_id', 'uuid', 'YES');
    if v_msg is not null then raise exception '%', v_msg; end if;
    v_msg := pg_temp.wh_fk('order_materials', 'warehouse_id', 'warehouses', 'id', 'n');
    if v_msg is not null then raise exception '%', v_msg; end if;
  end if;
end
$additive$;

create index if not exists inventory_movements_warehouse_id_idx on public.inventory_movements (warehouse_id);
create index if not exists inventory_movements_batch_id_idx on public.inventory_movements (batch_id);

-- Ensure one-default index definition (create only if missing; conflict aborts)
do $idx$
declare
  v_msg text;
begin
  v_msg := pg_temp.wh_one_default_idx('warehouses', 'warehouses_one_default_idx');
  if v_msg is not null and position('missing index' in v_msg) > 0 then
    execute 'create unique index warehouses_one_default_idx on public.warehouses (workspace_id) where is_default and deleted_at is null';
    v_msg := pg_temp.wh_one_default_idx('warehouses', 'warehouses_one_default_idx');
  end if;
  if v_msg is not null then
    raise exception '%', v_msg;
  end if;
end
$idx$;

-- =====================================================================
-- 3. updated_at trigger — create function only if missing; never replace
-- =====================================================================

do $touch$
begin
  if to_regprocedure('public.crm_touch_updated_at()') is null then
    execute $fn$
      create function public.crm_touch_updated_at()
      returns trigger
      language plpgsql
      set search_path = ''
      as $body$
      begin
        new.updated_at := now();
        return new;
      end
      $body$
    $fn$;
    revoke all on function public.crm_touch_updated_at() from public, anon, authenticated;
  end if;
end
$touch$;

do $trg$
declare
  r record;
begin
  for r in select table_name from wh_created loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.table_name and column_name = 'updated_at'
    ) and to_regprocedure('public.crm_touch_updated_at()') is not null then
      if not exists (
        select 1 from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = r.table_name
          and t.tgname = 'crm_touch_updated_at' and not t.tgisinternal
      ) then
        execute format(
          'create trigger crm_touch_updated_at before update on public.%I for each row execute function public.crm_touch_updated_at()',
          r.table_name
        );
      end if;
    end if;
  end loop;
end
$trg$;

-- =====================================================================
-- 4. RLS ensure (exact policy semantics; never drop unrelated policies)
-- =====================================================================

create or replace function pg_temp.wh_ensure_policy(
  p_table text, p_op text, p_permission text
) returns void
language plpgsql as $$
declare
  v_policy text := 'crm_' || p_op;
  v_rule text;
  v_status text;
begin
  if p_permission = '-' then
    return;
  end if;

  v_rule := pg_temp.wh_perm_expr(p_permission);
  v_status := pg_temp.wh_policy_ok(p_table, v_policy, p_op, p_permission);

  if v_status = 'EXISTS_OK' then
    null;
  elsif v_status is null then
    execute format('grant %s on public.%I to authenticated', p_op, p_table);
    execute format(
      'create policy %I on public.%I for %s to authenticated %s',
      v_policy, p_table, p_op,
      case p_op
        when 'insert' then format('with check (%s)', v_rule)
        when 'update' then format('using (%1$s) with check (%1$s)', v_rule)
        else format('using (%s)', v_rule)
      end
    );
  else
    raise exception '%', v_status;
  end if;

  execute format('grant %s on public.%I to authenticated', p_op, p_table);
end $$;

create or replace function pg_temp.wh_deny_stock_writes(p_table text) returns void
language plpgsql as $$
declare
  v_is_new boolean;
  v_pol text;
begin
  select exists (select 1 from wh_created c where c.table_name = p_table) into v_is_new;

  -- Any INSERT/UPDATE/DELETE/ALL policy is incompatible with stock write denial.
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = p_table
      and upper(cmd) in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    if v_is_new and v_pol in ('crm_insert', 'crm_update', 'crm_delete') then
      execute format('drop policy if exists %I on public.%I', v_pol, p_table);
    else
      raise exception
        'public.%s has write-capable policy %I; refusing to drop unrelated/foreign policies. Aborting.',
        p_table, v_pol;
    end if;
  end loop;

  -- Effective privileges include PUBLIC inheritance.
  execute format('revoke insert, update, delete, truncate on public.%I from public, anon, authenticated', p_table);
  execute format('grant select on public.%I to authenticated', p_table);
  execute format('grant all on public.%I to service_role', p_table);

  if has_table_privilege('authenticated', format('public.%I', p_table), 'insert')
     or has_table_privilege('authenticated', format('public.%I', p_table), 'update')
     or has_table_privilege('authenticated', format('public.%I', p_table), 'delete')
     or has_table_privilege('authenticated', format('public.%I', p_table), 'truncate') then
    raise exception 'authenticated still has write/truncate on public.%s after revoke (check PUBLIC grants)', p_table;
  end if;
end $$;

create or replace function pg_temp.wh_apply_table_rls(
  p_table text, p_select text, p_insert text, p_update text, p_delete text
) returns void
language plpgsql as $$
declare
  v_is_new boolean;
begin
  select exists (select 1 from wh_created c where c.table_name = p_table) into v_is_new;

  execute format('alter table public.%I enable row level security', p_table);
  execute format('grant all on public.%I to service_role', p_table);

  if v_is_new then
    execute format('revoke all on public.%I from public, anon, authenticated', p_table);
    execute format('grant all on public.%I to service_role', p_table);
  end if;

  perform pg_temp.wh_ensure_policy(p_table, 'select', p_select);
  perform pg_temp.wh_ensure_policy(p_table, 'insert', p_insert);
  perform pg_temp.wh_ensure_policy(p_table, 'update', p_update);
  perform pg_temp.wh_ensure_policy(p_table, 'delete', p_delete);

  if p_insert = '-' then
    perform pg_temp.wh_deny_stock_writes(p_table);
  end if;
end $$;

select pg_temp.wh_apply_table_rls(t, s, i, u, d) from (values
  ('warehouses',          '*', 'settings.warehouses', 'settings.warehouses', 'settings.warehouses'),
  ('bin_locations',       '*', 'settings.warehouses', 'settings.warehouses', 'settings.warehouses'),
  ('warehouse_stock',     '*', '-', '-', '-'),
  ('stock_batches',       '*', '-', '-', '-'),
  ('stock_serials',       '*', '-', '-', '-'),
  ('goods_receipts',      'inventory.receipts.view', 'inventory.receipts.create', 'inventory.receipts.edit', 'inventory.receipts.delete'),
  ('goods_receipt_lines', 'inventory.receipts.view', 'inventory.receipts.create', 'inventory.receipts.edit', 'inventory.receipts.delete'),
  ('stock_transfers',     'inventory.transfers.view', 'inventory.transfers.create', 'inventory.transfers.edit', 'inventory.delete_operations'),
  ('stock_transfer_lines','inventory.transfers.view', 'inventory.transfers.create', 'inventory.transfers.edit', 'inventory.delete_operations'),
  ('write_offs',          'inventory.write_offs.view', 'inventory.write_offs.create', 'inventory.write_offs.edit', 'inventory.write_offs.delete'),
  ('write_off_lines',     'inventory.write_offs.view', 'inventory.write_offs.create', 'inventory.write_offs.edit', 'inventory.write_offs.delete')
) as v(t, s, i, u, d);

-- =====================================================================
-- 5. Additive permission seed (settings.warehouses ← settings.locations)
-- =====================================================================

insert into public.role_permissions (workspace_id, role_id, permission)
select rp.workspace_id, rp.role_id, 'settings.warehouses'
from public.role_permissions rp
where rp.permission = 'settings.locations'
  and not exists (
    select 1 from public.role_permissions x
    where x.role_id = rp.role_id and x.permission = 'settings.warehouses'
  );

-- =====================================================================
-- 6. Post-apply sanity (abort → rollback)
-- =====================================================================

do $post$
declare
  v_problems text[] := array[]::text[];
  v_msg text;
  v_stock text;
begin
  if to_regclass('public.warehouses') is null then
    v_problems := v_problems || 'public.warehouses missing';
  end if;

  v_msg := pg_temp.wh_policy_ok('warehouses', 'crm_select', 'select', '*');
  if v_msg is distinct from 'EXISTS_OK' then
    v_problems := v_problems || coalesce(v_msg, 'warehouses.crm_select missing');
  end if;
  v_msg := pg_temp.wh_policy_ok('warehouses', 'crm_insert', 'insert', 'settings.warehouses');
  if v_msg is distinct from 'EXISTS_OK' then
    v_problems := v_problems || coalesce(v_msg, 'warehouses.crm_insert missing');
  end if;
  v_msg := pg_temp.wh_policy_ok('warehouses', 'crm_update', 'update', 'settings.warehouses');
  if v_msg is distinct from 'EXISTS_OK' then
    v_problems := v_problems || coalesce(v_msg, 'warehouses.crm_update missing');
  end if;
  v_msg := pg_temp.wh_policy_ok('warehouses', 'crm_delete', 'delete', 'settings.warehouses');
  if v_msg is distinct from 'EXISTS_OK' then
    v_problems := v_problems || coalesce(v_msg, 'warehouses.crm_delete missing');
  end if;

  if not has_table_privilege('authenticated', 'public.warehouses', 'select')
     or not has_table_privilege('authenticated', 'public.warehouses', 'insert')
     or not has_table_privilege('authenticated', 'public.warehouses', 'update')
     or not has_table_privilege('authenticated', 'public.warehouses', 'delete') then
    v_problems := v_problems || 'authenticated lacks full CRUD grants on public.warehouses';
  end if;

  v_msg := pg_temp.wh_one_default_idx('warehouses', 'warehouses_one_default_idx');
  if v_msg is not null then
    v_problems := v_problems || v_msg;
  end if;

  foreach v_stock in array array['warehouse_stock','stock_batches','stock_serials'] loop
    if has_table_privilege('authenticated', format('public.%I', v_stock), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_stock), 'update')
       or has_table_privilege('authenticated', format('public.%I', v_stock), 'delete')
       or has_table_privilege('authenticated', format('public.%I', v_stock), 'truncate') then
      v_problems := v_problems || format('authenticated retains write/truncate on public.%s', v_stock);
    end if;
    if not has_table_privilege('authenticated', format('public.%I', v_stock), 'select') then
      v_problems := v_problems || format('authenticated lacks SELECT on public.%s', v_stock);
    end if;
  end loop;

  if exists (
    select 1 from wh_created c
    where coalesce(obj_description(format('public.%I', c.table_name)::regclass, 'pg_class'), '') <> 'crm_ro_v1'
  ) then
    v_problems := v_problems || 'a table created in this run is missing comment crm_ro_v1';
  end if;

  if cardinality(v_problems) > 0 then
    raise exception E'Warehouse bootstrap post-check failed; rolling back:\n%',
      array_to_string(v_problems, E'\n');
  end if;
end
$post$;

commit;
