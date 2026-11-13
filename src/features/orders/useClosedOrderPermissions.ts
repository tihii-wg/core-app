import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emptyClosedOrderGrants,
  getClosedOrderPermissionGrants,
  saveClosedOrderPermissionGrants,
  type ClosedOrderPermissionGrants,
} from "../../services/apiClosedOrderPermissions";
import { updateOwnerCanManageClosedOrders } from "../../services/apiWorkspaces";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import {
  actsAsOwnerForClosedOrders,
  canCancelClosedOrder,
  canDeleteClosedOrder,
  hasClosedOrderFullAccess,
  ownerMayManageClosedOrders,
} from "./closedOrderPermissions";

export function closedOrderPermissionsQueryKey(workspaceId: string | undefined) {
  return ["closed-order-permissions", workspaceId] as const;
}

export function useClosedOrderPermissionGrants(workspaceId?: string | null) {
  const { workspaceId: activeId } = useActiveWorkspaceId();
  const id = workspaceId ?? activeId;
  return useQuery({
    queryKey: closedOrderPermissionsQueryKey(id),
    queryFn: () => getClosedOrderPermissionGrants(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Resolved cancel/delete-closed flags (owner+setting; else role grants). */
export function useClosedOrderActionPermissions() {
  const role = useActiveWorkspaceRole();
  const isOwnerByOwnerId = useIsWorkspaceOwnerId();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { data: grants, isLoading, isError } = useClosedOrderPermissionGrants();
  const safeGrants = grants ?? emptyClosedOrderGrants();
  const ownerCanManageClosedOrders = workspace?.ownerCanManageClosedOrders === true;
  const ownerMayManageClosed = ownerMayManageClosedOrders({
    isOwnerByOwnerId,
    ownerCanManageClosedOrders,
  });
  const fullAccess = hasClosedOrderFullAccess(role, safeGrants);
  const actsAsOwner = actsAsOwnerForClosedOrders({
    isOwnerByOwnerId,
    workspaceRole: role,
    grants: safeGrants,
  });
  return {
    role,
    grants: safeGrants,
    isLoading,
    isError,
    isOwnerByOwnerId,
    ownerCanManageClosedOrders,
    hasClosedFullAccess: fullAccess,
    actsAsOwnerForClosedOrders: actsAsOwner,
    /** Always false — closed content is immutable until cancelled. */
    canManageClosedContent: false as const,
    canCancelClosed: ownerMayManageClosed || fullAccess || canCancelClosedOrder(role, safeGrants),
    canDeleteClosed: ownerMayManageClosed || fullAccess || canDeleteClosedOrder(role, safeGrants),
  };
}

export function useSaveClosedOrderPermissionGrants() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (grants: ClosedOrderPermissionGrants) => saveClosedOrderPermissionGrants(workspaceId, grants),
    onSuccess: (saved) => {
      if (!workspaceId) return;
      queryClient.setQueryData(closedOrderPermissionsQueryKey(workspaceId), saved);
      queryClient.invalidateQueries({ queryKey: closedOrderPermissionsQueryKey(workspaceId) });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useSaveOwnerCanManageClosedOrders() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (enabled: boolean) => updateOwnerCanManageClosedOrders(workspaceId!, enabled),
    onSuccess: (workspace) => {
      if (!workspaceId || !workspace) return;
      // Workspace details power permission gates — refresh immediately.
      queryClient.setQueryData(["workspace", workspaceId], workspace);
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.invalidateQueries({ queryKey: closedOrderPermissionsQueryKey(workspaceId) });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
