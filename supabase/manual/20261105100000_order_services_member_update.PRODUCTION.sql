-- =============================================================================
-- Core App MAIN — grant UPDATE on public.order_services to authenticated
-- Script: 20261105100000_order_services_member_update.PRODUCTION.sql
-- Target: MAIN only (pundggjzzaqzbvykbxvo). Manual apply. Do not run against TEST.
-- =============================================================================
--
-- Root cause
-- ----------
-- Baseline (20260929000000) granted only SELECT + INSERT on order_services to
-- authenticated. 20260929000500 added DELETE for workspace members and
-- intentionally left UPDATE revoked.
--
-- The app's syncOrderServices path (apiOrders.ts) now UPDATEs existing lines to
-- persist warranty_months / warranty_days / warranty_km (and kind). That UPDATE
-- fails with:
--   permission denied for table order_services  (SQLSTATE 42501)
-- Role: authenticated (PostgREST via the publishable key + user JWT).
--
-- This script is additive:
--   • GRANT UPDATE to authenticated (keeps SELECT / INSERT / DELETE)
--   • RLS UPDATE policy scoped to active members of the parent order's workspace
--   • No grants to anon / public
--   • No changes to order_materials, warranty tables, or order lifecycle RPCs
--
-- Idempotent: safe to re-run.
-- =============================================================================

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.order_services') is null then
    v_problems := v_problems || 'order_services missing; ';
  end if;
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'Preflight failed: %', v_problems;
  end if;
end;
$preflight$;

alter table public.order_services enable row level security;

-- Mirror SELECT / INSERT / DELETE: membership via the parent order's workspace_id.
drop policy if exists "Members can update order services" on public.order_services;
create policy "Members can update order services"
  on public.order_services
  as permissive
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_services.order_id
        and public.is_workspace_member(o.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.orders o
      where o.id = order_services.order_id
        and public.is_workspace_member(o.workspace_id)
    )
  );

-- Table privilege: authenticated may UPDATE; anon/public stay without access.
grant update on table public.order_services to authenticated;

revoke all on table public.order_services from public, anon;
grant select, insert, update, delete on table public.order_services to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.order_services to service_role;

comment on policy "Members can update order services" on public.order_services is
  'managed-object: core-app/order_services_member_update@v1 — workspace members may UPDATE lines of orders in their active workspace (warranty / kind / line edits).';

-- ---------------------------------------------------------------------------
-- Optional verification (read-only; comment out if undesired in the runner):
-- ---------------------------------------------------------------------------
-- select
--   has_table_privilege('authenticated', 'public.order_services', 'select') as sel,
--   has_table_privilege('authenticated', 'public.order_services', 'insert') as ins,
--   has_table_privilege('authenticated', 'public.order_services', 'update') as upd,
--   has_table_privilege('authenticated', 'public.order_services', 'delete') as del,
--   has_table_privilege('anon', 'public.order_services', 'update') as anon_upd;
-- select polname, cmd, roles
-- from pg_policies
-- where schemaname = 'public' and tablename = 'order_services'
-- order by polname;
