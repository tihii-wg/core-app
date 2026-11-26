import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { getOrderBalanceHeaders } from "../../services/apiOrders";
import { getLedgerBalanceRows, PaymentsUnavailableError } from "../../services/apiPayments";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useRealtimeHotQueryOptions } from "../realtime/useRealtimeHotQueryOptions";
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
import type { LedgerPayment, LedgerPaymentMethod, PaymentListFilters } from "./paymentTypes";
import type { ReportPeriod } from "../reports/reportStats";

const EMPTY_ORDERS: Awaited<ReturnType<typeof getOrderBalanceHeaders>> = [];

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
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();
  const dates = useMemo(() => ({ from: period.start, to: period.end }), [period.start, period.end]);
  // Table + period totals: only the ledger rows / expenses dated in the selected period.
  const {
    payments: periodPayments,
    isLoading: periodPaymentsLoading,
    error: periodPaymentsError,
    isUnavailable: periodPaymentsUnavailable,
    refetch: refetchPeriodPayments,
  } = useGetPayments({ paidFrom: dates.from, paidTo: dates.to });
  // Outstanding / legacy totals are a workspace snapshot (not period-bound): balance-only columns of the ledger and
  // the orders, read in the same parallel wave instead of the full rows.
  const balanceLedgerQuery = useQuery({
    queryKey: ["payments", workspaceId, "balance-rows"],
    queryFn: () => getLedgerBalanceRows(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    ...hot,
    retry: (failureCount, error) => !(error instanceof PaymentsUnavailableError) && failureCount < 3,
  });
  const ordersQuery = useQuery({
    queryKey: ["orders", workspaceId, "balance-headers"],
    queryFn: () => getOrderBalanceHeaders(workspaceId),
    enabled: Boolean(workspaceId),
    ...hot,
  });
  const orders = ordersQuery.data ?? EMPTY_ORDERS;
  const balanceUnavailable = balanceLedgerQuery.error instanceof PaymentsUnavailableError;
  const paymentsUnavailable = periodPaymentsUnavailable || balanceUnavailable;
  const paymentsError = periodPaymentsError ?? balanceLedgerQuery.error;
  const paymentsLoading = periodPaymentsLoading || balanceLedgerQuery.isLoading;
  const ordersLoading = ordersQuery.isLoading;
  const ordersError = ordersQuery.error;
  /** Every ledger row (balance columns), with the full rows of the period on top — refund / void checks need the
   *  related rows even when they fall outside the period. */
  const payments = useMemo(() => {
    const byId = new Map<string, LedgerPayment>();
    for (const row of balanceLedgerQuery.data ?? []) byId.set(row.id, row);
    for (const row of periodPayments) byId.set(row.id, row);
    return [...byId.values()];
  }, [balanceLedgerQuery.data, periodPayments]);
  const {
    invoices,
    isLoading: invoicesLoading,
    error: invoicesError,
    isUnavailable: invoicesUnavailable,
    refetch: refetchInvoices,
  } = useGetInvoices();
  const {
    expenses,
    isLoading: expensesLoading,
    error: expensesError,
    isUnavailable: expensesUnavailable,
    refetch: refetchExpenses,
  } = useGetExpenses(dates);

  const filteredPayments = useMemo(() => {
    let rows = periodPayments;
    if (filters.link === "invoice") rows = rows.filter((row) => Boolean(row.invoiceId));
    if (filters.link === "no-invoice") rows = rows.filter((row) => !row.invoiceId);
    if (filters.paymentMethod) rows = rows.filter((row) => row.paymentMethod === filters.paymentMethod);
    return rows;
  }, [periodPayments, filters.link, filters.paymentMethod]);

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
          voidCategory: t("finance.categories.void"),
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
    /** Every workspace ledger row (balance columns; full rows for the period) — refundable balance / refund dialog. */
    payments,
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
      void refetchPeriodPayments();
      void balanceLedgerQuery.refetch();
      void refetchInvoices();
      void ordersQuery.refetch();
      void refetchExpenses();
    },
  };
}
