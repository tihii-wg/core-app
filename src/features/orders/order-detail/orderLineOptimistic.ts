import type { Order, OrderMaterial } from "../../../lib/types";
import { computeOrderMoney, type LineDiscountType, type MoneyLine } from "../orderTotals";

function toMoney(line: {
  price: number;
  quantity: number;
  discountType?: LineDiscountType | null;
  discountValue?: number | null;
}): MoneyLine {
  return {
    price: Number(line.price) || 0,
    qty: Number(line.quantity) || 0,
    discountType: line.discountType ?? null,
    discountValue: line.discountValue ?? null,
  };
}

export function orderMoneyOf(
  services: readonly {
    price: number;
    quantity: number;
    discountType?: LineDiscountType | null;
    discountValue?: number | null;
  }[],
  materials: readonly {
    price: number;
    quantity: number;
    discountType?: LineDiscountType | null;
    discountValue?: number | null;
  }[],
) {
  return computeOrderMoney({ services: services.map(toMoney), materials: materials.map(toMoney) });
}

/**
 * Optimistic copy of the order with one line's unit price changed and the total recomputed the same
 * way the server does (per-line discounts included).
 */
export function withOptimisticLinePrice(
  order: Order,
  kind: "service" | "material",
  lineId: string,
  price: number,
  quantity?: number,
): Order {
  const patchLine = <T extends { id?: string }>(line: T): T =>
    line.id === lineId ? { ...line, price, ...(quantity !== undefined ? { quantity } : {}) } : line;
  const services = kind === "service" ? order.services.map(patchLine) : order.services;
  const materials = kind === "material" ? (order.materials ?? []).map(patchLine) : (order.materials ?? []);
  const money = orderMoneyOf(services, materials);
  return { ...order, services, materials, totalPrice: money.total };
}

/** Optimistic copy of the order without one line, total recomputed like the server does. */
export function withoutLine(order: Order, kind: "service" | "material", lineId: string): Order {
  const services = kind === "service" ? order.services.filter((line) => line.id !== lineId) : order.services;
  const materials =
    kind === "material" ? (order.materials ?? []).filter((line) => line.id !== lineId) : (order.materials ?? []);
  return { ...order, services, materials, totalPrice: orderMoneyOf(services, materials).total };
}

/** Optimistic copy of the order with freshly added material drafts (no ids yet → read-only rows). */
export function withPendingMaterials(order: Order, drafts: readonly OrderMaterial[]): Order {
  const materials = [
    ...(order.materials ?? []),
    ...drafts.map((draft) => ({ ...draft, id: undefined, quantityIssued: 0, quantityReturned: 0 })),
  ];
  return { ...order, materials, totalPrice: orderMoneyOf(order.services, materials).total };
}
