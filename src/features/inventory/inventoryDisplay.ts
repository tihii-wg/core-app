import type { InventoryItem } from "../../lib/types";

export function quantityClass(item: InventoryItem) {
  if (item.stockStatus === "out_of_stock") return "text-destructive font-medium";
  if (item.stockStatus === "low_stock") return "text-warning font-medium";
  return "text-foreground";
}
