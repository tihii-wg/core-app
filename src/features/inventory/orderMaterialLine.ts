import type { InventoryItem, OrderMaterial } from "../../lib/types";
import { orderLineAmount } from "../services/orderServiceLine";

/**
 * Accepts only positive integers (live order_materials quantity columns are integer).
 * Does not round fractions. Empty / invalid / fractional / non-positive → null.
 */
export function parseOrderMaterialQuantity(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const number = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : value);
  if (!Number.isFinite(number)) return null;
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

/** Positive integer, or 0 when missing/invalid (for consolidate / skip-invalid paths). Never rounds. */
export function normalizeOrderMaterialQuantity(value: unknown): number {
  return parseOrderMaterialQuantity(value) ?? 0;
}

/**
 * Snapshots the inventory item's current name and selling price onto a new order material line.
 * Later catalog edits must not rewrite this line — order_materials stores its own price/name.
 */
export function catalogItemToOrderMaterial(item: Pick<InventoryItem, "id" | "name" | "sellingPrice">, quantity = 1): OrderMaterial {
  const qty = parseOrderMaterialQuantity(quantity);
  if (qty == null) {
    throw new Error("Material quantity must be a positive whole number");
  }
  return {
    inventoryItemId: item.id,
    itemName: item.name,
    price: item.sellingPrice ?? 0,
    quantity: qty,
  };
}

export function consolidateOrderMaterials(materials: OrderMaterial[]): OrderMaterial[] {
  const byItem = new Map<string, OrderMaterial>();
  for (const line of materials) {
    const itemId = line.inventoryItemId?.trim();
    if (!itemId) continue;
    const quantity = parseOrderMaterialQuantity(line.quantity);
    if (quantity == null) continue;
    const existing = byItem.get(itemId);
    if (existing) {
      existing.quantity = existing.quantity + quantity;
      continue;
    }
    byItem.set(itemId, {
      ...(line.id ? { id: line.id } : {}),
      inventoryItemId: itemId,
      itemName: line.itemName,
      price: Number(line.price) || 0,
      quantity,
      ...(line.quantityIssued != null ? { quantityIssued: line.quantityIssued } : {}),
      ...(line.quantityReturned != null ? { quantityReturned: line.quantityReturned } : {}),
    });
  }
  return [...byItem.values()];
}

export function sumOrderMaterialLines(lines: Array<Pick<OrderMaterial, "price" | "quantity">> | undefined): number {
  return (lines ?? []).reduce((total, line) => {
    const quantity = parseOrderMaterialQuantity(line.quantity) ?? 0;
    return total + orderLineAmount({ price: line.price, quantity });
  }, 0);
}
