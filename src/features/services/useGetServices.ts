import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getServices } from "../../services/apiServices";
import type { serviceCategory } from "../../lib/types";

export default function useGetServices(search?: string, categoriesFilter?: serviceCategory) {
  const { workspaceId } = useParams();
  const {
    data: services,
    error,
    isLoading,
    isPending,
  } = useQuery({
    queryKey: ["services", workspaceId, search, categoriesFilter],
    queryFn: () => getServices(search, categoriesFilter),
    enabled: Boolean(workspaceId),
  });

  if (error) throw new Error(error.message);

  return { services, error, isLoading, isPending };
}
