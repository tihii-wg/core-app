import { describe, expect, it } from "vitest";

/** Mirrors supabase/functions/_shared/googleCalendar.ts mapGoogleCalendarHttpError for client/unit coverage. */
function mapGoogleCalendarHttpError(status: number, bodyText: string) {
  const lower = bodyText.toLowerCase();
  if (status === 401 || (status === 400 && /invalid_grant/i.test(lower))) {
    return { code: "reconnect_required", message: "Google authorization expired", status: 409 };
  }
  if (status === 412 || /precondition|etag/i.test(lower)) {
    return { code: "conflict", message: "Event was changed in Google Calendar", status: 409 };
  }
  if (status === 403) {
    return { code: "forbidden", message: "Google Calendar access denied", status: 403 };
  }
  if (status === 404) {
    return { code: "not_found", message: "Calendar or event not found", status: 404 };
  }
  if (status === 429) {
    return { code: "rate_limited", message: "Google Calendar rate limit", status: 429, retryable: true };
  }
  if (status >= 500) {
    return { code: "provider_error", message: "Google Calendar unavailable", status: 502, retryable: true };
  }
  return { code: "provider_error", message: bodyText.slice(0, 200) || `google_calendar_http_${status}`, status: 502 };
}

describe("mapGoogleCalendarHttpError", () => {
  it("maps invalid_grant to reconnect_required", () => {
    expect(mapGoogleCalendarHttpError(401, "invalid_grant").code).toBe("reconnect_required");
  });

  it("does not treat a 403 mentioning unauthorized as an expired grant", () => {
    expect(mapGoogleCalendarHttpError(403, "unauthorized_client").code).toBe("forbidden");
  });

  it("maps 412 etag to conflict", () => {
    expect(mapGoogleCalendarHttpError(412, "Precondition Failed").code).toBe("conflict");
  });

  it("maps 403/404/429", () => {
    expect(mapGoogleCalendarHttpError(403, "").code).toBe("forbidden");
    expect(mapGoogleCalendarHttpError(404, "").code).toBe("not_found");
    expect(mapGoogleCalendarHttpError(429, "").code).toBe("rate_limited");
  });
});
