import i18n, { currentIntlLocale } from "../../i18n";
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

const exportSectionNeeds: Record<ExportSectionKey, Partial<DataNeeds>> = {
  summary: { orders: true, clients: true },
  revenue: { orders: true },
  orders: { orders: true },
  services: { orders: true },
  clients: { orders: true, clients: true },
  employees: { orders: true, employees: true },
  inventory: { inventory: true },
};

export const exportSectionKeys = Object.keys(exportSectionNeeds) as ExportSectionKey[];

export function exportSectionLabel(key: ExportSectionKey) {
  return i18n.t(`reports.exportSections.${key}.label`);
}

export function exportSectionDescription(key: ExportSectionKey) {
  return i18n.t(`reports.exportSections.${key}.description`);
}

export function comprehensiveReportTitle() {
  return i18n.t("reports.comprehensive.title");
}

export function exportNeeds(selected: ExportSectionKey[]): DataNeeds {
  const needs: DataNeeds = { orders: false, clients: false, employees: false, inventory: false };
  for (const key of selected) Object.assign(needs, exportSectionNeeds[key]);
  return needs;
}

export function usesPeriod(selected: ExportSectionKey[]) {
  return selected.some((key) => key !== "inventory");
}

export function comprehensiveReportDescription(selected: ExportSectionKey[]) {
  const labels = exportSectionKeys.filter((key) => selected.includes(key)).map((key) => i18n.t(`reports.exportSections.${key}.shortLabel`));
  const list = labels.length > 1 ? i18n.t("reports.comprehensive.listLast", { items: labels.slice(0, -1).join(i18n.t("reports.comprehensive.listSeparator")), last: labels[labels.length - 1] }) : labels.join("");
  return list ? `${list[0].toLocaleUpperCase(currentIntlLocale())}${list.slice(1)}` : "";
}

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
      type: client.client_type ? i18n.t(`reports.values.clientTypes.${client.client_type}`) : null,
      phone: client.phone,
      email: client.email,
      added: calendarDateKey(clientCreatedAt(client)),
    }));

  return {
    kind: "table",
    title: i18n.t("reports.sections.newClients.title"),
    description: i18n.t("reports.sections.newClients.description"),
    columns: [
      { key: "name", header: i18n.t("reports.columns.client"), secondary: [{ key: "contact", header: i18n.t("reports.columns.contactPerson") }] },
      { key: "type", header: i18n.t("reports.columns.type") },
      { key: "phone", header: i18n.t("reports.columns.phone"), secondary: [{ key: "email", header: i18n.t("reports.columns.email") }] },
      { key: "added", header: i18n.t("reports.columns.added"), format: "date" },
    ],
    rows,
  };
}

export function comprehensiveReport(data: ExportData, selected: ExportSectionKey[], period: ReportPeriod, today: string): QuickReportModel {
  const include = new Set(selected);
  const sections: ReportSection[] = [];
  const currentStockNote = i18n.t("reports.sections.currentStockNote");

  if (include.has("revenue")) sections.push(revenueByPeriodSection(data.orders, period), outstandingOrdersSection(data.orders, period), expensesUnavailable(), invoicesUnavailable());
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

function countText(count: number) {
  return count.toLocaleString(currentIntlLocale());
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

  const services = serviceDistribution(data.orders, period, Number.POSITIVE_INFINITY).length;

  return {
    summary: i18n.t("reports.preview.summary", { count: periodOrders.length, countText: countText(periodOrders.length), amount: formatMoney(collected) }),
    revenue: i18n.t("reports.preview.revenue", { count: unpaid, countText: countText(unpaid), amount: formatMoney(billed) }),
    orders: i18n.t("reports.preview.orders", { count: periodOrders.length, countText: countText(periodOrders.length) }),
    services: i18n.t("reports.preview.services", { count: services, countText: countText(services) }),
    clients: i18n.t("reports.preview.clients", { count: clientsWithOrders, countText: countText(clientsWithOrders), newCount: countText(newClients(data.clients, period).length) }),
    employees: i18n.t("reports.preview.employees", { count: data.employees.length, countText: countText(data.employees.length) }),
    inventory: i18n.t("reports.preview.inventory", {
      activeItems: i18n.t("reports.preview.activeItems", { count: activeItems.length, countText: countText(activeItems.length) }),
      attention: i18n.t("reports.preview.needAttention", { count: attention, countText: countText(attention) }),
    }),
  };
}
