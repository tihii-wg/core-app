import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateInventoryItem } from "../../services/apiInventory";
import type { InventoryItemFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: InventoryItemFormData & { id: string }) => updateInventoryItem(input, workspaceId),
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
