import { useQuery } from "@tanstack/react-query";
import type { InventoryListFilter, InventorySort } from "../../lib/types";
import { getInventoryItems } from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetInventoryItems(search: string, filter: InventoryListFilter, sort: InventorySort) {
  const { workspaceId } = useActiveWorkspaceId();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory", workspaceId, search, filter, sort.field, sort.ascending],
    queryFn: () => getInventoryItems(search, filter, sort, workspaceId),
    enabled: Boolean(workspaceId),
  });

  return {
    items: data ?? [],
    isLoading,
    isError,
    error,
    refetch,
  };
}
