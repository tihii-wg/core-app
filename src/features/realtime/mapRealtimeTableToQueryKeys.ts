import type { QueryKey } from "@tanstack/react-query";

/**
 * Map a postgres_changes table name → React Query keys to invalidate.
 * Mirrors useDeleteOrder / invalidatePaymentViews — invalidate only, never merge payloads.
 */
export function mapRealtimeTableToQueryKeys(table: string, workspaceId: string): QueryKey[] {
  switch (table) {
    case "orders":
    case "order_employees":
      // Order lists, client balances / counts, dashboard, warranty. NOT stock: when an order issues or returns
      // parts, warehouse_stock / inventory_items change too and their own events refresh the stock views —
      // an order edit by another user no longer reloads the whole parts catalog.
      return [
        ["orders", workspaceId],
        ["order_events", workspaceId],
        ["clients", workspaceId],
        ["dashboard", workspaceId],
        ["orders-warranty-indicators", workspaceId],
        ["warranty-records", workspaceId],
      ];
    case "order_comments":
      // A comment changes the order feed only.
      return [
        ["order_comments", workspaceId],
        ["order_events", workspaceId],
      ];
    case "order_attachments":
      return [
        ["order-attachments", workspaceId],
        ["orders-attachment-counts", workspaceId],
        ["order_events", workspaceId],
      ];
    case "payments":
    case "invoices":
    case "expenses":
      // Same set as invalidatePaymentViews in usePayments.ts.
      return [
        ["payments", workspaceId],
        ["orders", workspaceId],
        ["invoices", workspaceId],
        ["expenses", workspaceId],
        ["finance-accounts", workspaceId],
        ["order_events", workspaceId],
      ];
    case "clients":
      return [["clients", workspaceId]];
    case "inventory_items":
    case "warehouse_stock":
      return [
        ["inventory", workspaceId],
        ["inventory-movements", workspaceId],
        ["warehouse-stock", workspaceId],
      ];
    default:
      return [];
  }
}

/** Tables whose invalidation should bump the open-order edit conflict notice. */
export function isOrderEditRelevantTable(table: string): boolean {
  return (
    table === "orders" ||
    table === "order_employees" ||
    table === "order_comments" ||
    table === "order_attachments" ||
    table === "payments"
  );
}
