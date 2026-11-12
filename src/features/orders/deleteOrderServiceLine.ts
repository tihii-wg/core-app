import { deleteOrderServiceLineDirect, getOrder, updateOrder } from "../../services/apiOrders";
import type { Order, OrderService } from "../../lib/types";
import { preservedOrderFieldsForLineAppend } from "./appendOrderLines";

/**
 * Re-reads the order, drops ONE service line by `order_services.id`, and saves through `updateOrder`
 * so totals / VAT / team-from-performers stay consistent. History gets `service_removed` via DB triggers.
 */
export async function deleteOrderServiceLine(
  orderId: string,
  lineId: string,
  workspaceId: string | undefined,
  options?: { fullRebuild?: boolean },
): Promise<Order> {
  const id = lineId.trim();
  if (!id) throw new Error("Service line id is required");

  if (!options?.fullRebuild) return deleteOrderServiceLineDirect(orderId, id, workspaceId);

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
