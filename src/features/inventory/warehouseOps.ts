/**
 * Pure quantity / amount helpers for warehouse operations (receipts, transfers, write-offs).
 * Stock itself is only ever changed server-side by the `crm_post_*` RPCs — these helpers only
 * validate drafts and preview totals before they are saved.
 */

export type WarehouseOpKind = "receipt" | "transfer" | "writeOff" | "supplierReturn";

export type OpLineInput = {
  inventoryItemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
};

/** inventory_items.quantity is numeric(12,2), so operation quantities carry at most 2 decimals. */
export const QTY_DECIMALS = 2;

export function roundQty(value: number) {
  const factor = 10 ** QTY_DECIMALS;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Line amount rounded to cents, matching `round(quantity * unit_cost, 2)` in the RPCs. */
export function lineAmount(quantity: number, unitCost: number) {
  return Math.round((quantity * unitCost + Number.EPSILON) * 100) / 100;
}

export function sumLineAmounts(lines: Pick<OpLineInput, "quantity" | "unitCost">[]) {
  const cents = lines.reduce((sum, line) => sum + Math.round(lineAmount(line.quantity, line.unitCost) * 100), 0);
  return cents / 100;
}

/** Parses a user-typed decimal ("1,5" and "1.5" both work). Returns null for blank / non-numeric input. */
export function parseDecimalInput(raw: string) {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function hasValidQtyPrecision(value: number) {
  return Math.abs(value - roundQty(value)) < 1e-9;
}

/** Sums lines of the same inventory item (the RPCs check stock against the per-item total). */
export function totalsByItem(lines: Pick<OpLineInput, "inventoryItemId" | "quantity">[]) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.inventoryItemId, roundQty((totals.get(line.inventoryItemId) ?? 0) + line.quantity));
  }
  return totals;
}

export type OpLineIssue =
  | { code: "noLines" }
  | { code: "noItem"; index: number }
  | { code: "quantityPositive"; index: number }
  | { code: "quantityPrecision"; index: number }
  | { code: "costNegative"; index: number }
  | { code: "insufficientStock"; index: number; inventoryItemId: string; available: number; requested: number };

/**
 * Validates draft lines. `available` (item id → qty in the source warehouse) is required for
 * transfers and write-offs; receipts add stock and never need it.
 */
export function validateOpLines(
  kind: WarehouseOpKind,
  lines: OpLineInput[],
  available?: ReadonlyMap<string, number>,
): OpLineIssue | null {
  if (lines.length === 0) return { code: "noLines" };

  for (const [index, line] of lines.entries()) {
    if (!line.inventoryItemId) return { code: "noItem", index };
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return { code: "quantityPositive", index };
    if (!hasValidQtyPrecision(line.quantity)) return { code: "quantityPrecision", index };
    if (!Number.isFinite(line.unitCost) || line.unitCost < 0) return { code: "costNegative", index };
  }

  if (kind !== "receipt" && available) {
    const totals = totalsByItem(lines);
    for (const [index, line] of lines.entries()) {
      const requested = totals.get(line.inventoryItemId) ?? 0;
      const have = available.get(line.inventoryItemId) ?? 0;
      if (requested > have) {
        return { code: "insufficientStock", index, inventoryItemId: line.inventoryItemId, available: have, requested };
      }
    }
  }
  return null;
}

/** Quantity of each item in one warehouse, from the workspace-wide warehouse_stock rows. */
export function stockByItemForWarehouse(
  rows: { warehouseId: string; inventoryItemId: string; quantity: number }[],
  warehouseId: string,
) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.warehouseId === warehouseId) map.set(row.inventoryItemId, roundQty((map.get(row.inventoryItemId) ?? 0) + row.quantity));
  }
  return map;
}

/** Stock levels after posting — mirrors the RPC math, for previews and tests. */
export function previewStockAfter(
  kind: WarehouseOpKind,
  current: { from: number; to: number; total: number },
  quantity: number,
) {
  switch (kind) {
    case "receipt":
      return { from: current.from, to: roundQty(current.to + quantity), total: roundQty(current.total + quantity) };
    case "transfer":
      // inventory_items.quantity (total) stays unchanged: stock only moves between warehouses.
      return { from: roundQty(current.from - quantity), to: roundQty(current.to + quantity), total: current.total };
    case "writeOff":
    case "supplierReturn":
      return { from: roundQty(current.from - quantity), to: current.to, total: roundQty(current.total - quantity) };
  }
}

/** Draft line shape used by WarehouseOpDialog while the create-material dialog is open. */
export type OpDraftLine = { key: number; itemId: string; quantity: string; unitCost: string };

/**
 * Places a newly created catalog item onto the open operation draft without duplicating an
 * existing selection of the same item. Prefers the first empty line; otherwise appends a line.
 */
export function assignCreatedItemToOpLines(
  lines: OpDraftLine[],
  itemId: string,
  unitCost: string,
  makeLine: () => OpDraftLine,
): OpDraftLine[] {
  if (!itemId) return lines;
  if (lines.some((line) => line.itemId === itemId)) return lines;

  const emptyIndex = lines.findIndex((line) => !line.itemId);
  if (emptyIndex >= 0) {
    return lines.map((line, index) => (index === emptyIndex ? { ...line, itemId, unitCost } : line));
  }

  return [...lines, { ...makeLine(), itemId, unitCost }];
}
