import { describe, expect, it } from "vitest";
import {
  addCalendarDaysIso,
  addCalendarMonthsIso,
  buildOrderWarrantyIndicator,
  buildWarrantyExpiration,
  defaultsForKind,
  evaluateWarranty,
  formatWarrantyLimitsLabel,
  hasWarrantyCoverage,
  isWarrantyExpired,
  normalizeWarrantyDays,
  normalizeWarrantyKm,
  normalizeWarrantyMonths,
  remainingDurationUntil,
  selectPrimaryWarrantyItem,
  type WarrantySnapshot,
} from "./warranty";

function snapshot(partial: Partial<WarrantySnapshot> & Pick<WarrantySnapshot, "id" | "endsOn" | "expiresAtMileage" | "durationMonths" | "mileageLimit">): WarrantySnapshot {
  return {
    orderId: "order-1",
    itemKind: "service",
    itemName: "Oil change",
    orderServiceId: "svc-1",
    orderMaterialId: null,
    startsAt: "2026-11-04T12:00:00.000Z",
    startMileage: 80000,
    ...partial,
  };
}

describe("warranty helpers", () => {
  it("normalizes months and km (zero/negative → null)", () => {
    expect(normalizeWarrantyMonths(12)).toBe(12);
    expect(normalizeWarrantyMonths(0)).toBeNull();
    expect(normalizeWarrantyMonths(-1)).toBeNull();
    expect(normalizeWarrantyKm(10000)).toBe(10000);
    expect(normalizeWarrantyKm(0)).toBeNull();
  });

  it("detects coverage for duration-only, mileage-only, both, activated endsOn, and none", () => {
    expect(hasWarrantyCoverage({ durationMonths: 12, mileageLimit: null })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: null, mileageLimit: 10000 })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: 6, mileageLimit: 5000 })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: null, durationDays: 15, mileageLimit: null })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: null, mileageLimit: null, endsOn: "2027-01-01" })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: null, mileageLimit: null, expiresAtMileage: 90000 })).toBe(true);
    expect(hasWarrantyCoverage({ durationMonths: null, mileageLimit: null })).toBe(false);
  });

  it("preserves exact day-based expiration without converting to months", () => {
    expect(normalizeWarrantyDays(15)).toBe(15);
    expect(addCalendarDaysIso("2026-11-04T12:00:00.000Z", 15).slice(0, 10)).toBe("2026-11-19");
    const dayBased = buildWarrantyExpiration({
      startsAt: "2026-11-04T12:00:00.000Z",
      durationMonths: null,
      durationDays: 15,
      startMileage: null,
      mileageLimit: null,
    });
    expect(dayBased.endsOn).toBe("2026-11-19");
    expect(dayBased.expiresAtMileage).toBeNull();

    const monthBased = buildWarrantyExpiration({
      startsAt: "2026-11-04T12:00:00.000Z",
      durationMonths: 1,
      durationDays: 45,
      startMileage: null,
      mileageLimit: null,
    });
    expect(monthBased.endsOn).toBe("2026-12-04");
  });

  it("does not invent mileage expiration when start mileage is missing", () => {
    const result = buildWarrantyExpiration({
      startsAt: "2026-11-04T12:00:00.000Z",
      durationMonths: 12,
      startMileage: null,
      mileageLimit: 10000,
    });
    expect(result.endsOn).toBe("2027-11-04");
    expect(result.expiresAtMileage).toBeNull();
  });

  it("formats line warranty labels without inventing coverage", () => {
    const t = (key: string, options?: { count?: number; value?: string }) => {
      if (key.endsWith(".withCoverage")) return `Warranty: ${options?.value}`;
      if (key.includes(".months")) return `${options?.count} months`;
      if (key.includes(".days")) return `${options?.count} days`;
      if (key.includes(".km")) return `${options?.value} km`;
      return key;
    };
    expect(formatWarrantyLimitsLabel({ durationMonths: 3, mileageLimit: 10000 }, t, (n) => String(n))).toBe(
      "Warranty: 3 months / 10000 km",
    );
    expect(formatWarrantyLimitsLabel({ durationMonths: null, durationDays: 15, mileageLimit: null }, t, (n) => String(n))).toBe(
      "Warranty: 15 days",
    );
    expect(formatWarrantyLimitsLabel({ durationMonths: null, mileageLimit: null }, t, (n) => String(n))).toBeNull();
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

  it("expires on the exact expiration date and exact mileage threshold", () => {
    const base = {
      startsAt: "2026-11-04T12:00:00.000Z",
      endsOn: "2027-11-04",
      startMileage: 80000,
      expiresAtMileage: 90000,
      durationMonths: 12,
      mileageLimit: 10000,
    };
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-11-04T00:00:00.000Z", currentMileage: 85000 }).status).toBe("expired_date");
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-01-01T00:00:00.000Z", currentMileage: 90000 }).status).toBe("expired_mileage");
  });

  it("does not expire by mileage when current mileage is unknown", () => {
    const base = {
      startsAt: "2026-11-04T12:00:00.000Z",
      endsOn: "2027-11-04",
      startMileage: 80000,
      expiresAtMileage: 90000,
      durationMonths: 12,
      mileageLimit: 10000,
    };
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-01-01T00:00:00.000Z", currentMileage: null }).status).toBe("active");
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-01-01T00:00:00.000Z", currentMileage: undefined }).status).toBe("active");
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
    // Mileage first (8 months in, over threshold)
    expect(evaluateWarranty({ snapshot: base, nowIso: "2027-06-01T00:00:00.000Z", currentMileage: 91000 }).status).toBe("expired_mileage");
    // Date first (past endsOn, under mileage)
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

describe("order warranty indicator model", () => {
  const now = "2026-11-04T12:00:00.000Z";

  it("hides indicator for non-warranty orders without coverage", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [snapshot({ id: "r1", endsOn: null, expiresAtMileage: null, durationMonths: null, mileageLimit: null })],
      isWarrantyOrder: false,
      nowIso: now,
    });
    expect(model.visible).toBe(false);
  });

  it("shows active time-only warranty with remaining months", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2027-07-04",
          expiresAtMileage: null,
          durationMonths: 8,
          mileageLimit: null,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
      currentMileage: 81000,
    });
    expect(model.visible).toBe(true);
    expect(model.status).toBe("active");
    expect(model.remaining?.months).toBe(8);
    expect(model.evaluation?.remainingMileage).toBeNull();
  });

  it("shows active mileage-only warranty with remaining km", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: null,
          expiresAtMileage: 90000,
          durationMonths: null,
          mileageLimit: 10000,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
      currentMileage: 82500,
    });
    expect(model.visible).toBe(true);
    expect(model.status).toBe("active");
    expect(model.remaining).toBeNull();
    expect(model.evaluation?.remainingMileage).toBe(7500);
  });

  it("shows both time and mileage remaining when both limits apply", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2027-07-04",
          expiresAtMileage: 90000,
          durationMonths: 8,
          mileageLimit: 10000,
        }),
      ],
      isWarrantyOrder: true,
      nowIso: now,
      currentMileage: 82500,
    });
    expect(model.visible).toBe(true);
    expect(model.status).toBe("active");
    expect(model.remaining?.months).toBe(8);
    expect(model.evaluation?.remainingMileage).toBe(7500);
  });

  it("marks expired by date without negative remaining days", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2026-10-01",
          expiresAtMileage: 90000,
          durationMonths: 12,
          mileageLimit: 10000,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
      currentMileage: 81000,
    });
    expect(model.status).toBe("expired_date");
    expect(model.remaining).toBeNull();
    expect(remainingDurationUntil("2026-10-01", now)).toBeNull();
  });

  it("marks expired by mileage without negative remaining km", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2027-11-04",
          expiresAtMileage: 90000,
          durationMonths: 12,
          mileageLimit: 10000,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
      currentMileage: 95000,
    });
    expect(model.status).toBe("expired_mileage");
    expect(model.evaluation?.remainingMileage).toBe(0);
  });

  it("picks the earliest upcoming expiration among multiple covered items", () => {
    const early = snapshot({
      id: "early",
      itemName: "Pad",
      endsOn: "2027-01-04",
      expiresAtMileage: null,
      durationMonths: 2,
      mileageLimit: null,
    });
    const late = snapshot({
      id: "late",
      itemName: "Oil",
      endsOn: "2027-11-04",
      expiresAtMileage: null,
      durationMonths: 12,
      mileageLimit: null,
    });
    const primary = selectPrimaryWarrantyItem(
      [
        { snapshot: late, evaluation: evaluateWarranty({ snapshot: late, nowIso: now }) },
        { snapshot: early, evaluation: evaluateWarranty({ snapshot: early, nowIso: now }) },
      ],
      now,
    );
    expect(primary?.snapshot.id).toBe("early");

    const model = buildOrderWarrantyIndicator({
      snapshots: [late, early],
      isWarrantyOrder: true,
      nowIso: now,
    });
    expect(model.primary?.id).toBe("early");
    expect(model.coveredItemCount).toBe(2);
    expect(model.remaining?.months).toBe(2);
  });

  it("flags near-expiry without changing status", () => {
    const model = buildOrderWarrantyIndicator({
      snapshots: [
        snapshot({
          id: "r1",
          endsOn: "2026-11-20",
          expiresAtMileage: null,
          durationMonths: 1,
          mileageLimit: null,
        }),
      ],
      isWarrantyOrder: false,
      nowIso: now,
    });
    expect(model.status).toBe("active");
    expect(model.nearExpiry).toBe(true);
  });
});
