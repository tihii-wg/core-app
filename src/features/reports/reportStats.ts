import i18n, { currentIntlLocale } from "../../i18n";
import type { Employee, InventoryItem, Order, OrderStatus } from "../../lib/types";
import { calendarDateKey, localDateKey, startOfWeek } from "../../pages/dashboardStats";
import { financeDateKey } from "../finance/financeStats";
import {
  netCollected,
  orderPaymentBalance,
  paymentsForCurrency,
  paymentsInPeriod,
  signedLedgerAmount,
} from "../finance/paymentCalculations";
import type { LedgerPayment } from "../finance/paymentTypes";
import { orderAssignedToEmployee } from "../orders/orderAssignee";
import { isOpenOrder, isOrderOverdue } from "../orders/orderVisibility";

export type ReportRange = "last7" | "last30" | "last90" | "thisYear";
export type ReportGranularity = "day" | "week" | "month";

export type ReportPeriod = {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  granularity: ReportGranularity;
};

export type PeriodTotals = {
  revenue: number;
  orders: number;
  newClients: number;
  avgOrderValue: number;
};

export type SeriesPoint = { key: string; label: string; revenue: number; orders: number; billed: number; outstanding: number };

export type ServiceSlice = { name: string; count: number; revenue: number; percent: number; color: string };

export type EmployeeResult = { name: string; completed: number; revenue: number };

/** Period workload for an assignee (or the Unassigned bucket). */
export type WorkloadRow = {
  name: string;
  assigned: number;
  open: number;
  completed: number;
  overdue: number;
};

/** Operational snapshot for the Reports overview. */
export type OperationsStats = {
  /** Orders whose createdAt falls in the period. */
  created: number;
  /**
   * Orders currently completed/paid whose updatedAt (fallback: createdAt) falls in the period.
   * There is no separate completed_at column — this is the closest reliable signal.
   */
  completed: number;
  /** Open orders right now (not limited to the selected period). */
  open: number;
  /** Open overdue orders right now, same rule as Orders deadline filters. */
  overdue: number;
};

export type StockLevel = { name: string; quantity: number; minimum: number };

const rangeDays: Record<Exclude<ReportRange, "thisYear">, number> = { last7: 7, last30: 30, last90: 90 };
const completedStatuses = new Set<OrderStatus>(["completed", "paid"]);
export const serviceColors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];
export const otherServiceColor = "var(--color-subtle-foreground)";

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function fromDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function inRange(dateKey: string, start: string, end: string) {
  return dateKey !== "" && dateKey >= start && dateKey <= end;
}

export function ordersIn(orders: Order[], start: string, end: string) {
  return orders.filter((order) => inRange(order.createdAt, start, end));
}

function sumTotals(orders: Order[]) {
  return orders.reduce((sum, order) => sum + order.totalPrice, 0);
}

export function reportPeriod(range: ReportRange, now: Date): ReportPeriod {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === "thisYear") {
    const year = today.getFullYear();
    return {
      start: localDateKey(new Date(year, 0, 1)),
      end: localDateKey(today),
      previousStart: localDateKey(new Date(year - 1, 0, 1)),
      previousEnd: localDateKey(new Date(year - 1, today.getMonth(), today.getDate())),
      granularity: "month",
    };
  }

  const days = rangeDays[range];
  const start = addDays(today, -(days - 1));
  return {
    start: localDateKey(start),
    end: localDateKey(today),
    previousStart: localDateKey(addDays(start, -days)),
    previousEnd: localDateKey(addDays(start, -1)),
    granularity: range === "last90" ? "week" : "day",
  };
}

/** Operational order totals for a period. Revenue here is legacy order.isPaid — prefer ledgerPeriodRevenue for confirmed cash. */
export function periodTotals(orders: Order[], clientCreatedDates: string[], start: string, end: string): PeriodTotals {
  const periodOrders = ordersIn(orders, start, end);
  const billable = periodOrders.filter((order) => order.status !== "cancelled");

  return {
    revenue: sumTotals(periodOrders.filter((order) => order.isPaid)),
    orders: periodOrders.length,
    newClients: clientCreatedDates.filter((createdAt) => inRange(calendarDateKey(createdAt), start, end)).length,
    avgOrderValue: billable.length > 0 ? sumTotals(billable) / billable.length : 0,
  };
}

/** Confirmed cash receipts in period from the payments ledger (by paid_at). */
export function ledgerPeriodRevenue(payments: LedgerPayment[], period: Pick<ReportPeriod, "start" | "end">, currencyCode: string) {
  return netCollected(paymentsInPeriod(paymentsForCurrency(payments, currencyCode), period));
}

export function summaryStats(orders: Order[], clientCreatedDates: string[], period: ReportPeriod) {
  return {
    current: periodTotals(orders, clientCreatedDates, period.start, period.end),
    previous: periodTotals(orders, clientCreatedDates, period.previousStart, period.previousEnd),
  };
}

/** Same as summaryStats but replaces revenue with ledger-confirmed net receipts. */
export function summaryStatsWithLedger(
  orders: Order[],
  clientCreatedDates: string[],
  period: ReportPeriod,
  payments: LedgerPayment[],
  currencyCode: string,
) {
  const current = periodTotals(orders, clientCreatedDates, period.start, period.end);
  const previous = periodTotals(orders, clientCreatedDates, period.previousStart, period.previousEnd);
  return {
    current: { ...current, revenue: ledgerPeriodRevenue(payments, period, currencyCode) },
    previous: {
      ...previous,
      revenue: ledgerPeriodRevenue(payments, { start: period.previousStart, end: period.previousEnd }, currencyCode),
    },
  };
}

export function percentChange(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function bucketKey(dateKey: string, granularity: ReportGranularity) {
  if (granularity === "day") return dateKey;
  if (granularity === "week") return localDateKey(startOfWeek(fromDateKey(dateKey)));
  return dateKey.slice(0, 7);
}

function bucketLabel(key: string, granularity: ReportGranularity) {
  if (granularity === "month") return fromDateKey(`${key}-01`).toLocaleDateString(currentIntlLocale(), { month: "short" });
  return fromDateKey(key).toLocaleDateString(currentIntlLocale(), { month: "short", day: "numeric" });
}

export function revenueSeries(orders: Order[], period: ReportPeriod): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>();

  for (let day = fromDateKey(period.start); localDateKey(day) <= period.end; day = addDays(day, 1)) {
    const key = bucketKey(localDateKey(day), period.granularity);
    if (!points.has(key)) points.set(key, { key, label: bucketLabel(key, period.granularity), revenue: 0, orders: 0, billed: 0, outstanding: 0 });
  }

  for (const order of ordersIn(orders, period.start, period.end)) {
    const point = points.get(bucketKey(order.createdAt, period.granularity));
    if (!point) continue;
    point.orders += 1;
    if (order.isPaid) point.revenue += order.totalPrice;
    if (order.status === "cancelled") continue;
    point.billed += order.totalPrice;
    if (!order.isPaid) point.outstanding += order.totalPrice;
  }

  return [...points.values()];
}

/**
 * Series with confirmed revenue from payments.paid_at; order counts/billed still by order createdAt.
 * Outstanding uses ledger remaining (excludes unreconciled legacy paid-with-no-ledger).
 */
export function revenueSeriesWithLedger(
  orders: Order[],
  period: ReportPeriod,
  payments: LedgerPayment[],
  currencyCode: string,
): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>();

  for (let day = fromDateKey(period.start); localDateKey(day) <= period.end; day = addDays(day, 1)) {
    const key = bucketKey(localDateKey(day), period.granularity);
    if (!points.has(key)) points.set(key, { key, label: bucketLabel(key, period.granularity), revenue: 0, orders: 0, billed: 0, outstanding: 0 });
  }

  for (const order of ordersIn(orders, period.start, period.end)) {
    const point = points.get(bucketKey(order.createdAt, period.granularity));
    if (!point) continue;
    point.orders += 1;
    if (order.status === "cancelled") continue;
    point.billed += order.totalPrice;
    const balance = orderPaymentBalance(order, payments);
    if (!balance.isLegacyUnreconciled && balance.remaining > 0) point.outstanding += balance.remaining;
  }

  for (const payment of paymentsInPeriod(paymentsForCurrency(payments, currencyCode), period)) {
    const date = financeDateKey(payment.paidAt);
    if (!date) continue;
    const point = points.get(bucketKey(date, period.granularity));
    if (!point) continue;
    const signed = signedLedgerAmount(payment);
    if (signed == null) continue;
    point.revenue += signed;
  }

  return [...points.values()];
}

export function serviceDistribution(orders: Order[], period: ReportPeriod, maxSlices = 5): ServiceSlice[] {
  const totals = new Map<string, { name: string; count: number; revenue: number }>();

  for (const order of ordersIn(orders, period.start, period.end)) {
    if (order.status === "cancelled") continue;
    for (const line of order.services) {
      const name = line.serviceName.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const total = totals.get(key) ?? { name, count: 0, revenue: 0 };
      total.count += line.quantity;
      total.revenue += line.price * line.quantity;
      totals.set(key, total);
    }
  }

  const ranked = [...totals.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.name.localeCompare(b.name));
  const totalCount = ranked.reduce((sum, service) => sum + service.count, 0);
  if (totalCount === 0) return [];

  const top = ranked.length > maxSlices ? ranked.slice(0, maxSlices - 1) : ranked;
  const rest = ranked.slice(top.length);
  const slices = top.map((service, index) => ({ ...service, color: serviceColors[index % serviceColors.length] }));
  if (rest.length > 0) {
    slices.push({
      name: i18n.t("reports.charts.otherServices"),
      count: rest.reduce((sum, service) => sum + service.count, 0),
      revenue: rest.reduce((sum, service) => sum + service.revenue, 0),
      color: otherServiceColor,
    });
  }

  return slices.map((slice) => ({ ...slice, percent: Math.round((slice.count / totalCount) * 100) }));
}

export function employeePerformance(orders: Order[], employees: Employee[], period: ReportPeriod): EmployeeResult[] {
  const periodOrders = ordersIn(orders, period.start, period.end);

  return employees
    .map((employee) => {
      const completed = periodOrders.filter((order) => orderAssignedToEmployee(order.assignedEmployeeId, employee) && completedStatuses.has(order.status));
      return { name: employee.name, completed: completed.length, revenue: sumTotals(completed.filter((order) => order.isPaid)) };
    })
    .filter((result) => result.completed > 0)
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

function activityDate(order: Pick<Order, "createdAt" | "updatedAt">) {
  return order.updatedAt?.trim() || order.createdAt;
}

/** Created / completed in-period, plus current open and overdue snapshots. */
export function operationsStats(orders: Order[], period: ReportPeriod, today: string): OperationsStats {
  const created = ordersIn(orders, period.start, period.end).length;
  const completed = orders.filter(
    (order) => completedStatuses.has(order.status) && inRange(activityDate(order), period.start, period.end),
  ).length;

  return {
    created,
    completed,
    open: orders.filter((order) => isOpenOrder(order)).length,
    overdue: orders.filter((order) => isOrderOverdue(order, today)).length,
  };
}

function isAssignedToKnownEmployee(order: Order, employees: Employee[]) {
  return employees.some((employee) => orderAssignedToEmployee(order.assignedEmployeeId, employee));
}

/**
 * Workload for period-created orders by assignee.
 * Includes an Unassigned row when billable period orders have no matching employee.
 */
export function employeeWorkload(orders: Order[], employees: Employee[], period: ReportPeriod, today: string): WorkloadRow[] {
  const periodOrders = ordersIn(orders, period.start, period.end);
  const rows = employees
    .map((employee) => {
      const assigned = periodOrders.filter((order) => orderAssignedToEmployee(order.assignedEmployeeId, employee));
      if (assigned.length === 0) return null;
      return {
        name: employee.name,
        assigned: assigned.length,
        open: assigned.filter((order) => isOpenOrder(order)).length,
        completed: assigned.filter((order) => completedStatuses.has(order.status)).length,
        overdue: assigned.filter((order) => isOrderOverdue(order, today)).length,
      };
    })
    .filter((row): row is WorkloadRow => row != null);

  const unassigned = periodOrders.filter((order) => order.status !== "cancelled" && !isAssignedToKnownEmployee(order, employees));
  if (unassigned.length > 0) {
    rows.push({
      name: i18n.t("reports.charts.unassigned"),
      assigned: unassigned.length,
      open: unassigned.filter((order) => isOpenOrder(order)).length,
      completed: unassigned.filter((order) => completedStatuses.has(order.status)).length,
      overdue: unassigned.filter((order) => isOrderOverdue(order, today)).length,
    });
  }

  return rows.sort((a, b) => b.assigned - a.assigned || b.open - a.open || a.name.localeCompare(b.name));
}

export function lowestStockLevels(items: InventoryItem[], limit = 10): StockLevel[] {
  const ratio = (item: InventoryItem) => item.quantity / Math.max(item.minQuantity, 1);

  return items
    .filter((item) => item.isActive)
    .sort((a, b) => ratio(a) - ratio(b) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((item) => ({ name: item.name, quantity: item.quantity, minimum: item.minQuantity }));
}
