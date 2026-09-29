import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { createWorkspace } from "../../services/apiWorkspaces";

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
      toast.success("Workspace was created!", { id: "create-workspace" });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => {
      toast.error(error.message || "Could not create the workspace", { id: "create-workspace" });
    },
  });
}
