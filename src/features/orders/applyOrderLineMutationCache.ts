import type { QueryClient } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import { patchOrderLists } from "./orderCache";

export type OrderLineCacheOptions = {
  /** Invalidate warehouse/inventory queries — only when the mutation moved stock. */
  stockMoved?: boolean;
};

/**
 * Line RPCs / updateOrder do not return order_line_comments (their lines carry `comment: undefined`).
 * Keep the comment already shown for such lines so a price/qty edit does not blank it. A line whose
 * `comment` is explicitly `null` (deleted) or a string (just set) keeps the incoming value.
 */
export function preserveOrderLineComments(previous: Order | null | undefined, next: Order): Order {
  if (!previous || previous.id !== next.id) return next;
  const serviceComments = new Map<string, string>();
  for (const line of previous.services ?? []) if (line.id && line.comment?.trim()) serviceComments.set(line.id, line.comment);
  const materialComments = new Map<string, string>();
  for (const line of previous.materials ?? []) if (line.id && line.comment?.trim()) materialComments.set(line.id, line.comment);
  if (serviceComments.size === 0 && materialComments.size === 0) return next;
  let changed = false;
  const services = (next.services ?? []).map((line) => {
    if (line.comment !== undefined || !line.id) return line;
    const kept = serviceComments.get(line.id);
    if (!kept) return line;
    changed = true;
    return { ...line, comment: kept };
  });
  const materials = (next.materials ?? []).map((line) => {
    if (line.comment !== undefined || !line.id) return line;
    const kept = materialComments.get(line.id);
    if (!kept) return line;
    changed = true;
    return { ...line, comment: kept };
  });
  return changed ? { ...next, services, materials } : next;
}

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
  const previous = queryClient.getQueryData<Order>(["order", orderId]);
  const withComments = preserveOrderLineComments(previous, order);
  queryClient.setQueryData(["order", orderId], withComments);

  if (workspaceId) {
    patchOrderLists(queryClient, workspaceId, (cached) => (cached.id === orderId ? withComments : cached));
    // Also cover the legacy ["orders-page", workspaceId] key if anything still reads it.
    queryClient.setQueriesData({ queryKey: ["orders-page", workspaceId] }, (data: unknown) => {
      if (!data || typeof data !== "object") return data;
      const page = data as { orders?: Order[] };
      if (!Array.isArray(page.orders)) return data;
      return { ...page, orders: page.orders.map((row) => (row.id === orderId ? withComments : row)) };
    });
    void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId, orderId] });
  }

  if (options.stockMoved && workspaceId) {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
  }
}
