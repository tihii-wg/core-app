import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { updateEmployee } from "../../services/apiEmployees";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: Parameters<typeof updateEmployee>[0]) => {
      guardWrite();
      return updateEmployee(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("employees.toast.updating"), { id: "update-employee" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees", workspaceId] });
      toast.success(i18n.t("employees.toast.updated"), { id: "update-employee" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("employees.toast.genericError"), { id: "update-employee" });
    },
  });
}
