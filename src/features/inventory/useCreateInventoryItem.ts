import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { createInventoryItem } from "../../services/apiInventory";
import type { InventoryItemFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useCreateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: InventoryItemFormData) => createInventoryItem(input, workspaceId),
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
