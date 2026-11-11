import i18n from "../../i18n";
import type { Order, OrderMaterial } from "../../lib/types";
import { getOrder } from "../../services/apiOrders";
import { isMissingRpcError, MissingRpcError } from "../../services/missingRpc";
import { requireWorkspaceId } from "../../services/missingTable";
import supabase from "../../services/supabase";

export const DELETE_ORDER_MATERIAL_RPC = "crm_delete_order_material";

function mapDeleteMaterialRpcError(error: { message?: string; code?: string } | null | undefined): Error | null {
  if (!error?.message) return null;
  const message = error.message;
  if (/delete_order_material:closed_order_immutable|order_lifecycle:closed_order_immutable/i.test(message)) {
    return new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  if (/delete_order_material:cancelled_order_immutable/i.test(message)) {
    return new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  if (/delete_order_material:warehouse_permission|You do not have permission to return warehouse/i.test(message)) {
    return new Error(i18n.t("orders.errors.warehousePermission"));
  }
  if (/delete_order_material:warehouse_required/i.test(message)) {
    return new Error(i18n.t("orders.warehouse.warehouseRequired"));
  }
  if (/delete_order_material:line_not_found|delete_order_material:order_not_found/i.test(message)) {
    return new Error(i18n.t("orders.errors.materialsSyncFailed"));
  }
  if (/delete_order_material:forbidden|delete_order_material:not_authenticated/i.test(message)) {
    return new Error(i18n.t("orders.errors.warehousePermission"));
  }
  if (/insufficient_warehouse_stock|insufficient_batch_stock|insufficient_stock/i.test(message)) {
    return new Error(i18n.t("orders.errors.insufficientWarehouseStock"));
  }
  return null;
}

/**
 * Deletes ONE material line by id via `crm_delete_order_material` (returns outstanding stock for
 * catalog lines, then deletes the row and recalculates totals). Other lines are never rewritten.
 */
export async function deleteOrderMaterialLine(
  orderId: string,
  lineId: string,
  workspaceId: string | undefined,
): Promise<Order> {
  const id = lineId.trim();
  if (!id) throw new Error("Material line id is required");
  const ws = requireWorkspaceId(workspaceId);

  const { error } = await supabase.rpc(DELETE_ORDER_MATERIAL_RPC, {
    p_order_id: orderId,
    p_order_material_id: id,
  });
  if (error) {
    if (isMissingRpcError(error, DELETE_ORDER_MATERIAL_RPC)) {
      throw new MissingRpcError(
        DELETE_ORDER_MATERIAL_RPC,
        i18n.t("orders.lineDelete.materialRpcRequired", { rpc: DELETE_ORDER_MATERIAL_RPC }),
      );
    }
    throw mapDeleteMaterialRpcError(error) ?? new Error(error.message);
  }

  return getOrder(orderId, ws);
}

/** Snapshot used to undo a material delete (re-append without the deleted line id). */
export function materialDraftForUndo(line: OrderMaterial): OrderMaterial {
  const { id: _id, quantityIssued: _issued, quantityReturned: _returned, ...rest } = line;
  void _id;
  void _issued;
  void _returned;
  return {
    ...rest,
    quantityIssued: 0,
    quantityReturned: 0,
  };
}
