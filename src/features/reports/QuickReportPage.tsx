import { useEffect, useState } from "react";
import { Link, Navigate, useHref, useLocation, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { ArrowLeft, Calendar, Download, Printer, Share2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { localDateKey, clientCreatedAt } from "../../pages/dashboardStats";
import { useGetOrders } from "../orders/useGetOrders";
import { useGetClients } from "../clients/useGetClients";
import useGetEmployees from "../employees/useGetEmployees";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { reportPeriod } from "./reportStats";
import { employeeReport, financialReport, inventoryReport, isQuickReportType, quickReportDescription, quickReportTitle, quickReports, reportCsv, salesReport, toReportRange, type QuickReportModel, type QuickReportType } from "./quickReports";
import { ReportDocument } from "./ReportDocument";
import { downloadCsv, rangeLabel, reportRanges, useReportFormatting } from "./reportFormatting";

const inventorySort = { field: "name", ascending: true } as const;

async function shareLink(title: string, url: string) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error(i18n.t("reports.toast.shareFailed"));
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success(i18n.t("reports.toast.linkCopied"));
  } catch {
    toast.error(i18n.t("reports.toast.copyFailed"));
  }
}

export function QuickReportPage() {
  const { t } = useTranslation();
  const { locale = "en", workspaceId: routeWorkspaceId, reportType } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [generatedAt] = useState(() => new Date());
  const location = useLocation();
  const reportHref = useHref(`${location.pathname}${location.search}`);

  const type: QuickReportType = isQuickReportType(reportType) ? reportType : "sales";
  const definition = quickReports[type];
  const title = quickReportTitle(type);
  const range = toReportRange(searchParams.get("range"));

  const { workspaceId, workspaceName, formatMoney, formatDate, formatDateTime } = useReportFormatting();
  const ordersQuery = useGetOrders("", { enabled: definition.needs.orders });
  const clientsQuery = useGetClients("", "all", { enabled: definition.needs.clients });
  const employeesQuery = useGetEmployees();
  const inventoryQuery = useGetInventoryItems("", "all", inventorySort, { enabled: definition.needs.inventory });

  const today = localDateKey(generatedAt);
  const period = reportPeriod(range, generatedAt);
  const periodLabel = definition.usesPeriod ? `${formatDate(period.start)} – ${formatDate(period.end)}` : t("reports.asOf", { date: formatDate(today) });
  const generatedLabel = formatDateTime(generatedAt);

  const needed = [
    definition.needs.orders && ordersQuery,
    definition.needs.clients && clientsQuery,
    definition.needs.employees && employeesQuery,
    definition.needs.inventory && inventoryQuery,
  ].filter((query) => query !== false);
  const isLoading = !workspaceId || needed.some((query) => query.isLoading);
  const isError = needed.some((query) => ("isError" in query ? query.isError : Boolean(query.error)));

  let model: QuickReportModel | null = null;
  if (!isLoading && !isError) {
    if (type === "sales") model = salesReport(ordersQuery.orders, (clientsQuery.clients ?? []).map(clientCreatedAt), period);
    else if (type === "inventory") model = inventoryReport(inventoryQuery.items);
    else if (type === "employees") model = employeeReport(ordersQuery.orders, employeesQuery.employees ?? [], period, today);
    else model = financialReport(ordersQuery.orders, inventoryQuery.items, period);
  }

  const documentTitle = `${title} – ${workspaceName} – ${periodLabel}`;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = documentTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [documentTitle]);

  if (!isQuickReportType(reportType)) return <Navigate to={`/${locale}/${routeWorkspaceId}/reports`} replace />;

  const exportCsv = () => {
    if (!model) return;
    const csv = reportCsv({ title, workspace: workspaceName, period: periodLabel, generated: generatedLabel }, model);
    const suffix = definition.usesPeriod ? `${period.start}_${period.end}` : today;
    downloadCsv(`${type}-report_${suffix}.csv`, csv);
  };

  return (
    <div className="space-y-4 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/${locale}/${routeWorkspaceId}/reports`} className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("reports.quickPage.backToReports")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {definition.usesPeriod && (
            <Select
              value={range}
              onValueChange={(value) => {
                const next = new URLSearchParams(searchParams);
                next.set("range", value);
                setSearchParams(next, { replace: true });
              }}
            >
              <SelectTrigger className="w-44" aria-label={t("reports.quickPage.periodLabel")}>
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
          )}
          <Button type="button" variant="outline" onClick={() => shareLink(documentTitle, `${window.location.origin}${reportHref}`)}>
            <Share2 />
            {t("reports.quickPage.share")}
          </Button>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={!model}>
            <Download />
            {t("reports.quickPage.exportCsv")}
          </Button>
          <Button type="button" onClick={() => window.print()} disabled={!model}>
            <Printer />
            {t("reports.quickPage.print")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground print:hidden">{t("reports.quickPage.shareNotice")}</p>

      {isLoading && (
        <div className="mx-auto w-full max-w-[210mm] space-y-4 rounded-lg border border-border bg-card p-10">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {isError && !isLoading && (
        <div role="alert" className="mx-auto w-full max-w-[210mm] rounded-lg border border-border bg-card p-10 text-center">
          <p className="font-medium text-foreground">{t("reports.charts.loadError")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("reports.charts.loadErrorHint")}</p>
        </div>
      )}

      {model && (
        <ReportDocument
          title={title}
          description={quickReportDescription(type)}
          workspaceName={workspaceName}
          periodLabel={periodLabel}
          generatedLabel={generatedLabel}
          model={model}
          formatMoney={formatMoney}
          formatDate={formatDate}
        />
      )}
    </div>
  );
}
