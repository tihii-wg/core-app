export const ORDER_TOGGLEABLE_COLUMNS = [
  "client",
  "clientType",
  "device",
  "status",
  "payment",
  "createdBy",
  "employee",
  "team",
  "deadline",
  "total",
] as const;

export type OrderToggleableColumn = (typeof ORDER_TOGGLEABLE_COLUMNS)[number];

export const ORDER_COLUMN_STORAGE_KEY = "coreapp.orders.visibleColumns";
export const DASHBOARD_ORDER_COLUMN_STORAGE_KEY = "coreapp.dashboard.orders.visibleColumns";

/** Orders page defaults — payment stays stacked under status (optional column off). */
export const DEFAULT_ORDER_VISIBLE_COLUMNS: OrderToggleableColumn[] = [
  "client",
  "clientType",
  "device",
  "status",
  "createdBy",
  "employee",
  "team",
  "deadline",
  "total",
];

/** Dashboard defaults — same as Orders plus standalone payment column. */
export const DEFAULT_DASHBOARD_ORDER_VISIBLE_COLUMNS: OrderToggleableColumn[] = [
  ...DEFAULT_ORDER_VISIBLE_COLUMNS.slice(0, 4),
  "payment",
  ...DEFAULT_ORDER_VISIBLE_COLUMNS.slice(4),
];

export function isOrderToggleableColumn(value: unknown): value is OrderToggleableColumn {
  return typeof value === "string" && (ORDER_TOGGLEABLE_COLUMNS as readonly string[]).includes(value);
}

export function readOrderVisibleColumns(
  storageKey: string = ORDER_COLUMN_STORAGE_KEY,
  defaults: readonly OrderToggleableColumn[] = DEFAULT_ORDER_VISIBLE_COLUMNS,
): OrderToggleableColumn[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [...defaults];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...defaults];
    const valid = parsed.filter(isOrderToggleableColumn);
    // Former standalone "payment" column is stacked under status — keep status visible.
    if (parsed.includes("payment") && !valid.includes("status")) {
      valid.push("status");
    }
    const ordered = ORDER_TOGGLEABLE_COLUMNS.filter((key) => valid.includes(key));
    return ordered.length > 0 ? ordered : [...defaults];
  } catch {
    return [...defaults];
  }
}

export function writeOrderVisibleColumns(
  columns: Iterable<OrderToggleableColumn>,
  storageKey: string = ORDER_COLUMN_STORAGE_KEY,
) {
  const unique = ORDER_TOGGLEABLE_COLUMNS.filter((key) => [...columns].includes(key));
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(unique));
  } catch {
    // Ignore quota / unavailable storage (e.g. private mode or test stubs).
  }
}
