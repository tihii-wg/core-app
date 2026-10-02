import { useQuery } from "@tanstack/react-query";
import type { ClientListFilter } from "../../lib/types";
import { getClients } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetClients(search: string, clientType: ClientListFilter = "all", { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const {
    data: clients,
    isLoading,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ["clients", workspaceId, search, clientType],
    queryFn: () => getClients(search, workspaceId, clientType),
    enabled: Boolean(workspaceId) && enabled,
  });

  return { clients, isLoading, isPending, error, refetch };
}
