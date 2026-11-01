import { useQuery } from "@tanstack/react-query";
import { getEstimates } from "../../services/apiEstimates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetEstimates() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["estimates", workspaceId],
    queryFn: () => getEstimates(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
