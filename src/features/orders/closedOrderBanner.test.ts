import { describe, expect, it } from "vitest";
import { isOrderCurrentlyClosed, isOrderFormallyClosed } from "./orderLifecycle";

/**
 * Detail-card closure banner rules (OrderDetailPanel):
 * show only when the order is currently closed — never for cancelled/reopened
 * rows that still carry a historical closed_at.
 */
describe("closed-order detail banner lifecycle", () => {
  const closedAt = "2026-11-05T14:59:54.258807+00:00";
  const laterClosedAt = "2026-11-06T10:00:00.000Z";

  it("shows closure message for a currently closed order", () => {
    expect(isOrderCurrentlyClosed({ status: "closed", closedAt })).toBe(true);
  });

  it("hides closure message after cancel even when closed_at is preserved", () => {
    expect(isOrderCurrentlyClosed({ status: "cancelled", closedAt })).toBe(false);
    expect(isOrderFormallyClosed({ status: "cancelled", closedAt })).toBe(true);
  });

  it("hides closure message after reopen/status change while preserving closed_at history", () => {
    expect(isOrderCurrentlyClosed({ status: "in-progress", closedAt })).toBe(false);
    expect(isOrderFormallyClosed({ status: "in-progress", closedAt })).toBe(true);
  });

  it("shows the latest closure after the order is closed again", () => {
    expect(isOrderCurrentlyClosed({ status: "closed", closedAt: laterClosedAt })).toBe(true);
    expect(laterClosedAt).not.toBe(closedAt);
  });

  it("does not treat status=closed without closed_at as a displayable current closure", () => {
    expect(isOrderCurrentlyClosed({ status: "closed", closedAt: null })).toBe(false);
    expect(isOrderFormallyClosed({ status: "closed", closedAt: null })).toBe(true);
  });
});
