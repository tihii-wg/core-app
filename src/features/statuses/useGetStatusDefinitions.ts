import { useQuery } from "@tanstack/react-query";
import { getStatusDefinitions, type StatusEntity } from "../../services/apiStatusDefinitions";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetStatusDefinitions(entity?: StatusEntity) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["status_definitions", workspaceId, entity ?? "all"],
    queryFn: () => getStatusDefinitions(workspaceId, entity),
    enabled: Boolean(workspaceId),
  });
}
