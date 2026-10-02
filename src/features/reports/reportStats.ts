import type { Employee, InventoryItem, Order } from "../../lib/types";
import { calendarDateKey, localDateKey, startOfWeek } from "../../pages/dashboardStats";

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

export type SeriesPoint = { key: string; label: string; revenue: number; orders: number };

export type ServiceSlice = { name: string; count: number; revenue: number; percent: number; color: string };

export type EmployeeResult = { name: string; completed: number; revenue: number };

export type StockLevel = { name: string; quantity: number; minimum: number };

const rangeDays: Record<Exclude<ReportRange, "thisYear">, number> = { last7: 7, last30: 30, last90: 90 };
const completedStatuses = new Set(["completed", "paid"]);
export const serviceColors = ["#1973e1", "#099b49", "#f89200", "#6366f1"];
export const otherServiceColor = "#94a3b8";

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

function ordersIn(orders: Order[], start: string, end: string) {
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

// Revenue counts paid orders only, matching the Dashboard's "This Week" revenue.
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

export function summaryStats(orders: Order[], clientCreatedDates: string[], period: ReportPeriod) {
  return {
    current: periodTotals(orders, clientCreatedDates, period.start, period.end),
    previous: periodTotals(orders, clientCreatedDates, period.previousStart, period.previousEnd),
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
  if (granularity === "month") return fromDateKey(`${key}-01`).toLocaleDateString("en", { month: "short" });
  return fromDateKey(key).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function revenueSeries(orders: Order[], period: ReportPeriod): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>();

  for (let day = fromDateKey(period.start); localDateKey(day) <= period.end; day = addDays(day, 1)) {
    const key = bucketKey(localDateKey(day), period.granularity);
    if (!points.has(key)) points.set(key, { key, label: bucketLabel(key, period.granularity), revenue: 0, orders: 0 });
  }

  for (const order of ordersIn(orders, period.start, period.end)) {
    const point = points.get(bucketKey(order.createdAt, period.granularity));
    if (!point) continue;
    point.orders += 1;
    if (order.isPaid) point.revenue += order.totalPrice;
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
      name: "Other",
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
      const completed = periodOrders.filter((order) => order.assignedEmployeeId === employee.id && completedStatuses.has(order.status));
      return { name: employee.name, completed: completed.length, revenue: sumTotals(completed.filter((order) => order.isPaid)) };
    })
    .filter((result) => result.completed > 0)
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

export function lowestStockLevels(items: InventoryItem[], limit = 10): StockLevel[] {
  const ratio = (item: InventoryItem) => item.quantity / Math.max(item.minQuantity, 1);

  return items
    .filter((item) => item.isActive)
    .sort((a, b) => ratio(a) - ratio(b) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((item) => ({ name: item.name, quantity: item.quantity, minimum: item.minQuantity }));
}
