import type { Order } from "../../lib/types";

/** Dashboard Recent Orders card count — keep limited; not a full order list. */
export const RECENT_ORDERS_LIMIT = 5;

/**
 * User-visible order activity written to `order_events` by CRM triggers.
 * Technical column bumps (totals, is_paid, closed_at-only, etc.) are never inserted by those writers.
 */
export const MEANINGFUL_ORDER_EVENT_TYPES = [
  "order_created",
  "status_changed",
  "order_field_changed",
  "service_added",
  "service_updated",
  "service_removed",
  "material_added",
  "material_updated",
  "material_removed",
  "material_issued",
  "material_returned",
  "payment_recorded",
  "payment_refunded",
  "payment_voided",
  "warranty_activated",
  "warranty_updated",
  "warranty_claim_created",
  "warranty_claim_updated",
] as const;

export type MeaningfulOrderEventType = (typeof MEANINGFUL_ORDER_EVENT_TYPES)[number];

const meaningfulSet = new Set<string>(MEANINGFUL_ORDER_EVENT_TYPES);

export function isMeaningfulOrderEventType(eventType: string | null | undefined): boolean {
  return Boolean(eventType && meaningfulSet.has(eventType));
}

export type RecentActivityEvent = {
  orderId: string;
  eventType: string;
  createdAt: string;
};

/**
 * Walk newest-first events and keep the first occurrence of each order id.
 * Returns at most `limit` unique order ids (latest meaningful activity first).
 */
export function uniqueOrderIdsByLatestActivity(
  events: readonly RecentActivityEvent[],
  limit = RECENT_ORDERS_LIMIT,
): string[] {
  if (limit <= 0) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (!isMeaningfulOrderEventType(event.eventType)) continue;
    const orderId = event.orderId?.trim();
    if (!orderId || seen.has(orderId)) continue;
    seen.add(orderId);
    ids.push(orderId);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * Map activity-ordered ids onto hydrated workspace orders (one card per order).
 * Missing ids are skipped (deleted / other workspace). Does not pad with inactive orders
 * when activity data is available — only recently active orders appear.
 */
export function selectOrdersByActivityIds<T extends Pick<Order, "id">>(
  orders: readonly T[],
  activityOrderIds: readonly string[],
  limit = RECENT_ORDERS_LIMIT,
): T[] {
  if (limit <= 0) return [];
  const byId = new Map(orders.map((order) => [order.id, order]));
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const id of activityOrderIds) {
    if (!id || seen.has(id)) continue;
    const order = byId.get(id);
    if (!order) continue;
    seen.add(id);
    selected.push(order);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * When `order_events` is unavailable, fall back to creation order (newest first).
 * `orders` is expected already sorted by created_at desc from getOrders.
 */
export function selectRecentOrdersFallback<T>(orders: readonly T[], limit = RECENT_ORDERS_LIMIT): T[] {
  return orders.slice(0, Math.max(0, limit));
}
