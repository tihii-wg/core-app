import { ClipboardList, DollarSign, FileText, Package, Plus, Users, ArrowRight } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";

import { useApp } from "../../lib/appContext";
import type { Order } from "../../lib/types";
import { DataTable, type Column } from "../../ui/DataTable";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { DashboardCard } from "../../ui/DashboardCard";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { currentIntlLocale } from "../../i18n";
import { weekDateKeys } from "../../pages/dashboardStats";

export function Dashboard() {
  const { t } = useTranslation();
  const { orders, clients, inventory, setCurrentModule } = useApp();
  const { invoices } = useGetInvoices();
  const { formatMoney } = useWorkspaceMoney();


  // Calculate stats
  
  const activeOrders =
    orders?.filter(
      (o) => !["completed", "paid", "cancelled"].includes(o.status)
    ).length ?? 0;
  
  const todayRevenue =
    orders
      ?.filter((o) => o.paymentStatus === "paid")
      .reduce((sum, o) => sum + o.totalPrice, 0) ?? 0;
  
  const unpaidInvoices =
    invoices?.filter(
      (inv) => inv.status === "sent" || inv.status === "overdue"
    ).length ?? 0;
  
  const lowStockItems =
    inventory?.filter((item) => item.status === "low-stock").length ?? 0;
  
  // Recent orders
  
  const recentOrders = orders?.slice(0, 5) ?? [];
  
  // Recent activity (mock)
  
  const recentActivity =
    clients?.slice(0, 4)?.map((client, index) => ({
      ...client,
      actionKey: index % 2 === 0 ? ("dashboard.legacy.placedOrder" as const) : ("dashboard.legacy.wasAdded" as const),
      time: t("dashboard.legacy.hoursAgo", { count: (index + 1) * 2 }),
    })) ?? [];
  const weekdayFormat = new Intl.DateTimeFormat(currentIntlLocale(), { weekday: "narrow" });
  const weekdayLabels = weekDateKeys(new Date()).map((date) => weekdayFormat.format(new Date(`${date}T00:00:00`)));

  // Order columns
  const orderColumns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: t("dashboard.columns.order"),
      cell: (order) => <span className="font-medium text-primary">{order?.orderNumber}</span>,
    },
    {
      key: "client",
      header: t("dashboard.columns.client"),
      cell: (order) => order?.clientName,
    },
    {
      key: "device",
      header: t("dashboard.columns.device"),
      cell: (order) => order.device,
      className: "hidden md:table-cell",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (order) => <OrderStatusBadge status={order?.status} />,
    },
    {
      key: "payment",
      header: t("dashboard.columns.payment"),
      cell: (order) => <PaymentStatusBadge status={order?.paymentStatus} />,
      className: "hidden sm:table-cell",
    },
    {
      key: "total",
      header: t("common.total"),
      cell: (order) => formatMoney(order?.totalPrice),
      className: "text-right",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardCard title={t("dashboard.stats.activeOrders")} value={activeOrders} icon={ClipboardList} variant="primary" trend={{ value: 12, label: t("dashboard.legacy.vsLastWeek") }} />
        <DashboardCard title={t("dashboard.legacy.todaysRevenue")} value={formatMoney(todayRevenue)} icon={DollarSign} variant="success" trend={{ value: 8, label: t("dashboard.stats.vsYesterday") }} />
        <DashboardCard title={t("dashboard.legacy.unpaidInvoices")} value={unpaidInvoices} icon={FileText} variant="warning" />
        <DashboardCard title={t("dashboard.stats.lowStockItems")} value={lowStockItems} icon={Package} variant={lowStockItems > 0 ? "danger" : "default"} />
      </div>

      {/* Quick Actions */}
      <div className="bg-card rounded-md border border-border p-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">{t("dashboard.quickActions.title")}</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCurrentModule("orders")} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {t("dashboard.quickActions.createOrder")}
          </Button>
          <Button onClick={() => setCurrentModule("clients")} variant="outline" size="sm" className="border-input">
            <Plus className="h-4 w-4 mr-1" />
            {t("dashboard.quickActions.addClient")}
          </Button>
          <Button onClick={() => setCurrentModule("inventory")} variant="outline" size="sm" className="border-input">
            <Plus className="h-4 w-4 mr-1" />
            {t("dashboard.quickActions.addInventory")}
          </Button>
          <Button onClick={() => setCurrentModule("invoices")} variant="outline" size="sm" className="border-input">
            <Plus className="h-4 w-4 mr-1" />
            {t("dashboard.quickActions.createInvoice")}
          </Button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">{t("dashboard.lists.recentOrders")}</h2>
            <button onClick={() => setCurrentModule("orders")} className="text-sm text-primary hover:underline flex items-center gap-1">
              {t("dashboard.viewAll")}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <DataTable columns={orderColumns} data={recentOrders} keyExtractor={(order) => order.id} onRowClick={() => setCurrentModule("orders")} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Recent Activity */}
          <div className="bg-card rounded-md border border-border p-4">
            <h2 className="text-base font-semibold text-foreground mb-4">{t("dashboard.activity.title")}</h2>
            <div className="space-y-4">
              {recentActivity?.map((activity) => (
                <div key={activity?.id} className="flex items-start gap-3">
                  <div className="h-8 w-8 bg-accent rounded-full flex items-center justify-center flex-shrink-0">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      <Trans i18nKey={activity.actionKey} values={{ name: activity.name }} components={{ highlight: <span className="font-medium" /> }} />
                    </p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Employee Tasks */}
          <div className="bg-card rounded-md border border-border p-4">
            <h2 className="text-base font-semibold text-foreground mb-4">{t("dashboard.tasks.title")}</h2>
            <div className="space-y-3">
              {[
                { label: t("status.order.in-progress"), count: 4, color: "#f89200" },
                { label: t("status.order.waiting-parts"), count: 2, color: "#939699" },
                { label: t("dashboard.tasks.completedToday"), count: 3, color: "#099b49" },
              ].map((task) => (
                <div key={task.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: task.color }} />
                    <span className="text-sm text-foreground">{task.label}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">{task.count}</span>
                </div>
              ))}
            </div>

            {/* Simple visual bar */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex gap-1 h-2 rounded overflow-hidden">
                <div className="bg-warning" style={{ width: "44%" }} />
                <div className="bg-muted-foreground" style={{ width: "22%" }} />
                <div className="bg-success" style={{ width: "34%" }} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">{t("dashboard.tasks.totalToday", { count: 9 })}</p>
            </div>
          </div>

          {/* Revenue Summary */}
          <div className="bg-card rounded-md border border-border p-4">
            <h2 className="text-base font-semibold text-foreground mb-4">{t("dashboard.week.title")}</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("dashboard.week.revenue")}</span>
                <span className="text-sm font-medium text-success">{formatMoney(3245)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("dashboard.week.orders")}</span>
                <span className="text-sm font-medium text-foreground">18</span>
              </div>
              <div className="flex items-center justify-between">
//                 <span className="text-sm text-muted-foreground">{t("dashboard.week.newClients")}</span>
//                 <span className="text-sm font-medium text-foreground">5</span>
//               </div>
            </div>

            {/* Simple bar chart */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-end justify-between gap-1 h-16">
                {[40, 65, 45, 80, 55, 90, 70].map((height, i) => (
                  <div key={i} className="flex-1 bg-accent hover:bg-primary transition-colors rounded-sm cursor-pointer" style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {weekdayLabels.map((day, i) => (
                  <span key={i} className="text-xs text-muted-foreground flex-1 text-center">
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
