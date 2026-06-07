import { ClipboardList, DollarSign, FileText, Package, Plus, Users, ArrowRight } from "lucide-react";
import { DataTable, type Column } from "../ui/DataTable";
import type { Order } from "../lib/types";
import { DashboardCard } from "../ui/DashboardCard";
import { Button } from "../ui/Button";
import { useApp } from "../lib/appContext";
import { OrderStatusBadge, PaymentStatusBadge } from "../ui/StatusBadge";
// import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
// import { Spinner } from "../ui/Spinner";
// import { useEffect } from "react";
// import { useNavigate } from "react-router-dom";

export default function Dashboard() {
//   const { workspaces, isLoading } = useGetWorkspaces();
// const navigate = useNavigate()

  const { orders, clients, invoices, inventory, setCurrentModule } = useApp();

  // Calculate stats
  const activeOrders = orders.filter((o) => !["completed", "paid", "cancelled"].includes(o.status)).length;

  const todayRevenue = orders.filter((o) => o.paymentStatus === "paid").reduce((sum, o) => sum + o.totalPrice, 0);

  const unpaidInvoices = invoices.filter((inv) => inv.status === "sent" || inv.status === "overdue").length;

  const lowStockItems = inventory.filter((item) => item.status === "low-stock").length;

  // Recent orders
  const recentOrders = orders.slice(0, 5);

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
      cell: (order) => `$${order.totalPrice}`,
      className: "text-right",
    },
  ];

  // if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardCard title="Active Orders" value={activeOrders} icon={ClipboardList} variant="primary" trend={{ value: 12, label: "vs last week" }} />
        <DashboardCard title="Today's Revenue" value={`$${todayRevenue.toLocaleString()}`} icon={DollarSign} variant="success" trend={{ value: 8, label: "vs yesterday" }} />
        <DashboardCard title="Unpaid Invoices" value={unpaidInvoices} icon={FileText} variant="warning" />
        <DashboardCard title="Low Stock Items" value={lowStockItems} icon={Package} variant={lowStockItems > 0 ? "danger" : "default"} />
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-md border border-[#eeeeef] p-4">
        <h2 className="text-sm font-medium text-[#939699] mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCurrentModule("orders")} size="sm" className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
            Create Order
          </Button>
          <Button onClick={() => setCurrentModule("clients")} variant="outline" size="sm" className="border-[#c9cbcc]">
            <Plus className="h-4 w-4 mr-1" />
            Add Client
          </Button>
          <Button onClick={() => setCurrentModule("inventory")} variant="outline" size="sm" className="border-[#c9cbcc]">
            <Plus className="h-4 w-4 mr-1" />
            Add Inventory
          </Button>
          <Button onClick={() => setCurrentModule("invoices")} variant="outline" size="sm" className="border-[#c9cbcc]">
            <Plus className="h-4 w-4 mr-1" />
            Create Invoice
          </Button>
        </div>
      </div>

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
          <DataTable columns={orderColumns} data={recentOrders} keyExtractor={(order) => order.id} onRowClick={() => setCurrentModule("orders")} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Recent Activity */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h2 className="text-base font-semibold text-[#282e33] mb-4">Recent Activity</h2>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="h-8 w-8 bg-[#edf4fd] rounded-full flex items-center justify-center flex-shrink-0">
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
            <div className="space-y-3">
              {[
                { label: "In Progress", count: 4, color: "#f89200" },
                { label: "Waiting Parts", count: 2, color: "#939699" },
                { label: "Completed Today", count: 3, color: "#099b49" },
              ].map((task) => (
                <div key={task.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: task.color }} />
                    <span className="text-sm text-[#282e33]">{task.label}</span>
                  </div>
                  <span className="text-sm font-medium text-[#282e33]">{task.count}</span>
                </div>
              ))}
            </div>

            {/* Simple visual bar */}
            <div className="mt-4 pt-4 border-t border-[#eeeeef]">
              <div className="flex gap-1 h-2 rounded overflow-hidden">
                <div className="bg-[#f89200]" style={{ width: "44%" }} />
                <div className="bg-[#939699]" style={{ width: "22%" }} />
                <div className="bg-[#099b49]" style={{ width: "34%" }} />
              </div>
              <p className="text-xs text-[#939699] mt-2">9 total tasks today</p>
            </div>
          </div>

          {/* Revenue Summary */}
          <div className="bg-white rounded-md border border-[#eeeeef] p-4">
            <h2 className="text-base font-semibold text-[#282e33] mb-4">This Week</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#939699]">Revenue</span>
                <span className="text-sm font-medium text-[#099b49]">$3,245</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#939699]">Orders</span>
                <span className="text-sm font-medium text-[#282e33]">18</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#939699]">New Clients</span>
                <span className="text-sm font-medium text-[#282e33]">5</span>
              </div>
            </div>

            {/* Simple bar chart */}
            <div className="mt-4 pt-4 border-t border-[#eeeeef]">
              <div className="flex items-end justify-between gap-1 h-16">
                {[40, 65, 45, 80, 55, 90, 70].map((height, i) => (
                  <div key={i} className="flex-1 bg-[#edf4fd] hover:bg-[#1973e1] transition-colors rounded-sm cursor-pointer" style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
                  <span key={i} className="text-xs text-[#939699] flex-1 text-center">
                    {day}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
