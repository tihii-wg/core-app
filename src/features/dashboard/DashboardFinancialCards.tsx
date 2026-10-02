import { Clock3, Wallet } from "lucide-react";
import { DashboardCard, TrendBadge } from "../../ui/DashboardCard";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useDashboardFinancials } from "./useDashboardFinancials";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function DashboardFinancialCards({ now }: { now: Date }) {
  const { formatMoney } = useWorkspaceMoney();
  const financials = useDashboardFinancials(now);
  const { isError, isLoading } = financials;

  return (
    <>
      <DashboardCard
        title="Revenue Today"
        value={isError ? "—" : formatMoney(financials.revenueToday)}
        icon={Wallet}
        variant="success"
        isLoading={isLoading}
        footer={
          isError ? (
            "Could not load orders"
          ) : financials.revenueChangeVsYesterday !== null ? (
            <TrendBadge value={financials.revenueChangeVsYesterday} label="vs yesterday" />
          ) : financials.paidOrdersToday > 0 ? (
            `${plural(financials.paidOrdersToday, "paid order")} today`
          ) : (
            "No paid orders today yet"
          )
        }
      />

      <DashboardCard
        title="Outstanding Payments"
        value={isError ? "—" : formatMoney(financials.outstandingAmount)}
        icon={Clock3}
        variant={financials.unpaidOrders > 0 ? "warning" : "default"}
        isLoading={isLoading}
        footer={
          isError
            ? "Could not load orders"
            : financials.unpaidOrders > 0
              ? plural(financials.unpaidOrders, "unpaid order")
              : financials.hasOrders
                ? "All orders are paid"
                : "No orders yet"
        }
      />
    </>
  );
}
