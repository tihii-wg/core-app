import { useQuery } from "@tanstack/react-query";
import { getStatusTransitions } from "../../services/apiStatusDefinitions";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetStatusTransitions() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["status_transitions", workspaceId],
    queryFn: () => getStatusTransitions(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
