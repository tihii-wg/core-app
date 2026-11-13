import { describe, expect, it } from "vitest";
import {
  buildOwnerCalendarItems,
  nextVisibleIdsAfterToggle,
  selectedExtraIds,
} from "./CalendarMyCalendars";
import { googleEventToFullCalendar } from "../../services/apiGoogleCalendar";
import type { GoogleCalendarEvent, GoogleCalendarListItem } from "../../services/apiGoogleCalendar";

function cal(partial: Partial<GoogleCalendarListItem> & Pick<GoogleCalendarListItem, "id" | "summary">): GoogleCalendarListItem {
  return {
    primary: false,
    accessRole: "reader",
    timeZone: null,
    backgroundColor: "#abc",
    foregroundColor: "#000",
    selected: false,
    ...partial,
  };
}

function ev(partial: Partial<GoogleCalendarEvent> & Pick<GoogleCalendarEvent, "id" | "title" | "start" | "end">): GoogleCalendarEvent {
  return {
    description: null,
    location: null,
    allDay: false,
    colorId: null,
    htmlLink: null,
    recurringEventId: null,
    updated: null,
    etag: '"1"',
    authorUserId: null,
    authorUserName: null,
    coreAppOrderId: null,
    coreAppField: null,
    calendarId: "main",
    calendarColor: "#5484ed",
    readOnly: false,
    busyOnly: false,
    ...partial,
  };
}

describe("visible calendar toggle ids", () => {
  it("sends extra calendar ids without the main calendar", () => {
    const items = buildOwnerCalendarItems(
      [
        cal({ id: "main", summary: "Main", accessRole: "owner", selected: true }),
        cal({ id: "work", summary: "Work", accessRole: "writer", selected: true }),
        cal({ id: "personal", summary: "Personal", accessRole: "reader", selected: false }),
      ],
      "main",
    );
    expect(selectedExtraIds(items)).toEqual(["work"]);
    expect(nextVisibleIdsAfterToggle(["work"], "personal", true, "main").sort()).toEqual(
      ["personal", "work"].sort(),
    );
    expect(nextVisibleIdsAfterToggle(["work", "personal"], "work", false, "main")).toEqual(["personal"]);
  });
});

describe("read-only / busy events are not editable", () => {
  it("marks readOnly and busyOnly events as not editable", () => {
    const readOnly = googleEventToFullCalendar(
      ev({
        id: "r1",
        title: "Shared",
        start: "2026-11-13T10:00:00Z",
        end: "2026-11-13T11:00:00Z",
        readOnly: true,
        calendarId: "shared",
      }),
    );
    expect(readOnly.editable).toBe(false);
    expect(readOnly.id).toBe("shared:r1");

    const busy = googleEventToFullCalendar(
      ev({
        id: "b1",
        title: "",
        start: "2026-11-13T12:00:00Z",
        end: "2026-11-13T13:00:00Z",
        busyOnly: true,
        readOnly: true,
        calendarId: "fb",
      }),
      "Busy",
    );
    expect(busy.editable).toBe(false);
    expect(busy.title).toBe("Busy");
    expect(busy.extendedProps.busyOnly).toBe(true);
  });

  it("keeps writable events editable and applies calendarColor", () => {
    const fc = googleEventToFullCalendar(
      ev({
        id: "w1",
        title: "Meeting",
        start: "2026-11-13T10:00:00Z",
        end: "2026-11-13T11:00:00Z",
        calendarColor: "#51b749",
      }),
    );
    expect(fc.editable).toBe(true);
    expect(fc.backgroundColor).toBe("#51b749");
    expect(fc.extendedProps.googleEventId).toBe("w1");
  });
});
