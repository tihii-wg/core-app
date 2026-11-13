import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { convertEstimateToOrder, setEstimateStatus } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { patchOrderInLists } from "./orderCache";
import { notifyOrderCalendarChanged } from "../calendar/pokeCalendarSync";

/** Convert estimate → order (same id/number) and refresh order caches. */
export function useConvertEstimateToOrder() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (orderId: string) => {
      guardWrite();
      return convertEstimateToOrder(orderId, workspaceId);
    },
    onSuccess: (order) => {
      patchOrderInLists(queryClient, workspaceId, order.id, order);
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
      notifyOrderCalendarChanged(queryClient, workspaceId);
      toast.success(t("orders.estimates.convertSuccess", { number: order.orderNumber }));
    },
    onError: (error: Error) => {
      toast.error(error.message || t("common.somethingWentWrong"));
    },
  });
}

/** Change estimate_status_id (accept semantic converts via RPC). */
export function useSetEstimateStatus() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ orderId, statusId }: { orderId: string; statusId: string }) => {
      guardWrite();
      return setEstimateStatus(orderId, statusId, workspaceId);
    },
    onSuccess: (order: Order) => {
      patchOrderInLists(queryClient, workspaceId, order.id, order);
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
      if (order.kind !== "estimate") {
        toast.success(t("orders.estimates.convertSuccess", { number: order.orderNumber }));
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || t("common.somethingWentWrong"));
    },
  });
}
