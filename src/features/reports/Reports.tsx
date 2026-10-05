import { useCallback, useState, type ElementType, type ReactElement, type ReactNode } from "react";
import { BarChart3, TrendingUp, TrendingDown, Users, ShoppingCart, Wallet, Package, Calendar, Download, FileText, PieChart, Activity, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/Tabs";
import { PageHeader } from "../../pages/PageHeader";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RechartsPieChart, Pie, Cell, Legend, AreaChart, Area } from "recharts";
import { formatWorkspaceMoneyCompact } from "../../lib/workspaceFormat";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { Skeleton } from "../../ui/Skeleton";
import { statCardClassName, statIconVariants, statValueSizeClass } from "../../ui/statCardStyles";
import { cn } from "../../lib/utils";
import { useGetOrders } from "../orders/useGetOrders";
import { useGetClients } from "../clients/useGetClients";
import useGetEmployees from "../employees/useGetEmployees";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { clientCreatedAt } from "../../pages/dashboardStats";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useNavigate, useParams } from "react-router-dom";
import { quickReportDescription, quickReportTitle, quickReportTypes } from "./quickReports";
import { employeePerformance, lowestStockLevels, percentChange, reportPeriod, revenueSeries, serviceDistribution, summaryStats, type ReportRange } from "./reportStats";
import { ExportReportDialog } from "./ExportReportDialog";
import { ReportPrintRoot, type ReportPrintJob } from "./ReportPrintRoot";
import { rangeLabel, reportRanges, useReportFormatting } from "./reportFormatting";
import { chartAxisProps, chartColors, chartGridProps, chartLegendProps, chartTooltipProps } from "./chartTheme";

function ReportChart({ height, children }: { height: number; children: ReactElement }) {
  return (
    <div className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 480, height }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function ReportPlaceholder({ height, title, description, isLoading = false, isError = false }: { height: number; title?: string; description?: string; isLoading?: boolean; isError?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col items-center justify-center gap-1 px-6 text-center" style={{ height }}>
      {isLoading ? (
        <Skeleton className="h-full w-full" />
      ) : (
        <>
          <span className={cn("mb-2 flex size-9 items-center justify-center rounded-lg", isError ? "bg-destructive/10 text-destructive" : "bg-muted text-subtle-foreground")}>
            <BarChart3 aria-hidden="true" className="size-4" />
          </span>
          <p className="text-sm font-medium text-foreground">{isError ? t("reports.charts.loadError") : (title ?? t("reports.charts.noData"))}</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">{isError ? t("reports.charts.loadErrorHint") : description}</p>
        </>
      )}
    </div>
  );
}

function ChartTitle({ icon: Icon, children }: { icon?: ElementType; children: ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2">
      {Icon && <Icon aria-hidden="true" className="size-4 text-subtle-foreground" />}
      {children}
    </CardTitle>
  );
}

const inventorySort = { field: "name", ascending: true } as const;

export function ReportsModule() {
  const { t } = useTranslation();
  const { currency, formatMoney } = useWorkspaceMoney();
  const [dateRange, setDateRange] = useState<ReportRange>("last30");
  const [activeTab, setActiveTab] = useState("overview");
  const [exportOpen, setExportOpen] = useState(false);
  const [printJob, setPrintJob] = useState<ReportPrintJob | null>(null);
  const finishPrint = useCallback(() => setPrintJob(null), []);
  const { formatDate } = useReportFormatting();
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

  const statsLoading = ordersLoading || clientsLoading;
  const statsError = Boolean(ordersError || clientsError);

  const stats = [
    {
      key: "revenue",
      title: t("reports.stats.totalRevenue"),
      value: formatMoney(summary.current.revenue),
      change: percentChange(summary.current.revenue, summary.previous.revenue),
      icon: Wallet,
      variant: "success" as const,
    },
    {
      key: "orders",
      title: t("reports.stats.totalOrders"),
      value: String(summary.current.orders),
      change: percentChange(summary.current.orders, summary.previous.orders),
      icon: ShoppingCart,
      variant: "primary" as const,
    },
    {
      key: "clients",
      title: t("reports.stats.newClients"),
      value: String(summary.current.newClients),
      change: percentChange(summary.current.newClients, summary.previous.newClients),
      icon: Users,
      variant: "primary" as const,
    },
    {
      key: "average",
      title: t("reports.stats.avgOrderValue"),
      value: formatMoney(summary.current.avgOrderValue),
      change: percentChange(summary.current.avgOrderValue, summary.previous.avgOrderValue),
      icon: Activity,
      variant: "primary" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("reports.page.title")}
        description={t("reports.page.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dateRange} onValueChange={(value) => setDateRange(value as ReportRange)}>
              <SelectTrigger className="w-44">
                <Calendar aria-hidden="true" className="size-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reportRanges.map((value) => (
                  <SelectItem key={value} value={value}>
                    {rangeLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <Download />
              {t("reports.page.export")}
            </Button>
          </div>
        }
      />
      <ExportReportDialog open={exportOpen} range={dateRange} onOpenChange={setExportOpen} onPrint={setPrintJob} />
      {printJob && <ReportPrintRoot job={printJob} formatMoney={(value) => formatMoney(value)} formatDate={formatDate} onDone={finishPrint} />}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.key} className={statCardClassName}>
            <span className={cn("absolute top-4 right-4 flex size-8 items-center justify-center rounded-md sm:top-5 sm:right-5", statIconVariants[stat.variant])}>
              <stat.icon aria-hidden="true" className="size-4" />
            </span>
            {/* The value precedes its title in the DOM; the column is reversed so the title reads first visually. */}
            <div className="flex min-w-0 flex-col-reverse">
              {statsLoading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <p className={cn("mt-1 truncate leading-8 font-semibold tracking-tight text-foreground tabular-nums", statValueSizeClass(stat.value))} title={stat.value}>
                  {statsError ? "—" : stat.value}
                </p>
              )}
              <p className="flex min-h-8 items-start pr-10 text-[13px] font-medium text-muted-foreground">{stat.title}</p>
            </div>
            <div className="mt-2 text-xs">
              {statsLoading || statsError || stat.change === null ? (
                <span className="text-subtle-foreground" title={t("reports.stats.noPreviousData")}>
                  —
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={t("reports.stats.comparedWithPrevious")}>
                  <span className={cn("inline-flex items-center gap-0.5 rounded px-1 py-px font-medium tabular-nums", stat.change >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                    {stat.change >= 0 ? <TrendingUp aria-hidden="true" className="size-3" /> : <TrendingDown aria-hidden="true" className="size-3" />}
                    {`${stat.change >= 0 ? "+" : ""}${stat.change.toFixed(1)}%`}
                  </span>
                  {t("reports.stats.vsPreviousPeriod")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <BarChart3 />
            {t("reports.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="services">
            <PieChart />
            {t("reports.tabs.services")}
          </TabsTrigger>
          <TabsTrigger value="employees">
            <Users />
            {t("reports.tabs.employees")}
          </TabsTrigger>
          <TabsTrigger value="inventory">
            <Package />
            {t("reports.tabs.inventory")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <ChartTitle icon={TrendingUp}>{t(`reports.charts.revenueTitle.${period.granularity}`)}</ChartTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || summary.current.orders === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description={t("reports.charts.noOrders")} />
                ) : (
                  <ReportChart height={300}>
                    <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="report-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.22} />
                          <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...chartGridProps} vertical={false} />
                      <XAxis dataKey="label" {...chartAxisProps} />
                      <YAxis {...chartAxisProps} axisLine={false} width={84} tickFormatter={(v) => formatWorkspaceMoneyCompact(v, currency)} />
                      <Tooltip {...chartTooltipProps} cursor={{ stroke: "var(--color-border-strong)" }} formatter={(value) => [formatMoney(Number(value)), t("reports.charts.revenue")]} />
                      <Area type="monotone" dataKey="revenue" stroke={chartColors.primary} fill="url(#report-revenue-fill)" strokeWidth={2} />
                    </AreaChart>
                  </ReportChart>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <ChartTitle icon={ShoppingCart}>{t(`reports.charts.ordersTitle.${period.granularity}`)}</ChartTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || summary.current.orders === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description={t("reports.charts.noOrders")} />
                ) : (
                  <ReportChart height={300}>
                    <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...chartGridProps} vertical={false} />
                      <XAxis dataKey="label" {...chartAxisProps} />
                      <YAxis {...chartAxisProps} axisLine={false} width={40} allowDecimals={false} />
                      <Tooltip {...chartTooltipProps} />
                      <Bar dataKey="orders" name={t("reports.charts.orders")} fill={chartColors.success} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ReportChart>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="services" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <ChartTitle icon={PieChart}>{t("reports.charts.serviceDistribution")}</ChartTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || services.length === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description={t("reports.charts.noServices")} />
                ) : (
                  <ReportChart height={300}>
                    <RechartsPieChart>
                      <Pie data={services} nameKey="name" cx="50%" cy="50%" innerRadius={64} outerRadius={100} paddingAngle={2} dataKey="count" stroke="var(--color-card)" strokeWidth={2}>
                        {services.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip {...chartTooltipProps} formatter={(value) => [Number(value), t("reports.charts.timesPerformed")]} />
                      <Legend {...chartLegendProps} />
                    </RechartsPieChart>
                  </ReportChart>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <ChartTitle icon={BarChart3}>{t("reports.charts.topServices")}</ChartTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading || ordersError || services.length === 0 ? (
                  <ReportPlaceholder height={300} isLoading={ordersLoading} isError={Boolean(ordersError)} description={t("reports.charts.noServices")} />
                ) : (
                  <ol className="space-y-4">
                    {services.map((service, index) => (
                      <li key={service.name} className="flex items-center gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular-nums">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground" title={service.name}>{service.name}</p>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${service.percent}%`,
                                backgroundColor: service.color,
                              }}
                            />
                          </div>
                        </div>
                        <span className="w-10 shrink-0 text-right text-[13px] font-medium text-muted-foreground tabular-nums">{service.percent}%</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="employees" className="mt-4">
          <Card>
            <CardHeader>
              <ChartTitle icon={Users}>{t("reports.charts.employeePerformance")}</ChartTitle>
            </CardHeader>
            <CardContent>
              {ordersLoading || employeesLoading || ordersError || employeesError || employeeResults.length === 0 ? (
                <ReportPlaceholder
                  height={400}
                  isLoading={ordersLoading || employeesLoading}
                  isError={Boolean(ordersError || employeesError)}
                  description={t("reports.charts.noEmployeeResults")}
                />
              ) : (
                <ReportChart height={400}>
                  <BarChart data={employeeResults} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid {...chartGridProps} horizontal={false} />
                    <XAxis type="number" {...chartAxisProps} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" {...chartAxisProps} axisLine={false} width={120} />
                    <Tooltip {...chartTooltipProps} />
                    <Legend {...chartLegendProps} />
                    <Bar dataKey="completed" name={t("reports.charts.jobsCompleted")} fill={chartColors.primary} radius={[0, 4, 4, 0]} maxBarSize={28} />
                  </BarChart>
                </ReportChart>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <ChartTitle icon={Activity}>{t("reports.charts.inventoryTrends")}</ChartTitle>
            </CardHeader>
            <CardContent>
              <ReportPlaceholder height={200} description={t("reports.charts.inventoryTrendsUnavailable")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <ChartTitle icon={Package}>{t("reports.charts.stockLevels")}</ChartTitle>
              <CardDescription>{t("reports.charts.stockLevelsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {inventoryLoading || inventoryError || stockLevels.length === 0 ? (
                <ReportPlaceholder height={300} isLoading={inventoryLoading} isError={inventoryError} description={t("reports.charts.noInventory")} />
              ) : (
                <ReportChart height={Math.max(200, stockLevels.length * 48)}>
                  <BarChart data={stockLevels} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid {...chartGridProps} horizontal={false} />
                    <XAxis type="number" {...chartAxisProps} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" {...chartAxisProps} axisLine={false} width={140} />
                    <Tooltip {...chartTooltipProps} />
                    <Legend {...chartLegendProps} />
                    <Bar dataKey="quantity" name={t("reports.charts.inStock")} fill={chartColors.primary} radius={[0, 4, 4, 0]} maxBarSize={18} />
                    <Bar dataKey="minimum" name={t("reports.charts.minimum")} fill={chartColors.warning} radius={[0, 4, 4, 0]} maxBarSize={18} />
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
          <CardTitle>{t("reports.quickReports.title")}</CardTitle>
          <CardDescription>{t("reports.quickReports.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickReportTypes.map((type) => (
              <button
                key={type}
                type="button"
                className="group flex h-full flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-[border-color,box-shadow,background-color] duration-150 hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                onClick={() => navigate(`/${locale}/${routeWorkspaceId}/reports/${type}?range=${dateRange}`)}
              >
                <div className="mb-2 flex w-full items-center justify-between">
                  <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FileText aria-hidden="true" className="size-4" />
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4 text-subtle-foreground transition-colors group-hover:text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">{quickReportTitle(type)}</p>
                <p className="text-xs leading-5 text-muted-foreground">{quickReportDescription(type)}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
