-- =====================================================================
-- VERIFY (read-only) — inventory item delete live-stock cleanup package.
-- Expect every check_ok = true. Does not modify schema or data.
-- =====================================================================

select
  check_name,
  check_ok,
  detail
from (
  -- 1. Function exists
  select
    'fn_exists'::text as check_name,
    to_regprocedure('public.inventory_items_clear_denied_stock_children()') is not null as check_ok,
    'public.inventory_items_clear_denied_stock_children()'::text as detail

  -- 2. SECURITY DEFINER
  union all
  select
    'fn_security_definer',
    coalesce((
      select p.prosecdef from pg_proc p
      where p.oid = to_regprocedure('public.inventory_items_clear_denied_stock_children()')
    ), false),
    'prosecdef=true'

  -- 3. Empty search_path
  union all
  select
    'fn_search_path_empty',
    coalesce((
      select p.proconfig = array['search_path='] from pg_proc p
      where p.oid = to_regprocedure('public.inventory_items_clear_denied_stock_children()')
    ), false),
    'proconfig = {search_path=}'

  -- 4–5. Owner matches all three stock tables and has DELETE
  union all
  select
    'fn_owner_matches_all_stock_tables',
    case
      when to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then false
      else (
        select
          count(distinct rel.relowner) = 1
          and bool_and(p.proowner = rel.relowner)
        from pg_proc p
        cross join pg_class rel
        join pg_namespace n on n.oid = rel.relnamespace
        where p.oid = to_regprocedure('public.inventory_items_clear_denied_stock_children()')
          and n.nspname = 'public' and rel.relkind = 'r'
          and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
      )
    end,
    'function.proowner = common owner of warehouse_stock/stock_batches/stock_serials'

  union all
  select
    'fn_owner_has_delete_on_stock_tables',
    case
      when to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then false
      else (
        select bool_and(has_table_privilege(p.proowner, format('public.%I', rel.relname), 'delete'))
        from pg_proc p
        cross join pg_class rel
        join pg_namespace n on n.oid = rel.relnamespace
        where p.oid = to_regprocedure('public.inventory_items_clear_denied_stock_children()')
          and n.nspname = 'public' and rel.relkind = 'r'
          and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
      )
    end,
    'function owner DELETE on all three stock tables'

  -- 6. RLS / FORCE RLS safety
  union all
  select
    'stock_rls_enabled',
    (
      select bool_and(rel.relrowsecurity)
      from pg_class rel
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public' and rel.relkind = 'r'
        and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
    ),
    'relrowsecurity=true on stock tables'

  union all
  select
    'stock_force_rls_safe',
    (
      select bool_and(
        not rel.relforcerowsecurity
        or coalesce(r.rolbypassrls, false)
      )
      from pg_class rel
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_roles r on r.oid = rel.relowner
      where n.nspname = 'public' and rel.relkind = 'r'
        and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
    ),
    'FORCE RLS off, or table owner has BYPASSRLS'

  union all
  select
    'stock_no_delete_policies_for_authenticated_path',
    not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename in ('warehouse_stock', 'stock_batches', 'stock_serials')
        and upper(p.cmd) in ('DELETE', 'ALL')
    ),
    'no DELETE/ALL policies on protected stock tables (writes via DEFINER only)'

  -- 7–8. Trigger
  union all
  select
    'trigger_exists_before_delete_row',
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public'
        and c.relname = 'inventory_items'
        and t.tgname = 'inventory_items_clear_denied_stock_children'
        and not t.tgisinternal
        and p.proname = 'inventory_items_clear_denied_stock_children'
        and pg_get_triggerdef(t.oid) ilike '%before delete%'
        and pg_get_triggerdef(t.oid) ilike '%for each row%'
    ),
    'BEFORE DELETE FOR EACH ROW → inventory_items_clear_denied_stock_children'

  -- 9. Columns
  union all
  select
    'child_columns_uuid',
    (
      select count(*) = 6
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('warehouse_stock', 'stock_batches', 'stock_serials')
        and column_name in ('inventory_item_id', 'workspace_id')
        and udt_name = 'uuid'
    ),
    'each stock table has inventory_item_id uuid + workspace_id uuid'

  -- 10. FK relationships / delete actions
  union all
  select
    'fk_stock_to_inventory_cascade',
    (
      select count(*) = 3
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_class ref on ref.oid = c.confrelid
      join pg_namespace rn on rn.oid = ref.relnamespace
      where c.contype = 'f' and c.convalidated
        and n.nspname = 'public'
        and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
        and a.attname = 'inventory_item_id'
        and rn.nspname = 'public' and ref.relname = 'inventory_items'
        and c.confdeltype = 'c'
    ),
    '3× inventory_item_id ON DELETE CASCADE → inventory_items'

  union all
  select
    'fk_no_inter_stock_deps',
    not exists (
      select 1
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_class ref on ref.oid = c.confrelid
      join pg_namespace rn on rn.oid = ref.relnamespace
      where c.contype = 'f'
        and n.nspname = 'public' and rn.nspname = 'public'
        and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
        and ref.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
    ),
    'no FKs among stock tables (delete order independent)'

  union all
  select
    'fn_delete_order_serials_batches_stock',
    case
      when to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then false
      else (
        with d as (
          select pg_get_functiondef('public.inventory_items_clear_denied_stock_children()'::regprocedure) as body
        )
        select
          position('delete from public.stock_serials' in body)
            < position('delete from public.stock_batches' in body)
          and position('delete from public.stock_batches' in body)
            < position('delete from public.warehouse_stock' in body)
          and position('workspace_id = old.workspace_id' in body) > 0
          and position('inventory_item_id = old.id' in body) > 0
        from d
      )
    end,
    'body deletes serials → batches → warehouse_stock, scoped by id+workspace'

  -- 11–12. authenticated still no DELETE; no new broad grants
  union all
  select
    'authenticated_no_stock_delete',
    not coalesce(has_table_privilege('authenticated', 'public.warehouse_stock', 'delete'), true)
    and not coalesce(has_table_privilege('authenticated', 'public.stock_batches', 'delete'), true)
    and not coalesce(has_table_privilege('authenticated', 'public.stock_serials', 'delete'), true),
    'authenticated DELETE remains revoked on protected stock tables'

  union all
  select
    'fn_execute_not_public_or_anon',
    case
      when to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then false
      else
        not has_function_privilege('anon', 'public.inventory_items_clear_denied_stock_children()', 'execute')
        and has_function_privilege('authenticated', 'public.inventory_items_clear_denied_stock_children()', 'execute')
    end,
    'EXECUTE for authenticated; not anon'

  -- 13. History FKs preserved
  union all
  select
    'inventory_movements_still_restrict',
    exists (
      select 1
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_class ref on ref.oid = c.confrelid
      join pg_namespace rn on rn.oid = ref.relnamespace
      where c.contype = 'f' and c.convalidated
        and n.nspname = 'public' and rel.relname = 'inventory_movements'
        and a.attname = 'inventory_item_id'
        and rn.nspname = 'public' and ref.relname = 'inventory_items'
        and c.confdeltype = 'r'
    ),
    'inventory_movements.inventory_item_id ON DELETE RESTRICT'

  union all
  select
    'order_materials_still_no_action',
    exists (
      select 1
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_class ref on ref.oid = c.confrelid
      join pg_namespace rn on rn.oid = ref.relnamespace
      where c.contype = 'f' and c.convalidated
        and n.nspname = 'public' and rel.relname = 'order_materials'
        and a.attname = 'inventory_item_id'
        and rn.nspname = 'public' and ref.relname = 'inventory_items'
        and c.confdeltype in ('a', 'r')
    ),
    'order_materials.inventory_item_id ON DELETE NO ACTION/RESTRICT'

  union all
  select
    'fn_does_not_delete_history_tables',
    case
      when to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then false
      else (
        with d as (
          select pg_get_functiondef('public.inventory_items_clear_denied_stock_children()'::regprocedure) as body
        )
        select
          position('inventory_movements' in body) = 0
          and position('order_materials' in body) = 0
          and position('payments' in body) = 0
          and position('finance_transactions' in body) = 0
        from d
      )
    end,
    'function body never names movements/order_materials/finance tables'

  -- Membership gate (not owner-only)
  union all
  select
    'fn_uses_is_workspace_member_not_owner_only',
    case
      when to_regprocedure('public.inventory_items_clear_denied_stock_children()') is null then false
      else (
        with d as (
          select pg_get_functiondef('public.inventory_items_clear_denied_stock_children()'::regprocedure) as body
        )
        select
          position('is_workspace_member' in body) > 0
          and position('workspace_member_is_owner' in body) = 0
          and position('workspace_members' in body) = 0
        from d
      )
    end,
    'auth via is_workspace_member(old.workspace_id); not owner-only'

  -- 14. Unrelated inventory_items triggers remain
  union all
  select
    'unrelated_trigger_prevent_workspace_change',
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'inventory_items'
        and t.tgname = 'inventory_items_prevent_workspace_change' and not t.tgisinternal
    ),
    'inventory_items_prevent_workspace_change still present'

  union all
  select
    'unrelated_trigger_updated_at',
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'inventory_items'
        and t.tgname = 'inventory_items_updated_at' and not t.tgisinternal
    ),
    'inventory_items_updated_at still present'

  union all
  select
    'is_workspace_member_intact',
    to_regprocedure('public.is_workspace_member(uuid)') is not null
    and coalesce((
      select p.prosecdef from pg_proc p
      where p.oid = to_regprocedure('public.is_workspace_member(uuid)')
    ), false),
    'public.is_workspace_member(uuid) still SECURITY DEFINER'

  -- Diagnostic only for the reported Sans owner (does not gate the package)
  union all
  select
    'diag_sans_owner_membership',
    exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.workspace_id = 'cdbf8d72-28d7-4b94-8b76-738108d4bed1'::uuid
        and wm.user_id = 'f7133b93-3d6c-4cc0-9544-250daf4f36c6'::uuid
        and wm.role::text = 'owner'
        and wm.deleted_at is null
        and w.deleted_at is null
    ),
    'Sans owner membership present (diagnostic)'
) s
order by check_name;
