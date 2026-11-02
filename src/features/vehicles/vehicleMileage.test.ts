import { describe, expect, it } from "vitest";
import {
  compareMileageReadings,
  formatVehicleMileage,
  isMileageUnit,
  mileageToCanonicalKm,
  parseMileageUnit,
} from "./vehicleMileage";

const t = ((key: string) => key) as never;

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
});
