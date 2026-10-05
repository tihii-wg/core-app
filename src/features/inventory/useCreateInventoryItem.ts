import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createInventoryItem } from "../../services/apiInventory";
import type { InventoryItemFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useCreateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: InventoryItemFormData) => createInventoryItem(input, workspaceId),
    onMutate: () => {
      toast.loading(i18n.t("inventory.toast.creating"), { id: "create-inventory" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18n.t("inventory.toast.created"), { id: "create-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("inventory.errors.saveFailed"), { id: "create-inventory" });
    },
  });
}
