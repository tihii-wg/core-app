import type { QueryKey } from "@tanstack/react-query";

/**
 * Map a postgres_changes table name → React Query keys to invalidate.
 * Mirrors useDeleteOrder / invalidatePaymentViews — invalidate only, never merge payloads.
 */
export function mapRealtimeTableToQueryKeys(table: string, workspaceId: string): QueryKey[] {
  switch (table) {
    case "orders":
    case "order_employees":
    case "order_comments":
    case "order_attachments":
      // Same set as useDeleteOrder (+ payments touch via invalidatePaymentViews when needed).
      return [
        ["orders", workspaceId],
        ["orders-page", workspaceId],
        ["order_events", workspaceId],
        ["clients", workspaceId],
        ["inventory", workspaceId],
        ["inventory-movements", workspaceId],
        ["warehouse-stock", workspaceId],
        ["dashboard", workspaceId],
        ["orders-warranty-indicators", workspaceId],
        ["warranty-records", workspaceId],
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
