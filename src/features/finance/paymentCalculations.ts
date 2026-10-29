import type { Expense, Invoice, Order, PaymentMethod, Transaction } from "../../lib/types";
import { expenseTransaction, financeAmount, financeDateKey, transactionsInPeriod } from "./financeStats";
import type {
  LegacyUnreconciled,
  LedgerPayment,
  LedgerPaymentMethod,
  PaymentBalance,
  PaymentKind,
  PaymentListFilters,
} from "./paymentTypes";
import type { ReportPeriod } from "../reports/reportStats";

const MONEY_EPS = 0.005;

/** Round to cents the same way expense inserts do. */
export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** Positive finite money only — never treat invalid values as zero received. */
export function ledgerAmount(value: unknown): number | null {
  return financeAmount(value);
}

export function isValidLedgerPayment(row: Pick<LedgerPayment, "kind" | "amount" | "paidAt" | "currencyCode">): boolean {
  if (row.kind !== "payment" && row.kind !== "refund") return false;
  if (ledgerAmount(row.amount) == null) return false;
  if (!financeDateKey(row.paidAt)) return false;
  if (!(row.currencyCode ?? "").trim()) return false;
  return true;
}

/** Signed contribution: payments add, refunds subtract. Invalid rows contribute 0 and are skipped by callers. */
export function signedLedgerAmount(row: Pick<LedgerPayment, "kind" | "amount">): number | null {
  const amount = ledgerAmount(row.amount);
  if (amount == null) return null;
  return row.kind === "refund" ? -amount : amount;
}

export function paymentsForCurrency(payments: LedgerPayment[], currencyCode: string) {
  const code = currencyCode.trim().toUpperCase();
  return payments.filter((row) => row.currencyCode.trim().toUpperCase() === code && isValidLedgerPayment(row));
}

/** Net collected = payments − refunds. Each row counted once. Currencies must already be filtered. */
export function netCollected(payments: LedgerPayment[]): number {
  let sum = 0;
  for (const row of payments) {
    if (!isValidLedgerPayment(row)) continue;
    const signed = signedLedgerAmount(row);
    if (signed == null) continue;
    sum += signed;
  }
  return roundMoney(sum);
}

export function paymentLinkCategory(row: Pick<LedgerPayment, "invoiceId">): "invoice" | "no-invoice" {
  return row.invoiceId ? "invoice" : "no-invoice";
}

/**
 * Split net by invoice-linked vs no-invoice. A row with both invoice_id and order_id
 * counts only in the invoice-linked bucket (never both).
 */
export function netByLinkCategory(payments: LedgerPayment[]): { invoiceLinked: number; noInvoice: number; refunds: number; grossPayments: number; net: number } {
  let invoiceLinked = 0;
  let noInvoice = 0;
  let refunds = 0;
  let grossPayments = 0;

  for (const row of payments) {
    if (!isValidLedgerPayment(row)) continue;
    const amount = ledgerAmount(row.amount);
    if (amount == null) continue;

    if (row.kind === "refund") {
      refunds = roundMoney(refunds + amount);
      const signed = -amount;
      if (paymentLinkCategory(row) === "invoice") invoiceLinked += signed;
      else noInvoice += signed;
      continue;
    }

    grossPayments = roundMoney(grossPayments + amount);
    if (paymentLinkCategory(row) === "invoice") invoiceLinked += amount;
    else noInvoice += amount;
  }

  return {
    invoiceLinked: roundMoney(invoiceLinked),
    noInvoice: roundMoney(noInvoice),
    refunds: roundMoney(refunds),
    grossPayments: roundMoney(grossPayments),
    net: roundMoney(invoiceLinked + noInvoice),
  };
}

export function paymentsInPeriod(payments: LedgerPayment[], period: Pick<ReportPeriod, "start" | "end">) {
  return payments.filter((row) => {
    const date = financeDateKey(row.paidAt);
    return date !== "" && date >= period.start && date <= period.end;
  });
}

export function filterPayments(payments: LedgerPayment[], filters: PaymentListFilters = {}) {
  return payments.filter((row) => {
    if (filters.orderId && row.orderId !== filters.orderId) return false;
    if (filters.invoiceId && row.invoiceId !== filters.invoiceId) return false;
    if (filters.paymentMethod && row.paymentMethod !== filters.paymentMethod) return false;
    if (filters.link === "invoice" && !row.invoiceId) return false;
    if (filters.link === "no-invoice" && row.invoiceId) return false;
    const date = financeDateKey(row.paidAt);
    if (filters.paidFrom && (date === "" || date < filters.paidFrom)) return false;
    if (filters.paidTo && (date === "" || date > filters.paidTo)) return false;
    return true;
  });
}

export function paymentsForOrder(payments: LedgerPayment[], orderId: string) {
  return payments.filter((row) => row.orderId === orderId && isValidLedgerPayment(row));
}

export function paymentsForInvoice(payments: LedgerPayment[], invoiceId: string) {
  return payments.filter((row) => row.invoiceId === invoiceId && isValidLedgerPayment(row));
}

function deriveStatus(netPaid: number, total: number): PaymentBalance["status"] {
  if (netPaid <= MONEY_EPS) return "unpaid";
  if (netPaid + MONEY_EPS < total) return "partial";
  return "paid";
}

/**
 * Balance for a document total against linked ledger rows (same currency filter applied by caller).
 * Remaining is clamped at 0 for display; overpayment is reported separately.
 */
export function computePaymentBalance(
  totalRaw: unknown,
  linked: LedgerPayment[],
  legacyPaid: boolean,
): PaymentBalance {
  const totalParsed = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);
  const total = Number.isFinite(totalParsed) && totalParsed > 0 ? roundMoney(totalParsed) : 0;
  const valid = linked.filter(isValidLedgerPayment);
  const hasLedger = valid.length > 0;
  const netPaid = hasLedger ? Math.max(0, netCollected(valid)) : 0;
  const overpayment = hasLedger && total > 0 ? Math.max(0, roundMoney(netPaid - total)) : 0;
  const remaining = total > 0 ? Math.max(0, roundMoney(total - netPaid)) : 0;

  if (hasLedger) {
    return {
      total,
      netPaid: roundMoney(netPaid),
      remaining,
      overpayment,
      status: deriveStatus(netPaid, total),
      hasLedger: true,
      isLegacyUnreconciled: false,
    };
  }

  return {
    total,
    netPaid: 0,
    remaining: legacyPaid ? 0 : total,
    overpayment: 0,
    status: legacyPaid ? "paid" : "unpaid",
    hasLedger: false,
    isLegacyUnreconciled: legacyPaid && total > 0,
  };
}

/**
 * Order total field is `orders.total_price` → app `Order.totalPrice`.
 * When `invoiceIdForOrder` is known (at most one invoice per order), invoice-only
 * ledger rows for that invoice also count toward the order balance.
 */
export function orderPaymentBalance(
  order: Pick<Order, "id" | "totalPrice" | "isPaid" | "status">,
  payments: LedgerPayment[],
  invoiceIdForOrder?: string | null,
): PaymentBalance {
  const linked = invoiceIdForOrder
    ? paymentsAffectingOrder(payments, order.id, invoiceIdForOrder)
    : paymentsForOrder(payments, order.id);
  const legacyPaid = order.isPaid || order.status === "paid";
  return computePaymentBalance(order.totalPrice, linked, legacyPaid);
}

/** True when a non-cancelled order still has ledger remaining due (unpaid or partial). */
export function orderHasOutstandingBalance(
  order: Pick<Order, "id" | "totalPrice" | "isPaid" | "status">,
  payments: LedgerPayment[],
  invoiceIdForOrder?: string | null,
): boolean {
  if (order.status === "cancelled") return false;
  return orderPaymentBalance(order, payments, invoiceIdForOrder).remaining > MONEY_EPS;
}

/**
 * Invoice balance. When `orderId` is known, order-only ledger rows
 * (`order_id` set, `invoice_id` null) also reduce the invoice remaining —
 * covering payments recorded before the invoice was created.
 */
export function invoicePaymentBalance(
  invoice: Pick<Invoice, "id" | "total" | "amount" | "status" | "orderId">,
  payments: LedgerPayment[],
): PaymentBalance {
  const linked = paymentsAffectingInvoice(payments, invoice.id, invoice.orderId);
  const legacyPaid = invoice.status === "paid";
  return computePaymentBalance(invoice.amount ?? invoice.total, linked, legacyPaid);
}

/** Remaining refundable on an original payment after prior refund rows. */
export function refundableRemaining(original: LedgerPayment, allPayments: LedgerPayment[]): number {
  if (original.kind !== "payment") return 0;
  const amount = ledgerAmount(original.amount);
  if (amount == null) return 0;
  let refunded = 0;
  for (const row of allPayments) {
    if (row.kind !== "refund") continue;
    if (row.relatedPaymentId !== original.id) continue;
    if (!isValidLedgerPayment(row)) continue;
    const part = ledgerAmount(row.amount);
    if (part == null) continue;
    refunded += part;
  }
  return Math.max(0, roundMoney(amount - refunded));
}

/** Normalize currency codes the same way inserts do (trim + uppercase). */
export function normalizeCurrencyCode(currencyCode: string | null | undefined): string {
  return (currencyCode ?? "").trim().toUpperCase();
}

/** True when the code is a normalized three-letter currency (ISO-like). */
export function isNormalizedCurrencyCode(currencyCode: string | null | undefined): boolean {
  return /^[A-Z]{3}$/.test(normalizeCurrencyCode(currencyCode));
}

/**
 * Ledger rows that settle an order's economic balance.
 * Includes rows with `order_id` and rows linked only via the order's invoice
 * (at most one invoice per order in schema). Each row is still counted once.
 */
export function paymentsAffectingOrder(
  payments: LedgerPayment[],
  orderId: string,
  invoiceIdForOrder: string | null | undefined,
): LedgerPayment[] {
  const invoiceId = invoiceIdForOrder?.trim() || null;
  const seen = new Set<string>();
  const out: LedgerPayment[] = [];
  for (const row of payments) {
    if (!isValidLedgerPayment(row)) continue;
    const hitsOrder = row.orderId === orderId;
    const hitsInvoice = Boolean(invoiceId && row.invoiceId === invoiceId);
    if (!hitsOrder && !hitsInvoice) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * Ledger rows that settle an invoice's economic balance.
 * Includes direct invoice-linked rows and order-only rows for the invoice's order
 * (`invoice_id` null) so pre-invoice payments still reduce remaining.
 */
export function paymentsAffectingInvoice(
  payments: LedgerPayment[],
  invoiceId: string,
  orderId: string | null | undefined,
): LedgerPayment[] {
  const order = orderId?.trim() || null;
  const seen = new Set<string>();
  const out: LedgerPayment[] = [];
  for (const row of payments) {
    if (!isValidLedgerPayment(row)) continue;
    const hitsInvoice = row.invoiceId === invoiceId;
    const hitsOrderOnly = Boolean(order && row.orderId === order && !row.invoiceId);
    if (!hitsInvoice && !hitsOrderOnly) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Distinct normalized currency codes present on ledger rows. */
export function ledgerCurrencies(payments: LedgerPayment[]): string[] {
  const codes = new Set<string>();
  for (const row of payments) {
    if (!isValidLedgerPayment(row)) continue;
    const code = normalizeCurrencyCode(row.currencyCode);
    if (code) codes.add(code);
  }
  return [...codes].sort();
}

/**
 * Fail-closed currency rule for a proposed payment against an economic set:
 * - multiple distinct currencies already present → mixed (do not sum)
 * - one existing currency that differs from proposed → mismatch
 * - empty set → ok (first ledger currency for that balance)
 */
export function ledgerCurrencyGate(
  existing: LedgerPayment[],
  proposedCurrency: string,
): "ok" | "mixed" | "mismatch" {
  const codes = ledgerCurrencies(existing);
  const proposed = normalizeCurrencyCode(proposedCurrency);
  if (!proposed || !/^[A-Z]{3}$/.test(proposed)) return "mismatch";
  if (codes.length > 1) return "mixed";
  if (codes.length === 1 && codes[0] !== proposed) return "mismatch";
  return "ok";
}

/**
 * Workspace billing currency must exist and be a normalized three-letter code,
 * then match the payment currency. Mirrors the SQL fail-closed rule
 * (missing / soft-deleted workspace → invalid; invalid format → invalid).
 */
export function assertWorkspaceCurrencyMatch(
  workspaceCurrency: string | null | undefined,
  paymentCurrency: string,
): "ok" | "workspace_invalid" | "mismatch" {
  const workspace = normalizeCurrencyCode(workspaceCurrency);
  const payment = normalizeCurrencyCode(paymentCurrency);
  if (!isNormalizedCurrencyCode(workspace)) return "workspace_invalid";
  if (!isNormalizedCurrencyCode(payment) || workspace !== payment) return "mismatch";
  return "ok";
}

/**
 * After ORDER→INVOICE locks: decide whether the locked invoice's order_id is safe.
 * - lockedOrderId null + invoice now has order → retry (cannot lock order after invoice)
 * - both set but differ → mismatch
 * - locked order but invoice has none → mismatch
 * - otherwise ok
 */
export function invoiceOrderLockDecision(input: {
  lockedOrderId: string | null;
  invoiceOrderIdAfterLock: string | null;
}): "ok" | "mismatch" | "retry" {
  const locked = input.lockedOrderId?.trim() || null;
  const after = input.invoiceOrderIdAfterLock?.trim() || null;
  if (after && !locked) return "retry";
  if (after && locked && locked !== after) return "mismatch";
  if (!after && locked) return "mismatch";
  return "ok";
}

/** Remaining on a document total after existing net ledger (same currency assumed). */
export function remainingForTotal(totalRaw: unknown, linked: LedgerPayment[]): number {
  const totalParsed = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);
  const total = Number.isFinite(totalParsed) && totalParsed > 0 ? roundMoney(totalParsed) : 0;
  if (total <= 0) return 0;
  const net = Math.max(0, netCollected(linked));
  return Math.max(0, roundMoney(total - net));
}

/**
 * Whether a proposed payment amount would exceed the remaining balance.
 * `linked` must already be scoped to the target (invoice rows, or order-affecting rows).
 */
export function wouldExceedRemaining(totalRaw: unknown, linked: LedgerPayment[], proposedAmount: unknown): boolean {
  const proposed = ledgerAmount(proposedAmount);
  if (proposed == null) return true;
  const remaining = remainingForTotal(totalRaw, linked);
  return roundMoney(proposed - remaining) > MONEY_EPS;
}

/**
 * Legacy paid invoices/orders with no ledger rows.
 * When both a paid invoice and its order are legacy, only the invoice is listed
 * (same economic event — avoid double-counting the legacy aggregate).
 */
export function findLegacyUnreconciled(
  orders: Pick<Order, "id" | "orderNumber" | "totalPrice" | "isPaid" | "status">[],
  invoices: Pick<Invoice, "id" | "invoiceNumber" | "orderId" | "total" | "amount" | "status" | "paidAt">[],
  payments: LedgerPayment[],
): LegacyUnreconciled[] {
  const orderIdsWithLedger = new Set(payments.filter((p) => p.orderId && isValidLedgerPayment(p)).map((p) => p.orderId as string));
  const invoiceIdsWithLedger = new Set(payments.filter((p) => p.invoiceId && isValidLedgerPayment(p)).map((p) => p.invoiceId as string));

  const result: LegacyUnreconciled[] = [];
  const legacyInvoiceOrderIds = new Set<string>();

  for (const invoice of invoices) {
    if (invoice.status !== "paid") continue;
    if (invoiceIdsWithLedger.has(invoice.id)) continue;
    const amount = ledgerAmount(invoice.amount ?? invoice.total);
    if (amount == null) continue;
    const date = financeDateKey(invoice.paidAt) || null;
    result.push({
      kind: "invoice",
      id: invoice.id,
      label: invoice.invoiceNumber,
      amount,
      attributedDate: date,
      dateReliable: Boolean(date),
    });
    if (invoice.orderId) legacyInvoiceOrderIds.add(invoice.orderId);
  }

  for (const order of orders) {
    const legacyPaid = order.isPaid || order.status === "paid";
    if (!legacyPaid) continue;
    if (orderIdsWithLedger.has(order.id)) continue;
    if (legacyInvoiceOrderIds.has(order.id)) continue;
    // Order linked to any invoice that already has ledger — skip (invoice path owns money).
    const linkedInvoiceHasLedger = invoices.some((inv) => inv.orderId === order.id && invoiceIdsWithLedger.has(inv.id));
    if (linkedInvoiceHasLedger) continue;
    const amount = ledgerAmount(order.totalPrice);
    if (amount == null) continue;
    result.push({
      kind: "order",
      id: order.id,
      label: order.orderNumber,
      amount,
      attributedDate: null,
      dateReliable: false,
    });
  }

  return result;
}

export function legacyUnreconciledTotal(items: LegacyUnreconciled[]): number {
  return roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
}

/** Map ledger method to expense-style PaymentMethod for shared Finance icons/labels where possible. */
export function ledgerMethodToExpenseMethod(method: LedgerPaymentMethod): PaymentMethod {
  if (method === "bank_transfer") return "bank-transfer";
  return method;
}

export function expenseMethodToLedgerMethod(method: PaymentMethod): LedgerPaymentMethod {
  if (method === "bank-transfer") return "bank_transfer";
  return method;
}

export type FinanceLedgerTransaction = Transaction & {
  kind?: PaymentKind | "expense";
  linkCategory?: "invoice" | "no-invoice";
  currencyCode?: string;
  relatedPaymentId?: string;
  /** Source ledger row when this transaction is a payment/refund (for row actions). */
  payment?: LedgerPayment;
  /** Confirmed ledger row — never a synthetic legacy aggregate. */
  source: "ledger" | "expense";
};

export function paymentToTransaction(
  row: LedgerPayment,
  labels: { paymentCategory: string; refundCategory: string; description: string },
): FinanceLedgerTransaction | null {
  if (!isValidLedgerPayment(row)) return null;
  const amount = ledgerAmount(row.amount);
  if (amount == null) return null;
  const date = financeDateKey(row.paidAt);
  if (!date) return null;

  const isRefund = row.kind === "refund";
  return {
    id: `payment-${row.id}`,
    type: isRefund ? "refund" : "income",
    category: isRefund ? labels.refundCategory : labels.paymentCategory,
    description: labels.description,
    amount,
    paymentMethod: ledgerMethodToExpenseMethod(row.paymentMethod),
    date,
    ...(row.orderId ? { relatedOrderId: row.orderId } : {}),
    ...(row.invoiceId ? { relatedInvoiceId: row.invoiceId } : {}),
    kind: row.kind,
    linkCategory: paymentLinkCategory(row),
    currencyCode: row.currencyCode,
    ...(row.relatedPaymentId ? { relatedPaymentId: row.relatedPaymentId } : {}),
    payment: row,
    source: "ledger",
  };
}

/**
 * Confirmed Finance transactions: ledger payments/refunds + expenses.
 * Does not include legacy invoice/order paid flags.
 */
export function buildLedgerFinanceTransactions(
  payments: LedgerPayment[],
  expenses: Expense[],
  labelFor: (row: LedgerPayment) => { paymentCategory: string; refundCategory: string; description: string },
  currencyCode: string,
): FinanceLedgerTransaction[] {
  const inCurrency = paymentsForCurrency(payments, currencyCode);
  const ledgerTxns = inCurrency
    .map((row) => paymentToTransaction(row, labelFor(row)))
    .filter((txn): txn is FinanceLedgerTransaction => txn != null);

  const spent: FinanceLedgerTransaction[] = [];
  for (const expense of expenses) {
    const base = expenseTransaction(expense);
    if (!base) continue;
    spent.push({ ...base, kind: "expense", source: "expense", currencyCode });
  }

  return [...ledgerTxns, ...spent].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export type LedgerFinancePeriodStats = {
  /** Gross payment receipts (kind=payment) in period. */
  grossReceipts: number;
  invoiceLinkedReceipts: number;
  noInvoiceReceipts: number;
  refunds: number;
  /** Net receipts after refunds. */
  netReceipts: number;
  expenses: number;
  /** netReceipts − expenses */
  netOperating: number;
  outstandingTotal: number;
  legacyUnreconciledTotal: number;
  byCategory: [string, number][];
  byMethod: [PaymentMethod, number][];
  byPaymentMethod: [LedgerPaymentMethod, number][];
};

export function outstandingInvoiceBalances(
  invoices: Pick<Invoice, "id" | "total" | "amount" | "status">[],
  payments: LedgerPayment[],
): number {
  return roundMoney(
    invoices.reduce((sum, invoice) => {
      if (invoice.status === "draft") return sum;
      const balance = invoicePaymentBalance(invoice, payments);
      // Legacy paid flag with no ledger rows: not treated as confirmed outstanding.
      if (balance.isLegacyUnreconciled) return sum;
      return sum + balance.remaining;
    }, 0),
  );
}

export function ledgerFinancePeriodStats(
  inPeriod: FinanceLedgerTransaction[],
  outstandingTotal: number,
  legacyTotal: number,
): LedgerFinancePeriodStats {
  const incomeRows = inPeriod.filter((txn) => txn.type === "income" && txn.source === "ledger");
  const refundRows = inPeriod.filter((txn) => txn.type === "refund");
  const expenseRows = inPeriod.filter((txn) => txn.type === "expense");

  const grossReceipts = roundMoney(incomeRows.reduce((sum, txn) => sum + txn.amount, 0));
  const refunds = roundMoney(refundRows.reduce((sum, txn) => sum + txn.amount, 0));
  const invoiceLinkedReceipts = roundMoney(
    incomeRows.filter((txn) => txn.linkCategory === "invoice").reduce((sum, txn) => sum + txn.amount, 0) -
      refundRows.filter((txn) => txn.linkCategory === "invoice").reduce((sum, txn) => sum + txn.amount, 0),
  );
  const noInvoiceReceipts = roundMoney(
    incomeRows.filter((txn) => txn.linkCategory === "no-invoice").reduce((sum, txn) => sum + txn.amount, 0) -
      refundRows.filter((txn) => txn.linkCategory === "no-invoice").reduce((sum, txn) => sum + txn.amount, 0),
  );
  const netReceipts = roundMoney(grossReceipts - refunds);
  const expenses = roundMoney(expenseRows.reduce((sum, txn) => sum + txn.amount, 0));

  const byCategory = Object.entries(
    expenseRows.reduce<Record<string, number>>((acc, txn) => {
      acc[txn.category] = (acc[txn.category] ?? 0) + txn.amount;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]) as [string, number][];

  const byMethod = Object.entries(
    expenseRows.reduce<Record<string, number>>((acc, txn) => {
      const method = txn.paymentMethod ?? "other";
      acc[method] = (acc[method] ?? 0) + txn.amount;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]) as [PaymentMethod, number][];

  const byPaymentMethod = Object.entries(
    [...incomeRows, ...refundRows].reduce<Record<string, number>>((acc, txn) => {
      const method = txn.paymentMethod === "bank-transfer" ? "bank_transfer" : (txn.paymentMethod ?? "other");
      const signed = txn.type === "refund" ? -txn.amount : txn.amount;
      acc[method] = (acc[method] ?? 0) + signed;
      return acc;
    }, {}),
  ).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) as [LedgerPaymentMethod, number][];

  return {
    grossReceipts,
    invoiceLinkedReceipts,
    noInvoiceReceipts,
    refunds,
    netReceipts,
    expenses,
    netOperating: roundMoney(netReceipts - expenses),
    outstandingTotal,
    legacyUnreconciledTotal: legacyTotal,
    byCategory,
    byMethod,
    byPaymentMethod,
  };
}

export function ledgerTransactionsInPeriod(transactions: FinanceLedgerTransaction[], period: Pick<ReportPeriod, "start" | "end">) {
  return transactionsInPeriod(transactions, period) as FinanceLedgerTransaction[];
}

/** Confirmed net receipts on a calendar day (workspace currency), by paid_at. */
export function netReceiptsOnDate(payments: LedgerPayment[], dateKey: string, currencyCode: string): number {
  const rows = paymentsForCurrency(payments, currencyCode).filter((row) => financeDateKey(row.paidAt) === dateKey);
  return netCollected(rows);
}

/** Outstanding order balances for non-cancelled orders without a covering invoice remaining path. */
export function outstandingOrderBalances(
  orders: Pick<Order, "id" | "totalPrice" | "isPaid" | "status">[],
  invoices: Pick<Invoice, "id" | "orderId" | "status">[],
  payments: LedgerPayment[],
): { amount: number; count: number } {
  const invoicedOrderIds = new Set(invoices.filter((inv) => inv.orderId).map((inv) => inv.orderId as string));
  let amount = 0;
  let count = 0;
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    // Orders with an invoice: outstanding is tracked on the invoice side.
    if (invoicedOrderIds.has(order.id)) continue;
    const balance = orderPaymentBalance(order, payments);
    if (balance.isLegacyUnreconciled) continue;
    if (balance.remaining <= MONEY_EPS) continue;
    amount += balance.remaining;
    count += 1;
  }
  return { amount: roundMoney(amount), count };
}

export function combinedOutstanding(
  orders: Pick<Order, "id" | "totalPrice" | "isPaid" | "status">[],
  invoices: Pick<Invoice, "id" | "total" | "amount" | "status" | "orderId">[],
  payments: LedgerPayment[],
): { amount: number; invoicePart: number; orderPart: number; unpaidCount: number } {
  const invoicePart = outstandingInvoiceBalances(invoices, payments);
  const orderPart = outstandingOrderBalances(orders, invoices, payments);
  return {
    amount: roundMoney(invoicePart + orderPart.amount),
    invoicePart,
    orderPart: orderPart.amount,
    unpaidCount: orderPart.count + invoices.filter((inv) => {
      if (inv.status === "draft") return false;
      const b = invoicePaymentBalance(inv, payments);
      return !b.isLegacyUnreconciled && b.remaining > MONEY_EPS;
    }).length,
  };
}
