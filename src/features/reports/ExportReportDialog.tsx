import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Skeleton } from "../../ui/Skeleton";
import { localDateKey } from "../../pages/dashboardStats";
import { useGetOrders } from "../orders/useGetOrders";
import { useGetClients } from "../clients/useGetClients";
import useGetEmployees from "../employees/useGetEmployees";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { reportPeriod, type ReportRange } from "./reportStats";
import { reportCsv } from "./quickReports";
import { comprehensiveReport, comprehensiveReportDescription, comprehensiveReportTitle, exportNeeds, exportPreview, exportSectionKeys, exportSections, usesPeriod, type ExportSectionKey } from "./comprehensiveReport";
import { downloadCsv, rangeLabels, useReportFormatting } from "./reportFormatting";
import type { ReportPrintJob } from "./ReportPrintRoot";

type ExportFormat = "pdf" | "csv";

const inventorySort = { field: "name", ascending: true } as const;

const formats: { value: ExportFormat; label: string; description: string; icon: typeof FileText }[] = [
  { value: "pdf", label: "PDF", description: "Print-ready document. Choose “Save as PDF” in the print dialog.", icon: FileText },
  { value: "csv", label: "CSV", description: "Spreadsheet file with one table per section.", icon: FileSpreadsheet },
];

type ExportReportDialogProps = {
  open: boolean;
  range: ReportRange;
  onOpenChange: (open: boolean) => void;
  onPrint: (job: ReportPrintJob) => void;
};

export function ExportReportDialog({ open, range, onOpenChange, onPrint }: ExportReportDialogProps) {
  const pendingPrint = useRef<ReportPrintJob | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        // Runs after the dialog has fully closed and unmounted, so the print dialog never blocks the page mid-close.
        onCloseAutoFocus={() => {
          const job = pendingPrint.current;
          pendingPrint.current = null;
          if (job) onPrint(job);
        }}
      >
        <ExportReportForm
          range={range}
          open={open}
          onClose={() => onOpenChange(false)}
          onPrint={(job) => {
            pendingPrint.current = job;
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

type ExportReportFormProps = {
  range: ReportRange;
  open: boolean;
  onClose: () => void;
  onPrint: (job: ReportPrintJob) => void;
};

function ExportReportForm({ range, open, onClose, onPrint }: ExportReportFormProps) {
  const [selected, setSelected] = useState<ExportSectionKey[]>(exportSectionKeys);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const isOpen = useRef(open);
  const sectionsHeadingId = useId();

  const { workspaceId, workspaceName, formatMoney, formatDate, formatDateTime } = useReportFormatting();
  const ordersQuery = useGetOrders();
  const clientsQuery = useGetClients("");
  const employeesQuery = useGetEmployees();
  const inventoryQuery = useGetInventoryItems("", "all", inventorySort);

  const allSelected = selected.length === exportSectionKeys.length;
  const ordered = exportSectionKeys.filter((key) => selected.includes(key));
  const period = reportPeriod(range, new Date());
  const periodLabel = usesPeriod(ordered) || ordered.length === 0 ? `${formatDate(period.start)} – ${formatDate(period.end)}` : `As of ${formatDate(period.end)}`;
  const previewLoading = !workspaceId || ordersQuery.isLoading || clientsQuery.isLoading || employeesQuery.isLoading || inventoryQuery.isLoading;
  const preview = previewLoading ? null : exportPreview({ orders: ordersQuery.orders, clients: clientsQuery.clients ?? [], employees: employeesQuery.employees ?? [], items: inventoryQuery.items }, period, formatMoney);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.length > 0 && !allSelected;
  }, [selected.length, allSelected]);

  useEffect(() => {
    isOpen.current = open;
    return () => {
      isOpen.current = false;
    };
  }, [open]);

  const toggle = (key: ExportSectionKey) => setSelected((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const needs = exportNeeds(ordered);
      const [orders, clients, employees, items] = await Promise.all([
        needs.orders ? ordersQuery.refetch({ throwOnError: true }).then((result) => result.data ?? []) : [],
        needs.clients ? clientsQuery.refetch({ throwOnError: true }).then((result) => result.data ?? []) : [],
        needs.employees ? employeesQuery.refetch({ throwOnError: true }).then((result) => result.data ?? []) : [],
        needs.inventory ? inventoryQuery.refetch({ throwOnError: true }).then((result) => result.data ?? []) : [],
      ]);
      // Closed while the data was loading: the export was cancelled.
      if (!isOpen.current) return;

      const generatedAt = new Date();
      const exportPeriod = reportPeriod(range, generatedAt);
      const today = localDateKey(generatedAt);
      const model = comprehensiveReport({ orders, clients, employees, items }, ordered, exportPeriod, today);
      const withPeriod = usesPeriod(ordered);
      const exportPeriodLabel = withPeriod ? `${formatDate(exportPeriod.start)} – ${formatDate(exportPeriod.end)}` : `As of ${formatDate(today)}`;
      const generatedLabel = formatDateTime(generatedAt);

      if (format === "csv") {
        const csv = reportCsv({ title: comprehensiveReportTitle, workspace: workspaceName, period: exportPeriodLabel, generated: generatedLabel }, model);
        downloadCsv(`business-report_${withPeriod ? `${exportPeriod.start}_${exportPeriod.end}` : today}.csv`, csv);
        toast.success("Report exported", { id: "export-report" });
      } else {
        onPrint({
          title: comprehensiveReportTitle,
          description: comprehensiveReportDescription(ordered),
          workspaceName,
          periodLabel: exportPeriodLabel,
          generatedLabel,
          model,
          documentTitle: `${comprehensiveReportTitle} – ${workspaceName} – ${exportPeriodLabel}`,
        });
      }
      setIsGenerating(false);
      onClose();
    } catch (cause) {
      setIsGenerating(false);
      if (isOpen.current) setError(cause instanceof Error && cause.message ? cause.message : "Unknown error");
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#1973e1]/10 p-2">
            <FileText className="h-5 w-5 text-[#1973e1]" />
          </div>
          <div className="space-y-1 text-left">
            <DialogTitle>Export report</DialogTitle>
            <DialogDescription>
              Build a comprehensive report for <span className="font-medium text-[#282e33]">{rangeLabels[range]}</span> ({periodLabel}).
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-5">
          <fieldset className="space-y-2" disabled={isGenerating} aria-labelledby={sectionsHeadingId}>
            <div className="flex items-center justify-between gap-3">
              <p id={sectionsHeadingId} className="text-sm font-semibold text-[#282e33]">
                Include in report
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[#282e33]">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="size-4 cursor-pointer accent-[#1973e1]"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : exportSectionKeys)}
                />
                Select all
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {exportSectionKeys.map((key) => {
                const checked = selected.includes(key);
                return (
                  <label
                    key={key}
                    className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? "border-[#1973e1] bg-[#1973e1]/5" : "border-[#e5e7eb] hover:bg-[#f8f9fa]"}`}
                  >
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#1973e1]" checked={checked} onChange={() => toggle(key)} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[#282e33]">{exportSections[key].label}</span>
                      <span className="block text-xs text-[#939699]">{exportSections[key].description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-2" disabled={isGenerating}>
            <legend className="text-sm font-semibold text-[#282e33]">Format</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {formats.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${format === option.value ? "border-[#1973e1] bg-[#1973e1]/5" : "border-[#e5e7eb] hover:bg-[#f8f9fa]"}`}
                >
                  <input type="radio" name="export-format" value={option.value} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#1973e1]" checked={format === option.value} onChange={() => setFormat(option.value)} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-[#282e33]">
                      <option.icon className="h-4 w-4 text-[#1973e1]" />
                      {option.label}
                    </span>
                    <span className="block text-xs text-[#939699]">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <aside aria-label="Export preview" className="min-w-0 rounded-lg border border-[#e5e7eb] bg-[#f8f9fa] p-4">
          <h3 className="text-sm font-semibold text-[#282e33]">Report preview</h3>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-[#939699]">Workspace</dt>
              <dd className="truncate font-medium text-[#282e33]">{workspaceName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#939699]">Period</dt>
              <dd className="text-right font-medium text-[#282e33]">{periodLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#939699]">Format</dt>
              <dd className="font-medium text-[#282e33]">{format.toUpperCase()}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#939699]">Sections</dt>
              <dd className="font-medium text-[#282e33]">
                {ordered.length} of {exportSectionKeys.length}
              </dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-[#e5e7eb] pt-3">
            {ordered.length === 0 ? (
              <p className="text-xs text-[#939699]">Select at least one section to export.</p>
            ) : (
              <ol className="space-y-2">
                {ordered.map((key, index) => (
                  <li key={key} className="flex gap-2 text-xs">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1973e1]/10 font-medium text-[#1973e1]">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block font-medium text-[#282e33]">{exportSections[key].label}</span>
                      {preview ? <span className="block text-[#939699]">{preview[key]}</span> : <Skeleton className="mt-1 h-3 w-24" />}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Could not generate the report.</p>
            <p className="text-xs [overflow-wrap:anywhere]">Check your connection and try again. Details: {error}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={generate} disabled={isGenerating || ordered.length === 0 || !workspaceId} className="bg-[#1973e1] text-white hover:bg-[#1565c0]">
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating report...
            </>
          ) : (
            `Export ${format.toUpperCase()}`
          )}
        </Button>
      </div>
    </>
  );
}
