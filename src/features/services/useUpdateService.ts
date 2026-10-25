import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateService } from "../../services/apiServices";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { addNewServiceFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export default function useUpdateService() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: addNewServiceFormData) => {
      guardWrite();
      return updateService(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("services.toast.updating"), { id: "update-service" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success(i18n.t("services.toast.updated"), { id: "update-service" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("services.toast.genericError"), { id: "update-service" });
    },
  });
}
