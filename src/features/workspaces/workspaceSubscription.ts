/** Known `public.workspaces.subscription_status` values. */
export const workspaceSubscriptionStatuses = ["trial", "active", "expired", "suspended", "cancelled"] as const;
export type WorkspaceSubscriptionStatus = (typeof workspaceSubscriptionStatuses)[number];

export type WorkspaceSubscriptionFields = {
  subscriptionStatus: WorkspaceSubscriptionStatus | null;
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  subscriptionUpdatedAt: string | null;
};

export function normalizeSubscriptionStatus(value: unknown): WorkspaceSubscriptionStatus | null {
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return (workspaceSubscriptionStatuses as readonly string[]).includes(status)
    ? (status as WorkspaceSubscriptionStatus)
    : null;
}

export function parseSubscriptionTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Client-side write entitlement for a workspace subscription.
 * Not a security boundary — RLS / server policies remain authoritative.
 *
 * Rules:
 * - `active`: write only if expiry is null or in the future
 * - `trial`: write only if expiry is present and in the future
 * - `expired` | `suspended` | `cancelled` | missing | unknown: deny
 * - Past expiry always denies, regardless of status
 */
export function hasSubscriptionWriteEntitlement(
  state: Pick<WorkspaceSubscriptionFields, "subscriptionStatus" | "subscriptionExpiresAt"> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!state) return false;

  const status = state.subscriptionStatus;
  const expiresAt = parseSubscriptionTimestamp(state.subscriptionExpiresAt);

  if (expiresAt && expiresAt.getTime() <= now.getTime()) return false;

  if (status === "active") return true;
  if (status === "trial") return expiresAt != null;
  return false;
}

/** Role permission AND subscription write entitlement (subscription never elevates role). */
export function withSubscriptionWriteAccess(roleAllows: boolean, hasWriteEntitlement: boolean) {
  return roleAllows && hasWriteEntitlement;
}

export function subscriptionStatusBadgeVariant(
  status: WorkspaceSubscriptionStatus | null,
  canWrite: boolean,
): "success" | "warning" | "danger" | "muted" | "info" {
  if (!canWrite) {
    if (status === "trial") return "warning";
    if (status === "suspended" || status === "cancelled" || status === "expired") return "danger";
    return status ? "danger" : "muted";
  }
  if (status === "active") return "success";
  if (status === "trial") return "info";
  return "muted";
}
