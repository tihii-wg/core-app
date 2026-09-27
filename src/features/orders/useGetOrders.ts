import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getOrders, updateOrderStatus } from "../../services/apiOrders";
import type { OrderStatus } from "../../lib/types";

export function useGetOrders() {
  const { workspaceId } = useParams();
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId),
    enabled: Boolean(workspaceId),
  });

  if (error) throw new Error(error.message);

  return { orders: orders ?? [], isLoading };
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) => updateOrderStatus(orderId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
