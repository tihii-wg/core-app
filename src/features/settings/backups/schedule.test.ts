import { describe, expect, it } from "vitest";
import { localHourToUtcHour, utcHourToLocalHour } from "./schedule";

describe("backup schedule hour conversion", () => {
  it("round-trips a local hour in Europe/Chisinau", () => {
    // Fixed winter date (no DST): UTC+2
    const at = new Date("2026-01-15T12:00:00.000Z");
    const utc = localHourToUtcHour(3, "Europe/Chisinau", at);
    expect(utc).toBe(1);
    expect(utcHourToLocalHour(utc, "Europe/Chisinau", at)).toBe(3);
  });

  it("converts local midnight in America/New_York to the matching UTC hour", () => {
    const at = new Date("2026-01-15T12:00:00.000Z");
    const utc = localHourToUtcHour(0, "America/New_York", at);
    expect(utcHourToLocalHour(utc, "America/New_York", at)).toBe(0);
  });

  it("falls back safely for an invalid time zone", () => {
    const at = new Date("2026-06-01T00:00:00.000Z");
    const utc = localHourToUtcHour(5, "Not/AZone", at);
    expect(utc).toBeGreaterThanOrEqual(0);
    expect(utc).toBeLessThan(24);
  });
});
