import { deleteOrderServiceLineDirect, getOrder, orderFromLineRpcPayload, updateOrder } from "../../services/apiOrders";
import { isMissingRpcError } from "../../services/missingRpc";
import supabase from "../../services/supabase";
import type { Order, OrderService } from "../../lib/types";
import { preservedOrderFieldsForLineAppend } from "./appendOrderLines";

export const DELETE_ORDER_SERVICE_LINE_RPC = "crm_delete_order_service_line";

/**
 * Deletes ONE service line by `order_services.id`. Prefers `crm_delete_order_service_line`
 * (write + full order); falls back when the RPC is missing.
 */
export async function deleteOrderServiceLine(
  orderId: string,
  lineId: string,
  workspaceId: string | undefined,
  options?: { fullRebuild?: boolean },
): Promise<Order> {
  const id = lineId.trim();
  if (!id) throw new Error("Service line id is required");

  if (!options?.fullRebuild) {
    const { data, error } = await supabase.rpc(DELETE_ORDER_SERVICE_LINE_RPC, {
      p_order_id: orderId,
      p_line_id: id,
    });
    if (!error) {
      const order = orderFromLineRpcPayload(data);
      if (order) return order;
    } else if (!isMissingRpcError(error, DELETE_ORDER_SERVICE_LINE_RPC)) {
      throw new Error(error.message);
    }
    return deleteOrderServiceLineDirect(orderId, id, workspaceId);
  }

  const fresh = await getOrder(orderId, workspaceId);
  const index = fresh.services.findIndex((line) => line.id === id);
  if (index < 0) throw new Error("Service line was not found on this order");

  const nextServices = fresh.services.filter((line) => line.id !== id);

  return updateOrder(
    {
      orderId,
      ...preservedOrderFieldsForLineAppend(fresh),
      services: nextServices,
    },
    workspaceId,
  );
}

/** Test helper: build the services array after deleting one line by id. */
export function servicesAfterLineDelete(services: readonly OrderService[], lineId: string): OrderService[] {
  return services.filter((line) => line.id !== lineId);
}
