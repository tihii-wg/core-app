import { describe, expect, it } from "vitest";
import type { Client, Employee, InventoryItem, Order } from "../../lib/types";
import { reportPeriod } from "./reportStats";
import { reportCsv, type QuickReportModel, type ReportSection } from "./quickReports";
import { comprehensiveReport, comprehensiveReportDescription, exportNeeds, exportPreview, exportSectionKeys, usesPeriod, type ExportData } from "./comprehensiveReport";

const now = new Date(2026, 9, 2, 10, 0, 0);
const period = reportPeriod("last7", now);
const today = "2026-10-02";

function order(overrides: Partial<Order>): Order {
  return {
    id: "order",
    clientId: "client-1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "Car",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...overrides,
  };
}

function client(overrides: Partial<Client>): Client {
  return { id: "client-1", name: "Ada", email: "", phone: "", address: "", balance: 0, created_at: "2026-01-01T10:00:00Z", client_type: "individual", tax_id: null, contact_person: null, ...overrides };
}

const data: ExportData = {
  orders: [
    order({ id: "o1", orderNumber: "ORD-1", status: "paid", isPaid: true, totalPrice: 100, assignedEmployeeId: "e1", services: [{ serviceId: "s1", serviceName: "Oil change", price: 100, quantity: 1 }] }),
    order({ id: "o2", orderNumber: "ORD-2", clientId: "client-2", clientName: "Bob", totalPrice: 50 }),
    order({ id: "o-old", orderNumber: "ORD-OLD", totalPrice: 999, createdAt: "2026-08-01" }),
  ],
  clients: [client({}), client({ id: "client-2", name: "Bob", client_type: "organization", contact_person: "Bea", phone: "+1 555", email: "bob@example.com", created_at: "2026-09-30T08:00:00Z" })],
  employees: [{ id: "e1", name: "Tom Tech", role: "technician", status: "active" } as Employee],
  items: [
    { id: "i1", workspaceId: "ws", name: "Brake pads", sku: "BP-1", description: "", category: "Parts", quantity: 2, minQuantity: 5, unit: "pcs", purchasePrice: 10, sellingPrice: 15, supplier: "", location: "", isActive: true, stockStatus: "low_stock", createdAt: "", updatedAt: "" } as InventoryItem,
  ],
};

const titles = (model: QuickReportModel) => model.sections.map((section) => section.title);

function table(model: QuickReportModel, title: string) {
  const section = model.sections.find((entry) => entry.title === title);
  if (section?.kind !== "table") throw new Error(`No table "${title}"`);
  return section as Extract<ReportSection, { kind: "table" }>;
}

describe("comprehensiveReport", () => {
  it("includes every section in a fixed order when everything is selected", () => {
    const model = comprehensiveReport(data, [...exportSectionKeys].reverse(), period, today);

    expect(model.kpis.map((kpi) => kpi.label)).toEqual(["Revenue collected", "Orders", "Total order value", "Outstanding", "Average order value", "New clients"]);
    expect(titles(model)).toEqual([
      "Revenue by period",
      "Outstanding orders",
      "Expenses and profit",
      "Invoices",
      "Orders by status",
      "Orders",
      "Services sold",
      "New clients",
      "Clients by order value",
      "Performance by employee",
      "Overdue orders",
      "Items needing attention",
      "Stock by category",
      "Stock list",
      "Stock movements and parts usage",
    ]);
  });

  it("uses only orders from the selected period and the summary figures only when selected", () => {
    const model = comprehensiveReport(data, ["orders", "clients"], period, today);

    expect(model.kpis).toEqual([]);
    expect(titles(model)).toEqual(["Orders by status", "Orders", "New clients", "Clients by order value"]);
    expect(table(model, "Orders").rows.map((row) => row.number)).toEqual(["ORD-2", "ORD-1"]);
    expect(table(model, "Orders").totals?.total).toBe(150);
    expect(table(model, "New clients").rows).toEqual([{ name: "Bob", contact: "Bea", type: "Organization", phone: "+1 555", email: "bob@example.com", added: "2026-09-30" }]);
    expect(table(model, "Clients by order value").rows.map((row) => row.client)).toEqual(["Ada", "Bob"]);
  });

  it("calculates summary figures for the period", () => {
    const model = comprehensiveReport(data, ["summary"], period, today);
    const value = (label: string) => model.kpis.find((kpi) => kpi.label === label)?.value;

    expect(model.sections).toEqual([]);
    expect(value("Revenue collected")).toBe(100);
    expect(value("Orders")).toBe(2);
    expect(value("Outstanding")).toBe(50);
    expect(value("New clients")).toBe(1);
  });

  it("marks inventory tables as current stock", () => {
    const model = comprehensiveReport(data, ["inventory"], period, today);

    expect(table(model, "Stock list").description).toBe("Current stock, not affected by the report period.");
    expect(table(model, "Items needing attention").description).toBe("Active items that are low on stock or out of stock. Current stock, not affected by the report period.");
  });

  it("exports to CSV without an empty key figures block", () => {
    const csv = reportCsv({ title: "Business Report", workspace: "Garage", period: "p", generated: "g" }, comprehensiveReport(data, ["services"], period, today));

    expect(csv).not.toContain("Key figures");
    expect(csv.split("\r\n").slice(4)).toEqual(["", "Services sold", "Service,Times performed,Value,Share", "Oil change,1,100.00,100"]);
  });
});

describe("export helpers", () => {
  it("fetches only the data the selected sections need", () => {
    expect(exportNeeds(["inventory"])).toEqual({ orders: false, clients: false, employees: false, inventory: true });
    expect(exportNeeds(["summary", "employees"])).toEqual({ orders: true, clients: true, employees: true, inventory: false });
  });

  it("describes the selected sections in report order", () => {
    expect(comprehensiveReportDescription(["inventory", "summary", "orders"])).toBe("Key metrics, orders and inventory");
    expect(comprehensiveReportDescription(["clients"])).toBe("Clients");
  });

  it("treats an inventory-only export as a point-in-time report", () => {
    expect(usesPeriod(["inventory"])).toBe(false);
    expect(usesPeriod(["inventory", "orders"])).toBe(true);
  });

  it("summarises what each section will contain", () => {
    expect(exportPreview(data, period, (value) => `$${value}`)).toEqual({
      summary: "$100 collected from 2 orders",
      revenue: "$150 billed, 1 unpaid order",
      orders: "2 orders",
      services: "1 service",
      clients: "2 clients with orders, 1 new",
      employees: "1 employee",
      inventory: "1 active item, 1 needs attention",
    });
  });
});
