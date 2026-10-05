import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateInventoryItem } from "../../services/apiInventory";
import type { InventoryItemFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: InventoryItemFormData & { id: string }) => updateInventoryItem(input, workspaceId),
    onMutate: () => {
      toast.loading(i18n.t("inventory.toast.updating"), { id: "update-inventory" });
    },
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId, item.id] });
      toast.success(i18n.t("inventory.toast.updated"), { id: "update-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("inventory.errors.saveFailed"), { id: "update-inventory" });
    },
  });
}
