import i18n from "../i18n";
import supabase from "./supabase";

export const CLOSED_ORDER_PERMISSIONS = {
  cancelClosed: "orders.cancel_closed",
  deleteClosed: "orders.delete_closed",
} as const;

export type ClosedOrderPermission =
  (typeof CLOSED_ORDER_PERMISSIONS)[keyof typeof CLOSED_ORDER_PERMISSIONS];

export const CLOSED_ORDER_GRANTABLE_ROLES = ["admin", "manager", "member"] as const;
export type ClosedOrderGrantableRole = (typeof CLOSED_ORDER_GRANTABLE_ROLES)[number];

export type ClosedOrderPermissionGrants = {
  cancelClosed: ReadonlyArray<ClosedOrderGrantableRole>;
  deleteClosed: ReadonlyArray<ClosedOrderGrantableRole>;
};

const EMPTY_GRANTS: ClosedOrderPermissionGrants = { cancelClosed: [], deleteClosed: [] };

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function isMissingRelationError(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

/**
 * Owner always has both permissions. Others only when their workspace role is granted.
 */
export function roleHasClosedOrderPermission(
  workspaceRole: string | null | undefined,
  permission: ClosedOrderPermission,
  grants: ClosedOrderPermissionGrants | null | undefined,
): boolean {
  if (workspaceRole === "owner") return true;
  if (!grants) return false;
  if (workspaceRole !== "admin" && workspaceRole !== "manager" && workspaceRole !== "member") return false;
  const list = permission === CLOSED_ORDER_PERMISSIONS.cancelClosed ? grants.cancelClosed : grants.deleteClosed;
  return list.includes(workspaceRole);
}

export async function getClosedOrderPermissionGrants(
  workspaceId: string | undefined,
): Promise<ClosedOrderPermissionGrants> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("workspace_role_permission_grants")
    .select("permission, workspace_role")
    .eq("workspace_id", targetWorkspaceId);

  if (error) {
    if (isMissingRelationError(error)) return { ...EMPTY_GRANTS };
    throw new Error(error.message);
  }

  const cancelClosed: ClosedOrderGrantableRole[] = [];
  const deleteClosed: ClosedOrderGrantableRole[] = [];
  for (const row of data ?? []) {
    const role = String(row.workspace_role ?? "") as ClosedOrderGrantableRole;
    if (!CLOSED_ORDER_GRANTABLE_ROLES.includes(role)) continue;
    if (row.permission === CLOSED_ORDER_PERMISSIONS.cancelClosed) cancelClosed.push(role);
    if (row.permission === CLOSED_ORDER_PERMISSIONS.deleteClosed) deleteClosed.push(role);
  }
  return { cancelClosed, deleteClosed };
}

/**
 * Replace grants for both permissions atomically from the owner's perspective.
 * Owner-only via RLS; never stores owner (owner is always allowed in SQL).
 */
export async function saveClosedOrderPermissionGrants(
  workspaceId: string | undefined,
  grants: ClosedOrderPermissionGrants,
): Promise<ClosedOrderPermissionGrants> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);

  const { error: deleteError } = await supabase
    .from("workspace_role_permission_grants")
    .delete()
    .eq("workspace_id", targetWorkspaceId)
    .in("permission", [CLOSED_ORDER_PERMISSIONS.cancelClosed, CLOSED_ORDER_PERMISSIONS.deleteClosed]);

  if (deleteError) {
    if (isMissingRelationError(deleteError)) throw new Error(i18n.t("settings.closedOrderPermissions.errors.schemaRequired"));
    throw new Error(deleteError.message);
  }

  const rows: { workspace_id: string; permission: string; workspace_role: string }[] = [];
  for (const role of grants.cancelClosed) {
    if (CLOSED_ORDER_GRANTABLE_ROLES.includes(role)) {
      rows.push({
        workspace_id: targetWorkspaceId,
        permission: CLOSED_ORDER_PERMISSIONS.cancelClosed,
        workspace_role: role,
      });
    }
  }
  for (const role of grants.deleteClosed) {
    if (CLOSED_ORDER_GRANTABLE_ROLES.includes(role)) {
      rows.push({
        workspace_id: targetWorkspaceId,
        permission: CLOSED_ORDER_PERMISSIONS.deleteClosed,
        workspace_role: role,
      });
    }
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("workspace_role_permission_grants").insert(rows);
    if (insertError) throw new Error(insertError.message);
  }

  return getClosedOrderPermissionGrants(targetWorkspaceId);
}

export function emptyClosedOrderGrants(): ClosedOrderPermissionGrants {
  return { ...EMPTY_GRANTS };
}
