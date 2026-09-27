import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateOrder } from "../../services/apiOrders";
import type { UpdateOrderDetails } from "../../lib/types";

export function useUpdateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateOrderDetails) => updateOrder(input),
    onMutate: () => {
      toast.loading("Updating order...", { id: "update-order" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order updated successfully", { id: "update-order" });
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong", { id: "update-order" });
    },
  });
}
