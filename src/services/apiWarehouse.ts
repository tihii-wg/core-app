import type { InventoryMovement, InventoryMovementType, WarehouseMaterialLineInput } from "../lib/types";
import i18n from "../i18n";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";
import supabase from "./supabase";

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function warehouseError(error: { message?: string; code?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  const code = error?.code ?? "";
  if (message.includes("insufficient_warehouse_stock")) return i18n.t("orders.errors.insufficientWarehouseStock");
  if (message.includes("insufficient_batch_stock")) return i18n.t("orders.errors.insufficientWarehouseStock");
  if (message.includes("insufficient_stock")) return i18n.t("orders.errors.insufficientStock");
  if (message.includes("warehouse_stock table is missing")) return i18n.t("orders.errors.warehouseStockMissing");
  if (message.includes("Warehouse not found")) return i18n.t("orders.errors.warehouseInvalid");
  if (message.includes("remaining requested")) return i18n.t("orders.errors.issueExceedsRemaining");
  if (message.includes("outstanding issued")) return i18n.t("orders.errors.returnExceedsOutstanding");
  if (
    code === "42501" ||
    /row-level security|permission denied/i.test(message) ||
    message.includes("permission to issue") ||
    message.includes("permission to return")
  ) {
    return i18n.t("orders.errors.warehousePermission");
  }
  if (message.includes("not on this order") || message.includes("unavailable")) {
    return i18n.t("orders.errors.invalidMaterial");
  }
  if (message.includes("Idempotency key was already used")) return message;
  if (message.includes("Duplicate inventory_item_id")) return message;
  return message || fallback;
}

type MovementRow = {
  id?: string;
  workspace_id?: string;
  inventory_item_id?: string;
  order_id?: string | null;
  order_material_id?: string | null;
  warehouse_id?: string | null;
  movement_type?: string;
  document_type?: string | null;
  quantity?: number;
  reason?: string | null;
  created_by?: string | null;
  created_at?: string;
};

const movementTypes = new Set<InventoryMovementType>(["issue", "return", "adjustment"]);

const movementColumnsWithWarehouse =
  "id, workspace_id, inventory_item_id, order_id, order_material_id, warehouse_id, movement_type, document_type, quantity, reason, created_by, created_at";
const movementColumnsWithWarehouseNoDoc =
  "id, workspace_id, inventory_item_id, order_id, order_material_id, warehouse_id, movement_type, quantity, reason, created_by, created_at";
const movementColumnsLegacy =
  "id, workspace_id, inventory_item_id, order_id, order_material_id, movement_type, quantity, reason, created_by, created_at";

export function toInventoryMovement(row: MovementRow): InventoryMovement {
  const movementType = movementTypes.has(row.movement_type as InventoryMovementType) ? (row.movement_type as InventoryMovementType) : "adjustment";
  const documentType =
    typeof row.document_type === "string" && row.document_type.trim() ? row.document_type.trim() : null;
  return {
    id: String(row.id ?? ""),
    workspaceId: String(row.workspace_id ?? ""),
    inventoryItemId: String(row.inventory_item_id ?? ""),
    orderId: row.order_id ? String(row.order_id) : null,
    orderMaterialId: row.order_material_id ? String(row.order_material_id) : null,
    warehouseId: row.warehouse_id ? String(row.warehouse_id) : null,
    movementType,
    documentType,
    quantity: Number(row.quantity ?? 0),
    reason: typeof row.reason === "string" ? row.reason : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function linePayload(lines: WarehouseMaterialLineInput[]) {
  return lines.map((line) => ({
    inventory_item_id: line.inventoryItemId,
    quantity: line.quantity,
  }));
}

async function assertWarehouseClosedOrderMutable(orderId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("workspace_id, status, closed_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("orders.errors.warehousePermission"));
  const workspaceId = typeof (data as { workspace_id?: unknown }).workspace_id === "string"
    ? (data as { workspace_id: string }).workspace_id
    : "";
  if (!workspaceId) throw new Error(i18n.t("orders.errors.warehousePermission"));
  const { assertClosedOrderMutableOnServer } = await import("./apiOrders");
  await assertClosedOrderMutableOnServer(orderId, workspaceId);
}

export async function issueOrderMaterials(orderId: string, lines: WarehouseMaterialLineInput[], idempotencyKey?: string) {
  await assertWarehouseClosedOrderMutable(orderId);
  const { data, error } = await supabase.rpc("issue_order_materials", {
    p_order_id: orderId,
    p_lines: linePayload(lines),
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) throw new Error(warehouseError(error, i18n.t("orders.errors.issueFailed")));
  return ((data ?? []) as MovementRow[]).map(toInventoryMovement);
}

export const ISSUE_FROM_WAREHOUSE_RPC = "issue_order_materials_from_warehouse";

/**
 * Issues materials AND decreases `warehouse_stock` of the chosen warehouse (manual SQL
 * 20261101080000_issue_order_materials_warehouse). Throws `MissingRpcError` when that SQL is not
 * applied — callers that selected a warehouse must NOT fall back to global-only issue.
 */
export async function issueOrderMaterialsFromWarehouse(
  orderId: string,
  lines: WarehouseMaterialLineInput[],
  warehouseId: string,
  idempotencyKey?: string,
) {
  await assertWarehouseClosedOrderMutable(orderId);
  const { data, error } = await supabase.rpc(ISSUE_FROM_WAREHOUSE_RPC, {
    p_order_id: orderId,
    p_lines: linePayload(lines),
    p_warehouse_id: warehouseId,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) {
    if (isMissingRpcError(error, ISSUE_FROM_WAREHOUSE_RPC)) {
      throw new MissingRpcError(ISSUE_FROM_WAREHOUSE_RPC, i18n.t("orders.errors.issueFromWarehouseRpcMissing"));
    }
    throw new Error(warehouseError(error, i18n.t("orders.errors.issueFailed")));
  }
  return ((data ?? []) as MovementRow[]).map(toInventoryMovement);
}

export async function returnOrderMaterials(orderId: string, lines: WarehouseMaterialLineInput[], reason?: string, idempotencyKey?: string) {
  await assertWarehouseClosedOrderMutable(orderId);
  const { data, error } = await supabase.rpc("return_order_materials", {
    p_order_id: orderId,
    p_lines: linePayload(lines),
    p_reason: reason?.trim() || null,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) throw new Error(warehouseError(error, i18n.t("orders.errors.returnFailed")));
  return ((data ?? []) as MovementRow[]).map(toInventoryMovement);
}

export const RETURN_TO_WAREHOUSE_RPC = "return_order_materials_to_warehouse";

/**
 * Returns materials AND increases `warehouse_stock` of the chosen warehouse (manual SQL
 * 20261101100000_return_order_materials_warehouse). Throws `MissingRpcError` when that SQL is not
 * applied — callers that selected a warehouse must NOT fall back to global-only return.
 */
export async function returnOrderMaterialsToWarehouse(
  orderId: string,
  lines: WarehouseMaterialLineInput[],
  warehouseId: string,
  reason?: string,
  idempotencyKey?: string,
) {
  await assertWarehouseClosedOrderMutable(orderId);
  const { data, error } = await supabase.rpc(RETURN_TO_WAREHOUSE_RPC, {
    p_order_id: orderId,
    p_lines: linePayload(lines),
    p_warehouse_id: warehouseId,
    p_reason: reason?.trim() || null,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) {
    if (isMissingRpcError(error, RETURN_TO_WAREHOUSE_RPC)) {
      throw new MissingRpcError(RETURN_TO_WAREHOUSE_RPC, i18n.t("orders.errors.returnToWarehouseRpcMissing"));
    }
    throw new Error(warehouseError(error, i18n.t("orders.errors.returnFailed")));
  }
  return ((data ?? []) as MovementRow[]).map(toInventoryMovement);
}

function isMissingWarehouseIdColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = error.message ?? "";
  return /warehouse_id/i.test(message) && (/column/i.test(message) || error.code === "42703" || error.code === "PGRST204");
}

function isMissingDocumentTypeColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = error.message ?? "";
  return /document_type/i.test(message) && (/column/i.test(message) || error.code === "42703" || error.code === "PGRST204");
}

export async function getInventoryMovements(workspaceId: string | undefined, options?: { inventoryItemId?: string; orderId?: string; limit?: number }) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  async function run(columns: string) {
    let query = supabase
      .from("inventory_movements")
      .select(columns)
      .eq("workspace_id", resolvedWorkspaceId)
      .order("created_at", { ascending: false });

    if (options?.inventoryItemId) query = query.eq("inventory_item_id", options.inventoryItemId);
    if (options?.orderId) query = query.eq("order_id", options.orderId);
    if (options?.limit) query = query.limit(options.limit);
    return query;
  }

  const primary = await run(movementColumnsWithWarehouse);
  if (!primary.error) {
    return ((primary.data ?? []) as MovementRow[]).map(toInventoryMovement);
  }
  if (isMissingDocumentTypeColumn(primary.error)) {
    const withoutDoc = await run(movementColumnsWithWarehouseNoDoc);
    if (!withoutDoc.error) {
      return ((withoutDoc.data ?? []) as MovementRow[]).map(toInventoryMovement);
    }
    if (!isMissingWarehouseIdColumn(withoutDoc.error)) {
      throw new Error(withoutDoc.error.message || i18n.t("inventory.errors.loadFailed"));
    }
  } else if (!isMissingWarehouseIdColumn(primary.error)) {
    throw new Error(primary.error.message || i18n.t("inventory.errors.loadFailed"));
  }

  const fallback = await run(movementColumnsLegacy);
  if (fallback.error) throw new Error(fallback.error.message || i18n.t("inventory.errors.loadFailed"));
  return ((fallback.data ?? []) as MovementRow[]).map(toInventoryMovement);
}
