import type { ClientType, Order, OrderStatus } from "../../lib/types";

/** Statuses that close an order as fully paid in the current workflow. */
export function isPaidClosureStatus(status: OrderStatus) {
  return status === "paid";
}

/**
 * True when Paid status controls must be locked for this actor.
 * Workspace owners may change Paid orders; everyone else may not.
 * `isWorkspaceOwner` must come from real workspace ownership / owner role helpers —
 * never from a user-supplied flag alone.
 */
export function isOrderPaidLocked(
  order: Pick<Order, "status"> | { status?: string | null },
  isWorkspaceOwner = false,
) {
  return order.status === "paid" && !isWorkspaceOwner;
}

/**
 * True when changing from the current status to `nextStatus` must be rejected
 * because Paid is locked for non-owners. Same-status Paid → Paid is a no-op.
 * Owners are never forbidden by this rule (API still re-checks `workspaces.owner_id`).
 */
export function isPaidStatusChangeForbidden(
  currentStatus: OrderStatus | string | null | undefined,
  nextStatus: OrderStatus | string | null | undefined,
  isWorkspaceOwner = false,
) {
  if (isWorkspaceOwner) return false;
  return currentStatus === "paid" && nextStatus !== "paid";
}

/** Legal entities use clients.client_type = "organization"; individuals are "individual". */
export function isLegalEntityCustomer(clientType: ClientType | null | undefined) {
  return clientType === "organization";
}

/** A tax invoice number counts only when it has non-whitespace content. */
export function taxInvoiceNumberPresent(value: string | null | undefined) {
  return (value ?? "").trim().length > 0;
}

/** Order-shaped helper; trims whitespace the same way as `taxInvoiceNumberPresent`. */
export function hasTaxInvoiceNumber(order: Pick<Order, "taxInvoiceNumber">) {
  return taxInvoiceNumberPresent(order.taxInvoiceNumber);
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

/** Whether the Paid status option must be disabled for this order in selectors/menus. */
export function isPaidStatusOptionBlocked(order: Order, requireTaxInvoiceNumber: boolean) {
  return isTaxInvoiceBlocked(order, "paid", requireTaxInvoiceNumber);
}

/**
 * Fail-closed client type for the UI paid gate: if any known source says the
 * customer is a legal entity, treat them as one so a stale "individual" /
 * missing type cannot skip the tax-invoice check before the API runs.
 */
export function resolveClientTypeForTaxGate(
  primary: Pick<Order, "clientType">,
  secondary?: Pick<Order, "clientType"> | null,
): ClientType | null | undefined {
  if (isLegalEntityCustomer(primary.clientType) || isLegalEntityCustomer(secondary?.clientType)) {
    return "organization";
  }
  return primary.clientType ?? secondary?.clientType;
}
