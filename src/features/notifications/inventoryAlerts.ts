import type { InventoryItem, InventoryStockStatus } from "../../lib/types";
import { effectiveStockStatus, needsStockAttention } from "../inventory/stockStatus";

export type InventoryAlertKind = "out_of_stock" | "low_stock";

/** Live operational alert derived from current inventory — not a stored notification event. */
export type InventoryAlert = {
  id: string;
  kind: InventoryAlertKind;
  itemId: string;
  name: string;
  quantity: number;
  minQuantity: number;
  unit: string;
};

const DEFAULT_LIMIT = 10;

function alertId(kind: InventoryAlertKind, itemId: string) {
  return `${kind}:${itemId}`;
}

function statusRank(status: InventoryStockStatus) {
  if (status === "out_of_stock") return 0;
  if (status === "low_stock") return 1;
  return 2;
}

/**
 * Builds stable inventory stock alerts for the active workspace.
 * Priority: out of stock → low stock. Each item appears at most once.
 * Inactive items are omitted. Relies on stock_status / quantity vs minQuantity.
 */
export function buildInventoryAlerts(items: InventoryItem[], limit = DEFAULT_LIMIT): InventoryAlert[] {
  const seen = new Set<string>();
  const attention = items
    .filter(needsStockAttention)
    .map((item) => ({ ...item, stockStatus: effectiveStockStatus(item) }))
    .sort(
      (a, b) =>
        statusRank(a.stockStatus) - statusRank(b.stockStatus) ||
        a.quantity - b.quantity ||
        a.name.localeCompare(b.name),
    )
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

  return attention.slice(0, Math.max(0, limit)).map((item) => {
    const kind: InventoryAlertKind = item.stockStatus === "out_of_stock" ? "out_of_stock" : "low_stock";
    return {
      id: alertId(kind, item.id),
      kind,
      itemId: item.id,
      name: item.name,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      unit: item.unit,
    };
  });
}
