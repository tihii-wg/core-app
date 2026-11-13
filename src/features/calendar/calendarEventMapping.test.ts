import { describe, expect, it } from "vitest";
import {
  fullCalendarDateToGoogle,
  googleEventToFullCalendar,
  isAllDayGoogleRange,
  mapApiErrorCode,
  mapGoogleEventsToFc,
} from "./calendarEventMapping";
import type { GoogleCalendarEvent } from "../../services/apiGoogleCalendar";

function ev(partial: Partial<GoogleCalendarEvent> & Pick<GoogleCalendarEvent, "id" | "title" | "start" | "end">): GoogleCalendarEvent {
  return {
    description: null,
    location: null,
    allDay: false,
    colorId: null,
    htmlLink: null,
    recurringEventId: null,
    updated: null,
    etag: null,
    authorUserId: null,
    authorUserName: null,
    coreAppOrderId: null,
    coreAppField: null,
    calendarId: "primary",
    calendarColor: null,
    readOnly: false,
    busyOnly: false,
    ...partial,
  };
}

describe("isAllDayGoogleRange", () => {
  it("detects date-only all-day ranges", () => {
    expect(isAllDayGoogleRange("2026-11-13", "2026-11-14")).toBe(true);
    expect(isAllDayGoogleRange("2026-11-13T10:00:00Z", "2026-11-13T11:00:00Z")).toBe(false);
  });
});

describe("fullCalendarDateToGoogle", () => {
  it("maps timed events to ISO", () => {
    const start = new Date("2026-11-13T10:00:00.000Z");
    const end = new Date("2026-11-13T11:30:00.000Z");
    const mapped = fullCalendarDateToGoogle(start, end, false);
    expect(mapped.allDay).toBe(false);
    expect(mapped.start).toBe(start.toISOString());
    expect(mapped.end).toBe(end.toISOString());
  });

  it("maps all-day with exclusive end date", () => {
    const start = new Date(2026, 10, 13);
    const end = new Date(2026, 10, 14);
    const mapped = fullCalendarDateToGoogle(start, end, true);
    expect(mapped).toEqual({ start: "2026-11-13", end: "2026-11-14", allDay: true });
  });
});

describe("googleEventToFullCalendar", () => {
  it("preserves recurring instance metadata", () => {
    const fc = googleEventToFullCalendar(
      ev({
        id: "inst-1",
        title: "Standup",
        start: "2026-11-13T09:00:00+02:00",
        end: "2026-11-13T09:30:00+02:00",
        recurringEventId: "series-1",
        etag: '"abc"',
        authorUserName: "Vova",
      }),
    );
    expect(fc.extendedProps.recurringEventId).toBe("series-1");
    expect(fc.extendedProps.etag).toBe('"abc"');
    expect(fc.extendedProps.authorUserName).toBe("Vova");
  });

  it("maps all-day events", () => {
    const fc = googleEventToFullCalendar(
      ev({ id: "d1", title: "Holiday", start: "2026-11-13", end: "2026-11-14", allDay: true }),
    );
    expect(fc.allDay).toBe(true);
    expect(fc.start).toBe("2026-11-13");
  });
});

describe("mapGoogleEventsToFc", () => {
  it("maps a list", () => {
    expect(mapGoogleEventsToFc([ev({ id: "1", title: "A", start: "2026-11-13T10:00:00Z", end: "2026-11-13T11:00:00Z" })])).toHaveLength(1);
  });
});

describe("mapApiErrorCode", () => {
  it("maps reconnect_required and conflict", () => {
    expect(mapApiErrorCode("reconnect_required")).toBe("reconnect_required");
    expect(mapApiErrorCode("conflict")).toBe("conflict");
    expect(mapApiErrorCode("forbidden")).toBe("other");
  });
});
