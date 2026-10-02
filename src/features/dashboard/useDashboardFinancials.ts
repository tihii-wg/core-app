import { useQuery } from "@tanstack/react-query";
import { getOrders } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { outstandingPaymentStats, todayRevenueStats } from "../../pages/dashboardStats";

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

// Both Dashboard financial cards read from this hook. They are derived from the workspace's
// real orders (`is_paid`) until the Finance/Invoices data model exists; switching the source
// later only requires changing this hook.
export function useDashboardFinancials(now: Date): DashboardFinancials {
  const { workspaceId } = useActiveWorkspaceId();
  const {
    data: orders = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const today = todayRevenueStats(orders, now);
  const outstanding = outstandingPaymentStats(orders);

  return {
    revenueToday: today.revenue,
    paidOrdersToday: today.paidOrders,
    revenueChangeVsYesterday: today.changeVsYesterday,
    outstandingAmount: outstanding.amount,
    unpaidOrders: outstanding.orders,
    hasOrders: orders.length > 0,
    isLoading,
    isError,
  };
}
