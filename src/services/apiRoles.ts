import i18n from "../i18n";
import { resolvePermissions } from "../features/roles/permissions";
import { getWorkspaceMembers } from "./apiWorkspaces";
import { isMissingTableError } from "./missingTable";
import supabase from "./supabase";

export type RoleRecord = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  permissionCount: number;
};

const roleColumns = "id, workspace_id, name, description";

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

function isMissingRolesTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /roles/i.test(error.message ?? "");
}

export async function getRoles(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("roles")
    .select(roleColumns)
    .eq("workspace_id", resolved)
    .order("name", { ascending: true });

  if (error) {
    if (isMissingRolesTable(error)) return [] as RoleRecord[];
    throw new Error(error.message);
  }

  const roles = (data ?? []) as { id: string; workspace_id: string; name: string; description: string | null }[];
  if (roles.length === 0) return [];

  const { data: permissions, error: permissionsError } = await supabase
    .from("role_permissions")
    .select("role_id")
    .eq("workspace_id", resolved)
    .in(
      "role_id",
      roles.map((role) => role.id),
    );

  if (permissionsError && !isMissingRolesTable(permissionsError)) {
    throw new Error(permissionsError.message);
  }

  const counts = new Map<string, number>();
  for (const row of (permissions ?? []) as { role_id: string }[]) {
    counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1);
  }

  return roles.map((role) => ({
    id: role.id,
    workspaceId: role.workspace_id,
    name: role.name,
    description: role.description,
    permissionCount: counts.get(role.id) ?? 0,
  }));
}

export type MemberRoleRecord = {
  userId: string;
  workspaceRole: string;
  fullName: string | null;
  email: string | null;
  isCurrentUser: boolean;
  /** member_roles.role_id; null when no permission role is assigned. */
  roleId: string | null;
  roleName: string | null;
};

/**
 * Active workspace members joined with their assigned permission role (member_roles + roles).
 * Names/emails come from the existing team members list (workspace_member_profiles RPC).
 * Returns [] when the RO tables are not installed.
 */
export async function getMemberRoles(workspaceId: string | undefined): Promise<MemberRoleRecord[]> {
  const resolved = requireWorkspaceId(workspaceId);
  const [members, assignments, roles] = await Promise.all([
    getWorkspaceMembers(resolved),
    supabase.from("member_roles").select("user_id, role_id").eq("workspace_id", resolved),
    supabase.from("roles").select("id, name").eq("workspace_id", resolved),
  ]);

  for (const [table, result] of [["member_roles", assignments], ["roles", roles]] as const) {
    if (!result.error) continue;
    if (isMissingTableError(result.error, table)) return [];
    throw new Error(result.error.message);
  }

  const roleNames = new Map(((roles.data ?? []) as { id: string; name: string }[]).map((role) => [role.id, role.name]));
  const roleByUser = new Map(((assignments.data ?? []) as { user_id: string; role_id: string }[]).map((row) => [row.user_id, row.role_id]));

  return members.map((member) => {
    const roleId = roleByUser.get(member.userId) ?? null;
    return {
      userId: member.userId,
      workspaceRole: member.role,
      fullName: member.fullName,
      email: member.email,
      isCurrentUser: member.isCurrentUser,
      roleId,
      roleName: roleId ? (roleNames.get(roleId) ?? null) : null,
    };
  });
}

export async function assignMemberRole(workspaceId: string | undefined, userId: string, roleId: string) {
  const resolved = requireWorkspaceId(workspaceId);
  const { error } = await supabase
    .from("member_roles")
    .upsert({ workspace_id: resolved, user_id: userId, role_id: roleId }, { onConflict: "workspace_id,user_id" });
  if (error) throw new Error(error.message);
}

export async function clearMemberRole(workspaceId: string | undefined, userId: string) {
  const resolved = requireWorkspaceId(workspaceId);
  const { error } = await supabase.from("member_roles").delete().eq("workspace_id", resolved).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Permission keys of the current user in the workspace (mirrors public.crm_permitted_workspaces):
 * owner → ['*'], admin without member role → ['*'], otherwise the assigned role's permissions.
 * Returns null (legacy mode) when the RO tables are missing or the user has no active membership row.
 */
export async function getMyPermissions(workspaceId: string | undefined): Promise<string[] | null> {
  const resolved = requireWorkspaceId(workspaceId);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) return null;

  const [member, assignment] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", resolved)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("member_roles").select("role_id").eq("workspace_id", resolved).eq("user_id", user.id).maybeSingle(),
  ]);

  if (assignment.error) {
    if (isMissingTableError(assignment.error, "member_roles")) return null;
    throw new Error(assignment.error.message);
  }
  if (member.error) throw new Error(member.error.message);
  if (!member.data) return null;

  const roleId = (assignment.data as { role_id: string } | null)?.role_id ?? null;
  const workspaceRole = (member.data as { role: string | null }).role;
  let rolePermissions: string[] = [];

  if (roleId && workspaceRole !== "owner") {
    const { data, error } = await supabase.from("role_permissions").select("permission").eq("workspace_id", resolved).eq("role_id", roleId);
    if (error) {
      if (isMissingTableError(error, "role_permissions")) return null;
      throw new Error(error.message);
    }
    rolePermissions = ((data ?? []) as { permission: string }[]).map((row) => row.permission);
  }

  return resolvePermissions({ workspaceRole, memberRoleId: roleId, rolePermissions });
}
