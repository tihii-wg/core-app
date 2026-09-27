import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { createInventoryItem } from "../../services/apiInventory";

export function useCreateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useParams();

  return useMutation({
    mutationFn: createInventoryItem,
    onMutate: () => {
      toast.loading("Creating inventory item", { id: "create-inventory" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success("Inventory item created", { id: "create-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || "Could not save the inventory item. Please try again.", { id: "create-inventory" });
    },
  });
}
