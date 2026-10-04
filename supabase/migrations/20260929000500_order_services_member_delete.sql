-- Members who can edit an order can remove a service line from it.
--
-- Depends only on 20260929000000_production_baseline.sql (public.order_services, public.orders and
-- public.is_workspace_member(uuid): an EXISTS over an active membership in an active workspace,
-- never NULL).
--
-- Mirrors the edit rule already enforced on public.orders ("Members can update workspace orders"
-- and "Members can delete workspace orders", both is_workspace_member(workspace_id)) and the
-- existing SELECT/INSERT policies on public.order_services. Additive: SELECT and INSERT are
-- unchanged, UPDATE stays revoked, and public.services is not affected (order_services.service_id
-- has no cascade). No function, trigger or foreign key changes.

create policy "Members can delete order services"
  on public.order_services
  as permissive
  for delete
  to authenticated
  using ((exists ( select 1
   from public.orders o
  where ((o.id = order_services.order_id) and public.is_workspace_member(o.workspace_id)))));

grant delete on table public.order_services to authenticated;
