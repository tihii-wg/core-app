import { describe, expect, it } from "vitest";
import type { Employee, InventoryItem, Order } from "../../lib/types";
import { employeePerformance, lowestStockLevels, otherServiceColor, percentChange, reportPeriod, revenueSeries, serviceDistribution, summaryStats } from "./reportStats";

const now = new Date(2026, 9, 2, 10, 0, 0);

function order(overrides: Partial<Order>): Order {
  return {
    id: "order",
    clientId: "client",
    clientName: "Client",
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

const line = (serviceName: string, quantity = 1, price = 10) => ({ serviceId: serviceName, serviceName, price, quantity });

describe("reportPeriod", () => {
  it("covers the last N days including today and the equally long period before it", () => {
    expect(reportPeriod("last7", now)).toEqual({ start: "2026-09-26", end: "2026-10-02", previousStart: "2026-09-19", previousEnd: "2026-09-25", granularity: "day" });
    expect(reportPeriod("last30", now)).toMatchObject({ start: "2026-09-03", previousStart: "2026-08-04", previousEnd: "2026-09-02", granularity: "day" });
    expect(reportPeriod("last90", now)).toMatchObject({ start: "2026-07-05", granularity: "week" });
  });

  it("compares this year with the same part of last year", () => {
    expect(reportPeriod("thisYear", now)).toEqual({ start: "2026-01-01", end: "2026-10-02", previousStart: "2025-01-01", previousEnd: "2025-10-02", granularity: "month" });
  });
});

describe("summaryStats", () => {
  it("counts paid revenue, orders, new clients and the average order value per period", () => {
    const orders = [
      order({ id: "1", totalPrice: 100, isPaid: true, createdAt: "2026-10-01" }),
      order({ id: "2", totalPrice: 50, createdAt: "2026-09-30" }),
      order({ id: "3", totalPrice: 999, status: "cancelled", createdAt: "2026-09-30" }),
      order({ id: "4", totalPrice: 40, isPaid: true, createdAt: "2026-09-20" }),
      order({ id: "5", totalPrice: 70, isPaid: true, createdAt: "2026-08-01" }),
    ];
    const clients = ["2026-10-02T08:00:00", "2026-09-22T08:00:00", "2026-01-01T08:00:00", ""];

    expect(summaryStats(orders, clients, reportPeriod("last7", now))).toEqual({
      current: { revenue: 100, orders: 3, newClients: 1, avgOrderValue: 75 },
      previous: { revenue: 40, orders: 1, newClients: 1, avgOrderValue: 40 },
    });
  });

  it("reports no change percentage without a previous value", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe("revenueSeries", () => {
  it("has a bucket for every day of the period with paid revenue and order counts", () => {
    const series = revenueSeries([order({ totalPrice: 100, isPaid: true, createdAt: "2026-10-01" }), order({ totalPrice: 30, createdAt: "2026-10-01" }), order({ createdAt: "2026-09-01" })], reportPeriod("last7", now));

    expect(series).toHaveLength(7);
    expect(series[0]).toMatchObject({ key: "2026-09-26", label: "Sep 26", revenue: 0, orders: 0 });
    expect(series[5]).toMatchObject({ key: "2026-10-01", label: "Oct 1", revenue: 100, orders: 2 });
  });

  it("groups by Monday-based weeks for 90 days and by month for this year", () => {
    const weekly = revenueSeries([order({ createdAt: "2026-09-30" })], reportPeriod("last90", now));
    expect(weekly.find((point) => point.key === "2026-09-28")?.orders).toBe(1);

    const monthly = revenueSeries([order({ createdAt: "2026-02-14", isPaid: true, totalPrice: 20 })], reportPeriod("thisYear", now));
    expect(monthly.map((point) => point.label)).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
    expect(monthly[1]).toMatchObject({ revenue: 20, orders: 1 });
  });
});

describe("serviceDistribution", () => {
  it("ranks services by how often they were performed and folds the tail into Other", () => {
    const orders = [
      order({ services: [line("Oil change", 3), line("Brake check")] }),
      order({ services: [line("oil change"), line("Wash", 2), line("Tires"), line("Glass"), line("Paint")] }),
      order({ status: "cancelled", services: [line("Brake check", 10)] }),
      order({ createdAt: "2025-01-01", services: [line("Brake check", 10)] }),
    ];

    const slices = serviceDistribution(orders, reportPeriod("last7", now));

    expect(slices.map((slice) => [slice.name, slice.count, slice.percent])).toEqual([
      ["Oil change", 4, 40],
      ["Wash", 2, 20],
      ["Brake check", 1, 10],
      ["Glass", 1, 10],
      ["Other", 2, 20],
    ]);
    expect(slices.at(-1)?.color).toBe(otherServiceColor);
  });

  it("is empty without performed services", () => {
    expect(serviceDistribution([order({})], reportPeriod("last7", now))).toEqual([]);
  });
});

describe("employeePerformance", () => {
  it("counts completed and paid orders per assigned employee in the period", () => {
    const employees = [{ id: "e1", name: "Tom" }, { id: "e2", name: "Ann" }, { id: "e3", name: "Idle" }] as Employee[];
    const orders = [
      order({ assignedEmployeeId: "e1", status: "completed" }),
      order({ assignedEmployeeId: "e1", status: "paid", isPaid: true, totalPrice: 80 }),
      order({ assignedEmployeeId: "e1", status: "in-progress" }),
      order({ assignedEmployeeId: "e2", status: "completed" }),
      order({ assignedEmployeeId: "e3", status: "completed", createdAt: "2025-01-01" }),
    ];

    expect(employeePerformance(orders, employees, reportPeriod("last7", now))).toEqual([
      { name: "Tom", completed: 2, revenue: 80 },
      { name: "Ann", completed: 1, revenue: 0 },
    ]);
  });
});

describe("lowestStockLevels", () => {
  it("lists active items with the lowest stock relative to their minimum", () => {
    const item = (name: string, quantity: number, minQuantity: number, isActive = true) => ({ name, quantity, minQuantity, isActive }) as InventoryItem;

    expect(lowestStockLevels([item("Plenty", 50, 5), item("Empty", 0, 2), item("Low", 2, 5), item("Retired", 0, 5, false)], 2)).toEqual([
      { name: "Empty", quantity: 0, minimum: 2 },
      { name: "Low", quantity: 2, minimum: 5 },
    ]);
  });
});
