import { useQuery } from "@tanstack/react-query";
import { getServices } from "../../services/apiServices";
import type { serviceCategory } from "../../lib/types";

export default function useGetServices(search?: string, categoriesFilter?: serviceCategory) {


	
  const {
    data: services,
    error,
    isLoading,
    isPending,
  } = useQuery({
    queryKey: ["services", search, categoriesFilter],
    queryFn: () => getServices(search, categoriesFilter),
  });

  if (error) throw new Error(error.message);

  return { services, error, isLoading, isPending };
}
