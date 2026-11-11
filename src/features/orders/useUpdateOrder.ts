import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateOrder } from "../../services/apiOrders";
import type { UpdateOrderDetails } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

/** Query keys refreshed after any order write that can change lines, totals, stock or warranties. */
export function invalidateOrderCaches(queryClient: QueryClient, workspaceId: string | undefined, orderId: string) {
  queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["orders", workspaceId, "awaitingPayment"] });
  queryClient.invalidateQueries({ queryKey: ["orders-page", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
  // Catalog materials are issued from a warehouse on save — refresh per-warehouse stock and movements too.
  queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["orders-warranty-indicators", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["warranty-records", workspaceId] });
}

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: UpdateOrderDetails) => {
      guardWrite();
      return updateOrder(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("orders.toast.updating"), { id: "update-order" });
    },
    onSuccess: (_order, variables) => {
      invalidateOrderCaches(queryClient, workspaceId, variables.orderId);
      toast.success(i18n.t("orders.toast.updated"), { id: "update-order" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "update-order" });
    },
  });
}
