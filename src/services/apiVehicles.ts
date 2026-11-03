import i18n from "../i18n";
import type { Vehicle, VehicleInput } from "../lib/types";
import { nullIfEmptyNumber, nullIfEmptyText } from "../lib/nullish";
import { assertValidOptionalVin } from "../lib/vin";
import { isMileageUnit, parseMileageUnit } from "../features/vehicles/vehicleMileage";
import supabase from "./supabase";

const vehicleBaseColumns =
  "id, workspace_id, client_id, make, model, year, vin, license_plate, initial_mileage, current_mileage, engine_displacement, fuel_type, created_at, updated_at, deleted_at";

/** Optional until supabase/manual/20261102220000_vehicle_mileage_unit.PRODUCTION.sql is applied. */
let vehicleMileageUnitSupported = true;

/** Test hook: reset cached mileage_unit column support. */
export function resetVehicleMileageUnitSupport() {
  vehicleMileageUnitSupported = true;
}

export function isVehicleMileageUnitSupported() {
  return vehicleMileageUnitSupported;
}

type DbError = { code?: string; message?: string } | null | undefined;

function isMissingMileageUnitColumn(error: DbError) {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/\bmileage_unit\b/i.test(message)) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column|schema cache/i.test(message);
}

/** Dynamic select list; cast at call sites — generated DB types omit optional mileage_unit until SQL is applied. */
function vehicleColumns(): string {
  return vehicleMileageUnitSupported ? `${vehicleBaseColumns}, mileage_unit` : vehicleBaseColumns;
}

/** Prefer selecting mileage_unit whenever the payload writes it, even if a prior probe cached false. */
function vehicleSelectColumns(payload?: Record<string, unknown>): string {
  if (payload && "mileage_unit" in payload) return `${vehicleBaseColumns}, mileage_unit`;
  return vehicleColumns();
}

async function withVehicleColumns<T extends { error: DbError }>(run: () => PromiseLike<T>): Promise<T> {
  // Always try WITH mileage_unit first so a stale "unsupported" cache recovers after SQL apply.
  const wasSupported = vehicleMileageUnitSupported;
  vehicleMileageUnitSupported = true;
  let result = await run();
  if (isMissingMileageUnitColumn(result.error)) {
    vehicleMileageUnitSupported = false;
    result = await run();
  } else if (!result.error) {
    vehicleMileageUnitSupported = true;
  } else {
    // Unrelated error: restore prior cache so we do not flip support based on RLS/network.
    vehicleMileageUnitSupported = wasSupported;
  }
  return result;
}

/**
 * Read-only probe for vehicles.mileage_unit. Never throws.
 * Always re-checks the DB so a prior "missing column" cache can recover after SQL is applied.
 */
export async function probeVehicleMileageUnitSupport(): Promise<boolean> {
  try {
    const { error } = await supabase.from("vehicles").select("mileage_unit").limit(1);
    if (!error) {
      vehicleMileageUnitSupported = true;
      return true;
    }
    if (isMissingMileageUnitColumn(error)) {
      vehicleMileageUnitSupported = false;
      return false;
    }
    // Unrelated errors (network/RLS): keep current cache, do not flip false.
    return vehicleMileageUnitSupported;
  } catch {
    return vehicleMileageUnitSupported;
  }
}

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
    mileageUnit: parseMileageUnit(row.mileage_unit),
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
  if (input.mileageUnit != null && !isMileageUnit(input.mileageUnit)) {
    throw new Error(i18n.t("vehicles.validation.mileageUnitInvalid"));
  }
  assertValidOptionalVin(input.vin);
}

function payloadFromInput(input: VehicleInput) {
  validateVehicleInput(input);
  const payload: Record<string, unknown> = {
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
  // Always attempt to persist when the form/API provides a value (including explicit null).
  // Omitted keeps the existing DB value (e.g. visit-mileage updates that must not touch the unit).
  // Never invent km/mi. If the column is absent, create/update strip it and surface a clear error.
  if (input.mileageUnit !== undefined) {
    payload.mileage_unit = input.mileageUnit;
  }
  return payload;
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

  const { data, error } = await withVehicleColumns(() =>
    supabase
      .from("vehicles")
      .select(vehicleColumns() as typeof vehicleBaseColumns)
      .eq("workspace_id", targetWorkspaceId)
      .eq("client_id", targetClientId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  );

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toVehicle);
}

export async function getVehicle(workspaceId: string | undefined, vehicleId: string) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await withVehicleColumns(() =>
    supabase
      .from("vehicles")
      .select(vehicleColumns() as typeof vehicleBaseColumns)
      .eq("workspace_id", targetWorkspaceId)
      .eq("id", vehicleId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  if (error) throw new Error(error.message);
  if (!data) return null;
  return toVehicle(data as unknown as Record<string, unknown>);
}

function stripMileageUnitFromPayload(payload: Record<string, unknown>) {
  const next = { ...payload };
  delete next.mileage_unit;
  return next;
}

export async function createVehicle(workspaceId: string | undefined, clientId: string, input: VehicleInput) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const targetClientId = clientId.trim();
  if (!targetClientId) throw new Error(i18n.t("vehicles.errors.clientRequired"));
  await assertClientInWorkspace(targetWorkspaceId, targetClientId);

  let payload = payloadFromInput(input);
  let { data, error } = await supabase
    .from("vehicles")
    .insert({
      workspace_id: targetWorkspaceId,
      client_id: targetClientId,
      ...payload,
    } as Record<string, unknown>)
    .select(vehicleSelectColumns(payload) as typeof vehicleBaseColumns)
    .single();

  if (error && isMissingMileageUnitColumn(error)) {
    vehicleMileageUnitSupported = false;
    if (input.mileageUnit != null) {
      throw new Error(i18n.t("vehicles.errors.mileageUnitUnsupported"));
    }
    payload = stripMileageUnitFromPayload(payload);
    ({ data, error } = await supabase
      .from("vehicles")
      .insert({
        workspace_id: targetWorkspaceId,
        client_id: targetClientId,
        ...payload,
      } as Record<string, unknown>)
      .select(vehicleSelectColumns(payload) as typeof vehicleBaseColumns)
      .single());
  } else if (!error && "mileage_unit" in payload) {
    vehicleMileageUnitSupported = true;
  }

  if (error) throw new Error(error.message);
  return toVehicle(data as unknown as Record<string, unknown>);
}

export async function updateVehicle(workspaceId: string | undefined, vehicleId: string, input: VehicleInput) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  let payload = payloadFromInput(input);
  let { data, error } = await supabase
    .from("vehicles")
    .update({ ...payload, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq("id", vehicleId)
    .eq("workspace_id", targetWorkspaceId)
    .is("deleted_at", null)
    .select(vehicleSelectColumns(payload) as typeof vehicleBaseColumns)
    .maybeSingle();

  if (error && isMissingMileageUnitColumn(error)) {
    vehicleMileageUnitSupported = false;
    if (input.mileageUnit != null) {
      throw new Error(i18n.t("vehicles.errors.mileageUnitUnsupported"));
    }
    payload = stripMileageUnitFromPayload(payload);
    ({ data, error } = await supabase
      .from("vehicles")
      .update({ ...payload, updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq("id", vehicleId)
      .eq("workspace_id", targetWorkspaceId)
      .is("deleted_at", null)
      .select(vehicleSelectColumns(payload) as typeof vehicleBaseColumns)
      .maybeSingle());
  } else if (!error && "mileage_unit" in payload) {
    vehicleMileageUnitSupported = true;
  }

  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("vehicles.errors.notFound"));
  return toVehicle(data as unknown as Record<string, unknown>);
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
