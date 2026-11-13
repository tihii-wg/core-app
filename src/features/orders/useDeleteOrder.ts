import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { deleteOrder } from "../../services/apiOrders";
import { invalidatePaymentViews } from "../finance/usePayments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { notifyOrderCalendarChanged } from "../calendar/pokeCalendarSync";

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (orderId: string) => {
      guardWrite();
      return deleteOrder(orderId, workspaceId);
    },
    onMutate: () => toast.loading(i18n.t("orders.toast.deleting"), { id: "delete-order" }),
    onSuccess: (result) => {
      if (!result.storageCleanupComplete) {
        toast.error(i18n.t("orders.errors.deleteStorageCleanupPending", { count: result.attachmentStoragePaths.length, file: "order_attachment_cleanup" }), {
          id: "delete-order",
        });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["orders-page", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["orders-warranty-indicators", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["warranty-records", workspaceId] });
      invalidatePaymentViews(queryClient, workspaceId);
      notifyOrderCalendarChanged(queryClient, workspaceId);
      const returned = result.materialsReturned?.length ?? 0;
      toast.success(
        returned > 0
          ? i18n.t("orders.toast.deletedWithMaterialsReturned", {
              count: result.paymentsDeleted,
              warehouses: returned,
            })
          : result.paymentsDeleted > 0
            ? i18n.t("orders.toast.deletedWithPayments", { count: result.paymentsDeleted })
            : i18n.t("orders.toast.deleted"),
        { id: "delete-order" },
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "delete-order" });
    },
  });
}
