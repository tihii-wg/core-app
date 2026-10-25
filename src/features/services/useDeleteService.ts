import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { deleteService } from "../../services/apiServices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export default function useDeleteService() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (serviceId: string) => {
      guardWrite();
      return deleteService(serviceId, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("services.toast.deleting"), { id: "delete-service" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success(i18n.t("services.toast.deleted"), { id: "delete-service" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("services.toast.deleteFailed"), { id: "delete-service" });
    },
  });
}
