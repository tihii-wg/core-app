import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { Order, OrderMaterial, OrderService } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { appendOrderMaterialLines, appendOrderServiceLines } from "./appendOrderLines";
import { applyOrderLineMutationCache } from "./applyOrderLineMutationCache";
import { isCatalogOrderMaterial } from "../inventory/orderMaterialLine";

export type AppendOrderLinesInput =
  | { orderId: string; kind: "services"; drafts: OrderService[] }
  | { orderId: string; kind: "materials"; drafts: OrderMaterial[] };

/**
 * Append-only line save for the add-service / add-material dialogs.
 * API errors are NOT toasted here: the dialogs show them inline and stay open.
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
    onSuccess: (order, variables) => {
      const stockMoved =
        variables.kind === "materials" && variables.drafts.some((draft) => isCatalogOrderMaterial(draft));
      applyOrderLineMutationCache(queryClient, workspaceId, order, { stockMoved });
      toast.success(i18n.t(variables.kind === "services" ? "orders.toast.serviceAdded" : "orders.toast.materialAdded"));
    },
  });
}
