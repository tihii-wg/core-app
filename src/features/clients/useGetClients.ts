import { useQuery } from "@tanstack/react-query";
import { getClients } from "../../services/apiClients";

export function useGetClients() {
  const {
    data: clients,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["clients"],
		queryFn: getClients,
  });

  if (error) throw new Error(error.message);
  return { clients, isLoading };
}
