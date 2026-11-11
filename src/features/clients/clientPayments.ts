import { financeDateKey } from "../finance/financeStats";
import { isValidLedgerPayment } from "../finance/paymentCalculations";
import type { LedgerPayment } from "../finance/paymentTypes";

/**
 * Ledger rows belonging to a client: linked to one of the client's orders,
 * or to one of the client's invoices (invoice-only rows with no order_id).
 * Newest first.
 */
export function clientLedgerPayments(
  payments: LedgerPayment[],
  orderIds: Iterable<string>,
  invoiceIds: Iterable<string> = [],
): LedgerPayment[] {
  const orders = new Set(orderIds);
  const invoices = new Set(invoiceIds);
  return payments
    .filter(
      (row) =>
        isValidLedgerPayment(row) &&
        ((row.orderId != null && orders.has(row.orderId)) || (row.invoiceId != null && invoices.has(row.invoiceId))),
    )
    .sort(
      (a, b) =>
        financeDateKey(b.paidAt).localeCompare(financeDateKey(a.paidAt)) ||
        (b.paidAt ?? "").localeCompare(a.paidAt ?? "") ||
        b.createdAt.localeCompare(a.createdAt),
    );
}
