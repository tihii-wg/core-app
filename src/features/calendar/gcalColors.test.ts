import { describe, expect, it } from "vitest";
import {
  composeFullCalendarEventId,
  contrastingTextColor,
  googleEventColorIdToHex,
  isBusyOnlyAccessRole,
  isWritableAccessRole,
  resolveEventCalendarColor,
  splitFullCalendarEventId,
} from "./gcalColors";

describe("googleEventColorIdToHex", () => {
  it("maps standard Google colorIds", () => {
    expect(googleEventColorIdToHex("11")).toBe("#dc2127");
    expect(googleEventColorIdToHex("9")).toBe("#5484ed");
    expect(googleEventColorIdToHex("99")).toBeNull();
    expect(googleEventColorIdToHex(null)).toBeNull();
  });
});

describe("resolveEventCalendarColor", () => {
  it("prefers event colorId over calendar background", () => {
    expect(resolveEventCalendarColor("#abcdef", "4")).toBe("#ff887c");
    expect(resolveEventCalendarColor("#abcdef", null)).toBe("#abcdef");
  });
});

describe("compose / split FullCalendar event id", () => {
  it("composes and splits calendarId:eventId", () => {
    const id = composeFullCalendarEventId("cal@example.com", "evt-1");
    expect(id).toBe("cal@example.com:evt-1");
    expect(splitFullCalendarEventId(id)).toEqual({
      calendarId: "cal@example.com",
      eventId: "evt-1",
    });
  });
});

describe("access roles", () => {
  it("detects writable and busy-only roles", () => {
    expect(isWritableAccessRole("owner")).toBe(true);
    expect(isWritableAccessRole("writer")).toBe(true);
    expect(isWritableAccessRole("reader")).toBe(false);
    expect(isBusyOnlyAccessRole("freeBusyReader")).toBe(true);
    expect(isBusyOnlyAccessRole("reader")).toBe(false);
  });
});

describe("contrastingTextColor", () => {
  it("picks dark text on light backgrounds", () => {
    expect(contrastingTextColor("#fbd75b")).toBe("#1a1a1a");
    expect(contrastingTextColor("#dc2127")).toBe("#ffffff");
  });
});
