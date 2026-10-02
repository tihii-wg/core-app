import { ClipboardList, DollarSign, FileText, Package, Plus, Users, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable, type Column } from "../ui/DataTable";
import type { Order } from "../lib/types";
import { DashboardCard } from "../ui/DashboardCard";
import { Button } from "../ui/Button";
import { useApp } from "../lib/appContext";
import { OrderStatusBadge, PaymentStatusBadge } from "../ui/StatusBadge";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { getOrders } from "../services/apiOrders";
import { getClients } from "../services/apiClients";
import { clientCreatedAt, isAtOrBelowMinimum, localDateKey, taskOverviewCounts, thisWeekStats } from "./dashboardStats";
import { useGetInventoryItems } from "../features/inventory/useGetInventoryItems";
import { useWorkspaceMoney } from "../features/workspaces/useWorkspaceMoney";
import { useActiveWorkspaceId } from "../features/profiles/useGetProfile";
import { CreateOrderDialog } from "../features/orders/CreateOrderDialog";
import { AddClientDialog } from "../features/clients/AddClientDialog";
import { AddInventoryItemDialog } from "../features/inventory/AddInventoryItemDialog";
import ClientTypeBadge from "../features/clients/ClientTypeBadge";
import OrderDetailPanel from "../features/orders/OrderDetailPanel";
import { useOrderDetails } from "../features/orders/useOrderDetails";

type QuickActionDialog = "order" | "client" | "inventory";

const quickActionClass =
  "border-[#c9cbcc] cursor-pointer transition-all duration-200 ease-in-out hover:border-[#1973e1] hover:bg-[#1973e1] hover:text-white";


export default function Dashboard() {


  const { orders = [], clients = [], invoices = [], setCurrentModule } = useApp();
  const { workspaceId } = useActiveWorkspaceId();
  const [openDialog, setOpenDialog] = useState<QuickActionDialog | null>(null);
  const orderDetails = useOrderDetails();
  const dialogProps = (dialog: QuickActionDialog) => ({
    open: openDialog === dialog,
    onOpenChange: (open: boolean) => setOpenDialog(open ? dialog : null),
  });
  const { formatMoney } = useWorkspaceMoney();
  const {
    data: workspaceOrders = [],
    isLoading: ordersLoading,
    isError: ordersError,
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
    { label: "In Progress", count: taskOverview.inProgress, color: "#f89200" },
    { label: "Waiting Parts", count: taskOverview.waitingParts, color: "#939699" },
    { label: "Completed Today", count: taskOverview.completedToday, color: "#099b49" },
  ];

  const closedStatuses = ["completed", "paid", "cancelled"];
  const activeOrderCount = workspaceOrders.filter((order) => !closedStatuses.includes(order.status)).length;

  const todayRevenue = orders.filter((o) => o.paymentStatus === "paid").reduce((sum, o) => sum + o.totalPrice, 0);

  const unpaidInvoices = invoices.filter((inv) => inv.status === "sent" || inv.status === "overdue").length;

  const {
    items: inventoryItems,
    isLoading: inventoryLoading,
    isError: inventoryError,
  } = useGetInventoryItems("", "all", { field: "created_at", ascending: false });
  const lowStockCount = inventoryItems.filter(isAtOrBelowMinimum).length;

  const recentOrders = workspaceOrders.slice(0, 5);

  // Recent activity (mock)
  const recentActivity = clients.slice(0, 4).map((client, index) => ({
    ...client,
    action: index % 2 === 0 ? "placed an order" : "was added",
    time: `${(index + 1) * 2} hours ago`,
  }));

  // Order columns
  const orderColumns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: "Order",
      cell: (order) => <span className="font-medium text-[#1973e1]">{order.orderNumber}</span>,
    },
    {
      key: "client",
      header: "Client",
      cell: (order) => order.clientName,
    },
    {
      key: "clientType",
      header: "Client Type",
      cell: (order) => <ClientTypeBadge clientType={order.clientType} />,
    },
    {
      key: "device",
      header: "Device",
      cell: (order) => order.device,
      className: "hidden md:table-cell",
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
      cell: (order) => formatMoney(order.totalPrice),
      className: "text-right",
    },
  ];


  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-md border border-[#eeeeef] p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-[#939699] font-medium">Active Orders</p>
              {ordersLoading ? (
                <Skeleton className="h-8 w-12 mt-2" />
              ) : ordersError ? (
                <>
                  <p className="text-sm font-medium text-[#282e33] mt-2">Could not load orders</p>
                  <p className="text-xs text-[#939699] mt-1">Refresh the page to try again.</p>
                </>
              ) : activeOrderCount === 0 ? (
                <>
                  <p className="text-sm font-medium text-[#282e33] mt-2">No active orders</p>
                  <p className="text-xs text-[#939699] mt-1">Open orders will show up here.</p>
                </>
              ) : (
                <p className="text-2xl font-semibold text-[#282e33] mt-1">{activeOrderCount}</p>
              )}
            </div>
            <div className="p-2 rounded-md bg-[#edf4fd] text-[#1973e1]">
              <ClipboardList className="h-5 w-5" />
            </div>
          </div>
        </div>
        <DashboardCard title="Today's Revenue" value={formatMoney(todayRevenue)} icon={DollarSign} variant="success" trend={{ value: 8, label: "vs yesterday" }} />
        <DashboardCard title="Unpaid Invoices" value={unpaidInvoices} icon={FileText} variant="warning" />
        <div className="bg-white rounded-md border border-[#eeeeef] p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-[#939699] font-medium">Low Stock Items</p>
              {inventoryLoading ? (
                <Skeleton className="h-8 w-12 mt-2" />
              ) : inventoryError ? (
                <>
                  <p className="text-sm font-medium text-[#282e33] mt-2">Could not load inventory</p>
                  <p className="text-xs text-[#939699] mt-1">Refresh the page to try again.</p>
                </>
              ) : lowStockCount === 0 ? (
                <>
                  <p className="text-sm font-medium text-[#282e33] mt-2">No low stock items</p>
                  <p className="text-xs text-[#939699] mt-1">Items at or below their minimum will show up here.</p>
                </>
              ) : (
                <p className="text-2xl font-semibold text-[#282e33] mt-1">{lowStockCount}</p>
              )}
            </div>
            <div className={lowStockCount > 0 ? "p-2 rounded-md bg-[#fee7e7] text-[#f41f20]" : "p-2 rounded-md bg-[#f1f3f5] text-[#939699]"}>
              <Package className="h-5 w-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-md border border-[#eeeeef] p-4">
        <h2 className="text-sm font-medium text-[#939699] mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpenDialog("order")} variant="outline" size="sm" className={quickActionClass}>
            <Plus className="h-4 w-4 mr-1" />
            Create Order
          </Button>
          <Button onClick={() => setOpenDialog("client")} variant="outline" size="sm" className={quickActionClass}>
            <Plus className="h-4 w-4 mr-1" />
            Add Client
          </Button>
          <Button onClick={() => setOpenDialog("inventory")} variant="outline" size="sm" className={quickActionClass}>
            <Plus className="h-4 w-4 mr-1" />
            Add Inventory
          </Button>
          <Button onClick={() => setCurrentModule("invoices")} variant="outline" size="sm" className={quickActionClass}>
            <Plus className="h-4 w-4 mr-1" />
            Create Invoice
          </Button>
        </div>
      </div>

      <CreateOrderDialog {...dialogProps("order")} />
      <AddClientDialog {...dialogProps("client")} />
      <AddInventoryItemDialog {...dialogProps("inventory")} />
      <OrderDetailPanel {...orderDetails.panelProps} />

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[#282e33]">Recent Orders</h2>
            <button onClick={() => setCurrentModule("orders")} className="text-sm text-[#1973e1] hover:underline flex items-center gap-1">
              View all
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <DataTable
            columns={orderColumns}
            data={recentOrders}
            keyExtractor={(order) => order.id}
            onRowClick={orderDetails.openOrder}
            isLoading={ordersLoading}
            emptyState={
              <EmptyState
                icon={ClipboardList}
                title={ordersError ? "Could not load orders" : "No orders yet"}
                description={ordersError ? "Refresh the page to try again." : "Orders you create will show up here."}
              />
            }
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Recent Activity */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h2 className="text-base font-semibold text-[#282e33] mb-4">Recent Activity</h2>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="h-8 w-8 bg-[#edf4fd] rounded-full flex items-center justify-center shrink-0">
                    <Users className="h-4 w-4 text-[#1973e1]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#282e33]">
                      <span className="font-medium">{activity.name}</span> {activity.action}
                    </p>
                    <p className="text-xs text-[#939699]">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Employee Tasks */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h2 className="text-base font-semibold text-[#282e33] mb-4">Task Overview</h2>
            {ordersLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-2 w-full mt-4" />
              </div>
            ) : ordersError ? (
              <>
                <p className="text-sm font-medium text-[#282e33]">Could not load tasks</p>
                <p className="text-xs text-[#939699] mt-1">Refresh the page to try again.</p>
              </>
            ) : workspaceOrders.length === 0 ? (
              <>
                <p className="text-sm font-medium text-[#282e33]">No tasks yet</p>
                <p className="text-xs text-[#939699] mt-1">Open orders will show up here.</p>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  {taskRows.map((task) => (
                    <div key={task.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: task.color }} />
                        <span className="text-sm text-[#282e33]">{task.label}</span>
                      </div>
                      <span className="text-sm font-medium text-[#282e33]">{task.count}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-[#eeeeef]">
                  <div className="flex gap-1 h-2 rounded overflow-hidden bg-[#f8f9fa]">
                    {taskRows.map((task) => (
                      <div
                        key={task.label}
                        style={{
                          width: taskTotal === 0 ? "0%" : `${(task.count / taskTotal) * 100}%`,
                          backgroundColor: task.color,
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-[#939699] mt-2">
                    {taskTotal} total {taskTotal === 1 ? "task" : "tasks"} today
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Revenue Summary */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h2 className="text-base font-semibold text-[#282e33] mb-4">This Week</h2>
            {ordersLoading || clientsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-16 w-full mt-4" />
              </div>
            ) : ordersError ? (
              <>
                <p className="text-sm font-medium text-[#282e33]">Could not load this week</p>
                <p className="text-xs text-[#939699] mt-1">Refresh the page to try again.</p>
              </>
            ) : week.isEmpty && !clientsError ? (
              <>
                <p className="text-sm font-medium text-[#282e33]">No tasks yet</p>
                <p className="text-xs text-[#939699] mt-1">Orders and clients from this week will show up here.</p>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#939699]">Revenue</span>
                    <span className="text-sm font-medium text-[#099b49]">{formatMoney(week.revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#939699]">Orders</span>
                    <span className="text-sm font-medium text-[#282e33]">{week.orders}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#939699]">New Clients</span>
                    <span className="text-sm font-medium text-[#282e33]">{clientsError ? "Could not load" : week.newClients}</span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-[#eeeeef]">
                  <div className="flex items-end justify-between gap-1 h-16">
                    {week.days.map((day) => (
                      <div
                        key={day.date}
                        className="flex-1 bg-[#edf4fd] hover:bg-[#1973e1] transition-colors rounded-sm"
                        style={{ height: weekPeak === 0 ? "0%" : `${(day.count / weekPeak) * 100}%` }}
                        title={`${day.count} ${day.count === 1 ? "order" : "orders"}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between mt-2">
                    {week.days.map((day) => (
                      <span key={day.date} className="text-xs text-[#939699] flex-1 text-center">
                        {day.label}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
