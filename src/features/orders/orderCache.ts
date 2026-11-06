import type { QueryClient } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import type { OrdersPageResult } from "../../services/apiOrders";

/** Patch every cached orders list/page for a workspace (array or OrdersPageResult). */
export function patchOrderLists(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  patchOrder: (order: Order) => Order,
) {
  if (!workspaceId) return;
  queryClient.setQueriesData({ queryKey: ["orders", workspaceId] }, (data: unknown) => {
    if (Array.isArray(data)) return (data as Order[]).map(patchOrder);
    if (data && typeof data === "object" && Array.isArray((data as OrdersPageResult).orders)) {
      const page = data as OrdersPageResult;
      return { ...page, orders: page.orders.map(patchOrder) };
    }
    return data;
  });
}

/** Apply a field patch to one order id across list/page caches. */
export function patchOrderInLists(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
  patch: Partial<Order>,
) {
  patchOrderLists(queryClient, workspaceId, (order) => (order.id === orderId ? { ...order, ...patch } : order));
}
