import type { OrderMaterial } from "../../lib/types";
import { materialIssued, materialReturned } from "../inventory/warehouseMaterialStatus";
import { warehouseStockOf } from "./issueWarehouse";

type StockLike = { warehouseId: string; inventoryItemId: string; quantity: number };

function roundQty(value: number) {
  return Math.round(value * 100) / 100;
}

/** Net quantity already outside the warehouse for this line (issued − returned). */
export function catalogLineOutstanding(
  line: Pick<OrderMaterial, "quantityIssued" | "quantityReturned">,
): number {
  return roundQty(Math.max(0, materialIssued(line) - materialReturned(line)));
}

/**
 * How much of the warehouse on-hand this line still claims:
 * quantity above what is already outstanding (already written off for this line).
 */
export function catalogLineWarehouseClaim(
  line: Pick<OrderMaterial, "quantity" | "quantityIssued" | "quantityReturned">,
): number {
  const qty = Number(line.quantity) || 0;
  return roundQty(Math.max(0, qty - catalogLineOutstanding(line)));
}

type CatalogLineRef = Pick<
  OrderMaterial,
  "id" | "inventoryItemId" | "warehouseId" | "quantity" | "quantityIssued" | "quantityReturned" | "supplySource"
>;

/**
 * Sum of warehouse claims from other catalog lines that share the same item + warehouse.
 * `exclude` skips the line being edited (by id or by index in `lines`).
 */
export function otherCatalogLinesWarehouseClaim(
  lines: readonly CatalogLineRef[],
  inventoryItemId: string,
  warehouseId: string,
  exclude?: { lineId?: string | null; index?: number },
): number {
  const itemId = inventoryItemId.trim();
  const wh = warehouseId.trim();
  if (!itemId || !wh) return 0;

  let total = 0;
  lines.forEach((line, index) => {
    if (exclude?.index != null && index === exclude.index) return;
    if (exclude?.lineId && line.id && line.id === exclude.lineId) return;
    if (String(line.inventoryItemId ?? "").trim() !== itemId) return;
    if (String(line.warehouseId ?? "").trim() !== wh) return;
    // Freeform / customer never claim warehouse stock.
    if (line.inventoryItemId == null) return;
    total = roundQty(total + catalogLineWarehouseClaim(line));
  });
  return total;
}

/**
 * Maximum quantity allowed for a catalog line on a warehouse.
 * Available on-hand + already outstanding on this line − claims of sibling lines.
 */
export function maxAllowedCatalogMaterialQuantity(input: {
  warehouseOnHand: number;
  lineOutstanding: number;
  otherLinesClaim: number;
}): number {
  const onHand = Math.max(0, Number(input.warehouseOnHand) || 0);
  const outstanding = Math.max(0, Number(input.lineOutstanding) || 0);
  const others = Math.max(0, Number(input.otherLinesClaim) || 0);
  return roundQty(Math.max(0, onHand - others + outstanding));
}

export type CatalogQuantityStockCheck =
  | { ok: true; max: number; availableOnHand: number }
  | {
      ok: false;
      max: number;
      availableOnHand: number;
      requested: number;
      /** Extra units needed from on-hand beyond what this line already holds outstanding. */
      neededFromWarehouse: number;
    };

/** Evaluate whether `desiredQuantity` fits warehouse stock for one catalog line. */
export function checkCatalogMaterialQuantity(input: {
  desiredQuantity: number;
  warehouseOnHand: number;
  lineOutstanding: number;
  otherLinesClaim?: number;
}): CatalogQuantityStockCheck {
  const desired = roundQty(Number(input.desiredQuantity) || 0);
  const availableOnHand = Math.max(0, roundQty(Number(input.warehouseOnHand) || 0));
  const outstanding = Math.max(0, roundQty(Number(input.lineOutstanding) || 0));
  const otherLinesClaim = Math.max(0, roundQty(Number(input.otherLinesClaim) || 0));
  const max = maxAllowedCatalogMaterialQuantity({
    warehouseOnHand: availableOnHand,
    lineOutstanding: outstanding,
    otherLinesClaim,
  });
  const neededFromWarehouse = roundQty(Math.max(0, desired - outstanding));
  const availableForThisLine = roundQty(Math.max(0, availableOnHand - otherLinesClaim));

  if (desired <= max + 1e-9) {
    return { ok: true, max, availableOnHand: availableForThisLine };
  }
  return {
    ok: false,
    max,
    availableOnHand: availableForThisLine,
    requested: desired,
    neededFromWarehouse,
  };
}

/** Convenience: resolve max qty for a line against live stock + sibling draft lines. */
export function resolveCatalogLineStockLimit(input: {
  line: CatalogLineRef;
  lines: readonly CatalogLineRef[];
  stock: readonly StockLike[] | undefined;
  exclude?: { lineId?: string | null; index?: number };
}): { warehouseOnHand: number; outstanding: number; otherClaim: number; max: number } | null {
  const itemId = String(input.line.inventoryItemId ?? "").trim();
  const warehouseId = String(input.line.warehouseId ?? "").trim();
  if (!itemId || !warehouseId) return null;
  const warehouseOnHand = warehouseStockOf(input.stock, warehouseId, itemId);
  const outstanding = catalogLineOutstanding(input.line);
  const otherClaim = otherCatalogLinesWarehouseClaim(input.lines, itemId, warehouseId, input.exclude);
  const max = maxAllowedCatalogMaterialQuantity({
    warehouseOnHand,
    lineOutstanding: outstanding,
    otherLinesClaim: otherClaim,
  });
  return { warehouseOnHand, outstanding, otherClaim, max };
}

/**
 * Group issue requests by inventory item and flag those whose total exceeds on-hand stock.
 * Used by the "Issue materials" dialog so sibling lines cannot each take the last unit.
 */
export function issueRequestsExceedingStock(
  lines: readonly { inventoryItemId: string; quantity: number }[],
  stock: readonly StockLike[] | undefined,
  warehouseId: string,
): Array<{ inventoryItemId: string; available: number; requested: number }> {
  const wh = warehouseId.trim();
  if (!wh) return [];
  const requestedByItem = new Map<string, number>();
  for (const line of lines) {
    const itemId = line.inventoryItemId.trim();
    if (!itemId) continue;
    const qty = roundQty(Math.max(0, Number(line.quantity) || 0));
    requestedByItem.set(itemId, roundQty((requestedByItem.get(itemId) ?? 0) + qty));
  }
  const over: Array<{ inventoryItemId: string; available: number; requested: number }> = [];
  for (const [itemId, requested] of requestedByItem) {
    const available = warehouseStockOf(stock, wh, itemId);
    if (requested > available + 1e-9) {
      over.push({ inventoryItemId: itemId, available, requested });
    }
  }
  return over;
}

/** Parse `order_material:insufficient_stock available=N requested=M` (and legacy variants). */
export function parseInsufficientStockRpcMessage(message: string | null | undefined): {
  available?: number;
  requested?: number;
} | null {
  if (!message) return null;
  if (!/order_material:insufficient_stock|insufficient_warehouse_stock|insufficient_batch_stock|insufficient_stock/i.test(message)) {
    return null;
  }
  const availableMatch = message.match(/available[=:\s]+(-?\d+(?:\.\d+)?)/i);
  const requestedMatch = message.match(/requested[=:\s]+(-?\d+(?:\.\d+)?)/i);
  return {
    available: availableMatch ? Number(availableMatch[1]) : undefined,
    requested: requestedMatch ? Number(requestedMatch[1]) : undefined,
  };
}
