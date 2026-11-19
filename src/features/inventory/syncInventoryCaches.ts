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

  const replaceIn = (rows: InventoryItem[]) => {
    let changed = false;
    const next = rows.map((row) => {
      if (row.id !== item.id) return row;
      changed = true;
      return item;
    });
    return changed ? next : rows;
  };

  queryClient.setQueriesData<unknown>({ queryKey: ["inventory", workspaceId] }, (current: unknown) => {
    if (Array.isArray(current)) return replaceIn(current as InventoryItem[]);
    // Server page ({ rows }) of the Parts list.
    if (current && typeof current === "object" && Array.isArray((current as { rows?: unknown }).rows)) {
      const page = current as { rows: InventoryItem[] };
      const rows = replaceIn(page.rows);
      return rows === page.rows ? current : { ...page, rows };
    }
    if (current && typeof current === "object" && "id" in current && (current as InventoryItem).id === item.id) {
      return item;
    }
    return current;
  });
}
