import type { InventoryItem, MileageUnit, OrderMaterial, OrderMaterialSupplySource } from "../../lib/types";
import { parseQuantity, roundQuantity } from "../../lib/quantity";
import {
  catalogWarrantyFromDbRow,
  resolveOrderLineWarrantyForKind,
  type CatalogWarrantyDefaults,
} from "../orders/catalogWarranty";
import type { WorkspaceWarrantyDefaults } from "../orders/warranty";
import { orderLineAmount } from "../services/orderServiceLine";

/**
 * Positive quantity with at most 2 decimals (matches order_materials / sync RPCs).
 * Empty / invalid / >2 decimals / non-positive → null.
 */
export function parseOrderMaterialQuantity(value: unknown): number | null {
  const parsed = parseQuantity(value);
  return typeof parsed === "number" ? parsed : null;
}

/** Positive quantity, or 0 when missing/invalid (for consolidate / skip-invalid paths). */
export function normalizeOrderMaterialQuantity(value: unknown): number {
  return parseOrderMaterialQuantity(value) ?? 0;
}

export function resolveMaterialSupplySource(line: Pick<OrderMaterial, "inventoryItemId" | "supplySource">): OrderMaterialSupplySource {
  if (line.supplySource === "one_time" || line.supplySource === "customer" || line.supplySource === "catalog") {
    return line.supplySource;
  }
  return line.inventoryItemId?.trim() ? "catalog" : "one_time";
}

/** True when the line is linked to the inventory catalog and can participate in warehouse issue/return. */
export function isCatalogOrderMaterial(line: Pick<OrderMaterial, "inventoryItemId" | "supplySource">): boolean {
  return resolveMaterialSupplySource(line) === "catalog" && Boolean(line.inventoryItemId?.trim());
}

export function catalogWarrantyFromInventoryItem(
  item: Partial<Pick<InventoryItem, "warrantyType" | "warrantyMonths" | "warrantyKm">> & {
    warranty_type?: unknown;
    warranty_months?: unknown;
    warranty_km?: unknown;
  },
): CatalogWarrantyDefaults {
  if (item.warrantyType !== undefined || item.warrantyMonths !== undefined || item.warrantyKm !== undefined) {
    return catalogWarrantyFromDbRow({
      warranty_type: item.warrantyType,
      warranty_months: item.warrantyMonths,
      warranty_km: item.warrantyKm,
    });
  }
  return catalogWarrantyFromDbRow({
    warranty_type: item.warranty_type,
    warranty_months: item.warranty_months,
    warranty_km: item.warranty_km,
  });
}

/**
 * Snapshots the inventory item's current name, selling price, and warranty defaults onto a new order material line.
 * Later catalog edits must not rewrite this line — order_materials stores its own price/name/warranty.
 * `warehouseId` is required for warehouse-first immediate issue when the line is saved.
 */
export function catalogItemToOrderMaterial(
  item: Pick<InventoryItem, "id" | "name" | "sellingPrice"> &
    Partial<Pick<InventoryItem, "warrantyType" | "warrantyMonths" | "warrantyKm">>,
  quantity = 1,
  warehouseId?: string,
  workspaceDefaults?: WorkspaceWarrantyDefaults | null,
  orderUnit: MileageUnit = "km",
): OrderMaterial {
  const qty = parseOrderMaterialQuantity(quantity);
  if (qty == null) {
    throw new Error("Material quantity must be a positive number with at most 2 decimals");
  }
  const warehouse = warehouseId?.trim();
  const warranty = resolveOrderLineWarrantyForKind(
    catalogWarrantyFromInventoryItem(item),
    workspaceDefaults ?? null,
    "material",
    orderUnit,
  );
  return {
    inventoryItemId: item.id,
    itemName: item.name,
    price: item.sellingPrice ?? 0,
    quantity: qty,
    supplySource: "catalog",
    warrantyMonths: warranty.warrantyMonths,
    warrantyDays: warranty.warrantyDays,
    warrantyKm: warranty.warrantyKm,
    ...(warehouse ? { warehouseId: warehouse } : {}),
  };
}

/** Order-only material: no catalog id, no warehouse stock impact. */
export function freeformOrderMaterial(input: {
  itemName: string;
  price: number;
  quantity?: number;
  supplySource: Exclude<OrderMaterialSupplySource, "catalog">;
}): OrderMaterial {
  const name = input.itemName.trim();
  if (!name) throw new Error("Material name is required");
  const qty = parseOrderMaterialQuantity(input.quantity ?? 1);
  if (qty == null) throw new Error("Material quantity must be a positive number with at most 2 decimals");
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("Material price cannot be negative");
  return {
    itemName: name,
    price,
    quantity: qty,
    supplySource: input.supplySource,
  };
}

/**
 * Consolidates catalog lines by inventory item id; keeps one-time/customer lines separate
 * (merged only when they already share the same saved order_materials.id).
 */
export function consolidateOrderMaterials(materials: OrderMaterial[]): OrderMaterial[] {
  const catalogByItem = new Map<string, OrderMaterial>();
  const freeform: OrderMaterial[] = [];

  for (const line of materials) {
    const quantity = parseOrderMaterialQuantity(line.quantity);
    if (quantity == null) continue;
    const source = resolveMaterialSupplySource(line);
    const itemId = line.inventoryItemId?.trim() ?? "";

    if (source === "catalog" && itemId) {
      const existing = catalogByItem.get(itemId);
      if (existing) {
        existing.quantity = roundQuantity(existing.quantity + quantity);
        continue;
      }
      const warehouse = line.warehouseId?.trim();
      catalogByItem.set(itemId, {
        ...(line.id ? { id: line.id } : {}),
        inventoryItemId: itemId,
        itemName: line.itemName,
        price: Number(line.price) || 0,
        quantity,
        supplySource: "catalog",
        ...(warehouse ? { warehouseId: warehouse } : {}),
        ...(line.quantityIssued != null ? { quantityIssued: line.quantityIssued } : {}),
        ...(line.quantityReturned != null ? { quantityReturned: line.quantityReturned } : {}),
        ...(line.warrantyMonths !== undefined ? { warrantyMonths: line.warrantyMonths } : {}),
        ...(line.warrantyDays !== undefined ? { warrantyDays: line.warrantyDays } : {}),
        ...(line.warrantyKm !== undefined ? { warrantyKm: line.warrantyKm } : {}),
      });
      continue;
    }

    freeform.push({
      ...(line.id ? { id: line.id } : {}),
      itemName: line.itemName.trim(),
      price: Number(line.price) || 0,
      quantity,
      supplySource: source === "customer" ? "customer" : "one_time",
      ...(line.quantityIssued != null ? { quantityIssued: line.quantityIssued } : {}),
      ...(line.quantityReturned != null ? { quantityReturned: line.quantityReturned } : {}),
      ...(line.warrantyMonths !== undefined ? { warrantyMonths: line.warrantyMonths } : {}),
      ...(line.warrantyDays !== undefined ? { warrantyDays: line.warrantyDays } : {}),
      ...(line.warrantyKm !== undefined ? { warrantyKm: line.warrantyKm } : {}),
    });
  }

  return [...catalogByItem.values(), ...freeform];
}

export function sumOrderMaterialLines(lines: Array<Pick<OrderMaterial, "price" | "quantity">> | undefined): number {
  return (lines ?? []).reduce((total, line) => {
    const quantity = parseOrderMaterialQuantity(line.quantity) ?? 0;
    return total + orderLineAmount({ price: line.price, quantity });
  }, 0);
}

/**
 * Stable identity for sync-skip comparisons (id / catalog item / freeform name+source+price+qty).
 * Ignores discount metadata — sync_order_materials does not own discounts.
 */
function warrantySyncToken(line: Pick<OrderMaterial, "warrantyMonths" | "warrantyDays" | "warrantyKm">): string {
  return `w:${line.warrantyMonths ?? ""}:${line.warrantyDays ?? ""}:${line.warrantyKm ?? ""}`;
}

export function orderMaterialsSyncKey(materials: readonly OrderMaterial[]): string {
  return consolidateOrderMaterials([...materials])
    .map((line) => {
      const source = resolveMaterialSupplySource(line);
      const itemId = line.inventoryItemId?.trim() ?? "";
      const warranty = warrantySyncToken(line);
      if (source === "catalog" && itemId) {
        return `catalog:${itemId}:${line.quantity}:${line.warehouseId?.trim() ?? ""}:${warranty}`;
      }
      return `${source}:${line.id ?? ""}:${line.itemName.trim().toLowerCase()}:${Number(line.price) || 0}:${line.quantity}:${warranty}`;
    })
    .sort()
    .join("|");
}

/** True when desired materials already match the persisted set (no sync_order_materials call needed). */
export function orderMaterialsMatch(existing: readonly OrderMaterial[], desired: readonly OrderMaterial[]): boolean {
  return orderMaterialsSyncKey(existing) === orderMaterialsSyncKey(desired);
}
