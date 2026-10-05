import { ClipboardList, Package, Pencil, Plus, UserPlus, ArrowLeft, ArrowRight, FileText, RefreshCw, Activity } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { DataTable, type Column } from "../ui/DataTable";
import type { InventoryItem, Order } from "../lib/types";
import { statCardClassName, statIconVariants } from "../ui/statCardStyles";
import { Button } from "../ui/Button";
import { useApp } from "../lib/appContext";
import { InventoryStatusBadge, OrderStatusBadge, PaymentStatusBadge } from "../ui/StatusBadge";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { PageHeader } from "./PageHeader";
import { getOrders } from "../services/apiOrders";
import { getClients } from "../services/apiClients";
import {
  clientCreatedAt,
  isAtOrBelowMinimum,
  localDateKey,
  recentActivity,
  relativeDayLabel,
  taskOverviewCounts,
  thisWeekStats,
  type ActivityItem,
} from "./dashboardStats";
import { useGetInventoryItems } from "../features/inventory/useGetInventoryItems";
import { useWorkspaceMoney } from "../features/workspaces/useWorkspaceMoney";
import { useActiveWorkspaceId } from "../features/profiles/useGetProfile";
import { CreateOrderDialog } from "../features/orders/CreateOrderDialog";
import { AddClientDialog } from "../features/clients/AddClientDialog";
import { AddInventoryItemDialog } from "../features/inventory/AddInventoryItemDialog";
import ClientTypeBadge from "../features/clients/ClientTypeBadge";
import OrderDetailPanel from "../features/orders/OrderDetailPanel";
import { useOrderDetails } from "../features/orders/useOrderDetails";
import { EditInventoryItemDialog } from "../features/inventory/EditInventoryItemDialog";
import { quantityClass } from "../features/inventory/inventoryDisplay";
import { DashboardFinancialCards } from "../features/dashboard/DashboardFinancialCards";
import { cn } from "../lib/utils";
import { currentIntlLocale } from "../i18n";

type QuickActionDialog = "order" | "client" | "inventory";

const toggleCardClass = cn(
  statCardClassName,
  "cursor-pointer hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-pressed:border-primary/50 aria-pressed:ring-1 aria-pressed:ring-primary/25"
);

function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-card shadow-xs", className)}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function PanelMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { setCurrentModule } = useApp();
  const { workspaceId } = useActiveWorkspaceId();
  const [openDialog, setOpenDialog] = useState<QuickActionDialog | null>(null);
  const orderDetails = useOrderDetails();
  const [listView, setListView] = useState<"recent" | "active" | "lowStock">("recent");
  const showActiveOrders = listView === "active";
  const showLowStock = listView === "lowStock";
  const [editInventoryId, setEditInventoryId] = useState<string | null>(null);
  const { locale = "en", workspaceId: routeWorkspaceId } = useParams();
  const dialogProps = (dialog: QuickActionDialog) => ({
    open: openDialog === dialog,
    onOpenChange: (open: boolean) => setOpenDialog(open ? dialog : null),
  });
  const { formatMoney } = useWorkspaceMoney();
  const {
    data: workspaceOrders = [],
    isLoading: ordersLoading,
    isError: ordersError,
    refetch: refetchOrders,
    isRefetching: ordersRefetching,
  } = useQuery({
    queryKey: ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId),
    enabled: Boolean(workspaceId),
  });
  const {
    data: workspaceClients = [],
    isLoading: clientsLoading,
    isError: clientsError,
  } = useQuery({
    queryKey: ["clients", workspaceId, ""],
    queryFn: () => getClients("", workspaceId),
    enabled: Boolean(workspaceId),
  });

  const now = new Date();
  const today = localDateKey(now);
  const taskOverview = taskOverviewCounts(workspaceOrders, today);
  const week = thisWeekStats(
    workspaceOrders,
    workspaceClients.map((client) => ({ createdAt: clientCreatedAt(client) })),
    now,
  );
  const weekPeak = Math.max(...week.days.map((day) => day.count), 0);
  const taskTotal = taskOverview.total;
  const taskRows = [
    { key: "inProgress", label: t("status.order.in-progress"), count: taskOverview.inProgress, color: "bg-warning" },
    { key: "waitingParts", label: t("status.order.waiting-parts"), count: taskOverview.waitingParts, color: "bg-chart-4" },
    { key: "completedToday", label: t("dashboard.tasks.completedToday"), count: taskOverview.completedToday, color: "bg-success" },
  ];

  const closedStatuses = ["completed", "paid", "cancelled"];
  const activeOrders = workspaceOrders.filter((order) => !closedStatuses.includes(order.status));
  const orderCardCount = showActiveOrders ? workspaceOrders.length : activeOrders.length;

  const activity = recentActivity(workspaceOrders, workspaceClients, 6);

  const {
    items: inventoryItems,
    isLoading: inventoryLoading,
    isError: inventoryError,
  } = useGetInventoryItems("", "all", { field: "created_at", ascending: false });
  const lowStockItems = inventoryItems.filter(isAtOrBelowMinimum);
  const lowStockCount = lowStockItems.length;

  const listedOrders = showActiveOrders ? activeOrders : workspaceOrders.slice(0, 5);

  const openActivity = (event: ActivityItem) => {
    if (event.kind === "client-created") return;
    const order = workspaceOrders.find((item) => item.id === event.orderId);
    if (order) orderDetails.openOrder(order);
  };

  const orderColumns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: t("dashboard.columns.order"),
      cell: (order) => <span className="font-medium text-primary tabular-nums">{order.orderNumber}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: t("dashboard.columns.client"),
      cell: (order) => <span className="block max-w-[10rem] truncate xl:max-w-[14rem]" title={order.clientName}>{order.clientName}</span>,
    },
    {
      key: "clientType",
      header: t("dashboard.columns.clientType"),
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
      className: "hidden xl:table-cell",
    },
    {
      key: "device",
      header: t("dashboard.columns.device"),
      cell: (order) => <span className="block max-w-[12rem] truncate text-muted-foreground" title={order.device}>{order.device}</span>,
      className: "hidden 2xl:table-cell",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (order) => <OrderStatusBadge status={order.status} />,
    },
    {
      key: "payment",
      header: t("dashboard.columns.payment"),
      cell: (order) => <PaymentStatusBadge status={order.paymentStatus} />,
      className: "hidden sm:table-cell",
    },
    {
      key: "total",
      header: t("common.total"),
      cell: (order) => <span className="font-medium tabular-nums">{formatMoney(order.totalPrice)}</span>,
      className: "text-right whitespace-nowrap",
    },
  ];

  const lowStockColumns: Column<InventoryItem>[] = [
    {
      key: "name",
      header: t("dashboard.columns.name"),
      cell: (item) => <span className="block max-w-[16rem] truncate font-medium text-foreground" title={item.name}>{item.name}</span>,
    },
    {
      key: "sku",
      header: t("dashboard.columns.sku"),
      cell: (item) => <span className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</span>,
      className: "hidden sm:table-cell",
    },
    {
      key: "quantity",
      header: t("dashboard.columns.quantity"),
      cell: (item) => (
        <span className={cn("tabular-nums", quantityClass(item))}>
          {item.quantity} {item.unit}
        </span>
      ),
      className: "text-right",
    },
    {
      key: "minQuantity",
      header: t("dashboard.columns.minimum"),
      cell: (item) => <span className="tabular-nums text-muted-foreground">{`${item.minQuantity} ${item.unit}`}</span>,
      className: "hidden sm:table-cell text-right",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (item) => <InventoryStatusBadge status={item.stockStatus} />,
    },
    {
      key: "actions",
      header: t("common.actions"),
      className: "w-[80px] text-right",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("dashboard.editItem", { name: item.name })}
            onClick={(event) => {
              event.stopPropagation();
              setEditInventoryId(item.id);
            }}
          >
            <Pencil />
          </Button>
        </div>
      ),
    },
  ];

  const quickActions = [
    { key: "order", label: t("dashboard.quickActions.createOrder"), icon: ClipboardList, onClick: () => setOpenDialog("order") },
    { key: "client", label: t("dashboard.quickActions.addClient"), icon: UserPlus, onClick: () => setOpenDialog("client") },
    { key: "inventory", label: t("dashboard.quickActions.addInventory"), icon: Package, onClick: () => setOpenDialog("inventory") },
    { key: "invoice", label: t("dashboard.quickActions.createInvoice"), icon: FileText, onClick: () => setCurrentModule("invoices") },
  ];

  const refreshHint = t("dashboard.errors.refreshHint");

  const viewAllLink = (to: string) => (
    <Link to={to} className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
      {t("dashboard.viewAll")}
      <ArrowRight className="size-3.5" />
    </Link>
  );

  const ordersErrorState = (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <p className="text-sm font-semibold text-foreground">{t("dashboard.errors.orders")}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{refreshHint}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => refetchOrders()} loading={ordersRefetching}>
        {!ordersRefetching && <RefreshCw />}
        {t("dashboard.retry")}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("dashboard.title")} description={now.toLocaleDateString(currentIntlLocale(), { weekday: "long", month: "long", day: "numeric" })} />

      {/* Key figures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          aria-pressed={showActiveOrders}
          onClick={() => setListView((current) => (current === "active" ? "recent" : "active"))}
          className={toggleCardClass}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-muted-foreground">{showActiveOrders ? t("dashboard.stats.allOrders") : t("dashboard.stats.activeOrders")}</span>
              {ordersLoading ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : ordersError ? (
                <>
                  <span className="mt-2 block text-sm font-medium text-foreground">{t("dashboard.errors.orders")}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{refreshHint}</span>
                </>
              ) : orderCardCount === 0 ? (
                <>
                  <span className="mt-2 block text-sm font-medium text-foreground">{showActiveOrders ? t("dashboard.empty.noOrders") : t("dashboard.empty.noActiveOrders")}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{showActiveOrders ? t("dashboard.empty.noOrdersHint") : t("dashboard.empty.openOrdersHint")}</span>
                </>
              ) : (
                <span className="mt-1 block text-2xl leading-8 font-semibold tracking-tight text-foreground tabular-nums">{orderCardCount}</span>
              )}
            </span>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", statIconVariants.primary)}>
              <ClipboardList aria-hidden="true" className="size-4" />
            </span>
          </span>
        </button>

        <DashboardFinancialCards now={now} />

        <button
          type="button"
          aria-pressed={showLowStock}
          onClick={() => setListView((current) => (current === "lowStock" ? "recent" : "lowStock"))}
          className={toggleCardClass}
        >
          {showLowStock ? (
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-muted-foreground">{t("common.back")}</span>
                <span className="mt-2 block text-sm font-medium text-foreground">{t("dashboard.stats.showRecentOrders")}</span>
              </span>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", statIconVariants.primary)}>
                <ArrowLeft aria-hidden="true" className="size-4" />
              </span>
            </span>
          ) : (
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-muted-foreground">{t("dashboard.stats.lowStockItems")}</span>
                {inventoryLoading ? (
                  <Skeleton className="mt-2 h-7 w-12" />
                ) : inventoryError ? (
                  <>
                    <span className="mt-2 block text-sm font-medium text-foreground">{t("dashboard.errors.inventory")}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{refreshHint}</span>
                  </>
                ) : lowStockCount === 0 ? (
                  <>
                    <span className="mt-2 block text-sm font-medium text-foreground">{t("dashboard.empty.noLowStock")}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{t("dashboard.empty.lowStockHint")}</span>
                  </>
                ) : (
                  <span className="mt-1 block text-2xl leading-8 font-semibold tracking-tight text-destructive tabular-nums">{lowStockCount}</span>
                )}
              </span>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", lowStockCount > 0 ? statIconVariants.danger : statIconVariants.default)}>
                <Package aria-hidden="true" className="size-4" />
              </span>
            </span>
          )}
        </button>
      </div>

      {/* Quick Actions */}
      <section aria-labelledby="dashboard-quick-actions" className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <h2 id="dashboard-quick-actions" className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
          {t("dashboard.quickActions.title")}
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {quickActions.map(({ key, label, icon: Icon, onClick }) => (
            <Button key={key} onClick={onClick} variant="outline" className="h-10 justify-start gap-2.5 px-3 font-medium">
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="truncate">{label}</span>
              <Plus aria-hidden="true" className="ml-auto hidden size-3.5 shrink-0 text-subtle-foreground xl:block" />
            </Button>
          ))}
        </div>
      </section>

      <CreateOrderDialog {...dialogProps("order")} />
      <AddClientDialog {...dialogProps("client")} />
      <AddInventoryItemDialog {...dialogProps("inventory")} />
      <OrderDetailPanel {...orderDetails.panelProps} />
      <EditInventoryItemDialog itemId={editInventoryId} onClose={() => setEditInventoryId(null)} />

      <div className="space-y-6">
        {showLowStock ? (
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">{t("dashboard.lists.lowStockItems")}</h2>
              {viewAllLink(`/${locale}/${routeWorkspaceId}/inventory`)}
            </div>
            <DataTable
              columns={lowStockColumns}
              data={lowStockItems}
              keyExtractor={(item) => item.id}
              onRowClick={(item) => setEditInventoryId(item.id)}
              isLoading={inventoryLoading}
              emptyState={
                inventoryError ? (
                  <EmptyState icon={Package} title={t("dashboard.errors.inventory")} description={refreshHint} />
                ) : (
                  <EmptyState icon={Package} title={t("dashboard.empty.noLowStock")} description={t("dashboard.empty.lowStockHint")} />
                )
              }
            />
          </div>
        ) : (
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">{showActiveOrders ? t("dashboard.lists.activeOrders") : t("dashboard.lists.recentOrders")}</h2>
              {viewAllLink(`/${locale}/${routeWorkspaceId}/orders`)}
            </div>
            <DataTable
              columns={orderColumns}
              data={listedOrders}
              keyExtractor={(order) => order.id}
              onRowClick={orderDetails.openOrder}
              isLoading={ordersLoading}
              emptyState={
                ordersError ? (
                  ordersErrorState
                ) : showActiveOrders ? (
                  <EmptyState icon={ClipboardList} title={t("dashboard.empty.noActiveOrders")} description={t("dashboard.empty.openOrdersHint")} />
                ) : (
                  <EmptyState icon={ClipboardList} title={t("dashboard.empty.noOrders")} description={t("dashboard.empty.noOrdersHint")} />
                )
              }
            />
          </div>
        )}

        <div className="grid min-w-0 items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Panel title={t("dashboard.activity.title")} className="md:col-span-2 xl:col-span-1">
            {ordersLoading || clientsLoading ? (
              <PanelSkeleton rows={4} />
            ) : ordersError && clientsError ? (
              <PanelMessage title={t("dashboard.errors.activity")} description={refreshHint} />
            ) : activity.length === 0 ? (
              <div className="flex flex-col items-center py-4 text-center">
                <Activity aria-hidden="true" className="size-5 text-subtle-foreground" />
                <p className="mt-2 text-[13px] font-medium text-foreground">{t("dashboard.activity.empty")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("dashboard.activity.emptyHint")}</p>
              </div>
            ) : (
              <ol className="-mx-2 space-y-0.5">
                {activity.map((event) => {
                  const isOrder = event.kind !== "client-created";
                  const content = (
                    <>
                      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", isOrder ? "bg-primary/10 text-primary" : "bg-chart-4/10 text-chart-4")}>
                        {isOrder ? <ClipboardList aria-hidden="true" className="size-3.5" /> : <UserPlus aria-hidden="true" className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">
                          {event.kind === "order-created" && (
                            <Trans
                              i18nKey="dashboard.activity.orderCreated"
                              values={{ orderNumber: event.orderNumber }}
                              components={{ highlight: <span className="font-medium tabular-nums" /> }}
                            />
                          )}
                          {event.kind === "order-updated" && (
                            <Trans
                              i18nKey="dashboard.activity.orderUpdated"
                              values={{ orderNumber: event.orderNumber }}
                              components={{ highlight: <span className="font-medium tabular-nums" /> }}
                            />
                          )}
                          {event.kind === "client-created" && (
                            <Trans
                              i18nKey="dashboard.activity.clientCreated"
                              values={{ clientName: event.clientName }}
                              components={{ highlight: <span className="font-medium" /> }}
                            />
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {relativeDayLabel(event.date, now)}
                          {isOrder && event.clientName ? ` · ${event.clientName}` : ""}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={event.key}>
                      {isOrder ? (
                        <button
                          type="button"
                          onClick={() => openActivity(event)}
                          className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex items-start gap-3 px-2 py-1.5">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          <Panel title={t("dashboard.tasks.title")}>
            {ordersLoading ? (
              <PanelSkeleton />
            ) : ordersError ? (
              <PanelMessage title={t("dashboard.errors.tasks")} description={refreshHint} />
            ) : workspaceOrders.length === 0 ? (
              <PanelMessage title={t("dashboard.tasks.empty")} description={t("dashboard.empty.openOrdersHint")} />
            ) : (
              <>
                <div className="space-y-2.5">
                  {taskRows.map((task) => (
                    <div key={task.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className={cn("size-2 rounded-full", task.color)} />
                        <span className="text-[13px] text-foreground">{task.label}</span>
                      </div>
                      <span className="text-[13px] font-medium text-foreground tabular-nums">{task.count}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted">
                    {taskRows.map((task) => (
                      <div
                        key={task.key}
                        className={cn("h-full first:rounded-l-full last:rounded-r-full", task.color)}
                        style={{ width: taskTotal === 0 ? "0%" : `${(task.count / taskTotal) * 100}%` }}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.tasks.totalToday", { count: taskTotal })}</p>
                </div>
              </>
            )}
          </Panel>

          <Panel title={t("dashboard.week.title")}>
            {ordersLoading || clientsLoading ? (
              <PanelSkeleton />
            ) : ordersError ? (
              <PanelMessage title={t("dashboard.errors.week")} description={refreshHint} />
            ) : week.isEmpty && !clientsError ? (
              <PanelMessage title={t("dashboard.tasks.empty")} description={t("dashboard.week.emptyHint")} />
            ) : (
              <>
                <dl className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[13px] text-muted-foreground">{t("dashboard.week.revenue")}</dt>
                    <dd className="truncate text-[13px] font-semibold text-success tabular-nums">{formatMoney(week.revenue)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[13px] text-muted-foreground">{t("dashboard.week.orders")}</dt>
                    <dd className="text-[13px] font-medium text-foreground tabular-nums">{week.orders}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[13px] text-muted-foreground">{t("dashboard.week.newClients")}</dt>
                    <dd className="text-[13px] font-medium text-foreground tabular-nums">{clientsError ? t("dashboard.errors.generic") : week.newClients}</dd>
                  </div>
                </dl>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex h-16 items-end justify-between gap-1.5">
                    {week.days.map((day) => (
                      <div
                        key={day.date}
                        className={cn("min-h-[3px] flex-1 rounded-sm transition-colors", day.date === today ? "bg-primary" : "bg-primary/20 hover:bg-primary/40")}
                        style={{ height: weekPeak === 0 ? "0%" : `${(day.count / weekPeak) * 100}%` }}
                        title={t("dashboard.week.ordersCount", { count: day.count })}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between gap-1.5">
                    {week.days.map((day) => (
                      <span key={day.date} className={cn("flex-1 text-center text-[11px]", day.date === today ? "font-medium text-foreground" : "text-subtle-foreground")}>
                        {day.label}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
