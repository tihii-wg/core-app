import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { updateWorkspaceIndustry } from "../../services/apiWorkspaces";

type UpdateWorkspaceIndustryInput = {
  workspaceId: string;
  industryId: string;
};

export function useUpdateWorkspaceIndustry() {
  const queryClient = useQueryClient();

  const { mutateAsync, isPending } = useMutation({
    mutationFn: ({ workspaceId, industryId }: UpdateWorkspaceIndustryInput) => updateWorkspaceIndustry(workspaceId, industryId),
    onMutate() {
      toast.loading("Saving business type...", { id: "update-workspace-industry" });
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Business type updated", { id: "update-workspace-industry" });
    },
    onError(error) {
      toast.error(error.message, { id: "update-workspace-industry" });
    },
  });

  return { updateWorkspaceIndustry: mutateAsync, isPending };
}
