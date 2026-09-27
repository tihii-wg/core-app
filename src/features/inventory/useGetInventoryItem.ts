import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getInventoryItem } from "../../services/apiInventory";

export function useGetInventoryItem(inventoryItemId: string | null) {
  const { workspaceId } = useParams();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory", workspaceId, inventoryItemId],
    queryFn: () => getInventoryItem(inventoryItemId as string),
    enabled: Boolean(workspaceId && inventoryItemId),
  });

  return {
    item: data ?? null,
    isLoading,
    isError,
    error,
    refetch,
  };
}
