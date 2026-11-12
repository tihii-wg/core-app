import type { MileageUnit, Vehicle, VehicleInput } from "../../lib/types";
import { parseOptionalVehicleNumber } from "../../services/apiVehicles";
import { formatMileageInput, MileageParseError, parseMileageInput } from "../../lib/mileage";
import { normalizeVin, optionalVinValidate } from "../../lib/vin";
import i18n, { currentIntlLocale } from "../../i18n";
import { isMileageUnit } from "./vehicleMileage";

export const VEHICLE_FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric", "lpg", "other"] as const;

export type VehicleFormValues = {
  make: string;
  model: string;
  year: string;
  vin: string;
  licensePlate: string;
  initialMileage: string;
  currentMileage: string;
  /** "" = unset / unknown — never invent km or mi. */
  mileageUnit: "" | MileageUnit;
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
    mileageUnit: "",
    engineDisplacement: "",
    fuelType: "",
  };
}

function formatMileageFormValue(value: number | null | undefined): string {
  if (value == null) return "";
  return formatMileageInput(value, currentIntlLocale());
}

export function vehicleToFormValues(vehicle?: Vehicle | null): VehicleFormValues {
  if (!vehicle) return emptyVehicleFormValues();
  return {
    make: vehicle.make ?? "",
    model: vehicle.model ?? "",
    year: vehicle.year != null ? String(vehicle.year) : "",
    vin: vehicle.vin ?? "",
    licensePlate: vehicle.licensePlate ?? "",
    initialMileage: formatMileageFormValue(vehicle.initialMileage),
    currentMileage: formatMileageFormValue(vehicle.currentMileage),
    mileageUnit: vehicle.mileageUnit ?? "",
    engineDisplacement: vehicle.engineDisplacement != null ? String(vehicle.engineDisplacement) : "",
    fuelType: vehicle.fuelType ?? "",
  };
}

function parseMileageField(raw: string): number | null {
  try {
    return parseMileageInput(raw);
  } catch (error) {
    if (error instanceof MileageParseError) throw new Error(i18n.t(error.i18nKey));
    throw error;
  }
}

/**
 * Convert form strings to a VehicleInput; throws localized errors for invalid numbers/VIN.
 * Create forms mirror the single mileage field into both initial and current when current is empty.
 */
export function vehicleFormValuesToInput(values: VehicleFormValues): VehicleInput {
  const year = parseOptionalVehicleNumber(values.year);
  const initialMileage = parseMileageField(values.initialMileage);
  const currentMileageRaw = parseMileageField(values.currentMileage);
  // Create UI writes one field into initialMileage and mirrors via onChange; if mirroring was skipped,
  // still treat a lone initial value as both initial and current.
  const currentMileage = currentMileageRaw ?? initialMileage;
  const engineDisplacement = parseOptionalVehicleNumber(values.engineDisplacement);
  const mileageUnit: MileageUnit | null = values.mileageUnit === "" ? null : values.mileageUnit;

  if (values.year.trim() && (year == null || !Number.isInteger(year) || year < 1886 || year > 2200)) {
    throw new Error(i18n.t("vehicles.validation.yearRange"));
  }
  if (mileageUnit != null && !isMileageUnit(mileageUnit)) {
    throw new Error(i18n.t("vehicles.validation.mileageUnitInvalid"));
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
    mileageUnit,
    engineDisplacement,
    fuelType: values.fuelType,
  };
}
