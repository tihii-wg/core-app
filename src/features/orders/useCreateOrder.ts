import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createOrder } from "../../services/apiOrders";
import type { CreateOrderInput } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: CreateOrderInput) => {
      guardWrite();
      return createOrder(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("orders.toast.creating"), { id: "create-order" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18n.t("orders.toast.created"), { id: "create-order" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "create-order" });
    },
  });
}
