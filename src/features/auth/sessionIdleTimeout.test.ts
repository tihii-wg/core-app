import { describe, expect, it } from "vitest";
import {
  effectiveSessionIdleTimeoutMinutes,
  isSessionIdleExpired,
  normalizeSessionIdleTimeoutMinutes,
  sessionIdleCountdownSeconds,
  sessionIdleRemainingMs,
  sessionIdleWarningLeadMs,
  shouldShowSessionIdleWarning,
} from "./sessionIdleTimeout";

describe("normalizeSessionIdleTimeoutMinutes", () => {
  it("accepts allowed values and maps unknown to null", () => {
    expect(normalizeSessionIdleTimeoutMinutes(720)).toBe(720);
    expect(normalizeSessionIdleTimeoutMinutes("60")).toBe(60);
    expect(normalizeSessionIdleTimeoutMinutes(null)).toBeNull();
    expect(normalizeSessionIdleTimeoutMinutes(15)).toBeNull();
    expect(normalizeSessionIdleTimeoutMinutes(1)).toBeNull();
    expect(normalizeSessionIdleTimeoutMinutes(1, { allowDevMinute: true })).toBe(1);
  });
});

describe("effectiveSessionIdleTimeoutMinutes", () => {
  it("returns null when all off", () => {
    expect(effectiveSessionIdleTimeoutMinutes([null, undefined, null])).toBeNull();
  });

  it("picks the smallest non-null timeout (strictest workspace wins)", () => {
    expect(effectiveSessionIdleTimeoutMinutes([null, 720, 120, 480])).toBe(120);
    expect(effectiveSessionIdleTimeoutMinutes([1440, 30])).toBe(30);
  });
});

describe("expiry and warning", () => {
  const last = 1_000_000;
  const timeout = 30; // minutes

  it("is not expired before timeout", () => {
    expect(isSessionIdleExpired(last, last + 29 * 60_000, timeout)).toBe(false);
  });

  it("is expired at or after timeout", () => {
    expect(isSessionIdleExpired(last, last + 30 * 60_000, timeout)).toBe(true);
    expect(isSessionIdleExpired(last, last + 30 * 60_000 + 1, timeout)).toBe(true);
  });

  it("shows warning in the last 60s", () => {
    const almost = last + 30 * 60_000 - 30_000;
    expect(shouldShowSessionIdleWarning(last, almost, timeout)).toBe(true);
    expect(shouldShowSessionIdleWarning(last, last + 10_000, timeout)).toBe(false);
  });

  it("uses full timeout as warning lead when timeout <= 60s", () => {
    expect(sessionIdleWarningLeadMs(1)).toBe(60_000);
    expect(shouldShowSessionIdleWarning(last, last + 1_000, 1)).toBe(true);
  });

  it("never returns negative remaining or countdown", () => {
    expect(sessionIdleRemainingMs(last, last + 40 * 60_000, timeout)).toBe(0);
    expect(sessionIdleCountdownSeconds(-5_000)).toBe(0);
    expect(sessionIdleCountdownSeconds(1500)).toBe(2);
  });
});
