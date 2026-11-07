import type { InventoryItem, InventoryItemFormData, InventoryListFilter, InventorySort, InventorySortField } from "../lib/types";
import { DEFAULT_INVENTORY_MIN_QUANTITY } from "../features/inventory/inventoryDefaults";
import { stockStatusFromQuantities } from "../features/inventory/stockStatus";
import {
  catalogWarrantyFromDbRow,
  catalogWarrantyToDbPayload,
  normalizeCatalogWarrantyDefaults,
} from "../features/orders/catalogWarranty";
import i18n from "../i18n";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";

const PREVIEW_RPC = "crm_inventory_item_delete_preview";
const PURGE_RPC = "crm_purge_inventory_item";

export type InventoryItemDeleteBlockingOrder = {
  orderId: string;
  number: string;
  status: string;
};

export type InventoryItemDeletePreview = {
  itemId: string;
  itemName: string;
  isOwner: boolean;
  canDelete: boolean;
  blockingOrders: InventoryItemDeleteBlockingOrder[];
  cancelledOrdersCount: number;
  stockQuantity: number;
  movementsCount: number;
  stockRowsCount: number;
  batchesCount: number;
  serialsCount: number;
  reservationsCount: number;
  draftDocumentLinesCount: number;
  postedDocumentLinesCount: number;
};

export type PurgeInventoryItemResult = {
  itemId: string;
  deleted: true;
  detachedCancelledOrderLines: number;
  deletedMovements: number;
  deletedStockRows: number;
  deletedDraftDocumentLines: number;
};

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
  } else if (filter === "active") {
    // Inventory page default: active parts only.
    query = query.eq("is_active", true);
  } else if (filter !== "all") {
    // Stock-status filters: active parts only. "all" keeps every part (orders, warehouses, reports need inactive ones too).
    query = query.eq("is_active", true).eq("stock_status", filter);
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

function countValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function mapBlockingOrders(value: unknown): InventoryItemDeleteBlockingOrder[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const orderId = textValue(record.order_id);
    const number = textValue(record.number);
    if (!orderId || !number) return [];
    return [{ orderId, number, status: textValue(record.status) }];
  });
}

/** @internal test helper — maps preview RPC jsonb to camelCase. */
export function toInventoryItemDeletePreview(payload: Record<string, unknown>): InventoryItemDeletePreview {
  return {
    itemId: textValue(payload.item_id),
    itemName: textValue(payload.item_name),
    isOwner: payload.is_owner === true,
    canDelete: payload.can_delete === true,
    blockingOrders: mapBlockingOrders(payload.blocking_orders),
    cancelledOrdersCount: countValue(payload.cancelled_orders_count),
    stockQuantity: countValue(payload.stock_quantity),
    movementsCount: countValue(payload.movements_count),
    stockRowsCount: countValue(payload.stock_rows_count),
    batchesCount: countValue(payload.batches_count),
    serialsCount: countValue(payload.serials_count),
    reservationsCount: countValue(payload.reservations_count),
    draftDocumentLinesCount: countValue(payload.draft_document_lines_count),
    postedDocumentLinesCount: countValue(payload.posted_document_lines_count),
  };
}

/** @internal test helper — maps purge RPC jsonb to camelCase. */
export function toPurgeInventoryItemResult(payload: Record<string, unknown>): PurgeInventoryItemResult {
  return {
    itemId: textValue(payload.item_id),
    deleted: true,
    detachedCancelledOrderLines: countValue(payload.detached_cancelled_order_lines),
    deletedMovements: countValue(payload.deleted_movements),
    deletedStockRows: countValue(payload.deleted_stock_rows),
    deletedDraftDocumentLines: countValue(payload.deleted_draft_document_lines),
  };
}

type RpcLikeError = { code?: string; message?: string; details?: string | null };

function purgeInventoryError(error: RpcLikeError): Error {
  const message = error.message ?? "";
  if (/inventory_item_purge:used_in_orders/i.test(message)) {
    const orders = typeof error.details === "string" ? error.details : "";
    return new Error(i18n.t("inventory.purge.errors.usedInOrders", { orders }));
  }
  if (/inventory_item_purge:owner_only/i.test(message)) {
    return new Error(i18n.t("inventory.purge.errors.ownerOnly"));
  }
  if (/inventory_item_purge:not_found/i.test(message)) {
    return new Error(i18n.t("inventory.errors.deleteNotFound"));
  }
  if (/inventory_item_purge:not_authenticated|inventory_item_purge:not_member/i.test(message)) {
    return new Error(i18n.t("inventory.errors.permission"));
  }
  return new Error(message || i18n.t("inventory.errors.deleteFailed"));
}

export async function getInventoryItemDeletePreview(
  itemId: string,
  workspaceId: string | undefined,
): Promise<InventoryItemDeletePreview> {
  requireWorkspaceId(workspaceId);
  const id = itemId.trim();
  if (!id) throw new Error(i18n.t("inventory.errors.deleteNotFound"));

  const { data, error } = await supabase.rpc(PREVIEW_RPC, { p_item_id: id });
  if (error) {
    if (isMissingRpcError(error, PREVIEW_RPC)) {
      throw new MissingRpcError(PREVIEW_RPC, i18n.t("inventory.errors.deleteFailed"));
    }
    throw purgeInventoryError(error);
  }
  if (!data || typeof data !== "object") {
    throw new Error(i18n.t("inventory.errors.deleteFailed"));
  }
  return toInventoryItemDeletePreview(data as Record<string, unknown>);
}

export async function purgeInventoryItem(
  itemId: string,
  workspaceId: string | undefined,
): Promise<PurgeInventoryItemResult> {
  requireWorkspaceId(workspaceId);
  const id = itemId.trim();
  if (!id) throw new Error(i18n.t("inventory.errors.deleteNotFound"));

  const { data, error } = await supabase.rpc(PURGE_RPC, { p_item_id: id });
  if (error) {
    if (isMissingRpcError(error, PURGE_RPC)) {
      throw new MissingRpcError(PURGE_RPC, i18n.t("inventory.errors.deleteFailed"));
    }
    throw purgeInventoryError(error);
  }
  if (!data || typeof data !== "object") {
    throw new Error(i18n.t("inventory.errors.deleteFailed"));
  }
  return toPurgeInventoryItemResult(data as Record<string, unknown>);
}
