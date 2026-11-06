import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { formatWorkspaceMoney, workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import {
  cancelOrderWithPaymentVoid,
  closeOrder,
  type CancelOrderResult,
  type CancelOrderWithPaymentVoidResult,
  type CloseOrderResult,
} from "../../services/apiOrders";
import { invalidatePaymentViews } from "../finance/usePayments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { patchOrderLists } from "./orderCache";

function invalidateOrderCaches(queryClient: QueryClient, workspaceId: string | undefined, orderId: string) {
  void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["orders-page", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["orders-warranty-indicators", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["warranty-records", workspaceId] });
}

export type CancelOrderMutationInput =
  | string
  | {
      orderId: string;
      voidPayments?: boolean;
      reason?: string | null;
    };

function normalizeCancelInput(input: CancelOrderMutationInput) {
  if (typeof input === "string") {
    return { orderId: input, voidPayments: false, reason: null as string | null };
  }
  return {
    orderId: input.orderId,
    voidPayments: input.voidPayments === true,
    reason: input.reason ?? null,
  };
}

/** Patch every cached order list/page so cancelled status is visible before refetch settles. */
export function patchCancelledOrderInCache(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
  result: CancelOrderResult,
) {
  patchOrderLists(queryClient, workspaceId, (order) =>
    order.id === orderId
      ? {
          ...order,
          status: "cancelled",
          customStatusId: result.customStatusId,
          customStatus: result.customStatus,
          closedAt: result.closed_at ?? order.closedAt,
        }
      : order,
  );
}

/** Patch caches so closed lifecycle status is visible before refetch settles. */
export function patchClosedOrderInCache(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
  result: CloseOrderResult,
) {
  patchOrderLists(queryClient, workspaceId, (order) =>
    order.id === orderId
      ? {
          ...order,
          status: "closed",
          closedAt: result.closed_at ?? order.closedAt,
          customStatusId: result.customStatusId,
          customStatus: result.customStatus,
        }
      : order,
  );
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
      patchClosedOrderInCache(queryClient, workspaceId, orderId, result);
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
  const { data: workspace } = useGetWorkspace(workspaceId);
  const currency = workspace?.currency ?? workspacePreferenceDefaults.currency;
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (input: CancelOrderMutationInput) => {
      guardWrite();
      const normalized = normalizeCancelInput(input);
      return cancelOrderWithPaymentVoid(normalized.orderId, workspaceId, {
        voidPayments: normalized.voidPayments,
        reason: normalized.reason,
      });
    },
    onSuccess: (result: CancelOrderWithPaymentVoidResult, input) => {
      const orderId = typeof input === "string" ? input : input.orderId;
      // Only toast after the RPC succeeded; patch caches so list/board/detail agree immediately.
      patchCancelledOrderInCache(queryClient, workspaceId, orderId, result);
      invalidateOrderCaches(queryClient, workspaceId, orderId);
      invalidatePaymentViews(queryClient, workspaceId);

      if (result.voidedCount > 0) {
        toast.success(
          i18n.t("orders.cancelFinance.toast.cancelledAndVoided", {
            count: result.voidedCount,
            amount: formatWorkspaceMoney(result.voidedTotal, currency),
          }),
        );
      } else {
        toast.success(
          result.idempotent
            ? i18n.t("orders.lifecycle.toast.alreadyCancelled")
            : i18n.t("orders.lifecycle.toast.cancelled"),
        );
      }

      if (result.skipped.length > 0) {
        toast(i18n.t("orders.cancelFinance.toast.skippedRefunded", { count: result.skipped.length }), {
          id: "cancel-order-skipped-refunds",
        });
      }
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}
