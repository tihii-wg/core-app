import type { Order, OrderStatus } from "../../lib/types";

/** Statuses that close an order as fully paid in the current workflow. */
export function isPaidClosureStatus(status: OrderStatus) {
  return status === "paid";
}

/** A tax invoice number counts only when it has non-whitespace content. */
export function hasTaxInvoiceNumber(order: Pick<Order, "taxInvoiceNumber">) {
  return (order.taxInvoiceNumber ?? "").trim().length > 0;
}

/**
 * True when moving `order` to `status` must be blocked because the workspace
 * requires a tax invoice number and none is saved on the order.
 */
export function isTaxInvoiceBlocked(order: Order, status: OrderStatus, requireTaxInvoiceNumber: boolean) {
  return requireTaxInvoiceNumber && isPaidClosureStatus(status) && !hasTaxInvoiceNumber(order);
}
