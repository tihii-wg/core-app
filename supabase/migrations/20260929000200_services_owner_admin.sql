-- Hardening: only owners and admins can update or delete services (creating one already requires it).
--
-- Depends only on 20260929000000_production_baseline.sql (public.services and
-- public.workspace_member_is_admin(uuid): an EXISTS over an active owner/admin membership in an
-- active workspace, never NULL).
--
-- Replaces the two member-wide policies. SELECT ("Members can view workspace services") and
-- INSERT ("Owners and admins can create services") are unchanged; no grant, function, trigger or
-- foreign key changes. The drops have no IF EXISTS on purpose: if the policy names ever drift, the
-- migration must fail rather than leave a member-wide policy in place.

drop policy "Members can update workspace services" on public.services;
drop policy "Members can delete workspace services" on public.services;

create policy "Owners and admins can update services"
  on public.services
  as permissive
  for update
  to authenticated
  using (public.workspace_member_is_admin(workspace_id))
  with check (public.workspace_member_is_admin(workspace_id));

create policy "Owners and admins can delete services"
  on public.services
  as permissive
  for delete
  to authenticated
  using (public.workspace_member_is_admin(workspace_id));
