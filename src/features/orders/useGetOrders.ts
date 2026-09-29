import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { getOrders, updateOrderStatus } from "../../services/apiOrders";
import type { OrderStatus } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetOrders() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId),
    enabled: Boolean(workspaceId),
  });

  return { orders: orders ?? [], isLoading, error };
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
      toast.error(error.message || "Could not update the order status", { id: "update-order-status" });
    },
  });
}
