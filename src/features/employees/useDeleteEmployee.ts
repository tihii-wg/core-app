import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { deactivateEmployee } from "../../services/apiEmployees";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (employeeId: string) => {
      guardWrite();
      return deactivateEmployee(workspaceId, employeeId);
    },
    onMutate: () => {
      toast.loading(i18n.t("employees.toast.deleting"), { id: "delete-employee" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      toast.success(i18n.t("employees.toast.deleted"), { id: "delete-employee" });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "delete-employee" });
    },
  });
}
