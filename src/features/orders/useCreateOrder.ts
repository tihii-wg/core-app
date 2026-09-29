import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { createOrder } from "../../services/apiOrders";
import type { CreateOrderInput } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: CreateOrderInput) => createOrder(input, workspaceId),
    onMutate: () => {
      toast.loading("Creating order...", { id: "create-order" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success("Order created successfully", { id: "create-order" });
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong", { id: "create-order" });
    },
  });
}
