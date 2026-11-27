import { useQuery } from "@tanstack/react-query";
import { getUserWorkspaces, normalizeWorkspaceLanguage, type ListedWorkspaceMembership } from "../../services/apiWorkspaces";

export function useGetWorkspaces() {
  const {
    data: workspaces,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["workspaces"],
    queryFn: getUserWorkspaces,
  });
  return { workspaces, isLoading, error, refetch };
}

/** The workspace's interface language from the membership list, or null when it is not there. */
export function listedWorkspaceLanguage(memberships: ListedWorkspaceMembership[] | undefined, workspaceId: string) {
  for (const item of memberships ?? []) {
    const entries = Array.isArray(item.workspaces) ? item.workspaces : item.workspaces ? [item.workspaces] : [];
    const match = entries.find((entry) => entry.id === workspaceId);
    if (match) return match.language ? normalizeWorkspaceLanguage(match.language) : null;
  }
  return null;
}

export function listedWorkspaceIds(memberships: ListedWorkspaceMembership[] | undefined) {
  return (memberships ?? []).flatMap((item) => {
    const workspace = item.workspaces;
    if (!workspace) return [];
    const entries = Array.isArray(workspace) ? workspace : [workspace];
    return entries.flatMap((entry) => (entry.id ? [entry.id] : []));
  });
}
