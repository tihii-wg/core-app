import type { Order } from "../../lib/types";
import { lineNet, roundMoney } from "./orderTotals";

export type OrderTotalWorker = {
  /** employees.id, or null for lines without a performer. */
  employeeId: string | null;
  name: string;
  amount: number;
  lines: number;
};

export type OrderTotalBreakdown = {
  /** Work / service lines after line discounts. */
  works: number;
  /** Material lines after line discounts. */
  materials: number;
  /** Line discounts included in the totals above (for information). */
  discount: number;
  /** Works split by performer, biggest first. Empty when there are no work lines. */
  workers: OrderTotalWorker[];
};

/**
 * Splits the order total into works vs materials and works per performer
 * (order_services.technician_id). Amounts are net of line discounts, the same
 * way computeOrderMoney builds orders.total_price.
 */
export function orderTotalBreakdown(
  order: Pick<Order, "services" | "materials">,
  unassignedLabel: string,
): OrderTotalBreakdown {
  let works = 0;
  let materials = 0;
  let discount = 0;
  const byWorker = new Map<string, OrderTotalWorker>();

  for (const line of order.services ?? []) {
    const gross = roundMoney((Number(line.price) || 0) * (Number(line.quantity) || 0));
    const net = lineNet(line.price, line.quantity, line.discountType ?? null, line.discountValue ?? null);
    works += net;
    discount += gross - net;
    const id = line.technicianId?.trim() || null;
    const key = id ?? "__none__";
    const name = id ? line.technicianName?.trim() || unassignedLabel : unassignedLabel;
    const entry = byWorker.get(key) ?? { employeeId: id, name, amount: 0, lines: 0 };
    entry.amount = roundMoney(entry.amount + net);
    entry.lines += 1;
    byWorker.set(key, entry);
  }

  for (const line of order.materials ?? []) {
    const gross = roundMoney((Number(line.price) || 0) * (Number(line.quantity) || 0));
    const net = lineNet(line.price, line.quantity, line.discountType ?? null, line.discountValue ?? null);
    materials += net;
    discount += gross - net;
  }

  const workers = [...byWorker.values()].sort((a, b) => {
    if (a.employeeId === null) return 1;
    if (b.employeeId === null) return -1;
    return b.amount - a.amount || a.name.localeCompare(b.name);
  });

  return {
    works: roundMoney(works),
    materials: roundMoney(materials),
    discount: roundMoney(discount),
    workers,
  };
}
