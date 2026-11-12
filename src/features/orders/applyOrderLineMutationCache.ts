import type { QueryClient } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import { patchOrderLists } from "./orderCache";

export type OrderLineCacheOptions = {
  /** Invalidate warehouse/inventory queries — only when the mutation moved stock. */
  stockMoved?: boolean;
};

/**
 * Targeted cache update after an order-card line mutation.
 * Sets the open order, patches list/page rows in place, and only invalidates stock /
 * order_events when needed — never clients/services/dashboard/warranty/payments.
 */
export function applyOrderLineMutationCache(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  order: Order,
  options: OrderLineCacheOptions = {},
) {
  const orderId = order.id;
  queryClient.setQueryData(["order", orderId], order);

  if (workspaceId) {
    patchOrderLists(queryClient, workspaceId, (cached) => (cached.id === orderId ? order : cached));
    // Also cover the legacy ["orders-page", workspaceId] key if anything still reads it.
    queryClient.setQueriesData({ queryKey: ["orders-page", workspaceId] }, (data: unknown) => {
      if (!data || typeof data !== "object") return data;
      const page = data as { orders?: Order[] };
      if (!Array.isArray(page.orders)) return data;
      return { ...page, orders: page.orders.map((row) => (row.id === orderId ? order : row)) };
    });
    void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId, orderId] });
  }

  if (options.stockMoved && workspaceId) {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
  }
}
