import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCalendarOAuthRedirect } from "./calendarOAuthRedirect.ts";

Deno.test("calendar oauth redirect success", () => {
  assertEquals(
    buildCalendarOAuthRedirect({
      appUrl: "https://app.example.com",
      gcal: "connected",
      workspaceId: "ws_abcdefgh",
      locale: "ru",
    }),
    "https://app.example.com/ru/ws_abcdefgh/calendar?gcal=connected",
  );
});

Deno.test("calendar oauth redirect error uses gcal_error", () => {
  assertEquals(
    buildCalendarOAuthRedirect({
      appUrl: "https://app.example.com/",
      gcal: "error",
      reason: "token",
      workspaceId: "ws_abcdefgh",
      locale: "en",
    }),
    "https://app.example.com/en/ws_abcdefgh/calendar?gcal_error=token",
  );
});
