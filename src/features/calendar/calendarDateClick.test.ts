import { describe, expect, it } from "vitest";
import { draftFromDateClick } from "./calendarDateClick";

describe("draftFromDateClick", () => {
  it("creates a 1-hour timed slot", () => {
    const draft = draftFromDateClick({
      date: new Date("2026-11-13T10:00:00.000Z"),
      allDay: false,
      viewType: "timeGridDay",
    });
    expect(draft.allDay).toBe(false);
    expect(draft.start).toBe(new Date("2026-11-13T10:00:00.000Z").toISOString());
    expect(draft.end).toBe(new Date("2026-11-13T11:00:00.000Z").toISOString());
  });

  it("creates an all-day draft for month day clicks", () => {
    const draft = draftFromDateClick({
      date: new Date(2026, 10, 13, 15, 30),
      allDay: false,
      viewType: "dayGridMonth",
    });
    expect(draft).toEqual({ start: "2026-11-13", end: "2026-11-14", allDay: true });
  });

  it("keeps allDay flag from timeGrid all-day lane", () => {
    const draft = draftFromDateClick({
      date: new Date(2026, 10, 13),
      allDay: true,
      viewType: "timeGridWeek",
    });
    expect(draft.allDay).toBe(true);
    expect(draft.start).toBe("2026-11-13");
  });
});
