/** Subscription statuses recognized by Core App (`workspaces.subscription_status`). */
export const subscriptionStatuses = ["trial", "active", "expired", "suspended", "cancelled"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export type AccessLabel = "writable" | "read-only";

export type AdminWorkspace = {
  id: string;
  name: string;
  createdAt: string | null;
  deletedAt: string | null;
  language: string | null;
  currency: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerLastSignInAt: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  subscriptionUpdatedAt: string | null;
  memberCount: number;
  employeeCount: number;
  orderCount: number;
  ordersLast30d: number;
  lastOrderAt: string | null;
};

export type AdminWorkspaceMember = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  joinedAt: string | null;
  lastSignInAt: string | null;
};

export type AdminWorkspaceDetail = AdminWorkspace & {
  members: AdminWorkspaceMember[];
  stats: { clients: number; estimates: number };
};

export type SubscriptionSnapshot = {
  subscription_status?: string | null;
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
};

export type AuditEntry = {
  id: number;
  createdAt: string;
  actorEmail: string | null;
  action: string;
  workspaceId: string | null;
  workspaceName: string | null;
  before: SubscriptionSnapshot | null;
  after: SubscriptionSnapshot | null;
  reason: string | null;
};
