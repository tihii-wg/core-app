import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { deleteInventoryItem } from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (inventoryItemId: string) => deleteInventoryItem(inventoryItemId, workspaceId),
    onMutate: () => {
      toast.loading(i18n.t("inventory.toast.deleting"), { id: "delete-inventory" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18n.t("inventory.toast.deleted"), { id: "delete-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("inventory.errors.deleteFailed"), { id: "delete-inventory" });
    },
  });
}
