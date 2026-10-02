import { useEffect, useState } from "react";
import { Link, Navigate, useHref, useLocation, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, Calendar, Download, Printer, Share2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { formatWorkspaceDate, workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import { localDateKey, clientCreatedAt } from "../../pages/dashboardStats";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetOrders } from "../orders/useGetOrders";
import { useGetClients } from "../clients/useGetClients";
import useGetEmployees from "../employees/useGetEmployees";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { reportPeriod, type ReportRange } from "./reportStats";
import { employeeReport, financialReport, inventoryReport, isQuickReportType, quickReports, reportCsv, salesReport, toReportRange, type QuickReportModel, type QuickReportType } from "./quickReports";
import { ReportDocument } from "./ReportDocument";

const inventorySort = { field: "name", ascending: true } as const;

const rangeLabels: Record<ReportRange, string> = {
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  thisYear: "This Year",
};

function formatTime(date: Date, timeZone: string) {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }
}

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function shareLink(title: string, url: string) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error("Could not share the report link");
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Report link copied");
  } catch {
    toast.error("Could not copy the report link");
  }
}

export function QuickReportPage() {
  const { locale = "en", workspaceId: routeWorkspaceId, reportType } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [generatedAt] = useState(() => new Date());
  const location = useLocation();
  const reportHref = useHref(`${location.pathname}${location.search}`);

  const type: QuickReportType = isQuickReportType(reportType) ? reportType : "sales";
  const definition = quickReports[type];
  const range = toReportRange(searchParams.get("range"));

  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { formatMoney } = useWorkspaceMoney();
  const ordersQuery = useGetOrders("", { enabled: definition.needs.orders });
  const clientsQuery = useGetClients("", "all", { enabled: definition.needs.clients });
  const employeesQuery = useGetEmployees();
  const inventoryQuery = useGetInventoryItems("", "all", inventorySort, { enabled: definition.needs.inventory });

  const dateFormat = workspace?.dateFormat ?? workspacePreferenceDefaults.dateFormat;
  const timeZone = workspace?.timezone ?? workspacePreferenceDefaults.timezone;
  const workspaceName = workspace?.name || "Workspace";
  const formatDate = (value: string) => formatWorkspaceDate(value, dateFormat, timeZone);

  const today = localDateKey(generatedAt);
  const period = reportPeriod(range, generatedAt);
  const periodLabel = definition.usesPeriod ? `${formatDate(period.start)} – ${formatDate(period.end)}` : `As of ${formatDate(today)}`;
  const generatedLabel = `${formatWorkspaceDate(generatedAt.toISOString(), dateFormat, timeZone)} ${formatTime(generatedAt, timeZone)}`;

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

  const documentTitle = `${definition.title} – ${workspaceName} – ${periodLabel}`;

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
    const csv = reportCsv({ title: definition.title, workspace: workspaceName, period: periodLabel, generated: generatedLabel }, model);
    const suffix = definition.usesPeriod ? `${period.start}_${period.end}` : today;
    downloadCsv(`${type}-report_${suffix}.csv`, csv);
  };

  return (
    <div className="space-y-4 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/${locale}/${routeWorkspaceId}/reports`} className="inline-flex items-center gap-1 text-sm text-[#1973e1] hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
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
              <SelectTrigger className="w-45" aria-label="Report period">
                <Calendar className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(rangeLabels) as ReportRange[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {rangeLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="outline" onClick={() => shareLink(documentTitle, `${window.location.origin}${reportHref}`)}>
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={!model}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button type="button" onClick={() => window.print()} disabled={!model} className="bg-[#1973e1] text-white hover:bg-[#1565c0]">
            <Printer className="mr-2 h-4 w-4" />
            Print / PDF
          </Button>
        </div>
      </div>
      <p className="text-xs text-[#939699] print:hidden">Shared links open only for members of this workspace. Use Print / PDF to save a copy you can send to anyone.</p>

      {isLoading && (
        <div className="mx-auto w-full max-w-[210mm] space-y-4 rounded-md border border-[#e5e7eb] bg-white p-10">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {isError && !isLoading && (
        <div className="mx-auto w-full max-w-[210mm] rounded-md border border-[#e5e7eb] bg-white p-10 text-center">
          <p className="font-medium text-[#282e33]">Could not load report data</p>
          <p className="mt-1 text-sm text-[#939699]">Refresh the page to try again.</p>
        </div>
      )}

      {model && (
        <ReportDocument
          title={definition.title}
          description={definition.description}
          workspaceName={workspaceName}
          periodLabel={periodLabel}
          generatedLabel={generatedLabel}
          model={model}
          formatMoney={(value) => formatMoney(value)}
          formatDate={formatDate}
        />
      )}
    </div>
  );
}
