import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateWorkspaceDetails } from "../../services/apiWorkspaces";

type UpdateWorkspaceInput = {
  workspaceId: string;
  name: string;
  industryId: string;
};

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, name, industryId }: UpdateWorkspaceInput) => updateWorkspaceDetails(workspaceId, { name, industryId }),
    onMutate() {
      toast.loading("Saving company...", { id: "update-workspace" });
    },
    onSuccess(_data, { workspaceId }) {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Company updated", { id: "update-workspace" });
    },
    onError(error) {
      toast.error(error.message || "Could not update the company", { id: "update-workspace" });
    },
  });
}
