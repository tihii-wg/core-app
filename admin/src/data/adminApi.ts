import { getSupabase } from "@/lib/supabase";
import {
  subscriptionStatuses,
  type AdminWorkspace,
  type AdminWorkspaceDetail,
  type AdminWorkspaceMember,
  type AuditEntry,
  type SubscriptionSnapshot,
  type SubscriptionStatus,
} from "./types";

/** Error with an i18n key so pages can show a translated message. */
export class AdminApiError extends Error {
  readonly messageKey: string;

  constructor(messageKey: string, message?: string) {
    super(message ?? messageKey);
    this.name = "AdminApiError";
    this.messageKey = messageKey;
  }
}

type Row = Record<string, unknown>;

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new AdminApiError("errors.notConfigured");
  return supabase;
}

function mapError(error: { code?: string; message?: string }): AdminApiError {
  if (error.code === "42501") return new AdminApiError("errors.forbidden", error.message);
  if (error.code === "PGRST202" || error.code === "42883") return new AdminApiError("errors.backendMissing", error.message);
  if (error.code === "P0002") return new AdminApiError("errors.notFound", error.message);
  if (error.code === "22023") return new AdminApiError("errors.validation", error.message);
  return new AdminApiError("errors.generic", error.message);
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function normalizeStatus(value: unknown): SubscriptionStatus | null {
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return (subscriptionStatuses as readonly string[]).includes(status) ? (status as SubscriptionStatus) : null;
}

function mapWorkspace(row: Row): AdminWorkspace {
  return {
    id: String(row.id),
    name: str(row.name) ?? "—",
    createdAt: str(row.created_at),
    deletedAt: str(row.deleted_at),
    language: str(row.language),
    currency: str(row.currency),
    ownerId: str(row.owner_id),
    ownerName: str(row.owner_name),
    ownerEmail: str(row.owner_email),
    ownerLastSignInAt: str(row.owner_last_sign_in_at),
    subscriptionStatus: normalizeStatus(row.subscription_status),
    subscriptionStartedAt: str(row.subscription_started_at),
    subscriptionExpiresAt: str(row.subscription_expires_at),
    subscriptionUpdatedAt: str(row.subscription_updated_at),
    memberCount: num(row.member_count),
    employeeCount: num(row.employee_count),
    orderCount: num(row.order_count),
    ordersLast30d: num(row.orders_last_30d),
    lastOrderAt: str(row.last_order_at),
  };
}

export async function checkPlatformOwner(): Promise<boolean> {
  const { data, error } = await client().rpc("admin_is_platform_owner");
  if (error) throw mapError(error);
  return data === true;
}

export async function listWorkspaces(): Promise<AdminWorkspace[]> {
  const { data, error } = await client().rpc("admin_list_workspaces");
  if (error) throw mapError(error);
  return ((data ?? []) as Row[]).map(mapWorkspace);
}

export async function getWorkspace(workspaceId: string): Promise<AdminWorkspaceDetail> {
  const { data, error } = await client().rpc("admin_get_workspace", { p_workspace_id: workspaceId });
  if (error) throw mapError(error);
  const row = (data ?? {}) as Row;
  const members = (Array.isArray(row.members) ? row.members : []) as Row[];
  const stats = (row.stats ?? {}) as Row;
  return {
    ...mapWorkspace(row),
    members: members.map<AdminWorkspaceMember>((m) => ({
      userId: String(m.user_id),
      name: str(m.name),
      email: str(m.email),
      role: str(m.role) ?? "member",
      joinedAt: str(m.joined_at),
      lastSignInAt: str(m.last_sign_in_at),
    })),
    stats: { clients: num(stats.clients), estimates: num(stats.estimates) },
  };
}

export type SetSubscriptionInput = {
  workspaceId: string;
  status: SubscriptionStatus;
  expiresAt: string | null;
  reason?: string;
};

export async function setSubscription(input: SetSubscriptionInput): Promise<void> {
  const { error } = await client().rpc("admin_set_subscription", {
    p_workspace_id: input.workspaceId,
    p_status: input.status,
    p_expires_at: input.expiresAt,
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw mapError(error);
}

export async function listAudit(workspaceId?: string, limit = 200): Promise<AuditEntry[]> {
  const { data, error } = await client().rpc("admin_list_audit", {
    p_workspace_id: workspaceId ?? null,
    p_limit: limit,
  });
  if (error) throw mapError(error);
  return ((data ?? []) as Row[]).map((row) => ({
    id: num(row.id),
    createdAt: String(row.created_at),
    actorEmail: str(row.actor_email),
    action: str(row.action) ?? "",
    workspaceId: str(row.workspace_id),
    workspaceName: str(row.workspace_name),
    before: (row.before ?? null) as SubscriptionSnapshot | null,
    after: (row.after ?? null) as SubscriptionSnapshot | null,
    reason: str(row.reason),
  }));
}
