import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateInventoryItem } from "../../services/apiInventory";
import { syncOrderMaterialNames } from "../../services/apiOrders";
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
      // Open orders that use the item show its new name (in the background: the save itself is done).
      void syncOrderMaterialNames(workspaceId, item.id, item.name)
        .then((orderIds) => {
          if (orderIds.length > 0) void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
        })
        .catch((error: unknown) => console.warn("[inventory] order line names not updated", error));
      await queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18n.t("inventory.toast.updated"), { id: "update-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("inventory.errors.saveFailed"), { id: "update-inventory" });
    },
  });
}
