import type { InventoryItem, InventoryItemFormData, InventoryListFilter, InventorySort, InventorySortField } from "../lib/types";
import { DEFAULT_INVENTORY_MIN_QUANTITY } from "../features/inventory/inventoryDefaults";
import { stockStatusFromQuantities } from "../features/inventory/stockStatus";
import i18n from "../i18n";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";

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
  if (error.code === "23505") return new Error(i18n.t("inventory.errors.duplicateSku"));
  if (error.code === "42501" || error.message?.toLowerCase().includes("row-level security")) return new Error(i18n.t("inventory.errors.permission"));
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
  };
}

function resolveMinQuantity(value: number | null | undefined) {
  // Explicit 0 is valid (alerts only at empty stock). Only fill when omitted/invalid.
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_INVENTORY_MIN_QUANTITY;
}

function itemPayload(input: InventoryItemFormData) {
  const sku = input.sku.trim();

  return {
    name: input.name.trim(),
    sku: sku || null,
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    quantity: input.quantity,
    min_quantity: resolveMinQuantity(input.minQuantity),
    unit: input.unit.trim(),
    purchase_price: input.purchasePrice,
    selling_price: input.sellingPrice,
    supplier: input.supplier.trim() || null,
    location: input.location.trim() || null,
    is_active: input.isActive,
  };
}

export async function getInventoryItems(search: string | undefined, filter: InventoryListFilter, sort: InventorySort, workspaceId: string | undefined) {
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

  const { data, error } = await query;

  if (error) throw inventoryError(error, i18n.t("inventory.errors.loadFailed"));

  return ((data ?? []) as Record<string, unknown>[]).map(toInventoryItem);
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

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      workspace_id: resolvedWorkspaceId,
      ...itemPayload(input),
    })
    .select("id")
    .maybeSingle();

  if (error) throw inventoryError(error, i18n.t("inventory.errors.saveFailed"));
  if (!data || typeof (data as { id?: unknown }).id !== "string") throw new Error(i18n.t("inventory.errors.saveFailed"));

  // Re-read from the status view so callers get quantity-consistent stockStatus.
  const created = await getInventoryItem((data as { id: string }).id, resolvedWorkspaceId);
  if (!created) throw new Error(i18n.t("inventory.errors.saveFailed"));
  return created;
}

export async function updateInventoryItem({ id, ...input }: InventoryItemFormData & { id: string }, workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  const { data, error } = await supabase
    .from("inventory_items")
    .update({
      ...itemPayload(input),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", resolvedWorkspaceId)
    .select("id")
    .maybeSingle();

  if (error) throw inventoryError(error, i18n.t("inventory.errors.saveFailed"));
  if (!data) throw new Error(i18n.t("inventory.errors.updateNotFound"));

  // Re-read from the status view so stockStatus matches the committed quantity.
  const updated = await getInventoryItem(id, resolvedWorkspaceId);
  if (!updated) throw new Error(i18n.t("inventory.errors.updateNotFound"));
  return updated;
}

export async function deleteInventoryItem(inventoryItemId: string, workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  const { data, error } = await supabase.from("inventory_items").delete().eq("id", inventoryItemId).eq("workspace_id", resolvedWorkspaceId).select("id");

  if (error) throw inventoryError(error, i18n.t("inventory.errors.deleteFailed"));
  if (!data?.length) throw new Error(i18n.t("inventory.errors.deleteNotFound"));
}
