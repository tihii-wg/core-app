import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { Order } from "../../lib/types";
import { cancelOrder, closeOrder, type CancelOrderResult, type OrdersPageResult } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

function invalidateOrderCaches(queryClient: QueryClient, workspaceId: string | undefined, orderId: string) {
  void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["orders-page", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
}

/** Patch every cached order list/page so cancelled status is visible before refetch settles. */
export function patchCancelledOrderInCache(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
  result: CancelOrderResult,
) {
  if (!workspaceId) return;

  const patchOrder = (order: Order): Order =>
    order.id === orderId
      ? {
          ...order,
          status: "cancelled",
          customStatusId: result.customStatusId,
          customStatus: result.customStatus,
        }
      : order;

  queryClient.setQueriesData({ queryKey: ["orders", workspaceId] }, (data: unknown) => {
    if (Array.isArray(data)) return (data as Order[]).map(patchOrder);
    if (data && typeof data === "object" && Array.isArray((data as OrdersPageResult).orders)) {
      const page = data as OrdersPageResult;
      return { ...page, orders: page.orders.map(patchOrder) };
    }
    return data;
  });
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
      // Only toast after the RPC succeeded; patch caches so list/board/detail agree immediately.
      patchCancelledOrderInCache(queryClient, workspaceId, orderId, result);
      invalidateOrderCaches(queryClient, workspaceId, orderId);
      toast.success(
        result?.idempotent ? i18n.t("orders.lifecycle.toast.alreadyCancelled") : i18n.t("orders.lifecycle.toast.cancelled"),
      );
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
