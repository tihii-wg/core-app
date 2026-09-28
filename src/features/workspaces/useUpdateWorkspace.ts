import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateWorkspaceDetails, updateWorkspacePreferences, type WorkspacePreferencesInput } from "../../services/apiWorkspaces";

type UpdateWorkspaceInput = {
  workspaceId: string;
  name: string;
  industryId: string;
  inventoryMarkup: number;
};

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, name, industryId, inventoryMarkup }: UpdateWorkspaceInput) => updateWorkspaceDetails(workspaceId, { name, industryId, inventoryMarkup }),
    onMutate() {
      toast.loading("Saving company...", { id: "update-workspace" });
    },
    onSuccess(_data, { workspaceId }) {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-markup", workspaceId] });
      toast.success("Company updated", { id: "update-workspace" });
    },
    onError(error) {
      toast.error(error.message || "Could not update the company", { id: "update-workspace" });
    },
  });
}

export function useUpdateWorkspacePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, ...preferences }: WorkspacePreferencesInput & { workspaceId: string }) => updateWorkspacePreferences(workspaceId, preferences),
    onSuccess(workspace) {
      if (!workspace) return;
      queryClient.setQueryData(["workspace", workspace.id], workspace);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}
