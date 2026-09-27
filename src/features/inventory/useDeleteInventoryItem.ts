import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { deleteInventoryItem } from "../../services/apiInventory";

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useParams();

  return useMutation({
    mutationFn: (inventoryItemId: string) => deleteInventoryItem(inventoryItemId, workspaceId),
    onMutate: () => {
      toast.loading("Deleting inventory item", { id: "delete-inventory" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success("Inventory item deleted", { id: "delete-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || "Could not delete the inventory item. Please try again.", { id: "delete-inventory" });
    },
  });
}
