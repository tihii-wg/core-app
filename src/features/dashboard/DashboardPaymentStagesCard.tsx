import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import type { Order } from "../../lib/types";
import { formatWorkspaceDate } from "../../lib/workspaceFormat";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../lib/utils";
import { useGetPayments } from "../finance/usePayments";
import { useWorkspacePaymentStages } from "../finance/useOrderPaymentStages";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { listUpcomingPaymentStages } from "./upcomingPaymentStages";

const PREVIEW_LIMIT = 5;

type DashboardPaymentStagesCardProps = {
  orders: Order[];
  now: Date;
  isOrdersLoading?: boolean;
  onOpenOrder: (order: Order) => void;
};

export function DashboardPaymentStagesCard({
  orders,
  now,
  isOrdersLoading = false,
  onOpenOrder,
}: DashboardPaymentStagesCardProps) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { formatMoney } = useWorkspaceMoney();
  const { stages, isLoading: stagesLoading, error: stagesError } = useWorkspacePaymentStages();
  const { payments, isLoading: paymentsLoading, error: paymentsError, isUnavailable } = useGetPayments();

  const nowKey = now.toDateString();
  const rows = useMemo(
    () => listUpcomingPaymentStages({ orders, stages, payments, today: now }),
    // `now` is rebuilt on every dashboard render; its calendar day is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, stages, payments, nowKey],
  );
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);

  const isLoading = isOrdersLoading || stagesLoading || paymentsLoading;
  const isError = Boolean(stagesError) || (Boolean(paymentsError) && !isUnavailable);
  const preview = rows.slice(0, PREVIEW_LIMIT);
  const overdueCount = rows.filter((row) => row.overdue).length;

  return (
    <section className="min-w-0 rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-info/10 text-info">
            <CalendarClock aria-hidden="true" className="size-3.5" />
          </span>
          <h2 className="truncate text-sm font-semibold text-foreground">{t("dashboard.paymentStages.title")}</h2>
        </div>
        {!isLoading && !isError ? (
          <span
            className={cn(
              "shrink-0 text-sm font-semibold tabular-nums",
              overdueCount > 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {rows.length}
          </span>
        ) : null}
      </div>
      <div className="px-5 pb-5">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : isError ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-[13px] font-medium text-foreground">{t("dashboard.paymentStages.errorTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("dashboard.errors.refreshHint")}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-[13px] font-medium text-foreground">{t("dashboard.paymentStages.emptyTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("dashboard.paymentStages.emptyHint")}</p>
          </div>
        ) : (
          <>
            <ul className="-mx-2 space-y-0.5">
              {preview.map((row) => {
                const order = orderById.get(row.orderId);
                const dueLabel = row.stage.dueDate
                  ? formatWorkspaceDate(row.stage.dueDate, workspace?.dateFormat, workspace?.timezone)
                  : "";
                return (
                  <li key={`${row.orderId}:${row.stage.id ?? row.stage.position}`}>
                    <button
                      type="button"
                      disabled={!order}
                      onClick={() => order && onOpenOrder(order)}
                      className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">
                          <span className="font-medium text-primary tabular-nums">{row.orderNumber}</span>
                          {row.clientName ? ` · ${row.clientName}` : ""}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={row.stage.name}>
                          {row.stage.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={cn(
                            "block text-[13px] font-semibold tabular-nums",
                            row.overdue ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {formatMoney(row.stage.remaining)}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block text-xs tabular-nums",
                            row.overdue ? "font-medium text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {row.overdue ? `${t("dashboard.paymentStages.overdue")} · ${dueLabel}` : dueLabel}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {rows.length > PREVIEW_LIMIT ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("dashboard.deadlines.moreCount", { count: rows.length - PREVIEW_LIMIT })}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
