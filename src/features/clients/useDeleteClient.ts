import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { softDeleteClient } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useDeleteClient() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (clientId: string) => {
      guardWrite();
      return softDeleteClient(workspaceId, clientId);
    },
    onMutate: () => {
      toast.loading(i18n.t("clients.toast.deleting"), { id: "delete-client" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      toast.success(i18n.t("clients.toast.deleted"), { id: "delete-client" });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "delete-client" });
    },
  });
}
