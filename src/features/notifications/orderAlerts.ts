import type { Order } from "../../lib/types";
import { isOpenOrder, listOverdueOrders, listUpcomingOrders } from "../orders/orderVisibility";

export type OrderAlertKind = "overdue" | "upcoming" | "unassigned";

/** Live operational alert derived from current order state — not a stored notification event. */
export type OrderAlert = {
  id: string;
  kind: OrderAlertKind;
  orderId: string;
  orderNumber: string;
  clientName: string;
  deadline: string;
};

const DEFAULT_LIMIT = 10;

function alertId(kind: OrderAlertKind, orderId: string) {
  return `${kind}:${orderId}`;
}

function toAlert(kind: OrderAlertKind, order: Order): OrderAlert {
  return {
    id: alertId(kind, order.id),
    kind,
    orderId: order.id,
    orderNumber: order.orderNumber,
    clientName: order.clientName,
    deadline: order.deadline,
  };
}

function byDeadlineThenNumber(a: Order, b: Order) {
  const deadlineCompare = (a.deadline || "\uffff").localeCompare(b.deadline || "\uffff");
  if (deadlineCompare !== 0) return deadlineCompare;
  return a.orderNumber.localeCompare(b.orderNumber);
}

function isUnassigned(order: Order) {
  return !order.assignedEmployeeId?.trim();
}

/**
 * Builds a stable list of actionable order alerts from live workspace orders.
 * Priority: overdue → upcoming deadlines → open unassigned.
 * Each order appears at most once (highest-priority kind wins).
 */
export function buildOrderAlerts(orders: Order[], today: string, limit = DEFAULT_LIMIT): OrderAlert[] {
  const overdue = listOverdueOrders(orders, today);
  const upcoming = listUpcomingOrders(orders, today);
  const listed = new Set<string>();
  const alerts: OrderAlert[] = [];

  for (const order of overdue) {
    listed.add(order.id);
    alerts.push(toAlert("overdue", order));
  }

  for (const order of upcoming) {
    if (listed.has(order.id)) continue;
    listed.add(order.id);
    alerts.push(toAlert("upcoming", order));
  }

  const unassigned = orders.filter((order) => isOpenOrder(order) && isUnassigned(order) && !listed.has(order.id)).sort(byDeadlineThenNumber);

  for (const order of unassigned) {
    listed.add(order.id);
    alerts.push(toAlert("unassigned", order));
  }

  return alerts.slice(0, Math.max(0, limit));
}

/** Alerts that have not been dismissed in this session. */
export function undismissedAlerts(alerts: OrderAlert[], dismissedIds: ReadonlySet<string>) {
  return alerts.filter((alert) => !dismissedIds.has(alert.id));
}
