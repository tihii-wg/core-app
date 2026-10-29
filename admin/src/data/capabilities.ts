import type { AdminCapabilities } from "./types";

/**
 * Verified against Core App migrations and client code (read-only inspection).
 * All privileged admin mutations and cross-tenant reads are currently unsupported
 * without a new server-side authorization surface. Do not flip these to true
 * without verifying a real backend path that does not expose a service-role key.
 */
export const adminCapabilities: AdminCapabilities = {
  listAllWorkspaces: false,
  aggregateCounts: false,
  platformOwnerAuthz: false,
  changePlan: false,
  changeExpiration: false,
  suspendWorkspace: false,
  reactivateWorkspace: false,
  auditLog: false,
};

export const backendPrerequisites = [
  {
    id: "platform-admin",
    title: "Platform-owner authorization",
    detail:
      "Add a server-enforced check (SECURITY DEFINER RPC or Edge Function) that verifies the caller is the SaaS owner via a non-forgeable claim (e.g. auth app_metadata). Client-side email checks are rejected.",
  },
  {
    id: "cross-tenant-list",
    title: "Cross-tenant workspace listing",
    detail:
      "Existing RLS: owners + members can SELECT their workspaces only (baseline + 20260929000100). getUserWorkspaces filters membership by auth user. Need a privileged, audited query returning business-level fields only.",
  },
  {
    id: "aggregates",
    title: "Safe aggregate counts",
    detail:
      "Tenant getOrdersPage supports count:exact for accessible workspaces; employees are full-fetched. Need admin RPC aggregates that never return customer PII, order bodies, or invoices.",
  },
  {
    id: "subscription-mutations",
    title: "Subscription mutation RPCs",
    detail:
      "No admin write path for subscription_*. No plans table/plan_id in tracked migrations. Need validated, authorized, idempotent server endpoints before enabling UI confirms.",
  },
  {
    id: "suspension",
    title: "Server-enforced suspension",
    detail:
      "SPA write gating is frontend-only. soft_delete_workspace soft-deletes a workspace — do not reuse it as suspend. Need status + RLS/triggers for protected operations, plus reactivate.",
  },
  {
    id: "audit",
    title: "Admin audit log",
    detail:
      "No audit_log (or equivalent) in tracked migrations. Do not enable administrative mutations without actor/action/workspace/before-after auditability.",
  },
] as const;
