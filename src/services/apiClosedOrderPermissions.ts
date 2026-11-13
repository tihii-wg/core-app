import i18n from "../i18n";
import supabase from "./supabase";

export const CLOSED_ORDER_PERMISSIONS = {
  cancelClosed: "orders.cancel_closed",
  deleteClosed: "orders.delete_closed",
  closedFullAccess: "orders.closed_full_access",
} as const;

export type ClosedOrderPermission =
  (typeof CLOSED_ORDER_PERMISSIONS)[keyof typeof CLOSED_ORDER_PERMISSIONS];

export const CLOSED_ORDER_GRANTABLE_ROLES = ["admin", "manager", "member"] as const;
export type ClosedOrderGrantableRole = (typeof CLOSED_ORDER_GRANTABLE_ROLES)[number];

export type ClosedOrderPermissionGrants = {
  cancelClosed: ReadonlyArray<ClosedOrderGrantableRole>;
  deleteClosed: ReadonlyArray<ClosedOrderGrantableRole>;
  closedFullAccess: ReadonlyArray<ClosedOrderGrantableRole>;
};

const EMPTY_GRANTS: ClosedOrderPermissionGrants = {
  cancelClosed: [],
  deleteClosed: [],
  closedFullAccess: [],
};

const ALL_PERMISSION_KEYS = [
  CLOSED_ORDER_PERMISSIONS.cancelClosed,
  CLOSED_ORDER_PERMISSIONS.deleteClosed,
  CLOSED_ORDER_PERMISSIONS.closedFullAccess,
] as const;

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function isMissingRelationError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  // Constraint / unknown permission key before SQL applied.
  if (error.code === "23514") return true;
  return /closed_full_access|permission_check|does not exist|schema cache/i.test(error.message ?? "");
}

/**
 * Role grants for admin/manager/member only.
 * Workspace owner cancel/delete of closed orders uses owner_can_manage_closed_orders
 * (see ownerMayManageClosedOrders / crm_owner_may_manage_closed_orders) — not membership role.
 */
export function roleHasClosedOrderPermission(
  workspaceRole: string | null | undefined,
  permission: ClosedOrderPermission,
  grants: ClosedOrderPermissionGrants | null | undefined,
): boolean {
  if (!grants) return false;
  if (workspaceRole !== "admin" && workspaceRole !== "manager" && workspaceRole !== "member") return false;
  if (permission === CLOSED_ORDER_PERMISSIONS.closedFullAccess) {
    return grants.closedFullAccess.includes(workspaceRole);
  }
  // Full access implies cancel + delete.
  if (grants.closedFullAccess.includes(workspaceRole)) return true;
  const list =
    permission === CLOSED_ORDER_PERMISSIONS.cancelClosed ? grants.cancelClosed : grants.deleteClosed;
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
  const closedFullAccess: ClosedOrderGrantableRole[] = [];
  for (const row of data ?? []) {
    const role = String(row.workspace_role ?? "") as ClosedOrderGrantableRole;
    if (!CLOSED_ORDER_GRANTABLE_ROLES.includes(role)) continue;
    if (row.permission === CLOSED_ORDER_PERMISSIONS.cancelClosed) cancelClosed.push(role);
    if (row.permission === CLOSED_ORDER_PERMISSIONS.deleteClosed) deleteClosed.push(role);
    if (row.permission === CLOSED_ORDER_PERMISSIONS.closedFullAccess) closedFullAccess.push(role);
  }
  return { cancelClosed, deleteClosed, closedFullAccess };
}

/**
 * Replace grants for all closed-order permissions atomically from the owner's perspective.
 * Owner-only via RLS; never stores owner (owner is always allowed in SQL via owner_id).
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
    .in("permission", [...ALL_PERMISSION_KEYS]);

  if (deleteError) {
    if (isMissingRelationError(deleteError)) {
      throw new Error(i18n.t("settings.closedOrderPermissions.errors.fullAccessSchemaRequired"));
    }
    throw new Error(deleteError.message);
  }

  const rows: { workspace_id: string; permission: string; workspace_role: string }[] = [];
  for (const role of grants.closedFullAccess) {
    if (CLOSED_ORDER_GRANTABLE_ROLES.includes(role)) {
      rows.push({
        workspace_id: targetWorkspaceId,
        permission: CLOSED_ORDER_PERMISSIONS.closedFullAccess,
        workspace_role: role,
      });
    }
  }
  for (const role of grants.cancelClosed) {
    if (CLOSED_ORDER_GRANTABLE_ROLES.includes(role) && !grants.closedFullAccess.includes(role)) {
      rows.push({
        workspace_id: targetWorkspaceId,
        permission: CLOSED_ORDER_PERMISSIONS.cancelClosed,
        workspace_role: role,
      });
    }
  }
  for (const role of grants.deleteClosed) {
    if (CLOSED_ORDER_GRANTABLE_ROLES.includes(role) && !grants.closedFullAccess.includes(role)) {
      rows.push({
        workspace_id: targetWorkspaceId,
        permission: CLOSED_ORDER_PERMISSIONS.deleteClosed,
        workspace_role: role,
      });
    }
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("workspace_role_permission_grants").insert(rows);
    if (insertError) {
      if (isMissingRelationError(insertError)) {
        throw new Error(i18n.t("settings.closedOrderPermissions.errors.fullAccessSchemaRequired"));
      }
      throw new Error(insertError.message);
    }
  }

  return getClosedOrderPermissionGrants(targetWorkspaceId);
}

export function emptyClosedOrderGrants(): ClosedOrderPermissionGrants {
  return { cancelClosed: [], deleteClosed: [], closedFullAccess: [] };
}
