import type { Vehicle, VehicleInput } from "../../lib/types";
import { parseOptionalVehicleNumber } from "../../services/apiVehicles";
import { normalizeVin, optionalVinValidate } from "../../lib/vin";
import i18n from "../../i18n";

export const VEHICLE_FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric", "lpg", "other"] as const;

export type VehicleFormValues = {
  make: string;
  model: string;
  year: string;
  vin: string;
  licensePlate: string;
  initialMileage: string;
  currentMileage: string;
  engineDisplacement: string;
  fuelType: string;
};

export function emptyVehicleFormValues(): VehicleFormValues {
  return {
    make: "",
    model: "",
    year: "",
    vin: "",
    licensePlate: "",
    initialMileage: "",
    currentMileage: "",
    engineDisplacement: "",
    fuelType: "",
  };
}

export function vehicleToFormValues(vehicle?: Vehicle | null): VehicleFormValues {
  if (!vehicle) return emptyVehicleFormValues();
  return {
    make: vehicle.make ?? "",
    model: vehicle.model ?? "",
    year: vehicle.year != null ? String(vehicle.year) : "",
    vin: vehicle.vin ?? "",
    licensePlate: vehicle.licensePlate ?? "",
    initialMileage: vehicle.initialMileage != null ? String(vehicle.initialMileage) : "",
    currentMileage: vehicle.currentMileage != null ? String(vehicle.currentMileage) : "",
    engineDisplacement: vehicle.engineDisplacement != null ? String(vehicle.engineDisplacement) : "",
    fuelType: vehicle.fuelType ?? "",
  };
}

/** Convert form strings to a VehicleInput; throws localized errors for invalid numbers/VIN. */
export function vehicleFormValuesToInput(values: VehicleFormValues): VehicleInput {
  const year = parseOptionalVehicleNumber(values.year);
  const initialMileage = parseOptionalVehicleNumber(values.initialMileage);
  const currentMileage = parseOptionalVehicleNumber(values.currentMileage);
  const engineDisplacement = parseOptionalVehicleNumber(values.engineDisplacement);

  if (values.year.trim() && (year == null || !Number.isInteger(year) || year < 1886 || year > 2200)) {
    throw new Error(i18n.t("vehicles.validation.yearRange"));
  }
  if (values.initialMileage.trim() && (initialMileage == null || initialMileage < 0)) {
    throw new Error(i18n.t("vehicles.validation.mileageNonNegative"));
  }
  if (values.currentMileage.trim() && (currentMileage == null || currentMileage < 0)) {
    throw new Error(i18n.t("vehicles.validation.mileageNonNegative"));
  }
  if (values.engineDisplacement.trim() && (engineDisplacement == null || engineDisplacement <= 0)) {
    throw new Error(i18n.t("vehicles.validation.displacementPositive"));
  }
  const vinCheck = optionalVinValidate(values.vin, i18n.t("vehicles.validation.vinInvalid"));
  if (vinCheck !== true) throw new Error(vinCheck);

  return {
    make: values.make,
    model: values.model,
    year,
    vin: normalizeVin(values.vin) || null,
    licensePlate: values.licensePlate,
    initialMileage,
    currentMileage,
    engineDisplacement,
    fuelType: values.fuelType,
  };
}
