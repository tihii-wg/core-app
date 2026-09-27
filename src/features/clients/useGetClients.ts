import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { ClientListFilter } from "../../lib/types";
import { getClients } from "../../services/apiClients";

export function useGetClients(search: string, clientType: ClientListFilter = "all") {
  const { workspaceId } = useParams();
  const {
    data: clients,
    isLoading,
    isPending,
    error,
  } = useQuery({
    queryKey: ["clients", workspaceId, search, clientType],
    queryFn: async () => {
      return await getClients(search, workspaceId, clientType);
    },
    enabled: Boolean(workspaceId),
  });

  if (error) throw new Error(error.message);
  return { clients, isLoading, isPending };
}
