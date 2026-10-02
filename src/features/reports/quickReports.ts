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
  title: string;
  description: string;
  usesPeriod: boolean;
  needs: { orders: boolean; clients: boolean; employees: boolean; inventory: boolean };
};

export const quickReports: Record<QuickReportType, QuickReportDefinition> = {
  sales: {
    title: "Sales Report",
    description: "Detailed sales analytics",
    usesPeriod: true,
    needs: { orders: true, clients: true, employees: false, inventory: false },
  },
  inventory: {
    title: "Inventory Report",
    description: "Stock levels and usage",
    usesPeriod: false,
    needs: { orders: false, clients: false, employees: false, inventory: true },
  },
  employees: {
    title: "Employee Report",
    description: "Performance metrics",
    usesPeriod: true,
    needs: { orders: true, clients: false, employees: true, inventory: false },
  },
  financial: {
    title: "Financial Report",
    description: "Revenue and expenses",
    usesPeriod: true,
    needs: { orders: true, clients: false, employees: false, inventory: true },
  },
};

export const quickReportTypes = Object.keys(quickReports) as QuickReportType[];

export function isQuickReportType(value: string | undefined): value is QuickReportType {
  return Boolean(value && value in quickReports);
}

const reportRanges: ReportRange[] = ["last7", "last30", "last90", "thisYear"];

export function toReportRange(value: string | null): ReportRange {
  return reportRanges.includes(value as ReportRange) ? (value as ReportRange) : "last30";
}

const statusLabels: Record<OrderStatus, string> = {
  new: "New",
  "in-progress": "In Progress",
  "waiting-parts": "Waiting Parts",
  completed: "Completed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const stockStatusLabels = { in_stock: "In Stock", low_stock: "Low Stock", out_of_stock: "Out of Stock" } as const;

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
  if (change === null) return "No data for the previous period";
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs previous period`;
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

export function salesReport(orders: Order[], clientCreatedDates: string[], period: ReportPeriod): QuickReportModel {
  const periodOrders = ordersIn(orders, period.start, period.end).sort(newestFirst);
  const billable = periodOrders.filter(isBillable);
  const current = periodTotals(orders, clientCreatedDates, period.start, period.end);
  const previous = periodTotals(orders, clientCreatedDates, period.previousStart, period.previousEnd);
  const billed = sum(billable, (order) => order.totalPrice);
  const series = seriesRows(orders, period);

  const statusRows = (Object.keys(statusLabels) as OrderStatus[])
    .map((status) => {
      const matching = periodOrders.filter((order) => order.status === status);
      return { status: statusLabels[status], orders: matching.length, value: sum(matching, (order) => order.totalPrice), share: share(matching.length, periodOrders.length) };
    })
    .filter((row) => row.orders > 0);

  const services = serviceDistribution(orders, period, Number.POSITIVE_INFINITY);
  const servicesTotal = sum(services, (service) => service.count);

  const clients = new Map<string, { client: string; orders: number; value: number; paid: number; outstanding: number }>();
  for (const order of billable) {
    const key = order.clientId || order.clientName;
    const row = clients.get(key) ?? { client: order.clientName || "—", orders: 0, value: 0, paid: 0, outstanding: 0 };
    row.orders += 1;
    row.value += order.totalPrice;
    if (order.isPaid) row.paid += order.totalPrice;
    else row.outstanding += order.totalPrice;
    clients.set(key, row);
  }
  const clientRows = [...clients.values()].sort((a, b) => b.value - a.value || a.client.localeCompare(b.client)).slice(0, 10);

  return {
    kpis: [
      { label: "Orders", value: current.orders, format: "number", hint: changeHint(current.orders, previous.orders) },
      { label: "Total order value", value: billed, format: "money", hint: "Excludes cancelled orders" },
      { label: "Revenue collected", value: current.revenue, format: "money", hint: changeHint(current.revenue, previous.revenue) },
      { label: "Average order value", value: current.avgOrderValue, format: "money" },
      { label: "New clients", value: current.newClients, format: "number", hint: changeHint(current.newClients, previous.newClients) },
      { label: "Collection rate", value: share(current.revenue, billed), format: "percent", hint: "Revenue collected / order value" },
    ],
    sections: [
      {
        kind: "table",
        title: "Sales by period",
        columns: [
          { key: "period", header: "Period" },
          { key: "orders", header: "Orders", format: "number" },
          { key: "billed", header: "Order value", format: "money" },
          { key: "collected", header: "Collected", format: "money" },
        ],
        rows: series,
        totals: series.length ? { period: "Total", orders: current.orders, billed, collected: current.revenue } : undefined,
      },
      {
        kind: "table",
        title: "Orders by status",
        columns: [
          { key: "status", header: "Status" },
          { key: "orders", header: "Orders", format: "number" },
          { key: "value", header: "Value", format: "money" },
          { key: "share", header: "Share of orders", format: "share" },
        ],
        rows: statusRows,
      },
      {
        kind: "table",
        title: "Services sold",
        description: "Service lines on orders created in this period, excluding cancelled orders.",
        columns: [
          { key: "service", header: "Service" },
          { key: "count", header: "Times performed", format: "number" },
          { key: "revenue", header: "Value", format: "money" },
          { key: "share", header: "Share", format: "share" },
        ],
        rows: services.map((service) => ({ service: service.name, count: service.count, revenue: service.revenue, share: share(service.count, servicesTotal) })),
      },
      {
        kind: "table",
        title: "Top clients",
        description: "Up to 10 clients by order value in this period.",
        columns: [
          { key: "client", header: "Client" },
          { key: "orders", header: "Orders", format: "number" },
          { key: "value", header: "Order value", format: "money" },
          { key: "paid", header: "Paid", format: "money" },
          { key: "outstanding", header: "Outstanding", format: "money" },
        ],
        rows: clientRows,
      },
      {
        kind: "table",
        title: "Orders",
        columns: [
          { key: "number", header: "Order" },
          { key: "date", header: "Date", format: "date" },
          { key: "client", header: "Client" },
          { key: "status", header: "Status" },
          { key: "payment", header: "Payment" },
          { key: "total", header: "Total", format: "money" },
        ],
        rows: periodOrders.map((order) => ({ number: order.orderNumber, date: order.createdAt, client: order.clientName, status: statusLabels[order.status], payment: order.isPaid ? "Paid" : "Unpaid", total: order.totalPrice })),
        totals: periodOrders.length ? { number: "Total", total: sum(periodOrders, (order) => order.totalPrice) } : undefined,
      },
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
    const name = item.category.trim() || "Uncategorized";
    const row = categories.get(name) ?? { category: name, items: 0, quantity: 0, value: 0 };
    row.items += 1;
    row.quantity += item.quantity;
    row.value += stockValue(item, item.purchasePrice);
    categories.set(name, row);
  }
  const categoryRows = [...categories.values()].sort((a, b) => b.value - a.value || a.category.localeCompare(b.category));

  return {
    kpis: [
      { label: "Active items", value: active.length, format: "number", hint: inactiveCount ? `${inactiveCount} inactive not included` : undefined },
      { label: "Total quantity", value: sum(active, (item) => item.quantity), format: "number", hint: "Across all units" },
      { label: "Stock value at cost", value: costValue, format: "money", hint: unpriced ? `${unpriced} items without a purchase price` : undefined },
      { label: "Stock value at selling price", value: sum(active, (item) => stockValue(item, item.sellingPrice)), format: "money" },
      { label: "Low stock items", value: active.filter((item) => item.stockStatus === "low_stock").length, format: "number" },
      { label: "Out of stock items", value: active.filter((item) => item.stockStatus === "out_of_stock").length, format: "number" },
    ],
    sections: [
      {
        kind: "table",
        title: "Items needing attention",
        description: "Active items that are low on stock or out of stock.",
        columns: [
          { key: "name", header: "Item", secondary: [{ key: "sku", header: "SKU" }] },
          { key: "quantity", header: "In stock", format: "number" },
          { key: "minimum", header: "Minimum", format: "number" },
          { key: "unit", header: "Unit" },
          { key: "status", header: "Status" },
          { key: "supplier", header: "Supplier" },
        ],
        rows: attention.map((item) => ({ name: item.name, sku: item.sku, quantity: item.quantity, minimum: item.minQuantity, unit: item.unit, status: stockStatusLabels[item.stockStatus], supplier: item.supplier })),
      },
      {
        kind: "table",
        title: "Stock by category",
        columns: [
          { key: "category", header: "Category" },
          { key: "items", header: "Items", format: "number" },
          { key: "quantity", header: "Quantity", format: "number" },
          { key: "value", header: "Value at cost", format: "money" },
        ],
        rows: categoryRows,
        totals: categoryRows.length ? { category: "Total", items: active.length, quantity: sum(active, (item) => item.quantity), value: costValue } : undefined,
      },
      {
        kind: "table",
        title: "Stock list",
        columns: [
          { key: "name", header: "Item", secondary: [{ key: "sku", header: "SKU" }] },
          { key: "category", header: "Category", secondary: [{ key: "location", header: "Location" }] },
          { key: "quantity", header: "In stock", format: "number" },
          { key: "unit", header: "Unit" },
          { key: "cost", header: "Unit cost", format: "money" },
          { key: "value", header: "Value at cost", format: "money" },
          { key: "status", header: "Status" },
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
          status: stockStatusLabels[item.stockStatus],
        })),
        totals: active.length ? { name: "Total", value: costValue } : undefined,
      },
      { kind: "unavailable", title: "Stock movements and parts usage", description: "Stock movements and parts usage are not recorded yet, so usage history cannot be reported." },
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
        role: capitalize(employee.role),
        status: capitalize(employee.status),
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
      { label: "Active employees", value: employees.filter((employee) => employee.status === "active").length, format: "number" },
      { label: "Orders assigned", value: assignedOrders.length, format: "number" },
      { label: "Orders completed", value: completedCount, format: "number" },
      { label: "Completion rate", value: share(completedCount, assignedOrders.filter(isBillable).length), format: "percent", hint: "Completed / assigned, excluding cancelled" },
      { label: "Unassigned orders", value: periodOrders.filter((order) => isBillable(order) && !employeeNames.has(order.assignedEmployeeId)).length, format: "number" },
      { label: "Overdue open orders", value: overdue.length, format: "number" },
    ],
    sections: [
      {
        kind: "table",
        title: "Performance by employee",
        description: "Orders created in this period, grouped by the assigned employee.",
        columns: [
          {
            key: "name",
            header: "Employee",
            secondary: [
              { key: "role", header: "Role" },
              { key: "status", header: "Status" },
            ],
          },
          { key: "assigned", header: "Assigned", format: "number" },
          { key: "completed", header: "Completed", format: "number" },
          { key: "open", header: "Open", format: "number" },
          { key: "overdue", header: "Overdue", format: "number" },
          { key: "rate", header: "Completion", format: "percent" },
          { key: "revenue", header: "Revenue", format: "money" },
        ],
        rows,
        totals: rows.length
          ? { name: "Total", assigned: sum(rows, (row) => row.assigned), completed: sum(rows, (row) => row.completed), open: sum(rows, (row) => row.open), overdue: sum(rows, (row) => row.overdue), revenue: sum(rows, (row) => row.revenue) }
          : undefined,
      },
      {
        kind: "table",
        title: "Overdue orders",
        description: "Open orders past their deadline.",
        columns: [
          { key: "number", header: "Order" },
          { key: "employee", header: "Employee" },
          { key: "client", header: "Client" },
          { key: "deadline", header: "Deadline", format: "date" },
          { key: "status", header: "Status" },
        ],
        rows: overdue.map((order) => ({ number: order.orderNumber, employee: employeeNames.get(order.assignedEmployeeId) ?? "—", client: order.clientName, deadline: order.deadline, status: statusLabels[order.status] })),
      },
    ],
  };
}

export function financialReport(orders: Order[], items: InventoryItem[], period: ReportPeriod): QuickReportModel {
  const periodOrders = ordersIn(orders, period.start, period.end);
  const current = periodTotals(orders, [], period.start, period.end);
  const previous = periodTotals(orders, [], period.previousStart, period.previousEnd);
  const billed = sum(periodOrders.filter(isBillable), (order) => order.totalPrice);
  const outstandingOrders = periodOrders.filter(isOutstanding).sort(newestFirst);
  const outstanding = sum(outstandingOrders, (order) => order.totalPrice);
  const series = seriesRows(orders, period);
  const services = serviceDistribution(orders, period, Number.POSITIVE_INFINITY).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  const servicesRevenue = sum(services, (service) => service.revenue);
  const inventoryCost = sum(
    items.filter((item) => item.isActive),
    (item) => stockValue(item, item.purchasePrice),
  );

  return {
    kpis: [
      { label: "Revenue collected", value: current.revenue, format: "money", hint: changeHint(current.revenue, previous.revenue) },
      { label: "Total billed", value: billed, format: "money", hint: "Order value excluding cancelled orders" },
      { label: "Outstanding", value: outstanding, format: "money", hint: `${outstandingOrders.length} unpaid orders` },
      { label: "Cancelled order value", value: sum(periodOrders.filter((order) => !isBillable(order)), (order) => order.totalPrice), format: "money" },
      { label: "Collection rate", value: share(current.revenue, billed), format: "percent" },
      { label: "Inventory value at cost", value: inventoryCost, format: "money", hint: "Current stock, not period-based" },
    ],
    sections: [
      {
        kind: "table",
        title: "Revenue by period",
        columns: [
          { key: "period", header: "Period" },
          { key: "orders", header: "Orders", format: "number" },
          { key: "billed", header: "Billed", format: "money" },
          { key: "collected", header: "Collected", format: "money" },
          { key: "outstanding", header: "Outstanding", format: "money" },
        ],
        rows: series,
        totals: series.length ? { period: "Total", orders: current.orders, billed, collected: current.revenue, outstanding } : undefined,
      },
      {
        kind: "table",
        title: "Revenue by service",
        description: "Billed value of service lines, excluding cancelled orders.",
        columns: [
          { key: "service", header: "Service" },
          { key: "count", header: "Times performed", format: "number" },
          { key: "revenue", header: "Billed", format: "money" },
          { key: "share", header: "Share of billed", format: "share" },
        ],
        rows: services.map((service) => ({ service: service.name, count: service.count, revenue: service.revenue, share: share(service.revenue, servicesRevenue) })),
      },
      {
        kind: "table",
        title: "Outstanding orders",
        description: "Unpaid orders created in this period, excluding cancelled orders.",
        columns: [
          { key: "number", header: "Order" },
          { key: "date", header: "Date", format: "date" },
          { key: "client", header: "Client" },
          { key: "status", header: "Status" },
          { key: "total", header: "Amount due", format: "money" },
        ],
        rows: outstandingOrders.map((order) => ({ number: order.orderNumber, date: order.createdAt, client: order.clientName, status: statusLabels[order.status], total: order.totalPrice })),
        totals: outstandingOrders.length ? { number: "Total", total: outstanding } : undefined,
      },
      { kind: "unavailable", title: "Expenses and profit", description: "Expenses are not recorded in the app yet, so costs and profit cannot be calculated." },
      { kind: "unavailable", title: "Invoices", description: "Invoices are not stored in the database yet, so invoice totals cannot be reported." },
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
  const lines: string[][] = [[meta.title], ["Workspace", meta.workspace], ["Period", meta.period], ["Generated", meta.generated], [], ["Key figures"]];

  for (const kpi of model.kpis) lines.push([kpi.label, csvRawValue(kpi.value, kpi.format)]);

  for (const section of model.sections) {
    lines.push([], [section.title]);
    if (section.kind === "unavailable") {
      lines.push(["No data available yet", section.description]);
      continue;
    }
    if (section.rows.length === 0) {
      lines.push(["No data available yet"]);
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
