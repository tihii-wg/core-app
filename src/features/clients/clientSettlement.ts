import type { ClientOrderSummary } from "./clientOrders";

/**
 * Client account settlement (Взаиморасчёт), computed from the same
 * canonical data the rest of the app uses:
 *
 * - Order total: `orders.total_price` (Order.totalPrice) — the only
 *   order amount in the schema. Invoice totals are copies of it
 *   (one invoice per order), so invoices are never added on top.
 * - Paid: the app records payment per order as the boolean
 *   `orders.is_paid` (see reportStats: revenue counts totalPrice of
 *   paid orders, outstanding counts unpaid ones). There is NO
 *   payments table and no per-order paid amount, so partial payment
 *   of a single order cannot be represented: paid is either the full
 *   order total or 0. This module never fabricates amounts.
 * - Billable scope follows reportStats: cancelled orders are
 *   excluded from money totals.
 * - Only orders with a remaining amount due are listed. Fully paid
 *   orders are counted separately (settledOrdersCount) and never
 *   contribute to outstanding.
 *
 * Stored client balance (`clients.balance`) — the client's ADVANCE:
 * - It represents the client's available advance/credit held by the
 *   business (confirmed business meaning). It is NOT an additional
 *   debt. A positive stored value is advance held; that is the
 *   stored sign convention, used here unchanged (clientAdvance =
 *   stored balance). No application code, trigger, or migration
 *   derives it from orders or payments (it is only ever read, see
 *   apiClients.toClient), so combining it with order outstanding
 *   does NOT double-count order amounts. How the balance is saved
 *   or displayed elsewhere is untouched.
 *
 * Final settlement balance:
 *   finalBalance = clientAdvance - totalOutstanding
 *   negative -> the client still owes money (shown red)
 *   positive -> remaining advance/credit after settling (green)
 *   zero     -> fully settled (neutral)
 * Outstanding is always reported as a non-negative amount owed.
 */

export type ClientSettlementRow = {
  id: string;
  orderNumber: string;
  /** ISO date (yyyy-mm-dd) or "" when unknown. */
  date: string;
  total: number;
  paid: number;
  remaining: number;
  isPaid: boolean;
};

export type ClientSettlement = {
  /** Only orders with remaining > 0, in the input order. */
  rows: ClientSettlementRow[];
  /** Sum of totals of the displayed (outstanding) orders. */
  displayedOrderTotal: number;
  /** Sum of paid amounts of the displayed orders. */
  displayedPaid: number;
  /** Sum of remaining amounts of the displayed orders. */
  totalOutstanding: number;
  /** The stored clients.balance = client advance held (positive = credit). */
  existingBalance: number;
  /** existingBalance - totalOutstanding (see sign convention). */
  finalBalance: number;
  excludedCancelledCount: number;
  /** Fully paid billable orders, excluded from the list. */
  settledOrdersCount: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** UI tone for a settlement balance (see sign convention above). */
export function settlementBalanceTone(balance: number): "debt" | "credit" | "settled" {
  if (balance < 0) return "debt";
  if (balance > 0) return "credit";
  return "settled";
}

export function computeClientSettlement(orders: ClientOrderSummary[], storedBalance = 0): ClientSettlement {
  const rows: ClientSettlementRow[] = [];
  let excludedCancelledCount = 0;
  let settledOrdersCount = 0;

  for (const order of orders) {
    if (order.status === "cancelled") {
      excludedCancelledCount += 1;
      continue;
    }
    const total = roundMoney(order.totalPrice || 0);
    const paid = order.isPaid ? total : 0;
    const remaining = roundMoney(total - paid);
    if (remaining <= 0) {
      settledOrdersCount += 1;
      continue;
    }
    rows.push({
      id: order.id,
      orderNumber: order.orderNumber,
      date: order.createdAt ? order.createdAt.split("T")[0] : "",
      total,
      paid,
      remaining,
      isPaid: Boolean(order.isPaid),
    });
  }

  const displayedOrderTotal = roundMoney(rows.reduce((sum, row) => sum + row.total, 0));
  const displayedPaid = roundMoney(rows.reduce((sum, row) => sum + row.paid, 0));
  const totalOutstanding = roundMoney(rows.reduce((sum, row) => sum + row.remaining, 0));
  const existingBalance = roundMoney(storedBalance || 0);

  return {
    rows,
    displayedOrderTotal,
    displayedPaid,
    totalOutstanding,
    existingBalance,
    finalBalance: roundMoney(existingBalance - totalOutstanding),
    excludedCancelledCount,
    settledOrdersCount,
  };
}
