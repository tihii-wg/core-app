import type { InventoryItem, InventoryStockStatus } from "../../lib/types";

/**
 * Mirrors public.inventory_items_with_status:
 * quantity <= 0 → out_of_stock; quantity <= min_quantity → low_stock; else in_stock.
 * When min_quantity is 0, low_stock never appears (only out_of_stock at qty <= 0).
 */
export function stockStatusFromQuantities(quantity: number, minQuantity: number): InventoryStockStatus {
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= minQuantity) return "low_stock";
  return "in_stock";
}

/** Active items that need warehouse attention (low or out). Always derived from quantity. */
export function needsStockAttention(
  item: Pick<InventoryItem, "isActive" | "quantity" | "minQuantity" | "stockStatus">,
): boolean {
  if (!item.isActive) return false;
  const status = stockStatusFromQuantities(item.quantity, item.minQuantity);
  return status === "out_of_stock" || status === "low_stock";
}

/** Prefer quantity-derived status so UI never shows a stale stockStatus after a stock change. */
export function effectiveStockStatus(
  item: Pick<InventoryItem, "quantity" | "minQuantity" | "stockStatus">,
): InventoryStockStatus {
  return stockStatusFromQuantities(item.quantity, item.minQuantity);
}
