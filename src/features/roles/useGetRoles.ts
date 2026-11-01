import { useQuery } from "@tanstack/react-query";
import { getRoles } from "../../services/apiRoles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetRoles() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["roles", workspaceId],
    queryFn: () => getRoles(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
