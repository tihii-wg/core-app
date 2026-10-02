import { ClipboardList, Package, Pencil, Plus, UserPlus, ArrowLeft, ArrowRight, FileText, RefreshCw, Activity } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
    { label: "In Progress", count: taskOverview.inProgress, color: "bg-warning" },
    { label: "Waiting Parts", count: taskOverview.waitingParts, color: "bg-chart-4" },
    { label: "Completed Today", count: taskOverview.completedToday, color: "bg-success" },
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
      header: "Order",
      cell: (order) => <span className="font-medium text-primary tabular-nums">{order.orderNumber}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "client",
      header: "Client",
      cell: (order) => <span className="block max-w-[10rem] truncate xl:max-w-[14rem]" title={order.clientName}>{order.clientName}</span>,
    },
    {
      key: "clientType",
      header: "Client Type",
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
      className: "hidden xl:table-cell",
    },
    {
      key: "device",
      header: "Device",
      cell: (order) => <span className="block max-w-[12rem] truncate text-muted-foreground" title={order.device}>{order.device}</span>,
      className: "hidden 2xl:table-cell",
    },
    {
      key: "status",
      header: "Status",
      cell: (order) => <OrderStatusBadge status={order.status} />,
    },
    {
      key: "payment",
      header: "Payment",
      cell: (order) => <PaymentStatusBadge status={order.paymentStatus} />,
      className: "hidden sm:table-cell",
    },
    {
      key: "total",
      header: "Total",
      cell: (order) => <span className="font-medium tabular-nums">{formatMoney(order.totalPrice)}</span>,
      className: "text-right whitespace-nowrap",
    },
  ];

  const lowStockColumns: Column<InventoryItem>[] = [
    {
      key: "name",
      header: "Name",
      cell: (item) => <span className="block max-w-[16rem] truncate font-medium text-foreground" title={item.name}>{item.name}</span>,
    },
    {
      key: "sku",
      header: "SKU",
      cell: (item) => <span className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</span>,
      className: "hidden sm:table-cell",
    },
    {
      key: "quantity",
      header: "Quantity",
      cell: (item) => (
        <span className={cn("tabular-nums", quantityClass(item))}>
          {item.quantity} {item.unit}
        </span>
      ),
      className: "text-right",
    },
    {
      key: "minQuantity",
      header: "Minimum",
      cell: (item) => <span className="tabular-nums text-muted-foreground">{`${item.minQuantity} ${item.unit}`}</span>,
      className: "hidden sm:table-cell text-right",
    },
    {
      key: "status",
      header: "Status",
      cell: (item) => <InventoryStatusBadge status={item.stockStatus} />,
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[80px] text-right",
      cell: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${item.name}`}
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
    { label: "Create Order", icon: ClipboardList, onClick: () => setOpenDialog("order") },
    { label: "Add Client", icon: UserPlus, onClick: () => setOpenDialog("client") },
    { label: "Add Inventory", icon: Package, onClick: () => setOpenDialog("inventory") },
    { label: "Create Invoice", icon: FileText, onClick: () => setCurrentModule("invoices") },
  ];

  const viewAllLink = (to: string) => (
    <Link to={to} className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
      View all
      <ArrowRight className="size-3.5" />
    </Link>
  );

  const ordersErrorState = (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <p className="text-sm font-semibold text-foreground">Could not load orders</p>
      <p className="mt-1 text-[13px] text-muted-foreground">Refresh the page to try again.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => refetchOrders()} loading={ordersRefetching}>
        {!ordersRefetching && <RefreshCw />}
        Retry
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} />

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
              <span className="block text-[13px] font-medium text-muted-foreground">{showActiveOrders ? "All Orders" : "Active Orders"}</span>
              {ordersLoading ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : ordersError ? (
                <>
                  <span className="mt-2 block text-sm font-medium text-foreground">Could not load orders</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Refresh the page to try again.</span>
                </>
              ) : orderCardCount === 0 ? (
                <>
                  <span className="mt-2 block text-sm font-medium text-foreground">{showActiveOrders ? "No orders yet" : "No active orders"}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{showActiveOrders ? "Orders you create will show up here." : "Open orders will show up here."}</span>
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
                <span className="block text-[13px] font-medium text-muted-foreground">Back</span>
                <span className="mt-2 block text-sm font-medium text-foreground">Show Recent Orders</span>
              </span>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", statIconVariants.primary)}>
                <ArrowLeft aria-hidden="true" className="size-4" />
              </span>
            </span>
          ) : (
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-muted-foreground">Low Stock Items</span>
                {inventoryLoading ? (
                  <Skeleton className="mt-2 h-7 w-12" />
                ) : inventoryError ? (
                  <>
                    <span className="mt-2 block text-sm font-medium text-foreground">Could not load inventory</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Refresh the page to try again.</span>
                  </>
                ) : lowStockCount === 0 ? (
                  <>
                    <span className="mt-2 block text-sm font-medium text-foreground">No low stock items</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Items at or below their minimum will show up here.</span>
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
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {quickActions.map(({ label, icon: Icon, onClick }) => (
            <Button key={label} onClick={onClick} variant="outline" className="h-10 justify-start gap-2.5 px-3 font-medium">
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
              <h2 className="text-[15px] font-semibold text-foreground">Low Stock Items</h2>
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
                  <EmptyState icon={Package} title="Could not load inventory" description="Refresh the page to try again." />
                ) : (
                  <EmptyState icon={Package} title="No low stock items" description="Items at or below their minimum will show up here." />
                )
              }
            />
          </div>
        ) : (
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">{showActiveOrders ? "Active Orders" : "Recent Orders"}</h2>
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
                  <EmptyState icon={ClipboardList} title="No active orders" description="Open orders will show up here." />
                ) : (
                  <EmptyState icon={ClipboardList} title="No orders yet" description="Orders you create will show up here." />
                )
              }
            />
          </div>
        )}

        <div className="grid min-w-0 items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Panel title="Recent Activity" className="md:col-span-2 xl:col-span-1">
            {ordersLoading || clientsLoading ? (
              <PanelSkeleton rows={4} />
            ) : ordersError && clientsError ? (
              <PanelMessage title="Could not load activity" description="Refresh the page to try again." />
            ) : activity.length === 0 ? (
              <div className="flex flex-col items-center py-4 text-center">
                <Activity aria-hidden="true" className="size-5 text-subtle-foreground" />
                <p className="mt-2 text-[13px] font-medium text-foreground">No recent activity yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">New orders and clients will show up here.</p>
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
                            <>
                              New order <span className="font-medium tabular-nums">{event.orderNumber}</span>
                            </>
                          )}
                          {event.kind === "order-updated" && (
                            <>
                              <span className="font-medium tabular-nums">{event.orderNumber}</span> updated
                            </>
                          )}
                          {event.kind === "client-created" && (
                            <>
                              New client <span className="font-medium">{event.clientName}</span>
                            </>
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

          <Panel title="Task Overview">
            {ordersLoading ? (
              <PanelSkeleton />
            ) : ordersError ? (
              <PanelMessage title="Could not load tasks" description="Refresh the page to try again." />
            ) : workspaceOrders.length === 0 ? (
              <PanelMessage title="No tasks yet" description="Open orders will show up here." />
            ) : (
              <>
                <div className="space-y-2.5">
                  {taskRows.map((task) => (
                    <div key={task.label} className="flex items-center justify-between">
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
                        key={task.label}
                        className={cn("h-full first:rounded-l-full last:rounded-r-full", task.color)}
                        style={{ width: taskTotal === 0 ? "0%" : `${(task.count / taskTotal) * 100}%` }}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {taskTotal} total {taskTotal === 1 ? "task" : "tasks"} today
                  </p>
                </div>
              </>
            )}
          </Panel>

          <Panel title="This Week">
            {ordersLoading || clientsLoading ? (
              <PanelSkeleton />
            ) : ordersError ? (
              <PanelMessage title="Could not load this week" description="Refresh the page to try again." />
            ) : week.isEmpty && !clientsError ? (
              <PanelMessage title="No tasks yet" description="Orders and clients from this week will show up here." />
            ) : (
              <>
                <dl className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[13px] text-muted-foreground">Revenue</dt>
                    <dd className="truncate text-[13px] font-semibold text-success tabular-nums">{formatMoney(week.revenue)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[13px] text-muted-foreground">Orders</dt>
                    <dd className="text-[13px] font-medium text-foreground tabular-nums">{week.orders}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[13px] text-muted-foreground">New Clients</dt>
                    <dd className="text-[13px] font-medium text-foreground tabular-nums">{clientsError ? "Could not load" : week.newClients}</dd>
                  </div>
                </dl>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex h-16 items-end justify-between gap-1.5">
                    {week.days.map((day) => (
                      <div
                        key={day.date}
                        className={cn("min-h-[3px] flex-1 rounded-sm transition-colors", day.date === today ? "bg-primary" : "bg-primary/20 hover:bg-primary/40")}
                        style={{ height: weekPeak === 0 ? "0%" : `${(day.count / weekPeak) * 100}%` }}
                        title={`${day.count} ${day.count === 1 ? "order" : "orders"}`}
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
