import type { WarehouseMaterialLineInput } from "../../lib/types";

type WarehouseLike = { id: string; isDefault: boolean; isActive: boolean };
type StockLike = { warehouseId: string; inventoryItemId: string; quantity: number };

/** Warehouses an order can be issued from: active ones only, default first (input order kept otherwise). */
export function issuableWarehouses<T extends WarehouseLike>(warehouses: readonly T[] | undefined): T[] {
  const active = (warehouses ?? []).filter((warehouse) => warehouse.isActive);
  return [...active.filter((warehouse) => warehouse.isDefault), ...active.filter((warehouse) => !warehouse.isDefault)];
}

/** Pre-selected warehouse: the default one, else the first active one, else "" (no warehouse picker). */
export function defaultIssueWarehouseId(warehouses: readonly WarehouseLike[] | undefined): string {
  return issuableWarehouses(warehouses)[0]?.id ?? "";
}

/** On-hand quantity of `inventoryItemId` in `warehouseId` (0 when there is no stock row). */
export function warehouseStockOf(stock: readonly StockLike[] | undefined, warehouseId: string, inventoryItemId: string): number {
  let total = 0;
  for (const row of stock ?? []) {
    if (row.warehouseId === warehouseId && row.inventoryItemId === inventoryItemId) total += Number(row.quantity) || 0;
  }
  return total;
}

/** Item ids whose requested issue quantity is more than the chosen warehouse holds (client-side pre-check only). */
export function linesExceedingWarehouseStock(lines: readonly WarehouseMaterialLineInput[], stock: readonly StockLike[] | undefined, warehouseId: string): string[] {
  return lines.filter((line) => line.quantity > warehouseStockOf(stock, warehouseId, line.inventoryItemId)).map((line) => line.inventoryItemId);
}
