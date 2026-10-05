import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { getOrders, updateOrderStatus } from "../../services/apiOrders";
import type { OrderStatus } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetOrders(search = "", { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: search ? ["orders", workspaceId, search] : ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId, search),
    enabled: Boolean(workspaceId) && enabled,
  });

  return { orders: orders ?? [], isLoading, error, refetch };
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) => updateOrderStatus(orderId, status, workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("orders.toast.statusUpdateFailed"), { id: "update-order-status" });
    },
  });
}
