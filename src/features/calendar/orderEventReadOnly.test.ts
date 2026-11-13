import { describe, expect, it } from "vitest";
import { googleEventToFullCalendar } from "../../services/apiGoogleCalendar";
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
    etag: '"1"',
    authorUserId: null,
    authorUserName: null,
    coreAppOrderId: null,
    coreAppField: null,
    ...partial,
  };
}

describe("synced order events are read-only in FullCalendar mapping", () => {
  it("marks core_app_order_id events as order_sync and not editable", () => {
    const fc = googleEventToFullCalendar(
      ev({
        id: "g1",
        title: "ORD-1 · Client",
        start: "2026-11-20",
        end: "2026-11-21",
        allDay: true,
        coreAppOrderId: "ord-1",
        coreAppField: "deadline",
      }),
    );
    expect(fc.editable).toBe(false);
    expect(fc.startEditable).toBe(false);
    expect(fc.durationEditable).toBe(false);
    expect(fc.extendedProps.kind).toBe("order_sync");
    expect(fc.extendedProps.orderId).toBe("ord-1");
  });

  it("keeps manual events editable", () => {
    const fc = googleEventToFullCalendar(
      ev({ id: "g2", title: "Meeting", start: "2026-11-20T10:00:00Z", end: "2026-11-20T11:00:00Z" }),
    );
    expect(fc.editable).toBe(true);
    expect(fc.extendedProps.kind).toBe("gcal");
  });
});
