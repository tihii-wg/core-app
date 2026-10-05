import { Clock3, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DashboardCard, TrendBadge } from "../../ui/DashboardCard";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useDashboardFinancials } from "./useDashboardFinancials";

export function DashboardFinancialCards({ now }: { now: Date }) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const financials = useDashboardFinancials(now);
  const { isError, isLoading } = financials;

  return (
    <>
      <DashboardCard
        title={t("dashboard.stats.revenueToday")}
        value={isError ? "—" : formatMoney(financials.revenueToday)}
        icon={Wallet}
        variant="success"
        isLoading={isLoading}
        footer={
          isError ? (
            t("dashboard.errors.orders")
          ) : financials.revenueChangeVsYesterday !== null ? (
            <TrendBadge value={financials.revenueChangeVsYesterday} label={t("dashboard.stats.vsYesterday")} />
          ) : financials.paidOrdersToday > 0 ? (
            t("dashboard.stats.paidOrdersToday", { count: financials.paidOrdersToday })
          ) : (
            t("dashboard.stats.noPaidOrdersToday")
          )
        }
      />

      <DashboardCard
        title={t("dashboard.stats.outstandingPayments")}
        value={isError ? "—" : formatMoney(financials.outstandingAmount)}
        icon={Clock3}
        variant={financials.unpaidOrders > 0 ? "warning" : "default"}
        isLoading={isLoading}
        footer={
          isError
            ? t("dashboard.errors.orders")
            : financials.unpaidOrders > 0
              ? t("dashboard.stats.unpaidOrders", { count: financials.unpaidOrders })
              : financials.hasOrders
                ? t("dashboard.stats.allOrdersPaid")
                : t("dashboard.empty.noOrders")
        }
      />
    </>
  );
}
