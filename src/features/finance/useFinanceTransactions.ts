import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { useGetOrders } from "../orders/useGetOrders";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetExpenses } from "./useExpenses";
import { useGetPayments } from "./usePayments";
import {
  buildLedgerFinanceTransactions,
  findLegacyUnreconciled,
  ledgerFinancePeriodStats,
  ledgerTransactionsInPeriod,
  legacyUnreconciledTotal,
  outstandingInvoiceBalances,
  outstandingOrderBalances,
} from "./paymentCalculations";
import type { LedgerPaymentMethod, PaymentListFilters } from "./paymentTypes";
import type { ReportPeriod } from "../reports/reportStats";

export type FinanceUiFilters = {
  link?: PaymentListFilters["link"];
  paymentMethod?: LedgerPaymentMethod;
};

/**
 * Finance ledger for the active workspace:
 * - Confirmed income/refunds: `payments` rows (dated by paid_at), workspace currency only
 * - Expenses: expenses rows (dated by expense_date)
 * - Outstanding: invoice + uninvoiced order remaining after ledger (not period-filtered)
 * - Legacy: paid orders/invoices with no ledger rows — shown separately, never in confirmed receipts
 */
export function useFinanceTransactions(period: Pick<ReportPeriod, "start" | "end">, filters: FinanceUiFilters = {}) {
  const { t } = useTranslation();
  const { currency } = useWorkspaceMoney();
  const {
    payments,
    isLoading: paymentsLoading,
    error: paymentsError,
    isUnavailable: paymentsUnavailable,
    refetch: refetchPayments,
  } = useGetPayments();
  const {
    invoices,
    isLoading: invoicesLoading,
    error: invoicesError,
    isUnavailable: invoicesUnavailable,
    refetch: refetchInvoices,
  } = useGetInvoices();
  const {
    orders,
    isLoading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = useGetOrders();
  const {
    expenses,
    isLoading: expensesLoading,
    error: expensesError,
    isUnavailable: expensesUnavailable,
    refetch: refetchExpenses,
  } = useGetExpenses();

  const filteredPayments = useMemo(() => {
    let rows = payments;
    if (filters.link === "invoice") rows = rows.filter((row) => Boolean(row.invoiceId));
    if (filters.link === "no-invoice") rows = rows.filter((row) => !row.invoiceId);
    if (filters.paymentMethod) rows = rows.filter((row) => row.paymentMethod === filters.paymentMethod);
    return rows;
  }, [payments, filters.link, filters.paymentMethod]);

  const transactions = useMemo(
    () =>
      buildLedgerFinanceTransactions(filteredPayments, expenses, (row) => {
        const label = row.invoiceId
          ? t("finance.invoiceDescription", {
              number: invoices.find((inv) => inv.id === row.invoiceId)?.invoiceNumber ?? row.invoiceId,
              client: invoices.find((inv) => inv.id === row.invoiceId)?.clientName || t("common.noValue"),
            })
          : t("finance.orderDescription", {
              number: orders.find((order) => order.id === row.orderId)?.orderNumber ?? row.orderId ?? "",
            });
        return {
          paymentCategory: row.invoiceId ? t("finance.categories.invoicePayment") : t("finance.categories.orderPayment"),
          refundCategory: t("finance.categories.refund"),
          description: t("finance.paymentDescription", { label }),
        };
      }, currency),
    [filteredPayments, expenses, invoices, orders, currency, t],
  );

  const inPeriod = useMemo(() => ledgerTransactionsInPeriod(transactions, period), [transactions, period]);

  const legacyItems = useMemo(() => findLegacyUnreconciled(orders, invoices, payments), [orders, invoices, payments]);
  const legacyTotal = useMemo(() => legacyUnreconciledTotal(legacyItems), [legacyItems]);

  const outstandingTotal = useMemo(() => {
    const invoicePart = outstandingInvoiceBalances(invoices, payments);
    const orderPart = outstandingOrderBalances(orders, invoices, payments);
    return invoicePart + orderPart.amount;
  }, [invoices, orders, payments]);

  const stats = useMemo(() => ledgerFinancePeriodStats(inPeriod, outstandingTotal, legacyTotal), [inPeriod, outstandingTotal, legacyTotal]);

  const isLoading = paymentsLoading || invoicesLoading || ordersLoading || expensesLoading;
  const hasError = Boolean(
    (paymentsError && !paymentsUnavailable) ||
      (invoicesError && !invoicesUnavailable) ||
      ordersError ||
      (expensesError && !expensesUnavailable),
  );

  return {
    transactions,
    inPeriod,
    stats,
    legacyItems,
    isLoading,
    hasError,
    paymentsError: paymentsUnavailable ? null : paymentsError,
    invoicesError: invoicesUnavailable ? null : invoicesError,
    ordersError,
    expensesError: expensesUnavailable ? null : expensesError,
    paymentsUnavailable,
    invoicesUnavailable,
    expensesUnavailable,
    refetch: () => {
      void refetchPayments();
      void refetchInvoices();
      void refetchOrders();
      void refetchExpenses();
    },
  };
}
