import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { deleteOrderServiceLine } from "./deleteOrderServiceLine";
import { invalidateOrderCaches } from "./useUpdateOrder";

export function useDeleteOrderServiceLine() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { orderId: string; lineId: string }) => {
      guardWrite();
      return deleteOrderServiceLine(input.orderId, input.lineId, workspaceId);
    },
    onSuccess: (_order, variables) => {
      invalidateOrderCaches(queryClient, workspaceId, variables.orderId);
    },
  });
}
