import type { ClientType, Order, OrderStatus } from "../../lib/types";

/** Statuses that close an order as fully paid in the current workflow. */
export function isPaidClosureStatus(status: OrderStatus) {
  return status === "paid";
}

/** Legal entities use clients.client_type = "organization"; individuals are "individual". */
export function isLegalEntityCustomer(clientType: ClientType | null | undefined) {
  return clientType === "organization";
}

/** A tax invoice number counts only when it has non-whitespace content. */
export function hasTaxInvoiceNumber(order: Pick<Order, "taxInvoiceNumber">) {
  return (order.taxInvoiceNumber ?? "").trim().length > 0;
}

/**
 * True when moving `order` to `status` must be blocked because the workspace
 * requires a tax invoice number for legal-entity customers and none is saved.
 * Individual customers are never blocked by this rule.
 */
export function isTaxInvoiceBlocked(order: Order, status: OrderStatus, requireTaxInvoiceNumber: boolean) {
  return (
    requireTaxInvoiceNumber &&
    isPaidClosureStatus(status) &&
    isLegalEntityCustomer(order.clientType) &&
    !hasTaxInvoiceNumber(order)
  );
}
