import type { Order } from "../../lib/types";
import type { ClientOrderSummary } from "./ClientDetailPanel";

export function clientOrderSummaries(orders: Order[], clientId: string): ClientOrderSummary[] {
  return orders
    .filter((order) => order.clientId === clientId)
    .map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      device: order.device,
      service: order.service,
      totalPrice: order.totalPrice,
    }));
}
