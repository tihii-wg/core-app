import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateOrder } from "../../services/apiOrders";
import type { UpdateOrderDetails } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: UpdateOrderDetails) => updateOrder(input, workspaceId),
    onMutate: () => {
      toast.loading(i18n.t("orders.toast.updating"), { id: "update-order" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success(i18n.t("orders.toast.updated"), { id: "update-order" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "update-order" });
    },
  });
}
