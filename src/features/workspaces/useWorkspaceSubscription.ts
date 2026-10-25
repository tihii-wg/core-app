import { useCallback } from "react";
import i18n from "../../i18n";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "./useGetWorkspace";
import { canManageWorkspace } from "./workspaceRoles";
import {
  hasSubscriptionWriteEntitlement,
  withSubscriptionWriteAccess,
  type WorkspaceSubscriptionFields,
  type WorkspaceSubscriptionStatus,
} from "./workspaceSubscription";

export function workspaceSubscriptionFromDetails(
  workspace:
    | (WorkspaceSubscriptionFields & { id?: string })
    | null
    | undefined,
): WorkspaceSubscriptionFields | null {
  if (!workspace) return null;
  return {
    subscriptionStatus: workspace.subscriptionStatus,
    subscriptionStartedAt: workspace.subscriptionStartedAt,
    subscriptionExpiresAt: workspace.subscriptionExpiresAt,
    subscriptionUpdatedAt: workspace.subscriptionUpdatedAt,
  };
}

/**
 * Subscription state for the active workspace. Refetches when `workspaceId`
 * changes (query key `["workspace", workspaceId]`) — never reuse another
 * workspace's entitlement.
 *
 * TanStack Query v5 reports `isLoading === false` for disabled queries
 * (`enabled: false` while the profile/workspace id is still unknown). Treat
 * that as entitlement-pending so the read-only notice does not flash on reload.
 */
export function useWorkspaceSubscription() {
  const { workspaceId, isLoading: isProfileLoading } = useActiveWorkspaceId();
  const {
    data: workspace,
    isPending,
    isFetching,
    isFetched,
    isError,
    error,
    refetch,
  } = useGetWorkspace(workspaceId);

  // Only trust subscription fields once they belong to the current workspace id.
  // useGetWorkspace keys by workspaceId, so a switch clears prior data automatically.
  const workspaceMatchesActive =
    Boolean(workspaceId) && workspace != null && (workspace.id == null || workspace.id === workspaceId);

  const isEntitlementPending =
    Boolean(isProfileLoading) || !workspaceId || (isPending && !isError);

  const subscription = isEntitlementPending
    ? null
    : workspaceSubscriptionFromDetails(workspaceMatchesActive ? workspace : null);

  // Fail closed while unresolved — never grant writes from a loading/empty state.
  const canWrite = !isEntitlementPending && hasSubscriptionWriteEntitlement(subscription);

  return {
    workspaceId: workspaceId ?? null,
    subscription,
    status: (subscription?.subscriptionStatus ?? null) as WorkspaceSubscriptionStatus | null,
    expiresAt: subscription?.subscriptionExpiresAt ?? null,
    startedAt: subscription?.subscriptionStartedAt ?? null,
    updatedAt: subscription?.subscriptionUpdatedAt ?? null,
    canWrite,
    /** True until active-workspace subscription fields are resolved or the query errors. */
    isEntitlementPending,
    isEntitlementResolved: !isEntitlementPending,
    /** Alias of `isEntitlementPending` for existing skeleton/loading consumers. */
    isLoading: isEntitlementPending,
    isFetching,
    isFetched,
    error: isError ? error : null,
    refetch,
  };
}

export function subscriptionWriteDeniedMessage() {
  return i18n.t("settings.subscription.errors.writeDenied");
}

export function assertSubscriptionWriteAccess(
  state: Pick<WorkspaceSubscriptionFields, "subscriptionStatus" | "subscriptionExpiresAt"> | null | undefined,
  now: Date = new Date(),
) {
  if (!hasSubscriptionWriteEntitlement(state, now)) {
    throw new Error(subscriptionWriteDeniedMessage());
  }
}

/** Guard for TanStack mutationFns — fail closed while workspace/entitlement is unknown. */
export function useGuardSubscriptionWrite() {
  const { subscription, workspaceId, isEntitlementPending } = useWorkspaceSubscription();

  return useCallback(() => {
    if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
    if (isEntitlementPending) throw new Error(subscriptionWriteDeniedMessage());
    assertSubscriptionWriteAccess(subscription);
  }, [subscription, workspaceId, isEntitlementPending]);
}

/** Owner settings UI gate: owner role AND subscription write entitlement. */
export function useCanEditWorkspaceSettings(role: string | null | undefined) {
  const { canWrite } = useWorkspaceSubscription();
  return withSubscriptionWriteAccess(canManageWorkspace(role), canWrite);
}
