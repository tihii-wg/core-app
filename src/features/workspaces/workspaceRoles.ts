// Mirrors public.workspace_member_can_manage in supabase/migrations/20260929000000_production_baseline.sql.
export const workspaceRoles = ["owner", "admin", "manager", "member"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

export function workspaceRoleLabel(role: string) {
  return workspaceRoleLabels[role as WorkspaceRole] ?? role;
}

export function assignableWorkspaceRoles(actorRole: string | null | undefined): WorkspaceRole[] {
  if (actorRole === "owner") return ["admin", "manager", "member"];
  if (actorRole === "admin") return ["manager", "member"];
  return [];
}

export function canManageWorkspaceMember(actorRole: string | null | undefined, targetRole: string) {
  return (assignableWorkspaceRoles(actorRole) as string[]).includes(targetRole);
}

// UI visibility only; the services RLS policies are authoritative.
export function canManageServices(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}

// Workspace updates and deletion are owner-only in the database.
export function canManageWorkspace(role: string | null | undefined) {
  return role === "owner";
}
