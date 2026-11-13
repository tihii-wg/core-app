import { describe, expect, it } from "vitest";
import { initialVisibleRange, rangeIso } from "./calendarVisibleRange";

describe("initialVisibleRange", () => {
  const now = new Date("2026-11-13T12:00:00.000Z");

  it("uses a single day for timeGridDay", () => {
    const range = initialVisibleRange("timeGridDay", now);
    const from = new Date(range.from);
    const to = new Date(range.to);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("uses three days for timeGrid3Day", () => {
    const range = initialVisibleRange("timeGrid3Day", now);
    const from = new Date(range.from);
    const to = new Date(range.to);
    expect(to.getTime() - from.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("uses a week for timeGridWeek (not a full month)", () => {
    const range = initialVisibleRange("timeGridWeek", now);
    const from = new Date(range.from);
    const to = new Date(range.to);
    const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(7);
  });

  it("uses calendar month for dayGridMonth", () => {
    const range = initialVisibleRange("dayGridMonth", now);
    const from = new Date(range.from);
    expect(from.getUTCDate() === 1 || from.getDate() === 1).toBe(true);
    const spanDays = (new Date(range.to).getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThanOrEqual(28);
    expect(spanDays).toBeLessThanOrEqual(31);
  });
});

describe("rangeIso", () => {
  it("serializes dates to ISO", () => {
    const start = new Date("2026-11-13T00:00:00.000Z");
    const end = new Date("2026-11-14T00:00:00.000Z");
    expect(rangeIso(start, end)).toEqual({
      from: "2026-11-13T00:00:00.000Z",
      to: "2026-11-14T00:00:00.000Z",
    });
  });
});
