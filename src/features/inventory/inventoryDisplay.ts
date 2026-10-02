import type { InventoryItem } from "../../lib/types";

export function quantityClass(item: InventoryItem) {
  if (item.stockStatus === "out_of_stock") return "text-[#f41f20] font-medium";
  if (item.stockStatus === "low_stock") return "text-[#f89200] font-medium";
  return "text-[#282e33]";
}
