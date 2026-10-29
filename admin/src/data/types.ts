/** Subscription statuses recognized by the Core App client model. */
export const subscriptionStatuses = ["trial", "active", "expired", "suspended", "cancelled"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

/**
 * Plan labels used only for clearly labeled DEMO fixtures.
 * Repo migrations do not define a plans table or plan_id column.
 */
export const demoPlanLabels = ["trial", "starter", "professional", "enterprise"] as const;
export type DemoPlanLabel = (typeof demoPlanLabels)[number];

export type AdminWorkspaceRow = {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  planLabel: DemoPlanLabel | "unknown";
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  employeeCount: number | null;
  orderCount: number | null;
  /** Access status derived from subscription for display; not a separate schema field. */
  accessLabel: "writable" | "read-only" | "unknown";
};

export type DataSourceMode = "demo" | "unavailable";

export type AdminCapabilities = {
  /** Cross-tenant workspace list via anon client + existing RLS */
  listAllWorkspaces: boolean;
  /** Aggregate employee/order counts without fetching private rows */
  aggregateCounts: boolean;
  /** Trusted platform-owner authorization on the backend */
  platformOwnerAuthz: boolean;
  changePlan: boolean;
  changeExpiration: boolean;
  suspendWorkspace: boolean;
  reactivateWorkspace: boolean;
  auditLog: boolean;
};
