import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { Order } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { ORDER_FIELD_SAVED_TOAST_ID } from "./useUpdateOrderFields";
import { applyOrderLineMutationCache } from "./applyOrderLineMutationCache";
import {
  updateOrderMaterialLine,
  type OrderMaterialLinePatch,
} from "./updateOrderMaterialLine";
import { isCatalogOrderMaterial } from "../inventory/orderMaterialLine";

export type UpdateOrderMaterialLineInput = {
  orderId: string;
  lineId: string;
  patch: OrderMaterialLinePatch;
  warehouseName?: string;
};

/**
 * Narrow mutation for click-to-edit of one material line on the order card.
 * Errors are NOT toasted — the inline cell shows the message under the control.
 */
export function useUpdateOrderMaterialLine() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation<Order, Error, UpdateOrderMaterialLineInput>({
    mutationFn: (input) => {
      guardWrite();
      return updateOrderMaterialLine(input.orderId, input.lineId, input.patch, workspaceId, {
        warehouseName: input.warehouseName,
      });
    },
    onSuccess: (order, variables) => {
      const line = (order.materials ?? []).find((row) => row.id === variables.lineId);
      const stockMoved =
        variables.patch.quantity !== undefined && Boolean(line && isCatalogOrderMaterial(line));
      applyOrderLineMutationCache(queryClient, workspaceId, order, { stockMoved });
      toast.success(i18n.t("orders.toast.fieldSaved"), { id: ORDER_FIELD_SAVED_TOAST_ID });
    },
  });
}
