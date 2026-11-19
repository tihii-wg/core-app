import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getServiceCategoriesInUse,
  getServices,
  getServicesByIds,
  getServicesPage,
  searchServices,
  type ServiceSearchInput,
  type ServicesPageQuery,
} from "../../services/apiServices";
import type { Service, serviceCategory } from "../../lib/types";
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

/** Picker search in the database (debounce the query in the caller). Keeps the previous result while typing. */
export function useServiceSearch(input: ServiceSearchInput, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading } = useQuery({
    queryKey: ["services", workspaceId, "search", input.query.trim().toLowerCase(), input.activeOnly !== false, input.limit ?? 30],
    queryFn: () => searchServices(workspaceId, input),
    enabled: Boolean(workspaceId) && enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  return { services: data?.services ?? EMPTY_SERVICES, total: data?.total ?? 0, isLoading };
}

/** Services by id (the order's lines) — for catalog prices / names of what is already in the order. */
export function useServicesByIds(ids: readonly string[], { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const sorted = [...new Set(ids.filter(Boolean))].sort();
  const { data } = useQuery({
    queryKey: ["services", workspaceId, "by-ids", sorted],
    queryFn: () => getServicesByIds(workspaceId, sorted),
    enabled: Boolean(workspaceId) && enabled && sorted.length > 0,
    placeholderData: keepPreviousData,
  });
  return { services: sorted.length === 0 ? EMPTY_SERVICES : (data ?? EMPTY_SERVICES) };
}

const EMPTY_SERVICES: Service[] = [];
