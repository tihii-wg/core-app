import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "./useGetWorkspace";

export function useActiveWorkspaceRole() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  return workspace?.role ?? null;
}
