import { useQuery } from "@tanstack/react-query";
import { getInventoryItem } from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetInventoryItem(inventoryItemId: string | null) {
  const { workspaceId } = useActiveWorkspaceId();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory", workspaceId, inventoryItemId],
    queryFn: () => getInventoryItem(inventoryItemId as string, workspaceId),
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
