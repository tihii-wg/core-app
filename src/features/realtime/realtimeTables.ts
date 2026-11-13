/**
 * Phase-1 Realtime tables that have workspace_id (safe to filter).
 * order_services / order_materials are intentionally omitted — no workspace_id;
 * parent orders changes (and hot-list fallbacks) cover line edits.
 */
export const REALTIME_WORKSPACE_TABLES = [
  "orders",
  "order_employees",
  "payments",
  "clients",
  "inventory_items",
  "warehouse_stock",
  "invoices",
  "expenses",
  "order_comments",
  "order_attachments",
] as const;

export type RealtimeWorkspaceTable = (typeof REALTIME_WORKSPACE_TABLES)[number];

/** Query-key roots that should stay fresh via focus/reconnect/poll when realtime is down. */
export const REALTIME_HOT_LIST_ROOTS = [
  "orders",
  "orders-page",
  "payments",
  "dashboard",
  "inventory",
] as const;

export const REALTIME_INVALIDATE_DEBOUNCE_MS = 400;
export const REALTIME_FALLBACK_POLL_MS = 60_000;
export const REALTIME_HIDDEN_INVALIDATE_MS = 60_000;
