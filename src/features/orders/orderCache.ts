import type { QueryClient } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import type { OrdersPageResult } from "../../services/apiOrders";

/** Patch every cached orders list/page for a workspace (array or OrdersPageResult). */
export function patchOrderLists(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  patchOrder: (order: Order) => Order,
): boolean {
  if (!workspaceId) return false;
  let moneyChanged = false;
  const patchTracked = (order: Order) => {
    const next = patchOrder(order);
    if (
      next !== order &&
      (next.totalPrice !== order.totalPrice || next.status !== order.status || next.isPaid !== order.isPaid || next.kind !== order.kind)
    ) {
      moneyChanged = true;
    }
    return next;
  };
  queryClient.setQueriesData({ queryKey: ["orders", workspaceId] }, (data: unknown) => {
    if (Array.isArray(data)) return (data as Order[]).map(patchTracked);
    if (data && typeof data === "object" && Array.isArray((data as OrdersPageResult).orders)) {
      const page = data as OrdersPageResult;
      return { ...page, orders: page.orders.map(patchTracked) };
    }
    return data;
  });
  // The «Awaiting payment» card is a sum over all open orders, not a list of rows — it cannot be patched in
  // place. When a patched order's total / status / paid flag changed, re-read it (open orders + their payments).
  if (moneyChanged) void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId, "awaitingPayment"] });
  return moneyChanged;
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
