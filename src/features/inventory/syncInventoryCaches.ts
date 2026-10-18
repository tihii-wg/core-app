import type { QueryClient } from "@tanstack/react-query";
import type { InventoryItem } from "../../lib/types";

/**
 * Writes a fresh inventory item into every matching React Query cache entry
 * (detail + list queries) so Parts table status/quantity update without a reload.
 */
export function syncInventoryItemCaches(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  item: InventoryItem,
) {
  if (!workspaceId) return;

  queryClient.setQueryData<InventoryItem>(["inventory", workspaceId, item.id], item);

  queryClient.setQueriesData<InventoryItem[] | InventoryItem | null>({ queryKey: ["inventory", workspaceId] }, (current) => {
    if (Array.isArray(current)) {
      let changed = false;
      const next = current.map((row) => {
        if (row.id !== item.id) return row;
        changed = true;
        return item;
      });
      return changed ? next : current;
    }
    if (current && typeof current === "object" && "id" in current && current.id === item.id) {
      return item;
    }
    return current;
  });
}
