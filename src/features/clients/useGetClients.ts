import { useQuery } from "@tanstack/react-query";
import { getClients } from "../../services/apiClients";

export function useGetClients(search: string) {
  const {
    data: clients,
    isLoading,
    isPending,
    error,
  } = useQuery({
    queryKey: ["clients", search],
    queryFn: async () => {
      return await getClients(search);
    },
  });

  if (error) throw new Error(error.message);
  return { clients, isLoading, isPending };
}
