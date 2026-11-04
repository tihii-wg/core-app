/**
 * Warehouse-aware immediate issue/return for order catalog materials.
 *
 * Preferred atomic RPC (requires manual SQL apply — see
 * supabase/manual/20261103220000_add_and_issue_order_catalog_material.PRODUCTION.sql):
 *   add_and_issue_order_catalog_material(...)
 *   set_order_catalog_material_quantity_with_issue(...)
 *
 * Until those RPCs exist on MAIN, callers receive MissingRpcError with apply instructions.
 * Legacy global issue/return RPCs are intentionally not used here.
 */
import i18n from "../i18n";
import type { InventoryMovement, OrderMaterial } from "../lib/types";
import { isMissingRpcError, MissingRpcError } from "./missingRpc";
import supabase from "./supabase";

export const ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC = "add_and_issue_order_catalog_material";
export const SET_ORDER_CATALOG_MATERIAL_QUANTITY_WITH_ISSUE_RPC = "set_order_catalog_material_quantity_with_issue";

export type AddAndIssueOrderCatalogMaterialInput = {
  orderId: string;
  warehouseId: string;
  inventoryItemId: string;
  quantity: number;
  /** Optional selling price snapshot; server may default to inventory_items.selling_price. */
  price?: number | null;
  idempotencyKey: string;
};

export type SetOrderCatalogMaterialQuantityWithIssueInput = {
  orderId: string;
  orderMaterialId: string;
  warehouseId: string;
  quantity: number;
  idempotencyKey: string;
};

type RpcMaterialRow = {
  id?: unknown;
  order_id?: unknown;
  inventory_item_id?: unknown;
  item_name?: unknown;
  price?: unknown;
  quantity?: unknown;
  quantity_issued?: unknown;
  quantity_returned?: unknown;
  supply_source?: unknown;
  warehouse_id?: unknown;
};

function mapOrderMaterial(row: RpcMaterialRow): OrderMaterial {
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    inventoryItemId: typeof row.inventory_item_id === "string" ? row.inventory_item_id : undefined,
    itemName: String(row.item_name ?? ""),
    price: Number(row.price ?? 0),
    quantity: Number(row.quantity ?? 1),
    quantityIssued: Number(row.quantity_issued ?? 0),
    quantityReturned: Number(row.quantity_returned ?? 0),
    supplySource: row.supply_source === "customer" || row.supply_source === "one_time" ? row.supply_source : "catalog",
    warehouseId: typeof row.warehouse_id === "string" ? row.warehouse_id : undefined,
  };
}

function rpcMissingMessage(rpc: string) {
  return i18n.t("orders.errors.atomicIssueRpcMissing", { rpc });
}

/**
 * Creates (or reuses via idempotency) a catalog order_materials line and issues the full
 * requested quantity from the selected warehouse in one server transaction.
 */
export async function addAndIssueOrderCatalogMaterial(input: AddAndIssueOrderCatalogMaterialInput): Promise<{
  material: OrderMaterial;
  movements: InventoryMovement[];
}> {
  const { data, error } = await supabase.rpc(ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC, {
    p_order_id: input.orderId,
    p_warehouse_id: input.warehouseId,
    p_inventory_item_id: input.inventoryItemId,
    p_quantity: input.quantity,
    p_price: input.price ?? null,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    if (isMissingRpcError(error, ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC)) {
      throw new MissingRpcError(ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC, rpcMissingMessage(ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC));
    }
    throw new Error(error.message || i18n.t("orders.errors.issueFailed"));
  }

  const payload = data as { material?: RpcMaterialRow; movements?: unknown } | RpcMaterialRow | null;
  const materialRow =
    payload && typeof payload === "object" && "material" in payload ? (payload.material as RpcMaterialRow) : (payload as RpcMaterialRow);
  if (!materialRow || typeof materialRow.id !== "string") {
    throw new Error(i18n.t("orders.errors.issueFailed"));
  }
  return { material: mapOrderMaterial(materialRow), movements: [] };
}

/**
 * Sets requested quantity on an existing catalog line and issues only the positive delta
 * (new quantity − quantity_issued) from the selected warehouse, atomically.
 */
export async function setOrderCatalogMaterialQuantityWithIssue(
  input: SetOrderCatalogMaterialQuantityWithIssueInput,
): Promise<{ material: OrderMaterial }> {
  const { data, error } = await supabase.rpc(SET_ORDER_CATALOG_MATERIAL_QUANTITY_WITH_ISSUE_RPC, {
    p_order_id: input.orderId,
    p_order_material_id: input.orderMaterialId,
    p_warehouse_id: input.warehouseId,
    p_quantity: input.quantity,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    if (isMissingRpcError(error, SET_ORDER_CATALOG_MATERIAL_QUANTITY_WITH_ISSUE_RPC)) {
      throw new MissingRpcError(
        SET_ORDER_CATALOG_MATERIAL_QUANTITY_WITH_ISSUE_RPC,
        rpcMissingMessage(SET_ORDER_CATALOG_MATERIAL_QUANTITY_WITH_ISSUE_RPC),
      );
    }
    throw new Error(error.message || i18n.t("orders.errors.issueFailed"));
  }

  const payload = data as { material?: RpcMaterialRow } | RpcMaterialRow | null;
  const materialRow =
    payload && typeof payload === "object" && "material" in payload ? (payload.material as RpcMaterialRow) : (payload as RpcMaterialRow);
  if (!materialRow || typeof materialRow.id !== "string") {
    throw new Error(i18n.t("orders.errors.issueFailed"));
  }
  return { material: mapOrderMaterial(materialRow) };
}
