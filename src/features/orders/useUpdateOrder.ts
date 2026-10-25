import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateOrder } from "../../services/apiOrders";
import type { UpdateOrderDetails } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18n.t("orders.toast.updated"), { id: "update-order" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "update-order" });
    },
  });
}
