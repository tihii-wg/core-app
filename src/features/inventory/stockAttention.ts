import type { InventoryItem, InventoryStockStatus } from "../../lib/types";
import { effectiveStockStatus, needsStockAttention } from "./stockStatus";

export type StockAttentionSummary = {
  /** Active items that are out of stock or low stock, out-of-stock first. */
  items: InventoryItem[];
  lowCount: number;
  outCount: number;
  attentionCount: number;
};

function statusRank(status: InventoryStockStatus) {
  if (status === "out_of_stock") return 0;
  if (status === "low_stock") return 1;
  return 2;
}

/**
 * Active inventory needing attention using quantity-derived stock rules
 * (quantity ≤ 0 → out; quantity ≤ minQuantity → low). Inactive items are omitted.
 */
export function stockAttentionSummary(items: InventoryItem[]): StockAttentionSummary {
  const attention = items
    .filter(needsStockAttention)
    .map((item) => ({ ...item, stockStatus: effectiveStockStatus(item) }))
    .sort(
      (a, b) =>
        statusRank(a.stockStatus) - statusRank(b.stockStatus) ||
        a.quantity - b.quantity ||
        a.name.localeCompare(b.name),
    );

  const outCount = attention.filter((item) => item.stockStatus === "out_of_stock").length;
  const lowCount = attention.filter((item) => item.stockStatus === "low_stock").length;

  return {
    items: attention,
    lowCount,
    outCount,
    attentionCount: attention.length,
  };
}
