import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock } from "lucide-react";
import type { Order } from "../../lib/types";
import { OrderStatusBadge } from "../../ui/StatusBadge";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../lib/utils";
import { listOverdueOrders, listUpcomingOrders } from "../orders/orderVisibility";

const PREVIEW_LIMIT = 5;

type DashboardDeadlinePanelsProps = {
  orders: Order[];
  today: string;
  isLoading?: boolean;
  isError?: boolean;
  onOpenOrder: (order: Order) => void;
};

function PanelShell({
  title,
  count,
  countTone,
  icon: Icon,
  iconTone,
  children,
}: {
  title: string;
  count: number | null;
  countTone: "danger" | "default";
  icon: typeof AlertTriangle;
  iconTone: "danger" | "info";
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              iconTone === "danger" ? "bg-destructive/10 text-destructive" : "bg-info/10 text-info",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </span>
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {count != null ? (
          <span
            className={cn(
              "shrink-0 text-sm font-semibold tabular-nums",
              countTone === "danger" && count > 0 ? "text-destructive" : "text-foreground",
            )}
          >
            {count}
          </span>
        ) : null}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function EmptyMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function DeadlineOrderList({
  orders,
  onOpenOrder,
  emphasizeDeadline,
}: {
  orders: Order[];
  onOpenOrder: (order: Order) => void;
  emphasizeDeadline: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ul className="-mx-2 space-y-0.5">
      {orders.map((order) => {
        const assignee = order.assignedEmployeeName?.trim();
        return (
          <li key={order.id}>
            <button
              type="button"
              onClick={() => onOpenOrder(order)}
              className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-primary tabular-nums text-[13px]">{order.orderNumber}</span>
                  <OrderStatusBadge status={order.status} />
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-foreground" title={order.clientName}>
                  {order.clientName}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  <span className={cn("tabular-nums", emphasizeDeadline && "font-medium text-destructive")}>{order.deadline}</span>
                  {assignee ? ` · ${assignee}` : ` · ${t("orders.detail.unassigned")}`}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function DashboardDeadlinePanels({ orders, today, isLoading = false, isError = false, onOpenOrder }: DashboardDeadlinePanelsProps) {
  const { t } = useTranslation();
  const overdue = listOverdueOrders(orders, today);
  const upcoming = listUpcomingOrders(orders, today);
  const overduePreview = overdue.slice(0, PREVIEW_LIMIT);
  const upcomingPreview = upcoming.slice(0, PREVIEW_LIMIT);

  if (isLoading) {
    return (
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <PanelShell title={t("dashboard.deadlines.overdueTitle")} count={null} countTone="danger" icon={AlertTriangle} iconTone="danger">
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </PanelShell>
        <PanelShell title={t("dashboard.deadlines.upcomingTitle")} count={null} countTone="default" icon={CalendarClock} iconTone="info">
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </PanelShell>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <PanelShell title={t("dashboard.deadlines.overdueTitle")} count={null} countTone="danger" icon={AlertTriangle} iconTone="danger">
          <EmptyMessage title={t("dashboard.errors.orders")} description={t("dashboard.errors.refreshHint")} />
        </PanelShell>
        <PanelShell title={t("dashboard.deadlines.upcomingTitle")} count={null} countTone="default" icon={CalendarClock} iconTone="info">
          <EmptyMessage title={t("dashboard.errors.orders")} description={t("dashboard.errors.refreshHint")} />
        </PanelShell>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <PanelShell title={t("dashboard.deadlines.overdueTitle")} count={overdue.length} countTone="danger" icon={AlertTriangle} iconTone="danger">
        {overdue.length === 0 ? (
          <EmptyMessage title={t("dashboard.deadlines.emptyOverdue")} description={t("dashboard.deadlines.emptyOverdueHint")} />
        ) : (
          <>
            <DeadlineOrderList orders={overduePreview} onOpenOrder={onOpenOrder} emphasizeDeadline />
            {overdue.length > PREVIEW_LIMIT ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.deadlines.moreCount", { count: overdue.length - PREVIEW_LIMIT })}</p>
            ) : null}
          </>
        )}
      </PanelShell>

      <PanelShell title={t("dashboard.deadlines.upcomingTitle")} count={upcoming.length} countTone="default" icon={CalendarClock} iconTone="info">
        {upcoming.length === 0 ? (
          <EmptyMessage title={t("dashboard.deadlines.emptyUpcoming")} description={t("dashboard.deadlines.emptyUpcomingHint")} />
        ) : (
          <>
            <DeadlineOrderList orders={upcomingPreview} onOpenOrder={onOpenOrder} emphasizeDeadline={false} />
            {upcoming.length > PREVIEW_LIMIT ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.deadlines.moreCount", { count: upcoming.length - PREVIEW_LIMIT })}</p>
            ) : null}
          </>
        )}
      </PanelShell>
    </div>
  );
}
