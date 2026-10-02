import { describe, expect, it } from "vitest";
import { calendarDateKey, isAtOrBelowMinimum, outstandingPaymentStats, recentActivity, relativeDayLabel, startOfWeek, taskOverviewCounts, thisWeekStats, todayRevenueStats, weekDateKeys } from "./dashboardStats";

const sunday = new Date(2026, 8, 27, 15, 0, 0);

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

  it("summarizes only orders and clients from the current week", () => {
    const stats = thisWeekStats(
      [
        { createdAt: "2026-09-21", isPaid: true, totalPrice: 100 },
        { createdAt: "2026-09-27", isPaid: false, totalPrice: 40 },
        { createdAt: "2026-09-20", isPaid: true, totalPrice: 999 },
      ],
      [{ createdAt: "2026-09-22T10:00:00" }, { createdAt: "2026-09-01T10:00:00" }],
      sunday,
    );

    expect(stats.orders).toBe(2);
    expect(stats.revenue).toBe(100);
    expect(stats.newClients).toBe(1);
    expect(stats.isEmpty).toBe(false);
    expect(stats.days.map((day) => day.count)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(stats.days.map((day) => day.label)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
  });

  it("counts stock that is at or below the minimum quantity", () => {
    expect(isAtOrBelowMinimum({ quantity: 2, minQuantity: 5 })).toBe(true);
    expect(isAtOrBelowMinimum({ quantity: 0, minQuantity: 0 })).toBe(true);
    expect(isAtOrBelowMinimum({ quantity: 6, minQuantity: 5 })).toBe(false);
  });

  it("is empty when nothing was created this week", () => {
    const stats = thisWeekStats([{ createdAt: "2026-09-01", isPaid: true, totalPrice: 10 }], [{ createdAt: "2026-08-01" }], sunday);
    expect(stats.isEmpty).toBe(true);
    expect(stats.revenue).toBe(0);
    expect(stats.orders).toBe(0);
    expect(stats.newClients).toBe(0);
  });
});

describe("dashboard money stats", () => {
  const order = (createdAt: string, totalPrice: number, isPaid: boolean, status = "completed") => ({ createdAt, totalPrice, isPaid, status });

  it("sums today's paid orders and compares them with yesterday", () => {
    const stats = todayRevenueStats(
      [order("2026-09-27", 150, true), order("2026-09-27", 40, false), order("2026-09-26", 100, true), order("2026-09-20", 999, true)],
      sunday,
    );
    expect(stats).toEqual({ revenue: 150, paidOrders: 1, changeVsYesterday: 50 });
  });

  it("reports no trend when yesterday had no revenue", () => {
    const stats = todayRevenueStats([order("2026-09-27", 80, true), order("2026-09-26", 30, false)], sunday);
    expect(stats.revenue).toBe(80);
    expect(stats.changeVsYesterday).toBeNull();
  });

  it("counts unpaid orders as outstanding and ignores cancelled ones", () => {
    const stats = outstandingPaymentStats([order("2026-09-01", 120, false, "new"), order("2026-09-02", 30, false, "in-progress"), order("2026-09-03", 500, false, "cancelled"), order("2026-09-04", 70, true)]);
    expect(stats).toEqual({ amount: 150, orders: 2 });
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
