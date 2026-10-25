import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOrders } from "../../services/apiOrders";
import { getInvoices } from "../../services/apiInvoices";
import { getPayments, PaymentsUnavailableError } from "../../services/apiPayments";
import { localDateKey } from "../../pages/dashboardStats";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { combinedOutstanding, netReceiptsOnDate } from "../finance/paymentCalculations";

export type DashboardFinancials = {
  revenueToday: number;
  paidOrdersToday: number;
  /** Percentage change against yesterday, or null when yesterday has no revenue to compare with. */
  revenueChangeVsYesterday: number | null;
  outstandingAmount: number;
  unpaidOrders: number;
  hasOrders: boolean;
  isLoading: boolean;
  isError: boolean;
};

/**
 * Dashboard financial cards use ledger-confirmed receipts (payments.paid_at)
 * and outstanding balances after ledger payments. Legacy paid flags without
 * ledger rows are excluded from confirmed revenue.
 */
export function useDashboardFinancials(now: Date): DashboardFinancials {
  const { workspaceId } = useActiveWorkspaceId();
  const { currency } = useWorkspaceMoney();
  const {
    data: orders = [],
    isLoading: ordersLoading,
    isError: ordersError,
  } = useQuery({
    queryKey: ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const {
    data: invoices = [],
    isLoading: invoicesLoading,
    isError: invoicesError,
  } = useQuery({
    queryKey: ["invoices", workspaceId],
    queryFn: () => getInvoices(workspaceId),
    enabled: Boolean(workspaceId),
    retry: (failureCount, error) => !(error instanceof Error && error.name === "InvoicesUnavailableError") && failureCount < 3,
  });
  const {
    data: payments = [],
    isLoading: paymentsLoading,
    isError: paymentsError,
    error: paymentsQueryError,
  } = useQuery({
    queryKey: ["payments", workspaceId, {}],
    queryFn: () => getPayments(workspaceId),
    enabled: Boolean(workspaceId),
    retry: (failureCount, error) => !(error instanceof PaymentsUnavailableError) && failureCount < 3,
  });

  const todayKey = localDateKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);

  const revenueToday = useMemo(() => netReceiptsOnDate(payments, todayKey, currency), [payments, todayKey, currency]);
  const revenueYesterday = useMemo(() => netReceiptsOnDate(payments, yesterdayKey, currency), [payments, yesterdayKey, currency]);
  const outstanding = useMemo(() => combinedOutstanding(orders, invoices, payments), [orders, invoices, payments]);

  const paymentsUnavailable = paymentsQueryError instanceof PaymentsUnavailableError;

  return {
    revenueToday,
    paidOrdersToday: payments.filter((row) => row.kind === "payment" && row.paidAt.slice(0, 10) === todayKey).length,
    revenueChangeVsYesterday: revenueYesterday > 0 ? ((revenueToday - revenueYesterday) / revenueYesterday) * 100 : null,
    outstandingAmount: outstanding.amount,
    unpaidOrders: outstanding.unpaidCount,
    hasOrders: orders.length > 0,
    isLoading: ordersLoading || invoicesLoading || paymentsLoading,
    isError: ordersError || invoicesError || (paymentsError && !paymentsUnavailable),
  };
}
