import { useState, type ReactElement } from "react";
import { BarChart3, TrendingUp, TrendingDown, Users, ShoppingCart, DollarSign, Package, Calendar, Download, FileText, PieChart, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/Tabs";
import { PageHeader } from "../../pages/PageHeader";
// import { useApp } from "../../lib/app-context";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RechartsPieChart, Pie, Cell, Legend, AreaChart, Area } from "recharts";
import { formatWorkspaceMoneyCompact } from "../../lib/workspaceFormat";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { Skeleton } from "../../ui/Skeleton";
import { useGetOrders } from "../orders/useGetOrders";
import { useGetClients } from "../clients/useGetClients";
import useGetEmployees from "../employees/useGetEmployees";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { clientCreatedAt } from "../../pages/dashboardStats";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useNavigate, useParams } from "react-router-dom";
import { quickReports, quickReportTypes } from "./quickReports";
import { employeePerformance, lowestStockLevels, percentChange, reportPeriod, revenueSeries, serviceDistribution, summaryStats, type ReportRange } from "./reportStats";

function ReportChart({ height, children }: { height: number; children: ReactElement }) {
  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 480, height }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function ReportPlaceholder({ height, title = "No data available yet", description, isLoading = false, isError = false }: { height: number; title?: string; description?: string; isLoading?: boolean; isError?: boolean }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-1 text-center" style={{ height }}>
      {isLoading ? (
        <Skeleton className="h-full w-full" />
      ) : (
        <>
          <p className="font-medium text-foreground">{isError ? "Could not load report data" : title}</p>
          <p className="text-sm text-muted-foreground">{isError ? "Refresh the page to try again." : description}</p>
        </>
      )}
    </div>
  );
}

const granularityLabels = { day: "Daily", week: "Weekly", month: "Monthly" } as const;

const inventorySort = { field: "name", ascending: true } as const;

export function ReportsModule() {
  const { currency, formatMoney } = useWorkspaceMoney();
  const [dateRange, setDateRange] = useState<ReportRange>("last30");
  const [activeTab, setActiveTab] = useState("overview");
  const { locale = "en", workspaceId: routeWorkspaceId } = useParams();
  const navigate = useNavigate();

  // Queries stay disabled (and report isLoading: false) until the active workspace is known.
  const { workspaceId } = useActiveWorkspaceId();
  const waitingForWorkspace = !workspaceId;
  const { orders, isLoading: ordersQueryLoading, error: ordersError } = useGetOrders();
  const { clients = [], isLoading: clientsQueryLoading, error: clientsError } = useGetClients("");
  const { employees = [], isLoading: employeesQueryLoading, error: employeesError } = useGetEmployees();
  const { items: inventoryItems, isLoading: inventoryQueryLoading, isError: inventoryError } = useGetInventoryItems("", "all", inventorySort);
  const ordersLoading = waitingForWorkspace || ordersQueryLoading;
  const clientsLoading = waitingForWorkspace || clientsQueryLoading;
  const employeesLoading = waitingForWorkspace || employeesQueryLoading;
  const inventoryLoading = waitingForWorkspace || inventoryQueryLoading;

  const period = reportPeriod(dateRange, new Date());
  const summary = summaryStats(
    orders,
    clients.map((client) => clientCreatedAt(client)),
    period,
  );
  const series = revenueSeries(orders, period);
  const services = serviceDistribution(orders, period);
  const employeeResults = employeePerformance(orders, employees, period);
  const stockLevels = lowestStockLevels(inventoryItems);
  const granularity = granularityLabels[period.granularity];

  const statsLoading = ordersLoading || clientsLoading;
  const statsError = Boolean(ordersError || clientsError);

  const stats = [
    {
      title: "Total Revenue",
      value: formatMoney(summary.current.revenue),
      change: percentChange(summary.current.revenue, summary.previous.revenue),
      icon: DollarSign,
    },
    {
      title: "Total Orders",
      value: String(summary.current.orders),
      change: percentChange(summary.current.orders, summary.previous.orders),
      icon: ShoppingCart,
    },
    {
      title: "New Clients",
      value: String(summary.current.newClients),
      change: percentChange(summary.current.newClients, summary.previous.newClients),
      icon: Users,
    },
    {
      title: "Avg Order Value",
      value: formatMoney(summary.current.avgOrderValue),
      change: percentChange(summary.current.avgOrderValue, summary.previous.avgOrderValue),
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        description="Business performance insights and analytics"
        actions={
          <div className="flex items-center gap-3">
            <Select value={dateRange} onValueChange={(value) => setDateRange(value as ReportRange)}>
              <SelectTrigger className="w-45">
                <Calendar className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last7">Last 7 days</SelectItem>
                <SelectItem value="last30">Last 30 days</SelectItem>
                <SelectItem value="last90">Last 90 days</SelectItem>
                <SelectItem value="thisYear">This Year</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="rounded-lg bg-primary/10 p-2">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
                {statsLoading || statsError || stat.change === null ? (
                  <span className="text-sm text-muted-foreground" title="No data for the previous period">
                    —
                  </span>
                ) : (
                  <div className={`flex items-center gap-1 text-sm font-medium ${stat.change >= 0 ? "text-green-600" : "text-red-600"}`} title="Compared with the previous period">
                    {stat.change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {`${stat.change >= 0 ? "+" : ""}${stat.change.toFixed(1)}%`}
                  </div>
                )}
              </div>
              <div className="mt-4">
                {statsLoading ? <Skeleton className="h-8 w-24" /> : <p className="text-2xl font-bold text-foreground">{statsError ? "—" : stat.value}</p>}
                <p className="text-sm text-muted-foreground">{stat.title}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <BarChart3 className="mr-2 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="services">
            <PieChart className="mr-2 h-4 w-4" />
            Services
          </TabsTrigger>
          <TabsTrigger value="employees">
            <Users className="mr-2 h-4 w-4" />
            Employees
          </TabsTrigger>
          <TabsTrigger value="inventory">
            <Package className="mr-2 h-4 w-4" />
            Inventory
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Revenue Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  {granularity} Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || summary.current.orders === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description="No orders were created in this period." />
                ) : (
                <ReportChart height={300}>
                    <AreaChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => formatWorkspaceMoneyCompact(v, currency)} />
                      <Tooltip
                        formatter={(value) => [formatMoney(Number(value)), "Revenue"]}
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                        }}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#1973e1" fill="#1973e1" fillOpacity={0.1} strokeWidth={2} />
                    </AreaChart>
                </ReportChart>
                )}
              </CardContent>
            </Card>

            {/* Orders Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  {granularity} Orders
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || summary.current.orders === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description="No orders were created in this period." />
                ) : (
                <ReportChart height={300}>
                    <BarChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar dataKey="orders" name="Orders" fill="#099b49" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ReportChart>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="services" className="mt-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Service Breakdown Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Service Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || services.length === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description="No services were performed in this period." />
                ) : (
                <ReportChart height={300}>
                    <RechartsPieChart>
                      <Pie data={services} nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="count">
                        {services.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [Number(value), "Times performed"]}
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                    </RechartsPieChart>
                </ReportChart>
                )}
              </CardContent>
            </Card>

            {/* Top Services List */}
            <Card>
              <CardHeader>
                <CardTitle>Top Performing Services</CardTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || services.length === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description="No services were performed in this period." />
                ) : (
                <div className="space-y-4">
                  {services.map((service, index) => (
                    <div key={service.name} className="flex items-center gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium text-white" style={{ backgroundColor: service.color }}>
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{service.name}</p>
                        <div className="mt-1 h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${service.percent}%`,
                              backgroundColor: service.color,
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-sm font-medium text-muted-foreground">{service.percent}%</span>
                    </div>
                  ))}
                </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="employees" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Employee Performance</CardTitle>
            </CardHeader>
            <CardContent>
              {ordersLoading || employeesLoading || ordersError || employeesError || employeeResults.length === 0 ? (
                <ReportPlaceholder
                  height={400}
                  isLoading={ordersLoading || employeesLoading}
                  isError={Boolean(ordersError || employeesError)}
                  description="No orders assigned to employees were completed in this period."
                />
              ) : (
              <ReportChart height={400}>
                  <BarChart data={employeeResults} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" fontSize={12} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" stroke="#6b7280" fontSize={12} width={100} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Bar dataKey="completed" name="Jobs Completed" fill="#1973e1" radius={[0, 4, 4, 0]} />
                  </BarChart>
              </ReportChart>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportPlaceholder height={200} description="Stock history and parts usage are not recorded yet, so trends cannot be shown." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Stock Levels</CardTitle>
              <p className="text-sm text-muted-foreground">Active items with the lowest stock relative to their minimum. Current stock, not affected by the date range.</p>
            </CardHeader>
            <CardContent>
              {inventoryLoading || inventoryError || stockLevels.length === 0 ? (
                <ReportPlaceholder height={300} isLoading={inventoryLoading} isError={inventoryError} description="No active inventory items in this workspace." />
              ) : (
                <ReportChart height={Math.max(200, stockLevels.length * 48)}>
                  <BarChart data={stockLevels} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" fontSize={12} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" stroke="#6b7280" fontSize={12} width={120} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Bar dataKey="quantity" name="In Stock" fill="#1973e1" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="minimum" name="Minimum" fill="#f89200" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ReportChart>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quick Reports */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {quickReportTypes.map((type) => (
              <Button
                key={type}
                variant="outline"
                className="h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => navigate(`/${locale}/${routeWorkspaceId}/reports/${type}?range=${dateRange}`)}
              >
                <div className="flex w-full items-center justify-between">
                  <FileText className="h-5 w-5 text-primary" />
                  <Download className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="font-medium">{quickReports[type].title}</p>
                <p className="text-xs text-muted-foreground">{quickReports[type].description}</p>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
