import { useQuery } from "@tanstack/react-query";
import { getMyOpenTasks, getTasks, type TaskScope } from "../../services/apiTasks";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetTasks(scope: TaskScope = "all") {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["tasks", workspaceId, scope],
    queryFn: () => getTasks(workspaceId, scope),
    enabled: Boolean(workspaceId),
  });
}

/** Open tasks assigned to me — polled so a newly assigned task shows up without a reload. */
export function useMyOpenTasks() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["tasks", workspaceId, "my-open"],
    queryFn: () => getMyOpenTasks(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}
