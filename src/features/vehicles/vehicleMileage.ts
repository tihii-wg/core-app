import type { TFunction } from "i18next";
import { formatMileageInput } from "../../lib/mileage";
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
export function mileageUnitAbbreviation(unit: MileageUnit | null | undefined, t?: TFunction): string {
  if (unit === "km") return t ? String(t("vehicles.mileage.abbr.km")) : "km";
  if (unit === "mi") return t ? String(t("vehicles.mileage.abbr.mi")) : "mi";
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
  const formatted = formatMileageInput(value, options?.locale ?? "en");
  if (unit === "km" || unit === "mi") return `${formatted} ${mileageUnitAbbreviation(unit, t)}`;
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

/** Exact km-per-mile factor used for whole-unit round-trips (50_000 km ↔ 31_069 mi). */
export const KM_PER_MILE = 1.609344;

/** Convert a reading to kilometers for cross-unit comparison only. Never use for display/storage. */
export function mileageToCanonicalKm(value: number, unit: MileageUnit): number {
  if (unit === "mi") return value * KM_PER_MILE;
  return value;
}

/**
 * Convert a whole mileage value between km and mi.
 * Same unit → returned unchanged; null/non-finite → null.
 * Round-trip tolerance is ±1 whole unit because of Math.round (documented in tests).
 */
export function convertMileage(
  value: number | null | undefined,
  from: MileageUnit | null | undefined,
  to: MileageUnit | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const fromUnit = isMileageUnit(from) ? from : null;
  const toUnit = isMileageUnit(to) ? to : null;
  if (!fromUnit || !toUnit) return null;
  if (fromUnit === toUnit) return value;
  if (fromUnit === "km" && toUnit === "mi") return Math.round(value / KM_PER_MILE);
  return Math.round(value * KM_PER_MILE);
}

/**
 * Order mileage unit: saved snapshot first, else the selected vehicle, else kilometers.
 */
export function resolveOrderMileageUnit(params: {
  snapshotUnit?: MileageUnit | null;
  vehicleUnit?: MileageUnit | null;
}): MileageUnit {
  if (isMileageUnit(params.snapshotUnit)) return params.snapshotUnit;
  if (isMileageUnit(params.vehicleUnit)) return params.vehicleUnit;
  return "km";
}

/**
 * Live order-form unit while editing: selected vehicle wins so switching cars converts lines;
 * falls back to the order snapshot when no vehicle is selected.
 */
export function resolveFormOrderMileageUnit(params: {
  vehicleUnit?: MileageUnit | null;
  snapshotUnit?: MileageUnit | null;
}): MileageUnit {
  if (isMileageUnit(params.vehicleUnit)) return params.vehicleUnit;
  if (isMileageUnit(params.snapshotUnit)) return params.snapshotUnit;
  return "km";
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
