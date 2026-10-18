import { useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { buildInventoryAlerts, type InventoryAlert } from "../features/notifications/inventoryAlerts";
import { buildOrderAlerts, type OrderAlert } from "../features/notifications/orderAlerts";
import { useGetInventoryItems } from "../features/inventory/useGetInventoryItems";
import OrderDetailPanel from "../features/orders/OrderDetailPanel";
import { useGetOrders } from "../features/orders/useGetOrders";
import { useOrderDetails } from "../features/orders/useOrderDetails";
import { localDateKey } from "../pages/dashboardStats";
import { useActiveWorkspaceId } from "../features/profiles/useGetProfile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { cn } from "../lib/utils";

type CombinedAlert =
  | { source: "order"; alert: OrderAlert }
  | { source: "inventory"; alert: InventoryAlert };

export default function AppTopbarNotifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale = "en", workspaceId: routeWorkspaceId } = useParams();
  const { workspaceId } = useActiveWorkspaceId();
  const waitingForWorkspace = !workspaceId;
  const { orders, isLoading: ordersLoading, error: ordersError } = useGetOrders();
  const {
    items: inventoryItems,
    isLoading: inventoryLoading,
    isError: inventoryError,
  } = useGetInventoryItems("", "all", { field: "quantity", ascending: true });
  const orderDetails = useOrderDetails();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);

  const orderAlerts = useMemo(() => buildOrderAlerts(orders, localDateKey(new Date())), [orders]);
  const inventoryAlerts = useMemo(() => buildInventoryAlerts(inventoryItems), [inventoryItems]);

  const combined = useMemo<CombinedAlert[]>(() => {
    const rows: CombinedAlert[] = [
      ...orderAlerts.map((alert) => ({ source: "order" as const, alert })),
      ...inventoryAlerts.map((alert) => ({ source: "inventory" as const, alert })),
    ];
    return rows;
  }, [inventoryAlerts, orderAlerts]);

  const visibleAlerts = useMemo(
    () => combined.filter((row) => !dismissedIds.has(row.alert.id)),
    [combined, dismissedIds],
  );

  const unreadCount = visibleAlerts.length;
  const isLoading = waitingForWorkspace || ordersLoading || inventoryLoading;
  const isError = Boolean(ordersError) || inventoryError;

  const alertTitle = (row: CombinedAlert) => {
    if (row.source === "inventory") {
      if (row.alert.kind === "out_of_stock") {
        return t("nav.notifications.outOfStockItem", { name: row.alert.name });
      }
      return t("nav.notifications.lowStockItem", { name: row.alert.name });
    }
    if (row.alert.kind === "overdue") return t("nav.notifications.overdueOrder", { orderNumber: row.alert.orderNumber });
    if (row.alert.kind === "upcoming") return t("nav.notifications.upcomingDeadline", { orderNumber: row.alert.orderNumber });
    return t("nav.notifications.unassignedOrder", { orderNumber: row.alert.orderNumber });
  };

  const alertDetail = (row: CombinedAlert) => {
    if (row.source === "inventory") {
      return t("nav.notifications.stockDetail", {
        quantity: row.alert.quantity,
        unit: row.alert.unit,
        min: row.alert.minQuantity,
      });
    }
    const client = row.alert.clientName.trim() || t("nav.notifications.unknownClient");
    if (row.alert.kind === "unassigned") {
      return row.alert.deadline
        ? t("nav.notifications.unassignedWithDeadline", { client, deadline: row.alert.deadline })
        : t("nav.notifications.unassignedDetail", { client });
    }
    if (row.alert.deadline) return t("nav.notifications.deadlineDetail", { client, deadline: row.alert.deadline });
    return client;
  };

  const dismissAll = () => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const row of combined) next.add(row.alert.id);
      return next;
    });
  };

  const openAlert = (row: CombinedAlert) => {
    if (row.source === "inventory") {
      if (!routeWorkspaceId) return;
      navigate(`/${locale}/${routeWorkspaceId}/inventory?item=${encodeURIComponent(row.alert.itemId)}`);
      return;
    }
    const order = orders.find((item) => item.id === row.alert.orderId);
    if (order) orderDetails.openOrder(order);
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
            visibleAlerts.map((row) => (
              <DropdownMenuItem
                key={row.alert.id}
                className="flex cursor-pointer flex-col items-start gap-0.5 py-3"
                onSelect={() => openAlert(row)}
              >
                <span
                  className={cn(
                    "text-sm text-foreground",
                    (row.source === "order" && row.alert.kind === "overdue") ||
                      (row.source === "inventory" && row.alert.kind === "out_of_stock")
                      ? "font-medium"
                      : null,
                  )}
                >
                  {alertTitle(row)}
                </span>
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    ((row.source === "order" && row.alert.kind === "overdue") ||
                      (row.source === "inventory" && row.alert.kind === "out_of_stock")) &&
                      "text-destructive",
                  )}
                >
                  {alertDetail(row)}
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
