import i18n from "../i18n";
import supabase from "./supabase";

export type LocationRecord = {
  id: string;
  workspaceId: string;
  name: string;
  address: string | null;
  phone: string | null;
  color: string | null;
  code: string | null;
  isDefault: boolean;
  isActive: boolean;
};

const locationColumns = "id, workspace_id, name, address, phone, color, code, is_default, is_active, deleted_at";

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

function isMissingLocationsTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /locations/i.test(error.message ?? "");
}

export function toLocation(row: Record<string, unknown>): LocationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: typeof row.name === "string" ? row.name : "",
    address: typeof row.address === "string" ? row.address : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    color: typeof row.color === "string" ? row.color : null,
    code: typeof row.code === "string" ? row.code : null,
    isDefault: Boolean(row.is_default),
    isActive: row.is_active !== false,
  };
}

export async function getLocations(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("locations")
    .select(locationColumns)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    if (isMissingLocationsTable(error)) return [] as LocationRecord[];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toLocation);
}

/**
 * Phone for print `#КОМПАНИЯ-ТЕЛЕФОН`: default active location, else first active (non-deleted).
 */
export function pickPrintCompanyPhone(locations: readonly LocationRecord[]): string | null {
  const active = locations.filter((location) => location.isActive);
  const preferred = active.find((location) => location.isDefault) ?? active[0] ?? null;
  const phone = preferred?.phone?.trim() ?? "";
  return phone || null;
}

export type LocationInput = {
  name: string;
  address?: string | null;
  phone?: string | null;
  color?: string | null;
  code?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
};

function nullIfBlank(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function mapLocationWriteError(error: { code?: string; message?: string }) {
  if (isMissingLocationsTable(error)) return new Error(i18n.t("settings.locations.errors.unavailable"));
  return new Error(error.message ?? i18n.t("common.somethingWentWrong"));
}

function requireName(name: string | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) throw new Error(i18n.t("settings.locations.errors.nameRequired"));
  return trimmed;
}

/** Clears `is_default` on every other live location (partial unique index allows one default per workspace). */
async function clearOtherDefaults(workspaceId: string, exceptId?: string) {
  let query = supabase
    .from("locations")
    .update({ is_default: false })
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .is("deleted_at", null);
  if (exceptId) query = query.neq("id", exceptId);
  const { error } = await query;
  if (error) throw mapLocationWriteError(error);
}

export async function createLocation(input: LocationInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const name = requireName(input.name);
  if (input.isDefault) await clearOtherDefaults(resolved);

  const { data, error } = await supabase
    .from("locations")
    .insert({
      workspace_id: resolved,
      name,
      address: nullIfBlank(input.address),
      phone: nullIfBlank(input.phone),
      color: nullIfBlank(input.color),
      code: nullIfBlank(input.code),
      is_default: Boolean(input.isDefault),
      is_active: input.isActive !== false,
    })
    .select(locationColumns)
    .single();

  if (error) throw mapLocationWriteError(error);
  return toLocation(data as Record<string, unknown>);
}

export async function updateLocation(locationId: string, input: Partial<LocationInput>, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = requireName(input.name);
  if (input.address !== undefined) patch.address = nullIfBlank(input.address);
  if (input.phone !== undefined) patch.phone = nullIfBlank(input.phone);
  if (input.color !== undefined) patch.color = nullIfBlank(input.color);
  if (input.code !== undefined) patch.code = nullIfBlank(input.code);
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.isDefault === true) await clearOtherDefaults(resolved, locationId);
  if (input.isDefault !== undefined) patch.is_default = input.isDefault;

  const { data, error } = await supabase
    .from("locations")
    .update(patch)
    .eq("id", locationId)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .select(locationColumns)
    .single();

  if (error) throw mapLocationWriteError(error);
  return toLocation(data as Record<string, unknown>);
}

export async function setDefaultLocation(locationId: string, workspaceId: string | undefined) {
  return updateLocation(locationId, { isDefault: true, isActive: true }, workspaceId);
}

/** Soft delete: sets `deleted_at` and drops the default flag so another location can become default. */
export async function deleteLocation(locationId: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { error } = await supabase
    .from("locations")
    .update({ deleted_at: new Date().toISOString(), is_default: false, is_active: false })
    .eq("id", locationId)
    .eq("workspace_id", resolved)
    .is("deleted_at", null);
  if (error) throw mapLocationWriteError(error);
}
