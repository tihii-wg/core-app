import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { deleteInventoryItem } from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

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
