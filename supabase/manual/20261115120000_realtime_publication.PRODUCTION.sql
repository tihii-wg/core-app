-- =============================================================================
-- Supabase Realtime publication (postgres_changes) — phase 1 workspace tables
-- Script: 20261115120000_realtime_publication.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- Depends on: publication supabase_realtime; public tables listed below
-- =============================================================================
-- Idempotently ADD TABLE into supabase_realtime for Core App multi-device sync.
-- Client subscribes with filter workspace_id=eq.<activeWorkspace> (one channel/tab).
--
-- Included (all have workspace_id + SELECT RLS scoped to the member's workspaces):
--   orders, order_employees, payments, clients, inventory_items, warehouse_stock,
--   invoices, expenses, order_comments, order_attachments
--
-- Skipped (no workspace_id column — do NOT subscribe unfiltered):
--   order_services, order_materials — line edits that bump orders.updated_at are
--   covered by the orders listener; otherwise focus/reconnect/poll fallbacks apply.
--
-- Never add tables with secrets (Google/Drive credentials, backup tokens, etc.).
--
-- DELETE filter note: default REPLICA IDENTITY (DEFAULT) does not put workspace_id
-- on the old row for DELETE, so workspace_id=eq filter may miss deletes. We do not
-- set REPLICA IDENTITY FULL on large tables here; client fallbacks
-- (refetchOnFocus/reconnect, 60s poll while unsubscribed, visibility invalidate)
-- catch missed deletes. INSERT/UPDATE still match the filter.
-- Idempotent. Single DO block.
-- =============================================================================

do $realtime_publication$
declare
  v_table text;
  v_tables text[] := array[
    'orders',
    'order_employees',
    'payments',
    'clients',
    'inventory_items',
    'warehouse_stock',
    'invoices',
    'expenses',
    'order_comments',
    'order_attachments'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'realtime_publication preflight: publication supabase_realtime missing';
  end if;

  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'realtime_publication preflight: public.% missing', v_table;
    end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = v_table
         and column_name = 'workspace_id'
    ) then
      raise exception 'realtime_publication preflight: public.% has no workspace_id', v_table;
    end if;

    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;

  foreach v_table in array v_tables loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      raise exception 'realtime_publication postflight: % not in supabase_realtime', v_table;
    end if;
  end loop;
end;
$realtime_publication$;
