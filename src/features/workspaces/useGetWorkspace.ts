import { useQuery } from "@tanstack/react-query";
import { getWorkspace } from "../../services/apiWorkspaces";

export function useGetWorkspace(workspaceId?: string) {
  return useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}
