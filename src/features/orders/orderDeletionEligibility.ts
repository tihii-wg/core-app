import type { Order } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import type { LedgerPayment } from "../finance/paymentTypes";
import { isFullyVoidedPayment } from "../finance/paymentCalculations";

/**
 * True when the order is cancelled for hard-delete purposes.
 * Uses system status `cancelled` or a linked definition with semantic_action = cancel.
 * Never trusts translated / display names.
 */
export function orderHasCancelSemantic(
  order: Pick<Order, "status" | "customStatusId">,
  definitions: readonly StatusDefinition[] = [],
): boolean {
  if (order.status === "cancelled") return true;
  const customId = order.customStatusId?.trim();
  if (!customId) return false;
  const definition = definitions.find((row) => row.id === customId);
  return definition?.semanticAction === "cancel";
}

/** Active (non-annulled) payment trees that must be voided before order delete. */
export function activePaymentsBlockingOrderDelete(
  payments: readonly LedgerPayment[],
  orderId: string,
): LedgerPayment[] {
  const linked = payments.filter((row) => row.orderId === orderId);
  return linked.filter((row) => {
    if (row.kind === "void") return false;
    if (row.kind === "refund") return true;
    if (row.kind !== "payment") return false;
    return !isFullyVoidedPayment(row, linked as LedgerPayment[]);
  });
}

export function refundsBlockingOrderDelete(payments: readonly LedgerPayment[], orderId: string): LedgerPayment[] {
  return payments.filter((row) => row.orderId === orderId && row.kind === "refund");
}

/** Fully voided originals that the protected RPC may remove during delete. */
export function fullyVoidedPaymentsRemovableOnDelete(
  payments: readonly LedgerPayment[],
  orderId: string,
): LedgerPayment[] {
  const linked = payments.filter((row) => row.orderId === orderId);
  return linked.filter((row) => row.kind === "payment" && isFullyVoidedPayment(row, linked as LedgerPayment[]));
}
