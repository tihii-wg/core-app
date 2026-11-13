import type { Order, OrderKind, OrderStatus } from "../../lib/types";

export type ClientOrderSummary = {
  id: string;
  orderNumber: string;
  device: string;
  vin: string;
  carNumber: string;
  service: string;
  totalPrice: number;
  status: OrderStatus;
  customStatus?: { name: string; color: string | null } | null;
  estimateStatus?: { name: string; color: string | null } | null;
  kind?: OrderKind;
  isPaid: boolean;
  createdAt: string;
};

/** Orders for a client, newest first. Defaults to real orders (excludes estimates). */
export function clientOrderSummaries(
  orders: Order[],
  clientId: string,
  kind: OrderKind = "order",
): ClientOrderSummary[] {
  return orders
    .filter((order) => {
      if (order.clientId !== clientId) return false;
      const orderKind = order.kind === "estimate" ? "estimate" : "order";
      return orderKind === kind;
    })
    .map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      device: order.device,
      vin: order.vin,
      carNumber: order.carNumber,
      service: order.service,
      totalPrice: order.totalPrice,
      status: order.status,
      kind: order.kind === "estimate" ? ("estimate" as const) : ("order" as const),
      ...(order.customStatus ? { customStatus: order.customStatus } : {}),
      ...(order.estimateStatus
        ? { estimateStatus: { name: order.estimateStatus.name, color: order.estimateStatus.color } }
        : {}),
      isPaid: Boolean(order.isPaid),
      createdAt: order.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.orderNumber.localeCompare(a.orderNumber));
}

/** Secondary line for history rows — industry-visible assets and/or service. */
export function clientOrderHistoryLine(
  order: Pick<ClientOrderSummary, "device" | "service" | "vin" | "carNumber">,
  showDevice: boolean,
  showCarNumber: boolean,
  showVin: boolean,
) {
  const parts: string[] = [];
  if (showDevice && order.device?.trim()) parts.push(order.device.trim());
  if (showCarNumber && order.carNumber?.trim()) parts.push(order.carNumber.trim());
  if (showVin && order.vin?.trim()) parts.push(order.vin.trim());
  if (order.service?.trim()) parts.push(order.service.trim());
  return parts.join(" · ");
}
