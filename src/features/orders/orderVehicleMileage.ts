import type { QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import i18n, { currentIntlLocale } from "../../i18n";
import { formatMileageInput, MileageParseError, parseMileageInput } from "../../lib/mileage";
import type { MileageUnit, Order, Vehicle, VehicleInput } from "../../lib/types";
import { updateVehicle } from "../../services/apiVehicles";
import { clientVehiclesQueryKey } from "../vehicles/useGetClientVehicles";
import { convertMileage, formatVehicleMileage, mileageUnitAbbreviation } from "../vehicles/vehicleMileage";

/** Form string → non-negative whole number, or null when empty. Throws for invalid input. */
export function parseVisitMileage(raw: string | null | undefined): number | null {
  try {
    return parseMileageInput(raw);
  } catch (error) {
    if (error instanceof MileageParseError) throw new Error(i18n.t(error.i18nKey));
    throw error;
  }
}

/** Validate a visit-mileage form value for react-hook-form (empty allowed). */
export function visitMileageValidate(value: string, fallbackMessage?: string): true | string {
  if (!value.trim()) return true;
  try {
    parseVisitMileage(value);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message) return error.message;
    return fallbackMessage ?? "vehicles.validation.mileageInvalid";
  }
}

/** Latest known vehicle odometer: current when set, otherwise initial. */
export function knownVehicleMileage(
  vehicle: Pick<Vehicle, "currentMileage" | "initialMileage"> | null | undefined,
): number | null {
  if (!vehicle) return null;
  if (vehicle.currentMileage != null && Number.isFinite(vehicle.currentMileage)) return vehicle.currentMileage;
  if (vehicle.initialMileage != null && Number.isFinite(vehicle.initialMileage)) return vehicle.initialMileage;
  return null;
}

export function mileageFormValueFromVehicle(vehicle: Vehicle | null | undefined): string {
  const known = knownVehicleMileage(vehicle);
  return known != null ? formatMileageInput(known, currentIntlLocale()) : "";
}

/** Prefill edit forms from the order's historical snapshot (not the vehicle's live reading). */
export function mileageFormValueFromOrder(
  order: Pick<Order, "vehicleMileageSnapshot"> | null | undefined,
): string {
  return order?.vehicleMileageSnapshot != null
    ? formatMileageInput(order.vehicleMileageSnapshot, currentIntlLocale())
    : "";
}

/**
 * Build the order-level historical mileage snapshot for create / explicit edit.
 * Empty form → null (caller should omit the write on edit).
 * Unit comes from the vehicle's configured unit at save time — never converted.
 */
export function buildOrderMileageSnapshot(
  formMileage: string | null | undefined,
  vehicle: Pick<Vehicle, "mileageUnit"> | null | undefined,
): { vehicleMileageSnapshot: number; vehicleMileageUnitSnapshot: MileageUnit | null } | null {
  const reading = parseVisitMileage(formMileage);
  if (reading == null) return null;
  return {
    vehicleMileageSnapshot: reading,
    vehicleMileageUnitSnapshot: vehicle?.mileageUnit ?? null,
  };
}

/**
 * Decide whether to write vehicles.current_mileage.
 * Empty form never clears an existing mileage; unchanged values skip the write.
 */
export function resolveVehicleMileageUpdate(
  vehicle: Vehicle,
  formMileage: string | null | undefined,
): { update: false } | { update: true; currentMileage: number } {
  const next = parseVisitMileage(formMileage);
  if (next == null) return { update: false };
  if (vehicle.currentMileage === next) return { update: false };
  return { update: true, currentMileage: next };
}

export function vehicleInputWithCurrentMileage(vehicle: Vehicle, currentMileage: number): VehicleInput {
  return {
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    vin: vehicle.vin,
    licensePlate: vehicle.licensePlate,
    initialMileage: vehicle.initialMileage,
    currentMileage,
    // Omit mileageUnit so updateVehicle leaves the configured unit untouched.
    engineDisplacement: vehicle.engineDisplacement,
    fuelType: vehicle.fuelType,
  };
}

/** Persist visit mileage onto the selected vehicle before the order write. No-op when unchanged/empty. */
export async function persistOrderVehicleMileage(args: {
  workspaceId: string | undefined;
  clientId: string;
  vehicle: Vehicle;
  formMileage: string | null | undefined;
  queryClient: QueryClient;
}): Promise<Vehicle | null> {
  const decision = resolveVehicleMileageUpdate(args.vehicle, args.formMileage);
  if (!decision.update) return null;

  const updated = await updateVehicle(
    args.workspaceId,
    args.vehicle.id,
    vehicleInputWithCurrentMileage(args.vehicle, decision.currentMileage),
  );

  void args.queryClient.invalidateQueries({
    queryKey: clientVehiclesQueryKey(args.workspaceId, args.clientId),
  });
  void args.queryClient.invalidateQueries({
    queryKey: ["vehicles", args.workspaceId, "id", args.vehicle.id],
  });

  return updated;
}

/** True when the intake reading is below the vehicle's previously known mileage (odometer replace). */
export function isIntakeMileageBelowKnown(args: {
  reading: number | null | undefined;
  readingUnit?: MileageUnit | null;
  vehicle: Pick<Vehicle, "currentMileage" | "initialMileage" | "mileageUnit"> | null | undefined;
}): boolean {
  const known = knownVehicleMileage(args.vehicle);
  if (args.reading == null || !Number.isFinite(args.reading) || known == null || !args.vehicle) return false;
  const vehicleUnit = args.vehicle.mileageUnit;
  const fromUnit = args.readingUnit ?? vehicleUnit;
  const converted =
    fromUnit && vehicleUnit && fromUnit !== vehicleUnit
      ? convertMileage(args.reading, fromUnit, vehicleUnit)
      : args.reading;
  if (converted == null || !Number.isFinite(converted)) return false;
  return converted < known;
}

/** Soft warning copy when intake mileage is lower than the last known vehicle reading. */
export function intakeMileageBelowKnownMessage(
  vehicle: Pick<Vehicle, "currentMileage" | "initialMileage" | "mileageUnit">,
  t: TFunction,
): string {
  const known = knownVehicleMileage(vehicle);
  const formatted =
    known == null
      ? t("common.noValue")
      : formatVehicleMileage(known, vehicle.mileageUnit, t, { locale: currentIntlLocale() });
  return t("vehicles.mileage.belowKnownWarning", { value: formatted });
}

/** Muted hint under intake field: last known reading + optional updated date. */
export function lastKnownMileageHint(
  vehicle: Pick<Vehicle, "currentMileage" | "initialMileage" | "mileageUnit" | "updatedAt"> | null | undefined,
  t: TFunction,
  options?: { locale?: string; formatDate?: (iso: string) => string },
): string | null {
  const known = knownVehicleMileage(vehicle);
  if (known == null || !vehicle) return null;
  const unitAbbr = mileageUnitAbbreviation(vehicle.mileageUnit, t);
  const value = formatMileageInput(known, options?.locale ?? currentIntlLocale());
  const reading = unitAbbr ? `${value} ${unitAbbr}` : value;
  const updatedAt = vehicle.updatedAt?.trim();
  if (updatedAt && options?.formatDate) {
    return t("vehicles.mileage.lastKnownWithDate", {
      value: reading,
      date: options.formatDate(updatedAt),
    });
  }
  return t("vehicles.mileage.lastKnown", { value: reading });
}

export function orderHasMileageWarrantyLimit(
  order: Pick<Order, "services" | "materials"> | null | undefined,
): boolean {
  if (!order) return false;
  const lines = [...(order.services ?? []), ...(order.materials ?? [])];
  return lines.some(
    (line) =>
      line.warrantyKm != null && Number.isFinite(line.warrantyKm) && Number(line.warrantyKm) > 0,
  );
}

/**
 * Soft close dialog: vehicle industry + linked vehicle + mileage-warranty line + not confirmed.
 */
export function shouldConfirmMileageBeforeClose(
  order: Order | null | undefined,
  opts: { clientVehicles: boolean },
): boolean {
  if (!opts.clientVehicles || !order) return false;
  if (!order.vehicleId?.trim()) return false;
  if (order.vehicleMileageConfirmed === true) return false;
  return orderHasMileageWarrantyLimit(order);
}

/** Preferred intake reading shown in the close soft dialog (snapshot, else vehicle known). */
export function resolveCloseMileagePrefill(args: {
  order: Pick<Order, "vehicleMileageSnapshot" | "vehicleMileageUnitSnapshot">;
  vehicle: Pick<Vehicle, "currentMileage" | "initialMileage" | "mileageUnit"> | null | undefined;
}): { value: number | null; unit: MileageUnit | null } {
  if (args.order.vehicleMileageSnapshot != null && Number.isFinite(args.order.vehicleMileageSnapshot)) {
    return {
      value: args.order.vehicleMileageSnapshot,
      unit: args.order.vehicleMileageUnitSnapshot ?? args.vehicle?.mileageUnit ?? null,
    };
  }
  const known = knownVehicleMileage(args.vehicle);
  return {
    value: known,
    unit: args.vehicle?.mileageUnit ?? args.order.vehicleMileageUnitSnapshot ?? null,
  };
}
