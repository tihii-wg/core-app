import type { Order, OrderStatus } from "../../lib/types";
import { localDateKey } from "../../pages/dashboardStats";

/** Statuses that are no longer open work — excluded from overdue/upcoming. */
const CLOSED_STATUSES = new Set<OrderStatus>(["completed", "paid", "cancelled"]);

export type DeadlineFilter = "all" | "overdue" | "upcoming";

export const UPCOMING_DEADLINE_DAYS = 7;

export function isOpenOrder(order: Pick<Order, "status">) {
  return !CLOSED_STATUSES.has(order.status);
}

/** Add calendar days to a YYYY-MM-DD key using local date arithmetic. */
export function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  return localDateKey(new Date(year, month - 1, day + days));
}

/** Open order with a deadline strictly before today. */
export function isOrderOverdue(order: Pick<Order, "status" | "deadline">, today: string) {
  return Boolean(order.deadline) && isOpenOrder(order) && order.deadline < today;
}

/** Open order due today or within the next `withinDays` days (inclusive). */
export function isOrderUpcoming(order: Pick<Order, "status" | "deadline">, today: string, withinDays = UPCOMING_DEADLINE_DAYS) {
  if (!order.deadline || !isOpenOrder(order)) return false;
  if (order.deadline < today) return false;
  const until = addCalendarDays(today, withinDays);
  return Boolean(until) && order.deadline <= until;
}

export function matchesDeadlineFilter(order: Pick<Order, "status" | "deadline">, filter: DeadlineFilter, today: string) {
  if (filter === "all") return true;
  if (filter === "overdue") return isOrderOverdue(order, today);
  return isOrderUpcoming(order, today);
}

/** Earliest deadline first — most urgent overdue / soonest upcoming. */
function byDeadlineAsc(a: Pick<Order, "deadline">, b: Pick<Order, "deadline">) {
  return a.deadline.localeCompare(b.deadline);
}

/** Open overdue orders, oldest deadline first. */
export function listOverdueOrders<T extends Pick<Order, "status" | "deadline">>(orders: T[], today: string) {
  return orders.filter((order) => isOrderOverdue(order, today)).sort(byDeadlineAsc);
}

/** Open upcoming orders within the shared window, soonest deadline first. */
export function listUpcomingOrders<T extends Pick<Order, "status" | "deadline">>(orders: T[], today: string, withinDays = UPCOMING_DEADLINE_DAYS) {
  return orders.filter((order) => isOrderUpcoming(order, today, withinDays)).sort(byDeadlineAsc);
}
