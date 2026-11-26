import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getWarehouseStock, getWarehouseStockForItems } from "../../services/apiWarehouseStock";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useGetWarehouseStock(inventoryItemId?: string, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["warehouse-stock", workspaceId, inventoryItemId ?? "all"],
    queryFn: () => getWarehouseStock(workspaceId, inventoryItemId ? { inventoryItemId } : undefined),
    enabled: Boolean(workspaceId) && enabled,
  });
}

const NO_STOCK: Awaited<ReturnType<typeof getWarehouseStockForItems>> = [];

/**
 * Stock of the items on screen only (an order's materials, the visible search results). Under the usual
 * ["warehouse-stock", workspaceId] prefix, so issue / return / receipt invalidations refresh it.
 */
export function useWarehouseStockForItems(inventoryItemIds: readonly (string | null | undefined)[], enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  const ids = useMemo(
    () => [...new Set(inventoryItemIds.map((id) => id?.trim() ?? "").filter(Boolean))].sort(),
    [inventoryItemIds],
  );
  const query = useQuery({
    queryKey: ["warehouse-stock", workspaceId, "items", ids],
    queryFn: () => getWarehouseStockForItems(workspaceId, ids),
    enabled: Boolean(workspaceId) && enabled && ids.length > 0,
    placeholderData: keepPreviousData,
  });
  return { ...query, data: query.data ?? NO_STOCK };
}
