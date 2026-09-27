import { describe, expect, it } from "vitest";
import { calendarDateKey, startOfWeek, taskOverviewCounts, thisWeekStats, weekDateKeys } from "./dashboardStats";

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

  it("is empty when nothing was created this week", () => {
    const stats = thisWeekStats([{ createdAt: "2026-09-01", isPaid: true, totalPrice: 10 }], [{ createdAt: "2026-08-01" }], sunday);
    expect(stats.isEmpty).toBe(true);
    expect(stats.revenue).toBe(0);
    expect(stats.orders).toBe(0);
    expect(stats.newClients).toBe(0);
  });
});
