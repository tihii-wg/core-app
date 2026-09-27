import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { InventoryListFilter, InventorySort } from "../../lib/types";
import { getInventoryItems } from "../../services/apiInventory";

export function useGetInventoryItems(search: string, filter: InventoryListFilter, sort: InventorySort) {
  const { workspaceId } = useParams();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory", workspaceId, search, filter, sort.field, sort.ascending],
    queryFn: () => getInventoryItems(search, filter, sort),
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
