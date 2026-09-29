import { useQuery } from "@tanstack/react-query";
import { getUserWorkspaces, type ListedWorkspaceMembership } from "../../services/apiWorkspaces";

export function useGetWorkspaces() {
  const {
    data: workspaces,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["workspaces"],
    queryFn: getUserWorkspaces,
  });
  return { workspaces, isLoading, error };
}

export function listedWorkspaceIds(memberships: ListedWorkspaceMembership[] | undefined) {
  return (memberships ?? []).flatMap((item) => {
    const workspace = item.workspaces;
    if (!workspace) return [];
    const entries = Array.isArray(workspace) ? workspace : [workspace];
    return entries.flatMap((entry) => (entry.id ? [entry.id] : []));
  });
}
