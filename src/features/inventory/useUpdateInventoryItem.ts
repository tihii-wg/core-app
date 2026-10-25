import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateInventoryItem } from "../../services/apiInventory";
import type { InventoryItemFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { syncInventoryItemCaches } from "./syncInventoryCaches";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: InventoryItemFormData & { id: string }) => {
      guardWrite();
      return updateInventoryItem(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("inventory.toast.updating"), { id: "update-inventory" });
    },
    onSuccess: async (item) => {
      // Patch list + detail caches immediately so the Parts status badge updates
      // from the new quantity without waiting for a full refetch or page reload.
      syncInventoryItemCaches(queryClient, workspaceId, item);
      await queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18n.t("inventory.toast.updated"), { id: "update-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("inventory.errors.saveFailed"), { id: "update-inventory" });
    },
  });
}
