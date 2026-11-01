import { useQuery } from "@tanstack/react-query";
import { getLeads } from "../../services/apiLeads";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetLeads() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["leads", workspaceId],
    queryFn: () => getLeads(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
