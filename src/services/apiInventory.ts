import type { InventoryItem, InventoryItemFormData, InventoryListFilter, InventorySort, InventorySortField } from "../lib/types";
import { DEFAULT_INVENTORY_MIN_QUANTITY } from "../features/inventory/inventoryDefaults";
import { stockStatusFromQuantities } from "../features/inventory/stockStatus";
import {
  catalogWarrantyFromDbRow,
  catalogWarrantyToDbPayload,
  normalizeCatalogWarrantyDefaults,
} from "../features/orders/catalogWarranty";
import i18n from "../i18n";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";

let catalogWarrantyColumnsSupported: boolean | null = null;

function isMissingCatalogWarrantyColumn(error: { code?: string; message?: string }) {
  return (
    (/warranty_type|warranty_months|warranty_km/i.test(error.message ?? "") &&
      (error.code === "42703" || error.code === "PGRST204")) ||
    false
  );
}

function warrantyPayloadFromForm(input: Pick<InventoryItemFormData, "warrantyType" | "warrantyMonths" | "warrantyKm">) {
  if (input.warrantyType === undefined && input.warrantyMonths === undefined && input.warrantyKm === undefined) {
    return null;
  }
  try {
    return catalogWarrantyToDbPayload(
      normalizeCatalogWarrantyDefaults({
        warrantyType: input.warrantyType ?? "none",
        warrantyMonths: input.warrantyMonths,
        warrantyKm: input.warrantyKm,
      }),
    );
  } catch {
    throw new Error(i18n.t("catalogWarranty.errors.incomplete"));
  }
}

const inventorySortColumns: Record<InventorySortField, string> = {
  name: "name",
  sku: "sku",
  quantity: "quantity",
  purchase_price: "purchase_price",
  selling_price: "selling_price",
  created_at: "created_at",
  updated_at: "updated_at",
};

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function inventoryError(error: { code?: string; message?: string }, fallback: string) {
  const message = error.message ?? "";
  if (error.code === "23505") return new Error(i18n.t("inventory.errors.duplicateSku"));
  if (/inventory_item_delete:has_movements|inventory_movements_inventory_item_id_fkey/i.test(message)) {
    return new Error(i18n.t("inventory.errors.deleteHasMovements"));
  }
  if (/inventory_item_delete:has_order_materials|order_materials_inventory_item_id_fkey/i.test(message)) {
    return new Error(i18n.t("inventory.errors.deleteHasOrderMaterials"));
  }
  if (/inventory_item_delete:has_serial_history/i.test(message)) {
    return new Error(i18n.t("inventory.errors.deleteHasSerialHistory"));
  }
  if (error.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return new Error(i18n.t("inventory.errors.permission"));
  }
  return new Error(fallback);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toInventoryItem(row: Record<string, unknown>): InventoryItem {
  const quantity = numberValue(row.quantity);
  const minQuantity = numberValue(row.min_quantity);
  // Always derive from quantity + min_quantity so status cannot drift from stock
  // (e.g. base-table selects without stock_status, or a stale stock_status field).
  // Matches public.inventory_items_with_status CASE expression.
  const stockStatus = stockStatusFromQuantities(quantity, minQuantity);

  const warranty = catalogWarrantyFromDbRow(row);

  return {
    id: textValue(row.id),
    workspaceId: textValue(row.workspace_id),
    name: textValue(row.name),
    sku: textValue(row.sku),
    description: textValue(row.description),
    category: textValue(row.category),
    quantity,
    minQuantity,
    unit: textValue(row.unit),
    purchasePrice: optionalNumber(row.purchase_price),
    sellingPrice: optionalNumber(row.selling_price),
    supplier: textValue(row.supplier),
    location: textValue(row.location),
    isActive: row.is_active !== false,
    stockStatus,
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
    warrantyType: warranty.warrantyType,
    warrantyMonths: warranty.warrantyMonths,
    warrantyKm: warranty.warrantyKm,
  };
}

function resolveMinQuantity(value: number | null | undefined) {
  // Explicit 0 is valid (alerts only at empty stock). Only fill when omitted/invalid.
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_INVENTORY_MIN_QUANTITY;
}

function itemPayload(input: InventoryItemFormData, options?: { includeQuantity?: boolean; includeWarranty?: boolean }) {
  const sku = input.sku.trim();
  const warranty = options?.includeWarranty === false ? null : warrantyPayloadFromForm(input);

  return {
    name: input.name.trim(),
    sku: sku || null,
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    // Quantity is warehouse-owned. Create always forces 0; updates never send quantity.
    ...(options?.includeQuantity ? { quantity: input.quantity } : {}),
    min_quantity: resolveMinQuantity(input.minQuantity),
    unit: input.unit.trim(),
    purchase_price: input.purchasePrice,
    selling_price: input.sellingPrice,
    supplier: input.supplier.trim() || null,
    location: input.location.trim() || null,
    is_active: input.isActive,
    ...(warranty && catalogWarrantyColumnsSupported !== false ? warranty : {}),
  };
}

export function distinctSupplierNames(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const name = typeof value === "string" ? value.trim() : "";
    if (name) seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export async function getInventoryItems(search: string | undefined, filter: InventoryListFilter, sort: InventorySort, workspaceId: string | undefined, supplier?: string) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);
  const column = inventorySortColumns[sort.field] ?? "created_at";

  let query = supabase.from("inventory_items_with_status").select("*").eq("workspace_id", resolvedWorkspaceId).order(column, { ascending: sort.ascending });

  const term = searchTerm(search);
  if (term) {
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,category.ilike.%${term}%,supplier.ilike.%${term}%,location.ilike.%${term}%,description.ilike.%${term}%`);
  }

  if (filter === "inactive") {
    query = query.eq("is_active", false);
  } else if (filter !== "all") {
    query = query.eq("stock_status", filter);
  }

  const supplierName = supplier?.trim();
  if (supplierName && supplierName !== "all") {
    query = query.eq("supplier", supplierName);
  }

  const { data, error } = await query;

  if (error) throw inventoryError(error, i18n.t("inventory.errors.loadFailed"));

  return ((data ?? []) as Record<string, unknown>[]).map(toInventoryItem);
}

/** Distinct non-empty supplier names used by parts in the workspace (filter options). */
export async function getInventorySuppliers(workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  const { data, error } = await supabase
    .from("inventory_items_with_status")
    .select("supplier")
    .eq("workspace_id", resolvedWorkspaceId)
    .not("supplier", "is", null);

  if (error) throw inventoryError(error, i18n.t("inventory.errors.loadFailed"));

  return distinctSupplierNames(((data ?? []) as { supplier?: unknown }[]).map((row) => (typeof row.supplier === "string" ? row.supplier : null)));
}

export async function getInventoryItem(inventoryItemId: string, targetWorkspaceId: string | undefined) {
  const workspaceId = requireWorkspaceId(targetWorkspaceId);

  const { data, error } = await supabase.from("inventory_items_with_status").select("*").eq("id", inventoryItemId).eq("workspace_id", workspaceId).maybeSingle();

  if (error) throw inventoryError(error, i18n.t("inventory.errors.loadFailed"));
  if (!data) return null;

  return toInventoryItem(data as Record<string, unknown>);
}

export async function createInventoryItem(input: InventoryItemFormData, workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  // Catalog cards never create stock. Quantity always starts at 0; goods receipt (or
  // other warehouse ops) is the only path that increases inventory_items.quantity.
  const payload = {
    workspace_id: resolvedWorkspaceId,
    ...itemPayload({ ...input, quantity: 0 }, { includeQuantity: true }),
    quantity: 0,
  };

  let { data, error } = await supabase.from("inventory_items").insert(payload).select("id").maybeSingle();

  if (error && isMissingCatalogWarrantyColumn(error)) {
    catalogWarrantyColumnsSupported = false;
    ({ data, error } = await supabase
      .from("inventory_items")
      .insert({
        workspace_id: resolvedWorkspaceId,
        ...itemPayload({ ...input, quantity: 0 }, { includeQuantity: true, includeWarranty: false }),
        quantity: 0,
      })
      .select("id")
      .maybeSingle());
  } else if (error == null && "warranty_type" in payload && catalogWarrantyColumnsSupported == null) {
    catalogWarrantyColumnsSupported = true;
  }

  if (error) throw inventoryError(error, i18n.t("inventory.errors.saveFailed"));
  if (!data || typeof (data as { id?: unknown }).id !== "string") throw new Error(i18n.t("inventory.errors.saveFailed"));

  // Re-read from the status view so callers get quantity-consistent stockStatus.
  const created = await getInventoryItem((data as { id: string }).id, resolvedWorkspaceId);
  if (!created) throw new Error(i18n.t("inventory.errors.saveFailed"));
  return created;
}

export async function updateInventoryItem({ id, ...input }: InventoryItemFormData & { id: string }, workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  // Never write quantity from the catalog form — warehouse documents own stock.
  const payload = {
    ...itemPayload(input, { includeQuantity: false }),
    updated_at: new Date().toISOString(),
  };

  let { data, error } = await supabase
    .from("inventory_items")
    .update(payload)
    .eq("id", id)
    .eq("workspace_id", resolvedWorkspaceId)
    .select("id")
    .maybeSingle();

  if (error && isMissingCatalogWarrantyColumn(error)) {
    catalogWarrantyColumnsSupported = false;
    ({ data, error } = await supabase
      .from("inventory_items")
      .update({
        ...itemPayload(input, { includeQuantity: false, includeWarranty: false }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("workspace_id", resolvedWorkspaceId)
      .select("id")
      .maybeSingle());
  } else if (error == null && "warranty_type" in payload && catalogWarrantyColumnsSupported == null) {
    catalogWarrantyColumnsSupported = true;
  }

  if (error) throw inventoryError(error, i18n.t("inventory.errors.saveFailed"));
  if (!data) throw new Error(i18n.t("inventory.errors.updateNotFound"));

  // Re-read from the status view so stockStatus matches the committed quantity.
  const updated = await getInventoryItem(id, resolvedWorkspaceId);
  if (!updated) throw new Error(i18n.t("inventory.errors.updateNotFound"));
  return updated;
}

/** @internal test helper */
export function __resetCatalogWarrantyColumnCacheForTests() {
  catalogWarrantyColumnsSupported = null;
}

export async function deleteInventoryItem(inventoryItemId: string, workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  const { data, error } = await supabase.from("inventory_items").delete().eq("id", inventoryItemId).eq("workspace_id", resolvedWorkspaceId).select("id");

  if (error) throw inventoryError(error, i18n.t("inventory.errors.deleteFailed"));
  if (!data?.length) throw new Error(i18n.t("inventory.errors.deleteNotFound"));
}
