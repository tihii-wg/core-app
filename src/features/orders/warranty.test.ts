import { describe, expect, it } from "vitest";
import {
  addCalendarMonthsIso,
  buildWarrantyExpiration,
  defaultsForKind,
  evaluateWarranty,
  hasWarrantyCoverage,
  isWarrantyExpired,
  normalizeWarrantyKm,
  normalizeWarrantyMonths,
} from "./warranty";

describe("warranty helpers", () => {
  it("normalizes months and km (zero/negative → null)", () => {
    expect(normalizeWarrantyMonths(12)).toBe(12);
    expect(normalizeWarrantyMonths(0)).toBeNull();
    expect(normalizeWarrantyMonths(-1)).toBeNull();
    expect(normalizeWarrantyKm(10000)).toBe(10000);
    expect(normalizeWarrantyKm(0)).toBeNull();
  });

  it("detects coverage for duration-only, mileage-only, both, and none", () => {
    expect(hasWarrantyCoverage({ durationMonths: 12, mileageLimit: null })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: null, mileageLimit: 10000 })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: 6, mileageLimit: 5000 })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: null, mileageLimit: null })).toBe(false);
  });

  it("adds calendar months without overflowing the day-of-month", () => {
    expect(addCalendarMonthsIso("2026-01-31T10:00:00.000Z", 1).slice(0, 10)).toBe("2026-02-28");
    expect(addCalendarMonthsIso("2026-11-04T12:00:00.000Z", 12).slice(0, 10)).toBe("2027-11-04");
  });

  it("builds expiration date and mileage from start snapshot", () => {
    const result = buildWarrantyExpiration({
      startsAt: "2026-11-04T12:00:00.000Z",
      durationMonths: 12,
      startMileage: 80000,
      mileageLimit: 10000,
    });
    expect(result.endsOn).toBe("2027-11-04");
    expect(result.expiresAtMileage).toBe(90000);
  });

  it("evaluates duration-only and mileage-only expiration", () => {
    const base = {
      startsAt: "2026-11-04T12:00:00.000Z",
      endsOn: "2027-11-04",
      startMileage: 80000,
      expiresAtMileage: 90000,
      durationMonths: 12,
      mileageLimit: 10000,
    };
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-01-01T00:00:00.000Z", currentMileage: 85000 }).status).toBe("active");
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-11-05T00:00:00.000Z", currentMileage: 85000 }).status).toBe("expired_date");
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-01-01T00:00:00.000Z", currentMileage: 90000 }).status).toBe("expired_mileage");
  });

  it("expires by the first reached limit when both apply", () => {
    const base = {
      startsAt: "2026-11-04T12:00:00.000Z",
      endsOn: "2027-11-04",
      startMileage: 80000,
      expiresAtMileage: 90000,
      durationMonths: 12,
      mileageLimit: 10000,
    };
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-06-01T00:00:00.000Z", currentMileage: 91000 }).status).toBe("expired_mileage");
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-12-01T00:00:00.000Z", currentMileage: 82000 }).status).toBe("expired_date");
  });

  it("reports remaining mileage while active", () => {
    const result = evaluateWarranty({
      snapshot: {
        startsAt: "2026-11-04T12:00:00.000Z",
        endsOn: "2027-11-04",
        startMileage: 80000,
        expiresAtMileage: 90000,
        durationMonths: 12,
        mileageLimit: 10000,
      },
      nowIso: "2027-01-01T00:00:00.000Z",
      currentMileage: 82000,
    });
    expect(result.status).toBe("active");
    expect(result.remainingMileage).toBe(8000);
    expect(isWarrantyExpired(result.status)).toBe(false);
  });

  it("does not treat create-time as start — pending before startsAt", () => {
    const result = evaluateWarranty({
      snapshot: {
        startsAt: "2026-12-01T00:00:00.000Z",
        endsOn: "2027-12-01",
        startMileage: 0,
        expiresAtMileage: 10000,
        durationMonths: 12,
        mileageLimit: 10000,
      },
      nowIso: "2026-11-04T00:00:00.000Z",
      currentMileage: 100,
    });
    expect(result.status).toBe("pending");
  });

  it("applies workspace defaults by item kind", () => {
    const defaults = {
      serviceDurationMonths: 6,
      serviceMileageLimit: 5000,
      partsDurationMonths: 12,
      partsMileageLimit: 10000,
    };
    expect(defaultsForKind(defaults, "service")).toEqual({ durationMonths: 6, mileageLimit: 5000 });
    expect(defaultsForKind(defaults, "material")).toEqual({ durationMonths: 12, mileageLimit: 10000 });
  });
});
