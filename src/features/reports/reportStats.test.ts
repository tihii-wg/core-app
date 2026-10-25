import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import type { Employee, InventoryItem, Order } from "../../lib/types";
import type { LedgerPayment } from "../finance/paymentTypes";
import {
  employeePerformance,
  employeeWorkload,
  lowestStockLevels,
  operationsStats,
  otherServiceColor,
  percentChange,
  reportPeriod,
  revenueSeries,
  revenueSeriesWithLedger,
  serviceDistribution,
  summaryStats,
  summaryStatsWithLedger,
} from "./reportStats";

function ledgerPayment(partial: Partial<LedgerPayment> & Pick<LedgerPayment, "id" | "amount">): LedgerPayment {
  return {
    workspaceId: "ws-a",
    orderId: null,
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-10-01T12:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    ...partial,
  };
}

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

describe("summaryStatsWithLedger", () => {
  it("uses payment paid_at for confirmed revenue instead of order isPaid/createdAt", () => {
    const orders = [order({ id: "1", totalPrice: 100, isPaid: true, createdAt: "2026-10-01" })];
    const payments = [
      ledgerPayment({ id: "p1", amount: 60, paidAt: "2026-10-01T10:00:00.000Z", orderId: "1" }),
      ledgerPayment({ id: "p2", amount: 999, paidAt: "2026-08-01T10:00:00.000Z", orderId: "1" }),
    ];
    const stats = summaryStatsWithLedger(orders, [], reportPeriod("last7", now), payments, "MDL");
    expect(stats.current.revenue).toBe(60);
    expect(stats.current.orders).toBe(1);
  });
});

describe("revenueSeriesWithLedger", () => {
  it("buckets confirmed revenue by paid_at and does not count legacy isPaid as cash", () => {
    const series = revenueSeriesWithLedger(
      [order({ id: "1", totalPrice: 100, isPaid: true, createdAt: "2026-10-01" })],
      reportPeriod("last7", now),
      [ledgerPayment({ id: "p1", amount: 40, paidAt: "2026-10-01T10:00:00.000Z", orderId: "1" })],
      "MDL",
    );
    expect(series.find((point) => point.key === "2026-10-01")).toMatchObject({ revenue: 40, orders: 1, outstanding: 60 });
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

describe("operationsStats", () => {
  const today = "2026-10-02";
  const period = reportPeriod("last7", now);

  it("separates period created/completed from live open and overdue snapshots", () => {
    const orders = [
      order({ id: "created", createdAt: "2026-10-01", status: "new" }),
      order({ id: "completed-in", createdAt: "2026-09-01", updatedAt: "2026-09-30", status: "completed" }),
      order({ id: "completed-out", createdAt: "2026-08-01", updatedAt: "2026-08-15", status: "paid", isPaid: true }),
      order({ id: "open", createdAt: "2026-08-01", status: "in-progress", deadline: "2026-10-10" }),
      order({ id: "overdue", createdAt: "2026-08-01", status: "waiting-parts", deadline: "2026-09-01" }),
      order({ id: "closed-old", createdAt: "2026-08-01", status: "cancelled", deadline: "2026-01-01" }),
    ];

    expect(operationsStats(orders, period, today)).toEqual({
      created: 1,
      completed: 1,
      open: 3,
      overdue: 1,
    });
  });

  it("is empty when there are no orders", () => {
    expect(operationsStats([], period, today)).toEqual({ created: 0, completed: 0, open: 0, overdue: 0 });
  });

  it("uses createdAt when updatedAt is missing for completed-in-period", () => {
    expect(
      operationsStats(
        [order({ status: "completed", createdAt: "2026-09-28", updatedAt: "" })],
        period,
        today,
      ),
    ).toEqual({ created: 1, completed: 1, open: 0, overdue: 0 });
  });
});

describe("employeeWorkload", () => {
  const today = "2026-10-02";
  const period = reportPeriod("last7", now);

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("groups period-created orders by assignee and includes an Unassigned row", () => {
    const employees = [
      { id: "e1", name: "Tom", profile_id: "p1" },
      { id: "e2", name: "Ann", profile_id: "p2" },
    ] as Employee[];
    const orders = [
      order({ id: "t1", assignedEmployeeId: "e1", status: "in-progress", deadline: "2026-09-01" }),
      order({ id: "t2", assignedEmployeeId: "p1", status: "completed" }),
      order({ id: "a1", assignedEmployeeId: "e2", status: "new", deadline: "2026-10-10" }),
      order({ id: "u1", assignedEmployeeId: "", status: "waiting-parts", deadline: "2026-09-15" }),
      order({ id: "u2", assignedEmployeeId: "unknown", status: "new" }),
      order({ id: "cancelled-unassigned", assignedEmployeeId: "", status: "cancelled" }),
      order({ id: "outside", assignedEmployeeId: "e1", status: "new", createdAt: "2025-01-01" }),
    ];

    expect(employeeWorkload(orders, employees, period, today)).toEqual([
      { name: "Unassigned", assigned: 2, open: 2, completed: 0, overdue: 1 },
      { name: "Tom", assigned: 2, open: 1, completed: 1, overdue: 1 },
      { name: "Ann", assigned: 1, open: 1, completed: 0, overdue: 0 },
    ]);
  });

  it("returns an empty list when the period has no billable assigned or unassigned work", () => {
    expect(employeeWorkload([order({ status: "cancelled", assignedEmployeeId: "" })], [], period, today)).toEqual([]);
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
