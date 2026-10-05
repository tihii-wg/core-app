import i18n from "../../i18n";
import type { Employee, InventoryItem, Order, OrderStatus } from "../../lib/types";
import { ordersIn, percentChange, periodTotals, revenueSeries, serviceDistribution, type ReportPeriod, type ReportRange } from "./reportStats";

export type QuickReportType = "sales" | "inventory" | "employees" | "financial";

export type ReportFormat = "text" | "number" | "money" | "percent" | "share" | "date";

// Secondary columns are shown under the primary value in the document and as their own columns in CSV.
export type ReportColumn = { key: string; header: string; format?: ReportFormat; secondary?: ReportColumn[] };

export type ReportRow = Record<string, string | number | null>;

export type ReportSection =
  | { kind: "table"; title: string; description?: string; columns: ReportColumn[]; rows: ReportRow[]; totals?: ReportRow }
  | { kind: "unavailable"; title: string; description: string };

export type ReportKpi = { label: string; value: number | null; format: ReportFormat; hint?: string };

export type QuickReportModel = { kpis: ReportKpi[]; sections: ReportSection[] };

export type QuickReportDefinition = {
  usesPeriod: boolean;
  needs: { orders: boolean; clients: boolean; employees: boolean; inventory: boolean };
};

export const quickReports: Record<QuickReportType, QuickReportDefinition> = {
  sales: {
    usesPeriod: true,
    needs: { orders: true, clients: true, employees: false, inventory: false },
  },
  inventory: {
    usesPeriod: false,
    needs: { orders: false, clients: false, employees: false, inventory: true },
  },
  employees: {
    usesPeriod: true,
    needs: { orders: true, clients: false, employees: true, inventory: false },
  },
  financial: {
    usesPeriod: true,
    needs: { orders: true, clients: false, employees: false, inventory: true },
  },
};

export const quickReportTypes = Object.keys(quickReports) as QuickReportType[];

export function quickReportTitle(type: QuickReportType) {
  return i18n.t(`reports.quick.${type}.title`);
}

export function quickReportDescription(type: QuickReportType) {
  return i18n.t(`reports.quick.${type}.description`);
}

export function isQuickReportType(value: string | undefined): value is QuickReportType {
  return Boolean(value && value in quickReports);
}

const reportRanges: ReportRange[] = ["last7", "last30", "last90", "thisYear"];

export function toReportRange(value: string | null): ReportRange {
  return reportRanges.includes(value as ReportRange) ? (value as ReportRange) : "last30";
}

const orderStatuses: OrderStatus[] = ["new", "in-progress", "waiting-parts", "completed", "paid", "cancelled"];

function statusLabel(status: OrderStatus) {
  return i18n.t(`status.order.${status}`);
}

function stockStatusLabel(status: InventoryItem["stockStatus"]) {
  return i18n.t(`status.inventory.${status}`);
}

const employeeRoles = new Set(["admin", "manager", "technician", "receptionist"] as const);
const employeeStatuses = new Set(["active", "inactive"] as const);

function employeeRoleLabel(role: string) {
  return employeeRoles.has(role as Employee["role"]) ? i18n.t(`reports.values.employeeRoles.${role as Employee["role"]}`) : capitalize(role);
}

function employeeStatusLabel(status: string) {
  return employeeStatuses.has(status as Employee["status"]) ? i18n.t(`reports.values.employeeStatuses.${status as Employee["status"]}`) : capitalize(status);
}

const closedStatuses = new Set<OrderStatus>(["completed", "paid", "cancelled"]);
const completedStatuses = new Set<OrderStatus>(["completed", "paid"]);

function sum<T>(values: T[], pick: (value: T) => number) {
  return values.reduce((total, value) => total + pick(value), 0);
}

function share(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : null;
}

function changeHint(current: number, previous: number) {
  const change = percentChange(current, previous);
  if (change === null) return i18n.t("reports.hints.noPreviousData");
  return i18n.t("reports.hints.changeVsPrevious", { change: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` });
}

function totalLabel() {
  return i18n.t("common.total");
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function newestFirst(a: Order, b: Order) {
  return b.createdAt.localeCompare(a.createdAt) || b.orderNumber.localeCompare(a.orderNumber);
}

const isBillable = (order: Order) => order.status !== "cancelled";
const isOutstanding = (order: Order) => isBillable(order) && !order.isPaid;

function seriesRows(orders: Order[], period: ReportPeriod) {
  if (ordersIn(orders, period.start, period.end).length === 0) return [];
  return revenueSeries(orders, period).map((point) => ({ period: point.label, orders: point.orders, billed: point.billed, collected: point.revenue, outstanding: point.outstanding }));
}

function stockValue(item: InventoryItem, price: number | null) {
  return price == null ? 0 : item.quantity * price;
}

export function ordersByStatusSection(orders: Order[], period: ReportPeriod): ReportSection {
  const periodOrders = ordersIn(orders, period.start, period.end);
  const rows = orderStatuses
    .map((status) => {
      const matching = periodOrders.filter((order) => order.status === status);
      return { status: statusLabel(status), orders: matching.length, value: sum(matching, (order) => order.totalPrice), share: share(matching.length, periodOrders.length) };
    })
    .filter((row) => row.orders > 0);

  return {
    kind: "table",
    title: i18n.t("reports.sections.ordersByStatus.title"),
    columns: [
      { key: "status", header: i18n.t("reports.columns.status") },
      { key: "orders", header: i18n.t("reports.columns.orders"), format: "number" },
      { key: "value", header: i18n.t("reports.columns.value"), format: "money" },
      { key: "share", header: i18n.t("reports.columns.shareOfOrders"), format: "share" },
    ],
    rows,
  };
}

export function servicesSoldSection(orders: Order[], period: ReportPeriod): ReportSection {
  const services = serviceDistribution(orders, period, Number.POSITIVE_INFINITY);
  const servicesTotal = sum(services, (service) => service.count);

  return {
    kind: "table",
    title: i18n.t("reports.sections.servicesSold.title"),
    description: i18n.t("reports.sections.servicesSold.description"),
    columns: [
      { key: "service", header: i18n.t("reports.columns.service") },
      { key: "count", header: i18n.t("reports.columns.timesPerformed"), format: "number" },
      { key: "revenue", header: i18n.t("reports.columns.value"), format: "money" },
      { key: "share", header: i18n.t("reports.columns.share"), format: "share" },
    ],
    rows: services.map((service) => ({ service: service.name, count: service.count, revenue: service.revenue, share: share(service.count, servicesTotal) })),
  };
}

export function topClientsSection(orders: Order[], period: ReportPeriod, limit = 10): ReportSection {
  const clients = new Map<string, { client: string; orders: number; value: number; paid: number; outstanding: number }>();
  for (const order of ordersIn(orders, period.start, period.end).filter(isBillable)) {
    const key = order.clientId || order.clientName;
    const row = clients.get(key) ?? { client: order.clientName || "—", orders: 0, value: 0, paid: 0, outstanding: 0 };
    row.orders += 1;
    row.value += order.totalPrice;
    if (order.isPaid) row.paid += order.totalPrice;
    else row.outstanding += order.totalPrice;
    clients.set(key, row);
  }
  const limited = Number.isFinite(limit);

  return {
    kind: "table",
    title: limited ? i18n.t("reports.sections.topClients.title") : i18n.t("reports.sections.clientsByValue.title"),
    description: limited ? i18n.t("reports.sections.topClients.description", { count: limit }) : i18n.t("reports.sections.clientsByValue.description"),
    columns: [
      { key: "client", header: i18n.t("reports.columns.client") },
      { key: "orders", header: i18n.t("reports.columns.orders"), format: "number" },
      { key: "value", header: i18n.t("reports.columns.orderValue"), format: "money" },
      { key: "paid", header: i18n.t("reports.columns.paid"), format: "money" },
      { key: "outstanding", header: i18n.t("reports.columns.outstanding"), format: "money" },
    ],
    rows: [...clients.values()].sort((a, b) => b.value - a.value || a.client.localeCompare(b.client)).slice(0, limit),
  };
}

export function ordersListSection(orders: Order[], period: ReportPeriod): ReportSection {
  const periodOrders = ordersIn(orders, period.start, period.end).sort(newestFirst);

  return {
    kind: "table",
    title: i18n.t("reports.sections.orders.title"),
    columns: [
      { key: "number", header: i18n.t("reports.columns.order") },
      { key: "date", header: i18n.t("reports.columns.date"), format: "date" },
      { key: "client", header: i18n.t("reports.columns.client") },
      { key: "status", header: i18n.t("reports.columns.status") },
      { key: "payment", header: i18n.t("reports.columns.payment") },
      { key: "total", header: i18n.t("reports.columns.total"), format: "money" },
    ],
    rows: periodOrders.map((order) => ({ number: order.orderNumber, date: order.createdAt, client: order.clientName, status: statusLabel(order.status), payment: order.isPaid ? i18n.t("status.payment.paid") : i18n.t("status.payment.unpaid"), total: order.totalPrice })),
    totals: periodOrders.length ? { number: totalLabel(), total: sum(periodOrders, (order) => order.totalPrice) } : undefined,
  };
}

export function summaryKpis(orders: Order[], clientCreatedDates: string[], period: ReportPeriod): ReportKpi[] {
  const periodOrders = ordersIn(orders, period.start, period.end);
  const current = periodTotals(orders, clientCreatedDates, period.start, period.end);
  const previous = periodTotals(orders, clientCreatedDates, period.previousStart, period.previousEnd);
  const outstandingOrders = periodOrders.filter(isOutstanding);

  return [
    { label: i18n.t("reports.kpis.revenueCollected"), value: current.revenue, format: "money", hint: changeHint(current.revenue, previous.revenue) },
    { label: i18n.t("reports.kpis.orders"), value: current.orders, format: "number", hint: changeHint(current.orders, previous.orders) },
    { label: i18n.t("reports.kpis.totalOrderValue"), value: sum(periodOrders.filter(isBillable), (order) => order.totalPrice), format: "money", hint: i18n.t("reports.hints.excludesCancelled") },
    { label: i18n.t("reports.kpis.outstanding"), value: sum(outstandingOrders, (order) => order.totalPrice), format: "money", hint: i18n.t("reports.hints.unpaidOrders", { count: outstandingOrders.length }) },
    { label: i18n.t("reports.kpis.averageOrderValue"), value: current.avgOrderValue, format: "money", hint: changeHint(current.avgOrderValue, previous.avgOrderValue) },
    { label: i18n.t("reports.kpis.newClients"), value: current.newClients, format: "number", hint: changeHint(current.newClients, previous.newClients) },
  ];
}

export function salesReport(orders: Order[], clientCreatedDates: string[], period: ReportPeriod): QuickReportModel {
  const billable = ordersIn(orders, period.start, period.end).filter(isBillable);
  const current = periodTotals(orders, clientCreatedDates, period.start, period.end);
  const previous = periodTotals(orders, clientCreatedDates, period.previousStart, period.previousEnd);
  const billed = sum(billable, (order) => order.totalPrice);
  const series = seriesRows(orders, period);

  return {
    kpis: [
      { label: i18n.t("reports.kpis.orders"), value: current.orders, format: "number", hint: changeHint(current.orders, previous.orders) },
      { label: i18n.t("reports.kpis.totalOrderValue"), value: billed, format: "money", hint: i18n.t("reports.hints.excludesCancelled") },
      { label: i18n.t("reports.kpis.revenueCollected"), value: current.revenue, format: "money", hint: changeHint(current.revenue, previous.revenue) },
      { label: i18n.t("reports.kpis.averageOrderValue"), value: current.avgOrderValue, format: "money" },
      { label: i18n.t("reports.kpis.newClients"), value: current.newClients, format: "number", hint: changeHint(current.newClients, previous.newClients) },
      { label: i18n.t("reports.kpis.collectionRate"), value: share(current.revenue, billed), format: "percent", hint: i18n.t("reports.hints.collectionRate") },
    ],
    sections: [
      {
        kind: "table",
        title: i18n.t("reports.sections.salesByPeriod.title"),
        columns: [
          { key: "period", header: i18n.t("reports.columns.period") },
          { key: "orders", header: i18n.t("reports.columns.orders"), format: "number" },
          { key: "billed", header: i18n.t("reports.columns.orderValue"), format: "money" },
          { key: "collected", header: i18n.t("reports.columns.collected"), format: "money" },
        ],
        rows: series,
        totals: series.length ? { period: totalLabel(), orders: current.orders, billed, collected: current.revenue } : undefined,
      },
      ordersByStatusSection(orders, period),
      servicesSoldSection(orders, period),
      topClientsSection(orders, period),
      ordersListSection(orders, period),
    ],
  };
}

export function inventoryReport(items: InventoryItem[]): QuickReportModel {
  const active = items.filter((item) => item.isActive).sort((a, b) => a.name.localeCompare(b.name));
  const inactiveCount = items.length - active.length;
  const unpriced = active.filter((item) => item.purchasePrice == null).length;
  const costValue = sum(active, (item) => stockValue(item, item.purchasePrice));
  const attention = active
    .filter((item) => item.stockStatus !== "in_stock")
    .sort((a, b) => Number(b.stockStatus === "out_of_stock") - Number(a.stockStatus === "out_of_stock") || a.name.localeCompare(b.name));

  const categories = new Map<string, { category: string; items: number; quantity: number; value: number }>();
  for (const item of active) {
    const name = item.category.trim() || i18n.t("reports.values.uncategorized");
    const row = categories.get(name) ?? { category: name, items: 0, quantity: 0, value: 0 };
    row.items += 1;
    row.quantity += item.quantity;
    row.value += stockValue(item, item.purchasePrice);
    categories.set(name, row);
  }
  const categoryRows = [...categories.values()].sort((a, b) => b.value - a.value || a.category.localeCompare(b.category));

  return {
    kpis: [
      { label: i18n.t("reports.kpis.activeItems"), value: active.length, format: "number", hint: inactiveCount ? i18n.t("reports.hints.inactiveNotIncluded", { count: inactiveCount }) : undefined },
      { label: i18n.t("reports.kpis.totalQuantity"), value: sum(active, (item) => item.quantity), format: "number", hint: i18n.t("reports.hints.acrossAllUnits") },
      { label: i18n.t("reports.kpis.stockValueAtCost"), value: costValue, format: "money", hint: unpriced ? i18n.t("reports.hints.itemsWithoutPurchasePrice", { count: unpriced }) : undefined },
      { label: i18n.t("reports.kpis.stockValueAtSellingPrice"), value: sum(active, (item) => stockValue(item, item.sellingPrice)), format: "money" },
      { label: i18n.t("reports.kpis.lowStockItems"), value: active.filter((item) => item.stockStatus === "low_stock").length, format: "number" },
      { label: i18n.t("reports.kpis.outOfStockItems"), value: active.filter((item) => item.stockStatus === "out_of_stock").length, format: "number" },
    ],
    sections: [
      {
        kind: "table",
        title: i18n.t("reports.sections.itemsNeedingAttention.title"),
        description: i18n.t("reports.sections.itemsNeedingAttention.description"),
        columns: [
          { key: "name", header: i18n.t("reports.columns.item"), secondary: [{ key: "sku", header: i18n.t("reports.columns.sku") }] },
          { key: "quantity", header: i18n.t("reports.columns.inStock"), format: "number" },
          { key: "minimum", header: i18n.t("reports.columns.minimum"), format: "number" },
          { key: "unit", header: i18n.t("reports.columns.unit") },
          { key: "status", header: i18n.t("reports.columns.status") },
          { key: "supplier", header: i18n.t("reports.columns.supplier") },
        ],
        rows: attention.map((item) => ({ name: item.name, sku: item.sku, quantity: item.quantity, minimum: item.minQuantity, unit: item.unit, status: stockStatusLabel(item.stockStatus), supplier: item.supplier })),
      },
      {
        kind: "table",
        title: i18n.t("reports.sections.stockByCategory.title"),
        columns: [
          { key: "category", header: i18n.t("reports.columns.category") },
          { key: "items", header: i18n.t("reports.columns.items"), format: "number" },
          { key: "quantity", header: i18n.t("reports.columns.quantity"), format: "number" },
          { key: "value", header: i18n.t("reports.columns.valueAtCost"), format: "money" },
        ],
        rows: categoryRows,
        totals: categoryRows.length ? { category: totalLabel(), items: active.length, quantity: sum(active, (item) => item.quantity), value: costValue } : undefined,
      },
      {
        kind: "table",
        title: i18n.t("reports.sections.stockList.title"),
        columns: [
          { key: "name", header: i18n.t("reports.columns.item"), secondary: [{ key: "sku", header: i18n.t("reports.columns.sku") }] },
          { key: "category", header: i18n.t("reports.columns.category"), secondary: [{ key: "location", header: i18n.t("reports.columns.location") }] },
          { key: "quantity", header: i18n.t("reports.columns.inStock"), format: "number" },
          { key: "unit", header: i18n.t("reports.columns.unit") },
          { key: "cost", header: i18n.t("reports.columns.unitCost"), format: "money" },
          { key: "value", header: i18n.t("reports.columns.valueAtCost"), format: "money" },
          { key: "status", header: i18n.t("reports.columns.status") },
        ],
        rows: active.map((item) => ({
          name: item.name,
          sku: item.sku,
          category: item.category,
          location: item.location,
          quantity: item.quantity,
          unit: item.unit,
          cost: item.purchasePrice,
          value: item.purchasePrice == null ? null : stockValue(item, item.purchasePrice),
          status: stockStatusLabel(item.stockStatus),
        })),
        totals: active.length ? { name: totalLabel(), value: costValue } : undefined,
      },
      { kind: "unavailable", title: i18n.t("reports.sections.stockMovements.title"), description: i18n.t("reports.sections.stockMovements.description") },
    ],
  };
}

export function employeeReport(orders: Order[], employees: Employee[], period: ReportPeriod, today: string): QuickReportModel {
  const periodOrders = ordersIn(orders, period.start, period.end);
  const isOverdue = (order: Order) => !closedStatuses.has(order.status) && Boolean(order.deadline) && order.deadline < today;
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));

  const rows = employees
    .map((employee) => {
      const assigned = periodOrders.filter((order) => order.assignedEmployeeId === employee.id);
      const billable = assigned.filter(isBillable);
      const completed = assigned.filter((order) => completedStatuses.has(order.status));
      return {
        name: employee.name,
        role: employeeRoleLabel(employee.role),
        status: employeeStatusLabel(employee.status),
        assigned: assigned.length,
        completed: completed.length,
        open: assigned.filter((order) => !closedStatuses.has(order.status)).length,
        overdue: assigned.filter(isOverdue).length,
        rate: share(completed.length, billable.length),
        revenue: sum(
          completed.filter((order) => order.isPaid),
          (order) => order.totalPrice,
        ),
      };
    })
    .sort((a, b) => b.completed - a.completed || b.assigned - a.assigned || a.name.localeCompare(b.name));

  const assignedOrders = periodOrders.filter((order) => employeeNames.has(order.assignedEmployeeId));
  const completedCount = assignedOrders.filter((order) => completedStatuses.has(order.status)).length;
  const overdue = assignedOrders.filter(isOverdue).sort((a, b) => a.deadline.localeCompare(b.deadline));

  return {
    kpis: [
      { label: i18n.t("reports.kpis.activeEmployees"), value: employees.filter((employee) => employee.status === "active").length, format: "number" },
      { label: i18n.t("reports.kpis.ordersAssigned"), value: assignedOrders.length, format: "number" },
      { label: i18n.t("reports.kpis.ordersCompleted"), value: completedCount, format: "number" },
      { label: i18n.t("reports.kpis.completionRate"), value: share(completedCount, assignedOrders.filter(isBillable).length), format: "percent", hint: i18n.t("reports.hints.completionRate") },
      { label: i18n.t("reports.kpis.unassignedOrders"), value: periodOrders.filter((order) => isBillable(order) && !employeeNames.has(order.assignedEmployeeId)).length, format: "number" },
      { label: i18n.t("reports.kpis.overdueOpenOrders"), value: overdue.length, format: "number" },
    ],
    sections: [
      {
        kind: "table",
        title: i18n.t("reports.sections.employeePerformance.title"),
        description: i18n.t("reports.sections.employeePerformance.description"),
        columns: [
          {
            key: "name",
            header: i18n.t("reports.columns.employee"),
            secondary: [
              { key: "role", header: i18n.t("reports.columns.role") },
              { key: "status", header: i18n.t("reports.columns.status") },
            ],
          },
          { key: "assigned", header: i18n.t("reports.columns.assigned"), format: "number" },
          { key: "completed", header: i18n.t("reports.columns.completed"), format: "number" },
          { key: "open", header: i18n.t("reports.columns.open"), format: "number" },
          { key: "overdue", header: i18n.t("reports.columns.overdue"), format: "number" },
          { key: "rate", header: i18n.t("reports.columns.completion"), format: "percent" },
          { key: "revenue", header: i18n.t("reports.columns.revenue"), format: "money" },
        ],
        rows,
        totals: rows.length
          ? { name: totalLabel(), assigned: sum(rows, (row) => row.assigned), completed: sum(rows, (row) => row.completed), open: sum(rows, (row) => row.open), overdue: sum(rows, (row) => row.overdue), revenue: sum(rows, (row) => row.revenue) }
          : undefined,
      },
      {
        kind: "table",
        title: i18n.t("reports.sections.overdueOrders.title"),
        description: i18n.t("reports.sections.overdueOrders.description"),
        columns: [
          { key: "number", header: i18n.t("reports.columns.order") },
          { key: "employee", header: i18n.t("reports.columns.employee") },
          { key: "client", header: i18n.t("reports.columns.client") },
          { key: "deadline", header: i18n.t("reports.columns.deadline"), format: "date" },
          { key: "status", header: i18n.t("reports.columns.status") },
        ],
        rows: overdue.map((order) => ({ number: order.orderNumber, employee: employeeNames.get(order.assignedEmployeeId) ?? "—", client: order.clientName, deadline: order.deadline, status: statusLabel(order.status) })),
      },
    ],
  };
}

export function revenueByPeriodSection(orders: Order[], period: ReportPeriod): ReportSection {
  const periodOrders = ordersIn(orders, period.start, period.end);
  const current = periodTotals(orders, [], period.start, period.end);
  const billed = sum(periodOrders.filter(isBillable), (order) => order.totalPrice);
  const outstanding = sum(periodOrders.filter(isOutstanding), (order) => order.totalPrice);
  const series = seriesRows(orders, period);

  return {
    kind: "table",
    title: i18n.t("reports.sections.revenueByPeriod.title"),
    columns: [
      { key: "period", header: i18n.t("reports.columns.period") },
      { key: "orders", header: i18n.t("reports.columns.orders"), format: "number" },
      { key: "billed", header: i18n.t("reports.columns.billed"), format: "money" },
      { key: "collected", header: i18n.t("reports.columns.collected"), format: "money" },
      { key: "outstanding", header: i18n.t("reports.columns.outstanding"), format: "money" },
    ],
    rows: series,
    totals: series.length ? { period: totalLabel(), orders: current.orders, billed, collected: current.revenue, outstanding } : undefined,
  };
}

export function outstandingOrdersSection(orders: Order[], period: ReportPeriod): ReportSection {
  const outstandingOrders = ordersIn(orders, period.start, period.end).filter(isOutstanding).sort(newestFirst);

  return {
    kind: "table",
    title: i18n.t("reports.sections.outstandingOrders.title"),
    description: i18n.t("reports.sections.outstandingOrders.description"),
    columns: [
      { key: "number", header: i18n.t("reports.columns.order") },
      { key: "date", header: i18n.t("reports.columns.date"), format: "date" },
      { key: "client", header: i18n.t("reports.columns.client") },
      { key: "status", header: i18n.t("reports.columns.status") },
      { key: "total", header: i18n.t("reports.columns.amountDue"), format: "money" },
    ],
    rows: outstandingOrders.map((order) => ({ number: order.orderNumber, date: order.createdAt, client: order.clientName, status: statusLabel(order.status), total: order.totalPrice })),
    totals: outstandingOrders.length ? { number: totalLabel(), total: sum(outstandingOrders, (order) => order.totalPrice) } : undefined,
  };
}

export function expensesUnavailable(): ReportSection {
  return { kind: "unavailable", title: i18n.t("reports.sections.expenses.title"), description: i18n.t("reports.sections.expenses.description") };
}

export function invoicesUnavailable(): ReportSection {
  return { kind: "unavailable", title: i18n.t("reports.sections.invoices.title"), description: i18n.t("reports.sections.invoices.description") };
}

export function financialReport(orders: Order[], items: InventoryItem[], period: ReportPeriod): QuickReportModel {
  const periodOrders = ordersIn(orders, period.start, period.end);
  const current = periodTotals(orders, [], period.start, period.end);
  const previous = periodTotals(orders, [], period.previousStart, period.previousEnd);
  const billed = sum(periodOrders.filter(isBillable), (order) => order.totalPrice);
  const outstandingOrders = periodOrders.filter(isOutstanding);
  const outstanding = sum(outstandingOrders, (order) => order.totalPrice);
  const services = serviceDistribution(orders, period, Number.POSITIVE_INFINITY).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  const servicesRevenue = sum(services, (service) => service.revenue);
  const inventoryCost = sum(
    items.filter((item) => item.isActive),
    (item) => stockValue(item, item.purchasePrice),
  );

  return {
    kpis: [
      { label: i18n.t("reports.kpis.revenueCollected"), value: current.revenue, format: "money", hint: changeHint(current.revenue, previous.revenue) },
      { label: i18n.t("reports.kpis.totalBilled"), value: billed, format: "money", hint: i18n.t("reports.hints.orderValueExcludingCancelled") },
      { label: i18n.t("reports.kpis.outstanding"), value: outstanding, format: "money", hint: i18n.t("reports.hints.unpaidOrders", { count: outstandingOrders.length }) },
      { label: i18n.t("reports.kpis.cancelledOrderValue"), value: sum(periodOrders.filter((order) => !isBillable(order)), (order) => order.totalPrice), format: "money" },
      { label: i18n.t("reports.kpis.collectionRate"), value: share(current.revenue, billed), format: "percent" },
      { label: i18n.t("reports.kpis.inventoryValueAtCost"), value: inventoryCost, format: "money", hint: i18n.t("reports.hints.currentStock") },
    ],
    sections: [
      revenueByPeriodSection(orders, period),
      {
        kind: "table",
        title: i18n.t("reports.sections.revenueByService.title"),
        description: i18n.t("reports.sections.revenueByService.description"),
        columns: [
          { key: "service", header: i18n.t("reports.columns.service") },
          { key: "count", header: i18n.t("reports.columns.timesPerformed"), format: "number" },
          { key: "revenue", header: i18n.t("reports.columns.billed"), format: "money" },
          { key: "share", header: i18n.t("reports.columns.shareOfBilled"), format: "share" },
        ],
        rows: services.map((service) => ({ service: service.name, count: service.count, revenue: service.revenue, share: share(service.revenue, servicesRevenue) })),
      },
      outstandingOrdersSection(orders, period),
      expensesUnavailable(),
      invoicesUnavailable(),
    ],
  };
}

function csvRawValue(value: string | number | null | undefined, format: ReportFormat = "text") {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (format === "money") return value.toFixed(2);
    if (format === "percent" || format === "share") return (Math.round(value * 10) / 10).toString();
  }
  return String(value);
}

function csvCell(value: string) {
  return /[",;\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function reportCsv(meta: { title: string; workspace: string; period: string; generated: string }, model: QuickReportModel) {
  const lines: string[][] = [[meta.title], [i18n.t("reports.document.workspace"), meta.workspace], [i18n.t("reports.document.period"), meta.period], [i18n.t("reports.document.generated"), meta.generated]];

  if (model.kpis.length) lines.push([], [i18n.t("reports.document.keyFigures")]);
  for (const kpi of model.kpis) lines.push([kpi.label, csvRawValue(kpi.value, kpi.format)]);

  for (const section of model.sections) {
    lines.push([], [section.title]);
    if (section.kind === "unavailable") {
      lines.push([i18n.t("reports.document.noData"), section.description]);
      continue;
    }
    if (section.rows.length === 0) {
      lines.push([i18n.t("reports.document.noData")]);
      continue;
    }
    const columns = section.columns.flatMap((column) => [column, ...(column.secondary ?? [])]);
    lines.push(columns.map((column) => column.header));
    for (const row of [...section.rows, ...(section.totals ? [section.totals] : [])]) {
      lines.push(columns.map((column) => csvRawValue(row[column.key], column.format)));
    }
  }

  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
}
