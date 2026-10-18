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
