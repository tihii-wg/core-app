import i18n from "../i18n";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

export type WarehouseType = "location" | "company";

export type WarehouseRecord = {
  id: string;
  workspaceId: string;
  locationId: string | null;
  name: string;
  warehouseType: WarehouseType;
  isDefault: boolean;
  isActive: boolean;
};

export type WarehouseInput = {
  name: string;
  warehouseType?: WarehouseType;
  locationId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
};

export type BinLocationRecord = {
  id: string;
  workspaceId: string;
  warehouseId: string;
  name: string;
};

const warehouseColumns = "id, workspace_id, location_id, name, warehouse_type, is_default, is_active, deleted_at";
const binLocationColumns = "id, workspace_id, warehouse_id, name";

export function toWarehouse(row: Record<string, unknown>): WarehouseRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    locationId: row.location_id ? String(row.location_id) : null,
    name: typeof row.name === "string" ? row.name : "",
    warehouseType: row.warehouse_type === "company" ? "company" : "location",
    isDefault: Boolean(row.is_default),
    isActive: row.is_active !== false,
  };
}

export function toBinLocation(row: Record<string, unknown>): BinLocationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    warehouseId: String(row.warehouse_id),
    name: typeof row.name === "string" ? row.name : "",
  };
}

function requireName(name: string | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) throw new Error(i18n.t("settings.warehouses.errors.nameRequired"));
  return trimmed;
}

function mapWarehouseWriteError(error: { code?: string; message?: string }) {
  if (isMissingTableError(error, "warehouses")) return new Error(i18n.t("settings.warehouses.errors.unavailable"));
  if (error.code === "42501") return new Error(i18n.t("settings.warehouses.errors.noPermission"));
  return new Error(error.message ?? i18n.t("common.somethingWentWrong"));
}

/** Clears `is_default` on every other live warehouse (partial unique index allows one default per workspace). */
async function clearOtherDefaults(workspaceId: string, exceptId?: string) {
  let query = supabase
    .from("warehouses")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .is("deleted_at", null);
  if (exceptId) query = query.neq("id", exceptId);
  const { error } = await query;
  if (error) throw mapWarehouseWriteError(error);
}

/** Lists warehouses; returns [] when the `warehouses` table has not been applied yet. */
export async function getWarehouses(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("warehouses")
    .select(warehouseColumns)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    if (isMissingTableError(error, "warehouses")) return [] as WarehouseRecord[];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toWarehouse);
}

export async function createWarehouse(input: WarehouseInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const name = requireName(input.name);
  const makeDefault = Boolean(input.isDefault);
  if (makeDefault) await clearOtherDefaults(resolved);

  const { data, error } = await supabase
    .from("warehouses")
    .insert({
      workspace_id: resolved,
      name,
      warehouse_type: input.warehouseType === "company" ? "company" : "location",
      location_id: input.locationId?.trim() ? input.locationId.trim() : null,
      is_default: makeDefault,
      is_active: input.isActive !== false,
    })
    .select(warehouseColumns)
    .single();

  if (error) throw mapWarehouseWriteError(error);
  return toWarehouse(data as Record<string, unknown>);
}

export async function updateWarehouse(id: string, input: WarehouseInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const name = requireName(input.name);
  const makeDefault = Boolean(input.isDefault);
  if (makeDefault) await clearOtherDefaults(resolved, id);

  const { data, error } = await supabase
    .from("warehouses")
    .update({
      name,
      warehouse_type: input.warehouseType === "company" ? "company" : "location",
      location_id: input.locationId?.trim() ? input.locationId.trim() : null,
      is_default: makeDefault,
      is_active: input.isActive !== false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .select(warehouseColumns)
    .single();

  if (error) throw mapWarehouseWriteError(error);
  return toWarehouse(data as Record<string, unknown>);
}

/** Soft-deletes a warehouse. Refuses when it is the workspace default or still holds stock. */
export async function softDeleteWarehouse(id: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data: existing, error: readError } = await supabase
    .from("warehouses")
    .select(warehouseColumns)
    .eq("id", id)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) throw mapWarehouseWriteError(readError);
  if (!existing) throw new Error(i18n.t("settings.warehouses.errors.notFound"));
  if (Boolean((existing as Record<string, unknown>).is_default)) {
    throw new Error(i18n.t("settings.warehouses.errors.cannotDeleteDefault"));
  }

  const { data: stockRows, error: stockError } = await supabase
    .from("warehouse_stock")
    .select("quantity")
    .eq("workspace_id", resolved)
    .eq("warehouse_id", id);

  if (stockError && !isMissingTableError(stockError, "warehouse_stock")) throw mapWarehouseWriteError(stockError);
  const stockQty = (stockRows ?? []).reduce((sum, row) => sum + (Number((row as { quantity?: unknown }).quantity) || 0), 0);
  if (stockQty > 0) {
    throw new Error(i18n.t("settings.warehouses.errors.cannotDeleteWithStock"));
  }

  const { error } = await supabase
    .from("warehouses")
    .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", resolved)
    .is("deleted_at", null);

  if (error) throw mapWarehouseWriteError(error);
}

export async function setDefaultWarehouse(id: string, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  await clearOtherDefaults(resolved, id);
  const { data, error } = await supabase
    .from("warehouses")
    .update({ is_default: true, is_active: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .select(warehouseColumns)
    .single();

  if (error) throw mapWarehouseWriteError(error);
  return toWarehouse(data as Record<string, unknown>);
}

/** Lists bin locations (optionally for one warehouse); returns [] when the table is missing. */
export async function getBinLocations(workspaceId: string | undefined, warehouseId?: string) {
  const resolved = requireWorkspaceId(workspaceId);
  let query = supabase
    .from("bin_locations")
    .select(binLocationColumns)
    .eq("workspace_id", resolved)
    .order("name", { ascending: true });
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error, "bin_locations")) return [] as BinLocationRecord[];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toBinLocation);
}
