import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { createOrder } from "../../services/apiOrders";

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createOrder,
    onMutate: () => {
      toast.loading("Creating order...", { id: "create-order" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      toast.success("Order created successfully", { id: "create-order" });
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong", { id: "create-order" });
    },
  });
}
