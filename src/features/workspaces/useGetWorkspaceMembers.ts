import { useQuery } from "@tanstack/react-query";
import { getWorkspaceMembers } from "../../services/apiWorkspaces";
import { useGetProfile } from "../profiles/useGetProfile";

export function useGetWorkspaceMembers() {
  const { data: profile, isLoading: profileLoading, error: profileError } = useGetProfile();
  const activeWorkspaceId = profile?.active_workspace_id ?? undefined;
  const query = useQuery({
    queryKey: ["workspace-members", activeWorkspaceId],
    queryFn: () => getWorkspaceMembers(activeWorkspaceId ?? ""),
    enabled: Boolean(activeWorkspaceId),
    retry: false,
  });

  return {
    workspaceId: activeWorkspaceId,
    members: query.data,
    error: profileError ?? query.error,
    isLoading: profileLoading || query.isLoading,
  };
}
