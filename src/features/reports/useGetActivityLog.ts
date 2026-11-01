import { useQuery } from "@tanstack/react-query";
import { getActivityLog } from "../../services/apiActivityLog";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetActivityLog(limit = 100) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["activity_log", workspaceId, limit],
    queryFn: () => getActivityLog(workspaceId, limit),
    enabled: Boolean(workspaceId),
  });
}
