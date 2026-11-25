import type { Vehicle } from "../../lib/types";
import { plateMatchesQuery } from "../../lib/plateVin";
import { vehicleMakeModelMatches } from "../../lib/vehicleTextSearch";

type ClientVehicleSearchFields = Pick<Vehicle, "make" | "model" | "licensePlate"> & { vin?: string | null };

/**
 * Local match for the client Vehicles section search.
 * Make / model (token AND), normalized license plate or VIN (part of it); case-insensitive; partial.
 */
export function clientVehicleMatchesQuery(vehicle: ClientVehicleSearchFields, query: string): boolean {
  const raw = query.trim();
  if (!raw) return true;
  if (vehicle.licensePlate && plateMatchesQuery(vehicle.licensePlate, raw)) return true;
  const vinQuery = raw.replace(/\s+/g, "").toUpperCase();
  if (vinQuery.length >= 3 && vehicle.vin && vehicle.vin.toUpperCase().includes(vinQuery)) return true;
  if (vehicleMakeModelMatches(vehicle.make, vehicle.model, raw)) return true;
  return false;
}

/** Filter an already-loaded client vehicle list locally (no network). */
export function filterClientVehiclesByQuery<T extends ClientVehicleSearchFields>(
  vehicles: T[],
  query: string,
): T[] {
  const raw = query.trim();
  if (!raw) return vehicles;
  return vehicles.filter((vehicle) => clientVehicleMatchesQuery(vehicle, raw));
}
