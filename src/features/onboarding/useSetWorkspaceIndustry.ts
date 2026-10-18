import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setWorkspaceIndustry, type ListedWorkspaceMembership } from "../../services/apiWorkspaces";
import { rememberWorkspaceIndustry } from "./businessSetup";

export function useSetWorkspaceIndustry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, industryId }: { workspaceId: string; industryId: string }) => setWorkspaceIndustry(workspaceId, industryId),
    onSuccess(workspace) {
      if (!workspace?.industryId) return;
      queryClient.setQueryData(["workspace", workspace.id], workspace);
      queryClient.setQueryData<ListedWorkspaceMembership[]>(["workspaces"], (current) => (current ? rememberWorkspaceIndustry(current, workspace.id, workspace.industryId as string) : current));
    },
  });
}
