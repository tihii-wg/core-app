import type { Client, Employee, InventoryItem, Order } from "../../lib/types";
import { calendarDateKey, clientCreatedAt } from "../../pages/dashboardStats";
import { ordersIn, serviceDistribution, type ReportPeriod } from "./reportStats";
import {
  employeeReport,
  expensesUnavailable,
  inventoryReport,
  invoicesUnavailable,
  ordersByStatusSection,
  ordersListSection,
  outstandingOrdersSection,
  revenueByPeriodSection,
  servicesSoldSection,
  summaryKpis,
  topClientsSection,
  type QuickReportModel,
  type ReportSection,
} from "./quickReports";

export type ExportSectionKey = "summary" | "revenue" | "orders" | "services" | "clients" | "employees" | "inventory";

export type ExportData = { orders: Order[]; clients: Client[]; employees: Employee[]; items: InventoryItem[] };

type DataNeeds = { orders: boolean; clients: boolean; employees: boolean; inventory: boolean };

type ExportSectionDefinition = { label: string; shortLabel: string; description: string; needs: Partial<DataNeeds> };

export const exportSections: Record<ExportSectionKey, ExportSectionDefinition> = {
  summary: { label: "Summary / key metrics", shortLabel: "key metrics", description: "Revenue, orders, average order value and new clients", needs: { orders: true, clients: true } },
  revenue: { label: "Revenue / financial data", shortLabel: "revenue", description: "Revenue by period, outstanding orders", needs: { orders: true } },
  orders: { label: "Orders", shortLabel: "orders", description: "Orders by status and the full order list", needs: { orders: true } },
  services: { label: "Services", shortLabel: "services", description: "Services performed and their value", needs: { orders: true } },
  clients: { label: "Clients", shortLabel: "clients", description: "New clients and clients by order value", needs: { orders: true, clients: true } },
  employees: { label: "Employees", shortLabel: "employees", description: "Performance by employee and overdue orders", needs: { orders: true, employees: true } },
  inventory: { label: "Inventory", shortLabel: "inventory", description: "Current stock, items needing attention", needs: { inventory: true } },
};

export const exportSectionKeys = Object.keys(exportSections) as ExportSectionKey[];

export const comprehensiveReportTitle = "Business Report";

export function exportNeeds(selected: ExportSectionKey[]): DataNeeds {
  const needs: DataNeeds = { orders: false, clients: false, employees: false, inventory: false };
  for (const key of selected) Object.assign(needs, exportSections[key].needs);
  return needs;
}

export function usesPeriod(selected: ExportSectionKey[]) {
  return selected.some((key) => key !== "inventory");
}

export function comprehensiveReportDescription(selected: ExportSectionKey[]) {
  const labels = exportSectionKeys.filter((key) => selected.includes(key)).map((key) => exportSections[key].shortLabel);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels.join("");
  return list ? `${list[0].toUpperCase()}${list.slice(1)}` : "";
}

const clientTypeLabels = { individual: "Individual", organization: "Organization" } as const;

function newClients(clients: Client[], period: ReportPeriod) {
  return clients.filter((client) => {
    const created = calendarDateKey(clientCreatedAt(client));
    return created >= period.start && created <= period.end;
  });
}

function newClientsSection(clients: Client[], period: ReportPeriod): ReportSection {
  const rows = newClients(clients, period)
    .sort((a, b) => clientCreatedAt(b).localeCompare(clientCreatedAt(a)) || a.name.localeCompare(b.name))
    .map((client) => ({
      name: client.name,
      contact: client.contact_person,
      type: client.client_type ? clientTypeLabels[client.client_type] : null,
      phone: client.phone,
      email: client.email,
      added: calendarDateKey(clientCreatedAt(client)),
    }));

  return {
    kind: "table",
    title: "New clients",
    description: "Clients added in this period.",
    columns: [
      { key: "name", header: "Client", secondary: [{ key: "contact", header: "Contact person" }] },
      { key: "type", header: "Type" },
      { key: "phone", header: "Phone", secondary: [{ key: "email", header: "Email" }] },
      { key: "added", header: "Added", format: "date" },
    ],
    rows,
  };
}

const currentStockNote = "Current stock, not affected by the report period.";

export function comprehensiveReport(data: ExportData, selected: ExportSectionKey[], period: ReportPeriod, today: string): QuickReportModel {
  const include = new Set(selected);
  const sections: ReportSection[] = [];

  if (include.has("revenue")) sections.push(revenueByPeriodSection(data.orders, period), outstandingOrdersSection(data.orders, period), expensesUnavailable, invoicesUnavailable);
  if (include.has("orders")) sections.push(ordersByStatusSection(data.orders, period), ordersListSection(data.orders, period));
  if (include.has("services")) sections.push(servicesSoldSection(data.orders, period));
  if (include.has("clients")) sections.push(newClientsSection(data.clients, period), topClientsSection(data.orders, period, Number.POSITIVE_INFINITY));
  if (include.has("employees")) sections.push(...employeeReport(data.orders, data.employees, period, today).sections);
  if (include.has("inventory")) {
    sections.push(...inventoryReport(data.items).sections.map((section) => (section.kind === "table" ? { ...section, description: [section.description, currentStockNote].filter(Boolean).join(" ") } : section)));
  }

  return {
    kpis: include.has("summary") ? summaryKpis(data.orders, data.clients.map(clientCreatedAt), period) : [],
    sections,
  };
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

export function exportPreview(data: ExportData, period: ReportPeriod, formatMoney: (value: number) => string): Record<ExportSectionKey, string> {
  const periodOrders = ordersIn(data.orders, period.start, period.end);
  const billable = periodOrders.filter((order) => order.status !== "cancelled");
  const collected = periodOrders.filter((order) => order.isPaid).reduce((total, order) => total + order.totalPrice, 0);
  const billed = billable.reduce((total, order) => total + order.totalPrice, 0);
  const unpaid = billable.filter((order) => !order.isPaid).length;
  const clientsWithOrders = new Set(billable.map((order) => order.clientId || order.clientName)).size;
  const activeItems = data.items.filter((item) => item.isActive);
  const attention = activeItems.filter((item) => item.stockStatus !== "in_stock").length;

  return {
    summary: `${formatMoney(collected)} collected from ${plural(periodOrders.length, "order")}`,
    revenue: `${formatMoney(billed)} billed, ${plural(unpaid, "unpaid order")}`,
    orders: plural(periodOrders.length, "order"),
    services: plural(serviceDistribution(data.orders, period, Number.POSITIVE_INFINITY).length, "service"),
    clients: `${plural(clientsWithOrders, "client")} with orders, ${newClients(data.clients, period).length.toLocaleString()} new`,
    employees: plural(data.employees.length, "employee"),
    inventory: `${plural(activeItems.length, "active item")}, ${attention.toLocaleString()} ${attention === 1 ? "needs" : "need"} attention`,
  };
}
