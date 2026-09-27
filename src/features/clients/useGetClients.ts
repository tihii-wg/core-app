import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getClients } from "../../services/apiClients";

export function useGetClients(search: string) {
  const { workspaceId } = useParams();
  const {
    data: clients,
    isLoading,
    isPending,
    error,
  } = useQuery({
    queryKey: ["clients", workspaceId, search],
    queryFn: async () => {
      return await getClients(search);
    },
    enabled: Boolean(workspaceId),
  });

  if (error) throw new Error(error.message);
  return { clients, isLoading, isPending };
}
