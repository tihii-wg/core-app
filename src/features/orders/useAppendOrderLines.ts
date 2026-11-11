import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { Order, OrderMaterial, OrderService } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { appendOrderMaterialLines, appendOrderServiceLines } from "./appendOrderLines";
import { invalidateOrderCaches } from "./useUpdateOrder";

export type AppendOrderLinesInput =
  | { orderId: string; kind: "services"; drafts: OrderService[] }
  | { orderId: string; kind: "materials"; drafts: OrderMaterial[] };

/**
 * Append-only line save for the add-service / add-material dialogs. Goes through `updateOrder` (via
 * `appendOrderLines`) and invalidates the same caches as `useUpdateOrder`. API errors are NOT toasted here:
 * the dialogs show them inline and stay open.
 */
export function useAppendOrderLines() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation<Order, Error, AppendOrderLinesInput>({
    mutationFn: (input) => {
      guardWrite();
      return input.kind === "services"
        ? appendOrderServiceLines(input.orderId, input.drafts, workspaceId)
        : appendOrderMaterialLines(input.orderId, input.drafts, workspaceId);
    },
    onSuccess: (_order, variables) => {
      invalidateOrderCaches(queryClient, workspaceId, variables.orderId);
      toast.success(i18n.t(variables.kind === "services" ? "orders.toast.serviceAdded" : "orders.toast.materialAdded"));
    },
  });
}
