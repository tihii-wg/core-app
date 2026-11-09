import { describe, expect, it } from "vitest";
import type { LedgerPayment } from "../features/finance/paymentTypes";
import { calendarDateKey, isAtOrBelowMinimum, outstandingPaymentStats, recentActivity, relativeDayLabel, startOfWeek, taskOverviewCounts, thisWeekStats, todayRevenueStats, weekDateKeys } from "./dashboardStats";

const sunday = new Date(2026, 8, 27, 15, 0, 0);

function payment(partial: Partial<LedgerPayment> & Pick<LedgerPayment, "id" | "amount">): LedgerPayment {
  return {
    workspaceId: "ws-a",
    orderId: null,
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-09-27T12:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-09-27T12:00:00.000Z",
    ...partial,
  };
}

describe("dashboard week stats", () => {
  it("starts the week on Monday in local time", () => {
    expect(weekDateKeys(sunday)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(startOfWeek(sunday).getDay()).toBe(1);
  });

  it("keeps a date-only value and converts timestamps to the local calendar day", () => {
    expect(calendarDateKey("2026-09-27")).toBe("2026-09-27");
    expect(calendarDateKey("2026-09-27T22:30:00")).toBe("2026-09-27");
    expect(calendarDateKey("not-a-date")).toBe("");
  });

  it("counts current order work and completions from today", () => {
    const counts = taskOverviewCounts(
      [
        { status: "in-progress", updatedAt: "2026-09-20" },
        { status: "waiting-parts", updatedAt: "2026-09-27" },
        { status: "completed", updatedAt: "2026-09-27" },
        { status: "completed", updatedAt: "2026-09-26" },
        { status: "new", updatedAt: "2026-09-27" },
      ],
      "2026-09-27",
    );

    expect(counts).toEqual({ inProgress: 1, waitingParts: 1, completedToday: 1, total: 3 });
  });

  it("summarizes week orders by createdAt and cash revenue by payments.paidAt", () => {
    const stats = thisWeekStats(
      [
        { id: "o1", createdAt: "2026-09-21", isPaid: false, status: "completed", totalPrice: 100 },
        { id: "o2", createdAt: "2026-09-27", isPaid: false, status: "new", totalPrice: 40 },
        { id: "o3", createdAt: "2026-09-20", isPaid: true, status: "paid", totalPrice: 999 },
      ],
      [{ createdAt: "2026-09-22T10:00:00" }, { createdAt: "2026-09-01T10:00:00" }],
      sunday,
      [
        payment({ id: "p1", amount: 100, orderId: "o1", paidAt: "2026-09-21T10:00:00.000Z" }),
        // Outside the week — ignored for cash revenue.
        payment({ id: "p2", amount: 999, orderId: "o3", paidAt: "2026-09-10T10:00:00.000Z" }),
      ],
    );

    expect(stats.orders).toBe(2);
    expect(stats.revenue).toBe(100);
    expect(stats.newClients).toBe(1);
    expect(stats.isEmpty).toBe(false);
    expect(stats.days.map((day) => day.count)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(stats.days.map((day) => day.label)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
  });

  it("does not treat legacy isPaid as week cash without a ledger row", () => {
    const stats = thisWeekStats(
      [{ id: "o1", createdAt: "2026-09-21", isPaid: true, status: "paid", totalPrice: 100 }],
      [],
      sunday,
      [],
    );
    expect(stats.orders).toBe(1);
    expect(stats.revenue).toBe(0);
  });

  it("counts stock that is at or below the minimum quantity", () => {
    expect(isAtOrBelowMinimum({ quantity: 2, minQuantity: 5 })).toBe(true);
    expect(isAtOrBelowMinimum({ quantity: 5, minQuantity: 5 })).toBe(true);
    expect(isAtOrBelowMinimum({ quantity: 0, minQuantity: 0 })).toBe(true);
    expect(isAtOrBelowMinimum({ quantity: 6, minQuantity: 5 })).toBe(false);
    // Quantity wins over a stale stockStatus field.
    expect(isAtOrBelowMinimum({ quantity: 2, minQuantity: 5, stockStatus: "in_stock" })).toBe(true);
    expect(isAtOrBelowMinimum({ quantity: 10, minQuantity: 5, stockStatus: "low_stock" })).toBe(false);
    expect(isAtOrBelowMinimum({ quantity: 0, minQuantity: 1, stockStatus: "out_of_stock", isActive: false })).toBe(false);
    expect(isAtOrBelowMinimum({ quantity: 2, minQuantity: 0, stockStatus: "in_stock" })).toBe(false);
  });

  it("is empty when nothing was created this week", () => {
    const stats = thisWeekStats([{ createdAt: "2026-09-01", isPaid: true, status: "paid", totalPrice: 10 }], [{ createdAt: "2026-08-01" }], sunday);
    expect(stats.isEmpty).toBe(true);
    expect(stats.revenue).toBe(0);
    expect(stats.orders).toBe(0);
    expect(stats.newClients).toBe(0);
  });
});

describe("dashboard money stats", () => {
  const order = (id: string, createdAt: string, totalPrice: number, isPaid: boolean, status = "completed") => ({
    id,
    createdAt,
    totalPrice,
    isPaid,
    status,
  });

  it("sums today's cash by payments.paidAt and compares with yesterday", () => {
    const orders = [
      order("a", "2026-09-27", 150, false),
      order("b", "2026-09-27", 40, false),
      order("c", "2026-09-26", 100, false),
      order("d", "2026-09-20", 999, true),
    ];
    const payments = [
      payment({ id: "p1", amount: 150, orderId: "a", paidAt: "2026-09-27T10:00:00.000Z" }),
      payment({ id: "p2", amount: 100, orderId: "c", paidAt: "2026-09-26T10:00:00.000Z" }),
    ];
    const stats = todayRevenueStats(orders, sunday, payments);
    expect(stats).toEqual({ revenue: 150, paidOrders: 1, changeVsYesterday: 50 });
  });

  it("reports no trend when yesterday had no revenue", () => {
    const stats = todayRevenueStats(
      [order("a", "2026-09-27", 80, false)],
      sunday,
      [payment({ id: "p1", amount: 80, orderId: "a", paidAt: "2026-09-27T10:00:00.000Z" })],
    );
    expect(stats.revenue).toBe(80);
    expect(stats.changeVsYesterday).toBeNull();
  });

  it("counts unpaid orders as outstanding and ignores cancelled ones", () => {
    const stats = outstandingPaymentStats([
      order("1", "2026-09-01", 120, false, "new"),
      order("2", "2026-09-02", 30, false, "in-progress"),
      order("3", "2026-09-03", 500, false, "cancelled"),
      order("4", "2026-09-04", 70, true),
    ]);
    expect(stats).toEqual({ amount: 150, orders: 2 });
  });

  it("counts an order paid only via the ledger as paid even when is_paid is false", () => {
    const orders = [order("o1", "2026-09-01", 100, false, "completed")];
    const payments = [payment({ id: "p1", amount: 100, orderId: "o1", paidAt: "2026-09-27T10:00:00.000Z" })];
    expect(outstandingPaymentStats(orders, payments)).toEqual({ amount: 0, orders: 0 });
    expect(todayRevenueStats(orders, sunday, payments).revenue).toBe(100);
  });

  it("counts only the remaining balance for a partial payment", () => {
    const orders = [order("o1", "2026-09-01", 100, false, "completed")];
    const payments = [payment({ id: "p1", amount: 40, orderId: "o1", paidAt: "2026-09-27T10:00:00.000Z" })];
    expect(outstandingPaymentStats(orders, payments)).toEqual({ amount: 60, orders: 1 });
  });

  it("treats a fully refunded order as unpaid again", () => {
    const orders = [order("o1", "2026-09-01", 100, false, "completed")];
    const payments = [
      payment({ id: "p1", amount: 100, orderId: "o1", paidAt: "2026-09-26T10:00:00.000Z" }),
      payment({
        id: "r1",
        kind: "refund",
        amount: 100,
        orderId: "o1",
        relatedPaymentId: "p1",
        paidAt: "2026-09-27T10:00:00.000Z",
      }),
    ];
    expect(outstandingPaymentStats(orders, payments)).toEqual({ amount: 100, orders: 1 });
    // Net cash today is −100 (refund dated today).
    expect(todayRevenueStats(orders, sunday, payments).revenue).toBe(-100);
  });
});

describe("dashboard recent activity", () => {
  const orders = [
    { id: "o1", orderNumber: "ORD-1", clientName: "Ada", status: "completed", createdAt: "2026-09-20", updatedAt: "2026-09-27" },
    { id: "o2", orderNumber: "ORD-2", clientName: "Bob", status: "new", createdAt: "2026-09-26", updatedAt: "2026-09-26" },
  ];
  const clients = [{ id: "c1", name: "Cleo", created_at: "2026-09-25T09:00:00" }, { id: "c2", name: "Dan", created_at: "" }];

  it("lists real order and client events newest first", () => {
    expect(recentActivity(orders, clients).map((event) => [event.kind, event.date])).toEqual([
      ["order-updated", "2026-09-27"],
      ["order-created", "2026-09-26"],
      ["client-created", "2026-09-25"],
      ["order-created", "2026-09-20"],
    ]);
  });

  it("is empty without records and respects the limit", () => {
    expect(recentActivity([], [])).toEqual([]);
    expect(recentActivity(orders, clients, 2)).toHaveLength(2);
  });

  it("labels today and yesterday relative to now", () => {
    expect(relativeDayLabel("2026-09-27", sunday)).toBe("Today");
    expect(relativeDayLabel("2026-09-26", sunday)).toBe("Yesterday");
    expect(relativeDayLabel("2026-09-20", sunday)).not.toBe("");
  });
});
