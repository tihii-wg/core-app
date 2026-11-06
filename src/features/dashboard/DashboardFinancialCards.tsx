import { Clock3, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DashboardCard, TrendBadge } from "../../ui/DashboardCard";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../lib/utils";
import { statCardClassName, statIconVariants, statValueSizeClass, statValueTitle } from "../../ui/statCardStyles";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useDashboardFinancials } from "./useDashboardFinancials";

const toggleCardClass = cn(
  statCardClassName,
  "cursor-pointer hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-pressed:border-primary/50 aria-pressed:ring-1 aria-pressed:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-100 disabled:hover:border-border disabled:hover:shadow-xs",
);

type DashboardFinancialCardsProps = {
  now: Date;
  awaitingActive: boolean;
  onToggleAwaiting: () => void;
};

export function DashboardFinancialCards({ now, awaitingActive, onToggleAwaiting }: DashboardFinancialCardsProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const financials = useDashboardFinancials(now);
  const { isError, isLoading, awaitingPayment } = financials;
  const hasAwaiting = awaitingPayment.totalCount > 0;
  const canToggleAwaiting = awaitingActive || (!isLoading && !isError && hasAwaiting);

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

      <button
        type="button"
        aria-pressed={awaitingActive}
        disabled={!canToggleAwaiting}
        onClick={onToggleAwaiting}
        className={toggleCardClass}
      >
        {awaitingActive ? (
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-muted-foreground">{t("dashboard.stats.outstandingPayments")}</span>
              <span className="mt-2 block text-sm font-medium text-foreground">{t("dashboard.stats.showRecentOrders")}</span>
            </span>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", statIconVariants.warning)}>
              <Clock3 aria-hidden="true" className="size-4" />
            </span>
          </span>
        ) : (
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-muted-foreground">{t("dashboard.stats.outstandingPayments")}</span>
              {isLoading ? (
                <>
                  <Skeleton className="mt-2 h-7 w-28" />
                  <Skeleton className="mt-2.5 h-3 w-20" />
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "mt-1 block truncate leading-8 font-semibold tracking-tight text-foreground tabular-nums",
                      statValueSizeClass(isError ? "—" : formatMoney(financials.outstandingAmount)),
                    )}
                    title={statValueTitle(isError ? "—" : formatMoney(financials.outstandingAmount))}
                  >
                    {isError ? "—" : formatMoney(financials.outstandingAmount)}
                  </span>
                  <span className="mt-1.5 block truncate text-xs text-muted-foreground">
                    {isError
                      ? t("dashboard.errors.orders")
                      : financials.unpaidOrders > 0
                        ? t("dashboard.stats.unpaidOrders", { count: financials.unpaidOrders })
                        : financials.hasOrders
                          ? t("dashboard.stats.allOrdersPaid")
                          : t("dashboard.empty.noOrders")}
                  </span>
                </>
              )}
            </span>
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md",
                financials.unpaidOrders > 0 ? statIconVariants.warning : statIconVariants.default,
              )}
            >
              <Clock3 aria-hidden="true" className="size-4" />
            </span>
          </span>
        )}
      </button>
    </>
  );
}
