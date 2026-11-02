-- =====================================================================
-- Core App — READ-ONLY warehouse bootstrap VERIFY (strict readiness gate)
--
-- Run AFTER APPLY (authorized MAIN only). Does NOT mutate schema or data.
-- No INSERT/UPDATE/DELETE/DDL/GRANT/REVOKE/COMMENT/index creation.
--
-- Success criteria:
--   1) failed_checks query returns 0 rows
--   2) readiness query returns readiness = 'READY' with failed_checks = 0
-- Soft-deleted workspace filter is a separate security row (not part of READY).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Failed mandatory checks (expected: 0 rows)
-- ---------------------------------------------------------------------
with expected(check_id, section, ok, detail) as (
  select 't_warehouses', 'tables', to_regclass('public.warehouses') is not null, 'public.warehouses'
  union all select 't_bin_locations', 'tables', to_regclass('public.bin_locations') is not null, 'public.bin_locations'
  union all select 't_warehouse_stock', 'tables', to_regclass('public.warehouse_stock') is not null, 'public.warehouse_stock'
  union all select 't_stock_batches', 'tables', to_regclass('public.stock_batches') is not null, 'public.stock_batches'
  union all select 't_stock_serials', 'tables', to_regclass('public.stock_serials') is not null, 'public.stock_serials'
  union all select 't_goods_receipts', 'tables', to_regclass('public.goods_receipts') is not null, 'public.goods_receipts'
  union all select 't_goods_receipt_lines', 'tables', to_regclass('public.goods_receipt_lines') is not null, 'public.goods_receipt_lines'
  union all select 't_stock_transfers', 'tables', to_regclass('public.stock_transfers') is not null, 'public.stock_transfers'
  union all select 't_stock_transfer_lines', 'tables', to_regclass('public.stock_transfer_lines') is not null, 'public.stock_transfer_lines'
  union all select 't_write_offs', 'tables', to_regclass('public.write_offs') is not null, 'public.write_offs'
  union all select 't_write_off_lines', 'tables', to_regclass('public.write_off_lines') is not null, 'public.write_off_lines'

  union all select 'w_id', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='id' and udt_name='uuid' and is_nullable='NO'),
    'warehouses.id uuid NOT NULL'
  union all select 'w_workspace_id', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='workspace_id' and udt_name='uuid' and is_nullable='NO'),
    'warehouses.workspace_id'
  union all select 'w_location_id', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='location_id' and udt_name='uuid' and is_nullable='YES'),
    'warehouses.location_id'
  union all select 'w_name', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='name' and udt_name='text' and is_nullable='NO'),
    'warehouses.name'
  union all select 'w_type', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='warehouse_type' and udt_name='text' and is_nullable='NO'),
    'warehouses.warehouse_type'
  union all select 'w_is_default', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='is_default' and udt_name='bool' and is_nullable='NO'),
    'warehouses.is_default'
  union all select 'w_is_active', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='is_active' and udt_name='bool' and is_nullable='NO'),
    'warehouses.is_active'
  union all select 'w_created_at', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='created_at' and udt_name='timestamptz' and is_nullable='NO'),
    'warehouses.created_at'
  union all select 'w_updated_at', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='updated_at' and udt_name='timestamptz' and is_nullable='NO'),
    'warehouses.updated_at'
  union all select 'w_deleted_at', 'warehouses_shape',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='deleted_at' and udt_name='timestamptz' and is_nullable='YES'),
    'warehouses.deleted_at'

  union all select 'fk_w_workspace', 'foreign_keys',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      join pg_attribute ra on ra.attrelid=c.confrelid and ra.attnum=c.confkey[1]
      where n.nspname='public' and rel.relname='warehouses' and c.contype='f' and c.convalidated
        and a.attname='workspace_id' and rn.nspname='public' and ref.relname='workspaces' and ra.attname='id'
        and cardinality(c.conkey)=1
    ), 'warehouses.workspace_id → public.workspaces(id)'
  union all select 'fk_w_location', 'foreign_keys',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      join pg_attribute ra on ra.attrelid=c.confrelid and ra.attnum=c.confkey[1]
      where n.nspname='public' and rel.relname='warehouses' and c.contype='f' and c.convalidated
        and a.attname='location_id' and rn.nspname='public' and ref.relname='locations' and ra.attname='id'
    ), 'warehouses.location_id → public.locations(id)'
  union all select 'fk_stock_wh', 'foreign_keys',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      where n.nspname='public' and rel.relname='warehouse_stock' and c.contype='f' and c.convalidated
        and a.attname='warehouse_id' and rn.nspname='public' and ref.relname='warehouses'
    ), 'warehouse_stock.warehouse_id → public.warehouses'
  union all select 'fk_stock_item', 'foreign_keys',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      where n.nspname='public' and rel.relname='warehouse_stock' and c.contype='f' and c.convalidated
        and a.attname='inventory_item_id' and rn.nspname='public' and ref.relname='inventory_items'
    ), 'warehouse_stock.inventory_item_id → public.inventory_items'
  union all select 'fk_mov_wh', 'foreign_keys',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      where n.nspname='public' and rel.relname='inventory_movements' and c.contype='f' and c.convalidated
        and a.attname='warehouse_id' and rn.nspname='public' and ref.relname='warehouses'
    ), 'inventory_movements.warehouse_id → public.warehouses'
  union all select 'fk_mov_batch', 'foreign_keys',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      where n.nspname='public' and rel.relname='inventory_movements' and c.contype='f' and c.convalidated
        and a.attname='batch_id' and rn.nspname='public' and ref.relname='stock_batches'
    ), 'inventory_movements.batch_id → public.stock_batches'
  union all select 'fk_om_wh', 'foreign_keys',
    exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
      where n.nspname='public' and rel.relname='order_materials' and c.contype='f' and c.convalidated
        and a.attname='warehouse_id' and rn.nspname='public' and ref.relname='warehouses'
    ), 'order_materials.warehouse_id → public.warehouses'

  union all select 'idx_one_default', 'indexes',
    exists (
      select 1 from pg_index i
      join pg_class ic on ic.oid=i.indexrelid
      join pg_namespace n on n.oid=ic.relnamespace
      join pg_class tbl on tbl.oid=i.indrelid
      where n.nspname='public' and ic.relname='warehouses_one_default_idx' and tbl.relname='warehouses'
        and i.indisunique and i.indisvalid and i.indislive
        and pg_get_expr(i.indpred, i.indrelid) is not null
        and position('is_default' in lower(pg_get_expr(i.indpred, i.indrelid))) > 0
        and position('deleted_at' in lower(pg_get_expr(i.indpred, i.indrelid))) > 0
        and position('is null' in lower(pg_get_expr(i.indpred, i.indrelid))) > 0
        and (
          select array_agg(att.attname::text order by ord.ordinality)
          from unnest(i.indkey) with ordinality as ord(attnum, ordinality)
          join pg_attribute att on att.attrelid=i.indrelid and att.attnum=ord.attnum
        ) = array['workspace_id']::text[]
    ),
    'warehouses_one_default_idx UNIQUE (workspace_id) WHERE is_default AND deleted_at IS NULL'

  union all select 'fn_permitted', 'helpers',
    to_regprocedure('public.crm_permitted_workspaces(text)') is not null, 'crm_permitted_workspaces(text)'
  union all select 'fn_has_perm', 'helpers',
    to_regprocedure('public.crm_has_permission(uuid, text)') is not null, 'crm_has_permission(uuid, text)'
  union all select 'fn_permitted_secdef', 'helpers',
    coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.crm_permitted_workspaces(text)')), false),
    'crm_permitted_workspaces SECURITY DEFINER'
  union all select 'fn_has_perm_secdef', 'helpers',
    coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.crm_has_permission(uuid, text)')), false),
    'crm_has_permission SECURITY DEFINER'
  union all select 'fn_permitted_exec', 'helpers',
    coalesce(has_function_privilege('authenticated', 'public.crm_permitted_workspaces(text)', 'execute'), false),
    'authenticated EXECUTE crm_permitted_workspaces'
  union all select 'fn_has_perm_exec', 'helpers',
    coalesce(has_function_privilege('authenticated', 'public.crm_has_permission(uuid, text)', 'execute'), false),
    'authenticated EXECUTE crm_has_permission'

  union all select 'w_rls', 'rls',
    exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='warehouses' and c.relrowsecurity),
    'warehouses RLS enabled'
  union all select 'w_pol_select', 'rls',
    exists (
      select 1 from pg_policies p
      where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_select'
        and upper(p.cmd)='SELECT'
        and position('crm_permitted_workspaces' in lower(coalesce(p.qual,''))) > 0
        and (p.with_check is null or btrim(p.with_check)='')
    ), 'warehouses.crm_select'
  union all select 'w_pol_insert', 'rls',
    exists (
      select 1 from pg_policies p
      where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_insert'
        and upper(p.cmd)='INSERT'
        and position('settings.warehouses' in lower(coalesce(p.with_check,''))) > 0
        and (p.qual is null or btrim(p.qual)='')
    ), 'warehouses.crm_insert'
  union all select 'w_pol_update', 'rls',
    exists (
      select 1 from pg_policies p
      where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_update'
        and upper(p.cmd)='UPDATE'
        and position('settings.warehouses' in lower(coalesce(p.qual,''))) > 0
        and position('settings.warehouses' in lower(coalesce(p.with_check,''))) > 0
    ), 'warehouses.crm_update'
  union all select 'w_pol_delete', 'rls',
    exists (
      select 1 from pg_policies p
      where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_delete'
        and upper(p.cmd)='DELETE'
        and position('settings.warehouses' in lower(coalesce(p.qual,''))) > 0
    ), 'warehouses.crm_delete'

  union all select 'w_grant_select', 'grants', coalesce(has_table_privilege('authenticated','public.warehouses','select'), false), 'warehouses SELECT'
  union all select 'w_grant_insert', 'grants', coalesce(has_table_privilege('authenticated','public.warehouses','insert'), false), 'warehouses INSERT'
  union all select 'w_grant_update', 'grants', coalesce(has_table_privilege('authenticated','public.warehouses','update'), false), 'warehouses UPDATE'
  union all select 'w_grant_delete', 'grants', coalesce(has_table_privilege('authenticated','public.warehouses','delete'), false), 'warehouses DELETE'

  union all select 'stock_select', 'stock_protection', coalesce(has_table_privilege('authenticated','public.warehouse_stock','select'), false), 'warehouse_stock SELECT'
  union all select 'stock_no_ins', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.warehouse_stock','insert'), true), 'warehouse_stock no INSERT'
  union all select 'stock_no_upd', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.warehouse_stock','update'), true), 'warehouse_stock no UPDATE'
  union all select 'stock_no_del', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.warehouse_stock','delete'), true), 'warehouse_stock no DELETE'
  union all select 'batches_select', 'stock_protection', coalesce(has_table_privilege('authenticated','public.stock_batches','select'), false), 'stock_batches SELECT'
  union all select 'batches_no_ins', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.stock_batches','insert'), true), 'stock_batches no INSERT'
  union all select 'batches_no_upd', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.stock_batches','update'), true), 'stock_batches no UPDATE'
  union all select 'batches_no_del', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.stock_batches','delete'), true), 'stock_batches no DELETE'
  union all select 'serials_select', 'stock_protection', coalesce(has_table_privilege('authenticated','public.stock_serials','select'), false), 'stock_serials SELECT'
  union all select 'serials_no_ins', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.stock_serials','insert'), true), 'stock_serials no INSERT'
  union all select 'serials_no_upd', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.stock_serials','update'), true), 'stock_serials no UPDATE'
  union all select 'serials_no_del', 'stock_protection', not coalesce(has_table_privilege('authenticated','public.stock_serials','delete'), true), 'stock_serials no DELETE'
  union all select 'stock_no_write_policies', 'stock_protection',
    not exists (
      select 1 from pg_policies p
      where p.schemaname='public'
        and p.tablename in ('warehouse_stock','stock_batches','stock_serials')
        and upper(p.cmd) in ('INSERT','UPDATE','DELETE','ALL')
    ), 'no write policies on stock tables'
)
select check_id, section, detail, ok as passed
from expected
where not coalesce(ok, false)
order by section, check_id;

-- ---------------------------------------------------------------------
-- 2) Soft-delete security (informational; apply 2.1a if false)
-- ---------------------------------------------------------------------
select
  case
    when to_regprocedure('public.crm_permitted_workspaces(text)') is null then false
    else position('w.deleted_at is null' in pg_get_functiondef('public.crm_permitted_workspaces(text)'::regprocedure)) > 0
  end as ok_filters_deleted_workspaces,
  'If false: apply 20261101010000_crm_permitted_workspaces_deleted_at.PRODUCTION.sql'::text as remediation;

-- ---------------------------------------------------------------------
-- 3) READY / NOT READY (exact inventory size = 57)
-- ---------------------------------------------------------------------
with expected(check_id, ok) as (
  select 't_warehouses', to_regclass('public.warehouses') is not null
  union all select 't_bin_locations', to_regclass('public.bin_locations') is not null
  union all select 't_warehouse_stock', to_regclass('public.warehouse_stock') is not null
  union all select 't_stock_batches', to_regclass('public.stock_batches') is not null
  union all select 't_stock_serials', to_regclass('public.stock_serials') is not null
  union all select 't_goods_receipts', to_regclass('public.goods_receipts') is not null
  union all select 't_goods_receipt_lines', to_regclass('public.goods_receipt_lines') is not null
  union all select 't_stock_transfers', to_regclass('public.stock_transfers') is not null
  union all select 't_stock_transfer_lines', to_regclass('public.stock_transfer_lines') is not null
  union all select 't_write_offs', to_regclass('public.write_offs') is not null
  union all select 't_write_off_lines', to_regclass('public.write_off_lines') is not null
  union all select 'w_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='id' and udt_name='uuid' and is_nullable='NO')
  union all select 'w_workspace_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='workspace_id' and udt_name='uuid' and is_nullable='NO')
  union all select 'w_location_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='location_id' and udt_name='uuid' and is_nullable='YES')
  union all select 'w_name', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='name' and udt_name='text' and is_nullable='NO')
  union all select 'w_type', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='warehouse_type' and udt_name='text' and is_nullable='NO')
  union all select 'w_is_default', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='is_default' and udt_name='bool' and is_nullable='NO')
  union all select 'w_is_active', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='is_active' and udt_name='bool' and is_nullable='NO')
  union all select 'w_created_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='created_at' and udt_name='timestamptz' and is_nullable='NO')
  union all select 'w_updated_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='updated_at' and udt_name='timestamptz' and is_nullable='NO')
  union all select 'w_deleted_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='warehouses' and column_name='deleted_at' and udt_name='timestamptz' and is_nullable='YES')
  union all select 'fk_w_workspace', exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
    join pg_attribute ra on ra.attrelid=c.confrelid and ra.attnum=c.confkey[1]
    where n.nspname='public' and rel.relname='warehouses' and c.contype='f' and c.convalidated
      and a.attname='workspace_id' and rn.nspname='public' and ref.relname='workspaces' and ra.attname='id'
  )
  union all select 'fk_w_location', exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
    join pg_attribute ra on ra.attrelid=c.confrelid and ra.attnum=c.confkey[1]
    where n.nspname='public' and rel.relname='warehouses' and c.contype='f' and c.convalidated
      and a.attname='location_id' and rn.nspname='public' and ref.relname='locations' and ra.attname='id'
  )
  union all select 'fk_stock_wh', exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
    where n.nspname='public' and rel.relname='warehouse_stock' and c.contype='f' and c.convalidated
      and a.attname='warehouse_id' and rn.nspname='public' and ref.relname='warehouses'
  )
  union all select 'fk_stock_item', exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
    where n.nspname='public' and rel.relname='warehouse_stock' and c.contype='f' and c.convalidated
      and a.attname='inventory_item_id' and rn.nspname='public' and ref.relname='inventory_items'
  )
  union all select 'fk_mov_wh', exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
    where n.nspname='public' and rel.relname='inventory_movements' and c.contype='f' and c.convalidated
      and a.attname='warehouse_id' and rn.nspname='public' and ref.relname='warehouses'
  )
  union all select 'fk_mov_batch', exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
    where n.nspname='public' and rel.relname='inventory_movements' and c.contype='f' and c.convalidated
      and a.attname='batch_id' and rn.nspname='public' and ref.relname='stock_batches'
  )
  union all select 'fk_om_wh', exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_class ref on ref.oid=c.confrelid join pg_namespace rn on rn.oid=ref.relnamespace
    where n.nspname='public' and rel.relname='order_materials' and c.contype='f' and c.convalidated
      and a.attname='warehouse_id' and rn.nspname='public' and ref.relname='warehouses'
  )
  union all select 'idx_one_default', exists (
    select 1 from pg_index i
    join pg_class ic on ic.oid=i.indexrelid
    join pg_namespace n on n.oid=ic.relnamespace
    join pg_class tbl on tbl.oid=i.indrelid
    where n.nspname='public' and ic.relname='warehouses_one_default_idx' and tbl.relname='warehouses'
      and i.indisunique and i.indisvalid and i.indislive
      and pg_get_expr(i.indpred, i.indrelid) is not null
      and position('is_default' in lower(pg_get_expr(i.indpred, i.indrelid))) > 0
      and position('deleted_at' in lower(pg_get_expr(i.indpred, i.indrelid))) > 0
      and position('is null' in lower(pg_get_expr(i.indpred, i.indrelid))) > 0
      and (
        select array_agg(att.attname::text order by ord.ordinality)
        from unnest(i.indkey) with ordinality as ord(attnum, ordinality)
        join pg_attribute att on att.attrelid=i.indrelid and att.attnum=ord.attnum
      ) = array['workspace_id']::text[]
  )
  union all select 'fn_permitted', to_regprocedure('public.crm_permitted_workspaces(text)') is not null
  union all select 'fn_has_perm', to_regprocedure('public.crm_has_permission(uuid, text)') is not null
  union all select 'fn_permitted_secdef', coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.crm_permitted_workspaces(text)')), false)
  union all select 'fn_has_perm_secdef', coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.crm_has_permission(uuid, text)')), false)
  union all select 'fn_permitted_exec', coalesce(has_function_privilege('authenticated', 'public.crm_permitted_workspaces(text)', 'execute'), false)
  union all select 'fn_has_perm_exec', coalesce(has_function_privilege('authenticated', 'public.crm_has_permission(uuid, text)', 'execute'), false)
  union all select 'w_rls', exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='warehouses' and c.relrowsecurity)
  union all select 'w_pol_select', exists (
    select 1 from pg_policies p where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_select'
      and upper(p.cmd)='SELECT' and position('crm_permitted_workspaces' in lower(coalesce(p.qual,''))) > 0
      and (p.with_check is null or btrim(p.with_check)='')
  )
  union all select 'w_pol_insert', exists (
    select 1 from pg_policies p where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_insert'
      and upper(p.cmd)='INSERT' and position('settings.warehouses' in lower(coalesce(p.with_check,''))) > 0
      and (p.qual is null or btrim(p.qual)='')
  )
  union all select 'w_pol_update', exists (
    select 1 from pg_policies p where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_update'
      and upper(p.cmd)='UPDATE'
      and position('settings.warehouses' in lower(coalesce(p.qual,''))) > 0
      and position('settings.warehouses' in lower(coalesce(p.with_check,''))) > 0
  )
  union all select 'w_pol_delete', exists (
    select 1 from pg_policies p where p.schemaname='public' and p.tablename='warehouses' and p.policyname='crm_delete'
      and upper(p.cmd)='DELETE' and position('settings.warehouses' in lower(coalesce(p.qual,''))) > 0
  )
  union all select 'w_grant_select', coalesce(has_table_privilege('authenticated','public.warehouses','select'), false)
  union all select 'w_grant_insert', coalesce(has_table_privilege('authenticated','public.warehouses','insert'), false)
  union all select 'w_grant_update', coalesce(has_table_privilege('authenticated','public.warehouses','update'), false)
  union all select 'w_grant_delete', coalesce(has_table_privilege('authenticated','public.warehouses','delete'), false)
  union all select 'stock_select', coalesce(has_table_privilege('authenticated','public.warehouse_stock','select'), false)
  union all select 'stock_no_ins', not coalesce(has_table_privilege('authenticated','public.warehouse_stock','insert'), true)
  union all select 'stock_no_upd', not coalesce(has_table_privilege('authenticated','public.warehouse_stock','update'), true)
  union all select 'stock_no_del', not coalesce(has_table_privilege('authenticated','public.warehouse_stock','delete'), true)
  union all select 'batches_select', coalesce(has_table_privilege('authenticated','public.stock_batches','select'), false)
  union all select 'batches_no_ins', not coalesce(has_table_privilege('authenticated','public.stock_batches','insert'), true)
  union all select 'batches_no_upd', not coalesce(has_table_privilege('authenticated','public.stock_batches','update'), true)
  union all select 'batches_no_del', not coalesce(has_table_privilege('authenticated','public.stock_batches','delete'), true)
  union all select 'serials_select', coalesce(has_table_privilege('authenticated','public.stock_serials','select'), false)
  union all select 'serials_no_ins', not coalesce(has_table_privilege('authenticated','public.stock_serials','insert'), true)
  union all select 'serials_no_upd', not coalesce(has_table_privilege('authenticated','public.stock_serials','update'), true)
  union all select 'serials_no_del', not coalesce(has_table_privilege('authenticated','public.stock_serials','delete'), true)
  union all select 'stock_no_write_policies', not exists (
    select 1 from pg_policies p
    where p.schemaname='public' and p.tablename in ('warehouse_stock','stock_batches','stock_serials')
      and upper(p.cmd) in ('INSERT','UPDATE','DELETE','ALL')
  )
),
counted as (
  select
    count(*)::int as total_checks,
    count(*) filter (where coalesce(ok, false))::int as passed_checks,
    count(*) filter (where not coalesce(ok, false))::int as failed_checks
  from expected
)
select
  total_checks,
  passed_checks,
  failed_checks,
  case
    when total_checks = 57 and failed_checks = 0 and passed_checks = 57 then 'READY'
    else 'NOT READY'
  end as readiness
from counted;
