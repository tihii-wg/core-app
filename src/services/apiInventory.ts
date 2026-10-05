import type { InventoryItem, InventoryItemFormData, InventoryListFilter, InventorySort, InventorySortField, InventoryStockStatus } from "../lib/types";
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

const stockStatuses = new Set<InventoryStockStatus>(["in_stock", "low_stock", "out_of_stock"]);

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

function stockStatusFromQuantities(quantity: number, minQuantity: number): InventoryStockStatus {
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= minQuantity) return "low_stock";
  return "in_stock";
}

export function toInventoryItem(row: Record<string, unknown>): InventoryItem {
  const quantity = numberValue(row.quantity);
  const minQuantity = numberValue(row.min_quantity);
  const stockStatus = stockStatuses.has(row.stock_status as InventoryStockStatus) ? (row.stock_status as InventoryStockStatus) : stockStatusFromQuantities(quantity, minQuantity);

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

function itemPayload(input: InventoryItemFormData) {
  const sku = input.sku.trim();

  return {
    name: input.name.trim(),
    sku: sku || null,
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    quantity: input.quantity,
    min_quantity: input.minQuantity,
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
    .select("*")
    .maybeSingle();

  if (error) throw inventoryError(error, i18n.t("inventory.errors.saveFailed"));
  if (!data) throw new Error(i18n.t("inventory.errors.saveFailed"));

  return toInventoryItem(data as Record<string, unknown>);
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
    .select("*")
    .maybeSingle();

  if (error) throw inventoryError(error, i18n.t("inventory.errors.saveFailed"));
  if (!data) throw new Error(i18n.t("inventory.errors.updateNotFound"));

  return toInventoryItem(data as Record<string, unknown>);
}

export async function deleteInventoryItem(inventoryItemId: string, workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  const { data, error } = await supabase.from("inventory_items").delete().eq("id", inventoryItemId).eq("workspace_id", resolvedWorkspaceId).select("id");

  if (error) throw inventoryError(error, i18n.t("inventory.errors.deleteFailed"));
  if (!data?.length) throw new Error(i18n.t("inventory.errors.deleteNotFound"));
}
