import { useQuery } from "@tanstack/react-query";
import { getServices } from "../../services/apiServices";
import type { serviceCategory } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export default function useGetServices(search?: string, categoriesFilter?: serviceCategory) {
  const { workspaceId } = useActiveWorkspaceId();
  const {
    data: services,
    error,
    isLoading,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ["services", workspaceId, search, categoriesFilter],
    queryFn: () => getServices(workspaceId, search, categoriesFilter),
    enabled: Boolean(workspaceId),
  });

  return { services: services ?? [], error, isLoading, isPending, refetch };
}
