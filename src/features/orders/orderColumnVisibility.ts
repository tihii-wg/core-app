export const ORDER_TOGGLEABLE_COLUMNS = [
  "client",
  "clientType",
  "device",
  "status",
  "createdBy",
  "employee",
  "deadline",
  "total",
  "payment",
] as const;

export type OrderToggleableColumn = (typeof ORDER_TOGGLEABLE_COLUMNS)[number];

export const ORDER_COLUMN_STORAGE_KEY = "coreapp.orders.visibleColumns";

export const DEFAULT_ORDER_VISIBLE_COLUMNS: OrderToggleableColumn[] = [...ORDER_TOGGLEABLE_COLUMNS];

export function isOrderToggleableColumn(value: unknown): value is OrderToggleableColumn {
  return typeof value === "string" && (ORDER_TOGGLEABLE_COLUMNS as readonly string[]).includes(value);
}

export function readOrderVisibleColumns(): OrderToggleableColumn[] {
  try {
    const raw = window.localStorage.getItem(ORDER_COLUMN_STORAGE_KEY);
    if (!raw) return [...DEFAULT_ORDER_VISIBLE_COLUMNS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER_VISIBLE_COLUMNS];
    const valid = parsed.filter(isOrderToggleableColumn);
    return valid.length > 0 ? valid : [...DEFAULT_ORDER_VISIBLE_COLUMNS];
  } catch {
    return [...DEFAULT_ORDER_VISIBLE_COLUMNS];
  }
}

export function writeOrderVisibleColumns(columns: Iterable<OrderToggleableColumn>) {
  const unique = ORDER_TOGGLEABLE_COLUMNS.filter((key) => [...columns].includes(key));
  try {
    window.localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify(unique));
  } catch {
    // Ignore quota / unavailable storage (e.g. private mode or test stubs).
  }
}
