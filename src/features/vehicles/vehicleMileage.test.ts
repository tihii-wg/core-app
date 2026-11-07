import { describe, expect, it } from "vitest";
import {
  compareMileageReadings,
  convertMileage,
  formatVehicleMileage,
  isMileageUnit,
  mileageToCanonicalKm,
  parseMileageUnit,
  resolveFormOrderMileageUnit,
  resolveOrderMileageUnit,
} from "./vehicleMileage";

const t = ((key: string) => {
  if (key === "vehicles.mileage.abbr.km") return "km";
  if (key === "vehicles.mileage.abbr.mi") return "mi";
  return key;
}) as never;

describe("vehicleMileage", () => {
  it("parses only km/mi and leaves unknowns null", () => {
    expect(parseMileageUnit("km")).toBe("km");
    expect(parseMileageUnit("MI")).toBe("mi");
    expect(parseMileageUnit("")).toBeNull();
    expect(parseMileageUnit("miles")).toBeNull();
    expect(isMileageUnit("km")).toBe(true);
    expect(isMileageUnit("yd")).toBe(false);
  });

  it("formats readings with unit without converting", () => {
    expect(formatVehicleMileage(85000, "mi", t, { locale: "en-US" })).toBe("85,000 mi");
    expect(formatVehicleMileage(85000, "km", t, { locale: "en-US" })).toBe("85,000 km");
    expect(formatVehicleMileage(85000, null, t, { locale: "en-US" })).toBe(
      "85,000 (vehicles.mileage.unitUnknownShort)",
    );
    expect(formatVehicleMileage(null, "km", t)).toBe("common.noValue");
  });

  it("compares mixed units via canonical km only", () => {
    expect(mileageToCanonicalKm(1, "mi")).toBeCloseTo(1.609344);
    expect(compareMileageReadings({ value: 100, unit: "mi" }, { value: 160, unit: "km" })).toBeGreaterThan(0);
    expect(compareMileageReadings({ value: 100, unit: null }, { value: 100, unit: "km" })).toBeNull();
  });

  it("converts 50000 km ↔ 31069 mi with ±1 whole-unit round-trip tolerance", () => {
    expect(convertMileage(50000, "km", "mi")).toBe(31069);
    // 31069 * 1.609344 rounds to 50001 — documented ±1 tolerance for the reverse leg.
    expect(Math.abs((convertMileage(31069, "mi", "km") as number) - 50000)).toBeLessThanOrEqual(1);
    const mid = convertMileage(12345, "km", "mi");
    expect(mid).not.toBeNull();
    const back = convertMileage(mid, "mi", "km");
    expect(back).not.toBeNull();
    expect(Math.abs((back as number) - 12345)).toBeLessThanOrEqual(1);
    expect(convertMileage(0, "km", "mi")).toBe(0);
    expect(convertMileage(null, "km", "mi")).toBeNull();
    expect(convertMileage(50000, "km", "km")).toBe(50000);
  });

  it("resolves order unit snapshot-first and form unit vehicle-first", () => {
    expect(resolveOrderMileageUnit({ snapshotUnit: "mi", vehicleUnit: "km" })).toBe("mi");
    expect(resolveOrderMileageUnit({ snapshotUnit: null, vehicleUnit: "mi" })).toBe("mi");
    expect(resolveOrderMileageUnit({})).toBe("km");
    expect(resolveFormOrderMileageUnit({ vehicleUnit: "mi", snapshotUnit: "km" })).toBe("mi");
    expect(resolveFormOrderMileageUnit({ vehicleUnit: null, snapshotUnit: "mi" })).toBe("mi");
  });
});
