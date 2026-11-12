import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { applyOrderLineMutationCache } from "./applyOrderLineMutationCache";
import { deleteOrderServiceLine } from "./deleteOrderServiceLine";

export function useDeleteOrderServiceLine() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { orderId: string; lineId: string }) => {
      guardWrite();
      return deleteOrderServiceLine(input.orderId, input.lineId, workspaceId);
    },
    onSuccess: (order) => {
      applyOrderLineMutationCache(queryClient, workspaceId, order);
    },
  });
}
