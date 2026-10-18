import type { InventoryItem } from "../../lib/types";
import { effectiveStockStatus } from "./stockStatus";

export function quantityClass(item: InventoryItem) {
  const status = effectiveStockStatus(item);
  if (status === "out_of_stock") return "text-destructive font-medium";
  if (status === "low_stock") return "text-warning font-medium";
  return "text-foreground";
}
