import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createEmployee } from "../../services/apiEmployees";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";



export default function useCreateNewEmployee() {
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (input: Parameters<typeof createEmployee>[0]) => {
      guardWrite();
      return createEmployee(input);
    },
    onMutate: () => {
      toast.loading(i18n.t("employees.toast.creating"), { id: "create-employee" });
    },
    onSuccess: (_data, { workspace_id }) => {
      queryClient.invalidateQueries({ queryKey: ["employees", workspace_id] });
      toast.success(i18n.t("employees.toast.created"), { id: "create-employee" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("employees.toast.genericError"), { id: "create-employee" });
    },
  });
}
