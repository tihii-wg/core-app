-- =============================================================================
-- Closed orders are immutable for everyone (owner included) until cancelled
-- Script: 20261108120000_closed_orders_immutable.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: 20261105180000_owner_manage_closed_orders_complete,
--                20261105210000_cancelled_order_owner_warranty_edit,
--                20261105220000_reopen_cancelled_order
-- =============================================================================
-- Problem: with workspaces.owner_can_manage_closed_orders the owner could edit a
-- CLOSED order (prices, lines, status). Example: ORD-2026-001 was closed at
-- 18 000 fully paid, then its service price was changed to 25 000 — the order
-- stayed closed and underpaid.
--
-- New rule: nobody can change a closed order. To change it, cancel it first
-- (cancelled orders stay editable by the workspace owner, as before:
-- crm_owner_may_edit_cancelled_order), or cancel and reopen it.
--
-- How:
--   1) crm_owner_may_manage_closed_orders v2 -> always false. Every content guard
--      (orders_closed_content_guard, order_services_closed_guard,
--      order_materials_closed_guard, order_lifecycle_guard rule 2,
--      set_order_lifecycle_regular_custom_status, crm_assert_closed_order_mutable,
--      crm_owner_may_unlink_order_warranty) uses it as the owner bypass, so the
--      bypass is gone in all of them at once.
--   2) crm_has_closed_order_permission v3 keeps the owner's right to CANCEL /
--      DELETE closed orders: it now checks owner_id + owner_can_manage_closed_orders
--      directly (same logic as manage v1), plus the existing role grants.
--      So owner_can_manage_closed_orders now means only "owner may cancel/delete
--      closed orders".
--   Untouched: payments on closed orders (separate table), cancel tokens, close,
--   reopen of cancelled orders, comments/attachments, warranties.
--   Cleanup: drops the auto-reopen trigger/functions from the withdrawn draft
--   20261108120000_closed_order_underpaid_reopen if it was applied.
-- No data changes. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders missing; ';
  end if;
  if to_regprocedure('public.crm_has_closed_order_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_closed_order_permission missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_edit_cancelled_order(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_edit_cancelled_order missing (apply 20261105210000 first); ';
  end if;
  if to_regprocedure('public.reopen_cancelled_order(uuid,uuid,text,uuid)') is null then
    v_problems := v_problems || 'reopen_cancelled_order missing (apply 20261105220000 first); ';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'workspaces'
                   and column_name = 'owner_can_manage_closed_orders') then
    v_problems := v_problems || 'workspaces.owner_can_manage_closed_orders missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'closed_orders_immutable preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- 0) Cleanup of the withdrawn auto-reopen draft (no-op when it was never applied)
drop trigger if exists crm_orders_reopen_underpaid_au on public.orders;
drop function if exists public.crm_orders_reopen_underpaid();

-- 2) Cancel / delete closed orders: owner right no longer goes through "manage closed"
create or replace function public.crm_has_closed_order_permission(
  p_workspace_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select
    (
      p_permission in ('orders.cancel_closed', 'orders.delete_closed')
      and coalesce((
        select w.owner_can_manage_closed_orders
          and w.owner_id is not null
          and w.owner_id = auth.uid()
          and w.deleted_at is null
        from public.workspaces w
        where w.id = p_workspace_id
      ), false)
    )
    or (
      p_permission in ('orders.cancel_closed', 'orders.delete_closed')
      and exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        join public.workspace_role_permission_grants g
          on g.workspace_id = wm.workspace_id
         and g.permission = p_permission
         and g.workspace_role = wm.role
        where wm.workspace_id = p_workspace_id
          and wm.user_id = auth.uid()
          and wm.deleted_at is null
          and w.deleted_at is null
          and wm.role in ('admin', 'manager', 'member')
      )
    );
$fn$;

revoke all on function public.crm_has_closed_order_permission(uuid, text) from public, anon;
grant execute on function public.crm_has_closed_order_permission(uuid, text) to authenticated, service_role;

comment on function public.crm_has_closed_order_permission(uuid, text) is
  'managed-object: core-app/crm_has_closed_order_permission@v3 — cancel_closed / delete_closed only: owner_id + owner_can_manage_closed_orders, else admin/manager/member role grants. Not an edit permission.';

-- 1) Closed order contents: no owner bypass anymore
create or replace function public.crm_owner_may_manage_closed_orders(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select false;
$fn$;

revoke all on function public.crm_owner_may_manage_closed_orders(uuid) from public, anon;
grant execute on function public.crm_owner_may_manage_closed_orders(uuid) to authenticated, service_role;

comment on function public.crm_owner_may_manage_closed_orders(uuid) is
  'managed-object: core-app/crm_owner_may_manage_closed_orders@v2 — always false: closed orders are immutable for everyone until cancelled. Cancel/delete rights: crm_has_closed_order_permission.';

do $postflight$
declare
  v_def text;
begin
  select pg_get_functiondef('public.crm_owner_may_manage_closed_orders(uuid)'::regprocedure) into v_def;
  if position('select false' in v_def) = 0 then
    raise exception 'closed_orders_immutable postflight: manage-closed bypass still active';
  end if;
  select pg_get_functiondef('public.crm_has_closed_order_permission(uuid,text)'::regprocedure) into v_def;
  if position('crm_owner_may_manage_closed_orders' in v_def) > 0
     or position('owner_can_manage_closed_orders' in v_def) = 0 then
    raise exception 'closed_orders_immutable postflight: crm_has_closed_order_permission v3 not installed';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'crm_orders_reopen_underpaid_au') then
    raise exception 'closed_orders_immutable postflight: auto-reopen trigger still present';
  end if;
end;
$postflight$;

commit;
