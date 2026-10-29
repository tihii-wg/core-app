import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { deleteOrder } from "../../services/apiOrders";
import { invalidatePaymentViews } from "../finance/usePayments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

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
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      invalidatePaymentViews(queryClient, workspaceId);
      toast.success(
        result.paymentsDeleted > 0
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
