import type { TFunction } from "i18next";
import type { MileageUnit, Vehicle } from "../../lib/types";

export const MILEAGE_UNITS = ["km", "mi"] as const;

export function isMileageUnit(value: unknown): value is MileageUnit {
  return value === "km" || value === "mi";
}

export function parseMileageUnit(value: unknown): MileageUnit | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isMileageUnit(normalized) ? normalized : null;
}

/** Abbreviation for labels (km / mi). Empty when unit is unknown — never invent a unit. */
export function mileageUnitAbbreviation(unit: MileageUnit | null | undefined): string {
  if (unit === "km") return "km";
  if (unit === "mi") return "mi";
  return "";
}

export function mileageUnitLabel(unit: MileageUnit | null | undefined, t: TFunction): string {
  if (unit === "km") return t("vehicles.mileage.kilometers");
  if (unit === "mi") return t("vehicles.mileage.miles");
  return t("vehicles.mileage.unitUnknown");
}

/**
 * Display helper: known unit → "85,000 mi"; unknown unit → "85,000" plus a clear unknown marker via t().
 * Never converts between km and mi.
 */
export function formatVehicleMileage(
  value: number | null | undefined,
  unit: MileageUnit | null | undefined,
  t: TFunction,
  options?: { locale?: string; empty?: string },
): string {
  if (value == null || !Number.isFinite(value)) return options?.empty ?? t("common.noValue");
  const formatted = value.toLocaleString(options?.locale, { maximumFractionDigits: 0 });
  if (unit === "km" || unit === "mi") return `${formatted} ${mileageUnitAbbreviation(unit)}`;
  return `${formatted} (${t("vehicles.mileage.unitUnknownShort")})`;
}

export function formatVehicleMileageFromVehicle(
  vehicle: Pick<Vehicle, "currentMileage" | "initialMileage" | "mileageUnit">,
  which: "current" | "initial",
  t: TFunction,
  options?: { locale?: string; empty?: string },
): string {
  const value = which === "current" ? vehicle.currentMileage : vehicle.initialMileage;
  return formatVehicleMileage(value, vehicle.mileageUnit, t, options);
}

/** Convert a reading to kilometers for cross-unit comparison only. Never use for display/storage. */
export function mileageToCanonicalKm(value: number, unit: MileageUnit): number {
  if (unit === "mi") return value * 1.609344;
  return value;
}

/**
 * Compare two readings for sorting/aggregation.
 * Returns null when either unit is unknown — callers must not treat that as equal.
 */
export function compareMileageReadings(
  a: { value: number; unit: MileageUnit | null | undefined },
  b: { value: number; unit: MileageUnit | null | undefined },
): number | null {
  if (!isMileageUnit(a.unit) || !isMileageUnit(b.unit)) return null;
  return mileageToCanonicalKm(a.value, a.unit) - mileageToCanonicalKm(b.value, b.unit);
}
