import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { purgeInventoryItem } from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function usePurgeInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (inventoryItemId: string) => {
      guardWrite();
      return purgeInventoryItem(inventoryItemId, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("inventory.toast.deleting"), { id: "purge-inventory" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["warehouses", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      toast.success(i18n.t("inventory.purge.toast.purged"), { id: "purge-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("inventory.errors.deleteFailed"), { id: "purge-inventory" });
    },
  });
}
