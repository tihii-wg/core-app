-- Hardening: active members can read their workspace, not only its owner.
--
-- Depends only on 20260929000000_production_baseline.sql (public.workspaces,
-- public.is_workspace_member(uuid), which already excludes removed members and deleted workspaces).
--
-- Additive: "Owners can view active workspace" stays (signup and workspace creation read the new
-- row back before any membership exists). INSERT and UPDATE stay owner-only, deletion stays
-- with public.soft_delete_workspace(), and no grant, function or trigger changes.

create policy "Members can view active workspaces"
  on public.workspaces
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(id));
