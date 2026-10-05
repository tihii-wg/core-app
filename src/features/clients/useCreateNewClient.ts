import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "../../services/apiClients";
import toast from "react-hot-toast";
import i18n from "../../i18n";

export function useCreateNewClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createClient,
    onMutate: () => {
      toast.loading(i18n.t("clients.toast.creating"), { id: "create-client" });
    },
    onSuccess: (_data, { workspace_id }) => {
      queryClient.invalidateQueries({ queryKey: ["clients", workspace_id] });
      toast.success(i18n.t("clients.toast.created"), { id: "create-client" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("clients.toast.createFailed"), { id: "create-client" });
    },
  });
}
