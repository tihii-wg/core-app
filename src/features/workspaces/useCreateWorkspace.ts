import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { createWorkspace } from "../../services/apiWorkspaces";
import i18n from "../../i18n";

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
      toast.success(i18n.t("workspaces.toast.created"), { id: "create-workspace" });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("workspaces.toast.createFailed"), { id: "create-workspace" });
    },
  });
}
