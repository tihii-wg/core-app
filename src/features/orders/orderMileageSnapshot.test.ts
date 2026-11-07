import { describe, expect, it } from "vitest";
import { formatVehicleMileage } from "../vehicles/vehicleMileage";
import { buildOrderMileageSnapshot, mileageFormValueFromOrder } from "./orderVehicleMileage";
import { orderMileageSnapshotFields, resetOrderMileageSnapshotSupport } from "../../services/apiOrders";

const t = ((key: string) => {
  if (key === "vehicles.mileage.abbr.km") return "km";
  if (key === "vehicles.mileage.abbr.mi") return "mi";
  return key;
}) as never;

describe("historical order mileage snapshots", () => {
  it("stores a miles snapshot when the vehicle uses miles", () => {
    const snapshot = buildOrderMileageSnapshot("85500", { mileageUnit: "mi" });
    expect(snapshot).toEqual({
      vehicleMileageSnapshot: 85500,
      vehicleMileageUnitSnapshot: "mi",
    });
    expect(formatVehicleMileage(snapshot!.vehicleMileageSnapshot, snapshot!.vehicleMileageUnitSnapshot, t, { locale: "en-US" })).toBe(
      "85,500 mi",
    );
  });

  it("keeps displaying the old order in miles after the vehicle switches to kilometers", () => {
    const orderSnapshot = {
      vehicleMileageSnapshot: 85500,
      vehicleMileageUnitSnapshot: "mi" as const,
    };
    const vehicleNow = { currentMileage: 140000, mileageUnit: "km" as const };

    expect(
      formatVehicleMileage(orderSnapshot.vehicleMileageSnapshot, orderSnapshot.vehicleMileageUnitSnapshot, t, {
        locale: "en-US",
      }),
    ).toBe("85,500 mi");
    expect(
      formatVehicleMileage(vehicleNow.currentMileage, vehicleNow.mileageUnit, t, { locale: "en-US" }),
    ).toBe("140,000 km");
    expect(orderSnapshot.vehicleMileageUnitSnapshot).not.toBe(vehicleNow.mileageUnit);
  });

  it("uses the new vehicle unit for a newly created order", () => {
    const snapshot = buildOrderMileageSnapshot("140000", { mileageUnit: "km" });
    expect(snapshot).toEqual({
      vehicleMileageSnapshot: 140000,
      vehicleMileageUnitSnapshot: "km",
    });
  });

  it("leaves legacy orders with unknown units unknown", () => {
    expect(mileageFormValueFromOrder({ vehicleMileageSnapshot: 12000 })).toBe("12000");
    expect(
      formatVehicleMileage(12000, null, t, { locale: "en-US" }),
    ).toBe("12,000 (vehicles.mileage.unitUnknownShort)");
    expect(buildOrderMileageSnapshot("12000", { mileageUnit: null })?.vehicleMileageUnitSnapshot).toBeNull();
  });

  it("omits snapshot fields from unrelated updates when input is undefined", () => {
    resetOrderMileageSnapshotSupport();
    expect(orderMileageSnapshotFields({})).toEqual({});
    expect(
      orderMileageSnapshotFields({
        vehicleMileageSnapshot: 85500,
        vehicleMileageUnitSnapshot: "mi",
      }),
    ).toEqual({
      vehicle_mileage_snapshot: 85500,
      vehicle_mileage_unit_snapshot: "mi",
    });
  });
});
