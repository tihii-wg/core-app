import i18n from "../i18n";
import type { Vehicle, VehicleInput } from "../lib/types";
import { nullIfEmptyNumber, nullIfEmptyText } from "../lib/nullish";
import { assertValidOptionalVin } from "../lib/vin";
import supabase from "./supabase";

const vehicleColumns =
  "id, workspace_id, client_id, make, model, year, vin, license_plate, initial_mileage, current_mileage, engine_displacement, fuel_type, created_at, updated_at, deleted_at";

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toVehicle(row: Record<string, unknown>): Vehicle {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    clientId: String(row.client_id),
    make: textOrNull(row.make),
    model: textOrNull(row.model),
    year: numberOrNull(row.year),
    vin: textOrNull(row.vin),
    licensePlate: textOrNull(row.license_plate),
    initialMileage: numberOrNull(row.initial_mileage),
    currentMileage: numberOrNull(row.current_mileage),
    engineDisplacement: numberOrNull(row.engine_displacement),
    fuelType: textOrNull(row.fuel_type),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
  };
}

function validateVehicleInput(input: VehicleInput) {
  const year = input.year ?? null;
  if (year != null && (!Number.isInteger(year) || year < 1886 || year > 2200)) {
    throw new Error(i18n.t("vehicles.validation.yearRange"));
  }
  const initial = input.initialMileage ?? null;
  if (initial != null && initial < 0) throw new Error(i18n.t("vehicles.validation.mileageNonNegative"));
  const current = input.currentMileage ?? null;
  if (current != null && current < 0) throw new Error(i18n.t("vehicles.validation.mileageNonNegative"));
  const displacement = input.engineDisplacement ?? null;
  if (displacement != null && displacement <= 0) throw new Error(i18n.t("vehicles.validation.displacementPositive"));
  assertValidOptionalVin(input.vin);
}

function payloadFromInput(input: VehicleInput) {
  validateVehicleInput(input);
  return {
    make: nullIfEmptyText(input.make ?? null),
    model: nullIfEmptyText(input.model ?? null),
    year: input.year ?? null,
    vin: assertValidOptionalVin(input.vin),
    license_plate: nullIfEmptyText(input.licensePlate ?? null)?.toUpperCase() ?? null,
    initial_mileage: input.initialMileage ?? null,
    current_mileage: input.currentMileage ?? null,
    engine_displacement: input.engineDisplacement ?? null,
    fuel_type: nullIfEmptyText(input.fuelType ?? null),
  };
}

/** Parse optional numeric form string → number | null (empty → null, not 0). */
export function parseOptionalVehicleNumber(raw: string): number | null {
  return nullIfEmptyNumber(raw);
}

async function assertClientInWorkspace(workspaceId: string, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("vehicles.errors.clientNotFound"));
}

export async function getClientVehicles(workspaceId: string | undefined, clientId: string) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetClientId = clientId.trim();
  if (!targetClientId) return [] as Vehicle[];

  const { data, error } = await supabase
    .from("vehicles")
    .select(vehicleColumns)
    .eq("workspace_id", targetWorkspaceId)
    .eq("client_id", targetClientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toVehicle);
}

export async function getVehicle(workspaceId: string | undefined, vehicleId: string) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("vehicles")
    .select(vehicleColumns)
    .eq("workspace_id", targetWorkspaceId)
    .eq("id", vehicleId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return toVehicle(data as Record<string, unknown>);
}

export async function createVehicle(workspaceId: string | undefined, clientId: string, input: VehicleInput) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetClientId = clientId.trim();
  if (!targetClientId) throw new Error(i18n.t("vehicles.errors.clientRequired"));
  await assertClientInWorkspace(targetWorkspaceId, targetClientId);

  const payload = payloadFromInput(input);
  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      workspace_id: targetWorkspaceId,
      client_id: targetClientId,
      ...payload,
    })
    .select(vehicleColumns)
    .single();

  if (error) throw new Error(error.message);
  return toVehicle(data as Record<string, unknown>);
}

export async function updateVehicle(workspaceId: string | undefined, vehicleId: string, input: VehicleInput) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const payload = payloadFromInput(input);
  const { data, error } = await supabase
    .from("vehicles")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", vehicleId)
    .eq("workspace_id", targetWorkspaceId)
    .is("deleted_at", null)
    .select(vehicleColumns)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("vehicles.errors.notFound"));
  return toVehicle(data as Record<string, unknown>);
}

export async function archiveVehicle(workspaceId: string | undefined, vehicleId: string) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("vehicles")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", vehicleId)
    .eq("workspace_id", targetWorkspaceId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("vehicles.errors.notFound"));
  return { id: vehicleId };
}

/** Ensure vehicle belongs to workspace + client and is not soft-deleted. */
export async function assertVehicleAssignable(workspaceId: string, clientId: string | null, vehicleId: string | null) {
  if (!vehicleId) return null;
  if (!clientId) throw new Error(i18n.t("vehicles.errors.vehicleNeedsClient"));

  const { data, error } = await supabase
    .from("vehicles")
    .select("id")
    .eq("id", vehicleId)
    .eq("workspace_id", workspaceId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("vehicles.errors.invalidSelection"));
  return vehicleId;
}

/** Make / model / year joined the same way as vehicle list labels (empty when all missing). */
export function vehicleMakeModelLabel(vehicle: Pick<Vehicle, "make" | "model" | "year">) {
  return [vehicle.make, vehicle.model, vehicle.year != null ? String(vehicle.year) : null]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function vehicleDisplayLabel(vehicle: Vehicle) {
  const title = vehicleMakeModelLabel(vehicle);
  const plate = vehicle.licensePlate?.trim();
  if (title && plate) return `${title} · ${plate}`;
  if (title) return title;
  if (plate) return plate;
  if (vehicle.vin) return vehicle.vin;
  return i18n.t("vehicles.untitled");
}

/** Compact identifying lines for a selected vehicle on order forms. */
export function vehicleSummaryDetails(vehicle: Vehicle) {
  const title = vehicleMakeModelLabel(vehicle) || i18n.t("vehicles.untitled");
  const details = [
    vehicle.licensePlate ? `${i18n.t("vehicles.fields.licensePlate")}: ${vehicle.licensePlate}` : null,
    vehicle.vin ? `${i18n.t("vehicles.fields.vin")}: ${vehicle.vin}` : null,
  ].filter(Boolean) as string[];
  return { title, details };
}

/**
 * Legacy order snapshot columns from a linked `vehicles` row.
 * Missing vehicle fields become empty strings (API persists NULL via nullIfEmptyText).
 */
export function orderAssetFieldsFromVehicle(vehicle: Vehicle | null | undefined): {
  device: string;
  carNumber: string;
  vin: string;
} {
  if (!vehicle) return { device: "", carNumber: "", vin: "" };
  return {
    device: vehicleMakeModelLabel(vehicle),
    carNumber: vehicle.licensePlate?.trim() ?? "",
    vin: vehicle.vin?.trim() ?? "",
  };
}
