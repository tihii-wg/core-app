import { useQuery } from "@tanstack/react-query";
import { getLocations } from "../../services/apiLocations";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetLocations() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["locations", workspaceId],
    queryFn: () => getLocations(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
