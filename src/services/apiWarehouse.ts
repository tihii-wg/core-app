import type { InventoryMovement, InventoryMovementType, WarehouseMaterialLineInput } from "../lib/types";
import i18n from "../i18n";
import supabase from "./supabase";

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function warehouseError(error: { message?: string; code?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  if (message.includes("insufficient_stock")) return i18n.t("orders.errors.insufficientStock");
  if (message.includes("remaining requested")) return i18n.t("orders.errors.issueExceedsRemaining");
  if (message.includes("outstanding issued")) return i18n.t("orders.errors.returnExceedsOutstanding");
  if (message.includes("permission to issue") || message.includes("permission to return")) {
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
  movement_type?: string;
  quantity?: number;
  reason?: string | null;
  created_by?: string | null;
  created_at?: string;
};

const movementTypes = new Set<InventoryMovementType>(["issue", "return", "adjustment"]);

export function toInventoryMovement(row: MovementRow): InventoryMovement {
  const movementType = movementTypes.has(row.movement_type as InventoryMovementType) ? (row.movement_type as InventoryMovementType) : "adjustment";
  return {
    id: String(row.id ?? ""),
    workspaceId: String(row.workspace_id ?? ""),
    inventoryItemId: String(row.inventory_item_id ?? ""),
    orderId: row.order_id ? String(row.order_id) : null,
    orderMaterialId: row.order_material_id ? String(row.order_material_id) : null,
    movementType,
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

export async function issueOrderMaterials(orderId: string, lines: WarehouseMaterialLineInput[], idempotencyKey?: string) {
  const { data, error } = await supabase.rpc("issue_order_materials", {
    p_order_id: orderId,
    p_lines: linePayload(lines),
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) throw new Error(warehouseError(error, i18n.t("orders.errors.issueFailed")));
  return ((data ?? []) as MovementRow[]).map(toInventoryMovement);
}

export async function returnOrderMaterials(orderId: string, lines: WarehouseMaterialLineInput[], reason?: string, idempotencyKey?: string) {
  const { data, error } = await supabase.rpc("return_order_materials", {
    p_order_id: orderId,
    p_lines: linePayload(lines),
    p_reason: reason?.trim() || null,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) throw new Error(warehouseError(error, i18n.t("orders.errors.returnFailed")));
  return ((data ?? []) as MovementRow[]).map(toInventoryMovement);
}

export async function getInventoryMovements(workspaceId: string | undefined, options?: { inventoryItemId?: string; orderId?: string; limit?: number }) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);
  let query = supabase
    .from("inventory_movements")
    .select("id, workspace_id, inventory_item_id, order_id, order_material_id, movement_type, quantity, reason, created_by, created_at")
    .eq("workspace_id", resolvedWorkspaceId)
    .order("created_at", { ascending: false });

  if (options?.inventoryItemId) query = query.eq("inventory_item_id", options.inventoryItemId);
  if (options?.orderId) query = query.eq("order_id", options.orderId);
  if (options?.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message || i18n.t("inventory.errors.loadFailed"));
  return ((data ?? []) as MovementRow[]).map(toInventoryMovement);
}
