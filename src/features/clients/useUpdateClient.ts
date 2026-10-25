import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateClient } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: Parameters<typeof updateClient>[0]) => {
      guardWrite();
      return updateClient(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("clients.toast.updating"), { id: "update-client" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      // Orders embed clients.client_type; keep tax-invoice rules in sync when type changes.
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      toast.success(i18n.t("clients.toast.updated"), { id: "update-client" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "update-client" });
    },
  });
}
