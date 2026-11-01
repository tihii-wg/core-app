import { beforeEach, describe, expect, it } from "vitest";
import { stubLocalStorage } from "../../tests/memoryStorage";
import {
  ORDER_CALENDAR_SCALE_STORAGE_KEY,
  bucketOrdersByDate,
  calendarRange,
  calendarWeeks,
  countOrdersInRange,
  dateFromKey,
  isInAnchorMonth,
  orderCalendarPlacement,
  readOrderCalendarScale,
  shiftCalendarAnchor,
  writeOrderCalendarScale,
} from "./orderCalendar";
import { ORDER_VIEW_MODE_STORAGE_KEY, readOrderViewMode, writeOrderViewMode } from "./orderBoard";

const o = (orderNumber: string, deadline = "", createdAt = "") => ({ orderNumber, deadline, createdAt });

beforeEach(() => {
  stubLocalStorage();
});

describe("orderCalendarPlacement", () => {
  it("prefers the deadline and falls back to created_at", () => {
    expect(orderCalendarPlacement(o("1", "2026-11-05", "2026-10-01"))).toEqual({ dateKey: "2026-11-05", basis: "deadline" });
    expect(orderCalendarPlacement(o("1", "", "2026-10-01"))).toEqual({ dateKey: "2026-10-01", basis: "createdAt" });
    expect(orderCalendarPlacement(o("1", "", "2026-10-01T22:30:00Z"))).toEqual({ dateKey: "2026-10-01", basis: "createdAt" });
  });

  it("returns null when neither date is usable", () => {
    expect(orderCalendarPlacement(o("1"))).toBeNull();
    expect(orderCalendarPlacement(o("1", "soon", "n/a"))).toBeNull();
  });
});

describe("bucketOrdersByDate", () => {
  it("groups by day, sorts numbers naturally and keeps undated orders aside", () => {
    const { byDate, undated } = bucketOrdersByDate([
      o("ORD-10", "2026-11-05"),
      o("ORD-2", "2026-11-05"),
      o("ORD-3", "", "2026-11-06"),
      o("ORD-4"),
    ]);
    expect(byDate.get("2026-11-05")?.map((order) => order.orderNumber)).toEqual(["ORD-2", "ORD-10"]);
    expect(byDate.get("2026-11-06")?.map((order) => order.orderNumber)).toEqual(["ORD-3"]);
    expect(undated.map((order) => order.orderNumber)).toEqual(["ORD-4"]);
  });
});

describe("calendarWeeks / calendarRange", () => {
  it("builds Monday-first month rows covering the whole month (Nov 2026 starts on Sunday)", () => {
    const weeks = calendarWeeks(new Date(2026, 10, 15), "month");
    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(weeks[5][6]).toBe("2026-12-06");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("uses only four rows for a Monday-aligned February", () => {
    // Feb 2027 starts on Monday and has 28 days.
    const weeks = calendarWeeks(new Date(2027, 1, 10), "month");
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe("2027-02-01");
    expect(weeks[3][6]).toBe("2027-02-28");
  });

  it("returns a single week for the week scale", () => {
    const weeks = calendarWeeks(new Date(2026, 10, 4), "week"); // Wednesday
    expect(weeks).toHaveLength(1);
    expect(weeks[0][0]).toBe("2026-11-02");
    expect(weeks[0][6]).toBe("2026-11-08");
  });

  it("exposes the inclusive range and counts only orders inside it", () => {
    const range = calendarRange(new Date(2026, 10, 15), "week");
    expect(range).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    const buckets = bucketOrdersByDate([o("a", "2026-11-09"), o("b", "2026-11-15"), o("c", "2026-11-16"), o("d", "2026-11-08")]);
    expect(countOrdersInRange(buckets, range)).toBe(2);
  });
});

describe("shiftCalendarAnchor", () => {
  it("moves months without day overflow", () => {
    const next = shiftCalendarAnchor(new Date(2026, 0, 31), "month", 1);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(1);
    const prev = shiftCalendarAnchor(new Date(2026, 0, 31), "month", -1);
    expect(prev.getFullYear()).toBe(2025);
    expect(prev.getMonth()).toBe(11);
  });

  it("moves weeks by seven days across a month boundary", () => {
    const next = shiftCalendarAnchor(new Date(2026, 9, 30), "week", 1);
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 10, 6]);
  });
});

describe("date helpers", () => {
  it("parses keys and detects anchor-month membership", () => {
    expect(dateFromKey("2026-11-05")?.getDate()).toBe(5);
    expect(dateFromKey("nope")).toBeNull();
    expect(isInAnchorMonth("2026-11-30", new Date(2026, 10, 1))).toBe(true);
    expect(isInAnchorMonth("2026-12-01", new Date(2026, 10, 1))).toBe(false);
  });
});

describe("persistence", () => {
  it("round-trips the calendar scale and defaults to month", () => {
    expect(readOrderCalendarScale()).toBe("month");
    writeOrderCalendarScale("week");
    expect(window.localStorage.getItem(ORDER_CALENDAR_SCALE_STORAGE_KEY)).toBe("week");
    expect(readOrderCalendarScale()).toBe("week");
  });

  it("round-trips the calendar view mode alongside table/board", () => {
    expect(readOrderViewMode()).toBe("table");
    writeOrderViewMode("calendar");
    expect(window.localStorage.getItem(ORDER_VIEW_MODE_STORAGE_KEY)).toBe("calendar");
    expect(readOrderViewMode()).toBe("calendar");
    writeOrderViewMode("board");
    expect(readOrderViewMode()).toBe("board");
  });
});
