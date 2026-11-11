export const ORDER_TOGGLEABLE_COLUMNS = [
  "client",
  "clientType",
  "device",
  "status",
  "createdBy",
  "employee",
  "team",
  "deadline",
  "total",
] as const;

export type OrderBuiltinToggleableColumn = (typeof ORDER_TOGGLEABLE_COLUMNS)[number];

/** Built-in toggleable columns, or `custom:<field_key>` for workspace custom fields. */
export type OrderToggleableColumn = OrderBuiltinToggleableColumn | `custom:${string}`;

export const ORDER_COLUMN_STORAGE_KEY = "coreapp.orders.visibleColumns";
export const DASHBOARD_ORDER_COLUMN_STORAGE_KEY = "coreapp.dashboard.orders.visibleColumns";

/** Orders / Dashboard defaults — payment status stays stacked under the Status / Payment column. */
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

/** Dashboard uses the same visible-column defaults as the Orders list. */
export const DEFAULT_DASHBOARD_ORDER_VISIBLE_COLUMNS: OrderToggleableColumn[] = [...DEFAULT_ORDER_VISIBLE_COLUMNS];

/** Map list column key → order field registry key (for visibility / labels). */
export const ORDER_COLUMN_FIELD_KEY: Partial<Record<OrderBuiltinToggleableColumn, string>> = {
  client: "client",
  device: "device",
  status: "status",
  employee: "assignedEmployee",
  team: "team",
  deadline: "deadline",
  total: "total",
};

export function customColumnKey(fieldKey: string): `custom:${string}` {
  return `custom:${fieldKey}`;
}

export function parseCustomColumnKey(column: string): string | null {
  if (!column.startsWith("custom:")) return null;
  const key = column.slice("custom:".length).trim();
  return key || null;
}

export function isOrderToggleableColumn(value: unknown): value is OrderToggleableColumn {
  if (typeof value !== "string") return false;
  if ((ORDER_TOGGLEABLE_COLUMNS as readonly string[]).includes(value)) return true;
  return Boolean(parseCustomColumnKey(value));
}

export function isOrderBuiltinToggleableColumn(value: unknown): value is OrderBuiltinToggleableColumn {
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
    // Legacy standalone "payment" column was removed; payment status stays under Status / Payment.
    if (parsed.includes("payment") && !valid.includes("status")) {
      valid.push("status");
    }
    const builtins = ORDER_TOGGLEABLE_COLUMNS.filter((key) => valid.includes(key));
    const customs = valid.filter((key) => parseCustomColumnKey(key));
    const ordered = [...builtins, ...customs];
    return ordered.length > 0 ? ordered : [...defaults];
  } catch {
    return [...defaults];
  }
}

export function writeOrderVisibleColumns(
  columns: Iterable<OrderToggleableColumn>,
  storageKey: string = ORDER_COLUMN_STORAGE_KEY,
) {
  const list = [...columns];
  const builtins = ORDER_TOGGLEABLE_COLUMNS.filter((key) => list.includes(key));
  const customs = list.filter((key) => parseCustomColumnKey(key));
  const unique = [...builtins, ...customs];
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(unique));
  } catch {
    // Ignore quota / unavailable storage (e.g. private mode or test stubs).
  }
}
