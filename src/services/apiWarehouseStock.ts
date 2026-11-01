import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

export type WarehouseStockRecord = {
  id: string;
  workspaceId: string;
  warehouseId: string;
  inventoryItemId: string;
  itemName: string;
  binLocationId: string | null;
  quantity: number;
  minQuantity: number | null;
  maxQuantity: number | null;
};

const stockColumns =
  "id, workspace_id, warehouse_id, inventory_item_id, bin_location_id, quantity, min_quantity, max_quantity";

function toNumber(value: unknown, fallback: number): number;
function toNumber(value: unknown, fallback: null): number | null;
function toNumber(value: unknown, fallback: number | null) {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toWarehouseStock(row: Record<string, unknown>, itemNames: Map<string, string>): WarehouseStockRecord {
  const inventoryItemId = String(row.inventory_item_id);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    warehouseId: String(row.warehouse_id),
    inventoryItemId,
    itemName: itemNames.get(inventoryItemId) ?? "",
    binLocationId: row.bin_location_id ? String(row.bin_location_id) : null,
    quantity: toNumber(row.quantity, 0),
    minQuantity: toNumber(row.min_quantity, null),
    maxQuantity: toNumber(row.max_quantity, null),
  };
}

/**
 * Per-warehouse stock for the workspace. Returns [] when `warehouse_stock` is not applied yet.
 * Item names come from a second `inventory_items` lookup (no FK embed, so a missing relation never breaks the read).
 */
export async function getWarehouseStock(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("warehouse_stock")
    .select(stockColumns)
    .eq("workspace_id", resolved)
    .order("warehouse_id", { ascending: true });

  if (error) {
    if (isMissingTableError(error, "warehouse_stock")) return [] as WarehouseStockRecord[];
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const itemIds = [...new Set(rows.map((row) => String(row.inventory_item_id)))];
  const itemNames = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("inventory_items")
      .select("id, name")
      .eq("workspace_id", resolved)
      .in("id", itemIds);
    // Names are best-effort; stock quantities still render without them.
    if (!itemsError) {
      for (const item of (items ?? []) as Record<string, unknown>[]) {
        if (typeof item.name === "string") itemNames.set(String(item.id), item.name);
      }
    }
  }

  return rows.map((row) => toWarehouseStock(row, itemNames));
}
