import { useQuery } from "@tanstack/react-query";
import { getCategories, type CategoryScope } from "../../services/apiCategories";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetCategories(scope?: CategoryScope) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["categories", workspaceId, scope ?? "all"],
    queryFn: () => getCategories(workspaceId, scope),
    enabled: Boolean(workspaceId),
  });
}
