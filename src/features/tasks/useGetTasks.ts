import { useQuery } from "@tanstack/react-query";
import { getTasks } from "../../services/apiTasks";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetTasks() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["tasks", workspaceId],
    queryFn: () => getTasks(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
