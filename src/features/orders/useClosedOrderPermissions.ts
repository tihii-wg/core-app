import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emptyClosedOrderGrants,
  getClosedOrderPermissionGrants,
  saveClosedOrderPermissionGrants,
  type ClosedOrderPermissionGrants,
} from "../../services/apiClosedOrderPermissions";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
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

/** Resolved cancel/delete-closed flags for the current member (owner always true). */
export function useClosedOrderActionPermissions() {
  const role = useActiveWorkspaceRole();
  const { data: grants, isLoading, isError } = useClosedOrderPermissionGrants();
  const safeGrants = grants ?? emptyClosedOrderGrants();
  return {
    role,
    grants: safeGrants,
    isLoading,
    isError,
    canCancelClosed: canCancelClosedOrder(role, safeGrants),
    canDeleteClosed: canDeleteClosedOrder(role, safeGrants),
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
