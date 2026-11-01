import { useQuery } from "@tanstack/react-query";
import { getWarehouseStock } from "../../services/apiWarehouseStock";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetWarehouseStock(inventoryItemId?: string, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["warehouse-stock", workspaceId, inventoryItemId ?? "all"],
    queryFn: () => getWarehouseStock(workspaceId, inventoryItemId ? { inventoryItemId } : undefined),
    enabled: Boolean(workspaceId) && enabled,
  });
}
