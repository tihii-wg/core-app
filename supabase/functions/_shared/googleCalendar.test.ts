import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildGoogleEventBody, mapGoogleCalendarEvent, mapGoogleCalendarHttpError } from "./googleCalendar.ts";

Deno.test("mapGoogleCalendarEvent timed + all-day + recurring", () => {
  const timed = mapGoogleCalendarEvent({
    id: "1",
    summary: "Call",
    start: { dateTime: "2026-11-13T10:00:00+02:00" },
    end: { dateTime: "2026-11-13T11:00:00+02:00" },
    recurringEventId: "series",
    etag: '"e1"',
    extendedProperties: { private: { core_app_user_name: "Vova" } },
  });
  assertEquals(timed?.allDay, false);
  assertEquals(timed?.recurringEventId, "series");
  assertEquals(timed?.authorUserName, "Vova");

  const allDay = mapGoogleCalendarEvent({
    id: "2",
    summary: "Off",
    start: { date: "2026-11-13" },
    end: { date: "2026-11-14" },
  });
  assertEquals(allDay?.allDay, true);
  assertEquals(allDay?.start, "2026-11-13");
});

Deno.test("buildGoogleEventBody all-day vs timed", () => {
  const day = buildGoogleEventBody({
    title: "Off",
    start: "2026-11-13",
    end: "2026-11-14",
    allDay: true,
  });
  assertEquals(day.start, { date: "2026-11-13" });

  const timed = buildGoogleEventBody({
    title: "Meet",
    start: "2026-11-13T10:00:00.000Z",
    end: "2026-11-13T11:00:00.000Z",
    allDay: false,
    timeZone: "Europe/Chisinau",
    authorUserId: "u1",
    authorUserName: "Vova",
  });
  assertEquals((timed.start as { timeZone?: string }).timeZone, "Europe/Chisinau");
  assertEquals(
    (timed.extendedProperties as { private: Record<string, string> }).private.core_app_user_id,
    "u1",
  );
});

Deno.test("mapGoogleCalendarHttpError codes", () => {
  assertEquals(mapGoogleCalendarHttpError(401, "invalid_grant").code, "reconnect_required");
  assertEquals(mapGoogleCalendarHttpError(412, "etag").code, "conflict");
  assertEquals(mapGoogleCalendarHttpError(429, "").code, "rate_limited");
});
