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
 */
export function useWorkspaceSubscription() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace, isLoading, isFetching, isFetched, error, refetch } = useGetWorkspace(workspaceId);

  const subscription = workspaceSubscriptionFromDetails(workspace);
  const canWrite = hasSubscriptionWriteEntitlement(subscription);

  return {
    workspaceId: workspaceId ?? null,
    subscription,
    status: (subscription?.subscriptionStatus ?? null) as WorkspaceSubscriptionStatus | null,
    expiresAt: subscription?.subscriptionExpiresAt ?? null,
    startedAt: subscription?.subscriptionStartedAt ?? null,
    updatedAt: subscription?.subscriptionUpdatedAt ?? null,
    canWrite,
    isLoading,
    isFetching,
    isFetched,
    error,
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

/** Guard for TanStack mutationFns — fail closed while workspace is unknown. */
export function useGuardSubscriptionWrite() {
  const { subscription, workspaceId } = useWorkspaceSubscription();

  return useCallback(() => {
    if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
    assertSubscriptionWriteAccess(subscription);
  }, [subscription, workspaceId]);
}

/** Owner settings UI gate: owner role AND subscription write entitlement. */
export function useCanEditWorkspaceSettings(role: string | null | undefined) {
  const { canWrite } = useWorkspaceSubscription();
  return withSubscriptionWriteAccess(canManageWorkspace(role), canWrite);
}
