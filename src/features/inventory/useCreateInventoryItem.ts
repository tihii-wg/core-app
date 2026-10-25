import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createInventoryItem } from "../../services/apiInventory";
import type { InventoryItemFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { syncInventoryItemCaches } from "./syncInventoryCaches";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useCreateInventoryItem() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: InventoryItemFormData) => {
      guardWrite();
      return createInventoryItem(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("inventory.toast.creating"), { id: "create-inventory" });
    },
    onSuccess: async (item) => {
      syncInventoryItemCaches(queryClient, workspaceId, item);
      await queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18n.t("inventory.toast.created"), { id: "create-inventory" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("inventory.errors.saveFailed"), { id: "create-inventory" });
    },
  });
}
