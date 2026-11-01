import i18n from "../i18n";
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

export type BinLocationRecord = {
  id: string;
  workspaceId: string;
  warehouseId: string;
  name: string;
};

const warehouseColumns = "id, workspace_id, location_id, name, warehouse_type, is_default, is_active, deleted_at";
const binLocationColumns = "id, workspace_id, warehouse_id, name";

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

/** Tables from Appendix A may not exist yet (PGRST205 = not in schema cache, 42P01 = undefined_table). */
export function isMissingTableError(error: { code?: string } | null) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

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
    if (isMissingTableError(error)) return [] as WarehouseRecord[];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toWarehouse);
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
    if (isMissingTableError(error)) return [] as BinLocationRecord[];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toBinLocation);
}
