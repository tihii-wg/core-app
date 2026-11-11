import type { Order, OrderService } from "../../lib/types";
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

type OrderAssigneeFields = {
  assignedEmployeeId?: string | null;
  services?: Array<Pick<OrderService, "technicianId">> | null;
};

/** General/order-level assignee (`orders.employee_id` → `assignedEmployeeId`). */
export function hasOrderLevelAssignee(order: OrderAssigneeFields) {
  return Boolean(order.assignedEmployeeId?.trim());
}

/** True when any service line has a technician (`order_services.technician_id` → `technicianId`). */
export function hasAtLeastOneServiceAssignee(order: OrderAssigneeFields) {
  return (order.services ?? []).some((service) => Boolean(service.technicianId?.trim()));
}

/**
 * Order has an assignee somewhere: general employee field OR any service technician.
 * Team membership alone does not count.
 */
export function orderHasAnyAssignee(order: OrderAssigneeFields) {
  return hasOrderLevelAssignee(order) || hasAtLeastOneServiceAssignee(order);
}

/** Open-order “without an assignee” alert — only when nobody is assigned at order or service level. */
export function isOrderUnassignedForAlert(order: OrderAssigneeFields) {
  return !orderHasAnyAssignee(order);
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

  const unassigned = orders
    .filter((order) => isOpenOrder(order) && isOrderUnassignedForAlert(order) && !listed.has(order.id))
    .sort(byDeadlineThenNumber);

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
