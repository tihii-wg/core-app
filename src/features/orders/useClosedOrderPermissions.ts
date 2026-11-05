import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emptyClosedOrderGrants,
  getClosedOrderPermissionGrants,
  saveClosedOrderPermissionGrants,
  type ClosedOrderPermissionGrants,
} from "../../services/apiClosedOrderPermissions";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import { canCancelClosedOrder, canDeleteClosedOrder } from "./closedOrderPermissions";

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

/** Resolved cancel/delete-closed flags (workspaces.owner_id always; else role grants). */
export function useClosedOrderActionPermissions() {
  const role = useActiveWorkspaceRole();
  const isOwnerByOwnerId = useIsWorkspaceOwnerId();
  const { data: grants, isLoading, isError } = useClosedOrderPermissionGrants();
  const safeGrants = grants ?? emptyClosedOrderGrants();
  return {
    role,
    grants: safeGrants,
    isLoading,
    isError,
    canCancelClosed: isOwnerByOwnerId || canCancelClosedOrder(role, safeGrants),
    canDeleteClosed: isOwnerByOwnerId || canDeleteClosedOrder(role, safeGrants),
  };
}

export function useSaveClosedOrderPermissionGrants() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (grants: ClosedOrderPermissionGrants) => saveClosedOrderPermissionGrants(workspaceId, grants),
    onSuccess: (saved) => {
      if (workspaceId) {
        queryClient.setQueryData(closedOrderPermissionsQueryKey(workspaceId), saved);
      }
    },
  });
}
