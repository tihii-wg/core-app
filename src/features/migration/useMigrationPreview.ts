import { useQuery } from "@tanstack/react-query";
import { getMigrationPreview } from "../../services/apiMigrationPreview";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useMigrationPreview() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["migration-preview", workspaceId],
    queryFn: () => getMigrationPreview(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}
