import {
  clearTableColumnLayout,
  readTableColumnLayout,
  writeTableColumnLayout,
  type TableColumnLayout,
} from "../../ui/tableColumnLayout";

export const ORDER_COLUMN_LAYOUT_STORAGE_KEY = "coreapp.orders.columnLayout";
export const DASHBOARD_ORDER_COLUMN_LAYOUT_STORAGE_KEY = "coreapp.dashboard.orders.columnLayout";

/**
 * Default pixel widths for built-in order list columns. The default set adds up to ~1130 px so that on a
 * 1440 px screen (with the sidebar) every column — including «Итого» — is visible without scrolling.
 */
export const ORDER_COLUMN_DEFAULT_WIDTHS: Record<string, number> = {
  orderNumber: 128,
  client: 160,
  device: 140,
  status: 124,
  createdBy: 124,
  employee: 112,
  team: 76,
  deadline: 92,
  total: 112,
  actions: 64,
};

/** Columns can be squeezed until their text is mostly hidden (cells clip, never wrap). */
export const ORDER_COLUMN_MIN_WIDTHS: Record<string, number> = {
  orderNumber: 40,
  client: 40,
  device: 40,
  status: 40,
  createdBy: 40,
  employee: 40,
  team: 40,
  deadline: 40,
  total: 40,
  actions: 64,
};

export const ORDER_FLEX_COLUMN_ID = "client";
export const ORDER_PINNED_END_COLUMN_IDS = ["actions"] as const;

export function orderColumnLayoutStorageKey(page: "orders" | "dashboard"): string {
  return page === "dashboard" ? DASHBOARD_ORDER_COLUMN_LAYOUT_STORAGE_KEY : ORDER_COLUMN_LAYOUT_STORAGE_KEY;
}

export function readOrderColumnLayout(page: "orders" | "dashboard"): TableColumnLayout | null {
  return readTableColumnLayout(orderColumnLayoutStorageKey(page));
}

export function writeOrderColumnLayout(page: "orders" | "dashboard", layout: TableColumnLayout): void {
  writeTableColumnLayout(orderColumnLayoutStorageKey(page), layout);
}

export function clearOrderColumnLayout(page: "orders" | "dashboard"): void {
  clearTableColumnLayout(orderColumnLayoutStorageKey(page));
}

export function defaultWidthForOrderColumn(columnId: string): number {
  return ORDER_COLUMN_DEFAULT_WIDTHS[columnId] ?? 120;
}

export function minWidthForOrderColumn(columnId: string): number {
  return ORDER_COLUMN_MIN_WIDTHS[columnId] ?? 40;
}
