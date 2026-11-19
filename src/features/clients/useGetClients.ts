import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ClientListFilter } from "../../lib/types";
import { getClients, getClientsPage } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetClients(
  search: string,
  clientType: ClientListFilter = "all",
  { enabled = true, includeVehicleMatches = true }: { enabled?: boolean; includeVehicleMatches?: boolean } = {},
) {
  const { workspaceId } = useActiveWorkspaceId();
  const {
    data: clients,
    isLoading,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ["clients", workspaceId, search, clientType, includeVehicleMatches],
    queryFn: () => getClients(search, workspaceId, clientType, { includeVehicleMatches }),
    enabled: Boolean(workspaceId) && enabled,
  });

  return { clients, isLoading, isPending, error, refetch };
}

/** One page of the Clients list, paginated in the database. Keeps the previous page on screen while loading. */
export function useClientsPage(params: { search: string; clientType: ClientListFilter; page: number; pageSize: number }) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["clients", workspaceId, "page", params],
    queryFn: () => getClientsPage(workspaceId, params),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

/** Rows a client picker shows at most; typing narrows the search (done in the database). */
export const CLIENT_PICKER_LIMIT = 50;

/**
 * Client picker search: the first CLIENT_PICKER_LIMIT matches from the database (newest first),
 * not the whole client list when the search box is empty.
 */
export function useClientPickerSearch(
  search: string,
  { enabled = true, includeVehicleMatches = true }: { enabled?: boolean; includeVehicleMatches?: boolean } = {},
) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading, isPending, error } = useQuery({
    queryKey: ["clients", workspaceId, "picker", search, includeVehicleMatches],
    queryFn: () => getClientsPage(workspaceId, { search, page: 1, pageSize: CLIENT_PICKER_LIMIT, includeVehicleMatches }),
    enabled: Boolean(workspaceId) && enabled,
    placeholderData: keepPreviousData,
  });
  return { clients: data?.rows, total: data?.total ?? 0, isLoading, isPending, error };
}
