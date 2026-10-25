import type { Expense, Invoice, PaymentMethod, Transaction } from "../../lib/types";
import type { ReportPeriod } from "../reports/reportStats";

/** Positive finite amounts only — never treat missing/invalid money as zero revenue/expense. */
export function financeAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

/** YYYY-MM-DD for period filters; blank when the value cannot be dated. */
export function financeDateKey(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "";
}

export function isOutstandingInvoice(invoice: Pick<Invoice, "status">): boolean {
  return invoice.status === "sent" || invoice.status === "overdue";
}

/**
 * Legacy helper: invoice status + paid_at as income.
 * Finance confirmed receipts now use `paymentCalculations` / the payments ledger.
 * Kept for tests and any transitional call sites that still need the old signal.
 */
export function paidInvoiceIncome(
  invoice: Pick<Invoice, "id" | "status" | "paidAt" | "amount" | "total" | "orderId" | "invoiceNumber" | "clientName">,
  labels: { category: string; description: string },
): Transaction | null {
  if (invoice.status !== "paid") return null;
  const date = financeDateKey(invoice.paidAt);
  if (!date) return null;
  const amount = financeAmount(invoice.amount ?? invoice.total);
  if (amount == null) return null;

  return {
    id: `invoice-${invoice.id}`,
    type: "income",
    category: labels.category,
    description: labels.description,
    amount,
    date,
    ...(invoice.orderId ? { relatedOrderId: invoice.orderId } : {}),
    relatedInvoiceId: invoice.id,
  };
}

export function expenseTransaction(expense: Expense): Transaction | null {
  const date = financeDateKey(expense.date);
  const amount = financeAmount(expense.amount);
  if (!date || amount == null) return null;

  return {
    id: `expense-${expense.id}`,
    type: "expense",
    category: expense.category,
    description: expense.description,
    amount,
    paymentMethod: expense.paymentMethod,
    date,
    expense,
  };
}

export function buildFinanceTransactions(
  invoices: Invoice[],
  expenses: Expense[],
  labelFor: (invoice: Invoice) => { category: string; description: string },
): Transaction[] {
  const income = invoices
    .map((invoice) => paidInvoiceIncome(invoice, labelFor(invoice)))
    .filter((txn): txn is Transaction => txn != null);
  const spent = expenses.map(expenseTransaction).filter((txn): txn is Transaction => txn != null);
  return [...income, ...spent].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function transactionsInPeriod(transactions: Transaction[], period: Pick<ReportPeriod, "start" | "end">) {
  return transactions.filter((txn) => {
    const date = financeDateKey(txn.date);
    return date !== "" && date >= period.start && date <= period.end;
  });
}

/** Open receivable snapshot (sent/overdue). Not limited to the selected period. */
export function outstandingInvoiceTotal(invoices: Invoice[]): number {
  return invoices.reduce((sum, invoice) => {
    if (!isOutstandingInvoice(invoice)) return sum;
    const amount = financeAmount(invoice.amount ?? invoice.total);
    return amount == null ? sum : sum + amount;
  }, 0);
}

export type FinancePeriodStats = {
  income: number;
  expenses: number;
  profit: number;
  outstandingTotal: number;
  byCategory: [string, number][];
  byMethod: [PaymentMethod, number][];
};

export function financePeriodStats(
  inPeriod: Transaction[],
  outstandingTotal: number,
): FinancePeriodStats {
  const incomeRows = inPeriod.filter((txn) => txn.type === "income");
  const expenseRows = inPeriod.filter((txn) => txn.type === "expense");
  const income = incomeRows.reduce((sum, txn) => sum + txn.amount, 0);
  const expenses = expenseRows.reduce((sum, txn) => sum + txn.amount, 0);

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

  return {
    income,
    expenses,
    profit: income - expenses,
    outstandingTotal,
    byCategory,
    byMethod,
  };
}
