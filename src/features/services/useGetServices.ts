import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getServiceCategoriesInUse, getServices, getServicesPage, type ServicesPageQuery } from "../../services/apiServices";
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

/** One page of the Services list, paginated in the database. Keeps the previous page on screen while loading. */
export function useServicesPage(params: ServicesPageQuery) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["services", workspaceId, "page", params],
    queryFn: () => getServicesPage(workspaceId, params),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

/** Categories used by this workspace's services (filter options). */
export function useServiceCategoriesInUse() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data } = useQuery({
    queryKey: ["services", workspaceId, "categories-in-use"],
    queryFn: () => getServiceCategoriesInUse(workspaceId),
    enabled: Boolean(workspaceId),
  });
  return data ?? [];
}
