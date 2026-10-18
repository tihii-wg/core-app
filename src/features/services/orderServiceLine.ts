import type { OrderService, Service } from "../../lib/types";

/**
 * Copies the current catalog name and price into a new order line snapshot.
 * Later catalog edits must not rewrite this line — order_services stores its own price.
 */
export function catalogServiceToOrderLine(service: Pick<Service, "id" | "service_name" | "service_price">): OrderService {
  return {
    serviceId: service.id,
    serviceName: service.service_name,
    price: service.service_price ?? 0,
    quantity: 1,
  };
}

export function orderLineAmount(line: Pick<OrderService, "price" | "quantity">): number {
  const price = Number(line.price) || 0;
  const quantity = Number(line.quantity) || 0;
  return price * quantity;
}

export function sumOrderServiceLines(lines: Array<Pick<OrderService, "price" | "quantity">> | undefined): number {
  return (lines ?? []).reduce((total, line) => total + orderLineAmount(line), 0);
}
