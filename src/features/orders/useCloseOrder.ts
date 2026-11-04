import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { cancelOrder, closeOrder } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

function invalidateOrderCaches(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined, orderId: string) {
  void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["orders-page", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
}

export function useCloseOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (orderId: string) => {
      guardWrite();
      return closeOrder(orderId, workspaceId);
    },
    onSuccess: (result, orderId) => {
      invalidateOrderCaches(queryClient, workspaceId, orderId);
      toast.success(
        result?.idempotent ? i18n.t("orders.lifecycle.toast.alreadyClosed") : i18n.t("orders.lifecycle.toast.closed"),
      );
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (orderId: string) => {
      guardWrite();
      return cancelOrder(orderId, workspaceId);
    },
    onSuccess: (result, orderId) => {
      invalidateOrderCaches(queryClient, workspaceId, orderId);
      toast.success(
        result?.idempotent ? i18n.t("orders.lifecycle.toast.alreadyCancelled") : i18n.t("orders.lifecycle.toast.cancelled"),
      );
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
