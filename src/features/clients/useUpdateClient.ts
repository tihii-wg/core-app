import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateClient } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: Parameters<typeof updateClient>[0]) => updateClient(input, workspaceId),
    onMutate: () => {
      toast.loading(i18n.t("clients.toast.updating"), { id: "update-client" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      toast.success(i18n.t("clients.toast.updated"), { id: "update-client" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "update-client" });
    },
  });
}
