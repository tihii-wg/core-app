-- =============================================================================
-- Order line / client RPCs: honour «owner can manage closed orders»
-- Script: 20261112180000_line_rpcs_owner_closed_orders.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- The order-card RPCs added on 2026-11-11/12 refuse every closed order, while the UI (and the existing
-- table triggers order_services_closed_guard / order_materials_closed_guard) allow the workspace owner to
-- edit closed orders when workspaces.owner_can_manage_closed_orders is on. Result: the owner's edits on a
-- closed order were rolled back with «closed_order_immutable».
--
-- This script patches the closed-order check in each function IN PLACE (pg_get_functiondef + one textual
-- replacement), so the function bodies stay exactly as reviewed. The condition
--     (v_order.closed_at is not null or v_order.status = 'closed')
-- becomes
--     (v_order.closed_at is not null or v_order.status = 'closed')
--       and not coalesce(public.crm_owner_may_manage_closed_orders(v_order.workspace_id), false)
-- Cancelled orders stay refused as before. Grants are kept (CREATE OR REPLACE).
-- Idempotent: an already patched function is skipped.
-- =============================================================================

begin;

do $patch$
declare
  v_names text[] := array[
    'crm_add_order_service_line',
    'crm_update_order_service_line',
    'crm_delete_order_service_line',
    'crm_add_and_issue_order_catalog_material',
    'crm_change_order_material_quantity',
    'crm_delete_order_material',
    'crm_update_order_material_line',
    'crm_change_order_client'
  ];
  v_old text := '(v_order.closed_at is not null or v_order.status = ''closed'')';
  v_new text := '(v_order.closed_at is not null or v_order.status = ''closed'')'
    || E'\n     and not coalesce(public.crm_owner_may_manage_closed_orders(v_order.workspace_id), false)';
  r record;
  v_def text;
  v_patched int := 0;
  v_skipped int := 0;
begin
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    raise exception 'line_rpcs_owner_closed_orders preflight: crm_owner_may_manage_closed_orders(uuid) missing';
  end if;

  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_names)
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('crm_owner_may_manage_closed_orders' in v_def) > 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if position(v_old in v_def) = 0 then
      raise exception 'line_rpcs_owner_closed_orders: closed-order check not found in %', r.proname;
    end if;
    execute replace(v_def, v_old, v_new);
    v_patched := v_patched + 1;
  end loop;

  raise notice 'line_rpcs_owner_closed_orders: patched %, already patched %', v_patched, v_skipped;
  if v_patched + v_skipped = 0 then
    raise exception 'line_rpcs_owner_closed_orders: none of the target functions exist';
  end if;
end;
$patch$;

notify pgrst, 'reload schema';

commit;
