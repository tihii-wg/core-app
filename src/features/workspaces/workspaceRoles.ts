import i18n from "../../i18n";

// Mirrors public.workspace_member_can_manage in supabase/migrations/20260929000000_production_baseline.sql.
export const workspaceRoles = ["owner", "admin", "manager", "member"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

const workspaceRoleLabelKeys = {
  owner: "team.roles.owner",
  admin: "team.roles.admin",
  manager: "team.roles.manager",
  member: "team.roles.member",
} as const satisfies Record<WorkspaceRole, string>;

export function workspaceRoleLabel(role: string) {
  const key = workspaceRoleLabelKeys[role as WorkspaceRole];
  return key ? i18n.t(key) : role;
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
