import { describe, expect, it } from "vitest";
import type { Employee, InventoryItem, Order } from "../../lib/types";
import { reportPeriod } from "./reportStats";
import { employeeReport, financialReport, inventoryReport, isQuickReportType, reportCsv, salesReport, toReportRange, type QuickReportModel, type ReportSection } from "./quickReports";

const now = new Date(2026, 9, 2, 10, 0, 0);
const period = reportPeriod("last7", now);

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

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item",
    workspaceId: "ws",
    name: "Item",
    sku: "",
    description: "",
    category: "",
    quantity: 0,
    minQuantity: 0,
    unit: "pcs",
    purchasePrice: null,
    sellingPrice: null,
    supplier: "",
    location: "",
    isActive: true,
    stockStatus: "in_stock",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function kpi(model: QuickReportModel, label: string) {
  return model.kpis.find((entry) => entry.label === label);
}

function table(model: QuickReportModel, title: string) {
  const section = model.sections.find((entry) => entry.title === title) as Extract<ReportSection, { kind: "table" }> | undefined;
  if (section?.kind !== "table") throw new Error(`No table "${title}"`);
  return section;
}

const line = (serviceName: string, price: number, quantity = 1) => ({ serviceId: serviceName, serviceName, price, quantity });

describe("salesReport", () => {
  const orders = [
    order({ id: "1", orderNumber: "ORD-1", clientId: "c1", clientName: "Ada", totalPrice: 100, isPaid: true, status: "paid", createdAt: "2026-10-01", services: [line("Oil change", 100)] }),
    order({ id: "2", orderNumber: "ORD-2", clientId: "c2", clientName: "Bob", totalPrice: 300, status: "in-progress", createdAt: "2026-09-30", services: [line("Brakes", 150, 2)] }),
    order({ id: "3", orderNumber: "ORD-3", clientId: "c1", clientName: "Ada", totalPrice: 50, status: "cancelled", createdAt: "2026-09-29" }),
    order({ id: "4", orderNumber: "ORD-0", totalPrice: 80, isPaid: true, createdAt: "2026-09-20" }),
  ];
  const model = salesReport(orders, ["2026-10-01T09:00:00"], period);

  it("summarises orders, order value, collected revenue and collection rate", () => {
    expect(kpi(model, "Orders")).toMatchObject({ value: 3, hint: "+200.0% vs previous period" });
    expect(kpi(model, "Total order value")?.value).toBe(400);
    expect(kpi(model, "Revenue collected")).toMatchObject({ value: 100, hint: "+25.0% vs previous period" });
    expect(kpi(model, "Average order value")?.value).toBe(200);
    expect(kpi(model, "New clients")).toMatchObject({ value: 1, hint: "No data for the previous period" });
    expect(kpi(model, "Collection rate")?.value).toBe(25);
  });

  it("breaks sales down by status, service, client and order", () => {
    expect(table(model, "Orders by status").rows.map((row) => [row.status, row.orders])).toEqual([
      ["In Progress", 1],
      ["Paid", 1],
      ["Cancelled", 1],
    ]);
    expect(table(model, "Services sold").rows.map((row) => [row.service, row.count, row.revenue])).toEqual([
      ["Brakes", 2, 300],
      ["Oil change", 1, 100],
    ]);
    expect(table(model, "Top clients").rows).toEqual([
      { client: "Bob", orders: 1, value: 300, paid: 0, outstanding: 300 },
      { client: "Ada", orders: 1, value: 100, paid: 100, outstanding: 0 },
    ]);
    expect(table(model, "Orders").rows.map((row) => row.number)).toEqual(["ORD-1", "ORD-2", "ORD-3"]);
    expect(table(model, "Orders").totals).toEqual({ number: "Total", total: 450 });
    expect(table(model, "Sales by period").rows).toHaveLength(7);
  });

  it("leaves every table empty for a period without orders", () => {
    const empty = salesReport([], [], period);
    expect(empty.sections.every((section) => section.kind === "table" && section.rows.length === 0 && !section.totals)).toBe(true);
    expect(kpi(empty, "Collection rate")?.value).toBeNull();
  });
});

describe("inventoryReport", () => {
  const model = inventoryReport([
    item({ name: "Pads", category: "Brakes", quantity: 2, minQuantity: 5, purchasePrice: 10, sellingPrice: 15, stockStatus: "low_stock", supplier: "ACME" }),
    item({ name: "Oil", category: "Fluids", quantity: 0, minQuantity: 1, purchasePrice: 5, stockStatus: "out_of_stock" }),
    item({ name: "Filter", quantity: 10, purchasePrice: null, sellingPrice: 8 }),
    item({ name: "Old", quantity: 99, purchasePrice: 100, isActive: false }),
  ]);

  it("values active stock and counts items needing attention", () => {
    expect(kpi(model, "Active items")).toMatchObject({ value: 3, hint: "1 inactive not included" });
    expect(kpi(model, "Stock value at cost")).toMatchObject({ value: 20, hint: "1 items without a purchase price" });
    expect(kpi(model, "Stock value at selling price")?.value).toBe(110);
    expect(kpi(model, "Low stock items")?.value).toBe(1);
    expect(kpi(model, "Out of stock items")?.value).toBe(1);
  });

  it("lists attention items out-of-stock first, groups by category and reports missing usage history", () => {
    expect(table(model, "Items needing attention").rows.map((row) => [row.name, row.status])).toEqual([
      ["Oil", "Out of Stock"],
      ["Pads", "Low Stock"],
    ]);
    expect(table(model, "Stock by category").rows.map((row) => row.category)).toEqual(["Brakes", "Fluids", "Uncategorized"]);
    expect(table(model, "Stock list").rows.find((row) => row.name === "Filter")).toMatchObject({ cost: null, value: null });
    expect(model.sections.find((section) => section.title === "Stock movements and parts usage")?.kind).toBe("unavailable");
  });
});

describe("employeeReport", () => {
  it("measures each employee's assigned, completed, open and overdue orders", () => {
    const employees = [
      { id: "e1", name: "Tom", role: "technician", status: "active" },
      { id: "e2", name: "Ann", role: "manager", status: "inactive" },
    ] as Employee[];
    const orders = [
      order({ assignedEmployeeId: "e1", status: "paid", isPaid: true, totalPrice: 90 }),
      order({ assignedEmployeeId: "e1", status: "in-progress", deadline: "2026-09-30", orderNumber: "ORD-LATE" }),
      order({ assignedEmployeeId: "e1", status: "cancelled" }),
      order({ assignedEmployeeId: "e2", status: "new", deadline: "2026-12-01" }),
      order({ status: "new" }),
    ];

    const model = employeeReport(orders, employees, period, "2026-10-02");

    expect(table(model, "Performance by employee").rows).toEqual([
      { name: "Tom", role: "Technician", status: "Active", assigned: 3, completed: 1, open: 1, overdue: 1, rate: 50, revenue: 90 },
      { name: "Ann", role: "Manager", status: "Inactive", assigned: 1, completed: 0, open: 1, overdue: 0, rate: 0, revenue: 0 },
    ]);
    expect(kpi(model, "Active employees")?.value).toBe(1);
    expect(kpi(model, "Unassigned orders")?.value).toBe(1);
    expect(kpi(model, "Completion rate")?.value).toBeCloseTo(33.33, 1);
    expect(table(model, "Overdue orders").rows).toEqual([{ number: "ORD-LATE", employee: "Tom", client: "Ada", deadline: "2026-09-30", status: "In Progress" }]);
  });
});

describe("financialReport", () => {
  it("reports collected, billed, outstanding and cancelled amounts, and marks expenses as unavailable", () => {
    const orders = [
      order({ totalPrice: 100, isPaid: true, status: "paid", services: [line("Oil change", 100)] }),
      order({ orderNumber: "ORD-2", totalPrice: 300, services: [line("Brakes", 300)] }),
      order({ totalPrice: 40, status: "cancelled" }),
    ];

    const model = financialReport(orders, [item({ quantity: 3, purchasePrice: 10 })], period);

    expect(kpi(model, "Revenue collected")?.value).toBe(100);
    expect(kpi(model, "Total billed")?.value).toBe(400);
    expect(kpi(model, "Outstanding")).toMatchObject({ value: 300, hint: "1 unpaid orders" });
    expect(kpi(model, "Cancelled order value")?.value).toBe(40);
    expect(kpi(model, "Inventory value at cost")?.value).toBe(30);
    expect(table(model, "Revenue by service").rows.map((row) => [row.service, row.share])).toEqual([
      ["Brakes", 75],
      ["Oil change", 25],
    ]);
    expect(table(model, "Outstanding orders").rows.map((row) => row.number)).toEqual(["ORD-2"]);
    expect(table(model, "Revenue by period").totals).toMatchObject({ billed: 400, collected: 100, outstanding: 300 });
    expect(model.sections.filter((section) => section.kind === "unavailable").map((section) => section.title)).toEqual(["Expenses and profit", "Invoices"]);
  });
});

describe("reportCsv", () => {
  it("writes raw values, escapes separators and marks missing data", () => {
    const csv = reportCsv(
      { title: "Sales Report", workspace: 'Garage "A", Ltd', period: "01.10.2026 – 02.10.2026", generated: "02.10.2026 10:00" },
      {
        kpis: [
          { label: "Revenue", value: 1234.5, format: "money" },
          { label: "Rate", value: 33.333, format: "percent" },
          { label: "Empty", value: null, format: "percent" },
        ],
        sections: [
          { kind: "table", title: "Orders", columns: [{ key: "number", header: "Order" }, { key: "total", header: "Total", format: "money" }], rows: [{ number: "ORD-1", total: 10 }], totals: { number: "Total", total: 10 } },
          { kind: "table", title: "Clients", columns: [{ key: "name", header: "Name" }], rows: [] },
          { kind: "unavailable", title: "Expenses", description: "Not recorded." },
        ],
      },
    );

    expect(csv.split("\r\n")).toEqual([
      "Sales Report",
      'Workspace,"Garage ""A"", Ltd"',
      "Period,01.10.2026 – 02.10.2026",
      "Generated,02.10.2026 10:00",
      "",
      "Key figures",
      "Revenue,1234.50",
      "Rate,33.3",
      "Empty,",
      "",
      "Orders",
      "Order,Total",
      "ORD-1,10.00",
      "Total,10.00",
      "",
      "Clients",
      "No data available yet",
      "",
      "Expenses",
      "No data available yet,Not recorded.",
    ]);
  });

  it("exports secondary values as their own columns", () => {
    const csv = reportCsv(
      { title: "Employee Report", workspace: "Garage", period: "p", generated: "g" },
      {
        kpis: [],
        sections: [
          {
            kind: "table",
            title: "Staff",
            columns: [{ key: "name", header: "Employee", secondary: [{ key: "role", header: "Role" }] }, { key: "assigned", header: "Assigned", format: "number" }],
            rows: [{ name: "Tom Tech", role: "Technician", assigned: 3 }],
            totals: { name: "Total", assigned: 3 },
          },
        ],
      },
    );

    expect(csv.split("\r\n").slice(-4)).toEqual(["Staff", "Employee,Role,Assigned", "Tom Tech,Technician,3", "Total,,3"]);
  });
});

describe("route helpers", () => {
  it("accepts only known report types and ranges", () => {
    expect(isQuickReportType("sales")).toBe(true);
    expect(isQuickReportType("payroll")).toBe(false);
    expect(isQuickReportType(undefined)).toBe(false);
    expect(toReportRange("last90")).toBe("last90");
    expect(toReportRange("forever")).toBe("last30");
    expect(toReportRange(null)).toBe("last30");
  });
});
