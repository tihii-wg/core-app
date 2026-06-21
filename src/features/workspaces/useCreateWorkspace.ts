import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createWorkspace } from "../../services/apiWorkspaces";

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}
