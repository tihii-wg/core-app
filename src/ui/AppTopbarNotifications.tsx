import { useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { buildOrderAlerts, undismissedAlerts, type OrderAlert } from "../features/notifications/orderAlerts";
import OrderDetailPanel from "../features/orders/OrderDetailPanel";
import { useGetOrders } from "../features/orders/useGetOrders";
import { useOrderDetails } from "../features/orders/useOrderDetails";
import { localDateKey } from "../pages/dashboardStats";
import { useActiveWorkspaceId } from "../features/profiles/useGetProfile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { cn } from "../lib/utils";

export default function AppTopbarNotifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale = "en", workspaceId: routeWorkspaceId } = useParams();
  const { workspaceId } = useActiveWorkspaceId();
  const waitingForWorkspace = !workspaceId;
  const { orders, isLoading: ordersLoading, error: ordersError } = useGetOrders();
  const orderDetails = useOrderDetails();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);

  const alerts = useMemo(() => buildOrderAlerts(orders, localDateKey(new Date())), [orders]);
  const visibleAlerts = useMemo(() => undismissedAlerts(alerts, dismissedIds), [alerts, dismissedIds]);
  const unreadCount = visibleAlerts.length;
  const isLoading = waitingForWorkspace || ordersLoading;
  const isError = Boolean(ordersError);

  const alertTitle = (alert: OrderAlert) => {
    if (alert.kind === "overdue") return t("nav.notifications.overdueOrder", { orderNumber: alert.orderNumber });
    if (alert.kind === "upcoming") return t("nav.notifications.upcomingDeadline", { orderNumber: alert.orderNumber });
    return t("nav.notifications.unassignedOrder", { orderNumber: alert.orderNumber });
  };

  const alertDetail = (alert: OrderAlert) => {
    const client = alert.clientName.trim() || t("nav.notifications.unknownClient");
    if (alert.kind === "unassigned") {
      return alert.deadline
        ? t("nav.notifications.unassignedWithDeadline", { client, deadline: alert.deadline })
        : t("nav.notifications.unassignedDetail", { client });
    }
    if (alert.deadline) return t("nav.notifications.deadlineDetail", { client, deadline: alert.deadline });
    return client;
  };

  const dismissAll = () => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const alert of alerts) next.add(alert.id);
      return next;
    });
  };

  const openAlert = (alert: OrderAlert) => {
    const order = orders.find((item) => item.id === alert.orderId);
    if (!order) return;
    orderDetails.openOrder(order);
  };

  const viewOrders = () => {
    if (!routeWorkspaceId) return;
    navigate(`/${locale}/${routeWorkspaceId}/orders`);
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              unreadCount > 0
                ? t("nav.notifications.unreadAria", { count: unreadCount })
                : t("nav.notifications.title")
            }
            className="relative"
          >
            <Bell className="size-[18px]" />
            {unreadCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground ring-2 ring-background tabular-nums"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>{t("nav.notifications.title")}</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="text-xs font-normal text-primary hover:underline"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dismissAll();
                }}
              >
                {t("nav.notifications.markAllRead")}
              </button>
            ) : null}
          </DropdownMenuLabel>
          <p className="px-2 pb-2 text-xs text-muted-foreground">{t("nav.notifications.liveHint")}</p>
          <DropdownMenuSeparator />

          {isLoading ? (
            <div className="space-y-2 px-2 py-3">
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ) : isError ? (
            <div className="px-3 py-4 text-center">
              <p className="text-sm font-medium text-foreground">{t("nav.notifications.loadError")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("nav.notifications.loadErrorHint")}</p>
            </div>
          ) : visibleAlerts.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-sm font-medium text-foreground">{t("nav.notifications.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("nav.notifications.emptyHint")}</p>
            </div>
          ) : (
            visibleAlerts.map((alert) => (
              <DropdownMenuItem
                key={alert.id}
                className="flex cursor-pointer flex-col items-start gap-0.5 py-3"
                onSelect={() => openAlert(alert)}
              >
                <span
                  className={cn(
                    "text-sm text-foreground",
                    alert.kind === "overdue" && "font-medium",
                  )}
                >
                  {alertTitle(alert)}
                </span>
                <span className={cn("text-xs text-muted-foreground", alert.kind === "overdue" && "text-destructive")}>
                  {alertDetail(alert)}
                </span>
              </DropdownMenuItem>
            ))
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer justify-center text-center text-primary"
            onSelect={viewOrders}
            disabled={!routeWorkspaceId}
          >
            {t("nav.notifications.viewOrders")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {orderDetails.panelProps.selectedOrder && <OrderDetailPanel {...orderDetails.panelProps} />}
    </>
  );
}
