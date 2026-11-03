import { describe, expect, it } from "vitest";
import type { Vehicle } from "../../lib/types";
import {
  emptyVehicleFormValues,
  vehicleFormValuesToInput,
  vehicleToFormValues,
} from "./vehicleForm";

const baseVehicle: Vehicle = {
  id: "veh-1",
  workspaceId: "ws-1",
  clientId: "client-1",
  make: "Toyota",
  model: "Corolla",
  year: 2018,
  vin: null,
  licensePlate: "ABC123",
  initialMileage: 10000,
  currentMileage: 45200,
  mileageUnit: null,
  engineDisplacement: null,
  fuelType: null,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

describe("vehicleForm mileage unit", () => {
  it("starts create forms with an unset unit (never invents km/mi)", () => {
    expect(emptyVehicleFormValues().mileageUnit).toBe("");
    expect(vehicleToFormValues(null).mileageUnit).toBe("");
    expect(vehicleToFormValues({ ...baseVehicle, mileageUnit: null }).mileageUnit).toBe("");
  });

  it("loads a saved unit when reopening an existing vehicle", () => {
    expect(vehicleToFormValues({ ...baseVehicle, mileageUnit: "km" }).mileageUnit).toBe("km");
    expect(vehicleToFormValues({ ...baseVehicle, mileageUnit: "mi" }).mileageUnit).toBe("mi");
  });

  it("persists an explicit unit selection without converting mileage numbers", () => {
    const values = vehicleToFormValues({ ...baseVehicle, mileageUnit: null, currentMileage: 45200 });
    values.mileageUnit = "mi";
    const input = vehicleFormValuesToInput(values);
    expect(input.mileageUnit).toBe("mi");
    expect(input.currentMileage).toBe(45200);
    expect(input.initialMileage).toBe(10000);
  });

  it("allows changing the unit later without converting readings", () => {
    const values = vehicleToFormValues({ ...baseVehicle, mileageUnit: "km", currentMileage: 45200 });
    expect(values.mileageUnit).toBe("km");
    values.mileageUnit = "mi";
    const input = vehicleFormValuesToInput(values);
    expect(input.mileageUnit).toBe("mi");
    expect(input.currentMileage).toBe(45200);
  });

  it("saves null when the user leaves the unit unset", () => {
    const input = vehicleFormValuesToInput(emptyVehicleFormValues());
    expect(input.mileageUnit).toBeNull();
  });
});
