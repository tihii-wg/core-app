/** Wildcard granted to owners (and admins without an assigned member role), mirrors public.crm_permitted_workspaces. */
export const ALL_PERMISSIONS = "*";

export const PERMISSION_KEYS = {
  settingsRoles: "settings.roles",
  settingsStatuses: "settings.statuses",
  settingsForms: "settings.forms",
  reportsActivityLog: "reports.activity_log",
} as const;

/** Warehouse operation kind → permission keys (post RPCs accept create OR edit). */
export const WAREHOUSE_OP_PERMISSIONS = {
  receipt: { create: "inventory.receipts.create", edit: "inventory.receipts.edit" },
  transfer: { create: "inventory.transfers.create", edit: "inventory.transfers.edit" },
  writeOff: { create: "inventory.write_offs.create", edit: "inventory.write_offs.edit" },
  supplierReturn: { create: "inventory.supplier_returns.create", edit: "inventory.supplier_returns.edit" },
} as const;

/**
 * Resolves a permission key against the loaded permission list.
 * `perms` is `null`/`undefined` when permissions are not loaded or the RO tables are absent (legacy mode):
 * then `legacyFallback` (an existing canManageWorkspace / canWrite style check) decides.
 */
export function hasPermission(perms: readonly string[] | null | undefined, key: string, legacyFallback = true) {
  if (!perms) return legacyFallback;
  return perms.includes(ALL_PERMISSIONS) || perms.includes(key);
}

type ResolveInput = {
  /** workspace_members.role of the current user. */
  workspaceRole: string | null | undefined;
  /** member_roles.role_id for the current user, if any. */
  memberRoleId: string | null | undefined;
  /** role_permissions.permission for `memberRoleId`. */
  rolePermissions: readonly string[];
};

/**
 * Mirrors public.crm_permitted_workspaces: owner → everything; admin without member role → everything;
 * otherwise only the permissions of the assigned role.
 */
export function resolvePermissions({ workspaceRole, memberRoleId, rolePermissions }: ResolveInput): string[] {
  if (workspaceRole === "owner") return [ALL_PERMISSIONS];
  if (!memberRoleId) return workspaceRole === "admin" ? [ALL_PERMISSIONS] : [];
  return [...new Set(rolePermissions)];
}
