/**
 * Verified findings from repository inspection only (migrations, manual SQL,
 * Core App client/services). No remote database probing was performed.
 *
 * Do not flip capability flags or treat these as live-DB facts beyond what
 * the tracked schema and application code prove.
 */

export type FindingStatus = "present" | "partial" | "missing" | "frontend-only";

export type BackendFinding = {
  id: string;
  area: string;
  status: FindingStatus;
  summary: string;
  evidence: string[];
};

export const backendFindings: BackendFinding[] = [
  {
    id: "auth-session",
    area: "Authentication",
    status: "present",
    summary: "Browser Supabase client uses anon key; session via getSession/signInWithPassword/onAuthStateChange.",
    evidence: ["src/services/supabase.ts", "src/services/apiAuth.ts", "src/features/auth/AuthSession.tsx"],
  },
  {
    id: "workspace-ownership",
    area: "Workspace ownership",
    status: "present",
    summary: "workspaces.owner_id + workspace_members.role='owner'; RLS update/insert owner-scoped; soft_delete_workspace owner-checked.",
    evidence: [
      "supabase/migrations/20260929000000_production_baseline.sql",
      "supabase/migrations/20260929000050_soft_delete_workspace_owner_check.sql",
      "src/services/apiWorkspaces.ts",
    ],
  },
  {
    id: "workspace-list-rls",
    area: "Workspace listing (RLS)",
    status: "present",
    summary: "SELECT on workspaces is limited to owner (and member read migration). No cross-tenant list path for platform owners.",
    evidence: [
      "supabase/migrations/20260929000000_production_baseline.sql (Owners can view active workspace)",
      "supabase/migrations/20260929000100_workspace_member_read.sql",
      "src/services/apiWorkspaces.ts (getUserWorkspaces filters workspace_members by auth user)",
    ],
  },
  {
    id: "subscription-columns",
    area: "Subscription schema",
    status: "partial",
    summary:
      "Core App client reads subscription_status / started / expires / updated with graceful fallback if columns missing. Tracked migrations do not define these columns or a plans table.",
    evidence: [
      "src/services/apiWorkspaces.ts (subscriptionColumns + missing-column fallback)",
      "src/features/workspaces/workspaceSubscription.ts",
      "supabase/migrations/** (no subscription_* matches)",
    ],
  },
  {
    id: "subscription-gating",
    area: "Access gating",
    status: "frontend-only",
    summary:
      "hasSubscriptionWriteEntitlement gates writes in the SPA. No RLS/RPC in migrations references subscription_status. Soft-delete is not suspension.",
    evidence: [
      "src/features/workspaces/workspaceSubscription.ts",
      "src/features/workspaces/useWorkspaceSubscription.ts",
      "supabase/migrations/** (no subscription gating policies)",
    ],
  },
  {
    id: "edge-functions",
    area: "Trusted server code",
    status: "missing",
    summary: "No supabase/functions Edge Functions directory or platform-admin HTTP API in the repository.",
    evidence: ["repository tree (no supabase/functions)"],
  },
  {
    id: "platform-admin",
    area: "Platform-owner authorization",
    status: "missing",
    summary: "No is_platform_admin helper, app_metadata role check, or SECURITY DEFINER admin RPC for SaaS owner.",
    evidence: ["supabase/migrations/**", "src/** (no platform-admin patterns)"],
  },
  {
    id: "admin-mutations",
    area: "Subscription mutations",
    status: "missing",
    summary: "No RPC/API to change plan, expiration, or status. App never writes subscription_* fields. No plan IDs in schema.",
    evidence: ["src/services/apiWorkspaces.ts", "supabase/migrations/**"],
  },
  {
    id: "suspend",
    area: "Suspend / reactivate",
    status: "missing",
    summary:
      "No suspend/reactivate API. soft_delete_workspace soft-deletes the workspace — not a reversible access suspension and must not be used as one.",
    evidence: ["supabase/migrations/20260929000050_soft_delete_workspace_owner_check.sql"],
  },
  {
    id: "audit",
    area: "Audit logging",
    status: "missing",
    summary: "No audit_log / activity_log table or admin audit RPC in tracked migrations.",
    evidence: ["supabase/migrations/**"],
  },
  {
    id: "order-count",
    area: "Aggregate counts",
    status: "partial",
    summary:
      "getOrdersPage supports count:exact for a single workspace the caller can access. Employees are full-fetched. No cross-tenant aggregate admin RPC.",
    evidence: ["src/services/apiOrders.ts", "src/services/apiEmployees.ts"],
  },
  {
    id: "tenant-rpcs",
    area: "Existing RPCs (tenant-scoped)",
    status: "present",
    summary:
      "Verified RPCs are workspace-scoped (members, soft_delete, warehouse materials, invoice numbering) — not platform-admin surfaces.",
    evidence: [
      "workspace_member_profiles / workspace_member_find_user",
      "soft_delete_workspace",
      "sync_order_materials / issue_order_materials / return_order_materials",
      "workspace_get/set_invoice_next_number",
    ],
  },
];

/** Recommended later design — copy lives in i18n (`recommended.*`). */
export const recommendedBackendDesign = [
  { id: "claim" },
  { id: "listRpc" },
  { id: "mutations" },
  { id: "suspension" },
  { id: "frontend" },
] as const;