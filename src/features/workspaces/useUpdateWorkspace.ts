import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateWorkspaceDetails } from "../../services/apiWorkspaces";

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
