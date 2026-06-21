import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteWorkspace as deleteWorkspaceApi } from "../../services/apiWorkspaces";

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  const { mutateAsync: deleteWorkspace, isPending } = useMutation({
    mutationFn: deleteWorkspaceApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
  return { deleteWorkspace, isPending };
}
