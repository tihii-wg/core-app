import { adminCapabilities } from "./capabilities";
import type { AdminWorkspaceRow, DataSourceMode } from "./types";

export type LiveWorkspaceQueryResult = {
  mode: DataSourceMode;
  rows: AdminWorkspaceRow[];
  /** i18n message key for unavailable/error copy */
  reasonKey: string;
  /** True only when a verified platform-owner backend path returned rows. */
  isLiveAuthorized: boolean;
};

/**
 * Live cross-tenant workspace fetch.
 *
 * Intentionally does **not** call Supabase for workspace listing:
 * - RLS cannot return other tenants' workspaces to a normal authenticated user.
 * - There is no platform-owner RPC/Edge Function in the repository.
 * - Querying anyway would either return only the caller's memberships (misleading as "admin data")
 *   or fail — never a secure SaaS-owner inventory.
 */
export async function fetchAdminWorkspacesLive(): Promise<LiveWorkspaceQueryResult> {
  if (!adminCapabilities.listAllWorkspaces || !adminCapabilities.platformOwnerAuthz) {
    return {
      mode: "unavailable",
      rows: [],
      reasonKey: "liveData.unavailableReason",
      isLiveAuthorized: false,
    };
  }

  return {
    mode: "unavailable",
    rows: [],
    reasonKey: "liveData.capabilityTrueButUnwired",
    isLiveAuthorized: false,
  };
}

export type AdminMutationKind = "changePlan" | "changeExpiration" | "suspend" | "reactivate";

export type AdminMutationResult =
  | { ok: true }
  | { ok: false; code: "disabled" | "unauthorized" | "unsupported"; messageKey: string };

/**
 * Administrative mutations. All paths refuse until verified server RPCs exist.
 * Never updates local UI state to imply success.
 */
export async function runAdminMutation(
  kind: AdminMutationKind,
  workspaceId: string,
): Promise<AdminMutationResult> {
  void workspaceId;
  const enabled =
    (kind === "changePlan" && adminCapabilities.changePlan) ||
    (kind === "changeExpiration" && adminCapabilities.changeExpiration) ||
    (kind === "suspend" && adminCapabilities.suspendWorkspace) ||
    (kind === "reactivate" && adminCapabilities.reactivateWorkspace);

  if (!enabled || !adminCapabilities.platformOwnerAuthz) {
    return {
      ok: false,
      code: "disabled",
      messageKey: "mutations.disabled",
    };
  }

  return {
    ok: false,
    code: "unsupported",
    messageKey: "mutations.unsupported",
  };
}
