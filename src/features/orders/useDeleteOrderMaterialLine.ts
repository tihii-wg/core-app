import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { applyOrderLineMutationCache } from "./applyOrderLineMutationCache";
import { deleteOrderMaterialLine } from "./deleteOrderMaterialLine";

export function useDeleteOrderMaterialLine() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { orderId: string; lineId: string }) => {
      guardWrite();
      return deleteOrderMaterialLine(input.orderId, input.lineId, workspaceId);
    },
    onSuccess: (order) => {
      // Deleting a catalog line returns outstanding stock — always refresh stock caches.
      applyOrderLineMutationCache(queryClient, workspaceId, order, { stockMoved: true });
    },
  });
}
