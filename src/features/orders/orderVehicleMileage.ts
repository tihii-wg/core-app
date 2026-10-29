import type { QueryClient } from "@tanstack/react-query";
import i18n from "../../i18n";
import type { Vehicle, VehicleInput } from "../../lib/types";
import { parseOptionalVehicleNumber, updateVehicle } from "../../services/apiVehicles";
import { clientVehiclesQueryKey } from "../vehicles/useGetClientVehicles";

/** Form string → non-negative whole number, or null when empty. Throws for invalid input. */
export function parseVisitMileage(raw: string | null | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const n = parseOptionalVehicleNumber(trimmed);
  if (n == null || !Number.isInteger(n) || n < 0) {
    throw new Error(i18n.t("vehicles.validation.mileageWholeNonNegative"));
  }
  return n;
}

/** Validate a visit-mileage form value for react-hook-form (empty allowed). */
export function visitMileageValidate(value: string, message: string): true | string {
  if (!value.trim()) return true;
  try {
    parseVisitMileage(value);
    return true;
  } catch {
    return message;
  }
}

export function mileageFormValueFromVehicle(vehicle: Vehicle | null | undefined): string {
  return vehicle?.currentMileage != null ? String(vehicle.currentMileage) : "";
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
