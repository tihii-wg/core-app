import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { updateInventoryItem } from "../../services/apiInventory";

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useParams();

  return useMutation({
    mutationFn: (input) => updateInventoryItem(input, workspaceId),
    onMutate: () => {
      toast.loading("Updating inventory item", { id: "update-inventory" });
    },
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId, item.id] });
      toast.success("Inventory item updated", { id: "update-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || "Could not save the inventory item. Please try again.", { id: "update-inventory" });
    },
  });
}
